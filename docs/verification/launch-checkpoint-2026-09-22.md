# Launch checkpoint — 22 September 2026

The MIT software, website, npm packages, MCP registry entry, Swift release and Flutter package
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
- Android's approved signing identity, encrypted key, public-key distribution,
  signed five-artifact bundle and independent signature/checksum checks are ready.
  Central remains signed in with verified `com.likerts` ownership. Direct browser
  upload avoids creating another publisher credential.
- Flutter `likerts 0.0.3` is published on pub.dev. A fresh application with an
  empty package cache resolved the hosted dependency, passed analysis and the
  widget trigger/dismissal test. All library files and the registry archive hash
  match the tested release. Public installation instructions now use pub.dev.

The signup form loads, but the live Clerk configuration is invitation-only.
Existing-account sign-in cannot prove fresh public registration.

## Remaining actions and acceptance evidence

| Item | Next action | Completion evidence |
| --- | --- | --- |
| H01 public signup | Clerk is currently invitation-only (`sign_up.mode = restricted`). Resolve the registration policy with the preview gates, then perform a real email-code signup at `https://likerts.com/app`. | Successful self-service authentication and workspace opening without synthetic sign-in tickets. |
| H02 scheduled cleanup | Owner supplies retention duration and accepts the proposed schedule; establish monitoring, then enable and observe it. | Real scheduled executions, physical cleanup, retry/failure handling and delivered alerts. |
| H03 hosted recovery | Owner completes Neon login/email verification; inspect backup window and plan, then agree the safe recovery drill boundary. | Verified backup access, quarantine restore, deletion/revocation replay and safe reopening. |
| H04 alerting | Name primary/backup humans and an approved receiver. Configure the independent missed-run watcher, then arm and schedule the monitor. | Delivered failure and recovery notifications, receiver/missed-run detection and human acknowledgment. |
| H05 capacity | Agree the workload/cost boundary after H04. | Bounded provider-exhaustion/fairness checks with alert evidence; no unapproved production load or plan change. |
| A01 Show HN | Founder writes and submits their own text and remains available for replies. | Actual submission URL. AI-written or AI-edited submission text is not permitted by HN's recorded rules. |
| A02 community launch | Choose the posting accounts/destinations and approve the specific introductions. | Real publication URLs and recorded replies. |
| A06 Android | Approve the specific signed ZIP upload; complete Central validation/publication, then run the prepared fresh registry consumer. | Public coordinate, matching five artifact hashes/signatures and successful fresh consumer build/tests. |
| Claude client | Complete `claude auth login --claudeai`, then run the bounded Claude-only MCP rehearsal. | Actual returned survey-list tool result. |
| A08 adoption | Real outside developers install or contribute after authorized outreach. | Consented reports and actual outside contributions. Download counts alone do not establish installations. |

Read-only database status at the first probe showed 40 due retention workspaces,
one pending export-cleanup object, and 10 pending erasure-archive events.
These aggregate observations are not customer or adoption counts. Scheduled
work remained disabled; no retention policy, alert recipient or human
acknowledgment was invented.

The public Android signing identity is approved. Monitoring activation still
requires the actual responder names, alert destination and retention duration.

Account login, authorship, support commitments and real external adoption cannot
be replaced by prepared files or simulated evidence. See the
[master checklist](../../PUBLIC-LAUNCH.md),
[monitor evidence](hosted-callback-liveness.md), and
[native distribution evidence](native-distribution.md).
