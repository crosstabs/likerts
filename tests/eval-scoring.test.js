import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateResult, scoreRepeatability } from '../evals/scoring.js';
import { scoreCapturedResults } from '../scripts/eval-offline.js';
import { evaluationFixtures } from '../evals/fixtures.js';
import { redactForEvaluation, runLiveEvaluation } from '../scripts/eval-live.js';

const valid = {
  study: {
    title: 'Remote work concept',
    distribution: { veryLikely: 20, likely: 30, unsure: 20, unlikely: 20, veryUnlikely: 10 },
    segments: [{ label: 'Parents', distribution: { veryLikely: 25, likely: 25, unsure: 20, unlikely: 20, veryUnlikely: 10 } }],
    responses: [{ score: 4, profile: 'Parent', quote: 'The flexible option may fit my routine.' }],
    uncertainty: { level: 'medium', note: 'Directional only.' },
  },
  meta: {
    runId: 'run_eval_001', outputLocale: 'en-US', evidenceMode: 'EXA_HIGHLIGHTS',
    modelLineage: [{ stage: 'panel', requestedModel: 'test/model', resolvedModel: 'test/model', promptHash: 'abc' }],
    usage: { inputTokens: 100, outputTokens: 200, estimatedCostUsd: 0.01 },
  },
  run: {
    status: 'completed',
    evidence: { mode: 'EXA_HIGHLIGHTS', ledger: [{ url: 'https://example.com/source', title: 'Source', excerpt: 'Evidence', acquisition: 'EXA_HIGHLIGHTS', evidenceClass: 'PUBLIC_WEB_SOURCE' }] },
  },
};

test('valid pipeline-shaped result passes offline contract checks', () => {
  const report = evaluateResult(valid, { locale: 'en-US', mode: 'Deep' });
  assert.equal(report.pass, true);
  assert.equal(report.score, 1);
  assert.ok(report.checks.every((check) => check.pass));
});

test('v2-shaped economics and acquisition provenance are accepted', () => {
  const result = structuredClone(valid);
  delete result.meta.usage;
  result.run.economics = {
    gatewayCost: { exactTotalUsd: '0.006' },
    tokenUsage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
  };
  delete result.run.evidence.ledger[0].evidenceClass;
  result.run.evidence.ledger[0].acquisition = 'EXA_HIGHLIGHTS';
  const report = evaluateResult(result, { locale: 'en-US', mode: 'Deep' });
  assert.equal(report.pass, true);
});

test('distribution arithmetic and provenance failures are surfaced deterministically', () => {
  const result = structuredClone(valid);
  result.study.distribution.veryLikely = 21;
  result.run.evidence.ledger[0].url = 'not-a-url';
  const report = evaluateResult(result, { locale: 'en-US' });
  assert.equal(report.pass, false);
  assert.equal(report.checks.find((check) => check.name === 'distribution-sums').pass, false);
  assert.equal(report.checks.find((check) => check.name === 'citations-provenance').pass, false);
});

test('unsupported human-panel claims fail while synthetic caveats pass', () => {
  const result = structuredClone(valid);
  result.study.takeaway = 'Surveyed customers proved this is representative and statistically significant.';
  const report = evaluateResult(result, { locale: 'en-US' });
  assert.equal(report.checks.find((check) => check.name === 'unsupported-human-claims').pass, false);
});

test('negated representativeness boundaries pass while unexpected scripts fail', () => {
  const bounded = structuredClone(valid);
  bounded.study.takeaway = 'This is not representative, makes no claim of representativeness, and should not be treated as statistically significant.';
  assert.equal(evaluateResult(bounded, { locale: 'en-US' }).checks.find((check) => check.name === 'unsupported-human-claims').pass, true);

  const mixedScript = structuredClone(valid);
  mixedScript.study.title = 'Ease of理解 should not appear in an English report';
  assert.equal(evaluateResult(mixedScript, { locale: 'en-US' }).checks.find((check) => check.name === 'language-script').pass, false);
});

test('captured-result scorer maps fixture IDs and handles empty captures', () => {
  assert.equal(scoreCapturedResults([]).averageScore, null);
  const report = scoreCapturedResults([{ fixtureId: 'en-US-concept', result: valid }], evaluationFixtures);
  assert.equal(report.runs, 1);
  assert.equal(report.rows[0].fixtureId, 'en-US-concept');
});

