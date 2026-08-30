import { z } from 'zod';
import { isSafePublicUrl } from './public-url.js';

export const POPULATION_FRAME_VERSION = 'population-frame-v1';
export const POPULATION_FIT_VERSION = 'population-fit-v1';
export const ATTITUDINAL_ACCURACY_DISCLAIMER = 'Demographic fit does not prove attitudinal accuracy. Synthetic results remain model-generated hypotheses until validated with real people.';

const shareSchema = z.number().min(0).max(1);
const categorySchema = z.object({
  value: z.string().trim().min(1).max(120),
  share: shareSchema,
}).strict();

export const marginalDistributionSchema = z.object({
  variable: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  categories: z.array(categorySchema).min(2).max(30),
  sourceDatasetId: z.string().trim().min(1).max(100),
}).strict();

export const intersectionCellSchema = z.object({
  dimensions: z.record(z.string(), z.string().trim().min(1).max(120)),
  share: shareSchema,
}).strict();

export const knownIntersectionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(160),
  variables: z.array(z.string().trim().min(1).max(80)).min(2).max(5),
  cells: z.array(intersectionCellSchema).min(1).max(250),
  sourceDatasetId: z.string().trim().min(1).max(100),
}).strict();

const publicUrlSchema = z.string().trim().url().superRefine((value, context) => {
  if (!isSafePublicUrl(value)) context.addIssue({ code: 'custom', message: 'Population sources must use a safe public http(s) URL.' });
});

const sourceRecencySchema = z.object({
  version: z.literal('population-source-recency-v1'),
  asOfDate: z.string().date(),
  referenceDate: z.string().date(),
  ageDays: z.number().int().nonnegative(),
  status: z.enum(['CURRENT', 'AGING', 'STALE']),
  score: z.union([z.literal(100), z.literal(60), z.literal(20)]),
  thresholdsDays: z.object({ currentMaximum: z.literal(730), agingMaximum: z.literal(1825) }).strict(),
}).strict();

export const officialSourceDatasetSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(240),
  publisher: z.string().trim().min(1).max(180),
  url: publicUrlSchema,
  coverageDate: z.string().date(),
  geography: z.string().trim().min(1).max(160),
  variables: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
  verificationStatus: z.enum(['CURATED_OFFICIAL', 'USER_DECLARED_OFFICIAL', 'UNVERIFIED']),
  recency: sourceRecencySchema.nullable().optional(),
}).strict().superRefine((source, context) => {
  if (!source.recency) return;
  if (source.verificationStatus !== 'CURATED_OFFICIAL') {
    context.addIssue({ code: 'custom', path: ['recency'], message: 'Source recency metadata is reserved for curated official adapters.' });
  }
  if (source.recency.referenceDate !== source.coverageDate) {
    context.addIssue({ code: 'custom', path: ['recency', 'referenceDate'], message: 'Recency referenceDate must equal the source coverageDate.' });
  }
  const expectedAgeDays = Math.round((Date.parse(`${source.recency.asOfDate}T00:00:00.000Z`) - Date.parse(`${source.recency.referenceDate}T00:00:00.000Z`)) / 86_400_000);
  if (source.recency.ageDays !== expectedAgeDays) {
    context.addIssue({ code: 'custom', path: ['recency', 'ageDays'], message: 'Recency ageDays must equal the deterministic difference between asOfDate and referenceDate.' });
  }
  const expectedStatus = expectedAgeDays <= 730 ? 'CURRENT' : expectedAgeDays <= 1825 ? 'AGING' : 'STALE';
  const expectedScore = expectedStatus === 'CURRENT' ? 100 : expectedStatus === 'AGING' ? 60 : 20;
  if (expectedAgeDays < 0 || source.recency.status !== expectedStatus || source.recency.score !== expectedScore) {
    context.addIssue({ code: 'custom', path: ['recency'], message: 'Recency status and score must match the versioned thresholds and cannot use a future reference date.' });
  }
});

export const populationFrameInputSchema = z.object({
  intendedPopulation: z.string().trim().min(1).max(500).optional(),
  officialSourceDatasets: z.array(officialSourceDatasetSchema).max(20).optional().default([]),
  marginalDistributions: z.array(marginalDistributionSchema).max(30).optional().default([]),
  knownIntersections: z.array(knownIntersectionSchema).max(20).optional().default([]),
  unsupportedCharacteristics: z.array(z.string().trim().min(1).max(240)).max(30).optional().default([]),
  coverageDate: z.string().date().nullable().optional().default(null),
}).strict();

