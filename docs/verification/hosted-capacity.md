# Hosted admission capacity inspection

Checked 2026-09-13: provider API inspection at 01:50 UTC, followed by the existing Vercel-to-Upstash console session at approximately 02:08 UTC. These are read-only observations of the existing services, not a load test or a capacity guarantee. No plan, region, configuration, deployment, account access, or resource was changed.

| Item | Observed evidence | Interpretation |
| --- | --- | --- |
| Render API | `GET /v1/services/srv-dagbp57qj5pc738fe96g`: Singapore, Docker runtime, plan `1c-2g`, two instances. CLI instance listing returned two live instance IDs. | Admission traffic originates in Singapore. |
| Vercel integration store | `GET /storage/stores/store_n8l8UgcAdw9fAJJG`: available; `usageQuotaExceeded=false`. | The provider did not report an exceeded quota at inspection time. This does not establish remaining allowance. |
| Redis placement | Store metadata: primary `iad1`, no read regions. | API and Redis primary are in different regions. The later source-local timing sample is recorded below. |
| Redis plan | Store billing plan: Free, 500,000 monthly commands. | A monthly budget, separate from instantaneous throughput limits. |
| Store options | Eviction, automatic upgrade, and Prod Pack all false. | These features are not enabled on the inspected store. |
| Redis data limit | Actual admission Redis `INFO`: `max_data_size=268435456`, `total_data_size=603`, three keys. | 256 MiB configured data ceiling; 603 bytes reported at that moment. No keys or values were read. |
| Redis runtime limits | `INFO`: `max_ops_per_sec=10000`, `maxclients=30000`, `maxmemory_policy=noeviction`. | Provider-reported limits, not achieved application throughput. |
| Monthly billable usage | The authenticated Upstash console displayed `12k / 500k per month`, with a Free Tier label and $0.00 displayed cost. | Current monthly usage is available as a rounded console value. Exact consumption, billing-period boundaries and projected exhaustion remain unverified. |
| Singapore-to-Redis latency | Existing Render web shell, API instance suffix `bjmfd`: one cold HTTPS `PING` took 292.82 ms; ten sequential requests with connection reuse took min 232.36, median 232.61, max 233.06 ms, with zero failures. | A small source-local network sample, not a load test or application p95. SSH key authentication failed, but the existing dashboard shell worked. |
| Admission timeout | The same instance reported configured `LIKERTS_ADMISSION_TIMEOUT_MS=750`. | Median reused-connection `PING` consumed about 31% of that whole-exchange bound. Actual admission scripts and authenticated API work were not timed by this probe. |

The free plan is small relative to sustained admission traffic: 500,000 commands divided over a 30-day illustration is about 0.193 metered commands per second. This arithmetic is not a response allowance. Admission scripts, browser activity, monitoring, and other users of the database share its allowance; determine the billable command multiplier from actual provider usage before forecasting survey capacity. The [admission implementation](../../infrastructure/admission/README.md) explains the local and shared request budgets and fail-closed behavior.

## Access and measurement boundaries

Vercel CLI 52.0.0 and Render CLI 2.22.0 had working provider access. Vercel's published endpoint catalog was inspected before selecting read endpoints. The store response exposes secret names and lengths, not credential values. The marketplace resource GET returned HTTP 403, `Only integrations can query resources`; it is not a user-token fallback for resource usage.

