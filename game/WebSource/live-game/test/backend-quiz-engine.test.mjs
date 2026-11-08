import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createQuizRoom, joinRoom, reduceRoom, project, advance, identify, commandFingerprint, replayLeft, validateCommand, validateQuizSettings } from '../server/engine.mjs';
import { openStore } from '../server/store.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';

const timestamp = 1_000_000;
const command = (room, action, extra = {}) => ({ requestId: randomUUID(), matchId: room.matchId, ...(room.round ? { roundId: room.round.id } : {}), action, ...extra });
const act = (room, actor, action, extra = {}, now = timestamp) => reduceRoom(room, actor, command(room, action, extra), { now }).room;
const view = (room, actor = 'host') => project(room, actor, { now: timestamp });
function fixture(quiz = sampleQuizDocument()) {
  const host = createQuizRoom(quiz, { capacity: 12 }, { now: timestamp });
  let room = host.room;
  const members = [];
  for (const nickname of ['Ari', 'Bo']) {
    const member = joinRoom(room, { nickname, acceptRoomSharing: true }, { now: timestamp });
    members.push(member); room = member.room;
  }
  return { host, members, room };
}

test('Quiz creation validates capacity/document and detaches the normalized immutable session content', () => {
  const quiz = sampleQuizDocument(); quiz.title = '  Cafe\u0301  ';
  const created = createQuizRoom(quiz, {}, { now: timestamp });
  const originalPrompt = created.room.quizSnapshot.questions[0].prompt;
  quiz.title = 'Changed'; quiz.questions[0].prompt = 'Changed'; quiz.questions.pop();
  assert.equal(created.room.quizSnapshot.title, 'Café');
  assert.equal(created.room.quizSnapshot.questions[0].prompt, originalPrompt);
  assert.equal(created.room.quizSnapshot.questions.length, 3);
  assert.deepEqual(created.room.settings, { capacity: 12 });
  for (const settings of [{ capacity: null }, { capacity: 1 }, { capacity: 51 }, { capacity: 2.5 }, { answerSeconds: 20 }]) assert.throws(() => validateQuizSettings(settings), { code: 'invalid_settings' });
  for (const bad of [null, {}, { ...sampleQuizDocument(), version: 2 }, { ...sampleQuizDocument(), extra: 'untrusted' }]) assert.throws(() => createQuizRoom(bad), { code: 'invalid_quiz' });
});

test('Every pre-reveal recipient omits the answer key, explanations, future questions and unrelated choices', () => {
  let { room, members } = fixture(); room = act(room, 'host', 'start');
  room = act(room, members[0].memberId, 'quiz-answer', { value: 0 });
  const alternate = structuredClone(room);
  alternate.quizSnapshot.questions[0].correctAnswer = 2;
  alternate.quizSnapshot.questions[0].explanation = 'Private alternate explanation';
  alternate.quizSnapshot.questions[1].prompt = 'Private future prompt';
  alternate.quizSnapshot.questions[2].answers.reverse();
  alternate.round.submissions[members[0].memberId] = 3;
  for (const actor of ['host', members[1].memberId]) assert.deepEqual(view(room, actor), view(alternate, actor));
  assert.equal(view(room, members[0].memberId).round.ownAnswer, 0);
  const payload = JSON.stringify(view(room));
  for (const key of ['correctAnswer', 'explanation', 'quizSnapshot', 'tokenHash', 'submissions', 'catalogHash', 'subjectId']) assert.equal(payload.includes(`"${key}"`), false, key);
  assert.equal(payload.includes(room.quizSnapshot.questions[1].prompt), false);
  assert.equal(view(room).round.submittedCount, 1);
  assert.equal(view(room).reveal, null);
});

