import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {startHarness,validateConfig,releasedAssets} from './check-web-hosted.mjs';

// Synthetic local proxy checks only. No hosted request, private config or browser proof.
const config={schemaVersion:1,target:'web',sdkVersion:'0.0.3',baseUrl:'https://unit-test.invalid',collectionId:'11111111-1111-4111-8111-111111111111',collectionToken:'test_collection_only_fake_credential',idempotencyKey:'test_config_key',responseCap:1,disposable:true};
const path=`/v1/collections/${config.collectionId}`;
const headers={authorization:`Bearer ${config.collectionToken}`,'content-type':'application/json'};
const body=JSON.stringify({idempotencyKey:'generated-ui-key',answers:{rating:5},metadata:{source:'synthetic-web-hosted',target:'web'}});
const receipt={responseId:'22222222-2222-4222-8222-222222222222',collectionId:config.collectionId,accepted:true};
async function host(t,fetchImpl){const h=await startHarness({config,fetchImpl});t.after(()=>h.close());return h}
function rawStatus(origin,{path='/',headers={}}={}){
  const url=new URL(origin);
  return new Promise((resolve,reject)=>{
    const req=request({host:url.hostname,port:url.port,path,headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});
    req.on('error',reject);req.end();
  });
}

test('config rejects management fields and non-disposable or non-HTTPS scope',()=>{
  assert.equal(validateConfig(config).target,'web');
  for(const changed of [{managementToken:'forbidden'},{target:'android'},{disposable:false},{responseCap:2},{baseUrl:'http://api.example'},{baseUrl:'https://api.example/v1'},{baseUrl:'https://user:pass@api.example'}])assert.throws(()=>validateConfig({...config,...changed}));
});

test('static modules are exact release bytes and only bootstrap contains collection credential',async t=>{
  const h=await host(t,()=>{throw Error('unexpected upstream')});
  const released=await releasedAssets();
  for(const route of ['/','/app.js','/host.css','/evidence',...released.assets.keys()]){
    const response=await fetch(h.origin+route);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const bytes=Buffer.from(await response.arrayBuffer());assert.ok(!bytes.includes(config.collectionToken));
    if(released.assets.has(route))assert.deepEqual(bytes,released.assets.get(route));
  }
  const bootstrap=await fetch(h.origin+'/bootstrap').then(r=>r.json());
  assert.deepEqual(Object.keys(bootstrap).sort(),['collectionId','collectionToken','sdkVersion']);
  assert.equal(bootstrap.collectionToken,config.collectionToken);
  assert.deepEqual(h.evidence().upstreamRequests,{collectionGets:0,responsePosts:0});
});

test('wrong route, host, origin, method and credential never reach upstream',async t=>{
  let calls=0;const h=await host(t,()=>{calls++;throw Error('unexpected upstream')});
  for(const route of ['/v1/usage',path+'?redirect=https://example.com',path+'/../responses','/sdk/other.js'])assert.equal((await fetch(h.origin+route)).status,404);
  assert.equal((await fetch(h.origin+path,{method:'PUT',headers})).status,404);
  assert.equal((await fetch(h.origin+path)).status,401);
  assert.equal((await fetch(h.origin+'/bootstrap',{headers:{origin:'https://other.invalid'}})).status,403);
  assert.equal(await rawStatus(h.origin,{path:'/bootstrap',headers:{host:'evil.invalid'}}),403);
  assert.equal(await rawStatus(h.origin,{path:'/bootstrap',headers:{'sec-fetch-site':'cross-site'}}),403);
  assert.equal(calls,0);
});

test('fixture validation, exact retry bytes, fixed upstream and request budgets',async t=>{
  const calls=[];const h=await host(t,async(url,options)=>{calls.push({url,options});return Response.json(options.method==='GET'?{id:config.collectionId}:receipt)});
  const post=(b=body,hdr=headers)=>fetch(h.origin+path+'/responses',{method:'POST',headers:hdr,body:b});
  assert.equal((await post('{')).status,400);
  assert.equal((await post(body,{authorization:headers.authorization,'content-type':'text/plain'})).status,415);
  assert.equal((await post(body.replace('"rating":5','"rating":4'))).status,400);
  assert.equal(calls.length,0);
  assert.equal((await fetch(h.origin+path,{headers})).status,200);
  assert.deepEqual(await (await post()).json(),receipt);
  assert.equal((await post(body.replace('generated-ui-key','different-ui-key'))).status,409);
  assert.deepEqual(await (await post()).json(),receipt);
  assert.equal((await post()).status,429);
  assert.equal((await fetch(h.origin+path,{headers})).status,200);
  assert.equal((await fetch(h.origin+path,{headers})).status,429);
  assert.equal(calls.length,4);
  assert.deepEqual(calls.filter(c=>c.options.method==='POST').map(c=>c.options.body.toString()),[body,body]);
  for(const call of calls){assert.ok(call.url.startsWith(config.baseUrl+path));assert.equal(call.options.redirect,'manual');assert.equal(call.options.headers.authorization,headers.authorization);assert.ok(call.options.signal instanceof AbortSignal)}
  assert.deepEqual(h.evidence().upstreamRequests,{collectionGets:2,responsePosts:2});
  assert.equal(h.evidence().identicalRetrySameReceipt,true);
  assert.ok(!JSON.stringify(h.evidence()).includes(config.collectionToken));
});

test('upstream redirects and oversized response bodies are stopped',async t=>{
  let calls=0;const h=await host(t,async()=>{calls++;return calls===1?new Response(null,{status:302,headers:{location:'https://other.invalid'}}):new Response('x'.repeat(256*1024+1))});
  const first=await fetch(h.origin+path,{headers});assert.equal(first.status,502);assert.equal(first.headers.get('location'),null);
  const second=await fetch(h.origin+path,{headers});assert.equal(second.status,413);
  assert.deepEqual(h.evidence().failures,['upstream_redirect_denied','body_too_large']);
  assert.equal(calls,2);
});

test('one concurrent upstream operation and oversized request rejection',async t=>{
  let resolveResponse,calls=0;const h=await host(t,()=>{calls++;return new Promise(resolve=>{resolveResponse=resolve})});
  const first=fetch(h.origin+path,{headers});
  while(!resolveResponse)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await fetch(h.origin+path,{headers})).status,409);
  resolveResponse(Response.json({id:config.collectionId}));assert.equal((await first).status,200);
  try{assert.equal((await fetch(h.origin+path+'/responses',{method:'POST',headers,body:'x'.repeat(16385)})).status,413)}catch(error){if(error.code!=='UND_ERR_SOCKET'&&error.cause?.code!=='UND_ERR_SOCKET')throw error}
  assert.equal(calls,1);
});
