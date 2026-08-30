import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import localizationScorecardHandler, {
  config as localizationScorecardApiConfig,
  createLocalizationScorecardHandler,
} from '../api/localization-scorecard.js';
import { LOCALIZATION_CAPABILITIES, ASEAN_LANGUAGE_LOCALE_IDS, LOCALE_CAPABILITIES } from '../shared/localization.mjs';
import {
  LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE,
  LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS,
  LOCALIZATION_BROWSER_API_MODE,
  LOCALIZATION_BROWSER_EVIDENCE_MODE,
  createLocalizationBrowserAttestation,
} from '../server/localization-browser-attestation.js';
import {
  canonicalLocalizationBrowserPromotionJson,
  createLocalizationBrowserPromotionArtifact,
  derivePublishedLocalizationBrowserAttestation,
} from '../server/localization-browser-promotion.js';
import {
  buildLocalizationScorecard,
  LOCALIZATION_ACCESSIBILITY_EVIDENCE_BOUNDARY,
  LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
  LOCALIZATION_ACCURACY_BOUNDARY,
  LOCALIZATION_JOURNEY_FLOWS,
  LOCALIZATION_JOURNEY_GATE_VERSION,
  nativeReviewBrowserBindingStatus,
  projectLocaleScorecard,
  resolveLocaleLaunchStatus,
} from '../server/localization-scorecard.js';
import { CURRENT_LOCALIZATION_CATALOG_HASH } from '../server/localization-catalog-hash.js';
import {
  DEFAULT_NATIVE_REVIEW_RELEASE_EVIDENCE_POLICY,
  NativeReviewReleaseEvidenceError,
} from '../server/native-review-release-evidence-adapter.js';
import {
  ASEAN_NATIVE_REVIEW_PROGRAM,
  evaluateNativeReviewEligibility,
} from '../server/native-review-evidence.js';
import { createNativeReviewReleaseFixture } from './helpers/native-review-release-fixture.js';

const localizedOutputOnlyLocales = ['es-ES', 'pt-BR', 'fr-FR', 'de-DE', 'ar-SA', 'hi-IN'];

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { this.body += value; return this; },
  };
}

const TEST_BUILD_ID = '0123456789abcdef0123456789abcdef01234567';
const TEST_ARTIFACT_DIGEST = `sha256:${'a'.repeat(64)}`;
const TEST_VERIFIED_AT = '2026-08-29T12:00:00.000Z';
const TEST_LOCALES = ['zh-CN', 'ja-JP', 'ko-KR'];
const TEST_VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 375, height: 900 },
  { width: 768, height: 1000 },
  { width: 1440, height: 1000 },
];
const TEST_FULL_JOURNEY_WIDTH = { 'zh-CN': 320, 'ja-JP': 375, 'ko-KR': 768 };
const promotionKeys = generateKeyPairSync('ed25519');
const trustedPromotionKeys = {
  'release-operator-01': promotionKeys.publicKey.export({ type: 'spki', format: 'pem' }),
};

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

function sampleCoverage() {
  return LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS.map((entry) => ({
    localeId: entry.localeId,
    viewport: TEST_VIEWPORTS.find((viewport) => viewport.width === TEST_FULL_JOURNEY_WIDTH[entry.localeId]),
    status: 'PASSED',
    samples: entry.samples.map((sample) => ({
      ...sample,
      checks: sampleChecks(sample.quality),
    })),
  }));
}

