import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { LOCALIZATION_CAPABILITIES, LOCALE_CAPABILITIES } from '../../shared/localization.mjs';
import {
  CJK_NATIVE_REVIEW_PROGRAM,
  NATIVE_REVIEW_EVIDENCE_SCHEMA_VERSION,
  canonicalNativeReviewEvidenceJson,
  nativeReviewProgramContract,
} from '../../server/native-review-evidence.js';
import { CURRENT_LOCALIZATION_CATALOG_HASH } from '../../server/localization-catalog-hash.js';

function completions(section, ids) {
  return ids.map((id, index) => ({
    id,
    completed: true,
    evidenceReference: `review-packet/completion/${section}/${index + 1}`,
  }));
}

function completionSummary(program) {
  return {
    journeys: completions('journeys', program.requiredJourneyIds),
    viewports: completions('viewports', program.requiredViewports),
    capabilities: completions('capabilities', LOCALIZATION_CAPABILITIES),
    reviewAreas: completions('review-areas', program.requiredAreas),
    accessibilityRequirements: completions('accessibility', program.accessibilityRequirements),
    provenanceRequirements: completions('provenance', program.provenanceRequirements),
    recheckRequirements: completions('rechecks', program.recheckRequirements),
    blockingFindingRechecks: [],
  };
}

function declaredEvidenceContentDigest(reference) {
  return `sha256:${createHash('sha256').update(`test fixture evidence bytes for ${reference}`, 'utf8').digest('hex')}`;
}

function evidenceRecordsFor(review) {
  const records = [];
  for (const entries of Object.values(review.completionSummary)) {
    for (const entry of entries) {
      records.push({
        id: entry.evidenceReference,
        kind: 'completion',
        summary: `Recorded completion evidence for ${entry.id}.`,
        contentDigest: declaredEvidenceContentDigest(entry.evidenceReference),
      });
    }
  }
  records.push({
    id: review.browserGateEvidenceReference,
    kind: 'browser-gate',
    summary: 'Recorded browser-gate evidence.',
    contentDigest: declaredEvidenceContentDigest(review.browserGateEvidenceReference),
  });
  records.push({
    id: review.approvalReference,
    kind: 'approval',
    summary: 'Recorded approval evidence.',
    contentDigest: declaredEvidenceContentDigest(review.approvalReference),
  });
  return records;
}

function completedPacket(review, program) {
  return {
    schemaVersion: program.completedPacketSchemaVersion,
    packetVersion: program.completedPacketVersion,
    reviewProgram: program.id,
    status: 'completed',
    locale: review.locale,
    reviewPacketReference: review.reviewPacketReference,
    provenance: {
      locale: review.locale,
      market: LOCALE_CAPABILITIES[review.locale]?.marketId,
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
    findings: [],
    evidenceRecords: evidenceRecordsFor(review),
  };
}

export function createNativeReviewReleaseFixture({
  locale = 'ja-JP',
  reviewProgram = CJK_NATIVE_REVIEW_PROGRAM,
  origin = 'https://native-review.example.com',
  browserGateEvidenceReference = 'localization-browser/0123456789abcdef0123456789abcdef01234567/attestation.json',
  buildId = '0123456789abcdef0123456789abcdef01234567',
  catalogHash = reviewProgram === CJK_NATIVE_REVIEW_PROGRAM
    ? CURRENT_LOCALIZATION_CATALOG_HASH
    : `sha256:${'d'.repeat(64)}`,
} = {}) {
  const program = nativeReviewProgramContract(reviewProgram);
  if (!program || !program.localeIds.includes(locale)) {
    throw new TypeError('Native-review fixture locale must belong to its explicit review program.');
  }
  const reviewerId = `${reviewProgram.replace('-native-review', '')}-reviewer-${locale.toLowerCase()}`;
  const reviewerKeys = generateKeyPairSync('ed25519');
  const reviewPacketReference = `native-review/${locale.toLowerCase()}/completed-review-packet.json`;
  const draft = {
    schemaVersion: NATIVE_REVIEW_EVIDENCE_SCHEMA_VERSION,
    reviewProgram,
    registryVersion: 'localization-capabilities-v2',
    locale,
    reviewerId,
    reviewedAt: '2026-08-29T12:00:00.000Z',
    glossaryVersion: program.glossaryVersion,
    catalogHash,
    buildId,
    reviewedProductVersion: buildId,
    reviewedPromptVersion: 'prompts-2026.08.29',
    reviewPacketDigest: `sha256:${'0'.repeat(64)}`,
    reviewPacketReference,
    completionSummary: completionSummary(program),
    capabilityScope: [...LOCALIZATION_CAPABILITIES],
    reviewCoverage: [...program.requiredAreas],
    findingsLog: [],
    blockingFindingsResolved: true,
    browserGateEvidenceReference,
    approvalReference: `native-review/${locale.toLowerCase()}/2026-08-29`,
  };
  const packetBytes = new TextEncoder().encode(`${JSON.stringify(completedPacket(draft, program))}\n`);
  const reviewPacketDigest = `sha256:${createHash('sha256').update(packetBytes).digest('hex')}`;
  const artifact = { ...draft, reviewPacketDigest };
  const envelope = {
    artifact,
    signature: sign(
      null,
      Buffer.from(canonicalNativeReviewEvidenceJson(artifact)),
      reviewerKeys.privateKey,
    ).toString('base64'),
  };
  const digestHex = reviewPacketDigest.slice('sha256:'.length);
  const allowedOrigin = new URL(origin).origin;
  const envelopeUrl = `${allowedOrigin}/native-review/${digestHex}/${locale.toLowerCase()}/envelope.json`;
  const packetUrl = `${allowedOrigin}/native-review/${digestHex}/${locale.toLowerCase()}/packet.json`;
  const expectedBindings = {
    locale,
    catalogHash: artifact.catalogHash,
    buildId: artifact.buildId,
    browserGateEvidenceReference: artifact.browserGateEvidenceReference,
    approvalReference: artifact.approvalReference,
    reviewedProductVersion: artifact.reviewedProductVersion,
    reviewedPromptVersion: artifact.reviewedPromptVersion,
    reviewPacketDigest,
    reviewPacketReference,
  };
  const trustedReviewerKeys = {
    [reviewerId]: {
      publicKeyPem: reviewerKeys.publicKey.export({ type: 'spki', format: 'pem' }),
      allowedLocales: [locale],
      ...(reviewProgram === CJK_NATIVE_REVIEW_PROGRAM ? {} : { reviewProgram }),
    },
  };

  return {
    locale,
    reviewProgram,
    envelope,
    envelopeBytes: new TextEncoder().encode(JSON.stringify(envelope)),
    envelopeUrl,
    packetBytes,
    packetUrl,
    expectedBindings,
    allowedOrigin,
    trustedReviewerKeys,
    now: new Date('2026-08-29T12:05:00.000Z'),
  };
}