const weightingDiagnosticsSchema = z.object({
  iterations: z.number().int().nonnegative().nullable(),
  tolerance: z.number().positive().nullable(),
  maxAbsoluteError: z.number().nonnegative().nullable(),
  minWeight: z.number().nonnegative().nullable(),
  maxWeight: z.number().nonnegative().nullable(),
  effectiveCellCount: z.number().nonnegative().nullable(),
}).strict();

export const populationFrameSchema = z.object({
  frameVersion: z.literal(POPULATION_FRAME_VERSION),
  intendedPopulation: z.string().trim().min(1).max(500),
  geography: z.object({
    market: z.string().trim().min(1).max(160),
    countryCode: z.string().length(2).nullable(),
  }).strict(),
  languages: z.object({
    outputLocale: z.string().trim().min(2).max(35),
    sourceLanguages: z.array(z.string().trim().min(2).max(35)).max(8),
  }).strict(),
  characteristics: z.array(z.object({
    variable: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    support: z.enum(['MARGINAL', 'INTERSECTION', 'UNSUPPORTED']),
    sourceDatasetIds: z.array(z.string().trim().min(1).max(100)).max(8),
  }).strict()).max(30),
  officialSourceDatasets: z.array(officialSourceDatasetSchema).max(20),
  marginalDistributions: z.array(marginalDistributionSchema).max(30),
  knownIntersections: z.array(knownIntersectionSchema).max(20),
  populationCells: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    dimensions: z.record(z.string(), z.string().trim().min(1).max(120)),
    weight: z.number().min(0).max(1),
  }).strict()).max(250),
  weighting: z.object({
    method: z.enum(['NONE', 'RAKING_IPF', 'POST_STRATIFICATION']),
    status: z.enum(['NOT_APPLIED', 'CONVERGED', 'DID_NOT_CONVERGE', 'INVALID_INPUT']),
    diagnostics: weightingDiagnosticsSchema,
  }).strict(),
  unsupportedCharacteristics: z.array(z.string().trim().min(1).max(240)).max(30),
  coverageDate: z.string().date().nullable(),
  populationFit: z.object({
    scoreVersion: z.literal(POPULATION_FIT_VERSION),
    status: z.enum(['UNMEASURED', 'PARTIAL', 'MEASURED']),
    overall: z.number().min(0).max(100).nullable(),
    components: z.object({
      geographyCoverage: z.number().min(0).max(100).nullable(),
      marginalCoverage: z.number().min(0).max(100).nullable(),
      intersectionCoverage: z.number().min(0).max(100).nullable(),
      sourceQuality: z.number().min(0).max(100).nullable(),
      sourceRecency: z.number().min(0).max(100).nullable(),
      weightingQuality: z.number().min(0).max(100).nullable(),
    }).strict(),
    formula: z.string().trim().min(1).max(500),
  }).strict(),
  disclaimer: z.literal(ATTITUDINAL_ACCURACY_DISCLAIMER),
}).strict();

const emptyDiagnostics = Object.freeze({
  iterations: null,
  tolerance: null,
  maxAbsoluteError: null,
  minWeight: null,
  maxWeight: null,
  effectiveCellCount: null,
});

const POPULATION_FIT_WEIGHTS = Object.freeze({
  geographyCoverage: 0.2,
  marginalCoverage: 0.25,
  intersectionCoverage: 0.2,
  sourceQuality: 0.15,
  sourceRecency: 0.1,
  weightingQuality: 0.1,
});

const POPULATION_FIT_FORMULA = 'Overall = 20% geography coverage + 25% marginal coverage + 20% intersection coverage + 15% source quality + 10% source recency + 10% weighting quality. Missing components contribute zero and remain visibly unmeasured.';

function normaliseCellWeights(cells) {
  const total = cells.reduce((sum, cell) => sum + cell.weight, 0);
  if (!(total > 0)) return null;
  const normalised = cells.map((cell) => ({ ...cell, weight: cell.weight / total }));
  const beforeLast = normalised.slice(0, -1).reduce((sum, cell) => sum + cell.weight, 0);
  normalised[normalised.length - 1].weight = Math.max(0, 1 - beforeLast);
  return normalised;
}

function constraintGroups(marginalDistributions, knownIntersections) {
  return [
    ...marginalDistributions.map((marginal) => ({
      id: `marginal:${marginal.variable}`,
      targets: marginal.categories.map((category) => ({
        id: category.value,
        share: category.share,
        matches: (cell) => cell.dimensions[marginal.variable] === category.value,
      })),
    })),
    ...knownIntersections.map((intersection) => ({
      id: `intersection:${intersection.id}`,
      targets: intersection.cells.map((target, index) => ({
        id: `${intersection.id}:${index}`,
        share: target.share,
        matches: (cell) => Object.entries(target.dimensions).every(([variable, value]) => cell.dimensions[variable] === value),
      })),
    })),
  ];
}

