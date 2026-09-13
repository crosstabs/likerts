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
let stage = 'validate-options';
try {
  assert(process.argv.slice(2).every(value => value === '--delayed-init'), 'Unknown option.');
  // Regression mode holds the image's socket-only initialization server open.
  // No application readiness/authentication check is skipped in this mode.
  const delayedInit = process.argv.includes('--delayed-init');
  const imageArgs = delayedInit
    ? ['--entrypoint', 'sh', 'postgres:16-alpine', '-c', "echo 'SELECT pg_sleep(3);' > /docker-entrypoint-initdb.d/99-readiness-delay.sql; exec docker-entrypoint.sh postgres"]
    : ['postgres:16-alpine'];
  stage = 'start-postgres';
  // Named env option keeps generated passwords out of the Docker argument list.
  docker(['run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=likerts_owner', '--env', 'POSTGRES_DB=likerts', ...imageArgs], { env: { ...minimal, POSTGRES_PASSWORD: ownerPassword } });
  started = true;
  stage = 'wait-for-postgres-tcp';
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      // The image first runs a socket-only server while initializing. A default
      // pg_isready can accept that temporary server before the migrator's TCP
      // path exists. Require an authenticated query on the final TCP listener.
      const result = docker(['exec', '--env', 'PGPASSWORD', '--env', 'PGCONNECT_TIMEOUT=1', container,
        'psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'likerts_owner', '-d', 'likerts', '-At', '-c', 'select 1;'],
      { env: { ...minimal, PGPASSWORD: ownerPassword } });
      if (result.trim() === '1') { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'PostgreSQL readiness failed.');
  stage = 'resolve-postgres-port';
  const port = docker(['port', container, '5432/tcp']).trim().split(':').at(-1);
  const ownerUrl = `postgres://likerts_owner:${ownerPassword}@127.0.0.1:${port}/likerts`;
  stage = 'migrate';
  execFileSync(binary('backend/Cargo.toml', 'likerts-migrate'), [], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...minimal, LIKERTS_MIGRATION_DATABASE_URL: ownerUrl } });
  const psql = (sql, asArchiver = false) => docker(['exec', '--interactive', '--env', 'PGPASSWORD', container, 'psql', '-X', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', asArchiver ? 'likerts_erasure_archiver' : 'likerts_owner', '-d', 'likerts', '-At'], { input: sql, env: { ...minimal, PGPASSWORD: asArchiver ? archiverPassword : ownerPassword } });
  stage = 'bootstrap-archiver-role';
  docker(['exec', '--interactive', '--env', 'LIKERTS_BOOTSTRAP_ARCHIVER_PASSWORD', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'likerts_owner', '-d', 'likerts'], { input: await readFile(join(root, 'infrastructure/erasure-archive/bootstrap.sql')), env: { ...minimal, LIKERTS_BOOTSTRAP_ARCHIVER_PASSWORD: archiverPassword } });
  stage = 'provision-archiver-role';
  psql(await readFile(join(root, 'infrastructure/erasure-archive/provision-archiver.sql'), 'utf8'));
  stage = 'read-archive-source';
  const source = psql('select source_id from likerts.erasure_archive_control;').trim();
  const archiver = binary('backend/Cargo.toml', 'likerts-erasure-archive');
  const env = { ...minimal, LIKERTS_ERASURE_DATABASE_URL: `postgres://likerts_erasure_archiver:${archiverPassword}@127.0.0.1:${port}/likerts`, LIKERTS_ERASURE_SOURCE_ID: source, LIKERTS_ERASURE_ALLOW_LOCAL_INSECURE: '1' };
  const call = (args, extra = {}) => execFileSync(archiver, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, ...extra } });
  stage = 'verify-status';
  const status = JSON.parse(call(['status']));
  assert.equal(status.sourceId, source); assert.equal(status.pendingEvents, 0);
  stage = 'verify-raw-data-denial';
  for (const sql of ['select * from likerts.responses limit 1;', 'select * from likerts.usage_entries limit 1;']) {
    assert.throws(() => psql(sql, true), 'Archiver unexpectedly had raw data access.');
  }
  stage = 'seed-column-permission-fixture';
  const fixtureWorkspace = `archiver-column-${randomUUID()}`, surveyId = randomUUID(), collectionId = randomUUID();
  psql(`insert into likerts.workspaces(id) values('${fixtureWorkspace}');
    insert into likerts.surveys(workspace_id,id,revision,title,questions) values('${fixtureWorkspace}','${surveyId}',1,'Privilege fixture','[]');
    insert into likerts.survey_versions(workspace_id,survey_id,version,title,questions,sdk_capabilities) values('${fixtureWorkspace}','${surveyId}',1,'Privilege fixture','[]','{}');
    insert into likerts.collections(workspace_id,id,survey_id,version,placement,token_hash,sdk_capabilities) values('${fixtureWorkspace}','${collectionId}','${surveyId}',1,'fixture',decode(repeat('01',32),'hex'),'{}');
    insert into likerts.responses(workspace_id,id,collection_id,idempotency_key,answers,metadata) values('${fixtureWorkspace}',gen_random_uuid(),'${collectionId}','fixture','{"fixture":"private-answer"}','{}');`);
  stage = 'prove-old-guard-column-permission-gap';
  psql('grant select(answers) on likerts.responses to likerts_erasure_archiver;');
  // Simulate permission drift AFTER provisioning. The former startup check
  // inspected table SELECT privileges and missed a direct column grant.
  stage = 'inspect-drifted-column-acl';
  assert.equal(psql("select not has_table_privilege(current_user,'likerts.responses','SELECT') and not has_table_privilege(current_user,'likerts.usage_entries','SELECT') and has_column_privilege(current_user,'likerts.responses','answers','SELECT');", true).trim(), 't');
  stage = 'read-drifted-column-fixture';
  const leakedFixture = psql(`begin; select set_config('likerts.workspace_id','${fixtureWorkspace}',true); select answers from likerts.responses; rollback;`, true);
  assert(leakedFixture.includes('private-answer'), 'Column-grant regression fixture did not reproduce access.');
  stage = 'reject-drifted-column-permission';
  assert.throws(() => call(['status']), 'Archiver accepted a raw-answer column grant after provisioning.');
  stage = 'revoke-drifted-column-permission';
  psql(await readFile(join(root, 'infrastructure/erasure-archive/provision-archiver.sql'), 'utf8'));
  assert.equal(psql("select has_column_privilege(current_user,'likerts.responses','answers','SELECT');", true).trim(), 'f');
  assert.throws(() => psql('select answers from likerts.responses;', true), 'Column permission survived new provisioning.');
  assert.equal(JSON.parse(call(['status'])).sourceId, source);
  stage = 'reject-adversarial-role-grants';
  for (const [grant, revoke] of [
    ['grant update(metadata) on likerts.responses to likerts_erasure_archiver', 'revoke update(metadata) on likerts.responses from likerts_erasure_archiver'],
    ['grant select on likerts.surveys to likerts_erasure_archiver', 'revoke select on likerts.surveys from likerts_erasure_archiver'],
    ['grant execute on function likerts.export_cleanup_status() to likerts_erasure_archiver', 'revoke execute on function likerts.export_cleanup_status() from likerts_erasure_archiver'],
    ['grant create on schema likerts to likerts_erasure_archiver', 'revoke create on schema likerts from likerts_erasure_archiver'],
    ['alter role likerts_erasure_archiver replication', 'alter role likerts_erasure_archiver noreplication'],
    ['alter role likerts_erasure_archiver createdb', 'alter role likerts_erasure_archiver nocreatedb'],
    ['alter role likerts_erasure_archiver inherit', 'alter role likerts_erasure_archiver noinherit'],
    ['create role archiver_membership_probe; grant archiver_membership_probe to likerts_erasure_archiver', 'revoke archiver_membership_probe from likerts_erasure_archiver; drop role archiver_membership_probe'],
    ["create function likerts.archiver_ownership_probe() returns integer language sql as 'select 1'; alter function likerts.archiver_ownership_probe() owner to likerts_erasure_archiver", 'drop function likerts.archiver_ownership_probe()'],
  ]) {
    psql(grant);
    if (grant.includes(' replication') || grant.includes('archiver_ownership_probe')) {
      const provision = await readFile(join(root, 'infrastructure/erasure-archive/provision-archiver.sql'), 'utf8');
      assert.throws(() => psql(provision), 'Provisioning accepted an unsafe role or function owner.');
    }
    let denied = false;
    try { call(['status']); } catch { denied = true; }
    psql(revoke);
    assert(denied, 'Excess archiver privilege was accepted.');
    assert.equal(JSON.parse(call(['status'])).sourceId, source);
  }
  stage = 'verify-source-denial';
  assert.throws(() => call(['status'], { LIKERTS_ERASURE_SOURCE_ID: randomUUID() }), 'Wrong source accepted.');
  stage = 'verify-owner-denial';
  assert.throws(() => call(['status'], { LIKERTS_ERASURE_DATABASE_URL: ownerUrl }), 'Owner credential accepted.');
  stage = 'verify-fence-attestation';
  assert.throws(() => call(['fence']), 'Missing fence attestation accepted.');
  assert.equal(JSON.parse(call(['status'])).fenceId, null, 'Rejected command changed fence.');
  stage = 'verify-config-without-provider-contact';
  const checked = JSON.parse(call(['check-config'], { LIKERTS_ERASURE_BLOB_TOKEN: 'vercel_blob_rw_LocalFixture_not_a_real_credential', LIKERTS_ERASURE_NAMESPACE: 'local-check' }));
  assert.equal(checked.databaseRoleAndSourceVerified, true);
  assert.equal(checked.archiveConnectivityVerified, false);
  console.log('PASS: real PostgreSQL restricted archiver role/source/status; raw answer/usage reads denied; old startup column-ACL gap reproduced and provisioning removes it; nine additional unsafe grants rejected; owner and source mismatch rejected; maintenance requires attestation; config check explicitly does not claim archive connectivity. No provider request made.');
} catch {
  // Stage names are fixed literals. Never print caught child errors, argv, SQL,
  // stderr or connection strings: those can contain generated credentials.
  console.error(`Local archiver smoke failed at stage: ${stage}. No credential-bearing diagnostics emitted.`);
  process.exitCode = 1;
} finally {
  if (started) { try { docker(['rm', '--force', '--volumes', container]); } catch { console.error('Temporary archiver PostgreSQL cleanup failed.'); process.exitCode = 1; } }
}
