# Hosted admission capacity inspection

Checked 2026-09-13, with the final provider read at 01:50 UTC. These are read-only observations of the existing services, not a load test or a capacity guarantee. No plan, region, configuration, deployment, account access, or resource was changed.

| Item | Observed evidence | Interpretation |
| --- | --- | --- |
| Render API | `GET /v1/services/srv-dagbp57qj5pc738fe96g`: Singapore, Docker runtime, plan `1c-2g`, two instances. CLI instance listing returned two live instance IDs. | Admission traffic originates in Singapore. |
| Vercel integration store | `GET /storage/stores/store_n8l8UgcAdw9fAJJG`: available; `usageQuotaExceeded=false`. | The provider did not report an exceeded quota at inspection time. This does not establish remaining allowance. |
| Redis placement | Store metadata: primary `iad1`, no read regions. | API and Redis primary are in different regions. No round-trip timing was obtained from the API host. |
| Redis plan | Store billing plan: Free, 500,000 monthly commands. | A monthly budget, separate from instantaneous throughput limits. |
| Store options | Eviction, automatic upgrade, and Prod Pack all false. | These features are not enabled on the inspected store. |
| Redis data limit | Actual admission Redis `INFO`: `max_data_size=268435456`, `total_data_size=603`, three keys. | 256 MiB configured data ceiling; 603 bytes reported at that moment. No keys or values were read. |
| Redis runtime limits | `INFO`: `max_ops_per_sec=10000`, `maxclients=30000`, `maxmemory_policy=noeviction`. | Provider-reported limits, not achieved application throughput. |
| Monthly billable usage | Not exposed by the successful store or `INFO` reads. | Remaining monthly commands and projected exhaustion date are unverified. |
| Singapore-to-Redis latency | Existing live-instance SSH failed with `Permission denied (publickey)`. | No in-instance measurement completed. No laptop timing is presented as hosted latency. |

The free plan is small relative to sustained admission traffic: 500,000 commands divided over a 30-day illustration is about 0.193 metered commands per second. This arithmetic is not a response allowance. Admission scripts, browser activity, monitoring, and other users of the database share its allowance; determine the billable command multiplier from actual provider usage before forecasting survey capacity. The [admission implementation](../../infrastructure/admission/README.md) explains the local and shared request budgets and fail-closed behavior.

## Access and measurement boundaries

Vercel CLI 52.0.0 and Render CLI 2.22.0 had working provider access. Vercel's published endpoint catalog was inspected before selecting read endpoints. The store response exposes secret names and lengths, not credential values. The marketplace resource GET returned HTTP 403, `Only integrations can query resources`; it is not a user-token fallback for resource usage.

The ignored local environment file had no admission credentials. The existing Render CLI credential was therefore used privately with the documented per-variable GET endpoint to retrieve only `LIKERTS_ADMISSION_REST_URL` and `LIKERTS_ADMISSION_REST_TOKEN`. Those values remained in process memory and were used for exactly two read-only `INFO` requests. No credentials, raw provider response, raw `INFO` response, key names, or key values were saved to this report. [Render environment-variable API](https://api-docs.render.com/reference/retrieve-env-var)

The two `INFO` responses reported `total_commands_processed` values of 1 and 12,052. This field is a server processing counter, not a documented current-month billable total; the samples do not establish billing-period or server affinity. It was deliberately not used to estimate monthly consumption. Upstash lists `INFO` and `PING` among noncharged operational commands. [Redis INFO semantics](https://redis.io/docs/latest/commands/info/) · [Upstash pricing](https://upstash.com/pricing/redis)

No Upstash CLI or developer credentials were available through the inspected local configuration locations. More importantly, Upstash's Developer API documentation says accounts created through Vercel are unsupported. Creating a new developer key is therefore not an assumed fix for this integration's usage visibility. Use the existing integration's provider console to obtain its billing-period usage. [Upstash Developer API availability](https://upstash.com/docs/devops/developer-api/introduction)

For live-instance access, `render ssh` required interactive mode. A PTY invocation targeted one existing API instance with SSH `BatchMode=yes`, a ten-second connection timeout, strict host-key checking, and the harmless command `true`. Render selected `ssh.singapore.render.com`; host verification passed, but authentication failed with `Permission denied (publickey)`. The session was closed. No key was registered, no login was performed, and no ephemeral paid instance was requested. [Render SSH setup and instance targeting](https://render.com/docs/ssh)

## Remaining acceptance evidence

1. **Owner/provider console:** Open this existing Redis resource through Vercel's integration dashboard and record the billing-period start/end, consumed monthly commands, limit, data/bandwidth usage, and timestamp. Provider service-time charts do not include the Singapore network round trip. [Upstash metric definitions](https://upstash.com/docs/redis/howto/metrics-and-charts)
2. **Owner/engineering:** Restore authorized SSH access to an existing API instance, or use its existing dashboard shell. Run a bounded sequential `PING` timing sample from that instance using its current Redis environment values; retain only count, failures, and timing aggregates. Include a cold connection and reused-connection samples, with a per-request timeout. This needs no deployment, new instance, key reads, or key writes.
3. **Engineering:** Compare the measured round trip with the configured admission timeout and normal authenticated API latency. Record the actual billable-command multiplier from a controlled workflow and provider usage delta before forecasting monthly traffic. Review the region/plan only after this evidence; this inspection made no changes.

Hosted admission capacity remains unverified until these usage and source-local latency checks complete. Health success and local multi-process limiter tests remain useful evidence of different properties.
