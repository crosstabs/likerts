import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBlindSyntheticBrief,
  createOutcomeCommitment,
  createSyntheticBriefHash,
  createValidationRunLineage,
  scoreValidationCase,
  summarizeValidationCases,
} from '../evals/validation-lab.js';

const humanOutcome = {
  questions: [
    {
      questionId: 'q1',
      distribution: [10, 15, 20, 30, 25],
      subgroups: [
        { groupId: 'younger', distribution: [5, 10, 15, 35, 35] },
        { groupId: 'older', distribution: [15, 20, 25, 25, 15] },
      ],
    },
    {
      questionId: 'q2',
      distribution: [20, 25, 25, 20, 10],
      subgroups: [
        { groupId: 'younger', distribution: [15, 20, 25, 25, 15] },
        { groupId: 'older', distribution: [25, 30, 25, 15, 5] },
      ],
    },
    {
      questionId: 'q3',
      distribution: [12, 18, 25, 27, 18],
      subgroups: [],
    },
  ],
};

const nonce = 'benchmark-outcome-nonce-123';
const preregistration = {
  protocolVersion: 'validation-case-v1',
  caseId: 'case-workplace-001',
  registeredAt: '2026-08-01T00:00:00.000Z',
  dataset: { id: 'official-study', version: '2026.1', sourceUrl: 'https://example.org/dataset', licence: 'Public research use', fieldStart: '2026-01-01', fieldEnd: '2026-02-01' },
  humanStudy: { sampleSize: 1200, effectiveSampleSize: 914.5 },
  populationFrameHash: 'a'.repeat(64),
  population: 'Working adults ages 18–64',
  market: 'Spain',
  language: 'es-ES',
  weighting: 'Official final survey weight',
  researchMethod: 'CONCEPT_TEST',
  eligibility: { status: 'ELIGIBLE', exactQuestionWording: true, compatibleResponseScale: true, compatiblePopulation: true, heldOutAtSyntheticExecution: true },
  modelPolicy: { runtimeVersion: 'synthetic-research-v2.4', promptVersions: { panel: 'panel-v4' }, schemaVersions: { panel: 'study-schema-v1' }, modelRoutes: ['openai/test-model'] },
  evidencePolicy: 'PRIOR_ONLY',
  questions: [
    { questionId: 'q1', questionType: 'CONCEPT_INTENT', wording: 'Exact human wording one', scaleLabels: ['1', '2', '3', '4', '5'], topTwoIndices: [3, 4] },
    { questionId: 'q2', questionType: 'CONCEPT_INTENT', wording: 'Exact human wording two', scaleLabels: ['1', '2', '3', '4', '5'], topTwoIndices: [3, 4] },
    { questionId: 'q3', questionType: 'CONCEPT_INTENT', wording: 'Exact human wording three', scaleLabels: ['1', '2', '3', '4', '5'], topTwoIndices: [3, 4] },
  ],
  subgroupContrasts: [
    { contrastId: 'q1-age', questionId: 'q1', leftGroupId: 'younger', rightGroupId: 'older', metric: 'TOP_TWO_BOX' },
    { contrastId: 'q2-age', questionId: 'q2', leftGroupId: 'younger', rightGroupId: 'older', metric: 'TOP_TWO_BOX' },
  ],
};
preregistration.outcomeCommitment = createOutcomeCommitment(humanOutcome, nonce, preregistration);
preregistration.syntheticBriefHash = createSyntheticBriefHash(preregistration);
const evaluator = { version: 'validation-evaluator-v1', evaluatedAt: '2026-08-29T12:00:00.000Z', calibrationDate: '2026-08-29T00:00:00.000Z' };
const runLineage = createValidationRunLineage(preregistration);

