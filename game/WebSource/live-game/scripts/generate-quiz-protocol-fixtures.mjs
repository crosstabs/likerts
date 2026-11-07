import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { sampleQuizDocument } from '../web/quiz-document.mjs';

// This schema describes recipient projections only. Private creator uploads
// deliberately use the separate M1 document contract and contain answer keys.
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const nullable = value => ({ anyOf: [value, { type: 'null' }] });
const record = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const liveUUID = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' };
const authoredUUID = { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' };
const text = (minimum, maximum, multiline = false) => ({
  type: 'string', minLength: minimum, maxLength: maximum,
  pattern: multiline ? '^[^\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f]*$' : '^[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]*$',
});
const nickname = text(1, 40);
const choice = nullable(integer(0, 3));
const percentage = nullable({ type: 'number', minimum: 0, maximum: 100 });
const result = record({ playerId: liveUUID, nickname, value: choice, points: { enum: [0, 1000] } });
const round = record({
  id: liveUUID, index: integer(1, 30), total: integer(1, 30), questionId: authoredUUID,
  prompt: text(1, 240, true), answers: { type: 'array', minItems: 2, maxItems: 4, uniqueItems: true, items: text(1, 100) },
  deadline: nullable(integer()), submittedCount: integer(0, 50), eligibleCount: integer(2, 50), ownAnswer: choice,
});
const reveal = {
  ...record({
    correctAnswer: choice, explanation: text(0, 240, true), valid: { type: 'boolean' },
    reason: { enum: ['answered', 'timeout', 'host_revealed', 'host_ended', 'player_left', 'player_removed'] },
    results: { type: 'array', minItems: 2, maxItems: 50, items: result }, groupAccuracy: percentage,
  }),
  allOf: [{
    if: { properties: { valid: { const: true } }, required: ['valid'] },
    then: { properties: { correctAnswer: integer(0, 3), reason: { enum: ['answered', 'timeout', 'host_revealed'] }, groupAccuracy: { type: 'number', minimum: 0, maximum: 100 } } },
    else: { properties: { correctAnswer: { type: 'null' }, explanation: { const: '' }, reason: { enum: ['host_ended', 'player_left', 'player_removed'] }, groupAccuracy: { type: 'null' }, results: { items: { properties: { points: { const: 0 }, value: { type: 'null' } } } } } },
  }],
};
const state = record({
  protocolVersion: { const: 2 }, mode: { const: 'quiz' }, modeVersion: { const: 1 },
  code: { type: 'string', pattern: '^[A-HJ-NP-Z2-9]{6}$' }, matchId: liveUUID, revision: integer(), serverTime: integer(), expiresAt: integer(),
  role: { enum: ['host', 'player'] }, self: record({ id: { anyOf: [{ const: 'host' }, liveUUID] }, nickname }),
  phase: { enum: ['lobby', 'answer', 'reveal', 'finished'] }, joinLocked: { type: 'boolean' }, settings: record({ capacity: integer(2, 50) }), hostConnected: { type: 'boolean' },
  players: { type: 'array', maxItems: 50, items: record({ id: liveUUID, nickname, avatar: integer(1, 5), connected: { type: 'boolean' } }) },
  round: nullable(round), reveal: nullable(reveal),
  leaderboard: { type: 'array', maxItems: 50, items: record({ playerId: liveUUID, nickname, points: integer(0, 30_000), opportunities: integer(0, 30), accuracy: percentage, rank: nullable(integer(1, 50)) }) },
  completion: { enum: [null, 'complete', 'incomplete'] }, notice: nullable(text(1, 1000)),
  quiz: record({ id: authoredUUID, title: text(1, 80), questionCount: integer(1, 30) }),
});
const phase = (value, properties) => ({ if: { properties: { phase: { const: value } }, required: ['phase'] }, then: { properties } });
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:likerts:live:quiz:protocol:v2',
  title: 'Likerts shared quiz v2 recipient state',
  description: 'Strict public projection. Relational constraints (indices, roster identity, score arithmetic and deadlines) are also enforced by client validators and reducer tests.',
  ...state,
  allOf: [
    phase('lobby', { round: { type: 'null' }, reveal: { type: 'null' }, completion: { type: 'null' } }),
    phase('answer', { round: { type: 'object' }, reveal: { type: 'null' }, completion: { type: 'null' } }),
    phase('reveal', { round: { type: 'object' }, reveal: { type: 'object' }, completion: { type: 'null' } }),
    phase('finished', { round: { type: 'object' }, reveal: { type: 'object' }, completion: { enum: ['complete', 'incomplete'] } }),
    {
      if: { properties: { role: { const: 'host' } }, required: ['role'] },
      then: { properties: { self: { properties: { id: { const: 'host' } } }, round: { anyOf: [{ type: 'null' }, { type: 'object', properties: { ownAnswer: { type: 'null' } } }] } } },
      else: { properties: { self: { properties: { id: liveUUID } } } },
    },
    {
      if: { properties: { completion: { const: 'complete' } }, required: ['completion'] },
      then: { properties: { leaderboard: { items: { properties: { rank: integer(1, 50) } } } } },
      else: { properties: { leaderboard: { items: { properties: { rank: { type: 'null' } } } } } },
    },
    {
      if: { properties: { reveal: { type: 'object', properties: { valid: { const: false } }, required: ['valid'] } }, required: ['reveal'] },
      then: { properties: { round: { properties: { ownAnswer: { type: 'null' } } } } },
    },
    ...[2, 3].map(count => ({
      if: { properties: { round: { type: 'object', properties: { answers: { maxItems: count } } } }, required: ['round'] },
      then: { properties: { round: { properties: { ownAnswer: nullable(integer(0, count - 1)) } }, reveal: { anyOf: [{ type: 'null' }, { type: 'object', properties: { correctAnswer: nullable(integer(0, count - 1)), results: { items: { properties: { value: nullable(integer(0, count - 1)) } } } } }] } } },
    })),
  ],
};

