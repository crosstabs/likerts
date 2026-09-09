# Likerts management interfaces

The API, Rust CLI and MCP adapter share the operation registry in `capabilities.json`. Each implemented customer operation has the same authorization boundary across these interfaces. Health checks are operational infrastructure rather than customer tools.

## Connect your workspace

1. Sign in at [likerts.com](https://likerts.com) using passwordless email verification. The control plane creates your personal workspace and shows its ID, accepted responses and available credits.
2. Under **Connect Codex, Claude, or the CLI**, name a credential and select the capabilities it needs. Access management (`identity:write`) and billing (`billing:write`) are separate, opt-in scopes.
3. Select **Create 90-day credential** and copy the token immediately into your secret manager. It is returned only at creation; the credential list cannot retrieve it again. If the token is lost, revoke that credential and create another.
4. Supply it to your client as `LIKERTS_TOKEN`. Keep management tokens out of application bundles, source control, chat messages and model tool arguments. Each credential belongs to one workspace and authorizes only its selected scopes.

The production API origin is `https://likerts-api.onrender.com`; remote MCP is `https://likerts-mcp.onrender.com/mcp/{workspaceId}`. Copy the exact workspace ID from the control plane. A service credential selects its own workspace for direct API/CLI calls; the MCP path must match that workspace.

**Revoke** beside a credential in the control plane disables subsequent API operations, including operations forwarded by MCP. To rotate, create a replacement, update your client and revoke the old credential. Service credentials expire and do not refresh automatically. `likerts auth logout` manages separately stored OAuth credentials; it does not revoke a service token supplied through the environment. Remove the environment value when finished, and revoke it in Likerts when access should end.

## Direct API

With `LIKERTS_TOKEN` supplied by your secret manager and the `usage:read` scope, inspect usage:

```sh
export LIKERTS_API_URL=https://likerts-api.onrender.com
printf 'header = "Authorization: Bearer %s"\n' "$LIKERTS_TOKEN" | \
  curl --fail-with-body --config - "$LIKERTS_API_URL/v1/usage"
```

The header is read from stdin rather than putting the token in curl's arguments. The [capability reference](../contracts/CAPABILITIES.md) and [OpenAPI contract](../contracts/openapi.json) describe other routes and their required scopes. Development token maps remain explicitly gated and must not be deployed.

## Rust CLI

The launch path uses the scoped service token above. Download the checksummed source bundle and install it with Cargo:

```sh
curl --fail --remote-name https://likerts.com/downloads/likerts-cli-source-0.1.0.tar.gz
curl --fail --remote-name https://likerts.com/downloads/SHA256SUMS
grep 'likerts-cli-source-0.1.0.tar.gz' SHA256SUMS | shasum -a 256 -c -
tar -xzf likerts-cli-source-0.1.0.tar.gz
cargo install --locked --path tools/cli
```

This installs `likerts` into Cargo's binary directory. A platform-native binary installer is not published yet.

Human OAuth calls require `LIKERTS_WORKSPACE_ID`; the header selects a tenant and the API still proves current membership and grant authority. Service credentials are already tenant-bound and may omit it. `likerts auth login` discovers RFC OAuth authorization-server metadata, requires authorization code plus refresh support, PKCE S256 and every requested Likerts scope, and sends the protected resource identifier during authorization and token exchange.

The CLI refreshes an expiring access token with refresh-token rotation when the provider returns a replacement. `likerts auth logout` revokes the refresh token at the discovered provider endpoint before deleting the local credential; local credentials are deleted even if remote revocation fails. A remote failure is still reported with a nonzero exit, so the user can revoke the remaining provider session through the identity provider.

```sh
export LIKERTS_API_URL=https://likerts-api.onrender.com
# LIKERTS_TOKEN must already be supplied by your secret manager.
likerts capabilities
jq '. + {idempotencyKey:"my-survey-create-1"}' contracts/survey.example.json | likerts call surveys_create --input -
likerts call usage_get
```

Set `LIKERTS_API_URL` explicitly for the hosted service; the CLI defaults to local development at `http://127.0.0.1:8080`. The service-token path does not require `likerts auth login` or an OAuth client registration. For a separately configured human OAuth integration, set the public native-app `LIKERTS_OAUTH_CLIENT_ID` and run `likerts auth login`. The CLI discovers the authorization server from the API, opens passwordless authorization code login with PKCE and explicit consent, and writes the resulting credential atomically under the user's configuration directory with `0700`/`0600` permissions on Unix. `likerts auth status` checks local presence and `likerts auth logout` removes it. An explicit `LIKERTS_TOKEN` takes precedence for automation and tests. Collection schema/submission calls require a separate `LIKERTS_COLLECTION_TOKEN`; management tokens never substitute for collection tokens. Input is a JSON object, either a file or `--input -` for stdin. Resource IDs go in the input object's `id` field. Successful calls print JSON; errors go to stderr and return nonzero. No automatic write retries: callers preserve the original response idempotency key when retrying.

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

Connect to the hosted stateless MCP Streamable HTTP endpoint using your scoped service token:

```text
https://likerts-mcp.onrender.com/mcp/{workspaceId}
```

Replace `{workspaceId}` with the exact ID displayed at likerts.com. The gateway forwards the bearer token and that workspace to the API; the API enforces the credential's workspace, expiry, revocation and scope on every operation. Tool discovery lists the shared registry; selecting fewer scopes means unauthorized operations are denied, not that they disappear from discovery.

For **Codex**, set `LIKERTS_WORKSPACE_ID` to the displayed ID and ensure `LIKERTS_TOKEN` is available to the Codex process, then register the endpoint:

```sh
codex mcp add likerts \
  --url "https://likerts-mcp.onrender.com/mcp/$LIKERTS_WORKSPACE_ID" \
  --bearer-token-env-var LIKERTS_TOKEN
```

For **Claude Code**, add this entry to your project's `.mcp.json`, preserving any existing servers. Replace only `YOUR_WORKSPACE_ID`; leave `${LIKERTS_TOKEN}` as an environment reference. Start Claude Code with that environment variable supplied by your secret manager.

```json
{
  "mcpServers": {
    "likerts": {
      "type": "http",
      "url": "https://likerts-mcp.onrender.com/mcp/YOUR_WORKSPACE_ID",
      "headers": { "Authorization": "Bearer ${LIKERTS_TOKEN}" }
    }
  }
}
```

Claude Code documents [environment expansion in MCP configuration](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json). These are bearer-token client configurations; no provider OAuth consent or client registration is required for this path. Other Claude surfaces must support configuring an Authorization header to use it. If a client cannot supply a bearer header, use the local stdio adapter above with `LIKERTS_API_URL` and `LIKERTS_TOKEN` in its process environment.

A separately configured OAuth integration can use the `401` Bearer challenge at `/.well-known/oauth-protected-resource`, authorization-server discovery and authorization code with PKCE. That route additionally requires a registered OAuth client and an owner-approved durable grant matching the subject, client, audience, workspace and scopes. It is distinct from the self-service credential path.

To host your own MCP gateway from source, run `npm run start:remote --prefix tools/mcp` after building, with `LIKERTS_API_URL`, `LIKERTS_MCP_PUBLIC_ORIGIN`, `LIKERTS_OIDC_ISSUER`, `LIKERTS_MCP_ALLOWED_ORIGINS`, and optionally `LIKERTS_MCP_PORT`/`LIKERTS_MCP_BIND_ADDRESS`. All origins are exact; production values require HTTPS. The allowed-origin value is a comma-separated allowlist and cannot be `*` because browsers send bearer credentials.

Collection schema and submission operations use separate collection capabilities. A remote client that needs those operations supplies the collection credential as `X-Likerts-Collection-Token`; it is never substituted for the management bearer or forwarded as a management credential. Prefer an embedded SDK for end-user collection rather than placing this credential in general agent configuration.

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
