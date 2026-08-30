/**
 * Invented, deterministic contract data. It is deliberately not derived from a
 * human study and must never be published as a Validation Lab comparison.
 */
import {
  VALIDATION_CASE_VERSION,
  VALIDATION_RUN_VERSION,
  createOutcomeCommitment,
  createSyntheticBriefHash,
  createValidationRunLineage,
} from './validation-lab.js';

const nonce = 'invented-validation-fixture-nonce-20260829';

const humanOutcome = {
  fixtureNote: 'Invented human reference for offline contract tests only.',
  questions: [
    { questionId: 'q1', distribution: [10, 15, 20, 30, 25], subgroups: [{ groupId: 'younger', distribution: [5, 10, 15, 35, 35] }, { groupId: 'older', distribution: [15, 20, 25, 25, 15] }] },
    { questionId: 'q2', distribution: [20, 25, 25, 20, 10], subgroups: [{ groupId: 'younger', distribution: [15, 20, 25, 25, 15] }, { groupId: 'older', distribution: [25, 30, 25, 15, 5] }] },
    { questionId: 'q3', distribution: [12, 18, 25, 27, 18], subgroups: [] },
  ],
};

function preregistration() {
  const record = {
    protocolVersion: VALIDATION_CASE_VERSION,
    caseId: 'invented-contract-case-001',
    registeredAt: '2026-08-01T00:00:00.000Z',
    dataset: { id: 'invented-offline-reference', version: 'fixture-v1', sourceUrl: 'https://example.invalid/invented-fixture', licence: 'Invented test fixture only', fieldStart: '2026-01-01', fieldEnd: '2026-02-01' },
    humanStudy: { sampleSize: 1200, effectiveSampleSize: 914.5 },
    populationFrameHash: 'a'.repeat(64),
    population: 'Invented working-adult fixture population',
    market: 'Invented Market',
    language: 'en-US',
    weighting: 'Invented fixture weighting',
    researchMethod: 'CONCEPT_TEST',
    eligibility: { status: 'ELIGIBLE', exactQuestionWording: true, compatibleResponseScale: true, compatiblePopulation: true, heldOutAtSyntheticExecution: true },
    fixtureOnly: true,
    modelPolicy: { runtimeVersion: 'invented-runtime-v1', promptVersions: { panel: 'invented-prompt-v1' }, schemaVersions: { panel: 'invented-schema-v1' }, modelRoutes: ['offline/invented-model'] },
    evidencePolicy: 'PRIOR_ONLY',
    questions: [
      { questionId: 'q1', questionType: 'INVENTED_INTENT', wording: 'Invented fixture question one', scaleLabels: ['1', '2', '3', '4', '5'], topTwoIndices: [3, 4] },
      { questionId: 'q2', questionType: 'INVENTED_INTENT', wording: 'Invented fixture question two', scaleLabels: ['1', '2', '3', '4', '5'], topTwoIndices: [3, 4] },
      { questionId: 'q3', questionType: 'INVENTED_INTENT', wording: 'Invented fixture question three', scaleLabels: ['1', '2', '3', '4', '5'], topTwoIndices: [3, 4] },
    ],
    subgroupContrasts: [
      { contrastId: 'q1-age', questionId: 'q1', leftGroupId: 'younger', rightGroupId: 'older', metric: 'TOP_TWO_BOX' },
      { contrastId: 'q2-age', questionId: 'q2', leftGroupId: 'younger', rightGroupId: 'older', metric: 'TOP_TWO_BOX' },
    ],
  };
  record.outcomeCommitment = createOutcomeCommitment(humanOutcome, nonce, record);
  record.syntheticBriefHash = createSyntheticBriefHash(record);
  return record;
}

