import { createHash, randomUUID } from 'node:crypto';

import { Redis } from '@upstash/redis';

import {
  ADMISSION_STORE_CONTRACT_VERSION,
  ASYNC_IDEMPOTENT_LEASE_RELEASE,
  AdmissionStoreError,
  DISTRIBUTED_ATOMIC_ACQUIRE,
  GLOBALLY_DURABLE_ADMISSION,
  SHARED_ACROSS_INSTANCES,
  assertAdmissionStoreAdapter,
} from './admission-store.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_LEASE_TTL_MS = 2 * MINUTE_MS;
const POLICY_BINDING_VERSION = 'namespace-admission-policy-v1';
const DATABASE_IDENTITY_VERSION = 'upstash-redis-rest-database-v1';
const UNIT_SCHEDULE_VERSION = 'synthetic-study-admission-units-v1';
const REDIS_DATABASE_FINGERPRINTS = new WeakMap();
const UNAVAILABLE_MESSAGE = 'Admission control storage is temporarily unavailable.';
const DENIAL_MESSAGES = Object.freeze({
  RATE_LIMITED: 'This anonymous client has reached the synthetic study rate limit.',
  CONCURRENCY_LIMIT: 'The synthetic study service is busy. Try again shortly.',
  BUDGET_EXHAUSTED: 'The synthetic study budget is currently unavailable.',
});

const ACQUIRE_SCRIPT = `
local clientLimit = tonumber(ARGV[1])
local clientWindowMs = tonumber(ARGV[2])
local concurrencyLimit = tonumber(ARGV[3])
local budgetLimit = tonumber(ARGV[4])
local budgetWindowMs = tonumber(ARGV[5])
local estimatedUnits = tonumber(ARGV[6])
local leaseTtlMs = tonumber(ARGV[7])
local leaseId = ARGV[8]
local policyFingerprint = ARGV[9]

if not clientLimit or not clientWindowMs or not concurrencyLimit or
   not budgetLimit or not budgetWindowMs or not estimatedUnits or
   not leaseTtlMs or not leaseId or not policyFingerprint then
  return {'STORE_ERROR', '0'}
end

local boundPolicy = redis.call('GET', KEYS[4])
if boundPolicy and boundPolicy ~= policyFingerprint then
  return {'POLICY_MISMATCH'}
end
if not boundPolicy then
  local bound = redis.call('SET', KEYS[4], policyFingerprint, 'NX')
  if not bound then
    boundPolicy = redis.call('GET', KEYS[4])
    if boundPolicy ~= policyFingerprint then return {'POLICY_MISMATCH'} end
  end
end

local serverTime = redis.call('TIME')
local nowMs = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', nowMs)

local clientCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local inFlight = tonumber(redis.call('ZCARD', KEYS[3]) or '0')
local budgetUsed = tonumber(redis.call('GET', KEYS[2]) or '0')

local function retrySeconds(ttlMs, fallbackMs)
  if not ttlMs or ttlMs < 1 then ttlMs = fallbackMs end
  return tostring(math.max(1, math.ceil(ttlMs / 1000)))
end

if clientCount >= clientLimit then
  return {'RATE_LIMITED', retrySeconds(redis.call('PTTL', KEYS[1]), clientWindowMs)}
end

if inFlight >= concurrencyLimit then
  local earliestLease = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  local retryMs = leaseTtlMs
  if earliestLease[2] then retryMs = tonumber(earliestLease[2]) - nowMs end
  return {'CONCURRENCY_LIMIT', retrySeconds(retryMs, leaseTtlMs)}
end

if budgetUsed + estimatedUnits > budgetLimit then
  return {'BUDGET_EXHAUSTED', retrySeconds(redis.call('PTTL', KEYS[2]), budgetWindowMs)}
end

local leaseExpiresAtMs = nowMs + leaseTtlMs
local leaseAdded = redis.call('ZADD', KEYS[3], 'NX', leaseExpiresAtMs, leaseId)
if leaseAdded ~= 1 then return {'STORE_ERROR', '0'} end

local chargedClientCount = redis.call('INCR', KEYS[1])
if chargedClientCount == 1 then redis.call('PEXPIRE', KEYS[1], clientWindowMs) end
local chargedBudget = redis.call('INCRBY', KEYS[2], estimatedUnits)
if chargedBudget == estimatedUnits then redis.call('PEXPIRE', KEYS[2], budgetWindowMs) end
redis.call('PEXPIRE', KEYS[3], leaseTtlMs)

return {'ACQUIRED', leaseId, tostring(leaseExpiresAtMs)}
`;

