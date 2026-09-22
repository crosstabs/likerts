// Exercise the shipped Blackbox module against disposable, synthetic TLS responses.
// No production endpoint, credential, receiver or monitor state is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const image = process.env.BLACKBOX_IMAGE || 'prom/blackbox-exporter:v0.28.0';
// Use the checkout's ignored scratch directory: macOS VM runtimes may not share /var/folders.
const scratch = fileURLToPath(new URL('../.validation-private/', import.meta.url));
mkdirSync(scratch, { recursive: true });
const directory = mkdtempSync(join(scratch, 'watcher-fixture-'));
const name = `likerts-watcher-${randomUUID()}`;
const token = randomUUID();
let tlsServer, plainServer, containerStarted = false, redirected = 0;
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 120_000, stdio: 'pipe' });
const current = {
  status: 'current', coverage: 'admission_maintenance_callback_db',
  independentWatcherRequired: true, lastCompletedAt: new Date().toISOString(),
};
const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '0.0.0.0', () => resolve(server.address().port));
});
function handler(request, response) {
  if (request.url === '/redirected') redirected++;
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end(); return;
  }
  assert.equal(request.headers.accept, 'application/json');
  assert.equal(request.headers['cache-control'], 'no-cache, no-store');
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  let status = 200, body = { ...current };
  switch (request.url) {
    case '/unauthorized': status = 401; break;
    case '/missing_signal': status = 503; body.status = 'missing_signal'; break;
    case '/not_armed': status = 503; body.status = 'not_armed'; break;
    case '/pending': status = 503; body.status = 'alert_delivery_pending'; break;
    case '/degraded': body.status = 'degraded'; break;
    case '/wrong-coverage': body.coverage = 'public'; break;
    case '/missing-field': delete body.independentWatcherRequired; break;
    case '/wrong-type': body.independentWatcherRequired = 'true'; break;
    case '/wrong-timestamp': body.lastCompletedAt = 0; break;
    case '/missing-cache-control': delete headers['Cache-Control']; break;
    case '/cacheable': headers['Cache-Control'] = 'public, max-age=60'; break;
    case '/html': headers['Content-Type'] = 'text/html'; break;
    case '/oversized': body.padding = 'x'.repeat(5000); break;
    case '/redirect': status = 302; headers.Location = '/redirected'; break;
  }
  const encoded = JSON.stringify(body);
  response.writeHead(status, headers).end(request.url === '/invalid-json' ? encoded.slice(0, -1) : encoded);
}

try {
  chmodSync(directory, 0o755); // Only synthetic credentials and a one-run fixture certificate.
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=host.docker.internal', '-addext', 'subjectAltName=DNS:host.docker.internal',
    '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem')]);
  const source = readFileSync(new URL('../infrastructure/observability/blackbox-monitor.yml', import.meta.url), 'utf8');
  // Trust only the fixture CA in this test copy; production retains normal trust roots.
  writeFileSync(join(directory, 'blackbox.yml'), source
    .replace('min_version: TLS12', 'min_version: TLS12\n        ca_file: /fixture/cert.pem')
    .replace('/run/secrets/likerts_cron_secret', '/fixture/token'));
  writeFileSync(join(directory, 'token'), token, { mode: 0o444 });
  tlsServer = https.createServer({ key: readFileSync(join(directory, 'key.pem')), cert: readFileSync(join(directory, 'cert.pem')) }, handler);
  plainServer = http.createServer(handler);
  const tlsPort = await listen(tlsServer), plainPort = await listen(plainServer);
  run('docker', ['run', '--detach', '--rm', '--name', name, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--add-host', 'host.docker.internal:host-gateway',
    '--add-host', 'host-gateway.invalid:host-gateway',
    '--publish', '127.0.0.1::9115', '--mount', `type=bind,source=${directory},target=/fixture,readonly`,
    image, '--config.file=/fixture/blackbox.yml']);
  containerStarted = true;
  const port = run('docker', ['port', name, '9115/tcp']).trim().split(':').at(-1);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/-/healthy`, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) { ready = true; break; }
    } catch { /* Container startup is bounded by this loop. */ }
    await delay(100);
  }
  assert(ready, 'Blackbox exporter did not become healthy');
  async function probe(path, expected, scheme = 'https', hostname = 'host.docker.internal') {
    const targetPort = scheme === 'https' ? tlsPort : plainPort;
    const query = new URLSearchParams({ module: 'likerts_monitor_heartbeat', target: `${scheme}://${hostname}:${targetPort}${path}` });
    const response = await fetch(`http://127.0.0.1:${port}/probe?${query}`, { signal: AbortSignal.timeout(20_000) });
    const metrics = await response.text();
    assert.equal(response.status, 200, `probe handler: ${path}`);
    assert.match(metrics, new RegExp(`^probe_success ${expected}$`, 'm'), `unexpected result: ${path}`);
    console.log(`PASS ${scheme}://${hostname}${path}: probe_success=${expected}`);
  }
  await probe('/current', 1); // Proves the bearer was read from its file and sent.
  for (const path of ['/unauthorized', '/missing_signal', '/not_armed', '/pending', '/degraded',
    '/wrong-coverage', '/missing-field', '/wrong-type', '/wrong-timestamp', '/missing-cache-control',
    '/cacheable', '/html', '/oversized', '/invalid-json', '/redirect']) await probe(path, 0);
  assert.equal(redirected, 0, 'redirect must never be followed');
  await probe('/current', 0, 'http');
  // A different hostname reaches the same fixture but must fail certificate verification.
  await probe('/current', 0, 'https', 'host-gateway.invalid');
  await probe('/current', 1); // Failed probes must not poison recovery.
  console.log('Independent watcher fixture passed; no alert was delivered.');
} catch (error) {
  if (containerStarted) console.error(run('docker', ['logs', name]));
  throw error;
} finally {
  if (containerStarted) run('docker', ['rm', '--force', name]);
  await Promise.all([tlsServer, plainServer].filter(Boolean).map(server => new Promise(resolve => {
    server.closeAllConnections(); server.close(resolve);
  })));
  rmSync(directory, { recursive: true, force: true });
}
