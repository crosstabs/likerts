# Managed maintenance rehearsal — 13 September 2026

> Current deployment status: the separately authenticated, read-only maintenance status routes were deployed from protected source `351824d` and verified on 22 September; see the [deployment evidence](#authenticated-status-deployment--22-september-2026). The earlier rehearsals below retain their original dates and sources. Database status does not prove scheduled invocation, Blob reachability, independent checkpoint readback, callback-worker liveness or alert delivery.

This is partial operational evidence, not acceptance of hosted production readiness. The initial rehearsal below used source `a9f8b95b9f345129d91d961bee1070ad7f92e9e3`, [protected main CI](https://github.com/crosstabs/likerts/actions/runs/34733414936). Its failed attempts remain part of the record. The [later managed execution](#managed-execution-update) identifies what subsequently passed and what remains unproved.

## Initial rehearsal

Two existing-plan Vercel projects, `likerts-cleanup` and `likerts-erasure-archive`, have separate production-only worker secrets. A separate private Singapore Blob store is linked only to archive. No subscription upgrade occurred; provider usage remains metered. Owner database credentials were used only for controlled migration/provisioning and were not installed in either project.

Migrations 26–27 applied successfully. Both restricted database identities passed live role checks; archive source identity is pinned. API and MCP health remained HTTP 200 afterward. At this initial stage Render application deployment remained the earlier source; these worker deployments did not imply a Render rollout.

Both bundles were rebuilt from clean verified source, with ARM64 static binaries, bundled public CA, Node 22 and a 240-second function limit. Actual managed preview requests executed in `sin1`: unauthorized GET 401, authenticated missing-role configuration 503, query-string/method rejection 400. These tests did not exercise a configured child.

Initial configured production deployments (historical results, not the latest acceptance):

| Worker | Deployment | Initial result |
| --- | --- | --- |
| Archive | `dpl_FpQGmpWf7KgFt4tbt4zSNnppy6Md` | READY, cron disabled. Configured requests returned HTTP 503 `worker_failed`; one completed in 9.6 seconds. Production environment values privately matched the working local configuration. Failure cause remains unclassified. |
| Cleanup | `dpl_5S1CiEcDwkR9NXe6MEujaGcszHBt` | READY, cron disabled. Synthetic physical-deletion/retention verification remains pending. |

The exact Linux archive binary in the official Node 22 Lambda container connected with verified TLS, archived one event to the private store, independently read it back, and wrote a checkpoint. A native local 100-event batch also completed with a checkpoint; the resulting pending backlog was 5,837 events. These are real provider operations from local runners, not successful managed Vercel execution or scheduler delivery. A checkpoint covering 103 events was independently fetched from private Blob and its SHA-256 and source/checkpoint identities verified; the reference and verified object were saved to a private local recovery file outside the database. This is not full chain/fence verification. No production fence/release was performed. The backlog is existing operational history, not a claimed customer count.

The first deployment of a newly created project was automatically promoted to production even when `--target=preview` was requested. No production database/cron credentials were present then; handlers failed closed. Both project cron features were disabled and their states read back. The [promotion runbook](../../infrastructure/maintenance/README.md) now requires disabling cron before the first deployment and verifying actual target/aliases/paused state after every deployment.

At that point, managed failure classification and synthetic deletion/retry/retention isolation remained unresolved. The later observations below resolve only the explicitly tested portions. Local success, a READY deployment and a manual HTTP success cannot substitute for archive continuity, recovery, recurring execution or alert acceptance.

## Managed execution update

Later on **2026-09-13**, configured managed cleanup and archive execution used source `ce3166215f03ef34896198074b9fc8a671a2229b`. The separate Render API, MCP gateway and callback worker were verified LIVE at exact `a9f8b95b9f345129d91d961bee1070ad7f92e9e3`. Credentials, fixture identifiers, object paths and raw evidence stay private; the latest exact provider deployment identities are listed below. No source equality across those deployments is implied.

| Check | Observed result | Evidence boundary |
| --- | --- | --- |
| Hosted API synthetic lifecycle | Create/publish/collect, an identical retry counted once, one response readback, export hash/content verification, cross-tenant/scope denial and revocation passed. Service credentials were later revoked and fixture raw responses erased. | The original private lifecycle record reports a pass while still flagging cleanup as required; it predates the final cleanup confirmation. Prepared service credentials do not establish human signup, SSO or a fresh account-to-workspace journey. |
| Tenant-scoped retention | The managed worker erased the expired synthetic response in tenant A and preserved A's fresh response and tenant B's control. The private retention evidence records `passed: true`. | A bounded fixture proves the tested scope and age selection. It does not establish complete backlog removal, a running recurring schedule or an exact deletion-time guarantee. |
| Retained tombstone and late upload | After fixture workspace erasure, the cleanup tombstone remained. An intentionally late PUT was confirmed by authenticated origin-consistent GET 200; the managed cleanup invocation then led to GET 404. Tombstone retry and continuing raw-data erasure passed. The private late-upload evidence records `passed: true`. | This is an actual provider object-removal result for the controlled fixture. It is not a bucket inventory, historical-orphan audit, generic provider-failure drill or backup deletion guarantee. |
| Final maintenance-fixture cleanup | All three synthetic raw responses were erased. Tenant A and tenant B retained four and three deletion-journal records respectively. | Journal entries are not respondent payloads; their presence alone is not proof of independent archive coverage or recoverability. |
| Managed erasure archive | A 100-event batch and checkpoint completed successfully. A later backlog-drain attempt stopped with fixed failure category `archive_storage`; approximately 5,522 events were pending at the observation. | This supersedes the initial absence of a successful managed batch, not the archive/recovery gate. The storage category does not identify a specific provider cause. The backlog is operational history, not a customer count. |

The aggregate results above were checked against the operator's private lifecycle, retention and late-upload evidence files. Earlier `worker_failed` attempts and their private records were preserved rather than rewritten as successes. No new production probe was run merely to prepare this documentation.

At that stage, still unproved: independent archive coverage of the fixture deletions, full source/checkpoint continuity and backlog drain, verified Neon backup/PITR window and restore permissions, quarantine restore/replay, safe reopening, recurring schedule execution, missed-run/failure/backlog alerts and a responding human owner. Schedules were paused for the rehearsal; a manual managed invocation is not evidence that a recurring schedule is now active. H01–H04 and the final hosted decision remain open in [PUBLIC-LAUNCH.md](../../PUBLIC-LAUNCH.md).

These `a9f8b95` and `ce31662` observations preceded the further retry/journal rollout. They remain evidence for their original sources; the subsequent rollout is recorded separately below.


## Runtime 0.1.2 rollout and regression

[PR #22](https://github.com/crosstabs/likerts/pull/22) merged as `2996ebcbb9821cff67e0a6e8cae4722f0abf9e42` after [PR CI](https://github.com/crosstabs/likerts/actions/runs/34736866461) passed. The [exact-main workflow](https://github.com/crosstabs/likerts/actions/runs/34737342053) subsequently passed at `2996ebc`; the earlier queued observation is superseded by that completed check. Provider readback at 04:24 UTC on 2026-09-13 confirmed Render API, MCP gateway and callback worker LIVE at this exact source. The API/callback backend runtime is `0.1.2`; the MCP package remains `0.1.0`. API/MCP health returned 200. Callback delivery and process-loss recovery were not exercised by that readback.

| Component | Exact verified deployment | Source |
| --- | --- | --- |
| Render API | `dep-daj25e5g1s2s7395aue0` | `2996ebc` |
| Render MCP gateway | `dep-daj25hrm8hqs73em58qg` | `2996ebc` |
| Render callback worker | `dep-daj25i1594qs73aiprjg` | `2996ebc` |
| Vercel cleanup | `dpl_2cpWz7xmwNDupeFjh7K8v2kSD2Sx` | `2996ebc` |
| Vercel erasure archive | `dpl_EJ8iyzCdRJPnxMg9ghNh7VLFvRr9` | `2996ebc` |


| Check | Observed result | Evidence boundary |
| --- | --- | --- |
| Explicit export revocation and identical retry | The live synthetic API flow created, published and collected a response, produced an export, revoked it with HTTP 204 and denied download with HTTP 410. Independent database readbacks before fixture cleanup showed exactly one deletion-journal event, one outbox row and a matching hash. An identical DELETE returned 204; the second readback still showed exactly one event/outbox row with a matching hash. | This is the focused regression for the newer runtime, not a repetition of every earlier lifecycle/tenant test, fresh human onboarding or SSO. |
| Regression-fixture cleanup | The complete orchestrator passed. Final database readback showed credential revoked, workspace erased and zero raw rows. The controlled export object was deleted and authenticated origin-consistent GET returned 404. | The earlier exercise/retry snapshots correctly retained their cleanup-required flags; later orchestration and readbacks close cleanup for this fixture. They do not prove provider backup deletion or an inventory of all historic objects. |
| Historical fixture reconciliation | An allowlist of four known historical synthetic workspaces was audited. One missing export-revocation event was appended; the final separate readback reported zero missing export events and zero journal rows without outbox records within that scope. | The appended event records reconciliation time, not a reconstructed original revocation timestamp. Four known fixtures are not a complete historical audit or proof that all archived deletions can be replayed. |
| Managed cleanup, 04:32 UTC | Clean source ARM64 static binary passed Lambda Linux execution; the new Vercel production invocation returned HTTP 200 in 4.2 seconds, deleted one object and reached idle after two rounds without exhausting its budget. No raw responses or exports were newly erased/revoked in this invocation. | Cron remained disabled. An idle bounded invocation does not prove recurring scheduling or a provider-wide orphan/backlog audit. Earlier tenant-retention and late-upload scope tests remain attributed to `ce31662`. |
| Managed archive, 04:33 UTC | Clean source ARM64 static binary passed Lambda Linux execution; the new Vercel production invocation returned HTTP 200 in 159.7 seconds, archived 100 events and wrote a checkpoint. Database progress moved from 423 covered / 5,531 pending to 523 covered / 5,431 pending. | Cron remained disabled. This is a later successful batch, not a completed drain or independent verification of every stored event/checkpoint. Historical `worker_failed` and `archive_storage` attempts remain preserved above. |

At **04:40 UTC**, the first subsequent drain round completed four managed invocations with HTTP 200, each archiving 100 events and writing a checkpoint in 144.8–156.6 seconds. The final reported snapshot was 923 covered and 5,031 pending. The drain was still running at this cutoff; no completed-drain or full-chain verification is claimed. Concurrent invocation snapshots are observations, not separate customer counts.

The operator's private runtime-deployment, explicit-revocation orchestration, first/second database readback, object-absence, allowlisted reconciliation and source-specific managed-result records support these aggregates. This documentation update performed no new provider operation. Fixture identifiers, credentials, object keys and raw records remain private.

At that observation, remaining hosted gates included fresh human/second-tenant onboarding, full archive continuity and fixture coverage, a completed drain, verified provider backup/PITR and quarantine restore/replay, safe reopening, actual recurring scheduling, failure/missed-run/backlog alert delivery with a responding owner, capacity acceptance and managed recovery drills. A paused schedule and successful manual invocation are different evidence. See [PUBLIC-LAUNCH.md](../../PUBLIC-LAUNCH.md).


## Due-work completion and interrupted archive drain

The evidence above was published through [PR #23](https://github.com/crosstabs/likerts/pull/23), merged as `7d87f9f799ccd6c4acaf636a431b5d7ba23f3ee6` after [PR CI](https://github.com/crosstabs/likerts/actions/runs/34738694898) passed. [Exact-main CI](https://github.com/crosstabs/likerts/actions/runs/34739157847) subsequently passed both required jobs at `7d87f9f`. That documentation merge does not change the deployed worker source: the following managed operations still used exact `2996ebc` and the cleanup/archive deployment identities listed above.

At **04:56 UTC**, a read-only restricted-role status check found four retained cleanup tombstones, zero pending objects, zero retrying objects and 30 workspaces due for a retention visit. Two bounded managed cleanup invocations then completed the due-work snapshot:

| Managed invocation | Observed result | Due workspaces afterward |
| --- | --- | --- |
| 04:58:08 UTC | HTTP 200 in 4.3 seconds, 20 rounds; `idle: false`, **`budgetExhausted: true`**. | 30 → 10 |
| 04:58:51 UTC | HTTP 200 in 3.5 seconds, 11 rounds; `idle: true`, `budgetExhausted: false`. | 10 → 0 |

Both invocations reported zero object deletions, zero raw-response erasures and zero export revocations. The final restricted-role readback retained all four tombstones, with zero pending/retrying objects and zero due workspaces. Completing a due retention visit is not evidence that a response was deleted; earlier synthetic deletion/age-isolation proof remains attributed to its original fixture. Cron remained paused. This establishes that the observed due-work snapshot drained within successive bounded invocations, not that future work is scheduled or that all historical provider objects were inventoried.

The archive drain completed **eight rounds with four successful invocations each**, then stopped in round nine at **05:00 UTC** after one invocation returned HTTP 503 `archive_storage`; its three peers returned HTTP 200. This failure remains part of the record. At **05:03 UTC**, an independent retry-state snapshot conserved **5,954 total events = 4,111 covered + 1,843 pending**. It found zero active leases, zero attempted events still pending, zero archived events awaiting checkpoint coverage and no pending checkpoint. All 1,843 pending events were retry-eligible.

One event observed as retried during round nine was archived by the snapshot. Concurrent execution prevents attributing that event uniquely to the failed HTTP invocation; it is not a verified reconstruction of that invocation's partial work or proof of the specific storage failure cause. The next bounded resume used the same four-invocation concurrency. Its first round passed, but its second stopped at 05:09:19 UTC after another HTTP 503 `archive_storage` (41.7 seconds) and three successful 100-event peers. The terminal readback conserved 5,954 total = 4,835 covered + 1,118 pending + one archived event awaiting checkpoint coverage. It found zero active leases, zero attempted pending events, all 1,118 pending retry-eligible and no pending checkpoint marker. The one uncovered archived event remains checkpoint lag despite that absent marker; this is not proof of full checkpoint coverage. At **05:19:08 UTC**, one subsequent managed invocation at the same source/deployment completed successfully: HTTP 200 in 155.2 seconds, 100 events archived and a checkpoint written. Database coverage moved from 4,835 to 4,936, and pending events from 1,118 to 1,018; the 101-event coverage increase follows the earlier one-event checkpoint lag. This progress readback is not an independent archive-content/chain verification. Cron remained paused, and no drain was running at this cutoff. No completed drain, full independent archive chain verification, fixture replay or recovery completion is claimed here.

At that stage H02 remained open for actual scheduling, failure/missed-run alert delivery and acknowledgment; H03 still required terminal drain/prefix checks and provider restore/replay. The subsequent terminal evidence below supersedes only the completed portions.


## Completed drain and independently verified historical prefix

A bounded resume at two-invocation concurrency completed six rounds, **all twelve invocations passing**, and archived the remaining **1,018 events**. At **05:38:51 UTC**, pending events were zero while checkpoint coverage was 5,953. A normal idle completion at **05:40:28 UTC** returned HTTP 200 in 4.7 seconds, archived zero additional events and wrote the final checkpoint: **5,954 covered, zero pending**. Source remained `2996ebc` on the archive deployment listed above; cron remained paused. The earlier storage failures and intermediate checkpoint lag are preserved in this chronology.

The independent read-only verifier captured a repeatable database snapshot at **05:40:54 UTC**, pinned its completed head, then used an archive-only credential to fetch and verify the historical prefix. At **05:42:12 UTC**, verification passed for **44 checkpoints and 5,954 events**, totaling 2,584,510 archived bytes: 5,914 response, nine export and 31 workspace events. All **14 known fixture events across five workspaces** were included. Owner database credentials were not persisted; this verification performed no fence or provider mutation.

At **05:42:49 UTC**, a separate comparison also confirmed that the previously pinned retried event was included in the verified prefix, with exact archived bytes matching its prior database hash and matching event/source identity. This does not uniquely attribute that event to a failed HTTP 503 invocation.

**Scope: unfenced historical prefix integrity only.** The drain and this pinned prefix's continuity/known-fixture coverage are now proved; `recoveryCoverageProven` remains false. This is not proof of a fenced recovery cut, coverage of future writes, provider backup/PITR, quarantine restore/replay or safe reopening. H02/H03 remain open for their outstanding schedule, alert/owner and recovery requirements. No live recurring schedule or completed provider recovery drill is claimed.


## Authenticated status deployment — 22 September 2026

PR #42 passed the required `interfaces-and-database` and `container` checks
before merging as `351824d754969aba72ceef635def73d17bbc0470`. Both ARM64 bundles
were built from that clean maintenance/backend source and passed execution in
the compatible Linux environment.

| Service | Production deployment | Worker SHA-256 |
| --- | --- | --- |
| Cleanup | `dpl_9yjGBNPgbtsFdohg8EM5zpdK8KBe` | `7234d78707699f4bb102c0762bb558177eb9d286402db616d1ff25289b82719d` |
| Archive | `dpl_B9167L61A1ZQ3FL87bpk8NJt5kNq` | `4ea170940bbc23caff2a701b320b31b4a9490340179f11569eb0a37d36aca176` |

At 11:41 UTC both authenticated public `/api/status` routes returned HTTP 200.
Missing credentials, incorrect monitor credentials and extra query parameters
returned HTTP 401. The fix recognizes the exact path/query combination supplied
by Vercel's rewrite launcher; it retains the dedicated monitor credential and
read-only subprocess allowlists. The earlier header/absolute-URL compatibility
change alone did not fix the deployed route.

Cleanup reported one pending object, zero retrying objects, five tombstones and
40 due retention workspaces. Archive reported 10 pending / 5,954 covered events,
zero uncheckpointed or retrying events, zero active/stale leases, no pending
checkpoint, and an existing checkpoint without a fence. The real control-plane
probe parser classified both services as `backlog`. Schedules were read back as
disabled before and after deployment. No `/api/run` maintenance mutation or
retention-policy change was performed in this verification.

These are authenticated database status and route-boundary results. They do not
prove recurring execution, private object readback, delivered alerts, provider
recovery, or human acknowledgment. H02–H04 remain open for those separate gates.
