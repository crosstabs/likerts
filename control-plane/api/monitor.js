import { timingSafeEqual } from 'node:crypto';
import { collectStatus } from '../lib/status.mjs';
import { collectAdmissionStatus, collectCallbackStatus, collectMaintenanceStatus } from '../lib/monitor-probe.mjs';
import { COMPONENT_IDS, COMPONENT_STATUSES, MAX_ALERT_ATTEMPTS, monitorStore, prepareState } from '../lib/monitor-state.mjs';

export function authorizedMonitor(header, secret) {
  if (typeof secret !== 'string' || !/^[\x21-\x7e]{32,512}$/.test(secret)) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(typeof header === 'string' ? header : '');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function alertDestination(environment) {
  try {
    const url = new URL(environment.LIKERTS_ALERT_WEBHOOK_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || url.origin !== environment.LIKERTS_ALERT_RECEIVER_ORIGIN) return null;
    return url.toString();
  } catch { return null; }
}

export function monitorIsArmed(environment) {
  return environment.LIKERTS_MONITOR_ARMED === '1'
    && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(environment.LIKERTS_MONITOR_RESPONDER_ID ?? '')
    && !!alertDestination(environment);
}

export async function runMonitor({ environment = process.env, probe = collectStatus,
  admissionProbe = collectAdmissionStatus, maintenanceProbe = collectMaintenanceStatus, callbackProbe = collectCallbackStatus,
  fetcher = fetch, store, now = Date.now } = {}) {
  if (!monitorIsArmed(environment)) return { statusCode: 503, body: { status: 'not_armed', reason: 'approved_receiver_and_responder_required' } };
  try {
    store ??= monitorStore({ environment, fetcher });
    if (!store) return { statusCode: 503, body: { status: 'not_armed', reason: 'durable_state_required' } };
    const lock = await store.acquire();
    if (!lock) return { statusCode: 503, body: { status: 'run_in_progress' } };
    const [result, admission, maintenance, callback] = await Promise.all([
      probe({ fetcher }), admissionProbe({ environment, fetcher }), maintenanceProbe({ environment, fetcher }), callbackProbe({ environment, fetcher }),
    ]);
    // Select known classifications only. Never copy upstream objects into state,
    // notifications, logs or responses. Use our clock, not an upstream string.
    const components = COMPONENT_IDS.map(id => {
      const c = id === 'admission' ? admission
        : id === 'callback' ? callback
        : id === 'cleanup' || id === 'archive' ? maintenance?.find(c => c.id === id)
          : result?.components?.find(c => c.id === id);
      return { id, status: COMPONENT_STATUSES.includes(c?.status) ? c.status : 'unavailable' };
    });
    const admissionCovered = components.find(c => c.id === 'admission').status !== 'not_configured';
    const maintenanceCovered = components.filter(c => c.id === 'cleanup' || c.id === 'archive').every(c => c.status !== 'not_configured');
    const callbackCovered = components.find(c => c.id === 'callback').status !== 'not_configured';
    const coverage = admissionCovered && maintenanceCovered && callbackCovered ? 'admission_maintenance_callback_db'
      : maintenanceCovered && callbackCovered ? 'maintenance_callback_db'
        : admissionCovered && callbackCovered ? 'admission_callback_db' : callbackCovered ? 'callback_db'
          : admissionCovered && maintenanceCovered ? 'admission_maintenance_db'
            : maintenanceCovered ? 'maintenance_db' : admissionCovered ? 'admission' : 'reachability_only';
    const health = components.every(c => c.status === 'reachable') ? 'reachable' : 'degraded';
    const state = prepareState(lock.previous, health, components, coverage, now());
    let alert = state.notification?.accepted ? 'already_accepted' : 'not_needed';
    const notification = state.notification;
    if (notification && !notification.accepted) {
      if (notification.attempts >= MAX_ALERT_ATTEMPTS) alert = 'retry_exhausted';
      else {
        // Persist the stable event ID and attempt before a possibly ambiguous POST.
        notification.attempts += 1;
        await store.save(lock.lease, state);
        const { attempts, accepted, ...event } = notification;
        const payload = { service: 'likerts', ...event,
          text: event.event === 'dependency_recovered' ? 'Likerts monitored dependencies recovered. Verify the incident before closing it.'
            : 'Likerts monitored dependency check failed. Inspect the private monitor and operations runbook.' };
        try {
          const reply = await fetcher(alertDestination(environment), { method: 'POST', redirect: 'manual', credentials: 'omit', cache: 'no-store',
            signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
          void reply.body?.cancel().catch(() => {});
          if (reply.status < 200 || reply.status >= 300) throw new Error('receiver_rejected');
          notification.accepted = true;
          alert = 'receiver_accepted';
          if (health === 'reachable') { state.notification = null; state.incidentId = null; }
        } catch { alert = 'delivery_failed'; }
      }
    }
    state.completedAt = now();
    await store.save(lock.lease, state, true);
    const statusCode = health === 'reachable' && !['delivery_failed', 'retry_exhausted'].includes(alert) ? 200 : 503;
    return { statusCode, body: { status: health, checkedAt: new Date(state.completedAt).toISOString(), coverage, alert,
      admission: components.find(c => c.id === 'admission').status,
      maintenance: components.filter(c => c.id === 'cleanup' || c.id === 'archive'),
      callback: components.find(c => c.id === 'callback').status, independentWatcherRequired: true } };
  } catch {
    return { statusCode: 503, body: { status: 'monitor_unavailable', reason: 'probe_or_state_unavailable' } };
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'method_not_allowed' }); }
  if (!authorizedMonitor(request.headers.authorization, process.env.CRON_SECRET)) return response.status(401).json({ error: 'unauthorized' });
  const result = await runMonitor();
  // Fixed classifications only; no credentials, receiver URL, customer data or responder identity.
  console.info(JSON.stringify({ monitor: 'likerts', ...result.body }));
  return response.status(result.statusCode).json(result.body);
}