test('All-player answering, early reveal and timeouts produce authoritative 1000-point standings', () => {
  let { room, members } = fixture(); room = act(room, 'host', 'start');
  const [a, b] = members.map(member => member.memberId);
  const snapshot = structuredClone(room.quizSnapshot);
  room = act(room, a, 'quiz-answer', { value: snapshot.questions[0].correctAnswer });
  room = act(room, b, 'quiz-answer', { value: (snapshot.questions[0].correctAnswer + 1) % snapshot.questions[0].answers.length });
  assert.equal(room.phase, 'reveal'); assert.equal(view(room).reveal.reason, 'answered'); assert.equal(view(room).reveal.groupAccuracy, 50);
  assert.equal(view(room).leaderboard[0].points, 1000); assert.equal(view(room).leaderboard[0].accuracy, 100);
  room = act(room, 'host', 'next');
  room = act(room, a, 'quiz-answer', { value: snapshot.questions[1].correctAnswer });
  room = act(room, 'host', 'quiz-reveal');
  assert.equal(view(room).reveal.reason, 'host_revealed'); assert.equal(view(room).reveal.results.find(result => result.playerId === b).value, null);
  room = act(room, 'host', 'next');
  assert.equal(advance(room, room.round.deadline), true); assert.equal(advance(room, timestamp + 999_999), false);
  assert.equal(view(room).reveal.reason, 'timeout');
  room = act(room, 'host', 'next');
  assert.equal(room.completion, 'complete');
  const final = view(room).leaderboard;
  assert.deepEqual(final.map(row => [row.points, row.opportunities, row.rank]), [[2000, 3, 1], [0, 3, 2]]);
  assert.equal(final[0].accuracy, 2000 / 30);
  assert.deepEqual(room.quizSnapshot, snapshot);
});

test('Deadline is inclusive, untimed questions remain active, and host reveal binds the current round', () => {
  let { room, members } = fixture(); room = act(room, 'host', 'start');
  const deadline = room.round.deadline, late = command(room, 'quiz-answer', { value: 0 });
  assert.throws(() => reduceRoom(room, members[0].memberId, late, { now: deadline }), { code: 'wrong_phase' });
  room = act(room, members[0].memberId, 'quiz-answer', { value: 0 }, deadline - 1);
  assert.equal(room.round.submissions[members[0].memberId], 0);
  room = act(room, 'host', 'quiz-reveal', {}, deadline - 1);
  const oldRound = room.round.id; room = act(room, 'host', 'next', {}, deadline - 1);
  assert.throws(() => act(room, 'host', 'quiz-reveal', { roundId: oldRound }), { code: 'stale_round' });
  assert.throws(() => validateCommand({ requestId: randomUUID(), matchId: room.matchId, action: 'quiz-reveal' }), { code: 'invalid_round' });
  const quiz = sampleQuizDocument(); quiz.questions[0].timeLimitSeconds = 0;
  let untimed = fixture(quiz).room; untimed = act(untimed, 'host', 'start');
  assert.equal(untimed.round.deadline, null); assert.equal(advance(untimed, timestamp + 100_000), false);
});

test('Quiz choices are zero based, question bounded, player-only and single lock', () => {
  const quiz = sampleQuizDocument(); quiz.questions[0].answers = ['Yes', 'No']; quiz.questions[0].correctAnswer = 0;
  let { room, members } = fixture(quiz); room = act(room, 'host', 'start');
  const player = members[0].memberId;
  for (const value of [-1, 2, 4, 0.5, '0']) assert.throws(() => act(room, player, 'quiz-answer', { value }), { code: 'invalid_value' });
  assert.throws(() => act(room, 'host', 'quiz-answer', { value: 0 }), { code: 'wrong_phase' });
  assert.throws(() => act(room, player, 'quiz-reveal'), { code: 'forbidden' });
  room = act(room, player, 'quiz-answer', { value: 0 });
  assert.throws(() => act(room, player, 'quiz-answer', { value: 1 }), { code: 'already_locked' });
  for (const action of ['answer', 'guess', 'pause', 'resume', 'skip']) assert.throws(() => act(room, 'host', action, ['answer', 'guess'].includes(action) ? { value: 1 } : {}), { code: 'invalid_action' });
});

