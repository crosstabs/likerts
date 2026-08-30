import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  DEFAULT_LOCALIZATION_BROWSER_RELEASE_EVIDENCE_POLICY,
  LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV,
  LocalizationReleaseEvidenceError,
  createLocalizationReleaseEvidenceProvider,
  loadPublishedLocalizationBrowserEvidence,
  readLocalizationReleaseEvidenceConfig,
} from '../server/localization-release-evidence-provider.js';
import localizationScorecardHandler, { createRuntimeLocalizationScorecardHandler } from '../api/localization-scorecard.js';
import { createLocalizationBrowserReleaseFixture, TEST_BROWSER_NOW } from './helpers/localization-browser-release-fixture.js';
import { createNativeReviewReleaseFixture } from './helpers/native-review-release-fixture.js';
import { CURRENT_LOCALIZATION_CATALOG_HASH } from '../server/localization-catalog-hash.js';
import { ASEAN_NATIVE_REVIEW_PROGRAM } from '../server/native-review-evidence.js';
import {
  LOCALIZATION_CAPABILITY_STATUSES,
  LOCALIZATION_RELEASE_STATUSES,
  LOCALE_CAPABILITIES,
} from '../shared/localization.mjs';
import { buildLocalizationScorecardFromReleaseEvidence } from '../server/localization-scorecard-service.js';

const TEST_BUILD_ID = '0123456789abcdef0123456789abcdef01234567';
const TEST_ARTIFACT_DIGEST = `sha256:${'a'.repeat(64)}`;
const TEST_PACKET_DIGEST = `sha256:${'b'.repeat(64)}`;
const promotionKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
const reviewerKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });

function releaseEvidenceConfig() {
  const artifactHash = TEST_ARTIFACT_DIGEST.slice('sha256:'.length);
  const packetHash = TEST_PACKET_DIGEST.slice('sha256:'.length);
  const evidenceUrl = `https://evidence.example.com/localization/${artifactHash}/attestation.json`;
  return {
    schemaVersion: 'localization-release-evidence-source-v1',
    browser: {
      buildIdentity: { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST },
      attestationUrl: evidenceUrl,
      promotionUrl: `https://evidence.example.com/localization/${artifactHash}/promotion.json`,
      trustedPromotionKeys: { 'release-operator-01': promotionKey },
    },
    nativeReview: {
      sourceConfig: {
        'ja-JP': {
          envelopeUrl: `https://native-review.example.com/native/${packetHash}/envelope.json`,
          packetUrl: `https://native-review.example.com/native/${packetHash}/packet.json`,
          expectedBindings: {
            locale: 'ja-JP',
            catalogHash: CURRENT_LOCALIZATION_CATALOG_HASH,
            buildId: TEST_BUILD_ID,
            browserGateEvidenceReference: evidenceUrl,
            approvalReference: 'native-review/ja-jp/approval-2026-08-30',
            reviewedProductVersion: TEST_BUILD_ID,
            reviewedPromptVersion: 'prompts-2026.08.30',
            reviewPacketDigest: TEST_PACKET_DIGEST,
            reviewPacketReference: 'native-review/ja-jp/packet.json',
          },
        },
      },
      trustedReviewerKeys: {
        'cjk-reviewer-ja-jp': { publicKeyPem: reviewerKey, allowedLocales: ['ja-JP'] },
      },
    },
  };
}

