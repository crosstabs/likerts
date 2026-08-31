import assert from 'node:assert/strict';
import test from 'node:test';

import { createSegmentPerspectiveApiHandler } from '../api/segment-perspective.js';
import { createSyntheticStudyApiHandler } from '../api/synthetic-study.js';
import { MAX_JSON_API_BODY_BYTES } from '../server/api-boundary.js';
import { StudyPipelineError } from '../server/synthetic-study-pipeline.js';
import { normalizeLocalizationRequest } from '../server/localization-request.js';

const localizationReceiptFor = (reportLocale = 'en-US') => normalizeLocalizationRequest({
  localization: {
    schemaVersion: 'study-localization-v1',
    marketId: 'GLOBAL',
    reportLocale,
    sourceLocales: [],
    retrieval: { policy: 'ANY', locales: [] },
    instrumentLocale: reportLocale,
  },
});

function request(extra = {}) {
  return {
    method: 'POST',
    url: '/api/synthetic-study',
    headers: { host: 'likerts.example', 'content-type': 'application/json', 'x-correlation-id': 'corr_12345678' },
    body: {},
    async *[Symbol.asyncIterator]() {},
    ...extra,
  };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    headers,
    body: '',
    payload: null,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; this.body = JSON.stringify(value); return this; },
    end(chunk = '') { this.body += Buffer.from(chunk).toString(); this.ended = true; },
  };
}

const validSegmentPerspectiveRequest = {
  studyId: 'study_12345678',
  runId: 'run_12345678',
  expectedTurnIndex: 0,
  parentTurnId: null,
  segment: { id: 'segment-1', label: 'Urban apartment residents', distribution: [5, 9, 12, 34, 40] },
  question: 'What is the strongest modeled objection to this concept?',
  intent: 'OBJECTION',
  history: [],
  grounding: {
    localizationReceipt: localizationReceiptFor(),
    outputLocale: 'en-US',
    evidenceHash: null,
    populationFrameHash: null,
    researchDesignHash: null,
    modelCardHash: null,
    researchMethod: 'CONCEPT_TEST',
    researchMethodVersion: 'concept-test-v1',
    segments: [{ id: 'segment-1', label: 'Urban apartment residents', distribution: [5, 9, 12, 34, 40] }],
    evidence: [],
    assumptions: [],
    unsupportedCharacteristics: [],
  },
};

function noWorkHandler(factory, options = {}) {
  let admitted = false;
  let ran = false;
  const handler = factory({
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    admission: { async acquire() { admitted = true; return () => {}; } },
    runStudy: async () => { ran = true; },
    runPerspective: async () => { ran = true; },
    ...options,
  });
  return { handler, worked: () => admitted || ran };
}

test('synthetic API rejects cross-origin, non-JSON, invalid JSON, and oversized bodies before paid work', async () => {
  const { handler, worked } = noWorkHandler(createSyntheticStudyApiHandler);

  const badOrigin = response();
  await handler(request({ headers: { host: 'likerts.example', origin: 'https://evil.example', 'content-type': 'application/json' } }), badOrigin);
  assert.equal(badOrigin.statusCode, 403);
  assert.equal(badOrigin.payload.code, 'ORIGIN_NOT_ALLOWED');

  const badScheme = response();
  await handler(request({ headers: { host: 'likerts.example', origin: 'http://likerts.example', 'content-type': 'application/json' } }), badScheme);
  assert.equal(badScheme.statusCode, 403);

  const badPort = response();
  await handler(request({ headers: { host: 'likerts.example', origin: 'https://likerts.example:444', 'content-type': 'application/json' } }), badPort);
  assert.equal(badPort.statusCode, 403);

  const spoofedForwardedHost = response();
  await handler(request({ headers: { host: 'likerts.example', 'x-forwarded-host': 'evil.example', origin: 'https://evil.example', 'content-type': 'application/json' } }), spoofedForwardedHost);
  assert.equal(spoofedForwardedHost.statusCode, 403);

  const badType = response();
  await handler(request({ headers: { host: 'likerts.example', 'content-type': 'text/plain' } }), badType);
  assert.equal(badType.statusCode, 415);

  const invalidJson = response();
  await handler(request({ body: '{broken' }), invalidJson);
  assert.equal(invalidJson.statusCode, 400);
  assert.equal(invalidJson.payload.code, 'INVALID_JSON');

  const oversized = response();
  await handler(request({ body: 'x'.repeat(MAX_JSON_API_BODY_BYTES + 1) }), oversized);
  assert.equal(oversized.statusCode, 413);
  assert.equal(worked(), false);
});

