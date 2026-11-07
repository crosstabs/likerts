import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertProductionRuntime, isReviewedRuntime, runtimePolicy } from '../deployment/runtime-policy.mjs';

test('Production rejects the old tested runtime and prereleases before opening storage', () => {
  for (const version of ['22.22.2', '22.23.3', '22.23.4-rc.1', '20.20.2', '23.1.0', '24.22.1', '', null]) {
    assert.equal(isReviewedRuntime(version), false, String(version));
    assert.throws(() => assertProductionRuntime(true, version), error => error.code === 'runtime_unsupported');
  }
});

test('Reviewed patched runtime and later stable patches in the same LTS line are accepted', () => {
  for (const version of ['22.23.4', '22.23.5', '22.24.0']) {
    assert.equal(isReviewedRuntime(version), true);
    assert.doesNotThrow(() => assertProductionRuntime(true, version));
  }
  assert.doesNotThrow(() => assertProductionRuntime(false, '22.22.2'), 'Local reproduction is distinct from production readiness');
});

test('Deployment version pins match the reviewed security baseline', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engines.node, `>=${runtimePolicy.minimum} <23`);
  assert.equal((await readFile(new URL('../.node-version', import.meta.url), 'utf8')).trim(), runtimePolicy.minimum);
});
