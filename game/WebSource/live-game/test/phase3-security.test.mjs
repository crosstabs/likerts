import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import test from 'node:test';
import pg from 'pg';
import WebSocket from 'ws';
import { localTestDatabaseURL } from '../deployment/local-test-database.mjs';
import { openStore } from '../server/store.mjs';
import { commandFingerprint, createRoom, joinRoom, reduceRoom } from '../server/engine.mjs';

// No default database, public URL, caller-supplied search_path or production store.
const supplied = process.env.LIKERTS_LIVE_TEST_DATABASE_URL;
const baseURL = supplied ? localTestDatabaseURL(supplied) : null;
if (baseURL && baseURL.port !== '54329') throw new Error('Phase 3 only permits the explicitly owned local PostgreSQL fixture port.');
const gate = { skip: baseURL ? false : 'Set LIKERTS_LIVE_TEST_DATABASE_URL to the owned numeric-loopback fixture.', timeout: 55_000, concurrency: false };
const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const admission = body => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), ...body });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate, milliseconds = 4000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(10); }
  assert.fail('Bounded Phase 3 local observation timed out.');
}
const command = (state, action, values = {}, requestId = randomUUID()) => ({
  requestId, matchId: state.matchId, action,
  ...(['answer', 'guess', 'next', 'pause', 'resume', 'skip'].includes(action) ? { roundId: state.round.id } : {}), ...values,
});

function privateMetadataAbsent(state) {
  const forbidden = new Set(['instanceId', 'storageVersion', 'receiptCount', 'requests', 'tokenHash', 'verifier', 'socketLeases', 'leaseId', 'fingerprint', 'recoverySecret']);
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, 'Storage metadata must not enter a public projection.'); visit(child); }
  }
  visit(state);
}

function ownedPool(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, query_timeout: 6000, statement_timeout: 5000 });
  pool.on('error', () => {});
  const query = pool.query.bind(pool);
  pool.query = async (...args) => {
    try { return await query(...args); }
    catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : 'fixture_database_failed';
      throw Object.assign(new Error('An owned Phase 3 database operation failed.'), { code });
    }
  };
  return pool;
}

function redactedWorkerFailure(stage, error) {
  const stages = ['process_start', 'imports', 'catalogue', 'initialize', 'createFactory', 'listen', 'ready', 'shutdown', 'control', 'unknown'];
  const codes = ['storage_unavailable', 'configuration_error', 'room_limit', 'rate_limited', 'runtime_unsupported', 'ERR_MODULE_NOT_FOUND', 'ENOENT', 'EACCES', 'EADDRINUSE', 'EADDRNOTAVAIL', 'EMFILE', 'ENFILE', 'ECONNREFUSED', 'ETIMEDOUT', 'worker_exit_before_ready', 'worker_startup_timeout'];
  const phases = ['acquire', 'begin', 'configure', 'operation', 'commit', 'release', 'initialize', 'listen'];
  const kinds = ['unknown', 'lock_unavailable', 'deadlock', 'serialization_failure', 'query_canceled', 'connection_capacity', 'permission_denied', 'authentication_failed', 'database_unavailable', 'connection_failure', 'server_shutdown', 'pool_acquire_timeout', 'connection_timeout', 'query_timeout', 'lock_timeout', 'statement_timeout'];
  const states = ['55P03', '40P01', '40001', '57014', '53300', '42501', '28P01', '3D000', '08000', '08003', '08006', '57P01', '55000', '22P02', '23505', '42703', '42P01', '42883', '42P07'];
  const diagnostic = error?.diagnostic;
  return { stage: stages.includes(stage) ? stage : 'unknown', code: codes.includes(error?.code) ? error.code : 'unexpected_error',
    diagnostic: { phase: phases.includes(diagnostic?.phase) ? diagnostic.phase : null,
      kind: kinds.includes(diagnostic?.kind) ? diagnostic.kind : null,
      sqlState: states.includes(diagnostic?.sqlState) ? diagnostic.sqlState : null } };
}