function exactJsonResponse(bytes, url, init = {}) {
  const response = new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function pinnedHttpsSource(responseForUrl, {
  addresses = [{ address: '93.184.216.34', family: 4 }],
  connected = [],
} = {}) {
  return {
    createEvidenceResolver: () => ({
      resolve: async () => addresses,
      cancel() {},
    }),
    httpsRequestImpl(url, options, callback) {
      const request = new EventEmitter();
      let incoming = null;
      request.destroy = (error) => {
        incoming?.destroy?.(error);
        if (error) queueMicrotask(() => request.emit('error', error));
        return request;
      };
      request.end = () => {
        queueMicrotask(() => options.lookup(options.hostname, { all: true }, async (lookupError, lookupResult) => {
          if (lookupError) {
            request.emit('error', lookupError);
            return;
          }
          connected.push({
            url: url.href,
            hostname: options.hostname,
            servername: options.servername,
            addresses: lookupResult,
          });
          try {
            const response = await responseForUrl(url.href);
            if (response instanceof Response) {
              incoming = Readable.from(Buffer.from(await response.arrayBuffer()));
              incoming.statusCode = response.status;
              incoming.headers = Object.fromEntries(response.headers);
            } else {
              incoming = response;
            }
            incoming.once('end', () => request.emit('close'));
            callback(incoming);
          } catch (error) {
            request.emit('error', error);
          }
        }));
        return request;
      };
      return request;
    },
  };
}

function browserSourceConfig(fixture) {
  return {
    buildIdentity: fixture.buildIdentity,
    attestationUrl: fixture.evidenceUrl,
    promotionUrl: fixture.promotionRecordUrl,
    trustedPromotionKeys: fixture.trustedPromotionKeys,
  };
}

function releaseEvidenceConfigFor(browser, nativeReview) {
  return {
    schemaVersion: 'localization-release-evidence-source-v1',
    browser: browserSourceConfig(browser),
    nativeReview: {
      sourceConfig: {
        [nativeReview.locale]: {
          envelopeUrl: nativeReview.envelopeUrl,
          packetUrl: nativeReview.packetUrl,
          expectedBindings: nativeReview.expectedBindings,
          allowedOrigin: nativeReview.allowedOrigin,
        },
      },
      trustedReviewerKeys: nativeReview.trustedReviewerKeys,
    },
  };
}

function responseRecorder() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { this.body += value; return this; },
  };
}

test('release-evidence config is absent only when its server-only variable is unset', () => {
  assert.equal(LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV, 'LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON');
  assert.equal(readLocalizationReleaseEvidenceConfig({}), null);
});

test('release-evidence config rejects malformed, partial, and unknown values before network access', () => {
  for (const value of [
    '{',
    '[]',
    JSON.stringify({ schemaVersion: 'localization-release-evidence-source-v1' }),
    JSON.stringify({
      schemaVersion: 'localization-release-evidence-source-v1',
      browser: {},
      nativeReview: {},
      unexpected: true,
    }),
  ]) {
    assert.throws(
      () => readLocalizationReleaseEvidenceConfig({ [LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV]: value }),
      (error) => error instanceof LocalizationReleaseEvidenceError
        && error.code === 'LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID',
    );
  }

  const staleCatalogConfig = releaseEvidenceConfig();
  staleCatalogConfig.nativeReview.sourceConfig['ja-JP'].expectedBindings.catalogHash = `sha256:${'f'.repeat(64)}`;
  assert.throws(
    () => readLocalizationReleaseEvidenceConfig({
      [LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV]: JSON.stringify(staleCatalogConfig),
    }),
    (error) => error instanceof LocalizationReleaseEvidenceError
      && error.code === 'LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID',
  );

  const mutableEnvelopeConfig = releaseEvidenceConfig();
  mutableEnvelopeConfig.nativeReview.sourceConfig['ja-JP'].envelopeUrl = 'https://native-review.example.com/native/latest/envelope.json';
  assert.throws(
    () => readLocalizationReleaseEvidenceConfig({
      [LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV]: JSON.stringify(mutableEnvelopeConfig),
    }),
    (error) => error instanceof LocalizationReleaseEvidenceError
      && error.code === 'LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID',
  );
});

test('release-evidence config snapshots exact browser and native authority fields', () => {
  const parsed = readLocalizationReleaseEvidenceConfig({
    [LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV]: JSON.stringify(releaseEvidenceConfig()),
  });

  assert.deepEqual(parsed.browser.buildIdentity, { id: TEST_BUILD_ID, artifactDigest: TEST_ARTIFACT_DIGEST });
  assert.equal(parsed.browser.attestationUrl, releaseEvidenceConfig().browser.attestationUrl);
  assert.equal(parsed.browser.promotionUrl, releaseEvidenceConfig().browser.promotionUrl);
  assert.equal(parsed.nativeReview.sourceConfig['ja-JP'].expectedBindings.buildId, TEST_BUILD_ID);
  assert.equal(Object.isFrozen(parsed), true);
});

