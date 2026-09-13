-- Object keys survive revocation, erasure and failed uploads. The maintenance
-- credential can claim deletions, but cannot read answers or choose tenant IDs.
create table likerts.export_cleanup (
  object_key text primary key check(length(object_key) between 1 and 100 and object_key ~ '^[A-Za-z0-9_.-]+$'),
  workspace_id text not null,
  export_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null,
  lease_id uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check(attempts between 0 and 31),
  deleted_at timestamptz,
  check((lease_id is null)=(lease_expires_at is null))
);
create index export_cleanup_due on likerts.export_cleanup(next_attempt_at,object_key);
alter table likerts.export_cleanup enable row level security;
alter table likerts.export_cleanup force row level security;
do $$ begin
  execute format('create policy export_cleanup_owner on likerts.export_cleanup to %I using(true) with check(true)',current_user);
end $$;
revoke all on likerts.export_cleanup from public;

create function likerts.track_export_cleanup() returns trigger
language plpgsql security definer set search_path=pg_catalog,likerts as $$
begin
  if tg_op='UPDATE' and old.object_key is not null and old.object_key is distinct from new.object_key then
    insert into likerts.export_cleanup(object_key,workspace_id,export_id,next_attempt_at)
      values(old.object_key,old.workspace_id,old.id,clock_timestamp())
      on conflict(object_key) do update set next_attempt_at=least(export_cleanup.next_attempt_at,excluded.next_attempt_at),deleted_at=null;
  end if;
  if new.object_key is not null then
    insert into likerts.export_cleanup(object_key,workspace_id,export_id,next_attempt_at)
      values(new.object_key,new.workspace_id,new.id,new.expires_at)
      on conflict(object_key) do nothing;
  end if;
  -- Reserve the exact attempt key BEFORE any network upload. Even an upload
  -- followed by a crash, or an ambiguous timeout, leaves a durable tombstone.
  if new.lease_id is not null then
    insert into likerts.export_cleanup(object_key,workspace_id,export_id,next_attempt_at)
      values(new.id::text||'.'||new.lease_id::text||'.export',new.workspace_id,new.id,
        coalesce(new.lease_expires_at,clock_timestamp())+interval '60 seconds')
      on conflict(object_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function likerts.track_export_cleanup() from public;
create trigger track_export_cleanup after insert or update on likerts.export_jobs
  for each row execute function likerts.track_export_cleanup();

-- Owner-only, transactional backfill under the migration's table lock. Restore
-- FORCE before commit; the API never gets global table access.
alter table likerts.export_jobs no force row level security;
insert into likerts.export_cleanup(object_key,workspace_id,export_id,next_attempt_at)
  select object_key,workspace_id,id,expires_at from likerts.export_jobs where object_key is not null
  on conflict(object_key) do nothing;
insert into likerts.export_cleanup(object_key,workspace_id,export_id,next_attempt_at)
  select id::text||'.'||lease_id::text||'.export',workspace_id,id,
    coalesce(lease_expires_at,clock_timestamp())+interval '60 seconds'
  from likerts.export_jobs where lease_id is not null on conflict(object_key) do nothing;
alter table likerts.export_jobs force row level security;

create function likerts.claim_export_cleanup() returns table(object_key text,lease_id uuid)
language plpgsql security definer set search_path=pg_catalog,likerts as $$
declare candidate likerts.export_cleanup; job likerts.export_jobs;
  previous_scope text:=current_setting('likerts.workspace_id',true); claimed uuid;
begin
  -- Lock jobs before tombstones, matching the API/trigger lock order. Bound the
  -- scan so a busy tenant cannot make one maintenance call unbounded.
  for candidate in select q.* from likerts.export_cleanup q
    where q.next_attempt_at<=clock_timestamp()
      and (q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp())
    order by q.next_attempt_at,q.object_key limit 32 loop
    perform set_config('likerts.workspace_id',candidate.workspace_id,true);
    select * into job from likerts.export_jobs j where j.workspace_id=candidate.workspace_id and j.id=candidate.export_id for update skip locked;
    if not found then
      -- A locked job is not a missing job; never delete its object speculatively.
      if exists(select 1 from likerts.export_jobs j where j.workspace_id=candidate.workspace_id and j.id=candidate.export_id) then
        -- Rotate locked candidates behind older work, without waiting for their
        -- tombstone lock. Otherwise 32 busy jobs could hide every other tenant.
        update likerts.export_cleanup q set next_attempt_at=clock_timestamp()+interval '1 second'
          where q.object_key in (select c.object_key from likerts.export_cleanup c where c.object_key=candidate.object_key for update skip locked);
        continue;
      end if;
    end if;
    perform 1 from likerts.export_cleanup q where q.object_key=candidate.object_key
      and q.next_attempt_at<=clock_timestamp() and (q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp()) for update skip locked;
    if not found then continue; end if;
    if job.status='ready' and job.object_key=candidate.object_key and job.expires_at>clock_timestamp() then
      update likerts.export_cleanup q set next_attempt_at=job.expires_at where q.object_key=candidate.object_key;
      continue;
    end if;
    if job.status='running' and candidate.object_key=job.id::text||'.'||job.lease_id::text||'.export' then
      if job.lease_expires_at+interval '60 seconds'>clock_timestamp() then
        update likerts.export_cleanup q set next_attempt_at=job.lease_expires_at+interval '60 seconds' where q.object_key=candidate.object_key;
        continue;
      end if;
      -- Fence the expired attempt before deleting; it cannot later publish.
      update likerts.export_jobs set status='failed',error_code='export_lease_expired',lease_id=null,lease_expires_at=null
        where workspace_id=candidate.workspace_id and id=candidate.export_id;
    end if;
    claimed:=gen_random_uuid();
    update likerts.export_cleanup q set lease_id=claimed,lease_expires_at=clock_timestamp()+interval '60 seconds',attempts=least(q.attempts+1,31)
      where q.object_key=candidate.object_key;
    perform set_config('likerts.workspace_id',coalesce(previous_scope,''),true);
    return query select candidate.object_key,claimed;
    return;
  end loop;
  perform set_config('likerts.workspace_id',coalesce(previous_scope,''),true);
end $$;

create function likerts.finish_export_cleanup(key text,lease uuid,success boolean) returns boolean
language plpgsql security definer set search_path=pg_catalog,likerts as $$
begin
  -- Keep tombstones and recheck daily: a provider can accept an upload after a
  -- client timeout. Never forget the key merely because DELETE once succeeded.
  update likerts.export_cleanup set deleted_at=case when success then clock_timestamp() else null end,
    next_attempt_at=clock_timestamp()+case when success then interval '1 day' else least(300,power(2,least(attempts,9)))::double precision*interval '1 second' end,
    lease_id=null,lease_expires_at=null
    where object_key=key and lease_id=lease and lease_expires_at>clock_timestamp();
  return found;
end $$;
create function likerts.export_cleanup_status() returns jsonb
language sql security definer set search_path=pg_catalog,likerts as $$
  select jsonb_build_object('pendingObjects',count(*) filter(where deleted_at is null and next_attempt_at<=clock_timestamp()),
    'retryingObjects',count(*) filter(where deleted_at is null and attempts>0),
    'tombstones',count(*),
    'oldestDueSeconds',coalesce(greatest(0,extract(epoch from clock_timestamp()-min(next_attempt_at) filter(where deleted_at is null and next_attempt_at<=clock_timestamp())))::bigint,0))
  from likerts.export_cleanup
$$;
revoke all on function likerts.claim_export_cleanup(),likerts.finish_export_cleanup(text,uuid,boolean),likerts.export_cleanup_status() from public;
