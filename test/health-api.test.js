import assert from 'node:assert/strict';
import test from 'node:test';

import healthHandler, { createHealthApiHandler } from '../api/health.js';

function request(extra = {}) {
  return {
    method: 'GET',
    url: '/api/health',
    headers: { host: 'likerts.example' },
    ...extra,
  };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = JSON.stringify(value); return this; },
    end(value = '') { this.body += value; return this; },
    headers,
  };
}

test('health endpoint returns non-sensitive degraded liveness by default', async () => {
  const previous = { ...process.env };
  process.env.OPENAI_API_KEY = 'sk-secret';
  delete process.env.LIKERTS_EXECUTION_DISABLED;
  delete process.env.LIKERTS_ADMISSION_STORE_URL;
  try {
    const res = response();
    await healthHandler(request({ headers: { host: 'likerts.example', 'x-correlation-id': 'corr_12345678' } }), res);
    const body = JSON.parse(res.body);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-correlation-id'), 'corr_12345678');
    assert.equal(body.status, 'DEGRADED');
    assert.equal(body.admissionStore.durabilityStatus, 'DEGRADED_NOT_GLOBALLY_DURABLE');
    assert.equal(JSON.stringify(body).includes('sk-secret'), false);
  } finally {
    process.env = previous;
  }
});

test('readiness fails closed when emergency execution disable is active', async () => {
  const previous = { ...process.env };
  process.env.LIKERTS_EXECUTION_DISABLED = 'true';
  try {
    const res = response();
    await healthHandler(request({ url: '/api/health?ready=1' }), res);
    const body = JSON.parse(res.body);

    assert.equal(res.statusCode, 503);
    assert.equal(body.status, 'DISABLED');
    assert.equal(body.execution.disabled, true);
  } finally {
    process.env = previous;
  }
});

