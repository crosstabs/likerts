import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { localTestDatabaseURL } from '../deployment/local-test-database.mjs';
import { assertProductionRuntime } from '../deployment/runtime-policy.mjs';
import { openStore } from '../server/store.mjs';
import { commandFingerprint, createRoom, identify, joinRoom, project, reduceRoom } from '../server/engine.mjs';

assertProductionRuntime(true);
const supplied = process.env.LIKERTS_LIVE_TEST_DATABASE_URL;
const fixtureURL = supplied ? localTestDatabaseURL(supplied) : null;
if (fixtureURL && (fixtureURL.hostname !== '127.0.0.1' || fixtureURL.port !== '54329')) throw new Error('COMMIT acknowledgement testing only permits the explicitly owned numeric-loopback fixture.');
const MAX_FRAME = 64 * 1024, MAX_BUFFER = 256 * 1024, MAX_CONNECTIONS = 4;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate, milliseconds = 2000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(5); }
  assert.fail('A bounded local COMMIT-proof observation timed out.');
}
async function boundedCleanup(operation, milliseconds = 3000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned COMMIT-proof cleanup exceeded its bound.')), milliseconds); })]);
  } finally { clearTimeout(timer); }
}
function redactedDatabaseError(error) {
  return Object.assign(new Error('An owned COMMIT-proof database operation failed.'), {
    code: typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : 'fixture_database_failed',
  });
}
function ownedPool(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000, query_timeout: 6000, statement_timeout: 5000 });
  pool.on('error', () => {});
  const query = pool.query.bind(pool);
  pool.query = async (...args) => { try { return await query(...args); } catch (error) { throw redactedDatabaseError(error); } };
  return pool;
}

/** A test-only PostgreSQL frame proxy. The only upstream is the fixed owned
 * loopback fixture; no caller URL, DNS lookup, TLS interception or app route.
 * Payloads are forwarded transiently and never emitted in logs/diagnostics.
 */
