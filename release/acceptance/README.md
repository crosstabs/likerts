# Production customer acceptance

This runbook follows a new customer from email verification to deletion. It uses the real production endpoints and one dedicated workspace containing synthetic answers. Running it changes that workspace, consumes one promotional response, and eventually deletes it. The operator performs one $5 purchase and full refund separately. Do not use an existing customer workspace.

The script does not create accounts, read inboxes, complete payment forms, refund money, configure Codex/Claude, or claim that an operator attestation is an automated test. It records only bounded status, resource IDs and aggregate counts. No service tokens, collection tokens, session JWTs, checkout URLs, customer email addresses, answers or provider response bodies enter its evidence. The evidence directory is ignored and created with owner-only permissions.

## Prepare

Use Node.js 22+, the repository Rust toolchain and the built Web SDK. From the repository root:

```sh
cargo build --manifest-path tools/cli/Cargo.toml --locked
npm ci --prefix sdks/web
npm run build --prefix sdks/web
node --check release/acceptance/customer.mjs
node release/acceptance/customer.mjs self-test
```

The offline self-test checks balance assertions only. It is not a rehearsal of production mutations. The runner imports the actual built Web SDK; it declares only that SDK's capability record. Native renderer/device coverage remains a separate release gate.

Supply `LIKERTS_TOKEN` through your secret manager or a private environment injection mechanism. Do not paste it into commands, chat, recordings, committed environment files or terminal transcripts. Disable shell tracing, HTTP debug logging and verbose subprocess logging. The examples below contain only public URLs and non-secret IDs. The runner reads the token from its environment and captures CLI output in memory without printing it. It never launches an agent with a token argument.

## 1. New account, grant and browser credential

Human inbox step:

