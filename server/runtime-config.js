import {
  ADMISSION_STORE_CONTRACT_VERSION,
  ASYNC_IDEMPOTENT_LEASE_RELEASE,
  DISTRIBUTED_ATOMIC_ACQUIRE,
  GLOBALLY_DURABLE_ADMISSION,
  SHARED_ACROSS_INSTANCES,
} from './admission-store.js';

export const RUNTIME_CONFIG_VERSION = 'production-runtime-config-v2';

export const ADMISSION_STORE_PROVIDER_ENV = 'LIKERTS_ADMISSION_STORE_PROVIDER';
export const ADMISSION_STORE_URL_ENV = 'UPSTASH_REDIS_REST_URL';
export const ADMISSION_STORE_TOKEN_ENV = 'UPSTASH_REDIS_REST_TOKEN';
export const ADMISSION_STORE_NAMESPACE_ENV = 'LIKERTS_ADMISSION_NAMESPACE';
export const ADMISSION_STORE_LEASE_TTL_ENV = 'LIKERTS_ADMISSION_LEASE_TTL_MS';
export const ADMISSION_STORE_TIMEOUT_ENV = 'LIKERTS_ADMISSION_STORE_TIMEOUT_MS';
export const RATE_LIMIT_SALT_ENV = 'MCP_RATE_LIMIT_SALT';
export const READINESS_TOKEN_ENV = 'LIKERTS_READINESS_TOKEN';
export const UPSTASH_REDIS_REST_PROVIDER = 'upstash-redis-rest';
export const DEFAULT_ADMISSION_LEASE_TTL_MS = 120_000;
export const DEFAULT_ADMISSION_TIMEOUT_MS = 2_500;
const LEGACY_ADMISSION_STORE_URL_ENV = 'LIKERTS_ADMISSION_STORE_URL';
const TRUTHY = new Set(['true', '1']);
const FALSY = new Set(['false', '0']);

const integerSettings = [
  ['MCP_HTTP_REQUESTS_PER_MINUTE', 'mcpHttpRequestsPerMinute', 90, 10, 1_000],
  ['MCP_RUN_MAX_CONCURRENCY', 'mcpRunMaxConcurrency', 2, 1, 10],
  ['MCP_RUNS_PER_HOUR', 'mcpRunsPerHour', 3, 1, 50],
  ['MCP_RUN_PROCESS_DAILY_BUDGET', 'mcpRunProcessDailyBudget', 30, 1, 10_000],
  ['DEEP_ADMISSION_UNITS', 'deepAdmissionUnits', 3, 2, 10],
  ['DEEP_COHORT_CELLS', 'deepCohortCells', 4, 2, 8],
  ['DEEP_COHORT_MAX_CELLS', 'deepCohortMaxCells', 6, 2, 8],
  ['LIKERTS_EVAL_MAX_RUNS', 'liveEvalMaxRuns', 3, 1, 5],
  ['LIKERTS_EVAL_MAX_DURATION_MS', 'liveEvalMaxDurationMs', 120_000, 1_000, 300_000],
  ['LIKERTS_EVAL_OUTPUT_MAX_BYTES', 'liveEvalOutputMaxBytes', 200_000, 512, 1_000_000],
];

const numberSettings = [
  ['LIKERTS_STAGE_TIMEOUT_MULTIPLIER', 'stageTimeoutMultiplier', 1, 1, 4],
  ['LIKERTS_EVAL_MAX_COST_USD', 'liveEvalMaxCostUsd', 1, 0, 5],
  ['LIKERTS_EVAL_ESTIMATED_COST_USD', 'liveEvalEstimatedCostUsd', 0.25, 0, 1],
];

function issue(field, code, message) {
  return { field, code, message };
}

function strictBoolean(env, field, fallback, issues) {
  const raw = env[field];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  issues.push(issue(field, 'INVALID_BOOLEAN', `${field} must be true, false, 1, or 0.`));
  return fallback;
}

