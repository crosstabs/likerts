import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPopulationFrame, populationFrameSchema, rakePopulationCells } from './population-frame.js';

test('every study receives an explicit population frame when no demographic data is supplied', () => {
  const frame = buildPopulationFrame({
    audience: 'Adults expecting to replace a vehicle within 36 months who live in urban apartments',
    market: 'Spain',
    outputLocale: 'es-ES',
    sourceLanguages: ['es'],
  });

  assert.equal(populationFrameSchema.safeParse(frame).success, true);
  assert.equal(frame.frameVersion, 'population-frame-v1');
  assert.equal(frame.intendedPopulation, 'Adults expecting to replace a vehicle within 36 months who live in urban apartments');
  assert.deepEqual(frame.geography, { market: 'Spain', countryCode: null });
  assert.deepEqual(frame.languages, { outputLocale: 'es-ES', sourceLanguages: ['es'] });
  assert.deepEqual(frame.officialSourceDatasets, []);
  assert.deepEqual(frame.marginalDistributions, []);
  assert.deepEqual(frame.knownIntersections, []);
  assert.equal(frame.weighting.method, 'NONE');
  assert.equal(frame.weighting.status, 'NOT_APPLIED');
  assert.equal(frame.populationFit.status, 'UNMEASURED');
  assert.equal(frame.populationFit.overall, null);
  assert.ok(frame.unsupportedCharacteristics.includes('Demographic and firmographic characteristics were not supplied as structured population data.'));
  assert.match(frame.disclaimer, /demographic fit does not prove attitudinal accuracy/i);
});

test('structured official marginals produce a decomposed partial fit using only declared targets', () => {
  const frame = buildPopulationFrame({
    audience: 'Adults expecting to replace a vehicle within 36 months',
    market: 'Spain',
    searchCountry: 'ES',
    outputLocale: 'es-ES',
    sourceLanguages: ['es'],
    populationFrame: {
      officialSourceDatasets: [{
        id: 'ine-age-2025',
        title: 'Population by age group',
        publisher: 'Instituto Nacional de Estadistica',
        url: 'https://www.ine.es/example',
        coverageDate: '2025-01-01',
        geography: 'Spain',
        variables: ['age'],
        verificationStatus: 'USER_DECLARED_OFFICIAL',
      }],
      marginalDistributions: [{
        variable: 'age',
        label: 'Age group',
        sourceDatasetId: 'ine-age-2025',
        categories: [
          { value: '18-34', share: 0.3 },
          { value: '35-54', share: 0.4 },
          { value: '55+', share: 0.3 },
        ],
      }],
      unsupportedCharacteristics: ['Vehicle replacement intent remains unvalidated.'],
      coverageDate: '2025-01-01',
    },
  });

  assert.equal(populationFrameSchema.safeParse(frame).success, true);
  assert.equal(frame.officialSourceDatasets[0].verificationStatus, 'USER_DECLARED_OFFICIAL');
  assert.deepEqual(frame.characteristics, [{ variable: 'age', label: 'Age group', support: 'MARGINAL', sourceDatasetIds: ['ine-age-2025'] }]);
  assert.equal(frame.weighting.method, 'POST_STRATIFICATION');
  assert.equal(frame.weighting.status, 'CONVERGED');
  assert.equal(frame.populationFit.status, 'PARTIAL');
  assert.equal(typeof frame.populationFit.overall, 'number');
  assert.equal(frame.populationFit.components.marginalCoverage, 100);
  assert.equal(frame.populationFit.components.intersectionCoverage, 0);
  assert.equal(frame.populationFit.components.sourceQuality, 60);
  assert.match(frame.populationFit.formula, /20% geography/i);
  assert.deepEqual(frame.unsupportedCharacteristics, ['Vehicle replacement intent remains unvalidated.']);
});

test('population fit uses injected registry recency metadata without consulting the system clock', () => {
  const frame = buildPopulationFrame({
    audience: 'Usual resident adults',
    market: 'Exampleland',
    searchCountry: 'XZ',
    populationFrame: {
      officialSourceDatasets: [{
        id: 'invented-source',
        title: 'Invented population table',
        publisher: 'Example Statistics Office',
        url: 'https://statistics.example.org/invented',
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
        variable: 'age', label: 'Age group', sourceDatasetId: 'invented-source',
        categories: [{ value: '18-34', share: 0.4 }, { value: '35+', share: 0.6 }],
      }],
      coverageDate: '2025-01-15',
    },
  });

  assert.equal(frame.populationFit.components.sourceRecency, 100);
  assert.equal(frame.populationFit.status, 'MEASURED');

  assert.throws(() => buildPopulationFrame({
    audience: 'Usual resident adults',
    market: 'Exampleland',
    populationFrame: {
      officialSourceDatasets: [{
        ...frame.officialSourceDatasets[0],
        recency: { ...frame.officialSourceDatasets[0].recency, ageDays: 1 },
      }],
    },
  }), /ageDays must equal/i);
});

