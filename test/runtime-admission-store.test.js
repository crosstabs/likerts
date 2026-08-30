import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeAdmission } from '../server/runtime-admission-store.js';

test('runtime admission auto-wires the explicitly configured Upstash provider', async () => {
  const admission = createRuntimeAdmission({
    env: {
      LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
      LIKERTS_ADMISSION_NAMESPACE: 'likerts:tests',
      LIKERTS_ADMISSION_LEASE_TTL_MS: '120000',
      LIKERTS_ADMISSION_STORE_TIMEOUT_MS: '2500',
      LIKERTS_READINESS_TOKEN: 'r'.repeat(32),
      MCP_RATE_LIMIT_SALT: 's'.repeat(32),
    },
  });

  assert.equal(admission.protection.globallyDurable, true);
  assert.equal(admission.protection.durability, 'shared-admission-store');
  assert.equal(admission.protection.processLocalFallback, false);
  assert.equal(admission.snapshot().durabilityStatus, 'GLOBALLY_DURABLE');
});

test('runtime admission keeps an in-memory fallback when provider configuration is absent', () => {
  const admission = createRuntimeAdmission({ env: {} });
  assert.equal(admission.protection.globallyDurable, false);
  assert.equal(admission.protection.admissionStore.mode, 'IN_MEMORY');
});

test('runtime admission delegates readiness and snapshots to an injected store', async () => {
  const store = {
    metadata: {
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
    async acquire() { return async () => {}; },
    snapshot() { return { marker: 'snapshot' }; },
    async checkReady() { return { ready: true }; },
  };
  const admission = createRuntimeAdmission({ env: {}, admissionStore: store });
  assert.deepEqual(admission.snapshot(), { marker: 'snapshot' });
  assert.deepEqual(await admission.checkReady(), { ready: true });
});
