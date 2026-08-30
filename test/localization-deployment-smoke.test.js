import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  CJK_LOCALE_IDS,
  LOCALIZATION_REGISTRY_VERSION,
  LOCALE_CAPABILITIES,
} from '../shared/localization.mjs';
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
} from '../server/localization-browser-attestation.js';
import {
  canonicalLocalizationBrowserPromotionJson,
  createLocalizationBrowserPromotionArtifact,
  derivePublishedLocalizationBrowserAttestation,
} from '../server/localization-browser-promotion.js';
import {
  buildLocalizationScorecard,
  LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
  LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
  LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
  LOCALIZATION_JOURNEY_FLOWS,
  LOCALIZATION_JOURNEY_GATE_VERSION,
} from '../server/localization-scorecard.js';
import {
  LocalizationDeploymentSmokeError,
  createLocalizationEvidenceResolver,
  runLocalizationDeploymentSmoke,
} from '../server/localization-deployment-smoke.js';
import { loadNativeReviewReleaseEvidence } from '../server/native-review-release-evidence-adapter.js';
import { ASEAN_NATIVE_REVIEW_PROGRAM } from '../server/native-review-evidence.js';
import { createNativeReviewReleaseFixture } from './helpers/native-review-release-fixture.js';

const FIXED_NOW = new Date('2026-08-30T12:00:00.000Z');
const TEST_BUILD_ID = 'localization-smoke-build-20260829';
const TEST_ARTIFACT_DIGEST = `sha256:${'b'.repeat(64)}`;
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

