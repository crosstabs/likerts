import { randomUUID } from 'node:crypto';
import { boundedJson } from './status.mjs';

export const MONITOR_STATE_TTL_SECONDS = 604800;
export const MONITOR_LOCK_SECONDS = 45;
export const MAX_ALERT_ATTEMPTS = 3;
export const MISSING_SIGNAL_MS = 12 * 60 * 1000;
export const MONITOR_STATE_SCHEMA_VERSION = 2;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const COMPONENT_IDS = ['collection', 'agents', 'identity', 'admission', 'cleanup', 'archive'];
export const COMPONENT_STATUSES = ['reachable', 'unavailable', 'not_configured', 'invalid_configuration', 'cached_response', 'rate_limited', 'credential_rejected', 'invalid_response', 'backlog', 'fenced'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = () => { throw new Error('monitor_state_unavailable'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function parseState(raw) {
  if (raw === null) return null;
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 4096) return fail();
  let state;
  try { state = JSON.parse(raw); } catch { return fail(); }
  if (!exact(state, ['version', 'completedAt', 'health', 'coverage', 'incidentId', 'notification'])
    || state.version !== MONITOR_STATE_SCHEMA_VERSION || !integer(state.completedAt)
    || !['reachable', 'degraded'].includes(state.health)
    || !['admission_and_maintenance_db', 'maintenance_db', 'admission', 'reachability_only'].includes(state.coverage)
    || !(state.incidentId === null || UUID.test(state.incidentId))) return fail();
  const n = state.notification;
  if (n !== null && (!exact(n, ['eventId', 'event', 'incidentId', 'checkedAt', 'components', 'attempts', 'accepted'])
    || !UUID.test(n.eventId) || !UUID.test(n.incidentId) || n.incidentId !== state.incidentId
    || !['dependency_unavailable', 'dependency_recovered'].includes(n.event)
    || typeof n.checkedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(n.checkedAt)
    || !Number.isFinite(Date.parse(n.checkedAt)) || !integer(n.attempts) || n.attempts > MAX_ALERT_ATTEMPTS
    || typeof n.accepted !== 'boolean' || !Array.isArray(n.components) || n.components.length > COMPONENT_IDS.length
    || n.components.some(c => !exact(c, ['id', 'status']) || !COMPONENT_IDS.includes(c.id) || !COMPONENT_STATUSES.includes(c.status)))) return fail();
  if ((state.incidentId === null) !== (n === null)) return fail();
  return state;
}

export function prepareState(previous, health, components, coverage, nowMs, uuid = randomUUID) {
  const state = previous ? structuredClone(previous) : { version: MONITOR_STATE_SCHEMA_VERSION, completedAt: 0, health: 'reachable', coverage, incidentId: null, notification: null };
  const event = health === 'degraded' ? 'dependency_unavailable' : state.incidentId ? 'dependency_recovered' : null;
  const changedDegradation = event === 'dependency_unavailable' && state.notification?.event === event
    && JSON.stringify(state.notification.components) !== JSON.stringify(components);
  if (event && (state.notification?.event !== event || changedDegradation)) {
    if (event === 'dependency_unavailable' && state.incidentId === null) state.incidentId = uuid();
    state.notification = { eventId: uuid(), event, incidentId: state.incidentId,
      checkedAt: new Date(nowMs).toISOString(), components, attempts: 0, accepted: false };
  }
  state.health = health;
  state.coverage = coverage;
  return state;
}

export const ACQUIRE_SCRIPT = `
if not redis.call('SET', KEYS[2], ARGV[1], 'NX', 'EX', ARGV[2]) then return {0, ''} end
return {1, redis.call('GET', KEYS[1]) or ''}
`;
export const SAVE_SCRIPT = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
if ARGV[4] == '1' then redis.call('DEL', KEYS[2]) end
return 1
`;

export function monitorStore({ environment = process.env, fetcher = fetch } = {}) {
  const urlValue = environment.LIKERTS_MONITOR_STATE_REDIS_URL;
  const token = environment.LIKERTS_MONITOR_STATE_REDIS_TOKEN;
  const namespace = environment.LIKERTS_MONITOR_STATE_NAMESPACE;
  if (!urlValue && !token && !namespace) return null;
  let url;
  try { url = new URL(urlValue); } catch { return fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port || url.pathname !== '/'
    || !/^[a-z0-9-]+\.upstash\.io$/.test(url.hostname) || !/^[a-f0-9]{32}$/.test(namespace ?? '')
    || typeof token !== 'string' || !/^[\x21-\x7e]{16,4096}$/.test(token)) return fail();
  // Schema-isolated keys keep rollback safe: v1 readers never see v2 state,
  // while a rolled-back release retains its own untouched v1 state and lock.
  const stateKey = `likerts:monitor:${namespace}:v2:state`;
  const lockKey = `likerts:monitor:${namespace}:v2:lock`;
  async function command(value) {
    const signal = AbortSignal.timeout(2000);
    const response = await fetcher(url.origin, { method: 'POST', redirect: 'manual', cache: 'no-store', credentials: 'omit', signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(value) });
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); return fail(); }
    const body = await boundedJson(response, signal, 8192);
    if (!body || Object.hasOwn(body, 'error') || !Object.hasOwn(body, 'result')) return fail();
    return body.result;
  }
  return {
    async acquire() {
      const lease = randomUUID();
      const result = await command(['EVAL', ACQUIRE_SCRIPT, 2, stateKey, lockKey, lease, MONITOR_LOCK_SECONDS]);
      if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(result[0])) return fail();
      return result[0] === 0 ? null : { lease, previous: parseState(result[1] || null) };
    },
    async save(lease, state, release = false) {
      const raw = JSON.stringify(state);
      parseState(raw);
      if (await command(['EVAL', SAVE_SCRIPT, 2, stateKey, lockKey, lease, raw, MONITOR_STATE_TTL_SECONDS, release ? '1' : '0']) !== 1) return fail();
    },
    async read() { return parseState(await command(['GET', stateKey])); },
  };
}

export async function readHeartbeat({ environment = process.env, fetcher = fetch, store, now = Date.now } = {}) {
  const scope = { independentWatcherRequired: true };
  try {
    store ??= monitorStore({ environment, fetcher });
    if (!store) return { statusCode: 503, body: { status: 'state_not_configured', ...scope } };
    const state = await store.read();
    if (!state || state.completedAt === 0 || now() - state.completedAt > MISSING_SIGNAL_MS) {
      return { statusCode: 503, body: { status: 'missing_signal', ...scope } };
    }
    if (state.completedAt > now() + 60000) return fail();
    const pending = state.notification && !state.notification.accepted;
    const status = pending ? 'alert_delivery_pending' : state.health === 'degraded' ? 'degraded' : 'current';
    return { statusCode: status === 'current' ? 200 : 503, body: { status, coverage: state.coverage,
      lastCompletedAt: new Date(state.completedAt).toISOString(), ...scope } };
  } catch { return { statusCode: 503, body: { status: 'state_unavailable', ...scope } }; }
}
