import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HUMAN_RESEARCH_LIFECYCLE_STATES,
  HUMAN_RESEARCH_PACKAGE_PARTS,
  HUMAN_RESEARCH_PACKAGE_VERSION,
  createHumanResearchPackage,
  createHumanResearchPackageStore,
  editHumanResearchPackage,
  resolveHumanResearchBlocker,
  transitionHumanResearchPackage,
  validateHumanResearchPackage,
} from './human-research-lifecycle.js';
import { createMemoryStorageAdapter } from './storage-contract.js';

const parts = {
  questionnaire: { version: 'questionnaire-v1', questions: [{ id: 'Q1', type: 'SINGLE_SELECT' }] },
  screener: { version: 'screener-v1', criteria: [{ id: 'CONSENT', field: 'consent' }] },
  quota: { version: 'quota-v1', targets: [{ field: 'age', value: '18-34', count: 10 }] },
  recruitment: { version: 'recruitment-v1', instructions: ['Use the reviewed screener.'] },
  analysis: { version: 'analysis-v1', primary: 'q1', missingness: 'item-denominator' },
  sourceLineage: { studyId: 'study-1', runId: 'run-1', inputHash: 'a'.repeat(64) },
};

const clearPackage = () => createHumanResearchPackage({
  packageId: 'hrp_1',
  studyId: 'study-1',
  ...parts,
  blockers: [],
});

const handoffQuotaPlan = { version: 'quota-v1', status: 'TARGETS_APPROVED', targets: [{ field: 'age', value: '18-34', count: 25 }], denominatorStatus: 'APPROVED' };
const handoffSamplePlan = { version: 'sample-plan-v1', status: 'APPROVED', recommendedCompletes: 120, basis: 'RESEARCHER_APPROVED_POWER_PLAN' };
const handoffIncidencePlan = { version: 'incidence-plan-v1', status: 'PROVIDER_QUOTED', pointEstimate: 0.42, source: 'provider-quote-1' };

function reviewedHandoff(overrides = {}) {
  return {
    handoffId: 'hrh_reviewed',
    questionnaire: { ...parts.questionnaire, languageValidation: { status: 'APPROVED' }, hasPlaceholders: false, stimuli: [] },
    screeningPlan: { ...parts.screener, criteria: [{ id: 'CONSENT', field: 'consent', status: 'APPROVED' }], sensitiveDataReviewRequired: false },
    quotaPlan: handoffQuotaPlan,
    samplePlan: handoffSamplePlan,
    incidencePlan: handoffIncidencePlan,
    recruitmentPlan: parts.recruitment,
    analysisPlan: { ...parts.analysis, status: 'APPROVED', blocked: false },
    sourceStudy: parts.sourceLineage,
    ...overrides,
  };
}

test('human research packages freeze all fielding parts with auditable hashes', () => {
  const packageRecord = clearPackage();

  assert.deepEqual(HUMAN_RESEARCH_LIFECYCLE_STATES, [
    'DRAFT', 'RESEARCHER_REVIEW', 'APPROVED_FOR_FIELDING', 'FIELDING', 'CLOSED', 'ANALYZED',
  ]);
  assert.equal(packageRecord.status, 'DRAFT');
  assert.equal(packageRecord.version, 1);
  assert.equal(packageRecord.approval, null);
  assert.equal(packageRecord.lineage.classification, 'USER_PROVIDED');
  assert.equal(packageRecord.lineage.observedHumanResponse, false);
  for (const name of Object.keys(parts)) assert.match(packageRecord.packageHashes[name], /^[a-f0-9]{64}$/);
  assert.match(packageRecord.packageHashes.package, /^[a-f0-9]{64}$/);
  assert.equal(packageRecord.sourceLineage.inputHash, 'a'.repeat(64));
});

test('legacy simple quota package records keep the v1 contract and validate', () => {
  const packageRecord = clearPackage();

  assert.deepEqual(HUMAN_RESEARCH_PACKAGE_PARTS, [
    'questionnaire', 'screener', 'quota', 'recruitment', 'analysis', 'sourceLineage',
  ]);
  assert.equal(packageRecord.packageVersion, HUMAN_RESEARCH_PACKAGE_VERSION);
  assert.deepEqual(packageRecord.quota, parts.quota);
  assert.equal(packageRecord.quota.quotaPlan, undefined);
  assert.doesNotThrow(() => validateHumanResearchPackage(packageRecord));

  const edited = editHumanResearchPackage(packageRecord, {
    expectedVersion: 1,
    patch: { samplePlan: handoffSamplePlan },
  });
  assert.deepEqual(edited.quota.quotaPlan, parts.quota);
  assert.deepEqual(edited.quota.samplePlan, handoffSamplePlan);
  assert.equal(edited.packageVersion, HUMAN_RESEARCH_PACKAGE_VERSION);
  assert.doesNotThrow(() => validateHumanResearchPackage(edited));
});

