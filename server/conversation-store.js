import { z } from 'zod';
import { retentionPolicySchema } from './privacy-contract.js';

export const CONVERSATION_STORE_VERSION = 'conversation-store-v1';
export const SYNTHETIC_DISCLOSURE = 'Model-generated perspective—not a participant quotation.';

const id = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/i);
const contextSchema = z.object({
  evidenceHash: hash.nullable().default(null), populationFrameHash: hash.nullable().default(null), researchDesignHash: hash.nullable().default(null), modelCardHash: hash.nullable().default(null),
  evidenceIds: z.array(id).max(100).default([]), assumptionIds: z.array(id).max(100).default([]), unsupportedCharacteristics: z.array(z.string().trim().min(1).max(240)).max(30).default([]),
}).strict().superRefine((value, context) => {
  if (new Set(value.evidenceIds).size !== value.evidenceIds.length) context.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'Evidence IDs must be unique.' });
  if (new Set(value.assumptionIds).size !== value.assumptionIds.length) context.addIssue({ code: 'custom', path: ['assumptionIds'], message: 'Assumption IDs must be unique.' });
  if (value.evidenceIds.some((item) => value.assumptionIds.includes(item))) context.addIssue({ code: 'custom', path: ['assumptionIds'], message: 'Evidence and assumption IDs must be disjoint.' });
});
const userTurnSchema = z.object({ id, role: z.literal('user'), text: z.string().trim().min(2).max(2_000), intent: z.enum(['FOLLOW_UP', 'OBJECTION', 'COUNTERFACTUAL', 'CONCEPT_COMPARISON']).default('FOLLOW_UP'), parentTurnId: id.nullable().default(null) }).strict();
const assistantTurnSchema = z.object({ id, role: z.literal('assistant'), text: z.string().trim().min(20).max(4_000), evidenceRefs: z.array(id).max(8).default([]), assumptionRefs: z.array(id).max(8).default([]), parentTurnId: id.nullable().default(null), disclosure: z.literal(SYNTHETIC_DISCLOSURE) }).strict();
const turnSchema = z.discriminatedUnion('role', [userTurnSchema, assistantTurnSchema]);
const conversationSchema = z.object({
  contractVersion: z.literal(CONVERSATION_STORE_VERSION), id, projectId: id, studyId: id, runId: id, segmentId: id,
  frozenContext: contextSchema, turns: z.array(turnSchema).max(14), version: z.number().int().min(1),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }), retention: retentionPolicySchema,
  synthetic: z.literal(true), observedHumanResponse: z.literal(false), disclosure: z.literal(SYNTHETIC_DISCLOSURE),
}).strict();

export class ConversationStoreError extends Error {
  constructor(code, message = 'Conversation operation failed.') { super(message); this.name = 'ConversationStoreError'; this.code = code; }
}
const fail = (code, message) => { throw new ConversationStoreError(code, message); };
const clone = (value) => structuredClone(value);
const safeParse = (value) => { const parsed = conversationSchema.safeParse(value); if (!parsed.success) fail('VALIDATION', 'Conversation record is invalid.'); return parsed.data; };

function validateChain(conversation) {
  for (let index = 0; index < conversation.turns.length; index += 1) {
    const turn = conversation.turns[index];
    if (turn.role !== (index % 2 === 0 ? 'user' : 'assistant')) fail('VALIDATION', 'Conversation turn order is invalid.');
    if (turn.parentTurnId !== (conversation.turns[index - 1]?.id || null)) fail('VALIDATION', 'Conversation parent chain is invalid.');
    if (turn.role === 'assistant' && turn.evidenceRefs.some((ref) => !conversation.frozenContext.evidenceIds.includes(ref))) fail('VALIDATION', 'Conversation references unknown evidence.');
    if (turn.role === 'assistant' && turn.assumptionRefs.some((ref) => !conversation.frozenContext.assumptionIds.includes(ref))) fail('VALIDATION', 'Conversation references unknown assumptions.');
  }
  if (new Set(conversation.turns.map((turn) => turn.id)).size !== conversation.turns.length) fail('VALIDATION', 'Conversation contains duplicate turn IDs.');
  return conversation;
}

export function createMemoryConversationStore(options = {}) {
  const records = new Map();
  const now = options.now || (() => new Date().toISOString());
  const expired = (conversation) => conversation.retention.mode === 'TTL' && Date.parse(conversation.retention.expiresAt) <= Date.parse(now());
  const active = (idValue) => { const record = records.get(idValue); if (record && expired(record)) { records.delete(idValue); return null; } return record; };
  const read = (idValue) => { const record = records.get(idValue); if (!record) fail('NOT_FOUND'); if (expired(record)) { records.delete(idValue); fail('GONE'); } return safeParse(clone(record)); };
  return {
    async createConversation(input) {
      let conversation;
      try {
        const timestamp = input.createdAt || now();
        conversation = safeParse({ contractVersion: CONVERSATION_STORE_VERSION, turns: [], version: 1, createdAt: timestamp, updatedAt: timestamp, synthetic: true, observedHumanResponse: false, disclosure: SYNTHETIC_DISCLOSURE, ...input });
        validateChain(conversation);
      } catch (error) { if (error instanceof ConversationStoreError) throw error; fail('VALIDATION'); }
      if (records.has(conversation.id)) fail('CONFLICT');
      records.set(conversation.id, clone(conversation));
      return clone(conversation);
    },
    async appendTurn(idValue, input) {
      const conversation = read(idValue);
      if (input?.expectedTurnIndex !== conversation.turns.length || (input?.parentTurnId ?? null) !== (conversation.turns.at(-1)?.id || null)) fail('CONFLICT');
      let turn;
      try { turn = turnSchema.parse(input.turn); } catch { fail('VALIDATION'); }
      if (turn.role !== (conversation.turns.length % 2 === 0 ? 'user' : 'assistant')) fail('VALIDATION', 'Conversation turn role is invalid.');
      turn = { ...turn, parentTurnId: input.parentTurnId };
      if (conversation.turns.some((item) => item.id === turn.id)) fail('CONFLICT');
      if (turn.role === 'assistant' && turn.evidenceRefs.some((ref) => !conversation.frozenContext.evidenceIds.includes(ref))) fail('VALIDATION');
      if (turn.role === 'assistant' && turn.assumptionRefs.some((ref) => !conversation.frozenContext.assumptionIds.includes(ref))) fail('VALIDATION');
      const next = { ...conversation, turns: [...conversation.turns, turn], version: conversation.version + 1, updatedAt: now() };
      validateChain(next);
      records.set(idValue, clone(next));
      return clone(next);
    },
    async getConversation(idValue, options = {}) {
      const conversation = read(idValue);
      return options.metadataOnly ? metadata(conversation) : clone(conversation);
    },
    async listConversations(options = {}) {
      return [...records.keys()].map(active).filter(Boolean).filter((item) => !options.projectId || item.projectId === options.projectId).map((item) => options.metadataOnly ? metadata(item) : clone(item));
    },
    async deleteConversation(idValue) { if (!active(idValue)) return false; return records.delete(idValue); },
  };
}

function metadata(conversation) {
  return { contractVersion: conversation.contractVersion, id: conversation.id, projectId: conversation.projectId, studyId: conversation.studyId, runId: conversation.runId, segmentId: conversation.segmentId, version: conversation.version, turnCount: conversation.turns.length, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, retention: clone(conversation.retention), synthetic: true, observedHumanResponse: false, disclosure: SYNTHETIC_DISCLOSURE };
}
