import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  NativeReviewReleaseEvidenceError,
  loadNativeReviewReleaseEvidence,
} from '../server/native-review-release-evidence-adapter.js';
import { ASEAN_NATIVE_REVIEW_PROGRAM } from '../server/native-review-evidence.js';
import { createNativeReviewReleaseFixture } from './helpers/native-review-release-fixture.js';

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
  requestAborts = [],
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
        requestAborts.push(error || null);
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

test('native-review release evidence loader treats missing source configuration as no evidence', async () => {
  let fetchCalls = 0;
  const context = await loadNativeReviewReleaseEvidence({
    sourceConfig: null,
    trustedReviewerKeys: null,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('must not fetch');
    },
  });

  assert.equal(context, null);
  assert.equal(fetchCalls, 0);
});

test('native-review release evidence loader rejects configured invalid source configuration', async () => {
  let fetchCalls = 0;

  await assert.rejects(
    loadNativeReviewReleaseEvidence({
      sourceConfig: {},
      trustedReviewerKeys: {},
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('must not fetch');
      },
    }),
    (error) => error instanceof NativeReviewReleaseEvidenceError
      && error.code === 'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
  );
  assert.equal(fetchCalls, 0);
});

test('native-review release evidence loader fetches and validates exact operator-selected envelope and packet bytes', async () => {
  const fixture = createNativeReviewReleaseFixture();
  const calls = [];
  const transport = pinnedHttpsSource(async (url) => {
    calls.push(url);
    if (url === fixture.envelopeUrl) return exactJsonResponse(fixture.envelopeBytes, url);
    if (url === fixture.packetUrl) return exactJsonResponse(fixture.packetBytes, url);
    throw new Error(`unexpected URL: ${url}`);
  });

  const context = await loadNativeReviewReleaseEvidence({
    sourceConfig: {
      [fixture.locale]: {
        envelopeUrl: fixture.envelopeUrl,
        packetUrl: fixture.packetUrl,
        expectedBindings: fixture.expectedBindings,
        allowedOrigin: fixture.allowedOrigin,
      },
    },
    trustedReviewerKeys: fixture.trustedReviewerKeys,
    ...transport,
    now: fixture.now,
  });

  assert.deepEqual(calls, [fixture.envelopeUrl, fixture.packetUrl]);
  assert.deepEqual(context.nativeReviewEvidenceByLocale[fixture.locale].envelope, fixture.envelope);
  assert.deepEqual(
    context.nativeReviewEvidenceByLocale[fixture.locale].reviewPacketBytes,
    fixture.packetBytes,
  );
  assert.notEqual(context.nativeReviewEvidenceByLocale[fixture.locale].reviewPacketBytes, fixture.packetBytes);
  assert.deepEqual(context.nativeReviewBindingsByLocale[fixture.locale], fixture.expectedBindings);
  assert.deepEqual(context.trustedNativeReviewerKeys, fixture.trustedReviewerKeys);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.nativeReviewEvidenceByLocale), true);
  assert.equal(Object.isFrozen(context.nativeReviewEvidenceByLocale[fixture.locale].envelope), true);
  assert.equal(Object.isFrozen(context.nativeReviewBindingsByLocale[fixture.locale]), true);
  assert.equal(Object.isFrozen(context.trustedNativeReviewerKeys), true);
});

test('native-review release evidence loader accepts only an explicitly selected ASEAN program and its canonical locale scope', async () => {
  const fixture = createNativeReviewReleaseFixture({
    reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    locale: 'en-SG',
  });
  const transport = pinnedHttpsSource(async (url) => {
    if (url === fixture.envelopeUrl) return exactJsonResponse(fixture.envelopeBytes, url);
    if (url === fixture.packetUrl) return exactJsonResponse(fixture.packetBytes, url);
    throw new Error(`unexpected URL: ${url}`);
  });

  const context = await loadNativeReviewReleaseEvidence({
    reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    sourceConfig: {
      [fixture.locale]: {
        envelopeUrl: fixture.envelopeUrl,
        packetUrl: fixture.packetUrl,
        expectedBindings: fixture.expectedBindings,
        allowedOrigin: fixture.allowedOrigin,
      },
    },
    trustedReviewerKeys: fixture.trustedReviewerKeys,
    ...transport,
    now: fixture.now,
  });
  assert.deepEqual(context.nativeReviewBindingsByLocale[fixture.locale], fixture.expectedBindings);

  const cjkFixture = createNativeReviewReleaseFixture();
  await assert.rejects(
    loadNativeReviewReleaseEvidence({
      reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
      sourceConfig: {
        [cjkFixture.locale]: {
          envelopeUrl: cjkFixture.envelopeUrl,
          packetUrl: cjkFixture.packetUrl,
          expectedBindings: cjkFixture.expectedBindings,
        },
      },
      trustedReviewerKeys: cjkFixture.trustedReviewerKeys,
      ...transport,
      now: fixture.now,
    }),
    (error) => error instanceof NativeReviewReleaseEvidenceError
      && error.code === 'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
  );
});