function maximumConstraintError(cells, groups) {
  return Math.max(0, ...groups.flatMap((group) => group.targets.map((target) => {
    const actual = cells.filter(target.matches).reduce((sum, cell) => sum + cell.weight, 0);
    return Math.abs(actual - target.share);
  })));
}

function weightingDiagnostics(cells, iterations, tolerance, maxAbsoluteError) {
  const weights = cells.map((cell) => cell.weight);
  return {
    iterations,
    tolerance,
    maxAbsoluteError,
    minWeight: Math.min(...weights),
    maxWeight: Math.max(...weights),
    effectiveCellCount: 1 / weights.reduce((sum, weight) => sum + weight ** 2, 0),
  };
}

export function rakePopulationCells({ cells, marginalDistributions = [], knownIntersections = [], tolerance = 1e-6, maxIterations = 200 } = {}) {
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > 250) throw new TypeError('Raking requires 1 to 250 seed cells.');
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new TypeError('Raking tolerance must be a positive finite number.');
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10_000) throw new TypeError('Raking maxIterations must be an integer from 1 to 10,000.');
  const ids = new Set();
  let weighted = cells.map((cell, index) => {
    if (!cell || typeof cell !== 'object' || typeof cell.id !== 'string' || !cell.id.trim()) throw new TypeError(`Seed cell ${index + 1} requires an ID.`);
    if (ids.has(cell.id)) throw new TypeError(`Seed cell ID "${cell.id}" is duplicated.`);
    ids.add(cell.id);
    if (!cell.dimensions || typeof cell.dimensions !== 'object' || Array.isArray(cell.dimensions)) throw new TypeError(`Seed cell "${cell.id}" requires dimensions.`);
    const baseWeight = cell.baseWeight ?? 1;
    if (!Number.isFinite(baseWeight) || baseWeight <= 0) throw new TypeError(`Seed cell "${cell.id}" requires a positive finite base weight.`);
    return { id: cell.id, dimensions: { ...cell.dimensions }, weight: baseWeight };
  });
  weighted = normaliseCellWeights(weighted);

  const groups = constraintGroups(marginalDistributions, knownIntersections);
  if (!groups.length) throw new TypeError('Raking requires at least one marginal distribution or known intersection.');
  for (const group of groups) {
    for (const cell of weighted) {
      const matchCount = group.targets.filter((target) => target.matches(cell)).length;
      if (matchCount !== 1) throw new TypeError(`Seed cell "${cell.id}" must match exactly one target in ${group.id}.`);
    }
  }

  let iterations = 0;
  let maxAbsoluteError = maximumConstraintError(weighted, groups);
  while (maxAbsoluteError > tolerance && iterations < maxIterations) {
    iterations += 1;
    for (const group of groups) {
      for (const target of group.targets) {
        const matching = weighted.filter(target.matches);
        const actual = matching.reduce((sum, cell) => sum + cell.weight, 0);
        if (target.share > 0 && actual === 0) {
          return {
            status: 'INVALID_INPUT',
            reason: `Target "${target.id}" in ${group.id} has positive mass but no weighted seed support.`,
            cells: weighted,
            diagnostics: weightingDiagnostics(weighted, iterations, tolerance, maximumConstraintError(weighted, groups)),
          };
        }
        const factor = actual === 0 ? 0 : target.share / actual;
        for (const cell of matching) cell.weight *= factor;
      }
      const normalised = normaliseCellWeights(weighted);
      if (!normalised) {
        return {
          status: 'INVALID_INPUT',
          reason: `Constraint group ${group.id} reduced all seed weights to zero.`,
          cells: weighted,
          diagnostics: weightingDiagnostics(weighted, iterations, tolerance, maximumConstraintError(weighted, groups)),
        };
      }
      weighted = normalised;
    }
    maxAbsoluteError = maximumConstraintError(weighted, groups);
  }

  return {
    status: maxAbsoluteError <= tolerance ? 'CONVERGED' : 'DID_NOT_CONVERGE',
    reason: maxAbsoluteError <= tolerance ? null : `Maximum constraint error remained above tolerance after ${maxIterations} iterations.`,
    cells: weighted,
    diagnostics: weightingDiagnostics(weighted, iterations, tolerance, maxAbsoluteError),
  };
}

