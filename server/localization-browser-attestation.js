import { createHash } from 'node:crypto';

import { CURRENT_LOCALIZATION_CATALOG_HASH } from './localization-catalog-hash.js';

export const LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION = 'localization-browser-attestation-v5';
export const LOCALIZATION_JOURNEY_GATE_VERSION = 'localized-full-journey-browser-gate-v5';
export const LOCALIZATION_BROWSER_ATTESTATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const LOCALIZATION_BROWSER_EVIDENCE_MODE = 'FIXTURE_BACKED_UI_REQUEST_CONTRACT';
export const LOCALIZATION_BROWSER_API_MODE = 'IN_PROCESS_FIXTURES_UNKNOWN_API_ABORTED';
export const LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE = 'axe-core';
export const LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS = Object.freeze([
  'wcag21a',
  'wcag21aa',
  'wcag2a',
  'wcag2aa',
]);
export const LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS = Object.freeze([
  'first-run',
  'study-authoring',
  'results-overview',
  'stability',
  'evidence-ledger',
  'population-frame',
  'qualitative-exploration',
  'research-design-and-human-handoff',
]);
export const LOCALIZATION_BROWSER_ACCESSIBILITY_DEEP_SURFACE_IDS = Object.freeze([
  'required-source-error',
  'specialized-method-results',
  'specialized-method-handoffs',
  'static-sample-detail',
  'restored-sample-project',
]);
export const LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS = Object.freeze([
  ...LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS,
  ...LOCALIZATION_BROWSER_ACCESSIBILITY_DEEP_SURFACE_IDS,
]);
export const LOCALIZATION_BROWSER_METHOD_IDS = Object.freeze([
  'CONCEPT_TEST',
  'PURCHASE_INTENT',
  'MESSAGE_TEST',
  'CLAIMS_TEST',
  'UX_EXPECTATION_TEST',
  'FEATURE_PRIORITIZATION',
  'BRAND_POSITIONING',
  'PRICE_SENSITIVITY',
  'SURVEY_PRETEST',
  'INTERVIEW_GUIDE',
]);
export const LOCALIZATION_BROWSER_METHOD_RESULT_KINDS = Object.freeze([
  'ATTRIBUTE_MATRIX',
  'DIRECTIONAL_DISTRIBUTION',
  'INSTRUMENT_REVIEW',
  'INTERVIEW_GUIDE',
  'PRICE_LADDER',
  'RANKED_ITEMS',
]);
export const LOCALIZATION_BROWSER_ATTESTED_FLOW_IDS = Object.freeze([
  'first-run-and-authoring',
  'research-methods-and-instrument',
  'results-and-research-design',
  'evidence-and-retrieval',
  'population-frame-and-model-card',
  'stability-and-convergence',
  'qualitative-exploration',
  'exports-and-human-handoff',
  'samples-persistence-and-lineage',
]);

