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

assert.deepEqual(evidence.hostedCallbackAcceptance, {
  measuredAt: evidence.hostedCallbackAcceptance.measuredAt,
  receiverProvider: 'Vercel',
  independentlyDeployedReceiver: true,
  sameProviderAccount: true,
  endpointInitialDisabled: true,
  endpointEnabledExplicitly: true,
  publicHttpsDelivered: true,
  receiverStatus: 204,
  attempts: 1,
  hmacVerifiedOverExactRawBytes: true,
  timestampWindowVerified: true,
  eventVersion: 1,
  payloadKeys: ['createdAt', 'data', 'eventVersion', 'id', 'type'],
  dataKeys: ['collectionId', 'responseId', 'surveyId', 'surveyVersion'],
  answersOrMetadataPresent: false,
  temporaryWorkspaceTombstoned: true,
  receiverProjectDeleted: true,
  limitation: 'Synthetic acceptance against independently deployed receivers in the same provider account. It does not prove customer-owned DNS, dynamic DNS rebinding, enforced outbound policy, delivered alarms, sustained capacity or abrupt-process lease reclaim.',
  deployedDnsDenial: {
    measuredAt: evidence.hostedCallbackAcceptance.deployedDnsDenial.measuredAt,
    hostnameResolvedToLoopback: true,
    endpointCreatedDisabled: true,
    endpointEnabledExplicitly: true,
    status: 'failed',
    attempts: 1,
    httpRequestAttempted: false,
    failureCode: 'endpoint_address_denied',
    temporaryWorkspaceTombstoned: true,
    limitation: 'Uses a deterministic loopback-resolving public hostname. Dynamic rebinding between lookup and connection and customer-owned DNS remain separate tests.',
  },
  adversarialTransport: {
    measuredAt: evidence.hostedCallbackAcceptance.adversarialTransport.measuredAt,
    endpointInitialDisabled: true,
    redirect: {status: 'failed', attempts: 1, lastStatus: 307, failureCode: 'http_rejected'},
    timeout: {
      clientTimeoutSeconds: 10,
      handlerDelaySeconds: 12,
      status: 'queued',
      attempts: 1,
      lastStatus: null,
      failureCode: 'transport_failed',
      retryDelaySeconds: 60,
    },
    elapsedSeconds: evidence.hostedCallbackAcceptance.adversarialTransport.elapsedSeconds,
    temporaryWorkspaceTombstoned: true,
    receiverRequestRecords: 2,
    redirectTargetRequests: 0,
    receiverProjectDeleted: true,
    limitation: 'Synthetic same-account receiver and one delivery per endpoint. The timeout retry was observed queued and then cancelled by workspace tombstoning; later automatic attempts, worker restart and multi-worker contention were not exercised.',
  },
  multiWorkerConcurrency: {
    measuredAt: evidence.hostedCallbackAcceptance.multiWorkerConcurrency.measuredAt,
    activeWorkerInstances: 2,
    simultaneousResponses: 20,
    uniqueAcceptedResponses: 20,
    deliveryRows: 20,
    uniqueEvents: 20,
    delivered: 20,
    attemptsPerDelivery: 1,
    receiverStatus: 204,
    completionSeconds: evidence.hostedCallbackAcceptance.multiWorkerConcurrency.completionSeconds,
    temporaryWorkspaceTombstoned: true,
    receiverRequests: 20,
    normalWorkerInstancesRestored: 1,
    receiverProjectDeleted: true,
    limitation: 'Both worker instances were confirmed active and the shared queue produced exact one-attempt delivery, but privacy-preserving worker logs do not attribute individual deliveries to a specific instance. Synthetic same-account receiver; sustained callback capacity and restart during in-flight dispatch remain separate gates.',
  },
  inFlightRestart: {
    measuredAt: evidence.hostedCallbackAcceptance.inFlightRestart.measuredAt,
    submittedAt: '2026-09-09T09:17:39.043Z',
    requestStartedAt: '2026-09-09T09:17:39.516Z',
    restartRequestedAt: '2026-09-09T09:17:40.223Z',
    restartCommandReturnedAt: '2026-09-09T09:17:41.206Z',
    replacementWorkerStartedAt: '2026-09-09T09:17:43.939334227Z',
    receiverHandlerSeconds: 8,
    deliveryStatus: 'delivered',
    attempts: 1,
    receiverStatus: 204,
    receiverRequestsForThreeRuns: 3,
    gracefulDrainProved: true,
    hardLeaseReclaimProved: false,
    temporaryWorkspaceTombstoned: true,
    receiverProjectDeleted: true,
    limitation: 'Render performed a graceful service restart and allowed the in-flight request to complete on its first lease. Abrupt process loss and expired-lease reclaim remain unproved.',
  },
});
assert.match(evidence.hostedCallbackAcceptance.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
assert.match(evidence.hostedCallbackAcceptance.deployedDnsDenial.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
assert.match(evidence.hostedCallbackAcceptance.adversarialTransport.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
assert.ok(evidence.hostedCallbackAcceptance.adversarialTransport.elapsedSeconds >= 10);
assert.match(evidence.hostedCallbackAcceptance.multiWorkerConcurrency.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
assert.ok(evidence.hostedCallbackAcceptance.multiWorkerConcurrency.completionSeconds > 0);
assert.match(evidence.hostedCallbackAcceptance.inFlightRestart.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
assert.ok(Date.parse(evidence.hostedCallbackAcceptance.inFlightRestart.requestStartedAt) < Date.parse(evidence.hostedCallbackAcceptance.inFlightRestart.restartRequestedAt));
assert.ok(Date.parse(evidence.hostedCallbackAcceptance.inFlightRestart.restartRequestedAt) < Date.parse(evidence.hostedCallbackAcceptance.inFlightRestart.replacementWorkerStartedAt));
inspect(evidence.hostedCallbackAcceptance);

console.log('Hosted workspace/rollback evidence PASS: tenant denial, cleanup and compatible revision restoration.');
