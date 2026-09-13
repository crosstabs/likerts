# Explicit export revocation and the erasure archive

`DELETE /v1/exports/{id}` previously revoked the PostgreSQL job and retained its physical cleanup key, but did not insert an export deletion event. Consequently the independent erasure archive did not record that operation, and a source fence did not reject it. This is an archive completeness and fence consistency defect.

The documented recovery procedure already revokes **every** restored export before traffic resumes (`infrastructure/recovery/replay.sql`). The missing event therefore does not establish a restored-download exposure through that procedure. Recovery must continue to quarantine all restored exports and credentials; do not weaken that rule based on this change.

The fixed runtime appends an `export` deletion event in the same transaction as revocation. The existing archive trigger creates the immutable outbox event, or rejects the transaction while the source is fenced. Repeated revocation uses the existing `(workspace_id,kind,resource_id)` uniqueness key and does not duplicate the journal. A rejection rolls back the job, cleanup scheduling and audit changes together. Provider deletion occurs only after this database transaction commits.

## Historical reconciliation plan

This is a separate, reviewed operator action. No historical migration is changed and no production backfill is performed by the patch.

1. Deploy and verify the patched runtime so new explicit revocations append events.
2. Use the migration owner transport and an explicitly approved workspace ID. Keep FORCE RLS enabled. Do not grant the API or archive worker global table access. Run only while the archive source is unfenced; its existing trigger must remain enabled.
3. In a transaction, set `likerts.workspace_id` to that exact ID using a safely bound SQL value or psql `:'workspace_id'`. Check that the workspace exists in that context. Execute the following bounded batch, with a 2-second lock timeout and 10-second statement timeout. Commit only if it succeeds.

```sql
with candidates as (
  select j.id
  from likerts.export_jobs j
  where j.workspace_id = current_setting('likerts.workspace_id')
    and j.status = 'revoked'
    and not exists (
      select 1 from likerts.deletion_events d
      where d.workspace_id = j.workspace_id
        and d.kind = 'export' and d.resource_id = j.id::text
    )
  order by j.created_at, j.id
  limit 1000
  for update of j skip locked
), appended as (
  insert into likerts.deletion_events(workspace_id,id,kind,resource_id,deleted_at)
  select current_setting('likerts.workspace_id'), gen_random_uuid(),
         'export', id::text, clock_timestamp()
  from candidates
  on conflict(workspace_id,kind,resource_id) do nothing
  returning id
)
select count(*) as appended_events from appended;
```

4. The timestamp is when the historical revocation was reconciled, **not** its original revocation time, which cannot be recovered reliably from the current job row. This batch only attests to currently known revoked exports. It cannot reconstruct removed rows or claim the archive was complete before backfill. Record the workspace, run time and count in restricted operations evidence.
5. Repeat at a controlled pace until a separate scoped count of missing revoked-export events reaches zero. A zero-sized batch under `SKIP LOCKED` alone does not prove completion. Concurrent identical inserts are safe; fencing or a constraint failure rolls back the whole batch and must be investigated before retry.
6. Drain the independent archive and verify that the new events are archived and checkpointed, including authenticated object readback. Preserve deletion events, outbox records and cleanup tombstones. Keep snapshot/PITR quarantine and unconditional restored-export revocation in place.

Historical backfill does not find old object keys that are absent from the current database. Existing cleanup tombstones remain authoritative for physical deletion; archive completeness, current private-object absence, and successful restore quarantine are separate verification results.
