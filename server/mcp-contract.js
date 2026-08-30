import { z } from 'zod';
import { groundedInterviewRequestSchema } from './qualitative-interview.js';
import { requestSchema } from './synthetic-study-pipeline.js';

export const MCP_CONTRACT_VERSION = '2.1.0';
export const MCP_SERVER_INFO = Object.freeze({ name: 'likerts-public', version: MCP_CONTRACT_VERSION });
export const METHODOLOGY_URI = 'likerts://methodology/synthetic-likert-study';
export const LIMITATIONS_URI = 'likerts://methodology/limitations';
export const LOCALIZATION_SCORECARD_URI = 'likerts://localization/scorecard';

export const RUN_SYNTHETIC_STUDY_DESCRIPTION = 'Run a bounded, model-generated research study for directional hypothesis generation in QUICK or DEEP mode. Supported methods are GENERAL_LIKERT, CONCEPT_TEST, PURCHASE_INTENT, MESSAGE_TEST, CLAIMS_TEST, UX_EXPECTATION_TEST, FEATURE_PRIORITIZATION, BRAND_POSITIONING, PRICE_SENSITIVITY, SURVEY_PRETEST, and INTERVIEW_GUIDE. Each specialized method requires its matching strict methodConfig and returns its declared result kind: a directional distribution, ranked items, attribute matrix, price ladder, instrument review, or interview guide. Every run creates a transparent Population Frame, runtime-owned research design, Model Card, and versioned human-research handoff draft. Bounded uploaded excerpts remain unverified grounding. This can incur model and retrieval cost. It never surveys humans, books a panel, or independently verifies supplied or retrieved evidence.';

export const validateBriefInputSchema = z.object({
  brief: z.record(z.string(), z.unknown()).describe('A draft research brief to validate. No model is called.'),
}).strict();

export const runSyntheticStudyInputSchema = requestSchema;
export const exploreSegmentPerspectiveInputSchema = groundedInterviewRequestSchema;

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
        durability: z.enum(['process-local-fallback', 'shared-admission-store']),
        processLocalFallback: z.boolean(),
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

export const exploreSegmentPerspectiveOutputSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    contractVersion: z.literal(MCP_CONTRACT_VERSION),
    synthetic: z.literal(true),
    participant: z.literal(false),
    result: z.record(z.string(), z.unknown()),
  }).strict(),
  publicErrorSchema,
]);

