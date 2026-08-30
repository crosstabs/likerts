import { headerValue } from './observability.js';

export const MAX_JSON_API_BODY_BYTES = 64 * 1_024;

const DEFAULT_ALLOWED_METHODS = ['POST'];
const DEFAULT_CORS_HEADERS = 'Content-Type, X-Correlation-ID';

function byteLength(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value || null));
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
  const host = firstForwardedValue(headerValue(request.headers, 'host') || headerValue(request.headers, 'x-forwarded-host'));
  if (!host) return '';
  const forwardedProto = firstForwardedValue(headerValue(request.headers, 'x-forwarded-proto')).toLowerCase();
  const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? `${forwardedProto}:` : localHost ? 'http:' : 'https:';
  return `${protocol}//${host}`.toLowerCase();
}

function configuredOrigins(env) {
  return String(env.LIKERTS_ALLOWED_ORIGINS || env.MCP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .flatMap((origin) => {
      try { return [normalizedOrigin(origin)]; } catch { return []; }
    });
}

function allowedOrigins(request, env) {
  return [...new Set([requestOrigin(request), ...configuredOrigins(env)].filter(Boolean))];
}

function setCors(response, origin, allowedMethods) {
  if (!origin) return;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', [...allowedMethods, 'OPTIONS'].join(', '));
  response.setHeader('Access-Control-Allow-Headers', DEFAULT_CORS_HEADERS);
  response.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Correlation-ID');
  response.setHeader('Vary', 'Origin');
}

function originAllowed(origin, request, env) {
  if (!origin) return true;
  try {
    return allowedOrigins(request, env).includes(normalizedOrigin(origin));
  } catch {
    return false;
  }
}

function isJsonContentType(value) {
  return value.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

async function parseJsonBody(request, maxBodyBytes) {
  if (request.body !== undefined) {
    if (byteLength(request.body) > maxBodyBytes) return { ok: false, status: 413, code: 'BODY_TOO_LARGE', message: `JSON request bodies must not exceed ${maxBodyBytes} bytes.` };
    if (Buffer.isBuffer(request.body) || request.body instanceof Uint8Array || typeof request.body === 'string') {
      try {
        return { ok: true, body: JSON.parse(Buffer.from(request.body).toString('utf8')) };
      } catch {
        return { ok: false, status: 400, code: 'INVALID_JSON', message: 'The request body must be valid JSON.' };
      }
    }
    return { ok: true, body: request.body };
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBodyBytes) return { ok: false, status: 413, code: 'BODY_TOO_LARGE', message: `JSON request bodies must not exceed ${maxBodyBytes} bytes.` };
    chunks.push(bytes);
  }

  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, status: 400, code: 'INVALID_JSON', message: 'The request body must be valid JSON.' };
  }
}

export async function validateJsonApiRequest(request, response, {
  allowedMethods = DEFAULT_ALLOWED_METHODS,
  maxBodyBytes = MAX_JSON_API_BODY_BYTES,
  env = process.env,
} = {}) {
  const method = String(request.method || '').toUpperCase();
  const origin = headerValue(request.headers, 'origin');
  if (!originAllowed(origin, request, env)) {
    return { ok: false, status: 403, code: 'ORIGIN_NOT_ALLOWED', message: 'The request Origin is not allowed.' };
  }
  setCors(response, origin, allowedMethods);

  if (method === 'OPTIONS') {
    response.statusCode = 204;
    response.setHeader('Cache-Control', 'no-store');
    response.end();
    return { ok: false, handled: true };
  }

  if (!allowedMethods.includes(method)) {
    response.setHeader('Allow', allowedMethods.join(', '));
    return { ok: false, status: 405, code: 'METHOD_NOT_ALLOWED', message: `Use ${allowedMethods.join(' or ')} for this endpoint.` };
  }

  const declaredLength = Number.parseInt(headerValue(request.headers, 'content-length'), 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    return { ok: false, status: 413, code: 'BODY_TOO_LARGE', message: `JSON request bodies must not exceed ${maxBodyBytes} bytes.` };
  }

  if (!isJsonContentType(headerValue(request.headers, 'content-type'))) {
    return { ok: false, status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'POST requests must use Content-Type: application/json.' };
  }

  return parseJsonBody(request, maxBodyBytes);
}
