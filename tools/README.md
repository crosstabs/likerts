# Likerts management interfaces

A first working adapter layer for the implemented HTTP service. `capabilities.json` is the shared operation registry used by both interfaces. It currently exposes every implemented customer operation: survey creation/list/update/publication, collection creation/acceptance/configuration, response submission/retrieval and usage. Health checks are operational infrastructure rather than customer tools.

The adapters cover every implemented customer operation. The backend supports scoped/revocable service credentials, tenant membership administration, OAuth grants, response/export/workspace deletion and provider-neutral passwordless OAuth JWT verification. Local test-mode Stripe settlement is implemented; Clerk sandbox validation remains open; development token maps remain explicitly gated and must not be deployed.

## Rust CLI

Human OAuth calls require `LIKERTS_WORKSPACE_ID`; the header selects a tenant and the API still proves current membership and grant authority. Service credentials are already tenant-bound and may omit it. `likerts auth login` discovers RFC OAuth authorization-server metadata, requires authorization code plus refresh support, PKCE S256 and every requested Likerts scope, and sends the protected resource identifier during authorization and token exchange.

The CLI refreshes an expiring access token with refresh-token rotation when the provider returns a replacement. `likerts auth logout` revokes the refresh token at the discovered provider endpoint before deleting the local credential; local credentials are deleted even if remote revocation fails. A remote failure is still reported with a nonzero exit, so the user can revoke the remaining provider session through the identity provider.

```sh
cargo build --manifest-path tools/cli/Cargo.toml
./tools/cli/target/debug/likerts capabilities
jq '. + {idempotencyKey:"my-survey-create-1"}' contracts/survey.example.json | ./tools/cli/target/debug/likerts call surveys_create --input -
./tools/cli/target/debug/likerts call usage_get
```

Set `LIKERTS_API_URL` to the service origin (default `http://127.0.0.1:8080`). For human access, set the public native-app `LIKERTS_OAUTH_CLIENT_ID` and run `likerts auth login`. The CLI discovers the authorization server from the API, opens passwordless authorization code login with PKCE and explicit consent, and writes the resulting credential atomically under the user's configuration directory with `0700`/`0600` permissions on Unix. `likerts auth status` checks local presence and `likerts auth logout` removes it. An explicit `LIKERTS_TOKEN` takes precedence for automation and tests. Collection schema/submission calls require a separate `LIKERTS_COLLECTION_TOKEN`; management tokens never substitute for collection tokens. Input is a JSON object, either a file or `--input -` for stdin. Resource IDs go in the input object's `id` field. Successful calls print JSON; errors go to stderr and return nonzero. No automatic write retries: callers preserve the original response idempotency key when retrying.

`responses_list` accepts `limit` (default 100, maximum 1,000), `collectionId`, `acceptedFrom`, `acceptedTo` and `cursor`. The CLI and MCP client encode these as HTTP query parameters. The first page creates a stable snapshot; continue using its `nextCursor` until it is null. Start a new call without a cursor to include responses accepted after the snapshot began.

`exports_create` starts an idempotent `csv` or `json` snapshot export with optional response filters. Use `exports_get` to poll its job ID, `exports_download` to receive authenticated base64 content plus its SHA-256 and schema manifest, and `exports_revoke` to remove the object and deny further access. Jobs and downloads expire after 24 hours. The same operation names and input objects work through MCP and the CLI.

Collection creation returns a collection token. Treat saved CLI output accordingly. Neither tool accepts management tokens as command-line arguments or model-visible tool arguments.

Publication and collection creation require an `sdkCapabilities` object. Gather the exported capability record from every distinct installed SDK deployment group; do not report only the newest package when older installations remain active. For example:

```json
{"installations":[{"target":"ios","sdkVersion":"legacy-v1","schemaVersions":[1]},{"target":"ios","sdkVersion":"0.0.1","schemaVersions":[1,2]}]}
```

The backend compares every group with the survey's actual schema version. The example permits baseline schema v1 and blocks expanded schema v2 until the legacy group is removed or upgraded. The declaration is persisted with the immutable published version and collection; changing a declaration on an idempotent retry conflicts.

## MCP for local agent clients

```sh
npm ci --prefix tools/mcp
npm run build --prefix tools/mcp
node tools/mcp/dist/main.js
```

Configure an MCP client to launch `node` with the absolute path to `tools/mcp/dist/main.js` and the same environment variables. This adapter keeps using the official MCP TypeScript SDK over stdio. It must be launched by an MCP client; stdout is reserved for protocol messages. The launch configuration is client-specific.

## Remote MCP for Codex and Claude

The same 40-operation registry is available over stateless MCP Streamable HTTP. Each configured endpoint binds one explicit workspace in its path:

```text
https://mcp.example.com/mcp/{workspaceId}
```

