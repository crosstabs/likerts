#!/usr/bin/env node
// Explicit, localhost-only synthetic browser acceptance. Importing this module starts nothing.
import {createServer} from 'node:http';
import {readFile, lstat, open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash, timingSafeEqual} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const FIELDS=['schemaVersion','target','sdkVersion','baseUrl','collectionId','collectionToken','idempotencyKey','responseCap','disposable'].sort();
const fail=code=>{throw new Error(code)};
const requireValue=(condition,code)=>{if(!condition)fail(code)};
const sameKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
export function validateConfig(config){
  requireValue(sameKeys(config,FIELDS),'invalid_config_fields');
  requireValue(config.schemaVersion===1&&config.target==='web'&&config.sdkVersion==='0.0.3'&&config.responseCap===1&&config.disposable===true,'invalid_config_boundary');
  const url=new URL(config.baseUrl);
  requireValue(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&['','/'].includes(url.pathname),'exact_https_origin_required');
  requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.collectionId),'invalid_collection_id');
  requireValue(typeof config.collectionToken==='string'&&config.collectionToken.length>=16&&config.collectionToken.length<=4096&&!/[\s\x00-\x1f\x7f]/.test(config.collectionToken),'invalid_collection_token');
  requireValue(typeof config.idempotencyKey==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(config.idempotencyKey),'invalid_idempotency_key');
  return {...config,baseUrl:url.origin};
}
export async function readPrivateConfig(path){
  const info=await lstat(path);
  requireValue(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&info.size<=8192,'private_regular_config_required');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const opened=await handle.stat();
    requireValue(opened.ino===info.ino&&opened.dev===info.dev&&(opened.mode&0o077)===0,'config_changed');
    try{execFileSync('git',['ls-files','--error-unmatch',resolve(path)],{cwd:ROOT,stdio:'ignore'});fail('config_must_not_be_tracked')}
    catch(error){if(error.message==='config_must_not_be_tracked')throw error}
    return validateConfig(JSON.parse(await handle.readFile('utf8')));
  }finally{await handle.close()}
}

export async function releasedAssets(){
  const archive=resolve(ROOT,'releases/0.0.3/likerts-web-0.0.3.tgz');
  const bytes=await readFile(archive);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const manifest=JSON.parse(await readFile(resolve(ROOT,'releases/0.0.3/manifest.json'),'utf8'));
  const entry=manifest.artifacts.find(item=>item.file==='likerts-web-0.0.3.tgz');
  requireValue(entry?.sha256===sha256&&entry.bytes===bytes.length,'release_archive_checksum_mismatch');
  const packageJson=JSON.parse(execFileSync('tar',['-xOf',archive,'package/package.json'],{maxBuffer:65536}).toString());
  requireValue(packageJson.name==='@likerts/web'&&packageJson.version==='0.0.3','release_package_mismatch');
  const assets=new Map();
  for(const name of ['index','advanced-questions','branching','choice-features']){
    assets.set(`/sdk/${name}.js`,execFileSync('tar',['-xOf',archive,`package/dist/${name}.js`],{maxBuffer:1024*1024}));
  }
  return {assets,sha256};
}