function publishedEvidenceFixture({
  evidenceHostname = 'evidence.example.com',
  artifactDigest = TEST_ARTIFACT_DIGEST,
} = {}) {
  const evidenceUrl = `https://${evidenceHostname}/localization/${artifactDigest.slice('sha256:'.length)}/attestation.json`;
  const ciAttestation = createLocalizationBrowserAttestation({
    suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    verifiedAt: '2026-08-29T12:00:00.000Z',
    build: {
      id: TEST_BUILD_ID,
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
  const attestation = derivePublishedLocalizationBrowserAttestation(ciAttestation, { publishedEvidenceUrl: evidenceUrl });
  const promotionRecordUrl = evidenceUrl.replace(/attestation\.json$/, 'promotion.json');
  const bundle = {
    ok: true,
    bundleDigest: `sha256:${'c'.repeat(64)}`,
    artifactDigest,
    evidenceId: ciAttestation.evidenceId,
    publicationStatus: 'CI_ARTIFACT',
    published: false,
  };
  const promotionArtifact = createLocalizationBrowserPromotionArtifact({
    ciAttestation,
    ciBundle: bundle,
    publishedAttestation: attestation,
    promotionRecordUrl,
    signerId: 'release-operator-01',
    signedAt: '2026-08-30T11:59:00.000Z',
  });
  const promotion = {
    artifact: promotionArtifact,
    signature: sign(null, Buffer.from(canonicalLocalizationBrowserPromotionJson(promotionArtifact)), promotionKeys.privateKey).toString('base64'),
  };
  return {
    ciAttestation,
    attestation,
    evidenceUrl,
    promotion,
    promotionRecordUrl,
    bundle,
    scorecard: buildLocalizationScorecard({
      journeyAttestation: attestation,
      journeyPromotion: promotion,
      trustedPromotionKeys,
      buildIdentity: { id: TEST_BUILD_ID, artifactDigest },
      now: FIXED_NOW,
    }),
  };
}

function exactEvidenceAuthority(fixture) {
  return {
    expectedEvidenceUrl: fixture.evidenceUrl,
    expectedPromotionUrl: fixture.promotionRecordUrl,
    createEvidenceResolver: () => createLocalizationEvidenceResolver({
      resolverFactory: () => ({
        resolve4: async () => ['93.184.216.34'],
        resolve6: async () => {
          throw Object.assign(new Error('no AAAA records'), { code: 'ENODATA' });
        },
        cancel() {},
      }),
    }),
  };
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function deployedArtifactFixture(files) {
  const entries = Object.entries(files)
    .map(([relativePath, value]) => ({ relativePath, bytes: Buffer.from(value) }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const aggregateDigest = createHash('sha256');
  for (const entry of entries) {
    aggregateDigest.update(`${Buffer.byteLength(entry.relativePath)}\0${entry.relativePath}\0${entry.bytes.length}\0`);
    aggregateDigest.update(entry.bytes);
  }
  return {
    manifest: {
      schemaVersion: 'browser-artifact-manifest-v1',
      artifactDigest: `sha256:${aggregateDigest.digest('hex')}`,
      files: entries.map((entry) => ({
        relativePath: entry.relativePath,
        byteLength: entry.bytes.length,
        contentDigest: `sha256:${createHash('sha256').update(entry.bytes).digest('hex')}`,
      })),
    },
    files: new Map(entries.map((entry) => [entry.relativePath, entry.bytes])),
  };
}

function htmlFor(localeId, {
  status = LOCALE_CAPABILITIES[localeId].release.nativeReview.statusByCapability.sample,
  authority = 'registry-declared',
  releaseEligible = false,
} = {}) {
  const locale = LOCALE_CAPABILITIES[localeId];
  return `<!doctype html><html lang="${locale.htmlLang}" dir="${locale.dir}"><body><span data-native-review-status="${status}" data-native-review-authority="${authority}" data-native-review-release-eligible="${releaseEligible}">review</span></body></html>`;
}

function fakeDeployment({
  scorecard = buildLocalizationScorecard(),
  mcpScorecard = scorecard,
  evidence = null,
  promotion = null,
  artifactManifest = null,
  artifactFiles = null,
  artifactRootBytes = null,
  staticReviewByLocale = {},
  statusByPath = {},
} = {}) {
  return async (input, options = {}) => {
    const url = new URL(input);
    const method = String(options.method || 'GET').toUpperCase();
    const forcedStatus = statusByPath[url.pathname];
    if (forcedStatus) return new Response('missing', { status: forcedStatus });
    if (url.pathname === '/api/localization-scorecard') {
      if (method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      return new Response(JSON.stringify({ ...scorecard, correlationId: 'loc_smoke_12345678' }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    if (url.pathname === '/api/mcp' && method === 'POST') {
      let requestPayload;
      try {
        requestPayload = JSON.parse(String(options.body || ''));
      } catch {
        return new Response('invalid request', { status: 400 });
      }
      if (requestPayload?.method !== 'resources/read'
        || requestPayload?.params?.uri !== 'likerts://localization/scorecard') {
        return new Response('unknown resource', { status: 404 });
      }
      const payload = {
        jsonrpc: '2.0',
        id: requestPayload.id,
        result: {
          contents: [{
            uri: 'likerts://localization/scorecard',
            mimeType: 'application/json',
            text: JSON.stringify(mcpScorecard),
          }],
        },
      };
      return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    if (evidence && url.href === evidence.publication.evidenceUrl) {
      return new Response(JSON.stringify(evidence), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    if (promotion && url.href === promotion.artifact.promotionRecordUrl) {
      return new Response(JSON.stringify(promotion), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    if (artifactManifest && evidence
      && url.href === new URL('artifact-manifest.json', evidence.publication.evidenceUrl).href) {
      return new Response(JSON.stringify(artifactManifest), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    if (artifactFiles && url.origin === 'https://candidate.example.test') {
      if (url.pathname === '/' && artifactFiles.has('index.html')) {
        return new Response(artifactRootBytes || artifactFiles.get('index.html'), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      let relativePath;
      try {
        relativePath = url.pathname.slice(1).split('/').map(decodeURIComponent).join('/');
      } catch {
        relativePath = null;
      }
      const bytes = artifactFiles.get(relativePath);
      if (artifactFiles.has(relativePath)) {
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
    }
    const localeId = CJK_LOCALE_IDS.find((candidate) => (
      url.pathname === `/${candidate.toLowerCase()}/studies/`
    ));
    if (localeId) {
      return new Response(htmlFor(localeId, staticReviewByLocale[localeId]), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('missing', { status: 404 });
  };
}

async function independentlyLoadedNativeReviewContext(fixture) {
  const fetchImpl = async (input) => {
    const url = String(input);
    const bytes = url === fixture.envelopeUrl
      ? fixture.envelopeBytes
      : url === fixture.packetUrl
        ? fixture.packetBytes
        : null;
    if (!bytes) throw new Error(`unexpected native authority URL: ${url}`);
    const response = new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  const pinned = pinnedHttpsDeployment(fetchImpl, {
    approvedAddressesByHostname: new Map([
      ['native-review.example.com', [{ address: '93.184.216.34', family: 4 }]],
    ]),
    ambientDnsByHostname: new Map([
      ['native-review.example.com', { address: '10.0.0.9', family: 4 }],
    ]),
  });
  return loadNativeReviewReleaseEvidence({
    reviewProgram: fixture.reviewProgram,
    sourceConfig: {
      [fixture.locale]: {
        envelopeUrl: fixture.envelopeUrl,
        packetUrl: fixture.packetUrl,
        expectedBindings: fixture.expectedBindings,
        allowedOrigin: fixture.allowedOrigin,
      },
    },
    trustedReviewerKeys: fixture.trustedReviewerKeys,
    createEvidenceResolver: () => ({
      resolve: pinned.resolveHostname,
      cancel() {},
    }),
    httpsRequestImpl: pinned.httpsRequestImpl,
    now: fixture.now,
  });
}

function pinnedHttpsDeployment(deployment, {
  approvedAddressesByHostname = new Map([
    ['evidence.example.com', [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]],
    ['candidate.example.test', [
      { address: '93.184.216.35', family: 4 },
      { address: '2606:4700:4700::100', family: 6 },
    ]],
  ]),
  connected = [],
  agentCleanup = [],
  lookupOptions = { all: true },
  ambientDnsByHostname = new Map([
    ['evidence.example.com', { address: '10.0.0.9', family: 4 }],
    ['candidate.example.test', { address: '10.0.0.10', family: 4 }],
  ]),
} = {}) {
  return {
    resolveHostname: async (hostname) => {
      const addresses = approvedAddressesByHostname.get(hostname);
      if (!addresses) {
        throw Object.assign(new Error(`unexpected hostname ${hostname}`), { code: 'ENOTFOUND' });
      }
      return addresses;
    },
    httpsRequestImpl: (url, options = {}, callback) => {
      const request = new EventEmitter();
      request.destroyed = false;
      request.setTimeout = () => request;
      request.destroy = (error) => {
        request.destroyed = true;
        if (error) queueMicrotask(() => request.emit('error', error));
        return request;
      };
      const originalAgentDestroy = options.agent?.destroy?.bind(options.agent);
      if (originalAgentDestroy) {
        options.agent.destroy = () => {
          agentCleanup.push({ url: url.href, hostname: options.hostname });
          return originalAgentDestroy();
        };
      }
      request.end = () => {
        queueMicrotask(() => {
          if (request.destroyed) return;
          const ambientDnsAddress = ambientDnsByHostname.get(options.hostname) || null;
          options.lookup(options.hostname, lookupOptions, async (lookupError, lookupResult, family) => {
            if (lookupError) {
              request.emit('error', lookupError);
              return;
            }
            const selected = Array.isArray(lookupResult)
              ? lookupResult[0]
              : { address: lookupResult, family };
            connected.push({
              url: url.href,
              hostname: options.hostname,
              servername: options.servername,
              address: selected.address,
              family: selected.family,
              ambientDnsAddress,
              lookupResult: Array.isArray(lookupResult) ? lookupResult : [selected],
            });
            try {
              const response = await deployment(url, {
                method: options.method,
                headers: options.headers,
              });
              const body = Buffer.from(await response.arrayBuffer());
              const nodeResponse = Readable.from(body);
              nodeResponse.statusCode = response.status;
              nodeResponse.headers = Object.fromEntries(response.headers);
              callback(nodeResponse);
            } catch (error) {
              request.emit('error', error);
            }
          });
        });
        return request;
      };
      return request;
    },
  };
}

test('deployment smoke accepts an honest pending scorecard and reports release blockers', async () => {
  const report = await runLocalizationDeploymentSmoke({
    baseUrl: 'https://candidate.example.test/',
    fetchImpl: fakeDeployment(),
  });

  assert.equal(report.contractStatus, 'PASSED');
  assert.equal(report.releaseReady, false);
  assert.equal(report.evidenceResolutionReceipt, null);
  assert.deepEqual(report.checkedLocaleIds, CJK_LOCALE_IDS);
  assert.equal(report.scorecardStatus, 'NOT_PUBLISHED');
  assert.equal(report.mcpScorecardParity, 'NOT_CHECKED');
  assert.ok(report.releaseBlockers.includes('AUTOMATED_JOURNEY_ATTESTATION_NOT_PUBLISHED'));
  for (const localeId of CJK_LOCALE_IDS) {
    assert.ok(report.releaseBlockers.includes(`${localeId}:NATIVE_REVIEW_REQUIRED`));
  }
});

test('deployment smoke projects independently loaded native evidence without promoting pending registry metadata', async () => {
  const fixture = createNativeReviewReleaseFixture();
  const nativeReviewEvidenceContext = await independentlyLoadedNativeReviewContext(fixture);
  const scorecard = buildLocalizationScorecard({ ...nativeReviewEvidenceContext, now: fixture.now });
  const loaderCalls = [];

  const report = await runLocalizationDeploymentSmoke({
    baseUrl: 'https://candidate.example.test/',
    fetchImpl: fakeDeployment({ scorecard }),
    nativeReviewEvidenceLoader(...args) {
      loaderCalls.push(args);
      return nativeReviewEvidenceContext;
    },
    now: fixture.now,
  });

  assert.deepEqual(loaderCalls, [[]]);
  assert.equal(report.releaseReady, false);
  const row = scorecard.locales.find((entry) => entry.locale === fixture.locale);
  assert.equal(row.nativeReview.status, 'review-pending');
  assert.ok(Object.values(row.nativeReview.evidenceStatusByCapability).every((status) => status === 'STALE_BINDING'));
  assert.ok(report.releaseBlockers.includes(`${fixture.locale}:NATIVE_REVIEW_REQUIRED`));
});

test('deployment smoke preserves an explicitly selected ASEAN native-review program while every ASEAN locale remains runtime-disabled', async () => {
  const fixture = createNativeReviewReleaseFixture({
    reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    locale: 'en-SG',
  });
  const nativeReviewEvidenceContext = await independentlyLoadedNativeReviewContext(fixture);
  const scorecard = buildLocalizationScorecard({ ...nativeReviewEvidenceContext, now: fixture.now });
  const report = await runLocalizationDeploymentSmoke({
    baseUrl: 'https://candidate.example.test/',
    fetchImpl: fakeDeployment({ scorecard }),
    nativeReviewEvidenceContext,
    now: fixture.now,
  });

  assert.equal(nativeReviewEvidenceContext.nativeReviewProgram, ASEAN_NATIVE_REVIEW_PROGRAM);
  assert.equal(report.releaseReady, false);
  const row = scorecard.locales.find((entry) => entry.locale === fixture.locale);
  assert.equal(row.runtimeCapabilityStatus, 'NOT_ENABLED');
  assert.equal(row.copyStatus, 'unsupported');
  assert.equal(row.nativeReview.reviewer, null);
});

test('deployment smoke rejects an ASEAN evidence context relabeled as the CJK program', async () => {
  const fixture = createNativeReviewReleaseFixture({
    reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    locale: 'en-SG',
  });
  const nativeReviewEvidenceContext = await independentlyLoadedNativeReviewContext(fixture);

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      nativeReviewEvidenceContext: {
        ...nativeReviewEvidenceContext,
        nativeReviewProgram: 'cjk-native-review',
      },
      now: fixture.now,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_NATIVE_REVIEW_CONTEXT_INVALID',
  );
});

test('deployment smoke rejects independently valid native bindings that do not match validated published browser evidence', async () => {
  const nativeFixture = createNativeReviewReleaseFixture();
  const nativeReviewEvidenceContext = await independentlyLoadedNativeReviewContext(nativeFixture);
  const browserFixture = publishedEvidenceFixture();
  const scorecard = buildLocalizationScorecard({
    journeyAttestation: browserFixture.attestation,
    journeyPromotion: browserFixture.promotion,
    trustedPromotionKeys,
    buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
    ...nativeReviewEvidenceContext,
    now: FIXED_NOW,
  });
  const row = scorecard.locales.find((entry) => entry.locale === nativeFixture.locale);
  assert.equal(row.nativeReview.status, 'review-pending');

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({
        scorecard,
        evidence: browserFixture.attestation,
        promotion: browserFixture.promotion,
      }),
      trustedPromotionKeys,
      nativeReviewEvidenceContext,
      ...exactEvidenceAuthority(browserFixture),
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_NATIVE_REVIEW_BROWSER_BINDING_MISMATCH'
      && error.details.localeId === nativeFixture.locale
      && error.details.bindingStatus === 'STALE_BINDING',
  );
});

test('deployment smoke rejects a native attestation URL mismatch even when the build ID matches', async () => {
  const browserFixture = publishedEvidenceFixture();
  const wrongAttestationUrl = browserFixture.evidenceUrl.replace(
    /attestation\.json$/,
    'superseded-attestation.json',
  );
  const nativeFixture = createNativeReviewReleaseFixture({
    buildId: TEST_BUILD_ID,
    browserGateEvidenceReference: wrongAttestationUrl,
  });
  const nativeReviewEvidenceContext = await independentlyLoadedNativeReviewContext(nativeFixture);
  const scorecard = buildLocalizationScorecard({
    journeyAttestation: browserFixture.attestation,
    journeyPromotion: browserFixture.promotion,
    trustedPromotionKeys,
    buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
    ...nativeReviewEvidenceContext,
    now: FIXED_NOW,
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({
        scorecard,
        evidence: browserFixture.attestation,
        promotion: browserFixture.promotion,
      }),
      trustedPromotionKeys,
      nativeReviewEvidenceContext,
      ...exactEvidenceAuthority(browserFixture),
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_NATIVE_REVIEW_BROWSER_BINDING_MISMATCH'
      && error.details.localeId === nativeFixture.locale
      && error.details.bindingStatus === 'STALE_BINDING',
  );
});

test('deployment smoke requires independent native authority for an effective native-review claim', async () => {
  const scorecard = structuredClone(buildLocalizationScorecard());
  const row = scorecard.locales.find((entry) => entry.locale === 'ja-JP');
  row.nativeReview.status = 'native-reviewed';
  row.nativeReview.evidenceId = `sha256:${'d'.repeat(64)}`;

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({ scorecard }),
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_NATIVE_REVIEW_AUTHORITY_REQUIRED',
  );
});

test('deployment smoke fails closed when the scorecard route is missing', async () => {
  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({ statusByPath: { '/api/localization-scorecard': 404 } }),
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_HTTP_STATUS',
  );
});

test('deployment smoke rejects scorecards that overstate attitudinal accuracy', async () => {
  const scorecard = structuredClone(buildLocalizationScorecard());
  scorecard.locales.find((entry) => entry.locale === 'ja-JP').accuracyClaimPermitted = true;

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({ scorecard }),
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SCORECARD_REGISTRY_DRIFT',
  );
});

test('deployment smoke rejects capability, review-scope, and ASEAN market overclaims', async () => {
  for (const mutate of [
    (scorecard) => { scorecard.locales.find((entry) => entry.locale === 'zh-CN').capabilityDetails.ui.releaseEligible = true; },
    (scorecard) => { scorecard.locales.find((entry) => entry.locale === 'ko-KR').nativeReview.capabilityScope = ['ui']; },
    (scorecard) => { scorecard.markets.find((entry) => entry.marketId === 'SG').supportMode = 'MARKET_AND_ONE_OR_MORE_LOCALES'; },
    (scorecard) => { scorecard.markets.find((entry) => entry.marketId === 'ID').rolloutStatus = 'enabled'; },
  ]) {
    const scorecard = structuredClone(buildLocalizationScorecard());
    mutate(scorecard);
    await assert.rejects(
      runLocalizationDeploymentSmoke({
        baseUrl: 'https://candidate.example.test/',
        fetchImpl: fakeDeployment({ scorecard }),
      }),
      (error) => error instanceof LocalizationDeploymentSmokeError
        && [
          'LOCALIZATION_SMOKE_NATIVE_REVIEW_AUTHORITY_REQUIRED',
          'LOCALIZATION_SCORECARD_REGISTRY_DRIFT',
          'LOCALIZATION_SCORECARD_ASEAN_OVERCLAIM',
        ].includes(error.code),
    );
  }
});

test('deployment smoke fetches and validates both exact published evidence records', async () => {
  const fixture = publishedEvidenceFixture();
  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({
        scorecard: fixture.scorecard,
        promotion: fixture.promotion,
        statusByPath: { [new URL(fixture.evidenceUrl).pathname]: 404 },
      }),
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_HTTP_STATUS',
  );

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({ scorecard: fixture.scorecard, evidence: fixture.attestation }),
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_HTTP_STATUS',
  );

  const resolvedHostnames = [];
  const report = await runLocalizationDeploymentSmoke({
    baseUrl: 'https://candidate.example.test/',
    fetchImpl: fakeDeployment({ scorecard: fixture.scorecard, evidence: fixture.attestation, promotion: fixture.promotion }),
    trustedPromotionKeys,
    expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
    ...exactEvidenceAuthority(fixture),
    resolveHostname: async (hostname) => {
      resolvedHostnames.push(hostname);
      return [{ address: '93.184.216.34', family: 4 }];
    },
    now: FIXED_NOW,
  });
  assert.equal(report.scorecardStatus, 'PUBLISHED');
  assert.deepEqual(resolvedHostnames, ['evidence.example.com']);
  assert.deepEqual(report.evidenceResolutionReceipt, {
    authorityOrigin: 'https://evidence.example.com',
    hostname: 'evidence.example.com',
    addresses: [{ address: '93.184.216.34', family: 4 }],
    evidenceUrl: fixture.evidenceUrl,
    promotionUrl: fixture.promotionRecordUrl,
    connectionPinned: false,
    trustBoundary: 'PRE_FETCH_DNS_VALIDATION_ONLY_CONNECTION_NOT_PINNED',
  });
});

test('deployment smoke pins published evidence fetches to prechecked public addresses and reports it honestly', async () => {
  const fixture = publishedEvidenceFixture();
  const deployment = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
  });
  const connected = [];
  const agentCleanup = [];
  const report = await runLocalizationDeploymentSmoke({
    baseUrl: 'https://candidate.example.test/',
    fetchImpl: deployment,
    trustedPromotionKeys,
    ...exactEvidenceAuthority(fixture),
    ...pinnedHttpsDeployment(deployment, { connected, agentCleanup }),
    now: FIXED_NOW,
  });

  assert.equal(report.scorecardStatus, 'PUBLISHED');
  assert.equal(report.evidenceResolutionReceipt.connectionPinned, true);
  assert.equal(
    report.evidenceResolutionReceipt.trustBoundary,
    'HTTPS_CONNECTION_PINNED_TO_PRECHECKED_PUBLIC_ADDRESSES',
  );
  assert.deepEqual(report.evidenceResolutionReceipt.addresses, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  assert.deepEqual(connected.map((entry) => entry.url), [
    fixture.evidenceUrl,
    fixture.promotionRecordUrl,
  ]);
  assert.ok(connected.every((entry) => entry.hostname === 'evidence.example.com'));
  assert.ok(connected.every((entry) => entry.servername === 'evidence.example.com'));
  assert.ok(connected.every((entry) => entry.lookupResult.length === 2));
  assert.ok(connected.every((entry) => !entry.lookupResult.some((address) => address.address.startsWith('10.'))));
  assert.equal(agentCleanup.length, connected.length);
});

test('release-required smoke pins evidence and artifact fetches without connecting to a private rebind', async () => {
  const artifact = deployedArtifactFixture({
    'index.html': '<!doctype html><main>matching artifact</main>\n',
    'assets/app.js': 'globalThis.__artifact = "matching";\n',
  });
  const fixture = publishedEvidenceFixture({ artifactDigest: artifact.manifest.artifactDigest });
  const deployment = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
    artifactManifest: artifact.manifest,
    artifactFiles: artifact.files,
  });
  const connected = [];

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: deployment,
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: artifact.manifest.artifactDigest },
      expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
      expectedBundleDigest: fixture.bundle.bundleDigest,
      ...exactEvidenceAuthority(fixture),
      ...pinnedHttpsDeployment(deployment, { connected }),
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_RELEASE_GATES_OPEN',
  );

  assert.deepEqual(connected.map((entry) => entry.url), [
    fixture.evidenceUrl,
    fixture.promotionRecordUrl,
    new URL('artifact-manifest.json', fixture.evidenceUrl).href,
    'https://candidate.example.test/assets/app.js',
    'https://candidate.example.test/index.html',
    'https://candidate.example.test/',
  ]);
  assert.ok(connected.every((entry) => entry.ambientDnsAddress?.address.startsWith('10.')));
  assert.equal(connected.some((entry) => entry.address === entry.ambientDnsAddress?.address), false);
  assert.equal(connected.some((entry) => entry.address.startsWith('10.')), false);
  assert.ok(connected.every((entry) => (
    entry.lookupResult.some((address) => address.family === 4)
    && entry.lookupResult.some((address) => address.family === 6)
  )));
  assert.deepEqual(
    [...new Set(connected.map((entry) => `${entry.hostname}:${entry.servername}`))].sort(),
    [
      'candidate.example.test:candidate.example.test',
      'evidence.example.com:evidence.example.com',
    ],
  );
});

test('release-required smoke fails closed when custom fetches cannot establish pinned HTTPS transport', async () => {
  const artifact = deployedArtifactFixture({ 'index.html': '<!doctype html><main>artifact</main>\n' });
  const fixture = publishedEvidenceFixture({ artifactDigest: artifact.manifest.artifactDigest });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({
        scorecard: fixture.scorecard,
        evidence: fixture.attestation,
        promotion: fixture.promotion,
        artifactManifest: artifact.manifest,
        artifactFiles: artifact.files,
      }),
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: artifact.manifest.artifactDigest },
      expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
      expectedBundleDigest: fixture.bundle.bundleDigest,
      ...exactEvidenceAuthority(fixture),
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_PINNED_TRANSPORT_REQUIRED',
  );
});

test('published-evidence diagnostics require independently configured exact fetch authority', async () => {
  const fixture = publishedEvidenceFixture();
  const requestedUrls = [];
  const deploymentFetch = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options) => {
        requestedUrls.push(new URL(input).href);
        return deploymentFetch(input, options);
      },
      trustedPromotionKeys,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_AUTHORITY_REQUIRED',
  );
  assert.deepEqual(requestedUrls, [
    'https://candidate.example.test/api/localization-scorecard',
    'https://candidate.example.test/api/localization-scorecard',
  ]);
});

test('deployment smoke never follows scorecard evidence URLs targeting a private or link-local host', async () => {
  const fixture = publishedEvidenceFixture();
  const scorecard = structuredClone(fixture.scorecard);
  const artifactPath = `/localization/${TEST_ARTIFACT_DIGEST.slice('sha256:'.length)}`;
  scorecard.automatedJourneyVerification.evidenceUrl = `https://169.254.169.254${artifactPath}/attestation.json`;
  scorecard.automatedJourneyVerification.promotionRecordUrl = `https://169.254.169.254${artifactPath}/promotion.json`;
  const requestedUrls = [];
  const deploymentFetch = fakeDeployment({ scorecard });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options) => {
        requestedUrls.push(new URL(input).href);
        return deploymentFetch(input, options);
      },
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_URL_UNSAFE',
  );
  assert.equal(requestedUrls.some((url) => url.includes('169.254.169.254')), false);
});

test('deployment smoke rejects an unexpected public evidence origin before fetching it', async () => {
  const fixture = publishedEvidenceFixture();
  const scorecard = structuredClone(fixture.scorecard);
  const artifactPath = `/localization/${TEST_ARTIFACT_DIGEST.slice('sha256:'.length)}`;
  scorecard.automatedJourneyVerification.evidenceUrl = `https://unexpected.example.com${artifactPath}/attestation.json`;
  scorecard.automatedJourneyVerification.promotionRecordUrl = `https://unexpected.example.com${artifactPath}/promotion.json`;
  const requestedUrls = [];
  const deploymentFetch = fakeDeployment({ scorecard });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options) => {
        requestedUrls.push(new URL(input).href);
        return deploymentFetch(input, options);
      },
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_URL_MISMATCH',
  );
  assert.equal(requestedUrls.some((url) => url.includes('unexpected.example.com')), false);
});

test('deployment smoke rejects an evidence redirect without following its unsafe location', async () => {
  const fixture = publishedEvidenceFixture();
  const requestedUrls = [];
  const redirectModes = [];
  let redirectSignal = null;
  let redirectBodyCancelled = false;
  const deploymentFetch = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
  });
  const unsafeRedirect = 'https://169.254.169.254/latest/meta-data/';

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options = {}) => {
        const url = new URL(input);
        requestedUrls.push(url.href);
        redirectModes.push(options.redirect);
        if (url.href === fixture.evidenceUrl) {
          redirectSignal = options.signal || null;
          return new Response(new ReadableStream({
            pull() {
              return new Promise(() => {});
            },
            cancel() {
              redirectBodyCancelled = true;
            },
          }), {
            status: 302,
            headers: { location: unsafeRedirect },
          });
        }
        return deploymentFetch(input, options);
      },
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_HTTP_STATUS'
      && error.details.status === 302,
  );
  assert.equal(requestedUrls.includes(unsafeRedirect), false);
  assert.ok(redirectModes.length > 0 && redirectModes.every((mode) => mode === 'manual'));
  assert.equal(redirectSignal?.aborted, true);
  assert.equal(redirectBodyCancelled, true);
});

