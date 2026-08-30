import { z } from 'zod';
import { isSafePublicUrl } from './public-url.js';

export const POPULATION_DATA_REGISTRY_VERSION = 'population-data-registry-v1';
export const POPULATION_SOURCE_RECENCY_VERSION = 'population-source-recency-v1';
export const POPULATION_SOURCE_RECENCY_THRESHOLDS_DAYS = Object.freeze({ currentMaximum: 730, agingMaximum: 1825 });
export const NO_CURATED_DATASETS_BOUNDARY = 'No curated official population datasets are currently available. User-declared or retrieved sources must not be represented as registry-curated.';
export const CURATED_DATASETS_BOUNDARY = 'Only approved records owned by the Likerts population-data registry are represented as CURATED_OFFICIAL.';

const identifierSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/);
const dateSchema = z.string().date();
const instantSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest.');
const publicUrlSchema = z.string().trim().url().superRefine((value, context) => {
  if (!isSafePublicUrl(value)) context.addIssue({ code: 'custom', message: 'Registry sources must use a safe public http(s) URL.' });
});
const shortTextSchema = z.string().trim().min(1).max(240);
const unique = (values) => new Set(values).size === values.length;

const categorySchema = z.object({
  code: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  sourceValues: z.array(z.string().trim().min(1).max(160)).min(1).max(100),
  share: z.number().min(0).max(1),
}).strict();

const variableSchema = z.object({
  id: identifierSchema,
  label: z.string().trim().min(1).max(160),
  sourceField: z.string().trim().min(1).max(160),
  transformationId: identifierSchema,
  categories: z.array(categorySchema).min(2).max(100),
}).strict().superRefine((variable, context) => {
  if (!unique(variable.categories.map(({ code }) => code))) {
    context.addIssue({ code: 'custom', path: ['categories'], message: 'Category codes must be unique within a variable.' });
  }
  const sourceValues = variable.categories.flatMap((category) => category.sourceValues);
  if (!unique(sourceValues)) {
    context.addIssue({ code: 'custom', path: ['categories'], message: 'Category source values must not overlap within a variable.' });
  }
  const total = variable.categories.reduce((sum, { share }) => sum + share, 0);
  if (Math.abs(total - 1) > 1e-8) {
    context.addIssue({ code: 'custom', path: ['categories'], message: 'Category shares must sum to 1.' });
  }
});

const transformationSchema = z.object({
  id: identifierSchema,
  method: z.enum(['DIRECT', 'AGGREGATION', 'FILTER', 'DERIVATION', 'NORMALISATION']),
  description: shortTextSchema,
  inputFields: z.array(z.string().trim().min(1).max(160)).min(1).max(100),
  outputVariableIds: z.array(identifierSchema).min(1).max(30),
  steps: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
}).strict();

const intersectionSchema = z.object({
  id: identifierSchema,
  label: z.string().trim().min(1).max(160),
  variableIds: z.array(identifierSchema).min(2).max(5),
  transformationId: identifierSchema,
  cells: z.array(z.object({
    dimensions: z.record(z.string(), z.string().trim().min(1).max(120)),
    share: z.number().min(0).max(1),
  }).strict()).min(1).max(250),
}).strict();

const reviewSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  reviewedAt: instantSchema.nullable(),
  reviewerRole: z.enum(['DATA_STEWARD', 'RESEARCH_METHODS_REVIEWER']).nullable(),
  notes: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict().superRefine((review, context) => {
  const completed = review.status !== 'PENDING';
  if (completed !== Boolean(review.reviewedAt && review.reviewerRole)) {
    context.addIssue({ code: 'custom', message: 'Completed reviews require reviewedAt and reviewerRole; pending reviews require both to be null.' });
  }
});

