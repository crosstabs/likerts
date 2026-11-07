import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRoom, joinRoom, project, reduceRoom, validateCatalogue } from '../server/engine.mjs';

const catalogue = validateCatalogue(JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8')));
const now = Date.UTC(2026, 10, 6);
let room = createRoom({ answerSeconds: 0, predictSeconds: 0 }, { catalogue, now, code: 'ABCDEF' }).room;
const ids = [];
for (const nickname of ['Ari', 'Bo', 'Cam']) { const joined = joinRoom(room, { nickname, acceptRoomSharing: true }, { now }); room = joined.room; ids.push(joined.memberId); }
const states = { lobbyHost: project(room, 'host', { catalogue, now }), lobbyPlayer: project(room, ids[0], { catalogue, now }) };
function action(actor, action, extra = {}) {
  room = reduceRoom(room, actor, { requestId: randomUUID(), matchId: room.matchId, ...(room.round ? { roundId: room.round.id } : {}), action, ...extra }, { catalogue, now }).room;
}
action('host', 'start');
states.answerHost = project(room, 'host', { catalogue, now });
states.answerSubject = project(room, room.round.subjectId, { catalogue, now });
action(room.round.subjectId, 'answer', { value: 4 });
states.predictHost = project(room, 'host', { catalogue, now });
states.predictSubject = project(room, room.round.subjectId, { catalogue, now });
const predictors = ids.filter(id => id !== room.round.subjectId);
action(predictors[0], 'guess', { value: 3 });
states.predictGuest = project(room, predictors[0], { catalogue, now });
states.predictOtherGuest = project(room, predictors[1], { catalogue, now });
action(predictors[1], 'guess', { value: 4 });
states.revealHost = project(room, 'host', { catalogue, now });
while (room.phase !== 'finished') {
  action('host', 'next');
  if (room.phase === 'finished') break;
  action(room.round.subjectId, 'answer', { value: 4 });
  for (const id of ids.filter(id => id !== room.round.subjectId)) action(id, 'guess', { value: 4 });
}
states.finishedHost = project(room, 'host', { catalogue, now });
const fixtures = {
  note: 'Synthetic local protocol examples generated from the actual reducer; not a running room or valid production credential.',
  createRequest: { admissionId: randomUUID(), recoverySecret: 'A'.repeat(43), settings: { topic: 'mix', cycles: 1, capacity: 12, answerSeconds: 60, predictSeconds: 60 } },
  joinRequest: { admissionId: randomUUID(), recoverySecret: 'B'.repeat(43), nickname: 'Ari', acceptRoomSharing: true },
  authenticateFrame: { type: 'authenticate', code: 'ABCDEF', token: 'C'.repeat(43) },
  recoverRequest: { admissionId: randomUUID(), recoverySecret: 'D'.repeat(43) },
  actionRequest: { requestId: randomUUID(), matchId: states.answerSubject.matchId, roundId: states.answerSubject.round.id, action: 'answer', value: 4 },
  closeResponse: { state: null, closed: true }, leaveResponse: { state: null, left: true },
  errorResponse: { error: { code: 'stale_round', message: 'Refresh the current round before trying again.' } }, states,
};
const string = { type: 'string' }, integer = { type: 'integer', minimum: 0 }, nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const record = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const choice = nullable({ type: 'integer', minimum: 1, maximum: 5 });
const settings = record({ topic: string, cycles: { enum: [1, 2, 3] }, capacity: { type: 'integer', minimum: 2, maximum: 50 }, answerSeconds: { enum: [0, 30, 60, 120] }, predictSeconds: { enum: [0, 30, 60, 120] } });
const state = record({
  protocolVersion: { const: 1 }, code: { type: 'string', pattern: '^[A-HJ-NP-Z2-9]{6}$' }, matchId: { type: 'string', format: 'uuid' }, revision: integer, serverTime: integer, expiresAt: integer,
  catalogVersion: { const: 1 }, catalogHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, role: { enum: ['host', 'player'] }, self: record({ id: string, nickname: string }),
  phase: { enum: ['lobby', 'answer', 'predict', 'reveal', 'finished'] }, joinLocked: { type: 'boolean' }, settings, hostConnected: { type: 'boolean' },
  players: { type: 'array', maxItems: 50, items: record({ id: string, nickname: string, avatar: { type: 'integer', minimum: 1, maximum: 5 }, connected: { type: 'boolean' } }) },
  round: nullable(record({ id: { type: 'string', format: 'uuid' }, index: { type: 'integer', minimum: 1 }, total: { type: 'integer', minimum: 2, maximum: 150 }, subjectId: string, subjectName: string, prompt: record({ id: integer, text: string, topic: string, sceneSummary: string }), deadline: nullable(integer), paused: { type: 'boolean' }, answerLocked: { type: 'boolean' }, submittedCount: integer, eligibleCount: integer, ownAnswer: choice, ownGuess: choice })),
  reveal: nullable(record({ answer: choice, valid: { type: 'boolean' }, reason: string, guesses: { type: 'array', items: record({ playerId: string, nickname: string, value: choice, points: { type: 'integer', minimum: 0, maximum: 100 } }) }, groupAccuracy: nullable({ type: 'number', minimum: 0, maximum: 100 }) })),
  leaderboard: { type: 'array', items: record({ playerId: string, nickname: string, points: integer, opportunities: integer, accuracy: nullable({ type: 'number', minimum: 0, maximum: 100 }), rank: nullable({ type: 'integer', minimum: 1, maximum: 50 }) }) },
  completion: { enum: [null, 'complete', 'incomplete'] }, notice: nullable(string),
});
const catalogueMetadata = {
  type: 'object', additionalProperties: false, required: ['version', 'sha256', 'locale', 'topics'],
  properties: {
    version: { const: 1 }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, locale: { const: 'en' },
    topics: { type: 'array', items: record({ id: string, title: string }) },
    limits: record({ maxPlayers: { type: 'integer', minimum: 2, maximum: 50 }, defaultCapacity: { type: 'integer', minimum: 2, maximum: 12 } }),
  },
};
await mkdir(new URL('../server/fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('../server/fixtures/protocol-v1.json', import.meta.url), JSON.stringify(fixtures, null, 2) + '\n');
await writeFile(new URL('../server/protocol.schema.json', import.meta.url), JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:likerts:live:protocol:v1', title: 'Likerts Live v1 projected state', ...state, $defs: { catalogueMetadata } }, null, 2) + '\n');
console.log(`Generated ${Object.keys(states).length} actual projected-state fixtures and the strict state schema.`);