function publishedJourneyAttestation({
  publicationStatus = 'PUBLISHED',
  evidenceUrl = `https://evidence.example.invalid/localization/${TEST_ARTIFACT_DIGEST.slice('sha256:'.length)}/attestation.json`,
} = {}) {
  const verifiedFlowIds = LOCALIZATION_JOURNEY_FLOWS
    .map((flow) => flow.id)
    .filter((flowId) => ![
      'research-methods-and-instrument',
    ].includes(flowId));
  return createLocalizationBrowserAttestation({
    suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
    registryVersion: 'localization-capabilities-v2',
    verifiedAt: TEST_VERIFIED_AT,
    build: {
      id: TEST_BUILD_ID,
      artifactDigest: TEST_ARTIFACT_DIGEST,
      candidateUrl: `https://candidate.example.invalid/builds/${TEST_BUILD_ID}/`,
    },
    publication: {
      status: publicationStatus,
      evidenceUrl: publicationStatus === 'CI_ARTIFACT' ? null : evidenceUrl,
    },
    execution: {
      evidenceMode: LOCALIZATION_BROWSER_EVIDENCE_MODE,
      apiMode: LOCALIZATION_BROWSER_API_MODE,
      externalNetworkAllowed: false,
      liveBackendValidated: false,
      liveModelValidated: false,
      observedHumanResponses: false,
      participantPanelConnected: false,
    },
    matrix: TEST_LOCALES.flatMap((localeId) => TEST_VIEWPORTS.map((viewport) => ({
      localeId,
      viewport,
      journey: viewport.width === TEST_FULL_JOURNEY_WIDTH[localeId] ? 'FULL_JOURNEY' : 'AUTHORING_LAYOUT',
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
        surfaceChecks: accessibilitySurfaceChecks(viewport.width === TEST_FULL_JOURNEY_WIDTH[localeId]),
        violations: 0,
      },
    }))),
    flowEvidence: verifiedFlowIds.flatMap((flowId) => TEST_LOCALES.map((localeId) => ({
      flowId,
      localeId,
      status: 'PASSED',
      viewports: flowId === 'first-run-and-authoring'
        ? TEST_VIEWPORTS
        : [TEST_VIEWPORTS.find((viewport) => viewport.width === TEST_FULL_JOURNEY_WIDTH[localeId])],
    }))),
    methodCoverage: [],
    sampleCoverage: sampleCoverage(),
  });
}

function signedPromotionFixture() {
  const ci = publishedJourneyAttestation({ publicationStatus: 'CI_ARTIFACT' });
  const artifactHash = TEST_ARTIFACT_DIGEST.slice('sha256:'.length);
  const published = derivePublishedLocalizationBrowserAttestation(ci, {
    publishedEvidenceUrl: `https://evidence.example.invalid/localization/${artifactHash}/attestation.json`,
  });
  const bundle = {
    ok: true,
    bundleDigest: `sha256:${'b'.repeat(64)}`,
    artifactDigest: TEST_ARTIFACT_DIGEST,
    evidenceId: ci.evidenceId,
    publicationStatus: 'CI_ARTIFACT',
    published: false,
  };
  const artifact = createLocalizationBrowserPromotionArtifact({
    ciAttestation: ci,
    ciBundle: bundle,
    publishedAttestation: published,
    promotionRecordUrl: `https://evidence.example.invalid/localization/${artifactHash}/promotion.json`,
    signerId: 'release-operator-01',
    signedAt: '2026-08-30T11:59:00.000Z',
  });
  return {
    ci,
    bundle,
    published,
    promotion: {
      artifact,
      signature: sign(null, Buffer.from(canonicalLocalizationBrowserPromotionJson(artifact)), promotionKeys.privateKey).toString('base64'),
    },
  };
}

