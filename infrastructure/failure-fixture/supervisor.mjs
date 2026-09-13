// Disposable process-loss fixture only. Never install this supervisor in production.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const paths = { api: '/usr/local/bin/likerts-server', worker: '/usr/local/bin/likerts-webhook-worker' };
const digest = value => createHash('sha256').update(value).digest('hex');
const requireValue = (ok, code) => { if (!ok) throw Error(code); };
export function configuration(env) {
  requireValue(/^[a-f0-9]{64}$/.test(env.LIKERTS_DRILL_ADMIN_TOKEN ?? ''), 'invalid_drill_token');
  const database = env.LIKERTS_DRILL_DATABASE;
  requireValue(/^likerts_drill_[a-f0-9]{16,32}$/.test(database ?? ''), 'invalid_drill_database');
  const api = new URL(env.DATABASE_URL), worker = new URL(env.LIKERTS_WEBHOOK_DATABASE_URL);
  for (const [url, user] of [[api, 'likerts_runtime'], [worker, 'likerts_webhook_worker']]) {
    requireValue(['postgres:', 'postgresql:'].includes(url.protocol) && decodeURIComponent(url.pathname) === `/${database}` && url.username === user && url.password && !url.hash, 'invalid_drill_connection');
    requireValue(url.hostname === env.LIKERTS_DRILL_DATABASE_HOST, 'wrong_drill_host');
    requireValue([...url.searchParams.keys()].every(key => key === 'sslmode'), 'invalid_drill_connection');
    requireValue(url.searchParams.get('sslmode') === 'verify-full' || (url.searchParams.get('sslmode') === 'require' && /^dpg-[a-z0-9-]+$/.test(url.hostname)) || (env.LIKERTS_DRILL_LOCAL_TEST === '1' && url.searchParams.get('sslmode') === 'disable'), 'drill_tls_required');
  }
  requireValue(api.host === worker.host, 'different_drill_databases');
  for (const name of ['LIKERTS_WEBHOOK_CREDENTIAL_KEY', 'LIKERTS_COLLECTION_CREDENTIAL_KEY']) {
    requireValue(/^[A-Za-z0-9+/]{43}=$/.test(env[name] ?? '') && Buffer.from(env[name], 'base64').length === 32, 'invalid_fixture_key');
  }
  const port = Number(env.PORT ?? 10000);
  requireValue(Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 18081, 'invalid_fixture_port');
  const shared = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', LIKERTS_WEBHOOK_CREDENTIAL_KEY: env.LIKERTS_WEBHOOK_CREDENTIAL_KEY };
  return { token: env.LIKERTS_DRILL_ADMIN_TOKEN, port, children: {
    api: { ...shared, DATABASE_URL: env.DATABASE_URL, LIKERTS_COLLECTION_CREDENTIAL_KEY: env.LIKERTS_COLLECTION_CREDENTIAL_KEY,
      LIKERTS_BIND_ADDRESS: '127.0.0.1', LIKERTS_PORT: '18081', LIKERTS_ALLOW_DEV_AUTH: '1', LIKERTS_DEV_TOKENS: '{}', LIKERTS_ADMISSION_MODE: 'disabled', LIKERTS_EXPORT_PROVIDER: 'local', LIKERTS_EXPORT_DIR: '/tmp/likerts-drill-exports' },
    worker: { ...shared, LIKERTS_WEBHOOK_DATABASE_URL: env.LIKERTS_WEBHOOK_DATABASE_URL, LIKERTS_WEBHOOK_CONCURRENCY: '1' },
  } };
}
export function authorized(value, token) {
  const supplied = typeof value === 'string' && value.length <= 256 ? value : '';
  return timingSafeEqual(Buffer.from(digest(supplied), 'hex'), Buffer.from(digest(`Bearer ${token}`), 'hex'));
}
export function identity(child, binary) {
  requireValue(child.pid > 1 && child.pid !== process.pid && child.exitCode === null && child.signalCode === null, 'child_not_live');
  requireValue(readlinkSync(`/proc/${child.pid}/exe`) === binary, 'child_executable_changed');
  const status = readFileSync(`/proc/${child.pid}/status`, 'utf8');
  requireValue(Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) === process.getuid(), 'child_uid_changed');
  const raw = readFileSync(`/proc/${child.pid}/stat`, 'utf8');
  return { pid: child.pid, startTicks: raw.slice(raw.lastIndexOf(')') + 2).split(' ')[19] };
}
const reply = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
};
async function body(request) {
  let size = 0; const chunks = [];
  const timer = setTimeout(() => request.destroy(), 3000);
  try {
    for await (const chunk of request) { size += chunk.length; requireValue(size <= 1024, 'body_too_large'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { clearTimeout(timer); }
}
export async function start(env = process.env, { identify = identity } = {}) {
  const config = configuration(env), bootId = randomUUID(), events = [], children = {};
  let closing = false;
  const expected = Object.fromEntries(readFileSync('/opt/fixture/binaries.sha256', 'utf8').trim().split('\n').map(line => { const [sha, file] = line.split(/\s+/); return [file, sha]; }));
  for (const binary of Object.values(paths)) requireValue(expected[binary] === digest(readFileSync(binary)), 'binary_hash_mismatch');
  const record = event => { events.push({ at: new Date().toISOString(), ...event }); if (events.length > 32) events.shift(); };
  const launch = (target, generation = 1) => {
    const child = spawn(paths[target], [], { env: config.children[target], stdio: 'ignore' });
    const state = children[target] = { child, generation, killRequested: false, identity: null };
    child.once('spawn', () => { state.identity = identify(child, paths[target]); record({ target, generation, event: 'spawn', ...state.identity }); });
    child.once('error', () => record({ target, generation, event: 'spawn_error' }));
    child.once('exit', (code, signal) => {
      record({ target, generation, event: 'exit', code, signal, ...state.identity });
      // Only the one explicitly requested SIGKILL may restart. No crash loop.
      if (!closing && state.killRequested && signal === 'SIGKILL' && generation === 1) launch(target, 2);
    });
  };
  launch('api'); launch('worker');
  const expiresAt = Date.now() + 30 * 60 * 1000;
  const memory = () => Object.fromEntries(['current', 'peak', 'max'].map(name => {
    try { return [name, Number(readFileSync(`/sys/fs/cgroup/memory.${name}`, 'utf8').trim())]; } catch { return [name, null]; }
  }));
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === '/healthz' && request.method === 'GET') return reply(response, 200, { fixture: true, process: 'supervisor' });
      if (!authorized(request.headers['x-likerts-drill-authorization'], config.token)) return reply(response, 401, { error: 'unauthorized' });
      if (Date.now() >= expiresAt || closing) return reply(response, 410, { error: 'fixture_expired' });
      if (request.url === '/drill/status' && request.method === 'GET') {
        const states = Object.fromEntries(Object.entries(children).map(([target, state]) => [target, {
          generation: state.generation, identity: state.identity, live: state.child.exitCode === null && state.child.signalCode === null,
          sha256: expected[paths[target]], killRequested: state.killRequested,
        }]));
        return reply(response, 200, { bootId, expiresAt, serviceId: env.RENDER_SERVICE_ID ?? null, instanceId: env.RENDER_INSTANCE_ID ?? null, children: states, memory: memory(), events });
      }
      if (request.url === '/drill/kill' && request.method === 'POST') {
        requireValue(request.headers['content-type'] === 'application/json' && !request.headers['content-encoding'], 'invalid_kill_request');
        const input = await body(request);
        requireValue(input && Object.keys(input).sort().join(',') === 'bootId,generation,pid,startTicks,target', 'invalid_kill_request');
        requireValue(input.bootId === bootId && Object.hasOwn(paths, input.target), 'wrong_drill_identity');
        const state = children[input.target];
        requireValue(state.generation === 1 && input.generation === 1 && !state.killRequested, 'kill_already_used');
        const current = identify(state.child, paths[input.target]);
        requireValue(input.pid === current.pid && input.startTicks === current.startTicks && state.identity.pid === current.pid && state.identity.startTicks === current.startTicks, 'child_identity_changed');
        state.killRequested = true;
        requireValue(state.child.kill('SIGKILL'), 'signal_failed');
        record({ target: input.target, generation: 1, event: 'SIGKILL_requested', ...current });
        return reply(response, 202, { requested: true, target: input.target, ...current });
      }
      // A fixed loopback API bridge, not an HTTP proxy to caller-selected targets.
      if (request.url?.startsWith('/api/v1/') && ['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
        const headers = { ...request.headers, host: '127.0.0.1:18081' };
        delete headers['x-likerts-drill-authorization']; delete headers.connection;
        const upstream = http.request({ hostname: '127.0.0.1', port: 18081, path: request.url.slice(4), method: request.method, headers, timeout: 15000 }, result => {
          response.writeHead(result.statusCode, { ...result.headers, 'cache-control': 'no-store' }); result.pipe(response);
        });
        let size = 0;
        request.on('data', chunk => { size += chunk.length; if (size > 65536) { upstream.destroy(); request.destroy(); } });
        upstream.once('timeout', () => upstream.destroy());
        upstream.once('error', () => { if (!response.headersSent) reply(response, 503, { error: 'api_unavailable' }); else response.destroy(); });
        request.once('aborted', () => upstream.destroy());
        response.once('close', () => upstream.destroy()); request.pipe(upstream); return;
      }
      return reply(response, 404, { error: 'not_found' });
    } catch { if (!response.headersSent) reply(response, 409, { error: 'fixture_request_rejected' }); else response.destroy(); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
  server.maxConnections = 8; server.keepAliveTimeout = 1000;
  const stop = () => {
    if (closing) return; closing = true; server.close();
    for (const state of Object.values(children)) if (state.child.exitCode === null && state.child.signalCode === null) state.child.kill('SIGTERM');
    setTimeout(() => { for (const state of Object.values(children)) if (state.child.exitCode === null && state.child.signalCode === null) state.child.kill('SIGKILL'); process.exit(0); }, 27000).unref();
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  setTimeout(stop, 30 * 60 * 1000).unref();
  await new Promise(resolve => server.listen(config.port, '0.0.0.0', resolve));
  return { server, stop };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) start().catch(() => { console.error('fixture_start_failed'); process.exitCode = 1; });
