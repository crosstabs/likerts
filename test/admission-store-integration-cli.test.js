import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const script = path.resolve('scripts/verify-admission-store-integration.mjs');

function runCli(extraEnv = {}) {
  return spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH, ...extraEnv },
    encoding: 'utf8',
  });
}

test('admission-store integration CLI refuses without explicit opt-in', () => {
  const secret = 'do-not-print-this-token';
  const result = runCli({
    UPSTASH_REDIS_REST_URL: 'https://secret-example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: secret,
    LIKERTS_ADMISSION_NAMESPACE: 'likerts:verification:no-network',
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {
    status: 'FAILED',
    code: 'INTEGRATION_OPT_IN_REQUIRED',
  });
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stderr.includes(secret), false);
});

test('admission-store integration CLI rejects invalid config without contacting a backend', () => {
  const secret = 'still-must-not-be-printed';
  const result = runCli({
    LIKERTS_ADMISSION_INTEGRATION: '1',
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    LIKERTS_ADMISSION_NAMESPACE: 'production',
    UPSTASH_REDIS_REST_TOKEN: secret,
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {
    status: 'FAILED',
    code: 'INTEGRATION_CONFIG_INVALID',
  });
  assert.equal(result.stderr.includes(secret), false);
});

test('admission-store integration config parser accepts only a dedicated verification namespace', async () => {
  const { readAdmissionStoreIntegrationConfiguration } = await import('../scripts/verify-admission-store-integration.mjs');
  const config = readAdmissionStoreIntegrationConfiguration({
    LIKERTS_ADMISSION_INTEGRATION: '1',
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'test-token',
    LIKERTS_ADMISSION_NAMESPACE: 'likerts:verification:unit-test',
    MCP_RATE_LIMIT_SALT: 's'.repeat(32),
  });

  assert.equal(config.provider, 'upstash-redis-rest');
  assert.equal(config.namespace, 'likerts:verification:unit-test');
  assert.equal(config.leaseTtlMs, 120_000);
  assert.equal(config.timeoutMs, 2_500);

  assert.throws(
    () => readAdmissionStoreIntegrationConfiguration({
      LIKERTS_ADMISSION_INTEGRATION: '1',
      LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
      LIKERTS_ADMISSION_NAMESPACE: 'likerts:production',
      MCP_RATE_LIMIT_SALT: 's'.repeat(32),
    }),
    (error) => error.code === 'INTEGRATION_CONFIG_INVALID',
  );
});

test('admission-store integration runner uses two clients and emits only a sanitized verification report', async () => {
  const { runAdmissionStoreIntegrationCli } = await import('../scripts/verify-admission-store-integration.mjs');
  const env = {
    LIKERTS_ADMISSION_INTEGRATION: '1',
    LIKERTS_ADMISSION_STORE_PROVIDER: 'upstash-redis-rest',
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'private-test-token',
    LIKERTS_ADMISSION_NAMESPACE: 'likerts:verification:runner-test',
    MCP_RATE_LIMIT_SALT: 's'.repeat(32),
  };
  const state = { active: 0, budget: 0, clients: new Set() };
  let clientCount = 0;
  let stdout = '';
  let stderr = '';
  const exitCode = await runAdmissionStoreIntegrationCli({
    env,
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } },
    createRedisClient() { clientCount += 1; return { id: clientCount }; },
    createStore({ redis }) {
      assert.ok(redis.id === 1 || redis.id === 2);
      return {
        async checkReady() { return true; },
        async acquire({ clientKey, estimatedUnits }) {
          if (state.clients.has(clientKey)) throw Object.assign(new Error('rate'), { code: 'RATE_LIMITED' });
          if (state.active >= 2) throw Object.assign(new Error('concurrency'), { code: 'CONCURRENCY_LIMIT' });
          if (state.budget + estimatedUnits > 5) throw Object.assign(new Error('budget'), { code: 'BUDGET_EXHAUSTED' });
          state.clients.add(clientKey);
          state.active += 1;
          state.budget += estimatedUnits;
          let released = false;
          return async () => {
            if (released) return;
            released = true;
            state.active -= 1;
          };
        },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
  assert.equal(clientCount, 2);
  const report = JSON.parse(stdout);
  assert.equal(report.status, 'VERIFIED');
  assert.deepEqual(report.exactConcurrent, { requested: 3, granted: 2 });
  assert.deepEqual(report.denials, { concurrency: 1, rate: 1, weightedBudget: 1 });
  assert.match(report.namespaceFingerprint, /^[a-f0-9]{16}$/);
  assert.equal(stdout.includes(env.UPSTASH_REDIS_REST_TOKEN), false);
  assert.equal(stdout.includes(env.UPSTASH_REDIS_REST_URL), false);
  assert.equal(stdout.includes('integration-rate'), false);
});
