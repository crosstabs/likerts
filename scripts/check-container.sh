#!/usr/bin/env bash
set -euo pipefail

LIKERTS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIKERTS_IMAGE="${LIKERTS_IMAGE:-likerts:container-check}"
SMOKE_PREFIX="likerts-container-$$"
DB_CONTAINER="${SMOKE_PREFIX}-db"
API_CONTAINER="${SMOKE_PREFIX}-api"
SMOKE_NETWORK="${SMOKE_PREFIX}-network"
EXPORT_VOLUME="${SMOKE_PREFIX}-exports"

cleanup() {
  if [ "$?" != 0 ]; then
    docker logs --tail 30 "$DB_CONTAINER" 2>/dev/null || true
    docker logs --tail 30 "$API_CONTAINER" 2>/dev/null || true
  fi
  docker rm --force --volumes "$API_CONTAINER" "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$EXPORT_VOLUME" >/dev/null 2>&1 || true
  docker network rm "$SMOKE_NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ "${LIKERTS_SKIP_IMAGE_BUILD:-0}" != 1 ]; then
  docker build --tag "$LIKERTS_IMAGE" "$LIKERTS_ROOT"
fi

docker network create "$SMOKE_NETWORK" >/dev/null
docker volume create "$EXPORT_VOLUME" >/dev/null
# These randomly generated credentials exist only in this isolated test network.
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export MIGRATOR_PASSWORD="$(openssl rand -hex 24)"
export RUNTIME_PASSWORD="$(openssl rand -hex 24)"
export WEBHOOK_PASSWORD="$(openssl rand -hex 24)"
export LIKERTS_WEBHOOK_CREDENTIAL_KEY="$(openssl rand -base64 32 | tr -d '\n')"
export LIKERTS_COLLECTION_CREDENTIAL_KEY="$(openssl rand -base64 32 | tr -d '\n')"
docker run --detach --name "$DB_CONTAINER" --network "$SMOKE_NETWORK" \
  --cpus "${LIKERTS_DB_CPUS:-1}" --memory "${LIKERTS_DB_MEMORY:-1536m}" \
  --env POSTGRES_PASSWORD postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$DB_CONTAINER" pg_isready --host 127.0.0.1 --username postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$DB_CONTAINER" pg_isready --host 127.0.0.1 --username postgres >/dev/null

# psql's literal quoting keeps credential values out of executable SQL syntax.
docker exec --interactive --env MIGRATOR_PASSWORD --env RUNTIME_PASSWORD --env WEBHOOK_PASSWORD "$DB_CONTAINER" \
  psql --username postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv migrator_password MIGRATOR_PASSWORD
\getenv runtime_password RUNTIME_PASSWORD
\getenv webhook_password WEBHOOK_PASSWORD
create role likerts_migrator login noinherit nobypassrls password :'migrator_password';
create role likerts_runtime login noinherit nobypassrls password :'runtime_password';
create role likerts_webhook_worker login noinherit nobypassrls nocreatedb nocreaterole password :'webhook_password';
create database likerts owner likerts_migrator;
SQL
export LIKERTS_MIGRATION_DATABASE_URL="postgres://likerts_migrator:${MIGRATOR_PASSWORD}@${DB_CONTAINER}:5432/likerts"
export DATABASE_URL="postgres://likerts_runtime:${RUNTIME_PASSWORD}@${DB_CONTAINER}:5432/likerts"

migrate() {
  docker run --rm --network "$SMOKE_NETWORK" --read-only --cap-drop ALL \
    --security-opt no-new-privileges --env LIKERTS_MIGRATION_DATABASE_URL \
    --entrypoint /usr/local/bin/likerts-migrate "$LIKERTS_IMAGE"
}
migrate
migrate # Already-applied migrations must be a safe no-op.
if docker exec --interactive --env PGPASSWORD="$MIGRATOR_PASSWORD" "$DB_CONTAINER" \
  psql --host 127.0.0.1 --username likerts_migrator --dbname likerts \
  < "$LIKERTS_ROOT/backend/provision-runtime.sql"; then
  printf '%s\n' 'ERROR: role provisioning accepted a missing runtime_role' >&2
  exit 1
fi
if docker exec --interactive --env PGPASSWORD="$MIGRATOR_PASSWORD" "$DB_CONTAINER" \
  psql --host 127.0.0.1 --username likerts_migrator --dbname likerts \
  --set runtime_role=postgres < "$LIKERTS_ROOT/backend/provision-runtime.sql"; then
  printf '%s\n' 'ERROR: role provisioning accepted a privileged role' >&2
  exit 1
fi
docker exec --interactive --env PGPASSWORD="$MIGRATOR_PASSWORD" "$DB_CONTAINER" \
  psql --host 127.0.0.1 --username likerts_migrator --dbname likerts \
  --set ON_ERROR_STOP=1 --set runtime_role=likerts_runtime < "$LIKERTS_ROOT/backend/provision-runtime.sql"
docker exec --interactive --env PGPASSWORD="$MIGRATOR_PASSWORD" "$DB_CONTAINER" \
  psql --host 127.0.0.1 --username likerts_migrator --dbname likerts \
  --set ON_ERROR_STOP=1 < "$LIKERTS_ROOT/infrastructure/webhooks/provision-worker.sql"
export LIKERTS_WEBHOOK_DATABASE_URL="postgres://likerts_webhook_worker:${WEBHOOK_PASSWORD}@${DB_CONTAINER}:5432/likerts"
docker run --rm --network "$SMOKE_NETWORK" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --env LIKERTS_WEBHOOK_DATABASE_URL --env LIKERTS_WEBHOOK_CREDENTIAL_KEY --env LIKERTS_WEBHOOK_CHECK_CONFIG=1 \
  --entrypoint /usr/local/bin/likerts-webhook-worker "$LIKERTS_IMAGE"
if docker run --rm --network "$SMOKE_NETWORK" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --env LIKERTS_WEBHOOK_DATABASE_URL="$DATABASE_URL" --env LIKERTS_WEBHOOK_CREDENTIAL_KEY --env LIKERTS_WEBHOOK_CHECK_CONFIG=1 \
  --entrypoint /usr/local/bin/likerts-webhook-worker "$LIKERTS_IMAGE"; then
  printf '%s\n' 'ERROR: API identity could start the webhook worker' >&2; exit 1
fi
docker exec --interactive "$DB_CONTAINER" psql --username postgres --dbname likerts \
  --set ON_ERROR_STOP=1 < "$LIKERTS_ROOT/infrastructure/container/bootstrap-smoke.sql"

# A deployment job with runtime credentials must fail instead of acquiring DDL privilege.
if docker run --rm --network "$SMOKE_NETWORK" --read-only --cap-drop ALL \
  --security-opt no-new-privileges --env LIKERTS_MIGRATION_DATABASE_URL="$DATABASE_URL" \
  --entrypoint /usr/local/bin/likerts-migrate "$LIKERTS_IMAGE"; then
  printf '%s\n' 'ERROR: runtime credential could run migrations' >&2
  exit 1
fi
# A missing durable configuration must fail immediately; no automatic memory fallback.
if docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges "$LIKERTS_IMAGE"; then
  printf '%s\n' 'ERROR: service started without durable storage' >&2
  exit 1
fi

start_api() {
  docker run --detach --name "$API_CONTAINER" --network "$SMOKE_NETWORK" \
    --cpus "${LIKERTS_API_CPUS:-0.5}" --memory "${LIKERTS_API_MEMORY:-1g}" \
    --read-only --cap-drop ALL --security-opt no-new-privileges \
    --mount "type=volume,source=${EXPORT_VOLUME},target=/var/lib/likerts/exports" \
    --publish 127.0.0.1::8080 --env DATABASE_URL \
    --env LIKERTS_COLLECTION_CREDENTIAL_KEY --env LIKERTS_WEBHOOK_CREDENTIAL_KEY \
    --env LIKERTS_MONITOR_TOKEN=synthetic-container-monitor-token-v1 "$LIKERTS_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$API_CONTAINER")" = healthy ]; then break; fi
    sleep 1
  done
  [ "$(docker inspect --format '{{.State.Health.Status}}' "$API_CONTAINER")" = healthy ]
  [ "$(docker exec "$API_CONTAINER" id -u)" = 10001 ]
  API_PORT="$(docker port "$API_CONTAINER" 8080/tcp | sed 's/.*://')"
}
start_api
node "$LIKERTS_ROOT/infrastructure/container/smoke.mjs" "http://127.0.0.1:${API_PORT}" create monitor
docker stop --time 5 "$API_CONTAINER" >/dev/null
[ "$(docker inspect --format '{{.State.ExitCode}}' "$API_CONTAINER")" = 0 ]
docker rm "$API_CONTAINER" >/dev/null
start_api
node "$LIKERTS_ROOT/infrastructure/container/smoke.mjs" "http://127.0.0.1:${API_PORT}" verify monitor

