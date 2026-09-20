import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, childEnvironment, runChild, verifyBundle } from './handler.mjs';

const secret = 'a'.repeat(40);
const monitorSecret = 'm'.repeat(40);
const environment = { CRON_SECRET: secret, LIKERTS_MONITOR_SECRET: monitorSecret, LIKERTS_CLEANUP_DATABASE_URL: 'postgres://fixture', LIKERTS_VERCEL_BLOB_TOKEN: 'private-export-token', LIKERTS_EXPORT_PREFIX: 'exports', HOME: '/private', NODE_OPTIONS: '--require=bad', UNRELATED_SECRET: 'must-not-inherit' };
const archiveEnv = { CRON_SECRET: secret, LIKERTS_MONITOR_SECRET: monitorSecret, LIKERTS_ERASURE_DATABASE_URL: 'postgres://archive-fixture', LIKERTS_ERASURE_BLOB_TOKEN: 'private-archive-token', LIKERTS_ERASURE_SOURCE_ID: 'private-source', LIKERTS_ERASURE_NAMESPACE: 'fixture' };
const idle = 'retention={"worked":false}\ncleanup_worked=false\n';
async function invoke(handler, overrides = {}) {
  let body;
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { body = JSON.parse(value); } };
  await handler({ method: 'GET', url: '/api/run', headers: { authorization: `Bearer ${secret}` }, ...overrides }, response);
  return { status: response.statusCode, body, headers: response.headers };
}
async function status(handler, overrides = {}) {
  return invoke(handler, { url: '/api/status', headers: { 'x-likerts-monitor-secret': monitorSecret }, ...overrides });
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
test('authentication accepts Node and Web header collections', async () => {
  assert.equal((await invoke(handler('cleanup'), {
    url: 'https://likerts-cleanup.vercel.app/api/run',
    headers: new Headers({ authorization: `Bearer ${secret}` }),
  })).status, 200);
  const statusHandler = handler('cleanup', { execute: async () => JSON.stringify({
    cleanup: { pendingObjects: 0, retryingObjects: 0, tombstones: 0, oldestDueSeconds: 0 },
    retention: { dueWorkspaces: 0, oldestDueSeconds: 0, lastCompletedAt: null },
  }) });
  assert.equal((await status(statusHandler, {
    url: 'https://likerts-cleanup.vercel.app/api/status',
    headers: new Headers({ 'x-likerts-monitor-secret': monitorSecret }),
  })).status, 200);
  assert.equal((await status(statusHandler, {
    url: 'https://likerts-cleanup.vercel.app/api/run?likerts_action=status',
    headers: new Headers({ 'x-likerts-monitor-secret': monitorSecret }),
  })).status, 200);
  assert.equal((await status(statusHandler, {
    headers: new Headers({ 'x-likerts-monitor-secret': 'wrong' }),
  })).status, 401);
  for (const url of [
    'https://likerts-cleanup.vercel.app/api/status?',
    'https://likerts-cleanup.vercel.app/api/status#ignored',
    'https://likerts-cleanup.vercel.app/api/status?likerts_action=status',
  ]) assert.equal((await invoke(statusHandler, {
    url, headers: new Headers({ authorization: `Bearer ${secret}` }),
  })).status, 400);
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
test('read-only status has a distinct credential and fixed child command', async () => {
  const cleanup = await status(handler('cleanup', { execute: async (binary, args, env, timeout) => {
    assert.deepEqual(args, ['status']); assert.equal(timeout, 20000);
    assert.equal(env.CRON_SECRET, undefined); assert.equal(env.LIKERTS_MONITOR_SECRET, undefined);
    assert.equal(env.LIKERTS_VERCEL_BLOB_TOKEN, undefined); assert.equal(env.LIKERTS_EXPORT_PREFIX, undefined);
    return JSON.stringify({ cleanup: { pendingObjects: 2, retryingObjects: 1, tombstones: 4, oldestDueSeconds: 8 },
      retention: { dueWorkspaces: 3, oldestDueSeconds: 9, lastCompletedAt: '2026-09-20T01:02:03Z' }, private: 'omit' });
  } }));
  assert.deepEqual(cleanup.body, { ok: true, kind: 'cleanup', status: { pendingObjects: 2, retryingObjects: 1,
    tombstones: 4, oldestDueSeconds: 8, dueWorkspaces: 3, oldestRetentionSeconds: 9,
    lastCompletedAt: '2026-09-20T01:02:03Z' } });
  assert.doesNotMatch(JSON.stringify(cleanup), /private|fixture/);
  assert.equal((await status(handler('cleanup'), { headers: { 'x-likerts-monitor-secret': secret } })).status, 401);
  assert.equal((await status(handler('cleanup'), { headers: { authorization: `Bearer ${monitorSecret}` } })).status, 401);
  assert.equal((await invoke(handler('cleanup', { execute: async () => JSON.stringify({
    cleanup: { pendingObjects: 0, retryingObjects: 0, tombstones: 0, oldestDueSeconds: 0 },
    retention: { dueWorkspaces: 0, oldestDueSeconds: 0, lastCompletedAt: null },
  }) }), { url: '/api/run?likerts_action=status', headers: { 'x-likerts-monitor-secret': monitorSecret } })).status, 200);
  assert.equal((await status(handler('cleanup', { environment: { ...environment, LIKERTS_MONITOR_SECRET: secret } }))).status, 503);
});
test('archive status omits identifiers and cannot invoke mutating work', async () => {
  const result = await status(handler('archive', { execute: async (binary, args, env, timeout) => {
    assert.deepEqual(args, ['monitor-status']); assert.equal(timeout, 30000);
    assert.equal(env.LIKERTS_ERASURE_BLOB_TOKEN, undefined); assert.equal(env.LIKERTS_ERASURE_NAMESPACE, undefined);
    return JSON.stringify({ sourceId: 'private-source', fenceId: null, fencedAt: null,
      checkpointId: 'private-checkpoint', checkpointHash: 'private-hash', coveredEvents: 5954,
      pendingEvents: 0, oldestPendingSeconds: 0, uncheckpointedEvents: 0, oldestUncheckpointedSeconds: 0,
      retryingEvents: 0, activeLeases: 0, staleLeases: 0, pendingCheckpoint: false,
      pendingCheckpointAgeSeconds: 0 });
  } }));
  assert.deepEqual(result.body, { ok: true, kind: 'archive', status: { pendingEvents: 0,
    coveredEvents: 5954, oldestPendingSeconds: 0, uncheckpointedEvents: 0, oldestUncheckpointedSeconds: 0,
    retryingEvents: 0, activeLeases: 0, staleLeases: 0, pendingCheckpoint: false,
    pendingCheckpointAgeSeconds: 0, fenced: false, checkpointed: true } });
  assert.doesNotMatch(JSON.stringify(result), /private/);
});
test('malformed status output is sanitized', async () => {
  for (const [kind, output] of [['cleanup', '{"cleanup":{"pendingObjects":-1}}'], ['archive', '{"pendingEvents":0,"coveredEvents":0,"oldestPendingSeconds":0,"fenceId":null,"checkpointId":{"private":true}}']]) {
    const result = await status(handler(kind, { execute: async () => output }));
    assert.deepEqual(result.body, { ok: false, error: 'worker_output_invalid' });
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
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
test('archive failure diagnostics accept only the complete fixed enum line',async()=>{
  const categories = { Configuration:'archive_configuration',Database:'archive_database',Storage:'archive_storage',InvalidArchive:'archive_invalid',CoverageUnproven:'archive_coverage_unproven',FenceReleased:'archive_fence_released',Capacity:'archive_capacity',StaleLease:'archive_stale_lease' };
  for(const [category,safeCode] of Object.entries(categories)) {
    const line=`erasure_archive failed category=${category}; inspect restricted operational diagnostics\n`;
    await assert.rejects(runChild(process.execPath,['-e',`process.stderr.write(${JSON.stringify(line)});process.exit(1)`],{},2000),{message:safeCode,safeCode});
  }
  const known='erasure_archive failed category=Storage; inspect restricted operational diagnostics';
  for(const stderr of [known+' private-token', 'private-provider-body\n'+known, known+'\n'+known, known.replace('Storage','PrivateToken'),known+'\n\n',known+'\r\n']) {
    await assert.rejects(runChild(process.execPath,['-e',`process.stderr.write(${JSON.stringify(stderr)});process.exit(1)`],{},2000),{message:'worker_failed'});
  }
  await assert.rejects(runChild(process.execPath,['-e',`process.stderr.write(${JSON.stringify(known)});process.exit(2)`],{},2000),{message:'worker_failed'});
});
test('split diagnostic writes remain bounded and a failed partial batch is not HTTP success',async()=>{
  const partial=JSON.stringify({operation:'drain',archivedThisRun:2,checkpoint:null,status:{pendingEvents:8,coveredEvents:0,oldestPendingSeconds:1,sourceId:'private-source'}});
  const script=`process.stdout.write(${JSON.stringify(partial)});process.stderr.write('erasure_archive failed cate');setTimeout(()=>{process.stderr.write('gory=Storage; inspect restricted operational diagnostics\\n');process.exit(1)},30)`;
  const result=await invoke(handler('archive',{execute:()=>runChild(process.execPath,['-e',script],{},2000)}));
  assert.equal(result.status,503);
  assert.deepEqual(result.body,{ok:false,error:'archive_storage'});
  assert.doesNotMatch(JSON.stringify(result),/private-source|archivedThisRun|diagnostics/);
});
test('deadline takes precedence over a known diagnostic and signal exit stays distinct',async()=>{
  const diagnostic="process.stderr.write('erasure_archive failed category=Storage; inspect restricted operational diagnostics\\n');";
  await assert.rejects(runChild(process.execPath,['-e',diagnostic+'setInterval(()=>{},1000)'],{},100),{message:'worker_timeout'});
  await assert.rejects(runChild(process.execPath,['-e',diagnostic+"process.kill(process.pid,'SIGTERM')"],{},2000),{message:'worker_terminated'});
});
test('missing or wrong-platform bundle fails closed',async()=>{
  await assert.rejects(verifyBundle(new URL('./missing/',import.meta.url),'cleanup'),{message:'bundle_invalid'});
});
