import { timingSafeEqual } from 'node:crypto';
import { collectStatus } from '../lib/status.mjs';

export function authorizedMonitor(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(typeof header === 'string' ? header : '');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function alertDestination(environment) {
  try {
    const url = new URL(environment.LIKERTS_ALERT_WEBHOOK_URL);
    // The operator must explicitly approve the exact HTTPS receiver origin.
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || url.origin !== environment.LIKERTS_ALERT_RECEIVER_ORIGIN) return null;
    return url.toString();
  } catch { return null; }
}

export async function runMonitor({ environment = process.env, probe = collectStatus, fetcher = fetch } = {}) {
  const destination = alertDestination(environment);
  if (!destination) return { statusCode: 503, body: { status: 'not_armed', reason: 'approved_alert_receiver_required' } };
  const result = await probe();
  if (result.status === 'reachable') return { statusCode: 200, body: { status: 'reachable', checkedAt: result.checkedAt, alert: 'not_needed' } };
  const payload = {
    text: 'Likerts dependency check failed. Inspect https://likerts.com/status and the operations runbook.',
    service: 'likerts', event: 'dependency_unavailable', checkedAt: result.checkedAt,
    components: result.components.map(({ id, status }) => ({ id, status })),
  };
  try {
    const reply = await fetcher(destination, { method: 'POST', redirect: 'manual',
      signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    await reply.body?.cancel();
    if (reply.status < 200 || reply.status >= 300) throw new Error('receiver_rejected');
    return { statusCode: 503, body: { status: 'degraded', checkedAt: result.checkedAt, alert: 'receiver_accepted' } };
  } catch {
    return { statusCode: 503, body: { status: 'degraded', checkedAt: result.checkedAt, alert: 'delivery_failed' } };
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') return response.status(405).json({ error: 'method_not_allowed' });
  if (!authorizedMonitor(request.headers.authorization, process.env.CRON_SECRET)) return response.status(401).json({ error: 'unauthorized' });
  const result = await runMonitor();
  // Contains only fixed classifications; never log receiver URLs or secrets.
  console.info(JSON.stringify({ monitor: 'likerts', ...result.body }));
  return response.status(result.statusCode).json(result.body);
}
