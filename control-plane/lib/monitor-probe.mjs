import { boundedJson } from './status.mjs';

export const USAGE_PROBE_URL = 'https://likerts-api.onrender.com/v1/usage';
// This never accepts an owner JWT, collection credential, or provider key. The
// issuer must separately prove that this purpose-issued token has only usage:read.
const PROBE_TOKEN = /^lks_[a-f0-9]{32}$/;
const count = value => Number.isSafeInteger(value) && value >= 0;
const usageCounts = ['acceptedResponses', 'monthAcceptedResponses'];
const integer = value => Number.isSafeInteger(value) && value >= 0;

function maintenanceTarget(environment, kind) {
  const prefix = kind === 'cleanup' ? 'LIKERTS_CLEANUP' : 'LIKERTS_ARCHIVE';
  const urlValue = environment[`${prefix}_STATUS_URL`];
  const origin = environment[`${prefix}_STATUS_ORIGIN`];
  const token = environment[`${prefix}_STATUS_TOKEN`];
  if (!urlValue && !origin && !token) return null;
  try {
    const url = new URL(urlValue);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || url.pathname !== '/api/status' || !url.hostname.endsWith('.vercel.app') || url.origin !== origin
      || typeof token !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(token)) return false;
    return { url: url.toString(), token };
  } catch { return false; }
}

function maintenanceStatus(kind, body) {
  if (!body || body.ok !== true || body.kind !== kind || !body.status) return 'invalid_response';
  const value = body.status;
  if (kind === 'cleanup') {
    const fields = ['pendingObjects', 'retryingObjects', 'tombstones', 'oldestDueSeconds', 'dueWorkspaces', 'oldestRetentionSeconds'];
    if (!fields.every(key => integer(value[key])) || !(value.lastCompletedAt === null || typeof value.lastCompletedAt === 'string')) return 'invalid_response';
    return value.retryingObjects > 0
      || (value.pendingObjects > 0 && value.oldestDueSeconds > 1800)
      || (value.dueWorkspaces > 0 && value.oldestRetentionSeconds > 7200) ? 'backlog' : 'reachable';
  }
  const counters = ['pendingEvents', 'coveredEvents', 'oldestPendingSeconds', 'uncheckpointedEvents',
    'oldestUncheckpointedSeconds', 'retryingEvents', 'activeLeases', 'staleLeases', 'pendingCheckpointAgeSeconds'];
  if (!counters.every(key => integer(value[key])) || typeof value.pendingCheckpoint !== 'boolean'
    || typeof value.fenced !== 'boolean' || typeof value.checkpointed !== 'boolean') return 'invalid_response';
  if (value.coveredEvents > 0 && !value.checkpointed) return 'invalid_response';
  if (value.fenced) return 'fenced';
  return value.retryingEvents > 0 || value.staleLeases > 0
    || (value.pendingEvents > 0 && value.oldestPendingSeconds > 1800)
    || (value.uncheckpointedEvents > 0 && value.oldestUncheckpointedSeconds > 1800)
    || (value.pendingCheckpoint && value.pendingCheckpointAgeSeconds > 1800) ? 'backlog' : 'reachable';
}

export async function collectAdmissionStatus({ environment = process.env, fetcher = fetch, timeoutMs = 4000 } = {}) {
  const token = environment.LIKERTS_MONITOR_USAGE_TOKEN;
  if (!token) return { id: 'admission', status: 'not_configured' };
  if (!PROBE_TOKEN.test(token)) return { id: 'admission', status: 'invalid_configuration' };
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetcher(USAGE_PROBE_URL, { method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'cache-control': 'no-cache, no-store' },
      redirect: 'manual', credentials: 'omit', cache: 'no-store', signal });
    // An authenticated probe must reach the origin, not a cached healthy result.
    const cacheHit = /(?:HIT|STALE)/i.test(`${response.headers.get('x-vercel-cache') ?? ''} ${response.headers.get('cf-cache-status') ?? ''}`)
      || Number(response.headers.get('age') ?? 0) > 0;
    if (response.status !== 200 || cacheHit) {
      void response.body?.cancel().catch(() => {});
      return { id: 'admission', status: cacheHit ? 'cached_response' : response.status === 429 ? 'rate_limited'
        : response.status === 401 || response.status === 403 ? 'credential_rejected' : 'unavailable' };
    }
    const body = await boundedJson(response, signal);
    const valid = body && usageCounts.every(key => count(body[key]));
    return { id: 'admission', status: valid ? 'reachable' : 'invalid_response' };
  } catch {
    // Never return the upstream payload, credential, identifiers or balances.
    return { id: 'admission', status: 'unavailable' };
  }
}

export async function collectMaintenanceStatus({ environment = process.env, fetcher = fetch, timeoutMs = 10000 } = {}) {
  return Promise.all(['cleanup', 'archive'].map(async kind => {
    const target = maintenanceTarget(environment, kind);
    if (target === null) return { id: kind, status: 'not_configured' };
    if (target === false) return { id: kind, status: 'invalid_configuration' };
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await fetcher(target.url, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal,
        headers: { accept: 'application/json', authorization: `Bearer ${target.token}`, 'cache-control': 'no-cache, no-store' } });
      const cacheHit = /(?:HIT|STALE)/i.test(`${response.headers.get('x-vercel-cache') ?? ''} ${response.headers.get('cf-cache-status') ?? ''}`)
        || Number(response.headers.get('age') ?? 0) > 0;
      if (response.status !== 200 || cacheHit) {
        void response.body?.cancel().catch(() => {});
        return { id: kind, status: cacheHit ? 'cached_response' : response.status === 401 || response.status === 403 ? 'credential_rejected' : 'unavailable' };
      }
      return { id: kind, status: maintenanceStatus(kind, await boundedJson(response, signal, 8192)) };
    } catch { return { id: kind, status: 'unavailable' }; }
  }));
}