const FIELD_MESSAGES = Object.freeze({
  prompt: 'Research question must be a string containing 12 to 500 characters.',
  audience: 'Audience must be a string containing 3 to 160 characters.',
  panelSize: 'Panel size must be a whole number from 50 to 500.',
  researchMode: 'Research mode must be QUICK or DEEP (case-insensitive).',
  researchMethod: 'Research method must be GENERAL_LIKERT, CONCEPT_TEST, PURCHASE_INTENT, MESSAGE_TEST, CLAIMS_TEST, UX_EXPECTATION_TEST, FEATURE_PRIORITIZATION, BRAND_POSITIONING, PRICE_SENSITIVITY, SURVEY_PRETEST, or INTERVIEW_GUIDE.',
  methodConfig: 'Method configuration must match the selected research method and include every required stimulus field.',
  assumptions: 'Assumptions must be a string of at most 1,000 characters.',
  localization: 'Localization must use the supported study-localization-v1 contract and an enabled market/locale capability combination.',
  sampleLineage: 'Sample lineage must exactly match one current registered public sample and its original localization receipt.',
  market: 'Market must be a string containing 2 to 120 characters.',
  outputLocale: 'Output locale must be a valid BCP-47 language tag, such as en-US.',
  sourceLanguages: 'Source languages must contain at most four valid BCP-47 language tags.',
  searchCountry: 'Search country must be a two-letter country code.',
  searchLocation: 'Search location must be a string of at most 120 characters.',
  evidencePolicy: 'Evidence policy must be AUTO, REQUIRE_EXTERNAL, or PRIOR_ONLY.',
  sourceUrls: 'Source URLs must contain at most four safe, public HTTP(S) URLs.',
  sources: 'Sources must contain at most four valid public source records.',
  evidence: 'Evidence must contain at most four valid excerpts or source records.',
  populationFrame: 'Population frame data must use bounded, internally consistent marginals/intersections and safe public source URLs; callers cannot self-assert application-curated status.',
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

1. Before model calls, every run creates a versioned Population Frame. It records the intended population, geography, languages, declared official-source records, marginals, known intersections, weighting status, unsupported characteristics, coverage date, and decomposed Population Fit. Missing population evidence remains visibly unmeasured.
2. A runtime-owned research-method template selects the design, estimand, result kind, chart, critic rubric, and human-validation plan. Legacy callers use GENERAL_LIKERT. Specialized methods use strict matching configurations: CONCEPT_TEST, PURCHASE_INTENT, MESSAGE_TEST, CLAIMS_TEST, UX_EXPECTATION_TEST, FEATURE_PRIORITIZATION, BRAND_POSITIONING, PRICE_SENSITIVITY, SURVEY_PRETEST, and INTERVIEW_GUIDE. Their outputs are explicit discriminated result kinds rather than projecting every method into a fictional Likert distribution.
3. A framing stage neutralises the supplied question and records assumptions and evidence boundaries.
4. Evidence is handled according to \`evidencePolicy\`. User excerpts—including bounded uploads—and retrieved web text are treated as untrusted inputs and recorded in a hashed ledger; they are not independently verified. Uploaded material is explicitly labeled unverified grounding, not human validation.
5. QUICK uses one cost-efficient aggregate model call. DEEP uses a bounded multi-provider cohort of separate model-run calls and deterministically aggregates their five-position distributions.
6. A separate evidence-alignment and bias-critic stage checks weak claims, unsupported grounding, stereotypes, arithmetic, contradictions, and the selected method rubric. It is part of the same pipeline, not independent external review.
7. A completed directional run can be explored through bounded model-generated segment perspectives only when its research design marks \`segmentPerspectiveEligible: true\`. The endpoint preserves supplied conversation context, resolves only declared evidence and assumption references, and repeats the exact non-participant disclosure on every answer. It does not interview people or authenticate client-supplied run context as a durable server record.
8. Every completed run includes a deterministic human-research handoff for researcher review: questionnaire, screener, monitor-only demographic targets, sample-planning assumptions, unestimated incidence, recruitment and analysis plans, provider links, and frozen lineage. It books no panel and contains no observed human responses.

The result includes the Population Frame and its hash, a transparent Model Card, evidence mode, model lineage, stage status, exact Gateway cost when reported, token usage, reproducibility metadata, explicit cross-call disagreement metrics in DEEP, credibility signals, cautions, and the human-research handoff plus its hash. Model generation remains non-deterministic. A completed critic stage is an internal model review, not validation by human participants or an independent researcher. **Demographic fit does not prove attitudinal accuracy.**
`;

export const LIMITATIONS_MARKDOWN = `# Likerts synthetic study limitations

- Every response, segment, quote, and percentage is model-generated. There are no observed human responses.
- The panel is not representative, probability-sampled, statistically significant, causal, or suitable for population estimates.
- Population weighting constrains declared demographic or firmographic composition only. It does not validate generated attitudes, intentions, objections, or behaviour.
- Retrieved or supplied sources may be incomplete, biased, stale, or malicious. A source ledger provides traceability, not independent verification.
- Results are session-only unless the caller saves the returned client record.
- Anonymous rate, concurrency, and process-budget controls are conservative, best-effort in-memory safeguards. Serverless instances do not share these counters, so they are not a perfect distributed rate or cost limit. Operators can provide a shared external admission hook for stronger enforcement.
- Validate important decisions with real participants, appropriate sampling, accessibility review, privacy review, and domain expertise.
`;