export const populationDataRegistryDatasetSchema = z.object({
  id: identifierSchema,
  registryOwnership: z.literal('LIKERTS_REGISTRY'),
  title: shortTextSchema,
  publisher: z.object({
    name: z.string().trim().min(1).max(180),
    kind: z.enum(['NATIONAL_STATISTICS_OFFICE', 'INTERGOVERNMENTAL_ORGANIZATION', 'OTHER_OFFICIAL_BODY']),
    homepageUrl: publicUrlSchema,
  }).strict(),
  licence: z.object({
    name: z.string().trim().min(1).max(180),
    url: publicUrlSchema,
    redistribution: z.enum(['PERMITTED', 'PERMITTED_WITH_ATTRIBUTION', 'RESTRICTED', 'UNKNOWN']),
    attribution: z.string().trim().min(1).max(500),
  }).strict(),
  release: z.object({
    releaseId: z.string().trim().min(1).max(160),
    publishedDate: dateSchema,
    sourceUrl: publicUrlSchema,
    tableIds: z.array(z.string().trim().min(1).max(160)).min(1).max(100),
  }).strict(),
  geography: z.object({
    countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
    name: z.string().trim().min(1).max(160),
    level: z.enum(['NATIONAL', 'REGION', 'LOCAL', 'OTHER']),
    codes: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  }).strict(),
  universe: z.object({
    universeId: identifierSchema,
    label: z.string().trim().min(1).max(500),
    inclusions: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
    exclusions: z.array(z.string().trim().min(1).max(500)).max(30),
    broaderContextForUniverseIds: z.array(identifierSchema).max(30),
  }).strict(),
  denominator: z.object({
    label: z.string().trim().min(1).max(240),
    unit: z.enum(['PERSONS', 'HOUSEHOLDS', 'FIRMS', 'DWELLINGS', 'OTHER']),
    value: z.number().finite().positive(),
  }).strict(),
  coverage: z.object({
    startDate: dateSchema,
    endDate: dateSchema,
    referenceDate: dateSchema,
  }).strict(),
  retrievedAt: instantSchema,
  variables: z.array(variableSchema).min(1).max(30),
  intersections: z.array(intersectionSchema).max(20),
  transformations: z.array(transformationSchema).min(1).max(100),
  hashes: z.object({
    algorithm: z.literal('SHA-256'),
    sourceArtifact: sha256Schema,
    registryRecord: sha256Schema,
  }).strict(),
  review: reviewSchema,
}).strict().superRefine((dataset, context) => {
  if (dataset.coverage.startDate > dataset.coverage.endDate) {
    context.addIssue({ code: 'custom', path: ['coverage'], message: 'Coverage startDate must not be after endDate.' });
  }
  if (dataset.coverage.referenceDate < dataset.coverage.startDate || dataset.coverage.referenceDate > dataset.coverage.endDate) {
    context.addIssue({ code: 'custom', path: ['coverage', 'referenceDate'], message: 'Coverage referenceDate must fall within the coverage interval.' });
  }
  if (dataset.release.publishedDate > dataset.retrievedAt.slice(0, 10)) {
    context.addIssue({ code: 'custom', path: ['release', 'publishedDate'], message: 'A source release cannot postdate retrieval.' });
  }
  if (!unique(dataset.release.tableIds)) context.addIssue({ code: 'custom', path: ['release', 'tableIds'], message: 'Release table IDs must be unique.' });
  if (!unique(dataset.geography.codes)) context.addIssue({ code: 'custom', path: ['geography', 'codes'], message: 'Geography codes must be unique.' });
  if (!unique(dataset.variables.map(({ id }) => id))) context.addIssue({ code: 'custom', path: ['variables'], message: 'Variable IDs must be unique.' });
  if (!unique(dataset.intersections.map(({ id }) => id))) context.addIssue({ code: 'custom', path: ['intersections'], message: 'Intersection IDs must be unique.' });
  if (!unique(dataset.transformations.map(({ id }) => id))) context.addIssue({ code: 'custom', path: ['transformations'], message: 'Transformation IDs must be unique.' });

  const variableIds = new Set(dataset.variables.map(({ id }) => id));
  const variables = new Map(dataset.variables.map((item) => [item.id, item]));
  const transformations = new Map(dataset.transformations.map((item) => [item.id, item]));
  dataset.variables.forEach((variable, index) => {
    const transformation = transformations.get(variable.transformationId);
    if (!transformation || !transformation.outputVariableIds.includes(variable.id)) {
      context.addIssue({ code: 'custom', path: ['variables', index, 'transformationId'], message: 'Each variable must reference a transformation that declares it as an output.' });
    }
  });
  dataset.transformations.forEach((transformation, index) => {
    if (!unique(transformation.outputVariableIds) || transformation.outputVariableIds.some((id) => !variableIds.has(id))) {
      context.addIssue({ code: 'custom', path: ['transformations', index, 'outputVariableIds'], message: 'Transformation outputs must be unique declared variable IDs.' });
    }
  });
  dataset.intersections.forEach((intersection, index) => {
    const path = ['intersections', index];
    if (!unique(intersection.variableIds) || intersection.variableIds.some((id) => !variableIds.has(id))) {
      context.addIssue({ code: 'custom', path: [...path, 'variableIds'], message: 'Intersection variable IDs must be unique declared variables.' });
      return;
    }
    const transformation = transformations.get(intersection.transformationId);
    if (!transformation || intersection.variableIds.some((id) => !transformation.outputVariableIds.includes(id))) {
      context.addIssue({ code: 'custom', path: [...path, 'transformationId'], message: 'Each intersection must reference a transformation that declares all intersection variables.' });
    }

    const expectedKeys = [...intersection.variableIds].sort();
    const cellKeys = [];
    intersection.cells.forEach((cell, cellIndex) => {
      if (JSON.stringify(Object.keys(cell.dimensions).sort()) !== JSON.stringify(expectedKeys)) {
        context.addIssue({ code: 'custom', path: [...path, 'cells', cellIndex, 'dimensions'], message: 'Every intersection cell must contain exactly the declared dimensions.' });
        return;
      }
      const valid = intersection.variableIds.every((id) => variables.get(id).categories.some(({ code }) => code === cell.dimensions[id]));
      if (!valid) context.addIssue({ code: 'custom', path: [...path, 'cells', cellIndex, 'dimensions'], message: 'Intersection cell values must be declared variable category codes.' });
      cellKeys.push(intersection.variableIds.map((id) => cell.dimensions[id]).join('\u001f'));
    });
    if (!unique(cellKeys)) context.addIssue({ code: 'custom', path: [...path, 'cells'], message: 'Intersection cells must be unique.' });
    const expectedCellCount = intersection.variableIds.reduce((count, id) => count * variables.get(id).categories.length, 1);
    if (intersection.cells.length !== expectedCellCount) context.addIssue({ code: 'custom', path: [...path, 'cells'], message: 'Intersection cells must cover the complete category cross-product.' });
    const total = intersection.cells.reduce((sum, { share }) => sum + share, 0);
    if (Math.abs(total - 1) > 1e-8) context.addIssue({ code: 'custom', path: [...path, 'cells'], message: 'Intersection cell shares must sum to 1.' });
    intersection.variableIds.forEach((id) => variables.get(id).categories.forEach((category) => {
      const implied = intersection.cells.filter((cell) => cell.dimensions[id] === category.code).reduce((sum, cell) => sum + cell.share, 0);
      if (Math.abs(implied - category.share) > 1e-8) context.addIssue({
        code: 'custom', path: [...path, 'cells'], message: `Intersection shares must reproduce the declared ${id} marginals.`,
      });
    }));
  });
}).superRefine((dataset, context) => {
  if (dataset.review.reviewedAt && Date.parse(dataset.review.reviewedAt) < Date.parse(dataset.retrievedAt)) {
    context.addIssue({ code: 'custom', path: ['review', 'reviewedAt'], message: 'A completed review cannot predate retrieval.' });
  }
});

