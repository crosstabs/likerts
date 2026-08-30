import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { AdmissionStoreError, assertAdmissionStoreAdapter } from './admission-store.js';
import {
  createUpstashAdmissionStore as createRawUpstashAdmissionStore,
  createUpstashRedisClient,
} from './upstash-admission-store.js';

const TEST_DATABASE_FINGERPRINT = 'd'.repeat(64);
const TEST_CLIENT_IDENTITY = Object.freeze({
  version: 'anonymous-client-hmac-sha256-v1',
  saltFingerprint: 'e'.repeat(64),
});

function createUpstashAdmissionStore(options = {}) {
  return createRawUpstashAdmissionStore({
    databaseFingerprint: TEST_DATABASE_FINGERPRINT,
    clientIdentity: TEST_CLIENT_IDENTITY,
    ...options,
  });
}

function fakeRedis({ evalResults = [], zremResults = [] } = {}) {
  const calls = [];
  return {
    calls,
    async eval(...args) {
      calls.push(['eval', ...args]);
      const result = evalResults.length > 0
        ? evalResults.shift()
        : ['READY', 'admission-store-adapter-v1', '1'];
      return typeof result === 'function' ? result(...args) : result;
    },
    async zrem(...args) {
      calls.push(['zrem', ...args]);
      const result = zremResults.length > 0 ? zremResults.shift() : 1;
      return typeof result === 'function' ? result(...args) : result;
    },
  };
}