test('deployment smoke aborts and cancels a never-ending wrong-content-type response', async () => {
  const deploymentFetch = fakeDeployment();
  let responseSignal = null;
  let responseBodyCancelled = false;

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options = {}) => {
        const url = new URL(input);
        if (url.pathname === '/api/localization-scorecard'
          && String(options.method || 'GET').toUpperCase() === 'GET') {
          responseSignal = options.signal || null;
          return new Response(new ReadableStream({
            pull() {
              return new Promise(() => {});
            },
            cancel() {
              responseBodyCancelled = true;
            },
          }), {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          });
        }
        return deploymentFetch(input, options);
      },
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_CONTENT_TYPE',
  );
  assert.equal(responseSignal?.aborted, true);
  assert.equal(responseBodyCancelled, true);
});

test('deployment smoke rejects an evidence hostname that resolves to link-local before fetching artifacts', async () => {
  const fixture = publishedEvidenceFixture({ evidenceHostname: '169.254.169.254.nip.io' });
  const requestedUrls = [];
  const deploymentFetch = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options) => {
        requestedUrls.push(new URL(input).href);
        return deploymentFetch(input, options);
      },
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      resolveHostname: async (hostname) => {
        assert.equal(hostname, '169.254.169.254.nip.io');
        return [{ address: '169.254.169.254', family: 4 }];
      },
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_UNSAFE',
  );
  assert.deepEqual(requestedUrls, [
    'https://candidate.example.test/api/localization-scorecard',
    'https://candidate.example.test/api/localization-scorecard',
  ]);
});

