#!/usr/bin/env node
// Anonymous release-consumer rehearsal. Only the server is built from this checkout.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = 'community-v0.1.2';
const webVersion = '0.0.3';
const playwrightVersion = '1.63.0';
const target = `${process.platform}-${process.arch}`;
assert.ok(['linux-x64', 'darwin-arm64'].includes(target), 'Rehearsal supports Linux x64 and macOS arm64.');
const work = await mkdtemp(join(tmpdir(), 'likerts-newcomer-'));
const consumer = join(work, 'consumer');
await mkdir(consumer, { mode: 0o700 });
const project = `likerts-local-newcomer-${randomBytes(6).toString('hex')}`;
const environment = { ...process.env, LIKERTS_LOCAL_PROJECT: project, LIKERTS_LOCAL_STATE_DIR: join(work, 'state'), LIKERTS_LOCAL_PORT: '0' };
const composeScript = join(root, 'infrastructure/local/compose.sh');
const started = Date.now();
let stage = 'download';
let server, browser, composeStarted = false;
const transcript = [];
const record = name => { transcript.push({ check: name, result: 'passed' }); console.log(`PASS ${name}`); };
async function command(binary, args, options = {}) {
  return await new Promise((resolveCommand, reject) => {
    const child = spawn(binary, args, { cwd: consumer, env: environment, stdio: ['pipe', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', () => reject(new Error(`${stage}: command could not start (${basename(binary)})`)));
    child.on('close', code => code === 0 ? resolveCommand(stdout) : reject(new Error(`${stage}: ${basename(binary)} exited ${code}; no credential-bearing output retained`)));
    child.stdin.end(options.input ?? '');
  });
}
const compose = args => command('bash', [composeScript, ...args]);
async function download(url, path) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  assert.equal(response.status, 200, `Anonymous download failed: ${new URL(url).pathname}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path, bytes, { mode: 0o600 });
  return bytes;
}
try {
  const asset = `${release}-cli-${target}.tar.gz`;
  const releaseURL = `https://github.com/crosstabs/likerts/releases/download/${release}`;
  const checksums = (await download(`${releaseURL}/SHA256SUMS`, join(consumer, 'SHA256SUMS'))).toString();
  const archive = await download(`${releaseURL}/${asset}`, join(consumer, asset));
  const digest = createHash('sha256').update(archive).digest('hex');
  const checksumLine = checksums.split('\n').find(line => line.trim().endsWith(` ${asset}`));
  assert.ok(checksumLine, 'CLI asset must appear in release checksums');
  assert.equal(digest, checksumLine.trim().split(/\s+/)[0], 'Release checksum mismatch');
  const entries = (await command('tar', ['-tzf', join(consumer, asset)])).trim().split('\n');
  assert.ok(entries.every(path => !path.startsWith('/') && !path.split('/').includes('..')), 'Unsafe archive path');
  await command('tar', ['-xzf', join(consumer, asset), '-C', consumer]);
  const cliEntry = entries.find(path => path === 'likerts' || path.endsWith('/likerts'));
  assert.ok(cliEntry, 'CLI executable missing');
  const cli = join(consumer, cliEntry);
  const cliVersion = (await command(cli, ['--version'])).trim();
  assert.equal(cliVersion, 'likerts 0.1.2');
  record('anonymous-cli-download-and-sha256');

  stage = 'npm installation';
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'likerts-newcomer-check', private: true, type: 'module' }));
  await writeFile(join(work, 'npm-user.conf'), 'registry=https://registry.npmjs.org/\n');
  await writeFile(join(work, 'npm-global.conf'), '');
  const npmEnvironment = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(npmEnvironment, { NPM_CONFIG_USERCONFIG: join(work, 'npm-user.conf'), NPM_CONFIG_GLOBALCONFIG: join(work, 'npm-global.conf'), NPM_CONFIG_CACHE: join(work, 'npm-cache') });
  await command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', `@likerts/web@${webVersion}`, `playwright@${playwrightVersion}`], { env: npmEnvironment });
  const requireConsumer = createRequire(join(consumer, 'package.json'));
  const webPackage = JSON.parse(await readFile(join(consumer, 'node_modules/@likerts/web/package.json'), 'utf8'));
  assert.equal(webPackage.version, webVersion);
  const sdkDirectory = join(consumer, 'node_modules/@likerts/web/dist');
  const { LIKERTS_SDK_CAPABILITY } = await import(pathToFileURL(join(sdkDirectory, 'index.js')));
  assert.equal(LIKERTS_SDK_CAPABILITY.sdkVersion, webVersion);
  const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  const sdkIntegrity = lock.packages['node_modules/@likerts/web'].integrity;
  assert.ok(sdkIntegrity?.startsWith('sha512-'));
  await command(process.execPath, [join(consumer, 'node_modules/playwright/cli.js'), 'install', ...(process.env.CI ? ['--with-deps'] : []), 'chromium'], { env: npmEnvironment });
  record('fresh-public-npm-install');

  stage = 'durable API startup';
  composeStarted = true;
  await compose(['up', '--detach', '--wait', '--wait-timeout', '120', process.env.LIKERTS_SKIP_IMAGE_BUILD === '1' ? '--no-build' : '--build']);
  const endpoint = (await compose(['port', 'api', '8080'])).trim();
  assert.match(endpoint, /^127\.0\.0\.1:\d+$/);
  const apiContainer = (await compose(['ps', '-q', 'api'])).trim();
  const backendImageId = (await command('docker', ['inspect', '--format', '{{.Image}}', apiContainer])).trim();
  const api = `http://${endpoint}`;
  const credentials = await readFile(join(work, 'state/.env'), 'utf8');
  const token = /^LIKERTS_LOCAL_TOKEN=(.+)$/m.exec(credentials)?.[1];
  assert.ok(token);
  const cliEnv = { ...environment, LIKERTS_API_URL: api, LIKERTS_TOKEN: token, XDG_CONFIG_HOME: join(work, 'cli-config') };
  delete cliEnv.LIKERTS_COLLECTION_TOKEN;
  delete cliEnv.LIKERTS_WORKSPACE_ID;
  const call = async (name, input) => {
    stage = `released CLI ${name}`;
    return JSON.parse(await command(cli, ['call', name, '--input', '-'], { env: cliEnv, input: JSON.stringify(input) }));
  };
  const capabilities = await command(cli, ['capabilities']);
  assert.ok(capabilities.includes('surveys_create'));
  stage = 'released CLI lifecycle';
  const sdkCapabilities = { installations: [LIKERTS_SDK_CAPABILITY] };
  const survey = await call('surveys_create', { idempotencyKey: 'newcomer-survey', title: 'Newcomer feedback', questions: [{ id: 'rating', type: 'single_choice', label: 'How was setup?', required: true, options: [{ id: 'good', label: 'Good' }, { id: 'bad', label: 'Needs work' }] }] });
  const published = await call('surveys_publish', { id: survey.id, revision: survey.revision, sdkCapabilities });
  const collection = await call('collections_create', { idempotencyKey: 'newcomer-collection', surveyId: survey.id, version: published.version, placement: 'newcomer-browser', sdkCapabilities });
  record('released-cli-create-publish-collection');

  stage = 'real browser SDK';
  const app = `import {LikertsClient,mountSurvey} from '/sdk/index.js';
const config=await fetch('/bootstrap.json').then(r=>r.json());
const transport=(url,options)=>{if(options.body)window.submission=JSON.parse(options.body);return fetch(url,options)};
window.client=new LikertsClient(location.origin,config.token,transport);
window.collectionId=config.id;
const collection=await window.client.collection(config.id);
mountSurvey(document.querySelector('main'),collection,window.client,receipt=>{window.receipt=receipt;document.querySelector('output').textContent='Accepted'}, {channel:'newcomer'});`;
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      // Same-origin host integration: proxy only this collection's two respondent routes.
      if ([`/v1/collections/${collection.id}`, `/v1/collections/${collection.id}/responses`].includes(pathname)) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const upstream = await fetch(`${api}${pathname}`, { method: request.method, headers: { authorization: request.headers.authorization ?? '', 'content-type': 'application/json' }, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: 'manual', signal: AbortSignal.timeout(10000) });
        response.writeHead(upstream.status, { 'content-type': 'application/json' }); response.end(Buffer.from(await upstream.arrayBuffer())); return;
      }
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'");
      if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Likerts newcomer</title><script type="module" src="/app.js"></script><main></main><output></output></html>'); }
      else if (pathname === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(app); }
      else if (pathname === '/bootstrap.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ id: collection.id, token: collection.token })); }
      else if (/^\/sdk\/[a-z-]+\.js$/.test(pathname)) { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(join(sdkDirectory, basename(pathname)))); }
      else { response.writeHead(404); response.end(); }
    } catch { response.writeHead(502); response.end(); }
  });
  await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
  const { chromium } = requireConsumer('playwright');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.name));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel('How was setup?').selectOption('good');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.waitForFunction(() => window.receipt?.accepted === true);
  const receipt = await page.evaluate(() => window.receipt);
  const retry = await page.evaluate(() => window.client.submit(window.collectionId, window.submission));
  assert.deepEqual(retry, receipt);
  assert.deepEqual(pageErrors, []);
  const rows = await call('responses_list', { collectionId: collection.id, limit: 10 });
  assert.equal(rows.items.length, 1);
  assert.equal(rows.items[0].receipt.responseId, receipt.responseId);
  assert.equal(rows.items[0].answers.rating, 'good');
  record('browser-mount-submit-sdk-identical-retry-cli-retrieval');
  stage = 'revocation';
  await call('collections_update', { id: collection.id, revoke: true });
  const denial = await page.evaluate(async () => {
    try { await window.client.submit(window.collectionId, window.submission); return 200; }
    catch (error) { return error.status; }
  });
  assert.ok([401, 403, 410].includes(denial), `Revoked collection returned ${denial}`);
  const after = await call('responses_list', { collectionId: collection.id, limit: 10 });
  assert.equal(after.items.length, 1);
  record('revocation-denies-original-collection-credential');
  const evidence = { measuredAt: new Date().toISOString(), release, cliVersion, cliTarget: target, cliSha256: digest, webVersion, webIntegrity: sdkIntegrity, playwrightVersion, backendCheckout: (await command('git', ['-C', root, 'rev-parse', 'HEAD'])).trim(), backendImageId, backendBuiltDuringRun: process.env.LIKERTS_SKIP_IMAGE_BUILD !== '1', serverMode: 'durable-local-compose', durationSeconds: Math.round((Date.now() - started) / 1000), checks: transcript, limitations: ['Synthetic isolated local data; does not verify hosted sign-in, managed recovery, or production capacity.', 'CLI and SDK downloaded anonymously from their public release channels. Backend image identity and whether it was built during this run are recorded separately.'] };
  if (process.env.LIKERTS_NEWCOMER_EVIDENCE) {
    const evidencePath = resolve(process.env.LIKERTS_NEWCOMER_EVIDENCE);
    await mkdir(resolve(evidencePath, '..'), { recursive: true });
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  const cleanupFailures = [];
  try { await browser?.close(); } catch { cleanupFailures.push('browser'); }
  try {
    if (server) { server.closeAllConnections(); await new Promise(resolveServer => server.close(resolveServer)); }
  } catch { cleanupFailures.push('local server'); }
  if (composeStarted) try { await compose(['down', '--volumes', '--remove-orphans']); } catch { cleanupFailures.push(`isolated project ${project}`); }
  try { await rm(work, { recursive: true, force: true }); } catch { cleanupFailures.push('temporary files'); }
  if (cleanupFailures.length) throw new Error(`Cleanup failed: ${cleanupFailures.join(', ')}; inspect only this rehearsal's resources.`);
}
