import { authorizedMonitor, monitorIsArmed } from './monitor.js';
import { readHeartbeat } from '../lib/monitor-state.mjs';

// A separately hosted watcher must poll this endpoint. It never advances the
// heartbeat or posts alerts, so polling cannot make a missing run look current.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'method_not_allowed' }); }
  if (!authorizedMonitor(request.headers.authorization, process.env.CRON_SECRET)) return response.status(401).json({ error: 'unauthorized' });
  if (!monitorIsArmed(process.env)) return response.status(503).json({ status: 'not_armed', independentWatcherRequired: true });
  const result = await readHeartbeat();
  return response.status(result.statusCode).json(result.body);
}
