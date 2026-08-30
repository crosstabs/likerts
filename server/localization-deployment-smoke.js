import { request as defaultHttpsRequest } from 'node:https';
import { isDeepStrictEqual } from 'node:util';

import {
  ASEAN_LANGUAGE_LOCALE_IDS,
  CJK_LOCALE_IDS,
  LOCALIZATION_CAPABILITIES,
  LOCALIZATION_CAPABILITY_STATUSES,
  LOCALIZATION_REGISTRY_VERSION,
  LOCALE_CAPABILITIES,
  MARKET_CAPABILITIES,
  isAttitudinalValidationEligible,
  marketLocaleSupport,
} from '../shared/localization.mjs';
import {
  LOCALIZATION_ACCURACY_BOUNDARY,
  LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
  LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
  LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
  LOCALIZATION_JOURNEY_FLOWS,
  LOCALIZATION_JOURNEY_GATE_VERSION,
  LOCALIZATION_SCORECARD_VERSION,
  buildLocalizationScorecard,
  nativeReviewBrowserBindingStatus,
  resolveLocaleLaunchStatus,
} from './localization-scorecard.js';
import {
  LOCALIZATION_BROWSER_API_MODE,
  LOCALIZATION_BROWSER_ATTESTATION_MAX_AGE_MS,
  LOCALIZATION_BROWSER_EVIDENCE_MODE,
  validateLocalizationBrowserAttestation,
} from './localization-browser-attestation.js';
import { validateLocalizationBrowserPromotion } from './localization-browser-promotion.js';
import {
  BrowserArtifactBindingError,
  validatePortableBrowserArtifactManifest,
  verifyPortableBrowserArtifactManifestBytes,
} from './browser-artifact-binding.js';
import { projectStaticSampleNativeReviewDeclaration } from './sample-lineage.js';
import {
  CJK_NATIVE_REVIEW_PROGRAM,
  nativeReviewProgramContract,
  validateNativeReviewEvidence,
} from './native-review-evidence.js';
import {
  PublicAddressPinnedHttpsError,
  createInjectedAddressResolver,
  createPinnedPublicHttpsFetch,
  createPublicAddressResolver,
  isPublicHttpsHostname,
  normalizePinnedHostname,
  resolvePublicPinnedAuthorityAddresses,
} from './public-address-pinned-https.js';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SCORECARD_PATH = '/api/localization-scorecard';
const MCP_PATH = '/api/mcp';
const MCP_LOCALIZATION_SCORECARD_URI = 'likerts://localization/scorecard';
const MCP_LOCALIZATION_SCORECARD_REQUEST_ID = 'localization-release-smoke';
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DEFAULT_FETCH_POLICY = deepFreeze({
  timeoutMs: 15_000,
  maxJsonBytes: 2 * 1024 * 1024,
  maxHtmlBytes: 512 * 1024,
  maxArtifactFiles: 2_048,
  maxArtifactFileBytes: 8 * 1024 * 1024,
  maxArtifactTotalBytes: 64 * 1024 * 1024,
});
const FETCH_POLICY_MAXIMUMS = deepFreeze({
  timeoutMs: 60_000,
  maxJsonBytes: 8 * 1024 * 1024,
  maxHtmlBytes: 4 * 1024 * 1024,
  maxArtifactFiles: 10_000,
  maxArtifactFileBytes: 32 * 1024 * 1024,
  maxArtifactTotalBytes: 256 * 1024 * 1024,
});
const AUTOMATED_STATUSES = new Set(['NOT_PUBLISHED', 'PARTIALLY_PUBLISHED', 'PUBLISHED']);
const SIGNED_PROMOTION_BINDING = 'SIGNED_PROMOTION_RECORD';
const EVIDENCE_RESOLUTION_TRUST_BOUNDARY = 'PRE_FETCH_DNS_VALIDATION_ONLY_CONNECTION_NOT_PINNED';
const PINNED_HTTPS_TRUST_BOUNDARY = 'HTTPS_CONNECTION_PINNED_TO_PRECHECKED_PUBLIC_ADDRESSES';
const EXPECTED_EVIDENCE_SCOPE = deepFreeze({
  evidenceMode: LOCALIZATION_BROWSER_EVIDENCE_MODE,
  apiMode: LOCALIZATION_BROWSER_API_MODE,
  externalNetworkAllowed: false,
  liveBackendValidated: false,
  liveModelValidated: false,
  observedHumanResponses: false,
  participantPanelConnected: false,
});

export class LocalizationDeploymentSmokeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocalizationDeploymentSmokeError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new LocalizationDeploymentSmokeError(code, message, details);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function sameStrings(left, right) {
  const sortedRight = [...right].sort();
  return Array.isArray(left)
    && left.length === right.length
    && [...left].sort().every((value, index) => value === sortedRight[index]);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedRuntimeStatus(entry) {
  const statuses = Object.values(entry.capabilities);
  const enabled = statuses.filter((status) => status === LOCALIZATION_CAPABILITY_STATUSES.ENABLED).length;
  if (enabled === statuses.length) return 'ALL_CAPABILITIES_ENABLED';
  return enabled > 0 ? 'PARTIAL' : 'NOT_ENABLED';
}

function expectedJourney(entry, flow, publishedFlowIds, expectedLocaleProjection) {
  const runtimeStatuses = flow.requiredCapabilities.map((capability) => entry.capabilities[capability]);
  const enabledCount = runtimeStatuses.filter((status) => status === LOCALIZATION_CAPABILITY_STATUSES.ENABLED).length;
  const runtimeStatus = enabledCount === runtimeStatuses.length
    ? 'enabled'
    : enabledCount > 0
      ? 'partial'
      : 'not-enabled';
  const nativeReviewStatus = expectedLocaleProjection.journeys
    .find((journey) => journey.id === flow.id).nativeReviewStatus;
  const published = publishedFlowIds.has(flow.id) && CJK_LOCALE_IDS.includes(entry.id);
  return {
    runtimeStatus,
    nativeReviewStatus,
    automatedEvidenceStatus: published ? 'PUBLISHED' : 'NOT_PUBLISHED',
    releaseEligible: published
      && runtimeStatus === 'enabled'
      && nativeReviewStatus === 'native-reviewed'
      && flow.requiredCapabilities.every(
        (capability) => expectedLocaleProjection.capabilityDetails[capability].releaseEligible,
      ),
  };
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function scorecardClaimsEffectiveNativeReview(scorecard) {
  return scorecard.locales.some((row) => row?.nativeReview?.status === 'native-reviewed'
    || row?.nativeReview?.status === 'partial'
    || row?.nativeReview?.evidenceId != null
    || Object.values(row?.capabilityDetails || {}).some(
      (detail) => detail?.nativeReviewStatus === 'native-reviewed' || detail?.releaseEligible === true,
    )
    || (row?.journeys || []).some(
      (journey) => ['native-reviewed', 'partial'].includes(journey?.nativeReviewStatus)
        || journey?.releaseEligible === true,
    ));
}

function validateNativeReviewEvidenceContext(context, now) {
  if (context === null || context === undefined) return null;
  const expectedKeys = [
    'nativeReviewProgram',
    'nativeReviewEvidenceByLocale',
    'nativeReviewBindingsByLocale',
    'trustedNativeReviewerKeys',
  ];
  const legacyExpectedKeys = expectedKeys.filter((key) => key !== 'nativeReviewProgram');
  if (!plainObject(context)
    || (!sameStrings(Object.keys(context), expectedKeys)
      && !sameStrings(Object.keys(context), legacyExpectedKeys))
    || !plainObject(context.nativeReviewEvidenceByLocale)
    || !plainObject(context.nativeReviewBindingsByLocale)
    || !plainObject(context.trustedNativeReviewerKeys)) {
    fail(
      'LOCALIZATION_SMOKE_NATIVE_REVIEW_CONTEXT_INVALID',
      'Independent native-review authority must provide the exact scorecard evidence context.',
    );
  }
  const nativeReviewProgram = context.nativeReviewProgram ?? CJK_NATIVE_REVIEW_PROGRAM;
  const program = nativeReviewProgramContract(nativeReviewProgram);
  if (!program) {
    fail(
      'LOCALIZATION_SMOKE_NATIVE_REVIEW_CONTEXT_INVALID',
      'Independent native-review authority must declare a supported review program.',
    );
  }
  const localeIds = Object.keys(context.nativeReviewEvidenceByLocale);
  if (localeIds.length === 0
    || localeIds.length > program.localeIds.length
    || localeIds.some((localeId) => !program.localeIds.includes(localeId))
    || !sameStrings(Object.keys(context.nativeReviewBindingsByLocale), localeIds)) {
    fail(
      'LOCALIZATION_SMOKE_NATIVE_REVIEW_CONTEXT_INVALID',
      `Independent native-review evidence and binding locale maps must match one to ${program.localeIds.length} ${program.id} locales.`,
    );
  }
  for (const localeId of localeIds) {
    const bundle = context.nativeReviewEvidenceByLocale[localeId];
    const validation = validateNativeReviewEvidence(bundle?.envelope, {
      trustedReviewerKeys: context.trustedNativeReviewerKeys,
      expectedBindings: context.nativeReviewBindingsByLocale[localeId],
      reviewPacketBytes: bundle?.reviewPacketBytes,
      expectedReviewProgram: program.id,
      now,
    });
    if (!validation.ok || validation.value.status !== 'EVIDENCE_VALIDATED') {
      fail(
        'LOCALIZATION_SMOKE_NATIVE_REVIEW_CONTEXT_INVALID',
        `Independent native-review evidence for ${localeId} failed validation.`,
        { localeId, validationCodes: validation.errors?.map((error) => error.code) || [] },
      );
    }
  }
  return {
    nativeReviewProgram: program.id,
    nativeReviewEvidenceByLocale: context.nativeReviewEvidenceByLocale,
    nativeReviewBindingsByLocale: context.nativeReviewBindingsByLocale,
    trustedNativeReviewerKeys: context.trustedNativeReviewerKeys,
  };
}

function assertNativeReviewBindingsMatchPublishedBrowserEvidence(context, browserEvidence) {
  if (!context) return;
  for (const [localeId, expectedBindings] of Object.entries(context.nativeReviewBindingsByLocale)) {
    const bindingStatus = nativeReviewBrowserBindingStatus(expectedBindings, browserEvidence);
    if (bindingStatus !== 'MATCHED') {
      fail(
        'LOCALIZATION_SMOKE_NATIVE_REVIEW_BROWSER_BINDING_MISMATCH',
        `Independent native-review bindings for ${localeId} do not match the validated published browser evidence.`,
        { localeId, bindingStatus },
      );
    }
  }
}

async function resolveNativeReviewEvidenceContext({ context, loader, now }) {
  if (context !== null && context !== undefined && loader !== null && loader !== undefined) {
    fail(
      'LOCALIZATION_SMOKE_NATIVE_REVIEW_AUTHORITY_INVALID',
      'Provide either independent native-review context or a loader, not both.',
    );
  }
  if (loader !== null && loader !== undefined && typeof loader !== 'function') {
    fail('LOCALIZATION_SMOKE_NATIVE_REVIEW_AUTHORITY_INVALID', 'Native-review evidence loader must be a function.');
  }
  let resolved = context;
  if (typeof loader === 'function') {
    try {
      resolved = await loader();
    } catch (error) {
      fail(
        'LOCALIZATION_SMOKE_NATIVE_REVIEW_EVIDENCE_UNAVAILABLE',
        'Independent native-review evidence could not be loaded.',
        { sourceCode: typeof error?.code === 'string' ? error.code : null },
      );
    }
  }
  return validateNativeReviewEvidenceContext(resolved, now);
}

function exactPrimitiveObject(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && sameStrings(Object.keys(value), Object.keys(expected))
    && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function canonicalIsoDateTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function normalizeEvidenceArtifactUrl(value, resourceName) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('LOCALIZATION_SMOKE_EVIDENCE_URL_INVALID', `The expected ${resourceName} URL must be an exact HTTPS URL.`);
  }
  if (url.protocol !== 'https:'
    || url.username || url.password || url.search || url.hash
    || url.port
    || !url.pathname.endsWith(`/${resourceName}`)) {
    fail('LOCALIZATION_SMOKE_EVIDENCE_URL_INVALID', `The expected ${resourceName} URL must be an exact default-port HTTPS artifact URL.`);
  }
  if (!isPublicHttpsHostname(url.hostname)) {
    fail('LOCALIZATION_SMOKE_EVIDENCE_URL_UNSAFE', `The ${resourceName} URL does not name an allowed public evidence host.`);
  }
  return url;
}

function normalizeEvidenceAuthority(expectedEvidenceUrl, expectedPromotionUrl, expectedBuildIdentity) {
  const evidenceSupplied = expectedEvidenceUrl !== null && expectedEvidenceUrl !== undefined;
  const promotionSupplied = expectedPromotionUrl !== null && expectedPromotionUrl !== undefined;
  if (!evidenceSupplied && !promotionSupplied) return null;
  if (!evidenceSupplied || !promotionSupplied) {
    fail(
      'LOCALIZATION_SMOKE_EVIDENCE_AUTHORITY_INVALID',
      'Expected evidence and promotion URLs must be supplied together.',
    );
  }
  const evidenceUrl = normalizeEvidenceArtifactUrl(expectedEvidenceUrl, 'attestation.json');
  const promotionUrl = normalizeEvidenceArtifactUrl(expectedPromotionUrl, 'promotion.json');
  const evidenceDirectory = evidenceUrl.pathname.slice(0, evidenceUrl.pathname.lastIndexOf('/') + 1);
  const promotionDirectory = promotionUrl.pathname.slice(0, promotionUrl.pathname.lastIndexOf('/') + 1);
  if (evidenceUrl.origin !== promotionUrl.origin || evidenceDirectory !== promotionDirectory) {
    fail(
      'LOCALIZATION_SMOKE_EVIDENCE_AUTHORITY_INVALID',
      'Expected evidence and promotion URLs must share one exact immutable HTTPS directory.',
    );
  }
  if (SHA256_PATTERN.test(expectedBuildIdentity?.artifactDigest || '')) {
    const artifactHash = expectedBuildIdentity.artifactDigest.slice('sha256:'.length);
    if (!evidenceUrl.pathname.endsWith(`/${artifactHash}/attestation.json`)
      || !promotionUrl.pathname.endsWith(`/${artifactHash}/promotion.json`)) {
      fail(
        'LOCALIZATION_SMOKE_EVIDENCE_AUTHORITY_INVALID',
        'Expected evidence URLs must use the independently selected artifact digest path.',
      );
    }
  }
  return deepFreeze({ evidenceUrl, promotionUrl });
}

function bindPublishedEvidenceUrls(verification, evidenceAuthority) {
  if (!evidenceAuthority) {
    fail(
      'LOCALIZATION_SMOKE_EVIDENCE_AUTHORITY_REQUIRED',
      'Published evidence may be fetched only from independently configured exact evidence and promotion URLs.',
    );
  }
  const scorecardEvidenceUrl = normalizeEvidenceArtifactUrl(verification.evidenceUrl, 'attestation.json');
  const scorecardPromotionUrl = normalizeEvidenceArtifactUrl(verification.promotionRecordUrl, 'promotion.json');
  if (scorecardEvidenceUrl.href !== evidenceAuthority.evidenceUrl.href
    || scorecardPromotionUrl.href !== evidenceAuthority.promotionUrl.href) {
    fail(
      'LOCALIZATION_SMOKE_EVIDENCE_URL_MISMATCH',
      'The scorecard evidence URLs do not match the independently configured exact artifact URLs.',
    );
  }
  return evidenceAuthority;
}

/**
 * Creates the cancelable resolver used by the CLI. Tests may inject a Node-like
 * Resolver factory without touching the network.
 */
export const createLocalizationEvidenceResolver = createPublicAddressResolver;

function injectedEvidenceResolver(resolveHostname) {
  return createInjectedAddressResolver(resolveHostname);
}

function hostnameForPinnedResolution(url) {
  return normalizePinnedHostname(url);
}

export async function resolveLocalizationPinnedAuthorityAddresses(hostname, createResolver, timeoutMs) {
  try {
    return await resolvePublicPinnedAuthorityAddresses(hostname, createResolver, timeoutMs);
  } catch (error) {
    if (!(error instanceof PublicAddressPinnedHttpsError)) throw error;
    const codeBySharedCode = {
      PUBLIC_HTTPS_RESOLVER_UNAVAILABLE: 'LOCALIZATION_SMOKE_EVIDENCE_RESOLVER_UNAVAILABLE',
      PUBLIC_HTTPS_RESOLUTION_TIMEOUT: 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_TIMEOUT',
      PUBLIC_HTTPS_RESOLUTION_FAILED: 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_FAILED',
      PUBLIC_HTTPS_RESOLUTION_INVALID: 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_INVALID',
      PUBLIC_HTTPS_RESOLUTION_UNSAFE: 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_UNSAFE',
    };
    fail(codeBySharedCode[error.code], error.message, error.details);
  }
}

async function resolveEvidenceAuthority(evidenceAuthority, createEvidenceResolver, timeoutMs) {
  const hostname = hostnameForPinnedResolution(evidenceAuthority.evidenceUrl);
  const uniqueAddresses = await resolveLocalizationPinnedAuthorityAddresses(hostname, createEvidenceResolver, timeoutMs);
  return deepFreeze({
    authorityOrigin: evidenceAuthority.evidenceUrl.origin,
    hostname,
    addresses: uniqueAddresses,
    evidenceUrl: evidenceAuthority.evidenceUrl.href,
    promotionUrl: evidenceAuthority.promotionUrl.href,
    connectionPinned: false,
    trustBoundary: EVIDENCE_RESOLUTION_TRUST_BOUNDARY,
  });
}

async function resolveDeploymentRootAuthority(root, createResolver, timeoutMs) {
  if (root.protocol !== 'https:') {
    fail(
      'LOCALIZATION_SMOKE_PINNED_TRANSPORT_REQUIRED',
      'Release-required artifact verification requires an HTTPS deployment root that can be connection pinned.',
      { authorityOrigin: root.origin },
    );
  }
  const hostname = hostnameForPinnedResolution(root);
  const addresses = await resolveLocalizationPinnedAuthorityAddresses(hostname, createResolver, timeoutMs);
  return deepFreeze({
    authorityOrigin: root.origin,
    hostname,
    addresses,
  });
}

function normalizeFetchPolicy(fetchPolicy) {
  if (fetchPolicy === null || fetchPolicy === undefined) return DEFAULT_FETCH_POLICY;
  if (!fetchPolicy || typeof fetchPolicy !== 'object' || Array.isArray(fetchPolicy)) {
    fail('LOCALIZATION_SMOKE_FETCH_POLICY_INVALID', 'Fetch policy must be an object of bounded integer limits.');
  }
  const allowedKeys = Object.keys(DEFAULT_FETCH_POLICY);
  if (Object.keys(fetchPolicy).some((key) => !allowedKeys.includes(key))) {
    fail('LOCALIZATION_SMOKE_FETCH_POLICY_INVALID', 'Fetch policy contains an unsupported option.');
  }
  const normalized = { ...DEFAULT_FETCH_POLICY, ...fetchPolicy };
  for (const key of allowedKeys) {
    if (!Number.isInteger(normalized[key])
      || normalized[key] < 1
      || normalized[key] > FETCH_POLICY_MAXIMUMS[key]) {
      fail(
        'LOCALIZATION_SMOKE_FETCH_POLICY_INVALID',
        `${key} must be a positive integer no greater than ${FETCH_POLICY_MAXIMUMS[key]}.`,
      );
    }
  }
  return deepFreeze(normalized);
}

function immutablePromotionRecordUrl(value, evidenceUrl, artifactDigest) {
  let promotionUrl;
  try {
    promotionUrl = new URL(value);
  } catch {
    return false;
  }
  const artifactHash = artifactDigest.slice('sha256:'.length);
  return promotionUrl.protocol === 'https:'
    && !promotionUrl.username
    && !promotionUrl.password
    && !promotionUrl.search
    && !promotionUrl.hash
    && promotionUrl.origin === evidenceUrl.origin
    && promotionUrl.pathname.endsWith(`/${artifactHash}/promotion.json`)
    && promotionUrl.pathname.slice(0, promotionUrl.pathname.lastIndexOf('/') + 1)
      === evidenceUrl.pathname.slice(0, evidenceUrl.pathname.lastIndexOf('/') + 1);
}

function validatePublicationEvidence(verification, expectedBuildIdentity, expectedPromotionBinding, now) {
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)
    || !AUTOMATED_STATUSES.has(verification.status)
    || verification.suiteId !== LOCALIZATION_JOURNEY_GATE_VERSION
    || !sameStrings(verification.requiredLocaleIds, LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS)
    || !sameJson(verification.requiredViewports, LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS.map((viewport) => viewport.width))
    || !sameJson(verification.requiredViewportPairs, LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS)
    || !sameStrings(verification.flowIds, LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id))) {
    fail('LOCALIZATION_SCORECARD_SHAPE_INVALID', 'The localization scorecard has invalid automated-verification metadata.');
  }
  const flowIds = LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id);
  if (!Array.isArray(verification.verifiedFlowIds)
    || !Array.isArray(verification.unverifiedFlowIds)
    || !verification.verifiedFlowIds.every((flowId) => flowIds.includes(flowId))
    || !verification.unverifiedFlowIds.every((flowId) => flowIds.includes(flowId))
    || new Set([...verification.verifiedFlowIds, ...verification.unverifiedFlowIds]).size !== flowIds.length
    || !flowIds.every((flowId) => (
      verification.verifiedFlowIds.includes(flowId) !== verification.unverifiedFlowIds.includes(flowId)
    ))) {
    fail('LOCALIZATION_SCORECARD_EVIDENCE_INVALID', 'The scorecard flow-evidence partition is incomplete or contradictory.');
  }

  if (verification.status === 'NOT_PUBLISHED') {
    if (verification.verifiedFlowIds.length > 0
      || verification.buildId !== null
      || verification.artifactDigest !== null
      || verification.evidenceId !== null
      || verification.evidenceUrl !== null
      || verification.lastVerifiedAt !== null
      || verification.ciEvidenceId !== null
      || verification.bundleDigest !== null
      || verification.promotionRecordUrl !== null
      || verification.promotionRecordId !== null
      || verification.promotionSignerId !== null
      || verification.promotionSignedAt !== null
      || verification.publicationBinding !== null
      || verification.evidenceScope !== null) {
      fail('LOCALIZATION_SCORECARD_EVIDENCE_INVALID', 'An unpublished scorecard must not imply published browser evidence.');
    }
  } else {
    const verifiedAtMs = Date.parse(verification.lastVerifiedAt);
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!verification.verifiedFlowIds.length
      || typeof verification.buildId !== 'string'
      || verification.buildId.trim().length < 7
      || !SHA256_PATTERN.test(verification.artifactDigest || '')
      || !SHA256_PATTERN.test(verification.evidenceId || '')
      || !SHA256_PATTERN.test(verification.ciEvidenceId || '')
      || !SHA256_PATTERN.test(verification.bundleDigest || '')
      || !SHA256_PATTERN.test(verification.promotionRecordId || '')
      || typeof verification.promotionSignerId !== 'string'
      || !verification.promotionSignerId.trim()
      || !canonicalIsoDateTime(verification.promotionSignedAt)
      || verification.publicationBinding !== SIGNED_PROMOTION_BINDING
      || !Number.isFinite(verifiedAtMs)
      || new Date(verifiedAtMs).toISOString() !== verification.lastVerifiedAt
      || !Number.isFinite(nowMs)
      || verifiedAtMs > nowMs + 5 * 60 * 1000
      || nowMs - verifiedAtMs > LOCALIZATION_BROWSER_ATTESTATION_MAX_AGE_MS
      || !exactPrimitiveObject(verification.evidenceScope, EXPECTED_EVIDENCE_SCOPE)) {
      fail('LOCALIZATION_SCORECARD_EVIDENCE_INVALID', 'Published browser evidence is missing its exact build identity.');
    }
    let evidenceUrl;
    try {
      evidenceUrl = new URL(verification.evidenceUrl);
    } catch {
      fail('LOCALIZATION_SCORECARD_EVIDENCE_INVALID', 'Published browser evidence has an invalid URL.');
    }
    const artifactHash = verification.artifactDigest.slice('sha256:'.length);
    if (evidenceUrl.protocol !== 'https:'
      || evidenceUrl.username || evidenceUrl.password || evidenceUrl.search || evidenceUrl.hash
      || !evidenceUrl.pathname.endsWith(`/${artifactHash}/attestation.json`)) {
      fail('LOCALIZATION_SCORECARD_EVIDENCE_INVALID', 'Published browser evidence is not at its immutable content-addressed HTTPS path.');
    }
    if (!immutablePromotionRecordUrl(
      verification.promotionRecordUrl,
      evidenceUrl,
      verification.artifactDigest,
    )) {
      fail('LOCALIZATION_SCORECARD_EVIDENCE_INVALID', 'Published browser promotion is not at the immutable evidence directory.');
    }
    if (verification.status === 'PUBLISHED' && verification.verifiedFlowIds.length !== flowIds.length) {
      fail('LOCALIZATION_SCORECARD_EVIDENCE_INVALID', 'A fully published scorecard must cover every declared localization flow.');
    }
    if (verification.status === 'PARTIALLY_PUBLISHED' && verification.verifiedFlowIds.length === flowIds.length) {
      fail('LOCALIZATION_SCORECARD_EVIDENCE_INVALID', 'A partially published scorecard cannot cover every declared localization flow.');
    }
  }

  if (expectedBuildIdentity) {
    if (!expectedBuildIdentity
      || typeof expectedBuildIdentity !== 'object'
      || Array.isArray(expectedBuildIdentity)
      || Object.keys(expectedBuildIdentity).sort().join(',') !== 'artifactDigest,id'
      || typeof expectedBuildIdentity.id !== 'string'
      || !SHA256_PATTERN.test(expectedBuildIdentity.artifactDigest || '')) {
      fail('LOCALIZATION_SMOKE_EXPECTED_BUILD_INVALID', 'Expected build identity must contain an id and SHA-256 artifact digest.');
    }
    if (verification.buildId !== expectedBuildIdentity.id
      || verification.artifactDigest !== expectedBuildIdentity.artifactDigest) {
      fail('LOCALIZATION_SMOKE_BUILD_MISMATCH', 'The deployed scorecard does not match the expected build identity.');
    }
  }

  if (expectedPromotionBinding) {
    if (!expectedPromotionBinding
      || typeof expectedPromotionBinding !== 'object'
      || Array.isArray(expectedPromotionBinding)
      || Object.keys(expectedPromotionBinding).sort().join(',') !== 'bundleDigest,ciEvidenceId'
      || !SHA256_PATTERN.test(expectedPromotionBinding.ciEvidenceId || '')
      || !SHA256_PATTERN.test(expectedPromotionBinding.bundleDigest || '')) {
      fail('LOCALIZATION_SMOKE_EXPECTED_PROMOTION_INVALID', 'Expected CI evidence and bundle digests must be SHA-256 values.');
    }
    if (verification.ciEvidenceId !== expectedPromotionBinding.ciEvidenceId
      || verification.bundleDigest !== expectedPromotionBinding.bundleDigest) {
      fail('LOCALIZATION_SMOKE_PROMOTION_BINDING_MISMATCH', 'The deployed scorecard does not match the independently selected CI evidence bundle.');
    }
  }

  return new Set(verification.verifiedFlowIds);
}

