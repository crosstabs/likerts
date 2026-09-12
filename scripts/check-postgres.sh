#!/usr/bin/env bash
set -euo pipefail

LIKERTS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER_NAME="likerts-postgres-test-$$"

cleanup() {
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm --detach \
  --name "$CONTAINER_NAME" \
  --env POSTGRES_PASSWORD=likerts-test \
  --publish 127.0.0.1::5432 \
  postgres:17-alpine >/dev/null

ready=0
for _ in $(seq 1 60); do
  if [ "$(docker exec "$CONTAINER_NAME" psql --username postgres --dbname postgres --quiet --tuples-only --no-align --command 'select 1' 2>/dev/null || true)" = "1" ]; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  docker logs "$CONTAINER_NAME" >&2
  echo 'PostgreSQL test container did not become query-ready' >&2
  exit 1
fi

docker exec "$CONTAINER_NAME" psql --username postgres --set ON_ERROR_STOP=1 \
  --command "create role likerts_runtime_test login password 'likerts-runtime-test' noinherit nobypassrls"

PORT="$(docker port "$CONTAINER_NAME" 5432/tcp | sed 's/.*://')"
export LIKERTS_TEST_DATABASE_URL="postgres://postgres:likerts-test@127.0.0.1:${PORT}/postgres"
export LIKERTS_TEST_RUNTIME_DATABASE_URL="postgres://likerts_runtime_test:likerts-runtime-test@127.0.0.1:${PORT}/postgres"
source "$LIKERTS_ROOT/scripts/dev-env.sh"

# Exercise the same migration and exact grants used by deployment. Keeping a
# second grant inventory in the Rust fixture silently drifts when triggers land.
LIKERTS_MIGRATION_DATABASE_URL="$LIKERTS_TEST_DATABASE_URL" \
  cargo run --manifest-path "$LIKERTS_ROOT/backend/Cargo.toml" --locked --bin likerts-migrate
docker exec -i "$CONTAINER_NAME" psql --username postgres --set ON_ERROR_STOP=1 \
  --set runtime_role=likerts_runtime_test < "$LIKERTS_ROOT/backend/provision-runtime.sql"

cargo build --manifest-path "$LIKERTS_ROOT/backend/Cargo.toml" --locked --bin likerts-server
cargo test --manifest-path "$LIKERTS_ROOT/backend/Cargo.toml" --locked --test postgres -- --test-threads=1