test('native-review release evidence loader rejects non-exact authority configuration before fetching', async () => {
  const fixture = createNativeReviewReleaseFixture();
  const base = {
    envelopeUrl: fixture.envelopeUrl,
    packetUrl: fixture.packetUrl,
    expectedBindings: fixture.expectedBindings,
    allowedOrigin: fixture.allowedOrigin,
  };
  const unsafeSources = [
    { ...base, envelopeUrl: fixture.envelopeUrl.replace('https:', 'http:') },
    { ...base, envelopeUrl: fixture.envelopeUrl.replace('https://', 'https://user:secret@') },
    { ...base, packetUrl: `${fixture.packetUrl}?selected=request` },
    { ...base, packetUrl: `${fixture.packetUrl}#fragment` },
    { ...base, packetUrl: fixture.packetUrl.replace(fixture.allowedOrigin, 'https://other.example.com') },
    { ...base, envelopeUrl: `${fixture.allowedOrigin}/native-review/not-content-addressed/envelope.json` },
    { ...base, packetUrl: `${fixture.allowedOrigin}/native-review/not-content-addressed/packet.json` },
    { ...base, expectedBindings: { ...fixture.expectedBindings, requestSelectedUrl: 'https://attacker.invalid/' } },
  ];

  for (const source of unsafeSources) {
    let fetchCalls = 0;
    await assert.rejects(
      loadNativeReviewReleaseEvidence({
        sourceConfig: { [fixture.locale]: source },
        trustedReviewerKeys: fixture.trustedReviewerKeys,
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error('must not fetch');
        },
        now: fixture.now,
      }),
      (error) => error instanceof NativeReviewReleaseEvidenceError
        && error.code === 'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
    );
    assert.equal(fetchCalls, 0);
  }
});

test('native-review release evidence loader rejects a private DNS result before opening HTTPS', async () => {
  const fixture = createNativeReviewReleaseFixture();
  let httpsRequests = 0;

  await assert.rejects(
    loadNativeReviewReleaseEvidence({
      sourceConfig: {
        [fixture.locale]: {
          envelopeUrl: fixture.envelopeUrl,
          packetUrl: fixture.packetUrl,
          expectedBindings: fixture.expectedBindings,
        },
      },
      trustedReviewerKeys: fixture.trustedReviewerKeys,
      createEvidenceResolver: () => ({
        resolve: async () => [{ address: '169.254.169.254', family: 4 }],
        cancel() {},
      }),
      httpsRequestImpl() {
        httpsRequests += 1;
        throw new Error('must not connect');
      },
      fetchImpl: async (input) => exactJsonResponse(
        String(input) === fixture.envelopeUrl ? fixture.envelopeBytes : fixture.packetBytes,
        String(input),
      ),
      now: fixture.now,
    }),
    (error) => error instanceof NativeReviewReleaseEvidenceError
      && error.code === 'NATIVE_REVIEW_SOURCE_ADDRESS_UNSAFE',
  );
  assert.equal(httpsRequests, 0);
});

test('native-review release evidence loader pins HTTPS lookup to every prevalidated public address', async () => {
  const fixture = createNativeReviewReleaseFixture();
  const connected = [];
  const approvedAddresses = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ];
  const transport = pinnedHttpsSource(
    async (url) => exactJsonResponse(
      url === fixture.envelopeUrl ? fixture.envelopeBytes : fixture.packetBytes,
      url,
    ),
    { addresses: approvedAddresses, connected },
  );

  await loadNativeReviewReleaseEvidence({
    sourceConfig: {
      [fixture.locale]: {
        envelopeUrl: fixture.envelopeUrl,
        packetUrl: fixture.packetUrl,
        expectedBindings: fixture.expectedBindings,
      },
    },
    trustedReviewerKeys: fixture.trustedReviewerKeys,
    ...transport,
    now: fixture.now,
  });

  assert.deepEqual(connected.map((entry) => entry.url), [fixture.envelopeUrl, fixture.packetUrl]);
  assert.ok(connected.every((entry) => entry.hostname === 'native-review.example.com'));
  assert.ok(connected.every((entry) => entry.servername === 'native-review.example.com'));
  assert.ok(connected.every((entry) => (
    JSON.stringify(entry.addresses) === JSON.stringify(approvedAddresses)
  )));
  assert.equal(connected.some((entry) => entry.addresses.some((address) => address.address.startsWith('10.'))), false);
});