async function startWorker(databaseURL, epoch, limits, onDiagnostic = () => {}) {
  const source = `
    import {writeSync} from 'node:fs';
    import {createInterface} from 'node:readline';
    const safeFailure=${redactedWorkerFailure.toString()};
    const emit=value=>{try{writeSync(1,JSON.stringify(value)+'\\n')}catch{}};
    let now=${epoch},stage='imports',store,app,stopping,failing=false,ready=false;
    const mark=value=>{stage=value;emit({type:'worker_stage',stage})};
    const stop=(exitCode=0)=>stopping??=(async()=>{
      mark('shutdown');let timer;
      try{
        await Promise.race([(async()=>{await app?.close();await store?.close()})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned worker cleanup timed out.')),2500)})]);
      }catch(error){emit({type:'worker_cleanup_failed',...safeFailure(stage,error)});exitCode=1}
      finally{clearTimeout(timer)}
      process.exit(exitCode)
    })();
    const fatal=async error=>{if(failing)return;failing=true;emit({type:ready?'runtime_failed':'startup_failed',...safeFailure(stage,error)});await stop(1)};
    process.once('uncaughtException',error=>{void fatal(error)});
    process.once('unhandledRejection',error=>{void fatal(error)});
    process.once('exit',exitCode=>{emit({type:'worker_exit',stage,exitCode:Number.isInteger(exitCode)&&exitCode>=0&&exitCode<=255?exitCode:null})});
    process.once('SIGTERM',()=>{void stop()});
    try{
      mark('imports');
      const {readFile}=await import('node:fs/promises');
      const {createLiveServer}=await import(${JSON.stringify(new URL('../server/app.mjs', import.meta.url).href)});
      const {openStore}=await import(${JSON.stringify(new URL('../server/store.mjs', import.meta.url).href)});
      mark('catalogue');
      const catalogue=JSON.parse(await readFile(new URL(${JSON.stringify(new URL('../shared/catalogue.json', import.meta.url).href)}),'utf8'));
      mark('initialize');store=await openStore({databaseURL:process.env.LIKERTS_PHASE3_SCHEMA_URL,production:false,maxRooms:4,now:()=>now});
      mark('createFactory');app=await createLiveServer({store,catalogue,production:false,origins:['http://127.0.0.1'],allowNoOrigin:true,now:()=>now,limits:${JSON.stringify(limits)}});
      mark('listen');const {origin}=await app.listen({host:'127.0.0.1',port:0});
      ready=true;stage='ready';emit({type:'ready',origin});
      let tail=Promise.resolve();
      createInterface({input:process.stdin}).on('line',line=>{tail=tail.then(async()=>{
        let message;try{message=JSON.parse(line)}catch{return}
        if(message.type==='stop'){await stop();return}
        if(message.type==='advance'&&Number.isSafeInteger(message.milliseconds)&&message.milliseconds>=0&&message.milliseconds<=21600001){
          now+=message.milliseconds;if(message.tick)await app.tick();emit({type:'advanced',id:message.id})
        }
      }).catch(error=>{void fatal(error)})});
    }catch(error){await fatal(error)}
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { PATH: process.env.PATH, LIKERTS_PHASE3_SCHEMA_URL: databaseURL }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {}); // Never forward raw driver/connection diagnostics.
  child.stdin.on('error', () => {});
  const exited = new Promise(resolve => child.once('exit', resolve));
  const lines = createInterface({ input: child.stdout });
  const waiting = new Map();
  let startupResolve, startupReject, ready = false, closing, stopRequested = false, forced = false, lastStage = 'process_start', startupError;
  const started = new Promise((resolve, reject) => { startupResolve = resolve; startupReject = reject; });
  function failStartup(details) {
    if (startupError) return;
    const safe = redactedWorkerFailure(details.stage, details);
    startupError = Object.assign(new Error('Owned Phase 3 worker startup failed: ' + JSON.stringify(safe)), { code: 'worker_startup_failed', diagnostic: safe });
    clearTimeout(timer); startupReject(startupError);
  }
  const timer = setTimeout(() => failStartup({ stage: lastStage, code: 'worker_startup_timeout' }), 10_000);
  lines.on('line', line => {
    if (line.length > 4096) return;
    let value; try { value = JSON.parse(line); } catch { return; }
    if (value.type === 'ready') { ready = true; clearTimeout(timer); startupResolve(value.origin); }
    if (value.type === 'advanced') { waiting.get(value.id)?.(); waiting.delete(value.id); }
    if (value.type === 'worker_stage') {
      lastStage = redactedWorkerFailure(value.stage).stage;
      onDiagnostic({ type: 'worker_stage', stage: lastStage });
    }
    if (['startup_failed', 'runtime_failed', 'worker_cleanup_failed'].includes(value.type)) {
      const safe = redactedWorkerFailure(value.stage, value);
      onDiagnostic({ type: value.type, ...safe });
      if (!ready) failStartup(safe);
    }
    if (value.type === 'worker_exit') onDiagnostic({ type: 'worker_exit', stage: redactedWorkerFailure(value.stage).stage,
      exitCode: Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255 ? value.exitCode : null });
  });
  child.once('error', error => { if (!ready) failStartup({ stage: 'process_start', code: error?.code }); });
  // close follows stdout drainage, so a final redacted startup marker wins over
  // a generic early-exit error even if the process exits immediately afterwards.
  child.once('close', () => { clearTimeout(timer); if (!ready) failStartup({ stage: lastStage, code: 'worker_exit_before_ready' }); });
  const close = () => closing ??= (async () => {
    if (!child.pid) { lines.close(); return; }
    if (child.exitCode !== null || child.signalCode !== null) {
      lines.close();
      assert.equal(ready && !stopRequested, false, 'An owned worker exited unexpectedly before cleanup.');
      assert.equal(child.exitCode, 0, 'An owned worker did not exit cleanly.');
      assert.equal(child.signalCode, null, 'An owned worker was terminated unexpectedly.');
      return;
    }
    stopRequested = true;
    try { child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n'); } catch {}
    let force;
    await Promise.race([exited, new Promise(resolve => { force = setTimeout(() => { forced = true; child.kill('SIGKILL'); resolve(); }, 3000); })]);
    clearTimeout(force);
    if (child.exitCode === null && child.signalCode === null) await exited;
    lines.close();
    assert.equal(forced, false, 'An owned worker required forced cleanup; shutdown was not clean.');
    assert.equal(child.exitCode, 0, 'An owned worker did not exit cleanly.');
    assert.equal(child.signalCode, null, 'An owned worker was terminated unexpectedly.');
  })();
  let origin;
  try {
    origin = await started;
    const parsed = new URL(origin);
    if (parsed.hostname !== '127.0.0.1' || parsed.protocol !== 'http:' || !parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Owned worker readiness returned an invalid local origin.');
  } catch (error) {
    try { await close(); }
    catch (cleanupError) {
      onDiagnostic({ type: 'startup_cleanup_failed', firstStartupErrorPreserved: true,
        exitCode: Number.isInteger(child.exitCode) ? child.exitCode : null, forced });
      throw new AggregateError([error, cleanupError], error.message, { cause: error });
    }
    throw error;
  }
  return {
    origin, close,
    async advance(milliseconds, tick = false) {
      const id = randomUUID();
      await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => { waiting.delete(id); reject(new Error('Owned worker clock acknowledgement timed out.')); }, 5000);
        waiting.set(id, () => { clearTimeout(deadline); resolve(); });
        child.stdin.write(JSON.stringify({ type: 'advance', id, milliseconds, tick }) + '\n');
      });
    },
  };
}

async function fixture(t) {
  assert.ok(baseURL, 'PostgreSQL execution requires an explicit owned fixture.');
  const schema = 'phase3_security_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^[a-z][a-z0-9_]{1,62}$/);
  const admin = ownedPool(baseURL.href);
  const workers = [], stores = [], sockets = [];
  let created = false, clock = Date.now();
  let sql;
  t.after(async () => {
    let cleanupFailed = false;
    for (const peer of sockets) peer.socket.terminate();
    for (const worker of workers) try { await worker.close(); } catch { cleanupFailed = true; }
    for (const store of stores) try { await store.close(); } catch { cleanupFailed = true; }
    try {
      try { await sql?.end(); } catch { cleanupFailed = true; }
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally { await admin.end(); }
    assert.equal(cleanupFailed, false, 'An owned Phase 3 fixture failed to close cleanly.');
  });
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  const scoped = new URL(baseURL);
  scoped.searchParams.set('options', `-csearch_path=${schema}`); // Generated identifier only, after target validation.
  sql = ownedPool(scoped.href);
  const f = {
    schema, sql,
    get clock() { return clock; },
    async store() { const store = await openStore({ databaseURL: scoped.href, production: false, maxRooms: 4, now: () => clock }); stores.push(store); return store; },
    async worker(limits = {}) {
      const worker = await startWorker(scoped.href, clock, { maxRooms: 4, maxPlayers: 12, maxSockets: 64, maxSocketsPerRoom: 26, maxSocketsPerMember: 2, ...limits }, marker => t.diagnostic(JSON.stringify(marker)));
      workers.push(worker); return worker;
    },
    async advance(milliseconds, tick = false) { clock += milliseconds; await Promise.all(workers.map(worker => worker.advance(milliseconds, tick))); },
    async request(worker, method, path, body, token) {
      const response = await fetch(worker.origin + '/api/live' + path, { method, redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Origin: 'http://127.0.0.1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    async state(worker, member) { const result = await f.request(worker, 'GET', `/rooms/${member.code}`, undefined, member.token); assert.equal(result.status, 200); privateMetadataAbsent(result.body.state); return result.body.state; },
    async send(worker, member, value) { return f.request(worker, 'POST', `/rooms/${member.code}/actions`, value, member.token); },
    async act(worker, member, state, action, values = {}) { const result = await f.send(worker, member, command(state, action, values)); assert.equal(result.status, 200); return result.body.state; },
    async create(worker, settings = {}) {
      const pending = admission({ settings: { capacity: 3, ...settings } });
      const result = await f.request(worker, 'POST', '/rooms', pending); assert.equal(result.status, 201);
      return { ...result.body, pending };
    },
    async join(worker, host, nickname) {
      const pending = admission({ nickname, acceptRoomSharing: true });
      const result = await f.request(worker, 'POST', `/rooms/${host.code}/join`, pending); assert.equal(result.status, 201);
      return { ...result.body, pending };
    },
    async match(worker, settings = {}) {
      const host = await f.create(worker, settings);
      const members = [await f.join(worker, host, 'Synthetic Ari'), await f.join(worker, host, 'Synthetic Bo'), await f.join(worker, host, 'Synthetic Cy')];
      const state = await f.act(worker, host, await f.state(worker, host), 'start');
      return { host, members, state, subject: members.find(member => member.memberId === state.round.subjectId), predictors: members.filter(member => member.memberId !== state.round.subjectId) };
    },
    async peer(worker, member) {
      const socket = new WebSocket(worker.origin.replace('http:', 'ws:') + '/api/live/socket', { origin: 'http://127.0.0.1' });
      const peer = { socket, messages: [], closed: false, closeCode: null, pings: 0 };
      sockets.push(peer); socket.on('error', () => {}); socket.on('close', code => { peer.closed = true; peer.closeCode = code; });
      socket.on('ping', () => { peer.pings++; });
      socket.on('message', bytes => { if (peer.messages.length < 100) { try { peer.messages.push(JSON.parse(bytes.toString())); } catch {} } });
      await until(() => socket.readyState === WebSocket.OPEN || peer.closed);
      assert.equal(peer.closed, false);
      socket.send(JSON.stringify({ type: 'authenticate', code: member.code, token: member.token }));
      await until(() => peer.messages.some(message => ['state', 'error'].includes(message.type)));
      assert.equal(peer.messages.find(message => ['state', 'error'].includes(message.type)).type, 'state');
      return peer;
    },
    async counts(code) {
      const room = (await sql.query('SELECT instance_id,receipt_count,state_json,revision FROM likerts_live_rooms WHERE code=$1', [code])).rows[0];
      if (!room) return null;
      const receipts = (await sql.query('SELECT count(*)::integer AS count FROM likerts_live_command_receipts WHERE instance_id=$1', [room.instance_id])).rows[0].count;
      return { room, receipts };
    },
    async contended(code, start) {
      const lock = await sql.connect();
      let pending = [], committed = false;
      try {
        await lock.query('BEGIN');
        await lock.query('SELECT code FROM likerts_live_rooms WHERE code=$1 FOR UPDATE', [code]);
        pending = start();
        for (const promise of pending) void promise.catch(() => {});
        await until(async () => {
          // Include a second waiter blocked behind the first waiter's tuple
          // lock, rather than requiring both to block directly on our PID.
          const result = await admin.query(`WITH RECURSIVE waiting(pid) AS (
            SELECT pid FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))
            UNION SELECT activity.pid FROM pg_stat_activity AS activity JOIN waiting ON waiting.pid=ANY(pg_blocking_pids(activity.pid))
          ) SELECT count(*)::integer AS count FROM waiting`, [lock.processID]);
          return result.rows[0].count >= 2;
        }, 2000);
        await lock.query('COMMIT'); committed = true;
        return await Promise.all(pending);
      } finally {
        if (!committed) await lock.query('ROLLBACK').catch(() => {});
        lock.release();
        await Promise.allSettled(pending);
      }
    },
  };
  return f;
}

test('Phase 3 PostgreSQL: two processes commit duplicate final guesses once without exposing private storage', gate, async t => {
  const f = await fixture(t), first = await f.worker(), second = await f.worker();
  const match = await f.match(first, { capacity: 3 });
  const hostPeer = await f.peer(second, match.host);
  await f.act(first, match.subject, match.state, 'answer', { value: 4 });
  let state = await f.state(second, match.host);
  assert.equal(state.round.ownAnswer, null); assert.equal(state.reveal, null);
  await f.act(first, match.predictors[0], state, 'guess', { value: 4 });
  state = await f.state(second, match.predictors[1]);
  assert.equal(state.round.ownGuess, null); assert.equal(state.round.ownAnswer, null); assert.equal(state.reveal, null);
  await until(() => hostPeer.messages.some(message => message.state?.phase === 'predict' && message.state.round?.submittedCount === 1));
  for (const message of hostPeer.messages.filter(message => message.state)) {
    assert.equal(message.state.reveal, null, 'The host socket must not reveal while a predictor is still pending.');
    if (message.state.round) { assert.equal(message.state.round.ownAnswer, null); assert.equal(message.state.round.ownGuess, null); }
  }
  const before = await f.counts(match.host.code);
  const last = command(state, 'guess', { value: 4 });
  const replies = await f.contended(match.host.code, () => [f.send(first, match.predictors[1], last), f.send(second, match.predictors[1], last)]);
  assert.deepEqual(replies.map(value => value.status), [200, 200]);
  const conflict = await f.send(second, match.predictors[1], { ...last, value: 1 });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'request_conflict');
  const revealed = await f.state(first, match.host);
  assert.equal(revealed.phase, 'reveal');
  for (const row of revealed.leaderboard.filter(row => row.playerId !== match.subject.memberId)) { assert.equal(row.points, 100); assert.equal(row.opportunities, 1); }
  const after = await f.counts(match.host.code);
  assert.equal(after.receipts, before.receipts + 1); assert.equal(Number(after.room.receipt_count), after.receipts);
  assert.equal(after.room.state_json.requests, undefined);
  await until(() => hostPeer.messages.some(message => message.state?.phase === 'reveal'));
  for (const message of hostPeer.messages.filter(message => message.state)) {
    privateMetadataAbsent(message.state);
    if (['answer', 'predict'].includes(message.state.phase) && message.state.round) {
      assert.equal(message.state.round.ownAnswer, null); assert.equal(message.state.round.ownGuess, null); assert.equal(message.state.reveal, null);
    }
  }
});

test('Phase 3 PostgreSQL: rematch and rotated credentials preserve exact receipt scope without caching old secrets', gate, async t => {
  const f = await fixture(t), first = await f.worker(), second = await f.worker();
  const match = await f.match(first, { capacity: 3 });
  const answer = command(match.state, 'answer', { value: 5 });
  assert.equal((await f.send(first, match.subject, answer)).status, 200);
  await f.act(first, match.host, await f.state(first, match.host), 'end');
  const lobby = await f.act(first, match.host, await f.state(first, match.host), 'rematch');
  const pending = match.subject.pending;
  const recovered = await f.request(second, 'POST', '/admissions/recover', { admissionId: pending.admissionId, recoverySecret: pending.recoverySecret });
  assert.equal(recovered.status, 200);
  const current = recovered.body;
  assert.equal((await f.request(first, 'GET', `/rooms/${current.code}`, undefined, match.subject.token)).status, 401);
  const before = await f.counts(current.code);
  const replay = await f.send(second, current, answer);
  assert.equal(replay.status, 200); assert.equal(replay.body.state.matchId, lobby.matchId); assert.equal(replay.body.state.phase, 'lobby');
  assert.equal(replay.body.state.round, null); assert.equal(replay.body.state.reveal, null); privateMetadataAbsent(replay.body.state);
  assert.equal((await f.counts(current.code)).receipts, before.receipts);
  const conflict = await f.send(second, current, { ...answer, value: 1 });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'request_conflict');
  const stale = await f.send(second, current, { ...answer, requestId: randomUUID() });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'stale_match');
});

test('Phase 3 PostgreSQL: normalized receipt caps preserve host deletion and exact null-only leave recovery', gate, async t => {
  const f = await fixture(t), worker = await f.worker({ maxRequests: 1 });
  const host = await f.create(worker), player = await f.join(worker, host, 'Synthetic Ari');
  await f.act(worker, player, await f.state(worker, player), 'heartbeat');
  assert.equal((await f.counts(host.code)).receipts, 1);
  const closed = await f.send(worker, host, command(await f.state(worker, host), 'close'));
  assert.equal(closed.status, 200); assert.deepEqual(closed.body, { state: null, closed: true });
  const nextHost = await f.create(worker), nextPlayer = await f.join(worker, nextHost, 'Synthetic Bo');
  await f.act(worker, nextHost, await f.state(worker, nextHost), 'heartbeat');
  const leave = command(await f.state(worker, nextPlayer), 'leave');
  for (let retry = 0; retry < 2; retry++) { const left = await f.send(worker, nextPlayer, leave); assert.equal(left.status, 200); assert.deepEqual(left.body, { state: null, left: true }); }
  assert.equal((await f.counts(nextHost.code)).receipts, 1);
  assert.equal((await f.send(worker, nextPlayer, { ...leave, requestId: randomUUID() })).status, 401);
  assert.equal((await f.request(worker, 'GET', `/rooms/${nextHost.code}`, undefined, nextPlayer.token)).status, 401);
});

test('Phase 3 PostgreSQL: exact retries and rejected late commands persist one elapsed timeout without extra receipts', gate, async t => {
  const f = await fixture(t), worker = await f.worker();
  const first = await f.match(worker, { capacity: 3, answerSeconds: 30, predictSeconds: 30 });
  const answer = command(first.state, 'answer', { value: 4 });
  assert.equal((await f.send(worker, first.subject, answer)).status, 200);
  const before = await f.counts(first.host.code);
  await f.advance(30_001);
  const replay = await f.send(worker, first.subject, answer);
  assert.equal(replay.status, 200); assert.equal(replay.body.state.phase, 'reveal'); assert.equal(replay.body.state.reveal.reason, 'prediction_timeout');
  assert.equal((await f.counts(first.host.code)).receipts, before.receipts);
  assert.equal((await f.send(worker, first.subject, answer)).status, 200);
  const scores = (await f.state(worker, first.host)).leaderboard.filter(row => row.playerId !== first.subject.memberId);
  assert.ok(scores.every(row => row.points === 0 && row.opportunities === 1));
  const second = await f.match(worker, { capacity: 3, answerSeconds: 30, predictSeconds: 30 });
  const count = (await f.counts(second.host.code)).receipts;
  await f.advance(30_001);
  const late = await f.send(worker, second.subject, command(second.state, 'answer', { value: 4 }));
  assert.equal(late.status, 409); assert.equal((await f.counts(second.host.code)).receipts, count);
  const state = await f.state(worker, second.host);
  assert.equal(state.phase, 'reveal'); assert.equal(state.reveal.valid, false); assert.equal(state.reveal.answer, null);
});

test('Phase 3 PostgreSQL: old writers are blocked and a failed semantic write cannot leave a successful receipt', gate, async t => {
  const f = await fixture(t), worker = await f.worker(), host = await f.create(worker);
  const before = await f.counts(host.code);
  await assert.rejects(f.sql.query('UPDATE likerts_live_rooms SET revision=revision+1 WHERE code=$1', [host.code]), error => error.code === '55000');
  assert.equal(Number((await f.counts(host.code)).room.revision), Number(before.room.revision));
  await f.sql.query(`CREATE FUNCTION phase3_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-private-driver-marker'; END $$`);
  await f.sql.query('CREATE TRIGGER phase3_fail_write BEFORE UPDATE ON likerts_live_rooms FOR EACH ROW EXECUTE FUNCTION phase3_fail_write()');
  const value = command(await f.state(worker, host), 'heartbeat');
  const failed = await f.send(worker, host, value);
  assert.equal(failed.status, 503); assert.equal(JSON.stringify(failed.body).includes('synthetic-private-driver-marker'), false);
  const rolledBack = await f.counts(host.code);
  assert.equal(rolledBack.receipts, before.receipts); assert.equal(Number(rolledBack.room.revision), Number(before.room.revision));
  await f.sql.query('DROP TRIGGER phase3_fail_write ON likerts_live_rooms');
  const retried = await f.send(worker, host, value); assert.equal(retried.status, 200);
  assert.equal((await f.counts(host.code)).receipts, before.receipts + 1);
});

