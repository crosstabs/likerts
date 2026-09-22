# Hosted provider state

This is a provider audit from 20 September 2026. It records the current state
and bounded read-only runtime probes without enabling schedules, changing
plans, exhausting quotas, contacting an alert receiver, or running a recovery
drill.

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
or exhaustion behavior.

Upstash's current public free-plan page defines the account limits as 500K
commands per month, 256 MB of data and 10 GB of monthly bandwidth. Its official
FAQ explains that Redis data is kept across memory and block storage and that
idle entries can leave memory while remaining on disk. The observed 64 MiB
`maxmemory` field therefore cannot be treated as the account's maximum data
size; 256 MB is the documented provider quota. The provider does not document
how that internal field maps to its memory tier. The pricing page also says
operational commands such as `PING` and `INFO` are not billed.
[Current Upstash pricing](https://upstash.com/pricing/redis)
[Upstash FAQ](https://upstash.com/docs/redis/help/faq)

### Render Singapore path

The production API service `srv-dagbp57qj5pc738fe96g` is configured in Render's
Singapore region. A one-off job inherited that service's admission URL and token,
required an HTTPS `*.upstash.io` origin, then made five sequential authenticated
`PING` requests. Each request had a 50 ms connection and total timeout, required
HTTP 200 and required the exact `PONG` response. Job
`job-danm106gekts739dh92g` succeeded on 20 September from 04:26:40–04:26:50 UTC.

This establishes five successful REST round trips below 50 ms from a production
service container. It does not establish database-command latency for the Lua
admission workflow, sustained throughput, tail latency, fairness, or provider
exhaustion behavior. The probe issued five read-only commands and did not alter
the service, plan or quota configuration.

H05 remains open until exhaustion plus alert delivery are tested against an
approved workload boundary without unapproved load or spend.

## Browser identity path

Fresh production-browser testing found that the API still trusted the old Clerk
development issuer/JWKS and that the management-origin allowlist named an old
Vercel preview. The live API configuration now trusts the exact production
issuer and JWKS at `clerk.likerts.com` and accepts only `https://likerts.com` as
its browser management origin. A dedicated Clerk template supplies the exact
Render API audience; the web control plane requests that template instead of a
default session token.

Render deployment `dep-danmd53tqb8s73cd74d0` retained reviewed source
`ec8a581c2c7b9c739bc94a14633741bd5af8a9e4`. Vercel production deployment
`dpl_8gMT5pEp32DnF9hLZQD1nntV9vrK` serves the matching browser change from main
source `1e2b9c5d929042521102dd7ee9da3c9b60a80184`. The resulting two-account
lifecycle and cleanup are recorded in
[hosted onboarding and tenant-isolation verification](hosted-onboarding-isolation.md).

## Neon access and history window — 22 September 2026

A fresh authenticated Console visit at approximately 12:17 UTC opened
`likerts-postgres-neon` in the existing Vercel-managed organization. The earlier
login/email-verification blocker has cleared. The project overview showed Launch,
AWS Singapore, PostgreSQL 18, one branch (`main`), and a **one-day history window**.
The Backup & Restore page exposed restore controls and an earliest recoverable
time approximately 24 hours earlier; it showed **no snapshots and no snapshot
schedule**. These are configuration/read-access observations, not a successful
restore or a promised recovery point.

The create-branch form offers schema-only roots and historical branching. It was
inspected and cancelled without provisioning. No production restore, settings
change, fence, snapshot or new compute was started. The existing compute range
was 1–9 CU; it must not be inherited for an unbounded drill.

The next step is the [bounded recovery drill](../operations/NEON-RECOVERY-DRILL.md),
with explicit incremental-spend authorization because Launch compute is metered.
Provider login is no longer the next action. An isolated restore/replay result,
independent archive protection and the remaining operational gates are still
required for H03.
