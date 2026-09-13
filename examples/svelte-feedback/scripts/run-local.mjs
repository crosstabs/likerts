import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIKERTS_SDK_CAPABILITY } from '@likerts/web';

const here = fileURLToPath(new URL('../', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const check = process.argv.includes('--check');
const port = Number(process.env.LIKERTS_EXAMPLE_PORT ?? 4360);
const apiPort = Number(process.env.LIKERTS_EXAMPLE_API_PORT ?? 4361);
if (![port, apiPort].every(value => Number.isInteger(value) && value >= 1024 && value <= 65535) || port === apiPort) throw new Error('Choose two distinct local ports from 1024 to 65535.');
const origin = `http://127.0.0.1:${port}`, apiOrigin = `http://127.0.0.1:${apiPort}`;
const scratch = await mkdtemp(join(tmpdir(), 'likerts-svelte-'));
const token = randomBytes(32).toString('hex');
const workspace = `svelte-${randomUUID()}`;
const children = [];
let stopping = false;
const minimal = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await rm(scratch, { recursive: true, force: true });
  process.exit(code);
}
process.once('SIGINT', () => stop()); process.once('SIGTERM', () => stop());
function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: 'inherit', ...options });
    children.push(child);
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${executable} failed (${code}).`)));
  });
}
async function waitFor(url, child) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null || child.signalCode) throw new Error('Local process exited before ready.');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Local service did not become ready.');
}
function binary(manifest, name) {
  const value = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', manifest], { cwd: root, encoding: 'utf8' }));
  return join(value.target_directory, 'debug', name);
}
try {
  await command('cargo', ['build', '--quiet', '--locked', '--manifest-path', 'backend/Cargo.toml', '--bin', 'likerts-server']);
  await command('cargo', ['build', '--quiet', '--locked', '--manifest-path', 'tools/cli/Cargo.toml', '--bin', 'likerts']);
  const api = spawn(binary('backend/Cargo.toml', 'likerts-server'), [], { cwd: scratch,
    env: { ...minimal, LIKERTS_PORT: String(apiPort), LIKERTS_BIND_ADDRESS: '127.0.0.1', LIKERTS_ALLOW_MEMORY: '1',
      LIKERTS_ALLOW_DEV_AUTH: '1', LIKERTS_ADMISSION_MODE: 'disabled', LIKERTS_DEV_TOKENS: JSON.stringify({ [token]: workspace }), LIKERTS_EXPORT_DIR: join(scratch, 'exports') },
    stdio: ['ignore', 'ignore', 'pipe'] });
  children.push(api);
  await waitFor(`${apiOrigin}/health`, api);
  const cli = binary('tools/cli/Cargo.toml', 'likerts');
  const call = (operation, body) => {
    try { return JSON.parse(execFileSync(cli, ['call', operation, '--input', '-'], { cwd: root, input: JSON.stringify(body), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...minimal, LIKERTS_API_URL: apiOrigin, LIKERTS_TOKEN: token } })); }
    catch { throw new Error(`Local provisioning failed: ${operation}.`); }
  };
  const sdkCapabilities = { installations: [LIKERTS_SDK_CAPABILITY] };
  const survey = call('surveys_create', { idempotencyKey: randomUUID(), title: 'How was your checkout?', questions: [
    { id: 'rating', type: 'scale', label: 'How easy was it?', required: true, min: 1, max: 5 },
    { id: 'comment', type: 'text', label: 'What could improve?', maxLength: 200 },
  ] });
  const published = call('surveys_publish', { id: survey.id, revision: survey.revision, sdkCapabilities });
  const collection = call('collections_create', { idempotencyKey: randomUUID(), surveyId: published.surveyId, version: published.version, placement: 'checkout', sdkCapabilities });
  call('collections_security_update', { id: collection.id, allowedOrigins: [origin], requestsPerMinute: 60 });
  const env = { ...minimal, LIKERTS_EXAMPLE_LOCAL_OPERATOR: '1', LIKERTS_EXAMPLE_ORIGIN: origin, LIKERTS_EXAMPLE_PORT: String(port), LIKERTS_API_URL: apiOrigin,
    LIKERTS_TOKEN: token, LIKERTS_COLLECTION_ID: collection.id, LIKERTS_COLLECTION_TOKEN: collection.token };
  const args = [join(here, 'scripts/server.mjs')];
  if (check) {
    const disabled = spawn(process.execPath, args, { cwd: here, env: { ...env, LIKERTS_EXAMPLE_LOCAL_OPERATOR: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(disabled);
    await waitFor(origin, disabled);
    for (const path of ['/api/feedback/config', '/api/feedback/response?id=unconfigured']) {
      if ((await fetch(`${origin}${path}`)).status !== 403) throw new Error('Operator route did not fail closed without local opt-in.');
    }
    const exited = new Promise(resolve => disabled.once('exit', resolve)); disabled.kill('SIGTERM'); await exited;
    console.log('PASS: operator/config routes deny access when local opt-in is absent.');
  }
  const frontend = spawn(process.execPath, args, { cwd: here, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(frontend);
  await waitFor(origin, frontend);
  console.log(`Svelte feedback example: ${origin}\nReal local API, collection-scoped browser credential; temporary data clears on shutdown.`);
  if (check) {
    await command(process.execPath, ['scripts/check.mjs'], { cwd: here, env: { ...env, LIKERTS_EXAMPLE_SCREENSHOT_DIR: process.env.LIKERTS_EXAMPLE_SCREENSHOT_DIR ?? scratch } });
    await stop();
  }
  for (const child of [api, frontend]) child.once('exit', () => { if (!stopping) stop(1); });
} catch (error) { console.error(String(error.message).replaceAll(token, '[redacted]')); await stop(1); }
