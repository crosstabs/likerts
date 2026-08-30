import { generateKeyPairSync, sign } from 'node:crypto';

import { LOCALIZATION_REGISTRY_VERSION } from '../../shared/localization.mjs';
import {
  LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE,
  LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS,
  LOCALIZATION_BROWSER_API_MODE,
  LOCALIZATION_BROWSER_EVIDENCE_MODE,
  LOCALIZATION_BROWSER_METHOD_IDS,
  LOCALIZATION_BROWSER_METHOD_RESULT_KINDS,
  createLocalizationBrowserAttestation,
} from '../../server/localization-browser-attestation.js';
import {
  canonicalLocalizationBrowserPromotionJson,
  createLocalizationBrowserPromotionArtifact,
  derivePublishedLocalizationBrowserAttestation,
} from '../../server/localization-browser-promotion.js';
import {
  LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
  LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
  LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
  LOCALIZATION_JOURNEY_FLOWS,
  LOCALIZATION_JOURNEY_GATE_VERSION,
} from '../../server/localization-scorecard.js';

export const TEST_BROWSER_BUILD_ID = '0123456789abcdef0123456789abcdef01234567';
export const TEST_BROWSER_ARTIFACT_DIGEST = `sha256:${'a'.repeat(64)}`;
export const TEST_BROWSER_NOW = new Date('2026-08-30T12:00:00.000Z');

function accessibilitySurfaceChecks(deep) {
  return (deep
    ? LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS
    : LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS).map((surfaceId) => ({
    surfaceId,
    snapshotCount: ['specialized-method-results', 'specialized-method-handoffs'].includes(surfaceId) ? 10 : 1,
    violations: 0,
  }));
}

function sampleChecks(quality) {
  return {
    staticDetailRegistryMatched: true,
    staticDetailQualityBadgesMatched: true,
    ctaMatched: true,
    composerOpenedFromCta: true,
    autoRunApiCalls: 0,
    promptMatched: true,
    audienceMatched: true,
    researchMethod: 'GENERAL_LIKERT',
    staleMethodFieldCount: 0,
    lineageNoticeLocalized: true,
    lineageNoticeSource: 'static-sample-library',
    lineageNoticeAutomatedQaStatus: quality.automatedQaStatus,
    lineageNoticeNativeReviewStatus: quality.nativeReviewStatus,
    requestApiCalls: 1,
    requestMethodConfigPresent: false,
    requestCanonicalLineageMatched: true,
    responseRunLineageMatched: true,
    responseMetaLineageMatched: true,
    responseReproducibilityLineageMatched: true,
    responsePersistenceInputLineageMatched: true,
    responsePersistenceRunLineageMatched: true,
    evidencePackStudyLineageMatched: true,
    evidencePackResultLineageMatched: true,
    evidencePackTopLevelLineageMatched: true,
    qualitativeProjectExportLineageMatched: true,
    qualitativeRunRecordLineageMatched: true,
    localStorageLineageMatched: true,
    restoredWithoutSampleQuery: true,
    restoredReportMatched: true,
    restoredLineageNoticeMatched: true,
    restoreApiCalls: 0,
    observedHumanResponses: false,
    participantPanelConnected: false,
  };
}