test('Exact answer retries and conflicting request IDs cannot add points across reveal, next or rematch', () => {
  let { room, members } = fixture(); room = act(room, 'host', 'start');
  const player = members[0].memberId, original = command(room, 'quiz-answer', { value: room.quizSnapshot.questions[0].correctAnswer });
  room = reduceRoom(room, player, original, { now: timestamp }).room;
  assert.equal(reduceRoom(room, player, original, { now: timestamp }).replayed, true);
  assert.throws(() => reduceRoom(room, player, { ...original, value: (original.value + 1) % 4 }, { now: timestamp }), { code: 'request_conflict' });
  room = act(room, 'host', 'quiz-reveal');
  const points = room.scores[player].points;
  room = act(room, 'host', 'next');
  assert.equal(reduceRoom(room, player, original, { now: timestamp }).room.scores[player].points, points);
  room = act(room, 'host', 'end'); const oldMatch = room.matchId;
  room = act(room, 'host', 'rematch');
  assert.notEqual(room.matchId, oldMatch); assert.equal(reduceRoom(room, player, original, { now: timestamp }).replayed, true);
  assert.deepEqual(room.scores, {}); assert.equal(room.quizSnapshot.questions.length, 3);
});

test('End, leave and kick invalidate unfinished choices; leave retains its exact revoked receipt', () => {
  for (const action of ['end', 'leave', 'kick']) {
    let { room, members } = fixture(); room = act(room, 'host', 'start');
    room = act(room, members[0].memberId, 'quiz-answer', { value: room.quizSnapshot.questions[0].correctAnswer });
    const actor = action === 'leave' ? members[1].memberId : 'host';
    const cmd = command(room, action, action === 'kick' ? { playerId: members[1].memberId } : {});
    room = reduceRoom(room, actor, cmd, { now: timestamp }).room;
    const projected = view(room, members[0].memberId);
    assert.equal(projected.completion, 'incomplete'); assert.equal(projected.round.ownAnswer, null);
    assert.equal(projected.reveal.valid, false); assert.equal(projected.reveal.correctAnswer, null); assert.equal(projected.reveal.explanation, '');
    assert.equal(projected.reveal.reason, { end: 'host_ended', leave: 'player_left', kick: 'player_removed' }[action]);
    assert.ok(projected.reveal.results.every(result => result.value === null && result.points === 0));
    assert.ok(projected.leaderboard.every(row => row.points === 0 && row.opportunities === 0 && row.rank === null));
    if (action === 'leave') assert.equal(replayLeft(room, members[1].token, cmd), true);
  }
});

test('Quiz lobby removal locks new admission until an explicit host unlock', () => {
  let { room, members } = fixture();
  const removed = members[1], original = structuredClone(room);
  room = act(room, 'host', 'kick', { playerId: removed.memberId });
  assert.equal(original.joinLocked, false); assert.equal(original.players.length, 2);
  assert.equal(room.joinLocked, true); assert.equal(room.players.length, 1);
  assert.throws(() => identify(room, removed.token), { code: 'unauthorized' });
  assert.equal(identify(room, members[0].token), members[0].memberId);
  assert.throws(() => joinRoom(room, { nickname: 'Another name', acceptRoomSharing: true }, { now: timestamp }), { code: 'room_locked' });
  room = act(room, 'host', 'lock', { locked: false });
  const replacement = joinRoom(room, { nickname: 'Bo', acceptRoomSharing: true }, { now: timestamp });
  assert.notEqual(replacement.memberId, removed.memberId);
  assert.throws(() => identify(replacement.room, removed.token), { code: 'unauthorized' });
});

test('Quiz removal preserves earned points, prevents rematch readmission and cannot replay into an unlock', () => {
  let { room, members } = fixture(); room = act(room, 'host', 'start');
  for (const member of members) room = act(room, member.memberId, 'quiz-answer', { value: room.quizSnapshot.questions[0].correctAnswer });
  room = act(room, 'host', 'next');
  const kick = command(room, 'kick', { playerId: members[1].memberId });
  room = reduceRoom(room, 'host', kick, { now: timestamp }).room;
  assert.equal(room.joinLocked, true); assert.equal(room.completion, 'incomplete');
  assert.equal(room.scores[members[0].memberId].points, 1000);
  const beforeRetry = structuredClone(room), retry = reduceRoom(room, 'host', kick, { now: timestamp });
  assert.equal(retry.replayed, true); assert.deepEqual(retry.room, beforeRetry);
  const remaining = room.players.map(player => player.id);
  room = act(room, 'host', 'rematch');
  assert.equal(room.joinLocked, true); assert.deepEqual(room.players.map(player => player.id), remaining);
  assert.deepEqual(room.scores, {});
  assert.throws(() => joinRoom(room, { nickname: 'Bo', acceptRoomSharing: true }, { now: timestamp }), { code: 'room_locked' });
  room = act(room, 'host', 'lock', { locked: false });
  const unlocked = structuredClone(room), replay = reduceRoom(room, 'host', kick, { now: timestamp });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.room, unlocked);
  assert.throws(() => reduceRoom(room, 'host', { ...kick, playerId: members[0].memberId }, { now: timestamp }), { code: 'request_conflict' });
  const joined = joinRoom(replay.room, { nickname: 'Bo', acceptRoomSharing: true }, { now: timestamp });
  assert.notEqual(joined.memberId, members[1].memberId); assert.equal(joined.room.players.length, 2);
});

