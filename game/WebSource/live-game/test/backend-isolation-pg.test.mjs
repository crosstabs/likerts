import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgreSQLStore } from '../server/store.mjs';
import { createRoom } from '../server/engine.mjs';
import { localTestDatabaseURL } from '../deployment/local-test-database.mjs';

const supplied = process.env.LIKERTS_LIVE_TEST_DATABASE_URL;
const base = supplied ? localTestDatabaseURL(supplied) : null;
if (base) assert.equal(base.port, '54329', 'Isolation checks only permit the explicitly owned loopback fixture');
const gate = { skip: !base, timeout: 15_000 };
const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t) {
  const schema = `live_isolation_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: base.href, max: 1, connectionTimeoutMillis: 5000, query_timeout: 6000 });
  admin.on('error', () => {});
  const stores = []; let created = false;
  t.after(async () => {
    try { await Promise.all(stores.map(store => store.close())); }
    finally { try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); } }
  });
  const baselineDefault = (await admin.query('SHOW default_transaction_isolation')).rows[0].default_transaction_isolation;
  t.diagnostic(JSON.stringify({ normalFixtureDefaultIsolation: baselineDefault }));
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  const scoped = new URL(base); scoped.searchParams.set('options', `-c search_path=${schema}`);
  async function open() {
    const pool = new Pool({ connectionString: scoped.href, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000,
      // pg-pool's verify callback completes before handing out each new client.
      // Only these owned test sessions change; no server/role setting changes.
      verify(client, done) { client.query("SET SESSION default_transaction_isolation = 'repeatable read'", error => done(error)); },
    });
    const store = new PostgreSQLStore(pool, { maxRooms: 1, now: () => Date.now() }); stores.push(store);
    await store.initialize(); return store;
  }
  return { admin, open, baselineDefault };
}

test('PostgreSQL transactions explicitly use READ COMMITTED despite a REPEATABLE READ session default', gate, async t => {
  const f = await fixture(t), store = await f.open();
  const observed = await store.transaction(async client => ({
    defaultIsolation: (await client.query('SHOW default_transaction_isolation')).rows[0].default_transaction_isolation,
    activeIsolation: (await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation,
  }));
  t.diagnostic(JSON.stringify(observed));
  assert.equal(observed.defaultIsolation, 'repeatable read', 'The adversarial session default must actually be applied');
  assert.equal(observed.activeIsolation, 'read committed');
});

test('A transaction waiting on an unchanged parent row sees a child-only lease committed before its post-lock read', gate, async t => {
  const f = await fixture(t), first = await f.open(), second = await f.open();
  const created = createRoom({}, { catalogue }), room = await first.create(created.room), leaseId = randomUUID();
  const locked = deferred(), release = deferred();
  const writer = first.transaction(async client => {
    await client.query('SELECT code FROM likerts_live_rooms WHERE code=$1 FOR UPDATE', [room.code]);
    locked.resolve(); await release.promise;
    // The parent tuple is deliberately not UPDATEd. The lease is the only
    // committed change, making REPEATABLE READ's stale-child snapshot visible.
    await client.query('INSERT INTO likerts_live_socket_leases(instance_id,actor_id,lease_id,verifier,expires_at) VALUES($1,$2,$3,$4,$5)', [room.instanceId, 'host', leaseId, room.host.tokenHash, Date.now() + 45_000]);
  }).then(value => ({ value }), error => ({ error }));
  let reader, waitingPID, sawBlocked = false;
  const acquired = client => { waitingPID = client.processID; };
  second.pool.on('acquire', acquired);
  try {
    await Promise.race([locked.promise, writer.then(result => { if (result.error) throw result.error; assert.fail('Owned writer ended before acquiring its lock'); })]);
    reader = second.transact(room.code, current => ({ room: current, changed: false, value: Object.hasOwn(current.host.socketLeases, leaseId) })).then(value => ({ value }), error => ({ error }));
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (Number.isSafeInteger(waitingPID)) {
        const activity = (await f.admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [waitingPID])).rows[0];
        if (activity?.wait_event_type === 'Lock') { sawBlocked = true; break; }
      }
      await pause(10);
    }
    assert.equal(sawBlocked, true, 'The second transaction must actually wait on the parent lock');
    release.resolve();
    const written = await writer; if (written.error) throw written.error;
    const read = await reader; if (read.error) throw read.error;
    t.diagnostic(JSON.stringify({ parentLockWaitObserved: sawBlocked, parentSemanticTupleUpdated: false, freshChildVisible: read.value.value }));
    assert.equal(read.value.value, true, 'The separate post-lock child read must see the committed lease');
  } finally {
    release.resolve(); await writer; if (reader) await reader;
    second.pool.off('acquire', acquired);
  }
});
