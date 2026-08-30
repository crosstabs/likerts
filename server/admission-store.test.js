import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMISSION_STORE_CONTRACT_VERSION,
  ASYNC_IDEMPOTENT_LEASE_RELEASE,
  AdmissionStoreError,
  DISTRIBUTED_ATOMIC_ACQUIRE,
  GLOBALLY_DURABLE_ADMISSION,
  assertAdmissionStoreAdapter,
  createInMemoryAdmissionStore,
} from './admission-store.js';

function durableStore(overrides = {}) {
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
      ...overrides.metadata,
    },
    async acquire() { return async () => {}; },
    snapshot() { return {}; },
    async checkReady() { return true; },
    ...overrides,
  };
}

test('in-memory admission store implements the shared adapter contract with explicit degraded durability', async () => {
  const store = createInMemoryAdmissionStore({
    limits: { maximumConcurrency: 1, runsPerClientWindow: 10, clientWindowMs: 60_000, processDailyBudget: 10 },
  });

  assertAdmissionStoreAdapter(store);
  assert.equal(store.metadata.contractVersion, 'admission-store-adapter-v1');
  assert.equal(store.metadata.mode, 'IN_MEMORY');
  assert.equal(store.metadata.durabilityStatus, 'DEGRADED_NOT_GLOBALLY_DURABLE');

  const release = await store.acquire({ clientKey: 'client-a', estimatedUnits: 2 });
  await assert.rejects(
    () => store.acquire({ clientKey: 'client-b', estimatedUnits: 1 }),
    (error) => error instanceof AdmissionStoreError && error.code === 'CONCURRENCY_LIMIT',
  );
  release();
  release();

  const afterRelease = await store.acquire({ clientKey: 'client-b', estimatedUnits: 1 });
  afterRelease();
});

test('globally durable adapters must prove the complete atomic lease contract', () => {
  assertAdmissionStoreAdapter(durableStore());
  for (const adapter of [
    durableStore({ metadata: { atomicity: 'BEST_EFFORT' } }),
    durableStore({ metadata: { releaseSemantics: 'IDEMPOTENT' } }),
    durableStore({ metadata: { scope: 'PROCESS_LOCAL' } }),
    durableStore({ metadata: { leaseTtlMs: 60_000 } }),
    durableStore({ metadata: { namespaceFingerprint: 'unverified' } }),
    durableStore({ checkReady: undefined }),
    {
      metadata: {
        contractVersion: ADMISSION_STORE_CONTRACT_VERSION,
        durabilityStatus: GLOBALLY_DURABLE_ADMISSION,
      },
      async acquire() { return undefined; },
      snapshot() { return {}; },
    },
  ]) {
    assert.throws(() => assertAdmissionStoreAdapter(adapter), TypeError);
  }
});

test('in-memory admission store atomically enforces client windows and budget before mutation', async () => {
  let now = 1_000;
  const store = createInMemoryAdmissionStore({
    now: () => now,
    limits: { maximumConcurrency: 5, runsPerClientWindow: 1, clientWindowMs: 60_000, processDailyBudget: 2 },
  });

  const first = await store.acquire({ clientKey: 'client-a', estimatedUnits: 1 });
  first();
  await assert.rejects(
    () => store.acquire({ clientKey: 'client-a', estimatedUnits: 1 }),
    (error) => error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 60,
  );

  const other = await store.acquire({ clientKey: 'client-b', estimatedUnits: 1 });
  other();
  await assert.rejects(
    () => store.acquire({ clientKey: 'client-c', estimatedUnits: 1 }),
    (error) => error.code === 'BUDGET_EXHAUSTED',
  );

  const snapshot = store.snapshot();
  assert.equal(snapshot.inFlight, 0);
  assert.equal(snapshot.budgetUsed, 2);
  assert.equal(snapshot.clientWindows, 2);

  now += 24 * 60 * 60 * 1_000;
  const nextDay = await store.acquire({ clientKey: 'client-a', estimatedUnits: 1 });
  nextDay();
});
