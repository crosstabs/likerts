#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
container="likerts-render-roles-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm --detach --name "$container" --env POSTGRES_PASSWORD=render-role-test -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
ready=0
for _ in $(seq 1 60); do
  if [ "$(docker exec "$container" psql --host 127.0.0.1 --username postgres --dbname postgres --quiet --tuples-only --no-align --command 'select 1' 2>/dev/null || true)" = "1" ]; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  docker logs "$container" >&2
  echo 'PostgreSQL role-test container did not become query-ready' >&2
  exit 1
fi
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c "create role likerts_render_owner login password 'render-role-test' createrole nocreatedb noinherit nobypassrls;" >/dev/null
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c "create database likerts owner likerts_render_owner;" >/dev/null
port="$(docker port "$container" 5432/tcp | awk -F: '{print $NF}')"
source "$root/scripts/dev-env.sh"
LIKERTS_MIGRATION_DATABASE_URL="postgres://likerts_render_owner:render-role-test@127.0.0.1:$port/likerts" cargo run --manifest-path "$root/backend/Cargo.toml" --locked --bin likerts-migrate
docker exec "$container" psql -X -U likerts_render_owner -d likerts -v ON_ERROR_STOP=1 -c "create role likerts_export_cleanup login password 'synthetic-cleanup-password' noinherit nobypassrls nocreatedb nocreaterole;" >/dev/null
for _ in 1 2; do
  docker exec -i -e LIKERTS_BOOTSTRAP_RUNTIME_PASSWORD=synthetic-runtime-password -e LIKERTS_BOOTSTRAP_WORKER_PASSWORD=synthetic-worker-password "$container" psql -X -U likerts_render_owner -d likerts -v ON_ERROR_STOP=1 < "$root/infrastructure/render/bootstrap.sql" >/dev/null
  docker exec -i "$container" psql -X -U likerts_render_owner -d likerts -v ON_ERROR_STOP=1 -v runtime_role=likerts_runtime < "$root/backend/provision-runtime.sql" >/dev/null
  docker exec -i "$container" psql -X -U likerts_render_owner -d likerts -v ON_ERROR_STOP=1 < "$root/infrastructure/webhooks/provision-worker.sql" >/dev/null
  docker exec -i "$container" psql -X -U likerts_render_owner -d likerts -v ON_ERROR_STOP=1 < "$root/backend/provision-export-cleanup.sql" >/dev/null
done
docker exec -i "$container" psql -X -U likerts_render_owner -d likerts -v ON_ERROR_STOP=1 <<'SQL'
do $$ declare relation text; function_name text; begin
  if exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Migration owner bypasses RLS'; end if;
  foreach relation in array array['workspaces','responses','export_jobs','deletion_events','audit_events','export_cleanup','retention_schedule'] loop
    if not exists(select 1 from pg_class where oid=format('likerts.%I',relation)::regclass and relrowsecurity and relforcerowsecurity and relowner=current_user::regrole) then
      raise exception 'Missing owner FORCE RLS for %',relation;
    end if;
  end loop;
  foreach function_name in array array['run_scheduled_retention()','retention_schedule_status()','claim_export_cleanup()','finish_export_cleanup(text,uuid,boolean)','export_cleanup_status()'] loop
    if not exists(select 1 from pg_proc where oid=('likerts.'||function_name)::regprocedure and prosecdef and proowner=current_user::regrole) then
      raise exception 'Maintenance function not owned by non-superuser SECURITY DEFINER: %',function_name;
    end if;
  end loop;
end $$;
SQL
docker exec -i "$container" psql -X -U likerts_runtime -d likerts -v ON_ERROR_STOP=1 <<'SQL'
begin;
select set_config('likerts.workspace_id','render-tenant-a',true);
insert into likerts.workspaces(id) values('render-tenant-a');
insert into likerts.service_credentials(workspace_id,id,name,token_hash,scopes,expires_at)
values('render-tenant-a','00000000-0000-0000-0000-000000000001','resolver-test',decode(repeat('ab',32),'hex'),array['surveys:read'],now()+interval '1 day');
insert into likerts.export_jobs(workspace_id,id,idempotency_key,request_hash,format,upper_sequence,status,object_key,response_count,content_sha256,manifest,created_at,expires_at)
values('render-tenant-a','00000000-0000-0000-0000-000000000002','expired',decode(repeat('ab',32),'hex'),'json',0,'ready','synthetic-expired.export',0,repeat('ab',32),'{}',now()-interval '2 days',now()-interval '1 day');
commit;
begin;
select set_config('likerts.workspace_id','render-tenant-b',true);
insert into likerts.workspaces(id) values('render-tenant-b');
insert into likerts.export_jobs(workspace_id,id,idempotency_key,request_hash,format,upper_sequence,status,object_key,response_count,content_sha256,manifest)
values('render-tenant-b','00000000-0000-0000-0000-000000000003','fresh',decode(repeat('cd',32),'hex'),'json',0,'ready','synthetic-fresh.export',0,repeat('cd',32),'{}');
commit;
do $$ begin
  if (select count(*) from likerts.workspaces)<>0 then raise exception 'Unscoped tenant read';end if;
  if has_table_privilege(current_user,'likerts.audit_events','UPDATE') then raise exception 'Audit mutation privilege';end if;
  if has_schema_privilege(current_user,'likerts','CREATE') then raise exception 'Runtime migration privilege';end if;
  if (select count(*) from likerts.resolve_service_credential(decode(repeat('ab',32),'hex')))<>1 then raise exception 'Credential resolver unavailable';end if;
  if (select count(*) from likerts.resolve_service_credential(decode(repeat('cd',32),'hex')))<>0 then raise exception 'Credential resolver exposed another token';end if;