export function validateLocalizationDeploymentScorecard(scorecard, {
  expectedBuildIdentity = null,
  expectedPromotionBinding = null,
  nativeReviewEvidenceContext = null,
  now = new Date(),
} = {}) {
  if (!scorecard || typeof scorecard !== 'object' || Array.isArray(scorecard)
    || scorecard.schemaVersion !== LOCALIZATION_SCORECARD_VERSION
    || scorecard.registryVersion !== LOCALIZATION_REGISTRY_VERSION
    || scorecard.methodology?.accuracyBoundary !== LOCALIZATION_ACCURACY_BOUNDARY
    || !Array.isArray(scorecard.locales)) {
    fail('LOCALIZATION_SCORECARD_SHAPE_INVALID', 'The localization scorecard schema or accuracy boundary is missing.');
  }
  const independentNativeContext = validateNativeReviewEvidenceContext(nativeReviewEvidenceContext, now);
  if (!independentNativeContext && scorecardClaimsEffectiveNativeReview(scorecard)) {
    fail(
      'LOCALIZATION_SMOKE_NATIVE_REVIEW_AUTHORITY_REQUIRED',
      'The deployed scorecard claims effective native-review evidence without independent native authority.',
    );
  }
  const expectedNativeScorecard = buildLocalizationScorecard({
    ...(independentNativeContext || {}),
    now,
  });

  const publishedFlowIds = validatePublicationEvidence(
    scorecard.automatedJourneyVerification,
    expectedBuildIdentity,
    expectedPromotionBinding,
    now,
  );
  const expectedLocaleIds = Object.keys(LOCALE_CAPABILITIES).sort();
  const actualLocaleIds = scorecard.locales.map((entry) => entry?.locale).sort();
  if (!sameStrings(actualLocaleIds, expectedLocaleIds)) {
    fail('LOCALIZATION_SCORECARD_REGISTRY_DRIFT', 'The deployed locale set differs from the canonical registry.');
  }

  for (const localeId of expectedLocaleIds) {
    const expected = LOCALE_CAPABILITIES[localeId];
    const actual = scorecard.locales.find((entry) => entry.locale === localeId);
    const expectedProjection = expectedNativeScorecard.locales.find((entry) => entry.locale === localeId);
    const supportedCapabilities = LOCALIZATION_CAPABILITIES.filter(
      (capability) => expected.capabilities[capability] === LOCALIZATION_CAPABILITY_STATUSES.ENABLED,
    );
    const unsupportedCapabilities = LOCALIZATION_CAPABILITIES.filter(
      (capability) => expected.capabilities[capability] !== LOCALIZATION_CAPABILITY_STATUSES.ENABLED,
    );
    if (!actual
      || actual.runtimeCapabilityStatus !== expectedRuntimeStatus(expected)
      || actual.htmlLang !== expected.htmlLang
      || actual.marketId !== expected.marketId
      || actual.direction !== expected.dir
      || actual.copyStatus !== expected.release.copyStatus
      || !isDeepStrictEqual(actual.nativeReview, expectedProjection.nativeReview)
      || actual.populationEvidenceStatus !== expected.release.populationEvidenceStatus
      || actual.attitudinalValidationStatus !== expected.release.attitudinalValidationStatus
      || actual.accuracyClaimPermitted !== isAttitudinalValidationEligible(expected)
      || !sameStrings(actual.supportedCapabilities, supportedCapabilities)
      || !sameStrings(actual.unsupportedCapabilities, unsupportedCapabilities)
      || !Array.isArray(actual.journeys)
      || !actual.capabilityDetails || typeof actual.capabilityDetails !== 'object') {
      fail('LOCALIZATION_SCORECARD_REGISTRY_DRIFT', `The deployed scorecard overstates or drifts from locale ${localeId}.`, { localeId });
    }
    for (const capability of LOCALIZATION_CAPABILITIES) {
      const detail = actual.capabilityDetails[capability];
      const expectedDetail = expectedProjection.capabilityDetails[capability];
      if (!detail
        || detail.runtimeStatus !== expected.capabilities[capability]
        || detail.nativeReviewStatus !== expectedDetail.nativeReviewStatus
        || detail.nativeReviewEvidenceStatus !== expectedDetail.nativeReviewEvidenceStatus
        || detail.releaseEligible !== expectedDetail.releaseEligible) {
        fail('LOCALIZATION_SCORECARD_REGISTRY_DRIFT', `The deployed scorecard overstates or drifts from locale ${localeId}/${capability}.`, { localeId, capability });
      }
    }
    if (isAttitudinalValidationEligible(expected) === false
      && !actual.knownLimitations?.includes('ATTITUDINAL_ACCURACY_NOT_VALIDATED')) {
      fail('LOCALIZATION_SCORECARD_ACCURACY_BOUNDARY_MISSING', `Locale ${localeId} omits the attitudinal-accuracy limitation.`, { localeId });
    }
    if (actual.knownLimitations?.includes('NATIVE_REVIEW_NOT_COMPLETE')
      !== expectedProjection.knownLimitations.includes('NATIVE_REVIEW_NOT_COMPLETE')) {
      fail('LOCALIZATION_SCORECARD_NATIVE_REVIEW_BOUNDARY_MISSING', `Locale ${localeId} omits the packet-validated native-review limitation.`, { localeId });
    }

    const expectedJourneyIds = LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id);
    if (!sameStrings(actual.journeys.map((journey) => journey?.id), expectedJourneyIds)) {
      fail('LOCALIZATION_SCORECARD_JOURNEY_DRIFT', `Locale ${localeId} has an incomplete journey matrix.`, { localeId });
    }
    let allJourneyReleaseEligible = true;
    for (const flow of LOCALIZATION_JOURNEY_FLOWS) {
      const journey = actual.journeys.find((candidate) => candidate.id === flow.id);
      const expectedState = expectedJourney(expected, flow, publishedFlowIds, expectedProjection);
      if (journey.runtimeStatus !== expectedState.runtimeStatus
        || journey.nativeReviewStatus !== expectedState.nativeReviewStatus
        || journey.automatedEvidenceStatus !== expectedState.automatedEvidenceStatus
        || journey.releaseEligible !== expectedState.releaseEligible) {
        fail('LOCALIZATION_SCORECARD_JOURNEY_DRIFT', `Locale ${localeId} overstates or drifts on journey ${flow.id}.`, { localeId, flowId: flow.id });
      }
      allJourneyReleaseEligible &&= expectedState.releaseEligible;
    }
    const allRuntimeEnabled = unsupportedCapabilities.length === 0;
    const allNativeReleaseEligible = LOCALIZATION_CAPABILITIES.every(
      (capability) => expectedProjection.capabilityDetails[capability].releaseEligible,
    );
    const expectedLaunchStatus = resolveLocaleLaunchStatus({
      allRuntimeEnabled,
      allNativeReleaseEligible,
      allJourneyReleaseEligible,
    });
    if (actual.launchStatus !== expectedLaunchStatus) {
      fail('LOCALIZATION_SCORECARD_RELEASE_STATUS_INVALID', `Locale ${localeId} has an invalid launch status.`, { localeId });
    }
  }

  for (const localeId of ASEAN_LANGUAGE_LOCALE_IDS) {
    const row = scorecard.locales.find((entry) => entry.locale === localeId);
    if (!row || row.runtimeCapabilityStatus !== 'NOT_ENABLED' || row.launchStatus !== 'RUNTIME_ENABLEMENT_REQUIRED') {
      fail('LOCALIZATION_SCORECARD_ASEAN_OVERCLAIM', `Planned ASEAN locale ${localeId} is represented as enabled.`, { localeId });
    }
  }

  if (!Array.isArray(scorecard.markets)
    || !sameStrings(scorecard.markets.map((entry) => entry?.marketId), Object.keys(MARKET_CAPABILITIES))) {
    fail('LOCALIZATION_SCORECARD_REGISTRY_DRIFT', 'The deployed market set differs from the canonical registry.');
  }
  for (const expected of Object.values(MARKET_CAPABILITIES)) {
    const actual = scorecard.markets.find((entry) => entry.marketId === expected.id);
    const support = marketLocaleSupport(expected);
    const mismatch = !actual
      || actual.rolloutStatus !== expected.status
      || actual.supportMode !== support.supportMode
      || actual.currencyCode !== expected.currencyCode
      || !sameJson(actual.retrievalGeography, expected.retrievalGeography)
      || !sameStrings(actual.primaryLocaleIds, expected.primaryLocaleIds)
      || !sameStrings(actual.enabledLocaleIds, support.enabledLocaleIds)
      || !sameStrings(actual.fullyEnabledLocaleIds, support.fullyEnabledLocaleIds)
      || !sameStrings(actual.partialLocaleIds, support.partialLocaleIds)
      || !sameStrings(actual.outputEnabledLocaleIds, support.outputEnabledLocaleIds)
      || !sameStrings(actual.plannedLocaleIds, support.plannedLocaleIds)
      || !sameStrings(actual.preferredRetrievalLanguages, expected.preferredRetrievalLanguages);
    if (mismatch) {
      fail(
        ASEAN_LANGUAGE_LOCALE_IDS.some((localeId) => expected.primaryLocaleIds.includes(localeId))
          ? 'LOCALIZATION_SCORECARD_ASEAN_OVERCLAIM'
          : 'LOCALIZATION_SCORECARD_REGISTRY_DRIFT',
        `The deployed market row drifts from ${expected.id}.`,
        { marketId: expected.id },
      );
    }
  }

  return deepFreeze({
    scorecardStatus: scorecard.automatedJourneyVerification.status,
    publishedFlowIds: [...publishedFlowIds],
  });
}

function normalizeBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    fail('LOCALIZATION_SMOKE_BASE_URL_INVALID', 'A valid deployment root URL is required.');
  }
  const loopback = LOOPBACK_HOSTNAMES.has(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol)
    || (url.protocol !== 'https:' && !loopback)
    || url.username || url.password || url.search || url.hash
    || url.pathname !== '/') {
    fail('LOCALIZATION_SMOKE_BASE_URL_INVALID', 'Use an HTTPS deployment root, or an HTTP loopback root for local diagnostics.');
  }
  return url;
}

async function readBoundedResponseBytes(response, url, {
  maxBytes,
  resourceType,
  signal,
}) {
  const declaredLength = String(response.headers?.get?.('content-length') || '').trim();
  if (/^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    try {
      await response.body?.cancel?.();
    } catch {
      // The declared size failure remains authoritative if cancellation is unsupported.
    }
    fail('LOCALIZATION_SMOKE_BODY_TOO_LARGE', `${url.pathname} exceeds the ${resourceType} response-size limit.`, {
      path: url.pathname,
      resourceType,
      maxBytes,
    });
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    fail('LOCALIZATION_SMOKE_BODY_UNREADABLE', `${url.pathname} did not expose a bounded response stream.`, {
      path: url.pathname,
      resourceType,
    });
  }
  const cancelOnAbort = () => {
    Promise.resolve(reader.cancel(signal?.reason)).catch(() => {
      // The timeout remains authoritative if stream cancellation is unsupported.
    });
  };
  if (signal?.aborted) cancelOnAbort();
  else signal?.addEventListener('abort', cancelOnAbort, { once: true });
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size failure remains authoritative even if cancellation is unsupported.
        }
        fail('LOCALIZATION_SMOKE_BODY_TOO_LARGE', `${url.pathname} exceeds the ${resourceType} response-size limit.`, {
          path: url.pathname,
          resourceType,
          maxBytes,
        });
      }
      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readBoundedResponseText(response, url, options) {
  return new TextDecoder().decode(await readBoundedResponseBytes(response, url, options));
}

