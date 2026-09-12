import { boundedJson } from './status.mjs';

export const USAGE_PROBE_URL = 'https://likerts-api.onrender.com/v1/usage';
// This never accepts an owner JWT, collection credential, or provider key. The
// issuer must separately prove that this purpose-issued token has only usage:read.
const PROBE_TOKEN = /^lks_[a-f0-9]{32}$/;
const count = value => Number.isSafeInteger(value) && value >= 0;
const usageCounts = ['acceptedResponses', 'monthAcceptedResponses'];

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