export const populationDataRegistrySchema = z.object({
  schemaVersion: z.literal(POPULATION_DATA_REGISTRY_VERSION),
  registryVersion: z.number().int().positive(),
  datasets: z.array(populationDataRegistryDatasetSchema).max(100),
}).strict().superRefine((registry, context) => {
  if (!unique(registry.datasets.map(({ id }) => id))) {
    context.addIssue({ code: 'custom', path: ['datasets'], message: 'Registry dataset IDs must be unique.' });
  }
});

const lookupSchema = z.object({
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional(),
  variableIds: z.array(identifierSchema).max(30).optional().default([]),
}).strict().superRefine((query, context) => {
  if (!unique(query.variableIds)) context.addIssue({ code: 'custom', path: ['variableIds'], message: 'Lookup variable IDs must be unique.' });
});

const universeResolutionSchema = lookupSchema.extend({
  universeId: identifierSchema,
});
const frameRegistryQuerySchema = universeResolutionSchema.extend({
  asOfDate: dateSchema,
});

export function validatePopulationDataRegistry(value) {
  return populationDataRegistrySchema.parse(value);
}

export function computePopulationSourceRecency({ referenceDate, asOfDate }) {
  const reference = dateSchema.parse(referenceDate);
  const asOf = dateSchema.parse(asOfDate);
  const ageDays = Math.round((Date.parse(`${asOf}T00:00:00.000Z`) - Date.parse(`${reference}T00:00:00.000Z`)) / 86_400_000);
  if (ageDays < 0) throw new Error('Population source referenceDate cannot be in the future relative to asOfDate.');
  const status = ageDays <= POPULATION_SOURCE_RECENCY_THRESHOLDS_DAYS.currentMaximum
    ? 'CURRENT'
    : ageDays <= POPULATION_SOURCE_RECENCY_THRESHOLDS_DAYS.agingMaximum ? 'AGING' : 'STALE';
  return {
    version: POPULATION_SOURCE_RECENCY_VERSION,
    asOfDate: asOf,
    referenceDate: reference,
    ageDays,
    status,
    score: status === 'CURRENT' ? 100 : status === 'AGING' ? 60 : 20,
    thresholdsDays: { ...POPULATION_SOURCE_RECENCY_THRESHOLDS_DAYS },
  };
}