function abortAndCancelResponse(controller, response) {
  controller.abort();
  try {
    const cancellation = response?.body?.cancel?.();
    cancellation?.catch?.(() => {
      // Cleanup must not replace or delay the authoritative response error.
    });
  } catch {
    // Cleanup must not replace or delay the authoritative response error.
  }
}

export function createLocalizationPinnedHttpsFetch(authority, {
  httpsRequestImpl = defaultHttpsRequest,
  agentFactory,
} = {}) {
  return createPinnedPublicHttpsFetch(authority, {
    httpsRequestImpl,
    ...(agentFactory ? { agentFactory } : {}),
    errorCodes: {
      authorityMismatch: 'LOCALIZATION_SMOKE_PINNED_AUTHORITY_MISMATCH',
      lookupMismatch: 'LOCALIZATION_SMOKE_PINNED_LOOKUP_MISMATCH',
      lookupEmpty: 'LOCALIZATION_SMOKE_PINNED_LOOKUP_EMPTY',
    },
  });
}

function establishPinnedHttpsFetch(authority, {
  httpsRequestImpl,
  requirePinned,
}) {
  if (typeof httpsRequestImpl !== 'function') {
    if (requirePinned) {
      fail(
        'LOCALIZATION_SMOKE_PINNED_TRANSPORT_REQUIRED',
        'Release-required smoke checks require a pinned HTTPS transport for published evidence and artifact bytes.',
        { authorityOrigin: authority?.authorityOrigin || null },
      );
    }
    return { fetchImpl: null, connectionPinned: false };
  }
  try {
    return {
      fetchImpl: createLocalizationPinnedHttpsFetch(authority, { httpsRequestImpl }),
      connectionPinned: true,
    };
  } catch (error) {
    if (requirePinned) {
      fail(
        'LOCALIZATION_SMOKE_PINNED_TRANSPORT_REQUIRED',
        'Release-required smoke checks could not establish a pinned HTTPS transport.',
        {
          authorityOrigin: authority?.authorityOrigin || null,
          cause: error?.message || 'unknown',
        },
      );
    }
    return { fetchImpl: null, connectionPinned: false };
  }
}

