# Distributed API admission

The API admits requests before authentication through three fixed Redis keys shared by every API replica. The `management` budget includes management API, MCP/CLI HTTP calls, collection endpoints, and their collection preflights. Browser session/bootstrap/billing routes have a separate `browser` budget. The Stripe receiver has its own `stripe` budget so a management flood cannot consume its allowance. Existing per-collection rate limits and response accounting still apply after admission.

The implementation uses an atomic Lua script through the [Upstash REST command API](https://upstash.com/docs/redis/features/restapi). Each first request starts a one-second Redis TTL window; denied requests neither increment the counter nor extend expiry. Only `likerts:admission:v1:<namespace>:management`, `:browser`, and `:stripe` exist for admission, regardless of token, tenant, path IDs, or forwarded headers. It makes no client-IP or tenant-fairness claim. A fixed window can allow twice its configured limit around a window boundary.

## API configuration

| Variable | Required/default | Meaning |
| --- | --- | --- |
| `LIKERTS_ADMISSION_MODE` | `required` | Production cannot use the development bypass. |
| `LIKERTS_ADMISSION_REST_URL` | Required | Exact HTTPS Redis REST origin, no path, query, user info, or nonstandard port. |
| `LIKERTS_ADMISSION_REST_TOKEN` | Required secret | Redis credential; only the API receives it. |
| `LIKERTS_ADMISSION_NAMESPACE` | Required | Same stable deployment namespace on all replicas; 1–64 letters, digits, `_`, or `-`. Use a different namespace for isolated staging. |
| `LIKERTS_ADMISSION_MANAGEMENT_RPS` | `30` | Global management plus collection requests per one-second window. |
| `LIKERTS_ADMISSION_BROWSER_RPS` | `10` | Global browser requests per one-second window. |
| `LIKERTS_ADMISSION_STRIPE_RPS` | `10` | Global Stripe receiver requests per one-second window. |
| `LIKERTS_ADMISSION_TIMEOUT_MS` | `750` | Whole REST exchange timeout; configurable from 50 to 2000 ms. |

Each rate accepts integers from 1 to 1000. Keep rates and namespace identical across replicas. Roll out rate changes together: mixed settings have mixed admission semantics. Never put this token in browser, SDK, MCP, worker, or migration environments. Render startup rejects admission bypass on the API and rejects this token on the worker, MCP, and migration processes.

Before any Redis request, each API process applies a local rate window of the same configured size and a concurrency ceiling (32 management, 8 browser, 8 Stripe). The permit remains held through the application handler. This bounds fast Redis denials as well as slow calls; it is a cost and application-work boundary, not edge DDoS protection. Each incoming REST `EVAL` executes Redis commands inside the script; determine provider billing from measured usage rather than assuming one request equals one billed command. Scaling replicas raises the ceiling on attempted Redis calls, while the shared allowance remains fixed.

## Failure behavior and observability

- Local/shared saturation returns `429 rate_limited`. Redis errors, denied credentials, unexpected response shapes, oversized bodies, redirects, and timeouts return `503 admission_unavailable`. Both carry `Retry-After: 1` and `Cache-Control: no-store`. No request reaches authentication or collection/accounting handlers after either denial.
- The REST client does not follow redirects, proxy environment variables, or automatic retries. Responses stream into a bounded 4096-byte buffer. Errors do not expose provider bodies or credentials.
- `/health`, protected-resource metadata, and internal metrics remain available independently of Redis. A healthy process is therefore **not proof of admission availability**. Monitor API `503`/`429` rates by route and probe an authenticated read before enabling traffic after configuration changes.
- Allowed management origins receive normal CORS handling. Collection admission runs before the database lookup that validates the collection's allowed origin; a browser can see a network/CORS error for a denied collection request. Do not reflect an unvalidated origin to make this error readable. A client that retries must use bounded backoff and the original response idempotency key; it must not claim a response was accepted after a transport error. The server remains the authority for acceptance.
- A Redis outage blocks protected traffic intentionally. Stripe's independent budget protects it from management-budget exhaustion, but its own route can still be flooded and Redis failure also returns a retryable failure to Stripe. Provider redelivery and reconciliation remain necessary.

The parent operator inspected the existing production admission database on 2026-09-10: Free plan, primary region `iad1`, no read regions, automatic upgrade disabled, eviction disabled. The APIs are in Singapore. This is a preview constraint, not a capacity claim: measure the actual cross-region admission latency, inspect current provider quota/usage, and establish an alert/response before increasing preview traffic. The default timeout is a starting bound, not measured hosted evidence. Exhausting provider allowance fails closed; the code does not silently bypass protection or purchase an upgrade.

## Local verification

Run `bash scripts/check-admission.sh`. It starts an isolated real Redis container, then two actual API processes with the same namespace and a local REST-to-Redis bridge. It checks the shared allowance, independent browser/Stripe budgets, three-key bound, spoofed forwarded headers, local Redis-call bound, expiry recovery, health exemption, and bounded failure on denied/malformed/oversized/redirected/timed-out provider responses. The bridge is a test fixture, not a production service or proof of hosted Upstash latency.

Rust tests additionally check mandatory production configuration, strict origins/credentials/namespaces, rate and concurrency bounds, and permit lifetime through a blocked handler. Render entrypoint tests check missing admission configuration and forbid runtime bypass or misplaced credentials.

Disposable local API harnesses may explicitly set both development authentication and `LIKERTS_ADMISSION_MODE=disabled`, with **no** Redis URL/token present. Local real-Redis tests use loopback HTTP only with development mode. Neither exception is accepted by the production Render entrypoint. This change requires no database migration.
