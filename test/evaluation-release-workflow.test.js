import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('the manual release path requires the fail-closed signed evaluation gate and performs no deployment', async () => {
  const [workflow, packageJson, script] = await Promise.all([
    fs.readFile(new URL('../.github/workflows/evaluation-release-gate.yml', import.meta.url), 'utf8'),
    fs.readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    fs.readFile(new URL('../scripts/eval-release-gate.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /LIKERTS_RELEASE_REVIEWER_KEYS_JSON/);
  assert.match(workflow, /LIKERTS_RELEASE_APPROVER_KEYS_JSON/);
  assert.match(workflow, /npm run eval:release -- --bundle/);
  assert.doesNotMatch(workflow, /\b(deploy|release create|publish)\b/i);
  assert.equal(packageJson.scripts['eval:release'], 'node scripts/eval-release-gate.mjs');
  assert.match(script, /return result\.releaseAllowed \? 0 : 2/);
});
