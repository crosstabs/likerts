import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE,
  LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_DEEP_SURFACE_IDS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS,
  LOCALIZATION_BROWSER_API_MODE,
  LOCALIZATION_BROWSER_ATTESTED_FLOW_IDS,
  LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION,
  LOCALIZATION_BROWSER_EVIDENCE_MODE,
  LOCALIZATION_BROWSER_METHOD_IDS,
  LOCALIZATION_BROWSER_METHOD_RESULT_KINDS,
  LOCALIZATION_JOURNEY_GATE_VERSION,
  createLocalizationBrowserAttestation,
  validateLocalizationBrowserAttestation,
} from '../server/localization-browser-attestation.js';

const SUITE_ID = LOCALIZATION_JOURNEY_GATE_VERSION;
const REGISTRY_VERSION = 'localization-capabilities-v2';
const VERIFIED_AT = '2026-08-29T12:00:00.000Z';
const NOW = new Date('2026-08-30T12:00:00.000Z');
const BUILD_ID = '0123456789abcdef0123456789abcdef01234567';
const ARTIFACT_DIGEST = `sha256:${'a'.repeat(64)}`;
const LOCALES = ['zh-CN', 'ja-JP', 'ko-KR'];
const VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 375, height: 900 },
  { width: 768, height: 1000 },
  { width: 1440, height: 1000 },
];
const FLOW_IDS = [
  'first-run-and-authoring',
  'research-methods-and-instrument',
  'results-and-research-design',
  'evidence-and-retrieval',
  'population-frame-and-model-card',
  'stability-and-convergence',
  'qualitative-exploration',
  'exports-and-human-handoff',
  'samples-persistence-and-lineage',
];
const SAMPLE_FLOW_ID = 'samples-persistence-and-lineage';
const FULL_JOURNEY_WIDTH = { 'zh-CN': 320, 'ja-JP': 375, 'ko-KR': 768 };
const REQUIRED_SAMPLES_BY_LOCALE = [
  {
    localeId: 'zh-CN',
    samples: [{
      stableId: 'SS-ZH-CN-001',
      slug: 'smart-ev-data-controls-china',
      sampleSchemaVersion: '1.1',
      quality: { automatedQaStatus: 'passed', nativeReviewStatus: 'review-pending' },
    }],
  },
  {
    localeId: 'ja-JP',
    samples: [{
      stableId: 'SS-JA-JP-001',
      slug: 'mobile-checkin-business-hotels-japan',
      sampleSchemaVersion: '1.1',
      quality: { automatedQaStatus: 'passed', nativeReviewStatus: 'review-pending' },
    }],
  },
  {
    localeId: 'ko-KR',
    samples: [{
      stableId: 'SS-KO-KR-001',
      slug: 'ad-supported-ott-plan-south-korea',
      sampleSchemaVersion: '1.1',
      quality: { automatedQaStatus: 'passed', nativeReviewStatus: 'review-pending' },
    }],
  },
];

function surfaceChecks({ deep = false } = {}) {
  const surfaceIds = deep
    ? LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS
    : LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS;
  return surfaceIds.map((surfaceId) => ({
    surfaceId,
    snapshotCount: ['specialized-method-results', 'specialized-method-handoffs'].includes(surfaceId) ? 10 : 1,
    violations: 0,
  }));
}

function accessibility({ deep = false } = {}) {
  return {
    engine: LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE,
    engineVersion: '4.11.0',
    rulesetTags: [...LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS],
    surfaceChecks: surfaceChecks({ deep }),
    violations: 0,
  };
}

function matrix() {
  return LOCALES.flatMap((localeId) => VIEWPORTS.map((viewport) => ({
    localeId,
    viewport,
    journey: viewport.width === FULL_JOURNEY_WIDTH[localeId] ? 'FULL_JOURNEY' : 'AUTHORING_LAYOUT',
    status: 'PASSED',
    failures: {
      unmockedApiRequests: 0,
      externalRequests: 0,
      consoleErrors: 0,
      pageErrors: 0,
      failedResponses: 0,
      failedRequests: 0,
    },
    accessibility: accessibility({ deep: viewport.width === FULL_JOURNEY_WIDTH[localeId] }),
  })));
}