test('Phase 3 PostgreSQL: interrupted legacy migration rolls back atomically and retains legacy string leave replay', gate, async t => {
  const f = await fixture(t);
  function legacy(code) {
    const host = createRoom({ capacity: 2 }, { catalogue, now: f.clock, code });
    const player = joinRoom(host.room, { nickname: 'Synthetic Ari', acceptRoomSharing: true }, { now: f.clock });
    const beat = command(player.room, 'heartbeat');
    let room = reduceRoom(player.room, 'host', beat, { catalogue, now: f.clock }).room;
    const leave = command(room, 'leave');
    room = reduceRoom(room, player.memberId, leave, { catalogue, now: f.clock }).room;
    const [verifier, record] = Object.entries(room.revocations)[0];
    room.revocations[verifier] = record.memberId;
    room.requests[`${record.memberId}:${record.requestId}`] = commandFingerprint(leave);
    return { host: { code, token: host.token }, player: { code, token: player.token }, room, leave };
  }
  const first = legacy('ABCDEF'), second = legacy('ABCDGH');
  await f.sql.query('CREATE TABLE likerts_live_rooms(code text PRIMARY KEY,state_json jsonb NOT NULL,revision bigint NOT NULL,expires_at bigint NOT NULL,updated_at bigint NOT NULL)');
  for (const item of [first, second]) await f.sql.query('INSERT INTO likerts_live_rooms VALUES($1,$2::jsonb,$3,$4,$5)', [item.room.code, JSON.stringify(item.room), item.room.revision, item.room.expiresAt, f.clock]);
  await f.sql.query('CREATE SEQUENCE phase3_migration_attempt');
  await f.sql.query(`CREATE FUNCTION phase3_fail_second_migration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('phase3_migration_attempt')=2 THEN RAISE EXCEPTION 'synthetic-migration-fault'; END IF; RETURN NEW; END $$`);
  await f.sql.query('CREATE TRIGGER phase3_fail_second BEFORE UPDATE ON likerts_live_rooms FOR EACH ROW EXECUTE FUNCTION phase3_fail_second_migration()');
  await assert.rejects(f.store(), error => error.code === 'storage_unavailable');
  assert.equal(Number((await f.sql.query('SELECT last_value FROM phase3_migration_attempt')).rows[0].last_value), 2);
  for (const item of [first, second]) {
    const stored = (await f.sql.query('SELECT state_json FROM likerts_live_rooms WHERE code=$1', [item.room.code])).rows[0].state_json;
    assert.equal(stored.storageVersion, undefined); assert.equal(Object.keys(stored.requests).length, 2);
  }
  assert.equal((await f.sql.query('SELECT to_regclass($1) AS table_name', [`${f.schema}.likerts_live_command_receipts`])).rows[0].table_name, null);
  await f.sql.query('DROP TRIGGER phase3_fail_second ON likerts_live_rooms');
  await f.store();
  const migrated = await f.counts(first.room.code);
  assert.equal(migrated.receipts, 2); assert.equal(Number(migrated.room.receipt_count), 2); assert.equal(migrated.room.state_json.requests, undefined);
  const worker = await f.worker();
  const replay = await f.send(worker, first.player, first.leave);
  assert.equal(replay.status, 200); assert.deepEqual(replay.body, { state: null, left: true });
  assert.equal((await f.request(worker, 'GET', `/rooms/${first.player.code}`, undefined, first.player.token)).status, 401);
  await f.store(); // Repeat startup must not duplicate migrated history.
  assert.equal((await f.counts(first.room.code)).receipts, 2);
});

