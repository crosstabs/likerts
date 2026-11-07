import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openStore } from '../server/store.mjs';
import { createRoom, joinRoom, reduceRoom, commandFingerprint, identify, revokedLeaveActor, replayLeft } from '../server/engine.mjs';
const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const cmd = (room, action = 'heartbeat', extra = {}) => ({ requestId: randomUUID(), matchId: room.matchId, ...(room.round ? { roundId: room.round.id } : {}), action, ...extra });
async function fixture(t, { legacy = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-v3-'));
  const path = join(directory, 'rooms.sqlite');
  const stores = [], raw = [];
  t.after(async () => { for (const store of stores) await store.close(); for (const db of raw) db.close(); await rm(directory, { recursive: true, force: true }); });
  const open = async () => { const store = await openStore({ sqlitePath: path, databaseURL: '', production: false, now: () => 1000 }); stores.push(store); return store; };
  const direct = () => { const db = new DatabaseSync(path); raw.push(db); return db; };
  if (legacy) direct().exec('CREATE TABLE likerts_live_rooms(code TEXT PRIMARY KEY,state_json TEXT NOT NULL,revision INTEGER NOT NULL,expires_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)');
  return { path, open, direct };
}
async function action(store, code, token, command, maxReceipts = 1000) {
  return store.transactCommand(code, { requestId: command.requestId, fingerprint: commandFingerprint(command), maxReceipts,
    authorize(room) { const revoked = revokedLeaveActor(room, token, command); return { actorId: revoked ?? identify(room, token), scope: revoked ? 'revoked_leave' : 'active' }; },
  }, (room, receiptContext) => {
    if (receiptContext.scope === 'revoked_leave') {
      assert.equal(replayLeft(room, token, command, receiptContext), true);
      return { room, changed: false, value: { left: true, state: null } };
    }
    const result = reduceRoom(room, receiptContext.actorId, command, { catalogue, now: 1000, maxRequests: maxReceipts, receiptContext });
    return { room: result.room, changed: !result.replayed, recordReceipt: result.recordReceipt, value: result };
  });
}

test('One hundred accepted receipts do not rewrite semantic JSON, and exact retry survives restart/rematch', async t => {
  const f = await fixture(t), store = await f.open(), created = createRoom({}, { catalogue, now: 1000 });
  let room = created.room;
  for (const nickname of ['Ari', 'Bo']) room = joinRoom(room, { nickname, acceptRoomSharing: true }, { now: 1000 }).room;
  await store.create(room);
  const before = store.database.prepare('SELECT state_json FROM likerts_live_rooms').get().state_json;
  let original;
  for (let n = 0; n < 100; n++) { const command = cmd(room); original ??= command; room = (await action(store, room.code, created.token, command)).room; }
  assert.equal(store.database.prepare('SELECT state_json FROM likerts_live_rooms').get().state_json, before);
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM likerts_live_command_receipts').get().n, 100);
  assert.equal(room.receiptCount, 100); assert.equal(room.requests, undefined);
  room = (await action(store, room.code, created.token, cmd(room, 'start'))).room;
  room = (await action(store, room.code, created.token, cmd(room, 'end'))).room;
  room = (await action(store, room.code, created.token, cmd(room, 'rematch'))).room;
  await store.close(); const reopened = await f.open();
  const replay = await action(reopened, room.code, created.token, original);
  assert.equal(replay.value.replayed, true); assert.equal(replay.room.matchId, room.matchId); assert.equal(replay.room.receiptCount, 103);
  await assert.rejects(action(reopened, room.code, created.token, { ...original, action: 'lock', locked: true }), { code: 'request_conflict' });
});

test('A receipt-insert failure rolls back room, member metadata and count before exact retry', async t => {
  const f = await fixture(t), store = await f.open(), created = createRoom({}, { catalogue, now: 1000 }); await store.create(created.room);
  const command = cmd(created.room, 'lock', { locked: true });
  store.database.exec("CREATE TRIGGER receipt_fault BEFORE INSERT ON likerts_live_command_receipts BEGIN SELECT RAISE(ABORT,'OWNED_SYNTHETIC_FAILURE'); END");
  await assert.rejects(action(store, created.room.code, created.token, command), { code: 'storage_unavailable' });
  const unchanged = (await store.transact(created.room.code, room => ({ room, changed: false }))).room;
  assert.equal(unchanged.joinLocked, false); assert.equal(unchanged.revision, 1); assert.equal(unchanged.receiptCount, 0);
  store.database.exec('DROP TRIGGER receipt_fault');
  assert.equal((await action(store, created.room.code, created.token, command)).room.receiptCount, 1);
  assert.equal((await action(store, created.room.code, created.token, command)).value.replayed, true);
});

test('Atomic legacy migration preserves restricted string leave receipts and rejects the old SQLite writer', async t => {
  const f = await fixture(t, { legacy: true }), old = f.direct(), created = createRoom({}, { catalogue, now: 1000 });
  const joined = joinRoom(created.room, { nickname: 'Ari', acceptRoomSharing: true }, { now: 1000 });
  const leave = cmd(joined.room, 'leave');
  const left = reduceRoom(joined.room, joined.memberId, leave, { catalogue, now: 1000 }).room;
  const [hash, record] = Object.entries(left.revocations)[0]; left.revocations[hash] = record.memberId; left.requests[`${record.memberId}:${record.requestId}`] = record.fingerprint;
  old.prepare('INSERT INTO likerts_live_rooms VALUES(?,?,?,?,?)').run(left.code, JSON.stringify(left), left.revision, left.expiresAt, 1000);
  const oldWrite = old.prepare('UPDATE likerts_live_rooms SET revision=revision+1 WHERE code=?');
  const store = await f.open();
  const result = await action(store, left.code, joined.token, leave);
  assert.deepEqual(result.value, { left: true, state: null });
  assert.equal(result.room.requests, undefined); assert.equal(result.room.receiptCount, 1);
  assert.throws(() => oldWrite.run(left.code), /no such function/);
  const state = JSON.parse(store.database.prepare('SELECT state_json FROM likerts_live_rooms').get().state_json);
  assert.equal(state.requests, undefined); assert.equal(state.host.lastSeen, undefined); assert.equal(state.host.socketLeases, undefined);
});

test('A failing second migration row leaves every legacy row and schema change uncommitted', async t => {
  const f = await fixture(t, { legacy: true }), old = f.direct();
  for (const code of ['ABCDEF', 'BCDEFG']) { const room = createRoom({}, { catalogue, code, now: 1000 }).room; old.prepare('INSERT INTO likerts_live_rooms VALUES(?,?,?,?,?)').run(code, JSON.stringify(room), room.revision, room.expiresAt, 1000); }
  old.exec("CREATE TRIGGER migrate_fault BEFORE UPDATE ON likerts_live_rooms WHEN OLD.code='BCDEFG' BEGIN SELECT RAISE(ABORT,'OWNED_MIGRATION_FAILURE'); END");
  await assert.rejects(f.open(), { code: 'storage_unavailable' });
  assert.equal(old.prepare('PRAGMA table_info(likerts_live_rooms)').all().some(column => column.name === 'storage_version'), false);
  assert.ok(old.prepare('SELECT state_json FROM likerts_live_rooms').all().every(row => Object.hasOwn(JSON.parse(row.state_json), 'requests')));
  old.exec('DROP TRIGGER migrate_fault'); const store = await f.open(); assert.equal(await store.count(), 2);
});

test('Presence and lease-only mutations preserve semantic JSON and close cascades child metadata', async t => {
  const f = await fixture(t), store = await f.open(), created = createRoom({}, { catalogue, now: 1000 }); await store.create(created.room);
  const before = store.database.prepare('SELECT state_json FROM likerts_live_rooms').get().state_json;
  await store.transact(created.room.code, room => { room.host.lastSeen = 5000; room.lastActivityAt = 5000; room.revision++; room.host.socketLeases[randomUUID()] = 50_000; return { room, changed: true }; });
  assert.equal(store.database.prepare('SELECT state_json FROM likerts_live_rooms').get().state_json, before);
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM likerts_live_socket_leases').get().n, 1);
  await store.transact(created.room.code, () => ({ room: null, changed: true }));
  for (const table of ['likerts_live_command_receipts', 'likerts_live_members', 'likerts_live_socket_leases']) assert.equal(store.database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
});

test('Async authorization fails safely without an unhandled rejection; hydration rejects corrupt extra members', async t => {
  const f = await fixture(t), store = await f.open(), created = createRoom({}, { catalogue, now: 1000 }); const room = await store.create(created.room), command = cmd(room);
  await assert.rejects(store.transactCommand(room.code, { requestId: command.requestId, fingerprint: commandFingerprint(command), maxReceipts: 1000, async authorize() { throw new Error('PRIVATE_CALLBACK_FIXTURE'); } }, () => assert.fail()), { code: 'configuration_error' });
  await new Promise(resolve => setImmediate(resolve));
  store.database.prepare('INSERT INTO likerts_live_members VALUES(?,?,?,?)').run(room.instanceId, randomUUID(), 1000, 'a'.repeat(64));
  await assert.rejects(store.transact(room.code, value => ({ room: value, changed: false })), { code: 'configuration_error' });
});

test('Durable lease ceiling rejects unsupported configuration and excess mutations without truncating', async t => {
  const f = await fixture(t);
  await assert.rejects(openStore({ sqlitePath: f.path, databaseURL: '', production: false, maxLeasesPerRoom: 201 }), { code: 'configuration_error' });
  const store = await f.open(), created = createRoom({}, { catalogue, now: 1000 }); await store.create(created.room);
  await assert.rejects(store.transact(created.room.code, room => { for (let n = 0; n < 201; n++) room.host.socketLeases[randomUUID()] = 50_000; return { room, changed: true }; }), { code: 'configuration_error' });
  assert.equal(store.database.prepare('SELECT count(*) AS n FROM likerts_live_socket_leases').get().n, 0);
});

test('Corrupt semantic locators cannot redirect a locked mutation into a different room', async t => {
  const f = await fixture(t), store = await f.open();
  const first = createRoom({}, { catalogue, code: 'ABCDEF', now: 1000 }).room;
  const second = createRoom({}, { catalogue, code: 'BCDEFG', now: 1000 }).room;
  await store.create(first); await store.create(second);
  const row = store.database.prepare('SELECT state_json FROM likerts_live_rooms WHERE code=?').get(first.code);
  const corrupted = { ...JSON.parse(row.state_json), code: second.code };
  store.database.prepare('UPDATE likerts_live_rooms SET state_json=? WHERE code=?').run(JSON.stringify(corrupted), first.code);
  await assert.rejects(store.transact(first.code, room => { room.joinLocked = true; return { room, changed: true }; }), { code: 'configuration_error' });
  const other = (await store.transact(second.code, room => ({ room, changed: false }))).room;
  assert.equal(other.joinLocked, false); assert.equal(other.revision, 1);
});

test('Malformed legacy locators or numeric metadata abort migration without coercion', async t => {
  for (const corrupt of ['locator', 'timestamp']) {
    const f = await fixture(t, { legacy: true }), old = f.direct(), room = createRoom({}, { catalogue, code: 'ABCDEF', now: 1000 }).room;
    if (corrupt === 'timestamp') room.lastActivityAt = [];
    old.prepare('INSERT INTO likerts_live_rooms VALUES(?,?,?,?,?)').run(corrupt === 'locator' ? 'BCDEFG' : room.code, JSON.stringify(room), room.revision, room.expiresAt, 1000);
    await assert.rejects(f.open(), { code: 'storage_unavailable' });
    assert.equal(old.prepare('PRAGMA table_info(likerts_live_rooms)').all().some(column => column.name === 'storage_version'), false);
  }
});

test('Compatibility guards also reject old budget-only and admission-only writes', async t => {
  const f = await fixture(t), store = await f.open(), old = f.direct();
  const key = 'a'.repeat(64);
  await store.consumeBudget({ key, maximum: 10, now: 1000 });
  const created = createRoom({}, { catalogue, now: 1000 });
  const admissionId = randomUUID();
  await store.admit({ admissionId, secretHash: 'b'.repeat(64), payloadHash: 'c'.repeat(64), now: 1000 }, () => ({ room: created.room, admission: { memberId: 'host' } }));
  for (const sql of ['UPDATE likerts_live_budgets SET count=count+1', 'UPDATE likerts_live_admissions SET recoveries=recoveries+1']) assert.throws(() => old.prepare(sql).run(), /no such function/);
  assert.equal((await store.consumeBudget({ key, maximum: 10, now: 1000 })).remaining, 8);
  assert.equal(store.database.prepare('SELECT recoveries FROM likerts_live_admissions WHERE admission_id=?').get(admissionId).recoveries, 0);
});