ROW_COUNT="$(docker exec --env PGPASSWORD="$RUNTIME_PASSWORD" "$DB_CONTAINER" \
  psql --host 127.0.0.1 --username likerts_runtime --dbname likerts --tuples-only --no-align \
  --command 'select count(*) from likerts.surveys')"
[ "$ROW_COUNT" = 0 ]
docker exec --interactive --env PGPASSWORD="$RUNTIME_PASSWORD" "$DB_CONTAINER" \
  psql --host 127.0.0.1 --username likerts_runtime --dbname likerts --set ON_ERROR_STOP=1 <<'SQL'
begin;
select set_config('likerts.workspace_id', 'container-smoke', true);
insert into likerts.audit_events (workspace_id,request_id,actor_kind,action,resource_type,outcome)
values ('container-smoke','00000000-0000-4000-8000-000000000002','system','container.check','survey','succeeded');
do $$ begin
  if not (
    has_table_privilege(current_user,'likerts.collection_rate_windows','SELECT') and
    has_table_privilege(current_user,'likerts.collection_rate_windows','INSERT') and
    has_table_privilege(current_user,'likerts.collection_rate_windows','UPDATE') and
    has_table_privilege(current_user,'likerts.collection_rate_windows','DELETE') and
    has_function_privilege(current_user,'likerts.append_management_audit()','EXECUTE')
  ) then raise exception 'missing exact runtime rate-window or audit-trigger grants'; end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    where n.nspname='likerts' and p.proname='append_management_audit' and a.grantee=0
  ) then raise exception 'audit trigger must not be executable by public'; end if;
