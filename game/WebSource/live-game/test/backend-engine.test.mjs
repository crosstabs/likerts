import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { advance, createRoom, identify, joinRoom, normalizeNickname, project, reduceRoom, replayLeft, validateCatalogue, validateCommand, validateSettings } from '../server/engine.mjs';

const catalogue = validateCatalogue(JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8')));
const timestamp = 1_793_923_200_000;
function lobby(settings = {}, count = 3) {
  let room = createRoom({ answerSeconds: 0, predictSeconds: 0, ...settings }, { catalogue, now: timestamp }).room;
  const members = [];
  for (let i = 0; i < count; i++) { const joined = joinRoom(room, { nickname: `Player ${i + 1}`, acceptRoomSharing: true }, { now: timestamp }); room = joined.room; members.push({ id: joined.memberId, token: joined.token }); }
  return { room, members };
}
const command = (room, action, extra = {}) => ({ requestId: randomUUID(), matchId: room.matchId, ...(room.round ? { roundId: room.round.id } : {}), action, ...extra });
const act = (room, actor, action, extra = {}, now = timestamp) => reduceRoom(room, actor, command(room, action, extra), { catalogue, now }).room;
const view = (room, actor) => project(room, actor, { catalogue, now: timestamp });

test('Reviewed catalogue checksum and canonical settings are mandatory', () => {
  assert.equal(catalogue.rounds.length, 1000);
  assert.throws(() => validateCatalogue({ ...catalogue, sha256: '0'.repeat(64) }), /checksum/);
  assert.equal(validateSettings({}, catalogue).capacity, 12);
  for (const value of [{ capacity: 51 }, { cycles: 4 }, { topic: 'custom' }, { answerSeconds: 1 }, { private: true }]) assert.throws(() => validateSettings(value, catalogue), { code: 'invalid_settings' });
});

test('Nickname normalization is Unicode-aware and excludes HTML, controls, bidi and collisions', () => {
  assert.equal(normalizeNickname('  Ａri  '), 'Ari');
  assert.equal(normalizeNickname('Zoë'), 'Zoë');
  for (const value of ['<script>', 'Bo\nCam', 'A\u202eB', ' '.repeat(3), 'x'.repeat(21), '\u0301']) assert.throws(() => normalizeNickname(value), { code: 'invalid_nickname' });
  const { room } = lobby();
  assert.throws(() => joinRoom(room, { nickname: 'PLAYER 1', acceptRoomSharing: true }), { code: 'nickname_taken' });
});

test('Private answers are metamorphically invisible to host and every unrelated player', () => {
  const { room: initial, members } = lobby();
  const room = act(initial, 'host', 'start'), subject = room.round.subjectId;
  const cmd = command(room, 'answer', { value: 1 });
  const one = reduceRoom(room, subject, cmd, { catalogue, now: timestamp }).room;
  const five = reduceRoom(room, subject, { ...cmd, value: 5 }, { catalogue, now: timestamp }).room;
  assert.deepEqual(view(one, 'host'), view(five, 'host'));
  for (const { id } of members.filter(member => member.id !== subject)) assert.deepEqual(view(one, id), view(five, id));
  assert.equal(view(one, subject).round.ownAnswer, 1);
  assert.equal(view(five, subject).round.ownAnswer, 5);
  assert.equal(room.round.answer, null, 'The pure reducer preserves the prior state');
});

test('Private predictions are metamorphically invisible at the same submitted count', () => {
  const { room: initial, members } = lobby();
  let room = act(initial, 'host', 'start');
  room = act(room, room.round.subjectId, 'answer', { value: 3 });
  const [predictor, other] = members.filter(member => member.id !== room.round.subjectId);
  const cmd = command(room, 'guess', { value: 1 });
  const one = reduceRoom(room, predictor.id, cmd, { catalogue, now: timestamp }).room;
  const five = reduceRoom(room, predictor.id, { ...cmd, value: 5 }, { catalogue, now: timestamp }).room;
  for (const id of ['host', room.round.subjectId, other.id]) assert.deepEqual(view(one, id), view(five, id));
  assert.equal(view(five, predictor.id).round.ownGuess, 5);
  assert.equal(view(one, 'host').reveal, null);
  assert.ok(view(one, 'host').leaderboard.every(row => row.points === 0));
});

test('A complete fixed-roster match gives equal opportunities and shared ranks without a speed bonus', () => {
  let { room, members } = lobby({ cycles: 2 }); room = act(room, 'host', 'start');
  const prompts = new Set(), subjects = [];
  while (room.phase !== 'finished') {
    assert.equal(room.phase, 'answer'); prompts.add(room.round.promptId); subjects.push(room.round.subjectId);
    room = act(room, room.round.subjectId, 'answer', { value: 5 });
    for (const { id } of members.filter(member => member.id !== room.round.subjectId)) room = act(room, id, 'guess', { value: 5 });
    assert.equal(room.phase, 'reveal'); assert.equal(view(room, 'host').reveal.groupAccuracy, 100);
    room = act(room, 'host', 'next');
  }
  const final = view(room, 'host');
  assert.equal(prompts.size, 6); assert.equal(final.completion, 'complete');
  assert.ok(final.leaderboard.every(row => row.opportunities === 4 && row.points === 400 && row.accuracy === 100 && row.rank === 1));
  for (const { id } of members) assert.equal(subjects.filter(subject => subject === id).length, 2);
});

test('Repeated requests cannot change locks or score twice and conflicts/stale bindings are rejected', () => {
  let { room, members } = lobby(); room = act(room, 'host', 'start');
  const answer = command(room, 'answer', { value: 2 }), subject = room.round.subjectId;
  room = reduceRoom(room, subject, answer, { catalogue, now: timestamp }).room;
  assert.equal(reduceRoom(room, subject, answer, { catalogue, now: timestamp }).replayed, true);
  assert.throws(() => reduceRoom(room, subject, { ...answer, value: 4 }, { catalogue, now: timestamp }), { code: 'request_conflict' });
  const predictors = members.filter(member => member.id !== subject);
  for (const { id } of predictors) room = act(room, id, 'guess', { value: 2 });
  const scores = structuredClone(room.scores), old = command(room, 'next');
  room = reduceRoom(room, 'host', old, { catalogue, now: timestamp }).room;
  assert.deepEqual(reduceRoom(room, 'host', old, { catalogue, now: timestamp }).room.scores, scores);
  assert.throws(() => act(room, 'host', 'next', { roundId: old.roundId }), { code: 'stale_round' });
  assert.throws(() => act(room, predictors[0].id, 'skip'), { code: 'forbidden' });
});

test('Pause freezes time, resume restores remaining duration, and subject timeout withholds every secret', () => {
  let { room } = lobby({ answerSeconds: 30, predictSeconds: 30 }); room = act(room, 'host', 'start');
  room = act(room, 'host', 'pause', {}, timestamp + 5000);
  assert.equal(room.round.remainingMs, 25000); assert.equal(advance(room, timestamp + 90_000), false);
  room = act(room, 'host', 'resume', {}, timestamp + 90_000);
  assert.equal(room.round.deadline, timestamp + 115_000);
  assert.equal(advance(room, timestamp + 115_000), true);
  const state = view(room, 'host');
  assert.equal(state.reveal.valid, false); assert.equal(state.reveal.answer, null); assert.ok(state.reveal.guesses.every(guess => guess.value === null));
  assert.ok(state.leaderboard.every(row => row.opportunities === 0));
});

test('Prediction timeout scores misses zero exactly once and skipped matches remain provisional', () => {
  let { room } = lobby({ predictSeconds: 30 }); room = act(room, 'host', 'start');
  room = act(room, room.round.subjectId, 'answer', { value: 4 });
  assert.equal(advance(room, timestamp + 30000), true);
  assert.equal(advance(room, timestamp + 60000), false);
  assert.ok(view(room, 'host').reveal.guesses.every(guess => guess.points === 0 && guess.value === null));
  assert.equal(Object.values(room.scores).reduce((sum, score) => sum + score.opportunities, 0), 2);
  room = act(room, 'host', 'next'); room = act(room, 'host', 'skip'); room = act(room, 'host', 'end');
  assert.equal(view(room, 'host').completion, 'incomplete'); assert.ok(view(room, 'host').leaderboard.every(row => row.rank === null));
});

test('Leave ends an active match without exposing unfinished secrets and its exact receipt remains retryable', () => {
  let { room, members } = lobby(); room = act(room, 'host', 'start');
  room = act(room, room.round.subjectId, 'answer', { value: 5 });
  const leaver = members.find(member => member.id !== room.round.subjectId), leave = command(room, 'leave');
  room = reduceRoom(room, leaver.id, leave, { catalogue, now: timestamp }).room;
  assert.equal(view(room, 'host').completion, 'incomplete'); assert.equal(view(room, 'host').reveal.answer, null);
  assert.equal(replayLeft(room, leaver.token, leave), true);
  assert.equal(replayLeft(room, leaver.token, { ...leave, action: 'heartbeat' }), false);
  assert.throws(() => view(room, leaver.id), { code: 'unauthorized' });
});

test('Rematch avoids presented prompts and preserves old request conflicts without replaying old mutations', () => {
  let { room } = lobby(); room = act(room, 'host', 'start'); const first = room.round.promptId;
  const end = command(room, 'end'); room = reduceRoom(room, 'host', end, { catalogue, now: timestamp }).room;
  const oldMatch = room.matchId; room = act(room, 'host', 'rematch'); assert.notEqual(room.matchId, oldMatch);
  assert.equal(reduceRoom(room, 'host', end, { catalogue, now: timestamp }).replayed, true);
  assert.throws(() => act(room, 'host', 'start', { matchId: oldMatch }), { code: 'stale_match' });
  room = act(room, 'host', 'start'); assert.notEqual(room.round.promptId, first);
});

test('Capacity reaches 50 players, topic exhaustion resets only after all 50 reviewed prompts', () => {
  let { room } = lobby({ capacity: 50, cycles: 3, topic: catalogue.topics[0].id }, 50);
  assert.throws(() => joinRoom(room, { nickname: 'Overflow', acceptRoomSharing: true }), { code: 'room_full' });
  room = act(room, 'host', 'start'); assert.equal(room.totalRounds, 150);
  const seen = new Set();
  for (let i = 0; i < 50; i++) { seen.add(room.round.promptId); room = act(room, 'host', 'skip'); room = act(room, 'host', 'next'); }
  assert.equal(seen.size, 50); assert.equal(room.usedPromptIds.length, 1); assert.ok(seen.has(room.round.promptId));
});

test('Unsupported properties, fractional choices and malformed request identities cannot enter the reducer', () => {
  const { room } = lobby();
  for (const extra of [{ value: 1.1 }, { value: 0 }, { value: 6 }, { value: '3' }, { answer: 4 }]) assert.throws(() => validateCommand(command(room, 'answer', { roundId: randomUUID(), value: 3, ...extra })));
  assert.throws(() => validateCommand({ ...command(room, 'start'), requestId: 'not-a-uuid' }), { code: 'invalid_command' });
});

test('Removing a lobby player atomically locks new admission and revokes only the removed seat', () => {
  const { room: initial, members } = lobby();
  const original = structuredClone(initial), removed = members[0];
  const room = act(initial, 'host', 'kick', { playerId: removed.id });
  assert.deepEqual(initial, original, 'The prior room is unchanged before persistence');
  assert.equal(room.joinLocked, true);
  assert.deepEqual(room.players.map(player => player.id), members.slice(1).map(member => member.id));
  assert.throws(() => identify(room, removed.token), { code: 'unauthorized' });
  for (const member of members.slice(1)) assert.equal(identify(room, member.token), member.id);
  assert.throws(() => joinRoom(room, { nickname: 'Different name', acceptRoomSharing: true }, { now: timestamp }), { code: 'room_locked' });
  assert.equal(view(room, 'host').joinLocked, true);
});

test('Every host control remains forbidden to participants, including removal and unlocking', () => {
  let { room, members } = lobby(); room = act(room, 'host', 'start');
  const before = structuredClone(room);
  for (const actor of members) {
    for (const action of ['start', 'next', 'pause', 'resume', 'skip', 'quiz-reveal', 'end', 'rematch', 'close']) {
      assert.throws(() => act(room, actor.id, action), { code: 'forbidden' }, action);
    }
    assert.throws(() => act(room, actor.id, 'kick', { playerId: members.find(member => member.id !== actor.id).id }), { code: 'forbidden' });
    for (const locked of [false, true]) assert.throws(() => act(room, actor.id, 'lock', { locked }), { code: 'forbidden' });
  }
  assert.deepEqual(room, before);
});

test('Removal stays locked across rematch until the host explicitly allows a fresh admission', () => {
  let { room, members } = lobby(); room = act(room, 'host', 'start');
  const removed = members[0], kick = command(room, 'kick', { playerId: removed.id });
  room = reduceRoom(room, 'host', kick, { catalogue, now: timestamp }).room;
  assert.equal(room.phase, 'finished'); assert.equal(room.completion, 'incomplete');
  assert.equal(room.joinLocked, true);
  const remaining = room.players.map(player => player.id), oldMatch = room.matchId;
  room = act(room, 'host', 'rematch');
  assert.notEqual(room.matchId, oldMatch); assert.equal(room.joinLocked, true);
  assert.deepEqual(room.players.map(player => player.id), remaining, 'Rematch never recreates a removed seat');
  assert.throws(() => joinRoom(room, { nickname: 'Player 1', acceptRoomSharing: true }, { now: timestamp }), { code: 'room_locked' });
  room = act(room, 'host', 'lock', { locked: false });
  const beforeReplay = structuredClone(room), replay = reduceRoom(room, 'host', kick, { catalogue, now: timestamp });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.room, beforeReplay, 'An old removal receipt cannot relock a later lobby');
  room = replay.room;
  const joined = joinRoom(room, { nickname: 'Player 1', acceptRoomSharing: true }, { now: timestamp });
  assert.notEqual(joined.memberId, removed.id); assert.equal(joined.room.players.length, remaining.length + 1);
  assert.throws(() => identify(joined.room, removed.token), { code: 'unauthorized' });
});

test('Rejected removal leaves both admission lock and roster unchanged', () => {
  const { room, members } = lobby(), original = structuredClone(room);
  assert.throws(() => act(room, 'host', 'kick', { playerId: randomUUID() }), { code: 'invalid_player' });
  assert.throws(() => act(room, 'host', 'kick', { playerId: members[0].id, expectedRevision: room.revision + 1 }), { code: 'stale_revision' });
  assert.deepEqual(room, original); assert.equal(room.joinLocked, false);
});

test('Rematch preserves either an explicit room lock or the default unlocked admission', () => {
  for (const locked of [false, true]) {
    let { room } = lobby();
    assert.equal(room.joinLocked, false);
    if (locked) room = act(room, 'host', 'lock', { locked: true });
    room = act(room, 'host', 'start'); room = act(room, 'host', 'end');
    room = act(room, 'host', 'rematch');
    assert.equal(room.joinLocked, locked);
  }
});