await mkdir(new URL('../server/fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('../server/quiz-protocol.schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');
if (process.argv.includes('--schema-only')) {
  console.log('Generated strict quiz recipient schema; fixtures were not changed.');
} else {
  const { createQuizRoom, joinRoom, project, reduceRoom, advance, validateCatalogue } = await import('../server/engine.mjs');
  const catalogue = validateCatalogue(JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8')));
  const initialTime = Date.UTC(2026, 10, 7), ids = [];
  let now = initialTime, sequence = 1;
  const uuid = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
  const quiz = sampleQuizDocument();
  quiz.questions[2].timeLimitSeconds = 0;
  let room = createQuizRoom(quiz, { capacity: 12 }, { code: 'ABCDEF', token: 'A'.repeat(43), catalogue, now }).room;
  room.instanceId = uuid(); room.matchId = uuid();
  for (const [index, name] of ['Ari', 'Bo', 'Cam'].entries()) {
    const joined = joinRoom(room, { nickname: name, acceptRoomSharing: true }, { token: String.fromCharCode(66 + index).repeat(43), now });
    room = joined.room;
    const id = uuid(); room.players.find(player => player.id === joined.memberId).id = id; ids.push(id);
  }
  const view = actor => project(room, actor, { catalogue, now });
  const states = { lobbyHost: view('host'), lobbyPlayer: view(ids[0]) };
  function action(actor, action, extra = {}) {
    const oldRound = room.round?.id, oldMatch = room.matchId;
    room = reduceRoom(room, actor, { requestId: uuid(), matchId: room.matchId, ...(room.round ? { roundId: room.round.id } : {}), action, ...extra }, { catalogue, now }).room;
    if (room.matchId !== oldMatch) room.matchId = uuid();
    if (room.round && room.round.id !== oldRound) room.round.id = uuid();
  }
  action('host', 'start');
  states.answerHost = view('host'); states.answerPlayer = view(ids[0]);
  action(ids[0], 'quiz-answer', { value: 1 });
  states.answeredPlayer = view(ids[0]); states.waitingOtherPlayer = view(ids[1]);
  action(ids[1], 'quiz-answer', { value: 0 }); action(ids[2], 'quiz-answer', { value: 1 });
  states.revealHost = view('host'); states.revealPlayer = view(ids[0]);
  action('host', 'next'); action(ids[0], 'quiz-answer', { value: 1 });
  now = room.round.deadline;
  advance(room, now);
  states.timeoutHost = view('host'); states.timeoutPlayer = view(ids[1]);
  action('host', 'next');
  states.untimedHost = view('host'); states.untimedPlayer = view(ids[0]);
  action(ids[0], 'quiz-answer', { value: 2 }); action('host', 'quiz-reveal');
  states.earlyRevealHost = view('host');
  action('host', 'next');
  states.finishedHost = view('host'); states.finishedPlayer = view(ids[0]); states.finished = states.finishedHost;
  action('host', 'rematch'); states.rematchLobby = view('host');
  action('host', 'start'); action(ids[0], 'quiz-answer', { value: 1 }); action('host', 'end');
  states.incompleteHost = view('host'); states.incompletePlayer = view(ids[0]);
  action('host', 'rematch'); action('host', 'start'); action(ids[0], 'quiz-answer', { value: 1 }); action(ids[2], 'leave');
  states.playerLeftHost = view('host'); states.playerLeftPlayer = view(ids[0]);
  action('host', 'rematch'); action('host', 'start'); action(ids[0], 'quiz-answer', { value: 1 }); action('host', 'kick', { playerId: ids[1] });
  states.playerRemovedHost = view('host'); states.playerRemovedPlayer = view(ids[0]);
  const fixtures = {
    note: 'Deterministic synthetic examples generated from actual quiz reducer projections. No running room or production capability exists. Creator createRequest includes its answer key; recipient states omit undisclosed keys and future questions.',
    createRequest: { admissionId: uuid(), recoverySecret: 'E'.repeat(43), mode: 'quiz', modeVersion: 1, quiz, settings: { capacity: 12 } },
    joinRequest: { admissionId: uuid(), recoverySecret: 'F'.repeat(43), nickname: 'Ari', acceptRoomSharing: true },
    authenticateFrame: { type: 'authenticate', code: 'ABCDEF', token: 'G'.repeat(43) },
    recoverRequest: { admissionId: uuid(), recoverySecret: 'H'.repeat(43) },
    actionRequest: { requestId: uuid(), matchId: states.answerPlayer.matchId, roundId: states.answerPlayer.round.id, action: 'quiz-answer', value: 1 },
    revealRequest: { requestId: uuid(), matchId: states.untimedHost.matchId, roundId: states.untimedHost.round.id, action: 'quiz-reveal' },
    closeResponse: { state: null, closed: true }, leaveResponse: { state: null, left: true },
    errorResponse: { error: { code: 'stale_round', message: 'Refresh the current round before trying again.' } }, states,
  };
  await writeFile(new URL('../server/fixtures/quiz-protocol-v2.json', import.meta.url), JSON.stringify(fixtures, null, 2) + '\n');
  console.log(`Generated ${Object.keys(states).length} deterministic actual quiz projections and strict state schema.`);
}