async function fetchSmokeResource(fetchImpl, url, {
  method = 'GET',
  expectedContentType,
  timeoutMs,
  maxBytes = null,
  resourceType = null,
  responseType = 'text',
  requestHeaders = {},
  requestBody,
} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle;
  const operation = (async () => {
    const expectedContentTypes = Array.isArray(expectedContentType)
      ? expectedContentType
      : expectedContentType ? [expectedContentType] : [];
    const response = await fetchImpl(url, {
      method,
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        accept: expectedContentTypes.length ? expectedContentTypes.join(', ') : '*/*',
        ...requestHeaders,
      },
      ...(requestBody === undefined ? {} : { body: requestBody }),
      signal: controller.signal,
    });
    if (!response || response.status !== 200 || response.redirected) {
      abortAndCancelResponse(controller, response);
      fail('LOCALIZATION_SMOKE_HTTP_STATUS', `${method} ${url.pathname} did not return an exact 200 response.`, {
        path: url.pathname,
        status: response?.status ?? null,
      });
    }
    if (response.url) {
      let responseUrl;
      try {
        responseUrl = new URL(response.url);
      } catch {
        abortAndCancelResponse(controller, response);
        fail('LOCALIZATION_SMOKE_RESPONSE_URL_MISMATCH', `${url.pathname} returned an invalid response URL.`);
      }
      if (responseUrl.href !== url.href) {
        abortAndCancelResponse(controller, response);
        fail('LOCALIZATION_SMOKE_RESPONSE_URL_MISMATCH', `${url.pathname} resolved to an unexpected response URL.`, {
          expectedUrl: url.href,
          responseUrl: responseUrl.href,
        });
      }
    }
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (expectedContentTypes.length && !expectedContentTypes.some((type) => contentType.includes(type))) {
      abortAndCancelResponse(controller, response);
      fail('LOCALIZATION_SMOKE_CONTENT_TYPE', `${url.pathname} returned the wrong content type.`, {
        path: url.pathname,
        contentType,
      });
    }
    return resourceType
      ? (responseType === 'bytes' ? readBoundedResponseBytes : readBoundedResponseText)(response, url, {
        maxBytes,
        resourceType,
        signal: controller.signal,
      })
      : response;
  })();
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new LocalizationDeploymentSmokeError(
        'LOCALIZATION_SMOKE_FETCH_TIMEOUT',
        `${method} ${url.pathname} exceeded the smoke fetch timeout.`,
        { path: url.pathname, timeoutMs },
      ));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (error instanceof LocalizationDeploymentSmokeError) throw error;
    if (timedOut) {
      fail('LOCALIZATION_SMOKE_FETCH_TIMEOUT', `${method} ${url.pathname} exceeded the smoke fetch timeout.`, {
        path: url.pathname,
        timeoutMs,
      });
    }
    fail('LOCALIZATION_SMOKE_FETCH_FAILED', `Could not fetch ${url.pathname}.`, { cause: error?.message || 'unknown' });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseMcpJsonRpcPayload(body) {
  try {
    return JSON.parse(body);
  } catch {
    const normalized = String(body).replace(/\r\n/g, '\n');
    const messageData = normalized
      .split(/\n\n+/)
      .map((event) => event.split('\n'))
      .filter((lines) => lines.some((line) => line === 'event: message'))
      .map((lines) => lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n'))
      .filter(Boolean);
    if (messageData.length !== 1) {
      fail(
        'LOCALIZATION_MCP_SCORECARD_INVALID',
        'The deployed MCP scorecard resource did not return one bounded JSON-RPC message.',
      );
    }
    try {
      return JSON.parse(messageData[0]);
    } catch {
      fail(
        'LOCALIZATION_MCP_SCORECARD_INVALID',
        'The deployed MCP scorecard resource returned invalid JSON-RPC data.',
      );
    }
  }
}

async function readDeployedMcpLocalizationScorecard(fetchImpl, root, resourcePolicy) {
  const mcpUrl = new URL(MCP_PATH, root);
  const body = await fetchSmokeResource(fetchImpl, mcpUrl, {
    method: 'POST',
    expectedContentType: ['application/json', 'text/event-stream'],
    timeoutMs: resourcePolicy.timeoutMs,
    maxBytes: resourcePolicy.maxJsonBytes,
    resourceType: 'json',
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: JSON.stringify({
      jsonrpc: '2.0',
      id: MCP_LOCALIZATION_SCORECARD_REQUEST_ID,
      method: 'resources/read',
      params: { uri: MCP_LOCALIZATION_SCORECARD_URI },
    }),
  });
  const payload = parseMcpJsonRpcPayload(body);
  if (!plainObject(payload)
    || payload.jsonrpc !== '2.0'
    || payload.id !== MCP_LOCALIZATION_SCORECARD_REQUEST_ID
    || Object.hasOwn(payload, 'error')
    || !plainObject(payload.result)
    || !Array.isArray(payload.result.contents)
    || payload.result.contents.length !== 1) {
    fail(
      'LOCALIZATION_MCP_SCORECARD_INVALID',
      'The deployed MCP scorecard resource returned an invalid JSON-RPC result.',
    );
  }
  const [content] = payload.result.contents;
  if (!plainObject(content)
    || content.uri !== MCP_LOCALIZATION_SCORECARD_URI
    || content.mimeType !== 'application/json'
    || typeof content.text !== 'string') {
    fail(
      'LOCALIZATION_MCP_SCORECARD_INVALID',
      'The deployed MCP scorecard resource returned an invalid resource body.',
    );
  }
  try {
    return JSON.parse(content.text);
  } catch {
    fail(
      'LOCALIZATION_MCP_SCORECARD_INVALID',
      'The deployed MCP scorecard resource body was not valid JSON.',
    );
  }
}

function deployedArtifactFileUrl(root, relativePath) {
  const encodedPath = relativePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const url = new URL(encodedPath, root);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)
    || url.username || url.password || url.search || url.hash) {
    fail('LOCALIZATION_DEPLOYED_ARTIFACT_MANIFEST_INVALID', 'The published artifact manifest contains a path outside the deployment root.', {
      relativePath,
    });
  }
  return url;
}

