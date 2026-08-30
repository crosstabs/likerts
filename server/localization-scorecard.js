import {
  CJK_LOCALE_IDS,
  LOCALIZATION_CAPABILITIES,
  LOCALIZATION_CAPABILITY_STATUSES,
  LOCALIZATION_REGISTRY_VERSION,
  LOCALE_CAPABILITIES,
  MARKET_CAPABILITIES,
  isAttitudinalValidationEligible,
  marketLocaleSupport,
} from '../shared/localization.mjs';
import { sampleStudies } from '../content/sample-studies.mjs';
import {
  LOCALIZATION_JOURNEY_GATE_VERSION,
  validateLocalizationBrowserAttestation,
} from './localization-browser-attestation.js';
import { validateLocalizationBrowserPromotion } from './localization-browser-promotion.js';
import {
  CJK_NATIVE_REVIEW_PROGRAM,
  NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES,
  evaluateNativeReviewEligibility,
} from './native-review-evidence.js';
import { canonicalSampleLineageForSample } from './sample-lineage.js';

export { LOCALIZATION_JOURNEY_GATE_VERSION };

export const LOCALIZATION_SCORECARD_VERSION = 'localization-scorecard-v4';

export const LOCALIZATION_JOURNEY_FLOWS = deepFreeze([
  {
    id: 'first-run-and-authoring',
    label: 'First run and localized study authoring',
    requiredCapabilities: ['ui', 'report', 'source', 'retrieval', 'instrument'],
  },
  {
    id: 'research-methods-and-instrument',
    label: 'Research methods and respondent instrument',
    requiredCapabilities: ['ui', 'report', 'instrument'],
  },
  {
    id: 'results-and-research-design',
    label: 'Results and research-design metadata',
    requiredCapabilities: ['ui', 'report'],
  },
  {
    id: 'evidence-and-retrieval',
    label: 'Evidence Ledger and retrieval provenance',
    requiredCapabilities: ['ui', 'report', 'source', 'retrieval'],
  },
  {
    id: 'population-frame-and-model-card',
    label: 'Population Frame and Model Card',
    requiredCapabilities: ['ui', 'report', 'source'],
  },
  {
    id: 'stability-and-convergence',
    label: 'Multiple-run stability and convergence',
    requiredCapabilities: ['ui', 'report'],
  },
  {
    id: 'qualitative-exploration',
    label: 'Segment follow-up and qualitative exploration',
    requiredCapabilities: ['ui', 'report', 'source'],
  },
  {
    id: 'exports-and-human-handoff',
    label: 'Localized exports and human-research handoff',
    requiredCapabilities: ['ui', 'report', 'instrument'],
  },
  {
    id: 'samples-persistence-and-lineage',
    label: 'Samples, persistence, and localization lineage',
    requiredCapabilities: ['ui', 'report', 'sample'],
  },
]);

export const LOCALIZATION_ACCURACY_BOUNDARY = 'Demographic, market, or language fit does not prove attitudinal accuracy. Attitudinal claims require an eligible held-out comparison for the same market, language, population, research method, question types, wording, scale, and field dates, and apply only inside that recorded scope.';
export const LOCALIZATION_ACCESSIBILITY_EVIDENCE_BOUNDARY = 'Automated browser and axe-core checks are regression evidence for the named surfaces they inspected. They do not prove screen-reader behavior, native-platform font rendering, language quality, or manual zoom and reflow conformance.';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS = CJK_LOCALE_IDS;
export const LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS = deepFreeze([
  { width: 320, height: 844 },
  { width: 375, height: 900 },
  { width: 768, height: 1000 },
  { width: 1440, height: 1000 },
]);
export const LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS = deepFreeze(
  LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS.map((localeId) => ({
    localeId,
    samples: sampleStudies
      .filter((sample) => sample.locale === localeId)
      .map((sample) => {
        const lineage = canonicalSampleLineageForSample(sample);
        return {
          stableId: sample.stableId,
          slug: sample.slug,
          sampleSchemaVersion: sample.schemaVersion,
          quality: {
            automatedQaStatus: lineage.automatedQa.status,
            nativeReviewStatus: lineage.nativeReview.status,
          },
        };
      }),
  })),
);

