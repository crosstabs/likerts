# Community support

For setup and integration questions, use [GitHub Discussions](https://github.com/crosstabs/likerts/discussions). For reproducible defects, open an [issue](https://github.com/crosstabs/likerts/issues/new/choose). Read [SECURITY.md](../../SECURITY.md) for private vulnerability reporting; never put suspected vulnerabilities, response data or credentials in public issues.

Likerts is community-supported software. There is no promised response time or support SLA. The launch support owner and availability are **pending founder assignment**; see the [human handoff](HUMAN-HANDOFF.md). This guide does not establish a managed-hosting commitment.

## Before reporting

Record your component version or commit, deployment mode (local memory, self-hosted PostgreSQL or optional hosted service), OS/runtime and SDK. Include the operation, safe HTTP status/error code, expected behavior, actual behavior and a minimal reproduction with synthetic data. Include timestamps and a request ID if one is available. Remove bearer tokens, cookies, collection credentials, customer metadata and response bodies containing personal data. A collection credential is still a credential.

## Common integration problems

| Symptom | Check and next step |
| --- | --- |
| Management call returns `401` or `403` | Confirm the API origin and credential expiry/revocation. Use a service credential with the operation's required scope from the [capability reference](../../contracts/CAPABILITIES.md). Management calls use `LIKERTS_TOKEN`; collection calls use the separate `LIKERTS_COLLECTION_TOKEN`. A remote MCP workspace path must match the service credential's workspace. Never fix an authorization failure by exposing a management token to the client. |
| MCP lists a tool but invocation is denied | Discovery exposes the shared registry; it does not prove authorization. Review the selected scopes. `identity:write` is separate from survey-authoring access. See [tool authentication and rotation](../../tools/README.md). |
| Browser shows a CORS/network error | Confirm the collection's exact allowed origin, including scheme and port, through `collections_security_update`; do not add a wildcard. Check the collection preflight in browser developer tools. Collection requests allow GET/POST with Authorization and Content-Type; a same-origin proxy is another documented option. An error can hide its response from the browser, so also inspect sanitized server logs. Management and collection origin configuration are distinct. |
| Publish/create rejects SDK capabilities | Declare the capability record for every deployed SDK installation group, including older clients. Each group must support the survey's actual schema version. Upgrade incompatible clients or use a compatible survey; do not falsely declare newer capabilities. Published versions are immutable. See [schema contract](../../contracts/README.md). |
| Submission validation fails | Fetch the collection's published schema, use option IDs rather than display labels, and check required fields, bounds and answer shapes against that version. Reproduce with synthetic answers. Backend validation is authoritative even when a custom UI accepts the input. |
| Ambiguous timeout or retry conflict | For a retry of the same operation, preserve the complete original payload and idempotency key. A changed payload or stale revision can produce `409 conflict`; do not generate a new key merely to suppress the error. For a genuinely new operation, use a new key. The CLI does not automatically retry writes. |
| `429 rate_limited` | Respect `Retry-After` when available and use bounded host-controlled backoff. Collection rate limiting currently returns 60 seconds. Do not tight-loop or disable infrastructure safety controls; free software does not mean infinite server capacity. |
| Collection is closed, expired or revoked; receipt is expired | Inspect the error code, not just `409`/`410`. Stop blind retries and reconcile the collection/response state with the operator. Do not silently create a replacement response after `receipt_expired`. |
| Offline responses remain queued | Queues flush when the host asks; they are not background delivery services. Inspect the flush report: missing credentials, blocked records, local expiry and quarantine require different action. Preserve the original submission for a legitimate retry. See the [SDK guides](../../sdks/README.md). |
| Local demo data disappeared | The [embedded example](../../examples/embedded-feedback/README.md) uses temporary memory storage. Browser reloads can retrieve data while the API runs; stopping it clears data. Durable operation requires PostgreSQL. |

These notes were checked against the current [HTTP error/CORS implementation](../../backend/src/main.rs), [SDK capability validation](../../backend/src/lib.rs), [Web offline queue](../../sdks/web/src/offline.ts) and linked guides on 2026-09-13. They describe diagnosis, not a claim that every deployment has been tested.

## Versions and fix propagation

The current distribution is `community-v0.1.0`, with Web and React Native `0.0.3`, MCP `0.1.0` and CLI `0.1.2`. Native SDKs are distributed through source; use the community tag or record the exact commit. See [release installation and compatibility](../releases.md) rather than assuming equal version numbers mean identical historical archives.

As [SECURITY.md](../../SECURITY.md) states, fixes target the latest published version; before a stable release they land on the default branch and may break compatibility. Historical snapshots are immutable and are not silently patched. There is no promised backport window or automatic updater.

Maintainers reproduce the defect, add the relevant regression check, review it and require CI before merge. They then publish new versions of affected packages/artifacts, update release notes with affected/fixed versions and migration steps, and verify fresh installations. A fix merged to source is not yet a fix in npm, an old container or an operator's deployment. Track publication and deployment separately in the linked issue/advisory; keep security coordination private until disclosure is appropriate.

Operators choose and test the update, apply any migration and verify their integration. Native SDK source consumers update their pinned revision and rebuild. The [maintainer process](MAINTAINERS.md) governs reviews and release communication.
