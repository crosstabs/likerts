import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { capabilities, LikertsClient } from '../src/client.js';
import { createServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { examples } from '../../../contracts/example-data.mjs';

test('malformed configured origin never exposes credentials in startup stderr', () => {
  const sentinel = 'LIKERTS_SYNTHETIC_CREDENTIAL_SENTINEL';
  const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/main.ts', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, LIKERTS_API_URL: `https://user:${sentinel}@[invalid` },
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LIKERTS_API_URL must be a valid origin/);
  assert.equal(result.stderr.includes(sentinel), false);
  assert.equal(result.stdout, '');
});

test('uses correct credential and preserves retry payload', async () => {
  const calls: {url: string; init: RequestInit}[] = [];
  const transport: typeof fetch = async (url, init) => { calls.push({url: String(url), init: init!}); return Response.json({accepted: true}); };
  const client = new LikertsClient('https://api.example.com', 'admin', 'submit', transport);
  const payload = {id: 'collection-1', idempotencyKey: 'stable-key', answers: {rating: 5}};
  await client.call('responses_submit', payload); await client.call('responses_submit', payload);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer submit');
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {idempotencyKey:'stable-key', answers:{rating:5}});
  assert.equal(calls[0].init.redirect, 'error');
  await client.call('usage_get', {});
  assert.equal(new Headers(calls[2].init.headers).get('authorization'), 'Bearer admin');
  await client.call('responses_list', {limit: 25, collectionId: '123e4567-e89b-12d3-a456-426614174000'});
  assert.equal(calls[3].url, 'https://api.example.com/v1/responses?limit=25&collectionId=123e4567-e89b-12d3-a456-426614174000');
  assert.equal(calls[3].init.body, undefined);
});
test('rejects unsafe origins, missing collection credential and resource traversal', async () => {
  assert.throws(() => new LikertsClient('http://example.com', 'secret'));
  assert.throws(() => new LikertsClient('https://secret@example.com', 'secret'));
  const client = new LikertsClient('https://api.example.com', 'admin');
  await assert.rejects(client.call('collections_get', {id:'a'}), /Missing collection credential/);
  await assert.rejects(client.call('surveys_publish', {id:'../usage',revision:1}), /Invalid resource ID/);
});
test('MCP exposes exactly registry operations and dispatches calls', async () => {
  const transport: typeof fetch = async () => Response.json(examples.usage_get.output);
  const server = createServer(new LikertsClient('https://api.example.com', 'admin', 'submit', transport));
  const client = new Client({name:'test',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a),client.connect(b)]);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(x=>x.name).sort(), capabilities.map(x=>x.name).sort());
    const result = await client.callTool({name:'usage_get',arguments:{}});
    assert.equal(result.isError, undefined);
    const invalid = await client.callTool({name:'surveys_publish',arguments:{id:'survey-1',revision:-1}});
    assert.equal(invalid.isError,true);
  } finally { await client.close(); await server.close(); }
});

test('MCP publishes expanded input shapes and preserves create/update question definitions', async () => {
  const {readFileSync} = await import('node:fs');
  const draft = JSON.parse(readFileSync(new URL('../../../contracts/expanded-survey.example.json', import.meta.url),'utf8'));
  const calls: {url:string; body:unknown}[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({url:String(url),body:JSON.parse(init!.body as string)});
    const body=JSON.parse(init!.body as string);
    return Response.json({...examples.surveys_create.output,title:body.title,questions:body.questions});
  };
  const server = createServer(new LikertsClient('https://api.example.com','admin','submit',transport));
  const client = new Client({name:'expanded-test',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a),client.connect(b)]);
  try {
    const listed = await client.listTools();
    const schema = JSON.stringify(listed.tools.find(t=>t.name==='surveys_create')!.inputSchema);
    for (const field of ['preset','labels','minSelections','maxSelections']) assert.ok(schema.includes(field),`${field} discoverable`);
    const createInput = {idempotencyKey:'expanded-create',...draft};
    const created = await client.callTool({name:'surveys_create',arguments:createInput});
    assert.equal(created.isError,undefined);
    assert.deepEqual(calls[0].body,createInput);
    const updated = await client.callTool({name:'surveys_update',arguments:{id:'survey-1',revision:1,...draft}});
    assert.equal(updated.isError,undefined);
    assert.deepEqual(calls[1].body,{revision:1,...draft});
    const invalid = await client.callTool({name:'surveys_create',arguments:{title:'Invalid',questions:[{...draft.questions[0],preset:'yes_no'}]}});
    assert.equal(invalid.isError,true);
    const invalidLabels = await client.callTool({name:'surveys_create',arguments:{title:'Invalid',questions:[{...draft.questions[0],labels:{'01':'Invalid'}}]}});
    assert.equal(invalidLabels.isError,true);
    const invalidBounds = await client.callTool({name:'surveys_create',arguments:{title:'Invalid',questions:[{...draft.questions[3],maxSelections:-1}]}});
    assert.equal(invalidBounds.isError,true);
    assert.equal(calls.length,2,'Invalid schema inputs must not reach the API');
  } finally { await client.close(); await server.close(); }
});

test('MCP requires discoverable SDK capability declarations for publish and collection binding', async () => {
  const calls: unknown[]=[];const transport:typeof fetch=async(_url,init)=>{calls.push(JSON.parse(init!.body as string));return Response.json(examples.surveys_publish.output)};
  const server=createServer(new LikertsClient('https://api.example.com','admin','submit',transport));const client=new Client({name:'compatibility-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);
  try { const tools=await client.listTools();for(const name of ['surveys_publish','collections_create']){const schema=JSON.stringify(tools.tools.find(tool=>tool.name===name)!.inputSchema);assert.match(schema,/sdkCapabilities/);assert.match(schema,/schemaVersions/);}
    const missing=await client.callTool({name:'surveys_publish',arguments:{id:'survey-1',revision:1}});assert.equal(missing.isError,true);assert.equal(calls.length,0);
    const declaration={installations:[{target:'web',sdkVersion:'0.0.1',schemaVersions:[1,2]}]};const accepted=await client.callTool({name:'surveys_publish',arguments:{id:'survey-1',revision:1,sdkCapabilities:declaration}});assert.equal(accepted.isError,undefined);assert.deepEqual(calls[0],{revision:1,sdkCapabilities:declaration});
  } finally {await client.close();await server.close();}
});