test('deployment smoke rejects the whole evidence authority when any resolved address is non-global', async () => {
  const fixture = publishedEvidenceFixture({ evidenceHostname: 'localtest.me' });
  const requestedUrls = [];
  const deploymentFetch = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options) => {
        requestedUrls.push(new URL(input).href);
        return deploymentFetch(input, options);
      },
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      resolveHostname: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_UNSAFE'
      && error.details.address === '127.0.0.1',
  );
  assert.equal(requestedUrls.some((url) => url.includes('localtest.me')), false);
});

for (const specialAddress of [
  '2001::1',
  '2002::1',
  '3fff::1',
  '192.88.99.1',
]) {
  test(`deployment smoke rejects IANA special-use address ${specialAddress} before fetching artifacts`, async () => {
    const fixture = publishedEvidenceFixture({ evidenceHostname: 'special-address.example.com' });
    const requestedUrls = [];
    const deploymentFetch = fakeDeployment({
      scorecard: fixture.scorecard,
      evidence: fixture.attestation,
      promotion: fixture.promotion,
    });

    await assert.rejects(
      runLocalizationDeploymentSmoke({
        baseUrl: 'https://candidate.example.test/',
        fetchImpl: async (input, options) => {
          requestedUrls.push(new URL(input).href);
          return deploymentFetch(input, options);
        },
        trustedPromotionKeys,
        ...exactEvidenceAuthority(fixture),
        resolveHostname: async () => [{ address: specialAddress, family: specialAddress.includes(':') ? 6 : 4 }],
        now: FIXED_NOW,
      }),
      (error) => error instanceof LocalizationDeploymentSmokeError
        && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_UNSAFE'
        && error.details.address === specialAddress,
    );
    assert.deepEqual(requestedUrls, [
      'https://candidate.example.test/api/localization-scorecard',
      'https://candidate.example.test/api/localization-scorecard',
    ]);
  });
}