test('handoff quota hashes cover quota, sample, and incidence plans', () => {
  const packageRecord = createHumanResearchPackage({
    packageId: 'hrp_handoff_hash',
    studyId: 'study-1',
    handoff: reviewedHandoff(),
  });
  const sampleChanged = createHumanResearchPackage({
    packageId: 'hrp_handoff_sample_hash',
    studyId: 'study-1',
    handoff: reviewedHandoff({ samplePlan: { ...handoffSamplePlan, recommendedCompletes: 121 } }),
  });
  const incidenceChanged = createHumanResearchPackage({
    packageId: 'hrp_handoff_incidence_hash',
    studyId: 'study-1',
    handoff: reviewedHandoff({ incidencePlan: { ...handoffIncidencePlan, pointEstimate: 0.36 } }),
  });

  assert.deepEqual(packageRecord.quota, {
    quotaPlan: handoffQuotaPlan,
    samplePlan: handoffSamplePlan,
    incidencePlan: handoffIncidencePlan,
  });
  assert.notEqual(sampleChanged.packageHashes.quota, packageRecord.packageHashes.quota);
  assert.notEqual(sampleChanged.packageHashes.package, packageRecord.packageHashes.package);
  assert.notEqual(incidenceChanged.packageHashes.quota, packageRecord.packageHashes.quota);
  assert.notEqual(incidenceChanged.packageHashes.package, packageRecord.packageHashes.package);

  const approved = transitionHumanResearchPackage(
    transitionHumanResearchPackage(packageRecord, 'RESEARCHER_REVIEW', { expectedVersion: 1 }),
    'APPROVED_FOR_FIELDING',
    { expectedVersion: 2, actor: 'researcher-1' },
  );
  assert.equal(approved.approval.packageHashes.quota, approved.packageHashes.quota);
  assert.equal(approved.approval.packageHashes.package, approved.packageHashes.package);
});

test('quota sub-plan edits preserve composite siblings and change quota integrity hashes', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_quota_subplan_edits',
    studyId: 'study-1',
    ...parts,
    quota: {
      quotaPlan: handoffQuotaPlan,
      samplePlan: handoffSamplePlan,
      incidencePlan: handoffIncidencePlan,
    },
  });
  const edits = {
    quotaPlan: { ...handoffQuotaPlan, targets: [{ field: 'age', value: '18-34', count: 26 }] },
    samplePlan: { ...handoffSamplePlan, recommendedCompletes: 121 },
    incidencePlan: { ...handoffIncidencePlan, pointEstimate: 0.36 },
  };

  for (const [partName, replacement] of Object.entries(edits)) {
    const edited = editHumanResearchPackage(draft, { expectedVersion: 1, patch: { [partName]: replacement } });
    assert.deepEqual(edited.quota[partName], replacement);
    for (const sibling of Object.keys(edits).filter((name) => name !== partName)) {
      assert.deepEqual(edited.quota[sibling], draft.quota[sibling]);
    }
    assert.notEqual(edited.packageHashes.quota, draft.packageHashes.quota);
    assert.notEqual(edited.packageHashes.package, draft.packageHashes.package);
    assert.equal(edited[partName], undefined);
  }
});

test('part edits add newly inferred mandatory blockers', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_edit_infers_blockers',
    studyId: 'study-1',
    ...parts,
    quota: { quotaPlan: handoffQuotaPlan, samplePlan: handoffSamplePlan, incidencePlan: handoffIncidencePlan },
  });
  const edited = editHumanResearchPackage(draft, {
    expectedVersion: 1,
    patch: { samplePlan: { ...handoffSamplePlan, status: 'BLOCKED' } },
  });

  assert.ok(edited.blockingIssues.includes('SAMPLE_DESIGN_REVIEW'));
  assert.equal(edited.blockers.find((blocker) => blocker.code === 'SAMPLE_DESIGN_REVIEW').mandatory, true);
});

