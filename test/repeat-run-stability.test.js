import assert from 'node:assert/strict';
import test from 'node:test';

import { compareRepeatRuns } from '../src/lib/repeatRunStability.js';

const run = (runId, distribution, overrides = {}) => ({
  distribution,
  meta: {
    runId,
    inputHash: 'input-a',
    evidenceHash: 'evidence-a',
    populationFrameHash: 'frame-a',
    ...overrides,
  },
});

test('repeat-run comparison reports low variation without calling it accuracy', () => {
  const comparison = compareRepeatRuns([
    run('run-1', [10, 20, 30, 25, 15]),
    run('run-2', [11, 19, 29, 26, 15]),
    run('run-3', [9, 21, 30, 24, 16]),
  ]);

  assert.equal(comparison.status, 'COMPARABLE');
  assert.equal(comparison.convergence, 'LOW_VARIATION');
  assert.equal(comparison.runCount, 3);
  assert.equal(comparison.metrics.maxPercentagePointSpread, 2);
  assert.equal(comparison.metrics.topTwoBoxSpread, 1);
  assert.match(comparison.disclaimer, /not accuracy/i);
});

test('repeat-run comparison flags material variation and evidence changes', () => {
  const comparison = compareRepeatRuns([
    run('run-1', [5, 10, 20, 35, 30]),
    run('run-2', [20, 25, 25, 20, 10], { evidenceHash: 'evidence-b' }),
  ]);

  assert.equal(comparison.status, 'COMPARABLE');
  assert.equal(comparison.convergence, 'MATERIAL_VARIATION');
  assert.equal(comparison.lineage.evidenceChanged, true);
  assert.ok(comparison.metrics.maxPercentagePointSpread > comparison.thresholds.maxPercentagePointSpread);
});

test('repeat-run comparison refuses to combine different study inputs', () => {
  const comparison = compareRepeatRuns([
    run('run-1', [10, 20, 30, 25, 15]),
    run('run-2', [10, 20, 30, 25, 15], { inputHash: 'input-b' }),
  ]);

  assert.equal(comparison.status, 'NOT_COMPARABLE');
  assert.equal(comparison.convergence, 'NOT_ASSESSED');
});
