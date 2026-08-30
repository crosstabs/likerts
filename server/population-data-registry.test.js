import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePopulationSourceRecency,
  lookupCuratedPopulationDatasets,
  resolvePopulationUniverse,
  toPopulationFrameRegistryInput,
  toPublicPopulationDataRegistry,
  validatePopulationDataRegistry,
} from './population-data-registry.js';

function inventedDataset(overrides = {}) {
  return {
    id: 'example-statistics-age-2025',
    registryOwnership: 'LIKERTS_REGISTRY',
    title: 'Invented population by age group',
    publisher: {
      name: 'Example National Statistics Office',
      kind: 'NATIONAL_STATISTICS_OFFICE',
      homepageUrl: 'https://statistics.example.org/',
    },
    licence: {
      name: 'Example Open Data Licence',
      url: 'https://statistics.example.org/licence',
      redistribution: 'PERMITTED_WITH_ATTRIBUTION',
      attribution: 'Example National Statistics Office, invented test fixture.',
    },
    release: {
      releaseId: 'example-release-2025',
      publishedDate: '2025-02-01',
      sourceUrl: 'https://statistics.example.org/releases/example-2025',
      tableIds: ['EXAMPLE-TABLE-1'],
    },
    geography: {
      countryCode: 'XZ',
      name: 'Exampleland',
      level: 'NATIONAL',
      codes: ['XZ'],
    },
    universe: {
      universeId: 'usual-resident-adults',
      label: 'Usual residents aged 18 years or older',
      inclusions: ['Usual residents aged 18 years or older'],
      exclusions: ['People younger than 18 years'],
      broaderContextForUniverseIds: [],
    },
    denominator: {
      label: 'Usual resident adults',
      unit: 'PERSONS',
      value: 1000,
    },
    coverage: {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      referenceDate: '2025-01-15',
    },
    retrievedAt: '2025-02-10T12:00:00.000Z',
    variables: [{
      id: 'age',
      label: 'Age group',
      sourceField: 'AGE_GROUP',
      transformationId: 'age-bands-v1',
      categories: [
        { code: '18-34', label: '18 to 34', sourceValues: ['18-24', '25-34'], share: 0.4 },
        { code: '35+', label: '35 or older', sourceValues: ['35-54', '55+'], share: 0.6 },
      ],
    }],
    intersections: [],
    transformations: [{
      id: 'age-bands-v1',
      method: 'AGGREGATION',
      description: 'Aggregate invented source categories into two analysis bands.',
      inputFields: ['AGE_GROUP'],
      outputVariableIds: ['age'],
      steps: ['Sum source counts by declared category mapping.', 'Divide each category count by the declared denominator.'],
    }],
    hashes: {
      algorithm: 'SHA-256',
      sourceArtifact: 'a'.repeat(64),
      registryRecord: 'b'.repeat(64),
    },
    review: {
      status: 'APPROVED',
      reviewedAt: '2025-02-12T12:00:00.000Z',
      reviewerRole: 'DATA_STEWARD',
      notes: ['Invented fixture; not a real source claim.'],
    },
    ...overrides,
  };
}

function inventedIntersectionDataset() {
  const dataset = inventedDataset();
  dataset.variables.push({
    id: 'region',
    label: 'Region',
    sourceField: 'REGION',
    transformationId: 'region-direct-v1',
    categories: [
      { code: 'north', label: 'North', sourceValues: ['N'], share: 0.3 },
      { code: 'south', label: 'South', sourceValues: ['S'], share: 0.7 },
    ],
  });
  dataset.transformations.push({
    id: 'region-direct-v1',
    method: 'DIRECT',
    description: 'Map invented source regions directly.',
    inputFields: ['REGION'],
    outputVariableIds: ['region'],
    steps: ['Map source region codes to registry categories.'],
  });
  dataset.intersections = [{
    id: 'age-by-region',
    label: 'Age group by region',
    variableIds: ['age', 'region'],
    transformationId: 'age-region-joint-v1',
    cells: [
      { dimensions: { age: '18-34', region: 'north' }, share: 0.1 },
      { dimensions: { age: '18-34', region: 'south' }, share: 0.3 },
      { dimensions: { age: '35+', region: 'north' }, share: 0.2 },
      { dimensions: { age: '35+', region: 'south' }, share: 0.4 },
    ],
  }];
  dataset.transformations.push({
    id: 'age-region-joint-v1',
    method: 'AGGREGATION',
    description: 'Aggregate invented joint counts by age group and region.',
    inputFields: ['AGE_GROUP', 'REGION'],
    outputVariableIds: ['age', 'region'],
    steps: ['Group source counts by both mapped dimensions.', 'Divide joint counts by the declared denominator.'],
  });
  return dataset;
}