function localeLimitations(entry, journeys, effectiveNativeReview) {
  const limitations = [];
  if (entry.release.copyStatus === 'machine-drafted') limitations.push('COPY_IS_MACHINE_DRAFTED');
  if (entry.release.copyStatus === 'unsupported') limitations.push('LOCALIZED_COPY_NOT_AVAILABLE');
  if (effectiveNativeReview.status !== 'native-reviewed') limitations.push('NATIVE_REVIEW_NOT_COMPLETE');
  if (entry.release.populationEvidenceStatus !== 'ready') limitations.push('POPULATION_EVIDENCE_NOT_READY');
  if (entry.release.attitudinalValidationStatus !== 'validated') limitations.push('ATTITUDINAL_ACCURACY_NOT_VALIDATED');
  if (Object.values(entry.capabilities).some((status) => status !== LOCALIZATION_CAPABILITY_STATUSES.ENABLED)) {
    limitations.push('ONE_OR_MORE_RUNTIME_FLOWS_NOT_ENABLED');
  }
  if (journeys.some((flow) => flow.automatedEvidenceStatus !== 'PUBLISHED')) {
    limitations.push('AUTOMATED_JOURNEY_ATTESTATION_NOT_PUBLISHED');
  }
  limitations.push('MANUAL_ASSISTIVE_TECHNOLOGY_REVIEW_NOT_SEPARATELY_EVIDENCED');
  return limitations;
}

function automatedAccessibilityProjection(browserEvidence) {
  const matrix = browserEvidence?.attestation?.matrix || [];
  const surfaceChecks = matrix.flatMap((entry) => entry.accessibility?.surfaceChecks || []);
  const firstAccessibility = matrix[0]?.accessibility || null;
  return {
    status: browserEvidence ? 'PUBLISHED' : 'NOT_PUBLISHED',
    evidenceType: 'AUTOMATED_NAMED_SURFACE_RULESET_SCAN',
    engine: firstAccessibility?.engine || null,
    engineVersion: firstAccessibility?.engineVersion || null,
    rulesetTags: firstAccessibility ? [...firstAccessibility.rulesetTags] : [],
    namedSurfaceIds: [...new Set(surfaceChecks.map((entry) => entry.surfaceId))].sort(),
    matrixCellCount: matrix.length,
    snapshotCount: surfaceChecks.reduce((total, entry) => total + (entry.snapshotCount || 0), 0),
    violations: surfaceChecks.reduce((total, entry) => total + (entry.violations || 0), 0),
    evidenceBoundary: LOCALIZATION_ACCESSIBILITY_EVIDENCE_BOUNDARY,
  };
}

function effectiveCapabilityNativeReviewStatus(eligibility) {
  return eligibility?.releaseEligible ? 'native-reviewed' : 'review-pending';
}

export function nativeReviewBrowserBindingStatus(expectedBindings, browserEvidence) {
  if (!browserEvidence) return 'NOT_APPLICABLE';
  if (!expectedBindings || typeof expectedBindings !== 'object' || Array.isArray(expectedBindings)
    || typeof expectedBindings.catalogHash !== 'string' || !expectedBindings.catalogHash
    || typeof expectedBindings.buildId !== 'string' || !expectedBindings.buildId
    || typeof expectedBindings.browserGateEvidenceReference !== 'string'
    || !expectedBindings.browserGateEvidenceReference) {
    return 'MISSING_BINDING';
  }
  return expectedBindings.buildId === browserEvidence.attestation?.build?.id
    && expectedBindings.catalogHash === browserEvidence.attestation?.catalogHash
    && expectedBindings.browserGateEvidenceReference
      === browserEvidence.attestation?.publication?.evidenceUrl
    ? 'MATCHED'
    : 'STALE_BINDING';
}

