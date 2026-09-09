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
assert.deepEqual(rollback.failedCandidateRejection, {
  temporaryService: 'srv-dagh8p6q1p3s73bc2320',
  healthyDeploy: 'dep-dagh8ri0a91c73b5chn0',
  failedDeploy: 'dep-dagh9g740ujc73f6u1p0',
  failedStatus: 'update_failed',
  failureDurationSeconds: 31.75737,
  lastHealthyStatusAfterFailure: 200,
  customerCredentialsPresent: false,
  databaseConnected: false,
  temporaryServiceDeleted: true,
});
assert.match(rollback.limitation, /isolated|production/);
assert.equal(evidence.render.services.api.deploy, rollback.restored.deploy);
assert.equal(evidence.render.services.api.commit, rollback.restored.commit);
inspect(rollback);

assert.deepEqual(evidence.exportRestartRehearsal, {
  measuredAt: '2026-09-09T08:32:42.580Z',
  apiInstances: 2,
  syntheticResponses: 1000,
  approximateRawAnswerBytes: 54000000,
  submissionSeconds: 26.805097,
  restartAccepted: true,
  statusAfterRestart: 'running',
  completionSeconds: 31,
  finalManifestResponseCount: 1000,
  initialLeaseChanged: false,
  gracefulCompletionProved: true,
  crossReplicaReclaimProved: false,
  temporaryWorkspaceTombstoned: true,
  credentialDeniedAfterCleanup: true,
  limitation: 'The original lease completed during Render\'s zero-downtime service restart. A strict owner-only verifier rejected the stronger reclaim claim; abrupt single-instance termination remains unverified.',
});
assert.equal(evidence.managedRecoveryAccess.neonMarketplaceConsole, 'blocked_pending_account_email_verification');
assert.equal(evidence.managedRecoveryAccess.restoreExecuted, false);
assert.equal(evidence.providerUsageReview.vercelProject.billedCostUsd, 0.028879340130165812);
assert.equal(evidence.providerUsageReview.renderLikerts.monthToDateActiveServicesUsd, 0.61);
assert.equal(evidence.providerUsageReview.renderLikerts.deletedPostgresUsd, 0.12);
assert.equal(evidence.providerUsageReview.coverageComplete, false);
inspect(evidence.exportRestartRehearsal);
inspect(evidence.managedRecoveryAccess);
inspect(evidence.providerUsageReview);

console.log('Hosted workspace/rollback evidence PASS: tenant denial, cleanup and compatible revision restoration.');