const READINESS_SCRIPT = `
local policyFingerprint = ARGV[4]
if not policyFingerprint then return {'PROBE_FAILED'} end

local boundPolicy = redis.call('GET', KEYS[2])
if boundPolicy and boundPolicy ~= policyFingerprint then
  return {'POLICY_MISMATCH'}
end
if not boundPolicy then
  local bound = redis.call('SET', KEYS[2], policyFingerprint, 'NX')
  if not bound then
    boundPolicy = redis.call('GET', KEYS[2])
    if boundPolicy ~= policyFingerprint then return {'POLICY_MISMATCH'} end
  end
end

local stored = redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3], 'NX')
if not stored then return {'PROBE_FAILED'} end
local observed = redis.call('GET', KEYS[1])
local removed = redis.call('DEL', KEYS[1])
if observed ~= ARGV[2] or removed ~= 1 then return {'PROBE_FAILED'} end
local serverTime = redis.call('TIME')
local nowMs = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
return {'READY', ARGV[1], tostring(nowMs)}
`;

function positiveSafeInteger(value, fallback, label) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return candidate;
}

function boundedSafeInteger(value, fallback, label, minimum, maximum) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return candidate;
}

function normalizeNamespace(namespace) {
  if (typeof namespace !== 'string' || namespace.length < 8 || namespace.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(namespace)) {
    throw new TypeError('Admission-store namespace must contain 8-128 safe characters.');
  }
  return namespace;
}

function normalizeRedisUrl(url) {
  if (typeof url !== 'string' || url.length < 1 || url !== url.trim()) {
    throw new TypeError('Upstash Redis REST URL is required and must be HTTPS.');
  }
  const isExactRootOrigin = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.upstash\.io(?::443)?\/?$/i.test(url);
  if (!isExactRootOrigin) {
    throw new TypeError('Upstash Redis REST URL is required and must be HTTPS.');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError('Upstash Redis REST URL is required and must be HTTPS.');
  }
  const isUpstashHostname = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.upstash\.io$/i.test(parsed.hostname);
  if (parsed.protocol !== 'https:' || !isUpstashHostname || parsed.port
    || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('Upstash Redis REST URL is required and must be HTTPS.');
  }
  return url;
}

function normalizeRedisToken(token) {
  if (typeof token !== 'string' || token.length < 1 || token.length > 4_096
    || token !== token.trim() || /\p{Cc}/u.test(token)) {
    throw new TypeError('Upstash Redis REST token is required.');
  }
  return token;
}

function normalizeLimits(limits = {}) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new TypeError('Admission-store limits must be an object.');
  }
  return {
    maximumConcurrency: positiveSafeInteger(limits.maximumConcurrency, 2, 'maximumConcurrency'),
    runsPerClientWindow: positiveSafeInteger(limits.runsPerClientWindow, 3, 'runsPerClientWindow'),
    clientWindowMs: positiveSafeInteger(limits.clientWindowMs, HOUR_MS, 'clientWindowMs'),
    processDailyBudget: positiveSafeInteger(limits.processDailyBudget, 30, 'processDailyBudget'),
    dailyBudgetWindowMs: positiveSafeInteger(limits.dailyBudgetWindowMs, DAY_MS, 'dailyBudgetWindowMs'),
  };
}

