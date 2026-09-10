#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
container="likerts-webhook-isolation-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm --detach --name "$container" --env POSTGRES_PASSWORD=webhook-local-test -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi; sleep 1; done
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
cargo test --manifest-path "$root/backend/Cargo.toml" --locked --test credit_notifications -- --nocapture
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
node "$root/tests/webhooks.mjs"