Build the package, then run `npm run start:remote --prefix tools/mcp` with `LIKERTS_API_URL`, `LIKERTS_MCP_PUBLIC_ORIGIN`, `LIKERTS_OIDC_ISSUER`, `LIKERTS_MCP_ALLOWED_ORIGINS`, and optionally `LIKERTS_MCP_PORT`/`LIKERTS_MCP_BIND_ADDRESS`. All origins are exact; production values require HTTPS. The allowed-origin value is a comma-separated allowlist and cannot be `*` because browsers send bearer credentials.

An unauthenticated MCP request returns a `401` Bearer challenge pointing to `/.well-known/oauth-protected-resource`. That document names the canonical resource, Clerk/provider-neutral authorization server and the exact Likerts scopes. Clients then discover the authorization server's own `/.well-known/oauth-authorization-server` metadata, use authorization code with PKCE, and send the resulting bearer token to the fixed workspace endpoint. The gateway forwards the verified credential and workspace selection to the API; PostgreSQL still requires an active membership and an unexpired, unrevoked durable grant for the same subject, OAuth client, audience, workspace and requested scope. A browser owner must explicitly approve that grant. The gateway never derives workspace access from a token claim.

Collection schema and submission operations use separate collection capabilities. A remote client that needs those operations supplies the collection credential as `X-Likerts-Collection-Token`; it is never substituted for the OAuth bearer or forwarded as a management credential. Prefer an embedded SDK for end-user collection rather than placing this credential in general agent configuration.

Every registry operation becomes a named MCP tool. Question definitions follow the shared contract in `contracts/`; all inputs receive authoritative backend validation. MCP schema validation catches malformed operation arguments before sending. Collection credential setup is outside tool arguments and therefore not included in ordinary tool transcripts; collection-creation results do contain the newly issued limited credential.

## Transport safeguards

HTTPS is required except on explicit loopback origins. Redirects are refused to prevent credential forwarding to other origins. API origins cannot include credentials, paths, queries or fragments. Malformed-origin startup errors use a fixed message and never echo the configured input. Resource IDs cannot alter endpoint paths. Calls time out after 30 seconds and errors do not echo arbitrary upstream response bodies.

## Verification

```sh
npm run build --prefix tools/mcp
npm test --prefix tools/mcp
cargo test --manifest-path tools/cli/Cargo.toml
```

Tests exercise credential separation, retry payload preservation, unsafe URLs/resource IDs and actual MCP tool discovery/invocation over the SDK's in-memory and Streamable HTTP transports. The remote suite also checks all 40 tools, exact workspace forwarding, Bearer discovery challenges, origin allowlisting and fail-closed configuration. `node --test tests/interface-contract.mjs` additionally executes every capability through MCP and the compiled CLI against a validating HTTP fixture. OpenAPI supplies MCP input and output schemas; successful text remains the API JSON, while MCP `structuredContent` wraps it as `{result: ...}`. Safe HTTP failures contain `error.code`, `status`, `operation` and a fixed message; upstream bodies are discarded. The exact registered backend routes, compiled CLI inventory and generated examples also have CI gates. Backend authorization remains authoritative.

See [the complete capability reference](../contracts/CAPABILITIES.md) for every operation's scope, usage note, input file, output example and documented errors.

## Expanded questions through every interface

Use the same create/update operations for NPS, labeled Likert scales, yes/no and selection limits. These remain six wire question types; answers remain numbers, option IDs and arrays of IDs. No new endpoint or credential is required.

```sh
jq '. + {idempotencyKey:"my-expanded-survey-create-1"}' contracts/expanded-survey.example.json | ./tools/cli/target/debug/likerts call surveys_create --input -
```

For MCP, call `surveys_create` with the JSON object in that file plus a stable `idempotencyKey`. For HTTP, POST that augmented JSON to `/v1/surveys` using the management credential. Reuse the key only for an identical retry. Updates use the same `questions` and `title`, with the existing survey ID and revision.

- NPS: `type: "scale", preset: "nps", min: 0, max: 10`.
- Labeled scales: `labels: {"1":"Strongly disagree","5":"Strongly agree"}`; keys must be canonical integers within the scale range. Labels are optional for individual values and support custom language strings.
- Yes/no: `type: "single_choice", preset: "yes_no"`, with exactly options `yes` and `no`; labels may be customized.
- Multiple choice: `minSelections` and `maxSelections` constrain supplied arrays. Required questions have an effective minimum of at least one. Optional answers may be omitted, even with a minimum; an explicitly supplied empty array must satisfy the minimum.

The published collection returns `schemaVersion: 2` whenever any of these fields is present. Unextended surveys remain version 1. All supported SDKs accept both; older SDK releases must be upgraded before using expanded questions. Omit unused optional fields; explicit JSON null is rejected. Backend validation remains authoritative for relationships between fields.
