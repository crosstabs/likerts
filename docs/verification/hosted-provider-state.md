# Hosted provider state

This is a read-only provider audit from 20 September 2026. It records the
current state without enabling schedules, changing plans, exhausting quotas,
contacting an alert receiver, or running a recovery drill.

## Lifecycle jobs

The existing Vercel projects are deployed and have their required production
secret names:

| Project | Production deployment | Configuration present | Cron definition | Provider state |
| --- | --- | --- | --- | --- |
| `likerts-cleanup` | `dpl_2cpWz7xmwNDupeFjh7K8v2kSD2Sx` | `CRON_SECRET`, cleanup database URL, Blob token and export prefix | `/api/run` at `7,22,37,52 * * * *` | Disabled |
| `likerts-erasure-archive` | `dpl_EJ8iyzCdRJPnxMg9ghNh7VLFvRr9` | `CRON_SECRET`, restricted archive database URL, Blob token, namespace and source ID | `/api/run` at `11,26,41,56 * * * *` | Disabled |

The definitions remain visible in each project and count as configured cron
jobs, but Vercel reports a later `disabledAt` timestamp for both projects. No
invocation was made during this audit. Their presence therefore proves packaged
jobs and configuration, not scheduled retention, physical object deletion, or
independent journal replication.

## Neon

Vercel reports the `likerts-postgres-neon` integration resource as available.
The production connection host is in AWS `ap-southeast-1` and the stored owner
connection requires TLS. Opening the provider dashboard reached Neon's account
linking flow, which requires email verification before the console can be used.
The selected billing plan, point-in-time recovery window, backup freshness and
restore controls could not be inspected. No branch, restore, database mutation
or email resend was initiated.

## Upstash admission store

Vercel reports the `likerts-production-admission` integration resource as
available. The provider dashboard identifies the actual database as **Free
Tier**, AWS **N. Virginia (`us-east-1`)**, with the global REST endpoint enabled.
This is cross-region from the Render Singapore API.

Five authenticated `PING` requests through the provider-managed REST credential
from the Singapore operator host measured 249.9–283.2 ms, with a 251.6 ms
median. `DBSIZE` reported three keys, and `INFO` reported 12,240 processed
commands and a 64 MiB `maxmemory` value. These were bounded read-only probes;
they do not establish Render-to-Upstash latency, sustained throughput, fairness,
or exhaustion behavior. Upstash's current public free-plan page advertises 500K
commands per month, 256 MB and 10 GB monthly bandwidth, but the live instance's
reported 64 MiB limit is the operational value that needs provider confirmation.
[Current Upstash pricing](https://upstash.com/pricing/redis)

H05 remains open until the Render path is measured against an approved workload
boundary, the actual account quota/limit behavior is confirmed, and exhaustion
plus alert delivery are tested without unapproved load or spend.
