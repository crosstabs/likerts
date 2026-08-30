import { z } from 'zod';

export const METHOD_RESULT_CONTRACT_VERSION = 'method-result-v1';
export const METHOD_RESULT_DISCLOSURE = 'Method-specific output is model-generated direction, not a human measurement.';
export const METHOD_RESULT_KINDS = Object.freeze([
  'DIRECTIONAL_DISTRIBUTION',
  'RANKED_ITEMS',
  'ATTRIBUTE_MATRIX',
  'PRICE_LADDER',
  'INSTRUMENT_REVIEW',
  'INTERVIEW_GUIDE',
]);

const identifier = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/, 'Use a stable identifier containing only letters, numbers, underscores, or hyphens.');
const label = z.string().trim().min(1).max(240);
const summary = z.string().trim().min(1).max(1_000);
const percentageDistribution = z.array(z.number().int().min(0).max(100)).length(5).refine(
  (values) => values.reduce((total, value) => total + value, 0) === 100,
  'A directional distribution must total 100 percentage points.',
);
const scale = z.object({
  id: identifier,
  labels: z.array(label).length(5).refine((labels) => new Set(labels.map((value) => value.toLocaleLowerCase())).size === 5, 'Scale labels must be distinct.'),
}).strict();
const base = {
  contractVersion: z.literal(METHOD_RESULT_CONTRACT_VERSION),
  disclosure: z.literal(METHOD_RESULT_DISCLOSURE),
  accessibleLabel: label,
  summary,
};

function unique(items, key) {
  return new Set(items.map((item) => item[key])).size === items.length;
}

const directionalDistributionSchema = z.object({
  ...base,
  kind: z.literal('DIRECTIONAL_DISTRIBUTION'),
  scale,
  distribution: percentageDistribution,
}).strict();

const rankedItemsSchema = z.object({
  ...base,
  kind: z.literal('RANKED_ITEMS'),
  rankingLabel: label,
  items: z.array(z.object({ id: identifier, label, rank: z.number().int().positive(), rationale: summary.optional() }).strict()).min(2).max(20)
    .superRefine((items, context) => {
      if (new Set(items.map((item) => item.id)).size !== items.length) context.addIssue({ code: 'custom', message: 'Ranked item IDs must be unique.' });
      const ranks = items.map((item) => item.rank).sort((left, right) => left - right);
      if (!ranks.every((rank, index) => rank === index + 1)) context.addIssue({ code: 'custom', message: 'Ranks must be contiguous and start at 1.' });
    }),
}).strict();

const attributeMatrixSchema = z.object({
  ...base,
  kind: z.literal('ATTRIBUTE_MATRIX'),
  matrixLabel: label,
  attributes: z.array(z.object({ id: identifier, label }).strict()).min(1).max(12)
    .refine((items) => unique(items, 'id'), 'Attribute IDs must be unique.'),
  brands: z.array(z.object({
    id: identifier,
    label,
    associations: z.array(z.object({ attributeId: identifier, level: z.enum(['LOW', 'MEDIUM', 'HIGH']), accessibleLabel: label }).strict()).min(1).max(12),
  }).strict()).min(2).max(8),
}).strict().superRefine((result, context) => {
  if (new Set(result.brands.map((brand) => brand.id)).size !== result.brands.length) context.addIssue({ code: 'custom', message: 'Brand IDs must be unique.' });
  const attributeIds = result.attributes.map((attribute) => attribute.id);
  for (const [brandIndex, brand] of result.brands.entries()) {
    const associationIds = brand.associations.map((association) => association.attributeId);
    if (new Set(associationIds).size !== associationIds.length || associationIds.length !== attributeIds.length || associationIds.some((id) => !attributeIds.includes(id))) {
      context.addIssue({ code: 'custom', path: ['brands', brandIndex, 'associations'], message: 'Every brand must contain exactly one association for every supplied attribute.' });
    }
  }
});

const priceLadderSchema = z.object({
  ...base,
  kind: z.literal('PRICE_LADDER'),
  scale,
  priceContext: z.object({ currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/), unit: label }).strict(),
  points: z.array(z.object({ id: identifier, label, amount: z.number().finite().positive().max(1_000_000_000), distribution: percentageDistribution }).strict()).min(3).max(12),
}).strict().superRefine((result, context) => {
  const ids = result.points.map((point) => point.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['points'], message: 'Price-point IDs must be unique.' });
  if (!result.points.every((point, index) => index === 0 || point.amount > result.points[index - 1].amount)) {
    context.addIssue({ code: 'custom', path: ['points'], message: 'Price points must be strictly ascending by amount.' });
  }
});

const instrumentReviewSchema = z.object({
  ...base,
  kind: z.literal('INSTRUMENT_REVIEW'),
  issues: z.array(z.object({
    id: identifier,
    questionId: identifier,
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    category: label,
    explanation: summary,
    revisionSuggestion: summary,
  }).strict()).max(100).refine((items) => unique(items, 'id'), 'Instrument-review issue IDs must be unique.'),
  coverageGaps: z.array(summary).max(20),
  suggestedCognitiveProbes: z.array(summary).max(20),
}).strict();

const interviewGuideSchema = z.object({
  ...base,
  kind: z.literal('INTERVIEW_GUIDE'),
  opening: summary,
  questions: z.array(z.object({ id: identifier, topicId: identifier, prompt: summary, probes: z.array(summary).max(8) }).strict()).min(1).max(30)
    .refine((items) => unique(items, 'id'), 'Interview-guide question IDs must be unique.'),
  moderatorNotes: z.array(summary).max(20),
  consentAndAccessibilityNotes: z.array(summary).min(1).max(20),
  closing: summary,
}).strict();

export const methodResultSchema = z.discriminatedUnion('kind', [
  directionalDistributionSchema,
  rankedItemsSchema,
  attributeMatrixSchema,
  priceLadderSchema,
  instrumentReviewSchema,
  interviewGuideSchema,
]);

/** Validates untrusted output without throwing. */
export function validateMethodResult(value) {
  return methodResultSchema.safeParse(value);
}

/** Parses and returns a contract-normalized, browser/server-neutral method result. */
export function normalizeMethodResult(value) {
  return methodResultSchema.parse(value);
}

/**
 * Bridges only five-point directional method results to the legacy study fields.
 * Other method results deliberately have no fictional directional projection.
 */
export function projectLegacyDirectionalResult(value) {
  const result = normalizeMethodResult(value);
  if (result.kind !== 'DIRECTIONAL_DISTRIBUTION') return null;
  return {
    distribution: [...result.distribution],
    responseScale: { id: result.scale.id, labels: [...result.scale.labels] },
    disclosure: result.disclosure,
  };
}
