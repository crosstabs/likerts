import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const port = Number(process.env.LIKERTS_DEMO_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LIKERTS_DEMO_PORT must be between 1024 and 65535');
const origin = `http://127.0.0.1:${port}`;
const scratch = await mkdtemp(join(tmpdir(), 'likerts-feedback-demo-'));
const managementToken = randomBytes(32).toString('hex');
let api;
let server;
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  server?.closeAllConnections();
  server?.close();
  if (api && api.exitCode === null) {
    api.kill('SIGTERM');
    await Promise.race([new Promise(resolve => api.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (api.exitCode === null) api.kill('SIGKILL');
  }
  await rm(scratch, { recursive: true, force: true });
  console.log('\nLocal demo stopped. Temporary responses have been cleared.');
  process.exit(code);
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());

function binary(manifest, name) {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', join(root, manifest)], { encoding: 'utf8' }));
  return join(metadata.target_directory, 'debug', name);
}
async function freePort() {
  const probe = createPortServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const value = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return value;
}
const minimalEnv = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
try {
  const apiPort = await freePort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const cli = binary('tools/cli/Cargo.toml', 'likerts');
  api = spawn(binary('backend/Cargo.toml', 'likerts-server'), [], {
    cwd: scratch,
    env: { ...minimalEnv, LIKERTS_PORT: String(apiPort), LIKERTS_BIND_ADDRESS: '127.0.0.1', LIKERTS_ALLOW_MEMORY: '1', LIKERTS_ALLOW_DEV_AUTH: '1', LIKERTS_ADMISSION_MODE: 'disabled', LIKERTS_DEV_TOKENS: JSON.stringify({ [managementToken]: 'embedded-feedback-demo' }), LIKERTS_EXPORT_DIR: join(scratch, 'exports') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let startupError = '';
  api.stderr.on('data', chunk => { startupError = (startupError + chunk).slice(-3000); });
  api.once('error', error => { startupError = error.message; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (api.exitCode !== null || api.signalCode !== null) break;
    try { const health = await fetch(`${apiOrigin}/health`, { signal: AbortSignal.timeout(500) }); if (health.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`The local API could not start. ${startupError.replaceAll(managementToken, '[redacted]')}`);
  const call = (operation, body) => {
    try {
      return JSON.parse(execFileSync(cli, ['call', operation, '--input', '-'], { input: JSON.stringify(body), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...minimalEnv, LIKERTS_API_URL: apiOrigin, LIKERTS_TOKEN: managementToken } }));
    } catch { throw new Error(`Local provisioning failed at ${operation}.`); }
  };
  const capabilities = JSON.parse(await readFile(join(root, 'control-plane/public/docs/sdk-capabilities.json'), 'utf8'));
  const definition = JSON.parse(await readFile(join(here, 'survey.json'), 'utf8'));
  const survey = call('surveys_create', definition);
  const published = call('surveys_publish', { id: survey.id, revision: survey.revision, sdkCapabilities: capabilities });
  const collection = call('collections_create', { idempotencyKey: 'local-checkout-collection', surveyId: published.surveyId, version: published.version, placement: 'checkout_success', sdkCapabilities: capabilities });
  const collectionPath = `/v1/collections/${collection.id}`;
  const sdkFiles = new Set(['index.js', 'branching.js', 'choice-features.js', 'advanced-questions.js']);

  const send = (response, status, content, type = 'application/json') => {
    response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    response.end(typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  };
  server = createServer(async (request, response) => {
    try {
      // This intentionally unauthenticated operator sample is loopback-only.
      // Host/origin checks prevent other sites from using it as a local API bridge.
      if (request.headers.host !== `127.0.0.1:${port}` || (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') return send(response, 403, { error: 'Use the local demo origin.' });
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && url.pathname === '/demo/config') return send(response, 200, { collectionId: collection.id, collectionToken: collection.token, storage: 'memory', surveyTitle: definition.title });
      if (request.method === 'GET' && url.pathname === '/operator/responses') {
        const upstream = await fetch(`${apiOrigin}/v1/responses?collectionId=${encodeURIComponent(collection.id)}&limit=10`, { headers: { Authorization: `Bearer ${managementToken}` }, signal: AbortSignal.timeout(10000) });
        return send(response, upstream.status, await upstream.text());
      }
      if ((request.method === 'GET' && url.pathname === collectionPath) || (request.method === 'POST' && url.pathname === `${collectionPath}/responses`)) {
        if (request.headers.authorization !== `Bearer ${collection.token}`) return send(response, 401, { error: 'Collection credential required.' });
        let body = '';
        for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 16384) return send(response, 413, { error: 'Demo request too large.' }); }
        const upstream = await fetch(`${apiOrigin}${url.pathname}`, { method: request.method, headers: { Authorization: request.headers.authorization, ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(request.method === 'POST' ? { body } : {}), signal: AbortSignal.timeout(10000) });
        return send(response, upstream.status, await upstream.text());
      }
      if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed.' });
      const asset = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] }[url.pathname];
      if (asset) return send(response, 200, await readFile(join(here, asset[0])), asset[1]);
      if (url.pathname.startsWith('/sdk/') && sdkFiles.has(url.pathname.slice(5))) return send(response, 200, await readFile(join(root, 'sdks/web/dist', url.pathname.slice(5))), 'text/javascript');
      if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
      return send(response, 404, { error: 'Not found.' });
    } catch { if (!response.headersSent) send(response, 502, { error: 'Local API unavailable. Restart the demo to try again.' }); else response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  api.once('exit', () => { if (!stopping) { console.error('Local API stopped unexpectedly.'); stop(1); } });
  console.log(`\nOpen ${origin}\nReal Web SDK → local Rust API → temporary memory storage.\nSurvey created and published through the CLI. Management credential remains server-side.\nPress Ctrl+C to stop and clear responses.`);
} catch (error) {
  console.error(error.message.replaceAll(managementToken, '[redacted]'));
  await stop(1);
}
