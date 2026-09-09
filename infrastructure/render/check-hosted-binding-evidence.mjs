import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const evidence = JSON.parse(readFileSync(new URL('hosted-evidence.json', import.meta.url)));
const binding = evidence.workspaceBinding;

assert.ok(binding && typeof binding === 'object');
assert.match(binding.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
assert.match(binding.apiDeploy, /^dep-[a-z0-9]+$/);
assert.match(binding.apiCommit, /^[0-9a-f]{40}$/);
assert.equal(evidence.commit, binding.apiCommit);
assert.equal(evidence.render.services.api.deploy, binding.apiDeploy);
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

console.log('Hosted workspace binding evidence PASS: direct API and MCP tenant selection, denial and cleanup.');