test('inferred lifecycle blockers cannot be erased by an empty blocker declaration', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_inferred_blockers_are_mandatory',
    studyId: 'study-1',
    handoff: reviewedHandoff({
      samplePlan: { ...handoffSamplePlan, status: 'RESEARCHER_DESIGN_REQUIRED' },
      analysisPlan: { ...parts.analysis, status: 'APPROVED', blocked: false, analysisReviewRequired: true },
    }),
    blockers: [],
  });

  assert.ok(draft.blockingIssues.includes('SAMPLE_DESIGN_REVIEW'));
  assert.ok(draft.blockingIssues.includes('ANALYSIS_REVIEW'));
});

test('sample design review fails closed unless explicitly resolved', () => {
  for (const status of ['PLANNING_ESTIMATE', 'RESEARCHER_DESIGN_REQUIRED', 'BLOCKED']) {
    const draft = createHumanResearchPackage({
      packageId: `hrp_sample_${status.toLowerCase()}`,
      studyId: 'study-1',
      handoff: reviewedHandoff({ samplePlan: { ...handoffSamplePlan, status } }),
    });
    const sampleBlocker = draft.blockers.find((blocker) => blocker.code === 'SAMPLE_DESIGN_REVIEW');

    assert.equal(sampleBlocker.resolved, false);
    assert.ok(draft.blockingIssues.includes('SAMPLE_DESIGN_REVIEW'));
    const review = transitionHumanResearchPackage(draft, 'RESEARCHER_REVIEW', { expectedVersion: 1 });
    assert.throws(
      () => transitionHumanResearchPackage(review, 'APPROVED_FOR_FIELDING', { expectedVersion: 2, actor: 'researcher-1' }),
      /SAMPLE_DESIGN_REVIEW|blocking/i,
    );
  }

  const claimedResolved = createHumanResearchPackage({
    packageId: 'hrp_sample_resolved',
    studyId: 'study-1',
    handoff: reviewedHandoff({
      samplePlan: { ...handoffSamplePlan, status: 'PLANNING_ESTIMATE' },
      blockers: [{ code: 'SAMPLE_DESIGN_REVIEW', message: 'Researcher approved the sample design.', resolved: true }],
    }),
  });
  assert.equal(claimedResolved.blockers.find((blocker) => blocker.code === 'SAMPLE_DESIGN_REVIEW').resolved, false);
  const resolved = resolveHumanResearchBlocker(claimedResolved, 'SAMPLE_DESIGN_REVIEW', {
    expectedVersion: 1,
    actor: 'researcher-1',
    evidence: { reviewId: 'sample-design-review-1', decision: 'APPROVED' },
    now: () => '2026-08-29T13:10:00.000Z',
  });
  const resolvedBlocker = resolved.blockers.find((blocker) => blocker.code === 'SAMPLE_DESIGN_REVIEW');

  assert.equal(resolvedBlocker.resolved, true);
  assert.equal(resolved.blockingIssues.includes('SAMPLE_DESIGN_REVIEW'), false);
  const approved = transitionHumanResearchPackage(
    transitionHumanResearchPackage(resolved, 'RESEARCHER_REVIEW', { expectedVersion: 2 }),
    'APPROVED_FOR_FIELDING',
    { expectedVersion: 3, actor: 'researcher-1' },
  );
  assert.equal(approved.status, 'APPROVED_FOR_FIELDING');
});

test('sampling coverage review is inferred from unresolved incidence coverage', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_sampling_coverage',
    studyId: 'study-1',
    handoff: reviewedHandoff({ incidencePlan: { ...handoffIncidencePlan, status: 'UNESTIMATED', pointEstimate: null } }),
  });

  assert.ok(draft.blockingIssues.includes('SAMPLING_COVERAGE_REVIEW'));
  assert.ok(draft.blockingIssues.includes('DENOMINATOR_REVIEW'));

  const claimedResolved = createHumanResearchPackage({
    packageId: 'hrp_sampling_coverage_resolved',
    studyId: 'study-1',
    handoff: reviewedHandoff({
      incidencePlan: { ...handoffIncidencePlan, status: 'UNESTIMATED', pointEstimate: null },
      blockers: [{ code: 'SAMPLING_COVERAGE_REVIEW', message: 'Researcher accepted the sampling coverage limitation.', resolved: true }],
    }),
  });
  assert.equal(claimedResolved.blockers.find((blocker) => blocker.code === 'SAMPLING_COVERAGE_REVIEW').resolved, false);
  const resolved = resolveHumanResearchBlocker(claimedResolved, 'SAMPLING_COVERAGE_REVIEW', {
    expectedVersion: 1,
    actor: 'researcher-1',
    evidence: { reviewId: 'coverage-review-1', limitationAccepted: true },
    now: () => '2026-08-29T13:20:00.000Z',
  });

  assert.equal(resolved.blockers.find((blocker) => blocker.code === 'SAMPLING_COVERAGE_REVIEW').resolved, true);
  assert.equal(resolved.blockingIssues.includes('SAMPLING_COVERAGE_REVIEW'), false);
  assert.ok(resolved.blockingIssues.includes('DENOMINATOR_REVIEW'));
});