const syntheticRuns = [
  {
    runId: 'run-1', runVersion: 'validation-run-v1', status: 'COMPLETED', syntheticBriefHash: preregistration.syntheticBriefHash, evidenceHash: 'e'.repeat(64), evidencePairId: 'pair-1',
    questionResults: [
      { questionId: 'q1', distribution: [12, 14, 19, 31, 24], subgroups: [{ groupId: 'younger', distribution: [7, 9, 14, 35, 35] }, { groupId: 'older', distribution: [18, 20, 22, 24, 16] }] },
      { questionId: 'q2', distribution: [18, 26, 26, 20, 10], subgroups: [{ groupId: 'younger', distribution: [15, 21, 24, 25, 15] }, { groupId: 'older', distribution: [24, 31, 25, 15, 5] }] },
      { questionId: 'q3', distribution: [13, 17, 25, 28, 17], subgroups: [] },
    ],
  },
  {
    runId: 'run-2', runVersion: 'validation-run-v1', status: 'COMPLETED', syntheticBriefHash: preregistration.syntheticBriefHash, evidenceHash: 'f'.repeat(64), evidencePairId: 'pair-1',
    questionResults: [
      { questionId: 'q1', distribution: [11, 15, 20, 30, 24], subgroups: [{ groupId: 'younger', distribution: [6, 10, 14, 35, 35] }, { groupId: 'older', distribution: [17, 21, 22, 24, 16] }] },
      { questionId: 'q2', distribution: [19, 25, 26, 20, 10], subgroups: [{ groupId: 'younger', distribution: [16, 20, 24, 25, 15] }, { groupId: 'older', distribution: [25, 30, 25, 15, 5] }] },
      { questionId: 'q3', distribution: [12, 19, 24, 27, 18], subgroups: [] },
    ],
  },
  {
    runId: 'run-3', runVersion: 'validation-run-v1', status: 'COMPLETED', syntheticBriefHash: preregistration.syntheticBriefHash, evidenceHash: 'e'.repeat(64),
    questionResults: [
      { questionId: 'q1', distribution: [10, 16, 19, 30, 25], subgroups: [{ groupId: 'younger', distribution: [5, 11, 14, 35, 35] }, { groupId: 'older', distribution: [16, 20, 24, 25, 15] }] },
      { questionId: 'q2', distribution: [20, 24, 26, 20, 10], subgroups: [{ groupId: 'younger', distribution: [15, 20, 25, 25, 15] }, { groupId: 'older', distribution: [25, 30, 25, 15, 5] }] },
      { questionId: 'q3', distribution: [11, 18, 26, 27, 18], subgroups: [] },
    ],
  },
  {
    runId: 'run-4', runVersion: 'validation-run-v1', status: 'COMPLETED', syntheticBriefHash: preregistration.syntheticBriefHash, evidenceHash: 'e'.repeat(64),
    questionResults: [
      { questionId: 'q1', distribution: [11, 15, 19, 30, 25], subgroups: [{ groupId: 'younger', distribution: [6, 10, 14, 35, 35] }, { groupId: 'older', distribution: [16, 21, 23, 25, 15] }] },
      { questionId: 'q2', distribution: [20, 25, 25, 20, 10], subgroups: [{ groupId: 'younger', distribution: [15, 20, 25, 25, 15] }, { groupId: 'older', distribution: [25, 30, 25, 15, 5] }] },
      { questionId: 'q3', distribution: [12, 18, 25, 28, 17], subgroups: [] },
    ],
  },
  { runId: 'run-5', runVersion: 'validation-run-v1', status: 'FAILED', syntheticBriefHash: preregistration.syntheticBriefHash, evidenceHash: 'e'.repeat(64), failureCode: 'UPSTREAM_BUSY' },
];
for (const run of syntheticRuns) run.lineage = structuredClone(runLineage);

test('blind benchmark brief excludes human outcomes and reveal material', () => {
  const blind = buildBlindSyntheticBrief(preregistration);
  const serialized = JSON.stringify(blind);
  assert.equal(blind.caseId, preregistration.caseId);
  assert.equal(blind.outcomeCommitment.hash, preregistration.outcomeCommitment.hash);
  assert.equal(serialized.includes('humanOutcome'), false);
  assert.equal(serialized.includes(nonce), false);
  assert.equal(serialized.includes('[10,15,20,30,25]'), false);
  assert.equal(serialized.includes(preregistration.dataset.sourceUrl), false);
});

test('Validation Lab verifies the reveal and scores distributions, ranks, subgroup direction, repeat variation, and evidence sensitivity', () => {
  const report = scoreValidationCase({ preregistration, reveal: { nonce, humanOutcome }, syntheticRuns, evaluator });
  assert.equal(report.comparisonStatus, 'COMPLETED');
  assert.equal(report.outcome, 'MIXED_EVIDENCE');
  assert.equal(report.completedRuns, 4);
  assert.equal(report.failedRuns, 1);
  assert.ok(report.metrics.meanAbsolutePercentagePointError >= 0);
  assert.ok(report.metrics.topTwoBoxAbsoluteError >= 0);
  assert.ok(report.metrics.rankOrderAgreement >= -1 && report.metrics.rankOrderAgreement <= 1);
  assert.equal(report.metrics.segmentDirectionAgreement, 1);
  assert.ok(report.metrics.meanTotalVariationDistancePp >= 0);
  assert.ok(report.metrics.meanJensenShannonDivergence >= 0);
  assert.ok(report.metrics.repeatRunVariation.maxCategorySpreadPp >= 0);
  assert.equal(report.metrics.repeatRunVariation.attemptedRunCount, 4);
  assert.equal(report.metrics.evidenceSensitivity.status, 'ASSESSED');
  assert.equal(report.lineage.promptVersions.panel, 'panel-v4');
  assert.match(report.lineage.preregistrationHash, /^[a-f0-9]{64}$/);
  assert.match(report.lineage.syntheticRunBundleHash, /^[a-f0-9]{64}$/);
  assert.equal(report.evaluationDate, '2026-08-29');
  assert.equal(report.calibrationDate, '2026-08-29');
  assert.equal('accuracy' in report, false);
});

