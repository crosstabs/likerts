# Hosted admission capacity inspection

Checked 2026-09-13: provider API inspection at 01:50 UTC, followed by the existing Vercel-to-Upstash console session at approximately 02:08 UTC. These are read-only observations of the existing services, not a load test or a capacity guarantee. No plan, region, configuration, deployment, account access, or resource was changed.

| Item | Observed evidence | Interpretation |
| --- | --- | --- |
| Render API | `GET /v1/services/srv-dagbp57qj5pc738fe96g`: Singapore, Docker runtime, plan `1c-2g`, two instances. CLI instance listing returned two live instance IDs. | Admission traffic originates in Singapore. |
| Vercel integration store | `GET /storage/stores/store_n8l8UgcAdw9fAJJG`: available; `usageQuotaExceeded=false`. | The provider did not report an exceeded quota at inspection time. This does not establish remaining allowance. |
| Redis placement | Store metadata: primary `iad1`, no read regions. | API and Redis primary are in different regions. No round-trip timing was obtained from the API host. |
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

## Remaining acceptance evidence

1. **Engineering/provider console:** Monthly usage, limit, storage and region have now been observed. Obtain exact billing-period start/end and sufficiently precise command/bandwidth readings for a controlled workflow delta. Provider service-time charts do not include the Singapore network round trip. [Upstash metric definitions](https://upstash.com/docs/redis/howto/metrics-and-charts)
2. **Engineering:** The bounded source-local `PING` sample and configured timeout comparison are complete. Measure normal authenticated API/admission latency through a controlled synthetic workflow; the `PING` sample does not include the admission script or database/authentication work.
3. **Engineering:** Record the actual billable-command multiplier from that workflow and provider usage delta before forecasting monthly traffic. Verify exhaustion alerts and the operational response. Review the region/plan only after this evidence; this inspection made no changes.

Hosted admission capacity remains unverified until these usage and source-local latency checks complete. Health success and local multi-process limiter tests remain useful evidence of different properties.
