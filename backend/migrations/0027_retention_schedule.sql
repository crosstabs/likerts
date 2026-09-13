-- Fixed, bounded maintenance over tenant contexts. Caller supplies no workspace
-- ID or cutoff; workspace policy and database time are authoritative.
create table likerts.retention_schedule (
  workspace_id text primary key,
  next_run_at timestamptz not null default clock_timestamp(),
  last_completed_at timestamptz,
  last_responses_erased integer not null default 0,
  last_exports_revoked integer not null default 0
);
create index retention_schedule_due on likerts.retention_schedule(next_run_at,workspace_id);
alter table likerts.retention_schedule enable row level security;
alter table likerts.retention_schedule force row level security;
do $$ begin
  execute format('create policy retention_schedule_owner on likerts.retention_schedule to %I using(true) with check(true)',current_user);
end $$;
revoke all on likerts.retention_schedule from public;
create function likerts.schedule_workspace_retention() returns trigger
language plpgsql security definer set search_path=pg_catalog,likerts as $$
begin
  insert into likerts.retention_schedule(workspace_id) values(new.id) on conflict(workspace_id) do nothing;
  return new;
end $$;
revoke all on function likerts.schedule_workspace_retention() from public;
create trigger schedule_workspace_retention after insert on likerts.workspaces for each row execute function likerts.schedule_workspace_retention();
alter table likerts.workspaces no force row level security;
insert into likerts.retention_schedule(workspace_id) select id from likerts.workspaces on conflict(workspace_id) do nothing;
alter table likerts.workspaces force row level security;

create function likerts.run_scheduled_retention() returns jsonb
language plpgsql security definer set search_path=pg_catalog,likerts as $$
declare scope text; previous_scope text:=current_setting('likerts.workspace_id',true);
  cutoff timestamptz:=clock_timestamp(); erased integer:=0; revoked integer:=0; active boolean;
begin
  select workspace_id into scope from likerts.retention_schedule where next_run_at<=cutoff
    order by next_run_at,workspace_id for update skip locked limit 1;
  if not found then return jsonb_build_object('worked',false); end if;
  perform set_config('likerts.workspace_id',scope,true);
  select deleted_at is null into active from likerts.workspaces where id=scope;
  if coalesce(active,false) then
    with due as (
      select id from likerts.responses where workspace_id=scope and raw_deleted_at is null
        and accepted_at<cutoff-(select retention_days*interval '1 day' from likerts.workspaces where id=scope)
      order by accepted_at,id limit 1000 for update skip locked
    ), removed as (
      update likerts.responses r set answers=null,metadata=null,raw_deleted_at=cutoff from due
      where r.workspace_id=scope and r.id=due.id returning r.id
    ), journal as (
      insert into likerts.deletion_events(workspace_id,id,kind,resource_id,deleted_at)
        select scope,gen_random_uuid(),'response',id::text,cutoff from removed
        on conflict(workspace_id,kind,resource_id) do nothing
    ) select count(*) into erased from removed;
  end if;
  -- Even deleted tenants can have an interrupted export. Revocation and its
  -- physical deletion tombstone commit atomically with the erasure journal.
  with due as (
    select id from likerts.export_jobs where workspace_id=scope and status<>'revoked' and
      (not coalesce(active,false) or expires_at<=cutoff or erased>0 or exists(
        select 1 from likerts.deletion_events d where d.workspace_id=scope and d.kind='response' and d.deleted_at>=export_jobs.created_at))
    order by created_at,id limit 1000 for update skip locked
  ), removed as (
    update likerts.export_jobs j set status='revoked',object_key=null,response_count=null,content_sha256=null,manifest=null,error_code=null,lease_id=null,lease_expires_at=null
      from due where j.workspace_id=scope and j.id=due.id returning j.id
  ), journal as (
    insert into likerts.deletion_events(workspace_id,id,kind,resource_id,deleted_at)
      select scope,gen_random_uuid(),'export',id::text,cutoff from removed
      on conflict(workspace_id,kind,resource_id) do nothing
  ) select count(*) into revoked from removed;
  update likerts.retention_schedule set last_completed_at=clock_timestamp(),last_responses_erased=erased,last_exports_revoked=revoked,
    next_run_at=clock_timestamp()+case when erased=1000 or revoked=1000 then interval '1 second' else interval '1 hour' end
    where workspace_id=scope;
  perform set_config('likerts.workspace_id',coalesce(previous_scope,''),true);
  return jsonb_build_object('worked',true,'responsesErased',erased,'exportsRevoked',revoked);
end $$;
create function likerts.retention_schedule_status() returns jsonb
language sql security definer set search_path=pg_catalog,likerts as $$
  select jsonb_build_object('dueWorkspaces',count(*) filter(where next_run_at<=clock_timestamp()),
    'oldestDueSeconds',coalesce(greatest(0,extract(epoch from clock_timestamp()-min(next_run_at)))::bigint,0),
    'lastCompletedAt',max(last_completed_at)) from likerts.retention_schedule
$$;
revoke all on function likerts.run_scheduled_retention(),likerts.retention_schedule_status() from public;