test('an empty population-data registry publishes an honest zero state', () => {
  const published = toPublicPopulationDataRegistry({
    schemaVersion: 'population-data-registry-v1',
    registryVersion: 1,
    datasets: [],
  });

  assert.deepEqual(published, {
    schemaVersion: 'population-data-registry-v1',
    registryVersion: 1,
    status: 'NO_CURATED_DATASETS',
    curatedDatasetCount: 0,
    datasets: [],
    boundary: 'No curated official population datasets are currently available. User-declared or retrieved sources must not be represented as registry-curated.',
  });
});

test('only an approved registry-owned record becomes a curated official population-frame input', () => {
  const registry = validatePopulationDataRegistry({
    schemaVersion: 'population-data-registry-v1',
    registryVersion: 1,
    datasets: [inventedDataset()],
  });

  const matches = lookupCuratedPopulationDatasets(registry, { countryCode: 'xz', variableIds: ['age'] });
  assert.equal(matches.length, 1);

  const published = toPublicPopulationDataRegistry(registry);
  assert.equal(published.status, 'CURATED_DATASETS_AVAILABLE');
  assert.equal(published.curatedDatasetCount, 1);
  assert.equal(published.datasets[0].review.status, 'APPROVED');
  assert.equal(published.datasets[0].licence.attribution, 'Example National Statistics Office, invented test fixture.');

  assert.deepEqual(toPopulationFrameRegistryInput(registry, {
    countryCode: 'XZ', universeId: 'usual-resident-adults', variableIds: ['age'], asOfDate: '2026-01-15',
  }), {
    officialSourceDatasets: [{
      id: 'example-statistics-age-2025',
      title: 'Invented population by age group',
      publisher: 'Example National Statistics Office',
      url: 'https://statistics.example.org/releases/example-2025',
      coverageDate: '2025-01-15',
      geography: 'Exampleland',
      variables: ['age'],
      verificationStatus: 'CURATED_OFFICIAL',
      recency: {
        version: 'population-source-recency-v1',
        asOfDate: '2026-01-15',
        referenceDate: '2025-01-15',
        ageDays: 365,
        status: 'CURRENT',
        score: 100,
        thresholdsDays: { currentMaximum: 730, agingMaximum: 1825 },
      },
    }],
    marginalDistributions: [{
      variable: 'age',
      label: 'Age group',
      sourceDatasetId: 'example-statistics-age-2025',
      categories: [
        { value: '18-34', share: 0.4 },
        { value: '35+', share: 0.6 },
      ],
    }],
    knownIntersections: [],
    coverageDate: '2025-01-15',
  });
});

test('population universes resolve explicitly as exact, broader context, or no match', () => {
  const exact = inventedDataset();
  const broader = inventedDataset({
    id: 'example-statistics-all-residents-2025',
    universe: {
      universeId: 'all-usual-residents',
      label: 'All usual residents',
      inclusions: ['All usual residents'],
      exclusions: [],
      broaderContextForUniverseIds: ['vehicle-replacement-intenders'],
    },
  });
  const registry = {
    schemaVersion: 'population-data-registry-v1',
    registryVersion: 1,
    datasets: [exact, broader],
  };

  assert.equal(resolvePopulationUniverse(registry, {
    countryCode: 'XZ', universeId: 'usual-resident-adults', variableIds: ['age'],
  }).status, 'EXACT_POPULATION_UNIVERSE');
  assert.equal(resolvePopulationUniverse(registry, {
    countryCode: 'XZ', universeId: 'vehicle-replacement-intenders', variableIds: ['age'],
  }).status, 'BROADER_CONTEXT_ONLY');
  assert.equal(resolvePopulationUniverse(registry, {
    countryCode: 'XZ', universeId: 'unrelated-firms', variableIds: ['age'],
  }).status, 'NO_MATCH');
  assert.deepEqual(toPopulationFrameRegistryInput(registry, {
    countryCode: 'XZ', universeId: 'vehicle-replacement-intenders', variableIds: ['age'], asOfDate: '2026-01-15',
  }), {
    officialSourceDatasets: [], marginalDistributions: [], knownIntersections: [], coverageDate: null,
  });
});