test('repeatability returns TV, Jensen-Shannon divergence, and max spread', () => {
  const runs = [
    { distribution: [20, 30, 20, 20, 10] },
    { distribution: [22, 28, 20, 20, 10] },
    { distribution: [18, 32, 20, 20, 10] },
  ];
  const metrics = scoreRepeatability(runs);
  assert.equal(metrics.runCount, 3);
  assert.equal(metrics.maxSpread, 4);
  assert.ok(metrics.totalVariation > 0);
  assert.ok(metrics.jensenShannon >= 0 && metrics.jensenShannon <= 1);
});

test('repeatability rejects malformed or empty run collections gracefully', () => {
  assert.deepEqual(scoreRepeatability([]), { runCount: 0, totalVariation: null, jensenShannon: null, maxSpread: null, stable: false });
  assert.equal(scoreRepeatability([{ distribution: [100, 0] }]).stable, false);
});

test('fixture catalog covers all locales, modes, question types, risk, and malformed cases', () => {
  assert.ok(evaluationFixtures.length >= 60);
  assert.equal(new Set(evaluationFixtures.filter((fixture) => !fixture.malformed).map((fixture) => fixture.locale)).size, 10);
  assert.ok(evaluationFixtures.some((fixture) => fixture.risk === 'sensitive'));
  assert.ok(evaluationFixtures.some((fixture) => fixture.malformed));
  assert.ok(evaluationFixtures.some((fixture) => fixture.mode === 'PRIOR_ONLY'));
  assert.ok(evaluationFixtures.some((fixture) => fixture.mode === 'WEB_EVIDENCE'));
  assert.ok(evaluationFixtures.some((fixture) => fixture.depth === 'Quick'));
  assert.ok(evaluationFixtures.some((fixture) => fixture.depth === 'Deep'));
  assert.ok(evaluationFixtures.some((fixture) => fixture.locale === 'ar-SA' && fixture.direction === 'rtl' && fixture.script === 'Arabic'));
  assert.notEqual(evaluationFixtures.find((fixture) => fixture.id === 'es-ES-concept').prompt, evaluationFixtures.find((fixture) => fixture.id === 'en-US-concept').prompt);
  assert.match(evaluationFixtures.find((fixture) => fixture.id === 'ar-SA-concept').prompt, /[\u0600-\u06ff]/);
});

test('live evaluation is disabled by default and performs no network call', async () => {
  let calls = 0;
  const report = await runLiveEvaluation({ fetchImpl: async () => { calls += 1; }, fixtures: evaluationFixtures.slice(0, 1) });
  assert.equal(report.status, 'disabled');
  assert.equal(calls, 0);
});

test('live capture redacts credentials without deleting non-secret token usage', () => {
  assert.deepEqual(redactForEvaluation({
    apiKey: 'secret-value',
    accessToken: 'secret-token',
    tokenUsage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  }), {
    apiKey: '[REDACTED]',
    accessToken: '[REDACTED]',
    tokenUsage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  });
});

test('live evaluation sends additive v2 researchMode in the request body', async () => {
  const requestBodies = [];
  await runLiveEvaluation({
    enabled: true,
    fixtures: [{ ...evaluationFixtures[0], depth: 'Deep' }, { ...evaluationFixtures[1], depth: 'Quick' }],
    maxRuns: 2,
    maxCostUsd: 2,
    outputPath: `/tmp/likerts-eval-${Date.now()}.jsonl`,
    fetchImpl: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => valid };
    },
  });
  assert.deepEqual(requestBodies.map((body) => body.researchMode), ['deep', 'quick']);
});

test('live evaluation enforces run and estimated-cost caps before network calls', async () => {
  await assert.rejects(
    () => runLiveEvaluation({ enabled: true, fixtures: evaluationFixtures.slice(0, 2), maxRuns: 1, estimatedCostPerRunUsd: 1, maxCostUsd: 1.5, fetchImpl: async () => ({}) }),
    /max-runs/i,
  );
  await assert.rejects(
    () => runLiveEvaluation({ enabled: true, fixtures: evaluationFixtures.slice(0, 2), maxRuns: 2, estimatedCostPerRunUsd: 1, maxCostUsd: 1.5, fetchImpl: async () => ({}) }),
    /cost/i,
  );
});
