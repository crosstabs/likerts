export const ADMISSION_STORE_CONTRACT_VERSION = 'admission-store-adapter-v1';
export const DEGRADED_IN_MEMORY_DURABILITY = 'DEGRADED_NOT_GLOBALLY_DURABLE';
export const GLOBALLY_DURABLE_ADMISSION = 'GLOBALLY_DURABLE';
export const DISTRIBUTED_ATOMIC_ACQUIRE = 'DISTRIBUTED_ATOMIC_ACQUIRE';
export const ASYNC_IDEMPOTENT_LEASE_RELEASE = 'ASYNC_IDEMPOTENT_LEASE';
export const SHARED_ACROSS_INSTANCES = 'SHARED_ACROSS_INSTANCES';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export class AdmissionStoreError extends Error {
  constructor(code, message, retryAfterSeconds = null) {
    super(message);
    this.name = 'AdmissionStoreError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function positiveInteger(value, fallback, minimum = 1) {
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

function normalizedLimits(limits = {}) {
  return {
    maximumConcurrency: positiveInteger(limits.maximumConcurrency, 2),
    runsPerClientWindow: positiveInteger(limits.runsPerClientWindow, 3),
    clientWindowMs: positiveInteger(limits.clientWindowMs, HOUR_MS),
    processDailyBudget: positiveInteger(limits.processDailyBudget, 30),
    dailyBudgetWindowMs: positiveInteger(limits.dailyBudgetWindowMs, DAY_MS),
  };
}

export function assertAdmissionStoreAdapter(adapter) {
  if (!adapter || typeof adapter.acquire !== 'function' || typeof adapter.snapshot !== 'function') {
    throw new TypeError('Admission store adapters must expose acquire() and snapshot().');
  }
  if (adapter.metadata?.contractVersion !== ADMISSION_STORE_CONTRACT_VERSION) {
    throw new TypeError(`Admission store adapters must declare ${ADMISSION_STORE_CONTRACT_VERSION}.`);
  }
  if (!adapter.metadata?.durabilityStatus) {
    throw new TypeError('Admission store adapters must declare a durabilityStatus.');
  }
  const claimsGlobalDurability = adapter.metadata.globallyDurable === true
    || adapter.metadata.durabilityStatus === GLOBALLY_DURABLE_ADMISSION;
  if (claimsGlobalDurability && (
    adapter.metadata.globallyDurable !== true
    || adapter.metadata.durabilityStatus !== GLOBALLY_DURABLE_ADMISSION
    || adapter.metadata.atomicity !== DISTRIBUTED_ATOMIC_ACQUIRE
    || adapter.metadata.releaseSemantics !== ASYNC_IDEMPOTENT_LEASE_RELEASE
    || adapter.metadata.scope !== SHARED_ACROSS_INSTANCES
    || typeof adapter.metadata.provider !== 'string'
    || adapter.metadata.provider.length < 1
    || !Number.isInteger(adapter.metadata.leaseTtlMs)
    || adapter.metadata.leaseTtlMs < 61_000
    || adapter.metadata.leaseTtlMs > 300_000
    || !/^[a-f0-9]{64}$/.test(adapter.metadata.namespaceFingerprint || '')
    || !/^[a-f0-9]{64}$/.test(adapter.metadata.databaseFingerprint || '')
    || !/^[a-f0-9]{64}$/.test(adapter.metadata.policyFingerprint || '')
    || !/^[a-f0-9]{64}$/.test(adapter.metadata.unitScheduleFingerprint || '')
    || typeof adapter.metadata.clientIdentityVersion !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(adapter.metadata.clientIdentityVersion)
    || !/^[a-f0-9]{64}$/.test(adapter.metadata.clientIdentitySaltFingerprint || '')
    || typeof adapter.checkReady !== 'function'
  )) {
    throw new TypeError('Globally durable admission stores must declare a shared provider, bounded lease, canonical policy/database/namespace/identity fingerprints, distributed atomic acquire, async idempotent lease release, and checkReady().');
  }
  return adapter;
}

export function createInMemoryAdmissionStore({
  limits = {},
  now = Date.now,
  maximumClientKeys = 10_000,
} = {}) {
  const configuredLimits = normalizedLimits(limits);
  const clients = new Map();
  let inFlight = 0;
  let budgetWindowStartedAt = now();
  let budgetUsed = 0;

  function prune(timestamp) {
    for (const [key, value] of clients) {
      if (value.resetAt <= timestamp) clients.delete(key);
    }
    while (clients.size > maximumClientKeys) clients.delete(clients.keys().next().value);
  }

  function resetBudgetIfNeeded(timestamp) {
    if (timestamp - budgetWindowStartedAt >= configuredLimits.dailyBudgetWindowMs) {
      budgetWindowStartedAt = timestamp;
      budgetUsed = 0;
    }
  }

  return {
    metadata: Object.freeze({
      contractVersion: ADMISSION_STORE_CONTRACT_VERSION,
      mode: 'IN_MEMORY',
      durabilityStatus: DEGRADED_IN_MEMORY_DURABILITY,
      globallyDurable: false,
      atomicity: 'SINGLE_PROCESS_EVENT_LOOP',
      releaseSemantics: 'IDEMPOTENT',
    }),

    async acquire({ clientKey = 'anonymous', estimatedUnits = 1 } = {}) {
      const units = positiveInteger(estimatedUnits, 1);
      const timestamp = now();
      resetBudgetIfNeeded(timestamp);
      prune(timestamp);

      const normalizedClientKey = String(clientKey || 'anonymous');
      const existing = clients.get(normalizedClientKey);
      const client = existing && existing.resetAt > timestamp
        ? existing
        : { count: 0, resetAt: timestamp + configuredLimits.clientWindowMs };

      if (client.count >= configuredLimits.runsPerClientWindow) {
        throw new AdmissionStoreError(
          'RATE_LIMITED',
          'This anonymous client has reached the synthetic study rate limit.',
          Math.max(1, Math.ceil((client.resetAt - timestamp) / 1_000)),
        );
      }
      if (inFlight >= configuredLimits.maximumConcurrency) {
        throw new AdmissionStoreError('CONCURRENCY_LIMIT', 'The synthetic study service is busy. Try again shortly.', 30);
      }
      if (budgetUsed + units > configuredLimits.processDailyBudget) {
        throw new AdmissionStoreError('BUDGET_EXHAUSTED', 'The synthetic study budget is currently unavailable.');
      }

      if (client !== existing) clients.set(normalizedClientKey, client);
      client.count += 1;
      inFlight += 1;
      budgetUsed += units;

      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight = Math.max(0, inFlight - 1);
      };
    },

    snapshot() {
      return {
        contractVersion: ADMISSION_STORE_CONTRACT_VERSION,
        durabilityStatus: DEGRADED_IN_MEMORY_DURABILITY,
        inFlight,
        budgetUsed,
        clientWindows: clients.size,
      };
    },

    async checkReady() {
      return true;
    },
  };
}