function validateStructuredFrame(frame) {
  const datasetIds = new Set(frame.officialSourceDatasets.map((dataset) => dataset.id));
  if (datasetIds.size !== frame.officialSourceDatasets.length) throw new TypeError('Official source dataset IDs must be unique.');
  const marginalVariables = new Set(frame.marginalDistributions.map((marginal) => marginal.variable));
  if (marginalVariables.size !== frame.marginalDistributions.length) throw new TypeError('Marginal distribution variables must be unique.');
  for (const marginal of frame.marginalDistributions) {
    if (new Set(marginal.categories.map((category) => category.value)).size !== marginal.categories.length) throw new TypeError(`Marginal distribution "${marginal.variable}" contains duplicate categories.`);
    const total = marginal.categories.reduce((sum, category) => sum + category.share, 0);
    if (Math.abs(total - 1) > 1e-6) throw new TypeError(`Marginal distribution "${marginal.variable}" must sum to 1.`);
    if (!datasetIds.has(marginal.sourceDatasetId)) throw new TypeError(`Marginal distribution "${marginal.variable}" references an unknown source dataset.`);
  }
  for (const intersection of frame.knownIntersections) {
    const total = intersection.cells.reduce((sum, cell) => sum + cell.share, 0);
    if (Math.abs(total - 1) > 1e-6) throw new TypeError(`Known intersection "${intersection.id}" must sum to 1.`);
    if (!datasetIds.has(intersection.sourceDatasetId)) throw new TypeError(`Known intersection "${intersection.id}" references an unknown source dataset.`);
    for (const variable of intersection.variables) {
      if (!marginalVariables.has(variable)) throw new TypeError(`Known intersection "${intersection.id}" references variable "${variable}" without a marginal distribution.`);
    }
    const marginalByVariable = new Map(frame.marginalDistributions.map((marginal) => [marginal.variable, new Set(marginal.categories.map((category) => category.value))]));
    for (const cell of intersection.cells) {
      if (Object.keys(cell.dimensions).length !== intersection.variables.length || intersection.variables.some((variable) => !(variable in cell.dimensions))) {
        throw new TypeError(`Known intersection "${intersection.id}" cells must contain exactly its declared variables.`);
      }
      for (const [variable, value] of Object.entries(cell.dimensions)) {
        if (!marginalByVariable.get(variable)?.has(value)) throw new TypeError(`Known intersection "${intersection.id}" uses unknown category "${value}" for "${variable}".`);
      }
    }
  }
}

function seedCellsFor(marginalDistributions) {
  if (!marginalDistributions.length) return { cells: [], overflow: false };
  let combinations = [{ dimensions: {} }];
  for (const marginal of marginalDistributions) {
    if (combinations.length * marginal.categories.length > 250) return { cells: [], overflow: true };
    combinations = combinations.flatMap((combination) => marginal.categories.map((category) => ({
      dimensions: { ...combination.dimensions, [marginal.variable]: category.value },
    })));
  }
  return {
    overflow: false,
    cells: combinations.map((combination, index) => ({ id: `population-cell-${index + 1}`, dimensions: combination.dimensions, baseWeight: 1 })),
  };
}

function weightingFor(frame) {
  const seed = seedCellsFor(frame.marginalDistributions);
  if (!frame.marginalDistributions.length) {
    return { cells: [], weighting: { method: 'NONE', status: 'NOT_APPLIED', diagnostics: { ...emptyDiagnostics } }, weightingQuality: null, unsupported: [] };
  }
  if (seed.overflow) {
    return {
      cells: [],
      weighting: { method: frame.marginalDistributions.length === 1 ? 'POST_STRATIFICATION' : 'RAKING_IPF', status: 'INVALID_INPUT', diagnostics: { ...emptyDiagnostics } },
      weightingQuality: 0,
      unsupported: ['The declared population cross-product exceeds the 250-cell weighting safety limit.'],
    };
  }
  const result = rakePopulationCells({
    cells: seed.cells,
    marginalDistributions: frame.marginalDistributions,
    knownIntersections: frame.knownIntersections,
  });
  return {
    cells: result.cells,
    weighting: {
      method: frame.marginalDistributions.length === 1 && !frame.knownIntersections.length ? 'POST_STRATIFICATION' : 'RAKING_IPF',
      status: result.status,
      diagnostics: result.diagnostics,
    },
    weightingQuality: result.status === 'CONVERGED' ? 100 : 0,
    unsupported: result.reason ? [result.reason] : [],
  };
}

