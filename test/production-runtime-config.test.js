import assert from 'node:assert/strict';
import test from 'node:test';

import {
  READINESS_TOKEN_ENV,
  getPublicRuntimeHealth,
  readProductionRuntimeConfig,
  RuntimeConfigurationError,
  assertRuntimeCanExecute,
} from '../server/runtime-config.js';

const READINESS_TOKEN = 'r'.repeat(32);

const durableProtection = Object.freeze({
  durability: 'shared-admission-store',
  processLocalFallback: false,
  globallyDurable: true,
  durabilityStatus: 'GLOBALLY_DURABLE',
  admissionStore: Object.freeze({
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
  }),
});

test('runtime configuration rejects malformed and out-of-bounds production controls', () => {
  const config = readProductionRuntimeConfig({
    LIKERTS_EXECUTION_DISABLED: 'sometimes',
    MCP_RUN_MAX_CONCURRENCY: '0',
    MCP_RUNS_PER_HOUR: '51',
    LIKERTS_STAGE_TIMEOUT_MULTIPLIER: '4.5',
  });

  assert.equal(config.status, 'MISCONFIGURED');
  assert.deepEqual(config.issues.map((issue) => issue.field).sort(), [
    'LIKERTS_EXECUTION_DISABLED',
    'LIKERTS_STAGE_TIMEOUT_MULTIPLIER',
    'MCP_RUNS_PER_HOUR',
    'MCP_RUN_MAX_CONCURRENCY',
  ].sort());
  assert.equal(JSON.stringify(config).includes('secret'), false);
});

test('default runtime is bounded and marks in-memory admission as degraded durability', () => {
  const config = readProductionRuntimeConfig({});

  assert.equal(config.status, 'DEGRADED');
  assert.equal(config.execution.disabled, false);
  assert.equal(config.execution.syntheticRunsEnabled, true);
  assert.equal(config.limits.mcpHttpRequestsPerMinute, 90);
  assert.equal(config.limits.mcpRunMaxConcurrency, 2);
  assert.equal(config.admissionStore.mode, 'IN_MEMORY');
  assert.equal(config.admissionStore.durabilityStatus, 'DEGRADED_NOT_GLOBALLY_DURABLE');
});

test('runtime rejects a shared-store URL without an explicit implemented provider', () => {
  const config = readProductionRuntimeConfig({
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  });

  assert.equal(config.status, 'MISCONFIGURED');
  assert.equal(config.admissionStore.configured, true);
  assert.equal(config.admissionStore.durabilityStatus, 'SHARED_DURABLE_ADAPTER_REQUIRED');
  assert.ok(config.issues.some((entry) => entry.code === 'MISSING_PROVIDER'));
});

test('explicit Upstash runtime configuration is strict and never exposes credentials', () => {
  const valid = readProductionRuntimeConfig({
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'secret-token',
    LIKERTS_ADMISSION_NAMESPACE: 'likerts:production',
    LIKERTS_ADMISSION_LEASE_TTL_MS: '120000',
    LIKERTS_ADMISSION_STORE_TIMEOUT_MS: '2500',
    [READINESS_TOKEN_ENV]: READINESS_TOKEN,
    MCP_RATE_LIMIT_SALT: 's'.repeat(32),
  });
  assert.equal(valid.status, 'DEGRADED');
  assert.equal(valid.admissionStore.provider, 'upstash-redis-rest');
  assert.equal(JSON.stringify(valid).includes('secret-token'), false);

  const invalid = readProductionRuntimeConfig({
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    UPSTASH_REDIS_REST_URL: 'https://user:pass@example.upstash.io/?private=1',
    LIKERTS_ADMISSION_NAMESPACE: 'unstable namespace',
    LIKERTS_ADMISSION_LEASE_TTL_MS: '60000',
    LIKERTS_ADMISSION_STORE_TIMEOUT_MS: '99',
  });
  assert.equal(invalid.status, 'MISCONFIGURED');
  assert.ok(invalid.issues.some((entry) => entry.field === 'UPSTASH_REDIS_REST_TOKEN'));
  assert.ok(invalid.issues.some((entry) => entry.field === 'LIKERTS_ADMISSION_LEASE_TTL_MS'));
  assert.ok(invalid.issues.some((entry) => entry.field === 'LIKERTS_ADMISSION_STORE_TIMEOUT_MS'));

  const subMinimumLease = readProductionRuntimeConfig({
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'secret-token',
    LIKERTS_ADMISSION_NAMESPACE: 'likerts:production',
    LIKERTS_ADMISSION_LEASE_TTL_MS: '60999',
  });
  assert.ok(subMinimumLease.issues.some((entry) => entry.field === 'LIKERTS_ADMISSION_LEASE_TTL_MS'));
});

