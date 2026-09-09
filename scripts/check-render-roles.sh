#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
container="likerts-render-roles-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm --detach --name "$container" --env POSTGRES_PASSWORD=render-role-test -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi; sleep 1; done
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c "create role likerts_render_owner login password 'render-role-test' createrole nocreatedb noinherit nobypassrls;" >/dev/null
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c "create database likerts owner likerts_render_owner;" >/dev/null
port="$(docker port "$container" 5432/tcp | awk -F: '{print $NF}')"
source "$root/scripts/dev-env.sh"
LIKERTS_MIGRATION_DATABASE_URL="postgres://likerts_render_owner:render-role-test@127.0.0.1:$port/likerts" cargo run --manifest-path "$root/backend/Cargo.toml" --locked --bin likerts-migrate
for _ in 1 2; do
  docker exec -i -e LIKERTS_BOOTSTRAP_RUNTIME_PASSWORD=synthetic-runtime-password -e LIKERTS_BOOTSTRAP_WORKER_PASSWORD=synthetic-worker-password "$container" psql -X -U likerts_render_owner -d likerts -v ON_ERROR_STOP=1 < "$root/infrastructure/render/bootstrap.sql" >/dev/null
  docker exec -i "$container" psql -X -U likerts_render_owner -d likerts -v ON_ERROR_STOP=1 -v runtime_role=likerts_runtime < "$root/backend/provision-runtime.sql" >/dev/null
  docker exec -i "$container" psql -X -U likerts_render_owner -d likerts -v ON_ERROR_STOP=1 < "$root/infrastructure/webhooks/provision-worker.sql" >/dev/null
done
docker exec -i "$container" psql -X -U likerts_runtime -d likerts -v ON_ERROR_STOP=1 <<'SQL'
begin;
select set_config('likerts.workspace_id','render-tenant-a',true);
insert into likerts.workspaces(id) values('render-tenant-a');
insert into likerts.service_credentials(workspace_id,id,name,token_hash,scopes,expires_at)
values('render-tenant-a','00000000-0000-0000-0000-000000000001','resolver-test',decode(repeat('ab',32),'hex'),array['surveys:read'],now()+interval '1 day');
commit;
begin;
select set_config('likerts.workspace_id','render-tenant-b',true);
insert into likerts.workspaces(id) values('render-tenant-b');
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
  perform likerts.ensure_response_credit_onboarding('render-tenant-a');
  if (select sum(promotional_delta) from likerts.response_credits)<>1000 or (select count(*) from likerts.response_credits)<>1 then raise exception 'Non-idempotent tenant grant';end if;
  begin
    insert into likerts.response_credits(workspace_id,idempotency_key,kind,paid_delta,reason_code) values('render-tenant-a','unauthorized','purchase',1,'test');
    raise exception 'Runtime minted paid credits';
  exception when insufficient_privilege then null;end;
  begin
    insert into likerts.workspaces(id) values('render-cross-tenant');
    raise exception 'Cross-tenant insert succeeded';
  exception when insufficient_privilege then null;end;
end $$;
commit;
SQL
docker exec -i "$container" psql -X -U likerts_webhook_worker -d likerts -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls or rolinherit or rolcreaterole or rolcreatedb)) then raise exception 'Unsafe worker';end if;
  if exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=current_user)) then raise exception 'Worker role membership';end if;
  perform count(*) from likerts.webhook_events;
  begin
    perform count(*) from likerts.response_credits;
    raise exception 'Worker accessed credits';
  exception when insufficient_privilege then null;end;
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
echo 'Render role gate PASS: non-superuser CREATEROLE owner, repeated bootstrap, canonical grants, forced tenant RLS, runtime DDL/audit denial and worker customer-data denial.'
