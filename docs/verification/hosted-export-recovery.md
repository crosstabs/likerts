# Hosted API export process-loss drill

Verified 13 September 2026, 11:19:40–11:24:52 UTC. **The isolated native hosted export process-loss test passed:** the API child was killed with a committed running export lease, and its replacement recovered the same job after the real 300-second lease expiry. A different winning lease, one-response download/hash and unauthorized denial were verified. Fixture revocation and deletion passed at 11:25:56–11:26:00 UTC. The remaining H06 callback, DNS and rollback scope subsequently passed in the [15 September evidence](hosted-callback-recovery.md).

## Source and isolation

- The [disposable supervisor fixture](../../infrastructure/failure-fixture/README.md) came from [PR #27](https://github.com/crosstabs/likerts/pull/27), merged as `99724556a984cb67ace9307e5729a05b2f947d53`. Both required [merged-source CI checks](https://github.com/crosstabs/likerts/actions/runs/34743922757) passed before provisioning. Render's explicit deployment `dep-daj4q4p5efls73fja2b0` was pinned to that commit and verified live.
- The fixture copied unchanged runtime `0.1.2` binaries from released source `2996ebcbb9821cff67e0a6e8cae4722f0abf9e42`, image `ghcr.io/crosstabs/likerts@sha256:40042f29d15f7fb18a1d95287b099fd94cf2185df3c637e3304d73764488ae7c`. Native API SHA-256 was `7a44648d0245119ceb4c9b7754a52f181aa6e1ff6420992135e005533f01afd6`; worker SHA-256 was `136e387a55769eee12fe88c90e8cd0245b5dc2b124a1d99dd24244169368d4b6`.
- One new Free Render web service and one new Free PostgreSQL 16 database were created in Singapore after checking the existing workspace's included allowances. Actual resource readbacks confirmed Free plans, one web instance, no database replicas, no HA/autoscaling, the expected fresh owner username and the controller's exact external `/32` allowlist. An initial request specifying disk size received a definitive HTTP 400 because the Free plan does not allow that setting; the accepted Free request omitted the field. There was no paid fallback or plan upgrade. Included compute, build and bandwidth usage still apply.
- The released migrator applied migrations through 27 to the fresh database. Separate `likerts_runtime` and `likerts_webhook_worker` roles were created with the released privilege provisioning scripts; neither received superuser, BYPASSRLS, role/database creation, replication or role-membership privileges. The fresh database owner connection stayed in the private controller. Only the appropriate restricted connection entered each child; no production database credential entered the fixture.
- Render service creation cannot pin a commit, so its initial mutable-branch deployment received no fixture credentials. The controller confirmed that initial deployment terminal and the environment-variable inventory empty before installing fresh fixture secrets and submitting the explicit pinned deployment. The instance endpoint also returned an empty inventory, but that response does not independently establish absence of a running instance. State changes were journaled privately before dispatch with atomic replacement and directory fsync; uncertain requests were not automatically retried.

No production service was interrupted, no production database was migrated or written, and no DNS record was changed for this drill. Provider reads used existing operator access. Resource names, credentials, full instance IDs, boot IDs and synthetic row identifiers remain in restricted private evidence.

## Resume and native identity

A roughly four-hour execution gap separated provisioning from the drill. The next health request reached a new supervisor boot at 11:13 UTC with a `hibernate` instance ID. This is consistent with Free-service sleep/resume behavior, but the empty provider instance inventory does not independently prove that transition. The original short-lived fixture service credential returned 401. The controller verified the fresh database still had no survey/response work, revoked/replaced only that expired test credential, and repeated authorization and identity preflight. This is synthetic service authentication, not fresh human onboarding or SSO.

The resumed supervisor reported its full provider instance ID in the form `<owned service>-hibernate-<deployment suffix>-<five-character slug>`. Render's instance API returned null and the CLI returned an empty inventory despite the awake service. An independently queried, resource-only CPU metric returned the exact owned service/resource labels and the canonical `<owned service>-<same slug>` instance label. Render documents the five-character slug in logs/metrics and its use after the service ID. This is **provider-metric corroboration of the full native ID**, not equality with a populated instance inventory. [Render instance identification](https://render.com/docs/ssh#connecting-to-a-specific-instance)

The fallback required exactly one fresh positive CPU instance series, matching service/resource labels, a sample after this supervisor boot and no more than 120 seconds old, and an unchanged full native instance/boot identity. The pinned live deployment was also rechecked. Raw null inventory, query window and metric observations were preserved privately. The supervisor retained its native `/proc` executable, UID, PID and start-time guard immediately before the signal; local emulation overrides were not deployed.

At 11:19:25 UTC, unauthenticated supervisor access returned 401, API access with only supervisor authorization returned 401, and the scoped service credential succeeded. The expected API and worker hashes matched; both were live at generation 1. The API was PID 15, the worker PID 16.

## Observed results

The bounded lifecycle started at 11:19:40 UTC. It created and published one version-1 scale survey, created a collection and submitted one synthetic response twice with an identical idempotency key; both submissions returned the same receipt.

An external controller transaction acquired `ACCESS EXCLUSIVE` on `likerts.survey_versions` in the fresh fixture database at 11:19:45.770 UTC. It used a two-second lock acquisition timeout, 18-second statement/idle-transaction limits and a `finally` rollback. Export creation/claim can commit before its snapshot reads this locked table; the observer therefore captured an actual running lease rather than modifying job state or timestamps.

| Observation | Captured result |
| --- | --- |
| Initial committed running lease | 299.570 seconds remaining; object key absent. |
| Exact API loss | SIGKILL requested at 11:19:48.711 UTC; old child exit recorded with SIGKILL at 11:19:48.713 UTC. |
| Replacement | API PID 22, generation 2, at 11:19:48.715 UTC; supervisor boot/full instance unchanged. |
| Durable abandoned job | Same job and original lease, 296.607 seconds remaining, still running with no object; controller lock still held. |
| Worker | Remained generation 1; no worker signal or callback delivery in this test. |
| Lock release | Rollback and zero matching locks verified; total controller lock duration 4.590 seconds. |
| Final new winning lease and download | Same job ready after actual expiry; different winning lease in the object key, cleared live lease columns, exactly one response, matching API/download/database SHA-256. |
| Unauthorized download | 401 after the successful authorized download. |
| Hosted web memory | Peak 102,330,368 bytes (97.59 MiB), with a 536,870,912-byte limit; PostgreSQL was separate. |
| Fixture revocation and resource deletion | Collections and service credentials revoked; credential returned 401; web service and database deleted, each followed by an independent GET returning 404. |

The API has no autonomous export reclaim loop. The separate scoped poller made **135 authenticated status GETs**, spaced approximately two seconds apart; that route reclaimed the job after the actual 300-second lease expired. The durable winning object name matched `<job UUID>.<winning lease UUID>.export` with a new lease UUID. The initial/final database snapshots were independently compared for the same job, a different fence and cleared live lease columns. The decoded export contained exactly the original synthetic receipt, and its manifest count and computed SHA-256 matched the API and database. The supervisor boot/full instance ID remained unchanged. This establishes request-driven recovery after this child loss, not autonomous background recovery.

At 11:23 UTC, the refreshed billing UI displayed $0.00 for each fixture resource and usage remained within the workspace's included allowances. This dated display is not a final invoice or a promise that future usage is free.

## Cleanup and remaining scope

Cleanup ran at 11:25:56–11:26:00 UTC. The controller revoked the synthetic collections and service credentials, confirmed the credential returned 401, and observed zero callback endpoints. It deleted the exact owned web service before its fresh database, then independently obtained GET 404 for each resource. Production API, worker and MCP deployment IDs remained unchanged and live at released source `2996ebcbb9821cff67e0a6e8cae4722f0abf9e42`. No production resource was deleted.

The supervisor's 30-minute lifetime was not the cleanup mechanism: provider resources were explicitly deleted. Private controller state and raw evidence remain outside Git with restricted permissions; provider resource deletion does not assert secure physical-media erasure or deletion of retained evidence. Uncertain provider mutations must be reconciled instead of blindly retried.

This isolated fixture uses PostgreSQL persistence across API child loss and a local export directory in the surviving web container. It excludes VM/container loss, persistent-disk recovery, multi-replica takeover, managed Blob recovery, Neon PITR, compatible Render rollback, webhook lease reclaim, DNS transitions/rebinding, throughput and availability guarantees. Its explicit empty development-token map still requires hashed service credentials; admission is disabled only in this disposable fixture. Clerk, shared admission and the production startup wrapper are outside this test's scope.

The [hosted receiver checks](hosted-receiver.md) remain separate evidence from this export test. The later [combined recovery drill](hosted-callback-recovery.md) completed the bounded callback, DNS and rollback work. Completing H06 did not satisfy the still-open H01–H05 gates.