function runs(record) {
  const lineage = createValidationRunLineage(record);
  const rows = [
    { runId: 'invented-run-1', runVersion: VALIDATION_RUN_VERSION, status: 'COMPLETED', syntheticBriefHash: record.syntheticBriefHash, evidenceHash: 'e'.repeat(64), evidencePairId: 'pair-1', questionResults: [{ questionId: 'q1', distribution: [12, 14, 19, 31, 24], subgroups: [{ groupId: 'younger', distribution: [7, 9, 14, 35, 35] }, { groupId: 'older', distribution: [18, 20, 22, 24, 16] }] }, { questionId: 'q2', distribution: [18, 26, 26, 20, 10], subgroups: [{ groupId: 'younger', distribution: [15, 21, 24, 25, 15] }, { groupId: 'older', distribution: [24, 31, 25, 15, 5] }] }, { questionId: 'q3', distribution: [13, 17, 25, 28, 17], subgroups: [] }] },
    { runId: 'invented-run-2', runVersion: VALIDATION_RUN_VERSION, status: 'COMPLETED', syntheticBriefHash: record.syntheticBriefHash, evidenceHash: 'f'.repeat(64), evidencePairId: 'pair-1', questionResults: [{ questionId: 'q1', distribution: [11, 15, 20, 30, 24], subgroups: [{ groupId: 'younger', distribution: [6, 10, 14, 35, 35] }, { groupId: 'older', distribution: [17, 21, 22, 24, 16] }] }, { questionId: 'q2', distribution: [19, 25, 26, 20, 10], subgroups: [{ groupId: 'younger', distribution: [16, 20, 24, 25, 15] }, { groupId: 'older', distribution: [25, 30, 25, 15, 5] }] }, { questionId: 'q3', distribution: [12, 19, 24, 27, 18], subgroups: [] }] },
    { runId: 'invented-run-3', runVersion: VALIDATION_RUN_VERSION, status: 'COMPLETED', syntheticBriefHash: record.syntheticBriefHash, evidenceHash: 'e'.repeat(64), questionResults: [{ questionId: 'q1', distribution: [10, 16, 19, 30, 25], subgroups: [{ groupId: 'younger', distribution: [5, 11, 14, 35, 35] }, { groupId: 'older', distribution: [16, 20, 24, 25, 15] }] }, { questionId: 'q2', distribution: [20, 24, 26, 20, 10], subgroups: [{ groupId: 'younger', distribution: [15, 20, 25, 25, 15] }, { groupId: 'older', distribution: [25, 30, 25, 15, 5] }] }, { questionId: 'q3', distribution: [11, 18, 26, 27, 18], subgroups: [] }] },
    { runId: 'invented-run-4', runVersion: VALIDATION_RUN_VERSION, status: 'COMPLETED', syntheticBriefHash: record.syntheticBriefHash, evidenceHash: 'e'.repeat(64), questionResults: [{ questionId: 'q1', distribution: [11, 15, 19, 30, 25], subgroups: [{ groupId: 'younger', distribution: [6, 10, 14, 35, 35] }, { groupId: 'older', distribution: [16, 21, 23, 25, 15] }] }, { questionId: 'q2', distribution: [20, 25, 25, 20, 10], subgroups: [{ groupId: 'younger', distribution: [15, 20, 25, 25, 15] }, { groupId: 'older', distribution: [25, 30, 25, 15, 5] }] }, { questionId: 'q3', distribution: [12, 18, 25, 28, 17], subgroups: [] }] },
    { runId: 'invented-run-5', runVersion: VALIDATION_RUN_VERSION, status: 'FAILED', syntheticBriefHash: record.syntheticBriefHash, evidenceHash: 'e'.repeat(64), failureCode: 'UPSTREAM_BUSY' },
  ];
  return rows.map((row) => ({ ...row, lineage: structuredClone(lineage) }));
}

export function createInventedValidationFixture() {
  const record = preregistration();
  return {
    fixtureStatus: 'INVENTED_FIXTURE_ONLY',
    preregistration: record,
    syntheticImport: { importVersion: 'validation-lab-import-v1', stage: 'SYNTHETIC_EXECUTION', preregistration: structuredClone(record) },
    syntheticRuns: runs(record),
    reveal: { nonce, humanOutcome: structuredClone(humanOutcome) },
    evaluator: { version: 'invented-evaluator-v1', evaluatedAt: '2026-08-29T12:00:00.000Z', calibrationDate: '2026-08-29T00:00:00.000Z' },
  };
}