The ignored local environment file had no admission credentials. The existing Render CLI credential was therefore used privately with the documented per-variable GET endpoint to retrieve only `LIKERTS_ADMISSION_REST_URL` and `LIKERTS_ADMISSION_REST_TOKEN`. Those values remained in process memory and were used for exactly two read-only `INFO` requests. No credentials, raw provider response, raw `INFO` response, key names, or key values were saved to this report. [Render environment-variable API](https://api-docs.render.com/reference/retrieve-env-var)

The two `INFO` responses reported `total_commands_processed` values of 1 and 12,052. This field is a server processing counter, not a documented current-month billable total; the samples do not establish billing-period or server affinity. It was deliberately not used to estimate monthly consumption. Upstash lists `INFO` and `PING` among noncharged operational commands. [Redis INFO semantics](https://redis.io/docs/latest/commands/info/) · [Upstash pricing](https://upstash.com/pricing/redis)

No Upstash CLI or developer credentials were available through the inspected local configuration locations. More importantly, Upstash's Developer API documentation says accounts created through Vercel are unsupported. Creating a new developer key is therefore not an assumed fix for this integration's usage visibility. The existing Vercel dashboard's **Open in Upstash** navigation successfully opened the authenticated provider console without creating an account or key. [Upstash Developer API availability](https://upstash.com/docs/devops/developer-api/introduction)

The console confirmed AWS N. Virginia (`us-east-1`), 603 B of 256 MB storage, and the rounded monthly command usage above. Its bandwidth header showed 0 B of 50 GB while the five-day chart included nonzero daily traffic; these displays do not establish exact billing bytes or a common reporting interval. The API's unavailable usage view and Redis processing counter are superseded by the actual console for the limited monthly-usage observation, not for exact billing or response-capacity claims.

For live-instance access, `render ssh` required interactive mode. A PTY invocation targeted one existing API instance with SSH `BatchMode=yes`, a ten-second connection timeout, strict host-key checking, and the harmless command `true`. Render selected `ssh.singapore.render.com`; host verification passed, but authentication failed with `Permission denied (publickey)`. The session was closed. No key was registered, no login was performed, and no ephemeral paid instance was requested. [Render SSH setup and instance targeting](https://render.com/docs/ssh)

The existing authenticated Render dashboard subsequently exposed its web shell for one already-running API instance. A Node HTTPS probe used the instance's existing admission URL/token without printing either value. It issued eleven sequential `PING` requests, each with a five-second deadline: one initial connection and ten requests using a keep-alive agent. Only count, failure count and timing aggregates were printed. This supplies the previously missing Singapore-to-Redis sample without adding SSH access, a test instance or a load generator. The configured timeout was read separately as a numeric value. The measurements were completed by 02:14 UTC on 13 September 2026; one short sample cannot establish regional tail latency or throughput.

## Authenticated API sample and command execution — runtime 0.1.2

The controlled export-revocation regression at exact deployed source `2996ebcbb9821cff67e0a6e8cae4722f0abf9e42` supplied the following twelve client-observed request timings. This reuses the completed, erased fixture; no new production request was issued for this analysis. [Lifecycle and cleanup evidence](managed-maintenance.md#runtime-012-rollout-and-regression).

| Operation | HTTP status | Client elapsed time, ms |
| --- | --- | --- |
| Credential preflight | 200 | 573.1 |
| Create survey | 201 | 607.1 |
| Publish | 200 | 513.1 |
| Create collection | 201 | 488.8 |
| Submit response | 200 | 532.6 |
| Create export | 202 | 481.8 |
| Export poll, first | 200 | 459.3 |
| Export poll, second | 200 | 511.8 |
| First revoke | 204 | 1645.3 |
| Revoked download | 410 | 493.8 |
| Identical revoke | 204 | 575.6 |
| Revoked credential | 401 | 464.0 |

This small mixed-operation sample has minimum **459.3 ms**, median **512.45 ms** and maximum **1645.3 ms**. It is not a p95, throughput or load test. Client wall time includes client-to-Render transport, admission, authentication/database work and applicable Blob operations; it does not isolate Redis script service time or attribute the longest request to a particular dependency.

Current [admission source](../../backend/src/admission.rs) performs one REST `EVAL` after local rate/concurrency admission and before authentication, with HTTP retries disabled. Consequently, source analysis implies twelve wire `EVAL` requests for these twelve requests that reached their handlers; these were not independently captured in a provider billing trace. Identical retries and 401/410 application denials still pass through admission. Export polling adds one `EVAL` per poll. Local admission denial emits none; shared saturation emits one.

The exact source Lua script was separately executed against isolated Redis 7; all three branches passed their execution-count assertions:

| Lua branch | Wire command | Nested commands executed | Modeled command cost |
| --- | --- | --- | --- |
| New window, allowed | `EVAL` × 1 | `GET` + `SET`: 2 | 3 |
| Existing window, allowed | `EVAL` × 1 | `GET` + `PTTL` + `INCR`: 3 | 4 |
| Shared saturation, denied | `EVAL` × 1 | `GET` + `PTTL`: 2 | 3 |

Upstash's regional rate-limit cost documentation counts both `EVAL` and nested commands: its fixed-window examples cost three commands on the first request and two on intermediate requests; its denied token-bucket example counts `EVAL` plus `HMGET`. Applying that documented model to Likerts' custom Lua gives the costs above and zero for local admission denial. The inspected store has no read regions, and this script emits no analytics command. [Official command-cost model](https://upstash.com/docs/redis/sdks/ratelimit-ts/costs).

The twelve admitted fixture requests therefore model **36–48 commands**, including twelve wire `EVAL`s and 24–36 nested executions. This is source-based application of the provider's documented model, not a measured monthly billing delta or response allowance. Direct SQL fixture work, asynchronous export generation and exact-key Blob cleanup add no application Redis calls; unrelated traffic may still use the shared service.

At **05:36 UTC**, the refreshed authenticated Upstash console's Past 3 hours Top Commands table showed the following change. Its displayed timestamps did not label a timezone; the browser used Asia/Singapore, so they are not asserted as UTC.

| Command | Displayed 11:22 | Displayed 12:28 | Difference |
| --- | --- | --- | --- |
| `EVAL` | 26 | 38 | 12 |
| `GET` | 26 | 38 | 12 |
| `INCR` | 14 | 19 | 5 |
| `PTTL` | 14 | 19 | 5 |
| `SET` | 12 | 19 | 7 |
| Sum | 92 | 133 | **41** |

The difference is consistent with seven new-window and five existing-window calls: `7 × 3 + 5 × 4 = 41`. It does not uniquely identify the fixture workload or exclude other traffic. The Sunday display also rose from 92 to 133. At displayed 13:28 all five series became zero, so this is not a monotonic monthly billing counter. Monthly usage remained rounded `12k / 500k`; Vercel Current Period and Period Total were absent.

An exact billed-period delta remains unmeasured. Redis processing counters and the observed series cannot substitute for it. Separate background/dashboard traffic when measuring: Upstash documents console-generated `SCAN`, `GET`, `TTL` and `EXISTS` commands. [Official console command-count explanation](https://upstash.com/docs/redis/troubleshooting/command_count_increases_unexpectedly). No provider mutation or load test was performed for this inspection.

## Remaining acceptance evidence

1. **Engineering/provider console:** Monthly usage, limit, storage and region have now been observed. Obtain exact billing-period start/end and sufficiently precise command/bandwidth readings for a controlled workflow delta. Provider service-time charts do not include the Singapore network round trip. [Upstash metric definitions](https://upstash.com/docs/redis/howto/metrics-and-charts)
2. **Engineering:** The bounded source-local `PING` sample, timeout comparison and twelve-request authenticated API workflow timings are complete. Keep their distinct measurement boundaries; isolated admission service time and representative operational tail latency remain unmeasured.
3. **Engineering/provider:** The documented command-cost model is now established and applied above. Obtain exact billed-counter readings tied to a billing period, reporting delay and an approved fresh bounded workload, accounting for background/dashboard traffic, and compare the observed delta with the model. Usage/Top Commands is suitable only if precise, complete and tied to the billed meter. The erased fixture must not be rerun; any future measurement needs a fresh disposable fixture. Then record the billable multiplier before forecasting traffic, verify exhaustion alerts and decide the operational region/plan. This analysis made no provider changes.

Hosted admission capacity remains unverified until billing, exhaustion alerting and an operational capacity decision are supported. The bounded network and API timing evidence above is complete for its stated scope. Health success and local multi-process limiter tests remain useful evidence of different properties.