function strictInteger(env, field, key, fallback, minimum, maximum, target, issues) {
  const raw = env[field];
  if (raw === undefined || raw === null || raw === '') {
    target[key] = fallback;
    return;
  }
  const normalized = String(raw).trim();
  if (!/^-?\d+$/.test(normalized)) {
    issues.push(issue(field, 'INVALID_INTEGER', `${field} must be an integer between ${minimum} and ${maximum}.`));
    target[key] = fallback;
    return;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (parsed < minimum || parsed > maximum) {
    issues.push(issue(field, 'OUT_OF_RANGE', `${field} must be between ${minimum} and ${maximum}.`));
    target[key] = fallback;
    return;
  }
  target[key] = parsed;
}

function strictNumber(env, field, key, fallback, minimum, maximum, target, issues) {
  const raw = env[field];
  if (raw === undefined || raw === null || raw === '') {
    target[key] = fallback;
    return;
  }
  const parsed = Number(String(raw).trim());
  if (!Number.isFinite(parsed)) {
    issues.push(issue(field, 'INVALID_NUMBER', `${field} must be a number between ${minimum} and ${maximum}.`));
    target[key] = fallback;
    return;
  }
  if (parsed < minimum || parsed > maximum) {
    issues.push(issue(field, 'OUT_OF_RANGE', `${field} must be between ${minimum} and ${maximum}.`));
    target[key] = fallback;
    return;
  }
  target[key] = parsed;
}

function strictBoundedInteger(env, field, fallback, minimum, maximum, issues) {
  const raw = env[field];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const normalized = String(raw).trim();
  if (!/^\d+$/.test(normalized)) {
    issues.push(issue(field, 'INVALID_INTEGER', `${field} must be an integer between ${minimum} and ${maximum}.`));
    return fallback;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (parsed < minimum || parsed > maximum) {
    issues.push(issue(field, 'OUT_OF_RANGE', `${field} must be between ${minimum} and ${maximum}.`));
    return fallback;
  }
  return parsed;
}

function validUpstashUrl(raw) {
  if (typeof raw !== 'string' || raw !== raw.trim() || /[\r\n]/.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    const isUpstashHostname = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.upstash\.io$/i.test(parsed.hostname);
    return parsed.protocol === 'https:'
      && isUpstashHostname
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && (!parsed.port || parsed.port === '443')
      && (parsed.pathname === '/' || parsed.pathname === '');
  } catch {
    return false;
  }
}

function validAdmissionNamespace(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(String(value || '').trim());
}

function admissionProviderConfigurationPresent(env) {
  return [
    ADMISSION_STORE_PROVIDER_ENV,
    ADMISSION_STORE_URL_ENV,
    ADMISSION_STORE_TOKEN_ENV,
    ADMISSION_STORE_NAMESPACE_ENV,
    ADMISSION_STORE_LEASE_TTL_ENV,
    ADMISSION_STORE_TIMEOUT_ENV,
  ].some((field) => env[field] !== undefined && env[field] !== null && env[field] !== '');
}

function validateReadinessToken(env, required, issues) {
  const raw = env[READINESS_TOKEN_ENV];
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      issues.push(issue(READINESS_TOKEN_ENV, 'MISSING_TOKEN', `${READINESS_TOKEN_ENV} is required for authenticated readiness checks.`));
    }
    return;
  }
  if (typeof raw !== 'string' || raw.length < 32 || raw.length > 4_096
    || raw !== raw.trim() || /\p{Cc}/u.test(raw)) {
    issues.push(issue(READINESS_TOKEN_ENV, 'INVALID_TOKEN', `${READINESS_TOKEN_ENV} must contain 32 to 4096 characters without surrounding whitespace or control characters.`));
  }
}

function validateRateLimitSalt(env, required, issues) {
  const raw = env[RATE_LIMIT_SALT_ENV];
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      issues.push(issue(RATE_LIMIT_SALT_ENV, 'MISSING_SECRET', `${RATE_LIMIT_SALT_ENV} is required for stable shared admission identity.`));
    }
    return;
  }
  if (typeof raw !== 'string' || raw.length < 32 || raw.length > 4_096
    || raw !== raw.trim() || /\p{Cc}/u.test(raw)) {
    issues.push(issue(RATE_LIMIT_SALT_ENV, 'INVALID_SECRET', `${RATE_LIMIT_SALT_ENV} must contain 32 to 4096 characters without surrounding whitespace or control characters.`));
  }
}