function browserBoundNativeReviewEligibility({
  entry,
  capability,
  evidenceBundle,
  trustedReviewerKeys,
  expectedBindings,
  expectedReviewProgram,
  browserEvidence,
  now,
}) {
  const browserBindingStatus = nativeReviewBrowserBindingStatus(expectedBindings, browserEvidence);
  if (evidenceBundle && browserBindingStatus !== 'NOT_APPLICABLE' && browserBindingStatus !== 'MATCHED') {
    const code = browserBindingStatus === 'MISSING_BINDING'
      ? 'NATIVE_REVIEW_BROWSER_BUILD_BINDING_MISSING'
      : 'NATIVE_REVIEW_BROWSER_BUILD_BINDING_STALE';
    return deepFreeze({
      status: NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES.STALE_BINDING,
      releaseEligible: false,
      receipt: null,
      errors: [{
        code,
        message: 'Native-review evidence must bind its signed catalog and build to the exact published browser evidence URL before release eligibility can be projected.',
      }],
    });
  }
  return evaluateNativeReviewEligibility({
    entry,
    capability,
    evidenceBundle,
    trustedReviewerKeys,
    expectedBindings,
    expectedReviewProgram,
    now,
  });
}

export function projectNativeReviewAuthority(entry, nativeReviewEligibility) {
  const evidenceStatusByCapability = Object.fromEntries(LOCALIZATION_CAPABILITIES.map((capability) => [
    capability,
    nativeReviewEligibility?.[capability]?.status || 'NOT_PROVIDED',
  ]));
  const eligibleCapabilities = LOCALIZATION_CAPABILITIES.filter(
    (capability) => nativeReviewEligibility?.[capability]?.releaseEligible === true,
  );
  const status = eligibleCapabilities.length === LOCALIZATION_CAPABILITIES.length
    ? 'native-reviewed'
    : eligibleCapabilities.length
      ? 'partial'
      : 'review-pending';
  const releaseEligible = eligibleCapabilities.length === LOCALIZATION_CAPABILITIES.length;
  const receipt = eligibleCapabilities
    .map((capability) => nativeReviewEligibility[capability].receipt)
    .find(Boolean) || null;
  const projection = receipt?.registryProjection || null;
  return {
    status,
    authority: 'evidence-qualified',
    releaseEligible,
    declaredStatus: entry.release.nativeReview.status,
    evidenceStatusByCapability,
    evidenceId: receipt?.evidenceId || null,
    validatedAt: receipt?.validatedAt || null,
    expiresAt: receipt?.expiresAt || null,
    reviewer: projection?.reviewer || null,
    reviewedAt: projection?.reviewedAt || null,
    glossaryVersion: projection?.glossaryVersion || null,
    capabilityScope: projection ? [...projection.capabilityScope] : [],
    reviewedProductVersion: projection?.reviewedProductVersion || null,
    reviewedPromptVersion: projection?.reviewedPromptVersion || null,
    findingsLog: projection ? projection.findingsLog.map((finding) => ({ ...finding })) : [],
    blockingFindingsResolved: projection?.blockingFindingsResolved === true,
  };
}

function journeyFlowCard(entry, flow, browserEvidence, nativeReviewEligibility) {
  const runtimeStatuses = flow.requiredCapabilities.map((capability) => entry.capabilities[capability]);
  const enabledCount = runtimeStatuses.filter((status) => status === LOCALIZATION_CAPABILITY_STATUSES.ENABLED).length;
  const runtimeStatus = enabledCount === runtimeStatuses.length
    ? 'enabled'
    : enabledCount
      ? 'partial'
      : 'not-enabled';
  const nativeStatuses = flow.requiredCapabilities.map(
    (capability) => effectiveCapabilityNativeReviewStatus(nativeReviewEligibility[capability]),
  );
  const nativeReviewStatus = nativeStatuses.every((status) => status === 'native-reviewed')
    ? 'native-reviewed'
    : nativeStatuses.some((status) => status === 'native-reviewed')
      ? 'partial'
      : 'review-pending';
  const hasPublishedEvidence = browserEvidence?.flowCells.has(`${flow.id}@${entry.id}`) || false;
  return {
    id: flow.id,
    label: flow.label,
    requiredCapabilities: [...flow.requiredCapabilities],
    runtimeStatus,
    nativeReviewStatus,
    automatedEvidenceStatus: hasPublishedEvidence ? 'PUBLISHED' : 'NOT_PUBLISHED',
    automatedEvidenceId: hasPublishedEvidence ? browserEvidence.attestation.evidenceId : null,
    releaseEligible: hasPublishedEvidence
      && runtimeStatus === 'enabled'
      && nativeReviewStatus === 'native-reviewed'
      && flow.requiredCapabilities.every((capability) => nativeReviewEligibility[capability].releaseEligible),
  };
}

