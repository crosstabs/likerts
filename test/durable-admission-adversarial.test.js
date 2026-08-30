import assert from 'node:assert/strict';
import test from 'node:test';

import { AdmissionStoreError } from '../server/admission-store.js';
import { anonymousClientIdentityPolicy } from '../server/mcp-abuse-controls.js';
import { createUpstashAdmissionStore } from '../server/upstash-admission-store.js';

const SECRET = 'upstash-test-token-must-never-escape';

/**
 * A deterministic, shared Redis/Lua port. It implements the agreed EVAL
 * tuple contract rather than an in-process admission adapter, so separate
 * adapters exercise the same atomic backend state.
 */
class FakeRedisLuaBackend {
  constructor({ nowMs = 1_000_000 } = {}) {
    this.nowMs = nowMs;
    this.clientWindows = new Map();
    this.budgetWindows = new Map();
    this.activeLeases = new Map();
    this.policyBindings = new Map();
    this.evalCalls = [];
    this.zremCalls = [];
    this.nextFailure = null;
    this.loseNextAcquireResponse = false;
    this.readinessFailure = null;
  }

  advance(milliseconds) {
    this.nowMs += milliseconds;
  }

  failNext(error = new Error(`backend failure: ${SECRET}`)) {
    this.nextFailure = error;
  }

  loseNextResponseAfterCommit() {
    this.loseNextAcquireResponse = true;
  }

  failReadiness(error = new Error(`readiness failure: ${SECRET}`)) {
    this.readinessFailure = error;
  }

  snapshot() {
    return {
      clientWindows: [...this.clientWindows.entries()].map(([key, value]) => ({ key, ...value })),
      budgetWindows: [...this.budgetWindows.entries()].map(([key, value]) => ({ key, ...value })),
      activeLeases: [...this.activeLeases.entries()].map(([key, leases]) => ({ key, leases: [...leases.entries()] })),
      policyBindings: [...this.policyBindings.entries()].map(([key, fingerprint]) => ({ key, fingerprint })),
    };
  }

  async eval(script, keys, args) {
    this.evalCalls.push({ script, keys: [...keys], args: [...args] });
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      throw failure;
    }

    // checkReady(): atomically bind/validate policy, then exercise a unique write probe.
    if (keys.length === 2 && args.length === 4) {
      if (this.readinessFailure) throw this.readinessFailure;
      const boundPolicy = this.policyBindings.get(keys[1]);
      if (boundPolicy && boundPolicy !== args[3]) return ['POLICY_MISMATCH'];
      if (!boundPolicy) this.policyBindings.set(keys[1], args[3]);
      return ['READY', args[0], this.nowMs];
    }

