import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const freePort=async()=>{const probe=createNetServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port};
const backendPort=await freePort();const token='web-browser-management-token';const backendBase=`http://127.0.0.1:${backendPort}`;
const backend=spawn(`${root}backend/target/debug/likerts-server`,[],{env:{...process.env,LIKERTS_PORT:String(backendPort),LIKERTS_ALLOW_MEMORY:'1',LIKERTS_ALLOW_DEV_AUTH:'1',LIKERTS_DEV_TOKENS:JSON.stringify({[token]:'web-browser'})},stdio:['ignore','ignore','pipe']});
let backendLogs='';backend.stderr.on('data',chunk=>backendLogs+=chunk);
const json=async(path,body)=>{const response=await fetch(`${backendBase}${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error(`${path}: ${response.status} ${await response.text()}`);return response.json()};
let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`${backendBase}/health`)).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,50))}if(!ready)throw new Error(`backend failed: ${backendLogs}`);
const sdkCapabilities={installations:[{target:'web',sdkVersion:'0.0.1',schemaVersions:[1,2]}]};
const survey=await json('/v1/surveys',{idempotencyKey:'browser-survey',title:'Checkout feedback',questions:[{id:'rating',type:'single_choice',label:'How was checkout?',required:true,options:[{id:'good',label:'Good'},{id:'bad',label:'Bad'}]},{id:'comment',type:'text',label:'What should improve?',required:true,maxLength:100}]});
const version=await json(`/v1/surveys/${survey.id}/publish`,{revision:survey.revision,sdkCapabilities});
const collection=await json('/v1/collections',{idempotencyKey:'browser-collection',surveyId:survey.id,version:version.version,placement:'browser-test',sdkCapabilities});
const sdk=await readFile(new URL('../dist/index.js',import.meta.url));
const app=Buffer.from(`import {LikertsClient,mountSurvey} from '/sdk.js';
window.cspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push(event.violatedDirective));
const bootstrap=await fetch('/bootstrap.json').then(response=>response.json());
const client=new LikertsClient(location.origin,bootstrap.token);const config=await client.collection(bootstrap.id);
window.disposeSurvey=mountSurvey(document.querySelector('main'),config,client,receipt=>{document.querySelector('#receipt').textContent=receipt.responseId}, {}, {messages:{selectPlaceholder:'Choose one',submit:'Send response',submitting:'Sending…',submitted:'Response sent'},classNames:{form:'customer-survey'}});
document.querySelector('#ready').textContent='ready';`);
const css=Buffer.from(`.customer-survey{font-family:system-ui;max-width:32rem}.likerts-question{margin-block:1rem}.likerts-label,.likerts-control{display:block}.likerts-control{margin-top:.25rem}.likerts-status:focus{outline:2px solid currentColor}`);
const html=Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Likerts browser integration</title><link rel="stylesheet" href="/app.css"><script type="module" src="/app.js"></script></head><body><main></main><output id="ready"></output><output id="receipt"></output></body></html>');
const csp="default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const server=createServer(async(req,res)=>{try{
  if(req.url?.startsWith('/v1/')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const headers={authorization:req.headers.authorization??''};if(req.headers['content-type'])headers['content-type']=req.headers['content-type'];const upstream=await fetch(`${backendBase}${req.url}`,{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined,redirect:'manual'});res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});res.end(Buffer.from(await upstream.arrayBuffer()));return}
  res.setHeader('content-security-policy',csp);res.setHeader('x-content-type-options','nosniff');
  if(req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}
  else if(req.url==='/app.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(app)}
  else if(req.url==='/sdk.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(sdk)}
  else if(req.url==='/app.css'){res.writeHead(200,{'content-type':'text/css; charset=utf-8'});res.end(css)}
  else if(req.url==='/bootstrap.json'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:collection.id,token:collection.token}))}
  else if(req.url==='/result.json'){const usage=await fetch(`${backendBase}/v1/usage`,{headers:{authorization:`Bearer ${token}`}});res.writeHead(usage.status,{'content-type':'application/json'});res.end(Buffer.from(await usage.arrayBuffer()))}
  else{res.writeHead(404);res.end()}
}catch(error){res.writeHead(500);res.end(String(error))}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));console.log(`http://127.0.0.1:${server.address().port}`);
const stop=()=>{server.close();backend.kill('SIGTERM')};process.on('SIGTERM',stop);process.on('SIGINT',stop);
