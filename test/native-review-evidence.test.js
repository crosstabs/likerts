import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CJK_LOCALE_IDS,
  LOCALIZATION_CAPABILITIES,
  LOCALIZATION_RELEASE_STATUSES,
  LOCALE_CAPABILITIES,
} from '../shared/localization.mjs';
import {
  CJK_COMPLETED_REVIEW_PACKET_SCHEMA_VERSION,
  CJK_COMPLETED_REVIEW_PACKET_VERSION,
  CJK_NATIVE_REVIEW_ACCESSIBILITY_REQUIREMENTS,
  CJK_NATIVE_REVIEW_GLOSSARY_VERSION,
  CJK_NATIVE_REVIEW_PROVENANCE_REQUIREMENTS,
  CJK_NATIVE_REVIEW_REQUIRED_JOURNEY_IDS,
  CJK_NATIVE_REVIEW_REQUIRED_VIEWPORTS,
  canonicalNativeReviewEvidenceJson,
  hashNativeReviewEvidence,
  MAX_NATIVE_REVIEW_PACKET_BYTES,
  NATIVE_REVIEW_EVIDENCE_SCHEMA_VERSION,
  NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES,
  evaluateNativeReviewEligibility,
  validateNativeReviewEvidence,
} from '../server/native-review-evidence.js';
import { CURRENT_LOCALIZATION_CATALOG_HASH } from '../server/localization-catalog-hash.js';
import { runNativeReviewIntakeCli } from '../scripts/import-native-review-evidence.mjs';

const reviewerKeys = generateKeyPairSync('ed25519');
const trustedReviewerKeys = {
  'cjk-reviewer-01': {
    publicKeyPem: reviewerKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    allowedLocales: ['ja-JP'],
  },
};
const NOW = new Date('2026-08-29T12:05:00.000Z');
const TIME_POLICY = Object.freeze({ now: NOW, maxAgeMs: 60 * 60 * 1_000, maxFutureSkewMs: 60 * 1_000 });

const REVIEW_AREAS = [
  'meaning', 'tone', 'terminology', 'placeholder', 'scale-anchor', 'disclosure',
  'truncation', 'interaction-label', 'cultural-assumption', 'accessibility',
  'script', 'source-provenance', 'market-or-retrieval', 'technical-token',
];
const JOURNEY_IDS = [
  'first-run', 'study-setup', 'research-methods', 'respondent-instrument', 'results',
  'population-frame', 'evidence', 'retrieval', 'stability', 'qualitative', 'sample-library',
];
const REQUIRED_VIEWPORTS = [320, 375, 768, 1440];
const ACCESSIBILITY_REQUIREMENTS = [
  'document lang and direction are correct',
  'every control has a localized accessible name',
  'visible focus remains visible at all viewports',
  'keyboard order matches visual order',
  'expanded/collapsed state is announced',
  'validation and live-region messages are localized',
  'charts have a readable table or text alternative',
  'CJK text does not clip or create page-level horizontal overflow',
  'technical identifiers may wrap safely without changing content',
  'Korean syllable clusters are not orphaned by unsafe word-breaking',
];
const PROVENANCE_REQUIREMENTS = [
  'locale', 'market', 'catalogHash', 'glossaryVersion', 'buildId', 'productVersion',
  'promptVersion', 'modelVersions', 'sourceSnapshotDate', 'browserGateEvidenceReference',
  'reviewer', 'reviewedAt', 'approvalReference',
];
const RECHECK_REQUIREMENTS = [
  'blocking-findings-resolved',
  'blocking-findings-rechecked',
  'automated-checks-rerun-after-resolution',
];

function completions(section, ids) {
  return ids.map((id, index) => ({
    id,
    completed: true,
    evidenceReference: `review-packet/completion/${section}/${index + 1}`,
  }));
}

function completionSummary(overrides = {}) {
  return {
    journeys: completions('journeys', JOURNEY_IDS),
    viewports: completions('viewports', REQUIRED_VIEWPORTS),
    capabilities: completions('capabilities', LOCALIZATION_CAPABILITIES),
    reviewAreas: completions('review-areas', REVIEW_AREAS),
    accessibilityRequirements: completions('accessibility', ACCESSIBILITY_REQUIREMENTS),
    provenanceRequirements: completions('provenance', PROVENANCE_REQUIREMENTS),
    recheckRequirements: completions('rechecks', RECHECK_REQUIREMENTS),
    blockingFindingRechecks: completions('finding-rechecks', ['ja-001']),
    ...overrides,
  };
}

function artifact(overrides = {}) {
  return {
    schemaVersion: NATIVE_REVIEW_EVIDENCE_SCHEMA_VERSION,
    reviewProgram: 'cjk-native-review',
    registryVersion: 'localization-capabilities-v2',
    locale: 'ja-JP',
    reviewerId: 'cjk-reviewer-01',
    reviewedAt: '2026-08-29T12:00:00.000Z',
    glossaryVersion: 'cjk-glossary-v1.0.0',
    catalogHash: CURRENT_LOCALIZATION_CATALOG_HASH,
    buildId: '0123456789abcdef0123456789abcdef01234567',
    reviewedProductVersion: '0123456789abcdef0123456789abcdef01234567',
    reviewedPromptVersion: 'prompts-2026.08.29',
    reviewPacketDigest: `sha256:${'c'.repeat(64)}`,
    reviewPacketReference: 'native-review/ja-jp/completed-review-packet.json',
    completionSummary: completionSummary(),
    capabilityScope: [...LOCALIZATION_CAPABILITIES],
    reviewCoverage: [...REVIEW_AREAS],
    findingsLog: [
      {
        id: 'ja-001',
        severity: 'blocking',
        status: 'resolved',
        summary: 'A scale-anchor issue was rechecked in the reviewed build.',
        evidenceReference: 'review-notes/ja-001',
      },
    ],
    blockingFindingsResolved: true,
    browserGateEvidenceReference: 'localization-browser/0123456789abcdef0123456789abcdef01234567/attestation.json',
    approvalReference: 'native-review/ja-jp/2026-08-29',
    ...overrides,
  };
}

function signedEnvelope(review = artifact(), privateKey = reviewerKeys.privateKey) {
  return {
    artifact: review,
    signature: sign(null, Buffer.from(canonicalNativeReviewEvidenceJson(review)), privateKey).toString('base64'),
  };
}

