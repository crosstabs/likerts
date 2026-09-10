import { collectStatus } from '../lib/status.mjs';

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).json({ error: 'method_not_allowed' });
  }
  const result = await collectStatus();
  // A short shared cache bounds public probe fan-out. checkedAt makes age visible.
  response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return response.status(result.status === 'reachable' ? 200 : 503).json(result);
}