test('explicit handoff review-required flags remain mandatory even when plan statuses look approved', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_explicit_review_flags',
    studyId: 'study-1',
    handoff: reviewedHandoff({
      questionnaire: { ...reviewedHandoff().questionnaire, translationReviewRequired: true, questionnaireReviewRequired: true, stimulusReviewRequired: true },
      screeningPlan: { ...reviewedHandoff().screeningPlan, consentPrivacyReviewRequired: true },
      quotaPlan: { ...handoffQuotaPlan, samplingCoverageReviewRequired: true },
      samplePlan: { ...handoffSamplePlan, sampleDesignReviewRequired: true },
      analysisPlan: { ...parts.analysis, status: 'APPROVED', blocked: false, analysisReviewRequired: true },
    }),
    blockers: [],
  });

  for (const code of [
    'TRANSLATION_REVIEW',
    'QUESTIONNAIRE_REVIEW',
    'STIMULUS_REVIEW',
    'CONSENT_PRIVACY_REVIEW',
    'SAMPLING_COVERAGE_REVIEW',
    'SAMPLE_DESIGN_REVIEW',
    'ANALYSIS_REVIEW',
  ]) assert.ok(draft.blockingIssues.includes(code), code);
});

test('qualitative coverage review does not invent a statistical denominator gate', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_qualitative_coverage',
    studyId: 'study-1',
    handoff: reviewedHandoff({
      quotaPlan: { status: 'NOT_APPLICABLE', targets: [], monitorTargets: [], coverageDimensions: [], denominatorReviewRequired: false, samplingCoverageReviewRequired: true },
      samplePlan: { ...handoffSamplePlan, status: 'RESEARCHER_DESIGN_REQUIRED', recommendedCompletes: null },
      incidencePlan: { ...handoffIncidencePlan, status: 'UNESTIMATED', pointEstimate: null },
    }),
  });

  assert.ok(draft.blockingIssues.includes('SAMPLING_COVERAGE_REVIEW'));
  assert.ok(draft.blockingIssues.includes('SAMPLE_DESIGN_REVIEW'));
  assert.equal(draft.blockingIssues.includes('DENOMINATOR_REVIEW'), false);
});

test('composite quota parts infer sample and coverage blockers without handoff', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_composite_quota_parts',
    studyId: 'study-1',
    ...parts,
    quota: {
      quotaPlan: handoffQuotaPlan,
      samplePlan: { ...handoffSamplePlan, status: 'RESEARCHER_DESIGN_REQUIRED' },
      incidencePlan: { ...handoffIncidencePlan, status: 'UNESTIMATED', pointEstimate: null },
    },
  });

  assert.ok(draft.blockingIssues.includes('SAMPLE_DESIGN_REVIEW'));
  assert.ok(draft.blockingIssues.includes('SAMPLING_COVERAGE_REVIEW'));
  assert.ok(draft.blockingIssues.includes('DENOMINATOR_REVIEW'));
  assert.doesNotThrow(() => validateHumanResearchPackage(draft));
});

test('approval is blocked while any preregistered blocker remains unresolved', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_blocked',
    studyId: 'study-1',
    ...parts,
    blockers: [
      { code: 'TRANSLATION_REVIEW', message: 'Human translation review is required.', resolved: false },
      { code: 'DENOMINATOR_REVIEW', message: 'Screened denominator is not established.', resolved: true },
    ],
  });
  const review = transitionHumanResearchPackage(draft, 'RESEARCHER_REVIEW', { expectedVersion: 1 });

  assert.throws(
    () => transitionHumanResearchPackage(review, 'APPROVED_FOR_FIELDING', { expectedVersion: 2, actor: 'researcher-1' }),
    /TRANSLATION_REVIEW|blocking/i,
  );
});

