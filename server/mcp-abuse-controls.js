import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  AdmissionStoreError,
  GLOBALLY_DURABLE_ADMISSION,
  assertAdmissionStoreAdapter,
  createInMemoryAdmissionStore,
} from './admission-store.js';
import { RuntimeConfigurationError, assertRuntimeCanExecute, readProductionRuntimeConfig } from './runtime-config.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const PROCESS_SALT = process.env.MCP_RATE_LIMIT_SALT || randomBytes(32).toString('hex');
const ANONYMOUS_CLIENT_IDENTITY_VERSION = 'anonymous-client-hmac-sha256-v1';
const ANONYMOUS_CLIENT_SALT_FINGERPRINT_CONTEXT = 'likerts-admission-client-salt-v1\0';
const ANONYMOUS_CLIENT_INGRESS_MODES = Object.freeze({
  VERCEL_PRODUCTION: 'vercel-protected-client-ip-production',
  VERCEL_NONPRODUCTION: 'vercel-protected-client-ip-nonproduction',
  UNVERIFIED_PRODUCTION: 'fail-safe-unverified-production-ingress',
  UNVERIFIED_NONPRODUCTION: 'nonproduction-forwarded-or-real-ip',
});
const PUBLIC_ADMISSION_ERRORS = Object.freeze({
  RATE_LIMITED: Object.freeze({ message: 'This anonymous client has reached the synthetic study rate limit.', retryAfterSeconds: 60 }),
  CONCURRENCY_LIMIT: Object.freeze({ message: 'The synthetic study service is busy. Try again shortly.', retryAfterSeconds: 30 }),
  BUDGET_EXHAUSTED: Object.freeze({ message: 'The synthetic study budget is currently unavailable.', retryAfterSeconds: null }),
  ADMISSION_STORE_UNAVAILABLE: Object.freeze({ message: 'Admission control is temporarily unavailable. Try again shortly.', retryAfterSeconds: 30 }),
});

function integerSetting(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function headerValue(headers, name) {
  if (headers instanceof Headers) return headers.get(name) || '';
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : String(value || '');
}

function anonymousClientSalt(env) {
  return String(env?.MCP_RATE_LIMIT_SALT || PROCESS_SALT);
}

function anonymousClientIngressContext(env) {
  const vercel = String(env?.VERCEL || '').trim() === '1'
    || ['production', 'preview', 'development'].includes(String(env?.VERCEL_ENV || '').trim().toLowerCase());
  const production = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production'
    || String(env?.LIKERTS_RUNTIME_ENV || '').trim().toLowerCase() === 'production'
    || String(env?.VERCEL_ENV || '').trim().toLowerCase() === 'production';
  const mode = vercel
    ? production
      ? ANONYMOUS_CLIENT_INGRESS_MODES.VERCEL_PRODUCTION
      : ANONYMOUS_CLIENT_INGRESS_MODES.VERCEL_NONPRODUCTION
    : production
      ? ANONYMOUS_CLIENT_INGRESS_MODES.UNVERIFIED_PRODUCTION
      : ANONYMOUS_CLIENT_INGRESS_MODES.UNVERIFIED_NONPRODUCTION;
  return { vercel, production, mode };
}

export function anonymousClientIdentityPolicy(env = process.env) {
  const ingress = anonymousClientIngressContext(env);
  const saltFingerprint = createHash('sha256')
    .update(ANONYMOUS_CLIENT_SALT_FINGERPRINT_CONTEXT)
    .update(anonymousClientSalt(env))
    .digest('hex');
  return Object.freeze({
    version: `${ANONYMOUS_CLIENT_IDENTITY_VERSION}:${ingress.mode}`,
    saltFingerprint,
  });
}

export function anonymousClientKey(headers, env = process.env) {
  const salt = anonymousClientSalt(env);
  const ingress = anonymousClientIngressContext(env);
  const forwarded = ingress.vercel
    ? headerValue(headers, 'x-vercel-forwarded-for')
    : ingress.production
      ? ''
      : headerValue(headers, 'x-forwarded-for');
  const address = forwarded.split(',')[0]?.trim()
    || (ingress.production ? 'unverified-production-ingress' : headerValue(headers, 'x-real-ip'))
    || 'unknown';
  return createHmac('sha256', salt).update(address).digest('hex');
}

export class McpAdmissionError extends Error {
  constructor(code, message, retryAfterSeconds = null) {
    super(message);
    this.name = 'McpAdmissionError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function boundedRetryAfterSeconds(value, fallback = null) {
  return Number.isInteger(value) && value > 0 && value <= 86_400 ? value : fallback;
}

function publicAdmissionError(code, retryAfterSeconds = null) {
  const normalizedCode = Object.hasOwn(PUBLIC_ADMISSION_ERRORS, code) ? code : 'ADMISSION_STORE_UNAVAILABLE';
  const publicError = PUBLIC_ADMISSION_ERRORS[normalizedCode];
  return new McpAdmissionError(
    normalizedCode,
    publicError.message,
    boundedRetryAfterSeconds(retryAfterSeconds, publicError.retryAfterSeconds),
  );
}

export function createFixedWindowLimiter({
  limit = integerSetting(process.env.MCP_HTTP_REQUESTS_PER_MINUTE, 90, 10, 1_000),
  windowMs = MINUTE_MS,
  now = Date.now,
  maximumKeys = 10_000,
} = {}) {
  const windows = new Map();

  function prune(timestamp) {
    for (const [key, value] of windows) {
      if (value.resetAt <= timestamp) windows.delete(key);
    }
    while (windows.size > maximumKeys) windows.delete(windows.keys().next().value);
  }

  return {
    check(key) {
      const timestamp = now();
      let entry = windows.get(key);
      if (!entry || entry.resetAt <= timestamp) {
        entry = { count: 0, resetAt: timestamp + windowMs };
        windows.set(key, entry);
      }
      entry.count += 1;
      if (windows.size > maximumKeys) prune(timestamp);
      return {
        allowed: entry.count <= limit,
        limit,
        remaining: Math.max(0, limit - entry.count),
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1_000)),
      };
    },
  };
}

