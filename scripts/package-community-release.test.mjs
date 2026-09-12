import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertCliOutput, catalog, scanText, validateEntry, validateTag } from './package-community-release.mjs';

test('release tags cannot alias old SDK versions or become shell/path input', () => {
  assert.equal(validateTag('community-v0.1.0'), 'community-v0.1.0');
  for (const value of ['v0.0.3', 'community-v01.2.3', 'community-v1.2.3/next', 'community-v1.2.3\n', 'community-v1.2.3;echo secret']) assert.throws(() => validateTag(value));
});

test('archive paths reject escapes, credentials, dependencies and private keys', () => {
  for (const name of ['package/LICENSE', 'package/dist/index.js', 'package/dist/data/openapi.json']) validateEntry(name, 'package');
  for (const name of ['../LICENSE', 'package/../secret', '/package/LICENSE', 'C:/secret', 'package\\secret', 'package/name\n', 'package/.env', 'package/.env.production', 'package/.npmrc', 'package/.validation-private/key.json', 'package/node_modules/module.js', 'package/key.pem', 'other/LICENSE']) assert.throws(() => validateEntry(name, 'package'), name);
});

test('credential-pattern detection rejects real-shaped secrets without rejecting placeholder docs', () => {
  scanText('Supply LIKERTS_TOKEN through your secret manager. Authorization: Bearer <credential>', 'README.md');
  for (const value of ['-----BEGIN PRIVATE KEY-----', `ghp_${'a'.repeat(36)}`, `github_pat_${'b'.repeat(55)}`, `AKIA${'C'.repeat(16)}`, `sk_live_${'d'.repeat(30)}`]) assert.throws(() => scanText(value, 'fixture'));
});

test('native smoke catches version drift, missing operations, and changed routes', () => {
  const registry = [{ name: 'usage_get', method: 'GET', path: '/v1/usage', description: 'Inspect usage' }];
  const expected = 'usage_get\tGET /v1/usage\tInspect usage\n';
  assertCliOutput('likerts 0.1.2\r\n', expected, '0.1.2', registry);
  assert.throws(() => assertCliOutput('likerts 0.1.1', expected, '0.1.2', registry));
  assert.throws(() => assertCliOutput('likerts 0.1.2', '', '0.1.2', registry));
  assert.throws(() => assertCliOutput('likerts 0.1.2', expected.replace('/v1/usage', '/v1/billing'), '0.1.2', registry));
});

test('release catalog verifies full set, exact source SHA, content checksums and path safety', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-catalog-test-'));
  const tag = 'community-v0.1.0';
  const commit = 'a'.repeat(40);
  const names = ['cli-linux-x64.tar.gz', 'cli-darwin-arm64.tar.gz', 'cli-windows-x64.tar.gz', 'web.tgz', 'react-native.tgz', 'mcp.tgz', 'runtime-linux-x64.tar.gz'].map(name => `${tag}-${name}`);
  const payload = Buffer.from('staged artifact fixture');
  const metadata = file => ({ tag, commit, sourceDirty: false, file, bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') });
  try {
    for (const file of names) {
      await writeFile(join(directory, file), payload);
      await writeFile(join(directory, `${file}.manifest.json`), JSON.stringify(metadata(file)));
    }
    assert.equal((await catalog(directory, tag, commit)).length, 7);
    assert.equal((await readFile(join(directory, 'SHA256SUMS'), 'utf8')).trim().split('\n').length, 7);
    await writeFile(join(directory, names[0]), 'changed');
    await assert.rejects(catalog(directory, tag, commit), /size mismatch|checksum mismatch/);
    await writeFile(join(directory, names[0]), payload);
    await assert.rejects(catalog(directory, tag, 'b'.repeat(40)), /Mixed source commits/);
    await writeFile(join(directory, `${names[0]}.manifest.json`), JSON.stringify({ ...metadata(names[0]), sourceDirty: true }));
    await assert.rejects(catalog(directory, tag, commit), /clean checkout/);
    await writeFile(join(directory, `${names[0]}.manifest.json`), JSON.stringify({ ...metadata(names[0]), file: '../escape' }));
    await assert.rejects(catalog(directory, tag, commit), /Unsafe archive path/);
    await rm(join(directory, `${names[0]}.manifest.json`));
    await assert.rejects(catalog(directory, tag, commit), /Release requires all/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
