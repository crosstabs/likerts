import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDocuments, maintainedDocuments, localTargets } from './check-markdown-links.mjs';

test('relative, encoded, fragment, reference and parenthesized targets resolve from the document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'likerts-links-'));
  try {
    await mkdir(join(root, 'docs'));
    for (const name of ['Guide space.md','guide(test).md','name#hash.md']) await writeFile(join(root, name), '# Target');
    await writeFile(join(root, 'docs/readme.md'), '[encoded](../Guide%20space.md#heading)\n[angle](<../Guide space.md> "Title")\n[paren](../guide(test).md)\n[hash](../name%23hash.md)\n[ref]: ../Guide%20space.md#another\n[ref]\n');
    const result = await checkDocuments(root, ['docs/readme.md']);
    assert.equal(result.checked, 5); assert.deepEqual(result.broken, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('missing files fail with document, line and target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'likerts-links-'));
  try {
    await writeFile(join(root, 'README.md'), '# Title\n[broken](missing.md#anchor)\n');
    const result = await checkDocuments(root, ['README.md']);
    assert.deepEqual(result.broken, [{ document: 'README.md', line: 2, target: 'missing.md#anchor' }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('external, images, fragment-only, code and comments are excluded', () => {
  assert.deepEqual(localTargets('[web](https://example.com) [mail](mailto:a@example.com) [anchor](#heading) ![image](missing.png)\n`[inline](missing.md)`\n```md\n[code](missing.md)\n```\n<!-- [comment](missing.md) -->'), []);
});
test('scope excludes frozen release archives, generated and private directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'likerts-links-'));
  try {
    for (const directory of ['docs','sdks/web/node_modules','sdks/web/dist','releases','docs/.validation-private']) {
      await mkdir(join(root, directory), { recursive: true });
      await writeFile(join(root, directory, 'README.md'), '[broken](missing.md)');
    }
    assert.deepEqual(await maintainedDocuments(root), ['docs/README.md']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('CLI exits nonzero for broken files and zero after the target is supplied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'likerts-links-'));
  try {
    await writeFile(join(root, 'README.md'), '[guide](guide.md)');
    const args = [fileURLToPath(new URL('./check-markdown-links.mjs', import.meta.url)), '--root', root];
    const missing = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /README.md:1: missing target guide.md/);
    await writeFile(join(root, 'guide.md'), '# Guide');
    const valid = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /0 broken/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