async function verifyDeployedBrowserArtifact({
  fetchImpl,
  evidenceFetchImpl = fetchImpl,
  artifactFetchImpl = fetchImpl,
  root,
  evidenceUrl,
  artifactDigest,
  resourcePolicy,
}) {
  const artifactManifestUrl = new URL('artifact-manifest.json', evidenceUrl);
  const manifestBody = await fetchSmokeResource(evidenceFetchImpl, artifactManifestUrl, {
    expectedContentType: 'application/json',
    timeoutMs: resourcePolicy.timeoutMs,
    maxBytes: resourcePolicy.maxJsonBytes,
    resourceType: 'json',
  });
  let manifest;
  try {
    manifest = JSON.parse(manifestBody);
  } catch {
    fail('LOCALIZATION_DEPLOYED_ARTIFACT_MANIFEST_INVALID', 'The published browser artifact manifest did not return valid JSON.');
  }

  let relativePaths;
  try {
    relativePaths = validatePortableBrowserArtifactManifest(manifest);
  } catch (error) {
    if (!(error instanceof BrowserArtifactBindingError)) throw error;
    fail('LOCALIZATION_DEPLOYED_ARTIFACT_MANIFEST_INVALID', 'The published browser artifact manifest is malformed.', {
      validationCode: error.code,
    });
  }
  if (manifest.artifactDigest !== artifactDigest) {
    fail('LOCALIZATION_DEPLOYED_ARTIFACT_MISMATCH', 'The published browser artifact manifest does not match the signed attestation artifact digest.', {
      expectedArtifactDigest: artifactDigest,
      manifestArtifactDigest: manifest.artifactDigest,
    });
  }
  if (manifest.files.length > resourcePolicy.maxArtifactFiles) {
    fail('LOCALIZATION_DEPLOYED_ARTIFACT_LIMIT_EXCEEDED', 'The published browser artifact manifest exceeds the artifact file-count limit.', {
      fileCount: manifest.files.length,
      maxArtifactFiles: resourcePolicy.maxArtifactFiles,
    });
  }

  let declaredTotalBytes = 0;
  for (const entry of manifest.files) {
    if (entry.byteLength > resourcePolicy.maxArtifactFileBytes
      || entry.byteLength > resourcePolicy.maxArtifactTotalBytes - declaredTotalBytes) {
      fail('LOCALIZATION_SMOKE_BODY_TOO_LARGE', 'The published browser artifact manifest exceeds the deployed-artifact response-size limits.', {
        path: entry.relativePath,
        resourceType: 'artifact',
        maxArtifactFileBytes: resourcePolicy.maxArtifactFileBytes,
        maxArtifactTotalBytes: resourcePolicy.maxArtifactTotalBytes,
      });
    }
    declaredTotalBytes += entry.byteLength;
  }

  const fetchedFiles = [];
  let fetchedTotalBytes = 0;
  for (const [index, entry] of manifest.files.entries()) {
    const fileUrl = deployedArtifactFileUrl(root, relativePaths[index]);
    const bytes = await fetchSmokeResource(artifactFetchImpl, fileUrl, {
      timeoutMs: resourcePolicy.timeoutMs,
      maxBytes: Math.min(
        resourcePolicy.maxArtifactFileBytes,
        resourcePolicy.maxArtifactTotalBytes - fetchedTotalBytes,
      ),
      resourceType: 'artifact',
      responseType: 'bytes',
    });
    fetchedTotalBytes += bytes.byteLength;
    fetchedFiles.push({ relativePath: entry.relativePath, bytes });
  }

  const manifestedIndex = fetchedFiles.find((entry) => entry.relativePath === 'index.html');
  if (!manifestedIndex) {
    fail('LOCALIZATION_DEPLOYED_ARTIFACT_MANIFEST_INVALID', 'The published browser artifact manifest must include index.html for the deployment root.');
  }
  const rootBytes = await fetchSmokeResource(artifactFetchImpl, root, {
    timeoutMs: resourcePolicy.timeoutMs,
    maxBytes: resourcePolicy.maxArtifactFileBytes,
    resourceType: 'artifact-root',
    responseType: 'bytes',
  });
  if (!Buffer.from(rootBytes).equals(Buffer.from(manifestedIndex.bytes))) {
    fail('LOCALIZATION_DEPLOYED_ARTIFACT_MISMATCH', 'The user-facing deployment root does not serve the manifested index.html bytes.', {
      expectedArtifactDigest: artifactDigest,
      relativePath: 'index.html',
    });
  }

  try {
    return verifyPortableBrowserArtifactManifestBytes({ manifest, files: fetchedFiles });
  } catch (error) {
    if (!(error instanceof BrowserArtifactBindingError)) throw error;
    fail('LOCALIZATION_DEPLOYED_ARTIFACT_MISMATCH', 'The deployed browser build bytes do not match the signed attestation artifact digest.', {
      expectedArtifactDigest: artifactDigest,
      validationCode: error.code,
    });
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderedStaticBadgeValues(html, attribute) {
  const expression = new RegExp(`\\b${escapeRegex(attribute)}=["']([^"']+)["']`, 'gi');
  return [...html.matchAll(expression)].map((match) => match[1]);
}

function everyBadgeValueMatches(values, expected) {
  return values.length > 0 && values.every((value) => value === expected);
}

export async function runLocalizationDeploymentSmoke(options = {}) {
  const {
    baseUrl,
    fetchImpl = globalThis.fetch,
    expectedBuildIdentity = null,
    expectedCiEvidenceId = null,
    expectedBundleDigest = null,
    expectedEvidenceUrl = null,
    expectedPromotionUrl = null,
    trustedPromotionKeys = null,
    resolveHostname,
    createEvidenceResolver = createLocalizationEvidenceResolver,
    nativeReviewEvidenceContext = null,
    nativeReviewEvidenceLoader = null,
    requireReleaseReady = false,
    fetchPolicy = null,
    now = new Date(),
    httpsRequestImpl = defaultHttpsRequest,
  } = options;
  if (typeof fetchImpl !== 'function') {
    fail('LOCALIZATION_SMOKE_FETCH_UNAVAILABLE', 'A fetch implementation is required.');
  }
  if (requireReleaseReady && (!expectedBuildIdentity || !expectedCiEvidenceId || !expectedBundleDigest)) {
    fail(
      'LOCALIZATION_SMOKE_EXPECTED_BUILD_REQUIRED',
      'A release-required smoke must include independently selected build, CI evidence, and bundle digests.',
    );
  }
  if ((expectedCiEvidenceId === null) !== (expectedBundleDigest === null)) {
    fail('LOCALIZATION_SMOKE_EXPECTED_PROMOTION_INVALID', 'Expected CI evidence ID and bundle digest must be supplied together.');
  }
  const independentNativeContext = await resolveNativeReviewEvidenceContext({
    context: nativeReviewEvidenceContext,
    loader: nativeReviewEvidenceLoader,
    now,
  });
  const evidenceAuthority = normalizeEvidenceAuthority(
    expectedEvidenceUrl,
    expectedPromotionUrl,
    expectedBuildIdentity,
  );
  if (requireReleaseReady && !evidenceAuthority) {
    fail(
      'LOCALIZATION_SMOKE_EVIDENCE_AUTHORITY_REQUIRED',
      'A release-required smoke must include independently selected exact evidence and promotion URLs.',
    );
  }
  const resourcePolicy = normalizeFetchPolicy(fetchPolicy);
  const fetchImplWasInjected = Object.hasOwn(options, 'fetchImpl') && fetchImpl !== globalThis.fetch;
  const httpsRequestImplWasInjected = Object.hasOwn(options, 'httpsRequestImpl');
  const pinnedHttpsRequestImpl = fetchImplWasInjected && !httpsRequestImplWasInjected
    ? null
    : httpsRequestImpl;
  const expectedPromotionBinding = expectedCiEvidenceId === null
    ? null
    : { ciEvidenceId: expectedCiEvidenceId, bundleDigest: expectedBundleDigest };
  const root = normalizeBaseUrl(baseUrl);
  const scorecardUrl = new URL(SCORECARD_PATH, root);
  await fetchSmokeResource(fetchImpl, scorecardUrl, {
    method: 'HEAD',
    expectedContentType: 'application/json',
    timeoutMs: resourcePolicy.timeoutMs,
  });
  const scorecardBody = await fetchSmokeResource(fetchImpl, scorecardUrl, {
    expectedContentType: 'application/json',
    timeoutMs: resourcePolicy.timeoutMs,
    maxBytes: resourcePolicy.maxJsonBytes,
    resourceType: 'json',
  });
  let scorecard;
  try {
    scorecard = JSON.parse(scorecardBody);
  } catch {
    fail('LOCALIZATION_SCORECARD_JSON_INVALID', 'The localization scorecard did not return valid JSON.');
  }
  const scorecardValidation = validateLocalizationDeploymentScorecard(scorecard, {
    expectedBuildIdentity,
    expectedPromotionBinding,
    nativeReviewEvidenceContext: independentNativeContext,
    now,
  });
  let mcpScorecardParity = 'NOT_CHECKED';
  if (requireReleaseReady) {
    const mcpScorecard = await readDeployedMcpLocalizationScorecard(fetchImpl, root, resourcePolicy);
    const { correlationId: _restCorrelationId, ...restProjection } = scorecard;
    const { correlationId: _mcpCorrelationId, ...mcpProjection } = mcpScorecard;
    if (!isDeepStrictEqual(mcpProjection, restProjection)) {
      fail(
        'LOCALIZATION_MCP_SCORECARD_MISMATCH',
        'The deployed MCP and HTTP localization scorecards do not project the same release evidence.',
      );
    }
    mcpScorecardParity = 'MATCHED';
  }

  const verification = scorecard.automatedJourneyVerification;
  let validatedPublishedAttestation = null;
  let validatedPromotion = null;
  let evidenceResolutionReceipt = null;
  if (verification.status !== 'NOT_PUBLISHED') {
    const publishedUrls = bindPublishedEvidenceUrls(verification, evidenceAuthority);
    const evidenceResolverFactory = resolveHostname === undefined
      ? createEvidenceResolver
      : typeof resolveHostname === 'function'
        ? () => injectedEvidenceResolver(resolveHostname)
        : null;
    evidenceResolutionReceipt = await resolveEvidenceAuthority(
      publishedUrls,
      evidenceResolverFactory,
      resourcePolicy.timeoutMs,
    );
    const pinnedEvidence = establishPinnedHttpsFetch(evidenceResolutionReceipt, {
      httpsRequestImpl: pinnedHttpsRequestImpl,
      requirePinned: requireReleaseReady,
    });
    const evidenceFetchImpl = pinnedEvidence.fetchImpl || fetchImpl;
    if (pinnedEvidence.connectionPinned) {
      evidenceResolutionReceipt = deepFreeze({
        ...evidenceResolutionReceipt,
        connectionPinned: true,
        trustBoundary: PINNED_HTTPS_TRUST_BOUNDARY,
      });
    }
    const evidenceBody = await fetchSmokeResource(evidenceFetchImpl, publishedUrls.evidenceUrl, {
      expectedContentType: 'application/json',
      timeoutMs: resourcePolicy.timeoutMs,
      maxBytes: resourcePolicy.maxJsonBytes,
      resourceType: 'json',
    });
    let attestation;
    try {
      attestation = JSON.parse(evidenceBody);
    } catch {
      fail('LOCALIZATION_DEPLOYED_EVIDENCE_INVALID', 'Published localization evidence did not return valid JSON.');
    }
    const evidenceValidation = validateLocalizationBrowserAttestation(attestation, {
      suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
      registryVersion: LOCALIZATION_REGISTRY_VERSION,
      buildIdentity: {
        id: verification.buildId,
        artifactDigest: verification.artifactDigest,
      },
      requiredLocaleIds: LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
      requiredViewports: LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
      requiredSamplesByLocale: LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
      allowedFlowIds: LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id),
      now,
    });
    if (!evidenceValidation.ok || !evidenceValidation.published
      || attestation.evidenceId !== verification.evidenceId
      || attestation.publication.evidenceUrl !== verification.evidenceUrl
      || attestation.verifiedAt !== verification.lastVerifiedAt
      || !sameStrings(evidenceValidation.verifiedFlowIds, verification.verifiedFlowIds)
      || !exactPrimitiveObject(attestation.execution, verification.evidenceScope)) {
      fail('LOCALIZATION_DEPLOYED_EVIDENCE_INVALID', 'Published localization evidence does not match the scorecard and canonical browser contract.', {
        validationCode: evidenceValidation.code,
      });
    }
    validatedPublishedAttestation = evidenceValidation.value;

    const promotionBody = await fetchSmokeResource(evidenceFetchImpl, publishedUrls.promotionUrl, {
      expectedContentType: 'application/json',
      timeoutMs: resourcePolicy.timeoutMs,
      maxBytes: resourcePolicy.maxJsonBytes,
      resourceType: 'json',
    });
    let promotion;
    try {
      promotion = JSON.parse(promotionBody);
    } catch {
      fail('LOCALIZATION_DEPLOYED_PROMOTION_INVALID', 'Published localization promotion did not return valid JSON.');
    }
    const promotionValidation = validateLocalizationBrowserPromotion(promotion, {
      trustedPromotionKeys,
      publishedAttestation: evidenceValidation.value,
      now,
    });
    if (!promotionValidation.ok
      || promotionValidation.value.ciEvidenceId !== verification.ciEvidenceId
      || promotionValidation.value.bundleDigest !== verification.bundleDigest
      || promotionValidation.value.publishedEvidenceId !== verification.evidenceId
      || promotionValidation.value.publishedEvidenceUrl !== verification.evidenceUrl
      || promotionValidation.value.promotionRecordUrl !== verification.promotionRecordUrl
      || promotionValidation.value.signerId !== verification.promotionSignerId
      || promotionValidation.value.signedAt !== verification.promotionSignedAt
      || promotionValidation.promotionRecordId !== verification.promotionRecordId) {
      fail('LOCALIZATION_DEPLOYED_PROMOTION_INVALID', 'Published localization promotion does not match the scorecard and trusted signed-promotion contract.', {
        validationCode: promotionValidation.code,
      });
    }
    validatedPromotion = promotion;
    assertNativeReviewBindingsMatchPublishedBrowserEvidence(independentNativeContext, {
      attestation: validatedPublishedAttestation,
      promotion: promotionValidation.value,
    });
    if (requireReleaseReady) {
      const rootAuthority = await resolveDeploymentRootAuthority(
        root,
        evidenceResolverFactory,
        resourcePolicy.timeoutMs,
      );
      const pinnedRoot = establishPinnedHttpsFetch(rootAuthority, {
        httpsRequestImpl: pinnedHttpsRequestImpl,
        requirePinned: true,
      });
      await verifyDeployedBrowserArtifact({
        fetchImpl,
        evidenceFetchImpl,
        artifactFetchImpl: pinnedRoot.fetchImpl,
        root,
        evidenceUrl: publishedUrls.evidenceUrl,
        artifactDigest: promotionValidation.value.artifactDigest,
        resourcePolicy,
      });
    }
  }

  const { correlationId: _correlationId, ...deployedScorecard } = scorecard;
  const canonicalScorecard = buildLocalizationScorecard({
    journeyAttestation: validatedPublishedAttestation,
    journeyPromotion: validatedPromotion,
    trustedPromotionKeys,
    buildIdentity: validatedPublishedAttestation ? {
      id: verification.buildId,
      artifactDigest: verification.artifactDigest,
    } : null,
    ...(independentNativeContext || {}),
    now,
  });
  if (!isDeepStrictEqual(deployedScorecard, canonicalScorecard)) {
    fail(
      'LOCALIZATION_SCORECARD_CANONICAL_MISMATCH',
      'The deployed scorecard differs from the canonical projection of the registry and validated browser evidence.',
    );
  }

  for (const localeId of CJK_LOCALE_IDS) {
    const locale = LOCALE_CAPABILITIES[localeId];
    const hubUrl = new URL(`/${localeId.toLowerCase()}/studies/`, root);
    const html = await fetchSmokeResource(fetchImpl, hubUrl, {
      expectedContentType: 'text/html',
      timeoutMs: resourcePolicy.timeoutMs,
      maxBytes: resourcePolicy.maxHtmlBytes,
      resourceType: 'html',
    });
    const languagePattern = new RegExp(`<html\\s+[^>]*lang=["']${escapeRegex(locale.htmlLang)}["']`, 'i');
    const directionPattern = new RegExp(`<html\\s+[^>]*dir=["']${escapeRegex(locale.dir)}["']`, 'i');
    const staticNativeReview = projectStaticSampleNativeReviewDeclaration(locale);
    const renderedStatuses = renderedStaticBadgeValues(html, 'data-native-review-status');
    const renderedAuthorities = renderedStaticBadgeValues(html, 'data-native-review-authority');
    const renderedReleaseEligibility = renderedStaticBadgeValues(html, 'data-native-review-release-eligible');
    const scorecardSampleStatus = scorecard.locales
      .find((entry) => entry.locale === localeId)
      ?.capabilityDetails?.sample?.nativeReviewStatus;
    if (requireReleaseReady && !everyBadgeValueMatches(renderedStatuses, scorecardSampleStatus)) {
      fail(
        'LOCALIZATION_STATIC_NATIVE_REVIEW_SCORECARD_MISMATCH',
        `The ${localeId} static sample review badge differs from the evidence-qualified scorecard sample status.`,
        {
          localeId,
          renderedStatuses,
          registryStatus: staticNativeReview.status,
          scorecardStatus: scorecardSampleStatus || null,
        },
      );
    }
    if (!languagePattern.test(html)
      || !directionPattern.test(html)
      || !everyBadgeValueMatches(renderedStatuses, staticNativeReview.status)
      || !everyBadgeValueMatches(renderedAuthorities, staticNativeReview.authority)
      || !everyBadgeValueMatches(renderedReleaseEligibility, String(staticNativeReview.releaseEligible))) {
      fail('LOCALIZATION_STATIC_LANGUAGE_MISMATCH', `The ${localeId} study hub does not expose its canonical language, direction, and review state.`, { localeId });
    }
  }

  const releaseBlockers = [];
  if (scorecardValidation.scorecardStatus !== 'PUBLISHED') {
    releaseBlockers.push('AUTOMATED_JOURNEY_ATTESTATION_NOT_PUBLISHED');
  }
  for (const localeId of CJK_LOCALE_IDS) {
    const launchStatus = scorecard.locales.find((entry) => entry.locale === localeId).launchStatus;
    if (launchStatus !== 'NATIVE_REVIEWED') releaseBlockers.push(`${localeId}:${launchStatus}`);
  }
  const report = deepFreeze({
    contractStatus: 'PASSED',
    releaseReady: releaseBlockers.length === 0,
    baseUrl: root.href,
    scorecardStatus: scorecardValidation.scorecardStatus,
    checkedLocaleIds: [...CJK_LOCALE_IDS],
    mcpScorecardParity,
    releaseBlockers: [...new Set(releaseBlockers)],
    evidenceResolutionReceipt,
  });
  if (requireReleaseReady && !report.releaseReady) {
    fail('LOCALIZATION_RELEASE_GATES_OPEN', 'The deployed localization contract is valid, but release gates remain open.', {
      releaseBlockers: report.releaseBlockers,
    });
  }
  return report;
}