const HTML=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Likerts Web SDK hosted acceptance</title><link rel="stylesheet" href="/host.css"></head><body><main><p class="eyebrow">Same-team synthetic acceptance · released SDK 0.0.3</p><h1>Web SDK: hosted collection</h1><p>This local host checks a real required-rating form and the real SDK client through a restricted local proxy. No management credential enters this page.</p><ol><li>Try Submit with the required rating empty. No response request should be sent.</li><li>Enter <strong>5</strong> and submit once.</li><li>Retry the identical submission and compare the accepted receipt.</li></ol><p id="host-status" role="status">Loading collection…</p><section id="survey" aria-label="Released SDK survey"></section><button id="retry" disabled>Retry identical submission</button><button id="evidence">Refresh request evidence</button><pre id="proof" aria-live="polite"></pre><p class="note">One collection, one intended response, no real respondent data. The operator verifies the workspace ledger separately. This does not test direct browser-to-hosted CORS.</p></main><script type="module" src="/app.js"></script></body></html>`;
const CSS=`body{margin:0;background:#f3f5f8;color:#17212d;font:16px/1.55 system-ui,sans-serif}main{max-width:740px;margin:48px auto;padding:32px;background:white;border:1px solid #dce2eb;border-radius:16px}.eyebrow,.note{font-size:13px;color:#526579}h1{line-height:1.2}button,input{font:inherit}button{padding:10px 16px;margin:8px 8px 8px 0;border-radius:8px;border:1px solid #b6c2d2;background:#edf2ff;color:#142441}button:disabled{opacity:.5}label{display:block;font-weight:600}input{padding:10px;border:1px solid #9aabc0;border-radius:6px;width:100px}.likerts-form{border-top:1px solid #dce2eb;padding-top:12px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f3f5f8;padding:16px;border-radius:8px}#host-status{font-weight:650}@media(max-width:600px){main{margin:0;border:0;border-radius:0;padding:20px}}`;
const APP=String.raw`import {LikertsClient,mountSurvey,LIKERTS_SDK_CAPABILITY} from '/sdk/index.js';
const status=document.querySelector('#host-status'),proof=document.querySelector('#proof'),retryButton=document.querySelector('#retry');
let captured,firstReceipt,originalSubmit,collectionId;
const sameReceipt=(a,b)=>a&&b&&a.responseId===b.responseId&&a.collectionId===b.collectionId&&a.accepted===true&&b.accepted===true&&a.chargedCents===1&&b.chargedCents===1;
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value)}return value};
async function evidence(){const data=await fetch('/evidence',{cache:'no-store'}).then(r=>r.json());proof.textContent=JSON.stringify(data,null,2);return data}
document.querySelector('#evidence').addEventListener('click',()=>evidence().catch(()=>{status.textContent='Evidence unavailable'}));
retryButton.addEventListener('click',async()=>{
  retryButton.disabled=true;
  try{const receipt=await originalSubmit(collectionId,captured);if(!sameReceipt(firstReceipt,receipt))throw Error();status.textContent='HOSTED PASS — identical retry returned the same accepted receipt';await evidence()}
  catch{status.textContent='Retry not confirmed. Stop and inspect private operator evidence.'}
});
(async()=>{try{
  const config=await fetch('/bootstrap',{cache:'no-store'}).then(r=>r.json());
  if(LIKERTS_SDK_CAPABILITY.sdkVersion!=='0.0.3')throw Error();
  collectionId=config.collectionId;
  const client=new LikertsClient(location.origin,config.collectionToken,undefined,10000);
  const collection=await client.collection(collectionId,{refresh:true});
  if(collection.id!==collectionId||collection.schema.questions.length!==1||!collection.schema.questions.some(q=>q.id==='rating'&&q.type==='scale'&&q.required===true&&q.min===1&&q.max===5))throw Error();
  originalSubmit=client.submit.bind(client);
  // Observe mountSurvey's generated payload, then call the unmodified real SDK method.
  // No fetch replacement, fixed receipt, or backend simulation exists in this page.
  client.submit=async(id,submission,options)=>{
    const snapshot=JSON.parse(JSON.stringify(submission));
    if(captured&&JSON.stringify(captured)!==JSON.stringify(snapshot))throw Error('One intended response only');
    captured??=deepFreeze(snapshot);
    return originalSubmit(id,submission,options);
  };
  mountSurvey(document.querySelector('#survey'),collection,client,receipt=>{
    if(!receipt.accepted||receipt.chargedCents!==1||receipt.collectionId!==collectionId){status.textContent='Receipt mismatch';return}
    firstReceipt=receipt;retryButton.disabled=false;status.textContent='First accepted receipt confirmed. Retry the identical submission.';evidence();
  },{source:'synthetic-web-hosted',target:'web'});
  status.textContent='Ready — try the required field empty first';
  await evidence();
}catch{status.textContent='Setup failed. Stop and inspect private operator evidence.'}})();`;

async function boundedBody(stream,limit){
  const chunks=[];let total=0;
  for await(const chunk of stream){total+=chunk.length;if(total>limit)fail('body_too_large');chunks.push(chunk)}
  return Buffer.concat(chunks);
}
function publicReceipt(value,collectionId){
  if(!value||value.collectionId!==collectionId||value.accepted!==true||value.chargedCents!==1||typeof value.responseId!=='string'||!/^[0-9a-f-]{36}$/i.test(value.responseId))return null;
  return {responseId:value.responseId,collectionId:value.collectionId,accepted:true,chargedCents:1};
}

export async function startHarness({config:input,port=0,fetchImpl=globalThis.fetch}){
  const config=validateConfig(input),release=await releasedAssets();
  const collectionPath=`/v1/collections/${config.collectionId}`,responsePath=collectionPath+'/responses';
  let origin,firstBody,active=false,gets=0,posts=0;
  const receipts=[],failures=[];
  const evidence=()=>({target:'web',sdkVersion:'0.0.3',releaseArchiveSha256:release.sha256,collectionId:config.collectionId,upstreamRequests:{collectionGets:gets,responsePosts:posts},receipts,identicalRetrySameReceipt:receipts.length===2&&JSON.stringify(receipts[0])===JSON.stringify(receipts[1]),failures,boundary:'same-team synthetic real browser SDK through localhost proxy; direct CORS and ledger acceptance separate'});
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':type});res.end(type==='application/json'?JSON.stringify(value):value)};
    try{
      if(req.headers.host!==new URL(origin).host)return send(403,{error:'host_denied'});
      if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'origin_denied'});
      if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return send(403,{error:'cross_site_denied'});
      const path=req.url;
      if(req.method==='GET'&&path==='/')return send(200,HTML,'text/html; charset=utf-8');
      if(req.method==='GET'&&path==='/host.css')return send(200,CSS,'text/css; charset=utf-8');
      if(req.method==='GET'&&path==='/app.js')return send(200,APP,'text/javascript; charset=utf-8');
      if(req.method==='GET'&&release.assets.has(path))return send(200,release.assets.get(path),'text/javascript; charset=utf-8');
      if(req.method==='GET'&&path==='/bootstrap')return send(200,{collectionId:config.collectionId,collectionToken:config.collectionToken,sdkVersion:'0.0.3'});
      if(req.method==='GET'&&path==='/evidence')return send(200,evidence());
      const isGet=req.method==='GET'&&path===collectionPath,isPost=req.method==='POST'&&path===responsePath;
      if(!isGet&&!isPost)return send(404,{error:'route_denied'});
      const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+config.collectionToken);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(401,{error:'collection_credential_required'});
      if(active)return send(409,{error:'one_request_at_a_time'});
      if((isGet&&gets>=2)||(isPost&&posts>=2))return send(429,{error:'acceptance_budget_exhausted'});
      active=true;
      const abort=new AbortController();const timer=setTimeout(()=>{abort.abort();req.destroy()},15000);
      try{
        let body;
        if(isPost){
          if(req.headers['content-type']!=='application/json')return send(415,{error:'json_required'});
          body=await boundedBody(req,16384);
          let value;
          try{value=JSON.parse(body.toString('utf8'))}catch{return send(400,{error:'invalid_json'})}
          if(!sameKeys(value,['idempotencyKey','answers','metadata'])||typeof value.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value.idempotencyKey)||!sameKeys(value.answers,['rating'])||value.answers.rating!==5||!sameKeys(value.metadata,['source','target'])||value.metadata.source!=='synthetic-web-hosted'||value.metadata.target!=='web')return send(400,{error:'synthetic_fixture_only'});
          if(firstBody&&!firstBody.equals(body))return send(409,{error:'identical_retry_required'});
          firstBody??=Buffer.from(body);posts++;
        }else gets++;
        const upstream=await fetchImpl(config.baseUrl+path,{method:req.method,headers:{authorization:'Bearer '+config.collectionToken,...(isPost?{'content-type':'application/json'}:{})},...(body?{body}:{}),redirect:'manual',signal:abort.signal});
        if(upstream.status>=300&&upstream.status<400){failures.push('upstream_redirect_denied');return send(502,{error:'upstream_redirect_denied'})}
        const bytes=await boundedBody(upstream.body??[],256*1024);
        if(isPost&&upstream.ok){const receipt=publicReceipt(JSON.parse(bytes.toString('utf8')),config.collectionId);if(receipt)receipts.push(receipt);else failures.push('invalid_receipt')}
        // Only bounded JSON is returned; no upstream cookies/location/arbitrary headers.
        const value=JSON.parse(bytes.toString('utf8'));
        return send(upstream.status,value);
      }catch(error){abort.abort();const code=error.message==='body_too_large'?'body_too_large':'upstream_or_payload_failed';failures.push(code);if(!res.headersSent&&!res.destroyed)send(code==='body_too_large'?413:502,{error:code})}
      finally{clearTimeout(timer);active=false}
    }catch{if(!res.headersSent&&!res.destroyed)send(400,{error:'request_rejected'})}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolveListen)});
  origin=`http://127.0.0.1:${server.address().port}`;
  const close=()=>new Promise(resolveClose=>{server.closeAllConnections();server.close(resolveClose)});
  return {origin,evidence,close};
}

async function main(){
  const args=process.argv.slice(2);const value=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined};
  const path=value('--config');requireValue(path,'private_config_path_required');
  const port=Number(value('--port')??0);requireValue(Number.isInteger(port)&&port>=0&&port<=65535,'invalid_port');
  const config=await readPrivateConfig(resolve(path));
  if(args.includes('--validate-only')){const release=await releasedAssets();console.log(JSON.stringify({target:'web',config:'validated',releaseArchiveSha256:release.sha256,networkCalls:0}));return}
  const harness=await startHarness({config,port});
  console.log(JSON.stringify({url:harness.origin,evidenceUrl:harness.origin+'/evidence',target:'web',sdkVersion:'0.0.3',status:'ready_no_upstream_requests_yet'}));
  const stop=async()=>{await harness.close();process.exit(0)};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const expiry=setTimeout(stop,20*60*1000);expiry.unref();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){main().catch(()=>{console.error('Web hosted harness failed preflight/startup (details redacted).');process.exitCode=1})}
