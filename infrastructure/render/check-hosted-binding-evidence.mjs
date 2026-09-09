import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const evidence = JSON.parse(readFileSync(new URL('hosted-evidence.json', import.meta.url)));
const binding = evidence.workspaceBinding;

assert.ok(binding && typeof binding === 'object');
assert.match(binding.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
assert.match(binding.apiDeploy, /^dep-[a-z0-9]+$/);
assert.match(binding.apiCommit, /^[0-9a-f]{40}$/);
assert.equal(evidence.commit, binding.apiCommit);
assert.equal(evidence.render.services.api.commit, binding.apiCommit);
assert.deepEqual(binding.checks, {
  apiHealth: 200,
  mcpHealth: 200,
  directServiceCredentialWithoutSelection: 200,
  directMatchingWorkspace: 200,
  directMismatchedWorkspace: 403,
  mcpMatchingWorkspace: {http: 200, toolError: false},
  mcpMismatchedWorkspace: {http: 200, upstreamStatus: 403, toolError: true},
  workspaceDeletion: 204,
  directCredentialAfterDeletion: 401,
  mcpCredentialAfterDeletion: {http: 200, upstreamStatus: 401, toolError: true},
});
assert.equal(binding.temporaryWorkspaceTombstoned, true);
assert.ok(Array.isArray(binding.limitations) && binding.limitations.length > 0);

const forbiddenKey = /token|secret|password|authorization|database.?url/i;
function inspect(value, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!forbiddenKey.test(key), `secret-bearing evidence key: ${path}${key}`);
    inspect(child, `${path}${key}.`);
  }
}
inspect(binding);

const rollback = evidence.rollbackRehearsal;
assert.deepEqual(rollback.candidate, {
  deploy: 'dep-dagh68p42hec73cb4gh0',
  commit: 'bb699c2b9d034f4c688f21fad05ba5cbd3090208',
  status: 'live',
  durationSeconds: 44.109701,
  health: 200,
  unauthenticatedUsage: 401,
});
assert.deepEqual(rollback.restored, {
  deploy: 'dep-dagh6o3l550s73bl8300',
  commit: '72afd3f14938ecb01f9667398a3f05d57ece800b',
  status: 'live',
  durationSeconds: 36.619229,
  health: 200,
  unauthenticatedUsage: 401,
});
assert.equal(rollback.schemaCompatibilityReviewed, true);
assert.equal(rollback.runtimeDiffBetweenCommits, false);
assert.match(rollback.limitation, /unhealthy|failed/);
assert.equal(evidence.render.services.api.deploy, rollback.restored.deploy);
assert.equal(evidence.render.services.api.commit, rollback.restored.commit);
inspect(rollback);

console.log('Hosted workspace/rollback evidence PASS: tenant denial, cleanup and compatible revision restoration.');
