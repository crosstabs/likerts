# Real agent-client verification

Verified locally on 13 September 2026 with public `@likerts/mcp@0.1.0`, a disposable Rust API/PostgreSQL instance and restricted runtime database role. Client credentials had only `surveys:read` for a separate empty workspace. No hosted production data or credentials were used.

| Client | Account preflight | Real MCP outcome |
| --- | --- | --- |
| Codex CLI 0.154.0, `gpt-6-astra`, low reasoning | Existing ChatGPT login confirmed | Passed: initialization, 33-tool discovery, one `surveys_list` call and one exact empty result; exit 0 in 15.649 seconds. |
| Claude Code 2.1.201 | Logged out, `authMethod: none` | Not run again. A human must authenticate before the remaining real-client check. Earlier configuration parsing passed. |

The Codex proof comes from a transparent stdio relay between the actual client and installed npm MCP process. It records fixed counters only: one initialization request/result, one discovery request with 33 tools, one survey-list request, one empty-list result and zero tool errors. It never retains JSON-RPC bodies, tokens, arbitrary tool output or raw client logs. A separate official MCP SDK preflight verifies the relay before the model call.

The earlier Codex attempt did not prove a platform failure. The test harness used `execFile` without closing stdin; Codex reads piped stdin before beginning, even when a prompt is supplied as an argument. It waited before starting MCP. A second harness issue treated a graceful zero exit after timeout SIGTERM as ordinary completion. The corrected runner supplies immediate stdin EOF, tracks its own timeout independently of exit code and terminates its isolated child process group. Both regressions have focused tests in `scripts/bounded-client-command.test.mjs`.

Run the account-free protocol and scoped lifecycle check from the repository root:

```sh
npm ci --prefix tools/mcp
bash -c 'source scripts/dev-env.sh; node scripts/check-mcp-lifecycle.mjs'
```

This checks all 33 tool names, scoped survey authoring/publication, collection submission and identical retry, response/metadata retrieval, 403 for a read-only credential attempting a write, collection closure, response deletion and credential revocation.

The opt-in real-client mode is separate:

```sh
bash -c 'source scripts/dev-env.sh; node scripts/check-mcp-lifecycle.mjs --clients'
```

It preflights account state, skips model calls for unauthenticated clients, uses temporary configuration and makes one request per authenticated client with a three-minute bound. It exits nonzero while any selected real-client result is unverified. Use `--clients=claude` to finish the remaining Claude check without repeating the passed Codex model request. It never changes the user's global client configuration, buys access, performs login or bypasses account approval. The normal CI/publishing workflow does not use this mode.

The remaining owner action for Claude's subscription account is:

```sh
claude auth login --claudeai
claude auth status --json
```

The installed CLI confirms `--claudeai` uses the subscription login; `--console` is a separate API-billing path and is unnecessary for this check. Complete account authentication personally, then rerun the bounded probe. Do not put credentials in a chat message. Account status output may contain identity details and should not be copied into public evidence.
