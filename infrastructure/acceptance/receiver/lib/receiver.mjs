import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const MAX_RECORDS = 2000;
export const TTL_SECONDS = 3600;
const MAX_BODY_BYTES = 4096;
const MAX_STORE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{32,512}$/;
const error = (code, status = 503) => Object.assign(new Error(code), { status });
const requireValue = (condition, code, status) => { if (!condition) throw error(code, status); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function loadConfig(env = process.env) {
  const namespace = env.LIKERTS_ACCEPTANCE_NAMESPACE;
  const adminToken = env.LIKERTS_ACCEPTANCE_ADMIN_TOKEN;
  requireValue(typeof namespace === 'string' && /^[a-f0-9]{32,64}$/.test(namespace), 'receiver_not_configured');
  requireValue(typeof adminToken === 'string' && TOKEN.test(adminToken), 'receiver_not_configured');
  const rawKeys = env.LIKERTS_ACCEPTANCE_SIGNING_KEYS_JSON ?? '{}';
  requireValue(rawKeys.length <= 8192, 'receiver_not_configured');
  let keys;
  try { keys = JSON.parse(rawKeys); } catch { throw error('receiver_not_configured'); }
  requireValue(isObject(keys) && Object.keys(keys).length <= 10, 'receiver_not_configured');
  for (const [id, secret] of Object.entries(keys)) {
    requireValue(UUID.test(id) && typeof secret === 'string' && /^whsec_[A-Za-z0-9_-]{16,512}$/.test(secret), 'receiver_not_configured');
  }
  let url;
  try { url = new URL(env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL); } catch { throw error('receiver_not_configured'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/'
    && /^[a-z0-9-]+\.upstash\.io$/.test(url.hostname), 'receiver_not_configured');
  const redisToken = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  requireValue(typeof redisToken === 'string' && redisToken.length >= 16 && redisToken.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(redisToken), 'receiver_not_configured');
  return { namespace, adminToken, keys, redisUrl: url.origin, redisToken, redisKey: `likerts:acceptance:${namespace}:events` };
}

const publicHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...publicHeaders, ...headers } });
const publicFailure = failure => json({ error: Number.isInteger(failure?.status) ? failure.message : 'receiver_unavailable' }, Number.isInteger(failure?.status) ? failure.status : 503);

export async function boundedBytes(stream, max, signal) {
  const reader = stream?.getReader();
  requireValue(reader, 'invalid_body', 400);
  const chunks = []; let count = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      let abort;
      const aborted = new Promise((_, reject) => {
        abort = () => reject(error('body_timeout', 408));
        signal.addEventListener('abort', abort, { once: true });
      });
      let part;
      try { part = await Promise.race([reader.read(), aborted]); }
      finally { signal.removeEventListener('abort', abort); }
      if (part.done) break;
      count += part.value.byteLength;
      requireValue(count <= max, 'body_too_large', 413);
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally { void reader.cancel().catch(() => {}); }
}

export function verifyEvent(raw, headers, keys, nowMs = Date.now()) {
  const eventId = headers.get('likerts-event-id');
  const deliveryId = headers.get('likerts-delivery-id');
  const attemptId = headers.get('likerts-attempt-id');
  requireValue(UUID.test(eventId ?? '') && UUID.test(deliveryId ?? '') && UUID.test(attemptId ?? ''), 'invalid_delivery_ids', 400);
  // Exact grammar rejects duplicate signature parameters and combined headers.
  const match = /^t=([0-9]{1,12}),kid=([0-9a-f-]{36}),v1=([0-9a-f]{64})$/i.exec(headers.get('likerts-signature') ?? '');
  requireValue(match && UUID.test(match[2]), 'invalid_signature', 401);
  const [, timestamp, keyId, mac] = match;
  requireValue(Math.abs(Math.floor(nowMs / 1000) - Number(timestamp)) <= 300, 'invalid_signature', 401);
  requireValue(Object.hasOwn(keys, keyId), 'invalid_signature', 401);
  const expected = createHmac('sha256', keys[keyId]).update(`${timestamp}.${eventId}.`).update(raw).digest();
  requireValue(timingSafeEqual(expected, Buffer.from(mac, 'hex')), 'invalid_signature', 401);
  // Only authenticated raw bytes are decoded. Reject extra payload fields.
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { throw error('invalid_event', 400); }
  requireValue(exactKeys(body, ['id', 'type', 'eventVersion', 'createdAt', 'data']) && body.id === eventId
    && body.type === 'credits.threshold_reached' && body.eventVersion === 1
    && typeof body.createdAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(body.createdAt) && Number.isFinite(Date.parse(body.createdAt)), 'invalid_event', 400);
  const data = body.data;
  requireValue(exactKeys(data, ['workspaceId', 'bucket', 'generationId', 'thresholdPercent'])
    && typeof data.workspaceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.workspaceId)
    && ['promotional', 'paid'].includes(data.bucket) && UUID.test(data.generationId ?? '')
    && [80, 90, 100].includes(data.thresholdPercent), 'invalid_event', 400);
  return { eventId, deliveryId, attemptId, eventType: body.type, signatureVerified: true,
    bucket: data.bucket, generationId: data.generationId, thresholdPercent: data.thresholdPercent };
}