export function resolveLocaleLaunchStatus({
  allRuntimeEnabled,
  allNativeReleaseEligible,
  allJourneyReleaseEligible,
} = {}) {
  if (!allRuntimeEnabled) return 'RUNTIME_ENABLEMENT_REQUIRED';
  if (!allNativeReleaseEligible) return 'NATIVE_REVIEW_REQUIRED';
  if (!allJourneyReleaseEligible) return 'AUTOMATED_VERIFICATION_REQUIRED';
  return 'NATIVE_REVIEWED';
}

export function projectLocaleScorecard(entry, browserEvidence, nativeReviewEligibility) {
  const accuracyClaimPermitted = isAttitudinalValidationEligible(entry);
  const attitudinalValidationEvidence = entry.release.attitudinalValidationEvidence;
  const effectiveNativeReview = projectNativeReviewAuthority(entry, nativeReviewEligibility);
  const flows = Object.fromEntries(LOCALIZATION_CAPABILITIES.map((capability) => [capability, {
    runtimeStatus: entry.capabilities[capability],
    nativeReviewStatus: effectiveCapabilityNativeReviewStatus(nativeReviewEligibility[capability]),
    nativeReviewEvidenceStatus: nativeReviewEligibility[capability].status,
    releaseEligible: nativeReviewEligibility[capability].releaseEligible,
  }]));
  const supportedCapabilities = LOCALIZATION_CAPABILITIES.filter(
    (capability) => entry.capabilities[capability] === LOCALIZATION_CAPABILITY_STATUSES.ENABLED,
  );
  const unsupportedCapabilities = LOCALIZATION_CAPABILITIES.filter(
    (capability) => entry.capabilities[capability] !== LOCALIZATION_CAPABILITY_STATUSES.ENABLED,
  );
  const allRuntimeEnabled = unsupportedCapabilities.length === 0;
  const allReleaseEligible = LOCALIZATION_CAPABILITIES.every(
    (capability) => nativeReviewEligibility[capability].releaseEligible,
  );
  const journeys = LOCALIZATION_JOURNEY_FLOWS.map((flow) => journeyFlowCard(entry, flow, browserEvidence, nativeReviewEligibility));
  const allJourneyReleaseEligible = journeys.every((flow) => flow.releaseEligible);
  return {
    locale: entry.id,
    htmlLang: entry.htmlLang,
    marketId: entry.marketId,
    englishLabel: entry.englishLabel,
    nativeLabel: entry.nativeLabel,
    direction: entry.dir,
    runtimeCapabilityStatus: allRuntimeEnabled ? 'ALL_CAPABILITIES_ENABLED' : supportedCapabilities.length ? 'PARTIAL' : 'NOT_ENABLED',
    launchStatus: resolveLocaleLaunchStatus({
      allRuntimeEnabled,
      allNativeReleaseEligible: allReleaseEligible,
      allJourneyReleaseEligible,
    }),
    supportedCapabilities,
    unsupportedCapabilities,
    capabilityDetails: flows,
    supportedJourneys: journeys.filter((flow) => flow.runtimeStatus === 'enabled').map((flow) => flow.id),
    unsupportedJourneys: journeys.filter((flow) => flow.runtimeStatus !== 'enabled').map((flow) => flow.id),
    journeys,
    copyStatus: entry.release.copyStatus,
    nativeReview: effectiveNativeReview,
    populationEvidenceStatus: entry.release.populationEvidenceStatus,
    attitudinalValidationStatus: entry.release.attitudinalValidationStatus,
    calibrationDate: attitudinalValidationEvidence?.calibrationDate || null,
    calibrationScope: attitudinalValidationEvidence?.calibrationScope || null,
    accuracyClaimPermitted,
    knownLimitations: localeLimitations(entry, journeys, effectiveNativeReview),
  };
}

