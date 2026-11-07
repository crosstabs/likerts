import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLiveServer } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const admission = () => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url') });
async function fixture(t, limits = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-quiz-http-'));
  const sqlitePath = join(directory, 'rooms.sqlite'), apps = [], stores = [];
  let timestamp = Date.now(), origin, app, store;
  t.after(async () => { for (const value of apps) await value.close(); for (const value of stores) await value.close(); await rm(directory, { recursive: true, force: true }); });
  const start = async () => {
    store = await openStore({ sqlitePath, databaseURL: '', production: false, now: () => timestamp }); stores.push(store);
    app = await createLiveServer({ store, catalogue, now: () => timestamp, limits }); apps.push(app);
    origin = (await app.listen({ host: '127.0.0.1', port: 0 })).origin;
  };
  await start();
  const request = async (method, path, body, token) => {
    const response = await fetch(origin + '/api/live' + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const cmd = (state, action, extra = {}) => ({ requestId: randomUUID(), matchId: state.matchId, ...(state.round ? { roundId: state.round.id } : {}), action, ...extra });
  const send = (member, command) => request('POST', `/rooms/${member.code}/actions`, command, member.token);
  const action = (member, state, action, extra = {}) => send(member, cmd(state, action, extra));
  const read = member => request('GET', '/rooms/' + member.code, undefined, member.token);
  const lobby = async () => {
    const quiz = sampleQuizDocument(); quiz.questions[0].timeLimitSeconds = 10;
    const created = await request('POST', '/rooms', { ...admission(), mode: 'quiz', modeVersion: 1, quiz, settings: { capacity: Math.min(12, limits.maxPlayers ?? 12) } }); assert.equal(created.status, 201);
    const host = created.body, members = [];
    for (const nickname of ['Ari', 'Bo']) {
      const joined = await request('POST', `/rooms/${host.code}/join`, { ...admission(), nickname, acceptRoomSharing: true }); assert.equal(joined.status, 201); members.push(joined.body);
    }
    return { quiz, host, members };
  };
  return { request, cmd, send, action, read, lobby, advance(ms) { timestamp += ms; }, currentStore() { return store; }, async restart() { await app.close(); await store.close(); await start(); } };
}

test('Quiz HTTP late answer is rejected while elapsed reveal commits once without an accepted receipt', async t => {
  const f = await fixture(t), { host, members } = await f.lobby();
  const state = (await f.action(host, host.state, 'start')).body.state;
  const late = f.cmd(state, 'quiz-answer', { value: 0 }); f.advance(10_000);
  const rejected = await f.send(members[0], late);
  assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'wrong_phase');
  const revealed = (await f.read(host)).body.state;
  assert.equal(revealed.phase, 'reveal'); assert.equal(revealed.reveal.reason, 'timeout');
  assert.ok(revealed.leaderboard.every(row => row.points === 0 && row.opportunities === 1));
  const receipts = () => f.currentStore().database.prepare('SELECT count(*) AS n FROM likerts_live_command_receipts').get().n;
  assert.equal(receipts(), 1);
  assert.equal((await f.send(members[0], late)).status, 409); assert.equal(receipts(), 1);
  assert.deepEqual((await f.read(host)).body.state.leaderboard, revealed.leaderboard);
});

test('Concurrent final answer retries and server restart retain one reveal, one score and one durable receipt', async t => {
  const f = await fixture(t), { host, members, quiz } = await f.lobby();
  let state = (await f.action(host, host.state, 'start')).body.state;
  assert.equal((await f.action(members[0], state, 'quiz-answer', { value: quiz.questions[0].correctAnswer })).status, 200);
  const final = f.cmd(state, 'quiz-answer', { value: quiz.questions[0].correctAnswer });
  const replies = await Promise.all(Array.from({ length: 8 }, () => f.send(members[1], final)));
  assert.ok(replies.every(reply => reply.status === 200 && reply.body.state.phase === 'reveal'));
  assert.ok(replies.every(reply => reply.body.state.leaderboard.every(row => row.points === 1000 && row.opportunities === 1)));
  assert.equal(f.currentStore().database.prepare('SELECT count(*) AS n FROM likerts_live_command_receipts').get().n, 3);
  await f.restart();
  assert.equal((await f.send(members[1], final)).status, 200);
  state = (await f.read(host)).body.state;
  assert.ok(state.leaderboard.every(row => row.points === 1000 && row.opportunities === 1));
  state = (await f.action(host, state, 'next')).body.state;
  const replay = await f.send(members[1], final); assert.equal(replay.status, 200); assert.equal(replay.body.state.round.id, state.round.id);
  assert.ok(replay.body.state.leaderboard.every(row => row.points === 1000));
});

test('Quiz leave exact retry and host close remain available at the receipt cap and revoke room access', async t => {
  const f = await fixture(t, { maxRequests: 1 }), { host, members } = await f.lobby();
  const state = (await f.action(host, host.state, 'start')).body.state;
  assert.equal((await f.action(members[0], state, 'quiz-answer', { value: 0 })).body.error.code, 'request_limit');
  const leave = f.cmd(state, 'leave');
  const first = await f.send(members[0], leave), retry = await f.send(members[0], leave);
  assert.deepEqual(first, { status: 200, body: { state: null, left: true } }); assert.deepEqual(retry, first);
  assert.equal((await f.read(members[0])).status, 401);
  const current = (await f.read(host)).body.state; assert.equal(current.completion, 'incomplete');
  assert.deepEqual((await f.action(host, current, 'close')).body, { state: null, closed: true });
  assert.equal((await f.read(host)).status, 404); assert.equal((await f.read(members[1])).status, 404);
  const database = f.currentStore().database;
  for (const table of ['likerts_live_rooms', 'likerts_live_command_receipts', 'likerts_live_members', 'likerts_live_socket_leases']) assert.equal(database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
  // Admission recovery records contain hashes, not quiz content, and follow the
  // existing bounded TTL independently after the room itself is deleted.
  assert.equal(database.prepare('SELECT count(*) AS n FROM likerts_live_admissions').get().n, 3);
  f.advance(6 * 60 * 60_000); await f.currentStore().cleanup();
  assert.equal(database.prepare('SELECT count(*) AS n FROM likerts_live_admissions').get().n, 0);
});

test('Quiz mode rejects unsupported controls and service capacity without changing legacy v1 creation', async t => {
  const f = await fixture(t, { maxPlayers: 2 });
  const bad = await f.request('POST', '/rooms', { ...admission(), mode: 'quiz', modeVersion: 1, quiz: sampleQuizDocument(), settings: { capacity: 3 } });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'capacity_unavailable');
  const legacy = await f.request('POST', '/rooms', { ...admission(), settings: {} });
  assert.equal(legacy.status, 201); assert.equal(legacy.body.state.protocolVersion, 1);
  assert.equal(Object.hasOwn(legacy.body.state, 'mode'), false);
  const { host, members } = await f.lobby();
  const state = (await f.action(host, host.state, 'start')).body.state;
  assert.deepEqual(state.settings, { capacity: 2 });
  const malformed = f.cmd(state, 'quiz-answer', { value: 0, score: 1000 });
  assert.equal((await f.send(members[0], malformed)).body.error.code, 'invalid_command');
  assert.equal((await f.action(host, state, 'pause')).body.error.code, 'invalid_action');
});