test('synthetic API allows absent and same-host origins for local credentialless calls', async () => {
  const { handler } = noWorkHandler(createSyntheticStudyApiHandler);

  const absentOrigin = response();
  await handler(request(), absentOrigin);
  assert.equal(absentOrigin.statusCode, 400);
  assert.equal(absentOrigin.payload.code, 'VALIDATION_ERROR');

  const sameHost = response();
  await handler(request({ headers: { host: 'likerts.example', origin: 'https://likerts.example', 'content-type': 'application/json' } }), sameHost);
  assert.equal(sameHost.statusCode, 400);
  assert.equal(sameHost.headers.get('access-control-allow-origin'), 'https://likerts.example');

  const configuredLocal = response();
  const configuredHandler = noWorkHandler(createSyntheticStudyApiHandler, {
    env: { LIKERTS_ALLOWED_ORIGINS: 'http://localhost:5173' },
  }).handler;
  await configuredHandler(request({
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'http',
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
    },
  }), configuredLocal);
  assert.equal(configuredLocal.statusCode, 400);
  assert.equal(configuredLocal.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('synthetic API forwards its public correlation ID and logger into the study pipeline', async () => {
  const logs = [];
  const logger = { warn: () => {}, error: () => {}, info: (line) => logs.push(JSON.parse(line)) };
  let runtimeOptions;
  const handler = createSyntheticStudyApiHandler({
    env: {},
    logger,
    admission: { async acquire() { return () => {}; } },
    runStudy: async (_study, options) => {
      runtimeOptions = options;
      return {
        study: { title: 'Synthetic study' },
        run: { runId: 'run_12345678', status: 'completed', stages: [{ status: 'completed' }] },
        meta: {
          durationMs: 1200,
          economics: {
            tokenUsage: { totalTokens: 30 },
            gatewayCost: { exactTotalUsd: '0.01', reporting: 'complete' },
          },
        },
      };
    },
  });
  const res = response();

  await handler(request({
    body: {
      prompt: 'Would this audience adopt a shared workspace?',
      audience: 'Small business operations leaders',
      panelSize: 100,
    },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(runtimeOptions.correlationId, 'corr_12345678');
  assert.equal(runtimeOptions.logger, logger);
  assert.match(runtimeOptions.gatewayUserId, /^[a-f0-9]{64}$/);
  const runEvent = logs.find((event) => event.event === 'study_run_finished');
  assert.deepEqual(runEvent.attributes, {
    outcome: 'succeeded',
    runId: 'run_12345678',
    completionStatus: 'completed',
    researchMode: 'QUICK',
    researchMethod: 'GENERAL_LIKERT',
    reportLocale: 'en-US',
    durationMs: 1200,
    stageCount: 1,
    failedStageCount: 0,
    tokenUsage: { totalTokens: 30 },
    gatewayCostUsdExact: '0.01',
    gatewayCostReporting: 'complete',
  });
  assert.equal(logs.filter((event) => event.event === 'request_finished').length, 1);
});

test('synthetic API preserves the typed required-source no-match code for localized UI recovery', async () => {
  let releaseCalls = 0;
  const handler = createSyntheticStudyApiHandler({
    env: {},
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    admission: {
      async acquire() {
        return () => { releaseCalls += 1; };
      },
    },
    runStudy: async () => {
      throw new StudyPipelineError(
        'External evidence was required, but no source satisfied both provider-declared primary-language metadata and the registered-script compatibility check. This check is not language identification.',
        424,
        undefined,
        'REQUIRED_SOURCE_LANGUAGE_UNAVAILABLE',
      );
    },
  });
  const res = response();
  await handler(request({
    body: {
      prompt: 'Would this audience adopt a shared workspace?',
      audience: 'Small business operations leaders',
      panelSize: 100,
    },
  }), res);

  assert.equal(res.statusCode, 424);
  assert.equal(res.payload.code, 'REQUIRED_SOURCE_LANGUAGE_UNAVAILABLE');
  assert.match(res.payload.error, /This check is not language identification\./);
  assert.equal(releaseCalls, 1);
});

test('synthetic API rejects unresolved legacy custom markets before admission or generation', async () => {
  let admissionCalls = 0;
  let generationCalls = 0;
  const handler = createSyntheticStudyApiHandler({
    env: {},
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    admission: {
      async acquire() {
        admissionCalls += 1;
        return () => {};
      },
    },
    runStudy: async () => {
      generationCalls += 1;
      throw new Error('generation must not run');
    },
  });
  const res = response();

  await handler(request({
    body: {
      prompt: 'Would Quebec retailers adopt this shared inventory workflow?',
      audience: 'Independent retail operations leaders',
      panelSize: 100,
      market: 'Quebec retail',
      outputLocale: 'fr-FR',
      searchCountry: 'CA',
      searchLocation: 'Montreal, Quebec',
    },
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, 'UNKNOWN_MARKET');
  assert.equal(admissionCalls, 0);
  assert.equal(generationCalls, 0);
});

test('segment perspective API uses the same fail-closed JSON boundary before paid work', async () => {
  const { handler, worked } = noWorkHandler(createSegmentPerspectiveApiHandler);

  const badOrigin = response();
  await handler(request({ url: '/api/segment-perspective', headers: { host: 'likerts.example', origin: 'https://evil.example', 'content-type': 'application/json' } }), badOrigin);
  assert.equal(badOrigin.statusCode, 403);

  const badType = response();
  await handler(request({ url: '/api/segment-perspective', headers: { host: 'likerts.example', 'content-type': 'application/x-www-form-urlencoded' } }), badType);
  assert.equal(badType.statusCode, 415);

  const oversized = response();
  await handler(request({ url: '/api/segment-perspective', body: 'x'.repeat(MAX_JSON_API_BODY_BYTES + 1) }), oversized);
  assert.equal(oversized.statusCode, 413);
  assert.equal(worked(), false);
});

test('segment perspective API rejects planned and unknown report locales before admission or generation', async () => {
  let admissionCalls = 0;
  let generationCalls = 0;
  const handler = createSegmentPerspectiveApiHandler({
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    admission: {
      async acquire() {
        admissionCalls += 1;
        return () => {};
      },
    },
    runPerspective: async () => {
      generationCalls += 1;
      throw new Error('generation must not run');
    },
  });
  for (const [outputLocale, expectedCode] of [
    ['id-ID', 'UNSUPPORTED_REPORT_LOCALE'],
    ['xx-YY', 'UNKNOWN_LOCALE'],
  ]) {
    const res = response();
    await handler(request({
      url: '/api/segment-perspective',
      body: {
        ...validSegmentPerspectiveRequest,
        grounding: { ...validSegmentPerspectiveRequest.grounding, outputLocale },
      },
    }), res);
    assert.equal(res.statusCode, 400, outputLocale);
    assert.equal(res.payload.code, expectedCode, outputLocale);
  }
  assert.equal(admissionCalls, 0);
  assert.equal(generationCalls, 0);
});

test('segment perspective API requires current registered localization before admission or generation', async () => {
  let admissionCalls = 0;
  let generationCalls = 0;
  let runtimeOptions;
  const logs = [];
  const handler = createSegmentPerspectiveApiHandler({
    logger: { warn: () => {}, error: () => {}, info: (line) => logs.push(JSON.parse(line)) },
    admission: { async acquire() { admissionCalls += 1; return () => {}; } },
    runPerspective: async (input, options) => {
      generationCalls += 1;
      runtimeOptions = options;
      return {
        ok: true,
        localizationReceipt: input.grounding.localizationReceipt,
        modelLineage: [{ durationMs: 400, usage: { totalTokens: 20 }, gatewayCostUsdExact: '0.002' }],
      };
    },
  });

  const cases = [
    { name: 'absent', localizationReceipt: undefined, code: 'INVALID_LOCALIZATION_RECEIPT' },
    { name: 'custom', localizationReceipt: { ...localizationReceiptFor(), market: { ...localizationReceiptFor().market, id: 'LEGACY_CUSTOM', kind: 'legacy-custom' } }, code: 'UNKNOWN_MARKET' },
    { name: 'forged', localizationReceipt: { ...localizationReceiptFor(), registryVersion: 'forged-registry' }, code: 'INVALID_LOCALIZATION_RECEIPT' },
  ];
  for (const item of cases) {
    const body = { ...validSegmentPerspectiveRequest };
    body.grounding = { ...validSegmentPerspectiveRequest.grounding };
    if (item.localizationReceipt !== undefined) body.grounding.localizationReceipt = item.localizationReceipt;
    else delete body.grounding.localizationReceipt;
    const res = response();
    await handler(request({ url: '/api/segment-perspective', body }), res);
    assert.equal(res.statusCode, 400, item.name);
    assert.equal(res.payload.code, item.code, item.name);
  }
  assert.equal(admissionCalls, 0);
  assert.equal(generationCalls, 0);

  const success = response();
  await handler(request({ url: '/api/segment-perspective', body: validSegmentPerspectiveRequest }), success);
  assert.equal(success.statusCode, 200);
  assert.deepEqual(success.payload.localizationReceipt, validSegmentPerspectiveRequest.grounding.localizationReceipt);
  assert.equal(admissionCalls, 1);
  assert.equal(generationCalls, 1);
  assert.match(runtimeOptions.gatewayUserId, /^[a-f0-9]{64}$/);
  const followupEvent = logs.find((event) => event.event === 'segment_followup_finished');
  assert.deepEqual(followupEvent.attributes, {
    outcome: 'succeeded',
    intent: 'OBJECTION',
    researchMethod: 'CONCEPT_TEST',
    reportLocale: 'en-US',
    durationMs: 400,
    tokenUsage: { totalTokens: 20 },
    gatewayCostUsdExact: '0.002',
  });
});

test('segment perspective runtime-disable telemetry omits prompt and source text', async () => {
  const logs = [];
  const { handler, worked } = noWorkHandler(createSegmentPerspectiveApiHandler, {
    env: { LIKERTS_EXECUTION_DISABLED: 'true', OPENAI_API_KEY: 'sk-secret' },
    logger: { warn: (line) => logs.push(line), error: (line) => logs.push(line), info: (line) => logs.push(line) },
  });
  const res = response();

  await handler(request({
    url: '/api/segment-perspective',
    headers: { host: 'likerts.example', 'content-type': 'application/json', 'x-correlation-id': 'seg_12345678' },
    body: {
      question: 'Would the private segment prompt leak?',
      sources: [{ excerpt: 'sensitive source text' }],
    },
  }), res);
  const event = JSON.parse(logs[0]);

  assert.equal(res.statusCode, 503);
  assert.equal(res.headers.get('x-correlation-id'), 'seg_12345678');
  assert.equal(res.payload.code, 'EXECUTION_DISABLED');
  assert.equal(worked(), false);
  assert.equal(event.component, 'api.segment-perspective');
  assert.equal(JSON.stringify(event).includes('private segment prompt'), false);
  assert.equal(JSON.stringify(event).includes('sensitive source text'), false);
  assert.equal(JSON.stringify(event).includes('sk-secret'), false);
});