function flowEvidence() {
  return FLOW_IDS.flatMap((flowId) => LOCALES.map((localeId) => ({
    flowId,
    localeId,
    status: 'PASSED',
    viewports: flowId === 'first-run-and-authoring'
      ? VIEWPORTS
      : [VIEWPORTS.find((viewport) => viewport.width === FULL_JOURNEY_WIDTH[localeId])],
  })));
}

function methodCoverage() {
  return LOCALES.map((localeId) => ({
    localeId,
    methodIds: LOCALIZATION_BROWSER_METHOD_IDS,
    resultKinds: LOCALIZATION_BROWSER_METHOD_RESULT_KINDS,
    localizedAuthoringSurfaces: LOCALIZATION_BROWSER_METHOD_IDS.length,
    localizedResultSurfaces: LOCALIZATION_BROWSER_METHOD_IDS.length,
    localizedHandoffDrafts: LOCALIZATION_BROWSER_METHOD_IDS.length,
    methodSpecificReceiptDownloads: LOCALIZATION_BROWSER_METHOD_IDS.length,
    observedHumanResponses: false,
    participantPanelConnected: false,
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
  return REQUIRED_SAMPLES_BY_LOCALE.map(({ localeId, samples }) => ({
    localeId,
    viewport: VIEWPORTS.find((viewport) => viewport.width === FULL_JOURNEY_WIDTH[localeId]),
    status: 'PASSED',
    samples: samples.map((sample) => ({
      ...structuredClone(sample),
      checks: sampleChecks(sample.quality),
    })),
  }));
}

const fixtureBackedExecution = Object.freeze({
  evidenceMode: LOCALIZATION_BROWSER_EVIDENCE_MODE,
  apiMode: LOCALIZATION_BROWSER_API_MODE,
  externalNetworkAllowed: false,
  liveBackendValidated: false,
  liveModelValidated: false,
  observedHumanResponses: false,
  participantPanelConnected: false,
});

function input({
  publicationStatus = 'PUBLISHED',
  evidenceUrl,
  matrixEntries = matrix(),
  flows = flowEvidence(),
  methods = methodCoverage(),
  samples = sampleCoverage(),
  execution = fixtureBackedExecution,
} = {}) {
  return {
    suiteId: SUITE_ID,
    registryVersion: REGISTRY_VERSION,
    verifiedAt: VERIFIED_AT,
    build: {
      id: BUILD_ID,
      artifactDigest: ARTIFACT_DIGEST,
      candidateUrl: 'https://candidate.example.invalid/builds/0123456789abcdef0123456789abcdef01234567/',
    },
    publication: {
      status: publicationStatus,
      evidenceUrl: evidenceUrl === undefined
        ? `https://evidence.example.invalid/localization/${ARTIFACT_DIGEST.slice('sha256:'.length)}/attestation.json`
        : evidenceUrl,
    },
    execution,
    matrix: matrixEntries,
    flowEvidence: flows,
    methodCoverage: methods,
    sampleCoverage: samples,
  };
}

function expectations(overrides = {}) {
  return {
    suiteId: SUITE_ID,
    registryVersion: REGISTRY_VERSION,
    buildIdentity: { id: BUILD_ID, artifactDigest: ARTIFACT_DIGEST },
    requiredLocaleIds: LOCALES,
    requiredViewports: VIEWPORTS,
    requiredSamplesByLocale: REQUIRED_SAMPLES_BY_LOCALE,
    allowedFlowIds: FLOW_IDS,
    now: NOW,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function hashValidMutation(mutator) {
  const attestation = structuredClone(createLocalizationBrowserAttestation(input()));
  mutator(attestation);
  const { evidenceId: _evidenceId, ...payload } = attestation;
  attestation.evidenceId = `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
  return attestation;
}

test('a complete content-addressed attestation validates for its exact build and explicit flows', () => {
  const attestation = createLocalizationBrowserAttestation(input());
  const validation = validateLocalizationBrowserAttestation(attestation, expectations());

  assert.equal(attestation.schemaVersion, LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION);
  assert.match(attestation.evidenceId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(attestation), true);
  assert.equal(validation.ok, true);
  assert.equal(validation.published, true);
  assert.deepEqual(validation.verifiedFlowIds, FLOW_IDS);
  assert.deepEqual(LOCALIZATION_BROWSER_ATTESTED_FLOW_IDS, FLOW_IDS);
  assert.equal(validation.verifiedFlowIds.includes('research-methods-and-instrument'), true);
  assert.equal(validation.verifiedFlowIds.includes(SAMPLE_FLOW_ID), true);
  assert.deepEqual(attestation.execution, fixtureBackedExecution);
  assert.deepEqual(LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS, [
    'first-run',
    'study-authoring',
    'results-overview',
    'stability',
    'evidence-ledger',
    'population-frame',
    'qualitative-exploration',
    'research-design-and-human-handoff',
  ]);
  assert.deepEqual(LOCALIZATION_BROWSER_ACCESSIBILITY_DEEP_SURFACE_IDS, [
    'required-source-error',
    'specialized-method-results',
    'specialized-method-handoffs',
    'static-sample-detail',
    'restored-sample-project',
  ]);
  assert.deepEqual(LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS, [
    ...LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS,
    ...LOCALIZATION_BROWSER_ACCESSIBILITY_DEEP_SURFACE_IDS,
  ]);
  assert.deepEqual(attestation.testedViewports, VIEWPORTS);
  assert.deepEqual(attestation.methodCoverage.map((entry) => entry.localeId), [...LOCALES].sort());
  assert.ok(attestation.methodCoverage.every((entry) => entry.methodIds.length === 10 && entry.resultKinds.length === 6));
  assert.deepEqual(attestation.sampleCoverage.map((entry) => entry.localeId), [...LOCALES].sort());
  assert.ok(attestation.sampleCoverage.every((entry) => entry.samples.length === 1));
  for (const localeId of LOCALES) {
    const localeCells = attestation.matrix.filter((entry) => entry.localeId === localeId);
    const deepCells = localeCells.filter((entry) => (
      entry.accessibility.surfaceChecks.length === LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS.length
    ));
    assert.equal(deepCells.length, 1);
    assert.deepEqual(
      deepCells[0].viewport,
      attestation.sampleCoverage.find((entry) => entry.localeId === localeId).viewport,
    );
  }
});

test('surface receipts are normalized into canonical surface order before signing', () => {
  const canonical = createLocalizationBrowserAttestation(input());
  const reorderedMatrix = matrix().reverse().map((entry) => ({
    ...entry,
    accessibility: {
      ...entry.accessibility,
      rulesetTags: [...entry.accessibility.rulesetTags].reverse(),
      surfaceChecks: [...entry.accessibility.surfaceChecks].reverse(),
    },
  }));
  const reordered = createLocalizationBrowserAttestation(input({ matrixEntries: reorderedMatrix }));

  assert.deepEqual(reordered.matrix, canonical.matrix);
  assert.equal(reordered.evidenceId, canonical.evidenceId);
});

test('authoring flow evidence must cover every required viewport for every locale', () => {
  const incompleteAuthoring = flowEvidence().map((entry) => (
    entry.flowId === 'first-run-and-authoring'
      ? { ...entry, viewports: [entry.viewports[0]] }
      : entry
  ));
  const attestation = createLocalizationBrowserAttestation(input({ flows: incompleteAuthoring }));

  assert.equal(
    validateLocalizationBrowserAttestation(attestation, expectations()).code,
    'AUTHORING_FLOW_VIEWPORTS_INCOMPLETE',
  );
});

test('CI-only evidence is structurally valid but is not public scorecard evidence', () => {
  const attestation = createLocalizationBrowserAttestation(input({
    publicationStatus: 'CI_ARTIFACT',
    evidenceUrl: null,
  }));
  const validation = validateLocalizationBrowserAttestation(attestation, expectations());

  assert.equal(validation.ok, true);
  assert.equal(validation.published, false);
});

test('the browser runner refuses signed attestation output for a filtered locale diagnostic', () => {
  const outputPath = path.join(tmpdir(), `likerts-filtered-attestation-${process.pid}.json`);
  const result = spawnSync(process.execPath, ['scripts/verify-browser.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      VERIFY_BROWSER_LOCALES: 'zh-CN',
      LIKERTS_BROWSER_ATTESTATION_OUT: outputPath,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /complete 3-locale × 4-viewport matrix/);
  assert.equal(existsSync(outputPath), false);
});

test('matrix and nested sample tampering are rejected by the canonical evidence digest', () => {
  const attestation = structuredClone(createLocalizationBrowserAttestation(input()));
  attestation.matrix[0].failures.consoleErrors = 1;

  const validation = validateLocalizationBrowserAttestation(attestation, expectations());

  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'ATTESTATION_DIGEST_MISMATCH');

  const sampleAttestation = structuredClone(createLocalizationBrowserAttestation(input()));
  sampleAttestation.sampleCoverage[0].samples[0].checks.promptMatched = false;
  assert.equal(
    validateLocalizationBrowserAttestation(sampleAttestation, expectations()).code,
    'ATTESTATION_DIGEST_MISMATCH',
  );

  const accessibilityAttestation = structuredClone(createLocalizationBrowserAttestation(input()));
  accessibilityAttestation.matrix[0].accessibility.engineVersion = 'forged';
  assert.equal(
    validateLocalizationBrowserAttestation(accessibilityAttestation, expectations()).code,
    'ATTESTATION_DIGEST_MISMATCH',
  );
});

test('signed matrix cells require exact zero-violation axe WCAG evidence', () => {
  const cases = [
    {
      mutate(attestation) { delete attestation.matrix[0].accessibility; },
      code: 'MATRIX_INVALID',
    },
    {
      mutate(attestation) { attestation.matrix[0].accessibility.violations = 1; },
      code: 'MATRIX_ACCESSIBILITY_VIOLATIONS_RECORDED',
    },
    {
      mutate(attestation) { attestation.matrix[0].accessibility.rulesetTags = ['wcag2a']; },
      code: 'MATRIX_ACCESSIBILITY_INVALID',
    },
    {
      mutate(attestation) { attestation.matrix[0].accessibility.engine = 'unknown-engine'; },
      code: 'MATRIX_ACCESSIBILITY_INVALID',
    },
    {
      mutate(attestation) { attestation.matrix[0].accessibility.engineVersion = 'unknown'; },
      code: 'MATRIX_ACCESSIBILITY_INVALID',
    },
  ];

  for (const { mutate, code } of cases) {
    const attestation = hashValidMutation(mutate);
    assert.equal(validateLocalizationBrowserAttestation(attestation, expectations()).code, code);
  }
});

test('hash-valid surface receipt tampering fails closed', () => {
  const cases = [
    {
      label: 'missing core surface',
      mutate(attestation) { attestation.matrix[0].accessibility.surfaceChecks.splice(2, 1); },
      code: 'MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID',
    },
    {
      label: 'unknown surface',
      mutate(attestation) {
        attestation.matrix[0].accessibility.surfaceChecks.push({
          surfaceId: 'unscanned-dialog',
          snapshotCount: 1,
          violations: 0,
        });
      },
      code: 'MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID',
    },
    {
      label: 'duplicate surface',
      mutate(attestation) {
        attestation.matrix[0].accessibility.surfaceChecks.push(
          structuredClone(attestation.matrix[0].accessibility.surfaceChecks[0]),
        );
      },
      code: 'MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID',
    },
    {
      label: 'reordered signed surfaces',
      mutate(attestation) { attestation.matrix[0].accessibility.surfaceChecks.reverse(); },
      code: 'MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID',
    },
    {
      label: 'unexpected receipt field',
      mutate(attestation) { attestation.matrix[0].accessibility.surfaceChecks[0].selector = 'main'; },
      code: 'MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID',
    },
    {
      label: 'zero snapshots',
      mutate(attestation) { attestation.matrix[0].accessibility.surfaceChecks[0].snapshotCount = 0; },
      code: 'MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID',
    },
    {
      label: 'forged specialized-method snapshot count',
      mutate(attestation) {
        const deepCell = attestation.matrix.find((entry) => (
          entry.accessibility.surfaceChecks.some(({ surfaceId }) => surfaceId === 'specialized-method-results')
        ));
        deepCell.accessibility.surfaceChecks.find(
          ({ surfaceId }) => surfaceId === 'specialized-method-results',
        ).snapshotCount = 9;
      },
      code: 'MATRIX_ACCESSIBILITY_SURFACE_CHECKS_INVALID',
    },
    {
      label: 'surface violation hidden by zero aggregate',
      mutate(attestation) { attestation.matrix[0].accessibility.surfaceChecks[0].violations = 1; },
      code: 'MATRIX_ACCESSIBILITY_VIOLATIONS_RECORDED',
    },
  ];

  for (const { label, mutate, code } of cases) {
    assert.equal(
      validateLocalizationBrowserAttestation(hashValidMutation(mutate), expectations()).code,
      code,
      label,
    );
  }
});

test('deep surface receipts occur in exactly one sample-bound matrix cell per CJK locale', () => {
  const missingDeepCell = hashValidMutation((attestation) => {
    const deepCell = attestation.matrix.find((entry) => entry.localeId === 'zh-CN'
      && entry.accessibility.surfaceChecks.length === LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS.length);
    deepCell.accessibility.surfaceChecks = surfaceChecks();
  });
  assert.equal(
    validateLocalizationBrowserAttestation(missingDeepCell, expectations()).code,
    'MATRIX_ACCESSIBILITY_DEEP_COVERAGE_INVALID',
  );

  const duplicateDeepCell = hashValidMutation((attestation) => {
    const localeCells = attestation.matrix.filter((entry) => entry.localeId === 'ja-JP');
    const deepChecks = structuredClone(localeCells.find((entry) => (
      entry.accessibility.surfaceChecks.length === LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS.length
    )).accessibility.surfaceChecks);
    localeCells.find((entry) => (
      entry.accessibility.surfaceChecks.length === LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS.length
    )).accessibility.surfaceChecks = deepChecks;
  });
  assert.equal(
    validateLocalizationBrowserAttestation(duplicateDeepCell, expectations()).code,
    'MATRIX_ACCESSIBILITY_DEEP_COVERAGE_INVALID',
  );

  const movedOffSampleViewport = hashValidMutation((attestation) => {
    const localeCells = attestation.matrix.filter((entry) => entry.localeId === 'ko-KR');
    const deepCell = localeCells.find((entry) => (
      entry.accessibility.surfaceChecks.length === LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS.length
    ));
    const coreCell = localeCells.find((entry) => (
      entry.accessibility.surfaceChecks.length === LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS.length
    ));
    const deepChecks = deepCell.accessibility.surfaceChecks;
    deepCell.accessibility.surfaceChecks = coreCell.accessibility.surfaceChecks;
    coreCell.accessibility.surfaceChecks = deepChecks;
  });
  assert.equal(
    validateLocalizationBrowserAttestation(movedOffSampleViewport, expectations()).code,
    'SAMPLE_COVERAGE_ACCESSIBILITY_VIEWPORT_MISMATCH',
  );
});

test('the signed browser attestation is bound to the current derived localization catalog hash', () => {
  const attestation = createLocalizationBrowserAttestation(input());
  assert.match(attestation.catalogHash, /^sha256:[a-f0-9]{64}$/);

  const staleCatalog = hashValidMutation((candidate) => {
    candidate.catalogHash = `sha256:${'f'.repeat(64)}`;
  });
  assert.equal(
    validateLocalizationBrowserAttestation(staleCatalog, expectations()).code,
    'CATALOG_HASH_MISMATCH',
  );
});

test('a hash-valid attestation still fails when any required locale and viewport cell is absent', () => {
  const attestation = createLocalizationBrowserAttestation(input({ matrixEntries: matrix().slice(1) }));

  const validation = validateLocalizationBrowserAttestation(attestation, expectations());

  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'REQUIRED_MATRIX_CELL_MISSING');
});

test('the exact matrix contract rejects additional viewport pairs and wrong heights', () => {
  const attestation = createLocalizationBrowserAttestation(input({
    matrixEntries: [...matrix(), {
      localeId: 'zh-CN',
      viewport: { width: 1024, height: 900 },
      journey: 'AUTHORING_LAYOUT',
      status: 'PASSED',
      failures: {
        unmockedApiRequests: 0,
        externalRequests: 0,
        consoleErrors: 0,
        pageErrors: 0,
        failedResponses: 0,
        failedRequests: 0,
      },
      accessibility: accessibility(),
    }],
  }));

  const validation = validateLocalizationBrowserAttestation(attestation, expectations());

  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'MATRIX_VIEWPORT_NOT_ALLOWED');

  const wrongHeightEntries = matrix();
  wrongHeightEntries[0] = { ...wrongHeightEntries[0], viewport: { width: 320, height: 845 } };
  const wrongHeight = createLocalizationBrowserAttestation(input({ matrixEntries: wrongHeightEntries }));
  assert.equal(validateLocalizationBrowserAttestation(wrongHeight, expectations()).code, 'MATRIX_VIEWPORT_NOT_ALLOWED');
});

test('attestations fail closed for a different build, stale verification, or undeclared flow', () => {
  const attestation = createLocalizationBrowserAttestation(input());
  assert.equal(
    validateLocalizationBrowserAttestation(attestation, expectations({
      buildIdentity: { id: 'fedcba9876543210fedcba9876543210fedcba98', artifactDigest: ARTIFACT_DIGEST },
    })).code,
    'BUILD_ID_MISMATCH',
  );
  assert.equal(
    validateLocalizationBrowserAttestation(attestation, expectations({ now: new Date('2026-10-01T12:00:00.000Z') })).code,
    'VERIFICATION_STALE',
  );

  const unknownFlow = createLocalizationBrowserAttestation(input({
    flows: [...flowEvidence(), {
      flowId: 'unreviewed-browser-claim',
      localeId: 'zh-CN',
      status: 'PASSED',
      viewports: [{ width: 320, height: 844 }],
    }],
  }));
  assert.equal(validateLocalizationBrowserAttestation(unknownFlow, expectations()).code, 'FLOW_NOT_ALLOWED');
});

test('a published claim requires an HTTPS evidence URL ending exactly in the tested artifact attestation path', () => {
  const artifactHash = ARTIFACT_DIGEST.slice('sha256:'.length);
  const validUrl = `https://evidence.example.invalid/localization/${artifactHash}/attestation.json`;
  const invalidUrls = [
    ['mutable latest path', 'https://evidence.example.invalid/localization/latest/attestation.json'],
    ['hash before mutable tail', `https://evidence.example.invalid/localization/${artifactHash}/latest/attestation.json`],
    ['hash only in filename', `https://evidence.example.invalid/localization/attestation-${artifactHash}.json`],
    ['wrong filename', `https://evidence.example.invalid/localization/${artifactHash}/browser-attestation.json`],
    ['filename suffix', `https://evidence.example.invalid/localization/${artifactHash}/attestation.json.backup`],
    ['path after filename', `https://evidence.example.invalid/localization/${artifactHash}/attestation.json/download`],
    ['trailing slash', `https://evidence.example.invalid/localization/${artifactHash}/attestation.json/`],
    ['query string', `${validUrl}?download=1`],
    ['fragment', `${validUrl}#latest`],
    ['insecure protocol', `http://evidence.example.invalid/localization/${artifactHash}/attestation.json`],
  ];

  const validAttestation = createLocalizationBrowserAttestation(input({ evidenceUrl: validUrl }));
  assert.equal(validateLocalizationBrowserAttestation(validAttestation, expectations()).ok, true);

  for (const [label, evidenceUrl] of invalidUrls) {
    const attestation = createLocalizationBrowserAttestation(input({ evidenceUrl }));
    assert.equal(
      validateLocalizationBrowserAttestation(attestation, expectations()).code,
      'EVIDENCE_URL_NOT_IMMUTABLE',
      label,
    );
  }
});

test('fixture-backed execution scope rejects live, observed-human, and participant-panel overclaims', () => {
  for (const field of [
    'liveBackendValidated',
    'liveModelValidated',
    'observedHumanResponses',
    'participantPanelConnected',
  ]) {
    const invalidExecution = createLocalizationBrowserAttestation(input({
      execution: { ...fixtureBackedExecution, [field]: true },
    }));
    assert.equal(
      validateLocalizationBrowserAttestation(invalidExecution, expectations()).code,
      'EXECUTION_EVIDENCE_INVALID',
      field,
    );
  }

  const tampered = structuredClone(createLocalizationBrowserAttestation(input()));
  tampered.execution.liveBackendValidated = true;
  assert.equal(validateLocalizationBrowserAttestation(tampered, expectations()).code, 'ATTESTATION_DIGEST_MISMATCH');
});

test('sample coverage rejects missing, extra, and duplicate locale claims', () => {
  const validCoverage = sampleCoverage();
  const cases = [
    {
      label: 'missing locale',
      samples: validCoverage.slice(1),
      code: 'SAMPLE_COVERAGE_LOCALES_INCOMPLETE',
    },
    {
      label: 'extra locale',
      samples: [...validCoverage, { ...structuredClone(validCoverage[0]), localeId: 'en-US' }],
      code: 'SAMPLE_COVERAGE_INVALID',
    },
    {
      label: 'duplicate locale',
      samples: [...validCoverage, structuredClone(validCoverage[0])],
      code: 'SAMPLE_COVERAGE_LOCALE_DUPLICATED',
    },
  ];

  for (const { label, samples, code } of cases) {
    const attestation = createLocalizationBrowserAttestation(input({ samples }));
    assert.equal(validateLocalizationBrowserAttestation(attestation, expectations()).code, code, label);
  }
});

test('sample coverage rejects missing, extra, and duplicate sample claims', () => {
  const secondRequirement = {
    stableId: 'SS-ZH-CN-002',
    slug: 'test-only-second-zh-sample',
    sampleSchemaVersion: '1.1',
    quality: { automatedQaStatus: 'passed', nativeReviewStatus: 'review-pending' },
  };
  const requirementsWithSecondSample = structuredClone(REQUIRED_SAMPLES_BY_LOCALE);
  requirementsWithSecondSample.find((entry) => entry.localeId === 'zh-CN').samples.push(secondRequirement);

  const extraCoverage = sampleCoverage();
  extraCoverage.find((entry) => entry.localeId === 'zh-CN').samples.push({
    ...structuredClone(secondRequirement),
    checks: sampleChecks(secondRequirement.quality),
  });

  const duplicateCoverage = sampleCoverage();
  const duplicateLocale = duplicateCoverage.find((entry) => entry.localeId === 'zh-CN');
  duplicateLocale.samples.push(structuredClone(duplicateLocale.samples[0]));

  const cases = [
    {
      label: 'missing sample',
      attestation: createLocalizationBrowserAttestation(input()),
      expected: expectations({ requiredSamplesByLocale: requirementsWithSecondSample }),
      code: 'SAMPLE_COVERAGE_SAMPLES_MISMATCH',
    },
    {
      label: 'extra sample',
      attestation: createLocalizationBrowserAttestation(input({ samples: extraCoverage })),
      expected: expectations(),
      code: 'SAMPLE_COVERAGE_SAMPLES_MISMATCH',
    },
    {
      label: 'duplicate sample',
      attestation: createLocalizationBrowserAttestation(input({ samples: duplicateCoverage })),
      expected: expectations({ requiredSamplesByLocale: requirementsWithSecondSample }),
      code: 'SAMPLE_COVERAGE_SAMPLE_DUPLICATED',
    },
  ];

  for (const { label, attestation, expected, code } of cases) {
    assert.equal(validateLocalizationBrowserAttestation(attestation, expected).code, code, label);
  }
});

test('sample coverage rejects wrong identity, quality status, coverage status, and checks', () => {
  const wrongIdentityCoverage = sampleCoverage();
  wrongIdentityCoverage[0].samples[0].stableId = 'SS-ZH-CN-404';
  const wrongIdentity = createLocalizationBrowserAttestation(input({ samples: wrongIdentityCoverage }));
  assert.equal(
    validateLocalizationBrowserAttestation(wrongIdentity, expectations()).code,
    'SAMPLE_COVERAGE_SAMPLES_MISMATCH',
  );

  const wrongQualityCoverage = sampleCoverage();
  wrongQualityCoverage[0].samples[0].quality.automatedQaStatus = 'pending';
  const wrongQuality = createLocalizationBrowserAttestation(input({ samples: wrongQualityCoverage }));
  assert.equal(
    validateLocalizationBrowserAttestation(wrongQuality, expectations()).code,
    'SAMPLE_COVERAGE_SAMPLES_MISMATCH',
  );

  const wrongStatus = hashValidMutation((attestation) => {
    attestation.sampleCoverage[0].status = 'FAILED';
  });
  assert.equal(
    validateLocalizationBrowserAttestation(wrongStatus, expectations()).code,
    'SAMPLE_COVERAGE_INVALID',
  );

  const wrongChecksCoverage = sampleCoverage();
  wrongChecksCoverage[0].samples[0].checks.requestCanonicalLineageMatched = false;
  const wrongChecks = createLocalizationBrowserAttestation(input({ samples: wrongChecksCoverage }));
  assert.equal(
    validateLocalizationBrowserAttestation(wrongChecks, expectations()).code,
    'SAMPLE_COVERAGE_CHECKS_INVALID',
  );
});

test('sample coverage must match the signed sample-flow evidence for every locale', () => {
  const flows = flowEvidence().filter((entry) => !(
    entry.flowId === SAMPLE_FLOW_ID && entry.localeId === 'zh-CN'
  ));
  const attestation = createLocalizationBrowserAttestation(input({ flows }));

  assert.equal(
    validateLocalizationBrowserAttestation(attestation, expectations()).code,
    'SAMPLE_FLOW_EVIDENCE_MISMATCH',
  );
});

test('sample checks reject observed-human and participant-panel overclaims', () => {
  for (const field of ['observedHumanResponses', 'participantPanelConnected']) {
    const samples = sampleCoverage();
    samples[0].samples[0].checks[field] = true;
    const attestation = createLocalizationBrowserAttestation(input({ samples }));
    assert.equal(
      validateLocalizationBrowserAttestation(attestation, expectations()).code,
      'SAMPLE_COVERAGE_CHECKS_INVALID',
      field,
    );
  }
});

test('method-flow evidence requires the exact signed ten-method, six-result contract for every CJK locale', () => {
  const cases = [
    {
      methods: methodCoverage().slice(1),
      code: 'METHOD_COVERAGE_LOCALES_INCOMPLETE',
    },
    {
      methods: methodCoverage().map((entry, index) => index ? entry : { ...entry, localeId: 'en-US' }),
      code: 'METHOD_COVERAGE_LOCALE_NOT_ALLOWED',
    },
    {
      methods: methodCoverage().map((entry, index) => index ? entry : { ...entry, methodIds: entry.methodIds.slice(1) }),
      code: 'METHOD_COVERAGE_METHODS_INVALID',
    },
    {
      methods: methodCoverage().map((entry, index) => index ? entry : { ...entry, methodIds: [...entry.methodIds, 'GENERAL_LIKERT'] }),
      code: 'METHOD_COVERAGE_METHODS_INVALID',
    },
    {
      methods: methodCoverage().map((entry, index) => index ? entry : { ...entry, resultKinds: entry.resultKinds.slice(1) }),
      code: 'METHOD_COVERAGE_RESULT_KINDS_INVALID',
    },
    {
      methods: methodCoverage().map((entry, index) => index ? entry : { ...entry, resultKinds: [...entry.resultKinds, 'UNDECLARED_RESULT'] }),
      code: 'METHOD_COVERAGE_RESULT_KINDS_INVALID',
    },
    {
      methods: methodCoverage().map((entry, index) => index ? entry : { ...entry, localizedHandoffDrafts: 9 }),
      code: 'METHOD_COVERAGE_COUNTS_INVALID',
    },
    {
      methods: methodCoverage().map((entry, index) => index ? entry : { ...entry, observedHumanResponses: true }),
      code: 'METHOD_COVERAGE_HUMAN_BOUNDARY_INVALID',
    },
    {
      methods: methodCoverage().map((entry, index) => index ? entry : { ...entry, participantPanelConnected: true }),
      code: 'METHOD_COVERAGE_HUMAN_BOUNDARY_INVALID',
    },
  ];

  for (const { methods, code } of cases) {
    const attestation = createLocalizationBrowserAttestation(input({ methods }));
    assert.equal(validateLocalizationBrowserAttestation(attestation, expectations()).code, code);
  }

  const tampered = structuredClone(createLocalizationBrowserAttestation(input()));
  tampered.methodCoverage[0].methodIds.pop();
  assert.equal(validateLocalizationBrowserAttestation(tampered, expectations()).code, 'ATTESTATION_DIGEST_MISMATCH');
});

test('v1 through v4 schema and suite payloads fail closed instead of being reinterpreted as v5 evidence', () => {
  for (const version of ['v1', 'v2', 'v3', 'v4']) {
    const legacySchema = structuredClone(createLocalizationBrowserAttestation(input()));
    legacySchema.schemaVersion = `localization-browser-attestation-${version}`;
    assert.equal(
      validateLocalizationBrowserAttestation(legacySchema, expectations()).code,
      'ATTESTATION_SCHEMA_MISMATCH',
      version,
    );

    const legacySuite = structuredClone(createLocalizationBrowserAttestation(input()));
    legacySuite.suiteId = `localized-full-journey-browser-gate-${version}`;
    assert.equal(
      validateLocalizationBrowserAttestation(legacySuite, expectations()).code,
      'SUITE_ID_MISMATCH',
      version,
    );
  }
});