test('production runtime requires actual globally durable admission capability, not only a URL', () => {
  const urlOnly = readProductionRuntimeConfig({
    NODE_ENV: 'production',
    MCP_RATE_LIMIT_SALT: 's'.repeat(32),
    [READINESS_TOKEN_ENV]: READINESS_TOKEN,
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'secret-token',
    LIKERTS_ADMISSION_NAMESPACE: 'likerts:production',
  });

  assert.equal(urlOnly.status, 'BLOCKED');
  assert.equal(urlOnly.admissionStore.configured, true);
  assert.equal(urlOnly.admissionStore.globallyDurable, false);
  assert.equal(urlOnly.admissionStore.durabilityStatus, 'SHARED_DURABLE_ADAPTER_REQUIRED');

  assert.throws(
    () => assertRuntimeCanExecute(
      {
        NODE_ENV: 'production',
        MCP_RATE_LIMIT_SALT: 's'.repeat(32),
        [READINESS_TOKEN_ENV]: READINESS_TOKEN,
        LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
        UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'secret-token',
        LIKERTS_ADMISSION_NAMESPACE: 'likerts:production',
      },
      { synthetic: true },
    ),
    (error) => error instanceof RuntimeConfigurationError && error.code === 'DURABLE_ADMISSION_REQUIRED',
  );

  const actualAdapter = readProductionRuntimeConfig(
    {
      NODE_ENV: 'production',
      MCP_RATE_LIMIT_SALT: 's'.repeat(32),
      [READINESS_TOKEN_ENV]: READINESS_TOKEN,
      LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'secret-token',
      LIKERTS_ADMISSION_NAMESPACE: 'likerts:production',
    },
    { admissionProtection: durableProtection },
  );
  assert.equal(actualAdapter.status, 'OK');
  assert.equal(actualAdapter.admissionStore.globallyDurable, true);
  assert.equal(actualAdapter.admissionStore.namespaceFingerprint, 'a'.repeat(64));
  assert.equal(actualAdapter.admissionStore.databaseFingerprint, 'b'.repeat(64));
  assert.equal(actualAdapter.admissionStore.policyFingerprint, 'c'.repeat(64));
  assert.equal(actualAdapter.admissionStore.unitScheduleFingerprint, 'd'.repeat(64));
  assert.doesNotThrow(() => assertRuntimeCanExecute(
    { NODE_ENV: 'production', MCP_RATE_LIMIT_SALT: 's'.repeat(32), [READINESS_TOKEN_ENV]: READINESS_TOKEN },
    { synthetic: true, admissionProtection: durableProtection },
  ));
});

test('public runtime health exposes readiness without sensitive configuration values', () => {
  const health = getPublicRuntimeHealth({
    LIKERTS_EXECUTION_DISABLED: 'true',
    OPENAI_API_KEY: 'sk-secret',
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'secret-token',
    LIKERTS_ADMISSION_NAMESPACE: 'likerts:production',
    [READINESS_TOKEN_ENV]: READINESS_TOKEN,
    MCP_RATE_LIMIT_SALT: 's'.repeat(32),
  }, { now: () => '2030-01-01T00:00:00.000Z' });

  assert.equal(health.status, 'DISABLED');
  assert.equal(health.timestamp, '2030-01-01T00:00:00.000Z');
  assert.equal(health.execution.disabled, true);
  assert.equal(health.admissionStore.configured, true);
  assert.equal(JSON.stringify(health).includes('sk-secret'), false);
  assert.equal(JSON.stringify(health).includes('secret-token'), false);
  assert.equal(JSON.stringify(health).includes('policyFingerprint'), false);
});