    // acquire(): redis.eval(script, [client, budget, leases, policy], [limits..., leaseId, policyFingerprint])
    if (keys.length === 4 && args.length === 9) {
      const policyKey = keys[3];
      const policyFingerprint = args[8];
      const boundPolicy = this.policyBindings.get(policyKey);
      if (boundPolicy && boundPolicy !== policyFingerprint) return ['POLICY_MISMATCH'];
      if (!boundPolicy) this.policyBindings.set(policyKey, policyFingerprint);
      return this.#acquire(keys.slice(0, 3), args.slice(0, 8));
    }
    throw new Error(`Unexpected EVAL contract: keys=${keys.length}, args=${args.length}.`);
  }

  async zrem(activeLeaseKey, leaseId) {
    this.zremCalls.push({ activeLeaseKey, leaseId });
    const leases = this.activeLeases.get(activeLeaseKey);
    if (!leases) return 0;
    const removed = leases.delete(leaseId) ? 1 : 0;
    if (leases.size === 0) this.activeLeases.delete(activeLeaseKey);
    return removed;
  }

  #pruneLeases(activeLeaseKey) {
    const leases = this.activeLeases.get(activeLeaseKey);
    if (!leases) return new Map();
    for (const [leaseId, expiresAt] of leases) {
      if (expiresAt <= this.nowMs) leases.delete(leaseId);
    }
    if (leases.size === 0) this.activeLeases.delete(activeLeaseKey);
    return this.activeLeases.get(activeLeaseKey) || new Map();
  }

  #candidateWindow(map, key, windowMs) {
    const existing = map.get(key);
    if (existing && existing.resetAt > this.nowMs) return { value: existing, isNew: false };
    return { value: { count: 0, resetAt: this.nowMs + windowMs }, isNew: true };
  }

  #acquire([clientKey, budgetKey, activeLeaseKey], rawArgs) {
    const [
      runsPerClientWindow,
      clientWindowMs,
      maximumConcurrency,
      processDailyBudget,
      dailyBudgetWindowMs,
      estimatedUnits,
      leaseTtlMs,
      leaseId,
    ] = rawArgs.map((value) => Number.isSafeInteger(Number(value)) ? Number(value) : value);

    const clientCandidate = this.#candidateWindow(this.clientWindows, clientKey, clientWindowMs);
    const budgetCandidate = this.#candidateWindow(this.budgetWindows, budgetKey, dailyBudgetWindowMs);
    const clientWindow = clientCandidate.value;
    const budgetWindow = budgetCandidate.value;
    const leases = this.#pruneLeases(activeLeaseKey);

    if (clientWindow.count >= runsPerClientWindow) {
      return ['RATE_LIMITED', Math.max(1, Math.ceil((clientWindow.resetAt - this.nowMs) / 1_000))];
    }
    if (leases.size >= maximumConcurrency) {
      const earliestExpiry = Math.min(...leases.values());
      return ['CONCURRENCY_LIMIT', Math.max(1, Math.ceil((earliestExpiry - this.nowMs) / 1_000))];
    }
    if (budgetWindow.count + estimatedUnits > processDailyBudget) {
      return ['BUDGET_EXHAUSTED', Math.max(1, Math.ceil((budgetWindow.resetAt - this.nowMs) / 1_000))];
    }

    // This is the one atomic mutation point for the fake Lua backend.
    if (clientCandidate.isNew) this.clientWindows.set(clientKey, clientWindow);
    if (budgetCandidate.isNew) this.budgetWindows.set(budgetKey, budgetWindow);
    clientWindow.count += 1;
    budgetWindow.count += estimatedUnits;
    leases.set(leaseId, this.nowMs + leaseTtlMs);
    this.activeLeases.set(activeLeaseKey, leases);

    if (this.loseNextAcquireResponse) {
      this.loseNextAcquireResponse = false;
      throw new Error(`response lost after commit: ${SECRET}`);
    }
    return ['ACQUIRED', leaseId, this.nowMs + leaseTtlMs];
  }
}

function createStore(backend, limits = {}, options = {}) {
  return createUpstashAdmissionStore({
    redis: backend,
    namespace: 'likerts-test-admission',
    databaseFingerprint: 'd'.repeat(64),
    clientIdentity: {
      version: 'anonymous-client-hmac-sha256-v1',
      saltFingerprint: 'e'.repeat(64),
    },
    unitSchedule: { quick: 1, deep: 3 },
    leaseTtlMs: 120_000,
    timeoutMs: 500,
    limits: {
      maximumConcurrency: 3,
      runsPerClientWindow: 20,
      clientWindowMs: 60_000,
      processDailyBudget: 100,
      dailyBudgetWindowMs: 86_400_000,
      ...limits,
    },
    ...options,
  });
}

function isAdmissionFailure(error, code) {
  return error instanceof AdmissionStoreError && error.code === code;
}

async function expectAdmissionFailure(operation, code) {
  await assert.rejects(operation, (error) => isAdmissionFailure(error, code));
}

test('Upstash admission atomically enforces exact global concurrency across independent adapters', async () => {
  const backend = new FakeRedisLuaBackend();
  const firstInstance = createStore(backend, { maximumConcurrency: 3 });
  const secondInstance = createStore(backend, { maximumConcurrency: 3 });

  const attempts = await Promise.allSettled(
    Array.from({ length: 40 }, (_, index) => (index % 2 ? secondInstance : firstInstance).acquire({
      clientKey: `client-${index}`,
      estimatedUnits: 1,
    })),
  );
  const allowed = attempts.filter((result) => result.status === 'fulfilled');
  const denied = attempts.filter((result) => result.status === 'rejected');

  assert.equal(allowed.length, 3);
  assert.equal(denied.length, 37);
  for (const result of denied) assert.equal(isAdmissionFailure(result.reason, 'CONCURRENCY_LIMIT'), true);
  assert.equal(backend.snapshot().activeLeases[0].leases.length, 3);

  await Promise.all(allowed.map((result) => result.value()));
  const replacement = await secondInstance.acquire({ clientKey: 'after-release', estimatedUnits: 1 });
  await replacement();
});