// One hash and a single script make dedupe, capacity, write and initial TTL atomic.
// Later writes and duplicate deliveries never extend the one-hour retention.
export const STORE_SCRIPT = `
local existing = redis.call('HGET', KEYS[1], ARGV[1])
local count = redis.call('HLEN', KEYS[1])
if existing then return {0, count} end
if count >= tonumber(ARGV[3]) then return {-1, count} end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
if count == 0 then redis.call('EXPIRE', KEYS[1], ARGV[4]) end
return {1, count + 1}
`;

export async function redisCommand(config, command, fetcher = fetch) {
  const signal = AbortSignal.timeout(4000);
  const response = await fetcher(config.redisUrl, { method: 'POST',
    headers: { authorization: `Bearer ${config.redisToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(command), redirect: 'manual', cache: 'no-store', signal });
  requireValue(response.status === 200, 'storage_unavailable');
  const raw = await boundedBytes(response.body, MAX_STORE_BYTES, signal);
  let result;
  try { result = JSON.parse(raw); } catch { throw error('storage_unavailable'); }
  requireValue(isObject(result) && Object.hasOwn(result, 'result') && !Object.hasOwn(result, 'error'), 'storage_unavailable');
  return result.result;
}

export async function receive(request, dependencies = {}) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  try {
    const config = loadConfig(dependencies.env);
    requireValue(/^(application\/json)(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? ''), 'unsupported_media_type', 415);
    requireValue(!request.headers.has('content-encoding') || request.headers.get('content-encoding') === 'identity', 'unsupported_content_encoding', 415);
    const length = request.headers.get('content-length');
    requireValue(length === null || (/^\d+$/.test(length) && Number(length) <= MAX_BODY_BYTES), 'body_too_large', 413);
    const raw = await boundedBytes(request.body, MAX_BODY_BYTES, AbortSignal.timeout(3000));
    const event = verifyEvent(raw, request.headers, config.keys, dependencies.now?.() ?? Date.now());
    const result = await redisCommand(config, ['EVAL', STORE_SCRIPT, 1, config.redisKey, event.eventId, JSON.stringify(event), MAX_RECORDS, TTL_SECONDS], dependencies.fetcher);
    requireValue(Array.isArray(result) && result.length === 2 && [-1, 0, 1].includes(result[0]) && Number.isInteger(result[1]) && result[1] >= 0 && result[1] <= MAX_RECORDS, 'storage_unavailable');
    requireValue(result[0] !== -1, 'receiver_capacity_reached', 503);
    return new Response(null, { status: 204, headers: publicHeaders });
  } catch (failure) { return publicFailure(failure); }
}

function authorized(header, expected) {
  // Hash both sides to equal length before constant-time comparison, including malformed inputs.
  const supplied = typeof header === 'string' && header.length <= 1024 ? header : '';
  return timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(`Bearer ${expected}`).digest());
}

function storedEvent(value) {
  let event;
  try { event = JSON.parse(value); } catch { throw error('storage_unavailable'); }
  requireValue(exactKeys(event, ['eventId', 'deliveryId', 'attemptId', 'eventType', 'signatureVerified', 'bucket', 'generationId', 'thresholdPercent'])
    && UUID.test(event.eventId ?? '') && UUID.test(event.deliveryId ?? '') && UUID.test(event.attemptId ?? '')
    && event.eventType === 'credits.threshold_reached' && event.signatureVerified === true
    && ['promotional', 'paid'].includes(event.bucket) && UUID.test(event.generationId ?? '') && [80, 90, 100].includes(event.thresholdPercent), 'storage_unavailable');
  return event;
}

export async function events(request, dependencies = {}) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  try {
    const config = loadConfig(dependencies.env);
    requireValue(authorized(request.headers.get('authorization'), config.adminToken), 'unauthorized', 401);
    const result = await redisCommand(config, ['HVALS', config.redisKey], dependencies.fetcher);
    requireValue(Array.isArray(result) && result.length <= MAX_RECORDS && result.every(value => typeof value === 'string'), 'storage_unavailable');
    const records = result.map(storedEvent).sort((a, b) => a.eventId.localeCompare(b.eventId));
    requireValue(new Set(records.map(record => record.eventId)).size === records.length, 'storage_unavailable');
    return json({ events: records, receivedCount: records.length });
  } catch (failure) { return publicFailure(failure); }
}
