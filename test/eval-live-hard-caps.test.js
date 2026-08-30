import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { runLiveEvaluation } from '../scripts/eval-live.js';

const fixture = {
  id: 'fixture-1',
  prompt: 'Would operators adopt this workspace for shift planning?',
  audience: 'Operations leaders',
  market: 'US',
  locale: 'en-US',
  mode: 'PRIOR_ONLY',
  depth: 'Quick',
  panelSize: 100,
};

function validResult(secretText = 'private source text') {
  return {
    study: {
      title: 'Workspace adoption',
      summary: 'The model-generated result is directional and uncertain.',
      takeaway: 'Use this as a planning hypothesis and validate with real participants.',
      distribution: [10, 20, 30, 25, 15],
      confidence: 'Low',
      confidenceNote: 'Synthetic only; validate with human research before deciding.',
      audienceSummary: { audienceLabel: 'Leaders', contextLabel: 'Operations', attributes: [{ label: 'Role', value: 'Ops' }, { label: 'Need', value: 'Planning' }, { label: 'Team', value: 'Shift' }] },
      segments: ['A', 'B', 'C', 'D'].map((label) => ({ label, values: [10, 20, 30, 25, 15] })),
      responses: [1, 2, 3, 4].map((score) => ({ score, profile: 'Synthetic persona', quote: 'This quote must never be persisted by the live eval harness.' })),
      cautions: ['Synthetic output only.', 'Validate with real participants.'],
    },
    meta: { evidenceMode: 'PRIOR_ONLY', outputLocale: 'en-US', modelLineage: [{ stage: 'panel', requestedModel: 'test-model' }] },
    run: {
      evidence: { mode: 'PRIOR_ONLY', ledger: [], source: secretText },
      modelLineage: [{ stage: 'panel', requestedModel: 'test-model' }],
      economics: { tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, gatewayCost: { exactTotalUsd: '0.01' } },
    },
  };
}

test('live eval remains disabled by default and performs no network work', async () => {
  let calls = 0;
  const report = await runLiveEvaluation({ fetchImpl: async () => { calls += 1; } });

  assert.equal(report.status, 'disabled');
  assert.equal(report.runs, 0);
  assert.equal(calls, 0);
});

test('live eval enforces hard caps for runs, duration, cost, and output bytes', async () => {
  await assert.rejects(
    () => runLiveEvaluation({ enabled: true, fixtures: Array.from({ length: 6 }, (_, index) => ({ ...fixture, id: `fixture-${index}` })), maxRuns: 10 }),
    /hard cap/i,
  );
  await assert.rejects(
    () => runLiveEvaluation({ enabled: true, fixtures: [fixture], maxDurationMs: 0 }),
    /duration/i,
  );
  await assert.rejects(
    () => runLiveEvaluation({ enabled: true, fixtures: [fixture], maxCostUsd: 0.01, estimatedCostPerRunUsd: 0.02 }),
    /cost/i,
  );
  await assert.rejects(
    () => runLiveEvaluation({
      enabled: true,
      fixtures: [fixture],
      maxOutputBytes: 32,
      fetchImpl: async () => ({ ok: true, json: async () => validResult() }),
    }),
    /output/i,
  );
});

test('live eval writes only compact non-telemetry rows and passes an abort signal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-eval-'));
  const outputPath = join(directory, 'live-results.jsonl');
  let sawSignal = false;
  try {
    const report = await runLiveEvaluation({
      enabled: true,
      fixtures: [fixture],
      maxRuns: 1,
      maxCostUsd: 1,
      maxDurationMs: 30_000,
      outputPath,
      fetchImpl: async (url, init) => {
        sawSignal = Boolean(init.signal);
        return { ok: true, json: async () => validResult('secret source body') };
      },
    });
    const output = await readFile(outputPath, 'utf8');

    assert.equal(report.status, 'completed');
    assert.equal(sawSignal, true);
    assert.equal(output.includes(fixture.prompt), false);
    assert.equal(output.includes('secret source body'), false);
    assert.equal(output.includes('quote must never'), false);
    assert.equal(output.includes('"result"'), false);
    assert.match(output, /"fixtureId":"fixture-1"/);
    assert.match(output, /"failedChecks"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