function publishedBrowserEvidence({ journeyAttestation, journeyPromotion, trustedPromotionKeys, buildIdentity, now }) {
  if (!journeyAttestation || !journeyPromotion || !trustedPromotionKeys || !buildIdentity) return null;
  const validation = validateLocalizationBrowserAttestation(journeyAttestation, {
    suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    buildIdentity,
    requiredLocaleIds: LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
    requiredViewports: LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
    requiredSamplesByLocale: LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
    allowedFlowIds: LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id),
    now,
  });
  if (!validation.ok || !validation.published) return null;
  const promotionValidation = validateLocalizationBrowserPromotion(journeyPromotion, {
    trustedPromotionKeys,
    publishedAttestation: validation.value,
    now,
  });
  if (!promotionValidation.ok) return null;
  return {
    attestation: validation.value,
    promotion: promotionValidation.value,
    promotionRecordId: promotionValidation.promotionRecordId,
    verifiedFlowIds: validation.verifiedFlowIds,
    flowCells: new Set(validation.value.flowEvidence.map((entry) => `${entry.flowId}@${entry.localeId}`)),
  };
}

export function buildLocalizationScorecard({
  journeyAttestation = null,
  journeyPromotion = null,
  trustedPromotionKeys = null,
  buildIdentity = null,
  nativeReviewEvidenceByLocale = null,
  trustedNativeReviewerKeys = null,
  nativeReviewBindingsByLocale = null,
  nativeReviewProgram = CJK_NATIVE_REVIEW_PROGRAM,
  now = new Date(),
} = {}) {
  const browserEvidence = publishedBrowserEvidence({
    journeyAttestation,
    journeyPromotion,
    trustedPromotionKeys,
    buildIdentity,
    now,
  });
  const locales = Object.values(LOCALE_CAPABILITIES).map((entry) => {
    const evidenceBundle = nativeReviewEvidenceByLocale?.[entry.id] || null;
    const expectedBindings = nativeReviewBindingsByLocale?.[entry.id] || null;
    const nativeReviewEligibility = Object.fromEntries(LOCALIZATION_CAPABILITIES.map((capability) => [
      capability,
      browserBoundNativeReviewEligibility({
        entry,
        capability,
        evidenceBundle,
        trustedReviewerKeys: trustedNativeReviewerKeys,
        expectedBindings,
        expectedReviewProgram: nativeReviewProgram,
        browserEvidence,
        now,
      }),
    ]));
    return projectLocaleScorecard(entry, browserEvidence, nativeReviewEligibility);
  });
  const markets = Object.values(MARKET_CAPABILITIES).map((entry) => {
    const support = marketLocaleSupport(entry);
    return {
      marketId: entry.id,
      englishLabel: entry.englishLabel,
      countryCode: entry.countryCode,
      currencyCode: entry.currencyCode,
      rolloutStatus: entry.status,
      supportMode: support.supportMode,
      retrievalGeography: entry.retrievalGeography ? { ...entry.retrievalGeography } : null,
      primaryLocaleIds: [...entry.primaryLocaleIds],
      enabledLocaleIds: [...support.enabledLocaleIds],
      fullyEnabledLocaleIds: [...support.fullyEnabledLocaleIds],
      partialLocaleIds: [...support.partialLocaleIds],
      outputEnabledLocaleIds: [...support.outputEnabledLocaleIds],
      plannedLocaleIds: [...support.plannedLocaleIds],
      preferredRetrievalLanguages: [...entry.preferredRetrievalLanguages],
    };
  });
  const automatedAccessibility = automatedAccessibilityProjection(browserEvidence);
  return deepFreeze({
    schemaVersion: LOCALIZATION_SCORECARD_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    methodology: {
      releaseRule: 'A journey flow is release eligible only when runtime support is enabled, attributed native review records its complete evidence, and a trusted signed promotion record binds published browser evidence for the exact build, locale, and flow.',
      journeyEvidenceRule: 'Capability flags describe configured runtime support. Named journeys require a separate published browser-gate attestation and a validated signed promotion record before the scorecard may claim automated journey verification. Sample coverage binds the static detail/index registry identity, quality badges, CTA, registry-derived prefill and request lineage, client exports, and local restoration; it does not claim that the static study JSON itself embeds run lineage. The current gate is fixture-backed UI and request-contract evidence; it does not validate a live backend, live model, participant panel, or observed human responses.',
      marketSupportRule: 'Markets whose primary locales have localized report/source/retrieval/instrument/sample output but planned interface UI are reported as MARKET_AND_LOCALIZED_OUTPUT, not market-routing-only.',
      calibrationDateRule: 'A calibration date remains null until an eligible held-out human comparison is recorded for the exact scope.',
      accuracyBoundary: LOCALIZATION_ACCURACY_BOUNDARY,
      accessibilityEvidenceRule: LOCALIZATION_ACCESSIBILITY_EVIDENCE_BOUNDARY,
    },
    automatedJourneyVerification: {
      suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
      status: !browserEvidence
        ? 'NOT_PUBLISHED'
        : browserEvidence.verifiedFlowIds.length === LOCALIZATION_JOURNEY_FLOWS.length
          ? 'PUBLISHED'
          : 'PARTIALLY_PUBLISHED',
      lastVerifiedAt: browserEvidence?.attestation.verifiedAt || null,
      buildId: browserEvidence?.attestation.build.id || null,
      artifactDigest: browserEvidence?.attestation.build.artifactDigest || null,
      evidenceId: browserEvidence?.attestation.evidenceId || null,
      evidenceUrl: browserEvidence?.attestation.publication.evidenceUrl || null,
      ciEvidenceId: browserEvidence?.promotion.ciEvidenceId || null,
      bundleDigest: browserEvidence?.promotion.bundleDigest || null,
      promotionRecordUrl: browserEvidence?.promotion.promotionRecordUrl || null,
      promotionRecordId: browserEvidence?.promotionRecordId || null,
      promotionSignerId: browserEvidence?.promotion.signerId || null,
      promotionSignedAt: browserEvidence?.promotion.signedAt || null,
      publicationBinding: browserEvidence ? 'SIGNED_PROMOTION_RECORD' : null,
      evidenceScope: browserEvidence ? { ...browserEvidence.attestation.execution } : null,
      automatedAccessibility,
      manualAssistiveTechnologyReview: {
        status: 'NOT_SEPARATELY_EVIDENCED',
        evidenceReference: null,
        requiredChecks: [
          'SCREEN_READER_BEHAVIOR',
          'NATIVE_PLATFORM_FONT_RENDERING',
          'MANUAL_KEYBOARD_JOURNEY',
          'MANUAL_ZOOM_AND_REFLOW',
        ],
      },
      requiredViewports: LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS.map((viewport) => viewport.width),
      requiredViewportPairs: LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS.map((viewport) => ({ ...viewport })),
      requiredLocaleIds: LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
      flowIds: LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id),
      verifiedFlowIds: browserEvidence?.verifiedFlowIds || [],
      unverifiedFlowIds: LOCALIZATION_JOURNEY_FLOWS
        .map((flow) => flow.id)
        .filter((flowId) => !browserEvidence?.verifiedFlowIds.includes(flowId)),
    },
    locales,
    markets,
  });
}