test('localization scorecard separates runtime support, native review, population evidence, and calibration', () => {
  const scorecard = buildLocalizationScorecard();
  assert.equal(scorecard.schemaVersion, 'localization-scorecard-v4');
  assert.equal(scorecard.methodology.accuracyBoundary, LOCALIZATION_ACCURACY_BOUNDARY);
  assert.equal(scorecard.methodology.accessibilityEvidenceRule, LOCALIZATION_ACCESSIBILITY_EVIDENCE_BOUNDARY);
  assert.match(scorecard.methodology.releaseRule, /published browser evidence/i);
  assert.match(scorecard.methodology.journeyEvidenceRule, /separate published browser-gate attestation/i);
  assert.match(scorecard.methodology.journeyEvidenceRule, /does not claim that the static study JSON itself embeds run lineage/i);
  assert.match(scorecard.methodology.marketSupportRule, /MARKET_AND_LOCALIZED_OUTPUT/);
  assert.equal(scorecard.automatedJourneyVerification.suiteId, LOCALIZATION_JOURNEY_GATE_VERSION);
  assert.equal(scorecard.automatedJourneyVerification.status, 'NOT_PUBLISHED');
  assert.equal(scorecard.automatedJourneyVerification.lastVerifiedAt, null);
  assert.equal(scorecard.automatedJourneyVerification.ciEvidenceId, null);
  assert.equal(scorecard.automatedJourneyVerification.bundleDigest, null);
  assert.equal(scorecard.automatedJourneyVerification.promotionRecordUrl, null);
  assert.equal(scorecard.automatedJourneyVerification.promotionRecordId, null);
  assert.equal(scorecard.automatedJourneyVerification.promotionSignerId, null);
  assert.equal(scorecard.automatedJourneyVerification.promotionSignedAt, null);
  assert.equal(scorecard.automatedJourneyVerification.publicationBinding, null);
  assert.deepEqual(scorecard.automatedJourneyVerification.requiredViewports, [320, 375, 768, 1440]);
  assert.deepEqual(scorecard.automatedJourneyVerification.requiredViewportPairs, TEST_VIEWPORTS);
  assert.equal(scorecard.automatedJourneyVerification.evidenceScope, null);
  assert.deepEqual(scorecard.automatedJourneyVerification.automatedAccessibility, {
    status: 'NOT_PUBLISHED',
    evidenceType: 'AUTOMATED_NAMED_SURFACE_RULESET_SCAN',
    engine: null,
    engineVersion: null,
    rulesetTags: [],
    namedSurfaceIds: [],
    matrixCellCount: 0,
    snapshotCount: 0,
    violations: 0,
    evidenceBoundary: LOCALIZATION_ACCESSIBILITY_EVIDENCE_BOUNDARY,
  });
  assert.equal(scorecard.automatedJourneyVerification.manualAssistiveTechnologyReview.status, 'NOT_SEPARATELY_EVIDENCED');
  assert.equal(scorecard.automatedJourneyVerification.manualAssistiveTechnologyReview.evidenceReference, null);
  assert.deepEqual(
    scorecard.automatedJourneyVerification.flowIds,
    LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id),
  );
  assert.equal(Object.isFrozen(scorecard), true);

  for (const locale of ['zh-CN', 'ja-JP', 'ko-KR']) {
    const row = scorecard.locales.find((entry) => entry.locale === locale);
    assert.equal(row.runtimeCapabilityStatus, 'ALL_CAPABILITIES_ENABLED');
    assert.equal(row.launchStatus, 'NATIVE_REVIEW_REQUIRED');
    assert.equal(row.copyStatus, 'machine-drafted');
    assert.equal(row.nativeReview.reviewer, null);
    assert.deepEqual(row.nativeReview.capabilityScope, []);
    assert.equal(row.nativeReview.reviewedProductVersion, null);
    assert.equal(row.nativeReview.reviewedPromptVersion, null);
    assert.deepEqual(row.nativeReview.findingsLog, []);
    assert.equal(row.nativeReview.blockingFindingsResolved, false);
    assert.equal(row.calibrationDate, null);
    assert.equal(row.accuracyClaimPermitted, false);
    assert.equal(row.capabilityDetails.ui.releaseEligible, false);
    assert.deepEqual(row.unsupportedJourneys, []);
    assert.deepEqual(row.supportedJourneys, LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id));
    assert.ok(row.journeys.every((flow) => flow.runtimeStatus === 'enabled'));
    assert.ok(row.journeys.every((flow) => flow.automatedEvidenceStatus === 'NOT_PUBLISHED'));
    assert.ok(row.journeys.every((flow) => flow.releaseEligible === false));
    assert.ok(row.knownLimitations.includes('AUTOMATED_JOURNEY_ATTESTATION_NOT_PUBLISHED'));
    assert.ok(row.knownLimitations.includes('ATTITUDINAL_ACCURACY_NOT_VALIDATED'));
    assert.ok(row.knownLimitations.includes('MANUAL_ASSISTIVE_TECHNOLOGY_REVIEW_NOT_SEPARATELY_EVIDENCED'));
    for (const capability of LOCALIZATION_CAPABILITIES) {
      assert.equal(row.capabilityDetails[capability].runtimeStatus, 'enabled');
      assert.equal(row.capabilityDetails[capability].nativeReviewStatus, 'review-pending');
      assert.equal(row.capabilityDetails[capability].releaseEligible, false);
    }
  }

  for (const locale of ASEAN_LANGUAGE_LOCALE_IDS) {
    const row = scorecard.locales.find((entry) => entry.locale === locale);
    assert.equal(row.runtimeCapabilityStatus, 'NOT_ENABLED');
    assert.equal(row.launchStatus, 'RUNTIME_ENABLEMENT_REQUIRED');
    assert.deepEqual(row.supportedCapabilities, []);
    assert.deepEqual(row.unsupportedCapabilities, LOCALIZATION_CAPABILITIES);
    assert.deepEqual(row.supportedJourneys, []);
    assert.deepEqual(row.unsupportedJourneys, LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id));
    assert.ok(row.journeys.every((flow) => flow.runtimeStatus === 'not-enabled'));
    assert.ok(row.knownLimitations.includes('ONE_OR_MORE_RUNTIME_FLOWS_NOT_ENABLED'));
    assert.ok(row.knownLimitations.includes('LOCALIZED_COPY_NOT_AVAILABLE'));
    assert.ok(Object.values(row.capabilityDetails).every((flow) => flow.runtimeStatus === 'planned' && flow.releaseEligible === false));
  }

  for (const locale of localizedOutputOnlyLocales) {
    const row = scorecard.locales.find((entry) => entry.locale === locale);
    assert.equal(row.runtimeCapabilityStatus, 'PARTIAL');
    assert.equal(row.launchStatus, 'RUNTIME_ENABLEMENT_REQUIRED');
    assert.deepEqual(row.supportedCapabilities, ['report', 'source', 'retrieval', 'instrument', 'sample']);
    assert.deepEqual(row.unsupportedCapabilities, ['ui']);
    assert.deepEqual(row.supportedJourneys, []);
    assert.deepEqual(row.unsupportedJourneys, LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id));
    assert.ok(row.journeys.every((flow) => flow.runtimeStatus === 'partial'));
    assert.equal(row.capabilityDetails.ui.runtimeStatus, 'planned');
    for (const capability of ['report', 'source', 'retrieval', 'instrument', 'sample']) {
      assert.equal(row.capabilityDetails[capability].runtimeStatus, 'enabled');
    }
    assert.ok(row.knownLimitations.includes('ONE_OR_MORE_RUNTIME_FLOWS_NOT_ENABLED'));
    assert.ok(row.knownLimitations.includes('COPY_IS_MACHINE_DRAFTED'));
  }

  assert.equal(scorecard.markets.find((entry) => entry.marketId === 'ID').rolloutStatus, 'planned');
  assert.equal(scorecard.markets.find((entry) => entry.marketId === 'GLOBAL').retrievalGeography, null);
  assert.equal(scorecard.markets.find((entry) => entry.marketId === 'GLOBAL').supportMode, 'GLOBAL_SCOPE');
  const spain = scorecard.markets.find((entry) => entry.marketId === 'ES');
  assert.equal(spain.supportMode, 'MARKET_AND_LOCALIZED_OUTPUT');
  assert.deepEqual(spain.enabledLocaleIds, ['es-ES']);
  assert.deepEqual(spain.fullyEnabledLocaleIds, []);
  assert.deepEqual(spain.partialLocaleIds, ['es-ES']);
  assert.deepEqual(spain.outputEnabledLocaleIds, ['es-ES']);
  assert.deepEqual(spain.plannedLocaleIds, []);
  const singapore = scorecard.markets.find((entry) => entry.marketId === 'SG');
  assert.equal(singapore.rolloutStatus, 'enabled');
  assert.equal(singapore.supportMode, 'MARKET_ROUTING_ONLY');
  assert.deepEqual(singapore.enabledLocaleIds, []);
  assert.deepEqual(singapore.fullyEnabledLocaleIds, []);
  assert.deepEqual(singapore.plannedLocaleIds, ['en-SG', 'ms-SG', 'zh-Hans-SG', 'ta-SG']);
  assert.equal(singapore.currencyCode, 'SGD');
  assert.equal(scorecard.markets.find((entry) => entry.marketId === 'JP').supportMode, 'MARKET_AND_ONE_OR_MORE_LOCALES');
});