function expectedBindings(overrides = {}) {
  return {
    locale: 'ja-JP',
    catalogHash: CURRENT_LOCALIZATION_CATALOG_HASH,
    buildId: '0123456789abcdef0123456789abcdef01234567',
    browserGateEvidenceReference: 'localization-browser/0123456789abcdef0123456789abcdef01234567/attestation.json',
    approvalReference: 'native-review/ja-jp/2026-08-29',
    reviewedProductVersion: '0123456789abcdef0123456789abcdef01234567',
    reviewedPromptVersion: 'prompts-2026.08.29',
    reviewPacketDigest: `sha256:${'c'.repeat(64)}`,
    reviewPacketReference: 'native-review/ja-jp/completed-review-packet.json',
    ...overrides,
  };
}

function validationOptions(overrides = {}) {
  return { trustedReviewerKeys, expectedBindings: expectedBindings(), ...TIME_POLICY, ...overrides };
}

function expectedBindingArgs(bindings = expectedBindings()) {
  return [
    '--expected-locale', bindings.locale,
    '--expected-catalog-hash', bindings.catalogHash,
    '--expected-build-id', bindings.buildId,
    '--expected-browser-evidence-reference', bindings.browserGateEvidenceReference,
    '--expected-approval-reference', bindings.approvalReference,
    '--expected-product-version', bindings.reviewedProductVersion,
    '--expected-prompt-version', bindings.reviewedPromptVersion,
  ];
}

function packetFindingFor(reviewFinding, review) {
  const recheck = review.completionSummary.blockingFindingRechecks
    .find((entry) => entry.id === reviewFinding.id)?.evidenceReference ?? null;
  return {
    id: reviewFinding.id,
    locale: review.locale,
    capability: 'instrument',
    journeyId: 'research-methods',
    severity: reviewFinding.severity === 'blocking' ? 'blocking' : 'high',
    category: 'scale-anchor',
    status: reviewFinding.status,
    summary: reviewFinding.summary,
    sourceText: 'Original reviewed wording.',
    proposedText: 'Corrected reviewed wording.',
    rationale: 'The packet records the reviewer rationale for this finding.',
    evidenceReference: reviewFinding.evidenceReference,
    reviewerId: review.reviewerId,
    resolvedAt: reviewFinding.status === 'resolved' ? '2026-08-29T12:01:00.000Z' : null,
    recheckEvidence: reviewFinding.status === 'resolved' ? recheck : null,
  };
}

function declaredEvidenceContentDigest(reference) {
  return `sha256:${createHash('sha256').update(`test fixture evidence bytes for ${reference}`, 'utf8').digest('hex')}`;
}

function completedPacket(review, overrides = {}) {
  const evidenceRecords = [];
  const addEvidence = (id, kind) => {
    if (!evidenceRecords.some((record) => record.id === id)) {
      evidenceRecords.push({
        id,
        kind,
        summary: `Recorded ${kind} evidence for ${id}.`,
        contentDigest: declaredEvidenceContentDigest(id),
      });
    }
  };
  for (const [section, entries] of Object.entries(review.completionSummary)) {
    for (const entry of entries) addEvidence(entry.evidenceReference, section === 'blockingFindingRechecks' ? 'recheck' : 'completion');
  }
  for (const finding of review.findingsLog) addEvidence(finding.evidenceReference, 'finding');
  addEvidence(review.browserGateEvidenceReference, 'browser-gate');
  addEvidence(review.approvalReference, 'approval');

  return {
    schemaVersion: CJK_COMPLETED_REVIEW_PACKET_SCHEMA_VERSION,
    packetVersion: CJK_COMPLETED_REVIEW_PACKET_VERSION,
    reviewProgram: 'cjk-native-review',
    status: 'completed',
    locale: review.locale,
    reviewPacketReference: review.reviewPacketReference,
    provenance: {
      locale: review.locale,
      market: review.locale === 'ja-JP' ? 'JP' : review.locale === 'ko-KR' ? 'KR' : 'CN',
      catalogHash: review.catalogHash,
      glossaryVersion: review.glossaryVersion,
      buildId: review.buildId,
      reviewedProductVersion: review.reviewedProductVersion,
      reviewedPromptVersion: review.reviewedPromptVersion,
      modelVersions: ['model-2026.08.29'],
      sourceSnapshotDate: '2026-08-29',
      browserGateEvidenceReference: review.browserGateEvidenceReference,
      reviewerId: review.reviewerId,
      reviewedAt: review.reviewedAt,
      approvalReference: review.approvalReference,
    },
    completionSummary: structuredClone(review.completionSummary),
    findings: review.findingsLog.map((finding) => packetFindingFor(finding, review)),
    evidenceRecords,
    ...overrides,
  };
}

function completedPacketBytes(review, overrides = {}) {
  return Buffer.from(`${JSON.stringify(completedPacket(review, overrides))}\n`);
}

function reviewWithCompletedPacket(overrides = {}) {
  const draft = artifact(overrides);
  const packetBytes = completedPacketBytes(draft);
  return {
    review: artifact({ ...overrides, reviewPacketDigest: `sha256:${createHash('sha256').update(packetBytes).digest('hex')}` }),
    packetBytes,
  };
}

function reviewedEntry(receipt, overrides = {}) {
  const entry = structuredClone(LOCALE_CAPABILITIES['ja-JP']);
  entry.release.copyStatus = LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED;
  entry.release.nativeReview = {
    status: LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED,
    statusByCapability: Object.fromEntries(
      LOCALIZATION_CAPABILITIES.map((capability) => [capability, LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED]),
    ),
    ...structuredClone(receipt.registryProjection),
  };
  return { ...entry, ...overrides };
}

