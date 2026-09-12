import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
const exec = promisify(execFile);
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('public API snapshots and demo SDK match the current source tree', async () => {
  await exec(process.execPath, ['scripts/sync-public-reference.mjs', '--check'], { cwd: new URL('../', import.meta.url) });
});

test('marketing API example equals the validated create fixture and CLI examples name real capabilities', async () => {
  const script = await read('../public/marketing.js');
  const context = { document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => {} } };
  runInNewContext(`${script}\nthis.publicExamples = examples;`, context);
  const apiBody = context.publicExamples.api.code.slice(context.publicExamples.api.code.indexOf('{'));
  const fixture = JSON.parse(await read('../../contracts/examples/surveys_create.input.json'));
  assert.deepEqual(JSON.parse(apiBody), fixture);
  const registry = JSON.parse(await read('../../tools/capabilities.json'));
  const names = new Set(registry.map(operation => operation.name));
  for (const match of `${script}\n${await read('../public/docs/index.html')}`.matchAll(/likerts call ([a-z][a-z_]+)/g)) {
    assert.ok(names.has(match[1]), `Unknown documented capability: ${match[1]}`);
  }
  assert.doesNotMatch(script, /likerts survey create|likerts collection issue|\$ likerts usage/);
});

test('public quickstart declares the capability of the actual demo release and keeps tokens out of inputs', async () => {
  const { LIKERTS_SDK_CAPABILITY } = await import('../public/demo/sdk/index.js');
  const declared = JSON.parse(await read('../public/docs/sdk-capabilities.json'));
  assert.deepEqual(declared.installations, [LIKERTS_SDK_CAPABILITY]);
  const request = JSON.parse(await read('../public/docs/survey-create.json'));
  assert.deepEqual(request, JSON.parse(await read('../../contracts/examples/surveys_create.input.json')));
  assert.equal('token' in request, false);
});

test('sample demo uses released schema fixtures and denies network data connections', async () => {
  const html = await read('../public/demo/index.html');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /No response is sent or persisted/);
  const { examples } = await import('../public/demo/examples.js');
  for (const [name, version, fixture] of [
    ['conditional', 3, 'conditional-survey.example.json'],
    ['advanced', 5, 'advanced-survey.example.json'],
    ['branching', 4, 'branching-survey.example.json'],
  ]) {
    assert.deepEqual(examples[name], { schemaVersion: version, ...JSON.parse(await read(`../../contracts/${fixture}`)) });
  }
});