test('a shared namespace rejects concurrency-policy drift before admission state mutates', async () => {
  const backend = new FakeRedisLuaBackend();
  const canonical = createStore(backend, { maximumConcurrency: 2 });
  const drifted = createStore(backend, { maximumConcurrency: 3 });

  const canonicalRelease = await canonical.acquire({ clientKey: 'canonical-client', estimatedUnits: 1 });
  const beforeMismatch = backend.snapshot();
  await expectAdmissionFailure(
    () => drifted.acquire({ clientKey: 'drifted-client', estimatedUnits: 1 }),
    'ADMISSION_STORE_UNAVAILABLE',
  );
  assert.deepEqual(backend.snapshot(), beforeMismatch);
  await canonicalRelease();
});

test('a shared namespace rejects ingress identity-source drift before acquire state mutation', async () => {
  const backend = new FakeRedisLuaBackend();
  const salt = 's'.repeat(32);
  const vercelIdentity = anonymousClientIdentityPolicy({
    MCP_RATE_LIMIT_SALT: salt,
    VERCEL: '1',
    VERCEL_ENV: 'production',
  });
  const unverifiedProductionIdentity = anonymousClientIdentityPolicy({
    MCP_RATE_LIMIT_SALT: salt,
    NODE_ENV: 'production',
  });
  assert.notEqual(vercelIdentity.version, unverifiedProductionIdentity.version);

  const canonical = createStore(backend, {}, { clientIdentity: vercelIdentity });
  const drifted = createStore(backend, {}, { clientIdentity: unverifiedProductionIdentity });
  const release = await canonical.acquire({ clientKey: 'canonical-client', estimatedUnits: 1 });
  const beforeMismatch = backend.snapshot();

  await expectAdmissionFailure(
    () => drifted.acquire({ clientKey: 'drifted-client', estimatedUnits: 1 }),
    'ADMISSION_STORE_UNAVAILABLE',
  );
  assert.deepEqual(backend.snapshot(), beforeMismatch);
  await release();
});

test('readiness rejects ingress identity-source drift without probing or mutating admission state', async () => {
  const backend = new FakeRedisLuaBackend();
  const salt = 's'.repeat(32);
  const vercelIdentity = anonymousClientIdentityPolicy({
    MCP_RATE_LIMIT_SALT: salt,
    VERCEL_ENV: 'production',
  });
  const nonproductionIdentity = anonymousClientIdentityPolicy({
    MCP_RATE_LIMIT_SALT: salt,
  });
  const canonical = createStore(backend, {}, { clientIdentity: vercelIdentity });
  const drifted = createStore(backend, {}, { clientIdentity: nonproductionIdentity });

  assert.equal(await canonical.checkReady(), true);
  const beforeMismatch = backend.snapshot();
  const callsBeforeMismatch = backend.evalCalls.length;
  await expectAdmissionFailure(() => drifted.checkReady(), 'ADMISSION_STORE_UNAVAILABLE');

  assert.deepEqual(backend.snapshot(), beforeMismatch);
  assert.equal(backend.evalCalls.length, callsBeforeMismatch + 1);
  assert.equal(backend.evalCalls.at(-1).keys.length, 2);
});

test('a shared namespace rejects every safety-relevant policy drift before state mutation', async (context) => {
  const cases = [
    ['rate limit', { limits: { runsPerClientWindow: 21 } }],
    ['rate window', { limits: { clientWindowMs: 60_001 } }],
    ['budget limit', { limits: { processDailyBudget: 101 } }],
    ['budget window', { limits: { dailyBudgetWindowMs: 86_400_001 } }],
    ['lease TTL', { leaseTtlMs: 120_001 }],
    ['HMAC salt', { clientIdentity: { version: 'anonymous-client-hmac-sha256-v1', saltFingerprint: 'f'.repeat(64) } }],
    ['HMAC identity version', { clientIdentity: { version: 'anonymous-client-hmac-sha256-v2', saltFingerprint: 'e'.repeat(64) } }],
    ['DEEP unit schedule', { unitSchedule: { quick: 1, deep: 4 } }],
    ['database identity', { databaseFingerprint: 'f'.repeat(64) }],
  ];

  for (const [name, drift] of cases) {
    await context.test(name, async () => {
      const backend = new FakeRedisLuaBackend();
      const canonical = createStore(backend);
      const { limits: limitDrift = {}, ...optionDrift } = drift;
      const drifted = createStore(backend, limitDrift, optionDrift);
      const release = await canonical.acquire({ clientKey: 'canonical-client', estimatedUnits: 1 });
      const beforeMismatch = backend.snapshot();

      await expectAdmissionFailure(
        () => drifted.acquire({ clientKey: 'drifted-client', estimatedUnits: 1 }),
        'ADMISSION_STORE_UNAVAILABLE',
      );
      assert.deepEqual(backend.snapshot(), beforeMismatch);
      await release();
    });
  }
});