const PUBLICATION_STATUSES = new Set(['CI_ARTIFACT', 'PUBLISHED']);
const JOURNEY_TYPES = new Set(['AUTHORING_LAYOUT', 'FULL_JOURNEY']);
const METHOD_FLOW_ID = 'research-methods-and-instrument';
const SAMPLE_FLOW_ID = 'samples-persistence-and-lineage';
const FAILURE_FIELDS = [
  'unmockedApiRequests',
  'externalRequests',
  'consoleErrors',
  'pageErrors',
  'failedResponses',
  'failedRequests',
];
const ACCESSIBILITY_FIELDS = [
  'engine',
  'engineVersion',
  'rulesetTags',
  'surfaceChecks',
  'violations',
];
const ACCESSIBILITY_SURFACE_CHECK_FIELDS = [
  'surfaceId',
  'snapshotCount',
  'violations',
];
const ACCESSIBILITY_SURFACE_SNAPSHOT_COUNTS = Object.freeze({
  'first-run': 1,
  'study-authoring': 1,
  'results-overview': 1,
  stability: 1,
  'evidence-ledger': 1,
  'population-frame': 1,
  'qualitative-exploration': 1,
  'research-design-and-human-handoff': 1,
  'required-source-error': 1,
  'specialized-method-results': LOCALIZATION_BROWSER_METHOD_IDS.length,
  'specialized-method-handoffs': LOCALIZATION_BROWSER_METHOD_IDS.length,
  'static-sample-detail': 1,
  'restored-sample-project': 1,
});
const EXECUTION_FIELDS = [
  'evidenceMode',
  'apiMode',
  'externalNetworkAllowed',
  'liveBackendValidated',
  'liveModelValidated',
  'observedHumanResponses',
  'participantPanelConnected',
];
const METHOD_COVERAGE_FIELDS = [
  'localeId',
  'methodIds',
  'resultKinds',
  'localizedAuthoringSurfaces',
  'localizedResultSurfaces',
  'localizedHandoffDrafts',
  'methodSpecificReceiptDownloads',
  'observedHumanResponses',
  'participantPanelConnected',
];
const SAMPLE_COVERAGE_FIELDS = [
  'localeId',
  'viewport',
  'status',
  'samples',
];
const SAMPLE_REQUIREMENT_FIELDS = ['localeId', 'samples'];
const REQUIRED_SAMPLE_FIELDS = ['stableId', 'slug', 'sampleSchemaVersion', 'quality'];
const SAMPLE_FIELDS = [
  'stableId',
  'slug',
  'sampleSchemaVersion',
  'quality',
  'checks',
];
const SAMPLE_QUALITY_FIELDS = [
  'automatedQaStatus',
  'nativeReviewStatus',
];
const SAMPLE_CHECK_FIELDS = [
  'staticDetailRegistryMatched',
  'staticDetailQualityBadgesMatched',
  'ctaMatched',
  'composerOpenedFromCta',
  'autoRunApiCalls',
  'promptMatched',
  'audienceMatched',
  'researchMethod',
  'staleMethodFieldCount',
  'lineageNoticeLocalized',
  'lineageNoticeSource',
  'lineageNoticeAutomatedQaStatus',
  'lineageNoticeNativeReviewStatus',
  'requestApiCalls',
  'requestMethodConfigPresent',
  'requestCanonicalLineageMatched',
  'responseRunLineageMatched',
  'responseMetaLineageMatched',
  'responseReproducibilityLineageMatched',
  'responsePersistenceInputLineageMatched',
  'responsePersistenceRunLineageMatched',
  'evidencePackStudyLineageMatched',
  'evidencePackResultLineageMatched',
  'evidencePackTopLevelLineageMatched',
  'qualitativeProjectExportLineageMatched',
  'qualitativeRunRecordLineageMatched',
  'localStorageLineageMatched',
  'restoredWithoutSampleQuery',
  'restoredReportMatched',
  'restoredLineageNoticeMatched',
  'restoreApiCalls',
  'observedHumanResponses',
  'participantPanelConnected',
];
const TOP_LEVEL_FIELDS = [
  'schemaVersion',
  'suiteId',
  'registryVersion',
  'catalogHash',
  'status',
  'verifiedAt',
  'build',
  'publication',
  'execution',
  'testedLocaleIds',
  'testedViewports',
  'matrix',
  'flowEvidence',
  'methodCoverage',
  'sampleCoverage',
  'evidenceId',
];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Attestation values must be JSON-compatible plain objects.');
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function evidenceDigest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function withoutEvidenceId(attestation) {
  const { evidenceId: _evidenceId, ...payload } = attestation;
  return payload;
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function fail(code) {
  return deepFreeze({ ok: false, published: false, code });
}

function uniqueSortedStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortedStrings(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function viewportKey(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

function normalizedViewports(viewports = []) {
  return viewports.map((viewport) => ({ width: viewport?.width, height: viewport?.height }))
    .sort((left, right) => left.width - right.width || left.height - right.height);
}

function uniqueNormalizedViewports(viewports = []) {
  const byKey = new Map(normalizedViewports(viewports).map((viewport) => [viewportKey(viewport), viewport]));
  return [...byKey.values()];
}

function sameViewports(left, right) {
  return left.length === right.length && left.every((viewport, index) => (
    viewport.width === right[index].width && viewport.height === right[index].height
  ));
}

const ACCESSIBILITY_SURFACE_ORDER = new Map(
  LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS.map((surfaceId, index) => [surfaceId, index]),
);

function normalizedAccessibilitySurfaceChecks(surfaceChecks = []) {
  if (!Array.isArray(surfaceChecks)) return [];
  return surfaceChecks.map((entry) => ({
    surfaceId: entry?.surfaceId,
    snapshotCount: entry?.snapshotCount,
    violations: entry?.violations,
  })).sort((left, right) => {
    const leftOrder = ACCESSIBILITY_SURFACE_ORDER.get(left.surfaceId);
    const rightOrder = ACCESSIBILITY_SURFACE_ORDER.get(right.surfaceId);
    return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER)
      || String(left.surfaceId).localeCompare(String(right.surfaceId));
  });
}

function normalizedMatrix(matrix = []) {
  return matrix.map((entry) => ({
    localeId: entry.localeId,
    viewport: { width: entry.viewport?.width, height: entry.viewport?.height },
    journey: entry.journey,
    status: entry.status,
    failures: Object.fromEntries(FAILURE_FIELDS.map((field) => [field, entry.failures?.[field]])),
    accessibility: {
      engine: entry.accessibility?.engine,
      engineVersion: entry.accessibility?.engineVersion,
      rulesetTags: sortedStrings(entry.accessibility?.rulesetTags || []),
      surfaceChecks: normalizedAccessibilitySurfaceChecks(entry.accessibility?.surfaceChecks),
      violations: entry.accessibility?.violations,
    },
  })).sort((left, right) => left.localeId.localeCompare(right.localeId)
    || left.viewport.width - right.viewport.width
    || left.viewport.height - right.viewport.height);
}

function normalizedFlowEvidence(flowEvidence = []) {
  return flowEvidence.map((entry) => ({
    flowId: entry.flowId,
    localeId: entry.localeId,
    status: entry.status,
    viewports: normalizedViewports(entry.viewports || []),
  })).sort((left, right) => left.flowId.localeCompare(right.flowId)
    || left.localeId.localeCompare(right.localeId));
}

function normalizedMethodCoverage(methodCoverage = []) {
  return methodCoverage.map((entry) => ({
    localeId: entry.localeId,
    methodIds: sortedStrings(entry.methodIds || []),
    resultKinds: sortedStrings(entry.resultKinds || []),
    localizedAuthoringSurfaces: entry.localizedAuthoringSurfaces,
    localizedResultSurfaces: entry.localizedResultSurfaces,
    localizedHandoffDrafts: entry.localizedHandoffDrafts,
    methodSpecificReceiptDownloads: entry.methodSpecificReceiptDownloads,
    observedHumanResponses: entry.observedHumanResponses,
    participantPanelConnected: entry.participantPanelConnected,
  })).sort((left, right) => left.localeId.localeCompare(right.localeId));
}

function normalizedSamples(samples = []) {
  return samples.map((entry) => ({
    stableId: entry.stableId,
    slug: entry.slug,
    sampleSchemaVersion: entry.sampleSchemaVersion,
    quality: {
      automatedQaStatus: entry.quality?.automatedQaStatus,
      nativeReviewStatus: entry.quality?.nativeReviewStatus,
    },
    checks: Object.fromEntries(SAMPLE_CHECK_FIELDS.map((field) => [field, entry.checks?.[field]])),
  })).sort((left, right) => String(left.stableId).localeCompare(String(right.stableId))
    || String(left.slug).localeCompare(String(right.slug)));
}

function normalizedSampleCoverage(sampleCoverage = []) {
  return sampleCoverage.map((entry) => ({
    localeId: entry.localeId,
    viewport: { width: entry.viewport?.width, height: entry.viewport?.height },
    status: entry.status,
    samples: normalizedSamples(entry.samples || []),
  })).sort((left, right) => String(left.localeId).localeCompare(String(right.localeId)));
}

function normalizedSampleRequirements(requiredSamplesByLocale = []) {
  return requiredSamplesByLocale.map((entry) => ({
    localeId: entry.localeId,
    samples: (entry.samples || []).map((sample) => ({
      stableId: sample.stableId,
      slug: sample.slug,
      sampleSchemaVersion: sample.sampleSchemaVersion,
      quality: {
        automatedQaStatus: sample.quality?.automatedQaStatus,
        nativeReviewStatus: sample.quality?.nativeReviewStatus,
      },
    })).sort((left, right) => String(left.stableId).localeCompare(String(right.stableId))
      || String(left.slug).localeCompare(String(right.slug))),
  })).sort((left, right) => String(left.localeId).localeCompare(String(right.localeId)));
}

function expectedSampleChecks(quality) {
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

export function createLocalizationBrowserAttestation(input = {}) {
  const matrix = normalizedMatrix(input.matrix);
  const flowEvidence = normalizedFlowEvidence(input.flowEvidence);
  const methodCoverage = normalizedMethodCoverage(input.methodCoverage);
  const sampleCoverage = normalizedSampleCoverage(input.sampleCoverage);
  const payload = {
    schemaVersion: LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION,
    suiteId: input.suiteId,
    registryVersion: input.registryVersion,
    catalogHash: input.catalogHash ?? CURRENT_LOCALIZATION_CATALOG_HASH,
    status: matrix.length > 0
      && flowEvidence.length > 0
      && sampleCoverage.length > 0
      && matrix.every((entry) => entry.status === 'PASSED')
      && matrix.every((entry) => entry.accessibility.violations === 0)
      && matrix.every((entry) => entry.accessibility.surfaceChecks.length > 0
        && entry.accessibility.surfaceChecks.every((surfaceCheck) => surfaceCheck.violations === 0))
      && flowEvidence.every((entry) => entry.status === 'PASSED')
      && sampleCoverage.every((entry) => entry.status === 'PASSED' && entry.samples.length > 0)
      ? 'PASSED'
      : 'FAILED',
    verifiedAt: input.verifiedAt,
    build: {
      id: input.build?.id,
      artifactDigest: input.build?.artifactDigest,
      candidateUrl: input.build?.candidateUrl,
    },
    publication: {
      status: input.publication?.status,
      evidenceUrl: input.publication?.evidenceUrl ?? null,
    },
    execution: {
      evidenceMode: input.execution?.evidenceMode,
      apiMode: input.execution?.apiMode,
      externalNetworkAllowed: input.execution?.externalNetworkAllowed,
      liveBackendValidated: input.execution?.liveBackendValidated,
      liveModelValidated: input.execution?.liveModelValidated,
      observedHumanResponses: input.execution?.observedHumanResponses,
      participantPanelConnected: input.execution?.participantPanelConnected,
    },
    testedLocaleIds: uniqueSortedStrings(matrix.map((entry) => entry.localeId)),
    testedViewports: uniqueNormalizedViewports(matrix.map((entry) => entry.viewport)),
    matrix,
    flowEvidence,
    methodCoverage,
    sampleCoverage,
  };
  return deepFreeze({ ...payload, evidenceId: evidenceDigest(payload) });
}

export function validateLocalizationBrowserAttestation(attestation, {
  suiteId,
  registryVersion,
  buildIdentity,
  requiredLocaleIds = [],
  requiredViewports = [],
  requiredSamplesByLocale = [],
  allowedFlowIds = [],
  now = new Date(),
  maxAgeMs = LOCALIZATION_BROWSER_ATTESTATION_MAX_AGE_MS,
} = {}) {
  try {
    if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) return fail('ATTESTATION_SHAPE_INVALID');
    if (attestation.schemaVersion !== LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION) return fail('ATTESTATION_SCHEMA_MISMATCH');
    if (attestation.suiteId !== suiteId) return fail('SUITE_ID_MISMATCH');
    if (!exactFields(attestation, TOP_LEVEL_FIELDS)) return fail('ATTESTATION_SHAPE_INVALID');
    if (attestation.registryVersion !== registryVersion) return fail('REGISTRY_VERSION_MISMATCH');
    if (attestation.catalogHash !== CURRENT_LOCALIZATION_CATALOG_HASH) return fail('CATALOG_HASH_MISMATCH');
    if (!/^sha256:[a-f0-9]{64}$/.test(attestation.evidenceId || '')) return fail('ATTESTATION_DIGEST_INVALID');
    if (evidenceDigest(withoutEvidenceId(attestation)) !== attestation.evidenceId) return fail('ATTESTATION_DIGEST_MISMATCH');
    if (attestation.status !== 'PASSED') return fail('BROWSER_GATE_NOT_PASSED');

    if (!exactFields(attestation.execution, EXECUTION_FIELDS)
      || attestation.execution.evidenceMode !== LOCALIZATION_BROWSER_EVIDENCE_MODE
      || attestation.execution.apiMode !== LOCALIZATION_BROWSER_API_MODE
      || attestation.execution.externalNetworkAllowed !== false
      || attestation.execution.liveBackendValidated !== false
      || attestation.execution.liveModelValidated !== false
      || attestation.execution.observedHumanResponses !== false
      || attestation.execution.participantPanelConnected !== false) {
      return fail('EXECUTION_EVIDENCE_INVALID');
    }

    if (!exactFields(attestation.build, ['id', 'artifactDigest', 'candidateUrl'])) return fail('BUILD_IDENTITY_INVALID');
    if (typeof attestation.build.id !== 'string' || attestation.build.id.trim().length < 7) return fail('BUILD_IDENTITY_INVALID');
    if (!/^sha256:[a-f0-9]{64}$/.test(attestation.build.artifactDigest || '')) return fail('BUILD_IDENTITY_INVALID');
    try {
      const candidateUrl = new URL(attestation.build.candidateUrl);
      if (!['http:', 'https:'].includes(candidateUrl.protocol)) return fail('BUILD_IDENTITY_INVALID');
    } catch {
      return fail('BUILD_IDENTITY_INVALID');
    }
    if (!exactFields(buildIdentity, ['id', 'artifactDigest'])) return fail('EXPECTED_BUILD_IDENTITY_REQUIRED');
    if (attestation.build.id !== buildIdentity.id) return fail('BUILD_ID_MISMATCH');
    if (attestation.build.artifactDigest !== buildIdentity.artifactDigest) return fail('ARTIFACT_DIGEST_MISMATCH');

    const verifiedAtMs = Date.parse(attestation.verifiedAt);
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    if (!Number.isFinite(verifiedAtMs) || new Date(verifiedAtMs).toISOString() !== attestation.verifiedAt || !Number.isFinite(nowMs)) {
      return fail('VERIFICATION_TIME_INVALID');
    }
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) return fail('VERIFICATION_WINDOW_INVALID');
    if (verifiedAtMs > nowMs + 5 * 60 * 1000) return fail('VERIFICATION_TIME_INVALID');
    if (nowMs - verifiedAtMs > maxAgeMs) return fail('VERIFICATION_STALE');

    if (!exactFields(attestation.publication, ['status', 'evidenceUrl'])
      || !PUBLICATION_STATUSES.has(attestation.publication.status)) return fail('PUBLICATION_INVALID');
    if (attestation.publication.status === 'CI_ARTIFACT') {
      if (attestation.publication.evidenceUrl !== null) return fail('PUBLICATION_INVALID');
    } else {
      try {
        const evidenceUrl = new URL(attestation.publication.evidenceUrl);
        const artifactHash = attestation.build.artifactDigest.slice('sha256:'.length);
        const pathSegments = evidenceUrl.pathname.split('/').filter(Boolean);
        if (evidenceUrl.protocol !== 'https:'
          || evidenceUrl.username || evidenceUrl.password
          || evidenceUrl.search || evidenceUrl.hash
          || pathSegments.length < 2
          || pathSegments.at(-2) !== artifactHash
          || pathSegments.at(-1) !== 'attestation.json'
          || !evidenceUrl.pathname.endsWith(`/${artifactHash}/attestation.json`)) {
          return fail('EVIDENCE_URL_NOT_IMMUTABLE');
        }
      } catch {
        return fail('EVIDENCE_URL_NOT_IMMUTABLE');
      }
    }

    if (!Array.isArray(attestation.matrix) || attestation.matrix.length === 0) return fail('MATRIX_INVALID');
    const expectedLocales = uniqueSortedStrings(requiredLocaleIds);
    const expectedViewports = normalizedViewports(requiredViewports);
    if (expectedLocales.length === 0 || expectedViewports.length === 0
      || expectedViewports.some((viewport) => !exactFields(viewport, ['width', 'height'])
        || !Number.isInteger(viewport.width) || viewport.width <= 0
        || !Number.isInteger(viewport.height) || viewport.height <= 0)
      || new Set(expectedViewports.map(viewportKey)).size !== expectedViewports.length) {
      return fail('MATRIX_EXPECTATIONS_REQUIRED');
    }
    if (!Array.isArray(requiredSamplesByLocale)
      || requiredSamplesByLocale.length !== expectedLocales.length
      || requiredSamplesByLocale.some((entry) => !exactFields(entry, SAMPLE_REQUIREMENT_FIELDS)
        || !expectedLocales.includes(entry.localeId)
        || !Array.isArray(entry.samples)
        || entry.samples.length === 0
        || entry.samples.some((sample) => !exactFields(sample, REQUIRED_SAMPLE_FIELDS)
          || !exactFields(sample.quality, SAMPLE_QUALITY_FIELDS)
          || typeof sample.stableId !== 'string' || !sample.stableId
          || typeof sample.slug !== 'string' || !sample.slug
          || typeof sample.sampleSchemaVersion !== 'string' || !sample.sampleSchemaVersion
          || typeof sample.quality.automatedQaStatus !== 'string' || !sample.quality.automatedQaStatus
          || typeof sample.quality.nativeReviewStatus !== 'string' || !sample.quality.nativeReviewStatus))) {
      return fail('SAMPLE_COVERAGE_EXPECTATIONS_REQUIRED');
    }
    const expectedSampleRequirements = normalizedSampleRequirements(requiredSamplesByLocale);
    if (!sameArray(expectedSampleRequirements.map((entry) => entry.localeId), expectedLocales)
      || new Set(requiredSamplesByLocale.map((entry) => entry.localeId)).size !== expectedLocales.length
      || expectedSampleRequirements.some((entry) => new Set(entry.samples.map((sample) => sample.stableId)).size !== entry.samples.length
        || new Set(entry.samples.map((sample) => sample.slug)).size !== entry.samples.length)) {
      return fail('SAMPLE_COVERAGE_EXPECTATIONS_REQUIRED');
    }
    const expectedViewportKeys = new Set(expectedViewports.map(viewportKey));
    const matrixCells = new Map();
    const deepAccessibilityCells = new Map(expectedLocales.map((localeId) => [localeId, []]));
    for (const entry of attestation.matrix) {
      if (!exactFields(entry, ['localeId', 'viewport', 'journey', 'status', 'failures', 'accessibility'])
        || !exactFields(entry.viewport, ['width', 'height'])
        || !exactFields(entry.failures, FAILURE_FIELDS)
        || !exactFields(entry.accessibility, ACCESSIBILITY_FIELDS)) return fail('MATRIX_INVALID');
      if (!expectedLocales.includes(entry.localeId)) return fail('MATRIX_LOCALE_NOT_ALLOWED');
      if (!Number.isInteger(entry.viewport.width) || entry.viewport.width <= 0
        || !Number.isInteger(entry.viewport.height) || entry.viewport.height <= 0
        || !JOURNEY_TYPES.has(entry.journey)
        || entry.status !== 'PASSED') return fail('MATRIX_INVALID');
      if (!expectedViewportKeys.has(viewportKey(entry.viewport))) return fail('MATRIX_VIEWPORT_NOT_ALLOWED');
      if (FAILURE_FIELDS.some((field) => !Number.isInteger(entry.failures[field]) || entry.failures[field] < 0)) {
        return fail('MATRIX_INVALID');
      }
      if (FAILURE_FIELDS.some((field) => entry.failures[field] !== 0)) return fail('MATRIX_FAILURES_RECORDED');
      if (entry.accessibility.engine !== LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE
        || typeof entry.accessibility.engineVersion !== 'string'
        || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(entry.accessibility.engineVersion)
        || !Array.isArray(entry.accessibility.rulesetTags)
        || !sameArray(entry.accessibility.rulesetTags, LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS)
        || !Array.isArray(entry.accessibility.surfaceChecks)
        || !Number.isInteger(entry.accessibility.violations)
        || entry.accessibility.violations < 0) {
        return fail('MATRIX_ACCESSIBILITY_INVALID');
      }
      const normalizedSurfaceChecks = normalizedAccessibilitySurfaceChecks(entry.accessibility.surfaceChecks);
      if (entry.accessibility.surfaceChecks.some((surfaceCheck) => (
        !exactFields(surfaceCheck, ACCESSIBILITY_SURFACE_CHECK_FIELDS)
        || !Object.hasOwn(ACCESSIBILITY_SURFACE_SNAPSHOT_COUNTS, surfaceCheck.surfaceId)
        || surfaceCheck.snapshotCount !== ACCESSIBILITY_SURFACE_SNAPSHOT_COUNTS[surfaceCheck.surfaceId]
        || !Number.isInteger(surfaceCheck.violations)
        || surfaceCheck.violations < 0
      )) || canonicalJson(entry.accessibility.surfaceChecks) !== canonicalJson(normalizedSurfaceChecks)) {
        return fail('MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID');
      }
      const checkedSurfaceIds = entry.accessibility.surfaceChecks.map((surfaceCheck) => surfaceCheck.surfaceId);
      const coreSurfaceCell = sameArray(checkedSurfaceIds, LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS);
      const deepSurfaceCell = sameArray(checkedSurfaceIds, LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS);
      if (!coreSurfaceCell && !deepSurfaceCell) return fail('MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID');
      if (entry.accessibility.surfaceChecks.some((surfaceCheck) => surfaceCheck.violations !== 0)) {
        return fail('MATRIX_ACCESSIBILITY_VIOLATIONS_RECORDED');
      }
      const surfaceViolationCount = entry.accessibility.surfaceChecks.reduce(
        (total, surfaceCheck) => total + surfaceCheck.violations,
        0,
      );
      if (entry.accessibility.violations !== 0) return fail('MATRIX_ACCESSIBILITY_VIOLATIONS_RECORDED');
      if (entry.accessibility.violations !== surfaceViolationCount) {
        return fail('MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID');
      }
      const cellId = `${entry.localeId}@${viewportKey(entry.viewport)}`;
      if (matrixCells.has(cellId)) return fail('MATRIX_CELL_DUPLICATED');
      matrixCells.set(cellId, entry);
      if (deepSurfaceCell) deepAccessibilityCells.get(entry.localeId).push(entry);
    }
    if (!sameArray(attestation.testedLocaleIds, uniqueSortedStrings(attestation.matrix.map((entry) => entry.localeId)))
      || !Array.isArray(attestation.testedViewports)
      || attestation.testedViewports.some((viewport) => !exactFields(viewport, ['width', 'height']))
      || !sameViewports(attestation.testedViewports, uniqueNormalizedViewports(attestation.matrix.map((entry) => entry.viewport)))) {
      return fail('MATRIX_DECLARATION_MISMATCH');
    }
    for (const localeId of expectedLocales) {
      for (const viewport of expectedViewports) {
        if (!matrixCells.has(`${localeId}@${viewportKey(viewport)}`)) return fail('REQUIRED_MATRIX_CELL_MISSING');
      }
      if (deepAccessibilityCells.get(localeId).length !== 1) {
        return fail('MATRIX_ACCESSIBILITY_DEEP_COVERAGE_INVALID');
      }
    }

    if (!Array.isArray(attestation.flowEvidence) || attestation.flowEvidence.length === 0) return fail('FLOW_EVIDENCE_INVALID');
    const allowedFlows = new Set(allowedFlowIds);
    if (allowedFlows.size === 0) return fail('FLOW_EXPECTATIONS_REQUIRED');
    const flowCells = new Set();
    const flowEntries = new Map();
    for (const entry of attestation.flowEvidence) {
      if (!exactFields(entry, ['flowId', 'localeId', 'status', 'viewports'])
        || !allowedFlows.has(entry.flowId)) return fail('FLOW_NOT_ALLOWED');
      const normalizedEntryViewports = normalizedViewports(entry.viewports || []);
      if (!expectedLocales.includes(entry.localeId)
        || entry.status !== 'PASSED'
        || !Array.isArray(entry.viewports)
        || entry.viewports.length === 0
        || entry.viewports.some((viewport) => !exactFields(viewport, ['width', 'height']))
        || !sameViewports(entry.viewports, normalizedEntryViewports)
        || new Set(entry.viewports.map(viewportKey)).size !== entry.viewports.length) return fail('FLOW_EVIDENCE_INVALID');
      if (entry.flowId === 'first-run-and-authoring'
        && !sameViewports(normalizedEntryViewports, expectedViewports)) {
        return fail('AUTHORING_FLOW_VIEWPORTS_INCOMPLETE');
      }
      const flowCellId = `${entry.flowId}@${entry.localeId}`;
      if (flowCells.has(flowCellId)) return fail('FLOW_EVIDENCE_DUPLICATED');
      flowCells.add(flowCellId);
      flowEntries.set(flowCellId, entry);
      for (const viewport of entry.viewports) {
        const matrixCell = matrixCells.get(`${entry.localeId}@${viewportKey(viewport)}`);
        if (!matrixCell) return fail('FLOW_MATRIX_CELL_MISSING');
        if (entry.flowId !== 'first-run-and-authoring' && matrixCell.journey !== 'FULL_JOURNEY') {
          return fail('FLOW_REQUIRES_FULL_JOURNEY');
        }
      }
    }
    if (expectedLocales.some((localeId) => !flowCells.has(`first-run-and-authoring@${localeId}`))) {
      return fail('AUTHORING_FLOW_EVIDENCE_REQUIRED');
    }

    if (!Array.isArray(attestation.methodCoverage)) return fail('METHOD_COVERAGE_INVALID');
    const methodFlowClaimed = expectedLocales.some((localeId) => flowCells.has(`${METHOD_FLOW_ID}@${localeId}`));
    if (!methodFlowClaimed) {
      if (attestation.methodCoverage.length !== 0) return fail('METHOD_COVERAGE_WITHOUT_FLOW');
    } else {
      if (expectedLocales.some((localeId) => !flowCells.has(`${METHOD_FLOW_ID}@${localeId}`))) {
        return fail('METHOD_FLOW_EVIDENCE_INCOMPLETE');
      }
      const expectedMethodIds = sortedStrings(LOCALIZATION_BROWSER_METHOD_IDS);
      const expectedResultKinds = sortedStrings(LOCALIZATION_BROWSER_METHOD_RESULT_KINDS);
      const coveredLocales = new Set();
      for (const entry of attestation.methodCoverage) {
        if (!exactFields(entry, METHOD_COVERAGE_FIELDS)) return fail('METHOD_COVERAGE_INVALID');
        if (!expectedLocales.includes(entry.localeId)) return fail('METHOD_COVERAGE_LOCALE_NOT_ALLOWED');
        if (coveredLocales.has(entry.localeId)) return fail('METHOD_COVERAGE_LOCALE_DUPLICATED');
        coveredLocales.add(entry.localeId);
        if (!Array.isArray(entry.methodIds) || !sameArray(entry.methodIds, expectedMethodIds)) {
          return fail('METHOD_COVERAGE_METHODS_INVALID');
        }
        if (!Array.isArray(entry.resultKinds) || !sameArray(entry.resultKinds, expectedResultKinds)) {
          return fail('METHOD_COVERAGE_RESULT_KINDS_INVALID');
        }
        if (entry.localizedAuthoringSurfaces !== LOCALIZATION_BROWSER_METHOD_IDS.length
          || entry.localizedResultSurfaces !== LOCALIZATION_BROWSER_METHOD_IDS.length
          || entry.localizedHandoffDrafts !== LOCALIZATION_BROWSER_METHOD_IDS.length
          || entry.methodSpecificReceiptDownloads !== LOCALIZATION_BROWSER_METHOD_IDS.length) {
          return fail('METHOD_COVERAGE_COUNTS_INVALID');
        }
        if (entry.observedHumanResponses !== false || entry.participantPanelConnected !== false) {
          return fail('METHOD_COVERAGE_HUMAN_BOUNDARY_INVALID');
        }
      }
      if (attestation.methodCoverage.length !== expectedLocales.length
        || expectedLocales.some((localeId) => !coveredLocales.has(localeId))) {
        return fail('METHOD_COVERAGE_LOCALES_INCOMPLETE');
      }
    }

    if (!Array.isArray(attestation.sampleCoverage) || attestation.sampleCoverage.length === 0) {
      return fail('SAMPLE_COVERAGE_INVALID');
    }
    if (canonicalJson(attestation.sampleCoverage) !== canonicalJson(normalizedSampleCoverage(attestation.sampleCoverage))) {
      return fail('SAMPLE_COVERAGE_INVALID');
    }
    const expectedSamplesByLocale = new Map(expectedSampleRequirements.map((entry) => [entry.localeId, entry.samples]));
    const coveredSampleLocales = new Set();
    for (const entry of attestation.sampleCoverage) {
      if (!exactFields(entry, SAMPLE_COVERAGE_FIELDS)
        || !exactFields(entry.viewport, ['width', 'height'])
        || !expectedLocales.includes(entry.localeId)
        || entry.status !== 'PASSED'
        || !Array.isArray(entry.samples)
        || entry.samples.length === 0) {
        return fail('SAMPLE_COVERAGE_INVALID');
      }
      if (coveredSampleLocales.has(entry.localeId)) return fail('SAMPLE_COVERAGE_LOCALE_DUPLICATED');
      coveredSampleLocales.add(entry.localeId);
      const matrixCell = matrixCells.get(`${entry.localeId}@${viewportKey(entry.viewport)}`);
      if (!matrixCell || matrixCell.journey !== 'FULL_JOURNEY') return fail('SAMPLE_COVERAGE_REQUIRES_FULL_JOURNEY');
      const deepAccessibilityCell = deepAccessibilityCells.get(entry.localeId)?.[0];
      if (!deepAccessibilityCell
        || viewportKey(deepAccessibilityCell.viewport) !== viewportKey(entry.viewport)) {
        return fail('SAMPLE_COVERAGE_ACCESSIBILITY_VIEWPORT_MISMATCH');
      }
      const sampleFlowEntry = flowEntries.get(`${SAMPLE_FLOW_ID}@${entry.localeId}`);
      if (!sampleFlowEntry
        || sampleFlowEntry.viewports.length !== 1
        || !sameViewports(sampleFlowEntry.viewports, [entry.viewport])) {
        return fail('SAMPLE_FLOW_EVIDENCE_MISMATCH');
      }

      const expectedSamples = expectedSamplesByLocale.get(entry.localeId) || [];
      if (entry.samples.length !== expectedSamples.length) return fail('SAMPLE_COVERAGE_SAMPLES_MISMATCH');
      if (new Set(entry.samples.map((sample) => sample.stableId)).size !== entry.samples.length
        || new Set(entry.samples.map((sample) => sample.slug)).size !== entry.samples.length) {
        return fail('SAMPLE_COVERAGE_SAMPLE_DUPLICATED');
      }
      for (const [index, sample] of entry.samples.entries()) {
        if (!exactFields(sample, SAMPLE_FIELDS)
          || !exactFields(sample.quality, SAMPLE_QUALITY_FIELDS)
          || !exactFields(sample.checks, SAMPLE_CHECK_FIELDS)) return fail('SAMPLE_COVERAGE_INVALID');
        const expectedSample = expectedSamples[index];
        if (!expectedSample
          || sample.stableId !== expectedSample.stableId
          || sample.slug !== expectedSample.slug
          || sample.sampleSchemaVersion !== expectedSample.sampleSchemaVersion
          || canonicalJson(sample.quality) !== canonicalJson(expectedSample.quality)) {
          return fail('SAMPLE_COVERAGE_SAMPLES_MISMATCH');
        }
        if (canonicalJson(sample.checks) !== canonicalJson(expectedSampleChecks(expectedSample.quality))) {
          return fail('SAMPLE_COVERAGE_CHECKS_INVALID');
        }
      }
    }
    if (attestation.sampleCoverage.length !== expectedLocales.length
      || expectedLocales.some((localeId) => !coveredSampleLocales.has(localeId)
        || !flowCells.has(`${SAMPLE_FLOW_ID}@${localeId}`))) {
      return fail('SAMPLE_COVERAGE_LOCALES_INCOMPLETE');
    }

    const verifiedFlowIds = [...allowedFlows].filter(
      (flowId) => expectedLocales.every((localeId) => flowCells.has(`${flowId}@${localeId}`)),
    );
    return deepFreeze({
      ok: true,
      published: attestation.publication.status === 'PUBLISHED',
      code: null,
      verifiedFlowIds,
      value: structuredClone(attestation),
    });
  } catch {
    return fail('ATTESTATION_INVALID');
  }
}
