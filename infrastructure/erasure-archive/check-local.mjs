// Disposable PostgreSQL role/config smoke. Never contacts Blob or a cloud provider.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const container = `likerts-archiver-check-${randomUUID()}`;
const ownerPassword = randomBytes(32).toString('hex'), archiverPassword = randomBytes(32).toString('hex');
const minimal = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const docker = (args, options = {}) => execFileSync('docker', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: minimal, ...options });
function binary(manifest, name) {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest], { cwd: root, encoding: 'utf8' }));
  return join(metadata.target_directory, 'debug', name);
}
let started = false;
try {
  // Named env option keeps generated passwords out of the Docker argument list.
  docker(['run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=likerts_owner', '--env', 'POSTGRES_DB=likerts', 'postgres:16-alpine'], { env: { ...minimal, POSTGRES_PASSWORD: ownerPassword } });
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { docker(['exec', container, 'pg_isready', '-U', 'likerts_owner', '-d', 'likerts']); ready = true; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'PostgreSQL readiness failed.');
  const port = docker(['port', container, '5432/tcp']).trim().split(':').at(-1);
  const ownerUrl = `postgres://likerts_owner:${ownerPassword}@127.0.0.1:${port}/likerts`;
  execFileSync(binary('backend/Cargo.toml', 'likerts-migrate'), [], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...minimal, LIKERTS_MIGRATION_DATABASE_URL: ownerUrl } });
  const psql = (sql, asArchiver = false) => docker(['exec', '--interactive', '--env', 'PGPASSWORD', container, 'psql', '-X', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', asArchiver ? 'likerts_erasure_archiver' : 'likerts_owner', '-d', 'likerts', '-At'], { input: sql, env: { ...minimal, PGPASSWORD: asArchiver ? archiverPassword : ownerPassword } });
  docker(['exec', '--interactive', '--env', 'LIKERTS_BOOTSTRAP_ARCHIVER_PASSWORD', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'likerts_owner', '-d', 'likerts'], { input: await readFile(join(root, 'infrastructure/erasure-archive/bootstrap.sql')), env: { ...minimal, LIKERTS_BOOTSTRAP_ARCHIVER_PASSWORD: archiverPassword } });
  psql(await readFile(join(root, 'infrastructure/erasure-archive/provision-archiver.sql'), 'utf8'));
  const source = psql('select source_id from likerts.erasure_archive_control;').trim();
  const archiver = binary('backend/Cargo.toml', 'likerts-erasure-archive');
  const env = { ...minimal, LIKERTS_ERASURE_DATABASE_URL: `postgres://likerts_erasure_archiver:${archiverPassword}@127.0.0.1:${port}/likerts`, LIKERTS_ERASURE_SOURCE_ID: source, LIKERTS_ERASURE_ALLOW_LOCAL_INSECURE: '1' };
  const call = (args, extra = {}) => execFileSync(archiver, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, ...extra } });
  const status = JSON.parse(call(['status']));
  assert.equal(status.sourceId, source); assert.equal(status.pendingEvents, 0);
  for (const sql of ['select * from likerts.responses limit 1;', 'select * from likerts.usage_entries limit 1;']) {
    assert.throws(() => psql(sql, true), 'Archiver unexpectedly had raw data access.');
  }
  assert.throws(() => call(['status'], { LIKERTS_ERASURE_SOURCE_ID: randomUUID() }), 'Wrong source accepted.');
  assert.throws(() => call(['status'], { LIKERTS_ERASURE_DATABASE_URL: ownerUrl }), 'Owner credential accepted.');
  assert.throws(() => call(['fence']), 'Missing fence attestation accepted.');
  assert.equal(JSON.parse(call(['status'])).fenceId, null, 'Rejected command changed fence.');
  const checked = JSON.parse(call(['check-config'], { LIKERTS_ERASURE_BLOB_TOKEN: 'vercel_blob_rw_LocalFixture_not_a_real_credential', LIKERTS_ERASURE_NAMESPACE: 'local-check' }));
  assert.equal(checked.databaseRoleAndSourceVerified, true);
  assert.equal(checked.archiveConnectivityVerified, false);
  console.log('PASS: real PostgreSQL restricted archiver role/source/status; raw answer/usage reads denied; owner and source mismatch rejected; maintenance requires attestation; config check explicitly does not claim archive connectivity. No provider request made.');
} catch {
  console.error('Local archiver smoke failed; inspect a controlled local reproduction. No credential-bearing diagnostics emitted.');
  process.exitCode = 1;
} finally {
  if (started) { try { docker(['rm', '--force', '--volumes', container]); } catch { console.error('Temporary archiver PostgreSQL cleanup failed.'); process.exitCode = 1; } }
}
