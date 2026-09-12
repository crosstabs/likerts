import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {createBridge,redisCommand} from './fixtures/redis-rest-bridge.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),redisPort=Number(process.env.LIKERTS_ADMISSION_TEST_REDIS_PORT);
assert(redisPort,'Run scripts/check-admission.sh');
const restToken='synthetic-admission-rest-token',serviceToken='synthetic-admission-service-token';
const bridge=await createBridge(redisPort,restToken),children=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function start(index){
 const port=await freePort();
 const env={...process.env,DATABASE_URL:'',LIKERTS_PORT:String(port),LIKERTS_ALLOW_MEMORY:'1',LIKERTS_ALLOW_DEV_AUTH:'1',LIKERTS_DEV_TOKENS:JSON.stringify({[serviceToken]:'admission-fixture'}),LIKERTS_ADMISSION_MODE:'required',LIKERTS_ADMISSION_REST_URL:bridge.url,LIKERTS_ADMISSION_REST_TOKEN:restToken,LIKERTS_ADMISSION_NAMESPACE:'two-process-fixture',LIKERTS_ADMISSION_MANAGEMENT_RPS:'4',LIKERTS_ADMISSION_BROWSER_RPS:'2',LIKERTS_ADMISSION_TIMEOUT_MS:'150',LIKERTS_MANAGEMENT_ORIGINS:'https://app.customer.example'};
 // Do not inherit any real provider configuration into synthetic local processes.
 for(const key of Object.keys(env))if(/^LIKERTS_(BROWSER_SESSION|BROWSER_WORKSPACE|OIDC|WEBHOOK_CREDENTIAL|EXPORT|VERCEL_BLOB|REQUIRE_REMOTE)/.test(key))delete env[key];
 const child=spawn(`${root}backend/target/debug/likerts-server`,[],{env,stdio:['ignore','ignore','pipe']});let logs='';child.stderr.on('data',v=>logs+=v);children.push(child);
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await sleep(50);}assert(ready,`API${index} startup failed: ${logs}`);return base;
}
try {
 const bases=await Promise.all([start(0),start(1)]);
 const request=(index,path='/v1/usage',options={})=>fetch(bases[index]+path,{headers:{authorization:'Bearer invalid-synthetic-token','x-forwarded-for':`203.0.113.${Math.floor(Math.random()*200)+1}`,'forwarded':'for=198.51.100.8','origin':'https://app.customer.example'},...options});
 // All eight requests start within one Redis window; each replica contributes4.
 const responses=await Promise.all(Array.from({length:8},(_,i)=>request(i%2)));
 assert.equal(responses.filter(r=>r.status===401).length,4,'exactly one shared budget, not4per replica');
 assert.equal(responses.filter(r=>r.status===429).length,4);
 for(const response of responses.filter(r=>r.status===429)){assert.equal(response.headers.get('retry-after'),'1');assert.equal(response.headers.get('access-control-allow-origin'),'https://app.customer.example');assert.equal((await response.json()).error.code,'rate_limited');}
 const browser=await Promise.all(Array.from({length:4},(_,i)=>request(i%2,'/v1/browser/bootstrap',{method:'POST'})));
 assert.equal(browser.filter(r=>r.status===401).length,2,'management flood must not consume browser budget');assert.equal(browser.filter(r=>r.status===429).length,2);
 const keys=await redisCommand(redisPort,['KEYS','likerts:admission:v1:two-process-fixture:*']);assert.equal(keys.length,2);assert(keys.every(k=>/(management|browser)$/.test(k)));
 const calls=bridge.state.calls;
 await Promise.all(Array.from({length:40},(_,i)=>request(i%2)));assert.equal(bridge.state.calls,calls,'local process ceilings prevent paid Redis denial amplification');
 assert.equal((await fetch(bases[0]+'/health')).status,200);assert.equal((await fetch(bases[1]+'/.well-known/oauth-protected-resource')).status,404);assert.equal(bridge.state.calls,calls,'health/discovery bypass admission');
 await sleep(1100);
 assert.equal((await request(1,'/v1/usage',{headers:{authorization:`Bearer ${serviceToken}`}})).status,200,'shared admission recovers after expiry');
 for(const mode of ['denied','malformed','oversized','redirect','timeout']) {
  await sleep(1100);bridge.state.mode=mode;const before=Date.now();
  const result=await request(0);assert.equal(result.status,503,mode);assert.deepEqual(await result.json(),{error:{code:'admission_unavailable',message:'Request admission is temporarily unavailable'}});assert.equal(result.headers.get('retry-after'),'1');assert(Date.now()-before<1500,'provider delay must be bounded');
  assert.equal((await fetch(bases[1]+'/health')).status,200,'admission outage does not break health');
 }
 assert.equal(bridge.state.redirected,0,'Redis credentials must never follow redirect');
 bridge.state.mode='normal';await sleep(1100);
 assert.equal((await request(0,'/v1/usage',{headers:{authorization:`Bearer ${serviceToken}`}})).status,200);
 const evidence={replicas:2,redis:'real isolated Redis',sharedManagementBudget:4,separateBrowserBudget:2,fixedKeyCount:2,forwardedHeadersDoNotAffectKeys:true,localRedisCallsBounded:true,failClosedCases:5,healthExempt:true,redirectsFollowed:0};
 console.log('Distributed admission PASS: '+JSON.stringify(evidence));
}finally{
 for(const child of children)child.kill('SIGTERM');
 await Promise.all(children.map(child=>new Promise(r=>child.exitCode!==null?r():child.once('exit',r))));await bridge.close();
}
