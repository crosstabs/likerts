import assert from 'node:assert/strict';
import test from 'node:test';
import { researchSignalsFor } from '../src/lib/researchMeta.js';

test('research signals show only values returned by the API', () => {
  const signals = researchSignalsFor({
    credibility: { stability: 'High', ensemble: { models: 3, agreement: '82%' } },
    meta: {
      provenance: { inputHash: 'input-123', evidenceHash: 'evidence-456' },
      ownerCost: { amount: 0.04, currency: 'USD', estimated: true },
      sourceFreshness: '2026-08-20',
    },
  });

  assert.deepEqual(signals, {
    stability: 'High',
    ensemble: '3 models · 82%',
    provenance: 'input-123 · evidence-456',
    ownerCost: { amount: 0.04, currency: 'USD', estimated: true },
    sourceFreshness: '2026-08-20',
  });
});

test('research signals use neutral absences for legacy responses', () => {
  assert.deepEqual(researchSignalsFor({ credibility: {}, meta: {} }), {
    stability: null,
    ensemble: null,
    provenance: null,
    ownerCost: null,
    sourceFreshness: null,
  });
});

test('research signals preserve canonical Deep cohort and stability metadata', () => {
  const signals = researchSignalsFor({
    meta: {
      cohort: { completedCells: 5, plannedCells: 6 },
      stability: { applicable: true, maxPercentagePointSpread: 9, meanJensenShannonDivergence: 0.031 },
      economics: { currency: 'USD', gatewayCost: { exactTotalUsd: '0.018', reporting: 'complete' } },
      reproducibility: { inputHash: 'input-789', evidenceHash: 'evidence-012' },
    },
  });

  assert.deepEqual(signals.ensemble, { completedCells: 5, plannedCells: 6 });
  assert.deepEqual(signals.stability, { applicable: true, maxPercentagePointSpread: 9, meanJensenShannonDivergence: 0.031 });
  assert.deepEqual(signals.ownerCost, { amount: 0.018, currency: 'USD', estimated: false });
  assert.equal(signals.provenance, 'input-789 · evidence-012');
});