test('browser release loader fetches exact immutable bytes through a DNS-pinned HTTPS authority', async () => {
  const fixture = createLocalizationBrowserReleaseFixture();
  const calls = [];
  const transport = pinnedHttpsSource(async (url) => {
    calls.push(url);
    if (url === fixture.evidenceUrl) return exactJsonResponse(JSON.stringify(fixture.attestation), url);
    if (url === fixture.promotionRecordUrl) return exactJsonResponse(JSON.stringify(fixture.promotion), url);
    throw new Error(`unexpected URL: ${url}`);
  });

  const loaded = await loadPublishedLocalizationBrowserEvidence({
    browserConfig: browserSourceConfig(fixture),
    ...transport,
    now: TEST_BROWSER_NOW,
  });

  assert.deepEqual(calls, [fixture.evidenceUrl, fixture.promotionRecordUrl]);
  assert.deepEqual(loaded.journeyAttestation, fixture.attestation);
  assert.deepEqual(loaded.journeyPromotion, fixture.promotion);
  assert.deepEqual(loaded.trustedPromotionKeys, fixture.trustedPromotionKeys);
  assert.deepEqual(loaded.buildIdentity, fixture.buildIdentity);
  assert.equal(Object.isFrozen(loaded), true);
});

test('browser release loader rejects a mismatched signature before returning browser evidence', async () => {
  const fixture = createLocalizationBrowserReleaseFixture();
  const transport = pinnedHttpsSource(async (url) => {
    if (url === fixture.evidenceUrl) return exactJsonResponse(JSON.stringify(fixture.attestation), url);
    return exactJsonResponse(JSON.stringify({ ...fixture.promotion, signature: `${fixture.promotion.signature.slice(0, -4)}AAAA` }), url);
  });

  await assert.rejects(
    loadPublishedLocalizationBrowserEvidence({
      browserConfig: browserSourceConfig(fixture),
      ...transport,
      now: TEST_BROWSER_NOW,
    }),
    (error) => error instanceof LocalizationReleaseEvidenceError
      && error.code === 'LOCALIZATION_BROWSER_EVIDENCE_INVALID',
  );
});

test('browser release loader requires the configured build and immutable URLs to match the fetched records exactly', async () => {
  const fixture = createLocalizationBrowserReleaseFixture();
  const cases = [
    {
      name: 'build',
      browserConfig: {
        ...browserSourceConfig(fixture),
        buildIdentity: { ...fixture.buildIdentity, id: 'fedcba9876543210fedcba9876543210fedcba98' },
      },
    },
    {
      name: 'URL',
      browserConfig: {
        ...browserSourceConfig(fixture),
        attestationUrl: fixture.evidenceUrl.replace('evidence.example.com', 'alternate-evidence.example.com'),
        promotionUrl: fixture.promotionRecordUrl.replace('evidence.example.com', 'alternate-evidence.example.com'),
      },
    },
  ];
  for (const item of cases) {
    const transport = pinnedHttpsSource(async (url) => (
      url.endsWith('/attestation.json')
        ? exactJsonResponse(JSON.stringify(fixture.attestation), url)
        : exactJsonResponse(JSON.stringify(fixture.promotion), url)
    ));
    await assert.rejects(
      loadPublishedLocalizationBrowserEvidence({
        browserConfig: item.browserConfig,
        ...transport,
        now: TEST_BROWSER_NOW,
      }),
      (error) => error instanceof LocalizationReleaseEvidenceError
        && error.code === 'LOCALIZATION_BROWSER_EVIDENCE_INVALID',
      item.name,
    );
  }
});