function curatedDatasets(registry) {
  return validatePopulationDataRegistry(registry).datasets.filter((dataset) => (
    dataset.registryOwnership === 'LIKERTS_REGISTRY' && dataset.review.status === 'APPROVED'
  ));
}

export function lookupCuratedPopulationDatasets(registry, query = {}) {
  const filters = lookupSchema.parse(query);
  return curatedDatasets(registry).filter((dataset) => (
    (!filters.countryCode || dataset.geography.countryCode === filters.countryCode)
    && filters.variableIds.every((id) => dataset.variables.some((variable) => variable.id === id))
  ));
}

export function resolvePopulationUniverse(registry, query) {
  const filters = universeResolutionSchema.parse(query);
  const candidates = lookupCuratedPopulationDatasets(registry, {
    countryCode: filters.countryCode,
    variableIds: filters.variableIds,
  });
  const exactDatasets = candidates.filter((dataset) => dataset.universe.universeId === filters.universeId);
  const broaderContextDatasets = candidates.filter((dataset) => (
    dataset.universe.broaderContextForUniverseIds.includes(filters.universeId)
  ));
  return {
    status: exactDatasets.length
      ? 'EXACT_POPULATION_UNIVERSE'
      : broaderContextDatasets.length ? 'BROADER_CONTEXT_ONLY' : 'NO_MATCH',
    universeId: filters.universeId,
    exactDatasets,
    broaderContextDatasets,
  };
}

export function toPublicPopulationDataRegistry(registry) {
  const parsed = validatePopulationDataRegistry(registry);
  const datasets = parsed.datasets.filter((dataset) => dataset.review.status === 'APPROVED');
  return {
    schemaVersion: parsed.schemaVersion,
    registryVersion: parsed.registryVersion,
    status: datasets.length ? 'CURATED_DATASETS_AVAILABLE' : 'NO_CURATED_DATASETS',
    curatedDatasetCount: datasets.length,
    datasets,
    boundary: datasets.length ? CURATED_DATASETS_BOUNDARY : NO_CURATED_DATASETS_BOUNDARY,
  };
}

export function toPopulationFrameRegistryInput(registry, query = {}) {
  const filters = frameRegistryQuerySchema.parse(query);
  const datasets = resolvePopulationUniverse(registry, {
    countryCode: filters.countryCode,
    universeId: filters.universeId,
    variableIds: filters.variableIds,
  }).exactDatasets;
  const requestedVariables = new Set(filters.variableIds);
  const includesVariable = (id) => !requestedVariables.size || requestedVariables.has(id);
  const coverageDates = datasets.map(({ coverage }) => coverage.referenceDate).sort();

  return {
    officialSourceDatasets: datasets.map((dataset) => ({
      id: dataset.id,
      title: dataset.title,
      publisher: dataset.publisher.name,
      url: dataset.release.sourceUrl,
      coverageDate: dataset.coverage.referenceDate,
      geography: dataset.geography.name,
      variables: dataset.variables.map(({ id }) => id).filter(includesVariable),
      verificationStatus: 'CURATED_OFFICIAL',
      recency: computePopulationSourceRecency({ referenceDate: dataset.coverage.referenceDate, asOfDate: filters.asOfDate }),
    })),
    marginalDistributions: datasets.flatMap((dataset) => dataset.variables.filter(({ id }) => includesVariable(id)).map((variable) => ({
      variable: variable.id,
      label: variable.label,
      sourceDatasetId: dataset.id,
      categories: variable.categories.map(({ code, share }) => ({ value: code, share })),
    }))),
    knownIntersections: datasets.flatMap((dataset) => dataset.intersections
      .filter((intersection) => !requestedVariables.size || intersection.variableIds.every((id) => requestedVariables.has(id)))
      .map((intersection) => ({
        id: intersection.id,
        label: intersection.label,
        variables: intersection.variableIds,
        cells: intersection.cells,
        sourceDatasetId: dataset.id,
      }))),
    coverageDate: coverageDates[0] || null,
  };
}