test('declares the complete globally durable admission-store v1 contract without connection metadata', () => {
  const namespace = 'likerts:test';
  const store = createUpstashAdmissionStore({
    redis: fakeRedis(),
    namespace,
  });

  assertAdmissionStoreAdapter(store);
  const unitScheduleFingerprint = createHash('sha256')
    .update('version=synthetic-study-admission-units-v1\nquick=1\ndeep=3')
    .digest('hex');
  assert.deepEqual(store.metadata, {
    contractVersion: 'admission-store-adapter-v1',
    mode: 'UPSTASH_REDIS_REST',
    provider: 'UPSTASH_REDIS_REST',
    scope: 'SHARED_ACROSS_INSTANCES',
    durabilityStatus: 'GLOBALLY_DURABLE',
    globallyDurable: true,
    atomicity: 'DISTRIBUTED_ATOMIC_ACQUIRE',
    releaseSemantics: 'ASYNC_IDEMPOTENT_LEASE',
    leaseTtlMs: 120_000,
    namespaceFingerprint: createHash('sha256').update(namespace).digest('hex'),
    databaseFingerprint: TEST_DATABASE_FINGERPRINT,
    clientIdentityVersion: TEST_CLIENT_IDENTITY.version,
    clientIdentitySaltFingerprint: TEST_CLIENT_IDENTITY.saltFingerprint,
    unitScheduleFingerprint,
    policyFingerprint: store.metadata.policyFingerprint,
  });
  assert.match(store.metadata.policyFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(store.snapshot(), store.metadata);
  assert.notEqual(store.snapshot(), store.metadata);
});

test('enforces documented namespace, lease TTL, and operation timeout boundaries before Redis access', () => {
  const redis = fakeRedis();
  for (const options of [
    { namespace: '1234567' },
    { namespace: 'x'.repeat(129) },
    { namespace: 'unsafe{}' },
    { namespace: '_leading-underscore' },
    { namespace: 'likerts:test', leaseTtlMs: 60_999 },
    { namespace: 'likerts:test', leaseTtlMs: 300_001 },
    { namespace: 'likerts:test', timeoutMs: 249 },
    { namespace: 'likerts:test', timeoutMs: 10_001 },
  ]) {
    assert.throws(() => createUpstashAdmissionStore({ redis, ...options }), TypeError);
  }

  for (const options of [
    { namespace: '12345678', leaseTtlMs: 61_000, timeoutMs: 250 },
    { namespace: 'a.dot:_-namespace', leaseTtlMs: 120_000, timeoutMs: 2_500 },
    { namespace: 'x'.repeat(128), leaseTtlMs: 300_000, timeoutMs: 10_000 },
  ]) {
    assert.doesNotThrow(() => createUpstashAdmissionStore({ redis, ...options }));
  }
  assert.equal(redis.calls.length, 0);
});

test('requires canonical database, client identity, and unit-schedule inputs before Redis access', () => {
  const redis = fakeRedis();
  const base = { redis, namespace: 'likerts:test' };

  assert.throws(() => createRawUpstashAdmissionStore(base), TypeError);
  assert.throws(() => createRawUpstashAdmissionStore({
    ...base,
    databaseFingerprint: 'not-a-fingerprint',
    clientIdentity: TEST_CLIENT_IDENTITY,
  }), TypeError);
  assert.throws(() => createRawUpstashAdmissionStore({
    ...base,
    databaseFingerprint: TEST_DATABASE_FINGERPRINT,
    clientIdentity: { version: 'short', saltFingerprint: TEST_CLIENT_IDENTITY.saltFingerprint },
  }), TypeError);
  assert.throws(() => createUpstashAdmissionStore({ ...base, unitSchedule: { quick: 2, deep: 3 } }), TypeError);
  assert.throws(() => createUpstashAdmissionStore({ ...base, unitSchedule: { quick: 1, deep: 11 } }), TypeError);
  assert.equal(redis.calls.length, 0);
});

test('maps one atomic acquire EVAL to an exact asynchronous lease release', async () => {
  const redis = fakeRedis({
    evalResults: [(_script, _keys, args) => ['ACQUIRED', args[7], '120001']],
  });
  const store = createUpstashAdmissionStore({
    redis,
    namespace: 'likerts:test',
    limits: {
      runsPerClientWindow: 3,
      clientWindowMs: 60_000,
      maximumConcurrency: 2,
      processDailyBudget: 30,
      dailyBudgetWindowMs: 86_400_000,
    },
    leaseTtlMs: 120_000,
    timeoutMs: 500,
  });

  const release = await store.acquire({ clientKey: 'client-a', estimatedUnits: 4 });

  assert.equal(redis.calls.length, 1);
  const [, script, keys, args] = redis.calls[0];
  assert.match(script, /redis\.call\(['"]TIME['"]\)/);
  assert.match(script, /ZREMRANGEBYSCORE/);
  assert.match(script, /ZADD/);
  assert.equal(keys.length, 4);
  assert.match(keys[0], /:client:[a-f0-9]{64}$/);
  assert.match(keys[1], /:budget$/);
  assert.match(keys[2], /:leases$/);
  assert.match(keys[3], /:policy$/);
  assert.deepEqual(args.slice(0, 7), ['3', '60000', '2', '30', '86400000', '4', '120000']);
  assert.match(args[7], /^[0-9a-f-]{36}$/);
  assert.equal(args[8], store.metadata.policyFingerprint);

  await release();
  assert.deepEqual(redis.calls[1], ['zrem', keys[2], args[7]]);
});

test('double and concurrent release share one exact idempotent ZREM', async () => {
  const redis = fakeRedis({
    evalResults: [(_script, _keys, args) => ['ACQUIRED', args[7], 120001]],
  });
  const store = createUpstashAdmissionStore({ redis, namespace: 'likerts:test' });
  const release = await store.acquire({ clientKey: 'client-a' });

  await Promise.all([release(), release()]);
  await release();

  const releaseCalls = redis.calls.filter(([command]) => command === 'zrem');
  assert.equal(releaseCalls.length, 1);
  assert.equal(releaseCalls[0].length, 3);
});

test('release failures stay sanitized and double release does not repeat a failed ZREM', async () => {
  const secret = 'release-backend-secret';
  const redis = fakeRedis({
    evalResults: [(_script, _keys, args) => ['ACQUIRED', args[7], 120001]],
    zremResults: [() => { throw new Error(secret); }],
  });
  const store = createUpstashAdmissionStore({ redis, namespace: 'likerts:test' });
  const release = await store.acquire({ clientKey: 'client-a' });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      () => release(),
      (error) => error instanceof AdmissionStoreError
        && error.code === 'ADMISSION_STORE_UNAVAILABLE'
        && !error.message.includes(secret),
    );
  }
  assert.equal(redis.calls.filter(([command]) => command === 'zrem').length, 1);
});

test('malformed ZREM replies fail closed while accepting only exact idempotent outcomes', async () => {
  for (const malformed of [null, '0', '1', 2, -1]) {
    const redis = fakeRedis({
      evalResults: [(_script, _keys, args) => ['ACQUIRED', args[7], 120001]],
      zremResults: [malformed],
    });
    const store = createUpstashAdmissionStore({ redis, namespace: 'likerts:test' });
    const release = await store.acquire({ clientKey: 'client-a' });
    await assert.rejects(
      () => release(),
      (error) => error instanceof AdmissionStoreError && error.code === 'ADMISSION_STORE_UNAVAILABLE',
    );
  }

  for (const exact of [0, 1]) {
    const redis = fakeRedis({
      evalResults: [(_script, _keys, args) => ['ACQUIRED', args[7], 120001]],
      zremResults: [exact],
    });
    const store = createUpstashAdmissionStore({ redis, namespace: 'likerts:test' });
    const release = await store.acquire({ clientKey: 'client-a' });
    await assert.doesNotReject(() => release());
  }
});

test('maps a rate-limit verdict and its backend-derived retry boundary without returning a lease', async () => {
  const redis = fakeRedis({ evalResults: [['RATE_LIMITED', '3600']] });
  const store = createUpstashAdmissionStore({ redis, namespace: 'likerts:test' });

  await assert.rejects(
    () => store.acquire({ clientKey: 'client-a' }),
    (error) => error instanceof AdmissionStoreError
      && error.code === 'RATE_LIMITED'
      && error.message === 'This anonymous client has reached the synthetic study rate limit.'
      && error.retryAfterSeconds === 3600,
  );
  assert.equal(redis.calls.length, 1);
});

test('maps a concurrency-limit verdict at the one-second retry boundary', async () => {
  const store = createUpstashAdmissionStore({
    redis: fakeRedis({ evalResults: [['CONCURRENCY_LIMIT', 1]] }),
    namespace: 'likerts:test',
  });

  await assert.rejects(
    () => store.acquire({ clientKey: 'client-a' }),
    (error) => error instanceof AdmissionStoreError
      && error.code === 'CONCURRENCY_LIMIT'
      && error.retryAfterSeconds === 1,
  );
});

test('malformed acquire replies fail closed instead of manufacturing verdicts or leases', async () => {
  const malformedReplies = [
    null,
    {},
    [],
    ['UNKNOWN', '1'],
    ['RATE_LIMITED', '0'],
    ['RATE_LIMITED', '86401'],
    ['RATE_LIMITED', '1e2'],
    ['RATE_LIMITED', '1', 'extra'],
    (_script, _keys, args) => ['ACQUIRED', `${args[7]}-wrong`, '120001'],
  ];

  for (const reply of malformedReplies) {
    const store = createUpstashAdmissionStore({
      redis: fakeRedis({ evalResults: [reply] }),
      namespace: 'likerts:test',
    });
    await assert.rejects(
      () => store.acquire({ clientKey: 'client-a' }),
      (error) => error instanceof AdmissionStoreError
        && error.code === 'ADMISSION_STORE_UNAVAILABLE'
        && error.retryAfterSeconds === 30,
    );
  }
});

test('remote acquire failures are mapped to a sanitized AdmissionStoreError with no secret leakage', async () => {
  const secretToken = 'redis-token-super-secret';
  const secretUrl = 'https://secret-tenant.upstash.io';
  const namespace = 'private-production-namespace';
  const redis = fakeRedis({
    evalResults: [() => { throw new Error(`${secretToken} ${secretUrl} remote detail`); }],
  });
  const store = createUpstashAdmissionStore({ redis, namespace });

  let caught;
  try {
    await store.acquire({ clientKey: 'client-a' });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof AdmissionStoreError);
  assert.equal(caught.code, 'ADMISSION_STORE_UNAVAILABLE');
  assert.equal(caught.message, 'Admission control storage is temporarily unavailable.');
  assert.equal(caught.retryAfterSeconds, 30);
  const exposed = JSON.stringify({
    metadata: store.metadata,
    snapshot: store.snapshot(),
    error: { message: caught.message, stack: caught.stack, ...caught },
  });
  assert.doesNotMatch(exposed, new RegExp([secretToken, secretUrl, namespace].join('|')));
});

test('Lua denial precedence is rate, concurrency, then budget before any charge or lease creation', async () => {
  const redis = fakeRedis({ evalResults: [['BUDGET_EXHAUSTED', '86400']] });
  const store = createUpstashAdmissionStore({ redis, namespace: 'likerts:test' });

  await assert.rejects(
    () => store.acquire({ clientKey: 'client-a', estimatedUnits: 30 }),
    (error) => error instanceof AdmissionStoreError
      && error.code === 'BUDGET_EXHAUSTED'
      && error.retryAfterSeconds === 86_400,
  );

  const script = redis.calls[0][1];
  const backendTime = script.indexOf("redis.call('TIME')");
  const prune = script.indexOf("redis.call('ZREMRANGEBYSCORE'");
  const activeCount = script.indexOf("redis.call('ZCARD'");
  const rateDenial = script.indexOf('if clientCount >= clientLimit');
  const concurrencyDenial = script.indexOf('if inFlight >= concurrencyLimit');
  const budgetDenial = script.indexOf('if budgetUsed + estimatedUnits > budgetLimit');
  const leaseCreation = script.indexOf("redis.call('ZADD'");
  const rateCharge = script.indexOf("redis.call('INCR'");
  const budgetCharge = script.indexOf("redis.call('INCRBY'");
  assert.ok(backendTime < prune && prune < activeCount);
  assert.ok(rateDenial < concurrencyDenial && concurrencyDenial < budgetDenial);
  assert.ok(budgetDenial < leaseCreation && leaseCreation < rateCharge && rateCharge < budgetCharge);
  assert.match(script, /redis\.call\('ZADD', KEYS\[3\], 'NX', leaseExpiresAtMs, leaseId\)/);
  assert.match(script, /redis\.call\('PEXPIRE', KEYS\[3\], leaseTtlMs\)/);
  assert.ok(script.indexOf("redis.call('GET', KEYS[4])") < backendTime, 'policy mismatch must fail before backend time or admission mutation');
});

test('readiness atomically proves write, read, delete, and backend-time capability on a unique key', async () => {
  const redis = fakeRedis({
    evalResults: [
      ['READY', 'admission-store-adapter-v1', '1725000000000'],
      ['READY', 'admission-store-adapter-v1', '1725000000001'],
    ],
  });
  const store = createUpstashAdmissionStore({ redis, namespace: 'likerts:test' });

  assert.equal(await store.checkReady(), true);
  assert.equal(await store.checkReady(), true);
  assert.equal(redis.calls.length, 2);
  const [, script, keys, args] = redis.calls[0];
  assert.match(script, /redis\.call\(['"]TIME['"]\)/);
  assert.match(script, /redis\.call\('SET', KEYS\[1\], ARGV\[2\], 'PX', ARGV\[3\], 'NX'\)/);
  assert.match(script, /redis\.call\('GET', KEYS\[1\]\)/);
  assert.match(script, /redis\.call\('DEL', KEYS\[1\]\)/);
  assert.equal(keys.length, 2);
  assert.match(keys[0], /:readiness:[0-9a-f-]{36}$/);
  assert.match(keys[1], /:policy$/);
  assert.equal(args[0], 'admission-store-adapter-v1');
  assert.equal(args[1], keys[0].split(':').at(-1));
  assert.equal(args[2], '5000');
  assert.equal(args[3], store.metadata.policyFingerprint);
  assert.ok(script.indexOf("redis.call('GET', KEYS[2])") < script.indexOf("redis.call('SET', KEYS[1]"));
  assert.notEqual(redis.calls[1][2][0], keys[0]);
  assert.notEqual(redis.calls[1][3][1], args[1]);
});

test('malformed and remote readiness failures fail closed with sanitized errors', async () => {
  const secret = 'readiness-backend-secret';
  const failures = [
    null,
    ['READY', 'wrong-contract', '1725000000000'],
    ['READY', 'admission-store-adapter-v1', '0'],
    ['PROBE_FAILED'],
    () => { throw new Error(secret); },
  ];

  for (const failure of failures) {
    const store = createUpstashAdmissionStore({
      redis: fakeRedis({ evalResults: [failure] }),
      namespace: 'likerts:test',
    });
    await assert.rejects(
      () => store.checkReady(),
      (error) => error instanceof AdmissionStoreError
        && error.code === 'ADMISSION_STORE_UNAVAILABLE'
        && error.retryAfterSeconds === 30
        && !error.message.includes(secret),
    );
  }
});

test('Redis client uses one direct SDK request with retries and telemetry disabled', async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    throw new Error('simulated network failure');
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const client = createUpstashRedisClient({
    url: 'https://example.upstash.io',
    token: 'test-token',
    timeoutMs: 250,
  });

  await assert.rejects(() => client.eval('return 1', [], []));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.upstash.io');
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(requests[0].options.body), ['eval', 'return 1', 0]);
  assert.equal(Object.keys(requests[0].options.headers).some((name) => name.startsWith('Upstash-Telemetry-')), false);
});

test('Redis client accepts only root, default-port HTTPS Upstash REST origins', () => {
  const token = 'test-token';
  for (const url of [
    'http://tenant.upstash.io',
    'https://upstash.io',
    'https://tenant.upstash.io.evil.test',
    'https://user:password@tenant.upstash.io',
    'https://tenant.upstash.io:8443',
    'https://tenant.upstash.io/path',
    'https://tenant.upstash.io/.',
    'https://tenant.upstash.io/path/..',
    'https://tenant.upstash.io?query=value',
    'https://tenant.upstash.io#fragment',
    'https://ten\u0009ant.upstash.io',
  ]) {
    assert.throws(() => createUpstashRedisClient({ url, token, timeoutMs: 250 }), TypeError);
  }

  assert.doesNotThrow(() => createUpstashRedisClient({
    url: 'https://tenant.upstash.io', token, timeoutMs: 250,
  }));
  assert.doesNotThrow(() => createUpstashRedisClient({
    url: 'https://tenant.upstash.io:443/', token, timeoutMs: 10_000,
  }));
});

test('Redis clients derive a sanitized stable database identity from the canonical REST origin', () => {
  const token = 'test-token-database-identity';
  const first = createUpstashRedisClient({ url: 'https://tenant.upstash.io', token });
  const canonicalEquivalent = createUpstashRedisClient({ url: 'https://tenant.upstash.io:443/', token });
  const other = createUpstashRedisClient({ url: 'https://other.upstash.io', token });
  const options = {
    namespace: 'likerts:test',
    clientIdentity: TEST_CLIENT_IDENTITY,
  };
  const firstStore = createRawUpstashAdmissionStore({ ...options, redis: first });
  const equivalentStore = createRawUpstashAdmissionStore({ ...options, redis: canonicalEquivalent });
  const otherStore = createRawUpstashAdmissionStore({ ...options, redis: other });

  assert.match(firstStore.metadata.databaseFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(firstStore.metadata.databaseFingerprint, equivalentStore.metadata.databaseFingerprint);
  assert.notEqual(firstStore.metadata.databaseFingerprint, otherStore.metadata.databaseFingerprint);
  assert.throws(() => createRawUpstashAdmissionStore({
    ...options,
    redis: first,
    databaseFingerprint: 'f'.repeat(64),
  }), TypeError);
  const exposed = JSON.stringify([firstStore.metadata, equivalentStore.metadata, otherStore.metadata]);
  assert.equal(exposed.includes('tenant.upstash.io'), false);
  assert.equal(exposed.includes(token), false);
});

test('Redis client rejects missing, oversized, whitespace-padded, or control-bearing tokens', () => {
  const url = 'https://tenant.upstash.io';
  for (const token of [
    undefined,
    '',
    ' padded-token ',
    `embedded\u0000control`,
    `embedded\u0085control`,
    'x'.repeat(4_097),
  ]) {
    assert.throws(() => createUpstashRedisClient({ url, token, timeoutMs: 2_500 }), TypeError);
  }
  assert.doesNotThrow(() => createUpstashRedisClient({
    url,
    token: 'x'.repeat(4_096),
    timeoutMs: 2_500,
  }));
});