test('Phase 3 PostgreSQL: expired lease renewal cannot steal a replacement slot across workers', gate, async t => {
  const f = await fixture(t), first = await f.worker({ maxSocketsPerMember: 1, maxSocketsPerRoom: 1 }), second = await f.worker({ maxSocketsPerMember: 1, maxSocketsPerRoom: 1 });
  const host = await f.create(first), old = await f.peer(first, host);
  await f.advance(45_001);
  const replacement = await f.peer(second, host);
  // Real server heartbeat occurs every 15 seconds. Its solicited PONG exercises
  // the old socket's reserve=false renewal after replacement admission.
  await until(() => old.closed, 18_000);
  assert.ok(old.pings >= 1, 'The old socket must actually receive a server heartbeat and automatically answer its PING.');
  assert.equal(old.closeCode, 1008, 'The stale renewal must reject as room policy, not a transport crash.');
  assert.equal(replacement.closed, false);
  const instance = (await f.counts(host.code)).room.instance_id;
  const leases = (await f.sql.query('SELECT count(*)::integer AS count FROM likerts_live_socket_leases WHERE instance_id=$1', [instance])).rows[0].count;
  assert.equal(leases, 1);
  assert.equal((await f.state(second, host)).role, 'host');
});

test('Phase 3 PostgreSQL: recovery revokes old socket verifiers while preserving replacement admission and expiry', gate, async t => {
  const f = await fixture(t), first = await f.worker({ maxSocketsPerMember: 1 }), second = await f.worker({ maxSocketsPerMember: 1 });
  const host = await f.create(first), old = await f.peer(first, host);
  old.socket.pause();
  const recovered = await f.request(second, 'POST', '/admissions/recover', { admissionId: host.pending.admissionId, recoverySecret: host.pending.recoverySecret });
  assert.equal(recovered.status, 200);
  const replacement = await f.peer(second, recovered.body);
  old.socket.resume(); await until(() => old.closed);
  assert.equal(replacement.closed, false);
  assert.equal((await f.request(first, 'GET', `/rooms/${host.code}`, undefined, host.token)).status, 401);
  const instance = (await f.counts(host.code)).room.instance_id;
  const rows = (await f.sql.query('SELECT verifier FROM likerts_live_socket_leases WHERE instance_id=$1', [instance])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verifier, createHash('sha256').update(recovered.body.token).digest('hex'));
  assert.notEqual(rows[0].verifier, createHash('sha256').update(host.token).digest('hex'));
  await f.advance(2 * 60 * 60_000 + 1, true);
  await until(() => replacement.closed);
  assert.equal((await f.request(second, 'GET', `/rooms/${host.code}`, undefined, recovered.body.token)).status, 404);
  assert.equal((await f.sql.query('SELECT count(*)::integer AS count FROM likerts_live_socket_leases WHERE instance_id=$1', [instance])).rows[0].count, 0);
});

