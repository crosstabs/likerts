import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLiveServer } from '../server/app.mjs';
import { commandFingerprint } from '../server/engine.mjs';
import { openStore } from '../server/store.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const admission = () => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url') });
const roundActions = new Set(['answer', 'guess', 'quiz-answer', 'quiz-reveal', 'next', 'pause', 'resume', 'skip']);
const command = (state, action, extra = {}) => ({ requestId: randomUUID(), matchId: state.matchId,
  ...(roundActions.has(action) ? { roundId: state.round.id } : {}), action, ...extra });

async function fixture(t, mode) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-avatar-http-'));
  const sqlitePath = join(directory, 'rooms.sqlite'), timestamp = Date.now();
  let store, app, origin;
  const start = async () => {
    store = await openStore({ sqlitePath, databaseURL: '', production: false, now: () => timestamp });
    app = await createLiveServer({ store, catalogue, now: () => timestamp });
    ({ origin } = await app.listen({ host: '127.0.0.1', port: 0 }));
  };
  t.after(async () => {
    try { await app?.close(); }
    finally {
      try { await store?.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
  await start();
  const request = async (method, path, body, token) => {
    const response = await fetch(origin + '/api/live' + path, {
      method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const state = async member => {
    const response = await request('GET', '/rooms/' + member.code, undefined, member.token);
    assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.state;
  };
  const send = (member, value) => request('POST', `/rooms/${member.code}/actions`, value, member.token);
  const action = async (member, current, name, extra = {}) => {
    const response = await send(member, command(current, name, extra));
    assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.state;
  };
  const quiz = sampleQuizDocument();
  for (const question of quiz.questions) question.timeLimitSeconds = 0;
  const body = mode === 'quiz' ? { ...admission(), mode: 'quiz', modeVersion: 1, quiz, settings: { capacity: 12 } }
    : { ...admission(), settings: { capacity: 12, cycles: 1, answerSeconds: 0, predictSeconds: 0 } };
  const created = await request('POST', '/rooms', body); assert.equal(created.status, 201);
  const host = created.body, members = [];
  for (const nickname of ['Ari', 'Bo']) {
    const recovery = admission(), joinBody = { ...recovery, nickname, acceptRoomSharing: true };
    const joined = await request('POST', `/rooms/${host.code}/join`, joinBody); assert.equal(joined.status, 201);
    members.push({ ...joined.body, recovery, joinBody });
  }
  const raw = async () => (await store.transact(host.code, room => ({ room, changed: false, value: room }))).value;
  const receiptCount = () => store.database.prepare('SELECT count(*) AS n FROM likerts_live_command_receipts').get().n;
  const receipt = (member, value) => store.database.prepare('SELECT fingerprint FROM likerts_live_command_receipts WHERE actor_id=? AND request_id=?').get(member.memberId, value.requestId.toLowerCase());
  const restart = async () => { await app.close(); app = null; await store.close(); store = null; await start(); };
  const finish = async current => {
    while (current.phase !== 'finished') {
      if (current.phase === 'answer' && mode === 'quiz') {
        for (const member of members) current = await action(member, current, 'quiz-answer', { value: quiz.questions[current.round.index - 1].correctAnswer });
      } else if (current.phase === 'answer') {
        const subject = members.find(member => member.memberId === current.round.subjectId);
        current = await action(subject, current, 'answer', { value: 5 });
        for (const member of members.filter(member => member !== subject)) current = await action(member, current, 'guess', { value: 5 });
      }
      assert.equal(current.phase, 'reveal');
      current = await action(host, current, 'next');
    }
    return current;
  };
  return { request, state, send, action, raw, receiptCount, receipt, restart, finish, host, members };
}

for (const mode of ['mind-reading', 'quiz']) {
  test(`${mode} HTTP character selection is self-only, works in a locked lobby and preserves admission/revocation rules`, async t => {
    const f = await fixture(t, mode), { host, members: [ari, bo] } = f;
    let current = await f.state(host);
    assert.deepEqual(current.players.map(player => player.avatar), [1, 2], 'Old joins retain assigned defaults');
    current = await f.action(host, current, 'lock', { locked: true });
    const choose = command(current, 'choose-avatar', { value: 5 });
    const chosen = await f.send(ari, choose); assert.equal(chosen.status, 200);
    current = chosen.body.state;
    assert.deepEqual(current.players.map(player => player.avatar), [5, 2]);
    assert.equal(current.joinLocked, true);
    current = await f.action(bo, current, 'choose-avatar', { value: 5 });
    assert.deepEqual(current.players.map(player => player.avatar), [5, 5], 'Characters are not exclusive seats');
    const before = await f.raw(), receipts = f.receiptCount();
    for (const [member, values, status, code] of [
      [host, { value: 1 }, 403, 'forbidden'],
      [ari, { value: 1, playerId: bo.memberId }, 400, 'invalid_command'],
      [ari, { value: 1, avatar: 2 }, 400, 'invalid_command'],
      [ari, { value: 1, roundId: null }, 400, 'invalid_command'],
      ...[0, 6, 1.5, true, '2', null].map(value => [ari, { value }, 400, 'invalid_value']),
    ]) {
      const rejected = await f.send(member, command(current, 'choose-avatar', values));
      assert.equal(rejected.status, status); assert.equal(rejected.body.error.code, code);
      assert.deepEqual(await f.raw(), before, 'Rejected selection cannot mutate membership, score, roster or receipt state');
      assert.equal(f.receiptCount(), receipts);
    }
    const unauthenticated = await f.send({ ...ari, token: 'Z'.repeat(43) }, command(current, 'choose-avatar', { value: 1 }));
    assert.equal(unauthenticated.status, 401); assert.deepEqual(await f.raw(), before);
    const extraSeat = await f.request('POST', `/rooms/${host.code}/join`, { ...admission(), nickname: 'Cam', acceptRoomSharing: true });
    assert.equal(extraSeat.status, 409); assert.equal(extraSeat.body.error.code, 'room_locked');
    await f.action(host, await f.state(host), 'kick', { playerId: ari.memberId });
    assert.equal((await f.send(ari, choose)).status, 401, 'An old exact selection receipt grants no access after removal');
    const recovered = await f.request('POST', '/admissions/recover', ari.recovery);
    assert.equal(recovered.status, 410);
    const remaining = await f.state(host);
    assert.deepEqual(remaining.players.map(player => player.id), [bo.memberId]);
    assert.equal(remaining.players[0].avatar, 5); assert.equal(remaining.joinLocked, true);
  });

  test(`${mode} HTTP durable character receipts survive restart, recovery, start and rematch without replaying appearance or scores`, async t => {
    const f = await fixture(t, mode), { host, members: [ari] } = f;
    let current = await f.state(host);
    const original = command(current, 'choose-avatar', { value: 4 });
    assert.equal((await f.send(ari, original)).status, 200);
    current = await f.action(ari, await f.state(ari), 'choose-avatar', { value: 5 });
    const receipts = f.receiptCount();
    assert.equal(f.receipt(ari, original).fingerprint, commandFingerprint(original));
    await f.restart();
    const replay = await f.send(ari, original); assert.equal(replay.status, 200);
    assert.equal(replay.body.state.players.find(player => player.id === ari.memberId).avatar, 5);
    assert.equal(f.receiptCount(), receipts);
    const conflict = await f.send(ari, { ...original, value: 3 });
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'request_conflict');
    const obsoleteToken = ari.token;
    const recovery = await f.request('POST', '/admissions/recover', ari.recovery);
    assert.equal(recovery.status, 200); assert.equal(recovery.body.memberId, ari.memberId);
    ari.token = recovery.body.token; assert.notEqual(ari.token, obsoleteToken);
    assert.equal(recovery.body.state.players.find(player => player.id === ari.memberId).avatar, 5);
    assert.equal(recovery.body.state.players.length, 2, 'Recovery rotates access without adding a seat or rerolling the character');
    assert.equal((await f.send({ ...ari, token: obsoleteToken }, original)).status, 401);
    current = await f.action(host, await f.state(host), 'start');
    const started = await f.raw();
    assert.equal(started.roster.find(player => player.id === ari.memberId).avatar, 5);
    const activeChoice = await f.send(ari, command(current, 'choose-avatar', { value: 2 }));
    assert.equal(activeChoice.status, 409); assert.equal(activeChoice.body.error.code, 'wrong_phase');
    assert.deepEqual(await f.raw(), started, 'Start before a fresh selection prevents player and frozen-roster mutation');
    current = await f.finish(current);
    const finished = await f.raw(), scoredReceipts = f.receiptCount();
    assert.ok(current.leaderboard.some(row => row.points > 0), 'Replay checks cover an actually scored match');
    const afterScoring = await f.send(ari, original); assert.equal(afterScoring.status, 200);
    assert.deepEqual(await f.raw(), finished, 'An old exact receipt neither rescores nor reverts the character');
    assert.equal(f.receiptCount(), scoredReceipts);
    const finishedChoice = await f.send(ari, command(current, 'choose-avatar', { value: 2 }));
    assert.equal(finishedChoice.status, 409); assert.equal(finishedChoice.body.error.code, 'wrong_phase');
    current = await f.action(host, current, 'rematch');
    assert.notEqual(current.matchId, original.matchId);
    assert.equal(current.players.find(player => player.id === ari.memberId).avatar, 5);
    current = await f.action(ari, current, 'choose-avatar', { value: 2 });
    const rematched = await f.raw(), finalReceipts = f.receiptCount();
    await f.restart();
    const oldMatchReplay = await f.send(ari, original); assert.equal(oldMatchReplay.status, 200);
    assert.equal(oldMatchReplay.body.state.matchId, current.matchId);
    assert.equal(oldMatchReplay.body.state.players.find(player => player.id === ari.memberId).avatar, 2);
    assert.deepEqual(await f.raw(), rematched); assert.equal(f.receiptCount(), finalReceipts);
    const stale = await f.send(ari, { ...original, requestId: randomUUID(), value: 1 });
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'stale_match');
    assert.deepEqual(await f.raw(), rematched); assert.equal(f.receiptCount(), finalReceipts);
  });
}
