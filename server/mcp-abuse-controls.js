import { createHash, randomBytes } from 'node:crypto';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const PROCESS_SALT = process.env.MCP_RATE_LIMIT_SALT || randomBytes(32).toString('hex');

function integerSetting(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function headerValue(headers, name) {
  if (headers instanceof Headers) return headers.get(name) || '';
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : String(value || '');
}

function sourceAddress(headers) {
  const forwarded = headerValue(headers, 'x-vercel-forwarded-for') || headerValue(headers, 'x-forwarded-for');
  return forwarded.split(',')[0]?.trim() || headerValue(headers, 'x-real-ip') || 'unknown';
}

export function anonymousClientKey(headers) {
  return createHash('sha256').update(`${PROCESS_SALT}\n${sourceAddress(headers)}`).digest('hex');
}

export class McpAdmissionError extends Error {
  constructor(code, message, retryAfterSeconds = null) {
    super(message);
    this.name = 'McpAdmissionError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
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
  enabled = process.env.MCP_PUBLIC_SYNTHETIC_RUNS_ENABLED !== 'false',
  maximumConcurrency = integerSetting(process.env.MCP_RUN_MAX_CONCURRENCY, 2, 1, 10),
  runsPerClientWindow = integerSetting(process.env.MCP_RUNS_PER_HOUR, 3, 1, 50),
  clientWindowMs = HOUR_MS,
  processDailyBudget = integerSetting(process.env.MCP_RUN_PROCESS_DAILY_BUDGET, 30, 1, 10_000),
  maximumClientKeys = 10_000,
  externalCheck,
  now = Date.now,
} = {}) {
  const clients = new Map();
  let inFlight = 0;
  let budgetWindowStartedAt = now();
  let budgetUsed = 0;

  function currentClientWindow(clientKey, timestamp) {
    const current = clients.get(clientKey);
    if (current && current.resetAt > timestamp) return current;
    if (!current && clients.size >= maximumClientKeys) {
      for (const [key, value] of clients) {
        if (value.resetAt <= timestamp) clients.delete(key);
      }
      if (clients.size >= maximumClientKeys) clients.delete(clients.keys().next().value);
    }
    const next = { count: 0, resetAt: timestamp + clientWindowMs };
    clients.set(clientKey, next);
    return next;
  }

  function resetProcessBudgetIfNeeded(timestamp) {
    if (timestamp - budgetWindowStartedAt >= DAY_MS) {
      budgetWindowStartedAt = timestamp;
      budgetUsed = 0;
    }
  }

  return {
    async acquire({ clientKey, estimatedUnits = 1 } = {}) {
      if (!enabled) {
        throw new McpAdmissionError('SYNTHETIC_RUNS_DISABLED', 'Public synthetic study runs are temporarily disabled.');
      }

      if (externalCheck) {
        const verdict = await externalCheck({ clientKey, estimatedUnits });
        if (verdict === false || verdict?.allowed === false) {
          throw new McpAdmissionError(
            verdict?.code || 'BUDGET_EXHAUSTED',
            verdict?.message || 'The synthetic study budget is currently unavailable.',
            verdict?.retryAfterSeconds ?? null,
          );
        }
      }

      const timestamp = now();
      resetProcessBudgetIfNeeded(timestamp);
      const client = currentClientWindow(clientKey || 'anonymous', timestamp);

      if (client.count >= runsPerClientWindow) {
        throw new McpAdmissionError(
          'RATE_LIMITED',
          'This anonymous client has reached the synthetic study rate limit.',
          Math.max(1, Math.ceil((client.resetAt - timestamp) / 1_000)),
        );
      }
      if (inFlight >= maximumConcurrency) {
        throw new McpAdmissionError('CONCURRENCY_LIMIT', 'The synthetic study service is busy. Try again shortly.', 30);
      }
      if (budgetUsed + estimatedUnits > processDailyBudget) {
        throw new McpAdmissionError('BUDGET_EXHAUSTED', 'The synthetic study budget is currently unavailable.');
      }

      client.count += 1;
      inFlight += 1;
      budgetUsed += estimatedUnits;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          inFlight = Math.max(0, inFlight - 1);
        }
      };
    },
  };
}

export const anonymousHttpLimiter = createFixedWindowLimiter();
export const anonymousStudyAdmission = createAnonymousStudyAdmission();
