import { createUpstashAdmissionStore, createUpstashRedisClient } from './upstash-admission-store.js';
import { anonymousClientIdentityPolicy, createAnonymousStudyAdmission } from './mcp-abuse-controls.js';
import {
  ADMISSION_STORE_PROVIDER_ENV,
  UPSTASH_REDIS_REST_PROVIDER,
  readAdmissionStoreConfiguration,
  readProductionRuntimeConfig,
} from './runtime-config.js';

/**
 * Compose the one admission object shared by HTTP, MCP, and health entrypoints.
 * A caller can still inject a store (the test/offline seam); production defaults
 * only construct an adapter from a fully validated explicit provider config.
 */
export function createRuntimeAdmission({
  env = process.env,
  admissionStore,
  durableAdapter,
  ...overrides
} = {}) {
  if (admissionStore || durableAdapter) {
    return createAnonymousStudyAdmission({ env, admissionStore, durableAdapter, ...overrides });
  }

  const providerIssues = [];
  const provider = readAdmissionStoreConfiguration(env, providerIssues);
  let configuredStore;
  if (provider.provider === UPSTASH_REDIS_REST_PROVIDER && provider.valid && providerIssues.length === 0) {
    try {
      const runtimeConfig = readProductionRuntimeConfig(env);
      if (runtimeConfig.issues.length > 0) {
        throw new TypeError('Runtime configuration is invalid.');
      }
      const redis = createUpstashRedisClient({
        url: provider.url,
        token: provider.token,
        timeoutMs: provider.timeoutMs,
      });
      configuredStore = createUpstashAdmissionStore({
        redis,
        namespace: provider.namespace,
        limits: {
          maximumConcurrency: runtimeConfig.limits.mcpRunMaxConcurrency,
          runsPerClientWindow: runtimeConfig.limits.mcpRunsPerHour,
          processDailyBudget: runtimeConfig.limits.mcpRunProcessDailyBudget,
          clientWindowMs: 60 * 60 * 1_000,
          dailyBudgetWindowMs: 24 * 60 * 60 * 1_000,
        },
        unitSchedule: {
          quick: 1,
          deep: runtimeConfig.limits.deepAdmissionUnits,
        },
        clientIdentity: anonymousClientIdentityPolicy(env),
        leaseTtlMs: provider.leaseTtlMs,
        timeoutMs: provider.timeoutMs,
      });
    } catch {
      // The in-memory object is retained as an honest degraded fallback; the
      // runtime assertion will fail closed for production execution.
      configuredStore = undefined;
    }
  }

  return createAnonymousStudyAdmission({ env, admissionStore: configuredStore, ...overrides });
}

export const runtimeAdmission = createRuntimeAdmission();
export const runtimeAdmissionProvider = runtimeAdmission.protection.admissionStore?.provider
  || process.env[ADMISSION_STORE_PROVIDER_ENV]
  || null;
