#!/usr/bin/env node

import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  ADMISSION_STORE_NAMESPACE_ENV,
  ADMISSION_STORE_PROVIDER_ENV,
  ADMISSION_STORE_TIMEOUT_ENV,
  ADMISSION_STORE_TOKEN_ENV,
  ADMISSION_STORE_URL_ENV,
  DEFAULT_ADMISSION_LEASE_TTL_MS,
  DEFAULT_ADMISSION_TIMEOUT_MS,
  RATE_LIMIT_SALT_ENV,
  readAdmissionStoreConfiguration,
  UPSTASH_REDIS_REST_PROVIDER,
} from '../server/runtime-config.js';
import { anonymousClientIdentityPolicy } from '../server/mcp-abuse-controls.js';

const INTEGRATION_ENV = 'LIKERTS_ADMISSION_INTEGRATION';
const LEASE_TTL_ENV = 'LIKERTS_ADMISSION_LEASE_TTL_MS';
const NAMESPACE_PREFIX = 'likerts:verification:';
const EXACT_CONCURRENCY = 2;
const LIMITS = Object.freeze({
  maximumConcurrency: EXACT_CONCURRENCY,
  runsPerClientWindow: 1,
  clientWindowMs: 60 * 60 * 1_000,
  processDailyBudget: 5,
  dailyBudgetWindowMs: 24 * 60 * 60 * 1_000,
});

const ERROR_MESSAGES = Object.freeze({
  INTEGRATION_OPT_IN_REQUIRED: 'Admission-store integration verification requires explicit opt-in.',
  INTEGRATION_CONFIG_INVALID: 'Admission-store integration verification configuration is invalid.',
  INTEGRATION_PRODUCTION_NAMESPACE: 'Admission-store integration verification cannot use a production runtime.',
  INTEGRATION_VERIFICATION_FAILED: 'Admission-store integration verification failed.',
});

export class AdmissionStoreIntegrationError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.INTEGRATION_VERIFICATION_FAILED);
    this.name = 'AdmissionStoreIntegrationError';
    this.code = code;
  }
}

function isProductionEnvironment(env) {
  return ['NODE_ENV', 'VERCEL_ENV', 'LIKERTS_RUNTIME_ENV']
    .some((name) => String(env?.[name] || '').trim().toLowerCase() === 'production');
}

function namespaceIsDedicated(namespace) {
  if (!namespace.startsWith(NAMESPACE_PREFIX)) return false;
  const unique = namespace.slice(NAMESPACE_PREFIX.length);
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(unique)
    && namespace.length >= 8
    && namespace.length <= 128;
}

function namespaceFingerprint(namespace) {
  return createHash('sha256').update(namespace).digest('hex').slice(0, 16);
}

function stableIdentitySaltIsValid(env) {
  const raw = env?.[RATE_LIMIT_SALT_ENV];
  return typeof raw === 'string'
    && raw.length >= 32
    && raw.length <= 4_096
    && raw === raw.trim()
    && !/\p{Cc}/u.test(raw);
}

/**
 * Parse and validate the live verification gate without contacting a backend.
 * The returned token is intentionally only used by the caller and is never
 * included in a report or error payload.
 */
export function readAdmissionStoreIntegrationConfiguration(env = process.env) {
  if (String(env?.[INTEGRATION_ENV] || '') !== '1') {
    throw new AdmissionStoreIntegrationError('INTEGRATION_OPT_IN_REQUIRED');
  }
  if (isProductionEnvironment(env)) {
    throw new AdmissionStoreIntegrationError('INTEGRATION_PRODUCTION_NAMESPACE');
  }

  const issues = [];
  const configuration = readAdmissionStoreConfiguration(env, issues);
  if (!configuration.valid || configuration.provider !== UPSTASH_REDIS_REST_PROVIDER) {
    throw new AdmissionStoreIntegrationError('INTEGRATION_CONFIG_INVALID');
  }
  if (!namespaceIsDedicated(configuration.namespace)) {
    throw new AdmissionStoreIntegrationError('INTEGRATION_CONFIG_INVALID');
  }
  if (!stableIdentitySaltIsValid(env)) {
    throw new AdmissionStoreIntegrationError('INTEGRATION_CONFIG_INVALID');
  }
  // The provider, runtime parser, and adapter contract all require a lease
  // that is at least 61 seconds.
  if (configuration.leaseTtlMs < 61_000) {
    throw new AdmissionStoreIntegrationError('INTEGRATION_CONFIG_INVALID');
  }
  if (issues.length > 0) {
    throw new AdmissionStoreIntegrationError('INTEGRATION_CONFIG_INVALID');
  }

  return Object.freeze({
    provider: configuration.provider,
    url: configuration.url,
    token: configuration.token,
    namespace: configuration.namespace,
    leaseTtlMs: configuration.leaseTtlMs,
    timeoutMs: configuration.timeoutMs,
    clientIdentity: anonymousClientIdentityPolicy(env),
  });
}

function assertExpectedDenial(result, code) {
  if (!result || result.status !== 'rejected' || result.reason?.code !== code) {
    throw new AdmissionStoreIntegrationError('INTEGRATION_VERIFICATION_FAILED');
  }
}