test('deployment smoke rejects a mixed global and IANA special-use resolver result before fetching artifacts', async () => {
  const fixture = publishedEvidenceFixture({ evidenceHostname: 'mixed-addresses.example.com' });
  const requestedUrls = [];
  const deploymentFetch = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options) => {
        requestedUrls.push(new URL(input).href);
        return deploymentFetch(input, options);
      },
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      resolveHostname: async () => [
        { address: '2606:4700:4700::1111', family: 6 },
        { address: '2002::1', family: 6 },
      ],
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_UNSAFE'
      && error.details.address === '2002::1',
  );
  assert.deepEqual(requestedUrls, [
    'https://candidate.example.test/api/localization-scorecard',
    'https://candidate.example.test/api/localization-scorecard',
  ]);
});

test('deployment smoke accepts a globally routable IPv6 evidence resolver result', async () => {
  const fixture = publishedEvidenceFixture({ evidenceHostname: 'global-ipv6.example.com' });
  const requestedUrls = [];
  const deploymentFetch = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
  });

  await runLocalizationDeploymentSmoke({
    baseUrl: 'https://candidate.example.test/',
    fetchImpl: async (input, options) => {
      requestedUrls.push(new URL(input).href);
      return deploymentFetch(input, options);
    },
    trustedPromotionKeys,
    ...exactEvidenceAuthority(fixture),
    resolveHostname: async () => [{ address: '2606:4700:4700::1111', family: 6 }],
    now: FIXED_NOW,
  });
  assert.equal(requestedUrls.some((url) => url.includes('global-ipv6.example.com')), true);
});

test('deployment smoke fails closed when published-evidence resolution is unavailable or invalid', async () => {
  const fixture = publishedEvidenceFixture();
  for (const [resolveHostname, expectedCode] of [
    [null, 'LOCALIZATION_SMOKE_EVIDENCE_RESOLVER_UNAVAILABLE'],
    [async () => [], 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_INVALID'],
    [async () => [{ address: 'not-an-address', family: 4 }], 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_INVALID'],
    [async () => { throw Object.assign(new Error('unavailable'), { code: 'ENOTFOUND' }); }, 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_FAILED'],
  ]) {
    await assert.rejects(
      runLocalizationDeploymentSmoke({
        baseUrl: 'https://candidate.example.test/',
        fetchImpl: fakeDeployment({
          scorecard: fixture.scorecard,
          evidence: fixture.attestation,
          promotion: fixture.promotion,
        }),
        trustedPromotionKeys,
        ...exactEvidenceAuthority(fixture),
        resolveHostname,
        now: FIXED_NOW,
      }),
      (error) => error instanceof LocalizationDeploymentSmokeError
        && error.code === expectedCode,
    );
  }
});

test('deployment smoke times out and aborts a stalled evidence-host resolution', async () => {
  const fixture = publishedEvidenceFixture();
  let observedSignal = null;

  await assert.rejects(
    Promise.race([
      runLocalizationDeploymentSmoke({
        baseUrl: 'https://candidate.example.test/',
        fetchImpl: fakeDeployment({
          scorecard: fixture.scorecard,
          evidence: fixture.attestation,
          promotion: fixture.promotion,
        }),
        trustedPromotionKeys,
        ...exactEvidenceAuthority(fixture),
        resolveHostname: async (_hostname, options = {}) => {
          observedSignal = options.signal || null;
          return new Promise((resolve, reject) => {
            observedSignal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            }, { once: true });
          });
        },
        fetchPolicy: { timeoutMs: 10 },
        now: FIXED_NOW,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('test guard timeout')), 100)),
    ]),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_TIMEOUT',
  );
  assert.equal(observedSignal?.aborted, true);
});