test('mandatory blockers require an attributed, timestamped, evidence-backed lifecycle resolution', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_evidence_backed_resolution',
    studyId: 'study-1',
    ...parts,
    questionnaire: { ...parts.questionnaire, questionnaireReviewRequired: true },
    blockers: [{ code: 'QUESTIONNAIRE_REVIEW', message: 'Caller claims this is already clear.', resolved: true }],
  });
  const blocker = draft.blockers.find((item) => item.code === 'QUESTIONNAIRE_REVIEW');

  assert.equal(blocker.resolved, false);
  assert.equal(blocker.resolution, undefined);
  assert.throws(
    () => resolveHumanResearchBlocker(draft, 'QUESTIONNAIRE_REVIEW', { expectedVersion: 1, evidence: { reviewId: 'qr-1' } }),
    (error) => error?.code === 'BLOCKER_RESOLUTION_ACTOR_REQUIRED',
  );
  assert.throws(
    () => resolveHumanResearchBlocker(draft, 'QUESTIONNAIRE_REVIEW', { expectedVersion: 1, actor: 'researcher-1' }),
    (error) => error?.code === 'BLOCKER_RESOLUTION_EVIDENCE_REQUIRED',
  );

  const resolved = resolveHumanResearchBlocker(draft, 'QUESTIONNAIRE_REVIEW', {
    expectedVersion: 1,
    actor: 'researcher-1',
    evidence: { reviewId: 'qr-1', artifactHash: 'b'.repeat(64) },
    now: () => '2026-08-29T13:00:00.000Z',
  });
  const resolution = resolved.blockers.find((item) => item.code === 'QUESTIONNAIRE_REVIEW').resolution;

  assert.equal(resolved.version, 2);
  assert.equal(resolution.actor, 'researcher-1');
  assert.equal(resolution.resolvedAt, '2026-08-29T13:00:00.000Z');
  assert.deepEqual(resolution.evidence, { reviewId: 'qr-1', artifactHash: 'b'.repeat(64) });
  assert.match(resolution.evidenceHash, /^[a-f0-9]{64}$/);
  assert.ok(resolved.transitionHistory.some((event) => event.event === 'BLOCKER_RESOLVED' && event.blockerCode === 'QUESTIONNAIRE_REVIEW'));
});

test('material edits reopen resolved blockers so stale review evidence cannot authorize approval', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_stale_resolution',
    studyId: 'study-1',
    ...parts,
    questionnaire: { ...parts.questionnaire, questionnaireReviewRequired: true },
  });
  const resolved = resolveHumanResearchBlocker(draft, 'QUESTIONNAIRE_REVIEW', {
    expectedVersion: 1,
    actor: 'researcher-1',
    evidence: { reviewId: 'questionnaire-review-v1' },
    now: () => '2026-08-29T13:30:00.000Z',
  });
  const edited = editHumanResearchPackage(resolved, {
    expectedVersion: 2,
    patch: { questionnaire: { ...parts.questionnaire, questionnaireReviewRequired: false, revision: 2 } },
    actor: 'researcher-2',
    reason: 'Questionnaire changed after review.',
    now: () => '2026-08-29T13:40:00.000Z',
  });
  const reopened = edited.blockers.find((blocker) => blocker.code === 'QUESTIONNAIRE_REVIEW');

  assert.equal(reopened.resolved, false);
  assert.equal(reopened.resolution, undefined);
  assert.ok(edited.blockingIssues.includes('QUESTIONNAIRE_REVIEW'));
  assert.deepEqual(
    edited.transitionHistory.find((event) => event.event === 'BLOCKER_RESOLVED').evidence,
    { reviewId: 'questionnaire-review-v1' },
  );
  assert.deepEqual(edited.transitionHistory.at(-1).reopenedBlockers, ['QUESTIONNAIRE_REVIEW']);
  const review = transitionHumanResearchPackage(edited, 'RESEARCHER_REVIEW', { expectedVersion: 3 });
  assert.throws(
    () => transitionHumanResearchPackage(review, 'APPROVED_FOR_FIELDING', { expectedVersion: 4, actor: 'researcher-2' }),
    (error) => error?.code === 'APPROVAL_BLOCKED',
  );
});