function normalizeFingerprint(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 fingerprint.`);
  }
  return value;
}

function normalizeClientIdentity(clientIdentity) {
  if (!clientIdentity || typeof clientIdentity !== 'object' || Array.isArray(clientIdentity)
    || typeof clientIdentity.version !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(clientIdentity.version)) {
    throw new TypeError('clientIdentity must declare a stable safe version and salt fingerprint.');
  }
  return Object.freeze({
    version: clientIdentity.version,
    saltFingerprint: normalizeFingerprint(clientIdentity.saltFingerprint, 'clientIdentity.saltFingerprint'),
  });
}

function normalizeUnitSchedule(unitSchedule = {}) {
  if (!unitSchedule || typeof unitSchedule !== 'object' || Array.isArray(unitSchedule)) {
    throw new TypeError('unitSchedule must be an object.');
  }
  const quick = positiveSafeInteger(unitSchedule.quick, 1, 'unitSchedule.quick');
  const deep = positiveSafeInteger(unitSchedule.deep, 3, 'unitSchedule.deep');
  if (quick !== 1 || deep < 2 || deep > 10) {
    throw new TypeError('unitSchedule must declare QUICK=1 and DEEP between 2 and 10.');
  }
  return Object.freeze({ quick, deep });
}

function unavailableError() {
  return new AdmissionStoreError('ADMISSION_STORE_UNAVAILABLE', UNAVAILABLE_MESSAGE, 30);
}

async function withTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(unavailableError()), timeoutMs);
      }),
    ]);
  } catch {
    throw unavailableError();
  } finally {
    clearTimeout(timer);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function policyFingerprint({
  namespaceFingerprint,
  databaseFingerprint,
  limits,
  leaseTtlMs,
  clientIdentity,
  unitSchedule,
}) {
  return sha256([
    `binding=${POLICY_BINDING_VERSION}`,
    `contract=${ADMISSION_STORE_CONTRACT_VERSION}`,
    'provider=UPSTASH_REDIS_REST',
    `database=${databaseFingerprint}`,
    `namespace=${namespaceFingerprint}`,
    `rateLimit=${limits.runsPerClientWindow}`,
    `rateWindowMs=${limits.clientWindowMs}`,
    `concurrencyLimit=${limits.maximumConcurrency}`,
    `budgetLimit=${limits.processDailyBudget}`,
    `budgetWindowMs=${limits.dailyBudgetWindowMs}`,
    `leaseTtlMs=${leaseTtlMs}`,
    `clientIdentityVersion=${clientIdentity.version}`,
    `clientIdentitySalt=${clientIdentity.saltFingerprint}`,
    `unitScheduleVersion=${UNIT_SCHEDULE_VERSION}`,
    `unitScheduleQuick=${unitSchedule.quick}`,
    `unitScheduleDeep=${unitSchedule.deep}`,
  ].join('\n'));
}

function responseInteger(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value))) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseAcquireResponse(response, leaseId) {
  if (!Array.isArray(response)) throw unavailableError();
  if (response[0] === 'ACQUIRED') {
    if (response.length !== 3 || response[1] !== leaseId || responseInteger(response[2]) === null) {
      throw unavailableError();
    }
    return;
  }
  const message = DENIAL_MESSAGES[response[0]];
  const retryAfterSeconds = responseInteger(response[1]);
  if (response.length !== 2 || !message || retryAfterSeconds === null || retryAfterSeconds > 86_400) {
    throw unavailableError();
  }
  throw new AdmissionStoreError(response[0], message, retryAfterSeconds);
}

export function createUpstashRedisClient({ url, token, timeoutMs } = {}) {
  const configuredTimeoutMs = boundedSafeInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', 250, 10_000);
  const normalizedUrl = normalizeRedisUrl(url);
  const client = new Redis({
    url: normalizedUrl,
    token: normalizeRedisToken(token),
    retry: { retries: 0 },
    cache: 'no-store',
    signal: () => AbortSignal.timeout(configuredTimeoutMs),
    enableAutoPipelining: false,
    enableTelemetry: false,
    readYourWrites: true,
  });
  const canonicalDatabaseOrigin = new URL(normalizedUrl).origin;
  REDIS_DATABASE_FINGERPRINTS.set(
    client,
    sha256(`${DATABASE_IDENTITY_VERSION}\0${canonicalDatabaseOrigin}`),
  );
  return client;
}

export function createUpstashAdmissionStore({
  redis,
  namespace,
  limits = {},
  unitSchedule = {},
  clientIdentity,
  databaseFingerprint,
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!redis || typeof redis.eval !== 'function' || typeof redis.zrem !== 'function') {
    throw new TypeError('A Redis client with eval() and zrem() is required.');
  }
  const normalizedNamespace = normalizeNamespace(namespace);
  const configuredLimits = normalizeLimits(limits);
  const configuredUnitSchedule = normalizeUnitSchedule(unitSchedule);
  const configuredClientIdentity = normalizeClientIdentity(clientIdentity);
  const derivedDatabaseFingerprint = REDIS_DATABASE_FINGERPRINTS.get(redis);
  if (derivedDatabaseFingerprint && databaseFingerprint
    && databaseFingerprint !== derivedDatabaseFingerprint) {
    throw new TypeError('databaseFingerprint must match the Redis client database identity.');
  }
  const configuredDatabaseFingerprint = normalizeFingerprint(
    derivedDatabaseFingerprint || databaseFingerprint,
    'databaseFingerprint',
  );
  const configuredLeaseTtlMs = boundedSafeInteger(
    leaseTtlMs,
    DEFAULT_LEASE_TTL_MS,
    'leaseTtlMs',
    61_000,
    300_000,
  );
  const configuredTimeoutMs = boundedSafeInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', 250, 10_000);
  const namespaceFingerprint = sha256(normalizedNamespace);
  const namespaceTag = namespaceFingerprint;
  const keyPrefix = `${normalizedNamespace}:{${namespaceTag}}:admission:v1`;
  const budgetKey = `${keyPrefix}:budget`;
  const leasesKey = `${keyPrefix}:leases`;
  const policyKey = `${keyPrefix}:policy`;
  const configuredPolicyFingerprint = policyFingerprint({
    namespaceFingerprint,
    databaseFingerprint: configuredDatabaseFingerprint,
    limits: configuredLimits,
    leaseTtlMs: configuredLeaseTtlMs,
    clientIdentity: configuredClientIdentity,
    unitSchedule: configuredUnitSchedule,
  });
  const unitScheduleFingerprint = sha256([
    `version=${UNIT_SCHEDULE_VERSION}`,
    `quick=${configuredUnitSchedule.quick}`,
    `deep=${configuredUnitSchedule.deep}`,
  ].join('\n'));
  const metadata = Object.freeze({
    contractVersion: ADMISSION_STORE_CONTRACT_VERSION,
    mode: 'UPSTASH_REDIS_REST',
    provider: 'UPSTASH_REDIS_REST',
    scope: SHARED_ACROSS_INSTANCES,
    durabilityStatus: GLOBALLY_DURABLE_ADMISSION,
    globallyDurable: true,
    atomicity: DISTRIBUTED_ATOMIC_ACQUIRE,
    releaseSemantics: ASYNC_IDEMPOTENT_LEASE_RELEASE,
    leaseTtlMs: configuredLeaseTtlMs,
    namespaceFingerprint,
    databaseFingerprint: configuredDatabaseFingerprint,
    clientIdentityVersion: configuredClientIdentity.version,
    clientIdentitySaltFingerprint: configuredClientIdentity.saltFingerprint,
    unitScheduleFingerprint,
    policyFingerprint: configuredPolicyFingerprint,
  });

  return assertAdmissionStoreAdapter({
    metadata,
    async acquire({ clientKey = 'anonymous', estimatedUnits = 1 } = {}) {
      const normalizedClientKey = String(clientKey || 'anonymous');
      const normalizedEstimatedUnits = positiveSafeInteger(estimatedUnits, 1, 'estimatedUnits');
      const clientKeyHash = sha256(normalizedClientKey);
      const leaseId = randomUUID();
      const keys = [`${keyPrefix}:client:${clientKeyHash}`, budgetKey, leasesKey, policyKey];
      const args = [
        configuredLimits.runsPerClientWindow,
        configuredLimits.clientWindowMs,
        configuredLimits.maximumConcurrency,
        configuredLimits.processDailyBudget,
        configuredLimits.dailyBudgetWindowMs,
        normalizedEstimatedUnits,
        configuredLeaseTtlMs,
        leaseId,
        configuredPolicyFingerprint,
      ].map(String);
      const response = await withTimeout(
        () => redis.eval(ACQUIRE_SCRIPT, keys, args),
        configuredTimeoutMs,
      );
      parseAcquireResponse(response, leaseId);

      let releasePromise;
      return async () => {
        if (!releasePromise) {
          releasePromise = withTimeout(() => redis.zrem(leasesKey, leaseId), configuredTimeoutMs)
            .then((removed) => {
              if (removed !== 0 && removed !== 1) throw unavailableError();
            });
        }
        return releasePromise;
      };
    },
    snapshot() { return { ...metadata }; },
    async checkReady() {
      const probeId = randomUUID();
      const probeTtlMs = Math.min(30_000, Math.max(1_000, configuredTimeoutMs * 2));
      const response = await withTimeout(
        () => redis.eval(
          READINESS_SCRIPT,
          [`${keyPrefix}:readiness:${probeId}`, policyKey],
          [ADMISSION_STORE_CONTRACT_VERSION, probeId, String(probeTtlMs), configuredPolicyFingerprint],
        ),
        configuredTimeoutMs,
      );
      if (!Array.isArray(response) || response.length !== 3
        || response[0] !== 'READY'
        || response[1] !== ADMISSION_STORE_CONTRACT_VERSION
        || responseInteger(response[2]) === null) {
        throw unavailableError();
      }
      return true;
    },
  });
}
