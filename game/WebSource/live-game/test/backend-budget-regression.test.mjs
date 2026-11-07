// Budget behavior regressions with isolated PostgreSQL fixtures.
// Cleanup failures are reported alongside the primary test failure.
//
// Existing companion gates remain required:
// - backend-store.test.mjs: SQLite shared-budget/restart/rollover and 10k bounds.
// - backend-store-pg.test.mjs: cross-worker exhaustion and restart persistence.
// - backend-commit-ack-pg.test.mjs: actual TCP COMMIT-ack loss, unknown outcome,
//   broken-client discard and authoritative reconciliation. The final case
//   below is a smaller budget-specific driver-Promise fault, not TCP evidence.
// No SQL-call-count or implementation-shape assertions are used as a speed test.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { openStore } from '../server/store.mjs';
import { localTestDatabaseURL } from '../deployment/local-test-database.mjs';

const supplied = process.env.LIKERTS_LIVE_TEST_DATABASE_URL;
const baseURL = supplied ? localTestDatabaseURL(supplied) : null;
const gate = {
  skip: baseURL ? false : 'Set LIKERTS_LIVE_TEST_DATABASE_URL to the explicitly owned numeric-loopback fixture.',
  timeout: 20_000,
  concurrency: false,
};
const EPOCH = 600_000;
const SEED_PREFIX = 'a'.repeat(56);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const safeCodes = new Set(['configuration_error', 'rate_limited', 'room_limit', 'storage_unavailable']);
const safeSQLStates = new Set(['40P01', '55P03', '57014', '42501', '55000', '23505', '42P01', '42703', '08006']);

function redactedStoreFailure(error) {
  return {
    code: safeCodes.has(error?.code) ? error.code : 'unexpected_store_failure',
    phase: ['acquire', 'begin', 'configure', 'operation', 'commit', 'release'].includes(error?.diagnostic?.phase)
      ? error.diagnostic.phase : null,
    outcome: ['not_started', 'rolled_back', 'unknown', 'committed'].includes(error?.diagnostic?.outcome)
      ? error.diagnostic.outcome : null,
  };
}

function fixtureFailure(stage, error) {
  // Do not retain driver message/detail/hint/where/cause, SQL, URLs or parameters.
  return Object.assign(new Error(`Owned budget fixture failed during ${stage}.`), {
    code: 'budget_fixture_failed',
    sqlState: safeSQLStates.has(error?.code) ? error.code : null,
  });
}

function accepted(result, expected) {
  assert.equal(result.ok, true, 'The budget consume must succeed.');
  if (expected !== undefined) assert.deepEqual(result.value, expected);
  return result.value;
}

function rejected(result, code) {
  assert.equal(result.ok, false, 'The budget consume must reject.');
  assert.equal(result.error.code, code);
  return result.error;
}

