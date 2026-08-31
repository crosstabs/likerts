import { toNodeHandler } from '@modelcontextprotocol/node';
import { anonymousClientKey, anonymousHttpLimiter } from '../server/mcp-abuse-controls.js';
import { runtimeAdmission } from '../server/runtime-admission-store.js';
import { createLikertsMcpHandler } from '../server/mcp-server.js';
import { RuntimeConfigurationError, assertRuntimeCanExecute } from '../server/runtime-config.js';
import { logStructuredEvent, observeApiHandler, resolveCorrelationId, setCorrelationHeader } from '../server/observability.js';

export const MAX_MCP_BODY_BYTES = 32 * 1_024;
const ALLOWED_METHODS = ['POST', 'GET', 'DELETE', 'OPTIONS'];
const CORS_HEADERS = 'Accept, Authorization, Content-Type, Last-Event-ID, MCP-Protocol-Version, MCP-Session-Id';

export const config = {
  maxDuration: 60,
};
export const maxDuration = 60;

function firstHeader(request, name) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : String(value || '');
}

function firstForwardedValue(value) {
  return String(value || '').split(',')[0].trim();
}

function normalizedOrigin(value) {
  const parsed = new URL(String(value));
  return `${parsed.protocol}//${parsed.host}`.toLowerCase();
}

function requestOrigin(request) {
  // Prefer the server-selected Host header. Forwarded host values can be supplied by
  // clients unless a deployment's proxy explicitly strips and replaces them.
  const host = firstForwardedValue(firstHeader(request, 'host') || firstHeader(request, 'x-forwarded-host'));
  if (!host) return '';
  const forwardedProto = firstForwardedValue(firstHeader(request, 'x-forwarded-proto')).toLowerCase();
  const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? `${forwardedProto}:` : localHost ? 'http:' : 'https:';
  return `${protocol}//${host}`.toLowerCase();
}

function configuredOrigins(env) {
  return (env.MCP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try { return [normalizedOrigin(value)]; } catch { return []; }
    });
}

function allowedOrigins(request, env) {
  return [...new Set([requestOrigin(request), ...configuredOrigins(env)].filter(Boolean))];
}

function originAllowed(origin, request, env) {
  if (!origin) return true;
  try {
    return allowedOrigins(request, env).includes(normalizedOrigin(origin));
  } catch {
    return false;
  }
}

function jsonError(response, status, code, message, headers = {}, correlationId = '') {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  const rpcCode = code === 'INVALID_JSON' ? -32_700 : code === 'INTERNAL_ERROR' ? -32_603 : -32_000;
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: rpcCode, message, data: { code, ...(correlationId ? { correlationId } : {}) } },
    id: null,
  }));
}

function setCors(response, origin) {
  if (!origin) return;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
  response.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
  response.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version, MCP-Session-Id, Retry-After');
  response.setHeader('Vary', 'Origin');
}

function isJsonContentType(value) {
  return value.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function byteLength(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
}

async function parsePostBody(request) {
  if (request.body !== undefined) {
    if (byteLength(request.body) > MAX_MCP_BODY_BYTES) throw Object.assign(new Error('body_too_large'), { code: 'BODY_TOO_LARGE' });
    if (Buffer.isBuffer(request.body) || request.body instanceof Uint8Array || typeof request.body === 'string') {
      try { return JSON.parse(Buffer.from(request.body).toString('utf8')); }
      catch { throw Object.assign(new Error('invalid_json'), { code: 'INVALID_JSON' }); }
    }
    return request.body;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_MCP_BODY_BYTES) throw Object.assign(new Error('body_too_large'), { code: 'BODY_TOO_LARGE' });
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid_json'), { code: 'INVALID_JSON' }); }
}

function transportError(error, { logger = console, correlationId = 'unavailable', env = process.env } = {}) {
  logStructuredEvent({
    level: 'error',
    component: 'api.mcp',
    event: 'transport_failed',
    correlationId,
    error,
  }, { logger, env });
}

export function createMcpApiHandler({
  nodeHandler = null,
  requestLimiter = anonymousHttpLimiter,
  admission = runtimeAdmission,
  env = process.env,
  logger = console,
} = {}) {
  const admissionProtection = admission?.protection;
  const resolvedNodeHandler = nodeHandler || toNodeHandler(
    createLikertsMcpHandler({ admission, env }),
    { onerror: (error) => transportError(error, { logger, env }) },
  );
  const handler = async function mcpApiHandler(request, response) {
    const correlationId = resolveCorrelationId(request.headers);
    response.setHeader('Cache-Control', 'no-store');
    setCorrelationHeader(response, correlationId);
    const method = String(request.method || '').toUpperCase();
    const origin = firstHeader(request, 'origin');
    // Streamable HTTP servers must validate Origin; missing Origin remains valid for native MCP clients.
    if (!originAllowed(origin, request, env)) return jsonError(response, 403, 'ORIGIN_NOT_ALLOWED', 'The request Origin is not allowed.', {}, correlationId);
    setCors(response, origin);

    if (!ALLOWED_METHODS.includes(method)) {
      return jsonError(response, 405, 'METHOD_NOT_ALLOWED', 'Use POST for MCP messages; GET and DELETE are transport operations.', { Allow: ALLOWED_METHODS.join(', ') }, correlationId);
    }
    if (method === 'OPTIONS') {
      response.statusCode = 204;
      return response.end();
    }

    try {
      assertRuntimeCanExecute(env, { requireDurableAdmission: true, admissionProtection });
    } catch (error) {
      if (error instanceof RuntimeConfigurationError) {
        logStructuredEvent({
          level: 'warn',
          component: 'api.mcp',
          event: 'request_blocked',
          correlationId,
          error,
          attributes: { method, reason: error.code },
        }, { logger, env });
        return jsonError(response, 503, error.code, error.publicMessage, {}, correlationId);
      }
      throw error;
    }

    const rate = requestLimiter.check(anonymousClientKey(request.headers, env));
    response.setHeader('X-RateLimit-Limit', String(rate.limit));
    response.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    if (!rate.allowed) {
      return jsonError(response, 429, 'RATE_LIMITED', 'Too many anonymous MCP requests. Try again later.', { 'Retry-After': String(rate.retryAfterSeconds) }, correlationId);
    }

    const declaredLength = Number.parseInt(firstHeader(request, 'content-length'), 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_BODY_BYTES) {
      return jsonError(response, 413, 'BODY_TOO_LARGE', `MCP request bodies must not exceed ${MAX_MCP_BODY_BYTES} bytes.`, {}, correlationId);
    }
    if (method === 'POST' && !isJsonContentType(firstHeader(request, 'content-type'))) {
      return jsonError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'POST requests must use Content-Type: application/json.', {}, correlationId);
    }

    try {
      const parsedBody = method === 'POST' ? await parsePostBody(request) : undefined;
      return await resolvedNodeHandler(request, response, parsedBody);
    } catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') {
        return jsonError(response, 413, 'BODY_TOO_LARGE', `MCP request bodies must not exceed ${MAX_MCP_BODY_BYTES} bytes.`, {}, correlationId);
      }
      if (error?.code === 'INVALID_JSON') return jsonError(response, 400, 'INVALID_JSON', 'The request body must be valid JSON.', {}, correlationId);
      transportError(error, { logger, correlationId, env });
      return jsonError(response, 500, 'INTERNAL_ERROR', 'The MCP request could not be processed.', {}, correlationId);
    }
  };
  return observeApiHandler(handler, {
    component: 'api.mcp',
    route: '/api/mcp',
    logger,
    env,
  });
}

export default createMcpApiHandler();