test('identical policy bindings survive rolling instances and readiness rejects drift without touching counters', async () => {
  const backend = new FakeRedisLuaBackend();
  const first = createStore(backend);
  const rollingReplacement = createStore(backend);

  assert.equal(await first.checkReady(), true);
  const afterBind = backend.snapshot();
  assert.equal(afterBind.policyBindings.length, 1);
  assert.equal(afterBind.clientWindows.length, 0);
  assert.equal(await rollingReplacement.checkReady(), true);
  assert.deepEqual(backend.snapshot(), afterBind);

  const drifted = createStore(backend, { maximumConcurrency: 4 });
  await expectAdmissionFailure(() => drifted.checkReady(), 'ADMISSION_STORE_UNAVAILABLE');
  assert.deepEqual(backend.snapshot(), afterBind);

  const release = await rollingReplacement.acquire({ clientKey: 'rolling-client', estimatedUnits: 1 });
  await release();
});

test('Upstash admission shares client windows and weighted budget without mutating state on denial', async () => {
  const backend = new FakeRedisLuaBackend();
  const firstInstance = createStore(backend, {
    maximumConcurrency: 5,
    runsPerClientWindow: 2,
    processDailyBudget: 5,
  });
  const secondInstance = createStore(backend, {
    maximumConcurrency: 5,
    runsPerClientWindow: 2,
    processDailyBudget: 5,
  });

  const first = await firstInstance.acquire({ clientKey: 'one-client', estimatedUnits: 1 });
  await first();
  const second = await secondInstance.acquire({ clientKey: 'one-client', estimatedUnits: 1 });
  await second();
  const beforeRateDenial = backend.snapshot();
  await expectAdmissionFailure(
    () => firstInstance.acquire({ clientKey: 'one-client', estimatedUnits: 1 }),
    'RATE_LIMITED',
  );
  assert.deepEqual(backend.snapshot(), beforeRateDenial, 'a rate denial must not consume budget or create a lease');

  const weighted = await secondInstance.acquire({ clientKey: 'deep-client', estimatedUnits: 3 });
  await weighted();
  const beforeBudgetDenial = backend.snapshot();
  await expectAdmissionFailure(
    () => firstInstance.acquire({ clientKey: 'another-client', estimatedUnits: 1 }),
    'BUDGET_EXHAUSTED',
  );
  assert.deepEqual(backend.snapshot(), beforeBudgetDenial, 'a budget denial must not create a client window or lease');
});

test('Upstash admission uses backend time at exact client and budget window boundaries', async () => {
  const backend = new FakeRedisLuaBackend({ nowMs: 50_000 });
  const firstInstance = createStore(backend, {
    maximumConcurrency: 5,
    runsPerClientWindow: 1,
    clientWindowMs: 10_000,
    processDailyBudget: 2,
    dailyBudgetWindowMs: 10_000,
  });
  const secondInstance = createStore(backend, {
    maximumConcurrency: 5,
    runsPerClientWindow: 1,
    clientWindowMs: 10_000,
    processDailyBudget: 2,
    dailyBudgetWindowMs: 10_000,
  });

  const first = await firstInstance.acquire({ clientKey: 'boundary-client', estimatedUnits: 2 });
  await first();
  backend.advance(9_999);
  await expectAdmissionFailure(
    () => secondInstance.acquire({ clientKey: 'boundary-client', estimatedUnits: 1 }),
    'RATE_LIMITED',
  );
  backend.advance(1);
  const atBoundary = await secondInstance.acquire({ clientKey: 'boundary-client', estimatedUnits: 2 });
  await atBoundary();
});

