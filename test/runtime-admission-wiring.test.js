import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createHealthApiHandler } from '../api/health.js';
import { createSegmentPerspectiveApiHandler } from '../api/segment-perspective.js';
import { createSyntheticStudyApiHandler } from '../api/synthetic-study.js';
import { createLikertsMcpHandler } from '../server/mcp-server.js';

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    headers,
    body: '',
    payload: null,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    end(value = '') { this.body += value; },
  };
}

function durableAdmission(calls) {
  const admissionStore = Object.freeze({
    contractVersion: 'admission-store-adapter-v1',
    globallyDurable: true,
    durabilityStatus: 'GLOBALLY_DURABLE',
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
  });
  return {
    protection: Object.freeze({
      globallyDurable: true,
      durabilityStatus: 'GLOBALLY_DURABLE',
      durability: 'shared-admission-store',
      processLocalFallback: false,
      admissionStore,
    }),
    async acquire(request) {
      calls.push(request);
      return async () => {};
    },
    async checkReady() { return true; },
  };
}

test('REST and health factories retain one injected admission object with a non-network model stub', async () => {
  const calls = [];
  const readinessToken = 'r'.repeat(32);
  const admission = durableAdmission(calls);
  const synthetic = createSyntheticStudyApiHandler({
    env: {},
    admission,
    logger: { info() {}, warn() {}, error() {} },
    runStudy: async () => ({ study: { title: 'test' } }),
  });
  const segment = createSegmentPerspectiveApiHandler({
    env: {},
    admission,
    logger: { info() {}, warn() {}, error() {} },
    runPerspective: async () => ({ answer: 'test' }),
  });
  const health = createHealthApiHandler({ env: { LIKERTS_READINESS_TOKEN: readinessToken }, admission });

  const syntheticResponse = response();
  await synthetic({
    method: 'POST',
    headers: { host: 'likerts.example', 'content-type': 'application/json' },
    body: { prompt: 'Would this audience adopt a shared workspace?', audience: 'Operations leaders', panelSize: 100 },
  }, syntheticResponse);
  assert.equal(syntheticResponse.statusCode, 200);

  const segmentResponse = response();
  await segment({
    method: 'POST',
    headers: { host: 'likerts.example', 'content-type': 'application/json' },
    body: {},
  }, segmentResponse);
  assert.equal(segmentResponse.statusCode, 400, 'invalid input must stop before model/admission work');

  const healthResponse = response();
  await health({
    method: 'GET',
    url: '/api/health?ready=1',
    headers: { authorization: `Bearer ${readinessToken}` },
  }, healthResponse);
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(JSON.parse(healthResponse.body).admissionStore.globallyDurable, true);
  assert.equal(calls.length, 1);
});

test('MCP factory accepts the same injected admission object without constructing a default store', () => {
  const calls = [];
  const admission = durableAdmission(calls);
  const handler = createLikertsMcpHandler({
    admission,
    reportError: () => {},
    runStudy: async () => { throw new Error('model must not run in factory wiring test'); },
  });
  assert.equal(typeof handler.fetch, 'function');
  assert.equal(calls.length, 0);
  void handler.close();
});

test('default REST, MCP, and health composition imports and defaults to the runtime admission singleton', async () => {
  // The legacy anonymousStudyAdmission remains an explicit dev/test seam. The
  // deployed entrypoints must instead import the singleton composed by
  // runtime-admission-store, so metadata, readiness, and paid execution cannot
  // accidentally select different stores.
  const modules = [
    ['synthetic REST', new URL('../api/synthetic-study.js', import.meta.url)],
    ['segment REST', new URL('../api/segment-perspective.js', import.meta.url)],
    ['MCP HTTP', new URL('../api/mcp.js', import.meta.url)],
    ['MCP server', new URL('../server/mcp-server.js', import.meta.url)],
    ['health', new URL('../api/health.js', import.meta.url)],
  ];

  for (const [name, url] of modules) {
    const source = await readFile(url, 'utf8');
    assert.match(source, /runtimeAdmission/, `${name} must import the runtime admission singleton`);
    assert.match(source, /admission\s*=\s*runtimeAdmission/, `${name} must use runtimeAdmission as its default dependency`);
  }
});