test('scorecard projects packet-validated native review separately from registry declarations', () => {
  const declared = structuredClone(LOCALE_CAPABILITIES['ja-JP']);
  declared.release.copyStatus = 'native-reviewed';
  declared.release.nativeReview = {
    status: 'native-reviewed',
    reviewer: 'declared-reviewer',
    reviewedAt: '2026-08-29T12:00:00.000Z',
    glossaryVersion: 'declared-glossary',
    capabilityScope: [...LOCALIZATION_CAPABILITIES],
    reviewedProductVersion: 'declared-product',
    reviewedPromptVersion: 'declared-prompt',
    findingsLog: [],
    blockingFindingsResolved: true,
    statusByCapability: Object.fromEntries(LOCALIZATION_CAPABILITIES.map((capability) => [capability, 'native-reviewed'])),
  };
  const noEvidence = Object.fromEntries(LOCALIZATION_CAPABILITIES.map((capability) => [capability, {
    status: 'NOT_PROVIDED',
    releaseEligible: false,
    receipt: null,
    errors: [],
  }]));

  const row = projectLocaleScorecard(declared, null, noEvidence);
  assert.equal(row.nativeReview.declaredStatus, 'native-reviewed');
  assert.equal(row.nativeReview.status, 'review-pending');
  assert.equal(row.nativeReview.authority, 'evidence-qualified');
  assert.equal(row.nativeReview.releaseEligible, false);
  assert.equal(row.nativeReview.reviewer, null);
  assert.equal(row.nativeReview.evidenceId, null);
  assert.deepEqual(row.nativeReview.evidenceStatusByCapability, Object.fromEntries(
    LOCALIZATION_CAPABILITIES.map((capability) => [capability, 'NOT_PROVIDED']),
  ));
  assert.ok(row.knownLimitations.includes('NATIVE_REVIEW_NOT_COMPLETE'));
  assert.ok(Object.values(row.capabilityDetails).every((detail) => detail.nativeReviewStatus === 'review-pending'));
  assert.ok(Object.values(row.capabilityDetails).every((detail) => detail.releaseEligible === false));
  assert.equal(row.launchStatus, 'NATIVE_REVIEW_REQUIRED');
});

