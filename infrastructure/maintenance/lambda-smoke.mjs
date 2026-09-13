import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runChild, verifyBundle } from './handler.mjs';

const root = resolve(process.argv[2] || '/bundle');
assert.equal(process.platform, 'linux');
for (const kind of ['cleanup', 'archive']) {
  const folder = resolve(root, 'projects', kind, '.vercel/output/functions/api/run.func');
  const manifest = JSON.parse(await readFile(resolve(folder, 'manifest.json'), 'utf8'));
  assert.equal(manifest.arch, process.arch);
  const config = JSON.parse(await readFile(resolve(folder, '.vc-config.json'), 'utf8'));
  assert.equal(config.architecture, process.arch === 'arm64' ? 'arm64' : 'x86_64');
  if (manifest.sourceDirty) {
    await assert.rejects(verifyBundle(pathToFileURL(folder + '/'), kind), { message: 'bundle_invalid' });
  } else {
    assert.equal(await verifyBundle(pathToFileURL(folder + '/'), kind), resolve(folder, 'worker'));
  }
  const { default: entrypoint } = await import(pathToFileURL(resolve(folder, 'index.mjs')));
  process.env.CRON_SECRET = 'synthetic-lambda-smoke-secret-32-characters';
  let responseBody;
  const response = { setHeader() {}, end(value) { responseBody = JSON.parse(value); } };
  await entrypoint({ method: 'GET', url: '/api/run', headers: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(responseBody, { ok: false, error: 'unauthorized' });
  const fixture = await mkdtemp(resolve(tmpdir(), 'maintenance-integrity-'));
  try {
    // Only a synthetic test manifest changes; the deployment bundle stays read-only.
    await symlink(resolve(folder, 'worker'), resolve(fixture, 'worker'));
    await writeFile(resolve(fixture, 'manifest.json'), JSON.stringify({ ...manifest, sourceDirty: false }));
    assert.equal(await verifyBundle(pathToFileURL(fixture + '/'), kind), resolve(fixture, 'worker'));
    await writeFile(resolve(fixture, 'manifest.json'), JSON.stringify({ ...manifest, sourceDirty: false, sha256: '0'.repeat(64) }));
    await assert.rejects(verifyBundle(pathToFileURL(fixture + '/'), kind), { message: 'bundle_invalid' });
  } finally { await rm(fixture, { recursive: true, force: true }); }
  // Direct execution proves ELF/OS compatibility. Missing configuration must
  // fail immediately; there are no database/provider credentials or requests.
  await assert.rejects(runChild(resolve(folder, 'worker'), [kind === 'cleanup' ? 'once' : 'drain'], {}, 5000), { message: 'worker_failed' });
  console.log(JSON.stringify({ kind, architecture: process.arch, nativeBinaryExecuted: true, expectedConfigurationFailure: true, sourceDirty: manifest.sourceDirty, providerConnectivityVerified: false }));
}