test('browser release loader rejects unsafe DNS before opening HTTPS', async () => {
  const fixture = createLocalizationBrowserReleaseFixture();
  let httpsRequests = 0;

  await assert.rejects(
    loadPublishedLocalizationBrowserEvidence({
      browserConfig: browserSourceConfig(fixture),
      createEvidenceResolver: () => ({
        resolve: async () => [{ address: '169.254.169.254', family: 4 }],
        cancel() {},
      }),
      httpsRequestImpl() {
        httpsRequests += 1;
        throw new Error('must not connect');
      },
      now: TEST_BROWSER_NOW,
    }),
    (error) => error instanceof LocalizationReleaseEvidenceError
      && error.code === 'LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE',
  );
  assert.equal(httpsRequests, 0);
});

test('browser release loader rejects redirects, non-JSON responses, oversized bodies, and timeouts', async () => {
  const fixture = createLocalizationBrowserReleaseFixture();
  const cases = [
    {
      name: 'redirect',
      response: () => exactJsonResponse(JSON.stringify(fixture.attestation), fixture.evidenceUrl, { status: 302 }),
    },
    {
      name: 'content type',
      response: () => exactJsonResponse(JSON.stringify(fixture.attestation), fixture.evidenceUrl, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    },
    {
      name: 'bytes',
      response: () => exactJsonResponse('x'.repeat(DEFAULT_LOCALIZATION_BROWSER_RELEASE_EVIDENCE_POLICY.maxFileBytes + 1), fixture.evidenceUrl),
    },
  ];
  for (const item of cases) {
    const transport = pinnedHttpsSource(async (url) => item.response(url));
    await assert.rejects(
      loadPublishedLocalizationBrowserEvidence({
        browserConfig: browserSourceConfig(fixture),
        ...transport,
        now: TEST_BROWSER_NOW,
      }),
      (error) => error instanceof LocalizationReleaseEvidenceError
        && error.code === 'LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE',
      item.name,
    );
  }

  const timeoutTransport = {
    createEvidenceResolver: () => ({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], cancel() {} }),
    httpsRequestImpl() {
      const request = new EventEmitter();
      request.destroy = () => request;
      request.end = () => request;
      return request;
    },
  };
  await assert.rejects(
    loadPublishedLocalizationBrowserEvidence({
      browserConfig: browserSourceConfig(fixture),
      ...timeoutTransport,
      fetchPolicy: {
        deadlineMs: 5,
        maxFileBytes: DEFAULT_LOCALIZATION_BROWSER_RELEASE_EVIDENCE_POLICY.maxFileBytes,
        maxTotalBytes: DEFAULT_LOCALIZATION_BROWSER_RELEASE_EVIDENCE_POLICY.maxTotalBytes,
      },
      now: TEST_BROWSER_NOW,
    }),
    (error) => error instanceof LocalizationReleaseEvidenceError
      && error.code === 'LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE',
  );
});

test('runtime provider composes the exact browser and native contexts from server config without request input', async () => {
  const browser = createLocalizationBrowserReleaseFixture();
  const nativeReview = createNativeReviewReleaseFixture({
    browserGateEvidenceReference: browser.evidenceUrl,
  });
  const env = {
    [LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV]: JSON.stringify(releaseEvidenceConfigFor(browser, nativeReview)),
  };
  const calls = [];
  const transport = pinnedHttpsSource(async (url) => {
    calls.push(url);
    if (url === browser.evidenceUrl) return exactJsonResponse(JSON.stringify(browser.attestation), url);
    if (url === browser.promotionRecordUrl) return exactJsonResponse(JSON.stringify(browser.promotion), url);
    if (url === nativeReview.envelopeUrl) return exactJsonResponse(nativeReview.envelopeBytes, url);
    if (url === nativeReview.packetUrl) return exactJsonResponse(nativeReview.packetBytes, url);
    throw new Error(`unexpected URL: ${url}`);
  });
  const provider = createLocalizationReleaseEvidenceProvider({ env, ...transport, now: TEST_BROWSER_NOW });

  assert.equal(provider.length, 0);
  const context = await provider({
    headers: { 'x-evidence-url': 'https://attacker.invalid/attestation.json' },
    query: { promotionUrl: 'https://attacker.invalid/promotion.json' },
  });

  assert.deepEqual(Object.keys(context).sort(), [
    'buildIdentity',
    'journeyAttestation',
    'journeyPromotion',
    'nativeReviewBindingsByLocale',
    'nativeReviewEvidenceByLocale',
    'nativeReviewProgram',
    'trustedNativeReviewerKeys',
    'trustedPromotionKeys',
  ]);
  assert.deepEqual(context.buildIdentity, browser.buildIdentity);
  assert.equal(context.nativeReviewProgram, 'cjk-native-review');
  assert.deepEqual(context.journeyAttestation, browser.attestation);
  assert.deepEqual(context.journeyPromotion, browser.promotion);
  assert.deepEqual(context.nativeReviewBindingsByLocale[nativeReview.locale], nativeReview.expectedBindings);
  assert.deepEqual(new Set(calls), new Set([
    browser.evidenceUrl,
    browser.promotionRecordUrl,
    nativeReview.envelopeUrl,
    nativeReview.packetUrl,
  ]));
});