async function verifyLiveStore({ configuration, createRedisClient, createStore }) {
  const redisClients = Array.from({ length: 2 }, () => createRedisClient({
    url: configuration.url,
    token: configuration.token,
    timeoutMs: configuration.timeoutMs,
  }));
  const storeOptions = {
    namespace: configuration.namespace,
    limits: LIMITS,
    leaseTtlMs: configuration.leaseTtlMs,
    timeoutMs: configuration.timeoutMs,
    unitSchedule: { quick: 1, deep: 3 },
    clientIdentity: configuration.clientIdentity,
  };
  const first = createStore({ ...storeOptions, redis: redisClients[0] });
  const second = createStore({ ...storeOptions, redis: redisClients[1] });
  const stores = [first, second];

  const readiness = await Promise.all(stores.map((store) => store.checkReady()));
  if (readiness.some((result) => result !== true)) {
    throw new AdmissionStoreIntegrationError('INTEGRATION_VERIFICATION_FAILED');
  }

  const exactAttempts = await Promise.allSettled(
    Array.from({ length: EXACT_CONCURRENCY + 1 }, (_, index) => stores[index % stores.length].acquire({
      clientKey: `integration-concurrency-${index}`,
      estimatedUnits: 1,
    })),
  );
  const exactLeases = exactAttempts
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const exactDenial = exactAttempts.find((result) => result.status === 'rejected');
  await Promise.all(exactLeases.map((release) => release()));
  if (exactLeases.length !== EXACT_CONCURRENCY) {
    throw new AdmissionStoreIntegrationError('INTEGRATION_VERIFICATION_FAILED');
  }
  assertExpectedDenial(exactDenial, 'CONCURRENCY_LIMIT');

  const releaseProbe = await first.acquire({ clientKey: 'integration-release', estimatedUnits: 1 });
  await releaseProbe();
  const replacement = await second.acquire({ clientKey: 'integration-replacement', estimatedUnits: 1 });
  await replacement();

  const rateLease = await first.acquire({ clientKey: 'integration-rate', estimatedUnits: 1 });
  const rateAttempt = await second.acquire({ clientKey: 'integration-rate', estimatedUnits: 1 })
    .then(async (release) => {
      await release();
      return { status: 'fulfilled' };
    })
    .catch((reason) => ({ status: 'rejected', reason }));
  assertExpectedDenial(rateAttempt, 'RATE_LIMITED');
  await rateLease();

  const weightedAttempt = await first.acquire({ clientKey: 'integration-weighted', estimatedUnits: 2 })
    .then(async (release) => {
      await release();
      return { status: 'fulfilled' };
    })
    .catch((reason) => ({ status: 'rejected', reason }));
  assertExpectedDenial(weightedAttempt, 'BUDGET_EXHAUSTED');

  return {
    adapters: stores.length,
    readyProbes: stores.length,
    exactConcurrent: { requested: EXACT_CONCURRENCY + 1, granted: exactLeases.length },
    denials: { concurrency: 1, rate: 1, weightedBudget: 1 },
    releases: exactLeases.length + 3,
    namespaceFingerprint: namespaceFingerprint(configuration.namespace),
  };
}

export async function runAdmissionStoreIntegrationCli({
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  createRedisClient,
  createStore,
} = {}) {
  try {
    const configuration = readAdmissionStoreIntegrationConfiguration(env);
    let redisFactory = createRedisClient;
    let storeFactory = createStore;
    if (!redisFactory || !storeFactory) {
      const provider = await import('../server/upstash-admission-store.js');
      redisFactory ||= provider.createUpstashRedisClient;
      storeFactory ||= provider.createUpstashAdmissionStore;
    }
    const report = await verifyLiveStore({
      configuration,
      createRedisClient: redisFactory,
      createStore: storeFactory,
    });
    stdout.write(`${JSON.stringify({ status: 'VERIFIED', ...report }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof AdmissionStoreIntegrationError
      ? error.code
      : 'INTEGRATION_VERIFICATION_FAILED';
    stderr.write(`${JSON.stringify({ status: 'FAILED', code }, null, 2)}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runAdmissionStoreIntegrationCli();
}

// Keep these names discoverable to callers that build env fixtures from the
// verifier itself without exposing any credential values.
export const ADMISSION_STORE_INTEGRATION_ENV = INTEGRATION_ENV;
export const ADMISSION_STORE_INTEGRATION_NAMESPACE_PREFIX = NAMESPACE_PREFIX;
export const ADMISSION_STORE_INTEGRATION_DEFAULTS = Object.freeze({
  leaseTtlMs: DEFAULT_ADMISSION_LEASE_TTL_MS,
  timeoutMs: DEFAULT_ADMISSION_TIMEOUT_MS,
  provider: UPSTASH_REDIS_REST_PROVIDER,
  providerEnv: ADMISSION_STORE_PROVIDER_ENV,
  urlEnv: ADMISSION_STORE_URL_ENV,
  tokenEnv: ADMISSION_STORE_TOKEN_ENV,
  namespaceEnv: ADMISSION_STORE_NAMESPACE_ENV,
  timeoutEnv: ADMISSION_STORE_TIMEOUT_ENV,
  leaseTtlEnv: LEASE_TTL_ENV,
  rateLimitSaltEnv: RATE_LIMIT_SALT_ENV,
});
