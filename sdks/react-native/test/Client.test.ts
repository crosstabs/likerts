import {LikertsClient,LIKERTS_SDK_CAPABILITY} from '../src/index';

const fixture=require('../../../contracts/sdk-behavior.json');
const compatibility=require('../../../contracts/sdk-compatibility.json');
const response=(value:unknown,status=200)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(value),json:async()=>value}) as Response;

// SDK-CONTRACT: validation.required
// SDK-CONTRACT: validation.selection-bounds
// Renderer tests exercise both validation cases without invoking onSubmit.
// SDK-CONTRACT: schema.unknown
test('loads shared contract and rejects future schema',async()=>{
 expect(fixture.contractVersion).toBe(1);
 const client=new LikertsClient('https://example.test','token',async()=>response({id:'c',schema:{schemaVersion:6,questions:[]}}));
 await expect(client.collection('c')).rejects.toThrow('Unsupported');
});

// SDK-CONTRACT: transport.https
test('requires HTTPS except loopback',()=>{
 expect(()=>new LikertsClient('http://example.test','token')).toThrow('HTTPS');
 expect(()=>new LikertsClient('http://localhost:3000','token')).not.toThrow();
});

// SDK-CONTRACT: transport.redirect
// SDK-CONTRACT: transport.timeout
test('rejects redirects and timeout aborts without retry',async()=>{
 let calls=0;let redirect:RequestRedirect|undefined;
 const client=new LikertsClient('https://example.test','token',async(_url,init)=>{calls++;redirect=init?.redirect;return await new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));});
 await expect(client.collection('c',{timeoutMs:5})).rejects.toThrow('aborted');
 expect(calls).toBe(1);expect(redirect).toBe('error');
});

// SDK-CONTRACT: lifecycle.cancellation
test('caller cancellation aborts an active operation',async()=>{
 const controller=new AbortController();let observed=false;
 const client=new LikertsClient('https://example.test','token',async(_url,init)=>await new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>{observed=true;reject(new Error('cancelled'));},{once:true})));
 const request=client.collection('c',{signal:controller.signal});controller.abort();
 await expect(request).rejects.toThrow('cancelled');expect(observed).toBe(true);
});

// SDK-CONTRACT: retry.ambiguous
test('ambiguous retry preserves caller payload and is never automatic',async()=>{
 const bodies:string[]=[];
 const client=new LikertsClient('https://example.test','token',async(_url,init)=>{bodies.push(String(init?.body));if(bodies.length===1)throw new Error('lost');return response({responseId:'r',collectionId:'c',accepted:true,chargedCents:1});});
 const submission={idempotencyKey:'stable',answers:{q:4},metadata:{}};
 await expect(client.submit('c',submission)).rejects.toThrow('lost');expect(bodies).toHaveLength(1);
 await expect(client.submit('c',submission)).resolves.toMatchObject({accepted:true});expect(bodies[0]).toBe(bodies[1]);
});

// SDK-CONTRACT: callback.success
test('only a valid accepted receipt resolves as completion',async()=>{
 const client=new LikertsClient('https://example.test','token',async()=>response({responseId:'r',collectionId:'c',accepted:false,chargedCents:1}));
 await expect(client.submit('c',{idempotencyKey:'k',answers:{},metadata:{}})).rejects.toThrow('Invalid Likerts receipt');
});

test('declares capability and refreshes an immutable cached binding',async()=>{
 expect(LIKERTS_SDK_CAPABILITY).toEqual(compatibility.currentFleet.installations[1]);
 let calls=0;let version=1;const client=new LikertsClient('https://example.test','token',async()=>{calls++;return response({id:'c',surveyId:'s',version,placement:'p',schema:{schemaVersion:1,title:'T',questions:[]}})});
 await client.collection('c');await client.collection('c');expect(calls).toBe(1);
 await client.collection('c',{refresh:true});expect(calls).toBe(2);
 version=2;await expect(client.collection('c',{refresh:true})).rejects.toThrow('binding changed');
 version=1;await client.collection('c');expect(calls).toBe(4);
});