1. Open [likerts.com](https://likerts.com) in a fresh browser profile, use an acceptance email address you control, and complete the received email code. Never record the code. Verify that no password is requested.
2. The workspace must show **0 accepted responses and 1,000 available credits**. Record its workspace ID privately. An account already containing data or credits is unsuitable.
3. Under **Connect Codex, Claude, or the CLI**, create an acceptance credential. Select survey read/write, collection management, response read/erase, usage, export read/write, and access management. Billing is unnecessary for the automated runner; browser checkout uses its separate owner session.
4. Copy the token once to the secret manager. Record its credential ID through the metadata list/API. Reload the page: the list must show metadata and revocation controls, never redisplay the old token. The button issues a 90-day credential.

Set the non-secret workspace and credential IDs, the same workspace as the explicit test target, and the absolute CLI executable path:

```sh
export LIKERTS_WORKSPACE_ID=YOUR_DEDICATED_WORKSPACE_ID
export LIKERTS_ACCEPTANCE_WORKSPACE="$LIKERTS_WORKSPACE_ID"
export LIKERTS_ACCEPTANCE_CREDENTIAL_ID=YOUR_CREDENTIAL_ID
export LIKERTS_ACCEPTANCE_CLI=/absolute/path/to/likerts/tools/cli/target/debug/likerts
node release/acceptance/customer.mjs begin
node release/acceptance/customer.mjs attest email_otp
```

`begin` is read-only against the service. It requires exactly 0 accepted responses, 1,000 promotional credits, 0 paid credits and no credit debt. It verifies the specified credential metadata belongs to the target workspace and that the list contains no token field. It refuses to overwrite an existing run.

Sign out and sign back in with another email code. The workspace ID and balances must be unchanged. Refresh twice and confirm another grant is not issued. Then:

```sh
node release/acceptance/customer.mjs recheck-grant
node release/acceptance/customer.mjs attest grant_relogin
```

Evidence: `fresh_grant`, `grant_recheck`, and two clearly labeled operator attestations. This proves a same-account repeat does not duplicate its grant; it does not prove duplicate-person abuse prevention across distinct accounts.

## 2. Actual Codex and Claude Code clients

Use the same restricted-to-task credential, supplied to each client process through the environment. Follow [the setup guide](../../tools/README.md#remote-mcp-for-codex-and-claude). The endpoint must be:

```text
https://likerts-mcp.onrender.com/mcp/YOUR_DEDICATED_WORKSPACE_ID
```

In **each real client**, connect and request: “Use the Likerts MCP tool `usage_get` to read the workspace balance. Do not create, edit, submit or delete anything.” Inspect the actual tool result, not merely the assistant's prose. It must return 0 accepted responses, 1,000 promotional credits and 0 paid credits. Store an internal redacted capture showing client/version, server name, operation and those counters; exclude client configuration, account details and tokens. Then record:

```sh
node release/acceptance/customer.mjs attest codex
node release/acceptance/customer.mjs attest claude_code
```

These are manual observations of real integrations. The runner's direct MCP protocol probe does not replace them. Failure to connect in either required client leaves that client gate open. Other Claude surfaces with different connector/authentication support are not certified by Claude Code evidence.

## 3. Automated API, CLI, credential and SDK lifecycle

```sh
node release/acceptance/customer.mjs lifecycle
```

The runner performs this exact sequence:

| Check | Required result |
| --- | --- |
| CLI `usage_get` | Same untouched grant as API; credential supplied through environment |
| Remote MCP initialize/list/call | Successful protocol exchange; `usage_get` returns the same balance; tool inventory count recorded |
| Child credential with only `usage:read` | Usage succeeds; survey listing is 403; revocation is 204; subsequent usage is 401 |
| Draft and immutable publication | Create 201, publish 200 using the built Web SDK's exported capability declaration |
| Collection | Create 201, response cap 1, token stays only in memory |
| Actual Web SDK network client | Fetch schema; submit a synthetic rating; submit identical payload/key again; response ID identical |
| Retrieval and accounting | Exactly 1 response; 999 promotional credits; 0 paid credits/debt |
| Private JSON export | Ready within bounded polling; SHA-256 matches downloaded bytes; exactly the accepted response appears |
| Response deletion | 204; response list empty; the prior export download returns 410 |
| Collection revocation | Revoke succeeds; collection credential subsequently receives 410 |

The SDK check runs the real Web client in Node, not the browser renderer. It does not establish CORS, DOM accessibility, mobile rendering or cross-replica export failover. [The five-platform release rehearsal](../README.md) and the SDK device matrices remain separate acceptance requirements. This run intentionally declares only the client it executes.

Only a complete sequence records `web_sdk_lifecycle`. Aggregate usage remains 1 after response deletion: deletion must not erase financial accounting. No real respondent data is involved.

## 4. Purchase and refund

Human payment step, only after the operator has authorized the real $5 charge and full refund:

1. Use **Add response credits** at likerts.com to initiate exactly a $5 purchase in the same workspace. If the deployed checkout is in Stripe test mode, use Stripe's supported test method and label the provider evidence **test**, not production settlement. Never enter real card details into a test checkout.
2. Before successful payment, balance must remain 999 promotional / 0 paid. Complete checkout in the browser. The payment return page alone is insufficient: verify the Stripe payment/session in the merchant dashboard and wait for the signed event to update Likerts.
3. Confirm exactly one successful payment for 500 cents USD. Refresh/revisit the completion page; balance must remain 500 paid credits, not double. Record internal provider references in the merchant's audit system, not this repository. The redacted acceptance evidence must identify test/live mode, 500 cents USD, successful status and matching Likerts workspace; omit payment details and full checkout URLs.

```sh
node release/acceptance/customer.mjs verify-payment
node release/acceptance/customer.mjs attest payment_confirmed
```

The automated assertion requires 1 accepted response, 999 promotional credits, exactly 500 paid credits and no debt. It does not independently prove who paid, one charge, provider mode or settlement reconciliation; the provider confirmation is required.

4. Do not submit another response or spend paid credits. An authorized merchant operator issues a **full 500-cent refund of this exact acceptance payment** through Stripe's dashboard. Match the payment to the dedicated workspace before confirming. Do not refund another customer or invoke the legacy postpaid settlement refund route for a prepaid checkout.
5. Wait for refund webhook delivery. Verify the provider refund succeeded and Likerts removes the 500 paid credits while preserving 999 promotional credits and gross usage. Record internal provider references and redacted amount/status/mode evidence.

```sh
node release/acceptance/customer.mjs verify-refund
node release/acceptance/customer.mjs attest refund_confirmed
```

Provider event replay, out-of-order events and disputed payments require their separate sandbox gates. Neither balance read nor an attestation substitutes for those tests. If a webhook is delayed, run the read-only verification again; do not repeat the charge or refund.

## 5. Browser revocation and final deletion

To verify the browser's **Revoke** button, revoke the original acceptance credential at likerts.com, while the old token is still supplied to the runner:

```sh
node release/acceptance/customer.mjs verify-revoked
```

Expected: API usage returns 401. In Codex and Claude Code, a new `usage_get` invocation with the old token must fail authorization. A cached previous result is insufficient. Keep the redacted client observations with the run evidence.

Create a new short-lived cleanup credential in the same workspace with access management scope and securely replace `LIKERTS_TOKEN` in the operator environment. Keep the original credential ID in the evidence; it identifies the token already proved revoked. Deletion requires the exact workspace as a second explicit guard:

```sh
export LIKERTS_ACCEPTANCE_DELETE="$LIKERTS_WORKSPACE_ID"
node release/acceptance/customer.mjs delete-workspace
```

Expected: workspace delete 204; the cleanup credential immediately receives 401. Sign out and back into the same browser account. Bootstrap must not recreate the deleted workspace or reissue 1,000 credits. An access-denied/tombstoned outcome is correct; a new free workspace is a failure. Record:

```sh
node release/acceptance/customer.mjs attest post_delete_relogin
node release/acceptance/customer.mjs summary
```

Delete the obsolete tokens from client environments and secret storage and remove acceptance-only client configurations. Financial/provider records persist according to the financial retention policy; account deletion is not proof those records were erased.

## Evidence and failure handling

`release/acceptance/evidence/customer.json` is the sanitized run record. It must contain all these checks before this specific journey is accepted:

```text
fresh_grant, email_otp, grant_recheck, grant_relogin,
codex, claude_code, cli_usage, remote_mcp_protocol,
restricted_credential_scope_and_revocation, web_sdk_lifecycle,
payment_balance, payment_confirmed, refund_balance, refund_confirmed,
browser_issued_token_denied, workspace_deleted, post_delete_relogin
```

Review the actual details and the separate redacted client/provider evidence. Attestations explicitly identify themselves as operator reports, not machine proof. The runner does not emit a blanket “production ready” verdict. Complete five-SDK platform coverage, load, monitoring, recovery, security and launch approval remain outside this journey.

On failure, only a fixed error classification is printed. IDs already created are retained in the private evidence; tokens are not. The script refuses to rerun a started mutating lifecycle because token issuance and publication cannot be blindly retried. Inspect the saved IDs, revoke any acceptance credentials through the owner UI, and use scoped management operations for cleanup. For a partially completed run that never purchased credits, an owner may explicitly delete the dedicated workspace through `workspace_delete` after confirming its exact ID. For any run that might have charged money, inspect and reconcile/refund its payment before deletion. Do not manually mark a failed check passed.

Archive the sanitized record outside this directory before a new run. A new run requires a newly approved dedicated account/workspace; repeatedly creating free accounts is not an abuse test and should not be done without a separate bounded test plan. This script performs no account-creation automation.
