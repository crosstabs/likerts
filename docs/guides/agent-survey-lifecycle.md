# Manage a survey lifecycle through MCP

This walkthrough exercises a real workspace through the published `@likerts/mcp@0.1.0` adapter: discover tools, create a scoped credential, author and publish a survey, create a collection, submit one synthetic answer, retrieve it, close collection intake, delete the answer and revoke access. A disposable PostgreSQL database backs the real Rust API. No hosted workspace is used.

The runnable [lifecycle script](../../scripts/check-mcp-lifecycle.mjs) is a deterministic MCP client. It uses the same tools available to an agent, without requiring a model account or a model-generated decision. The current MCP registry record is `0.1.1`; its npm executable remains `0.1.0`. These are separate version numbers. The associated Web capability declaration is `0.0.3`; the repository CLI is `0.1.2`.

## Run it from a fresh checkout

Prerequisites: Node.js 22+, npm, Rust stable and a running Docker daemon. The first run downloads the PostgreSQL image, npm dependencies and Rust dependencies. Use **Bash** from the repository root:

```sh
set -e
source scripts/dev-env.sh
npm ci --prefix tools/mcp
node scripts/check-mcp-lifecycle.mjs
```

The script installs the public npm package into a temporary directory, creates a uniquely named PostgreSQL container with a dynamically allocated loopback port, applies migrations and starts the API under a restricted runtime database role. It deliberately excludes production database, OIDC and workspace credentials from that API's environment. The bootstrap development token exists only in the disposable workspace.

The final JSON reports the following verified results; a failed assertion exits nonzero:

```json
{
  "package": "@likerts/mcp@0.1.0",
  "tools": 33,
  "realApi": true,
  "scopedLifecycle": true,
  "identicalRetry": true,
  "retrievedResponses": 1,
  "insufficientScopeStatus": 403,
  "collectionClosed": true,
  "responseDeleted": true,
  "credentialRevoked": true,
  "storage": "disposable-postgresql-restricted-role"
}
```

## Understand the authority before authoring

The bootstrap operator calls `service_credentials_create` once to issue a one-hour credential. The everyday manager then uses that narrower credential rather than the bootstrap token.

| Scope or credential | What this walkthrough uses it for |
| --- | --- |
| `surveys:read`, `surveys:write` | Inspect, create and publish surveys. |
| `collections:write` | Create a collection and close intake. |
| `responses:read` | Retrieve the stored answer. |
| `responses:write` | Delete the synthetic answer. This is unnecessary for an authoring-only agent. |
| `usage:read` | A call used to prove that revoked access fails. |
| Separate collection credential | Fetch collection configuration and submit an answer. Management scope does not replace this credential. |
| Operator-only `identity:write` authority | Issue/revoke service credentials and delete the disposable workspace. It is not granted to the manager. |

All 33 tools remain discoverable. Discovery is not a grant. The script creates another credential with only `surveys:read`, confirms it can list surveys and verifies its attempt to create one returns `403`.

## Trace the tool calls

The script is the executable reference for this sequence. Resource IDs and revisions below refer to values returned by previous calls; do not replace them with guessed IDs. Its `call` helper invokes `client.callTool({ name, arguments })`, rejects `isError: true` and reads `structuredContent.result`.