test('modified human outcome or mismatched frozen brief invalidates the comparison', () => {
  const modifiedOutcome = structuredClone(humanOutcome);
  modifiedOutcome.questions[0].distribution = [11, 14, 20, 30, 25];
  assert.equal(scoreValidationCase({ preregistration, reveal: { nonce, humanOutcome: modifiedOutcome }, syntheticRuns, evaluator }).comparisonStatus, 'INVALIDATED');
  const mismatched = structuredClone(syntheticRuns);
  mismatched[0].syntheticBriefHash = 'd'.repeat(64);
  assert.equal(scoreValidationCase({ preregistration, reveal: { nonce, humanOutcome }, syntheticRuns: mismatched, evaluator }).comparisonStatus, 'INVALIDATED');
});

test('malformed, duplicate, and incomplete benchmark inputs fail closed without throwing', () => {
  const cases = [];
  const emptyQuestions = structuredClone(preregistration);
  emptyQuestions.questions = [];
  cases.push({ preregistration: emptyQuestions, reveal: { nonce, humanOutcome }, syntheticRuns, evaluator });

  const invalidScale = structuredClone(preregistration);
  invalidScale.questions[0].topTwoIndices = [0, 4];
  cases.push({ preregistration: invalidScale, reveal: { nonce, humanOutcome }, syntheticRuns, evaluator });

  const duplicateRuns = structuredClone(syntheticRuns);
  duplicateRuns[1].runId = duplicateRuns[0].runId;
  cases.push({ preregistration, reveal: { nonce, humanOutcome }, syntheticRuns: duplicateRuns, evaluator });

  const missingQuestion = structuredClone(syntheticRuns);
  missingQuestion[0].questionResults.pop();
  cases.push({ preregistration, reveal: { nonce, humanOutcome }, syntheticRuns: missingQuestion, evaluator });

  const wrongLineage = structuredClone(syntheticRuns);
  wrongLineage[0].lineage.runtimeVersion = 'changed-after-freeze';
  cases.push({ preregistration, reveal: { nonce, humanOutcome }, syntheticRuns: wrongLineage, evaluator });

  for (const input of cases) assert.doesNotThrow(() => assert.equal(scoreValidationCase(input).comparisonStatus, 'INVALIDATED'));
});

test('insufficient comparable repeats remain not assessed instead of receiving a favorable outcome', () => {
  const twoEvidenceVariants = structuredClone(syntheticRuns.slice(0, 2));
  const report = scoreValidationCase({ preregistration, reveal: { nonce, humanOutcome }, syntheticRuns: twoEvidenceVariants, evaluator });
  assert.equal(report.comparisonStatus, 'COMPLETED');
  assert.equal(report.metrics.repeatRunVariation.status, 'NOT_ASSESSED');
  assert.equal(report.outcome, 'NOT_ASSESSED');
});

test('scorecard summary publishes failures and stratifies completed cases without universal claims', () => {
  const completed = scoreValidationCase({ preregistration, reveal: { nonce, humanOutcome }, syntheticRuns, evaluator });
  const aborted = { caseId: 'case-failed-002', comparisonStatus: 'ABORTED', outcome: 'NOT_ASSESSED', market: 'Japan', language: 'ja-JP', questionTypes: ['PURCHASE_INTENT'], reason: 'No eligible synthetic run completed.' };
  const summary = summarizeValidationCases([completed, aborted]);
  assert.equal(summary.completedComparisons, 1);
  assert.equal(summary.publishedNonCompletedComparisons, 1);
  assert.equal(summary.comparisons.length, 2);
  assert.equal(summary.byMarket.Spain.completedComparisons, 1);
  assert.equal(summary.byLanguage['es-ES'].completedComparisons, 1);
  assert.ok(summary.unsupportedMarkets.includes('Japan'));
  assert.equal('accuracy' in summary, false);
});