test('Phase 3 PostgreSQL: stale close callbacks and old receipts cannot affect a reused short code', gate, async t => {
  const f = await fixture(t), store = await f.store(), worker = await f.worker();
  const first = createRoom({ capacity: 2 }, { catalogue, now: f.clock, code: 'ABCDEF' });
  await store.create(first.room);
  const oldHost = { code: first.room.code, token: first.token };
  const oldPeer = await f.peer(worker, oldHost);
  const prior = command(await f.state(worker, oldHost), 'heartbeat');
  assert.equal((await f.send(worker, oldHost, prior)).status, 200);
  oldPeer.socket.pause(); // Delay the client's close handshake, not a global setting.
  assert.equal((await f.send(worker, oldHost, command(await f.state(worker, oldHost), 'close'))).status, 200);
  const next = createRoom({ capacity: 2 }, { catalogue, now: f.clock, code: 'ABCDEF' });
  await store.create(next.room);
  const newHost = { code: next.room.code, token: next.token };
  const newPeer = await f.peer(worker, newHost);
  oldPeer.socket.resume(); await until(() => oldPeer.closed);
  assert.equal(newPeer.closed, false); assert.equal((await f.state(worker, newHost)).role, 'host');
  assert.equal((await f.send(worker, oldHost, prior)).status, 401);
  const newInstance = await f.counts(newHost.code);
  assert.equal(newInstance.receipts, 0);
  const oldMatch = await f.send(worker, newHost, prior);
  assert.equal(oldMatch.status, 409); assert.equal(oldMatch.body.error.code, 'stale_match');
  const reusedUUID = await f.send(worker, newHost, { ...prior, matchId: (await f.state(worker, newHost)).matchId });
  assert.equal(reusedUUID.status, 200, 'The same host UUID in another immutable instance must be a separate receipt.');
  assert.equal((await f.counts(newHost.code)).receipts, 1);
  assert.equal((await f.sql.query('SELECT count(*)::integer AS count FROM likerts_live_socket_leases WHERE instance_id=$1', [newInstance.room.instance_id])).rows[0].count, 1);
  assert.equal((await f.sql.query('SELECT count(*)::integer AS count FROM likerts_live_command_receipts WHERE instance_id=$1', [first.room.instanceId])).rows[0].count, 0);
});
