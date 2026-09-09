// Production acceptance with synthetic data. Secrets remain in process memory.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {randomUUID, createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const area = new URL('./evidence/', import.meta.url);
const statePath = new URL('customer.json', area);
const api = 'https://likerts-api.onrender.com';
const mcp = 'https://likerts-mcp.onrender.com';
const token = process.env.LIKERTS_TOKEN;
const workspace = process.env.LIKERTS_WORKSPACE_ID;
let state;
function check(ok, code) { if (!ok) throw new Error(code); }
async function save() {
  await mkdir(area, {recursive: true, mode: 0o700});
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600});
}
function record(name, details = {}) {
  state.checks[name] = {at: new Date().toISOString(), ...details};
}
async function request(path, {method = 'GET', body, bearer = token, expected = 200} = {}) {
  const response = await fetch(`${api}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: {authorization: `Bearer ${bearer}`, 'content-type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  // Never include provider bodies, tokens or URLs in a thrown error.
  check(response.status === expected, `http_${method}_${response.status}_expected_${expected}`);
  if (expected === 204 || expected >= 400) { await response.body?.cancel(); return null; }
  return response.json();
}
function checkUsage(usage, responses, promo, paid = 0) {
  check(usage.acceptedResponses === responses, 'accepted_response_count');
  check(usage.credits.promotionalCredits === promo, 'promotional_balance');
  check(usage.credits.paidCredits === paid, 'paid_balance');
  check(usage.credits.paidCreditDebt === 0, 'unexpected_credit_debt');
}
async function remoteUsage() {
  async function rpc(id, method, params) {
    const response = await fetch(`${mcp}/mcp/${encodeURIComponent(workspace)}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18'},
      body: JSON.stringify({jsonrpc: '2.0', id, method, params}),
    });
    check(response.status === 200, `mcp_http_${response.status}`);
    const text = await response.text();
    const messages = response.headers.get('content-type')?.includes('text/event-stream')
      ? text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
      : [JSON.parse(text)];
    const message = messages.find(item => item.id === id);
    check(message?.result && !message.error && !message.result.isError, 'mcp_result');
    return message.result;
  }
  await rpc(1, 'initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'likerts-acceptance', version: '1'}});
  const inventory = await rpc(2, 'tools/list', {});
  check(inventory.tools.some(tool => tool.name === 'usage_get'), 'mcp_usage_tool_missing');
  const result = await rpc(3, 'tools/call', {name: 'usage_get', arguments: {}});
  const usage = result.structuredContent?.result ?? JSON.parse(result.content.find(item => item.type === 'text').text);
  return {usage, toolCount: inventory.tools.length};
}
async function main() {
  const command = process.argv[2];
  if (!command || command === 'help') {
    console.log('Commands: begin, recheck-grant, lifecycle, verify-payment, verify-refund, delete-workspace, verify-revoked, attest <name>, summary');
    return;
  }
  if (command === 'self-test') {
    checkUsage({acceptedResponses: 0, credits: {promotionalCredits: 1000, paidCredits: 0, paidCreditDebt: 0}}, 0, 1000);
    let rejected = false;
    try { checkUsage({acceptedResponses: 0, credits: {promotionalCredits: 2000, paidCredits: 0, paidCreditDebt: 0}}, 0, 1000); } catch { rejected = true; }
    check(rejected, 'grant_check_did_not_fail');
    console.log('Offline grant assertion self-test passed; no network or evidence writes.');
    return;
  }
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('evidence_read_failed');
  }
  if (command === 'begin') {
    check(!state, 'existing_run_do_not_overwrite');
    check(token && workspace, 'missing_environment');
    check(process.env.LIKERTS_ACCEPTANCE_WORKSPACE === workspace, 'dedicated_workspace_confirmation_missing');
    const usage = await request('/v1/usage');
    checkUsage(usage, 0, 1000);
    const credentials = await request('/v1/service-credentials');
    check(credentials.every(item => !Object.hasOwn(item, 'token')), 'credential_list_exposes_token');
    const matching = credentials.find(item => item.id === process.env.LIKERTS_ACCEPTANCE_CREDENTIAL_ID);
    check(matching && matching.workspaceId === workspace && !matching.revoked, 'credential_workspace_not_verified');
    state = {runId: randomUUID(), workspaceId: workspace, credentialId: matching.id,
      startedAt: new Date().toISOString(), scope: 'synthetic dedicated customer workspace', checks: {}};
    record('fresh_grant', {responses: 0, promotionalCredits: 1000, paidCredits: 0});
  } else {
    check(state, 'run_not_started');
    if (command === 'attest') {
      const name = process.argv[3];
      check(['email_otp', 'grant_relogin', 'codex', 'claude_code', 'payment_confirmed', 'refund_confirmed', 'post_delete_relogin'].includes(name), 'unknown_attestation');
      record(name, {kind: 'operator_attestation_not_automated_proof'});
    } else if (command === 'summary') {
      console.log(JSON.stringify({runId: state.runId, checks: state.checks}, null, 2));
      return;
    } else {
      check(token && workspace === state.workspaceId, 'workspace_or_token_missing');
      if (command !== 'verify-revoked') {
        // Service credentials select their own tenant; an environment/header ID
        // alone is not a deletion guard, especially after replacing the token.
        const credentials = await request('/v1/service-credentials');
        check(credentials.some(item => item.id === state.credentialId && item.workspaceId === state.workspaceId), 'token_bound_to_other_workspace');
      }
      if (command === 'recheck-grant') {
        checkUsage(await request('/v1/usage'), 0, 1000);
        record('grant_recheck', {responses: 0, promotionalCredits: 1000});
      } else if (command === 'lifecycle') {
        check(state.checks.grant_recheck, 'recheck_grant_first');
        check(!state.lifecycleStarted, 'lifecycle_already_started_inspect_and_cleanup_do_not_rerun');
        // Resolve/build prerequisites before the first mutation.
        const {LikertsClient, LIKERTS_SDK_CAPABILITY} = await import('../../../sdks/web/dist/index.js');
        const cli = process.env.LIKERTS_ACCEPTANCE_CLI;
        check(cli?.startsWith('/'), 'absolute_cli_path_required');
        const exec = promisify(execFile);
        const result = await exec(cli, ['call', 'usage_get'], {timeout: 30_000, maxBuffer: 1_000_000,
          env: {...process.env, LIKERTS_API_URL: api}});
        checkUsage(JSON.parse(result.stdout), 0, 1000);
        record('cli_usage');
        const remote = await remoteUsage();
        checkUsage(remote.usage, 0, 1000);
        record('remote_mcp_protocol', {toolCount: remote.toolCount, client: 'protocol probe, not Codex/Claude'});
        state.lifecycleStarted = true;
        await save();
        const restricted = await request('/v1/service-credentials', {method: 'POST', expected: 201,
          body: {name: 'acceptance-restricted', scopes: ['usage:read'], expiresAt: new Date(Date.now() + 3600_000).toISOString()}});
        state.restrictedCredentialId = restricted.credential.id;
        await save();
        try {
          checkUsage(await request('/v1/usage', {bearer: restricted.token}), 0, 1000);
          await request('/v1/surveys', {bearer: restricted.token, expected: 403});
        } finally {
          await request(`/v1/service-credentials/${restricted.credential.id}`, {method: 'DELETE', expected: 204});
        }
        await request('/v1/usage', {bearer: restricted.token, expected: 401});
        record('restricted_credential_scope_and_revocation');
        const capabilities = {installations: [LIKERTS_SDK_CAPABILITY]};
        const survey = await request('/v1/surveys', {method: 'POST', expected: 201, body: {
          idempotencyKey: `${state.runId}-survey`, title: 'Synthetic customer acceptance',
          questions: [{id: 'rating', type: 'scale', label: 'Synthetic rating', min: 1, max: 5, required: true}],
        }});
        state.surveyId = survey.id;
        await save();
        const version = await request(`/v1/surveys/${survey.id}/publish`, {method: 'POST', body: {revision: survey.revision, sdkCapabilities: capabilities}});
        const collection = await request('/v1/collections', {method: 'POST', expected: 201, body: {
          idempotencyKey: `${state.runId}-collection`, surveyId: survey.id, version: version.version,
          placement: 'synthetic-acceptance', responseCap: 1, sdkCapabilities: capabilities,
        }});
        state.collectionId = collection.id;
        await save();
        const sdk = new LikertsClient(api, collection.token);
        const schema = await sdk.collection(collection.id);
        check(schema.schema.questions.length === 1, 'sdk_schema_mismatch');
        const submission = {idempotencyKey: `${state.runId}-response`, answers: {rating: 5}, metadata: {source: 'synthetic-acceptance'}};
        const receipt = await sdk.submit(collection.id, submission);
        state.responseId = receipt.responseId;
        await save();
        const retry = await sdk.submit(collection.id, submission);
        check(receipt.responseId === retry.responseId, 'duplicate_receipt');
        const responses = await request(`/v1/responses?collectionId=${collection.id}&limit=10`);
        check(responses.items.length === 1 && responses.items[0].receipt.responseId === receipt.responseId, 'retrieval_mismatch');
        checkUsage(await request('/v1/usage'), 1, 999);
        const job = await request('/v1/exports', {method: 'POST', expected: 202,
          body: {idempotencyKey: `${state.runId}-export`, format: 'json', collectionId: collection.id}});
        state.exportId = job.id;
        await save();
        let ready = false;
        for (let i = 0; i < 60; i++) {
          const current = await request(`/v1/exports/${job.id}`);
          if (current.status === 'ready') { ready = true; break; }
          check(current.status !== 'failed', 'export_failed');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        check(ready, 'export_timeout');
        const download = await request(`/v1/exports/${job.id}/download`);
        const bytes = Buffer.from(download.contentBase64, 'base64');
        check(createHash('sha256').update(bytes).digest('hex') === download.contentSha256, 'export_checksum');
        const exported = JSON.parse(bytes.toString());
        check(exported.responses.length === 1 && exported.responses[0].receipt.responseId === receipt.responseId, 'export_record_mismatch');
        await request(`/v1/responses/${receipt.responseId}`, {method: 'DELETE', expected: 204});
        await request(`/v1/exports/${job.id}/download`, {expected: 410});
        check((await request(`/v1/responses?collectionId=${collection.id}&limit=10`)).items.length === 0, 'response_not_deleted');
        await request(`/v1/collections/${collection.id}`, {method: 'PATCH', body: {revoke: true}});
        await request(`/v1/collections/${collection.id}`, {bearer: collection.token, expected: 410});
        record('web_sdk_lifecycle', {sdkVersion: LIKERTS_SDK_CAPABILITY.sdkVersion, acceptedResponses: 1,
          promotionalCredits: 999, duplicateDebits: 0, exportChecksumVerified: true,
          responseDeleted: true, exportRevokedByDeletion: true, collectionRevoked: true,
          boundary: 'Web SDK network client in Node; no browser/native renderer certification'});
      } else if (command === 'verify-payment') {
        check(state.checks.web_sdk_lifecycle && !state.checks.payment_balance, 'payment_sequence');
        checkUsage(await request('/v1/usage'), 1, 999, 500);
        record('payment_balance', {paidCredits: 500, promotionalCredits: 999, debt: 0});
      } else if (command === 'verify-refund') {
        check(state.checks.payment_balance, 'verify_payment_first');
        checkUsage(await request('/v1/usage'), 1, 999, 0);
        record('refund_balance', {paidCredits: 0, promotionalCredits: 999, debt: 0});
      } else if (command === 'delete-workspace') {
        check(state.checks.refund_balance && state.checks.refund_confirmed, 'confirm_refund_before_deletion');
        check(process.env.LIKERTS_ACCEPTANCE_DELETE === state.workspaceId, 'exact_delete_confirmation_missing');
        await request('/v1/workspace', {method: 'DELETE', expected: 204});
        await request('/v1/usage', {expected: 401});
        record('workspace_deleted', {oldCredentialDenied: true});
      } else if (command === 'verify-revoked') {
        await request('/v1/usage', {expected: 401});
        record('browser_issued_token_denied');
      } else throw new Error('unknown_command');
    }
  }
  await save();
  console.log(`PASS ${command}; sanitized evidence saved under release/acceptance/evidence/.`);
}

main().catch(async error => {
  // Child process errors can contain stdout/stderr; never print the error object.
  const safe = /^(http_[A-Z]+_\d+_expected_\d+|[a-z][a-z0-9_]+)$/.test(error.message ?? '') ? error.message : 'operation_failed_details_suppressed';
  if (state) { state.lastFailure = {at: new Date().toISOString(), command: process.argv[2], code: safe}; await save().catch(() => {}); }
  console.error(`FAIL ${safe}. See the acceptance runbook; do not blindly retry mutations.`);
  process.exitCode = 1;
});
