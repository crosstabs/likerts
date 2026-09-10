import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createServer as netServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {LikertsClient as WebClient} from '../sdks/web/dist/index.js';
import {LikertsClient} from '../tools/mcp/dist/client.js';
import {createServer} from '../tools/mcp/dist/server.js';
import {Client} from '../tools/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {InMemoryTransport} from '../tools/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=JSON.parse(await readFile(new URL('../contracts/conditional-survey.example.json',import.meta.url)));
const fleet={installations:[{target:'web',sdkVersion:'0.0.2',schemaVersions:[1,2,3]}]};
const probe=netServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}`,token='conditional-local-test';
const processServer=spawn(`${root}backend/target/debug/likerts-server`,[],{env:{...process.env,LIKERTS_PORT:String(port),LIKERTS_ADMISSION_MODE:'disabled',LIKERTS_ADMISSION_REST_URL:undefined,LIKERTS_ADMISSION_REST_TOKEN:undefined,LIKERTS_ALLOW_MEMORY:'1',LIKERTS_DEV_TOKENS:JSON.stringify({[token]:'conditional'})},stdio:['ignore','ignore','pipe']});
let logs='';processServer.stderr.on('data',chunk=>logs+=chunk);let server,mcp;
try {
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`${base}/health`)).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,50))}assert(ready,logs);
 const cli=(operation,input)=>JSON.parse(execFileSync(`${root}tools/cli/target/debug/likerts`,['call',operation,'--input','-'],{input:JSON.stringify(input),encoding:'utf8',env:{...process.env,LIKERTS_API_URL:base,LIKERTS_TOKEN:token}}));
 server=createServer(new LikertsClient(base,token));mcp=new Client({name:'conditional',version:'1.0.0'});const [left,right]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(left),mcp.connect(right)]);
 const call=async(name,args={})=>{const result=await mcp.callTool({name,arguments:args});if(result.isError)throw new Error(result.content[0].text);return JSON.parse(result.content[0].text)};
 const survey=cli('surveys_create',{idempotencyKey:'conditional-create',...fixture});
 const published=await call('surveys_publish',{id:survey.id,revision:1,sdkCapabilities:fleet});assert.equal(published.version,1);
 const collection=cli('collections_create',{idempotencyKey:'conditional-collection',surveyId:survey.id,version:1,placement:'app',sdkCapabilities:fleet});
 const web=new WebClient(base,collection.token),configuration=await web.collection(collection.id);assert.equal(configuration.schema.schemaVersion,3);assert.deepEqual(configuration.schema.questions,fixture.questions.map(question=>({required:false,...question})));
 await web.submit(collection.id,{idempotencyKey:'hidden',answers:{return:'yes',reason:'discard me',contactDate:'2026-09-08'},metadata:{}});
 await assert.rejects(()=>web.submit(collection.id,{idempotencyKey:'visible-missing',answers:{return:'no'},metadata:{}}),error=>error.status===400);
 await web.submit(collection.id,{idempotencyKey:'visible',answers:{return:'no',reason:'late'},metadata:{}});
 const responses=cli('responses_list',{collectionId:collection.id});assert.deepEqual(responses.items.map(item=>item.answers),[{return:'yes'},{return:'no',reason:'late'}]);
 const usage=await call('usage_get');assert.equal(usage.chargedCents,2);
 const cyclic=structuredClone(fixture);cyclic.questions[0].visibleWhen={questionId:'contactDate',operator:'answered'};
 await assert.rejects(()=>call('surveys_create',{idempotencyKey:'conditional-cycle',...cyclic}),/400/);
 console.log('Conditional API/MCP/CLI/Web integration: v3 schema, hidden-answer persistence, visible requiredness, unbilled rejection and cycle denial passed.');
} finally {await mcp?.close();await server?.close();processServer.kill('SIGTERM');await new Promise(resolve=>processServer.exitCode!==null?resolve():processServer.once('exit',resolve));}
