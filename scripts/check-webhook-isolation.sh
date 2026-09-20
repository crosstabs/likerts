#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
container="likerts-webhook-isolation-$$"
worker_pid=""
worker_log="$(mktemp "${TMPDIR:-/tmp}/likerts-webhook-worker.XXXXXX")"
cleanup() {
  if [ -n "$worker_pid" ]; then kill -KILL "$worker_pid" >/dev/null 2>&1 || true; wait "$worker_pid" >/dev/null 2>&1 || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -f "$worker_log"
}
trap cleanup EXIT
docker run --rm --detach --name "$container" --env POSTGRES_PASSWORD=webhook-local-test -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
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
  echo 'PostgreSQL webhook-test container did not become query-ready' >&2
  exit 1
fi
psql=(docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1)
for migration in "$root"/backend/migrations/*.sql; do "${psql[@]}" < "$migration" >/dev/null; done
"${psql[@]}" -c "create role likerts_webhook_worker login password 'webhook-local-test' noinherit nobypassrls nocreatedb nocreaterole; create role likerts_webhook_api_test login password 'webhook-local-test' noinherit nobypassrls nocreatedb nocreaterole;" >/dev/null
"${psql[@]}" < "$root/infrastructure/webhooks/provision-worker.sql" >/dev/null
"${psql[@]}" -v runtime_role=likerts_webhook_api_test < "$root/backend/provision-runtime.sql" >/dev/null
"${psql[@]}" -v runtime_role=likerts_webhook_api_test < "$root/infrastructure/webhooks/runtime-grants.sql" >/dev/null
"${psql[@]}" -c "grant usage on schema likerts to likerts_webhook_api_test;" >/dev/null
"${psql[@]}" < "$root/backend/tests/webhook_privileges.sql" >/dev/null
printf '%s\n' 'Webhook PostgreSQL isolation PASS: atomic outbox/dedup/rollback, tenant API, restricted worker, erasure cascades.'
port="$(docker port "$container" 5432/tcp | awk -F: '{print $NF}')"
source "$root/scripts/dev-env.sh"
export LIKERTS_WEBHOOK_TEST_ADMIN_URL="postgres://postgres:webhook-local-test@127.0.0.1:$port/postgres"
export LIKERTS_WEBHOOK_TEST_API_URL="postgres://likerts_webhook_api_test:webhook-local-test@127.0.0.1:$port/postgres"
export LIKERTS_WEBHOOK_TEST_WORKER_URL="postgres://likerts_webhook_worker:webhook-local-test@127.0.0.1:$port/postgres"
export LIKERTS_WEBHOOK_TEST_CONTAINER="$container"
cargo test --manifest-path "$root/backend/Cargo.toml" --locked --test webhook_unit --test webhook_lifecycle -- --nocapture
cargo build --manifest-path "$root/backend/Cargo.toml" --locked --bins
cargo build --manifest-path "$root/tools/cli/Cargo.toml" --locked
npm --prefix "$root/tools/mcp" ci --ignore-scripts
npm --prefix "$root/tools/mcp" run build
node "$root/contracts/check-release.mjs"
node "$root/contracts/generate-examples.mjs" --check
export LIKERTS_WEBHOOK_CREDENTIAL_KEY="$(openssl rand -base64 32 | tr -d '\n')"
LIKERTS_WEBHOOK_DATABASE_URL="$LIKERTS_WEBHOOK_TEST_WORKER_URL" LIKERTS_WEBHOOK_CHECK_CONFIG=1 "$root/backend/target/debug/likerts-webhook-worker"
if LIKERTS_WEBHOOK_DATABASE_URL="$LIKERTS_WEBHOOK_TEST_API_URL" LIKERTS_WEBHOOK_CHECK_CONFIG=1 "$root/backend/target/debug/likerts-webhook-worker" 2>/dev/null; then
  echo 'ERROR: API database identity could start the webhook worker' >&2;exit 1
fi

# A real forced process loss must stop freshness, then a replacement worker's
# first successful empty queue poll must recover it. Database time is aged by
# the fixture owner to avoid turning this deterministic gate into a 120s sleep.
callback_status() {
  docker exec -e PGPASSWORD=webhook-local-test "$container" psql -X -h 127.0.0.1 -U likerts_webhook_api_test -d postgres -Atqc 'select likerts.callback_worker_status()'
}
start_callback_worker() {
  LIKERTS_WEBHOOK_DATABASE_URL="$LIKERTS_WEBHOOK_TEST_WORKER_URL" \
    LIKERTS_WEBHOOK_CREDENTIAL_KEY="$LIKERTS_WEBHOOK_CREDENTIAL_KEY" \
    LIKERTS_WEBHOOK_CONCURRENCY=1 "$root/backend/target/debug/likerts-webhook-worker" >"$worker_log" 2>&1 &
  worker_pid=$!
  for _ in $(seq 1 40); do
    [ "$(callback_status)" = reachable ] && return 0
    kill -0 "$worker_pid" >/dev/null 2>&1 || { cat "$worker_log" >&2; return 1; }
    sleep 0.25
  done
  return 1
}
# The lifecycle test records through the worker role. Remove that fixture signal
# so this process-loss gate cannot pass on a heartbeat from an earlier process.
"${psql[@]}" -qc 'delete from likerts.callback_worker_heartbeats' >/dev/null
[ "$(callback_status)" = unavailable ] || { echo 'ERROR: callback heartbeat fixture did not reset' >&2; exit 1; }
start_callback_worker
heartbeat_before="$("${psql[@]}" -Atqc 'select extract(epoch from heartbeat_at)::text from likerts.callback_worker_heartbeats')"
[ -n "$heartbeat_before" ] || { echo 'ERROR: launched callback worker did not record heartbeat' >&2; exit 1; }
kill -KILL "$worker_pid"; wait "$worker_pid" >/dev/null 2>&1 || true; worker_pid=""
sleep 2
heartbeat_after="$("${psql[@]}" -Atqc 'select extract(epoch from heartbeat_at)::text from likerts.callback_worker_heartbeats')"
[ "$heartbeat_before" = "$heartbeat_after" ] || { echo 'ERROR: callback heartbeat advanced after worker termination' >&2; exit 1; }
"${psql[@]}" -qc "update likerts.callback_worker_heartbeats set heartbeat_at=clock_timestamp()-interval '120 seconds'" >/dev/null
[ "$(callback_status)" = stale ] || { echo 'ERROR: terminated callback worker did not become stale' >&2; exit 1; }
start_callback_worker
[ "$(callback_status)" = reachable ] || { echo 'ERROR: replacement callback worker did not recover liveness' >&2; exit 1; }
kill -KILL "$worker_pid"; wait "$worker_pid" >/dev/null 2>&1 || true; worker_pid=""
printf '%s\n' 'Callback liveness PASS: claim-gated freshness stops on SIGKILL, becomes stale, and recovers on replacement.'
node "$root/tests/webhooks.mjs"