test('Quiz participants cannot use host controls or change room admission', () => {
  let { room, members } = fixture(); room = act(room, 'host', 'start');
  const original = structuredClone(room), actor = members[0].memberId;
  for (const action of ['start', 'next', 'pause', 'resume', 'skip', 'quiz-reveal', 'end', 'rematch', 'close']) assert.throws(() => act(room, actor, action), { code: 'forbidden' }, action);
  assert.throws(() => act(room, actor, 'kick', { playerId: members[1].memberId }), { code: 'forbidden' });
  for (const locked of [false, true]) assert.throws(() => act(room, actor, 'lock', { locked }), { code: 'forbidden' });
  assert.deepEqual(room, original);
});

test('All thirty questions can complete at 30000 points with shared tied ranks', () => {
  const quiz = sampleQuizDocument();
  quiz.questions = Array.from({ length: 30 }, () => ({ ...structuredClone(quiz.questions[0]), id: randomUUID() }));
  let { room, members } = fixture(quiz); room = act(room, 'host', 'start');
  while (room.phase !== 'finished') {
    for (const player of members) room = act(room, player.memberId, 'quiz-answer', { value: quiz.questions[room.round.index - 1].correctAnswer });
    room = act(room, 'host', 'next');
  }
  assert.ok(view(room).leaderboard.every(row => row.points === 30_000 && row.opportunities === 30 && row.accuracy === 100 && row.rank === 1));
});

test('Storage v3 restart preserves quiz snapshot, deadline and exact answer receipt without another score', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-quiz-storage-'));
  const sqlitePath = join(directory, 'rooms.sqlite'), stores = [];
  t.after(async () => { for (const store of stores) await store.close(); await rm(directory, { recursive: true, force: true }); });
  const open = async () => { const store = await openStore({ sqlitePath, databaseURL: '', production: false, now: () => timestamp }); stores.push(store); return store; };
  let store = await open(); let { room, host, members } = fixture(); await store.create(room);
  const transact = async (token, cmd) => store.transactCommand(room.code, { requestId: cmd.requestId, fingerprint: commandFingerprint(cmd), maxReceipts: 1000, authorize(value) { return { actorId: identify(value, token), scope: 'active' }; } }, (value, receiptContext) => {
    const result = reduceRoom(value, receiptContext.actorId, cmd, { now: timestamp, receiptContext });
    return { room: result.room, changed: !result.replayed, recordReceipt: result.recordReceipt, value: result.replayed };
  });
  room = (await transact(host.token, command(room, 'start'))).room;
  const deadline = room.round.deadline, snapshot = structuredClone(room.quizSnapshot);
  const answer = command(room, 'quiz-answer', { value: snapshot.questions[0].correctAnswer });
  room = (await transact(members[0].token, answer)).room;
  await store.close(); store = await open();
  const retry = await transact(members[0].token, answer);
  assert.equal(retry.value, true); room = retry.room;
  assert.equal(room.round.deadline, deadline); assert.deepEqual(room.quizSnapshot, snapshot); assert.equal(room.receiptCount, 2);
  room = (await transact(host.token, command(room, 'quiz-reveal'))).room;
  assert.equal(room.scores[members[0].memberId].points, 1000);
  assert.equal((await transact(members[0].token, answer)).room.scores[members[0].memberId].points, 1000);
  await transact(host.token, command(room, 'close'));
  for (const table of ['likerts_live_rooms', 'likerts_live_command_receipts', 'likerts_live_members', 'likerts_live_socket_leases']) assert.equal(store.database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0, table);
});