test('authenticated readiness probes durable storage and exposes fleet fingerprints while execution is disabled', async () => {
  let probes = 0;
  const readinessToken = 'r'.repeat(32);
  const admission = {
    protection: {
      durability: 'shared-admission-store',
      processLocalFallback: false,
      globallyDurable: true,
      durabilityStatus: 'GLOBALLY_DURABLE',
      admissionStore: {
        contractVersion: 'admission-store-adapter-v1',
        mode: 'TEST_SHARED',
        durabilityStatus: 'GLOBALLY_DURABLE',
        globallyDurable: true,
        provider: 'TEST_SHARED',
        scope: 'SHARED_ACROSS_INSTANCES',
        atomicity: 'DISTRIBUTED_ATOMIC_ACQUIRE',
        releaseSemantics: 'ASYNC_IDEMPOTENT_LEASE',
        leaseTtlMs: 120_000,
        namespaceFingerprint: 'a'.repeat(64),
        databaseFingerprint: 'b'.repeat(64),
        policyFingerprint: 'c'.repeat(64),
        unitScheduleFingerprint: 'd'.repeat(64),
        clientIdentityVersion: 'anonymous-client-hmac-sha256-v1',
        clientIdentitySaltFingerprint: 'e'.repeat(64),
      },
    },
    async checkReady() { probes += 1; return true; },
  };
  const handler = createHealthApiHandler({
    env: {
      NODE_ENV: 'production',
      LIKERTS_EXECUTION_DISABLED: 'true',
      LIKERTS_READINESS_TOKEN: readinessToken,
      MCP_RATE_LIMIT_SALT: 's'.repeat(32),
    },
    admission,
  });

  const unauthorized = response();
  await handler(request({ url: '/api/health?ready=1' }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(probes, 0);

  const ready = response();
  await handler(request({
    url: '/api/health?ready=1',
    headers: { authorization: `Bearer ${readinessToken}` },
  }), ready);
  const body = JSON.parse(ready.body);

  assert.equal(ready.statusCode, 503);
  assert.equal(body.status, 'DISABLED');
  assert.equal(body.execution.disabled, true);
  assert.equal(body.admissionStore.namespaceFingerprint, 'a'.repeat(64));
  assert.equal(body.admissionStore.databaseFingerprint, 'b'.repeat(64));
  assert.equal(body.admissionStore.policyFingerprint, 'c'.repeat(64));
  assert.equal(body.admissionStore.unitScheduleFingerprint, 'd'.repeat(64));
  assert.equal(probes, 1);
});

test('production readiness fails closed without actual durable admission capability', async () => {
  const previous = { ...process.env };
  const readinessToken = 'r'.repeat(32);
  process.env.NODE_ENV = 'production';
  process.env.MCP_RATE_LIMIT_SALT = 's'.repeat(32);
  process.env.LIKERTS_ADMISSION_STORE_PROVIDER = 'upstash-redis-rest';
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'secret-token';
  process.env.LIKERTS_ADMISSION_NAMESPACE = 'likerts:production';
  process.env.LIKERTS_READINESS_TOKEN = readinessToken;
  delete process.env.LIKERTS_EXECUTION_DISABLED;
  try {
    const live = response();
    await healthHandler(request(), live);
    const liveBody = JSON.parse(live.body);
    assert.equal(live.statusCode, 200);
    assert.equal(liveBody.status, 'BLOCKED');
    assert.equal(liveBody.admissionStore.globallyDurable, false);
    assert.equal(JSON.stringify(liveBody).includes('secret'), false);

    const ready = response();
    await healthHandler(request({
      url: '/api/health?ready=1',
      headers: { authorization: `Bearer ${readinessToken}` },
    }), ready);
    const readyBody = JSON.parse(ready.body);
    assert.equal(ready.statusCode, 503);
    assert.equal(readyBody.status, 'BLOCKED');
    assert.equal(readyBody.admissionStore.durabilityStatus, 'SHARED_DURABLE_ADAPTER_REQUIRED');
  } finally {
    process.env = previous;
  }
});

test('health endpoint supports HEAD and rejects mutating methods', async () => {
  const head = response();
  await healthHandler(request({ method: 'HEAD' }), head);
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');

  const post = response();
  await healthHandler(request({ method: 'POST' }), post);
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('HEAD readiness requests stay metadata-only and never run the active probe', async () => {
  let probes = 0;
  const handler = createHealthApiHandler({
    env: { NODE_ENV: 'production', LIKERTS_READINESS_TOKEN: 'r'.repeat(32) },
    admission: {
      protection: {
        durability: 'shared-admission-store',
        processLocalFallback: false,
        globallyDurable: true,
        durabilityStatus: 'GLOBALLY_DURABLE',
        admissionStore: {
          contractVersion: 'admission-store-adapter-v1',
          mode: 'TEST_SHARED',
          durabilityStatus: 'GLOBALLY_DURABLE',
          globallyDurable: true,
          provider: 'TEST_SHARED',
          scope: 'SHARED_ACROSS_INSTANCES',
          atomicity: 'DISTRIBUTED_ATOMIC_ACQUIRE',
          releaseSemantics: 'ASYNC_IDEMPOTENT_LEASE',
          leaseTtlMs: 120_000,
          namespaceFingerprint: 'a'.repeat(64),
          databaseFingerprint: 'b'.repeat(64),
          policyFingerprint: 'c'.repeat(64),
          unitScheduleFingerprint: 'd'.repeat(64),
          clientIdentityVersion: 'anonymous-client-hmac-sha256-v1',
          clientIdentitySaltFingerprint: 'e'.repeat(64),
        },
      },
      async checkReady() { probes += 1; return true; },
    },
  });

  const head = response();
  await handler(request({ method: 'HEAD', url: '/api/health?ready=1' }), head);
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');
  assert.equal(probes, 0);
});

test('readiness performs a bounded live admission probe while liveness stays metadata-only', async () => {
  let probes = 0;
  const readinessToken = 'r'.repeat(32);
  const admission = {
    protection: {
      durability: 'shared-admission-store',
      processLocalFallback: false,
      globallyDurable: true,
      durabilityStatus: 'GLOBALLY_DURABLE',
      admissionStore: {
        contractVersion: 'admission-store-adapter-v1',
        mode: 'TEST_SHARED',
        durabilityStatus: 'GLOBALLY_DURABLE',
        globallyDurable: true,
        provider: 'TEST_SHARED',
        scope: 'SHARED_ACROSS_INSTANCES',
        atomicity: 'DISTRIBUTED_ATOMIC_ACQUIRE',
        releaseSemantics: 'ASYNC_IDEMPOTENT_LEASE',
        leaseTtlMs: 120_000,
        namespaceFingerprint: 'a'.repeat(64),
        databaseFingerprint: 'b'.repeat(64),
        policyFingerprint: 'c'.repeat(64),
        unitScheduleFingerprint: 'd'.repeat(64),
        clientIdentityVersion: 'anonymous-client-hmac-sha256-v1',
        clientIdentitySaltFingerprint: 'e'.repeat(64),
      },
    },
    async checkReady() { probes += 1; return false; },
  };
  const handler = createHealthApiHandler({
    env: { LIKERTS_READINESS_TOKEN: readinessToken },
    admission,
    readinessTimeoutMs: 100,
  });

  const live = response();
  await handler(request(), live);
  assert.equal(live.statusCode, 200);
  assert.equal(probes, 0);

  const unauthorized = response();
  for (let index = 0; index < 100; index += 1) {
    const attempt = index === 99 ? unauthorized : response();
    await handler(request({ url: '/api/health?ready=1' }), attempt);
    assert.equal(attempt.statusCode, 401);
    assert.equal(JSON.parse(attempt.body).code, 'READINESS_AUTH_REQUIRED');
  }
  assert.equal(unauthorized.headers.get('www-authenticate'), 'Bearer realm="likerts-readiness"');
  assert.equal(probes, 0);

  const wrongToken = response();
  await handler(request({
    url: '/api/health?ready=1',
    headers: { authorization: `Bearer ${'x'.repeat(32)}` },
  }), wrongToken);
  assert.equal(wrongToken.statusCode, 401);
  assert.equal(probes, 0);

  const ready = response();
  await handler(request({
    url: '/api/health?ready=1',
    headers: { authorization: `Bearer ${readinessToken}` },
  }), ready);
  const body = JSON.parse(ready.body);
  assert.equal(ready.statusCode, 503);
  assert.equal(probes, 1);
  assert.equal(body.status, 'BLOCKED');
  assert.equal(body.issues[0].code, 'ADMISSION_STORE_UNAVAILABLE');
  assert.equal(body.admissionStore.namespaceFingerprint, 'a'.repeat(64));
  assert.equal(body.admissionStore.databaseFingerprint, 'b'.repeat(64));
  assert.equal(body.admissionStore.policyFingerprint, 'c'.repeat(64));
  assert.equal(body.admissionStore.unitScheduleFingerprint, 'd'.repeat(64));
  assert.equal(JSON.stringify(body).includes('e'.repeat(64)), false, 'salt-derived identity fingerprint is not public health metadata');
  assert.equal(JSON.stringify(body).includes('private'), false);
});

test('degraded development readiness still probes its configured admission adapter', async () => {
  let probes = 0;
  const handler = createHealthApiHandler({
    env: {},
    admission: {
      protection: {
        durability: 'process-local-fallback',
        processLocalFallback: true,
        globallyDurable: false,
        durabilityStatus: 'DEGRADED_NOT_GLOBALLY_DURABLE',
        admissionStore: {
          contractVersion: 'admission-store-adapter-v1',
          mode: 'TEST_DEGRADED',
          durabilityStatus: 'DEGRADED_NOT_GLOBALLY_DURABLE',
          globallyDurable: false,
        },
      },
      async checkReady() { probes += 1; return false; },
    },
  });

  const ready = response();
  await handler(request({ url: '/api/health?ready=1' }), ready);
  assert.equal(ready.statusCode, 503);
  assert.equal(probes, 1);
  assert.equal(JSON.parse(ready.body).issues[0].code, 'ADMISSION_STORE_UNAVAILABLE');
});