function validatedReview(overrides = {}) {
  const { review, packetBytes } = reviewWithCompletedPacket(overrides);
  const result = validateNativeReviewEvidence(
    signedEnvelope(review),
    validationOptions({ expectedBindings: expectedBindings({
      ...overrides,
      reviewPacketDigest: review.reviewPacketDigest,
      reviewPacketReference: review.reviewPacketReference,
    }), reviewPacketBytes: packetBytes }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'EVIDENCE_VALIDATED');
  return { review, packetBytes, receipt: result.value };
}

test('release eligibility is fail-closed without a packet-backed native-review receipt', () => {
  const absent = evaluateNativeReviewEligibility({
    entry: LOCALE_CAPABILITIES['ja-JP'],
    capability: 'ui',
    now: NOW,
  });
  assert.equal(absent.status, NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES.NOT_PROVIDED);
  assert.equal(absent.releaseEligible, false);

  const declaration = signedEnvelope();
  const declarationsOnly = evaluateNativeReviewEligibility({
    entry: LOCALE_CAPABILITIES['ja-JP'],
    capability: 'ui',
    evidenceBundle: { envelope: declaration },
    trustedReviewerKeys,
    expectedBindings: expectedBindings(),
    now: NOW,
  });
  assert.equal(declarationsOnly.status, NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES.DECLARATIONS_ONLY);
  assert.equal(declarationsOnly.releaseEligible, false);
});

test('release eligibility rejects expired evidence, stale bindings, and registry projection drift', () => {
  const { review, packetBytes, receipt } = validatedReview();
  const base = {
    entry: reviewedEntry(receipt),
    capability: 'ui',
    evidenceBundle: { envelope: signedEnvelope(review), reviewPacketBytes: packetBytes },
    trustedReviewerKeys,
    expectedBindings: expectedBindings({ reviewPacketDigest: review.reviewPacketDigest }),
    maxAgeMs: 60 * 60 * 1_000,
    now: NOW,
  };

  const expired = evaluateNativeReviewEligibility({ ...base, now: new Date('2026-08-29T13:00:00.000Z') });
  assert.equal(expired.status, NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES.EXPIRED);
  assert.equal(expired.releaseEligible, false);

  const stale = evaluateNativeReviewEligibility({
    ...base,
    expectedBindings: expectedBindings({
      buildId: 'fedcba9876543210fedcba9876543210fedcba98',
      reviewPacketDigest: review.reviewPacketDigest,
    }),
  });
  assert.equal(stale.status, NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES.STALE_BINDING);
  assert.equal(stale.releaseEligible, false);

  const driftedEntry = reviewedEntry(receipt);
  driftedEntry.release.nativeReview.reviewer = 'different-reviewer';
  const drift = evaluateNativeReviewEligibility({ ...base, entry: driftedEntry });
  assert.equal(drift.status, NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES.STALE_BINDING);
  assert.equal(drift.releaseEligible, false);
});

test('a valid signed completed packet enables only a reviewed capability on a matching registry projection', () => {
  const { review, packetBytes, receipt } = validatedReview();
  const result = evaluateNativeReviewEligibility({
    entry: reviewedEntry(receipt),
    capability: 'ui',
    evidenceBundle: { envelope: signedEnvelope(review), reviewPacketBytes: packetBytes },
    trustedReviewerKeys,
    expectedBindings: expectedBindings({ reviewPacketDigest: review.reviewPacketDigest }),
    now: NOW,
  });
  assert.equal(result.status, NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES.ELIGIBLE);
  assert.equal(result.releaseEligible, true);
  assert.equal(result.receipt.status, 'EVIDENCE_VALIDATED');
  assert.equal(result.receipt.reviewPacketByteVerification, 'HASH_VERIFIED');
  assert.equal(result.receipt.reviewPacketSchemaValidation, 'COMPLETED_PACKET_VALIDATED');
  assert.equal(Object.isFrozen(result), true);
});

test('a trusted, complete CJK native-review record yields an auditable intake without mutating the registry', () => {
  const original = structuredClone(LOCALE_CAPABILITIES['ja-JP'].release.nativeReview);
  const result = validateNativeReviewEvidence(signedEnvelope(), validationOptions());

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'DECLARATIONS_ONLY');
  assert.match(result.value.evidenceId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.value.registryMutation, 'NOT_PERFORMED');
  assert.equal(result.value.releaseDecision, 'NOT_EVALUATED');
  assert.equal(result.value.reviewPacketDigest, `sha256:${'c'.repeat(64)}`);
  assert.equal(result.value.reviewPacketReference, 'native-review/ja-jp/completed-review-packet.json');
  assert.equal(result.value.reviewPacketByteVerification, 'NOT_SUPPLIED');
  assert.equal(result.value.reviewPacketSchemaValidation, 'NOT_SUPPLIED');
  assert.equal(result.value.validatedAt, NOW.toISOString());
  assert.equal(result.value.expiresAt, '2026-08-29T13:00:00.000Z');
  assert.deepEqual(result.value.policy, {
    maxAgeMs: 60 * 60 * 1_000,
    maxFutureSkewMs: 60 * 1_000,
    packetRequiredForEvidenceValidated: true,
  });
  assert.deepEqual(result.value.completionSummary, completionSummary());
  assert.deepEqual(result.value.registryProjection.capabilityScope, LOCALIZATION_CAPABILITIES);
  assert.deepEqual(result.value.registryProjection.findingsLog, [{
    id: 'ja-001', severity: 'blocking', status: 'resolved', summary: 'A scale-anchor issue was rechecked in the reviewed build.',
  }]);
  assert.deepEqual(LOCALE_CAPABILITIES['ja-JP'].release.nativeReview, original);
  assert.equal(LOCALE_CAPABILITIES['ja-JP'].release.nativeReview.status, LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING);
});

test('intake requires signed, referenced completion of every canonical review requirement', () => {
  const requiredSections = {
    journeys: 'INCOMPLETE_JOURNEY_COMPLETIONS',
    viewports: 'INCOMPLETE_VIEWPORT_COMPLETIONS',
    capabilities: 'INCOMPLETE_CAPABILITY_COMPLETIONS',
    reviewAreas: 'INCOMPLETE_REVIEW_AREA_COMPLETIONS',
    accessibilityRequirements: 'INCOMPLETE_ACCESSIBILITY_COMPLETIONS',
    provenanceRequirements: 'INCOMPLETE_PROVENANCE_COMPLETIONS',
    recheckRequirements: 'INCOMPLETE_RECHECK_COMPLETIONS',
  };

  for (const [section, errorCode] of Object.entries(requiredSections)) {
    const summary = completionSummary();
    summary[section] = summary[section].slice(0, -1);
    const result = validateNativeReviewEvidence(
      signedEnvelope(artifact({ completionSummary: summary })),
      validationOptions(),
    );
    assert.equal(result.ok, false, section);
    assert.ok(result.errors.some((item) => item.code === errorCode), section);
  }

  for (const invalidEntry of [
    { id: JOURNEY_IDS[0], completed: false, evidenceReference: 'review-packet/completion/journeys/1' },
    { id: JOURNEY_IDS[0], completed: true, evidenceReference: '' },
  ]) {
    const summary = completionSummary();
    summary.journeys[0] = invalidEntry;
    const result = validateNativeReviewEvidence(
      signedEnvelope(artifact({ completionSummary: summary })),
      validationOptions(),
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.code === 'INCOMPLETE_JOURNEY_COMPLETIONS'));
  }
});

test('intake requires a signed recheck reference for every resolved blocking finding', () => {
  for (const blockingFindingRechecks of [
    [],
    completions('finding-rechecks', ['unrelated-finding']),
  ]) {
    const result = validateNativeReviewEvidence(signedEnvelope(artifact({
      completionSummary: completionSummary({ blockingFindingRechecks }),
    })), validationOptions());
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.code === 'INCOMPLETE_BLOCKING_FINDING_RECHECKS'));
  }
});

