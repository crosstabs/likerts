# Likerts MCP server

Operate the free, MIT-licensed Likerts survey platform from an MCP client. The server exposes the same typed operations and authorization boundaries as the HTTP API and CLI.

The hosted server is listed in the [official MCP registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.crosstabs%2Flikerts/versions/latest) as `io.github.crosstabs/likerts`. Configure your workspace ID and scoped service credential in your MCP client. The listing does not make workspace data public.

## Install

Install a published version from npm:

```sh
npm install --global @likerts/mcp@0.1.0
```

Alternatively, download the MCP tarball from the [community release](https://github.com/crosstabs/likerts/releases) and run `npm install --global /absolute/path/to/the-mcp-package.tgz`. Node.js 22 or newer is required.

Configure your MCP client to run `likerts-mcp` over stdio. Set `LIKERTS_API_URL` to your API origin and supply a scoped `LIKERTS_TOKEN` through your environment or secret manager. The local API defaults to `http://127.0.0.1:8080`. Collection operations use `LIKERTS_COLLECTION_TOKEN` separately; keep management credentials out of embedded apps and tool arguments.

Copy the [local Codex configuration](https://github.com/crosstabs/likerts/blob/main/tools/README.md#local-codex-setup) or [local Claude Code configuration](https://github.com/crosstabs/likerts/blob/main/tools/README.md#local-claude-code-setup). Both read the service credential from your environment; start with only the scopes your workflow needs.

For a source checkout:

```sh
npm ci --prefix tools/mcp
npm run build --prefix tools/mcp
node tools/mcp/dist/main.js
```

Launch the command from an MCP client; stdout is reserved for protocol messages. Authentication and permission checks remain enforced by your API.

## Remote connection

The optional hosted endpoint is `https://likerts-mcp.onrender.com/mcp/{workspaceId}`. It requires the workspace's scoped service credential. It is a [hosted reference preview](https://likerts.com/preview) for synthetic, non-sensitive evaluation data, with the same operational and support limits as the web preview. Self-hosters use their own remote host.

[Setup for Codex and Claude](https://github.com/crosstabs/likerts/blob/main/tools/README.md) · [Quickstart](https://likerts.com/docs) · [API reference](https://likerts.com/docs/api)

## Registry metadata and release verification

`server.json` prepares registry listing `0.1.1`, adding the published npm package `@likerts/mcp@0.1.0` alongside the remote endpoint. The listing version and npm package version are independent. The existing registry `0.1.0` record and npm tarball stay immutable; the new listing is not live until its publication workflow succeeds.

From a source checkout with Docker, Rust stable and Node 22+, run:

```sh
npm ci --prefix tools/mcp
node scripts/check-mcp-registry.mjs
bash -c 'source scripts/dev-env.sh; node scripts/check-mcp-lifecycle.mjs'
```

The registry check validates the official pinned schema, exact npm package identity and version, and published `mcpName`. The lifecycle check installs the public npm artifact in a temporary consumer, starts the real Rust API on loopback with disposable PostgreSQL and a restricted runtime role, discovers every tool, and uses a scoped service credential to create/publish a survey, create a collection, submit/retry/read/delete a response and close collection access. It also proves insufficient-scope denial and credential revocation. It deletes its temporary workspace/files. This does not test a specific Codex/Claude UI, backup/restore behavior or the hosted service.

Maintainers publish metadata from an exact `main` commit only after both required jobs in its **Verify foundations** push run succeed:

```sh
gh workflow run publish-mcp.yml --ref main \
  -f source_sha=FULL_TESTED_MAIN_COMMIT \
  -f registry_version=0.1.1
```

The workflow requires that SHA to match its dispatch commit, rejects an existing registry version, repeats schema/npm/lifecycle checks, checks remote health/authentication denial, publishes through GitHub OIDC, and verifies the resulting record. It does not publish npm or rebuild the historical community release. If publication succeeds but final verification fails, inspect that exact registry version before retrying; existing records are never overwritten.

For an opt-in check through installed, already authenticated Codex and Claude Code CLIs, add `--clients` to the lifecycle command. This makes one bounded model request per client using only `surveys_list` and a temporary `surveys:read` credential for an empty local workspace. It does not purchase access, alter global client configuration, or run in ordinary CI. Each client has a three-minute timeout; unavailable authentication or approval is reported separately from the account-free protocol test. The optional run exits nonzero unless both clients return a verified empty tool result. Client output is summarized without publishing raw logs or credentials.

A local client attempt on 13 September 2026 verified configuration parsing in Codex CLI 0.154.0 and Claude Code 2.1.201. The bounded model probes did not establish an end-to-end client result: Codex returned without a verified `surveys_list` tool completion, and Claude Code required authentication. The account-free installed-package/PostgreSQL lifecycle passed. Do not describe those client model probes as passed until repeated with working client access.