test('deployment smoke cancels its default resolver lifecycle when authority resolution times out', async () => {
  const fixture = publishedEvidenceFixture({ evidenceHostname: '93.184.216.34' });
  let cancelCalls = 0;
  let pendingQueries = 0;
  const rejectPending = [];

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({
        scorecard: fixture.scorecard,
        evidence: fixture.attestation,
        promotion: fixture.promotion,
      }),
      trustedPromotionKeys,
      expectedEvidenceUrl: fixture.evidenceUrl,
      expectedPromotionUrl: fixture.promotionRecordUrl,
      createEvidenceResolver: () => createLocalizationEvidenceResolver({
        resolverFactory: () => ({
          resolve4: async () => new Promise((resolve, reject) => {
            pendingQueries += 1;
            rejectPending.push(reject);
          }),
          resolve6: async () => new Promise((resolve, reject) => {
            pendingQueries += 1;
            rejectPending.push(reject);
          }),
          cancel: () => {
            cancelCalls += 1;
            pendingQueries = 0;
            for (const reject of rejectPending) {
              reject(Object.assign(new Error('cancelled'), { code: 'ECANCELLED' }));
            }
          },
        }),
      }),
      fetchPolicy: { timeoutMs: 10 },
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_RESOLUTION_TIMEOUT',
  );
  assert.equal(cancelCalls, 1);
  assert.equal(pendingQueries, 0);
});

test('default evidence resolution accepts a valid result from either DNS family', async () => {
  let cancelCalls = 0;
  const resolver = createLocalizationEvidenceResolver({
    resolverFactory: () => ({
      resolve4: async () => {
        throw Object.assign(new Error('no IPv4 records'), { code: 'ENODATA' });
      },
      resolve6: async () => ['2606:4700:4700::1111'],
      cancel() {
        cancelCalls += 1;
      },
    }),
  });

  assert.deepEqual(await resolver.resolve('evidence.example.com'), [
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  resolver.cancel();
  assert.equal(cancelCalls, 1);
});

test('default evidence resolution fails closed when either DNS family has an unexpected failure', async () => {
  const resolver = createLocalizationEvidenceResolver({
    resolverFactory: () => ({
      resolve4: async () => {
        throw Object.assign(new Error('IPv4 resolver unavailable'), { code: 'ESERVFAIL' });
      },
      resolve6: async () => ['2606:4700:4700::1111'],
      cancel() {},
    }),
  });

  await assert.rejects(
    resolver.resolve('evidence.example.com'),
    (error) => error?.code === 'ESERVFAIL',
  );
});

test('deployment smoke aborts a fetch that exceeds the injected timeout', async () => {
  let observedSignal = null;
  const fetchImpl = async (_input, options = {}) => {
    observedSignal = options.signal || null;
    if (!observedSignal) throw new Error('Abort signal was not supplied');
    return new Promise((resolve, reject) => {
      observedSignal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl,
      fetchPolicy: { timeoutMs: 10 },
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_FETCH_TIMEOUT',
  );
  assert.equal(observedSignal?.aborted, true);
});

test('deployment smoke aborts and cancels a response body that stalls after headers', async () => {
  const deploymentFetch = fakeDeployment();
  let observedSignal = null;
  let streamCancelled = false;
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname === '/api/localization-scorecard'
      && String(options.method || 'GET').toUpperCase() === 'GET') {
      observedSignal = options.signal || null;
      return new Response(new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          streamCancelled = true;
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return deploymentFetch(input, options);
  };

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl,
      fetchPolicy: { timeoutMs: 10 },
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_FETCH_TIMEOUT',
  );
  assert.equal(observedSignal?.aborted, true);
  assert.equal(streamCancelled, true);
});

test('deployment smoke rejects an oversized scorecard before JSON parsing', async () => {
  const scorecardBody = JSON.stringify({
    ...buildLocalizationScorecard(),
    correlationId: 'loc_smoke_12345678',
  });
  const maxJsonBytes = byteLength(scorecardBody);
  const deploymentFetch = fakeDeployment();
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname === '/api/localization-scorecard'
      && String(options.method || 'GET').toUpperCase() === 'GET') {
      return new Response(`${scorecardBody} `, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return deploymentFetch(input, options);
  };

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl,
      fetchPolicy: { maxJsonBytes },
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_BODY_TOO_LARGE'
      && error.details.resourceType === 'json',
  );
});

test('deployment smoke rejects oversized published evidence before JSON parsing', async () => {
  const fixture = publishedEvidenceFixture();
  const scorecardBody = JSON.stringify({ ...fixture.scorecard, correlationId: 'loc_smoke_12345678' });
  const evidenceBody = JSON.stringify(fixture.attestation);
  const promotionBody = JSON.stringify(fixture.promotion);
  const maxJsonBytes = Math.max(
    byteLength(scorecardBody),
    byteLength(evidenceBody),
    byteLength(promotionBody),
  );
  const oversizedEvidenceBody = `${evidenceBody}${' '.repeat(maxJsonBytes - byteLength(evidenceBody) + 1)}`;
  const deploymentFetch = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
  });
  const fetchImpl = async (input, options) => {
    if (new URL(input).href === fixture.evidenceUrl) {
      return new Response(oversizedEvidenceBody, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return deploymentFetch(input, options);
  };

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl,
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      fetchPolicy: { maxJsonBytes },
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_BODY_TOO_LARGE'
      && error.details.resourceType === 'json',
  );
});

test('deployment smoke rejects an oversized promotion before JSON parsing', async () => {
  const fixture = publishedEvidenceFixture();
  const scorecardBody = JSON.stringify({ ...fixture.scorecard, correlationId: 'loc_smoke_12345678' });
  const evidenceBody = JSON.stringify(fixture.attestation);
  const promotionBody = JSON.stringify(fixture.promotion);
  const maxJsonBytes = Math.max(
    byteLength(scorecardBody),
    byteLength(evidenceBody),
    byteLength(promotionBody),
  );
  const oversizedPromotionBody = `${promotionBody}${' '.repeat(maxJsonBytes - byteLength(promotionBody) + 1)}`;
  const deploymentFetch = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
  });
  const fetchImpl = async (input, options) => {
    if (new URL(input).href === fixture.promotionRecordUrl) {
      return new Response(oversizedPromotionBody, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return deploymentFetch(input, options);
  };

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl,
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      fetchPolicy: { maxJsonBytes },
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_BODY_TOO_LARGE'
      && error.details.resourceType === 'json',
  );
});

test('deployment smoke rejects oversized static HTML before inspecting markup', async () => {
  const maxHtmlBytes = Math.max(...CJK_LOCALE_IDS.map((localeId) => byteLength(htmlFor(localeId))));
  const oversizedHtml = `${htmlFor('zh-CN')}${' '.repeat(maxHtmlBytes - byteLength(htmlFor('zh-CN')) + 1)}`;
  const deploymentFetch = fakeDeployment();
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    if (url.pathname === '/zh-cn/studies/') {
      return new Response(oversizedHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return deploymentFetch(input, options);
  };

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl,
      fetchPolicy: { maxHtmlBytes },
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_BODY_TOO_LARGE'
      && error.details.resourceType === 'html',
  );
});

