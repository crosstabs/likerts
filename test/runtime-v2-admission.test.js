import assert from 'node:assert/strict';
import test from 'node:test';

import {
  anonymousClientIdentityPolicy,
  anonymousClientKey,
  createAnonymousStudyAdmission,
} from '../server/mcp-abuse-controls.js';
import {
  ADMISSION_STORE_CONTRACT_VERSION,
  ASYNC_IDEMPOTENT_LEASE_RELEASE,
  DISTRIBUTED_ATOMIC_ACQUIRE,
  GLOBALLY_DURABLE_ADMISSION,
} from '../server/admission-store.js';
import { admissionUnitsForResearchMode } from '../server/synthetic-study-pipeline.js';

function durableStore({ acquire } = {}) {
  return {
    metadata: {
      contractVersion: ADMISSION_STORE_CONTRACT_VERSION,
      mode: 'TEST_SHARED',
      durabilityStatus: GLOBALLY_DURABLE_ADMISSION,
      globallyDurable: true,
      provider: 'TEST_SHARED',
      scope: 'SHARED_ACROSS_INSTANCES',
      atomicity: DISTRIBUTED_ATOMIC_ACQUIRE,
      releaseSemantics: ASYNC_IDEMPOTENT_LEASE_RELEASE,
      leaseTtlMs: 120_000,
      namespaceFingerprint: 'a'.repeat(64),
      databaseFingerprint: 'b'.repeat(64),
      policyFingerprint: 'c'.repeat(64),
      unitScheduleFingerprint: 'd'.repeat(64),
      clientIdentityVersion: 'anonymous-client-hmac-sha256-v1',
      clientIdentitySaltFingerprint: 'e'.repeat(64),
    },
    acquire: acquire || (async () => async () => {}),
    snapshot() { return {}; },
    async checkReady() { return true; },
  };
}

test('DEEP admission costs more quota than QUICK with safe bounded configuration', () => {
  assert.equal(admissionUnitsForResearchMode('QUICK', {}), 1);
  assert.ok(admissionUnitsForResearchMode('DEEP', {}) > admissionUnitsForResearchMode('QUICK', {}));
  assert.equal(admissionUnitsForResearchMode('DEEP', { DEEP_ADMISSION_UNITS: '999' }), 10);
});

test('anonymous client keys use stable HMAC identity and trust Vercel forwarding only on Vercel', () => {
  const env = { MCP_RATE_LIMIT_SALT: 's'.repeat(32) };
  const vercelHeaders = { 'x-vercel-forwarded-for': '198.51.100.9, 10.0.0.1', 'x-forwarded-for': '203.0.113.4' };
  const localHeaders = { ...vercelHeaders, 'x-real-ip': '192.0.2.7' };
  const vercelKey = anonymousClientKey(vercelHeaders, { ...env, VERCEL: '1' });
  assert.equal(vercelKey, anonymousClientKey(vercelHeaders, { ...env, VERCEL: '1' }));
  assert.equal(vercelKey, anonymousClientKey({ ...vercelHeaders, 'x-forwarded-for': '192.0.2.99' }, { ...env, VERCEL: '1' }));
  assert.match(vercelKey, /^[a-f0-9]{64}$/);
  assert.notEqual(vercelKey, anonymousClientKey(localHeaders, env));
  assert.equal(
    anonymousClientKey({ 'x-forwarded-for': '198.51.100.1' }, { ...env, NODE_ENV: 'production' }),
    anonymousClientKey({ 'x-forwarded-for': '203.0.113.9' }, { ...env, NODE_ENV: 'production' }),
    'non-Vercel production must not trust a caller-supplied forwarding header',
  );
});

test('anonymous client identity exposes only a versioned salt fingerprint for policy binding', () => {
  const firstSalt = 'first-secret-salt-value'.repeat(2);
  const secondSalt = 'second-secret-salt-value'.repeat(2);
  const first = anonymousClientIdentityPolicy({ MCP_RATE_LIMIT_SALT: firstSalt });
  const repeated = anonymousClientIdentityPolicy({ MCP_RATE_LIMIT_SALT: firstSalt });
  const second = anonymousClientIdentityPolicy({ MCP_RATE_LIMIT_SALT: secondSalt });
  const vercelProduction = anonymousClientIdentityPolicy({
    MCP_RATE_LIMIT_SALT: firstSalt,
    VERCEL: '1',
    NODE_ENV: 'production',
  });
  const vercelPreview = anonymousClientIdentityPolicy({
    MCP_RATE_LIMIT_SALT: firstSalt,
    VERCEL_ENV: 'preview',
  });
  const unverifiedProduction = anonymousClientIdentityPolicy({
    MCP_RATE_LIMIT_SALT: firstSalt,
    NODE_ENV: 'production',
  });

  assert.deepEqual(first, repeated);
  assert.equal(first.version, 'anonymous-client-hmac-sha256-v1:nonproduction-forwarded-or-real-ip');
  assert.equal(vercelProduction.version, 'anonymous-client-hmac-sha256-v1:vercel-protected-client-ip-production');
  assert.equal(vercelPreview.version, 'anonymous-client-hmac-sha256-v1:vercel-protected-client-ip-nonproduction');
  assert.equal(unverifiedProduction.version, 'anonymous-client-hmac-sha256-v1:fail-safe-unverified-production-ingress');
  assert.equal(new Set([
    first.version,
    vercelProduction.version,
    vercelPreview.version,
    unverifiedProduction.version,
  ]).size, 4);
  assert.match(first.saltFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.saltFingerprint, vercelProduction.saltFingerprint);
  assert.notEqual(first.saltFingerprint, second.saltFingerprint);
  assert.equal(JSON.stringify(first).includes(firstSalt), false);
});

test('globally durable admission uses one contract-checked shared store without double-counting fallback', async () => {
  const calls = [];
  let durableReleases = 0;
  const admission = createAnonymousStudyAdmission({
    admissionStore: durableStore({
      async acquire(request) {
        calls.push(request);
        return async () => { durableReleases += 1; };
      },
    }),
  });

  const release = await admission.acquire({ clientKey: 'client', estimatedUnits: 3 });
  assert.deepEqual(calls, [{ clientKey: 'client', estimatedUnits: 3 }]);
  assert.equal(admission.protection.durability, 'shared-admission-store');
  assert.equal(admission.protection.processLocalFallback, false);
  assert.equal(admission.protection.globallyDurable, true);
  assert.equal(await admission.checkReady(), true);
  assert.deepEqual(admission.snapshot(), {});
  await release();
  await release();
  assert.equal(durableReleases, 1);

  const fallback = createAnonymousStudyAdmission();
  assert.equal(fallback.protection.durability, 'process-local-fallback');
  assert.equal(fallback.protection.globallyDurable, false);
});

test('unverified durable callbacks cannot self-declare capability or leak diagnostics', async () => {
  assert.throws(
    () => createAnonymousStudyAdmission({ durableAdapter: { async acquire() { return undefined; } } }),
    TypeError,
  );

  const admission = createAnonymousStudyAdmission({
    externalCheck: async () => ({ allowed: false, code: 'PRIVATE_POLICY_CODE', message: 'adapter-private-diagnostic' }),
  });
  await assert.rejects(
    () => admission.acquire({ clientKey: 'client', estimatedUnits: 1 }),
    (error) => error.code === 'ADMISSION_STORE_UNAVAILABLE'
      && error.message === 'Admission control is temporarily unavailable. Try again shortly.'
      && !error.message.includes('private'),
  );
});