test('runtime provider accepts explicitly program-bound ASEAN native evidence without changing planned locale state', async () => {
  const browser = createLocalizationBrowserReleaseFixture();
  const nativeReview = createNativeReviewReleaseFixture({
    reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    locale: 'en-SG',
    browserGateEvidenceReference: browser.evidenceUrl,
    buildId: browser.buildIdentity.id,
    catalogHash: CURRENT_LOCALIZATION_CATALOG_HASH,
  });
  const env = {
    [LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV]: JSON.stringify({
      schemaVersion: 'localization-release-evidence-source-v1',
      browser: browserSourceConfig(browser),
      nativeReview: {
        reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
        sourceConfig: {
          [nativeReview.locale]: {
            envelopeUrl: nativeReview.envelopeUrl,
            packetUrl: nativeReview.packetUrl,
            expectedBindings: nativeReview.expectedBindings,
            allowedOrigin: nativeReview.allowedOrigin,
          },
        },
        trustedReviewerKeys: nativeReview.trustedReviewerKeys,
      },
    }),
  };
  const transport = pinnedHttpsSource(async (url) => {
    if (url === browser.evidenceUrl) return exactJsonResponse(JSON.stringify(browser.attestation), url);
    if (url === browser.promotionRecordUrl) return exactJsonResponse(JSON.stringify(browser.promotion), url);
    if (url === nativeReview.envelopeUrl) return exactJsonResponse(nativeReview.envelopeBytes, url);
    if (url === nativeReview.packetUrl) return exactJsonResponse(nativeReview.packetBytes, url);
    throw new Error(`unexpected URL: ${url}`);
  });

  const context = await createLocalizationReleaseEvidenceProvider({ env, ...transport, now: TEST_BROWSER_NOW })();
  assert.deepEqual(context.nativeReviewBindingsByLocale['en-SG'], nativeReview.expectedBindings);
  const scorecard = buildLocalizationScorecardFromReleaseEvidence(context, { now: TEST_BROWSER_NOW });
  const singaporeEnglish = scorecard.locales.find((entry) => entry.locale === 'en-SG');
  assert.equal(singaporeEnglish.nativeReview.status, LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING);
  assert.equal(singaporeEnglish.nativeReview.reviewer, null);
  assert.ok(Object.values(singaporeEnglish.nativeReview.evidenceStatusByCapability)
    .every((status) => status === 'STALE_BINDING'));
  assert.equal(LOCALE_CAPABILITIES['en-SG'].capabilities.ui, LOCALIZATION_CAPABILITY_STATUSES.PLANNED);
  assert.equal(LOCALE_CAPABILITIES['en-SG'].release.nativeReview.reviewer, null);
});