test('population source records reject local and private network targets', () => {
  assert.throws(() => buildPopulationFrame({
    audience: 'Adults in Spain',
    market: 'Spain',
    populationFrame: {
      officialSourceDatasets: [{
        id: 'unsafe-source',
        title: 'Unsafe source',
        publisher: 'Untrusted publisher',
        url: 'http://127.0.0.1/private',
        coverageDate: '2025-01-01',
        geography: 'Spain',
        variables: ['age'],
        verificationStatus: 'UNVERIFIED',
      }],
    },
  }), /safe public http\(s\) URL/i);
});

test('raking converges seed cells to known marginal distributions with auditable diagnostics', () => {
  const marginals = [
    {
      variable: 'age', label: 'Age group', sourceDatasetId: 'source',
      categories: [{ value: '18-34', share: 0.4 }, { value: '35+', share: 0.6 }],
    },
    {
      variable: 'region', label: 'Region', sourceDatasetId: 'source',
      categories: [{ value: 'north', share: 0.3 }, { value: 'south', share: 0.7 }],
    },
  ];
  const result = rakePopulationCells({
    cells: [
      { id: 'young-north', dimensions: { age: '18-34', region: 'north' }, baseWeight: 8 },
      { id: 'young-south', dimensions: { age: '18-34', region: 'south' }, baseWeight: 2 },
      { id: 'older-north', dimensions: { age: '35+', region: 'north' }, baseWeight: 1 },
      { id: 'older-south', dimensions: { age: '35+', region: 'south' }, baseWeight: 9 },
    ],
    marginalDistributions: marginals,
    knownIntersections: [],
    tolerance: 1e-8,
    maxIterations: 500,
  });

  assert.equal(result.status, 'CONVERGED');
  assert.ok(result.diagnostics.iterations > 0);
  assert.ok(result.diagnostics.maxAbsoluteError <= 1e-8);
  assert.equal(result.cells.reduce((sum, cell) => sum + cell.weight, 0), 1);
  const share = (variable, value) => result.cells.filter((cell) => cell.dimensions[variable] === value).reduce((sum, cell) => sum + cell.weight, 0);
  assert.ok(Math.abs(share('age', '18-34') - 0.4) <= 1e-8);
  assert.ok(Math.abs(share('age', '35+') - 0.6) <= 1e-8);
  assert.ok(Math.abs(share('region', 'north') - 0.3) <= 1e-8);
  assert.ok(Math.abs(share('region', 'south') - 0.7) <= 1e-8);
  assert.ok(result.diagnostics.effectiveCellCount > 0);
  assert.ok(result.diagnostics.maxWeight >= result.diagnostics.minWeight);
});

test('a structured frame materializes bounded weighted population cells before simulation', () => {
  const source = {
    id: 'official-source', title: 'Official population table', publisher: 'National statistics office',
    url: 'https://example.gov/population', coverageDate: '2025-01-01', geography: 'Spain',
    variables: ['age', 'region'], verificationStatus: 'CURATED_OFFICIAL',
  };
  const frame = buildPopulationFrame({
    audience: 'Adults in Spain', market: 'Spain', searchCountry: 'ES', outputLocale: 'es-ES',
    populationFrame: {
      officialSourceDatasets: [source],
      marginalDistributions: [
        { variable: 'age', label: 'Age', sourceDatasetId: source.id, categories: [{ value: '18-34', share: 0.4 }, { value: '35+', share: 0.6 }] },
        { variable: 'region', label: 'Region', sourceDatasetId: source.id, categories: [{ value: 'north', share: 0.3 }, { value: 'south', share: 0.7 }] },
      ],
      unsupportedCharacteristics: ['Purchase intent remains unvalidated.'],
      coverageDate: '2025-01-01',
    },
  });

  assert.equal(frame.populationCells.length, 4);
  assert.equal(frame.weighting.method, 'RAKING_IPF');
  assert.equal(frame.weighting.status, 'CONVERGED');
  assert.ok(frame.weighting.diagnostics.maxAbsoluteError <= frame.weighting.diagnostics.tolerance);
  assert.equal(frame.populationFit.components.weightingQuality, 100);
  assert.equal(frame.populationCells.reduce((sum, cell) => sum + cell.weight, 0), 1);
  const ageShare = frame.populationCells.filter((cell) => cell.dimensions.age === '18-34').reduce((sum, cell) => sum + cell.weight, 0);
  assert.ok(Math.abs(ageShare - 0.4) <= frame.weighting.diagnostics.tolerance);
});