end $$;
begin;
select set_config('likerts.workspace_id','render-tenant-a',true);
do $$ begin
  if (select count(*) from likerts.workspaces)<>1 then raise exception 'Tenant visibility';end if;
  begin
    insert into likerts.workspaces(id) values('render-cross-tenant');
    raise exception 'Cross-tenant insert succeeded';
  exception when insufficient_privilege then null;end;
end $$;
do $$ declare statement text; begin
  foreach statement in array array['select * from likerts.export_cleanup','select * from likerts.retention_schedule','select likerts.run_scheduled_retention()','select * from likerts.claim_export_cleanup()','select likerts.export_cleanup_status()','select likerts.retention_schedule_status()', 'select likerts.finish_export_cleanup(''synthetic-expired.export'',gen_random_uuid(),true)'] loop
    begin
      execute statement;
      raise exception 'Runtime accessed maintenance operation: %',statement;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
commit;
SQL
# Use TCP/password authentication as the restricted login, not SET ROLE or local trust.
docker exec -i -e PGPASSWORD=synthetic-cleanup-password "$container" psql -X -h 127.0.0.1 -U likerts_export_cleanup -d likerts -v ON_ERROR_STOP=1 <<'SQL'
begin;
select set_config('likerts.workspace_id','unrelated-worker-scope',true);
do $$ declare relation text; result jsonb; claim record; begin
  if session_user<>'likerts_export_cleanup' or current_user<>session_user then raise exception 'Cleanup login not authenticated directly'; end if;
  if exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls or rolinherit or rolcreaterole or rolcreatedb or rolreplication)) then raise exception 'Unsafe cleanup role'; end if;
  if exists(select 1 from pg_auth_members where member=current_user::regrole) then raise exception 'Cleanup role membership'; end if;
  foreach relation in array array['workspaces','responses','export_jobs','deletion_events','audit_events','service_credentials','export_cleanup','retention_schedule'] loop
    begin
      execute format('select * from likerts.%I',relation);
      raise exception 'Cleanup worker read raw table: %',relation;
    exception when insufficient_privilege then null; end;
  end loop;
  result:=likerts.run_scheduled_retention();
  if result<>jsonb_build_object('worked',true,'responsesErased',0,'exportsRevoked',1) then raise exception 'Expired export retention failed: %',result; end if;
  if current_setting('likerts.workspace_id')<>'unrelated-worker-scope' then raise exception 'Retention leaked tenant scope'; end if;
  result:=likerts.run_scheduled_retention();
  if result<>jsonb_build_object('worked',true,'responsesErased',0,'exportsRevoked',0) then raise exception 'Fresh tenant retention failed: %',result; end if;
  if likerts.run_scheduled_retention()<>jsonb_build_object('worked',false) then raise exception 'Retention schedule did not advance'; end if;
  if (likerts.retention_schedule_status()->>'dueWorkspaces')::integer<>0 then raise exception 'Scheduled status unavailable'; end if;
  select * into claim from likerts.claim_export_cleanup();
  if claim.object_key is distinct from 'synthetic-expired.export' or claim.lease_id is null then raise exception 'Expired object not claimable'; end if;
  if current_setting('likerts.workspace_id')<>'unrelated-worker-scope' then raise exception 'Cleanup claim leaked tenant scope'; end if;
  if likerts.finish_export_cleanup(claim.object_key,gen_random_uuid(),true) then raise exception 'Cleanup accepted incorrect lease'; end if;
  if not likerts.finish_export_cleanup(claim.object_key,claim.lease_id,true) then raise exception 'Cleanup could not finish its lease'; end if;
  if exists(select 1 from likerts.claim_export_cleanup()) then raise exception 'Cleanup claimed fresh or completed object'; end if;
  if (likerts.export_cleanup_status()->>'tombstones')::integer<>2 then raise exception 'Cleanup did not retain tombstones'; end if;
end $$;
commit;
SQL
docker exec -i "$container" psql -X -U likerts_runtime -d likerts -v ON_ERROR_STOP=1 <<'SQL'
begin;
select set_config('likerts.workspace_id','render-tenant-a',true);
do $$ begin
  if not exists(select 1 from likerts.export_jobs where status='revoked' and object_key is null) then raise exception 'Expired job not revoked'; end if;
  if (select count(*) from likerts.deletion_events where kind='export' and resource_id='00000000-0000-0000-0000-000000000002')<>1 then raise exception 'Export deletion journal missing'; end if;
end $$;
select set_config('likerts.workspace_id','render-tenant-b',true);
do $$ begin
  if not exists(select 1 from likerts.export_jobs where status='ready' and object_key='synthetic-fresh.export') then raise exception 'Fresh tenant export changed'; end if;
  if exists(select 1 from likerts.deletion_events) then raise exception 'Fresh tenant received deletion journal'; end if;
end $$;
commit;
SQL
docker exec -i "$container" psql -X -U likerts_webhook_worker -d likerts -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls or rolinherit or rolcreaterole or rolcreatedb)) then raise exception 'Unsafe worker';end if;
  if exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=current_user)) then raise exception 'Worker role membership';end if;
  perform count(*) from likerts.webhook_events;
  begin
    perform count(*) from likerts.responses;
    raise exception 'Worker accessed responses';
  exception when insufficient_privilege then null;end;
  begin
    perform count(*) from likerts.audit_events;
    raise exception 'Worker accessed audit';
  exception when insufficient_privilege then null;end;
end $$;
SQL
echo 'Render role gate PASS: non-superuser CREATEROLE owner, repeated bootstrap, canonical grants, forced tenant RLS, runtime maintenance/DDL/audit denial, authenticated cleanup retention/claim/lease/scope restoration and worker customer-data denial.'
