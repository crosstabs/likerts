import { toNodeHandler } from '@modelcontextprotocol/node';
import { validateOriginHeader } from '@modelcontextprotocol/server';
import { anonymousClientKey, anonymousHttpLimiter } from '../server/mcp-abuse-controls.js';
import { likertsMcpHandler } from '../server/mcp-server.js';

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

function allowedOriginHostnames(request) {
  const configured = (process.env.MCP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try { return [new URL(value).hostname]; } catch { return []; }
    });
  const requestHost = firstHeader(request, 'x-forwarded-host') || firstHeader(request, 'host');
  const hostname = requestHost.startsWith('[') ? requestHost.split(']')[0] + ']' : requestHost.split(':')[0];
  return [...new Set([hostname, ...configured].filter(Boolean))];
}

function jsonError(response, status, code, message, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  const rpcCode = code === 'INVALID_JSON' ? -32_700 : code === 'INTERNAL_ERROR' ? -32_603 : -32_000;
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: rpcCode, message, data: { code } },
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

function transportError(error) {
  console.error('Likerts MCP transport failed', { name: error?.name || 'Error' });
}

export function createMcpApiHandler({
  nodeHandler = toNodeHandler(likertsMcpHandler, { onerror: transportError }),
  requestLimiter = anonymousHttpLimiter,
} = {}) {
  return async function mcpApiHandler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const method = String(request.method || '').toUpperCase();
    const origin = firstHeader(request, 'origin');
    // Streamable HTTP servers must validate Origin; missing Origin remains valid for native MCP clients.
    // Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#security-warning
    const originVerdict = validateOriginHeader(origin || undefined, allowedOriginHostnames(request));
    if (!originVerdict.ok) return jsonError(response, 403, 'ORIGIN_NOT_ALLOWED', 'The request Origin is not allowed.');
    setCors(response, origin);

    if (!ALLOWED_METHODS.includes(method)) {
      return jsonError(response, 405, 'METHOD_NOT_ALLOWED', 'Use POST for MCP messages; GET and DELETE are transport operations.', { Allow: ALLOWED_METHODS.join(', ') });
    }
    if (method === 'OPTIONS') {
      response.statusCode = 204;
      return response.end();
    }

    const rate = requestLimiter.check(anonymousClientKey(request.headers));
    response.setHeader('X-RateLimit-Limit', String(rate.limit));
    response.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    if (!rate.allowed) {
      return jsonError(response, 429, 'RATE_LIMITED', 'Too many anonymous MCP requests. Try again later.', { 'Retry-After': String(rate.retryAfterSeconds) });
    }

    const declaredLength = Number.parseInt(firstHeader(request, 'content-length'), 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_BODY_BYTES) {
      return jsonError(response, 413, 'BODY_TOO_LARGE', `MCP request bodies must not exceed ${MAX_MCP_BODY_BYTES} bytes.`);
    }
    if (method === 'POST' && !isJsonContentType(firstHeader(request, 'content-type'))) {
      return jsonError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'POST requests must use Content-Type: application/json.');
    }

    try {
      const parsedBody = method === 'POST' ? await parsePostBody(request) : undefined;
      return await nodeHandler(request, response, parsedBody);
    } catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') {
        return jsonError(response, 413, 'BODY_TOO_LARGE', `MCP request bodies must not exceed ${MAX_MCP_BODY_BYTES} bytes.`);
      }
      if (error?.code === 'INVALID_JSON') return jsonError(response, 400, 'INVALID_JSON', 'The request body must be valid JSON.');
      transportError(error);
      return jsonError(response, 500, 'INTERNAL_ERROR', 'The MCP request could not be processed.');
    }
  };
}

export default createMcpApiHandler();