function characteristicsFor(frame) {
  const intersectionsByVariable = new Map();
  for (const intersection of frame.knownIntersections) {
    for (const variable of intersection.variables) {
      const ids = intersectionsByVariable.get(variable) || [];
      intersectionsByVariable.set(variable, [...ids, intersection.sourceDatasetId]);
    }
  }
  return frame.marginalDistributions.map((marginal) => {
    const intersectionDatasetIds = intersectionsByVariable.get(marginal.variable) || [];
    return {
      variable: marginal.variable,
      label: marginal.label,
      support: intersectionDatasetIds.length ? 'INTERSECTION' : 'MARGINAL',
      sourceDatasetIds: [...new Set([marginal.sourceDatasetId, ...intersectionDatasetIds])],
    };
  });
}

function fitFor({ frame, market, weightingQuality = null }) {
  if (!frame.officialSourceDatasets.length && !frame.marginalDistributions.length && !frame.knownIntersections.length) {
    return {
      scoreVersion: POPULATION_FIT_VERSION,
      status: 'UNMEASURED',
      overall: null,
      components: {
        geographyCoverage: null,
        marginalCoverage: null,
        intersectionCoverage: null,
        sourceQuality: null,
        sourceRecency: null,
        weightingQuality: null,
      },
      formula: 'No aggregate is calculated until supported population variables and source datasets are present. When measured, every component and weight is reported alongside the aggregate.',
    };
  }

  const qualityScores = { CURATED_OFFICIAL: 100, USER_DECLARED_OFFICIAL: 60, UNVERIFIED: 20 };
  const geographyMatches = frame.officialSourceDatasets.filter((dataset) => dataset.geography.localeCompare(market, undefined, { sensitivity: 'base' }) === 0).length;
  const components = {
    geographyCoverage: frame.officialSourceDatasets.length ? Math.round((geographyMatches / frame.officialSourceDatasets.length) * 100) : null,
    marginalCoverage: frame.marginalDistributions.length ? 100 : 0,
    intersectionCoverage: frame.knownIntersections.length ? 100 : 0,
    sourceQuality: frame.officialSourceDatasets.length
      ? Math.round(frame.officialSourceDatasets.reduce((sum, dataset) => sum + qualityScores[dataset.verificationStatus], 0) / frame.officialSourceDatasets.length)
      : null,
    sourceRecency: frame.officialSourceDatasets.length && frame.officialSourceDatasets.every((dataset) => dataset.recency)
      ? Math.round(frame.officialSourceDatasets.reduce((sum, dataset) => sum + dataset.recency.score, 0) / frame.officialSourceDatasets.length)
      : null,
    weightingQuality,
  };
  const overall = Math.round(Object.entries(POPULATION_FIT_WEIGHTS).reduce((sum, [component, weight]) => sum + (components[component] ?? 0) * weight, 0));
  return {
    scoreVersion: POPULATION_FIT_VERSION,
    status: Object.values(components).every(Number.isFinite) ? 'MEASURED' : 'PARTIAL',
    overall,
    components,
    formula: POPULATION_FIT_FORMULA,
  };
}

export function buildPopulationFrame({
  audience,
  market = 'Global',
  searchCountry = null,
  outputLocale = 'en-US',
  sourceLanguages = [],
  populationFrame = {},
} = {}) {
  const structured = populationFrameInputSchema.parse(populationFrame);
  validateStructuredFrame(structured);
  const hasStructuredCoverage = structured.officialSourceDatasets.length || structured.marginalDistributions.length || structured.knownIntersections.length;
  const weightingResult = weightingFor(structured);
  const defaultUnsupported = hasStructuredCoverage ? [] : ['Demographic and firmographic characteristics were not supplied as structured population data.'];
  return populationFrameSchema.parse({
    frameVersion: POPULATION_FRAME_VERSION,
    intendedPopulation: structured.intendedPopulation || audience,
    geography: { market, countryCode: searchCountry },
    languages: { outputLocale, sourceLanguages },
    characteristics: characteristicsFor(structured),
    officialSourceDatasets: structured.officialSourceDatasets,
    marginalDistributions: structured.marginalDistributions,
    knownIntersections: structured.knownIntersections,
    populationCells: weightingResult.cells,
    weighting: weightingResult.weighting,
    unsupportedCharacteristics: [...new Set([...structured.unsupportedCharacteristics, ...weightingResult.unsupported, ...defaultUnsupported])],
    coverageDate: structured.coverageDate,
    populationFit: fitFor({ frame: structured, market, weightingQuality: weightingResult.weightingQuality }),
    disclaimer: ATTITUDINAL_ACCURACY_DISCLAIMER,
  });
}
