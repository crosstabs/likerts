import { createHash, verify as verifyCryptographicSignature } from 'node:crypto';

export const EVALUATION_RELEASE_DECISION_VERSION = 'evaluation-release-decision-v1';
export const EVALUATION_RELEASE_POLICY_VERSION = 'evaluation-release-policy-v1';
export const HUMAN_EDITORIAL_RUBRIC_VERSION = 'human-editorial-rubric-v1';

export const HUMAN_EDITORIAL_CRITERIA = Object.freeze([
  { id: 'synthetic-boundary', label: 'Synthetic and human evidence remain unmistakably distinct.' },
  { id: 'population-fit', label: 'Population fit and unsupported characteristics are disclosed.' },
  { id: 'method-fit', label: 'The instrument, estimand, chart, critic, and validation plan fit the selected method.' },
  { id: 'evidence-discipline', label: 'Evidence, assumptions, model inference, and verification state remain distinct.' },
  { id: 'language-and-culture', label: 'Language, script, locale, and cultural claims have been reviewed at the claimed level.' },
  { id: 'accessibility-and-rtl', label: 'The reviewed experience is accessible and directionally correct, including RTL where applicable.' },
  { id: 'privacy-and-safety', label: 'Sensitive content, retention, deletion, and participant-like material follow the privacy contract.' },
  { id: 'human-validation-off-ramp', label: 'Limitations and the recommended real-human validation path are actionable and honest.' },
]);

export const EVALUATION_RELEASE_THRESHOLDS = Object.freeze({
  contractPassRateMin: 1,
  forbiddenHumanClaimCountMax: 0,
  malformedInputFailClosedRateMin: 1,
  repeatabilityRunCountMin: 3,
  totalVariationMax: 0.1,
  jensenShannonMax: 0.05,
  maxPercentagePointSpreadMax: 15,
  p95LatencyMsMax: 30_000,
  p95CostUsdMax: 0.5,
  fallbackRateMax: 0.25,
  drift: Object.freeze({
    contractPassRateDropMax: 0.01,
    malformedInputFailClosedRateDropMax: 0,
    totalVariationIncreaseMax: 0.02,
    jensenShannonIncreaseMax: 0.01,
    maxPercentagePointSpreadIncreaseMax: 5,
    p95LatencyRelativeIncreaseMax: 0.25,
    p95CostRelativeIncreaseMax: 0.25,
    fallbackRateIncreaseMax: 0.1,
  }),
});

const VERSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function canonicalEvaluationJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalEvaluationJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalEvaluationJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function hashEvaluationArtifact(value) {
  return createHash('sha256').update(canonicalEvaluationJson(value)).digest('hex');
}

export const EVALUATION_RELEASE_THRESHOLDS_HASH = hashEvaluationArtifact(EVALUATION_RELEASE_THRESHOLDS);

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function signedEnvelopeValid(envelope, artifactKeys, trustedKeys, identityField) {
  if (!exactKeys(envelope, ['artifact', 'signature']) || !exactKeys(envelope.artifact, artifactKeys) || typeof envelope.signature !== 'string' || !SIGNATURE_PATTERN.test(envelope.signature)) return false;
  const signerId = envelope.artifact[identityField];
  const trustedKey = trustedKeys && typeof trustedKeys === 'object' ? trustedKeys[signerId] : null;
  if (!trustedKey) return false;
  try {
    return verifyCryptographicSignature(null, Buffer.from(canonicalEvaluationJson(envelope.artifact)), trustedKey, Buffer.from(envelope.signature, 'base64'));
  } catch {
    return false;
  }
}

