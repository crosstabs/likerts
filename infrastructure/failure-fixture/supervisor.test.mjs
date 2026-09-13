import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { configuration, authorized, identity } from './supervisor.mjs';
const base = {
  LIKERTS_DRILL_ADMIN_TOKEN: 'a'.repeat(64), LIKERTS_DRILL_DATABASE: 'likerts_drill_0123456789abcdef',
  LIKERTS_DRILL_DATABASE_HOST: 'dpg-isolated-fixture-a',
  DATABASE_URL: 'postgres://likerts_runtime:synthetic@dpg-isolated-fixture-a/likerts_drill_0123456789abcdef?sslmode=require',
  LIKERTS_WEBHOOK_DATABASE_URL: 'postgres://likerts_webhook_worker:synthetic@dpg-isolated-fixture-a/likerts_drill_0123456789abcdef?sslmode=require',
  LIKERTS_COLLECTION_CREDENTIAL_KEY: randomBytes(32).toString('base64'), LIKERTS_WEBHOOK_CREDENTIAL_KEY: randomBytes(32).toString('base64'),
};
test('fixture environment has fixed bounds, ordinary service auth and child credential separation', () => {
  const config = configuration({ ...base, LIKERTS_MIGRATION_DATABASE_URL: 'never-pass-owner', UNRELATED_SECRET: 'never-pass-other', NODE_OPTIONS: '--inspect' });
  assert.equal(config.children.api.LIKERTS_DEV_TOKENS, '{}');
  assert.equal(config.children.api.LIKERTS_ALLOW_DEV_AUTH, '1');
  assert.equal(config.children.api.LIKERTS_ADMISSION_MODE, 'disabled');
  assert.equal(config.children.api.LIKERTS_BIND_ADDRESS, '127.0.0.1');
  assert.equal(config.children.api.LIKERTS_PORT, '18081');
  assert.equal(config.children.worker.LIKERTS_WEBHOOK_CONCURRENCY, '1');
  for (const child of Object.values(config.children)) {
    for (const key of ['LIKERTS_DRILL_ADMIN_TOKEN', 'LIKERTS_MIGRATION_DATABASE_URL', 'UNRELATED_SECRET', 'NODE_OPTIONS', 'LIKERTS_ALLOW_MEMORY']) assert.equal(child[key], undefined);
  }
  assert.equal(config.children.api.LIKERTS_WEBHOOK_DATABASE_URL, undefined);
  assert.equal(config.children.worker.DATABASE_URL, undefined);
  assert.equal(config.children.worker.LIKERTS_COLLECTION_CREDENTIAL_KEY, undefined);
});
test('wrong database identities, role names, weak TLS and caller-controlled connection options fail closed', () => {
  for (const change of [
    { LIKERTS_DRILL_ADMIN_TOKEN: 'short' }, { LIKERTS_DRILL_DATABASE: 'production' },
    { LIKERTS_DRILL_DATABASE_HOST: 'different-host' }, { PORT: '18081' },
    { DATABASE_URL: base.DATABASE_URL.replace('likerts_runtime:', 'postgres:') },
    { DATABASE_URL: base.DATABASE_URL.replace('sslmode=require', 'sslmode=disable') },
    { DATABASE_URL: base.DATABASE_URL + '&options=-c%20role%3Dpostgres' },
    { DATABASE_URL: base.DATABASE_URL.replace('/likerts_drill_', '/different_') },
    { LIKERTS_WEBHOOK_DATABASE_URL: base.LIKERTS_WEBHOOK_DATABASE_URL.replace('dpg-isolated-fixture-a', 'other') },
  ]) assert.throws(() => configuration({ ...base, ...change }));
});
test('admin authentication uses the exact independent bearer secret', () => {
  for (const value of [undefined, '', 'Bearer wrong', ['Bearer '+base.LIKERTS_DRILL_ADMIN_TOKEN], 'x'.repeat(300)]) assert.equal(authorized(value, base.LIKERTS_DRILL_ADMIN_TOKEN), false);
  assert.equal(authorized('Bearer '+base.LIKERTS_DRILL_ADMIN_TOKEN, base.LIKERTS_DRILL_ADMIN_TOKEN), true);
});
test('native Linux guard validates exact child executable, UID, PID and stable start time, then rejects an exited child', { skip: process.platform !== 'linux', timeout: 5000 }, async () => {
  const child = spawn('/usr/bin/sleep', ['30'], { stdio: 'ignore' });
  try {
    await once(child, 'spawn');
    const before = identity(child, '/usr/bin/sleep');
    assert.equal(before.pid, child.pid); assert.match(before.startTicks, /^\d+$/);
    assert.deepEqual(identity(child, '/usr/bin/sleep'), before);
    assert.throws(() => identity(child, '/usr/local/bin/likerts-server'), /child_executable_changed/);
    const exited = once(child, 'exit'); assert.equal(child.kill('SIGKILL'), true);
    assert.deepEqual(await exited, [null, 'SIGKILL']);
    assert.throws(() => identity(child, '/usr/bin/sleep'), /child_not_live/);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});