end $$;
commit;
SQL
AUDIT_COUNT="$(docker exec --env PGPASSWORD="$RUNTIME_PASSWORD" "$DB_CONTAINER" \
  psql --host 127.0.0.1 --username likerts_runtime --dbname likerts --tuples-only --no-align \
  --command 'select count(*) from likerts.audit_events')"
[ "$AUDIT_COUNT" = 0 ]
for action in "update likerts.audit_events set action='tampered'" "delete from likerts.audit_events"; do
  if docker exec --env PGPASSWORD="$RUNTIME_PASSWORD" "$DB_CONTAINER" \
    psql --host 127.0.0.1 --username likerts_runtime --dbname likerts \
    --set ON_ERROR_STOP=1 --command "$action"; then
    printf '%s\n' 'ERROR: runtime role has mutable audit privileges' >&2
    exit 1
  fi
done
printf '%s\n' 'Container gate passed: separate migration/runtime roles, fail-closed startup, non-root read-only runtime, scope checks, graceful replacement, persistence, unscoped RLS denial and append-only audit grants.'

if [ -n "${LIKERTS_BENCHMARK_OUTPUT:-}" ]; then
  docker exec --interactive "$DB_CONTAINER" psql --username postgres --dbname likerts \
    --set ON_ERROR_STOP=1 < "$LIKERTS_ROOT/infrastructure/container/bootstrap-benchmark.sql"
  node "$LIKERTS_ROOT/infrastructure/container/benchmark.mjs" \
    "http://127.0.0.1:${API_PORT}" "$DB_CONTAINER" "$API_CONTAINER" "$LIKERTS_BENCHMARK_OUTPUT"
fi

if [ -n "${LIKERTS_RECOVERY_OUTPUT:-}" ]; then
  docker exec --interactive "$DB_CONTAINER" psql --username postgres --dbname likerts \
    --set ON_ERROR_STOP=1 < "$LIKERTS_ROOT/infrastructure/container/bootstrap-benchmark.sql"
  node "$LIKERTS_ROOT/infrastructure/recovery/drill.mjs" \
    "http://127.0.0.1:${API_PORT}" "$DB_CONTAINER" "$SMOKE_NETWORK" "$LIKERTS_IMAGE" "$LIKERTS_RECOVERY_OUTPUT"
fi
