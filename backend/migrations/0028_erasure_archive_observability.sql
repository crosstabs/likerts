-- Preserve the legacy status shape for existing and rolled-back workers. The
-- new monitor command uses a fixed application_name to negotiate aggregate
-- observability fields without adding another privileged function or grant.
create or replace function likerts.erasure_archive_status() returns jsonb
language sql security definer set search_path=pg_catalog,likerts as $$
  select jsonb_build_object(
    'sourceId',source_id,
    'fenceId',fence_id,
    'fencedAt',fenced_at,
    'checkpointId',head_id,
    'checkpointHash',head_hash,
    'coveredEvents',covered_events,
    'pendingEvents',(select count(*) from likerts.erasure_archive_outbox where archived_at is null),
    'oldestPendingSeconds',(select coalesce(greatest(0,extract(epoch from clock_timestamp()-min(created_at)))::bigint,0)
      from likerts.erasure_archive_outbox where archived_at is null))
    || case when current_setting('application_name',true)='likerts-erasure-archive-observability-v2' then
      jsonb_build_object(
        'uncheckpointedEvents',(select count(*) from likerts.erasure_archive_outbox where archived_at is not null and checkpoint_id is null),
        'oldestUncheckpointedSeconds',(select coalesce(greatest(0,extract(epoch from clock_timestamp()-min(archived_at)))::bigint,0)
          from likerts.erasure_archive_outbox where archived_at is not null and checkpoint_id is null),
        'retryingEvents',(select count(*) from likerts.erasure_archive_outbox where archived_at is null and attempts>0 and lease_id is null),
        'activeLeases',(select count(*) from likerts.erasure_archive_outbox where archived_at is null and lease_expires_at>clock_timestamp()),
        'staleLeases',(select count(*) from likerts.erasure_archive_outbox where archived_at is null and lease_expires_at<=clock_timestamp()),
        'pendingCheckpoint',pending_id is not null,
        'pendingCheckpointAgeSeconds',case when pending_body is null then 0 else
          greatest(0,extract(epoch from clock_timestamp()-(pending_body::jsonb->>'createdAt')::timestamptz))::bigint end)
      else '{}'::jsonb end
  from likerts.erasure_archive_control
$$;
revoke all on function likerts.erasure_archive_status() from public;