test('ASEAN review evidence reaches scorecard eligibility with its explicit program but cannot release planned registry capability', () => {
  const fixture = createNativeReviewReleaseFixture({
    reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    locale: 'en-SG',
  });
  const entry = structuredClone(LOCALE_CAPABILITIES['en-SG']);
  entry.release.nativeReview = {
    status: 'native-reviewed',
    reviewer: fixture.envelope.artifact.reviewerId,
    reviewedAt: fixture.envelope.artifact.reviewedAt,
    glossaryVersion: fixture.envelope.artifact.glossaryVersion,
    capabilityScope: [...fixture.envelope.artifact.capabilityScope],
    reviewedProductVersion: fixture.envelope.artifact.reviewedProductVersion,
    reviewedPromptVersion: fixture.envelope.artifact.reviewedPromptVersion,
    findingsLog: [],
    blockingFindingsResolved: true,
    statusByCapability: Object.fromEntries(LOCALIZATION_CAPABILITIES.map((capability) => [capability, 'native-reviewed'])),
  };
  const eligibility = evaluateNativeReviewEligibility({
    entry,
    capability: 'ui',
    evidenceBundle: {
      envelope: fixture.envelope,
      reviewPacketBytes: fixture.packetBytes,
    },
    trustedReviewerKeys: fixture.trustedReviewerKeys,
    expectedBindings: fixture.expectedBindings,
    expectedReviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    now: fixture.now,
  });

  assert.equal(eligibility.status, 'INVALID');
  assert.equal(eligibility.releaseEligible, false);
  assert.equal(eligibility.receipt?.status, 'EVIDENCE_VALIDATED');
  assert.equal(eligibility.receipt?.reviewProgram, ASEAN_NATIVE_REVIEW_PROGRAM);
  assert.equal(LOCALE_CAPABILITIES['en-SG'].capabilities.ui, 'planned');
  assert.equal(LOCALE_CAPABILITIES['en-SG'].release.copyStatus, 'unsupported');
});

