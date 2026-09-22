# Bounded Neon recovery drill

Prepared 22 September 2026; **execution declined by the owner on 22 September**.
This is an inactive reference plan, not a pending approval request or launch task.
No test resources will be provisioned and no recovery-test spending is authorized.
Hosted restore/replay remains unverified; the waiver is not successful test evidence.
The existing
Likerts Neon project is accessible, on Launch in Singapore with PostgreSQL 18 and
a one-day history window. No manual snapshots or snapshot schedule were present.
See the [provider readback](../verification/hosted-provider-state.md#neon-access-and-history-window--22-september-2026).

## Proposed resources and cost boundary

Use the existing Likerts project and at most two temporary branches:
`likerts-recovery-source-20260922` and `likerts-recovery-restored-20260922`.
The source is a schema-only root, containing no copied production rows. Neon
[documents schema-only branches as independent roots](https://neon.com/docs/guides/branching-schema-only).
Only these branches may be written, fenced, restored or cleared by this drill.
The live `main` branch, its endpoints, schedules and history setting stay unchanged.

An owner-approved incremental budget of up to **US$1** is proposed for this single
run. Use the smallest supported fixed compute, aim for 0.25 CU, enable scale-to-zero,
and limit active testing to one hour. Record each actual compute size and runtime;
stop before projected use reaches the approved amount. This is an operational
budget, not a provider-enforced billing cap. Launch compute is metered; storage and
history also accrue usage. [Current Neon plan rates](https://neon.com/docs/introduction/plans)
list $0.106/CU-hour, so two 0.25-CU computes running for one hour would be $0.053 in
compute alone. Recheck account-specific rates and settings before provisioning.
Do not accept inherited production autoscaling of 1–9 CU for an unbounded run.

## Execution and evidence

1. Inventory branch IDs and confirm the names are unused. Create the schema-only
   source; verify it is a root and contains no respondent rows. Record its history
   window and endpoint. Use a fresh `likerts_recovery_*` database, exact deployed
   migrations and restricted roles so the existing replay guard remains intact.
2. Bind a locally accessible test API to that endpoint, with no public deployment,
   callback sender or production credentials in its client. Seed two synthetic
   workspaces, accepted responses, an export and a queued callback fixture. Record
   a database timestamp/LSN before controlled deletion and revocation.
3. Delete one fixture response and a second fixture workspace; revoke fixture
   access. Use the existing archiver with a separate source ID and owned private
   fixture prefix. Fence **only the synthetic source**, then drain and checkpoint
   it using the [archive procedure](../../infrastructure/erasure-archive/README.md#manual-fenced-recovery-operations).
   Verify the complete external chain without a database credential. Keep the
   source/fence/checkpoint/hash outside the database to be restored.
4. Create the restored branch from the recorded pre-deletion point. Verify the
   restored schema, migration checksums and fixture rows before replay. Keep it
   quarantined: no public API, callbacks, export downloads or restored credentials.
5. Replay verified erasures. Independently reconcile membership and credential
   revocations; the erasure chain does not prove those. Quarantine every restored
   callback, remove stale callback queues, and invalidate restored export and
   collection capabilities using the existing recovery procedure.
6. Exercise both tenants through the isolated test API: retained response and
   counters are correct, erased data is absent, old credentials/exports/callbacks
   cannot resume, cross-tenant operations are denied, and an identical retry does
   not duplicate a response. Reopen only the isolated fixture after these pass.
7. Record elapsed recovery stages, provider operation IDs, archive verification,
   denial results and limits. Stop test processes and remove only the owned
   temporary resources through the supported cleanup flow, obtaining any required
   action-time deletion confirmation. Verify cleanup rather than assuming expiry.

If schema-only creation, role permissions, restore history, cost accounting or
archive independence cannot meet this plan, stop and report the specific gap.
Do not substitute a restore or deletion fence on live `main`.

Successful execution would establish bounded Neon PITR and replay evidence for
the exercised configuration. It would not establish a production failover RTO,
continuous archive scheduling, approved retention protection, alert delivery,
human acknowledgment or an SLA. Those remaining H02–H05 gates stay explicit.