export function readAdmissionStoreConfiguration(env = process.env, issues = []) {
  const rawProvider = String(env[ADMISSION_STORE_PROVIDER_ENV] || '');
  const rawUrl = String(env[ADMISSION_STORE_URL_ENV] || '');
  const rawToken = String(env[ADMISSION_STORE_TOKEN_ENV] || '');
  const rawNamespace = String(env[ADMISSION_STORE_NAMESPACE_ENV] || '');
  const provider = rawProvider.trim().toLowerCase();
  const url = rawUrl.trim();
  const token = rawToken.trim();
  const namespace = rawNamespace.trim();
  const leaseTtlMs = strictBoundedInteger(env, ADMISSION_STORE_LEASE_TTL_ENV, DEFAULT_ADMISSION_LEASE_TTL_MS, 61_000, 300_000, issues);
  const timeoutMs = strictBoundedInteger(env, ADMISSION_STORE_TIMEOUT_ENV, DEFAULT_ADMISSION_TIMEOUT_MS, 250, 10_000, issues);
  const providerFieldsPresent = Boolean(
    rawUrl || rawToken || rawNamespace
    || env[ADMISSION_STORE_LEASE_TTL_ENV]
    || env[ADMISSION_STORE_TIMEOUT_ENV],
  );

  if (rawProvider !== rawProvider.trim()) {
    issues.push(issue(ADMISSION_STORE_PROVIDER_ENV, 'INVALID_PROVIDER', `${ADMISSION_STORE_PROVIDER_ENV} must not contain surrounding whitespace.`));
  }
  if (provider && provider !== UPSTASH_REDIS_REST_PROVIDER) {
    issues.push(issue(ADMISSION_STORE_PROVIDER_ENV, 'UNSUPPORTED_PROVIDER', `Only ${UPSTASH_REDIS_REST_PROVIDER} is supported.`));
  }
  if (!provider && providerFieldsPresent) {
    issues.push(issue(ADMISSION_STORE_PROVIDER_ENV, 'MISSING_PROVIDER', `${ADMISSION_STORE_PROVIDER_ENV} must explicitly select ${UPSTASH_REDIS_REST_PROVIDER}.`));
  }
  if (env[LEGACY_ADMISSION_STORE_URL_ENV]) {
    issues.push(issue(LEGACY_ADMISSION_STORE_URL_ENV, 'UNSUPPORTED_LEGACY_CONFIG', 'The legacy admission-store URL variable is unsupported; configure the explicit Upstash provider and credentials.'));
  }
  if (provider === UPSTASH_REDIS_REST_PROVIDER) {
    if (!validUpstashUrl(rawUrl)) issues.push(issue(ADMISSION_STORE_URL_ENV, 'INVALID_URL', 'Admission store URL must be an HTTPS Upstash URL without credentials, query, or fragment.'));
    if (!token) issues.push(issue(ADMISSION_STORE_TOKEN_ENV, 'MISSING_TOKEN', 'Admission store token is required when the Upstash provider is enabled.'));
    else if (rawToken !== token || token.length > 4_096 || /\p{Cc}/u.test(token)) {
      issues.push(issue(ADMISSION_STORE_TOKEN_ENV, 'INVALID_TOKEN', 'Admission store token contains invalid whitespace or control characters.'));
    }
    if (rawNamespace !== namespace || !validAdmissionNamespace(namespace)) issues.push(issue(ADMISSION_STORE_NAMESPACE_ENV, 'INVALID_NAMESPACE', 'Admission store namespace must be a stable identifier of 8 to 128 letters, numbers, or ._:- characters.'));
  }

  return Object.freeze({
    provider: provider || null,
    url: url || null,
    token: token || null,
    namespace: namespace || null,
    leaseTtlMs,
    timeoutMs,
    configured: Boolean(provider || providerFieldsPresent),
    valid: issues.length === 0 && provider === UPSTASH_REDIS_REST_PROVIDER,
  });
}