test('registry-known intersections map into exact-universe population-frame constraints', () => {
  const registry = {
    schemaVersion: 'population-data-registry-v1',
    registryVersion: 1,
    datasets: [inventedIntersectionDataset()],
  };

  const frameInput = toPopulationFrameRegistryInput(registry, {
    countryCode: 'XZ', universeId: 'usual-resident-adults', variableIds: ['age', 'region'], asOfDate: '2026-01-15',
  });
  assert.deepEqual(frameInput.knownIntersections, [{
    id: 'age-by-region',
    label: 'Age group by region',
    variables: ['age', 'region'],
    cells: [
      { dimensions: { age: '18-34', region: 'north' }, share: 0.1 },
      { dimensions: { age: '18-34', region: 'south' }, share: 0.3 },
      { dimensions: { age: '35+', region: 'north' }, share: 0.2 },
      { dimensions: { age: '35+', region: 'south' }, share: 0.4 },
    ],
    sourceDatasetId: 'example-statistics-age-2025',
  }]);
});

test('source recency is deterministic, versioned, threshold-visible, and rejects future coverage', () => {
  assert.deepEqual(computePopulationSourceRecency({ referenceDate: '2025-01-01', asOfDate: '2027-01-01' }), {
    version: 'population-source-recency-v1',
    asOfDate: '2027-01-01',
    referenceDate: '2025-01-01',
    ageDays: 730,
    status: 'CURRENT',
    score: 100,
    thresholdsDays: { currentMaximum: 730, agingMaximum: 1825 },
  });
  assert.equal(computePopulationSourceRecency({ referenceDate: '2025-01-01', asOfDate: '2027-01-02' }).status, 'AGING');
  assert.equal(computePopulationSourceRecency({ referenceDate: '2020-01-01', asOfDate: '2026-01-01' }).status, 'STALE');
  assert.throws(() => computePopulationSourceRecency({
    referenceDate: '2027-01-01', asOfDate: '2026-01-01',
  }), /future/i);
});

test('a variable cannot map the same source category into two published categories', () => {
  const dataset = inventedDataset();
  dataset.variables[0].categories[1].sourceValues.push('25-34');

  assert.throws(() => validatePopulationDataRegistry({
    schemaVersion: 'population-data-registry-v1',
    registryVersion: 1,
    datasets: [dataset],
  }), /source values must not overlap/i);
});

test('validation rejects provenance records that are unsafe, internally inconsistent, or incomplete', () => {
  const registry = (dataset) => ({
    schemaVersion: 'population-data-registry-v1',
    registryVersion: 1,
    datasets: [dataset],
  });

  const unsafe = inventedDataset();
  unsafe.release.sourceUrl = 'http://127.0.0.1/private';
  assert.throws(() => validatePopulationDataRegistry(registry(unsafe)), /safe public http\(s\) URL/i);

  const badHash = inventedDataset();
  badHash.hashes.sourceArtifact = 'not-a-sha-256-digest';
  assert.throws(() => validatePopulationDataRegistry(registry(badHash)), /SHA-256 digest/i);

  const badShares = inventedDataset();
  badShares.variables[0].categories[1].share = 0.5;
  assert.throws(() => validatePopulationDataRegistry(registry(badShares)), /shares must sum to 1/i);

  const postdatedRelease = inventedDataset();
  postdatedRelease.release.publishedDate = '2025-03-01';
  assert.throws(() => validatePopulationDataRegistry(registry(postdatedRelease)), /release cannot postdate retrieval/i);

  const incompleteReview = inventedDataset();
  incompleteReview.review.reviewedAt = null;
  assert.throws(() => validatePopulationDataRegistry(registry(incompleteReview)), /completed reviews require/i);

  const unknownField = inventedDataset({ unreviewedClaim: true });
  assert.throws(() => validatePopulationDataRegistry(registry(unknownField)), /unrecognized key/i);
});

test('pending records remain private to the registry and cannot create a curated claim', () => {
  const pending = inventedDataset({
    review: { status: 'PENDING', reviewedAt: null, reviewerRole: null, notes: ['Awaiting review.'] },
  });
  const registry = {
    schemaVersion: 'population-data-registry-v1',
    registryVersion: 1,
    datasets: [pending],
  };

  assert.deepEqual(lookupCuratedPopulationDatasets(registry, { countryCode: 'XZ' }), []);
  assert.equal(toPublicPopulationDataRegistry(registry).status, 'NO_CURATED_DATASETS');
  assert.deepEqual(toPublicPopulationDataRegistry(registry).datasets, []);
  assert.deepEqual(toPopulationFrameRegistryInput(registry, {
    countryCode: 'XZ', universeId: 'usual-resident-adults', asOfDate: '2026-01-15',
  }), {
    officialSourceDatasets: [],
    marginalDistributions: [],
    knownIntersections: [],
    coverageDate: null,
  });
});
