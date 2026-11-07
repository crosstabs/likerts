import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PostgreSQLStore } from '../server/store.mjs';

const marker = 'PRIVATE_LISTENER_FIXTURE_URL_TOKEN';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture({ subscription, drain, releaseError, endError } = {}) {
  const clients = [];
  let ends = 0;
  const pool = Object.assign(new EventEmitter(), {
    async connect() {
      const client = Object.assign(new EventEmitter(), {
        releases: 0,
        async query() { await subscription?.promise; return { rows: [] }; },
        release() { this.releases++; if (releaseError) throw new Error(marker); },
      });
      clients.push(client); return client;
    },
    async end() { ends++; await drain?.promise; if (endError) throw new Error(marker); },
  });
  const store = new PostgreSQLStore(pool, { maxRooms: 4, now: () => 0 });
  return { store, clients, get ends() { return ends; } };
}

test('Concurrent store close callers wait for the same pool drain', async () => {
  const drain = deferred(), f = fixture({ drain });
  const first = f.store.close(); let finished = false;
  const second = f.store.close().then(() => { finished = true; });
  await turn(); const premature = finished;
  drain.resolve(); await Promise.all([first, second]);
  assert.equal(premature, false); assert.equal(f.ends, 1);
});

test('A failing listener release still drains the pool without retaining private driver details', async () => {
  const f = fixture({ releaseError: true }); await f.store.connectListener();
  let observed; try { await f.store.close(); } catch (error) { observed = error; }
  assert.equal(f.ends, 1, 'Listener cleanup must not skip pool shutdown');
  if (observed) { assert.equal(observed.code, 'storage_unavailable'); assert.equal(JSON.stringify(observed).includes(marker), false); assert.equal(observed.message.includes(marker), false); }
});

test('Pool shutdown errors are sanitized and shared by all close callers', async () => {
  const f = fixture({ endError: true });
  const results = await Promise.allSettled([f.store.close(), f.store.close()]);
  for (const result of results) {
    assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'storage_unavailable');
    assert.equal(result.reason.message.includes(marker), false); assert.equal(Object.hasOwn(result.reason, 'cause'), false);
  }
  assert.equal(f.ends, 1);
});

test('Concurrent LISTEN subscriptions lease one client and publish readiness only after acknowledgement', async () => {
  const subscription = deferred(), f = fixture({ subscription });
  const first = f.store.connectListener(), second = f.store.connectListener();
  await turn(); const premature = f.store.listener; const leased = f.clients.length;
  subscription.resolve(); await Promise.all([first, second]);
  await f.store.connectListener(); const repeated = f.clients.length;
  await f.store.close();
  assert.equal(premature, null); assert.equal(leased, 1); assert.equal(repeated, 1);
  assert.equal(f.clients[0].releases, 1);
});

test('Closing during an outstanding LISTEN acknowledgement disposes the pending client once', async () => {
  const subscription = deferred(), f = fixture({ subscription });
  const connecting = f.store.connectListener(); await turn();
  const closing = f.store.close(); subscription.resolve();
  await Promise.all([connecting, closing]);
  assert.equal(f.store.listener, null); assert.equal(f.store.reconnect, null);
  assert.equal(f.clients[0].releases, 1); assert.equal(f.ends, 1);
});

test('Lost notification connections release once and reconnect without exposing notification payloads', async () => {
  const f = fixture(); await f.store.connectListener();
  const old = f.clients[0]; old.emit('error', new Error(marker)); old.emit('end');
  assert.equal(old.releases, 1); assert.equal(f.store.listener, null);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(f.clients.length, 2); assert.equal(f.store.listener, f.clients[1]);
  let notifications = 0; f.store.subscribe(() => { notifications++; });
  old.emit('notification', { channel: 'likerts_live_changes', payload: JSON.stringify({ code: 'ABCDEF', revision: 1 }) });
  assert.equal(notifications, 0, 'An obsolete disconnected listener cannot deliver notifications');
  await f.store.close();
});

test('Losing a listener while LISTEN is pending cannot consume the only reconnect attempt', async () => {
  const subscription = deferred(), f = fixture({ subscription });
  const connecting = f.store.connectListener(); await turn();
  f.clients[0].emit('error', new Error(marker));
  await new Promise(resolve => setTimeout(resolve, 300)); // First retry overlaps the outstanding LISTEN.
  subscription.resolve(); await connecting;
  await new Promise(resolve => setTimeout(resolve, 550));
  const reconnected = f.clients.length > 1 && f.store.listener === f.clients.at(-1);
  await f.store.close();
  assert.equal(reconnected, true);
});

test('A failed LISTEN acknowledgement is sanitized and its leased client is discarded', async () => {
  const subscription = deferred(), f = fixture({ subscription });
  const connecting = f.store.connectListener(); await turn(); subscription.reject(new Error(marker));
  await assert.rejects(connecting, error => error.code === 'storage_unavailable' && !error.message.includes(marker) && !Object.hasOwn(error, 'cause'));
  assert.equal(f.clients[0].releases, 1); assert.equal(f.store.listener, null);
  await f.store.close(); assert.equal(f.store.reconnect, null);
});