test('intake requires a signed review-packet digest/reference bound to operator expectations', () => {
  for (const overrides of [
    { reviewPacketDigest: 'sha256:not-a-digest' },
    { reviewPacketReference: '' },
  ]) {
    const result = validateNativeReviewEvidence(signedEnvelope(artifact(overrides)), validationOptions());
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.code === 'INVALID_REVIEW_PACKET_BINDING'));
  }

  for (const [field, value] of Object.entries({
    reviewPacketDigest: `sha256:${'d'.repeat(64)}`,
    reviewPacketReference: 'native-review/ja-jp/a-different-packet.json',
  })) {
    const result = validateNativeReviewEvidence(signedEnvelope(), validationOptions({
      expectedBindings: expectedBindings({ [field]: value }),
    }));
    assert.equal(result.ok, false, field);
    assert.ok(result.errors.some((item) => item.code === 'EXPECTED_BINDING_MISMATCH' && item.message.includes(field)), field);
  }
});

test('intake enforces a canonical UTC reviewedAt and the injected freshness policy', () => {
  for (const reviewedAt of [
    '2026-08-29T12:00:00Z',
    '2026-08-29T12:00:00.00Z',
    '2026-08-29T12:00:00.000+00:00',
    '2026-02-30T12:00:00.000Z',
  ]) {
    const result = validateNativeReviewEvidence(signedEnvelope(artifact({ reviewedAt })), validationOptions());
    assert.equal(result.ok, false, reviewedAt);
    assert.ok(result.errors.some((item) => item.code === 'INVALID_REVIEWED_AT'), reviewedAt);
  }

  const stale = validateNativeReviewEvidence(
    signedEnvelope(artifact({ reviewedAt: '2026-08-29T11:04:59.999Z' })),
    validationOptions(),
  );
  assert.equal(stale.ok, false);
  assert.ok(stale.errors.some((item) => item.code === 'REVIEW_EVIDENCE_TOO_OLD'));

  const future = validateNativeReviewEvidence(
    signedEnvelope(artifact({ reviewedAt: '2026-08-29T12:06:00.001Z' })),
    validationOptions(),
  );
  assert.equal(future.ok, false);
  assert.ok(future.errors.some((item) => item.code === 'REVIEW_EVIDENCE_FROM_FUTURE'));

  for (const invalidPolicy of [
    { now: new Date('invalid') },
    { maxAgeMs: -1 },
    { maxFutureSkewMs: Number.POSITIVE_INFINITY },
  ]) {
    const result = validateNativeReviewEvidence(signedEnvelope(), validationOptions(invalidPolicy));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.code === 'INVALID_TIME_POLICY'));
  }
});

test('intake rejects missing scope, missing coverage, unresolved blockers, and untrusted or tampered signatures', () => {
  const incompleteScope = validateNativeReviewEvidence(signedEnvelope(artifact({ capabilityScope: ['ui'] })), validationOptions());
  assert.equal(incompleteScope.ok, false);
  assert.ok(incompleteScope.errors.some((error) => error.code === 'INCOMPLETE_CAPABILITY_SCOPE'));

  const incompleteCoverage = validateNativeReviewEvidence(signedEnvelope(artifact({ reviewCoverage: REVIEW_AREAS.slice(1) })), validationOptions());
  assert.equal(incompleteCoverage.ok, false);
  assert.ok(incompleteCoverage.errors.some((error) => error.code === 'INCOMPLETE_REVIEW_COVERAGE'));

  const unresolved = validateNativeReviewEvidence(signedEnvelope(artifact({
    findingsLog: [{
      id: 'ja-001', severity: 'blocking', status: 'open', summary: 'A blocking issue remains.', evidenceReference: 'review-notes/ja-001',
    }],
  })), validationOptions());
  assert.equal(unresolved.ok, false);
  assert.ok(unresolved.errors.some((error) => error.code === 'BLOCKING_FINDINGS_UNRESOLVED'));

  const tampered = signedEnvelope();
  tampered.artifact.reviewedPromptVersion = 'another-prompt';
  const rejected = validateNativeReviewEvidence(tampered, validationOptions());
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some((error) => error.code === 'UNTRUSTED_OR_INVALID_SIGNATURE'));
});

test('intake accepts only canonical 64-byte Ed25519 signatures and derives the evidence ID from the artifact', () => {
  const review = artifact();
  const envelope = signedEnvelope(review);
  const accepted = validateNativeReviewEvidence(envelope, validationOptions());
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.evidenceId, hashNativeReviewEvidence(review));
  assert.equal(Buffer.from(envelope.signature, 'base64').byteLength, 64);

  for (const signature of [
    envelope.signature.replace(/=+$/, ''),
    Buffer.alloc(63).toString('base64'),
    Buffer.alloc(65).toString('base64'),
  ]) {
    const result = validateNativeReviewEvidence({ artifact: review, signature }, validationOptions());
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((item) => item.code === 'INVALID_SIGNATURE_ENCODING'));
  }
});