test('deployment smoke rejects a promotion that is not signed by a trusted configured key', async () => {
  const fixture = publishedEvidenceFixture();
  const untrusted = structuredClone(fixture.promotion);
  untrusted.signature = `${untrusted.signature.slice(0, -4)}AAAA`;
  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({
        scorecard: fixture.scorecard,
        evidence: fixture.attestation,
        promotion: untrusted,
      }),
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_DEPLOYED_PROMOTION_INVALID',
  );
});

test('deployment smoke rejects stale or overstated published evidence metadata', async () => {
  const fixture = publishedEvidenceFixture();
  const overstated = structuredClone(fixture.scorecard);
  overstated.automatedJourneyVerification.evidenceScope.liveBackendValidated = true;
  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({ scorecard: overstated, evidence: fixture.attestation, promotion: fixture.promotion }),
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SCORECARD_EVIDENCE_INVALID',
  );

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({ scorecard: fixture.scorecard, evidence: fixture.attestation, promotion: fixture.promotion }),
      trustedPromotionKeys,
      ...exactEvidenceAuthority(fixture),
      now: new Date('2026-10-01T12:00:00.000Z'),
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SCORECARD_EVIDENCE_INVALID',
  );
});

test('deployment smoke rejects any evidence-bearing scorecard field that differs from the canonical attestation projection', async () => {
  const fixture = publishedEvidenceFixture();
  for (const mutate of [
    (scorecard) => { scorecard.locales.find((entry) => entry.locale === 'zh-CN').journeys[0].automatedEvidenceId = `sha256:${'c'.repeat(64)}`; },
    (scorecard) => { scorecard.locales.find((entry) => entry.locale === 'ja-JP').calibrationDate = '2026-08-29'; },
    (scorecard) => { scorecard.locales.find((entry) => entry.locale === 'ko-KR').knownLimitations.push('FABRICATED_LIMITATION'); },
  ]) {
    const scorecard = structuredClone(fixture.scorecard);
    mutate(scorecard);
    await assert.rejects(
      runLocalizationDeploymentSmoke({
        baseUrl: 'https://candidate.example.test/',
        fetchImpl: fakeDeployment({ scorecard, evidence: fixture.attestation, promotion: fixture.promotion }),
        trustedPromotionKeys,
        ...exactEvidenceAuthority(fixture),
        now: FIXED_NOW,
      }),
      (error) => error instanceof LocalizationDeploymentSmokeError
        && error.code === 'LOCALIZATION_SCORECARD_CANONICAL_MISMATCH',
    );
  }
});

test('deployment smoke rejects a CJK hub whose document language does not match the registry', async () => {
  const baseFetch = fakeDeployment();
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    if (url.pathname === '/zh-cn/studies/') {
      return new Response('<!doctype html><html lang="en-US"><body></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return baseFetch(input, options);
  };

  await assert.rejects(
    runLocalizationDeploymentSmoke({ baseUrl: 'https://candidate.example.test/', fetchImpl }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_STATIC_LANGUAGE_MISMATCH',
  );
});

test('deployment smoke allows insecure HTTP only for loopback diagnostics', async () => {
  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'http://candidate.example.test/',
      fetchImpl: fakeDeployment(),
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_BASE_URL_INVALID',
  );

  const local = await runLocalizationDeploymentSmoke({
    baseUrl: 'http://127.0.0.1:4173/',
    fetchImpl: fakeDeployment(),
  });
  assert.equal(local.contractStatus, 'PASSED');
});

test('release-required smoke rejects a deployed MCP scorecard that diverges from HTTP', async () => {
  const fixture = publishedEvidenceFixture();
  const divergentMcpScorecard = structuredClone(fixture.scorecard);
  divergentMcpScorecard.markets[0].englishLabel = 'Divergent MCP projection';
  const deployment = fakeDeployment({
    scorecard: fixture.scorecard,
    mcpScorecard: divergentMcpScorecard,
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: deployment,
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
      expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
      expectedBundleDigest: fixture.bundle.bundleDigest,
      ...exactEvidenceAuthority(fixture),
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_MCP_SCORECARD_MISMATCH',
  );
});

test('release-required smoke rejects evidence for artifact A when the deployment serves artifact B bytes', async () => {
  const artifactA = deployedArtifactFixture({
    'index.html': '<!doctype html><main>artifact A</main>\n',
    'assets/app.js': 'globalThis.__artifact = "A";\n',
  });
  const artifactB = deployedArtifactFixture({
    'index.html': '<!doctype html><main>artifact B</main>\n',
    'assets/app.js': 'globalThis.__artifact = "B";\n',
  });
  const fixture = publishedEvidenceFixture({ artifactDigest: artifactA.manifest.artifactDigest });
  const deployment = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
    artifactManifest: artifactA.manifest,
    artifactFiles: artifactB.files,
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: deployment,
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: artifactA.manifest.artifactDigest },
      expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
      expectedBundleDigest: fixture.bundle.bundleDigest,
      ...exactEvidenceAuthority(fixture),
      ...pinnedHttpsDeployment(deployment),
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_DEPLOYED_ARTIFACT_MISMATCH',
  );
});

test('release-required smoke binds the user-facing root alias to manifested index.html bytes', async () => {
  const artifact = deployedArtifactFixture({
    'index.html': '<!doctype html><main>manifested root</main>\n',
    'assets/app.js': 'globalThis.__artifact = "root";\n',
  });
  const fixture = publishedEvidenceFixture({ artifactDigest: artifact.manifest.artifactDigest });
  const deployment = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
    artifactManifest: artifact.manifest,
    artifactFiles: artifact.files,
    artifactRootBytes: Buffer.from('<!doctype html><main>different root</main>\n'),
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: deployment,
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: artifact.manifest.artifactDigest },
      expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
      expectedBundleDigest: fixture.bundle.bundleDigest,
      ...exactEvidenceAuthority(fixture),
      ...pinnedHttpsDeployment(deployment),
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_DEPLOYED_ARTIFACT_MISMATCH',
  );
});

test('release-required smoke bounds the number of manifested artifact fetches', async () => {
  const artifact = deployedArtifactFixture({
    'empty-a.txt': '',
    'empty-b.txt': '',
  });
  const fixture = publishedEvidenceFixture({ artifactDigest: artifact.manifest.artifactDigest });
  const requestedArtifactPaths = [];
  const deployment = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
    artifactManifest: artifact.manifest,
    artifactFiles: artifact.files,
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options) => {
        const url = new URL(input);
        const relativePath = url.pathname.slice(1).split('/').map(decodeURIComponent).join('/');
        if (url.origin === 'https://candidate.example.test' && artifact.files.has(relativePath)) {
          requestedArtifactPaths.push(url.pathname);
        }
        return deployment(input, options);
      },
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: artifact.manifest.artifactDigest },
      expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
      expectedBundleDigest: fixture.bundle.bundleDigest,
      ...exactEvidenceAuthority(fixture),
      ...pinnedHttpsDeployment(deployment),
      requireReleaseReady: true,
      fetchPolicy: { maxArtifactFiles: 1 },
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_DEPLOYED_ARTIFACT_LIMIT_EXCEEDED',
  );
  assert.deepEqual(requestedArtifactPaths, []);
});