test('readiness authentication token is strict, required for production or Upstash config, and never exposed', () => {
  const providerEnv = {
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'secret-token',
    LIKERTS_ADMISSION_NAMESPACE: 'likerts:production',
  };
  const missingForProvider = readProductionRuntimeConfig(providerEnv);
  assert.ok(missingForProvider.issues.some(({ field, code }) => field === READINESS_TOKEN_ENV && code === 'MISSING_TOKEN'));

  const missingForProduction = readProductionRuntimeConfig({
    NODE_ENV: 'production',
    MCP_RATE_LIMIT_SALT: 's'.repeat(32),
  });
  assert.ok(missingForProduction.issues.some(({ field, code }) => field === READINESS_TOKEN_ENV && code === 'MISSING_TOKEN'));

  for (const token of ['x'.repeat(31), 'x'.repeat(4_097), ` ${READINESS_TOKEN}`, `${READINESS_TOKEN}\n`]) {
    const config = readProductionRuntimeConfig({ ...providerEnv, [READINESS_TOKEN_ENV]: token });
    assert.ok(config.issues.some(({ field, code }) => field === READINESS_TOKEN_ENV && code === 'INVALID_TOKEN'));
  }

  const valid = readProductionRuntimeConfig({ ...providerEnv, [READINESS_TOKEN_ENV]: READINESS_TOKEN });
  assert.equal(valid.issues.some(({ field }) => field === READINESS_TOKEN_ENV), false);
  assert.equal(JSON.stringify(valid).includes(READINESS_TOKEN), false);
});

test('shared admission requires a strict stable HMAC salt in every environment', () => {
  const providerEnv = {
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'secret-token',
    LIKERTS_ADMISSION_NAMESPACE: 'likerts:production',
    [READINESS_TOKEN_ENV]: READINESS_TOKEN,
  };

  const missing = readProductionRuntimeConfig(providerEnv);
  assert.ok(missing.issues.some(({ field, code }) => field === 'MCP_RATE_LIMIT_SALT' && code === 'MISSING_SECRET'));

  for (const salt of ['x'.repeat(31), 'x'.repeat(4_097), ` ${'x'.repeat(32)}`, `${'x'.repeat(32)}\n`]) {
    const invalid = readProductionRuntimeConfig({ ...providerEnv, MCP_RATE_LIMIT_SALT: salt });
    assert.ok(invalid.issues.some(({ field, code }) => field === 'MCP_RATE_LIMIT_SALT' && code === 'INVALID_SECRET'));
  }

  const valid = readProductionRuntimeConfig({ ...providerEnv, MCP_RATE_LIMIT_SALT: 's'.repeat(32) });
  assert.equal(valid.issues.some(({ field }) => field === 'MCP_RATE_LIMIT_SALT'), false);
  assert.equal(JSON.stringify(valid).includes('s'.repeat(32)), false);
});

test('runtime execution assertion fails closed for disable and invalid config', () => {
  assert.throws(
    () => assertRuntimeCanExecute({ LIKERTS_EXECUTION_DISABLED: '1' }),
    (error) => error instanceof RuntimeConfigurationError && error.code === 'EXECUTION_DISABLED',
  );
  assert.throws(
    () => assertRuntimeCanExecute({ MCP_PUBLIC_SYNTHETIC_RUNS_ENABLED: 'false' }, { synthetic: true }),
    (error) => error instanceof RuntimeConfigurationError && error.code === 'SYNTHETIC_RUNS_DISABLED',
  );
  assert.throws(
    () => assertRuntimeCanExecute({ MCP_RUN_MAX_CONCURRENCY: '100' }),
    (error) => error instanceof RuntimeConfigurationError && error.code === 'RUNTIME_CONFIG_INVALID',
  );
});
