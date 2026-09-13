import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.LIKERTS_EXAMPLE_PORT ?? 4360);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a local port from 1024 to 65535.');
const origin = `http://127.0.0.1:${port}`;
const files = new Map();
async function inventory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await inventory(join(directory, entry.name), `${prefix}/${entry.name}`);
    else if (entry.isFile()) files.set(`${prefix}/${entry.name}`, join(directory, entry.name));
  }
}
await inventory(join(here, 'dist'));
const required = name => { if (!process.env[name]) throw new Error('Local configuration incomplete.'); return process.env[name]; };
function config() {
  const api = new URL(required('LIKERTS_API_URL'));
  if ((api.protocol !== 'https:' && !(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname)))
      || api.username || api.password || api.pathname !== '/' || api.search || api.hash) throw new Error('Invalid API origin.');
  return { apiOrigin: api.origin, collectionId: required('LIKERTS_COLLECTION_ID'), collectionToken: required('LIKERTS_COLLECTION_TOKEN') };
}
function local(request) {
  return process.env.LIKERTS_EXAMPLE_LOCAL_OPERATOR === '1'
    && ['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
    && request.headers.host === `127.0.0.1:${port}`
    && (!request.headers.origin || request.headers.origin === origin)
    && request.headers['sec-fetch-site'] !== 'cross-site';
}
const send = (response, status, value, type = 'application/json') => {
  response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  response.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
};
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') return send(response, 405, { error: 'GET only.' });
    const url = new URL(request.url, origin);
    if (url.pathname.startsWith('/api/')) {
      if (!local(request)) return send(response, 403, { error: 'Local operator access disabled or denied.' });
      const value = config();
      if (url.pathname === '/api/feedback/config') return send(response, 200, value);
      if (url.pathname === '/api/feedback/response') {
        const id = url.searchParams.get('id') ?? '';
        if (!/^[a-zA-Z0-9-]{1,128}$/.test(id)) return send(response, 400, { error: 'Receipt ID required.' });
        const query = new URLSearchParams({ collectionId: value.collectionId, limit: '100' });
        const upstream = await fetch(`${value.apiOrigin}/v1/responses?${query}`, { headers: { Authorization: `Bearer ${required('LIKERTS_TOKEN')}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!upstream.ok) return send(response, 502, { error: 'API retrieval failed.' });
        const item = (await upstream.json()).items.find(item => item.receipt.responseId === id);
        return send(response, item ? 200 : 404, item ? { response: item } : { error: 'Receipt not found in the first 100 collection records.' });
      }
      return send(response, 404, { error: 'No such route.' });
    }
    const path = files.get(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!path) return send(response, 404, 'Not found.', 'text/plain');
    const type = path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    send(response, 200, await readFile(path), type);
  } catch { send(response, 503, { error: 'Local feedback configuration or API is unavailable.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local operator example: ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.closeAllConnections(); server.close(); });
