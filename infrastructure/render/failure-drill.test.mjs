import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('verify-export-reclaim.sh', import.meta.url));
const initial = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const winner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function checkRows(rows, args = ['hosted-launch-export-synthetic', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-reclaim-test-'));
  try {
    await writeFile(join(directory, 'psql'), `#!${process.execPath}\nimport('node:fs').then(fs=>{const state=process.env.RECLAIM_TEST_STATE;const calls=fs.existsSync(state)?Number(fs.readFileSync(state,'utf8')):0;const rows=JSON.parse(process.env.RECLAIM_TEST_ROWS);fs.writeFileSync(state,String(calls+1));process.stdout.write((rows[Math.min(calls,rows.length-1)]??'')+'\\n');});\n`, { mode: 0o700 });
    // Keep branch tests fast; production polling limits are unchanged.
    await writeFile(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    return spawnSync('/bin/sh', [script, ...args], { encoding: 'utf8', timeout: 5000, env: {
      PATH: `${directory}:${process.env.PATH}`, LIKERTS_MIGRATION_DATABASE_URL: 'postgres://synthetic-secret-never-print',
      RECLAIM_TEST_STATE: join(directory, 'calls'), RECLAIM_TEST_ROWS: JSON.stringify(rows),
    } });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('SSH prerequisites retain non-root UID and install no SSH daemon or credentials', async () => {
  const docker = await readFile(new URL('Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /useradd --uid 10001 --gid 10001 --create-home --home-dir \/home\/likerts --shell \/bin\/sh likerts/);
  assert.match(docker, /--owner=10001 --group=10001 --mode=0700 \/home\/likerts\/\.ssh/);
  assert.match(docker, /USER 10001:10001/);
  assert.doesNotMatch(docker, /openssh-server|authorized_keys|id_ed25519|PasswordAuthentication|passwd -u|sudo/);
});

test('reclaim verifier accepts a new fenced object lease after live lease is cleared', async () => {
  const result = await checkRows([`running|${initial}|f`, `ready|${winner}|t`]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Hosted export lease reclaim verified/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(`${initial}|${winner}|synthetic-secret`));
});

test('original lease, malformed fence and completion before observation are not reclaim', async () => {
  for (const [rows, expected] of [
    [[`running|${initial}|f`, `ready|${initial}|t`], /initial lease; no reclaim proved/],
    [[`running|${initial}|f`, `ready|${winner}|f`], /not fenced/],
    [[`ready|${winner}|t`], /completed before initial lease observation/],
    [[`running|${initial}|f`, 'failed||f'], /unexpected terminal state/],
  ]) {
    const result = await checkRows(rows);
    assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, expected);
  }
});

test('invalid rehearsal identifiers fail before invoking database', async () => {
  for (const args of [
    ['real-customer', initial], ['hosted-launch-export-safe;bad', initial],
    ['hosted-launch-export-safe', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'],
  ]) assert.equal((await checkRows([], args)).status, 2);
});

test('SQL final fence reads durable object key and requires cleared live lease', async () => {
  const source = await readFile(script, 'utf8');
  assert.match(source, /status='ready' then coalesce\(split_part\(object_key,'\.',2\)/);
  assert.match(source, /lease_id is null and lease_expires_at is null/);
  assert.match(source, /object_key = id::text \|\| '\.' \|\| split_part\(object_key,'\.',2\) \|\| '\.export'/);
});
