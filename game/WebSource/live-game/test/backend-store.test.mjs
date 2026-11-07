import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { openStore } from '../server/store.mjs';

const read = (store, code) => store.transact(code, room => ({ room, changed: false, value: room }));
const fixture = (code = 'ABCDEF', extra = {}) => ({ code, revision: 1, expiresAt: 5000, private: { answer: 4 }, count: 0, ...extra });

async function local(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-live-store-test-'));
  const sqlitePath = join(directory, 'rooms.sqlite');
  const store = await openStore({ sqlitePath, now: () => 1000, databaseURL: '', production: false, ...options });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, sqlitePath, store };
}

test('SQLite survives close/reopen and keeps committed state separate from caller objects', async t => {
  const { store, sqlitePath } = await local(t);
  const room = fixture();
  await store.create(room);
  room.private.answer = 1;
  assert.equal((await read(store, room.code)).room.private.answer, 4);
  await store.close();
  const reopened = await openStore({ sqlitePath, now: () => 1000, production: false, databaseURL: '' });
  t.after(() => reopened.close());
  const result = await read(reopened, room.code);
  assert.equal(result.room.private.answer, 4);
  result.room.private.answer = 2;
  assert.equal((await read(reopened, room.code)).room.private.answer, 4);
});

test('SQLite concurrent mutations serialize exactly once with no lost update', async t => {
  const { store } = await local(t);
  await store.create(fixture());
  await Promise.all(Array.from({ length: 100 }, () => store.transact('ABCDEF', room => {
    room.count += 1;
    room.revision += 1;
    return { room, changed: true, value: room.count };
  })));
  const final = (await read(store, 'ABCDEF')).room;
  assert.equal(final.count, 100);
  assert.equal(final.revision, 101);
});

test('Two SQLite adapters sharing one development file preserve all mutations', async t => {
  const { store, sqlitePath } = await local(t);
  const other = await openStore({ sqlitePath, now: () => 1000, production: false, databaseURL: '' });
  t.after(() => other.close());
  await store.create(fixture());
  await Promise.all(Array.from({ length: 80 }, (_, index) => (index % 2 ? store : other).transact('ABCDEF', room => {
    room.count += 1;
    room.revision += 1;
    return { room, changed: true };
  })));
  assert.equal((await read(store, 'ABCDEF')).room.count, 80);
  assert.equal((await read(other, 'ABCDEF')).room.count, 80);
});

