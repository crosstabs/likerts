import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { openStore } from '../server/store.mjs';
import { localTestDatabaseURL } from '../deployment/local-test-database.mjs';

// An explicit, owned loopback test database only; never deployment credentials.
const databaseURL = process.env.LIKERTS_LIVE_TEST_DATABASE_URL;
if (databaseURL) localTestDatabaseURL(databaseURL);
const pgTest = (name, run) => test(name, { skip: !databaseURL, timeout: 15_000 }, run);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(10); }
  assert.fail('Owned PostgreSQL listener did not reach the expected lifecycle state');
}
async function fixture(t) {
  const schema = `live_listener_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseURL, max: 1, connectionTimeoutMillis: 5000 });
  const stores = [];
  let created = false;
  t.after(async () => {
    try { await Promise.all(stores.map(store => store.close())); }
    finally { try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); } }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  const url = new URL(databaseURL); url.searchParams.set('options', `-c search_path=${schema}`);
  const connect = async () => { const store = await openStore({ databaseURL: url.href, production: false, maxRooms: 4 }); stores.push(store); return store; };
  return { admin, connect };
}

pgTest('A terminated real PostgreSQL LISTEN connection is replaced and committed notifications resume', async t => {
  const f = await fixture(t), first = await f.connect(), second = await f.connect();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 6 }, () => alphabet[randomInt(32)]).join('');
  await first.create({ code, revision: 1, expiresAt: Date.now() + 60_000, count: 0 });
  const previous = second.listener.processID;
  assert.ok(Number.isSafeInteger(previous));
  await f.admin.query('SELECT pg_terminate_backend($1)', [previous]);
  await until(() => second.listener !== null && second.listener.processID !== previous);
  let seen = false;
  second.subscribe((changedCode, revision) => { if (changedCode === code && revision === 2) seen = true; });
  await first.transact(code, room => ({ room: { ...room, revision: 2, count: 1 }, changed: true }));
  await until(() => seen);
  assert.equal((await second.transact(code, room => ({ room, changed: false }))).room.count, 1);
  assert.equal(second.listenerConnecting, null); assert.equal(second.reconnect, null);
  t.diagnostic('Terminated only the owned listener backend; replacement subscription received a new committed revision and durable state remained intact. Local fixture does not verify production TLS or a provider failover.');
});

pgTest('Concurrent shutdown after a real listener loss cancels reconnect and drains the owned pool', async t => {
  const f = await fixture(t), store = await f.connect();
  await f.admin.query('SELECT pg_terminate_backend($1)', [store.listener.processID]);
  await until(() => store.listener === null);
  await Promise.all([store.close(), store.close()]);
  await delay(300);
  assert.equal(store.listener, null); assert.equal(store.listenerConnecting, null); assert.equal(store.reconnect, null);
  assert.equal(store.pool.ended, true);
});
