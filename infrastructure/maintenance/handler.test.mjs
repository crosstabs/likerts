import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, childEnvironment, runChild, verifyBundle } from './handler.mjs';

const secret = 'a'.repeat(40);
const environment = { CRON_SECRET: secret, LIKERTS_CLEANUP_DATABASE_URL: 'postgres://fixture', LIKERTS_VERCEL_BLOB_TOKEN: 'private-export-token', LIKERTS_EXPORT_PREFIX: 'exports', HOME: '/private', NODE_OPTIONS: '--require=bad', UNRELATED_SECRET: 'must-not-inherit' };
const archiveEnv = { CRON_SECRET: secret, LIKERTS_ERASURE_DATABASE_URL: 'postgres://archive-fixture', LIKERTS_ERASURE_BLOB_TOKEN: 'private-archive-token', LIKERTS_ERASURE_SOURCE_ID: 'private-source', LIKERTS_ERASURE_NAMESPACE: 'fixture' };
const idle = 'retention={"worked":false}\ncleanup_worked=false\n';
async function invoke(handler, overrides = {}) {
  let body;
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { body = JSON.parse(value); } };
  await handler({ method: 'GET', url: '/api/run', headers: { authorization: `Bearer ${secret}` }, ...overrides }, response);
  return { status: response.statusCode, body, headers: response.headers };
}
function handler(kind = 'cleanup', overrides = {}) {
  return makeHandler(kind, new URL('./', import.meta.url), { environment: kind === 'cleanup' ? environment : archiveEnv, verify: async () => '/fixed/worker', execute: async () => idle, ...overrides });
}

test('authentication and exact route fail before verification or child launch', async () => {
  const h = handler('cleanup', { verify: async () => assert.fail('must not verify') });
  for (const authorization of [undefined, '', 'Bearer bad', 'x'.repeat(2048)]) assert.equal((await invoke(h, { headers: { authorization } })).status, 401);
  for (const url of ['/api/run?command=fence', '/api/run/other', '/api/run?source=evil']) assert.equal((await invoke(h, { url })).status, 400);
  assert.equal((await invoke(h, { method: 'POST' })).status, 400);
  assert.equal((await invoke(handler('cleanup', { environment: { ...environment, CRON_SECRET: '' } }))).status, 503);
});
test('only fixed command and credential allowlist reach the worker', async () => {
  const result = await invoke(handler('cleanup', { execute: async (binary, args, env, timeout) => {
    assert.equal(binary, '/fixed/worker'); assert.deepEqual(args, ['once']); assert.equal(timeout,45000);
    assert.equal(env.LIKERTS_EXPORT_STORE,'vercel_blob');
    for (const key of ['CRON_SECRET','HOME','NODE_OPTIONS','UNRELATED_SECRET']) assert.equal(env[key],undefined);
    return idle;
  } }));
  assert.equal(result.status,200); assert.equal(result.body.rounds,1); assert.equal(result.body.idle,true); assert.equal(result.headers['Cache-Control'],'no-store');
});
test('mixed role credentials and owner connections fail closed', () => {
  for (const key of ['DATABASE_URL','LIKERTS_MIGRATION_DATABASE_URL','LIKERTS_ERASURE_BLOB_TOKEN']) assert.throws(() => childEnvironment('cleanup',{...environment,[key]:'not-permitted'},'/ca'),/credential_boundary_failed/);
  assert.throws(() => childEnvironment('archive',{...archiveEnv,LIKERTS_VERCEL_BLOB_TOKEN:'not-permitted'},'/ca'),/credential_boundary_failed/);
});
test('cleanup has a fixed round cap and reports backlog budget honestly', async () => {
  let calls=0;
  const result=await invoke(handler('cleanup',{execute:async()=>{calls++;return 'retention={"worked":true,"responsesErased":1000,"exportsRevoked":2}\ncleanup_worked=true\n';}}));
  assert.equal(calls,20); assert.equal(result.body.responsesErased,20000); assert.equal(result.body.deleted,20); assert.equal(result.body.budgetExhausted,true);
});
test('cleanup stops before another operation can exceed deadline budget',async()=>{
  let clock=0,calls=0;
  const result=await invoke(handler('cleanup',{now:()=>clock,execute:async()=>{calls++;clock+=60000;return 'retention={"worked":false}\ncleanup_worked=true\n';}}));
  assert.equal(calls,3); assert.equal(result.body.budgetExhausted,true);
});
test('archive returns only reviewed aggregate fields',async()=>{
  const result=await invoke(handler('archive',{execute:async(binary,args,env,timeout)=>{
    assert.deepEqual(args,['drain']); assert.equal(timeout,200000); assert.equal(env.LIKERTS_ERASURE_BATCH_SIZE,'100');
    return JSON.stringify({operation:'drain',archivedThisRun:3,checkpoint:{id:'secret-checkpoint',sha256:'private-hash'},status:{sourceId:'private-source',fenceId:'private-fence',pendingEvents:2,coveredEvents:5,oldestPendingSeconds:8}});
  }}));
  assert.equal(result.status,200); assert.deepEqual(result.body,{ok:true,kind:'archive',archived:3,pending:2,covered:5,oldestPendingSeconds:8,checkpointWritten:true});
  assert.doesNotMatch(JSON.stringify(result),/private|secret/);
});
test('malformed worker output and arbitrary failures are sanitized',async()=>{
  for(const output of ['private-record','retention={}\ncleanup_worked=true\n',idle+'private-extra']) {
    const result=await invoke(handler('cleanup',{execute:async()=>output}));
    assert.deepEqual(result.body,{ok:false,error:'worker_output_invalid'});
  }
  const result=await invoke(handler('cleanup',{execute:async()=>{throw new Error('postgres://private-password');}}));
  assert.deepEqual(result.body,{ok:false,error:'maintenance_failed'});
});
test('idle cleanup discards unexpected raw fields instead of echoing them',async()=>{
  const result=await invoke(handler('cleanup',{execute:async()=> 'retention={"worked":false,"responsesErased":"private-answer","exportsRevoked":{"token":"private"}}\ncleanup_worked=false\n'}));
  assert.equal(result.status,200); assert.equal(result.body.responsesErased,0); assert.equal(result.body.exportsRevoked,0);
  assert.doesNotMatch(JSON.stringify(result),/private/);
});
test('real child process does not inherit parent secrets or forward stderr',async()=>{
  const output=await runChild(process.execPath,['-e',"process.stderr.write('private-provider-body');process.stdout.write(String(process.env.CRON_SECRET))"],{},2000);
  assert.equal(output,'undefined');
  await assert.rejects(runChild(process.execPath,['-e',"process.stderr.write('private-provider-body');process.exit(1)"],{},2000),{message:'worker_failed'});
});
test('real child timeout and output flood are bounded and sanitized',async()=>{
  await assert.rejects(runChild(process.execPath,['-e','setInterval(()=>{},1000)'],{},50),{message:'worker_timeout'});
  await assert.rejects(runChild(process.execPath,['-e',"process.stdout.write('private'.repeat(20000));setInterval(()=>{},1000)"],{},2000),{message:'worker_output_limit'});
  await assert.rejects(runChild('/nonexistent/maintenance-worker',[],{},1000),{message:'worker_start_failed'});
});
test('missing or wrong-platform bundle fails closed',async()=>{
  await assert.rejects(verifyBundle(new URL('./missing/',import.meta.url),'cleanup'),{message:'bundle_invalid'});
});
