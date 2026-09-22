# Launch checkpoint — 22 September 2026

The MIT software, website, npm packages, MCP registry entry, Swift release, Flutter package and Android Maven coordinate
are public. The managed service remains a bounded preview for synthetic,
non-sensitive evaluation. Unrestricted hosted production is not yet verified.

## Work completed in this continuation

- PR #41 passed both required checks and merged at
  `0e24bf510581af22f0a884e7998c7ac1e9d80331`.
- Cleanup and archive bundles were built from that clean source, executed in
  the compatible Linux runtime and deployed. Cron execution remained disabled.
- Production monitoring has its 12 sensitive, production-only configuration
  values. Its authenticated endpoint correctly returns `not_armed`; admission
  and callback probes return `reachable` from the operator host.
- An isolated preview reproduced the remaining maintenance status bug:
  Vercel preserves `/api/status` and appends the rewrite selector. PR #42 passed both required CI jobs, merged as `351824d`, and fixes
  that exact request shape. Both rebuilt production status routes passed HTTP 200;
  missing/wrong credentials and extra queries were denied. The monitor correctly
  reports their current backlog. The regression first failed, then all 19 handler
  tests and observability checks passed. The diagnostic deployment was removed.
- Android `com.likerts:likerts-android:0.0.3` is published on Maven Central. The
  approved signed bundle passed both Central component validations; deployment
  `20c72da8-64ac-4ee1-9396-9d0ad6d2d8f5` reports PUBLISHED. Five public artifact
  hashes and signatures matched the release. A consumer with an empty dependency
  cache compiled the Compose host and passed both SDK tests, completing A06.
  Direct browser upload required no new publisher token.
- Flutter `likerts 0.0.3` is published on pub.dev. A fresh application with an
  empty package cache resolved the hosted dependency, passed analysis and the
  widget trigger/dismissal test. All library files and the registry archive hash
  match the tested release. Public installation instructions now use pub.dev.

- Neon Console access is now verified: Launch/Singapore, PostgreSQL 18, one-day
  history, no snapshots or snapshot schedule. No restore was started.
- The monitor backing store passed seven isolated persistence/lease/heartbeat
  checks; all test keys were removed. This does not establish alert delivery.
- Main `9f0a028` passed both required jobs in run `35725519052`; its production
  website serves the verified Flutter install instructions.
- The optional [independent heartbeat watcher](../../infrastructure/observability/README.md)
  now has executable Prometheus/Blackbox configuration, five alert-rule scenarios
  and 19 local TLS/HTTP probes. Failure, missing metrics and recovery passed;
  the watcher is not deployed and no notification was sent.
- [PR #45](https://github.com/crosstabs/likerts/pull/45) passed both required jobs in
  [run 35729518230](https://github.com/crosstabs/likerts/actions/runs/35729518230)
  and merged as `c1320b3`. Its Vercel production deployment
  `dpl_4cE7p1edXErePkkVZKk4vLrX3imG` is READY. Home, downloads, docs and `llms.txt`
  returned HTTP 200; the unauthenticated heartbeat returned HTTP 401.

23 September policy clarification: the existing database default is 90 days and the worker reads each workspace’s stored retention setting. No new global duration is needed to activate that worker.

The signup form loads, but the live Clerk configuration is invitation-only.
Existing-account sign-in cannot prove fresh public registration.

## Remaining actions and acceptance evidence

| Item | Next action | Completion evidence |
| --- | --- | --- |
| H01 public signup | Clerk is currently invitation-only (`sign_up.mode = restricted`). Resolve the registration policy with the preview gates, then perform a real email-code signup at `https://likerts.com/app`. | Successful self-service authentication and workspace opening without synthetic sign-in tickets. |
| H02 scheduled cleanup | Operational setup is approved. The worker uses each workspace’s stored 1–90-day policy (90-day database default). Establish alert ownership, then enable and observe the proposed schedule. | Real scheduled executions, physical cleanup, retry/failure handling and delivered alerts. |
| H03 archive operations | Neon access and its one-day history window are verified. The owner declined the [isolated recovery drill](../operations/NEON-RECOVERY-DRILL.md) on 22 September; remove it from the execution queue. Configure archive scheduling/protection after the operations details are supplied. | Independent archive protection, checkpoint continuity and scheduled operation. Hosted restore/replay is waived and remains unverified. |
| H04 alerting | Name primary/backup humans and an approved receiver. Deploy the prepared independent watcher on an approved host with a dead-man check, then arm and schedule the monitor. | Delivered failure and recovery notifications, receiver/missed-run detection and human acknowledgment. |
| H05 capacity | Agree the workload/cost boundary after H04. | Bounded provider-exhaustion/fairness checks with alert evidence; no unapproved production load or plan change. |
| A01 Show HN | Founder writes and submits their own text and remains available for replies. | Actual submission URL. AI-written or AI-edited submission text is not permitted by HN's recorded rules. |
| A02 community launch | Choose the posting accounts/destinations and approve the specific introductions. | Real publication URLs and recorded replies. |
| Claude client | Complete `claude auth login --claudeai`, then run the bounded Claude-only MCP rehearsal. | Actual returned survey-list tool result. |
| A08 adoption | Real outside developers install or contribute after authorized outreach. | Consented reports and actual outside contributions. Download counts alone do not establish installations. |

Read-only database status at the first probe showed 40 due retention workspaces,
one pending export-cleanup object, and 10 pending erasure-archive events.
These aggregate observations are not customer or adoption counts. Scheduled
work remained disabled; no retention policy, alert recipient or human
acknowledgment was invented.

Android publication and fresh public-registry installation are complete. Monitoring activation still
requires the actual responder names and alert destination. The existing database default is 90 days; workspace overrides remain authoritative.

Account login, authorship, support commitments and real external adoption cannot
be replaced by prepared files or simulated evidence. See the
[master checklist](../../PUBLIC-LAUNCH.md),
[monitor evidence](hosted-callback-liveness.md), and
[native distribution evidence](native-distribution.md).
