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
const playerIds = state => state.players.map(player => player.id).sort();
const leaderboardIds = state => state.leaderboard.map(player => player.playerId).sort();
const command = (state, action, extra = {}) => ({ requestId: randomUUID(), matchId: state.matchId, expectedRevision: state.revision, ...(state.round ? { roundId: state.round.id } : {}), action, ...extra });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-removal-lock-http-'));
  const timestamp = Date.now();
  let store, app;
  // Register before opening resources so an interrupted setup still cleans up.
  t.after(async () => {
    try { await app?.close(); }
    finally {
      try { await store?.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
  store = await openStore({ sqlitePath: join(directory, 'rooms.sqlite'), databaseURL: '', production: false, now: () => timestamp });
  app = await createLiveServer({ store, catalogue, now: () => timestamp });
  const { origin } = await app.listen({ host: '127.0.0.1', port: 0 });
  const request = async (method, path, body, token) => {
    const response = await fetch(origin + '/api/live' + path, {
      method,
      headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const read = member => request('GET', '/rooms/' + member.code, undefined, member.token);
  const state = async member => {
    const result = await read(member); assert.equal(result.status, 200);
    return result.body.state;
  };
  const send = (member, value) => request('POST', `/rooms/${member.code}/actions`, value, member.token);
  const action = async (member, current, name, extra = {}) => {
    const result = await send(member, command(current, name, extra));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.state;
  };
  const joinPlayer = async (host, nickname, credential = admission()) => {
    const body = { ...credential, nickname, acceptRoomSharing: true };
    const result = await request('POST', `/rooms/${host.code}/join`, body);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return { ...result.body, admission: credential, joinBody: body };
  };
  const lobby = async mode => {
    const quiz = sampleQuizDocument();
    // Keep a second question available after scoring the first, without timers.
    if (quiz.questions.length === 1) quiz.questions.push({ ...structuredClone(quiz.questions[0]), id: randomUUID() });
    for (const question of quiz.questions) question.timeLimitSeconds = 0;
    const body = mode === 'quiz'
      ? { ...admission(), mode: 'quiz', modeVersion: 1, quiz, settings: { capacity: 12 } }
      : { ...admission(), settings: { capacity: 12, cycles: 1, answerSeconds: 0, predictSeconds: 0 } };
    const result = await request('POST', '/rooms', body); assert.equal(result.status, 201);
    const host = result.body, members = [];
    for (const nickname of ['Ari', 'Bo', 'Cam']) members.push(await joinPlayer(host, nickname));
    assert.equal((await state(host)).players.length, 3);
    return { host, members, quiz };
  };
  const scoreRound = async (mode, host, members, quiz, current) => {
    if (mode === 'quiz') {
      const correct = quiz.questions[current.round.index - 1].correctAnswer;
      for (const member of members) current = await action(member, current, 'quiz-answer', { value: correct });
    } else {
      const subject = members.find(member => member.memberId === current.round.subjectId);
      current = await action(subject, current, 'answer', { value: 5 });
      for (const member of members.filter(member => member.memberId !== subject.memberId)) current = await action(member, current, 'guess', { value: 5 });
    }
    assert.equal(current.phase, 'reveal');
    assert.ok(current.leaderboard.some(row => row.points > 0), 'Replay checks must exercise an already scored match.');
    return state(host);
  };
  const receiptCount = () => store.database.prepare('SELECT count(*) AS n FROM likerts_live_command_receipts').get().n;
  return { request, read, state, send, action, joinPlayer, lobby, scoreRound, receiptCount };
}

for (const mode of ['mind-reading', 'quiz']) {
  for (const phase of ['lobby', 'active']) {
    test(`${mode} HTTP ${phase} removal revokes access, locks admission through rematch and cannot replay a mutation after reopening`, async t => {
      const f = await fixture(t), { host, members, quiz } = await f.lobby(mode);
      // Replaying an admission rotates its token, not its membership. Recovery
      // after removal must never recreate that membership behind the lock.
      const removed = members[2], obsoleteToken = removed.token;
      const replayedAdmission = await f.request('POST', `/rooms/${host.code}/join`, removed.joinBody);
      assert.equal(replayedAdmission.status, 201);
      assert.equal(replayedAdmission.body.memberId, removed.memberId);
      removed.token = replayedAdmission.body.token;
      assert.notEqual(removed.token, obsoleteToken);
      assert.equal((await f.read({ ...removed, token: obsoleteToken })).status, 401);
      const recovered = await f.request('POST', '/admissions/recover', removed.admission);
      assert.equal(recovered.status, 200); assert.equal(recovered.body.memberId, removed.memberId);
      removed.token = recovered.body.token;
      let current = await f.state(host);
      assert.equal(current.players.length, 3);
      if (phase === 'active') {
        current = await f.action(host, current, 'start');
        current = await f.scoreRound(mode, host, members, quiz, current);
        current = await f.action(host, current, 'next');
        assert.equal(current.phase, 'answer');
        // Include unfinished private input when terminating the next round.
        const actor = mode === 'quiz' ? removed : members.find(member => member.memberId === current.round.subjectId);
        await f.action(actor, current, mode === 'quiz' ? 'quiz-answer' : 'answer', { value: mode === 'quiz' ? quiz.questions[current.round.index - 1].correctAnswer : 5 });
        current = await f.state(host);
      }
      const priorScores = current.leaderboard;
      const kick = command(current, 'kick', { playerId: removed.memberId });
      const receiptsBeforeKick = f.receiptCount();
      const kicked = await f.send(host, kick); assert.equal(kicked.status, 200);
      current = kicked.body.state;
      assert.equal(current.joinLocked, true, 'The accepted removal must atomically lock fresh admission.');
      const remaining = members.filter(member => member !== removed);
      const remainingIds = remaining.map(member => member.memberId).sort();
      assert.deepEqual(playerIds(current), remainingIds);
      assert.equal(f.receiptCount(), receiptsBeforeKick + 1, 'Removal commits one durable command receipt.');
      assert.equal((await f.read(removed)).status, 401);
      assert.equal((await f.send(removed, command(current, 'heartbeat'))).status, 401);
      for (const nickname of ['Fresh player', removed.joinBody.nickname]) {
        const blocked = await f.request('POST', `/rooms/${host.code}/join`, { ...admission(), nickname, acceptRoomSharing: true });
        assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'room_locked');
      }
      for (const [path, body] of [['/admissions/recover', removed.admission], [`/rooms/${host.code}/join`, removed.joinBody]]) {
        const rejected = await f.request('POST', path, body);
        assert.equal(rejected.status, 410); assert.equal(rejected.body.error.code, 'admission_unavailable');
      }
      assert.deepEqual(await f.state(host), current, 'Rejected access/admissions cannot change the room.');
      if (phase === 'active') {
        assert.equal(current.phase, 'finished'); assert.equal(current.completion, 'incomplete');
        assert.deepEqual(current.leaderboard, priorScores, 'Terminating unfinished input must not score another round.');
        assert.equal(current.reveal.valid, false);
      } else {
        assert.equal(current.phase, 'lobby');
        current = await f.action(host, current, 'start');
        current = await f.action(host, current, 'end');
      }
      const oldMatch = current.matchId;
      current = await f.action(host, current, 'rematch');
      assert.equal(current.phase, 'lobby'); assert.notEqual(current.matchId, oldMatch);
      assert.equal(current.joinLocked, true, 'Rematch must preserve the admission lock.');
      assert.deepEqual(playerIds(current), remainingIds); assert.deepEqual(leaderboardIds(current), remainingIds);
      assert.ok(current.leaderboard.every(row => row.points === 0 && row.opportunities === 0));
      const blockedRematch = await f.request('POST', `/rooms/${host.code}/join`, { ...admission(), nickname: 'Rematch visitor', acceptRoomSharing: true });
      assert.equal(blockedRematch.status, 409); assert.equal(blockedRematch.body.error.code, 'room_locked');
      current = await f.action(host, current, 'lock', { locked: false });
      assert.equal(current.joinLocked, false);
      const beforeRetry = current, receiptsBeforeRetry = f.receiptCount();
      const retry = await f.send(host, kick);
      assert.equal(retry.status, 200); assert.deepEqual(retry.body.state, beforeRetry);
      assert.equal(f.receiptCount(), receiptsBeforeRetry, 'An old exact removal retry adds no receipt or revision.');
      const replacement = await f.joinPlayer(host, removed.joinBody.nickname);
      assert.notEqual(replacement.memberId, removed.memberId);
      current = await f.state(host);
      assert.deepEqual(playerIds(current), [...remainingIds, replacement.memberId].sort());
      current = await f.action(host, current, 'start');
      current = await f.scoreRound(mode, host, [...remaining, replacement], quiz, current);
      const scoredReceipts = f.receiptCount();
      const scoredRetry = await f.send(host, kick);
      assert.equal(scoredRetry.status, 200); assert.deepEqual(scoredRetry.body.state, current);
      assert.equal(f.receiptCount(), scoredReceipts, 'Retry cannot relock, remove the replacement or rescore the new match.');
      const conflict = await f.send(host, { ...kick, playerId: replacement.memberId });
      assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'request_conflict');
      assert.deepEqual(await f.state(host), current);
      assert.equal((await f.read(removed)).status, 401, 'The original revoked capability remains revoked after reopening.');
    });
  }

  test(`${mode} HTTP rejected host controls and stale/cross-room removals leave both rooms and receipts unchanged`, async t => {
    const f = await fixture(t), { host, members } = await f.lobby(mode);
    const other = await f.lobby(mode);
    const current = await f.state(host), otherCurrent = await f.state(other.host);
    const receipts = f.receiptCount();
    const reject = async (member, value, status, code) => {
      const result = await f.send(member, value);
      assert.equal(result.status, status); assert.equal(result.body.error.code, code);
      assert.deepEqual(await f.state(host), current);
      assert.deepEqual(await f.state(other.host), otherCurrent);
      assert.equal(f.receiptCount(), receipts, 'Rejected controls must not receive accepted command receipts.');
    };
    for (const [name, extra] of [['kick', { playerId: members[2].memberId }], ['lock', { locked: true }], ['rematch', {}]]) {
      await reject(members[0], command(current, name, extra), 403, 'forbidden');
    }
    await reject(host, command(current, 'kick', { playerId: 'invalid' }), 400, 'invalid_player');
    await reject(host, command(current, 'kick', { playerId: randomUUID() }), 404, 'invalid_player');
    await reject(host, command(current, 'lock', { locked: 'true' }), 400, 'invalid_command');
    await reject(host, command(current, 'kick', { playerId: members[2].memberId, expectedRevision: current.revision - 1 }), 409, 'stale_revision');
    await reject(host, command(current, 'kick', { playerId: members[2].memberId, matchId: randomUUID() }), 409, 'stale_match');
    await reject(host, command(current, 'kick', { playerId: members[2].memberId, roundId: randomUUID() }), 409, 'stale_round');
    await reject({ ...other.host, code: host.code }, command(current, 'kick', { playerId: members[2].memberId }), 401, 'unauthorized');
    await reject(other.host, command(current, 'kick', { playerId: members[2].memberId }), 409, 'stale_match');
    await reject(host, command(current, 'kick', { playerId: other.members[0].memberId }), 404, 'invalid_player');
  });
}
