import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { commandFingerprint, createQuizRoom, createRoom, identify, joinRoom, project, reduceRoom, validateCatalogue } from '../server/engine.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';

const catalogue = validateCatalogue(JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8')));
const timestamp = 1_793_923_200_000;
const roundActions = new Set(['answer', 'guess', 'quiz-answer', 'quiz-reveal', 'next', 'pause', 'resume', 'skip']);
const command = (room, action, extra = {}) => ({
  requestId: randomUUID(), matchId: room.matchId,
  ...(roundActions.has(action) && room.round ? { roundId: room.round.id } : {}), action, ...extra,
});
const reduce = (room, actor, body) => reduceRoom(room, actor, body, { catalogue, now: timestamp });
const act = (room, actor, action, extra = {}) => reduce(room, actor, command(room, action, extra)).room;
const view = (room, actor = 'host') => project(room, actor, { catalogue, now: timestamp });

function lobby(mode) {
  let room = mode === 'quiz'
    ? createQuizRoom(sampleQuizDocument(), { capacity: 12 }, { now: timestamp }).room
    : createRoom({ capacity: 12, answerSeconds: 0, predictSeconds: 0 }, { catalogue, now: timestamp }).room;
  const members = [];
  for (const nickname of ['Ari', 'Bo', 'Cam']) {
    const admission = joinRoom(room, { nickname, acceptRoomSharing: true }, { now: timestamp });
    room = admission.room;
    members.push({ id: admission.memberId, token: admission.token });
  }
  return { room, members };
}

function rejectUnchanged(room, actor, body, code, status) {
  const before = structuredClone(room), originalCommand = structuredClone(body);
  assert.throws(() => reduce(room, actor, body), { code, status });
  assert.deepEqual(room, before, 'Rejected actions preserve every room field, including avatars, rosters, points and receipts');
  assert.deepEqual(body, originalCommand, 'Rejected actions do not rewrite the caller’s command');
}

function replayUnchanged(room, actor, body) {
  const before = structuredClone(room), result = reduce(room, actor, body);
  assert.equal(result.replayed, true);
  assert.equal(result.closed, false);
  assert.equal(result.recordReceipt, false);
  assert.deepEqual(result.room, before, 'An exact receipt returns current state without reverting avatars, rosters, points or revision');
  assert.deepEqual(room, before, 'Receipt replay preserves its input');
  return result.room;
}

function revealCurrentRound(room, members) {
  assert.equal(room.phase, 'answer');
  if (room.mode === 'quiz') {
    const correct = room.quizSnapshot.questions[room.round.index - 1].correctAnswer;
    for (const member of members) room = act(room, member.id, 'quiz-answer', { value: correct });
  } else {
    const subject = room.round.subjectId;
    room = act(room, subject, 'answer', { value: 4 });
    for (const member of members.filter(member => member.id !== subject)) room = act(room, member.id, 'guess', { value: 4 });
  }
  assert.equal(room.phase, 'reveal');
  assert.ok(Object.values(room.scores).some(score => score.points > 0), 'Replay coverage includes real scored state');
  return room;
}

for (const mode of ['mind-reading', 'quiz']) {
  test(`${mode}: a player can select every existing avatar without changing peers or gameplay`, () => {
    let { room, members } = lobby(mode);
    const actor = members[0].id;
    for (const value of [1, 2, 3, 4, 5]) {
      const before = structuredClone(room);
      const body = Object.freeze(command(room, 'choose-avatar', { value, expectedRevision: room.revision }));
      const originalCommand = structuredClone(body), result = reduce(room, actor, body);
      assert.equal(result.replayed, false);
      assert.equal(result.closed, false);
      assert.deepEqual(room, before, 'Selection must not mutate the room supplied to the pure reducer');
      assert.deepEqual(body, originalCommand);
      const expected = structuredClone(before);
      expected.players.find(player => player.id === actor).avatar = value;
      expected.revision++;
      expected.requests[`${actor}:${body.requestId.toLowerCase()}`] = commandFingerprint(body);
      assert.deepEqual(result.room, expected, 'Only the authenticated player’s avatar, revision and receipt change');
      room = result.room;
      for (const recipient of ['host', ...members.map(member => member.id)]) {
        assert.equal(view(room, recipient).players.find(player => player.id === actor).avatar, value);
      }
      for (const member of members) assert.equal(identify(room, member.token), member.id);
    }
  });

  test(`${mode}: locked admission still permits duplicate avatar choices by existing players`, () => {
    let { room, members } = lobby(mode);
    room = act(room, 'host', 'lock', { locked: true });
    const untouched = structuredClone(room.players[2]);
    for (const member of members.slice(0, 2)) room = act(room, member.id, 'choose-avatar', { value: 5 });
    assert.equal(room.joinLocked, true);
    assert.equal(room.phase, 'lobby');
    assert.deepEqual(room.players.slice(0, 2).map(player => player.avatar), [5, 5]);
    assert.deepEqual(room.players[2], untouched);
    assert.deepEqual(room.roster, []);
    assert.deepEqual(room.scores, {});
    assert.equal(room.round, null);
    assert.throws(() => joinRoom(room, { nickname: 'New player', acceptRoomSharing: true }, { now: timestamp }), { code: 'room_locked', status: 409 });
  });

  test(`${mode}: avatar commands reject malformed values, identities, revisions and unsupported fields immutably`, () => {
    const { room, members } = lobby(mode), actor = members[0].id;
    rejectUnchanged(room, actor, command(room, 'choose-avatar'), 'invalid_value', 400);
    for (const value of [undefined, null, false, true, -1, 0, 6, 1.5, '1', [], {}, NaN, Infinity]) {
      rejectUnchanged(room, actor, command(room, 'choose-avatar', { value }), 'invalid_value', 400);
    }
    for (const extra of [
      { roundId: randomUUID() }, { roundId: null }, { roundId: undefined },
      { playerId: members[1].id }, { playerId: undefined }, { locked: false },
      { avatar: 3 }, { nickname: 'Someone else' }, { extra: true },
    ]) rejectUnchanged(room, actor, command(room, 'choose-avatar', { value: 3, ...extra }), 'invalid_command', 400);
    for (const expectedRevision of [-1, 1.5, '1', null, false, NaN, Infinity]) {
      rejectUnchanged(room, actor, command(room, 'choose-avatar', { value: 3, expectedRevision }), 'invalid_revision', 400);
    }
    for (const requestId of ['not-a-uuid', null, undefined]) {
      rejectUnchanged(room, actor, command(room, 'choose-avatar', { value: 3, requestId }), 'invalid_command', 400);
    }
    rejectUnchanged(room, actor, command(room, 'choose-avatar', { value: 3, matchId: 'not-a-match' }), 'invalid_command', 400);
  });

  test(`${mode}: hosts and nonmembers cannot select an avatar or target another player`, () => {
    const { room, members } = lobby(mode);
    rejectUnchanged(room, 'host', command(room, 'choose-avatar', { value: 5 }), 'forbidden', 403);
    rejectUnchanged(room, randomUUID(), command(room, 'choose-avatar', { value: 5 }), 'unauthorized', 401);
    rejectUnchanged(room, members[0].id, command(room, 'choose-avatar', { value: 5, playerId: members[1].id }), 'invalid_command', 400);
  });

  test(`${mode}: fresh avatar choices are rejected throughout every nonlobby phase without altering scores or roster`, () => {
    const fixture = lobby(mode), members = fixture.members;
    let room = act(fixture.room, 'host', 'start');
    const phases = [room];
    if (mode === 'mind-reading') {
      room = act(room, room.round.subjectId, 'answer', { value: 4 });
      phases.push(room);
      for (const member of members.filter(member => member.id !== room.round.subjectId)) room = act(room, member.id, 'guess', { value: 4 });
    } else {
      room = revealCurrentRound(room, members);
    }
    assert.equal(room.phase, 'reveal');
    assert.ok(Object.values(room.scores).some(score => score.points > 0));
    phases.push(room);
    room = act(room, 'host', 'end');
    phases.push(room);
    assert.deepEqual(phases.map(state => state.phase), mode === 'quiz' ? ['answer', 'reveal', 'finished'] : ['answer', 'predict', 'reveal', 'finished']);
    for (const state of phases) {
      rejectUnchanged(state, members[0].id, command(state, 'choose-avatar', { value: 5 }), 'wrong_phase', 409);
    }
  });

  test(`${mode}: selection before Start freezes into the roster and survives a rematch, while Start first rejects a fresh pick`, () => {
    let { room, members } = lobby(mode);
    room = act(room, members[0].id, 'choose-avatar', { value: 5 });
    room = act(room, members[1].id, 'choose-avatar', { value: 4 });
    const chosenPlayers = structuredClone(room.players);
    const frozen = chosenPlayers.map(({ id, nickname, avatar }) => ({ id, nickname, avatar }));
    room = act(room, 'host', 'start');
    assert.deepEqual(room.roster, frozen);
    rejectUnchanged(room, members[0].id, command(room, 'choose-avatar', { value: 2 }), 'wrong_phase', 409);
    room = revealCurrentRound(room, members);
    const scored = structuredClone(room.scores), priorMatch = room.matchId;
    room = act(room, 'host', 'end');
    assert.deepEqual(room.roster, frozen);
    assert.deepEqual(room.scores, scored);
    room = act(room, 'host', 'rematch');
    assert.notEqual(room.matchId, priorMatch);
    assert.equal(room.phase, 'lobby');
    assert.deepEqual(room.players, chosenPlayers, 'Rematch retains every chosen avatar and current membership');
    assert.deepEqual(room.roster, []);
    assert.deepEqual(room.scores, {});
    room = act(room, 'host', 'start');
    assert.deepEqual(room.roster, frozen);
  });

  test(`${mode}: exact old avatar receipts return current state across newer picks, scoring and rematches`, () => {
    let { room, members } = lobby(mode);
    const actor = members[0].id, original = command(room, 'choose-avatar', { value: 5 });
    room = reduce(room, actor, original).room;
    room = act(room, actor, 'choose-avatar', { value: 4 });
    room = replayUnchanged(room, actor, original);
    assert.equal(room.players.find(player => player.id === actor).avatar, 4);
    rejectUnchanged(room, actor, { ...original, value: 2 }, 'request_conflict', 409);
    room = act(room, 'host', 'start');
    room = replayUnchanged(room, actor, original);
    assert.equal(room.roster.find(player => player.id === actor).avatar, 4);
    room = revealCurrentRound(room, members);
    room = replayUnchanged(room, actor, original);
    while (room.phase !== 'finished') {
      if (room.phase === 'answer') room = revealCurrentRound(room, members);
      room = act(room, 'host', 'next');
    }
    assert.equal(room.completion, 'complete');
    room = replayUnchanged(room, actor, original);
    rejectUnchanged(room, actor, { ...original, value: 2 }, 'request_conflict', 409);
    const priorMatch = room.matchId;
    room = act(room, 'host', 'rematch');
    assert.notEqual(room.matchId, priorMatch);
    room = replayUnchanged(room, actor, original);
    rejectUnchanged(room, actor, { ...original, requestId: randomUUID() }, 'stale_match', 409);
    room = act(room, actor, 'choose-avatar', { value: 1 });
    room = replayUnchanged(room, actor, original);
    assert.equal(room.players.find(player => player.id === actor).avatar, 1);
    room = act(room, 'host', 'start');
    room = replayUnchanged(room, actor, original);
    assert.equal(room.roster.find(player => player.id === actor).avatar, 1);
    rejectUnchanged(room, actor, { ...original, value: 2 }, 'request_conflict', 409);
  });

  test(`${mode}: fresh foreign-match commands are rejected and request receipts remain scoped to the authenticated player`, () => {
    let { room, members } = lobby(mode);
    const other = lobby(mode).room;
    rejectUnchanged(room, members[0].id, command(other, 'choose-avatar', { value: 5 }), 'stale_match', 409);
    const shared = command(room, 'choose-avatar', { value: 5 });
    room = reduce(room, members[0].id, shared).room;
    const second = reduce(room, members[1].id, shared);
    assert.equal(second.replayed, false, 'One player’s receipt cannot stand in for another player’s selection');
    room = second.room;
    assert.deepEqual(room.players.slice(0, 2).map(player => player.avatar), [5, 5]);
    assert.equal(room.players[2].avatar, 3);
    room = replayUnchanged(room, members[0].id, shared);
    room = replayUnchanged(room, members[1].id, shared);
    assert.deepEqual(room.roster, []);
    assert.deepEqual(room.scores, {});
  });
}