function admissionStoreSummary(env, issues) {
  const providerConfiguration = readAdmissionStoreConfiguration(env, issues);
  let summary = {
    contractVersion: ADMISSION_STORE_CONTRACT_VERSION,
    configured: false,
    mode: 'IN_MEMORY',
    durabilityStatus: 'DEGRADED_NOT_GLOBALLY_DURABLE',
  };

  if (!providerConfiguration.configured) return summary;

  summary = {
    contractVersion: ADMISSION_STORE_CONTRACT_VERSION,
    configured: true,
    mode: providerConfiguration.provider === UPSTASH_REDIS_REST_PROVIDER
      ? 'UPSTASH_REDIS_REST'
      : 'SHARED_ADAPTER_UNAVAILABLE',
    durabilityStatus: 'SHARED_DURABLE_ADAPTER_REQUIRED',
    ...(providerConfiguration.provider ? { provider: providerConfiguration.provider } : {}),
  };
  return summary;
}

function runtimeEnvironment(env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const vercelEnv = String(env.VERCEL_ENV || '').trim().toLowerCase();
  const likertsEnv = String(env.LIKERTS_RUNTIME_ENV || '').trim().toLowerCase();
  return {
    production: nodeEnv === 'production' || vercelEnv === 'production' || likertsEnv === 'production',
  };
}

function actualAdmissionCapability(admissionProtection = {}) {
  const protection = admissionProtection || {};
  const store = protection.admissionStore || {};
  const declaredStatus = protection.durabilityStatus || protection.admissionStore?.durabilityStatus || '';
  const globallyDurable = Boolean(
    protection.globallyDurable === true
    && protection.durability === 'shared-admission-store'
    && protection.processLocalFallback === false
    && declaredStatus === GLOBALLY_DURABLE_ADMISSION
    && store.contractVersion === ADMISSION_STORE_CONTRACT_VERSION
    && store.globallyDurable === true
    && store.durabilityStatus === GLOBALLY_DURABLE_ADMISSION
    && store.atomicity === DISTRIBUTED_ATOMIC_ACQUIRE
    && store.releaseSemantics === ASYNC_IDEMPOTENT_LEASE_RELEASE
    && store.scope === SHARED_ACROSS_INSTANCES
    && typeof store.provider === 'string'
    && store.provider.length > 0
    && Number.isInteger(store.leaseTtlMs)
    && store.leaseTtlMs >= 61_000
    && store.leaseTtlMs <= 300_000
    && /^[a-f0-9]{64}$/.test(store.namespaceFingerprint || '')
    && /^[a-f0-9]{64}$/.test(store.databaseFingerprint || '')
    && /^[a-f0-9]{64}$/.test(store.policyFingerprint || '')
    && /^[a-f0-9]{64}$/.test(store.unitScheduleFingerprint || '')
    && typeof store.clientIdentityVersion === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(store.clientIdentityVersion)
    && /^[a-f0-9]{64}$/.test(store.clientIdentitySaltFingerprint || ''),
  );
  return {
    globallyDurable,
    actualDurabilityStatus: globallyDurable ? GLOBALLY_DURABLE_ADMISSION : declaredStatus || 'NOT_AVAILABLE',
  };
}

function admissionStoreWithCapability(env, issues, admissionProtection) {
  const summary = admissionStoreSummary(env, issues);
  const capability = actualAdmissionCapability(admissionProtection);
  const store = admissionProtection?.admissionStore || {};
  return {
    ...summary,
    durabilityStatus: capability.globallyDurable ? GLOBALLY_DURABLE_ADMISSION : summary.durabilityStatus,
    actualDurabilityStatus: capability.actualDurabilityStatus,
    globallyDurable: capability.globallyDurable,
    ...(capability.globallyDurable ? {
      scope: store.scope,
      leaseTtlMs: store.leaseTtlMs,
      namespaceFingerprint: store.namespaceFingerprint,
      databaseFingerprint: store.databaseFingerprint,
      policyFingerprint: store.policyFingerprint,
      unitScheduleFingerprint: store.unitScheduleFingerprint,
    } : {}),
  };
}