test('release-required smoke rejects a malformed portable artifact manifest before fetching build files', async () => {
  const artifact = deployedArtifactFixture({ 'index.html': '<!doctype html><main>artifact</main>\n' });
  const fixture = publishedEvidenceFixture({ artifactDigest: artifact.manifest.artifactDigest });
  const malformedManifest = { ...artifact.manifest, unexpectedField: true };
  let artifactFileRequests = 0;
  const deployment = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
    artifactManifest: malformedManifest,
    artifactFiles: artifact.files,
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: async (input, options) => {
        if (new URL(input).pathname === '/index.html') artifactFileRequests += 1;
        return deployment(input, options);
      },
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: artifact.manifest.artifactDigest },
      expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
      expectedBundleDigest: fixture.bundle.bundleDigest,
      ...exactEvidenceAuthority(fixture),
      ...pinnedHttpsDeployment(deployment),
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_DEPLOYED_ARTIFACT_MANIFEST_INVALID',
  );
  assert.equal(artifactFileRequests, 0);
});

test('release-required smoke enforces per-file and aggregate artifact byte limits before fetching build files', async () => {
  const cases = [
    {
      files: { 'index.html': 'four' },
      fetchPolicy: { maxArtifactFileBytes: 3 },
    },
    {
      files: { 'a.txt': 'aa', 'b.txt': 'bb' },
      fetchPolicy: { maxArtifactFileBytes: 2, maxArtifactTotalBytes: 3 },
    },
  ];
  for (const { files, fetchPolicy } of cases) {
    const artifact = deployedArtifactFixture(files);
    const fixture = publishedEvidenceFixture({ artifactDigest: artifact.manifest.artifactDigest });
    let artifactFileRequests = 0;
    const deployment = fakeDeployment({
      scorecard: fixture.scorecard,
      evidence: fixture.attestation,
      promotion: fixture.promotion,
      artifactManifest: artifact.manifest,
      artifactFiles: artifact.files,
    });
    await assert.rejects(
      runLocalizationDeploymentSmoke({
        baseUrl: 'https://candidate.example.test/',
        fetchImpl: async (input, options) => {
          const url = new URL(input);
          const relativePath = url.pathname.slice(1).split('/').map(decodeURIComponent).join('/');
          if (url.origin === 'https://candidate.example.test' && artifact.files.has(relativePath)) {
            artifactFileRequests += 1;
          }
          return deployment(input, options);
        },
        trustedPromotionKeys,
        expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: artifact.manifest.artifactDigest },
        expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
        expectedBundleDigest: fixture.bundle.bundleDigest,
        ...exactEvidenceAuthority(fixture),
        ...pinnedHttpsDeployment(deployment),
        requireReleaseReady: true,
        fetchPolicy,
        now: FIXED_NOW,
      }),
      (error) => error instanceof LocalizationDeploymentSmokeError
        && error.code === 'LOCALIZATION_SMOKE_BODY_TOO_LARGE'
        && error.details.resourceType === 'artifact',
    );
    assert.equal(artifactFileRequests, 0);
  }
});

test('release-required smoke requires independent identities and matching deployed bytes reach the open release gates', async () => {
  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment(),
      requireReleaseReady: true,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EXPECTED_BUILD_REQUIRED',
  );

  const fixture = publishedEvidenceFixture();
  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({ scorecard: fixture.scorecard, evidence: fixture.attestation, promotion: fixture.promotion }),
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EXPECTED_BUILD_REQUIRED',
  );
  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: fakeDeployment({ scorecard: fixture.scorecard, evidence: fixture.attestation, promotion: fixture.promotion }),
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
      expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
      expectedBundleDigest: fixture.bundle.bundleDigest,
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_SMOKE_EVIDENCE_AUTHORITY_REQUIRED',
  );
  const matchingArtifact = deployedArtifactFixture({
    'index.html': '<!doctype html><main>matching artifact</main>\n',
    'assets/app.js': 'globalThis.__artifact = "matching";\n',
    'empty.txt': '',
  });
  const matchingFixture = publishedEvidenceFixture({
    artifactDigest: matchingArtifact.manifest.artifactDigest,
  });
  const connected = [];
  const matchingDeployment = fakeDeployment({
    scorecard: matchingFixture.scorecard,
    evidence: matchingFixture.attestation,
    promotion: matchingFixture.promotion,
    artifactManifest: matchingArtifact.manifest,
    artifactFiles: matchingArtifact.files,
  });
  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: matchingDeployment,
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: matchingArtifact.manifest.artifactDigest },
      expectedCiEvidenceId: matchingFixture.ciAttestation.evidenceId,
      expectedBundleDigest: matchingFixture.bundle.bundleDigest,
      ...exactEvidenceAuthority(matchingFixture),
      ...pinnedHttpsDeployment(matchingDeployment, { connected }),
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_RELEASE_GATES_OPEN'
      && error.details.releaseBlockers.length >= 3,
  );
  assert.deepEqual(
    connected
      .filter((entry) => new URL(entry.url).origin === 'https://candidate.example.test')
      .map((entry) => new URL(entry.url).pathname)
      .filter((path) => path !== '/'),
    ['/assets/app.js', '/empty.txt', '/index.html'],
  );
});

test('release-required smoke rejects a rendered static review badge that differs from the evidence-qualified sample status', async () => {
  const artifact = deployedArtifactFixture({
    'index.html': '<!doctype html><main>matching artifact</main>\n',
    'assets/app.js': 'globalThis.__artifact = "matching";\n',
  });
  const fixture = publishedEvidenceFixture({ artifactDigest: artifact.manifest.artifactDigest });
  const deployment = fakeDeployment({
    scorecard: fixture.scorecard,
    evidence: fixture.attestation,
    promotion: fixture.promotion,
    artifactManifest: artifact.manifest,
    artifactFiles: artifact.files,
    staticReviewByLocale: { 'ja-JP': { status: 'native-reviewed' } },
  });

  await assert.rejects(
    runLocalizationDeploymentSmoke({
      baseUrl: 'https://candidate.example.test/',
      fetchImpl: deployment,
      trustedPromotionKeys,
      expectedBuildIdentity: { id: TEST_BUILD_ID, artifactDigest: artifact.manifest.artifactDigest },
      expectedCiEvidenceId: fixture.ciAttestation.evidenceId,
      expectedBundleDigest: fixture.bundle.bundleDigest,
      ...exactEvidenceAuthority(fixture),
      ...pinnedHttpsDeployment(deployment),
      requireReleaseReady: true,
      now: FIXED_NOW,
    }),
    (error) => error instanceof LocalizationDeploymentSmokeError
      && error.code === 'LOCALIZATION_STATIC_NATIVE_REVIEW_SCORECARD_MISMATCH'
      && error.details.localeId === 'ja-JP'
      && error.details.scorecardStatus === 'review-pending',
  );
});

test('deployment smoke CLI requires an explicit target and never defaults to production', () => {
  const result = spawnSync(process.execPath, ['scripts/smoke-localization-deployment.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LIKERTS_DEPLOYMENT_URL: '' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LOCALIZATION_SMOKE_BASE_URL_INVALID/);
  assert.doesNotMatch(result.stdout, /likerts\.com/i);
});

test('package exposes the explicit read-only localization smoke command', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['localization:smoke'], 'node scripts/smoke-localization-deployment.mjs');
});