test('package validation and approval fail closed for forged blocker resolution state', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_forged_resolution',
    studyId: 'study-1',
    ...parts,
    questionnaire: { ...parts.questionnaire, questionnaireReviewRequired: true },
  });
  const forged = structuredClone(draft);
  forged.blockers = forged.blockers.map((blocker) => blocker.code === 'QUESTIONNAIRE_REVIEW'
    ? { ...blocker, resolved: true }
    : blocker);
  forged.blockingIssues = [];
  forged.status = 'APPROVED_FOR_FIELDING';
  forged.approval = { actor: 'unattributed-input' };

  assert.throws(
    () => validateHumanResearchPackage(forged),
    (error) => ['INVALID_PACKAGE', 'TAMPERED_PACKAGE', 'APPROVAL_BLOCKED'].includes(error?.code),
  );

  const forgedApproval = structuredClone(clearPackage());
  forgedApproval.status = 'APPROVED_FOR_FIELDING';
  forgedApproval.approval = { actor: 'unattributed-input' };
  assert.throws(
    () => validateHumanResearchPackage(forgedApproval),
    (error) => ['INVALID_PACKAGE', 'TAMPERED_PACKAGE'].includes(error?.code),
  );
});

test('edits cannot replace lifecycle blockers or add unknown top-level fields', () => {
  const draft = createHumanResearchPackage({
    packageId: 'hrp_edit_guardrails',
    studyId: 'study-1',
    ...parts,
    questionnaire: { ...parts.questionnaire, questionnaireReviewRequired: true },
  });

  for (const patch of [{ blockers: [] }, { blockingIssues: [] }, { arbitraryApproval: true }]) {
    assert.throws(
      () => editHumanResearchPackage(draft, { expectedVersion: 1, patch }),
      (error) => error?.code === 'INVALID_EDIT',
    );
  }
  assert.ok(draft.blockingIssues.includes('QUESTIONNAIRE_REVIEW'));
});

test('lifecycle enforces ordered transitions and optimistic versions', () => {
  let current = clearPackage();
  for (const [nextStatus, expectedVersion] of [
    ['RESEARCHER_REVIEW', 1],
    ['APPROVED_FOR_FIELDING', 2],
    ['FIELDING', 3],
    ['CLOSED', 4],
    ['ANALYZED', 5],
  ]) {
    current = transitionHumanResearchPackage(current, nextStatus, { expectedVersion, actor: 'researcher-1' });
    assert.equal(current.status, nextStatus);
    assert.equal(current.version, expectedVersion + 1);
  }
  assert.throws(() => transitionHumanResearchPackage(current, 'FIELDING', { expectedVersion: 6 }), /transition|ANALYZED/i);
  assert.throws(() => transitionHumanResearchPackage(clearPackage(), 'RESEARCHER_REVIEW', { expectedVersion: 9 }), /version conflict/i);
});

test('editing an approved package creates a new version and invalidates approval', () => {
  let approved = transitionHumanResearchPackage(
    transitionHumanResearchPackage(clearPackage(), 'RESEARCHER_REVIEW', { expectedVersion: 1 }),
    'APPROVED_FOR_FIELDING',
    { expectedVersion: 2, actor: 'researcher-1' },
  );
  const edited = editHumanResearchPackage(approved, {
    expectedVersion: 3,
    patch: { questionnaire: { ...parts.questionnaire, questions: [{ id: 'Q1', type: 'SINGLE_SELECT' }, { id: 'Q2', type: 'OPEN_TEXT' }] } },
    reason: 'Researcher wording revision',
  });

  assert.equal(approved.status, 'APPROVED_FOR_FIELDING');
  assert.equal(approved.approval.actor, 'researcher-1');
  assert.equal(edited.status, 'RESEARCHER_REVIEW');
  assert.equal(edited.version, 4);
  assert.equal(edited.approval, null);
  assert.equal(edited.approvalInvalidated.reason, 'Researcher wording revision');
  assert.notEqual(edited.packageHashes.questionnaire, approved.packageHashes.questionnaire);
});

test('package store can use the existing lineage-aware storage adapter', async () => {
  const storage = createMemoryStorageAdapter({ now: () => '2026-08-29T12:00:00.000Z' });
  const store = createHumanResearchPackageStore({ storage, now: () => '2026-08-29T12:00:00.000Z' });
  const created = await store.createPackage({ packageId: 'hrp_stored', studyId: 'study-1', ...parts, blockers: [] });
  const reviewed = await store.transitionPackage('hrp_stored', 'RESEARCHER_REVIEW', { expectedVersion: created.version });
  const loaded = await store.getPackage('hrp_stored');
  assert.equal(reviewed.version, 2);
  assert.equal(loaded.status, 'RESEARCHER_REVIEW');
  assert.equal(loaded.lineage.payloadHash, loaded.packageHashes.package);
});
