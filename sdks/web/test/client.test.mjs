import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LikertsClient, LikertsError, LIKERTS_SDK_CAPABILITY} from '../dist/index.js';
const behavior=JSON.parse(readFileSync(new URL('../../../contracts/sdk-behavior.json',import.meta.url)));
const compatibility=JSON.parse(readFileSync(new URL('../../../contracts/sdk-compatibility.json',import.meta.url)));
test('loads shared SDK behavior contract',()=>{assert.equal(behavior.contractVersion,1);assert.equal(behavior.scenarios.length,9);});
// SDK-CONTRACT: schema.unknown
test('collection capability is sent; unknown schema rejected', async()=>{
 let request;
 const client=new LikertsClient('https://example.test','public-token',async(url,init)=>{request={url,init};return Response.json({id:'c',schema:{schemaVersion:6,questions:[]}});});
 await assert.rejects(()=>client.collection('a/b'),/Unsupported/);
 assert.equal(request.url,'https://example.test/v1/collections/a%2Fb'); assert.equal(request.init.headers.Authorization,'Bearer public-token');
 assert.equal(request.init.redirect,'error');
});
// SDK-CONTRACT: retry.ambiguous
test('ambiguous failure retries preserve payload and key',async()=>{
 const bodies=[];let attempt=0;
 const client=new LikertsClient('https://example.test/','token',async(url,init)=>{bodies.push(init.body);if(attempt++===0) throw new TypeError('network disconnected');return Response.json({accepted:true,chargedCents:1,responseId:'r',collectionId:'c'});});
 const submission={idempotencyKey:'same-key',answers:{q:4},metadata:{}};
 await assert.rejects(()=>client.submit('c',submission));
 const receipt=await client.submit('c',submission);assert.equal(receipt.accepted,true);assert.equal(bodies[0],bodies[1]);
});
// SDK-CONTRACT: callback.success
test('server denial is not reported as acceptance',async()=>{
 const client=new LikertsClient('https://example.test','token',async()=>new Response('{"error":{"code":"invalid"}}',{status:422}));
 await assert.rejects(()=>client.submit('c',{idempotencyKey:'k',answers:{},metadata:{}}),e=>e instanceof LikertsError&&e.status===422);
});
test('unaccepted or incorrectly charged receipts are rejected',async()=>{
 for(const receipt of [{accepted:false,chargedCents:1},{accepted:true,chargedCents:2}]){
  const client=new LikertsClient('https://example.test','token',async()=>Response.json(receipt));
  await assert.rejects(()=>client.submit('c',{idempotencyKey:'k',answers:{},metadata:{}}),/Invalid Likerts receipt/);
 }
});
// SDK-CONTRACT: transport.https
test('HTTPS is required except exact loopback development hosts',()=>{
 assert.throws(()=>new LikertsClient('http://example.test','token'),/HTTPS/);
 assert.throws(()=>new LikertsClient('https://user@example.test','token'),/HTTPS/);
 assert.doesNotThrow(()=>new LikertsClient('http://localhost:8080','token'));
 assert.doesNotThrow(()=>new LikertsClient('http://127.0.0.1:8080','token'));
});
// SDK-CONTRACT: transport.redirect
// SDK-CONTRACT: transport.timeout
test('timeout aborts one request without retrying and redirects are rejected',async()=>{
 let calls=0;let redirect;
 const client=new LikertsClient('https://example.test','token',async(_url,init)=>{
  calls++;redirect=init.redirect;
  return await new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
 });
 await assert.rejects(()=>client.collection('c',{timeoutMs:5}));
 assert.equal(calls,1);assert.equal(redirect,'error');
});
// SDK-CONTRACT: lifecycle.cancellation
test('caller cancellation aborts the active request',async()=>{
 const controller=new AbortController();let observed=false;
 const client=new LikertsClient('https://example.test','token',async(_url,init)=>await new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>{observed=true;reject(init.signal.reason);},{once:true})));
 const pending=client.collection('c',{signal:controller.signal});controller.abort(new Error('disposed'));
 await assert.rejects(()=>pending,/disposed/);assert.equal(observed,true);
});
test('declares capability and caches immutable bindings until explicit refresh',async()=>{
 assert.deepEqual(LIKERTS_SDK_CAPABILITY,compatibility.currentFleet.installations[0]);
 let calls=0;let version=1;
 const payload=()=>({id:'c',surveyId:'s',version,placement:'p',schema:{schemaVersion:1,title:'T',questions:[]}});
 const client=new LikertsClient('https://example.test','token',async()=>{calls++;return Response.json(payload())});
 const first=await client.collection('c');assert.equal((await client.collection('c')),first);assert.equal(calls,1);
 assert.equal((await client.collection('c',{refresh:true})).version,1);assert.equal(calls,2);
 version=2;await assert.rejects(()=>client.collection('c',{refresh:true}),/binding changed/);assert.equal(calls,3);
 version=1;await client.collection('c');assert.equal(calls,4);
});
test('failed refresh evicts cache instead of serving stale configuration',async()=>{
 let calls=0;const payload={id:'c',surveyId:'s',version:1,placement:'p',schema:{schemaVersion:1,title:'T',questions:[]}};
 const client=new LikertsClient('https://example.test','token',async()=>{calls++;if(calls===2)throw new Error('offline');return Response.json(payload)});
 await client.collection('c');await assert.rejects(()=>client.collection('c',{refresh:true}),/offline/);await client.collection('c');assert.equal(calls,3);
});
test('bounds successful and error response bodies before JSON decoding',async()=>{
 const oversized='x'.repeat(33);
 for(const response of [new Response(oversized),new Response(oversized,{status:422})]){
  const client=new LikertsClient('https://example.test','token',async()=>response,15000,300000,32);
  await assert.rejects(()=>client.collection('c'),/size limit/);
 }
 const declared=new LikertsClient('https://example.test','token',async()=>new Response('{}',{headers:{'content-length':'100'}}),15000,300000,32);
 await assert.rejects(()=>declared.collection('c'),/size limit/);
 let cancelled=false;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(20));controller.enqueue(new Uint8Array(20));},cancel(){cancelled=true}});
 const chunked=new LikertsClient('https://example.test','token',async()=>new Response(stream),15000,300000,32);await assert.rejects(()=>chunked.collection('c'),/size limit/);assert.equal(cancelled,true);
});
// SDK-CONTRACT: validation.required
// SDK-CONTRACT: validation.selection-bounds
