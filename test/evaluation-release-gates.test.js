import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  canonicalEvaluationJson,
  compareEvaluationVersions,
  EVALUATION_RELEASE_POLICY_VERSION,
  EVALUATION_RELEASE_THRESHOLDS_HASH,
  evaluateReleaseCandidate,
  hashEvaluationArtifact,
  HUMAN_EDITORIAL_CRITERIA,
  HUMAN_EDITORIAL_RUBRIC_VERSION,
} from '../evals/release-gates.js';

const reviewerKeys = generateKeyPairSync('ed25519');
const approverKeys = generateKeyPairSync('ed25519');
const trustedReviewerKeys = { 'editor-01': reviewerKeys.publicKey };
const trustedPolicyApproverKeys = { 'methods-owner-01': approverKeys.publicKey };
const snapshot = {
  evaluationVersion: 'eval-2030.01',
  capturedAt: '2030-01-10T00:00:00.000Z',
  versions: {
    runtimeVersion: 'runtime-v1',
    promptVersions: { panel: 'panel-v4', critic: 'critic-v4' },
    schemaVersions: { panel: 'study-v2', critic: 'critic-v2' },
    modelRoutes: { panel: ['openai/model-a', 'google/model-b'], critic: ['google/model-b'] },
  },
  quality: { contractPassRate: 1, forbiddenHumanClaimCount: 0, malformedInputFailClosedRate: 1 },
  repeatability: { runCount: 4, totalVariation: 0.04, jensenShannon: 0.01, maxPercentagePointSpread: 8 },
  operations: { p95LatencyMs: 10_000, p95CostUsd: 0.08, fallbackRate: 0.05 },
};

function signedEnvelope(artifact, privateKey) {
  return { artifact, signature: sign(null, Buffer.from(canonicalEvaluationJson(artifact)), privateKey).toString('base64') };
}

function reviewsFor(current) {
  const candidateEvaluationHash = hashEvaluationArtifact(current);
  return HUMAN_EDITORIAL_CRITERIA.map((criterion) => signedEnvelope({
    schemaVersion: 'human-editorial-review-v1',
    rubricVersion: HUMAN_EDITORIAL_RUBRIC_VERSION,
    criterionId: criterion.id,
    status: 'PASS',
    reviewerId: 'editor-01',
    reviewedAt: '2030-01-11T00:00:00.000Z',
    candidateEvaluationHash,
  }, reviewerKeys.privateKey));
}

function approvalFor(baseline) {
  return signedEnvelope({
    schemaVersion: 'evaluation-policy-approval-v1',
    status: 'APPROVED',
    policyVersion: EVALUATION_RELEASE_POLICY_VERSION,
    thresholdsHash: EVALUATION_RELEASE_THRESHOLDS_HASH,
    baselineEvaluationHash: hashEvaluationArtifact(baseline),
    approverId: 'methods-owner-01',
    approvedAt: '2030-01-09T00:00:00.000Z',
  }, approverKeys.privateKey);
}

function evaluate(baseline, current, overrides = {}) {
  return evaluateReleaseCandidate({
    baseline,
    current,
    editorialReviews: reviewsFor(current),
    policyApproval: approvalFor(baseline),
    trustedReviewerKeys,
    trustedPolicyApproverKeys,
    ...overrides,
  });
}

test('versioned baseline, calibrated policy, automated gates, and complete editorial review can return GO', () => {
  const current = structuredClone(snapshot);
  current.evaluationVersion = 'eval-2030.02';
  current.versions.runtimeVersion = 'runtime-v2';
  current.versions.promptVersions.panel = 'panel-v5';
  current.operations.p95LatencyMs = 11_000;

  const result = evaluate(snapshot, current);
  assert.equal(result.decision, 'GO');
  assert.equal(result.releaseAllowed, true);
  assert.equal(result.gates.every((gate) => gate.pass), true);
  assert.equal(result.drift.versionChanges.runtimeVersionChanged, true);
  assert.deepEqual(result.drift.versionChanges.promptStagesChanged, ['panel']);
});