test('native-review release evidence loader enforces one aggregate byte budget across both exact files', async () => {
  const fixture = createNativeReviewReleaseFixture();
  const transport = pinnedHttpsSource(async (url) => {
    return exactJsonResponse(
      url === fixture.envelopeUrl ? fixture.envelopeBytes : fixture.packetBytes,
      url,
    );
  });

  await assert.rejects(
    loadNativeReviewReleaseEvidence({
      sourceConfig: {
        [fixture.locale]: {
          envelopeUrl: fixture.envelopeUrl,
          packetUrl: fixture.packetUrl,
          expectedBindings: fixture.expectedBindings,
        },
      },
      trustedReviewerKeys: fixture.trustedReviewerKeys,
      ...transport,
      fetchPolicy: {
        deadlineMs: 1_000,
        maxFileBytes: 1_048_576,
        maxTotalBytes: fixture.envelopeBytes.byteLength + fixture.packetBytes.byteLength - 1,
      },
      now: fixture.now,
    }),
    (error) => error instanceof NativeReviewReleaseEvidenceError
      && error.code === 'NATIVE_REVIEW_SOURCE_TOTAL_TOO_LARGE',
  );
});

test('native-review release evidence loader rejects redirect, non-200, and non-JSON responses', async () => {
  const fixture = createNativeReviewReleaseFixture();
  const sourceConfig = {
    [fixture.locale]: {
      envelopeUrl: fixture.envelopeUrl,
      packetUrl: fixture.packetUrl,
      expectedBindings: fixture.expectedBindings,
    },
  };
  const invalidEnvelopeResponses = [
    exactJsonResponse(null, fixture.envelopeUrl, { status: 302 }),
    exactJsonResponse(fixture.envelopeBytes, fixture.envelopeUrl, { status: 206 }),
    exactJsonResponse(fixture.envelopeBytes, fixture.envelopeUrl, {
      headers: { 'content-type': 'application/problem+json' },
    }),
  ];

  for (const response of invalidEnvelopeResponses) {
    await assert.rejects(
      loadNativeReviewReleaseEvidence({
        sourceConfig,
        trustedReviewerKeys: fixture.trustedReviewerKeys,
        ...pinnedHttpsSource(async () => response),
        now: fixture.now,
      }),
      (error) => error instanceof NativeReviewReleaseEvidenceError
        && error.code === 'NATIVE_REVIEW_SOURCE_RESPONSE_INVALID',
    );
  }
});

test('native-review release evidence loader aborts and cancels an invalid early response body', async () => {
  const fixture = createNativeReviewReleaseFixture();
  const requestAborts = [];
  let bodyCancelled = false;
  const stalledBody = new Readable({ read() {} });
  stalledBody.statusCode = 200;
  stalledBody.headers = { 'content-type': 'text/plain' };
  stalledBody.once('close', () => { bodyCancelled = true; });

  await assert.rejects(
    loadNativeReviewReleaseEvidence({
      sourceConfig: {
        [fixture.locale]: {
          envelopeUrl: fixture.envelopeUrl,
          packetUrl: fixture.packetUrl,
          expectedBindings: fixture.expectedBindings,
        },
      },
      trustedReviewerKeys: fixture.trustedReviewerKeys,
      ...pinnedHttpsSource(async () => stalledBody, { requestAborts }),
      now: fixture.now,
    }),
    (error) => error instanceof NativeReviewReleaseEvidenceError
      && error.code === 'NATIVE_REVIEW_SOURCE_RESPONSE_INVALID',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bodyCancelled, true);
  assert.equal(requestAborts.length > 0, true);
});

test('native-review release evidence loader rejects duplicate-key envelopes and tampered signed evidence', async () => {
  const fixture = createNativeReviewReleaseFixture();
  const sourceConfig = {
    [fixture.locale]: {
      envelopeUrl: fixture.envelopeUrl,
      packetUrl: fixture.packetUrl,
      expectedBindings: fixture.expectedBindings,
    },
  };
  const cases = [
    {
      envelopeBytes: new TextEncoder().encode('{"artifact":{},"artifact":{},"signature":"invalid"}'),
      code: 'NATIVE_REVIEW_ENVELOPE_INVALID',
    },
    {
      envelopeBytes: new TextEncoder().encode(JSON.stringify({
        ...fixture.envelope,
        artifact: {
          ...fixture.envelope.artifact,
          approvalReference: 'native-review/tampered-approval',
        },
      })),
      code: 'NATIVE_REVIEW_EVIDENCE_INVALID',
    },
  ];

  for (const scenario of cases) {
    await assert.rejects(
      loadNativeReviewReleaseEvidence({
        sourceConfig,
        trustedReviewerKeys: fixture.trustedReviewerKeys,
        ...pinnedHttpsSource(async (url) => {
          return exactJsonResponse(
            url === fixture.envelopeUrl ? scenario.envelopeBytes : fixture.packetBytes,
            url,
          );
        }),
        now: fixture.now,
      }),
      (error) => error instanceof NativeReviewReleaseEvidenceError
        && error.code === scenario.code,
    );
  }
});