export function createLocalizationBrowserReleaseFixture({
  buildId = TEST_BROWSER_BUILD_ID,
  artifactDigest = TEST_BROWSER_ARTIFACT_DIGEST,
  evidenceHostname = 'evidence.example.com',
  signerId = 'release-operator-01',
} = {}) {
  const promotionKeys = generateKeyPairSync('ed25519');
  const trustedPromotionKeys = {
    [signerId]: promotionKeys.publicKey.export({ type: 'spki', format: 'pem' }),
  };
  const evidenceUrl = `https://${evidenceHostname}/localization/${artifactDigest.slice('sha256:'.length)}/attestation.json`;
  const ciAttestation = createLocalizationBrowserAttestation({
    suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    verifiedAt: '2026-08-29T12:00:00.000Z',
    build: {
      id: buildId,
      artifactDigest,
      candidateUrl: 'https://candidate.example.test/',
    },
    publication: { status: 'CI_ARTIFACT', evidenceUrl: null },
    execution: {
      evidenceMode: LOCALIZATION_BROWSER_EVIDENCE_MODE,
      apiMode: LOCALIZATION_BROWSER_API_MODE,
      externalNetworkAllowed: false,
      liveBackendValidated: false,
      liveModelValidated: false,
      observedHumanResponses: false,
      participantPanelConnected: false,
    },
    matrix: LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS.flatMap((localeId) => (
      LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS.map((viewport, viewportIndex) => ({
        localeId,
        viewport,
        journey: 'FULL_JOURNEY',
        status: 'PASSED',
        failures: {
          unmockedApiRequests: 0,
          externalRequests: 0,
          consoleErrors: 0,
          pageErrors: 0,
          failedResponses: 0,
          failedRequests: 0,
        },
        accessibility: {
          engine: LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE,
          engineVersion: '4.11.0',
          rulesetTags: [...LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS],
          surfaceChecks: accessibilitySurfaceChecks(viewportIndex === 0),
          violations: 0,
        },
      }))
    )),
    flowEvidence: LOCALIZATION_JOURNEY_FLOWS.flatMap((flow) => (
      LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS.map((localeId) => ({
        flowId: flow.id,
        localeId,
        status: 'PASSED',
        viewports: flow.id === 'first-run-and-authoring'
          ? LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS
          : [LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS[0]],
      }))
    )),
    methodCoverage: LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS.map((localeId) => ({
      localeId,
      methodIds: LOCALIZATION_BROWSER_METHOD_IDS,
      resultKinds: LOCALIZATION_BROWSER_METHOD_RESULT_KINDS,
      localizedAuthoringSurfaces: LOCALIZATION_BROWSER_METHOD_IDS.length,
      localizedResultSurfaces: LOCALIZATION_BROWSER_METHOD_IDS.length,
      localizedHandoffDrafts: LOCALIZATION_BROWSER_METHOD_IDS.length,
      methodSpecificReceiptDownloads: LOCALIZATION_BROWSER_METHOD_IDS.length,
      observedHumanResponses: false,
      participantPanelConnected: false,
    })),
    sampleCoverage: LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS.map((entry) => ({
      localeId: entry.localeId,
      viewport: LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS[0],
      status: 'PASSED',
      samples: entry.samples.map((sample) => ({
        ...structuredClone(sample),
        checks: sampleChecks(sample.quality),
      })),
    })),
  });
  const attestation = derivePublishedLocalizationBrowserAttestation(ciAttestation, {
    publishedEvidenceUrl: evidenceUrl,
  });
  const promotionRecordUrl = evidenceUrl.replace(/attestation\.json$/, 'promotion.json');
  const promotionArtifact = createLocalizationBrowserPromotionArtifact({
    ciAttestation,
    ciBundle: {
      ok: true,
      bundleDigest: `sha256:${'c'.repeat(64)}`,
      artifactDigest,
      evidenceId: ciAttestation.evidenceId,
      publicationStatus: 'CI_ARTIFACT',
      published: false,
    },
    publishedAttestation: attestation,
    promotionRecordUrl,
    signerId,
    signedAt: '2026-08-30T11:59:00.000Z',
  });
  const promotion = {
    artifact: promotionArtifact,
    signature: sign(
      null,
      Buffer.from(canonicalLocalizationBrowserPromotionJson(promotionArtifact)),
      promotionKeys.privateKey,
    ).toString('base64'),
  };
  return {
    buildIdentity: { id: buildId, artifactDigest },
    attestation,
    evidenceUrl,
    promotion,
    promotionRecordUrl,
    trustedPromotionKeys,
  };
}