test('a missing human review or calibration approval holds an otherwise healthy candidate', () => {
  const result = evaluateReleaseCandidate({ baseline: snapshot, current: snapshot, editorialReviews: reviewsFor(snapshot).slice(1), trustedReviewerKeys, trustedPolicyApproverKeys });
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.releaseAllowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes('calibrated-policy-approval')));
  assert.ok(result.reasons.some((reason) => reason.includes('editorial-synthetic-boundary')));
});

test('safety, quality, repeatability, operational, or regression failures return NO_GO', () => {
  const current = structuredClone(snapshot);
  current.quality.forbiddenHumanClaimCount = 1;
  current.quality.malformedInputFailClosedRate = 0.9;
  current.repeatability.totalVariation = 0.2;
  current.operations.p95CostUsd = 0.6;
  current.operations.fallbackRate = 0.3;

  const result = evaluate(snapshot, current);
  assert.equal(result.decision, 'NO_GO');
  assert.equal(result.releaseAllowed, false);
  assert.equal(result.gates.find((gate) => gate.id === 'forbidden-human-claims').pass, false);
  assert.equal(result.gates.find((gate) => gate.id === 'drift-total-variation').pass, false);
});

test('malformed or incomplete metric snapshots fail closed', () => {
  const result = evaluateReleaseCandidate({ baseline: snapshot, current: { evaluationVersion: 'broken' }, trustedReviewerKeys, trustedPolicyApproverKeys });
  assert.equal(result.decision, 'NO_GO');
  assert.equal(result.releaseAllowed, false);
  assert.equal(result.gates.find((gate) => gate.id === 'valid-versioned-snapshots').pass, false);
});

test('release artifacts whitelist metrics and lineage instead of copying prompt, source, or respondent text', () => {
  const current = {
    ...structuredClone(snapshot),
    prompt: 'secret prompt text',
    sourceExcerpt: 'private source text',
    respondentQuote: 'participant-looking text',
  };
  const result = evaluate(snapshot, current);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secret prompt text'), false);
  assert.equal(serialized.includes('private source text'), false);
  assert.equal(serialized.includes('participant-looking text'), false);
});

test('drift comparison rejects incomplete snapshots and reports version and metric deltas otherwise', () => {
  assert.equal(compareEvaluationVersions({}, snapshot).valid, false);
  const current = structuredClone(snapshot);
  current.versions.modelRoutes.panel = ['openai/model-c'];
  current.operations.fallbackRate = 0.1;
  const drift = compareEvaluationVersions(snapshot, current);
  assert.equal(drift.valid, true);
  assert.deepEqual(drift.versionChanges.modelRouteStagesChanged, ['panel']);
  assert.equal(drift.metricDrift.fallbackRateDelta, 0.05);
});

test('forged, untrusted, or candidate-mismatched attestations cannot produce GO', () => {
  const attacker = generateKeyPairSync('ed25519');
  const forgedReviews = reviewsFor(snapshot).map((review) => signedEnvelope(review.artifact, attacker.privateKey));
  const forged = evaluateReleaseCandidate({
    baseline: snapshot,
    current: snapshot,
    editorialReviews: forgedReviews,
    policyApproval: approvalFor(snapshot),
    trustedReviewerKeys,
    trustedPolicyApproverKeys,
  });
  assert.equal(forged.decision, 'NO_GO');

  const otherCandidate = structuredClone(snapshot);
  otherCandidate.evaluationVersion = 'eval-other';
  const mismatched = evaluate(snapshot, otherCandidate, { editorialReviews: reviewsFor(snapshot) });
  assert.equal(mismatched.decision, 'NO_GO');
});

test('a capture older than its baseline fails chronology and cannot produce GO', () => {
  const stale = structuredClone(snapshot);
  stale.capturedAt = '2029-12-31T00:00:00.000Z';
  const result = evaluate(snapshot, stale);
  assert.equal(result.decision, 'NO_GO');
  assert.equal(result.releaseAllowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes('must be at or after')));
});