test('Independent Node processes serialize writes to the same SQLite file', async t => {
  const { store, sqlitePath } = await local(t);
  await store.create(fixture());
  const script = `
    import { openStore } from ${JSON.stringify(new URL('../server/store.mjs', import.meta.url).href)};
    const store = await openStore({ sqlitePath: process.argv[1], now: () => 1000, production: false, databaseURL: '' });
    for (let i = 0; i < 80; i++) await store.transact('ABCDEF', room => {
      room.count++; room.revision++; return { room, changed: true };
    });
    await store.close();
  `;
  await Promise.all(Array.from({ length: 3 }, () => promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', script, sqlitePath], { timeout: 15_000 })));
  assert.equal((await read(store, 'ABCDEF')).room.count, 240);
  assert.equal((await read(store, 'ABCDEF')).room.revision, 241);
});

test('Failed reducer and asynchronous callback roll back without poisoning later transactions', async t => {
  const { store } = await local(t);
  await store.create(fixture());
  const rejected = Object.assign(new Error('A domain rejection'), { code: 'invalid_phase' });
  await assert.rejects(store.transact('ABCDEF', room => {
    room.private.answer = 1;
    throw rejected;
  }), error => error === rejected);
  await assert.rejects(store.transact('ABCDEF', async room => ({ room, changed: true })), { code: 'configuration_error' });
  await assert.rejects(store.transact('ABCDEF', async () => { throw new Error('A rejected asynchronous reducer'); }), { code: 'configuration_error' });
  assert.equal((await read(store, 'ABCDEF')).room.private.answer, 4);
  assert.equal(await store.count(), 1);
});

test('Unchanged result cannot persist or return a mutated room; domain value stays available', async t => {
  const { store } = await local(t);
  await store.create(fixture());
  const result = await store.transact('ABCDEF', room => {
    room.private.answer = 1;
    return { room, changed: false, value: 'kept' };
  });
  assert.equal(result.value, 'kept');
  assert.equal(result.room.private.answer, 4);
  assert.equal((await read(store, 'ABCDEF')).room.private.answer, 4);
});

test('Creation capacity is atomic, duplicates conflict, and only expired rows may reuse a code', async t => {
  let now = 1000;
  const { store } = await local(t, { maxRooms: 2, now: () => now });
  const results = await Promise.allSettled(['ABCDEF', 'BCDEFG', 'CDEFGH'].map(code => store.create(fixture(code))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'room_limit');
  await assert.rejects(store.create(fixture()), { code: 'room_exists' });
  now = 6000;
  assert.equal(await store.count(), 0);
  await store.create(fixture('ABCDEF', { expiresAt: 9000, private: { answer: 2 } }));
  assert.equal((await read(store, 'ABCDEF')).room.private.answer, 2);
  assert.equal(await store.count(), 1);
});

test('Cleanup is bounded and notifications contain only committed code and revision', async t => {
  const { store } = await local(t);
  const notices = [];
  const unsubscribe = store.subscribe((...args) => { notices.push(args); });
  await store.create(fixture('ABCDEF', { expiresAt: 2000 }));
  await store.create(fixture('BCDEFG', { expiresAt: 2000 }));
  await store.create(fixture('CDEFGH', { expiresAt: 9000 }));
  await store.transact('CDEFGH', room => {
    room.revision += 1;
    return { room, changed: true };
  });
  assert.equal(await store.cleanup(3000, 1), 1);
  assert.equal((await read(store, 'ABCDEF')).room, null);
  assert.ok((await read(store, 'BCDEFG')).room);
  assert.equal(await store.cleanup(3000, 1), 1);
  assert.equal(await store.cleanup(3000, 1), 0);
  assert.deepEqual(notices, [['ABCDEF', 1], ['BCDEFG', 1], ['CDEFGH', 1], ['CDEFGH', 2], ['ABCDEF', 2], ['BCDEFG', 2]]);
  unsubscribe();
  await store.transact('CDEFGH', () => ({ room: null, changed: true }));
  assert.equal(notices.length, 6);
  assert.equal(await store.count(), 0);
});

test('No production SQLite or in-memory fallback and no implicit survey URL', async () => {
  await assert.rejects(openStore({ production: true, databaseURL: '', sqlitePath: '/tmp/unused.sqlite' }), { code: 'configuration_error' });
  await assert.rejects(openStore({ production: false, databaseURL: '', sqlitePath: ':memory:' }), { code: 'configuration_error' });
  await assert.rejects(openStore({ production: false, databaseURL: '', sqlitePath: '' }), { code: 'configuration_error' });
  await assert.rejects(openStore({ production: true, databaseURL: 'sqlite://localhost/test' }), { code: 'configuration_error' });
  for (const suffix of ['sslmode=disable', 'sslmode=no-verify', 'sslmode=require', 'ssl=false', 'sslrejectunauthorized=false', 'sslmode=verify-full&sslmode=disable']) {
    await assert.rejects(openStore({ production: true, databaseURL: `postgresql://synthetic@db.example/live?${suffix}` }), { code: 'configuration_error' });
  }
  const source = await readFile(new URL('../server/store.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env\.DATABASE_URL/);
});

test('Closed stores fail safely, even after a rejected transaction', async t => {
  const { store } = await local(t);
  await store.create(fixture());
  await store.close();
  await assert.rejects(store.count(), { code: 'storage_unavailable' });
  await assert.rejects(store.transact('ABCDEF', room => ({ room, changed: false })), { code: 'storage_unavailable' });
});

const admissionOptions = (extra = {}) => ({
  admissionId: randomUUID(), secretHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64), now: 1000, ...extra,
});
const admittedRoom = (code = 'ABCDEF') => fixture(code, {
  hardExpiresAt: 6 * 60 * 60_000 + 1000,
  host: { id: 'host', tokenHash: '1'.repeat(64) }, players: [],
});
const rotateHost = ({ room, admission }) => {
  room.host.tokenHash = createHash('sha256').update(room.host.tokenHash).digest('hex');
  room.revision++;
  return { room, admission, value: 'rotated' };
};

test('SQLite commits admission and room atomically and recovers across restart without the original payload', async t => {
  const { store, sqlitePath } = await local(t);
  const options = admissionOptions();
  await assert.rejects(store.admit(options, () => { throw Object.assign(new Error('Rollback fixture'), { code: 'invalid_phase' }); }), { code: 'invalid_phase' });
  assert.equal(await store.count(), 0);
  await assert.rejects(store.recover({ admissionId: options.admissionId, secretHash: options.secretHash, now: 1000 }, rotateHost), { code: 'admission_invalid' });
  const created = await store.admit(options, () => ({ room: admittedRoom(), admission: { memberId: 'host' }, value: 'created' }));
  assert.equal(created.value, 'created');
  assert.equal(created.admission.recoveries, 0);
  await store.close();
  const reopened = await openStore({ sqlitePath, now: () => 1000, production: false, databaseURL: '' });
  t.after(() => reopened.close());
  const recovered = await reopened.recover({ admissionId: options.admissionId, secretHash: options.secretHash, now: 2000 }, rotateHost);
  assert.equal(recovered.value, 'rotated');
  assert.equal(recovered.admission.memberId, 'host');
  assert.equal(recovered.admission.payloadHash, options.payloadHash);
  assert.equal(recovered.admission.recoveries, 1);
  assert.equal(recovered.room.revision, 2);
  assert.notEqual(recovered.room.host.tokenHash, created.room.host.tokenHash);
  assert.deepEqual(Object.keys(recovered.admission).sort(), ['admissionId', 'code', 'createdAt', 'expiresAt', 'memberId', 'payloadHash', 'recoverUntil', 'recoveries', 'roomInstance', 'secretHash'].sort());
});

test('SQLite competing admission retries create one member and atomically rotate subsequent credentials', async t => {
  const { store } = await local(t);
  await store.create(admittedRoom());
  const options = admissionOptions({ code: 'ABCDEF' });
  const id = randomUUID();
  const joined = await Promise.all(Array.from({ length: 10 }, () => store.admit(options, ({ room, admission }) => {
    if (!admission) room.players.push({ id, tokenHash: '2'.repeat(64), nickname: 'Fixture' });
    else room.players[0].tokenHash = createHash('sha256').update(room.players[0].tokenHash).digest('hex');
    room.revision++;
    return { room, admission: { memberId: id } };
  })));
  assert.equal((await read(store, 'ABCDEF')).room.players.length, 1);
  assert.equal(joined.at(-1).admission.recoveries, 9);
  assert.equal(new Set(joined.map(value => value.admission.memberId)).size, 1);
  await store.transact('ABCDEF', room => { room.players = []; return { room, changed: true }; });
  await assert.rejects(store.recover({ admissionId: options.admissionId, secretHash: options.secretHash, now: 2000 }, () => assert.fail('Removed participant must not be resurrected')), { code: 'admission_unavailable' });
});

test('SQLite admission conflicts, recovery ceiling, expiry and close never resurrect rooms', async t => {
  const { store } = await local(t);
  const options = admissionOptions();
  await store.admit(options, () => ({ room: admittedRoom(), admission: { memberId: 'host' } }));
  await assert.rejects(store.admit({ ...options, payloadHash: 'c'.repeat(64) }, () => assert.fail('Conflicting payload must not run')), { code: 'admission_conflict' });
  await assert.rejects(store.recover({ ...options, secretHash: 'd'.repeat(64) }, () => assert.fail('Wrong secret must not run')), { code: 'admission_invalid' });
  for (let i = 0; i < 20; i++) await store.recover({ admissionId: options.admissionId, secretHash: options.secretHash, now: 2000 }, rotateHost);
  await assert.rejects(store.recover({ admissionId: options.admissionId, secretHash: options.secretHash, now: 2000 }, rotateHost), { code: 'admission_limit' });
  await store.transact('ABCDEF', () => ({ room: null, changed: true }));
  assert.equal(await store.cleanup(6000, 1), 0);
  await assert.rejects(store.admit({ ...options, now: 6000 }, () => assert.fail('Closed room must retain an admission tombstone')), { code: 'admission_unavailable' });
  assert.equal(await store.count(), 0);

  const timed = admissionOptions();
  await store.admit(timed, () => ({ room: admittedRoom('BCDEFG'), admission: { memberId: 'host' } }));
  await assert.rejects(store.recover({ admissionId: timed.admissionId, secretHash: timed.secretHash, now: 601_000 }, rotateHost), { code: 'admission_unavailable' });
});

test('SQLite admission capacity override is atomic while existing recovery bypasses the full quota', async t => {
  const { store } = await local(t);
  const codes = ['ABCDEF', 'BCDEFG', 'CDEFGH', 'DEFGHJ'];
  const attempts = codes.map(code => ({ options: admissionOptions({ maxRooms: 1 }), room: admittedRoom(code) }));
  const results = await Promise.allSettled(attempts.map(({ options, room }) => store.admit(options, () => ({ room, admission: { memberId: 'host' } }))));
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.ok(results.filter(value => value.status === 'rejected').every(value => value.reason.code === 'room_limit'));
  const index = results.findIndex(value => value.status === 'fulfilled');
  const options = attempts[index].options;
  const recovered = await store.recover({ admissionId: options.admissionId, secretHash: options.secretHash, now: 2000, maxRooms: 1 }, rotateHost);
  assert.equal(recovered.admission.recoveries, 1);
  assert.equal(await store.count(), 1);
});

test('SQLite fixed-window budgets share exact limits across adapters and persist through restart', async t => {
  const { store, sqlitePath } = await local(t);
  const second = await openStore({ sqlitePath, production: false, databaseURL: '' });
  t.after(() => second.close());
  const options = { key: 'a'.repeat(64), maximum: 7, now: 1000, windowMs: 1000 };
  const results = await Promise.allSettled(Array.from({ length: 70 }, (_, index) => (index % 2 ? store : second).consumeBudget(options)));
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 7);
  assert.ok(results.filter(value => value.status === 'rejected').every(value => value.reason.code === 'rate_limited'));
  await store.close();
  await second.close();
  const reopened = await openStore({ sqlitePath, production: false, databaseURL: '' });
  t.after(() => reopened.close());
  await assert.rejects(reopened.consumeBudget(options), { code: 'rate_limited' });
  await assert.rejects(reopened.consumeBudget({ ...options, maximum: 100 }), { code: 'rate_limited' });
  const next = await reopened.consumeBudget({ ...options, now: 2000 });
  assert.deepEqual(next, { remaining: 6, resetAt: 3000 });
  await reopened.cleanup(2000, 1);
  assert.deepEqual(await reopened.consumeBudget({ ...options, now: 2000 }), { remaining: 5, resetAt: 3000 });
  assert.equal(reopened.database.prepare('SELECT count(*) AS count FROM likerts_live_budgets').get().count, 1);
});

test('SQLite budget metadata has a hard row ceiling and cleanup releases only a bounded batch', async t => {
  const { store } = await local(t);
  // Synthetic fixture rows accelerate filling the documented metadata ceiling;
  // the API must still reject the next new key and accept after bounded cleanup.
  store.database.exec('BEGIN');
  const insert = store.database.prepare('INSERT INTO likerts_live_budgets (budget_key, window_start, count, maximum, expires_at) VALUES (?, 0, 1, 1, 60000)');
  for (let i = 0; i < 10_000; i++) insert.run(i.toString(16).padStart(64, '0'));
  store.database.exec('COMMIT');
  const options = { key: 'f'.repeat(64), maximum: 2, now: 1000 };
  await assert.rejects(store.consumeBudget(options), { code: 'room_limit' });
  await assert.rejects(store.consumeBudget({ ...options, now: 60_000 }), { code: 'room_limit' });
  await store.cleanup(60_000, 100);
  assert.equal(store.database.prepare('SELECT count(*) AS count FROM likerts_live_budgets').get().count, 9900);
  assert.equal((await store.consumeBudget({ ...options, now: 60_000 })).remaining, 1);
  assert.equal(store.database.prepare('SELECT count(*) AS count FROM likerts_live_budgets').get().count, 9901);
});

test('SQLite old host admission cannot recover a different room reusing the same code and clock', async t => {
  const { store } = await local(t);
  const oldOptions = admissionOptions();
  const first = await store.admit(oldOptions, () => ({ room: { ...admittedRoom(), createdAt: 1000 }, admission: { memberId: 'host' } }));
  await store.transact(first.room.code, () => ({ room: null, changed: true }));
  const newOptions = admissionOptions();
  const replacement = await store.admit(newOptions, () => ({ room: { ...admittedRoom(), createdAt: 1000 }, admission: { memberId: 'host' } }));
  assert.equal(replacement.room.code, first.room.code);
  assert.equal(replacement.room.createdAt, first.room.createdAt);
  assert.notEqual(replacement.room.instanceId, first.room.instanceId);
  await assert.rejects(store.recover({ admissionId: oldOptions.admissionId, secretHash: oldOptions.secretHash, now: 2000 },
    () => assert.fail('Old host admission must never reach the replacement room')), { code: 'admission_unavailable' });
  assert.equal((await read(store, first.room.code)).room.host.tokenHash, '1'.repeat(64));
  const recovered = await store.recover({ admissionId: newOptions.admissionId, secretHash: newOptions.secretHash, now: 2000 }, rotateHost);
  assert.equal(recovered.admission.roomInstance, replacement.room.instanceId);
  assert.equal(recovered.admission.recoveries, 1);
  await assert.rejects(store.transact(first.room.code, room => {
    room.instanceId = randomUUID(); return { room, changed: true };
  }), { code: 'configuration_error' });
  assert.equal((await read(store, first.room.code)).room.instanceId, replacement.room.instanceId);
});

test('SQLite adds a nullable legacy instance column without inferring ownership or enabling recovery', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-live-legacy-test-'));
  const sqlitePath = join(directory, 'rooms.sqlite');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(sqlitePath);
  const options = admissionOptions();
  old.exec(`CREATE TABLE likerts_live_admissions (
    admission_id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, payload_hash TEXT NOT NULL,
    code TEXT NOT NULL, member_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    recover_until INTEGER NOT NULL, expires_at INTEGER NOT NULL, recoveries INTEGER NOT NULL
  )`);
  old.prepare('INSERT INTO likerts_live_admissions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(options.admissionId, options.secretHash, options.payloadHash, 'ABCDEF', 'host', 1000, 601000, 21601000, 0);
  old.close();
  const store = await openStore({ sqlitePath, production: false, databaseURL: '', now: () => 1000 });
  t.after(() => store.close());
  await store.create(admittedRoom());
  assert.equal(store.database.prepare('SELECT room_instance FROM likerts_live_admissions WHERE admission_id = ?').get(options.admissionId).room_instance, null);
  await assert.rejects(store.recover({ admissionId: options.admissionId, secretHash: options.secretHash, now: 2000 },
    () => assert.fail('Legacy unbound admission must fail closed')), { code: 'admission_unavailable' });
  assert.equal(store.database.prepare('SELECT room_instance FROM likerts_live_admissions WHERE admission_id = ?').get(options.admissionId).room_instance, null);
});
