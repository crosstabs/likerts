# Retention and export deletion worker

The `likerts-export-cleanup` binary runs bounded retention and durable object-deletion retries. It is packaged in both runtime images. Adding the binary does not start a hosted schedule: the deployed worker, its credentials, observed deletion and alert receiver must be verified separately before closing H02 in [the launch record](../../PUBLIC-LAUNCH.md).

## Database and object credentials

Apply migrations with the migration owner, then create a dedicated LOGIN role named `likerts_export_cleanup` with NOINHERIT, NOBYPASSRLS, NOSUPERUSER, NOCREATEDB, NOCREATEROLE and NOREPLICATION. Set its password through the secret manager. Run [provision-export-cleanup.sql](../../backend/provision-export-cleanup.sql) as the owner using `psql -X -v ON_ERROR_STOP=1`; the script rejects role memberships and application-object ownership, removes table/column privileges, and grants only fixed maintenance functions. Runtime startup rejects excess table/column access. Do not give this worker the migration owner or management token.

Set `LIKERTS_CLEANUP_DATABASE_URL` to that dedicated connection and configure the exact same export provider, store and prefix as the API:

| Provider | Required configuration |
| --- | --- |
| Private Vercel Blob | `LIKERTS_EXPORT_STORE=vercel_blob`, `LIKERTS_VERCEL_BLOB_TOKEN`, `LIKERTS_EXPORT_PREFIX` |
| S3 | `LIKERTS_EXPORT_STORE=s3`, `LIKERTS_EXPORT_BUCKET`, `LIKERTS_EXPORT_PREFIX`, provider identity |
| Disposable/local development | `LIKERTS_EXPORT_STORE=local`, `LIKERTS_ALLOW_LOCAL_CLEANUP=1`, `LIKERTS_EXPORT_DIR` |

The binary enforces verified TLS for hosted PostgreSQL, including when a URL requests a weaker mode. Disposable loopback PostgreSQL requires `LIKERTS_CLEANUP_ALLOW_LOCAL_INSECURE=1`; the switch rejects remote hosts. Keep local cleanup on the same durable filesystem as the API. Never point the worker at an empty replacement bucket/store: an idempotent DELETE may return success there while the real export remains elsewhere. Prove the mapping by creating a synthetic export through the target API, then verifying physical absence in that exact provider after revocation. Blob read/write tokens have broader object permissions than the worker's restricted database role; database isolation does not turn them into delete-only credentials.

## Run and observe

```sh
likerts-export-cleanup check
likerts-export-cleanup status
likerts-export-cleanup once
likerts-export-cleanup worker
```

`check` validates the database role, without claiming provider connectivity. `status` returns aggregate cleanup and retention counters, not workspace IDs or answers. `once` runs one retention batch and at most one object deletion. `worker` repeats on a bounded loop and handles SIGTERM; canceled operations retain their database lease for a later retry. Run one supervised process or schedule bounded `once` invocations. Multiple workers coordinate through PostgreSQL locks and leases.

Each retention batch chooses an internally scheduled workspace, uses database time and its stored `retention_days`, and erases at most 1,000 raw responses and revokes at most 1,000 exports. It appends deletion-journal records transactionally. A full batch is scheduled again after one second; ordinary checks recur after one hour. Lock contention can defer work. This schedule is an operational target, not an exact deletion-time guarantee. A fenced erasure source rejects the transaction rather than deleting without its journal.

Export object keys enter a durable outbox before upload and before revocation clears the live key. A valid, ready export remains protected until expiry. Expired running attempts are fenced before cleanup so they cannot publish afterward. Deletion failures retain their key and retry with exponential backoff capped at five minutes; a crashed worker's lease expires after 60 seconds. Object operations have a 35-second worker timeout.

Successful deletions retain tombstones and recheck once per day. This covers a storage provider accepting a late PUT after the client's timeout. Tombstones contain IDs/keys, never answer payloads, and currently remain indefinitely. Budget their database size and daily delete operations. There is no claim that one successful DELETE proves an ambiguous upload can never arrive afterward.

Monitor `retryingObjects`, `pendingObjects`, cleanup `oldestDueSeconds`, retention `dueWorkspaces`/`oldestDueSeconds`, and the process/scheduler heartbeat. Cleanup due age measures waiting since the current eligible attempt, not cumulative outage duration; retry count remains important during repeated provider failure. Alert on persistent failures and overdue work, test receiver delivery, and record a human acknowledgment. Merely printing counters does not arm alerts.

## Verification and deployment boundary

Run `bash scripts/check-postgres.sh` for restricted-role and lifecycle integration tests. Use isolated provider objects for the hosted acceptance drill; test storage failure/recovery, stale leases, expired exports, workspace erasure, backlog drain and scope denial. Never use real respondent data for a launch rehearsal.

The [13 September managed rehearsal](../verification/managed-maintenance.md#managed-execution-update) at source `ce3166215f03ef34896198074b9fc8a671a2229b` passed bounded tenant-scoped retention and retained-tombstone removal of a late upload after workspace erasure, with all three fixture raw responses subsequently erased. These results do not establish a completed backlog drain, active recurring schedule or working alert delivery. The evidence record preserves the earlier failed attempts. A subsequent [runtime `0.1.2` managed invocation](../verification/managed-maintenance.md#runtime-012-rollout-and-regression) at source `2996ebc` deleted one object and reached idle after two rounds with cron still disabled; the earlier retention and late-upload tests remain attributed to `ce31662`.

A later [due-work snapshot](../verification/managed-maintenance.md#due-work-completion-and-interrupted-archive-drain) at `2996ebc` drained 30 → 10 → 0 due retention visits across two managed invocations. The first correctly reported `budgetExhausted: true`; the second reached idle. Neither invocation erased raw responses or revoked exports. Four cleanup tombstones remained, with zero pending/retrying objects. This is bounded manual progress while cron remained paused.

Migrations backfill object keys and attempt IDs still present in PostgreSQL. Objects orphaned before this migration with no surviving key need a separately reviewed provider inventory/reconciliation. The worker does not blindly list/delete an entire bucket, purge provider backups or establish Neon recovery guarantees. [The independent erasure archive](../../infrastructure/erasure-archive/README.md) and quarantined restore remain separate operations.