1. **Create the draft** with `surveys_create`. The [input file](../../control-plane/public/docs/survey-create.json) contains a required 1–5 scale question with ID `rating` and title “Checkout feedback.” The script replaces its illustrative idempotency key with a fresh UUID for this new operation. Keep that key if retrying the creation.
2. **Publish** with `surveys_publish`, passing the returned `id`, current `revision` and the [Web SDK capability record](../../control-plane/public/docs/sdk-capabilities.json). Publication fixes an immutable version. Every deployed SDK group must support that survey's schema; declaring a newer SDK than your clients run is not a compatibility fix.
3. **Create collection intake** with `collections_create`, passing a new operation key, the published `surveyId`, `version`, `placement: "registry-lifecycle"` and the same capabilities. Save the returned collection credential through a protected process. It is a credential even though respondent clients need it.
4. **Use collection authority** for `collections_get` and `responses_submit`. The collector process receives `LIKERTS_COLLECTION_TOKEN` separately. The submission shape is:

   ```js
   const submission = {
     id: collection.id,
     idempotencyKey: randomUUID(),
     answers: { rating: 5 },
     metadata: { channel: 'public-npm-mcp-rehearsal' },
   };
   const receipt = await call(collector, 'responses_submit', submission);
   const retry = await call(collector, 'responses_submit', submission);
   ```

   This is the core excerpt from the runnable script, not a standalone program. Both calls use the same object. The script asserts `accepted: true` and identical receipt IDs. In an actual customer app, submission normally comes from the embedded SDK; agent submission here is synthetic verification, not an invitation/distribution workflow.
5. **Retrieve** with `responses_list`, using `{ collectionId: collection.id, limit: 10 }`. Check that there is one item, its `receipt.responseId` matches, and answers and metadata match. This newly created collection contains only this test answer. For real lists, follow `nextCursor` until null; do not treat the first page as the whole dataset.
6. **Close intake** with `collections_update`, using `{ id: collection.id, accepting: false }`. A new submission is now rejected. Closing intake does not erase existing answers.
7. **Erase the test answer** with `responses_delete`, using `{ id: receipt.responseId }`, then assert that listing the collection is empty. This is destructive; do not include it in an ordinary reporting agent's scope or task.
8. **End access** with operator `service_credentials_revoke`, passing the credential record's ID. The manager's next `usage_get` must fail. Finally the bootstrap operator calls `workspace_delete` on this disposable workspace. Never copy that cleanup step into a shared workspace.

## Connect an agent to your own workspace

After the local rehearsal, follow the [Codex or Claude connection guide](../../tools/README.md#mcp-for-local-agent-clients). It contains installation and environment-based configuration for the same pinned npm adapter. Start with a `surveys:read` credential and ask the client to call `surveys_list` with `{}`. Add only the capabilities needed for its next job.

For an authoring job, a useful instruction is: “Create a draft checkout survey with one required 1–5 rating. Return its draft ID and revision for review.” Grant `surveys:write` for that task. Publication, collection creation, response access and deletion should follow the authority and intent you actually gave the agent. The API enforces scopes; it cannot infer your business approval policy from a prompt.

Keep management tokens in the client's secret environment, outside prompts, tool arguments, repository files and logs. Tool results may include customer responses or newly issued collection credentials: choose an approved model/client and keep its transcript access appropriate to that workspace. For a browser host, configure the collection's exact allowed origins; this stdio rehearsal does not establish browser CORS policy.

On `401`, inspect expiry/revocation and the API origin. On `403`, inspect scope and workspace binding. On a timeout, preserve the complete original payload/key; on `409`, reconcile the operation rather than silently generating a replacement key. Refer to [support troubleshooting](../community/SUPPORT.md#common-integration-problems) and the [operation contract](../../contracts/CAPABILITIES.md).

## Verification and cleanup limits

The command sequence above passed on **2026-09-13**, using a fresh public npm installation and the final JSON shown above. It verifies protocol discovery, real API operations, restricted PostgreSQL runtime access, scope denial, idempotency, readback, closed intake, response deletion and credential revocation. It does not prove model judgment, a hosted deployment, backup restoration or retention of deleted data in historical backups.

The script closes MCP transports, stops the API and disposable container, and removes its temporary package/export directory in its normal completion/failure cleanup. A killed process or host crash may leave resources; inspect only the `likerts-mcp-lifecycle-…` container and temporary directory belonging to your run before removing them. Do not use a blanket Docker cleanup against unrelated development resources. No third-party account changes or public posts occur.