test('runtime scorecard factory uses the configured provider and keeps request data out of evidence selection', async () => {
  const browser = createLocalizationBrowserReleaseFixture();
  const nativeReview = createNativeReviewReleaseFixture({
    browserGateEvidenceReference: browser.evidenceUrl,
  });
  const env = {
    [LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV]: JSON.stringify(releaseEvidenceConfigFor(browser, nativeReview)),
  };
  const transport = pinnedHttpsSource(async (url) => {
    if (url === browser.evidenceUrl) return exactJsonResponse(JSON.stringify(browser.attestation), url);
    if (url === browser.promotionRecordUrl) return exactJsonResponse(JSON.stringify(browser.promotion), url);
    if (url === nativeReview.envelopeUrl) return exactJsonResponse(nativeReview.envelopeBytes, url);
    if (url === nativeReview.packetUrl) return exactJsonResponse(nativeReview.packetBytes, url);
    throw new Error(`unexpected URL: ${url}`);
  });
  const handler = createRuntimeLocalizationScorecardHandler({ env, ...transport, now: TEST_BROWSER_NOW });
  const result = responseRecorder();

  await handler({
    method: 'GET',
    headers: { 'x-localization-attestation-url': 'https://attacker.invalid/evidence.json' },
    query: { promotionUrl: 'https://attacker.invalid/promotion.json' },
  }, result);

  const scorecard = JSON.parse(result.body);
  assert.equal(result.statusCode, 200);
  assert.equal(scorecard.automatedJourneyVerification.buildId, browser.buildIdentity.id);
  assert.equal(scorecard.automatedJourneyVerification.publicationBinding, 'SIGNED_PROMOTION_RECORD');
});

test('runtime scorecard factory keeps absent release-evidence configuration honestly pending', async () => {
  let transportCalls = 0;
  const handler = createRuntimeLocalizationScorecardHandler({
    env: {},
    createEvidenceResolver() {
      transportCalls += 1;
      throw new Error('must not resolve');
    },
  });
  const result = responseRecorder();
  await handler({ method: 'GET', headers: {} }, result);

  const scorecard = JSON.parse(result.body);
  assert.equal(result.statusCode, 200);
  assert.equal(scorecard.automatedJourneyVerification.status, 'NOT_PUBLISHED');
  assert.equal(transportCalls, 0);
});

test('default scorecard handler treats present invalid server config as a sanitized no-store 503', async () => {
  const original = process.env[LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV];
  process.env[LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV] = '{not-json';
  try {
    const result = responseRecorder();
    await localizationScorecardHandler({ method: 'GET', headers: {} }, result);

    assert.equal(result.statusCode, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(JSON.parse(result.body), {
      error: 'Localization release evidence is temporarily unavailable.',
      code: 'LOCALIZATION_RELEASE_EVIDENCE_UNAVAILABLE',
      correlationId: result.headers.get('x-correlation-id'),
    });
    assert.equal(result.body.includes('not-json'), false);
  } finally {
    if (original === undefined) delete process.env[LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV];
    else process.env[LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV] = original;
  }
});

test('runtime scorecard factory sanitizes configured evidence transport failures as a 503', async () => {
  const browser = createLocalizationBrowserReleaseFixture();
  const nativeReview = createNativeReviewReleaseFixture({
    browserGateEvidenceReference: browser.evidenceUrl,
  });
  const env = {
    [LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV]: JSON.stringify(releaseEvidenceConfigFor(browser, nativeReview)),
  };
  const handler = createRuntimeLocalizationScorecardHandler({
    env,
    createEvidenceResolver: () => ({
      resolve: async () => [{ address: '169.254.169.254', family: 4 }],
      cancel() {},
    }),
    httpsRequestImpl() {
      throw new Error('must not connect');
    },
    now: TEST_BROWSER_NOW,
  });
  const result = responseRecorder();
  await handler({ method: 'GET', headers: {} }, result);

  assert.equal(result.statusCode, 503);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(result.body), {
    error: 'Localization release evidence is temporarily unavailable.',
    code: 'LOCALIZATION_RELEASE_EVIDENCE_UNAVAILABLE',
    correlationId: result.headers.get('x-correlation-id'),
  });
  assert.equal(result.body.includes('169.254.169.254'), false);
});