export function readProductionRuntimeConfig(env = process.env, { admissionProtection = null } = {}) {
  const issues = [];
  const limits = {};
  const environment = runtimeEnvironment(env);
  const execution = {
    disabled: strictBoolean(env, 'LIKERTS_EXECUTION_DISABLED', false, issues),
    syntheticRunsEnabled: strictBoolean(env, 'MCP_PUBLIC_SYNTHETIC_RUNS_ENABLED', true, issues),
    liveEvalEnabled: strictBoolean(env, 'LIKERTS_EVAL_LIVE', false, issues),
  };

  for (const setting of integerSettings) strictInteger(env, ...setting, limits, issues);
  for (const setting of numberSettings) strictNumber(env, ...setting, limits, issues);

  const sharedAdmissionConfigured = admissionProviderConfigurationPresent(env);
  validateReadinessToken(env, environment.production || sharedAdmissionConfigured, issues);
  validateRateLimitSalt(env, environment.production || sharedAdmissionConfigured, issues);

  if (limits.deepCohortCells > limits.deepCohortMaxCells) {
    issues.push(issue('DEEP_COHORT_CELLS', 'OUT_OF_RANGE', 'DEEP_COHORT_CELLS must be less than or equal to DEEP_COHORT_MAX_CELLS.'));
  }

  const admissionStore = admissionStoreWithCapability(env, issues, admissionProtection);
  const status = issues.length
    ? 'MISCONFIGURED'
    : execution.disabled || !execution.syntheticRunsEnabled
      ? 'DISABLED'
      : environment.production && !admissionStore.globallyDurable
        ? 'BLOCKED'
        : !admissionStore.globallyDurable
        ? 'DEGRADED'
        : 'OK';

  return {
    version: RUNTIME_CONFIG_VERSION,
    status,
    environment,
    execution,
    limits,
    admissionStore,
    issues,
  };
}

export class RuntimeConfigurationError extends Error {
  constructor(code, publicMessage, issues = []) {
    super(publicMessage);
    this.name = 'RuntimeConfigurationError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.issues = issues;
  }
}

export function assertRuntimeCanExecute(env = process.env, {
  synthetic = false,
  requireDurableAdmission = false,
  admissionProtection = null,
} = {}) {
  const config = readProductionRuntimeConfig(env, { admissionProtection });
  if (config.issues.length) {
    throw new RuntimeConfigurationError('RUNTIME_CONFIG_INVALID', 'Runtime configuration is invalid.', config.issues);
  }
  if (config.execution.disabled) {
    throw new RuntimeConfigurationError('EXECUTION_DISABLED', 'Execution is temporarily disabled.');
  }
  if (synthetic && !config.execution.syntheticRunsEnabled) {
    throw new RuntimeConfigurationError('SYNTHETIC_RUNS_DISABLED', 'Public synthetic study runs are temporarily disabled.');
  }
  if (config.environment.production && (synthetic || requireDurableAdmission) && !config.admissionStore.globallyDurable) {
    throw new RuntimeConfigurationError('DURABLE_ADMISSION_REQUIRED', 'Production execution requires globally durable admission control.', [
      issue('admissionStore', 'DURABLE_ADMISSION_REQUIRED', 'Inject and verify a globally durable admission adapter before enabling production execution.'),
    ]);
  }
  return config;
}

export function getPublicRuntimeHealth(env = process.env, {
  now = () => new Date().toISOString(),
  admissionProtection = null,
  includeAdmissionFingerprints = false,
} = {}) {
  const config = readProductionRuntimeConfig(env, { admissionProtection });
  const admissionStore = includeAdmissionFingerprints
    ? config.admissionStore
    : Object.fromEntries(Object.entries(config.admissionStore).filter(([key]) => ![
        'namespaceFingerprint',
        'databaseFingerprint',
        'policyFingerprint',
        'unitScheduleFingerprint',
      ].includes(key)));
  return {
    service: 'likerts',
    version: config.version,
    timestamp: now(),
    status: config.status,
    environment: config.environment,
    execution: {
      disabled: config.execution.disabled,
      syntheticRuns: config.execution.syntheticRunsEnabled ? 'enabled' : 'disabled',
      liveEval: config.execution.liveEvalEnabled ? 'enabled' : 'disabled',
    },
    admissionStore,
    checks: [
      {
        name: 'runtime-config',
        status: config.issues.length ? 'fail' : 'pass',
        issueCount: config.issues.length,
      },
      {
        name: 'execution',
        status: config.execution.disabled || !config.execution.syntheticRunsEnabled ? 'disabled' : 'pass',
      },
      {
        name: 'admission-store',
        status: config.admissionStore.globallyDurable ? 'pass' : config.environment.production ? 'fail' : 'degraded',
        code: config.admissionStore.durabilityStatus,
      },
    ],
    issues: config.issues,
  };
}