async function commitAckProxy(onWitness) {
  assert.ok(fixtureURL && fixtureURL.hostname === '127.0.0.1' && fixtureURL.port === '54329');
  const pairs = new Set();
  let armed = false, closing = false;
  const evidence = { commitQueryIntercepted: false, upstreamCommitObserved: false, commitAckWithheld: false,
    readyForQueryWithheld: false, droppedPairs: 0, protocolFailure: false, unexpectedTransportFailure: false,
    backendPID: null };
  function destroyPair(pair, deliberate = false) {
    if (pair.destroyed) return;
    pair.destroyed = true; pair.deliberate ||= deliberate; clearTimeout(pair.cutoff);
    pair.front.destroy(); pair.upstream.destroy();
  }
  function protocolFailure(pair) { evidence.protocolFailure = true; destroyPair(pair, true); }
  function forward(pair, source, target, bytes, direction) {
    if (pair.destroyed || closing || target.destroyed) return;
    if (target.writableLength + bytes.length > MAX_BUFFER) { protocolFailure(pair); return; }
    const accepted = target.write(bytes);
    if (!accepted && !pair.paused[direction]) {
      pair.paused[direction] = true; source.pause();
      target.once('drain', () => { pair.paused[direction] = false; if (!pair.destroyed && !closing) source.resume(); });
    }
  }
  function frontend(pair, bytes) {
    if (pair.frontBuffer.length + bytes.length > MAX_BUFFER) { protocolFailure(pair); return; }
    pair.frontBuffer = Buffer.concat([pair.frontBuffer, bytes]);
    while (!pair.destroyed) {
      if (pair.startup) {
        if (pair.frontBuffer.length < 4) break;
        const length = pair.frontBuffer.readUInt32BE(0);
        if (length < 8 || length > 16 * 1024) { protocolFailure(pair); return; }
        if (pair.frontBuffer.length < length) break;
        // Tests explicitly use sslmode=disable on this loopback hop. Reject
        // SSL/GSS/cancel negotiation instead of pretending to parse ciphertext.
        if (pair.frontBuffer.readUInt32BE(4) !== 196608) { protocolFailure(pair); return; }
        pair.frontBuffer = pair.frontBuffer.subarray(length); pair.startup = false;
        continue;
      }
      if (pair.frontBuffer.length < 5) break;
      const length = pair.frontBuffer.readUInt32BE(1);
      if (length < 4 || length + 1 > MAX_FRAME) { protocolFailure(pair); return; }
      if (pair.frontBuffer.length < length + 1) break;
      const frame = pair.frontBuffer.subarray(0, length + 1);
      pair.frontBuffer = pair.frontBuffer.subarray(length + 1);
      if (frame[0] === 88 && length === 4) pair.clientTerminated = true;
      if (armed && frame[0] === 81 && length <= 68 && /^\s*COMMIT\s*;?\s*\0$/i.test(frame.subarray(5).toString('ascii'))) {
        assert.equal(evidence.commitQueryIntercepted, false);
        armed = false; pair.targetCommit = true; evidence.commitQueryIntercepted = true;
      }
    }
    // Parse the COMMIT before its final bytes reach PostgreSQL. Earlier partial
    // query bytes cannot execute until that complete message has arrived.
    forward(pair, pair.front, pair.upstream, bytes, 'front');
  }
  function backend(pair, bytes) {
    if (pair.backBuffer.length + bytes.length > MAX_BUFFER) { protocolFailure(pair); return; }
    pair.backBuffer = Buffer.concat([pair.backBuffer, bytes]);
    while (!pair.destroyed && pair.backBuffer.length >= 5) {
      const length = pair.backBuffer.readUInt32BE(1);
      if (length < 4 || length + 1 > MAX_FRAME) { protocolFailure(pair); return; }
      if (pair.backBuffer.length < length + 1) return;
      const frame = pair.backBuffer.subarray(0, length + 1);
      pair.backBuffer = pair.backBuffer.subarray(length + 1);
      // Retain only the fixture backend PID for matching the affected pool's
      // remove event; never retain/output the accompanying cancellation secret.
      if (frame[0] === 75 && length === 12) pair.backendPID = frame.readUInt32BE(5);
      if (pair.targetCommit && frame[0] === 67 && frame.subarray(5).equals(Buffer.from('COMMIT\0'))) {
        pair.withholding = true; evidence.upstreamCommitObserved = true;
        evidence.commitAckWithheld = true; evidence.backendPID = pair.backendPID;
        pair.cutoff = setTimeout(() => { evidence.protocolFailure = true; destroyPair(pair, true); }, 1000);
        continue; // Never forward this successful CommandComplete.
      }
      if (pair.withholding) {
        if (frame[0] === 90) {
          if (length !== 5 || frame[5] !== 73) { protocolFailure(pair); return; }
          evidence.readyForQueryWithheld = true; evidence.droppedPairs++;
          onWitness({ phase: 'before-owned-socket-drop', actualUpstreamCommitObserved: true,
            completeCommitFramesWithheld: 1, idleReadyFramesWithheld: 1 });
          destroyPair(pair, true); // Neither C nor idle ReadyForQuery reached pg.
        }
        continue;
      }
      forward(pair, pair.upstream, pair.front, frame, 'back');
    }
  }
  const server = createServer(front => {
    if (closing || pairs.size >= MAX_CONNECTIONS) { front.destroy(); return; }
    const upstream = createConnection({ host: '127.0.0.1', port: 54329 });
    const pair = { front, upstream, startup: true, frontBuffer: Buffer.alloc(0), backBuffer: Buffer.alloc(0),
      targetCommit: false, withholding: false, destroyed: false, deliberate: false, clientTerminated: false, backendPID: null, cutoff: null, closedSockets: 0, paused: { front: false, back: false } };
    pairs.add(pair);
    for (const socket of [front, upstream]) {
      socket.on('error', () => { if (!closing && !pair.deliberate) evidence.unexpectedTransportFailure = true; destroyPair(pair, true); });
      socket.once('close', () => {
        if (!closing && !pair.deliberate && !pair.clientTerminated) evidence.unexpectedTransportFailure = true;
        pair.closedSockets++; destroyPair(pair, true); if (pair.closedSockets === 2) pairs.delete(pair);
      });
    }
    front.on('data', bytes => { try { frontend(pair, bytes); } catch { protocolFailure(pair); } });
    upstream.on('data', bytes => { try { backend(pair, bytes); } catch { protocolFailure(pair); } });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    port: server.address().port, evidence,
    arm() { assert.equal(armed, false); assert.equal(evidence.commitQueryIntercepted, false); armed = true; },
    async close() {
      if (closing) return; closing = true;
      for (const pair of pairs) destroyPair(pair, true);
      await new Promise(resolve => server.close(resolve));
      await until(() => pairs.size === 0);
      assert.equal(pairs.size, 0, 'Owned proxy sockets did not close.');
    },
  };
}

test('PostgreSQL COMMIT acknowledgement loss is unknown to the caller but commits one score and exact receipt', {
  skip: fixtureURL ? false : 'Set LIKERTS_LIVE_TEST_DATABASE_URL to the explicitly owned numeric-loopback PostgreSQL fixture.',
  timeout: 30_000, concurrency: false,
}, async t => {
  const sourceHash = createHash('sha256');
  for (const path of ['../server/store.mjs', '../server/storage-v3.mjs', '../server/engine.mjs', '../server/errors.mjs', '../shared/catalogue.json', '../deployment/local-test-database.mjs', '../deployment/runtime-policy.mjs', '../package-lock.json', './backend-commit-ack-pg.test.mjs']) {
    sourceHash.update(path); sourceHash.update(await readFile(new URL(path, import.meta.url)));
  }
  t.diagnostic(JSON.stringify({ sourceSha256: sourceHash.digest('hex'), node: process.versions.node }));
  const schema = 'commit_ack_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^[a-z][a-z0-9_]{1,62}$/);
  const admin = ownedPool(fixtureURL.href), stores = [];
  let created = false, proxy, authority;
  t.after(async () => {
    let cleanupFailed = false, schemaRemoved = false;
    for (const store of stores) try { await boundedCleanup(store.close()); } catch { cleanupFailed = true; }
    try { await boundedCleanup(proxy?.close()); } catch { cleanupFailed = true; }
    try { await boundedCleanup(authority?.end()); } catch { cleanupFailed = true; }
    try { if (created) { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); schemaRemoved = true; } }
    finally { await boundedCleanup(admin.end()); }
    assert.equal(cleanupFailed, false, 'The owned COMMIT-proof fixture did not close cleanly.');
    t.diagnostic(JSON.stringify({ boundedFixtureCleanupCompleted: true, ownedSchemaRemoved: schemaRemoved }));
  });
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  const directURL = new URL(fixtureURL);
  directURL.searchParams.set('options', `-csearch_path=${schema}`);
  // Only the generated private schema and explicit local no-TLS transport are
  // appended after validating the original fixture target. No hosted URL.
  directURL.searchParams.set('sslmode', 'disable');
  authority = ownedPool(directURL.href);
  proxy = await commitAckProxy(witness => t.diagnostic(JSON.stringify(witness)));
  const throughProxy = new URL(directURL); throughProxy.port = String(proxy.port);
  const clock = Date.now();
  const store = await openStore({ databaseURL: throughProxy.href, production: false, maxRooms: 1, now: () => clock }); stores.push(store);
  const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
  const host = createRoom({ capacity: 2, cycles: 1, answerSeconds: 0, predictSeconds: 0 }, { catalogue, now: clock });
  const first = joinRoom(host.room, { nickname: 'Synthetic Ari', acceptRoomSharing: true }, { now: clock });
  const second = joinRoom(first.room, { nickname: 'Synthetic Bo', acceptRoomSharing: true }, { now: clock });
  await store.create(second.room);
  const code = second.room.code;
  const members = [{ id: first.memberId, token: first.token }, { id: second.memberId, token: second.token }];
  const makeCommand = (room, action, values = {}) => ({ requestId: randomUUID(), matchId: room.matchId, action,
    ...(['answer', 'guess', 'next'].includes(action) ? { roundId: room.round.id } : {}), ...values });
  async function perform(target, token, value) {
    return target.transactCommand(code, {
      requestId: value.requestId, fingerprint: commandFingerprint(value), maxReceipts: 100,
      authorize(room) { assert.ok(room, 'Owned test room is unavailable.'); return { actorId: identify(room, token), scope: 'active' }; },
    }, (room, receiptContext) => {
      const reduced = reduceRoom(room, receiptContext.actorId, value, { catalogue, now: clock, maxRequests: 100, receiptContext });
      return { room: reduced.room, changed: !reduced.replayed, recordReceipt: reduced.recordReceipt,
        value: { replayed: reduced.replayed, state: project(reduced.room, receiptContext.actorId, { catalogue, now: clock }) } };
    });
  }
  const started = await perform(store, host.token, makeCommand(second.room, 'start'));
  const subject = members.find(member => member.id === started.room.round.subjectId);
  const predictor = members.find(member => member !== subject);
  const answered = await perform(store, subject.token, makeCommand(started.room, 'answer', { value: 4 }));
  const finalGuess = makeCommand(answered.room, 'guess', { value: 4 });
  const before = (await authority.query('SELECT instance_id,receipt_count FROM likerts_live_rooms WHERE code=$1', [code])).rows[0];
  const removedPIDs = new Set();
  const removed = client => { removedPIDs.add(client.processID); };
  store.pool.on('remove', removed);
  proxy.arm();
  let failure;
  try { await perform(store, predictor.token, finalGuess); } catch (error) { failure = error; }
  assert.ok(failure, 'Withheld COMMIT acknowledgement must not be reported as caller success.');
  assert.equal(failure.code, 'storage_unavailable');
  assert.equal(failure.diagnostic?.phase, 'commit');
  assert.equal(failure.diagnostic?.outcome, 'unknown');
  assert.equal(failure.diagnostic?.rollback, 'failed');
  assert.equal(proxy.evidence.commitQueryIntercepted, true);
  assert.equal(proxy.evidence.upstreamCommitObserved, true, 'Successful upstream CommandComplete is mandatory commit proof.');
  assert.equal(proxy.evidence.commitAckWithheld, true); assert.equal(proxy.evidence.readyForQueryWithheld, true);
  assert.equal(proxy.evidence.droppedPairs, 1); assert.equal(proxy.evidence.protocolFailure, false);
  assert.equal(proxy.evidence.unexpectedTransportFailure, false);
  assert.ok(Number.isSafeInteger(proxy.evidence.backendPID));
  await until(() => removedPIDs.has(proxy.evidence.backendPID));
  store.pool.off('remove', removed);

  async function authoritative() {
    const row = (await authority.query('SELECT instance_id,receipt_count,state_json FROM likerts_live_rooms WHERE code=$1', [code])).rows[0];
    const receipts = (await authority.query('SELECT count(*)::integer AS count FROM likerts_live_command_receipts WHERE instance_id=$1', [row.instance_id])).rows[0].count;
    const exact = (await authority.query('SELECT count(*)::integer AS count FROM likerts_live_command_receipts WHERE instance_id=$1 AND actor_id=$2 AND request_id=$3', [row.instance_id, predictor.id, finalGuess.requestId])).rows[0].count;
    return { row, receipts, exact };
  }
  const committed = await authoritative();
  assert.equal(committed.row.state_json.phase, 'reveal'); assert.equal(committed.row.state_json.round.scored, true);
  assert.equal(committed.row.state_json.scores[predictor.id].points, 100); assert.equal(committed.row.state_json.scores[predictor.id].opportunities, 1);
  assert.equal(committed.exact, 1); assert.equal(committed.receipts, Number(before.receipt_count) + 1);
  assert.equal(Number(committed.row.receipt_count), committed.receipts);

  // A fresh direct store bypasses the failed TCP connection. Move forward first
  // so exact retry must return current state, rather than a cached old reveal.
  const fresh = await openStore({ databaseURL: directURL.href, production: false, maxRooms: 1, now: () => clock }); stores.push(fresh);
  const current = (await fresh.transact(code, room => ({ room, changed: false }))).room;
  const advanced = await perform(fresh, host.token, makeCommand(current, 'next'));
  const beforeRetry = await authoritative();
  const retry = await perform(fresh, predictor.token, finalGuess);
  assert.equal(retry.value.replayed, true); assert.equal(retry.value.state.phase, 'answer');
  assert.equal(retry.value.state.round.id, advanced.room.round.id); assert.notEqual(retry.value.state.round.id, finalGuess.roundId);
  assert.equal(retry.value.state.reveal, null);
  assert.equal(retry.value.state.round.ownAnswer, null); assert.equal(retry.value.state.round.ownGuess, null);
  const afterRetry = await authoritative();
  assert.equal(afterRetry.receipts, beforeRetry.receipts); assert.equal(afterRetry.exact, 1);
  assert.equal(Number(afterRetry.row.receipt_count), afterRetry.receipts);
  assert.equal(afterRetry.row.state_json.scores[predictor.id].points, 100); assert.equal(afterRetry.row.state_json.scores[predictor.id].opportunities, 1);
  t.diagnostic(JSON.stringify({ actualUpstreamCommitObserved: true, commitAndReadyAcknowledgementsWithheld: true,
    callerOutcomeUnknown: true, affectedPoolClientRemoved: true, authoritativeFinalGuessReceipts: 1,
    replayedCurrentRound: true, additionalRetryReceipts: 0, additionalRetryScores: 0 }));
});
