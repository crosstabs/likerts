import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryConversationStore, ConversationStoreError } from './conversation-store.js';

const context = {
  evidenceHash: 'a'.repeat(64), populationFrameHash: 'b'.repeat(64), researchDesignHash: 'c'.repeat(64), modelCardHash: 'd'.repeat(64),
  evidenceIds: ['e1'], assumptionIds: ['a1'], unsupportedCharacteristics: ['income'],
};
const input = (id = 'conversation_1', overrides = {}) => ({
  id, projectId: 'project_1', studyId: 'study_1', runId: 'run_1', segmentId: 'segment_1', frozenContext: context,
  retention: { mode: 'SESSION' }, ...overrides,
});
const userTurn = { id: 'turn_1', role: 'user', text: 'What would change your mind?', intent: 'FOLLOW_UP', parentTurnId: null };
const assistantTurn = { id: 'turn_2', role: 'assistant', text: 'Model-generated perspective for planning.', evidenceRefs: ['e1'], assumptionRefs: ['a1'], disclosure: 'Model-generated perspective—not a participant quotation.' };

test('conversation store creates, appends, reloads in order, and exposes immutable disclosure', async () => {
  const store = createMemoryConversationStore();
  const created = await store.createConversation(input());
  assert.equal(created.version, 1);
  assert.equal(created.turns.length, 0);
  assert.equal(created.disclosure, 'Model-generated perspective—not a participant quotation.');
  await store.appendTurn('conversation_1', { expectedTurnIndex: 0, parentTurnId: null, turn: userTurn });
  await store.appendTurn('conversation_1', { expectedTurnIndex: 1, parentTurnId: 'turn_1', turn: assistantTurn });
  const loaded = await store.getConversation('conversation_1');
  assert.deepEqual(loaded.turns.map((turn) => turn.id), ['turn_1', 'turn_2']);
  assert.equal(loaded.turns[1].disclosure, 'Model-generated perspective—not a participant quotation.');
});

test('stores and validates parent links across a four-turn append-only chain', async () => {
  const store = createMemoryConversationStore();
  await store.createConversation(input());
  await store.appendTurn('conversation_1', { expectedTurnIndex: 0, parentTurnId: null, turn: userTurn });
  await store.appendTurn('conversation_1', { expectedTurnIndex: 1, parentTurnId: 'turn_1', turn: assistantTurn });
  await store.appendTurn('conversation_1', { expectedTurnIndex: 2, parentTurnId: 'turn_2', turn: { id: 'turn_3', role: 'user', text: 'And if the price changed?', intent: 'COUNTERFACTUAL' } });
  await store.appendTurn('conversation_1', { expectedTurnIndex: 3, parentTurnId: 'turn_3', turn: { ...assistantTurn, id: 'turn_4' } });
  const turns = (await store.getConversation('conversation_1')).turns;
  assert.deepEqual(turns.map((turn) => turn.parentTurnId), [null, 'turn_1', 'turn_2', 'turn_3']);
});

test('stale writes produce typed conflicts and do not mutate the chain', async () => {
  const store = createMemoryConversationStore();
  await store.createConversation(input());
  await store.appendTurn('conversation_1', { expectedTurnIndex: 0, parentTurnId: null, turn: userTurn });
  await assert.rejects(() => store.appendTurn('conversation_1', { expectedTurnIndex: 0, parentTurnId: null, turn: { ...userTurn, id: 'turn_other' } }), (error) => error instanceof ConversationStoreError && error.code === 'CONFLICT');
  assert.deepEqual((await store.getConversation('conversation_1')).turns.map((turn) => turn.id), ['turn_1']);
});

test('rejects tampered chain, unknown evidence, and malformed hashes', async () => {
  const store = createMemoryConversationStore();
  await assert.rejects(() => store.createConversation(input('bad_hash', { frozenContext: { ...context, evidenceHash: 'bad' } })), (error) => error.code === 'VALIDATION');
  await store.createConversation(input());
  await assert.rejects(() => store.appendTurn('conversation_1', { expectedTurnIndex: 1, parentTurnId: 'wrong', turn: assistantTurn }), (error) => error.code === 'CONFLICT');
  await assert.rejects(() => store.appendTurn('conversation_1', { expectedTurnIndex: 0, parentTurnId: 'wrong', turn: { ...userTurn, id: 'turn_bad', text: 'contains raw text that must not appear in an error' } }), (error) => error.code === 'CONFLICT' && !error.message.includes('contains raw text'));
  await store.appendTurn('conversation_1', { expectedTurnIndex: 0, parentTurnId: null, turn: userTurn });
  await assert.rejects(() => store.appendTurn('conversation_1', { expectedTurnIndex: 1, parentTurnId: 'turn_1', turn: { ...assistantTurn, id: 'turn_3', evidenceRefs: ['unknown'] } }), (error) => error.code === 'VALIDATION');
  await assert.rejects(() => store.appendTurn('conversation_1', { expectedTurnIndex: 1, parentTurnId: 'turn_1', turn: { ...assistantTurn, id: 'turn_4', evidenceRefs: ['a1'] } }), (error) => error.code === 'VALIDATION');
});

test('rejects duplicate or overlapping frozen evidence and assumption IDs', async () => {
  const store = createMemoryConversationStore();
  await assert.rejects(() => store.createConversation(input('duplicate_ids', { frozenContext: { ...context, evidenceIds: ['e1', 'e1'] } })), (error) => error.code === 'VALIDATION');
  await assert.rejects(() => store.createConversation(input('overlap_ids', { frozenContext: { ...context, assumptionIds: ['a1', 'e1'] } })), (error) => error.code === 'VALIDATION');
});

test('supports list metadata redaction and expiry/delete lifecycle', async () => {
  let now = new Date('2030-01-01T00:00:00.000Z');
  const store = createMemoryConversationStore({ now: () => now.toISOString() });
  await store.createConversation(input('conversation_ttl', { retention: { mode: 'TTL', expiresAt: '2030-01-02T00:00:00.000Z' } }));
  await store.createConversation(input('conversation_keep'));
  const metadata = await store.listConversations({ metadataOnly: true });
  assert.equal(metadata.length, 2);
  assert.equal('turns' in metadata[0], false);
  now = new Date('2030-01-03T00:00:00.000Z');
  await assert.rejects(() => store.getConversation('conversation_ttl'), (error) => error.code === 'GONE');
  assert.deepEqual((await store.listConversations()).map((conversation) => conversation.id), ['conversation_keep']);
  assert.equal(await store.deleteConversation('conversation_keep'), true);
  await assert.rejects(() => store.getConversation('conversation_keep'), (error) => error.code === 'NOT_FOUND');
});

test('missing conversation and invalid operations expose controlled codes without raw content', async () => {
  const store = createMemoryConversationStore();
  await assert.rejects(() => store.getConversation('missing'), (error) => error.code === 'NOT_FOUND' && !error.message.includes('missing'));
  await assert.rejects(() => store.createConversation(input('conversation bad', { projectId: 'raw secret text' })), (error) => error.code === 'VALIDATION' && !error.message.includes('raw secret text'));
});