test('canonical signing bytes match the independent fixed Ed25519 known-answer vector', () => {
  const value = {
    z: 0,
    é: 'snowman ☃',
    a: [true, null, { b: 'x', a: 2 }],
  };
  const canonicalBytes = '{"a":[true,null,{"a":2,"b":"x"}],"z":0,"é":"snowman ☃"}';
  const publicKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAa/VykncIXUdfjtHVVuEpTuhVvwGtfu3FEAQZidoJdlI=
-----END PUBLIC KEY-----
`;
  const signature = 'ruV4nAh6TmoAlQ4uv2UqDTioIOOYFcneTwHiKDy06DClgvFxG79kVnV7InDon6bT6JuWCWh6n0CyX4/fnQ4VAw==';

  assert.equal(canonicalNativeReviewEvidenceJson(value), canonicalBytes);
  assert.equal(hashNativeReviewEvidence(value), 'sha256:b5436cb14572a31a8c4e61529510d7774fb81dda23439f1830c3b601c2c34211');
  assert.equal(verify(null, Buffer.from(canonicalBytes, 'utf8'), createPublicKey(publicKey), Buffer.from(signature, 'base64')), true);
});

test('intake rejects accessor-backed artifacts before a getter can make the signed and returned values diverge', () => {
  const review = artifact();
  const signed = signedEnvelope(review);
  let reads = 0;
  Object.defineProperty(signed.artifact, 'locale', {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return reads <= 2 ? 'ja-JP' : 'ko-KR';
    },
  });

  const result = validateNativeReviewEvidence(signed, validationOptions());

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'INVALID_ENVELOPE' || item.code === 'INVALID_ARTIFACT_SHAPE'));
});

test('a signed declaration without packet bytes is explicitly declarations-only', () => {
  const result = validateNativeReviewEvidence(signedEnvelope(), validationOptions());

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'DECLARATIONS_ONLY');
  assert.equal(result.value.reviewPacketByteVerification, 'NOT_SUPPLIED');
});

test('a digest-matching one-field JSON packet is not a completed CJK review packet', () => {
  const packetBytes = Buffer.from('{"completedReviewPacket":true}\n');
  const reviewPacketDigest = `sha256:${createHash('sha256').update(packetBytes).digest('hex')}`;
  const result = validateNativeReviewEvidence(
    signedEnvelope(artifact({ reviewPacketDigest })),
    validationOptions({ reviewPacketBytes: packetBytes }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'INVALID_REVIEW_PACKET_SCHEMA'));
});

test('a completed packet binds provenance, completion declarations, findings, and every artifact evidence reference', () => {
  const draft = artifact();
  const validPacket = completedPacket(draft);
  const scenarios = [
    {
      name: 'wrong packet locale',
      mutate(packet) {
        packet.locale = 'ko-KR';
        packet.provenance.locale = 'ko-KR';
        packet.provenance.market = 'KR';
      },
      code: 'INVALID_REVIEW_PACKET_SCHEMA',
    },
    {
      name: 'wrong packet provenance',
      mutate(packet) { packet.provenance.buildId = 'fedcba9876543210fedcba9876543210fedcba98'; },
      code: 'INVALID_REVIEW_PACKET_SCHEMA',
    },
    {
      name: 'different completion declaration',
      mutate(packet) { packet.completionSummary.journeys[0].evidenceReference = 'review-packet/completion/journeys/changed'; },
      code: 'INVALID_REVIEW_PACKET_SCHEMA',
    },
    {
      name: 'unresolved artifact evidence reference',
      mutate(packet) { packet.evidenceRecords = packet.evidenceRecords.filter((record) => record.id !== draft.browserGateEvidenceReference); },
      code: 'UNRESOLVED_PACKET_EVIDENCE_REFERENCE',
    },
  ];

  for (const scenario of scenarios) {
    const packet = structuredClone(validPacket);
    scenario.mutate(packet);
    const packetBytes = Buffer.from(JSON.stringify(packet));
    const review = artifact({ reviewPacketDigest: `sha256:${createHash('sha256').update(packetBytes).digest('hex')}` });
    const result = validateNativeReviewEvidence(
      signedEnvelope(review),
      validationOptions({ reviewPacketBytes: packetBytes, expectedBindings: expectedBindings({ reviewPacketDigest: review.reviewPacketDigest }) }),
    );
    assert.equal(result.ok, false, scenario.name);
    assert.ok(result.errors.some((item) => item.code === scenario.code), scenario.name);
  }
});

test('completed packet evidence records require signed SHA-256 content digests and reject digest tampering', () => {
  const draft = artifact();
  for (const scenario of [
    {
      name: 'missing content digest',
      mutate(packet) {
        for (const record of packet.evidenceRecords) delete record.contentDigest;
      },
    },
    {
      name: 'malformed content digest',
      mutate(packet) { packet.evidenceRecords[0].contentDigest = 'sha256:not-a-digest'; },
    },
  ]) {
    const packet = completedPacket(draft);
    scenario.mutate(packet);
    const packetBytes = Buffer.from(`${JSON.stringify(packet)}\n`);
    const reviewPacketDigest = `sha256:${createHash('sha256').update(packetBytes).digest('hex')}`;
    const review = artifact({ reviewPacketDigest });
    const result = validateNativeReviewEvidence(
      signedEnvelope(review),
      validationOptions({ reviewPacketBytes: packetBytes, expectedBindings: expectedBindings({ reviewPacketDigest }) }),
    );

    assert.equal(result.ok, false, scenario.name);
    assert.ok(result.errors.some((item) => item.code === 'INVALID_REVIEW_PACKET_SCHEMA'), scenario.name);
  }

  const { review, packetBytes } = reviewWithCompletedPacket();
  const originalEnvelope = signedEnvelope(review);
  const tamperedPacket = JSON.parse(packetBytes.toString('utf8'));
  tamperedPacket.evidenceRecords[0].contentDigest = `sha256:${'f'.repeat(64)}`;
  const tamperedPacketBytes = Buffer.from(`${JSON.stringify(tamperedPacket)}\n`);
  const tampered = validateNativeReviewEvidence(
    originalEnvelope,
    validationOptions({
      reviewPacketBytes: tamperedPacketBytes,
      expectedBindings: expectedBindings({ reviewPacketDigest: review.reviewPacketDigest }),
    }),
  );

  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((item) => item.code === 'REVIEW_PACKET_DIGEST_MISMATCH'));

  const tamperedPacketDigest = `sha256:${createHash('sha256').update(tamperedPacketBytes).digest('hex')}`;
  const reboundArtifact = { ...review, reviewPacketDigest: tamperedPacketDigest };
  const staleSignature = validateNativeReviewEvidence(
    { artifact: reboundArtifact, signature: originalEnvelope.signature },
    validationOptions({
      reviewPacketBytes: tamperedPacketBytes,
      expectedBindings: expectedBindings({ reviewPacketDigest: tamperedPacketDigest }),
    }),
  );

  assert.equal(staleSignature.ok, false);
  assert.ok(staleSignature.errors.some((item) => item.code === 'UNTRUSTED_OR_INVALID_SIGNATURE'));
});

test('completed packet findings project high/medium/low to non-blocking and every non-resolved workflow state to open', () => {
  const findingsLog = [
    ['high-open', 'high', 'open'],
    ['medium-accepted', 'medium', 'accepted'],
    ['low-wont-fix', 'low', 'wont-fix'],
    ['high-needs-context', 'high', 'needs-context'],
  ].map(([id]) => ({
    id,
    severity: 'non-blocking',
    status: 'open',
    summary: `Projected ${id} finding.`,
    evidenceReference: `review-notes/${id}`,
  }));
  const draft = artifact({
    findingsLog,
    completionSummary: completionSummary({ blockingFindingRechecks: [] }),
  });
  const packet = completedPacket(draft);
  for (const [index, [, severity, status]] of [
    ['high-open', 'high', 'open'],
    ['medium-accepted', 'medium', 'accepted'],
    ['low-wont-fix', 'low', 'wont-fix'],
    ['high-needs-context', 'high', 'needs-context'],
  ].entries()) {
    packet.findings[index].severity = severity;
    packet.findings[index].status = status;
    packet.findings[index].category = index === 0 ? 'interaction-label' : 'meaning';
  }
  const packetBytes = Buffer.from(JSON.stringify(packet));
  const review = artifact({
    findingsLog,
    completionSummary: completionSummary({ blockingFindingRechecks: [] }),
    reviewPacketDigest: `sha256:${createHash('sha256').update(packetBytes).digest('hex')}`,
  });
  const result = validateNativeReviewEvidence(
    signedEnvelope(review),
    validationOptions({ reviewPacketBytes: packetBytes, expectedBindings: expectedBindings({ reviewPacketDigest: review.reviewPacketDigest }) }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'EVIDENCE_VALIDATED');
  assert.equal(result.value.reviewPacketSchemaValidation, 'COMPLETED_PACKET_VALIDATED');
  assert.deepEqual(result.value.registryProjection.findingsLog.map(({ severity, status }) => ({ severity, status })), [
    { severity: 'non-blocking', status: 'open' },
    { severity: 'non-blocking', status: 'open' },
    { severity: 'non-blocking', status: 'open' },
    { severity: 'non-blocking', status: 'open' },
  ]);
});

test('reviewer keys are explicit CJK-locale trust entries and legacy PEM maps fail closed', () => {
  const wrongScope = validateNativeReviewEvidence(signedEnvelope(), validationOptions({
    trustedReviewerKeys: {
      'cjk-reviewer-01': {
        publicKeyPem: reviewerKeys.publicKey.export({ type: 'spki', format: 'pem' }),
        allowedLocales: ['ko-KR'],
      },
    },
  }));
  assert.equal(wrongScope.ok, false);
  assert.ok(wrongScope.errors.some((item) => item.code === 'UNTRUSTED_OR_INVALID_SIGNATURE'));

  const legacy = validateNativeReviewEvidence(signedEnvelope(), validationOptions({
    trustedReviewerKeys: { 'cjk-reviewer-01': reviewerKeys.publicKey.export({ type: 'spki', format: 'pem' }) },
  }));
  assert.equal(legacy.ok, false);
  assert.ok(legacy.errors.some((item) => item.code === 'UNTRUSTED_OR_INVALID_SIGNATURE'));
});

test('a proxy snapshot cannot change the verified values returned in an intake receipt', () => {
  const target = artifact();
  const envelope = signedEnvelope(target);
  const proxiedArtifact = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (key === 'locale') object.locale = 'ko-KR';
      return descriptor;
    },
  });
  envelope.artifact = proxiedArtifact;

  const result = validateNativeReviewEvidence(envelope, validationOptions());

  assert.equal(target.locale, 'ko-KR');
  assert.equal(result.ok, true);
  assert.equal(result.value.locale, 'ja-JP');
});

test('intake uses only an own reviewer-key property and enforces an Ed25519 public key', () => {
  const inheritedKeys = Object.create({ 'cjk-reviewer-01': trustedReviewerKeys['cjk-reviewer-01'] });
  const inherited = validateNativeReviewEvidence(signedEnvelope(), validationOptions({
    trustedReviewerKeys: inheritedKeys,
  }));
  assert.equal(inherited.ok, false);
  assert.ok(inherited.errors.some((item) => item.code === 'UNTRUSTED_OR_INVALID_SIGNATURE'));

  // A 512-bit RSA signature is also 64 bytes, so length enforcement alone cannot
  // substitute for checking the configured public-key algorithm.
  const rsaKeys = generateKeyPairSync('rsa', { modulusLength: 512 });
  const rsaEnvelope = signedEnvelope(artifact(), rsaKeys.privateKey);
  const rsa = validateNativeReviewEvidence(rsaEnvelope, validationOptions({
    trustedReviewerKeys: {
      'cjk-reviewer-01': {
        publicKeyPem: rsaKeys.publicKey.export({ type: 'spki', format: 'pem' }),
        allowedLocales: ['ja-JP'],
      },
    },
  }));
  assert.equal(rsa.ok, false);
  assert.ok(rsa.errors.some((item) => item.code === 'UNTRUSTED_OR_INVALID_SIGNATURE'));
});

test('intake requires every operator-declared expected binding and rejects signed evidence for a different artifact', () => {
  const missing = validateNativeReviewEvidence(signedEnvelope(), { trustedReviewerKeys });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((item) => item.code === 'INVALID_EXPECTED_BINDINGS'));

  let malformed;
  assert.doesNotThrow(() => {
    malformed = validateNativeReviewEvidence(signedEnvelope(), validationOptions({
      expectedBindings: expectedBindings({ catalogHash: Symbol('not-a-digest') }),
    }));
  });
  assert.equal(malformed.ok, false);
  assert.ok(malformed.errors.some((item) => item.code === 'INVALID_EXPECTED_BINDINGS'));

  const mismatches = {
    locale: 'ko-KR',
    catalogHash: `sha256:${'b'.repeat(64)}`,
    buildId: 'fedcba9876543210fedcba9876543210fedcba98',
    browserGateEvidenceReference: 'localization-browser/another-build/attestation.json',
    approvalReference: 'native-review/ja-jp/another-approval',
    reviewedProductVersion: 'fedcba9876543210fedcba9876543210fedcba98',
    reviewedPromptVersion: 'prompts-2026.08.30',
  };
  for (const [field, unexpected] of Object.entries(mismatches)) {
    const result = validateNativeReviewEvidence(signedEnvelope(), validationOptions({
      expectedBindings: expectedBindings({ [field]: unexpected }),
    }));
    assert.equal(result.ok, false, field);
    assert.ok(result.errors.some((item) => item.code === 'EXPECTED_BINDING_MISMATCH' && item.message.includes(field)), field);
  }
});

test('a matching operator assertion cannot make an arbitrary signed catalog hash current', async () => {
  const staleHash = `sha256:${'b'.repeat(64)}`;
  const staleReview = artifact({ catalogHash: staleHash });
  const validation = validateNativeReviewEvidence(signedEnvelope(staleReview), validationOptions({
    expectedBindings: expectedBindings({ catalogHash: staleHash }),
  }));
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((item) => item.code === 'CATALOG_HASH_MISMATCH'));

  let stderr = '';
  const exitCode = await runNativeReviewIntakeCli({
    argv: [
      '--input', '/not-read.json',
      '--output', '/not-written.json',
      '--review-packet', '/not-read-packet.json',
      '--review-packet-reference', 'native-review/ja-jp/packet.json',
      ...expectedBindingArgs(expectedBindings({ catalogHash: staleHash })),
    ],
    env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(trustedReviewerKeys) },
    stdout: { write() {} },
    stderr: { write(value) { stderr += value; } },
  });
  assert.equal(exitCode, 2);
  assert.match(stderr, /canonical catalog and registry provenance/);
});

test('the intake CLI writes only a validated evidence receipt and never rewrites the localization registry', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'likerts-native-review-'));
  const input = path.join(directory, 'review.json');
  const output = path.join(directory, 'receipt.json');
  const reviewPacket = path.join(directory, 'completed-review-packet.json');
  const { review, packetBytes } = reviewWithCompletedPacket();
  const reviewPacketDigest = review.reviewPacketDigest;
  await fs.writeFile(input, JSON.stringify(signedEnvelope(review)), 'utf8');
  await fs.writeFile(reviewPacket, packetBytes);
  let stdout = '';
  let stderr = '';

  const exitCode = await runNativeReviewIntakeCli({
    argv: [
      '--input', input,
      '--output', output,
      '--review-packet', reviewPacket,
      '--review-packet-reference', review.reviewPacketReference,
      ...expectedBindingArgs(expectedBindings({ reviewPacketDigest })),
    ],
    env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(trustedReviewerKeys) },
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } },
    ...TIME_POLICY,
  });
  const receipt = JSON.parse(await fs.readFile(output, 'utf8'));

  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
  assert.equal(JSON.parse(stdout).registryMutation, 'NOT_PERFORMED');
  assert.equal(receipt.status, 'EVIDENCE_VALIDATED');
  assert.equal(receipt.reviewPacketDigest, reviewPacketDigest);
  assert.equal(receipt.reviewPacketByteVerification, 'HASH_VERIFIED');
  assert.equal(receipt.registryMutation, 'NOT_PERFORMED');
  for (const localeId of CJK_LOCALE_IDS) {
    assert.equal(LOCALE_CAPABILITIES[localeId].release.nativeReview.status, LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING);
  }
});

test('the intake CLI fails closed when an expected binding option is omitted', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'likerts-native-review-bindings-'));
  const input = path.join(directory, 'review.json');
  const reviewPacket = path.join(directory, 'completed-review-packet.json');
  const { review, packetBytes } = reviewWithCompletedPacket();
  const reviewPacketDigest = review.reviewPacketDigest;
  await fs.writeFile(input, JSON.stringify(signedEnvelope(review)), 'utf8');
  await fs.writeFile(reviewPacket, packetBytes);

  const bindingArgs = expectedBindingArgs(expectedBindings({ reviewPacketDigest }));
  for (let index = 0; index < bindingArgs.length; index += 2) {
    const omittedOption = bindingArgs[index];
    const argv = [
      '--input', input,
      '--output', path.join(directory, `receipt-${index}.json`),
      '--review-packet', reviewPacket,
      '--review-packet-reference', review.reviewPacketReference,
      ...bindingArgs,
    ];
    const optionIndex = argv.indexOf(omittedOption);
    argv.splice(optionIndex, 2);
    let stderr = '';
    const exitCode = await runNativeReviewIntakeCli({
      argv,
      env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(trustedReviewerKeys) },
      stdout: { write() {} },
      stderr: { write(value) { stderr += value; } },
      ...TIME_POLICY,
    });
    assert.equal(exitCode, 2, omittedOption);
    assert.match(stderr, new RegExp(omittedOption), omittedOption);
  }
});

test('the intake CLI requires and hashes the exact completed review-packet bytes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'likerts-native-review-packet-'));
  const input = path.join(directory, 'review.json');
  const reviewPacket = path.join(directory, 'completed-review-packet.json');
  await fs.writeFile(input, JSON.stringify(signedEnvelope()), 'utf8');
  await fs.writeFile(reviewPacket, '{"differentPacket":true}\n', 'utf8');

  const baseArgv = [
    '--input', input,
    '--output', path.join(directory, 'receipt.json'),
    '--review-packet', reviewPacket,
    '--review-packet-reference', artifact().reviewPacketReference,
    ...expectedBindingArgs(),
  ];
  let stderr = '';
  const mismatchExitCode = await runNativeReviewIntakeCli({
    argv: baseArgv,
    env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(trustedReviewerKeys) },
    stdout: { write() {} },
    stderr: { write(value) { stderr += value; } },
    ...TIME_POLICY,
  });
  assert.equal(mismatchExitCode, 2);
  assert.match(stderr, /reviewPacketDigest/);

  for (const omittedOption of ['--review-packet', '--review-packet-reference']) {
    const argv = [...baseArgv];
    argv.splice(argv.indexOf(omittedOption), 2);
    stderr = '';
    const exitCode = await runNativeReviewIntakeCli({
      argv,
      env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(trustedReviewerKeys) },
      stdout: { write() {} },
      stderr: { write(value) { stderr += value; } },
      ...TIME_POLICY,
    });
    assert.equal(exitCode, 2, omittedOption);
    assert.match(stderr, new RegExp(omittedOption), omittedOption);
  }
});

test('the intake CLI applies its injected clock and freshness bounds', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'likerts-native-review-time-'));
  const input = path.join(directory, 'review.json');
  const reviewPacket = path.join(directory, 'completed-review-packet.json');
  const { review, packetBytes } = reviewWithCompletedPacket({ reviewedAt: '2026-08-29T11:04:59.999Z' });
  const reviewPacketDigest = review.reviewPacketDigest;
  await fs.writeFile(input, JSON.stringify(signedEnvelope(review)), 'utf8');
  await fs.writeFile(reviewPacket, packetBytes);
  let stderr = '';
  const exitCode = await runNativeReviewIntakeCli({
    argv: [
      '--input', input,
      '--output', path.join(directory, 'receipt.json'),
      '--review-packet', reviewPacket,
      '--review-packet-reference', review.reviewPacketReference,
      ...expectedBindingArgs(expectedBindings({ reviewPacketDigest })),
    ],
    env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(trustedReviewerKeys) },
    stdout: { write() {} },
    stderr: { write(value) { stderr += value; } },
    ...TIME_POLICY,
  });
  assert.equal(exitCode, 2);
  assert.match(stderr, /REVIEW_EVIDENCE_TOO_OLD/);
});

test('the intake CLI bounds input and packet reads and rejects symbolic links', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'likerts-native-review-safe-read-'));
  const validInput = path.join(directory, 'valid-review.json');
  const validPacket = path.join(directory, 'valid-packet.json');
  const oversized = path.join(directory, 'oversized.json');
  const { review, packetBytes } = reviewWithCompletedPacket();
  await fs.writeFile(validInput, JSON.stringify(signedEnvelope(review)), 'utf8');
  await fs.writeFile(validPacket, packetBytes);
  await fs.writeFile(oversized, Buffer.alloc(MAX_NATIVE_REVIEW_PACKET_BYTES + 1, 0x20));

  const argvFor = (input, reviewPacket, suffix) => [
    '--input', input,
    '--output', path.join(directory, `receipt-${suffix}.json`),
    '--review-packet', reviewPacket,
    '--review-packet-reference', review.reviewPacketReference,
    ...expectedBindingArgs(expectedBindings({ reviewPacketDigest: review.reviewPacketDigest })),
  ];
  for (const [input, reviewPacket, label] of [
    [oversized, validPacket, 'input'],
    [validInput, oversized, 'review packet'],
  ]) {
    let stderr = '';
    const exitCode = await runNativeReviewIntakeCli({
      argv: argvFor(input, reviewPacket, `oversized-${label}`),
      env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(trustedReviewerKeys) },
      stdout: { write() {} },
      stderr: { write(value) { stderr += value; } },
      ...TIME_POLICY,
    });
    assert.equal(exitCode, 2, label);
    assert.match(stderr, /no larger than 1048576 bytes/);
  }

  for (const [linkName, target, input, packet] of [
    ['review-link.json', validInput, null, validPacket],
    ['packet-link.json', validPacket, validInput, null],
  ]) {
    const link = path.join(directory, linkName);
    await fs.symlink(target, link);
    let stderr = '';
    const exitCode = await runNativeReviewIntakeCli({
      argv: argvFor(input ?? link, packet ?? link, `symlink-${linkName}`),
      env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(trustedReviewerKeys) },
      stdout: { write() {} },
      stderr: { write(value) { stderr += value; } },
      ...TIME_POLICY,
    });
    assert.equal(exitCode, 2, linkName);
    assert.match(stderr, /must not be a symbolic link/);
  }
});

test('the intake CLI rejects duplicate-key evidence envelopes before signature validation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'likerts-native-review-strict-json-'));
  const input = path.join(directory, 'duplicate-review.json');
  const reviewPacket = path.join(directory, 'completed-packet.json');
  const { review, packetBytes } = reviewWithCompletedPacket();
  const duplicated = JSON.stringify(signedEnvelope(review)).replace('{"artifact":', '{"artifact":{},"artifact":');
  await fs.writeFile(input, duplicated, 'utf8');
  await fs.writeFile(reviewPacket, packetBytes);
  let stderr = '';

  const exitCode = await runNativeReviewIntakeCli({
    argv: [
      '--input', input,
      '--output', path.join(directory, 'receipt.json'),
      '--review-packet', reviewPacket,
      '--review-packet-reference', review.reviewPacketReference,
      ...expectedBindingArgs(expectedBindings({ reviewPacketDigest: review.reviewPacketDigest })),
    ],
    env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(trustedReviewerKeys) },
    stdout: { write() {} },
    stderr: { write(value) { stderr += value; } },
    ...TIME_POLICY,
  });

  assert.equal(exitCode, 2);
  assert.match(stderr, /no duplicate object keys/);
});

test('the review protocol exposes the non-mutating signed intake command', async () => {
  const [packageJson, protocol, packet, template] = await Promise.all([
    fs.readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    fs.readFile(new URL('../docs/localization-review-and-release.md', import.meta.url), 'utf8'),
    fs.readFile(new URL('../docs/localization-review-kit/cjk-review-packet-v1.json', import.meta.url), 'utf8').then(JSON.parse),
    fs.readFile(new URL('../docs/localization-review-kit/cjk-native-review-evidence-template.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);

  assert.equal(packageJson.scripts['localization:review:intake'], 'node scripts/import-native-review-evidence.mjs');
  assert.equal(packageJson.scripts['localization:catalog-hash'], 'node scripts/print-localization-catalog-hash.mjs');
  assert.match(protocol, /LIKERTS_NATIVE_REVIEWER_KEYS_JSON/);
  for (const optionName of [
    '--review-packet',
    '--review-packet-reference',
    '--expected-locale',
    '--expected-catalog-hash',
    '--expected-build-id',
    '--expected-browser-evidence-reference',
    '--expected-approval-reference',
    '--expected-product-version',
    '--expected-prompt-version',
  ]) assert.match(protocol, new RegExp(optionName));
  assert.match(protocol, /EVIDENCE_VALIDATED/);
  assert.match(protocol, /DECLARATIONS_ONLY/);
  assert.match(protocol, /HASH_VERIFIED/);
  assert.match(protocol, /allowedLocales/);
  assert.match(protocol, /validatedAt/);
  assert.match(protocol, /expiresAt/);
  assert.match(protocol, /canonicalNativeReviewEvidenceJson/);
  assert.match(protocol, /review acts actually occurred/i);
  assert.match(protocol, /NOT_PERFORMED/);
  assert.match(protocol, /does not modify `shared\/localization\.mjs`/);
  assert.equal(packet.packetVersion, 'cjk-review-packet-v1.1.0');
  assert.equal(packet.completedPacketSchema.schemaVersion, CJK_COMPLETED_REVIEW_PACKET_SCHEMA_VERSION);
  assert.equal(packet.completedPacketSchema.packetVersion, CJK_COMPLETED_REVIEW_PACKET_VERSION);
  assert.equal(packet.sourceArtifacts.nativeReviewEvidenceTemplate, 'docs/localization-review-kit/cjk-native-review-evidence-template.json');
  assert.deepEqual(packet.journey.map(({ id }) => id), CJK_NATIVE_REVIEW_REQUIRED_JOURNEY_IDS);
  assert.deepEqual(packet.reviewSetup.viewports, CJK_NATIVE_REVIEW_REQUIRED_VIEWPORTS);
  assert.deepEqual(packet.accessibilityGate.required, CJK_NATIVE_REVIEW_ACCESSIBILITY_REQUIREMENTS);
  assert.deepEqual(packet.provenanceCapture.perLocale, CJK_NATIVE_REVIEW_PROVENANCE_REQUIREMENTS);
  assert.equal(template.artifact.schemaVersion, NATIVE_REVIEW_EVIDENCE_SCHEMA_VERSION);
  assert.equal(template.artifact.glossaryVersion, CJK_NATIVE_REVIEW_GLOSSARY_VERSION);
  assert.equal(template.artifact.locale, null);
  assert.equal(template.artifact.reviewerId, null);
  assert.equal(template.artifact.reviewedAt, null);
  assert.equal(template.artifact.reviewPacketDigest, null);
  assert.equal(template.artifact.reviewPacketReference, null);
  assert.deepEqual(template.artifact.capabilityScope, []);
  assert.deepEqual(template.artifact.completionSummary, {
    journeys: [],
    viewports: [],
    capabilities: [],
    reviewAreas: [],
    accessibilityRequirements: [],
    provenanceRequirements: [],
    recheckRequirements: [],
    blockingFindingRechecks: [],
  });
  assert.equal(template.artifact.blockingFindingsResolved, false);
  assert.equal(template.signature, null);
});