test('expired leases recover crash capacity and stale or double releases cannot free another holder', async () => {
  const backend = new FakeRedisLuaBackend();
  const firstInstance = createStore(backend, { maximumConcurrency: 1 }, { leaseTtlMs: 61_000 });
  const secondInstance = createStore(backend, { maximumConcurrency: 1 }, { leaseTtlMs: 61_000 });

  const crashedRelease = await firstInstance.acquire({ clientKey: 'crashed-worker', estimatedUnits: 1 });
  await expectAdmissionFailure(
    () => secondInstance.acquire({ clientKey: 'blocked-before-expiry', estimatedUnits: 1 }),
    'CONCURRENCY_LIMIT',
  );

  backend.advance(61_000);
  const replacementRelease = await secondInstance.acquire({ clientKey: 'replacement-worker', estimatedUnits: 1 });
  await crashedRelease();
  await crashedRelease();

  await expectAdmissionFailure(
    () => firstInstance.acquire({ clientKey: 'must-stay-blocked', estimatedUnits: 1 }),
    'CONCURRENCY_LIMIT',
  );
  await replacementRelease();
  assert.equal(backend.zremCalls.filter(({ leaseId }) => leaseId).length, 2, 'each distinct lease must release exactly once');
});

test('backend failures and response loss fail closed with sanitized admission errors', async () => {
  const backend = new FakeRedisLuaBackend();
  const store = createStore(backend);

  backend.failNext();
  await assert.rejects(
    () => store.acquire({ clientKey: 'backend-down', estimatedUnits: 1 }),
    (error) => error instanceof AdmissionStoreError
      && error.code === 'ADMISSION_STORE_UNAVAILABLE'
      && !error.message.includes(SECRET),
  );
  assert.equal(backend.snapshot().activeLeases.length, 0);

  let modelCalls = 0;
  backend.loseNextResponseAfterCommit();
  await assert.rejects(
    async () => {
      const release = await store.acquire({ clientKey: 'lost-response', estimatedUnits: 1 });
      modelCalls += 1;
      await release();
    },
    (error) => error instanceof AdmissionStoreError
      && error.code === 'ADMISSION_STORE_UNAVAILABLE'
      && !error.message.includes(SECRET),
  );
  assert.equal(modelCalls, 0, 'uncertain admission must not begin paid work');
  assert.equal(backend.snapshot().activeLeases.length, 1, 'a response-lost committed lease must not be silently treated as absent');
});

test('readiness and snapshots are sanitized when the durable backend is unavailable', async () => {
  const backend = new FakeRedisLuaBackend();
  const store = createStore(backend);

  assert.equal(await store.checkReady(), true);
  assert.equal(await store.checkReady(), true);
  const readinessCalls = backend.evalCalls.slice(-2);
  for (const call of readinessCalls) {
    assert.equal(call.keys.length, 2, 'readiness must use a short-lived probe key plus the policy binding key');
    assert.equal(call.args.length, 4, 'readiness must send contract version, probe data, and policy fingerprint');
    assert.equal(call.args[0], 'admission-store-adapter-v1');
    assert.equal(call.args[3], store.metadata.policyFingerprint);
  }
  assert.notEqual(readinessCalls[0].keys[0], readinessCalls[1].keys[0], 'readiness probes must not share a reusable key');
  assert.notEqual(readinessCalls[0].args[1], readinessCalls[1].args[1], 'readiness probes must use unique opaque IDs');

  assert.equal(store.metadata.scope, 'SHARED_ACROSS_INSTANCES');
  assert.equal(store.metadata.leaseTtlMs, 120_000);
  assert.match(store.metadata.namespaceFingerprint, /^[a-f0-9]{64}$/);
  assert.match(store.metadata.databaseFingerprint, /^[a-f0-9]{64}$/);
  assert.match(store.metadata.policyFingerprint, /^[a-f0-9]{64}$/);
  assert.match(store.metadata.clientIdentitySaltFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(store.metadata).includes('likerts-test-admission'), false);
  const snapshot = await store.snapshot();
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false);

  backend.failReadiness();
  await assert.rejects(
    () => store.checkReady(),
    (error) => error instanceof AdmissionStoreError
      && error.code === 'ADMISSION_STORE_UNAVAILABLE'
      && !error.message.includes(SECRET),
  );
});

test('Upstash admission rejects unsafe namespace, lease, and timeout settings before contacting Redis', () => {
  const backend = new FakeRedisLuaBackend();
  assert.throws(
    () => createStore(backend, {}, { namespace: 'short' }),
    /namespace/i,
  );
  assert.throws(
    () => createStore(backend, {}, { leaseTtlMs: 60_000 }),
    /leaseTtlMs/i,
  );
  assert.throws(
    () => createStore(backend, {}, { timeoutMs: 249 }),
    /timeoutMs/i,
  );
  assert.equal(backend.evalCalls.length, 0);
});