function finite(value, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function versionMap(value, field, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${field} must be a version map.`);
    return {};
  }
  const output = {};
  for (const [key, version] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (!VERSION_KEY_PATTERN.test(key) || typeof version !== 'string' || !VERSION_KEY_PATTERN.test(version)) {
      errors.push(`${field} contains an invalid stage or version identifier.`);
      continue;
    }
    output[key] = version;
  }
  if (Object.keys(output).length === 0) errors.push(`${field} must not be empty.`);
  return output;
}

function modelRoutes(value, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('versions.modelRoutes must be a stage-to-route map.');
    return {};
  }
  const output = {};
  for (const [stage, route] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (!VERSION_KEY_PATTERN.test(stage) || !Array.isArray(route) || route.length === 0 || route.some((model) => typeof model !== 'string' || !VERSION_KEY_PATTERN.test(model))) {
      errors.push('versions.modelRoutes contains an invalid stage or route.');
      continue;
    }
    output[stage] = [...route];
  }
  if (Object.keys(output).length === 0) errors.push('versions.modelRoutes must not be empty.');
  return output;
}

function normalizeSnapshot(value, label) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value: null, errors: [`${label} snapshot is required.`] };

  const snapshot = {
    evaluationVersion: typeof value.evaluationVersion === 'string' && VERSION_KEY_PATTERN.test(value.evaluationVersion) ? value.evaluationVersion : null,
    capturedAt: typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt)) ? new Date(value.capturedAt).toISOString() : null,
    versions: {
      runtimeVersion: typeof value.versions?.runtimeVersion === 'string' && VERSION_KEY_PATTERN.test(value.versions.runtimeVersion) ? value.versions.runtimeVersion : null,
      promptVersions: versionMap(value.versions?.promptVersions, 'versions.promptVersions', errors),
      schemaVersions: versionMap(value.versions?.schemaVersions, 'versions.schemaVersions', errors),
      modelRoutes: modelRoutes(value.versions?.modelRoutes, errors),
    },
    quality: {
      contractPassRate: value.quality?.contractPassRate,
      forbiddenHumanClaimCount: value.quality?.forbiddenHumanClaimCount,
      malformedInputFailClosedRate: value.quality?.malformedInputFailClosedRate,
    },
    repeatability: {
      runCount: value.repeatability?.runCount,
      totalVariation: value.repeatability?.totalVariation,
      jensenShannon: value.repeatability?.jensenShannon,
      maxPercentagePointSpread: value.repeatability?.maxPercentagePointSpread,
    },
    operations: {
      p95LatencyMs: value.operations?.p95LatencyMs,
      p95CostUsd: value.operations?.p95CostUsd,
      fallbackRate: value.operations?.fallbackRate,
    },
  };

  if (!snapshot.evaluationVersion) errors.push(`${label}.evaluationVersion is invalid.`);
  if (!snapshot.capturedAt) errors.push(`${label}.capturedAt is invalid.`);
  if (!snapshot.versions.runtimeVersion) errors.push(`${label}.versions.runtimeVersion is invalid.`);
  if (!finite(snapshot.quality.contractPassRate, 0, 1)) errors.push(`${label}.quality.contractPassRate must be between 0 and 1.`);
  if (!Number.isInteger(snapshot.quality.forbiddenHumanClaimCount) || snapshot.quality.forbiddenHumanClaimCount < 0) errors.push(`${label}.quality.forbiddenHumanClaimCount must be a non-negative integer.`);
  if (!finite(snapshot.quality.malformedInputFailClosedRate, 0, 1)) errors.push(`${label}.quality.malformedInputFailClosedRate must be between 0 and 1.`);
  if (!Number.isInteger(snapshot.repeatability.runCount) || snapshot.repeatability.runCount < 0) errors.push(`${label}.repeatability.runCount must be a non-negative integer.`);
  if (!finite(snapshot.repeatability.totalVariation, 0, 1)) errors.push(`${label}.repeatability.totalVariation must be between 0 and 1.`);
  if (!finite(snapshot.repeatability.jensenShannon, 0, 1)) errors.push(`${label}.repeatability.jensenShannon must be between 0 and 1.`);
  if (!finite(snapshot.repeatability.maxPercentagePointSpread, 0, 100)) errors.push(`${label}.repeatability.maxPercentagePointSpread must be between 0 and 100.`);
  if (!finite(snapshot.operations.p95LatencyMs)) errors.push(`${label}.operations.p95LatencyMs must be finite and non-negative.`);
  if (!finite(snapshot.operations.p95CostUsd)) errors.push(`${label}.operations.p95CostUsd must be finite and non-negative.`);
  if (!finite(snapshot.operations.fallbackRate, 0, 1)) errors.push(`${label}.operations.fallbackRate must be between 0 and 1.`);

  return { value: snapshot, errors };
}

function changedKeys(baseline = {}, current = {}) {
  return [...new Set([...Object.keys(baseline), ...Object.keys(current)])]
    .sort()
    .filter((key) => JSON.stringify(baseline[key]) !== JSON.stringify(current[key]));
}

function relativeIncrease(baseline, current) {
  if (baseline === 0) return current === 0 ? 0 : null;
  return Number(((current - baseline) / baseline).toFixed(6));
}

export function compareEvaluationVersions(baseline, current) {
  const baselineResult = normalizeSnapshot(baseline, 'baseline');
  const currentResult = normalizeSnapshot(current, 'current');
  const errors = [...baselineResult.errors, ...currentResult.errors];
  if (!errors.length && Date.parse(currentResult.value.capturedAt) < Date.parse(baselineResult.value.capturedAt)) errors.push('current.capturedAt must be at or after baseline.capturedAt.');
  if (errors.length) return { valid: false, errors, versionChanges: null, metricDrift: null };

  const left = baselineResult.value;
  const right = currentResult.value;
  return {
    valid: true,
    errors: [],
    versionChanges: {
      evaluationVersionChanged: left.evaluationVersion !== right.evaluationVersion,
      runtimeVersionChanged: left.versions.runtimeVersion !== right.versions.runtimeVersion,
      promptStagesChanged: changedKeys(left.versions.promptVersions, right.versions.promptVersions),
      schemaStagesChanged: changedKeys(left.versions.schemaVersions, right.versions.schemaVersions),
      modelRouteStagesChanged: changedKeys(left.versions.modelRoutes, right.versions.modelRoutes),
    },
    metricDrift: {
      contractPassRateDelta: Number((right.quality.contractPassRate - left.quality.contractPassRate).toFixed(6)),
      malformedInputFailClosedRateDelta: Number((right.quality.malformedInputFailClosedRate - left.quality.malformedInputFailClosedRate).toFixed(6)),
      totalVariationDelta: Number((right.repeatability.totalVariation - left.repeatability.totalVariation).toFixed(6)),
      jensenShannonDelta: Number((right.repeatability.jensenShannon - left.repeatability.jensenShannon).toFixed(6)),
      maxPercentagePointSpreadDelta: Number((right.repeatability.maxPercentagePointSpread - left.repeatability.maxPercentagePointSpread).toFixed(6)),
      p95LatencyRelativeIncrease: relativeIncrease(left.operations.p95LatencyMs, right.operations.p95LatencyMs),
      p95CostRelativeIncrease: relativeIncrease(left.operations.p95CostUsd, right.operations.p95CostUsd),
      fallbackRateDelta: Number((right.operations.fallbackRate - left.operations.fallbackRate).toFixed(6)),
    },
  };
}

function gate(id, category, pass, details) {
  return { id, category, pass: Boolean(pass), details };
}

function automatedGates(snapshot, drift, thresholds) {
  const gates = [
    gate('contract-pass-rate', 'quality', snapshot.quality.contractPassRate >= thresholds.contractPassRateMin, `Minimum ${thresholds.contractPassRateMin}.`),
    gate('forbidden-human-claims', 'safety', snapshot.quality.forbiddenHumanClaimCount <= thresholds.forbiddenHumanClaimCountMax, `Maximum ${thresholds.forbiddenHumanClaimCountMax}.`),
    gate('malformed-input-fail-closed', 'safety', snapshot.quality.malformedInputFailClosedRate >= thresholds.malformedInputFailClosedRateMin, `Minimum ${thresholds.malformedInputFailClosedRateMin}.`),
    gate('repeatability-run-count', 'repeatability', snapshot.repeatability.runCount >= thresholds.repeatabilityRunCountMin, `Minimum ${thresholds.repeatabilityRunCountMin}.`),
    gate('repeatability-total-variation', 'repeatability', snapshot.repeatability.totalVariation <= thresholds.totalVariationMax, `Maximum ${thresholds.totalVariationMax}.`),
    gate('repeatability-jensen-shannon', 'repeatability', snapshot.repeatability.jensenShannon <= thresholds.jensenShannonMax, `Maximum ${thresholds.jensenShannonMax}.`),
    gate('repeatability-max-spread', 'repeatability', snapshot.repeatability.maxPercentagePointSpread <= thresholds.maxPercentagePointSpreadMax, `Maximum ${thresholds.maxPercentagePointSpreadMax} percentage points.`),
    gate('p95-latency', 'operations', snapshot.operations.p95LatencyMs <= thresholds.p95LatencyMsMax, `Maximum ${thresholds.p95LatencyMsMax} ms.`),
    gate('p95-cost', 'operations', snapshot.operations.p95CostUsd <= thresholds.p95CostUsdMax, `Maximum $${thresholds.p95CostUsdMax} per run.`),
    gate('fallback-rate', 'operations', snapshot.operations.fallbackRate <= thresholds.fallbackRateMax, `Maximum ${thresholds.fallbackRateMax}.`),
  ];

  const delta = drift.metricDrift;
  gates.push(
    gate('drift-contract-pass-rate', 'drift', delta.contractPassRateDelta >= -thresholds.drift.contractPassRateDropMax, `Maximum drop ${thresholds.drift.contractPassRateDropMax}.`),
    gate('drift-malformed-fail-closed', 'drift', delta.malformedInputFailClosedRateDelta >= -thresholds.drift.malformedInputFailClosedRateDropMax, `Maximum drop ${thresholds.drift.malformedInputFailClosedRateDropMax}.`),
    gate('drift-total-variation', 'drift', delta.totalVariationDelta <= thresholds.drift.totalVariationIncreaseMax, `Maximum increase ${thresholds.drift.totalVariationIncreaseMax}.`),
    gate('drift-jensen-shannon', 'drift', delta.jensenShannonDelta <= thresholds.drift.jensenShannonIncreaseMax, `Maximum increase ${thresholds.drift.jensenShannonIncreaseMax}.`),
    gate('drift-max-spread', 'drift', delta.maxPercentagePointSpreadDelta <= thresholds.drift.maxPercentagePointSpreadIncreaseMax, `Maximum increase ${thresholds.drift.maxPercentagePointSpreadIncreaseMax} percentage points.`),
    gate('drift-p95-latency', 'drift', delta.p95LatencyRelativeIncrease !== null && delta.p95LatencyRelativeIncrease <= thresholds.drift.p95LatencyRelativeIncreaseMax, `Maximum relative increase ${thresholds.drift.p95LatencyRelativeIncreaseMax}.`),
    gate('drift-p95-cost', 'drift', delta.p95CostRelativeIncrease !== null && delta.p95CostRelativeIncrease <= thresholds.drift.p95CostRelativeIncreaseMax, `Maximum relative increase ${thresholds.drift.p95CostRelativeIncreaseMax}.`),
    gate('drift-fallback-rate', 'drift', delta.fallbackRateDelta <= thresholds.drift.fallbackRateIncreaseMax, `Maximum increase ${thresholds.drift.fallbackRateIncreaseMax}.`),
  );
  return gates;
}

function editorialGates(reviews, trustedReviewerKeys, candidateEvaluationHash) {
  const byId = new Map();
  const invalid = [];
  if (reviews === undefined || reviews === null) return { gates: HUMAN_EDITORIAL_CRITERIA.map((criterion) => gate(`editorial-${criterion.id}`, 'editorial', false, 'Human review is missing.')), complete: false, failed: false, invalid: [] };
  if (!Array.isArray(reviews)) return { gates: HUMAN_EDITORIAL_CRITERIA.map((criterion) => gate(`editorial-${criterion.id}`, 'editorial', false, 'Human review is invalid.')), complete: false, failed: false, invalid: ['Editorial reviews must be an array of signed envelopes.'] };

  for (const review of reviews) {
    const artifact = review?.artifact;
    const structurallyValid = artifact
      && artifact.schemaVersion === 'human-editorial-review-v1'
      && artifact.rubricVersion === HUMAN_EDITORIAL_RUBRIC_VERSION
      && HUMAN_EDITORIAL_CRITERIA.some((criterion) => criterion.id === artifact.criterionId)
      && ['PASS', 'FAIL'].includes(artifact.status)
      && typeof artifact.reviewerId === 'string' && VERSION_KEY_PATTERN.test(artifact.reviewerId)
      && typeof artifact.reviewedAt === 'string' && Number.isFinite(Date.parse(artifact.reviewedAt))
      && artifact.candidateEvaluationHash === candidateEvaluationHash;
    const signatureValid = structurallyValid && signedEnvelopeValid(
      review,
      ['schemaVersion', 'rubricVersion', 'criterionId', 'status', 'reviewerId', 'reviewedAt', 'candidateEvaluationHash'],
      trustedReviewerKeys,
      'reviewerId',
    );
    if (!signatureValid || byId.has(artifact?.criterionId)) {
      invalid.push('Editorial reviews must be unique signed artifacts from trusted reviewers and bound to the exact candidate evaluation hash.');
      continue;
    }
    byId.set(artifact.criterionId, artifact.status);
  }

  const gates = HUMAN_EDITORIAL_CRITERIA.map((criterion) => {
    const status = byId.get(criterion.id);
    return gate(`editorial-${criterion.id}`, 'editorial', status === 'PASS', status ? `Human editorial status: ${status}.` : 'Human review is missing.');
  });
  return { gates, complete: invalid.length === 0 && byId.size === HUMAN_EDITORIAL_CRITERIA.length, failed: [...byId.values()].includes('FAIL'), invalid };
}

function policyApprovalResult(approval, trustedPolicyApproverKeys, baselineEvaluationHash) {
  if (approval === undefined || approval === null) return { gate: gate('calibrated-policy-approval', 'governance', false, 'A signed calibration approval is required.'), missing: true, invalid: false };
  const artifact = approval?.artifact;
  const structurallyValid = artifact
    && artifact.schemaVersion === 'evaluation-policy-approval-v1'
    && artifact.status === 'APPROVED'
    && artifact.policyVersion === EVALUATION_RELEASE_POLICY_VERSION
    && artifact.thresholdsHash === EVALUATION_RELEASE_THRESHOLDS_HASH
    && artifact.baselineEvaluationHash === baselineEvaluationHash
    && typeof artifact.approverId === 'string' && VERSION_KEY_PATTERN.test(artifact.approverId)
    && typeof artifact.approvedAt === 'string' && Number.isFinite(Date.parse(artifact.approvedAt));
  const pass = structurallyValid && signedEnvelopeValid(
    approval,
    ['schemaVersion', 'status', 'policyVersion', 'thresholdsHash', 'baselineEvaluationHash', 'approverId', 'approvedAt'],
    trustedPolicyApproverKeys,
    'approverId',
  );
  return {
    gate: gate('calibrated-policy-approval', 'governance', pass, pass ? 'The exact thresholds and baseline have a trusted cryptographic calibration approval.' : 'The calibration approval is malformed, untrusted, unsigned, or bound to another policy/baseline.'),
    missing: false,
    invalid: !pass,
  };
}

export function evaluateReleaseCandidate({ baseline, current, editorialReviews, policyApproval, trustedReviewerKeys, trustedPolicyApproverKeys } = {}) {
  const baselineResult = normalizeSnapshot(baseline, 'baseline');
  const currentResult = normalizeSnapshot(current, 'current');
  const snapshotErrors = [...baselineResult.errors, ...currentResult.errors];
  const baselineEvaluationHash = baselineResult.value && baselineResult.errors.length === 0 ? hashEvaluationArtifact(baselineResult.value) : null;
  const candidateEvaluationHash = currentResult.value && currentResult.errors.length === 0 ? hashEvaluationArtifact(currentResult.value) : null;
  const approval = policyApprovalResult(policyApproval, trustedPolicyApproverKeys, baselineEvaluationHash);
  const editorial = editorialGates(editorialReviews, trustedReviewerKeys, candidateEvaluationHash);

  if (snapshotErrors.length) {
    const gates = [gate('valid-versioned-snapshots', 'contract', false, 'Both snapshots must satisfy the metric and lineage contract.'), approval.gate, ...editorial.gates];
    return {
      schemaVersion: EVALUATION_RELEASE_DECISION_VERSION,
      policyVersion: EVALUATION_RELEASE_POLICY_VERSION,
      rubricVersion: HUMAN_EDITORIAL_RUBRIC_VERSION,
      decision: 'NO_GO',
      releaseAllowed: false,
      reasons: [...new Set([...snapshotErrors, ...editorial.invalid])],
      gates,
      baseline: null,
      current: null,
      drift: null,
    };
  }

  const drift = compareEvaluationVersions(baselineResult.value, currentResult.value);
  if (!drift.valid) {
    const gates = [gate('valid-versioned-snapshots', 'contract', false, 'The current capture must not predate its baseline.'), approval.gate, ...editorial.gates];
    return {
      schemaVersion: EVALUATION_RELEASE_DECISION_VERSION,
      policyVersion: EVALUATION_RELEASE_POLICY_VERSION,
      rubricVersion: HUMAN_EDITORIAL_RUBRIC_VERSION,
      decision: 'NO_GO',
      releaseAllowed: false,
      reasons: [...drift.errors, ...editorial.invalid],
      gates,
      baseline: baselineResult.value,
      current: currentResult.value,
      baselineEvaluationHash,
      candidateEvaluationHash,
      drift: null,
    };
  }
  const automated = automatedGates(currentResult.value, drift, EVALUATION_RELEASE_THRESHOLDS);
  const gates = [gate('valid-versioned-snapshots', 'contract', true, 'Both snapshots satisfy the metric, lineage, and chronology contract.'), approval.gate, ...automated, ...editorial.gates];
  const automatedFailure = automated.some((item) => !item.pass);
  const hardFailure = automatedFailure || approval.invalid || editorial.failed || editorial.invalid.length > 0;
  const pendingGovernance = approval.missing || !editorial.complete;
  const decision = hardFailure ? 'NO_GO' : pendingGovernance ? 'HOLD' : 'GO';

  return {
    schemaVersion: EVALUATION_RELEASE_DECISION_VERSION,
    policyVersion: EVALUATION_RELEASE_POLICY_VERSION,
    rubricVersion: HUMAN_EDITORIAL_RUBRIC_VERSION,
    decision,
    releaseAllowed: decision === 'GO',
    reasons: gates.filter((item) => !item.pass).map((item) => `${item.id}: ${item.details}`),
    gates,
    baseline: baselineResult.value,
    current: currentResult.value,
    baselineEvaluationHash,
    candidateEvaluationHash,
    drift,
  };
}
