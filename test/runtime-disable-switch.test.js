import assert from 'node:assert/strict';
import test from 'node:test';

import { createMcpApiHandler } from '../api/mcp.js';
import { createSegmentPerspectiveApiHandler } from '../api/segment-perspective.js';
import { createSyntheticStudyApiHandler } from '../api/synthetic-study.js';
import { createAnonymousStudyAdmission } from '../server/mcp-abuse-controls.js';

const PRODUCTION_READINESS_TOKEN = 'r'.repeat(32);

function request(extra = {}) {
  return {
    method: 'POST',
    url: '/api/mcp',
    headers: { host: 'likerts.example', 'content-type': 'application/json', 'x-correlation-id': 'corr_12345678' },
    body: { jsonrpc: '2.0', id: 1, method: 'ping' },
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

test('emergency execution disable blocks admission before quota mutation', async () => {
  let storeAcquireCalls = 0;
  const admission = createAnonymousStudyAdmission({
    env: { LIKERTS_EXECUTION_DISABLED: 'true' },
    admissionStore: {
      metadata: {
        contractVersion: 'admission-store-adapter-v1',
        mode: 'TEST_DEGRADED',
        durabilityStatus: 'DEGRADED_NOT_GLOBALLY_DURABLE',
        globallyDurable: false,
      },
      async acquire() {
        storeAcquireCalls += 1;
        return () => {};
      },
      snapshot() { return {}; },
    },
  });

  await assert.rejects(
    () => admission.acquire({ clientKey: 'client-a', estimatedUnits: 1 }),
    (error) => error.code === 'EXECUTION_DISABLED',
  );
  assert.equal(storeAcquireCalls, 0);
});

test('production admission blocks before degraded store mutation when no durable adapter is injected', async () => {
  let storeAcquireCalls = 0;
  const admission = createAnonymousStudyAdmission({
    env: {
      NODE_ENV: 'production',
      MCP_RATE_LIMIT_SALT: 's'.repeat(32),
      LIKERTS_READINESS_TOKEN: PRODUCTION_READINESS_TOKEN,
    },
    admissionStore: {
      metadata: {
        contractVersion: 'admission-store-adapter-v1',
        mode: 'IN_MEMORY',
        durabilityStatus: 'DEGRADED_NOT_GLOBALLY_DURABLE',
      },
      async acquire() {
        storeAcquireCalls += 1;
        return () => {};
      },
      snapshot() { return {}; },
    },
  });

  await assert.rejects(
    () => admission.acquire({ clientKey: 'client-a', estimatedUnits: 1 }),
    (error) => error.code === 'DURABLE_ADMISSION_REQUIRED',
  );
  assert.equal(admission.protection.globallyDurable, false);
  assert.equal(storeAcquireCalls, 0);
});

test('emergency execution disable stops MCP HTTP dispatch with structured redacted telemetry', async () => {
  const logs = [];
  let dispatched = false;
  const handler = createMcpApiHandler({
    env: { LIKERTS_EXECUTION_DISABLED: 'true' },
    logger: { warn: (line) => logs.push(line), error: (line) => logs.push(line), info: (line) => logs.push(line) },
    requestLimiter: { check: () => ({ allowed: true, limit: 10, remaining: 9, retryAfterSeconds: 60 }) },
    nodeHandler: async () => { dispatched = true; },
  });
  const res = response();
  await handler(request(), res);
  const body = JSON.parse(res.body);
  const event = JSON.parse(logs[0]);

  assert.equal(res.statusCode, 503);
  assert.equal(res.headers.get('x-correlation-id'), 'corr_12345678');
  assert.equal(body.error.data.code, 'EXECUTION_DISABLED');
  assert.equal(body.error.data.correlationId, 'corr_12345678');
  assert.equal(dispatched, false);
  assert.equal(event.correlationId, 'corr_12345678');
  assert.equal(event.event, 'request_blocked');
  assert.equal(JSON.stringify(event).includes('ping'), false);
});

test('emergency execution disable stops synthetic API before model work with public error mapping', async () => {
  const logs = [];
  let admitted = false;
  let ranStudy = false;
  const handler = createSyntheticStudyApiHandler({
    env: { LIKERTS_EXECUTION_DISABLED: 'true', OPENAI_API_KEY: 'sk-secret' },
    logger: { warn: (line) => logs.push(line), error: (line) => logs.push(line), info: (line) => logs.push(line) },
    admission: { async acquire() { admitted = true; return () => {}; } },
    runStudy: async () => { ranStudy = true; },
  });
  const res = response();
  await handler({
    method: 'POST',
    url: '/api/synthetic-study',
    headers: { host: 'likerts.example', 'content-type': 'application/json', 'x-correlation-id': 'study_12345678' },
    body: {
      prompt: 'Would this audience adopt a workspace if the private prompt leaked?',
      audience: 'Operations leaders',
      panelSize: 100,
    },
  }, res);
  const event = JSON.parse(logs[0]);

  assert.equal(res.statusCode, 503);
  assert.equal(res.headers.get('x-correlation-id'), 'study_12345678');
  assert.equal(res.payload.code, 'EXECUTION_DISABLED');
  assert.equal(res.payload.correlationId, 'study_12345678');
  assert.equal(admitted, false);
  assert.equal(ranStudy, false);
  assert.equal(event.component, 'api.synthetic-study');
  assert.equal(event.correlationId, 'study_12345678');
  assert.equal(JSON.stringify(event).includes('private prompt'), false);
  assert.equal(JSON.stringify(event).includes('sk-secret'), false);
});

test('production synthetic API requires actual durable admission before admission or model work', async () => {
  const logs = [];
  let admitted = false;
  let ranStudy = false;
  const handler = createSyntheticStudyApiHandler({
    env: {
      NODE_ENV: 'production',
      MCP_RATE_LIMIT_SALT: 's'.repeat(32),
      LIKERTS_READINESS_TOKEN: PRODUCTION_READINESS_TOKEN,
    },
    logger: { warn: (line) => logs.push(line), error: (line) => logs.push(line), info: (line) => logs.push(line) },
    admission: {
      protection: { globallyDurable: false, durabilityStatus: 'SHARED_DURABLE_ADAPTER_REQUIRED' },
      async acquire() { admitted = true; return () => {}; },
    },
    runStudy: async () => { ranStudy = true; },
  });
  const res = response();

  await handler({
    method: 'POST',
    url: '/api/synthetic-study',
    headers: { host: 'likerts.example', 'content-type': 'application/json', 'x-correlation-id': 'prod_12345678' },
    body: {
      prompt: 'Would this private prompt leak?',
      audience: 'Operations leaders',
      panelSize: 100,
    },
  }, res);
  const event = JSON.parse(logs[0]);

  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.code, 'DURABLE_ADMISSION_REQUIRED');
  assert.equal(res.payload.correlationId, 'prod_12345678');
  assert.equal(admitted, false);
  assert.equal(ranStudy, false);
  assert.equal(event.event, 'request_blocked');
  assert.equal(JSON.stringify(event).includes('private prompt'), false);
});

test('production segment perspective API requires actual durable admission before paid work', async () => {
  let admitted = false;
  let ranPerspective = false;
  const handler = createSegmentPerspectiveApiHandler({
    env: {
      NODE_ENV: 'production',
      MCP_RATE_LIMIT_SALT: 's'.repeat(32),
      LIKERTS_READINESS_TOKEN: PRODUCTION_READINESS_TOKEN,
    },
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    admission: {
      protection: { globallyDurable: false, durabilityStatus: 'DEGRADED_NOT_GLOBALLY_DURABLE' },
      async acquire() { admitted = true; return () => {}; },
    },
    runPerspective: async () => { ranPerspective = true; },
  });
  const res = response();

  await handler({
    method: 'POST',
    url: '/api/segment-perspective',
    headers: { host: 'likerts.example', 'content-type': 'application/json', 'x-correlation-id': 'segprod_12345678' },
    body: {},
  }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.code, 'DURABLE_ADMISSION_REQUIRED');
  assert.equal(admitted, false);
  assert.equal(ranPerspective, false);
});

test('production MCP HTTP boundary requires actual durable admission before dispatch or request limits', async () => {
  const logs = [];
  let checkedLimit = false;
  let dispatched = false;
  const handler = createMcpApiHandler({
    env: {
      NODE_ENV: 'production',
      MCP_RATE_LIMIT_SALT: 's'.repeat(32),
      LIKERTS_READINESS_TOKEN: PRODUCTION_READINESS_TOKEN,
    },
    logger: { warn: (line) => logs.push(line), error: (line) => logs.push(line), info: (line) => logs.push(line) },
    admission: {
      protection: {
        durability: 'process-local-fallback',
        processLocalFallback: true,
        globallyDurable: false,
        durabilityStatus: 'SHARED_DURABLE_ADAPTER_REQUIRED',
      },
    },
    requestLimiter: { check: () => { checkedLimit = true; return { allowed: true, limit: 10, remaining: 9, retryAfterSeconds: 60 }; } },
    nodeHandler: async () => { dispatched = true; },
  });
  const res = response();

  await handler(request({ headers: { host: 'likerts.example', 'content-type': 'application/json', 'x-correlation-id': 'mcpprod_12345678' } }), res);
  const body = JSON.parse(res.body);
  const event = JSON.parse(logs[0]);

  assert.equal(res.statusCode, 503);
  assert.equal(body.error.data.code, 'DURABLE_ADMISSION_REQUIRED');
  assert.equal(body.error.data.correlationId, 'mcpprod_12345678');
  assert.equal(checkedLimit, false);
  assert.equal(dispatched, false);
  assert.equal(event.event, 'request_blocked');
  assert.equal(JSON.stringify(event).includes('ping'), false);
});
