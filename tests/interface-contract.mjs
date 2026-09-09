import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Client} from '../tools/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {InMemoryTransport} from '../tools/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import {createServer} from '../tools/mcp/dist/server.js';
import {LikertsClient,capabilities} from '../tools/mcp/dist/client.js';
import {operationContracts} from '../tools/mcp/dist/contract.js';
import {examples} from '../contracts/example-data.mjs';
const spec=JSON.parse(readFileSync(new URL('../contracts/openapi.json',import.meta.url)));
const Ajv=createRequire(new URL('../tools/mcp/package.json',import.meta.url))('ajv/dist/2020').default;
const validateToolError=new Ajv({strict:false}).compile({$ref:'#/components/schemas/ToolError',components:spec.components});
const cli=fileURLToPath(new URL('../tools/cli/target/debug/likerts',import.meta.url));
const SECRET='synthetic-upstream-secret-must-never-be-echoed';
function runCli(base,args,input){return new Promise((resolve,reject)=>{
  const child=spawn(cli,args,{env:{...process.env,LIKERTS_API_URL:base,LIKERTS_TOKEN:'synthetic-management',LIKERTS_COLLECTION_TOKEN:'synthetic-collection',LIKERTS_WORKSPACE_ID:'example-workspace'},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';const timeout=setTimeout(()=>child.kill(),10000);
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>1e6)child.kill();});child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>1e6)child.kill();});
  child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);resolve({code,stdout,stderr});});
  child.stdin.end(input===undefined?'':JSON.stringify(input));
});}

test('all capabilities preserve typed inputs, HTTP mapping, credentials and output across MCP and CLI',async()=>{
  let active,requestCount=0,serverFailure;
  const http=createHttpServer(async(req,res)=>{try{
    assert.ok(active,'Unexpected request');requestCount++;
    const {capability:c,input,output,status}=active;const url=new URL(req.url,'http://fixture');
    assert.equal(req.method,c.method);assert.equal(url.pathname,c.path.replace('{id}',input.id??''));
    assert.equal(req.headers.authorization,`Bearer synthetic-${c.auth==='management'?'management':'collection'}`);
    assert.equal(req.headers['x-likerts-workspace'],c.auth==='management'?'example-workspace':undefined);
    let raw='';for await(const chunk of req)raw+=chunk;
    const body={...input};if(c.path.includes('{id}'))delete body.id;
    if(c.method==='GET'){assert.equal(raw,'');assert.deepEqual(Object.fromEntries(url.searchParams),Object.fromEntries(Object.entries(body).map(([k,v])=>[k,String(v)])));}
    else{assert.equal(url.search,'');assert.deepEqual(JSON.parse(raw),body);}
    res.writeHead(status,{'content-type':'application/json'});res.end(status===204?'':JSON.stringify(output));
  }catch(error){serverFailure=error;res.writeHead(500);res.end('{}');}});
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${http.address().port}`;
  const server=createServer(new LikertsClient(base,'synthetic-management','synthetic-collection',fetch,'example-workspace'));
  const client=new Client({name:'full-parity-test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);
  try{
    const listed=await client.listTools();assert.deepEqual(listed.tools.map(t=>t.name).sort(),capabilities.map(c=>c.name).sort());
    const cliListed=await runCli(base,['capabilities']);assert.equal(cliListed.code,0);assert.deepEqual(cliListed.stdout.trim().split('\n').map(line=>line.split('\t')[0]).sort(),capabilities.map(c=>c.name).sort());
    for(const c of capabilities){
      const example=examples[c.name],operation=spec.paths[c.path][c.method.toLowerCase()];const status=Number(Object.keys(operation.responses).find(s=>/^2\d\d$/.test(s)));
      active={capability:c,...example,status};
      const published=listed.tools.find(t=>t.name===c.name),contract=operationContracts.get(c.name);
      assert.deepEqual(published.inputSchema,contract.inputSchema);assert.deepEqual(published.outputSchema,contract.outputSchema);
      const result=await client.callTool({name:c.name,arguments:example.input});
      assert.equal(result.isError,undefined,`${c.name}: ${JSON.stringify(result)}`);assert.deepEqual(JSON.parse(result.content[0].text),example.output);assert.deepEqual(result.structuredContent,{result:example.output});
      const invoked=await runCli(base,['call',c.name,'--input','-'],example.input);assert.equal(invoked.code,0,`${c.name}: ${invoked.stderr}`);assert.deepEqual(JSON.parse(invoked.stdout),example.output);
      const before=requestCount;const invalid=await client.callTool({name:c.name,arguments:{...example.input,unknownFixtureField:true}});assert.equal(invalid.isError,true);assert.equal(requestCount,before,`${c.name} invalid input must not dispatch`);
      active.status=c.auth==='management'?403:401;active.output={error:{code:SECRET,message:SECRET}};
      const failed=await client.callTool({name:c.name,arguments:example.input});assert.equal(failed.isError,true);const envelope=JSON.parse(failed.content[0].text);assert.ok(validateToolError(envelope));assert.equal(envelope.error.status,active.status);assert.equal(envelope.error.operation,c.name);assert.equal(envelope.error.code,'http_error');assert.ok(!JSON.stringify(failed).includes(SECRET));
      const cliFailed=await runCli(base,['call',c.name,'--input','-'],example.input);assert.equal(cliFailed.code,1);assert.equal(cliFailed.stdout,'');const cliError=JSON.parse(cliFailed.stderr);assert.deepEqual(cliError,envelope);assert.ok(!cliFailed.stderr.includes(SECRET));
      assert.equal(serverFailure,undefined);
    }
    const c=capabilities.find(c=>c.name==='responses_submit');
    for(const status of [400,402,404,409,410,413,415,429,500]){active={capability:c,...examples[c.name],status,output:{error:{message:SECRET}}};const result=await client.callTool({name:c.name,arguments:active.input});assert.equal(JSON.parse(result.content[0].text).error.status,status);const cliResult=await runCli(base,['call',c.name,'--input','-'],active.input);assert.equal(JSON.parse(cliResult.stderr).error.status,status);assert.ok(!JSON.stringify(result).includes(SECRET));}
    active={capability:capabilities.find(c=>c.name==='usage_get'),input:{},status:200,output:{secret:SECRET}};
    const malformed=await client.callTool({name:'usage_get',arguments:{}});assert.equal(malformed.isError,true);assert.equal(JSON.parse(malformed.content[0].text).error.code,'invalid_response');assert.ok(!JSON.stringify(malformed).includes(SECRET));
    assert.equal(serverFailure,undefined);
  }finally{await client.close();await server.close();await new Promise(resolve=>http.close(resolve));}
});