function createFixture() {
  assert.ok(baseURL, 'The test fixture requires explicit loopback opt-in.');
  const schema = `live_budget_regression_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^live_budget_regression_[a-f0-9]{32}$/);
  const stores = [], leased = new Set(), pending = new Set(), cleanupFailures = [];
  let admin, control, created = false, idleErrors = 0;
  const pool = url => {
    const value = new pg.Pool({
      connectionString: url, max: 3, connectionTimeoutMillis: 3000,
      statement_timeout: 5000, query_timeout: 6000,
    });
    value.on('error', () => { idleErrors++; });
    return value;
  };
  const execute = async (client, sql, parameters = []) => {
    try { return await client.query(sql, parameters); }
    catch (error) { throw fixtureFailure('database_operation', error); }
  };
  const f = {
    stores,
    async start() {
      admin = pool(baseURL.href);
      await execute(admin, `CREATE SCHEMA "${schema}"`); created = true;
      const scoped = new URL(baseURL);
      scoped.searchParams.set('options', `-c search_path=${schema}`);
      control = pool(scoped.href);
      // Two real adapters/pools share only this test's new random namespace.
      for (let index = 0; index < 2; index++) {
        try { stores.push(await openStore({ databaseURL: scoped.href, production: false, maxRooms: 1, now: () => EPOCH })); }
        catch (error) { throw fixtureFailure('store_initialize', error); }
      }
    },
    key() {
      let key;
      do { key = createHash('sha256').update(randomUUID()).digest('hex'); } while (key.startsWith(SEED_PREFIX));
      return key;
    },
    consume(worker, options) {
      // budgetInput may throw synchronously. Capture that as a safe outcome
      // without weakening the requirement that no mutation was committed.
      const operation = Promise.resolve().then(() => stores[worker].consumeBudget(options))
        .then(value => ({ ok: true, value }), error => ({ ok: false, error: redactedStoreFailure(error) }));
      pending.add(operation); void operation.then(() => pending.delete(operation));
      return operation;
    },
    async sql(sql, parameters = []) { return execute(control, sql, parameters); },
    async writer(work) {
      let client;
      try { client = await control.connect(); }
      catch (error) { throw fixtureFailure('writer_acquire', error); }
      leased.add(client); let discard = false;
      try {
        await execute(client, 'BEGIN ISOLATION LEVEL READ COMMITTED');
        await execute(client, "SET LOCAL likerts_live.storage_version = '3'");
        const value = await work(client);
        await execute(client, 'COMMIT');
        return value;
      } catch (error) {
        try { await execute(client, 'ROLLBACK'); } catch { discard = true; }
        throw error;
      } finally { leased.delete(client); client.release(discard); }
    },
    async seedRow(key, { window = EPOCH, count = 1, maximum = 17, expiresAt = EPOCH + 1000 } = {}) {
      await f.writer(client => execute(client,
        'INSERT INTO likerts_live_budgets(budget_key,window_start,count,maximum,expires_at) VALUES($1,$2,$3,$4,$5)',
        [key, window, count, maximum, expiresAt]));
    },
    async seedUnrelated(rows, { window = EPOCH, maximum = 100, expiresAt = EPOCH + 60_000 } = {}) {
      assert.ok(Number.isInteger(rows) && rows >= 1 && rows <= 10_000);
      // One bounded INSERT, no extension or 10,000 request/round-trip loop.
      // The prefix and padded integer make these synthetic keys unique.
      await f.writer(client => execute(client, `INSERT INTO likerts_live_budgets
        (budget_key,window_start,count,maximum,expires_at)
        SELECT repeat('a',56)||lpad(to_hex(n),8,'0'),$1,1,$2,$3
        FROM generate_series(1,$4::integer) AS seed(n)`, [window, maximum, expiresAt, rows]));
    },
    async row(key, window = EPOCH) {
      const result = await f.sql('SELECT count,maximum,expires_at FROM likerts_live_budgets WHERE budget_key=$1 AND window_start=$2', [key, window]);
      if (!result.rows.length) return null;
      return Object.fromEntries(Object.entries(result.rows[0]).map(([name, value]) => [name, Number(value)]));
    },
    async count() { return Number((await f.sql('SELECT count(*) AS count FROM likerts_live_budgets')).rows[0].count); },
    async holdRow(key, window = EPOCH) {
      let client;
      try { client = await control.connect(); }
      catch (error) { throw fixtureFailure('blocker_acquire', error); }
      leased.add(client);
      try {
        await execute(client, 'BEGIN ISOLATION LEVEL READ COMMITTED');
        await execute(client, "SET LOCAL likerts_live.storage_version = '3'");
        const row = await execute(client, 'SELECT count FROM likerts_live_budgets WHERE budget_key=$1 AND window_start=$2 FOR UPDATE', [key, window]);
        assert.equal(row.rows.length, 1, 'The owned row blocker must actually lock a row.');
      } catch (error) {
        await execute(client, 'ROLLBACK').catch(() => {}); leased.delete(client); client.release(true); throw error;
      }
      let released = false;
      return {
        pid: client.processID,
        async release() {
          if (released) return; released = true;
          let discard = false;
          try { await execute(client, 'ROLLBACK'); }
          catch { discard = true; cleanupFailures.push('blocker_rollback'); }
          finally {
            leased.delete(client);
            try { client.release(discard); }
            catch { cleanupFailures.push('blocker_release'); }
          }
        },
      };
    },
    async blockedBy(pid, blocker) {
      if (!Number.isInteger(pid) || !Number.isInteger(blocker)) return false;
      const answer = await f.sql('SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked', [blocker, pid]);
      return answer.rows[0].blocked === true;
    },
    async close() {
      // Include failures recorded by already-released blockers. Keep only fixed
      // tags; withFixture aggregates this cleanup result with any body failure.
      const failures = cleanupFailures;
      // Always release this fixture's own blockers before draining operations.
      for (const client of leased) {
        let discard = false;
        try { await execute(client, 'ROLLBACK'); } catch { discard = true; failures.push('blocker_cleanup'); }
        try { client.release(discard); } catch { failures.push('client_release'); }
      }
      leased.clear();
      await Promise.all([...pending]);
      for (const result of await Promise.allSettled(stores.map(store => store.close()))) if (result.status === 'rejected') failures.push('store_close');
      if (control) try { await control.end(); } catch { failures.push('control_close'); }
      if (admin) {
        try { if (created) await execute(admin, `DROP SCHEMA "${schema}" CASCADE`); }
        catch { failures.push('schema_cleanup'); }
        finally { try { await admin.end(); } catch { failures.push('admin_close'); } }
      }
      if (idleErrors) failures.push('idle_pool_error');
      if (failures.length) throw new Error(`Owned budget fixture cleanup failed: ${failures.join(',')}.`);
    },
  };
  return f;
}

async function withFixture(work) {
  const f = createFixture(); let primary, cleanup;
  try { await f.start(); await work(f); } catch (error) { primary = error; }
  try { await f.close(); } catch (error) { cleanup = error; }
  if (primary && cleanup) throw new AggregateError([primary, cleanup], 'Budget behavior and owned-fixture cleanup both failed.');
  if (primary) throw primary;
  if (cleanup) throw cleanup;
}

async function until(predicate, message) {
  const end = Date.now() + 2000;
  while (Date.now() < end) { if (await predicate()) return; await pause(10); }
  assert.fail(message);
}

test('Budget: twenty first-use requests across two workers consume exactly seventeen slots', gate, async () => withFixture(async f => {
  const key = f.key(), options = { key, maximum: 17, now: EPOCH + 100, windowMs: 1000 };
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => f.consume(i % 2, options)));
  const wins = results.filter(value => value.ok), losses = results.filter(value => !value.ok);
  assert.equal(wins.length, 17); assert.equal(losses.length, 3);
  for (const loss of losses) rejected(loss, 'rate_limited');
  assert.deepEqual(wins.map(value => value.value.remaining).sort((a, b) => a - b), Array.from({ length: 17 }, (_, i) => i));
  assert.ok(wins.every(value => value.value.resetAt === EPOCH + 1000));
  assert.deepEqual(await f.row(key), { count: 17, maximum: 17, expires_at: EPOCH + 1000 });
  assert.equal(await f.count(), 1);
}));

test('Budget: a concurrent last-slot success returns remaining zero without a fallback consume', gate, async () => withFixture(async f => {
  const key = f.key(); await f.seedRow(key, { count: 3, maximum: 4 });
  const options = { key, maximum: 4, now: EPOCH + 100, windowMs: 1000 };
  const results = await Promise.all([f.consume(0, options), f.consume(1, options)]);
  assert.equal(results.filter(value => value.ok).length, 1);
  accepted(results.find(value => value.ok), { remaining: 0, resetAt: EPOCH + 1000 });
  rejected(results.find(value => !value.ok), 'rate_limited');
  assert.deepEqual(await f.row(key), { count: 4, maximum: 4, expires_at: EPOCH + 1000 });
}));

test('Budget: a rejected lower maximum does not persist or consume a slot', gate, async () => withFixture(async f => {
  const key = f.key(); await f.seedRow(key, { count: 8, maximum: 10 });
  rejected(await f.consume(0, { key, maximum: 5, now: EPOCH + 100, windowMs: 1000 }), 'rate_limited');
  assert.deepEqual(await f.row(key), { count: 8, maximum: 10, expires_at: EPOCH + 1000 });
  accepted(await f.consume(1, { key, maximum: 100, now: EPOCH + 100, windowMs: 1000 }), { remaining: 1, resetAt: EPOCH + 1000 });
  assert.deepEqual(await f.row(key), { count: 9, maximum: 10, expires_at: EPOCH + 1000 });
}));

test('Budget: an accepted lower maximum remains a ceiling for later competing higher requests', gate, async () => withFixture(async f => {
  const key = f.key(); await f.seedRow(key, { count: 1, maximum: 10 });
  accepted(await f.consume(0, { key, maximum: 4, now: EPOCH + 100, windowMs: 1000 }), { remaining: 2, resetAt: EPOCH + 1000 });
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => f.consume(i % 2, { key, maximum: 100, now: EPOCH + 100, windowMs: 1000 })));
  assert.deepEqual(results.filter(value => value.ok).map(value => value.value.remaining).sort((a, b) => a - b), [0, 1]);
  for (const loss of results.filter(value => !value.ok)) rejected(loss, 'rate_limited');
  assert.deepEqual(await f.row(key), { count: 4, maximum: 4, expires_at: EPOCH + 1000 });
}));

test('Budget: same-window expiry mismatch rejects unchanged and inclusive rollover gets a fresh counter', gate, async () => withFixture(async f => {
  const key = f.key();
  accepted(await f.consume(0, { key, maximum: 3, now: EPOCH + 100, windowMs: 1000 }), { remaining: 2, resetAt: EPOCH + 1000 });
  rejected(await f.consume(1, { key, maximum: 3, now: EPOCH + 100, windowMs: 2000 }), 'rate_limited');
  assert.deepEqual(await f.row(key), { count: 1, maximum: 3, expires_at: EPOCH + 1000 });
  accepted(await f.consume(1, { key, maximum: 3, now: EPOCH + 999, windowMs: 1000 }), { remaining: 1, resetAt: EPOCH + 1000 });
  accepted(await f.consume(0, { key, maximum: 3, now: EPOCH + 1000, windowMs: 1000 }), { remaining: 2, resetAt: EPOCH + 2000 });
  assert.equal(await f.row(key), null, 'The expired same-key row is reclaimed on rollover.');
  assert.deepEqual(await f.row(key, EPOCH + 1000), { count: 1, maximum: 3, expires_at: EPOCH + 2000 });
  assert.equal(await f.count(), 1);
}));

test('Budget: two new keys competing at 9999 rows admit only one while existing capacity remains usable', gate, async () => withFixture(async f => {
  await f.seedUnrelated(9999);
  const keys = [f.key(), f.key()];
  const results = await Promise.all(keys.map((key, i) => f.consume(i, { key, maximum: 3, now: EPOCH + 100, windowMs: 1000 })));
  assert.equal(results.filter(value => value.ok).length, 1);
  rejected(results.find(value => !value.ok), 'room_limit');
  assert.equal(await f.count(), 10_000);
  const winner = results.findIndex(value => value.ok);
  accepted(await f.consume(1 - winner, { key: keys[winner], maximum: 3, now: EPOCH + 100, windowMs: 1000 }), { remaining: 1, resetAt: EPOCH + 1000 });
  assert.equal(await f.count(), 10_000);
}));

test('Budget: unrelated expired rows count toward quota until bounded cleanup reclaims them', gate, async () => withFixture(async f => {
  await f.seedUnrelated(10_000, { expiresAt: EPOCH + 50 });
  const key = f.key(), options = { key, maximum: 3, now: EPOCH + 100, windowMs: 1000 };
  rejected(await f.consume(0, options), 'room_limit');
  assert.equal(await f.count(), 10_000, 'A rejected new key must not perform global unbounded cleanup.');
  assert.equal(await f.stores[1].cleanup(EPOCH + 100, 100), 0, 'No room rows are present in this fixture.');
  assert.equal(await f.count(), 9900, 'The public cleanup limit also bounds budget reclamation.');
  accepted(await f.consume(1, options), { remaining: 2, resetAt: EPOCH + 1000 });
  assert.equal(await f.count(), 9901);
}));

test('Budget: a queued old-window consume does not make same-key rollover reject at global capacity', gate, async () => withFixture(async f => {
  await f.seedUnrelated(9999);
  const key = f.key(); await f.seedRow(key, { count: 1, maximum: 10 });
  const blocker = await f.holdRow(key); let oldPID, newPID, oldResult, newResult, newSettled = false;
  const oldAcquire = client => { oldPID = client.processID; }, newAcquire = client => { newPID = client.processID; };
  f.stores[0].pool.on('acquire', oldAcquire); f.stores[1].pool.on('acquire', newAcquire);
  try {
    oldResult = f.consume(0, { key, maximum: 10, now: EPOCH + 999, windowMs: 1000 });
    await until(() => f.blockedBy(oldPID, blocker.pid), 'The old-window request must actually wait on the owned row blocker.');
    newResult = f.consume(1, { key, maximum: 10, now: EPOCH + 1000, windowMs: 1000 });
    void newResult.then(() => { newSettled = true; });
    // Observe either the intended lock dependency or an early result; no
    // guessed sleep or query-count expectation is used to arrange the race.
    await until(async () => newSettled || await f.blockedBy(newPID, oldPID), 'The new-window request did not reach a bounded observable state.');
    assert.equal(newSettled, false, 'Rollover must wait for the older same-key consume rather than reject before it can reclaim the row.');
    await blocker.release();
    accepted(await oldResult, { remaining: 8, resetAt: EPOCH + 1000 });
    accepted(await newResult, { remaining: 9, resetAt: EPOCH + 2000 });
    assert.equal(await f.row(key), null);
    assert.deepEqual(await f.row(key, EPOCH + 1000), { count: 1, maximum: 10, expires_at: EPOCH + 2000 });
    assert.equal(await f.count(), 10_000);
  } finally {
    await blocker.release();
    await Promise.all([oldResult, newResult].filter(Boolean));
    f.stores[0].pool.off('acquire', oldAcquire); f.stores[1].pool.off('acquire', newAcquire);
  }
}));

test('Budget: malformed keys, limits and captured clocks reject without changing an existing counter', gate, async () => withFixture(async f => {
  const key = f.key(), good = { key, maximum: 3, now: EPOCH + 100, windowMs: 1000 };
  accepted(await f.consume(0, good), { remaining: 2, resetAt: EPOCH + 1000 });
  const invalid = [
    undefined, { ...good, key: 'not-a-hash' }, { ...good, key: 'A'.repeat(64) },
    { ...good, maximum: 0 }, { ...good, maximum: 100_001 }, { ...good, maximum: 1.5 },
    { ...good, now: -1 }, { ...good, now: NaN }, { ...good, now: Infinity }, { ...good, now: Number.MAX_SAFE_INTEGER + 1 },
    { ...good, windowMs: 0 }, { ...good, windowMs: 1.5 }, { ...good, windowMs: 3_600_001 },
    { ...good, now: Number.MAX_SAFE_INTEGER, windowMs: 1 },
  ];
  for (let index = 0; index < invalid.length; index++) rejected(await f.consume(index % 2, invalid[index]), 'configuration_error');
  assert.deepEqual(await f.row(key), { count: 1, maximum: 3, expires_at: EPOCH + 1000 });
  assert.equal(await f.count(), 1);
  accepted(await f.consume(1, good), { remaining: 1, resetAt: EPOCH + 1000 });
}));

test('Budget: a post-COMMIT reply fault reports unknown outcome without an automatic second consume', gate, async () => withFixture(async f => {
  const key = f.key(); await f.seedRow(key, { count: 1, maximum: 5 });
  const descriptors = new Map(); let injected = false, committedWitness = false;
  const acquired = client => {
    if (descriptors.has(client)) return;
    descriptors.set(client, Object.getOwnPropertyDescriptor(client, 'query'));
    const original = client.query;
    client.query = function (...args) {
      const value = Reflect.apply(original, this, args);
      if (!injected && typeof args[0] === 'string' && args[0].trim().toUpperCase() === 'COMMIT') {
        injected = true;
        assert.ok(value && typeof value.then === 'function', 'The owned fault seam requires the product Promise query contract.');
        return value.then(result => {
          // Actual PostgreSQL COMMIT has completed; suppress only its returned
          // Promise result. No wire drop/broken-client claim is made here.
          committedWitness = true;
          throw Object.assign(new Error('Synthetic budget commit reply unavailable.'), { code: 'ECONNRESET' });
        });
      }
      return value;
    };
  };
  f.stores[0].pool.on('acquire', acquired);
  try {
    const failure = rejected(await f.consume(0, { key, maximum: 5, now: EPOCH + 100, windowMs: 1000 }), 'storage_unavailable');
    assert.equal(committedWitness, true, 'The actual COMMIT must finish before its Promise result is suppressed.');
    assert.equal(failure.phase, 'commit'); assert.equal(failure.outcome, 'unknown');
    assert.deepEqual(await f.row(key), { count: 2, maximum: 5, expires_at: EPOCH + 1000 });
    accepted(await f.consume(1, { key, maximum: 5, now: EPOCH + 100, windowMs: 1000 }), { remaining: 2, resetAt: EPOCH + 1000 });
    assert.deepEqual(await f.row(key), { count: 3, maximum: 5, expires_at: EPOCH + 1000 });
  } finally {
    f.stores[0].pool.off('acquire', acquired);
    for (const [client, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(client, 'query', descriptor); else delete client.query;
    }
  }
}));