export function createAnonymousStudyAdmission({
  enabled,
  maximumConcurrency,
  runsPerClientWindow,
  clientWindowMs = HOUR_MS,
  processDailyBudget,
  maximumClientKeys = 10_000,
  admissionStore,
  durableAdapter,
  externalCheck,
  now = Date.now,
  env = process.env,
} = {}) {
  if (admissionStore && durableAdapter) {
    throw new TypeError('Configure one admission store; admissionStore and durableAdapter cannot both be supplied.');
  }
  const runtimeConfig = readProductionRuntimeConfig(env);
  const configuredAdmissionStore = admissionStore || durableAdapter;
  const localAdmissionStore = configuredAdmissionStore ? assertAdmissionStoreAdapter(configuredAdmissionStore) : createInMemoryAdmissionStore({
    now,
    maximumClientKeys,
    limits: {
      maximumConcurrency: maximumConcurrency ?? runtimeConfig.limits.mcpRunMaxConcurrency,
      runsPerClientWindow: runsPerClientWindow ?? runtimeConfig.limits.mcpRunsPerHour,
      clientWindowMs,
      processDailyBudget: processDailyBudget ?? runtimeConfig.limits.mcpRunProcessDailyBudget,
      dailyBudgetWindowMs: DAY_MS,
    },
  });

  const storeMetadata = Object.freeze({ ...localAdmissionStore.metadata });
  const storeDurabilityStatus = storeMetadata.durabilityStatus;
  const globallyDurable = storeMetadata.globallyDurable === true
    && storeDurabilityStatus === GLOBALLY_DURABLE_ADMISSION;
  const protection = Object.freeze({
    durability: globallyDurable ? 'shared-admission-store' : 'process-local-fallback',
    contractVersion: storeMetadata.contractVersion,
    durabilityStatus: storeDurabilityStatus,
    admissionStore: storeMetadata,
    durableAdapterConfigured: globallyDurable,
    processLocalFallback: !globallyDurable,
    globallyDurable,
    note: globallyDurable
      ? 'Rate, concurrency-lease, and weighted-budget admission are enforced by one distributed atomic store.'
      : 'Counters are process-local fallback protection and are DEGRADED_NOT_GLOBALLY_DURABLE across serverless instances.',
  });

  return {
    protection,
    async checkReady(...args) {
      if (typeof localAdmissionStore.checkReady !== 'function') return false;
      return localAdmissionStore.checkReady(...args);
    },
    snapshot(...args) {
      return localAdmissionStore.snapshot(...args);
    },
    async acquire({ clientKey, estimatedUnits = 1 } = {}) {
      try {
        assertRuntimeCanExecute(env, { synthetic: true, admissionProtection: protection });
      } catch (error) {
        if (error instanceof RuntimeConfigurationError) {
          throw new McpAdmissionError(error.code, error.publicMessage);
        }
        throw error;
      }
      if (enabled === false) {
        throw new McpAdmissionError('SYNTHETIC_RUNS_DISABLED', 'Public synthetic study runs are temporarily disabled.');
      }

      if (externalCheck) {
        let verdict;
        try {
          verdict = await externalCheck({ clientKey, estimatedUnits });
        } catch {
          throw publicAdmissionError('ADMISSION_STORE_UNAVAILABLE');
        }
        if (verdict === false || verdict?.allowed === false) {
          throw publicAdmissionError(verdict?.code || 'BUDGET_EXHAUSTED', verdict?.retryAfterSeconds);
        }
      }

      try {
        const storeRelease = await localAdmissionStore.acquire({ clientKey, estimatedUnits });
        if (typeof storeRelease !== 'function') {
          throw new AdmissionStoreError('ADMISSION_STORE_UNAVAILABLE', 'Admission store returned an invalid lease.');
        }
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          try {
            await storeRelease();
          } catch {
            // A durable lease expires server-side; release failure must not mask
            // the completed study response or become an unhandled rejection.
          }
        };
      } catch (error) {
        if (error instanceof AdmissionStoreError) {
          throw publicAdmissionError(error.code, error.retryAfterSeconds);
        }
        if (error instanceof McpAdmissionError) throw error;
        throw publicAdmissionError('ADMISSION_STORE_UNAVAILABLE');
      }
    },
  };
}

export const anonymousHttpLimiter = createFixedWindowLimiter();
export const anonymousStudyAdmission = createAnonymousStudyAdmission();
