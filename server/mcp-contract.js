import { z } from 'zod';
import { requestSchema } from './synthetic-study-pipeline.js';

export const MCP_CONTRACT_VERSION = '1.0.0';
export const MCP_SERVER_INFO = Object.freeze({ name: 'likerts-public', version: MCP_CONTRACT_VERSION });
export const METHODOLOGY_URI = 'likerts://methodology/synthetic-likert-study';
export const LIMITATIONS_URI = 'likerts://methodology/limitations';

export const validateBriefInputSchema = z.object({
  brief: z.record(z.string(), z.unknown()).describe('A draft research brief to validate. No model is called.'),
}).strict();

export const runSyntheticStudyInputSchema = requestSchema;

const issueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
  message: z.string(),
}).strict();

const publicErrorSchema = z.object({
  ok: z.literal(false),
  contractVersion: z.literal(MCP_CONTRACT_VERSION),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().positive().nullable(),
  }).strict(),
}).strict();

export const validateBriefOutputSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    contractVersion: z.literal(MCP_CONTRACT_VERSION),
    validation: z.object({
      valid: z.boolean(),
      issues: z.array(issueSchema),
      normalizedInput: z.record(z.string(), z.unknown()).nullable(),
      estimatedModelCalls: z.number().int().min(3).max(11),
      estimatedAdmissionUnits: z.number().int().min(1).max(10),
      admissionProtection: z.object({
        durability: z.enum(['process-local-fallback', 'durable-adapter-plus-process-local-fallback']),
        processLocalFallback: z.literal(true),
        globallyDurable: z.boolean(),
      }).strict(),
      syntheticPanel: z.literal(true),
      mayUseExternalRetrieval: z.boolean(),
    }).strict(),
  }).strict(),
  publicErrorSchema,
]);

export const runSyntheticStudyOutputSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    contractVersion: z.literal(MCP_CONTRACT_VERSION),
    synthetic: z.literal(true),
    evidenceAware: z.literal(true),
    result: z.record(z.string(), z.unknown()),
  }).strict(),
  publicErrorSchema,
]);

const FIELD_MESSAGES = Object.freeze({
  prompt: 'Research question must be a string containing 12 to 500 characters.',
  audience: 'Audience must be a string containing 3 to 160 characters.',
  panelSize: 'Panel size must be a whole number from 50 to 500.',
  researchMode: 'Research mode must be QUICK or DEEP (case-insensitive).',
  assumptions: 'Assumptions must be a string of at most 1,000 characters.',
  market: 'Market must be a string containing 2 to 120 characters.',
  outputLocale: 'Output locale must be a valid BCP-47 language tag, such as en-US.',
  sourceLanguages: 'Source languages must contain at most four valid BCP-47 language tags.',
  searchCountry: 'Search country must be a two-letter country code.',
  searchLocation: 'Search location must be a string of at most 120 characters.',
  evidencePolicy: 'Evidence policy must be AUTO, REQUIRE_EXTERNAL, or PRIOR_ONLY.',
  sourceUrls: 'Source URLs must contain at most four safe, public HTTP(S) URLs.',
  sources: 'Sources must contain at most four valid public source records.',
  evidence: 'Evidence must contain at most four valid excerpts or source records.',
  clientRunId: 'Client run ID must be 8 to 100 letters, numbers, underscores, or hyphens.',
});

export function publicValidationIssues(error) {
  return error.issues.map((issue) => {
    const field = typeof issue.path[0] === 'string' ? issue.path[0] : null;
    return {
      path: issue.path,
      code: field ? `INVALID_${field.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}` : 'INVALID_BRIEF',
      message: field && FIELD_MESSAGES[field] ? FIELD_MESSAGES[field] : 'The research brief contains unsupported or invalid fields.',
    };
  });
}

export const METHODOLOGY_MARKDOWN = `# Likerts synthetic study methodology

Likerts generates **synthetic, directional hypotheses**. It does not survey or observe people.

1. A framing stage neutralises the supplied question and records assumptions and evidence boundaries.
2. Evidence is handled according to \`evidencePolicy\`. User excerpts and retrieved web text are treated as untrusted inputs and recorded in a hashed ledger; they are not independently verified.
3. QUICK uses one cost-efficient synthetic panel call. DEEP uses a bounded multi-provider cohort of separate model calls and deterministically aggregates their five-position distributions.
4. A separate evidence-alignment and bias-critic stage checks weak claims, unsupported grounding, stereotypes, arithmetic, and contradictions. It is part of the same pipeline, not independent external review.

The result includes evidence mode, model lineage, stage status, exact Gateway cost when reported, token usage, reproducibility metadata, explicit cross-call disagreement metrics in DEEP, credibility signals, and cautions. Model generation remains non-deterministic. A completed critic stage is an internal model review, not validation by human participants or an independent researcher.
`;

export const LIMITATIONS_MARKDOWN = `# Likerts synthetic study limitations

- Every response, segment, quote, and percentage is model-generated. There are no observed human responses.
- The panel is not representative, probability-sampled, statistically significant, causal, or suitable for population estimates.
- Retrieved or supplied sources may be incomplete, biased, stale, or malicious. A source ledger provides traceability, not independent verification.
- Results are session-only unless the caller saves the returned client record.
- Anonymous rate, concurrency, and process-budget controls are conservative, best-effort in-memory safeguards. Serverless instances do not share these counters, so they are not a perfect distributed rate or cost limit. Operators can provide a shared external admission hook for stronger enforcement.
- Validate important decisions with real participants, appropriate sampling, accessibility review, privacy review, and domain expertise.
`;
