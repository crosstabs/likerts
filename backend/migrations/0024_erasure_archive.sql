-- Independent ID-only erasure archive. No archive credential is granted to the
-- API/callback worker. A source fence is explicit maintenance, never automatic.
create table likerts.erasure_archive_control (
  singleton boolean primary key default true check(singleton),
  source_id uuid not null default gen_random_uuid(),
  fence_id uuid,
  fenced_at timestamptz,
  head_id uuid,
  head_hash text check(head_hash is null or head_hash ~ '^[0-9a-f]{64}$'),
  head_fence_id uuid,
  covered_events bigint not null default 0 check(covered_events>=0),
  pending_id uuid,
  pending_body text,
  check((fence_id is null)=(fenced_at is null)),
  check((head_id is null)=(head_hash is null)),
  check((pending_id is null)=(pending_body is null))
);
insert into likerts.erasure_archive_control(singleton) values(true);
create table likerts.erasure_archive_outbox (
  event_id uuid primary key,
  body text not null check(octet_length(body)<=4096),
  body_hash text not null check(body_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  lease_id uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check(attempts between 0 and 31),
  next_attempt_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  checkpoint_id uuid,
  check((lease_id is null)=(lease_expires_at is null)),
  check(checkpoint_id is null or archived_at is not null)
);
create index erasure_archive_pending on likerts.erasure_archive_outbox(next_attempt_at,created_at,event_id) where archived_at is null;
create index erasure_archive_uncheckpointed on likerts.erasure_archive_outbox(event_id) where checkpoint_id is null and archived_at is not null;

-- FORCE RLS remains on. Only the migration owner, through functions below,
-- sees these global ID-only operational tables; no direct worker table grant.
alter table likerts.erasure_archive_control enable row level security;
alter table likerts.erasure_archive_control force row level security;
alter table likerts.erasure_archive_outbox enable row level security;
alter table likerts.erasure_archive_outbox force row level security;
do $$ begin
  execute format('create policy erasure_archive_owner on likerts.erasure_archive_control to %I using(true) with check(true)',current_user);
  execute format('create policy erasure_archive_owner on likerts.erasure_archive_outbox to %I using(true) with check(true)',current_user);
end $$;
revoke all on likerts.erasure_archive_control,likerts.erasure_archive_outbox from public;

create function likerts.archive_erasure_event() returns trigger
language plpgsql security definer set search_path=pg_catalog,likerts as $$
declare control likerts.erasure_archive_control; payload text;
begin
  -- The INSERT's tenant policy remains authoritative. Shared transaction locks
  -- make the explicit exclusive maintenance fence wait for in-flight erasures.
  perform pg_advisory_xact_lock_shared(714208476221::bigint);
  select * into strict control from likerts.erasure_archive_control;
  if control.fence_id is not null then
    raise exception using errcode='LKF01',message='erasure_source_fenced';
  end if;
  payload := jsonb_build_object('archiveVersion',1,'sourceId',control.source_id,
    'eventId',new.id,'workspaceId',new.workspace_id,'kind',new.kind,
    'resourceId',new.resource_id,'deletedAt',new.deleted_at)::text;
  insert into likerts.erasure_archive_outbox(event_id,body,body_hash)
    values(new.id,payload,encode(sha256(convert_to(payload,'UTF8')),'hex'));
  return new;
end $$;
revoke all on function likerts.archive_erasure_event() from public;
-- AFTER means denied tenant inserts and ON CONFLICT retries cannot forge events.
create trigger archive_erasure_event after insert on likerts.deletion_events for each row execute function likerts.archive_erasure_event();

-- The migration locks deletion_events against writes while installing/backfilling.
-- Iterate authorized tenant contexts for non-superuser owners under FORCE RLS.
do $$ declare workspace record; event record; payload text; source uuid;
  previous_scope text := current_setting('likerts.workspace_id',true);
begin
  select source_id into source from likerts.erasure_archive_control;
  -- Temporary owner-only NO FORCE is transactional and ends before migration
  -- commit; necessary to enumerate an existing global journal without BYPASSRLS.
  alter table likerts.deletion_events no force row level security;
  for event in select * from likerts.deletion_events loop
    payload := jsonb_build_object('archiveVersion',1,'sourceId',source,'eventId',event.id,
      'workspaceId',event.workspace_id,'kind',event.kind,'resourceId',event.resource_id,'deletedAt',event.deleted_at)::text;
    insert into likerts.erasure_archive_outbox(event_id,body,body_hash)
      values(event.id,payload,encode(sha256(convert_to(payload,'UTF8')),'hex')) on conflict(event_id) do nothing;
  end loop;
  alter table likerts.deletion_events force row level security;
end $$;

create function likerts.erasure_archive_status() returns jsonb
language sql security definer set search_path=pg_catalog,likerts as $$
  select jsonb_build_object('sourceId',source_id,'fenceId',fence_id,'fencedAt',fenced_at,
    'checkpointId',head_id,'checkpointHash',head_hash,'coveredEvents',covered_events,
    'pendingEvents',(select count(*) from likerts.erasure_archive_outbox where archived_at is null),
    'oldestPendingSeconds',(select coalesce(greatest(0,extract(epoch from clock_timestamp()-min(created_at)))::bigint,0) from likerts.erasure_archive_outbox where archived_at is null))
  from likerts.erasure_archive_control
$$;
create function likerts.claim_erasure_archive() returns table(event_id uuid,body text,body_hash text,lease_id uuid)
language sql security definer set search_path=pg_catalog,likerts as $$
  with candidate as (
    select o.event_id from likerts.erasure_archive_outbox o
    where o.archived_at is null and o.next_attempt_at<=clock_timestamp()
      and (o.lease_expires_at is null or o.lease_expires_at<=clock_timestamp())
    order by o.created_at,o.event_id for update skip locked limit 1
  ) update likerts.erasure_archive_outbox o set lease_id=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+interval '60 seconds',attempts=least(o.attempts+1,31)
    from candidate c where o.event_id=c.event_id returning o.event_id,o.body,o.body_hash,o.lease_id
$$;
create function likerts.finish_erasure_archive(event uuid,lease uuid,verified_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog,likerts as $$
begin
  update likerts.erasure_archive_outbox set archived_at=clock_timestamp(),lease_id=null,lease_expires_at=null
    where event_id=event and lease_id=lease and lease_expires_at>clock_timestamp()
      and archived_at is null and body_hash=verified_hash;
  return found;
end $$;
create function likerts.retry_erasure_archive(event uuid,lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,likerts as $$
begin
  update likerts.erasure_archive_outbox set next_attempt_at=clock_timestamp()+least(300,power(2,least(attempts,9)))::double precision*interval '1 second',lease_id=null,lease_expires_at=null
    where event_id=event and lease_id=lease and lease_expires_at>clock_timestamp() and archived_at is null;
  return found;
end $$;

create function likerts.prepare_erasure_checkpoint() returns text
language plpgsql security definer set search_path=pg_catalog,likerts as $$
declare control likerts.erasure_archive_control; identifier uuid:=gen_random_uuid(); entries jsonb;
  total bigint; fence uuid; payload text;
begin
  perform pg_advisory_xact_lock(714208476222::bigint);
  select * into strict control from likerts.erasure_archive_control for update;
  if control.pending_id is not null then return control.pending_body; end if;
  with candidates as (
    select event_id from likerts.erasure_archive_outbox where archived_at is not null and checkpoint_id is null order by event_id limit 1000
  ) update likerts.erasure_archive_outbox o set checkpoint_id=identifier from candidates c where o.event_id=c.event_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',event_id,'sha256',body_hash) order by event_id),'[]'::jsonb)
    into entries from likerts.erasure_archive_outbox where checkpoint_id=identifier;
  total := control.covered_events+jsonb_array_length(entries);
  -- This proves the explicitly fenced source set, never future deletions.
  if control.fence_id is not null and not exists(select 1 from likerts.erasure_archive_outbox where checkpoint_id is null or archived_at is null) then fence:=control.fence_id; end if;
  if jsonb_array_length(entries)=0 and (fence is null or fence is not distinct from control.head_fence_id) then return null; end if;
  payload:=jsonb_build_object('archiveVersion',1,'sourceId',control.source_id,'checkpointId',identifier,
    'previous',case when control.head_id is null then null else jsonb_build_object('id',control.head_id,'sha256',control.head_hash) end,
    'fenceId',fence,'createdAt',clock_timestamp(),'totalEvents',total,'events',entries)::text;
  update likerts.erasure_archive_control set pending_id=identifier,pending_body=payload;
  return payload;
end $$;
create function likerts.finish_erasure_checkpoint(identifier uuid,verified_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog,likerts as $$
begin
  perform pg_advisory_xact_lock(714208476222::bigint);
  update likerts.erasure_archive_control set head_id=pending_id,head_hash=verified_hash,
    head_fence_id=(pending_body::jsonb->>'fenceId')::uuid,
    covered_events=(pending_body::jsonb->>'totalEvents')::bigint,pending_id=null,pending_body=null
    where pending_id=identifier and encode(sha256(convert_to(pending_body,'UTF8')),'hex')=verified_hash;
  return found;
end $$;
create function likerts.fence_erasure_source(expected_source uuid,attestation text) returns uuid
language plpgsql security definer set search_path=pg_catalog,likerts as $$
declare result uuid;
begin
  if attestation<>'I_ACCEPT_DELETIONS_WILL_BE_REJECTED' then raise exception 'Explicit erasure maintenance attestation required'; end if;
  perform pg_advisory_xact_lock(714208476221::bigint);
  update likerts.erasure_archive_control set fence_id=coalesce(fence_id,gen_random_uuid()),fenced_at=coalesce(fenced_at,clock_timestamp())
    where source_id=expected_source returning fence_id into result;
  if result is null then raise exception 'Source identity mismatch'; end if;
  return result;
end $$;
create function likerts.release_erasure_source(expected_source uuid,expected_fence uuid,attestation text) returns boolean
language plpgsql security definer set search_path=pg_catalog,likerts as $$
begin
  if attestation<>'I_ACCEPT_OLD_CHECKPOINT_NO_LONGER_COVERS_FUTURE_DELETIONS' then raise exception 'Explicit source release attestation required'; end if;
  perform pg_advisory_xact_lock(714208476221::bigint);
  update likerts.erasure_archive_control set fence_id=null,fenced_at=null where source_id=expected_source and fence_id=expected_fence;
  return found;
end $$;
revoke all on function likerts.erasure_archive_status(),likerts.claim_erasure_archive(),likerts.finish_erasure_archive(uuid,uuid,text),likerts.retry_erasure_archive(uuid,uuid),likerts.prepare_erasure_checkpoint(),likerts.finish_erasure_checkpoint(uuid,text),likerts.fence_erasure_source(uuid,text),likerts.release_erasure_source(uuid,uuid,text) from public;