test('public localization scorecard endpoint is read-only, non-cacheable, and supports HEAD', async () => {
  const get = response();
  await localizationScorecardHandler({ method: 'GET', headers: { 'x-correlation-id': 'loc_12345678' } }, get);
  const payload = JSON.parse(get.body);
  assert.equal(get.statusCode, 200);
  assert.equal(get.headers.get('cache-control'), 'private, no-store');
  assert.equal(get.headers.get('x-correlation-id'), 'loc_12345678');
  assert.equal(Object.hasOwn(payload, 'correlationId'), false);
  assert.equal(payload.registryVersion, 'localization-capabilities-v2');

  const head = response();
  await localizationScorecardHandler({ method: 'HEAD', headers: {} }, head);
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');

  const post = response();
  await localizationScorecardHandler({ method: 'POST', headers: {} }, post);
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('scorecard API execution cap exceeds the native-review source deadline', () => {
  assert.ok(
    localizationScorecardApiConfig.maxDuration * 1_000
      > DEFAULT_NATIVE_REVIEW_RELEASE_EVIDENCE_POLICY.deadlineMs,
  );
});

test('scorecard API loads native-review context from a zero-argument authority provider', async () => {
  const providerCalls = [];
  const handler = createLocalizationScorecardHandler({
    nativeReviewEvidenceProvider(...args) {
      providerCalls.push(args);
      return {
        nativeReviewEvidenceByLocale: { 'ja-JP': { envelope: {} } },
        nativeReviewBindingsByLocale: { 'ja-JP': {} },
        trustedNativeReviewerKeys: {},
      };
    },
  });
  const get = response();
  await handler({
    method: 'GET',
    headers: { 'x-native-review-envelope-url': 'https://attacker.invalid/envelope.json' },
    query: { packetUrl: 'https://attacker.invalid/packet.json' },
    url: '/api/localization-scorecard?nativeEvidence=attacker',
  }, get);

  const payload = JSON.parse(get.body);
  assert.equal(get.statusCode, 200);
  assert.equal(get.headers.get('cache-control'), 'private, no-store');
  assert.equal(Object.hasOwn(payload, 'correlationId'), false);
  assert.deepEqual(providerCalls, [[]]);
  assert.ok(Object.values(
    payload.locales.find((entry) => entry.locale === 'ja-JP').nativeReview.evidenceStatusByCapability,
  ).every((status) => status === 'INVALID'));
});

test('scorecard API sanitizes configured native-review provider failures as no-store 503 responses', async () => {
  const secret = 'https://user:secret@internal.invalid/private-envelope.json';
  const handler = createLocalizationScorecardHandler({
    nativeReviewEvidenceProvider: async () => {
      throw new NativeReviewReleaseEvidenceError(
        'NATIVE_REVIEW_SOURCE_UNAVAILABLE',
        `Could not fetch ${secret}`,
        { secret },
      );
    },
  });
  const get = response();
  await handler({ method: 'GET', headers: {} }, get);

  assert.equal(get.statusCode, 503);
  assert.equal(get.headers.get('cache-control'), 'no-store');
  assert.equal(get.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(get.body), {
    error: 'Native-review release evidence is temporarily unavailable.',
    code: 'LOCALIZATION_NATIVE_REVIEW_EVIDENCE_UNAVAILABLE',
    correlationId: get.headers.get('x-correlation-id'),
  });
  assert.equal(get.body.includes(secret), false);

  const head = response();
  await handler({ method: 'HEAD', headers: {} }, head);
  assert.equal(head.statusCode, 503);
  assert.equal(head.headers.get('cache-control'), 'no-store');
  assert.equal(head.body, '');
});

test('scorecard publishes only validated browser evidence without changing release or accuracy state', () => {
  const fixture = signedPromotionFixture();
  const attestation = fixture.published;
  const scorecard = buildLocalizationScorecard({
    journeyAttestation: attestation,
    journeyPromotion: fixture.promotion,
    trustedPromotionKeys,
    buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
    now: new Date('2026-08-30T12:00:00.000Z'),
  });

  assert.equal(scorecard.automatedJourneyVerification.status, 'PARTIALLY_PUBLISHED');
  assert.equal(scorecard.automatedJourneyVerification.evidenceId, attestation.evidenceId);
  assert.equal(scorecard.automatedJourneyVerification.buildId, TEST_BUILD_ID);
  assert.equal(scorecard.automatedJourneyVerification.lastVerifiedAt, TEST_VERIFIED_AT);
  assert.equal(scorecard.automatedJourneyVerification.ciEvidenceId, fixture.ci.evidenceId);
  assert.equal(scorecard.automatedJourneyVerification.bundleDigest, fixture.bundle.bundleDigest);
  assert.equal(scorecard.automatedJourneyVerification.promotionRecordUrl, fixture.promotion.artifact.promotionRecordUrl);
  assert.equal(scorecard.automatedJourneyVerification.promotionSignerId, 'release-operator-01');
  assert.equal(scorecard.automatedJourneyVerification.promotionSignedAt, '2026-08-30T11:59:00.000Z');
  assert.equal(scorecard.automatedJourneyVerification.publicationBinding, 'SIGNED_PROMOTION_RECORD');
  assert.equal(scorecard.automatedJourneyVerification.evidenceScope.evidenceMode, LOCALIZATION_BROWSER_EVIDENCE_MODE);
  assert.equal(scorecard.automatedJourneyVerification.evidenceScope.liveBackendValidated, false);
  assert.equal(scorecard.automatedJourneyVerification.evidenceScope.liveModelValidated, false);
  assert.equal(scorecard.automatedJourneyVerification.evidenceScope.participantPanelConnected, false);
  assert.equal(scorecard.automatedJourneyVerification.evidenceScope.observedHumanResponses, false);
  assert.equal(scorecard.automatedJourneyVerification.automatedAccessibility.status, 'PUBLISHED');
  assert.equal(scorecard.automatedJourneyVerification.automatedAccessibility.engine, LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE);
  assert.equal(scorecard.automatedJourneyVerification.automatedAccessibility.engineVersion, '4.11.0');
  assert.deepEqual(scorecard.automatedJourneyVerification.automatedAccessibility.rulesetTags, LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS);
  assert.deepEqual(
    scorecard.automatedJourneyVerification.automatedAccessibility.namedSurfaceIds,
    [...LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS].sort(),
  );
  assert.equal(scorecard.automatedJourneyVerification.automatedAccessibility.matrixCellCount, 12);
  assert.equal(scorecard.automatedJourneyVerification.automatedAccessibility.snapshotCount, 165);
  assert.equal(scorecard.automatedJourneyVerification.automatedAccessibility.violations, 0);
  assert.equal(scorecard.automatedJourneyVerification.manualAssistiveTechnologyReview.status, 'NOT_SEPARATELY_EVIDENCED');
  assert.equal(scorecard.automatedJourneyVerification.verifiedFlowIds.includes('samples-persistence-and-lineage'), true);

  for (const locale of TEST_LOCALES) {
    const row = scorecard.locales.find((entry) => entry.locale === locale);
    const unpublishedFlows = row.journeys.filter((flow) => flow.id === 'research-methods-and-instrument');
    assert.equal(row.launchStatus, 'NATIVE_REVIEW_REQUIRED');
    assert.equal(row.copyStatus, 'machine-drafted');
    assert.equal(row.nativeReview.status, 'review-pending');
    assert.equal(row.calibrationDate, null);
    assert.equal(row.accuracyClaimPermitted, false);
    assert.ok(row.journeys
      .filter((flow) => flow.id !== 'research-methods-and-instrument')
      .every((flow) => flow.automatedEvidenceStatus === 'PUBLISHED' && flow.automatedEvidenceId === attestation.evidenceId));
    assert.ok(row.journeys.every((flow) => flow.releaseEligible === false));
    assert.ok(unpublishedFlows.every((flow) => flow.automatedEvidenceStatus === 'NOT_PUBLISHED'));
    assert.ok(unpublishedFlows.every((flow) => flow.automatedEvidenceId === null));
    assert.ok(unpublishedFlows.every((flow) => flow.releaseEligible === false));
    assert.ok(row.knownLimitations.includes('AUTOMATED_JOURNEY_ATTESTATION_NOT_PUBLISHED'));
  }

  for (const locale of ASEAN_LANGUAGE_LOCALE_IDS) {
    const row = scorecard.locales.find((entry) => entry.locale === locale);
    assert.equal(row.launchStatus, 'RUNTIME_ENABLEMENT_REQUIRED');
    assert.ok(row.journeys.every((flow) => flow.automatedEvidenceStatus === 'NOT_PUBLISHED'));
  }
});

test('launch and journey release status require published browser evidence after native review', () => {
  assert.equal(resolveLocaleLaunchStatus({
    allRuntimeEnabled: true,
    allNativeReleaseEligible: true,
    allJourneyReleaseEligible: false,
  }), 'AUTOMATED_VERIFICATION_REQUIRED');
  assert.equal(resolveLocaleLaunchStatus({
    allRuntimeEnabled: true,
    allNativeReleaseEligible: true,
    allJourneyReleaseEligible: true,
  }), 'NATIVE_REVIEWED');
  assert.equal(resolveLocaleLaunchStatus({
    allRuntimeEnabled: true,
    allNativeReleaseEligible: false,
    allJourneyReleaseEligible: false,
  }), 'NATIVE_REVIEW_REQUIRED');
});

test('native review eligibility is bound to the exact published browser evidence URL and build', () => {
  const evidenceUrl = `https://evidence.example.invalid/localization/${TEST_ARTIFACT_DIGEST.slice('sha256:'.length)}/attestation.json`;
  const browserEvidence = {
    attestation: {
      catalogHash: CURRENT_LOCALIZATION_CATALOG_HASH,
      build: {
        id: TEST_BUILD_ID,
        artifactDigest: TEST_ARTIFACT_DIGEST,
      },
      publication: {
        status: 'PUBLISHED',
        evidenceUrl,
      },
    },
  };
  const matching = {
    locale: 'ja-JP',
    catalogHash: CURRENT_LOCALIZATION_CATALOG_HASH,
    buildId: TEST_BUILD_ID,
    browserGateEvidenceReference: evidenceUrl,
  };

  assert.equal(nativeReviewBrowserBindingStatus(matching, browserEvidence), 'MATCHED');
  assert.equal(nativeReviewBrowserBindingStatus({ ...matching, buildId: 'different-build' }, browserEvidence), 'STALE_BINDING');
  assert.equal(nativeReviewBrowserBindingStatus({
    ...matching,
    browserGateEvidenceReference: evidenceUrl.replace('/attestation.json', '/other/attestation.json'),
  }, browserEvidence), 'STALE_BINDING');
  assert.equal(nativeReviewBrowserBindingStatus({
    ...matching,
    browserGateEvidenceReference: `localization-browser/${TEST_BUILD_ID}/attestation.json`,
  }, browserEvidence), 'STALE_BINDING');
  assert.equal(nativeReviewBrowserBindingStatus({
    locale: matching.locale,
    catalogHash: matching.catalogHash,
    buildId: matching.buildId,
  }, browserEvidence), 'MISSING_BINDING');
  assert.equal(nativeReviewBrowserBindingStatus(null, browserEvidence), 'MISSING_BINDING');
  assert.equal(nativeReviewBrowserBindingStatus(matching, null), 'NOT_APPLICABLE');
});

test('scorecard rejects native-review bundles whose operator binding names another browser build', () => {
  const fixture = signedPromotionFixture();
  const scorecard = buildLocalizationScorecard({
    journeyAttestation: fixture.published,
    journeyPromotion: fixture.promotion,
    trustedPromotionKeys,
    buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
    nativeReviewEvidenceByLocale: {
      'ja-JP': { envelope: {}, reviewPacketBytes: Buffer.from('{}') },
    },
    nativeReviewBindingsByLocale: {
      'ja-JP': { locale: 'ja-JP', buildId: 'different-build' },
    },
    now: new Date('2026-08-30T12:00:00.000Z'),
  });
  const row = scorecard.locales.find((entry) => entry.locale === 'ja-JP');

  assert.equal(row.nativeReview.status, 'review-pending');
  assert.ok(Object.values(row.nativeReview.evidenceStatusByCapability).every((status) => status === 'STALE_BINDING'));
  assert.ok(Object.values(row.capabilityDetails).every((detail) => detail.releaseEligible === false));
  assert.equal(row.launchStatus, 'NATIVE_REVIEW_REQUIRED');
});

test('scorecard ignores CI-only, tampered, stale, or wrong-build attestations', () => {
  const published = publishedJourneyAttestation();
  const ciOnly = createLocalizationBrowserAttestation({
    ...structuredClone(published),
    evidenceId: undefined,
    publication: { status: 'CI_ARTIFACT', evidenceUrl: null },
  });
  const tampered = structuredClone(published);
  tampered.matrix[0].failures.pageErrors = 1;
  const invalidSampleCoverageInput = structuredClone(published);
  invalidSampleCoverageInput.sampleCoverage[0].samples[0].checks.localStorageLineageMatched = false;
  const invalidSampleCoverage = createLocalizationBrowserAttestation({
    ...invalidSampleCoverageInput,
    evidenceId: undefined,
  });

  for (const options of [
    { journeyAttestation: ciOnly, buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST } },
    { journeyAttestation: tampered, buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST } },
    { journeyAttestation: invalidSampleCoverage, buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST } },
    { journeyAttestation: published, buildIdentity: { id: 'wrong-build', artifactDigest: TEST_ARTIFACT_DIGEST } },
    { journeyAttestation: published, buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST }, now: new Date('2026-10-01T12:00:00.000Z') },
  ]) {
    const scorecard = buildLocalizationScorecard(options);
    assert.equal(scorecard.automatedJourneyVerification.status, 'NOT_PUBLISHED');
    assert.equal(scorecard.automatedJourneyVerification.evidenceId, null);
    assert.ok(scorecard.locales.every((locale) => locale.journeys.every((flow) => flow.automatedEvidenceStatus === 'NOT_PUBLISHED')));
  }
});

test('scorecard never accepts a raw PUBLISHED attestation without a validated signed promotion record', () => {
  const published = publishedJourneyAttestation();
  const scorecard = buildLocalizationScorecard({
    journeyAttestation: published,
    buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
    now: new Date('2026-08-30T12:00:00.000Z'),
  });

  assert.equal(scorecard.automatedJourneyVerification.status, 'NOT_PUBLISHED');
  assert.equal(scorecard.automatedJourneyVerification.evidenceId, null);
  assert.equal(scorecard.automatedJourneyVerification.promotionRecordUrl, null);
});
