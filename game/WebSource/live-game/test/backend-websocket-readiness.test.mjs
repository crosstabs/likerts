// Authentication readiness and lease revocation regressions.
// Real owned SQLite/app/loopback WebSockets, with one deferred storage seam
// BEFORE the authentication follow-up read. No production deadline is raised.
// A host-only lobby and aligned captured clock provide causal revision markers;
// an arbitrary unsolicited state frame is never treated as a refresh ACK.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import WebSocket from 'ws';
import { createLiveServer, DEFAULT_LIMITS, PRODUCTION_LIMITS } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const WAIT_MS = 3000, GATE_MS = 2000, QUIET_MS = 100;
const options = { concurrency: false, timeout: 15_000 };
const safeCodes = new Set(['unauthorized', 'room_not_found', 'storage_unavailable', 'connection_limit']);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const admission = () => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url') });
const deferred = () => {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
};

async function bounded(operation, stage, milliseconds = WAIT_MS) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Owned readiness fixture deadline: ${stage}.`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function followUpGate() {
  const entered = deferred(), released = deferred(), finished = deferred();
  let timer;
  return {
    target: null, firstSnapshotCompleted: false, firstRevision: null,
    claimed: false, released: false, expired: false, callbackEntered: false,
    resultKind: null, errorCode: null,
    enter() {
      assert.equal(this.claimed, false, 'Only one follow-up read may be held.');
      this.claimed = true; entered.resolve();
      // This is a fault-fixture safety bound, not an extended auth deadline.
      // Expiry releases work for cleanup but is always a test/cleanup failure.
      timer = setTimeout(() => { this.expired = true; this.release(); }, GATE_MS);
    },
    release() {
      if (this.released) return;
      this.released = true; clearTimeout(timer); released.resolve();
    },
    waitEntered: () => bounded(entered.promise, 'follow_up_enter'),
    waitReleased: () => released.promise,
    complete() { finished.resolve(); },
    waitFinished: () => bounded(finished.promise, 'follow_up_finish'),
  };
}

class Peer {
  constructor(origin) {
    const url = new URL('/api/live/socket', origin); url.protocol = 'ws:';
    assert.equal(url.hostname, '127.0.0.1');
    this.socket = new WebSocket(url, { origin });
    this.messages = []; this.waiters = new Set(); this.closeCode = null;
    this.failed = false; this.closedAlready = false; this.overflow = false;
    this.opened = new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', () => reject(new Error('Owned readiness socket failed before open.')));
      this.socket.once('close', () => reject(new Error('Owned readiness socket closed before open.')));
    });
    this.closed = new Promise(resolve => this.socket.once('close', code => {
      this.closedAlready = true; this.closeCode = code; resolve();
      for (const waiter of [...this.waiters]) waiter.reject(new Error(`Owned readiness socket closed during ${waiter.stage}.`));
    }));
    this.socket.on('error', () => {
      this.failed = true;
      for (const waiter of [...this.waiters]) waiter.reject(new Error(`Owned readiness socket failed during ${waiter.stage}.`));
    });
    this.socket.on('message', bytes => {
      let message;
      try { message = JSON.parse(bytes.toString('utf8')); }
      catch {
        this.failed = true;
        for (const waiter of [...this.waiters]) waiter.reject(new Error('Owned readiness socket sent invalid JSON.'));
        return;
      }
      if (this.messages.length >= 64) {
        this.overflow = true;
        for (const waiter of [...this.waiters]) waiter.reject(new Error('Owned readiness message bound exceeded.'));
        return;
      }
      this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.resolve(message);
    });
  }
  async authenticate(member) {
    await bounded(this.opened, 'socket_open');
    this.socket.send(JSON.stringify({ type: 'authenticate', code: member.code, token: member.token }));
  }
  wait(predicate, stage) {
    const old = this.messages.find(predicate);
    if (old) return Promise.resolve(old);
    if (this.closedAlready || this.failed) return Promise.reject(new Error(`Owned readiness socket unavailable during ${stage}.`));
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (settle, value) => { clearTimeout(timer); this.waiters.delete(waiter); settle(value); };
      const waiter = { predicate, stage, resolve: value => finish(resolve, value), reject: error => finish(reject, error) };
      timer = setTimeout(() => waiter.reject(new Error(`Owned readiness state deadline: ${stage}.`)), WAIT_MS);
      this.waiters.add(waiter);
    });
  }
  async expectNoStateWhileHeld(gate) {
    assert.equal(gate.claimed, true); assert.equal(gate.released, false);
    // Bounded negative observation plus a later positive read/response check.
    // This is not a sleep added to make authentication/refresh races disappear.
    await pause(QUIET_MS);
    assert.equal(gate.released, false, 'The owned deferred gate must still be held.');
    assert.equal(this.messages.length, 0, 'No state or error may be published before the auth follow-up can run.');
    assert.equal(this.closedAlready, false, 'The unchanged default auth policy must still admit this pending valid socket.');
  }
  refresh() { this.socket.send(JSON.stringify({ type: 'refresh' })); }
  terminate() { this.socket.terminate(); }
}

function snapshotResult(value, code) {
  return value?.value?.id === 'host' && value.value.state?.code === code && value.value.state.self?.id === 'host';
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-auth-readiness-'));
  const gate = followUpGate(), pending = new Set(), peers = new Set();
  // Both5001ms steps remain in this same60s request-budget window.
  let timestamp = Math.floor(Date.now() / 60_000) * 60_000 + 1000;
  let store, app, origin, closed = false;
  const track = work => {
    let operation;
    try { operation = Promise.resolve(work()); } catch (error) { operation = Promise.reject(error); }
    pending.add(operation);
    void operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };
  const f = {
    gate,
    async start() {
      // Explicitly disable any environment database fallback.
      store = await openStore({ sqlitePath: join(directory, 'rooms.sqlite'), databaseURL: '', production: false,
        now: () => timestamp, maxRooms: PRODUCTION_LIMITS.maxRooms, maxLeasesPerRoom: PRODUCTION_LIMITS.maxSocketsPerRoom });
      const facade = {
        kind: store.kind, maxLeasesPerRoom: store.maxLeasesPerRoom,
        count: (...args) => track(() => store.count(...args)),
        subscribe: (...args) => store.subscribe(...args),
        consumeBudget: (...args) => track(() => store.consumeBudget(...args)),
        admit: (...args) => track(() => store.admit(...args)),
        transactCommand: (...args) => track(() => store.transactCommand(...args)),
        cleanup: (...args) => track(() => store.cleanup(...args)),
        transact(code, callback) {
          return track(async () => {
            // Arm only after the FIRST completed semantic snapshot. In this
            // isolated SQLite auth path, its follow-up is invoked in the same
            // Promise/microtask chain before timers can interleave. Tick and
            // broadcast results do not arm it. Verify the intercepted success
            // is itself a snapshot; never count an arbitrary read as success.
            const held = !closed && !gate.released && code === gate.target && gate.firstSnapshotCompleted && !gate.claimed;
            if (held) { gate.enter(); await gate.waitReleased(); }
            try {
              const result = await store.transact(code, (...args) => {
                if (held) {
                  assert.equal(gate.released, true);
                  gate.callbackEntered = true;
                }
                return callback(...args);
              });
              const snapshot = snapshotResult(result, code);
              if (code === gate.target && snapshot && !gate.firstSnapshotCompleted) {
                gate.firstSnapshotCompleted = true; gate.firstRevision = result.value.state.revision;
              }
              if (held) gate.resultKind = snapshot ? 'snapshot' : 'unexpected_non_snapshot';
              return result;
            } catch (error) {
              if (held) { gate.resultKind = 'rejected'; gate.errorCode = safeCodes.has(error?.code) ? error.code : 'unexpected_error'; }
              throw error;
            } finally { if (held) gate.complete(); }
          });
        },
      };
      app = await createLiveServer({ store: facade, catalogue, production: false, now: () => timestamp,
        limits: { ...PRODUCTION_LIMITS, refreshPerMinute: 2 } });
      ({ origin } = await app.listen({ host: '127.0.0.1', port: 0 }));
      const url = new URL(origin);
      assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
      assert.equal(app.limits.authTimeoutMs, DEFAULT_LIMITS.authTimeoutMs);
      assert.equal(app.limits.maxSocketsPerMember, PRODUCTION_LIMITS.maxSocketsPerMember);
      assert.equal(app.limits.maxSocketsPerRoom, PRODUCTION_LIMITS.maxSocketsPerRoom);
    },
    async request(method, path, body, token) {
      const response = await fetch(origin + '/api/live' + path, { method, redirect: 'error',
        headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(WAIT_MS) });
      return { status: response.status, body: await response.json() };
    },
    async host() {
      const identity = admission();
      const created = await f.request('POST', '/rooms', { ...identity,
        settings: { topic: 'mix', capacity: 2, cycles: 1, answerSeconds: 0, predictSeconds: 0 } });
      assert.equal(created.status, 201); assert.equal(created.body.memberId, 'host');
      gate.target = created.body.code;
      return { ...created.body, recovery: identity };
    },
    async peer(member) {
      const peer = new Peer(origin); peers.add(peer);
      await peer.authenticate(member); return peer;
    },
    advancePresenceClock() {
      const oldWindow = Math.floor(timestamp / 60_000); timestamp += 5001;
      assert.equal(Math.floor(timestamp / 60_000), oldWindow, 'Refresh bounds must stay in one budget window.');
    },
    async leases(member) {
      // Control observations bypass only this fixture's deferred wrapper.
      return (await store.transact(member.code, room => ({ room, changed: false,
        value: room ? Object.keys(room.host.socketLeases ?? {}).length : null }))).value;
    },
    async untilLeases(member, expected) {
      const deadline = performance.now() + WAIT_MS;
      do { if (await f.leases(member) === expected) return; await pause(5); } while (performance.now() < deadline);
      assert.fail('Owned readiness lease cleanup deadline exceeded.');
    },
    async close() {
      if (closed) return; closed = true;
      const failures = [];
      gate.release();
      for (const peer of peers) peer.terminate();
      try { await bounded(Promise.all([...peers].map(peer => peer.closed)), 'socket_cleanup'); } catch { failures.push('socket_cleanup'); }
      if (app) try { await bounded(app.close(), 'app_cleanup'); } catch { failures.push('app_cleanup'); }
      try {
        await bounded((async () => {
          // Retire all tracked app/store work, including continuations that
          // enqueue another operation after an earlier Promise settles.
          let quietTurns = 0;
          while (quietTurns < 2) {
            await Promise.allSettled([...pending]); await nextTurn();
            quietTurns = pending.size ? 0 : quietTurns + 1;
          }
        })(), 'operation_cleanup');
      } catch { failures.push('operation_cleanup'); }
      let storeClosed = !store;
      if (store) try { await bounded(store.close(), 'store_cleanup'); storeClosed = true; } catch { failures.push('store_cleanup'); }
      if (storeClosed) try { await rm(directory, { recursive: true, force: true }); } catch { failures.push('directory_cleanup'); }
      else failures.push('owned_directory_retained');
      if (gate.expired) failures.push('deferred_gate_expired');
      if (peers.size && [...peers].some(peer => peer.failed || peer.overflow)) failures.push('wire_failure');
      if (failures.length) throw new Error(`Owned readiness fixture cleanup failed: ${failures.join(',')}.`);
    },
  };
  return f;
}

async function withFixture(work) {
  const f = await createFixture(); let primary, cleanup;
  try { await f.start(); await work(f); } catch (error) { primary = error; }
  try { await f.close(); } catch (error) { cleanup = error; }
  if (primary && cleanup) throw new AggregateError([primary, cleanup], 'Readiness behavior and owned cleanup both failed.');
  if (primary) throw primary;
  if (cleanup) throw cleanup;
}

test('WebSocket authentication publishes readiness only after its follow-up and preserves two exact refresh slots', options, async () => withFixture(async f => {
  const host = await f.host(), peer = await f.peer(host);
  await f.gate.waitEntered();
  assert.equal(await f.leases(host), 1, 'The held admission must retain its counted lease.');
  await peer.expectNoStateWhileHeld(f.gate);
  f.gate.release();
  const initial = await peer.wait(message => message.type === 'state', 'initial_ready_state');
  await f.gate.waitFinished();
  assert.equal(f.gate.callbackEntered, true); assert.equal(f.gate.resultKind, 'snapshot');
  assert.equal(initial.state.self.id, 'host'); assert.equal(initial.state.players.length, 0);
  let revision = initial.state.revision;
  for (let index = 0; index < 2; index++) {
    f.advancePresenceClock(); peer.refresh();
    const fresh = await peer.wait(message => message.type === 'state' && message.state?.revision === revision + 1,
      index ? 'second_refresh_presence_commit' : 'first_refresh_presence_commit');
    assert.equal(fresh.state.self.id, 'host'); assert.equal(fresh.state.phase, 'lobby');
    revision = fresh.state.revision;
  }
  peer.refresh();
  const rejection = await peer.wait(message => message.type === 'error', 'third_refresh_rejection');
  assert.equal(rejection.error?.code, 'rate_limited');
  await bounded(peer.closed, 'rate_limited_close');
  assert.equal(peer.closeCode, 1008); await f.untilLeases(host, 0);
}));

test('Revocation before the held authentication follow-up publishes no state and leaves no old lease', options, async () => withFixture(async f => {
  const host = await f.host(), peer = await f.peer(host);
  await f.gate.waitEntered();
  const recovered = await f.request('POST', '/admissions/recover', host.recovery);
  assert.equal(recovered.status, 200); assert.equal(recovered.body.memberId, 'host');
  assert.ok(recovered.body.token !== host.token, 'Actual admission recovery must revoke the old credential.');
  await peer.expectNoStateWhileHeld(f.gate);
  f.gate.release();
  const rejection = await peer.wait(message => message.type === 'error', 'revoked_auth_rejection');
  await f.gate.waitFinished(); await bounded(peer.closed, 'revoked_auth_close');
  assert.equal(f.gate.callbackEntered, true); assert.equal(f.gate.resultKind, 'rejected');
  assert.equal(f.gate.errorCode, 'unauthorized'); assert.equal(rejection.error?.code, 'unauthorized');
  assert.equal(peer.closeCode, 1008);
  assert.equal(peer.messages.some(message => message.type === 'state'), false,
    'No early auth projection may escape before the revalidation that observes revocation.');
  assert.ok(peer.messages.every(message => message.type === 'error' && Object.keys(message).every(key => ['type', 'error'].includes(key))
    && Object.keys(message.error).every(key => ['code', 'message'].includes(key))));
  assert.equal(JSON.stringify(peer.messages).includes(host.token), false);
  assert.equal(JSON.stringify(peer.messages).includes(recovered.body.token), false);
  assert.equal((await f.request('GET', '/rooms/' + host.code, undefined, host.token)).status, 401);
  await f.untilLeases(host, 0);
}));

test('A held authentication counts toward unchanged member caps and close releases its lease before follow-up', options, async () => withFixture(async f => {
  const host = await f.host(), pending = await f.peer(host);
  await f.gate.waitEntered(); assert.equal(await f.leases(host), 1);
  const second = await f.peer(host);
  const accepted = await second.wait(message => message.type === 'state', 'second_connection_ready');
  assert.equal(accepted.state.self.id, 'host'); assert.equal(await f.leases(host), 2);
  const excess = await f.peer(host);
  const denied = await excess.wait(message => message.type === 'error', 'excess_connection_rejection');
  assert.equal(denied.error?.code, 'connection_limit');
  await bounded(excess.closed, 'excess_connection_close');
  assert.equal(excess.closeCode, 1008); assert.equal(await f.leases(host), 2);
  pending.terminate(); await bounded(pending.closed, 'held_connection_close');
  await f.untilLeases(host, 1);
  f.gate.release(); await f.gate.waitFinished();
  assert.equal(f.gate.callbackEntered, true); assert.equal(f.gate.resultKind, 'snapshot');
  assert.equal(await f.leases(host), 1, 'Completing a closed auth follow-up must not recreate its lease.');
  second.terminate(); await bounded(second.closed, 'remaining_connection_close');
  await f.untilLeases(host, 0);
}));
