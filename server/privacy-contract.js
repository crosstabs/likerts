import { z } from 'zod';

export const PRIVACY_CONTRACT_VERSION = 'privacy-contract-v1';
export const LINEAGE_ENVELOPE_VERSION = 'lineage-envelope-v1';
export const DATA_CLASSIFICATIONS = Object.freeze(['PUBLIC', 'USER_PROVIDED', 'SENSITIVE', 'OBSERVED_HUMAN_DATA']);

const isoDate = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[a-f0-9]{64}$/i);

export const retentionPolicySchema = z.object({
  mode: z.enum(['SESSION', 'TTL', 'UNTIL_DELETED']),
  expiresAt: isoDate.nullable().default(null),
  deletionRequestedAt: isoDate.nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.mode === 'TTL' && !value.expiresAt) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'TTL retention requires an expiry timestamp.' });
  if (value.mode !== 'TTL' && value.expiresAt) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Only TTL retention may specify an expiry timestamp.' });
});

export const lineageEnvelopeSchema = z.object({
  contractVersion: z.literal(LINEAGE_ENVELOPE_VERSION),
  recordType: z.string().trim().min(1).max(80),
  recordId: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/),
  classification: z.enum(DATA_CLASSIFICATIONS),
  studyId: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/).nullable().default(null),
  runId: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/).nullable().default(null),
  payloadHash: hash,
  synthetic: z.boolean(),
  observedHumanResponse: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
  parentRecordId: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/).nullable().default(null),
  version: z.number().int().min(1).default(1),
  retention: retentionPolicySchema,
}).strict().superRefine((value, context) => {
  if (value.synthetic && value.observedHumanResponse) context.addIssue({ code: 'custom', path: ['observedHumanResponse'], message: 'Synthetic records cannot be observed human responses.' });
  if (value.observedHumanResponse && value.classification !== 'OBSERVED_HUMAN_DATA') context.addIssue({ code: 'custom', path: ['classification'], message: 'Observed responses require OBSERVED_HUMAN_DATA classification.' });
});

export function createLineageEnvelope(input, options = {}) {
  const now = options.now || (() => new Date().toISOString());
  return lineageEnvelopeSchema.parse({
    contractVersion: LINEAGE_ENVELOPE_VERSION,
    studyId: null,
    runId: null,
    retention: { mode: 'SESSION' },
    createdAt: now(),
    updatedAt: now(),
    parentRecordId: null,
    version: 1,
    ...input,
  });
}

const SECRET_KEY = /authorization|api[-_]?key|secret|password|passwd|bearer|cookie|set-cookie|private[-_]?key|^token$/i;
const USAGE_KEY = /^(input|output|total|reasoning|cached)tokens$/i;
const CREDENTIAL_VALUE = /^(?:Bearer\s+\S+|Basic\s+[A-Za-z0-9+/]{8,}={0,2})$/i;
const MAX_REDACTION_DEPTH = 20;

export function redactSensitive(value, depth = 0) {
  if (depth > MAX_REDACTION_DEPTH) return '[REDACTED_DEPTH]';
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && CREDENTIAL_VALUE.test(value.trim())) return '[REDACTED]';
    return typeof value === 'string' && value.length > 2_000 ? `${value.slice(0, 2_000)}…[TRUNCATED]` : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) && !USAGE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, depth + 1)]));
}
