import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { openStore } from '../server/store.mjs';
import { publicError } from '../server/errors.mjs';
import { localTestDatabaseURL } from '../deployment/local-test-database.mjs';

// Explicit opt-in only. Never consult either deployment's real DATABASE_URL.
let databaseURL = process.env.LIKERTS_LIVE_TEST_DATABASE_URL;
if (databaseURL) {
  const target = localTestDatabaseURL(databaseURL);
  const { Pool } = await import('pg');
  const admin = new Pool({ connectionString: target.href, max: 1, connectionTimeoutMillis: 5000 });
  admin.on('error', () => {});
  const schema = `live_store_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  after(async () => { try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); } });
  target.searchParams.set('options', `-c search_path=${schema}`);
  databaseURL = target.href;
}
const pgTest = (name, run) => test(name, { skip: !databaseURL, timeout: 30_000 }, run);
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
const read = (store, code) => store.transact(code, room => ({ room, changed: false, value: room }));

async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

async function fixture(t, options = {}) {
  const marker = randomUUID();
  const owned = new Set();
  const ownedAdmissions = [];
  const ownedBudgets = [];
  const stores = [];
  const connect = async extra => {
    const store = await openStore({ databaseURL, production: false, maxRooms: 1000, ...options, ...extra });
    stores.push(store);
    return store;
  };
  const [first, second] = await Promise.all([connect(), connect()]);
  const room = (extra = {}) => {
    const value = { code: code(), revision: 1, expiresAt: Date.now() + 60_000, fixtureMarker: marker, count: 0, private: { answer: 4 }, ...extra };
    owned.add(value.code);
    return value;
  };
  const admission = extra => {
    const value = { admissionId: randomUUID(), secretHash: createHash('sha256').update(randomUUID()).digest('hex'), payloadHash: createHash('sha256').update(randomUUID()).digest('hex'), now: Date.now(), ...extra };
    ownedAdmissions.push(value);
    return value;
  };
  const budgetKey = () => {
    const key = createHash('sha256').update(`${marker}:${randomUUID()}`).digest('hex');
    ownedBudgets.push(key);
    return key;
  };
  t.after(async () => {
    // Remove only rows owned by this exact fixture, never truncate or delete
    // unfiltered rows in a shared database, and never drop the adapter table.
    const cleanup = stores.find(store => !store.closed) ?? await connect();
    for (const code of owned) await cleanup.transact(code, current => ({
      room: current?.fixtureMarker === marker ? null : current,
      changed: current?.fixtureMarker === marker,
    }));
    if (ownedAdmissions.length || ownedBudgets.length) {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: databaseURL, connectionTimeoutMillis: 5000 });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL likerts_live.storage_version = '3'");
        for (const value of ownedAdmissions) await client.query('DELETE FROM likerts_live_admissions WHERE admission_id = $1 AND secret_hash = $2', [value.admissionId, value.secretHash]);
        for (const key of ownedBudgets) await client.query('DELETE FROM likerts_live_budgets WHERE budget_key = $1', [key]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); await pool.end(); }
    }
    await Promise.all(stores.map(store => store.close()));
  });
  return { first, second, connect, room, admission, budgetKey };
}

pgTest('PostgreSQL row transactions serialize competing workers without lost updates', async t => {
  const { first, second, room } = await fixture(t);
  const original = room();
  await first.create(original);
  await Promise.all(Array.from({ length: 100 }, (_, index) => (index % 2 ? first : second).transact(original.code, current => {
    current.count++;
    current.revision++;
    return { room: current, changed: true };
  })));
  const final = (await read(second, original.code)).room;
  assert.equal(final.count, 100);
  assert.equal(final.revision, 101);
});

pgTest('PostgreSQL controlled pool exhaustion is classified and recovers without extending its timeout', async t => {
  const { first } = await fixture(t);
  const held = [];
  try {
    assert.equal(first.pool.options.max, 10);
    assert.equal(first.pool.options.connectionTimeoutMillis, 5000);
    // LISTEN owns one connection; hold the remaining nine in this owned pool.
    for (let i = 0; i < 9; i++) held.push(await first.pool.connect());
    await assert.rejects(first.transact(code(), room => ({ room, changed: false })), error => {
      assert.equal(error.code, 'storage_unavailable');
      assert.equal(error.diagnostic.phase, 'acquire');
      assert.equal(error.diagnostic.kind, 'pool_acquire_timeout');
      assert.equal(error.diagnostic.rollback, 'not_started');
      assert.equal(error.diagnostic.outcome, 'not_started');
      assert.equal(error.diagnostic.pool.total, 10);
      assert.equal(error.diagnostic.pool.idle, 0);
      assert.ok(error.diagnostic.elapsedMs >= 4500);
      assert.deepEqual(publicError(error), { status: 503, error: { code: 'storage_unavailable', message: 'The game service is temporarily unavailable.' } });
      t.diagnostic(`Owned pool exhaustion: ${JSON.stringify(error.diagnostic)}`);
      return true;
    });
  } finally { for (const client of held) client.release(); }
  const result = await first.transact(code(), room => ({ room, changed: false, value: 'recovered' }));
  assert.equal(result.value, 'recovered');
});

pgTest('PostgreSQL controlled row contention preserves the driver class and rolls back before recovery', async t => {
  const { first, second, room } = await fixture(t);
  const original = room(); await first.create(original);
  const blocker = await second.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT code FROM likerts_live_rooms WHERE code = $1 FOR UPDATE', [original.code]);
    await assert.rejects(first.transact(original.code, current => ({ room: { ...current, count: 99 }, changed: true })), error => {
      assert.equal(error.code, 'storage_unavailable');
      assert.equal(error.diagnostic.phase, 'operation');
      // Both fixed server limits are 5s. PostgreSQL may fire statement_timeout
      // before lock_timeout; preserve the exact observed SQLSTATE, not a guess.
      assert.ok(['lock_timeout', 'statement_timeout'].includes(error.diagnostic.kind));
      assert.ok(['55P03', '57014'].includes(error.diagnostic.sqlState));
      assert.equal(error.diagnostic.rollback, 'succeeded');
      assert.equal(error.diagnostic.outcome, 'rolled_back');
      assert.ok(error.diagnostic.elapsedMs >= 4500);
      t.diagnostic(`Owned row contention: ${JSON.stringify(error.diagnostic)}`);
      return true;
    });
  } finally {
    let discard = false;
    try { await blocker.query('ROLLBACK'); } catch { discard = true; }
    blocker.release(discard);
  }
  assert.equal((await read(first, original.code)).room.count, 0, 'The timed-out mutation never committed');
  await first.transact(original.code, current => ({ room: { ...current, count: 1, revision: current.revision + 1 }, changed: true }));
  assert.equal((await read(second, original.code)).room.count, 1, 'A subsequent transaction still commits once');
});

pgTest('PostgreSQL rollback, deletion and reopen preserve only committed room state', async t => {
  const { first, second, connect, room } = await fixture(t);
  const original = room();
  await first.create(original);
  const rejected = Object.assign(new Error('Synthetic reducer rejection'), { code: 'invalid_phase' });
  await assert.rejects(first.transact(original.code, current => {
    current.private.answer = 1;
    throw rejected;
  }), error => error === rejected);
  await first.close();
  const reopened = await connect();
  assert.equal((await read(reopened, original.code)).room.private.answer, 4);
  await second.transact(original.code, () => ({ room: null, changed: true }));
  assert.equal((await read(reopened, original.code)).room, null);
});

pgTest('PostgreSQL unique insertion and global room admission remain atomic across workers', async t => {
  const { first, second, connect, room } = await fixture(t);
  const same = room();
  const duplicate = await Promise.allSettled([first.create(same), second.create(same)]);
  assert.equal(duplicate.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(duplicate.find(result => result.status === 'rejected').reason.code, 'room_exists');
  const baseline = await first.count();
  const [limitedA, limitedB] = await Promise.all([connect({ maxRooms: baseline + 2 }), connect({ maxRooms: baseline + 2 })]);
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
    (index % 2 ? limitedA : limitedB).create(room())));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'room_limit'));
  assert.equal(await first.count(), baseline + 2);
});

pgTest('PostgreSQL notifications cross workers with only code and revision, including listener reconnection', async t => {
  const { first, second, room } = await fixture(t);
  const notices = [];
  const unsubscribe = second.subscribe((...args) => { notices.push(args); });
  t.after(unsubscribe);
  const original = room();
  await first.create(original);
  await waitFor(() => notices.some(value => value[0] === original.code && value[1] === 1), 'Other worker did not receive committed room notification');
  await first.transact(original.code, current => {
    current.count = 8;
    current.revision++;
    return { room: current, changed: true };
  });
  await waitFor(() => notices.some(value => value[0] === original.code && value[1] === 2), 'Other worker did not receive update notification');
  assert.equal((await read(second, original.code)).room.count, 8);
  assert.ok(notices.every(value => value.length === 2 && typeof value[0] === 'string' && Number.isSafeInteger(value[1])));

  // Destroy only this fixture's dedicated LISTEN connection to the disposable
  // database. No provider, container or unrelated connection is stopped.
  const oldListener = second.listener;
  oldListener.connection.stream.destroy();
  await waitFor(() => second.listener && second.listener !== oldListener, 'LISTEN connection did not reconnect');
  const afterReconnect = room();
  await first.create(afterReconnect);
  await waitFor(() => notices.some(value => value[0] === afterReconnect.code), 'Reconnected listener missed a new committed notification');
  await first.transact(original.code, () => ({ room: null, changed: true }));
  await waitFor(() => notices.some(value => value[0] === original.code && value[1] === 3), 'Deletion did not revoke the room subscription');
});

pgTest('PostgreSQL atomic admission survives cross-table rollback and cross-worker recovery', async t => {
  const { first, second, room, admission } = await fixture(t);
  const options = admission();
  const original = room({ host: { id: 'host', tokenHash: '1'.repeat(64) }, players: [], hardExpiresAt: Date.now() + 6 * 60 * 60_000 });
  await assert.rejects(first.admit(options, () => { throw Object.assign(new Error('Synthetic rollback'), { code: 'invalid_phase' }); }), { code: 'invalid_phase' });
  await assert.rejects(second.recover({ admissionId: options.admissionId, secretHash: options.secretHash }, () => assert.fail('Rolled back admission must be absent')), { code: 'admission_invalid' });
  await first.admit(options, () => ({ room: original, admission: { memberId: 'host' } }));
  const recovered = await second.recover({ admissionId: options.admissionId, secretHash: options.secretHash }, ({ room, admission }) => {
    room.host.tokenHash = '2'.repeat(64);
    room.revision++;
    return { room, admission };
  });
  assert.equal(recovered.admission.recoveries, 1);
  assert.equal(recovered.admission.payloadHash, options.payloadHash);
  assert.equal((await read(first, original.code)).room.host.tokenHash, '2'.repeat(64));
  await assert.rejects(second.admit({ ...options, payloadHash: '3'.repeat(64) }, () => assert.fail('Conflicting admission must not run')), { code: 'admission_conflict' });
  await first.transact(original.code, () => ({ room: null, changed: true }));
  await assert.rejects(second.admit(options, () => assert.fail('Closed admission must not recreate the room')), { code: 'admission_unavailable' });
});

pgTest('PostgreSQL competing joins with one admission create exactly one player', async t => {
  const { first, second, room, admission } = await fixture(t);
  const original = room({ host: { id: 'host', tokenHash: '1'.repeat(64) }, players: [], hardExpiresAt: Date.now() + 6 * 60 * 60_000 });
  await first.create(original);
  const options = admission({ code: original.code });
  const memberId = randomUUID();
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).admit(options, ({ room, admission }) => {
    if (!admission) room.players.push({ id: memberId, tokenHash: '2'.repeat(64) });
    else room.players[0].tokenHash = createHash('sha256').update(room.players[0].tokenHash).digest('hex');
    room.revision++;
    return { room, admission: { memberId } };
  })));
  assert.equal((await read(first, original.code)).room.players.length, 1);
  assert.equal(Math.max(...results.map(value => value.admission.recoveries)), 11);
  assert.equal(new Set(results.map(value => value.admission.memberId)).size, 1);
});

pgTest('PostgreSQL shared budgets count across workers and remain exhausted after restart', async t => {
  const { first, second, connect, budgetKey } = await fixture(t);
  const now = Date.now();
  const options = { key: budgetKey(), maximum: 11, now, windowMs: 60_000 };
  const results = await Promise.allSettled(Array.from({ length: 80 }, (_, index) => (index % 2 ? first : second).consumeBudget(options)));
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 11);
  assert.ok(results.filter(value => value.status === 'rejected').every(value => value.reason.code === 'rate_limited'));
  await first.close(); await second.close();
  const reopened = await connect();
  await assert.rejects(reopened.consumeBudget(options), { code: 'rate_limited' });
  await assert.rejects(reopened.consumeBudget({ ...options, maximum: 100 }), { code: 'rate_limited' });
  const next = await reopened.consumeBudget({ ...options, now: Math.floor(now / 60_000) * 60_000 + 60_000 });
  assert.equal(next.remaining, 10);
});

pgTest('PostgreSQL admission maxRooms override admits one race winner and permits recovery at capacity', async t => {
  const { first, second, room, admission } = await fixture(t);
  const baseline = await first.count();
  const attempts = Array.from({ length: 10 }, () => ({
    options: admission({ maxRooms: baseline + 1 }),
    room: room({ host: { id: 'host', tokenHash: '1'.repeat(64) }, players: [], hardExpiresAt: Date.now() + 6 * 60 * 60_000 }),
  }));
  const results = await Promise.allSettled(attempts.map((value, index) => (index % 2 ? first : second).admit(value.options,
    () => ({ room: value.room, admission: { memberId: 'host' } }))));
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.ok(results.filter(value => value.status === 'rejected').every(value => value.reason.code === 'room_limit'));
  const index = results.findIndex(value => value.status === 'fulfilled');
  const options = attempts[index].options;
  const recovered = await second.recover({ admissionId: options.admissionId, secretHash: options.secretHash, maxRooms: baseline + 1 }, ({ room, admission }) => {
    room.host.tokenHash = '2'.repeat(64); room.revision++;
    return { room, admission };
  });
  assert.equal(recovered.admission.recoveries, 1);
  assert.equal(await first.count(), baseline + 1);
});

pgTest('PostgreSQL old host admission cannot cross reused room codes and legacy missing bindings fail closed', async t => {
  const { first, second, room, admission } = await fixture(t);
  const now = Date.now();
  const oldOptions = admission({ now });
  const original = room({ createdAt: now, hardExpiresAt: now + 6 * 60 * 60_000, host: { id: 'host', tokenHash: '1'.repeat(64) }, players: [] });
  const old = await first.admit(oldOptions, () => ({ room: original, admission: { memberId: 'host' } }));
  await first.transact(original.code, () => ({ room: null, changed: true }));
  const newOptions = admission({ now });
  const replacement = await second.admit(newOptions, () => ({ room: original, admission: { memberId: 'host' } }));
  assert.equal(replacement.room.code, old.room.code);
  assert.equal(replacement.room.createdAt, old.room.createdAt);
  assert.notEqual(replacement.room.instanceId, old.room.instanceId);
  await assert.rejects(first.recover({ admissionId: oldOptions.admissionId, secretHash: oldOptions.secretHash, now: now + 1 },
    () => assert.fail('Old host admission must not authorize the new room')), { code: 'admission_unavailable' });
  assert.equal((await read(first, original.code)).room.host.tokenHash, '1'.repeat(64));
  const recovered = await first.recover({ admissionId: newOptions.admissionId, secretHash: newOptions.secretHash, now: now + 1 }, ({ room, admission }) => {
    room.host.tokenHash = '2'.repeat(64); room.revision++;
    return { room, admission };
  });
  assert.equal(recovered.admission.roomInstance, replacement.room.instanceId);
  await assert.rejects(first.transact(original.code, room => {
    room.instanceId = randomUUID(); return { room, changed: true };
  }), { code: 'configuration_error' });
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: databaseURL, connectionTimeoutMillis: 5000, max: 1 });
  try {
    await pool.query('BEGIN');
    await pool.query("SET LOCAL likerts_live.storage_version = '3'");
    await pool.query('UPDATE likerts_live_admissions SET room_instance = NULL WHERE admission_id = $1 AND secret_hash = $2', [newOptions.admissionId, newOptions.secretHash]);
    await pool.query('COMMIT');
    await assert.rejects(second.recover({ admissionId: newOptions.admissionId, secretHash: newOptions.secretHash, now: now + 2 },
      () => assert.fail('Legacy admission without room instance must fail closed')), { code: 'admission_unavailable' });
    const legacy = await pool.query('SELECT room_instance FROM likerts_live_admissions WHERE admission_id = $1', [newOptions.admissionId]);
    assert.equal(legacy.rows[0].room_instance, null);
  } finally { await pool.end(); }
});
