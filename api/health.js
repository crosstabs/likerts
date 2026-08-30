import { timingSafeEqual } from 'node:crypto';

import {
  DEFAULT_ADMISSION_TIMEOUT_MS,
  READINESS_TOKEN_ENV,
  getPublicRuntimeHealth,
} from '../server/runtime-config.js';
import { runtimeAdmission } from '../server/runtime-admission-store.js';
import { resolveCorrelationId, setCorrelationHeader } from '../server/observability.js';

export const config = {
  maxDuration: 5,
};

function sendJson(response, status, value, head = false) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (head) return response.end();
  return response.end(JSON.stringify(value));
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === target);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? '' : String(value || '');
}

function hasReadinessAuthorization(request, expectedToken) {
  if (typeof expectedToken !== 'string' || expectedToken.length < 32 || expectedToken.length > 4_096) return false;
  const authorization = headerValue(request?.headers, 'authorization');
  if (!authorization.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createHealthApiHandler({
  env = null,
  admission = runtimeAdmission,
  readinessTimeoutMs = DEFAULT_ADMISSION_TIMEOUT_MS,
} = {}) {
  return async function handler(request, response) {
    const correlationId = resolveCorrelationId(request.headers);
    setCorrelationHeader(response, correlationId);

    const method = String(request.method || '').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return sendJson(response, 405, {
        error: 'Use GET or HEAD for health checks.',
        correlationId,
      });
    }

    const url = new URL(request.url || '/api/health', 'https://likerts.local');
    const readiness = method === 'GET'
      && ['1', 'true'].includes(String(url.searchParams.get('ready') || '').toLowerCase());
    const runtimeEnv = env || process.env;
    let body = {
      ...getPublicRuntimeHealth(runtimeEnv, { admissionProtection: admission?.protection }),
      correlationId,
    };
    let readyProbeFailed = false;
    if (readiness) {
      const authorizationRequired = body.environment?.production === true
        || body.admissionStore?.configured === true
        || body.admissionStore?.globallyDurable === true;
      if (authorizationRequired && !hasReadinessAuthorization(request, String(runtimeEnv[READINESS_TOKEN_ENV] || ''))) {
        response.setHeader('WWW-Authenticate', 'Bearer realm="likerts-readiness"');
        return sendJson(response, 401, {
          error: 'Readiness authorization is required.',
          code: 'READINESS_AUTH_REQUIRED',
          correlationId,
        }, method === 'HEAD');
      }
      if (authorizationRequired) {
        body = {
          ...getPublicRuntimeHealth(runtimeEnv, {
            admissionProtection: admission?.protection,
            includeAdmissionFingerprints: true,
          }),
          correlationId,
        };
      }
    }
    if (readiness && !['MISCONFIGURED', 'BLOCKED'].includes(body.status)) {
      const timeoutMs = Number.isFinite(readinessTimeoutMs)
        ? Math.max(250, Math.min(10_000, Number(readinessTimeoutMs)))
        : DEFAULT_ADMISSION_TIMEOUT_MS;
      try {
        const probe = typeof admission?.checkReady === 'function'
          ? admission.checkReady()
          : false;
        let timer;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        });
        try {
          const result = await Promise.race([
            Promise.resolve(probe),
            timeout,
          ]);
          readyProbeFailed = !(result === true || result?.ready === true || result?.ok === true);
        } finally {
          clearTimeout(timer);
        }
      } catch {
        readyProbeFailed = true;
      }
      if (readyProbeFailed) {
        body = {
          ...body,
          // Emergency shutdown remains the primary runtime state while the
          // authenticated storage-only probe still reports its own failure.
          status: body.status === 'DISABLED' ? 'DISABLED' : 'BLOCKED',
          checks: body.checks.map((check) => check.name === 'admission-store'
            ? { ...check, status: 'fail', code: 'ADMISSION_STORE_UNAVAILABLE' }
            : check),
          issues: [
            ...body.issues,
            { field: 'admissionStore', code: 'ADMISSION_STORE_UNAVAILABLE', message: 'Admission control is temporarily unavailable.' },
          ],
        };
      }
    }
    const unavailable = readyProbeFailed || ['MISCONFIGURED', 'DISABLED', 'BLOCKED'].includes(body.status);
    return sendJson(response, readiness && unavailable ? 503 : 200, body, method === 'HEAD');
  };
}

export default createHealthApiHandler();
