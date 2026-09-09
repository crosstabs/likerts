import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const base = process.env.LIKERTS_HOSTED_BASE_URL;
const bootstrapToken = process.env.LIKERTS_HOSTED_BOOTSTRAP_TOKEN;
const evidencePath = process.env.LIKERTS_HOSTED_EVIDENCE_OUTPUT;
assert.ok(base && bootstrapToken && evidencePath, 'missing hosted lifecycle configuration');

const bootstrapHeaders = {
  authorization: `Bearer ${bootstrapToken}`,
  'content-type': 'application/json',
};
async function call(path, {method = 'GET', body, headers = bootstrapHeaders} = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await response.text();
  let value = text;
  try { value = text ? JSON.parse(text) : null; } catch {}
  return {status: response.status, value};
}
async function expect(path, options, status) {
  const result = await call(path, options);
  assert.equal(result.status, status, `${path}: ${result.status} ${JSON.stringify(result.value)}`);
  return result.value;
}

const suffix = Date.now().toString(36);
const scopes = [
  'surveys:read', 'surveys:write', 'collections:write',
  'responses:read', 'responses:write', 'exports:read', 'exports:write',
  'usage:read', 'billing:write', 'identity:write', 'webhooks:read', 'webhooks:write',
];
const baselineUsage = await expect('/v1/usage', {}, 200);
const issued = await expect('/v1/service-credentials', {
  method: 'POST',
  body: {name: `hosted-lifecycle-${suffix}`, scopes, expiresAt: new Date(Date.now() + 3600_000).toISOString()},
}, 201);
const managementHeaders = {authorization: `Bearer ${issued.token}`, 'content-type': 'application/json'};
const sdkCapabilities = {installations: ['web', 'react_native', 'ios', 'android', 'flutter'].map(target => ({target, sdkVersion: '0.0.3', schemaVersions: [1, 2, 3, 4, 5]}))};
const survey = await expect('/v1/surveys', {method: 'POST', headers: managementHeaders, body: {
  idempotencyKey: `hosted-survey-${suffix}`,
  title: 'Hosted launch lifecycle',
  questions: [{id: 'rating', type: 'scale', label: 'Readiness', required: true, min: 1, max: 5}],
}}, 201);
const version = await expect(`/v1/surveys/${survey.id}/publish`, {method: 'POST', headers: managementHeaders, body: {revision: survey.revision, sdkCapabilities}}, 200);
const collection = await expect('/v1/collections', {method: 'POST', headers: managementHeaders, body: {
  idempotencyKey: `hosted-collection-${suffix}`,
  surveyId: survey.id,
  version: version.version,
  placement: 'hosted-launch-rehearsal',
  responseCap: 10,
  sdkCapabilities,
}}, 201);
const collectionHeaders = {authorization: `Bearer ${collection.token}`, 'content-type': 'application/json'};
await expect(`/v1/collections/${collection.id}`, {headers: collectionHeaders}, 200);
const receipt = await expect(`/v1/collections/${collection.id}/responses`, {method: 'POST', headers: collectionHeaders, body: {
  idempotencyKey: `hosted-response-${suffix}`,
  answers: {rating: 5},
  metadata: {source: 'hosted-rehearsal'},
}}, 200);
const responses = await expect(`/v1/responses?collectionId=${encodeURIComponent(collection.id)}&limit=10`, {headers: managementHeaders}, 200);
assert.equal(responses.items.length, 1);
assert.equal(responses.items[0].receipt.responseId, receipt.responseId);
const exportJob = await expect('/v1/exports', {method: 'POST', headers: managementHeaders, body: {
  idempotencyKey: `hosted-export-${suffix}`, format: 'json', collectionId: collection.id,
}}, 202);
let exportStatus;
for (let attempt = 0; attempt < 120; attempt++) {
  exportStatus = await expect(`/v1/exports/${exportJob.id}`, {headers: managementHeaders}, 200);
  if (exportStatus.status === 'ready') break;
  await new Promise(resolve => setTimeout(resolve, 250));
}
assert.equal(exportStatus.status, 'ready');
const download = await expect(`/v1/exports/${exportJob.id}/download`, {headers: managementHeaders}, 200);
const exported = JSON.parse(Buffer.from(download.contentBase64, 'base64').toString());
assert.equal(exported.responses.length, 1);
assert.equal(exported.responses[0].receipt.responseId, receipt.responseId);
const usage = await expect('/v1/usage', {headers: managementHeaders}, 200);
assert.equal(usage.acceptedResponses, baselineUsage.acceptedResponses + 1);
assert.equal(usage.credits.promotionalResponses, baselineUsage.credits.promotionalResponses + 1);
await expect(`/v1/responses/${receipt.responseId}`, {method: 'DELETE', headers: managementHeaders}, 204);
assert.equal((await call(`/v1/exports/${exportJob.id}/download`, {headers: managementHeaders})).status, 410);
await expect(`/v1/collections/${collection.id}`, {method: 'PATCH', headers: managementHeaders, body: {revoke: true}}, 200);
assert.equal((await call(`/v1/collections/${collection.id}`, {headers: collectionHeaders})).status, 410);
await expect(`/v1/service-credentials/${issued.credential.id}`, {method: 'DELETE'}, 204);
assert.equal((await call('/v1/usage', {headers: managementHeaders})).status, 401);
await expect('/v1/workspace', {method: 'DELETE'}, 204);
assert.equal((await call('/v1/usage')).status, 401);

await writeFile(evidencePath, JSON.stringify({
  measuredAt: new Date().toISOString(),
  base,
  checks: [
    'scoped child service credential issued and revoked',
    'survey created and immutable version published',
    'five-SDK capability declaration accepted',
    'collection configuration fetched with collection-only credential',
    'response accepted and retrieved once',
    'private object-store JSON export created and downloaded',
    'raw response deletion revoked prior export',
    'collection credential irreversibly revoked',
    'workspace tombstoned and bootstrap credential invalidated',
  ],
  acceptedResponses: 1,
  promotionalCreditsConsumed: 1,
  exportProviderRoundTrip: true,
  temporaryWorkspaceTombstoned: true,
}, null, 2) + '\n');
console.log('Hosted create/publish/collect/retrieve/export/revoke/delete lifecycle passed');
