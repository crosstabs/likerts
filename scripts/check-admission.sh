#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
container="likerts-admission-test-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm --detach --name "$container" -p 127.0.0.1::6379 redis:7-alpine >/dev/null
for _ in $(seq 1 30); do if docker exec "$container" redis-cli ping >/dev/null 2>&1; then break; fi; sleep 1; done
export LIKERTS_ADMISSION_TEST_REDIS_PORT="$(docker port "$container" 6379/tcp | awk -F: '{print $NF}')"
source "$root/scripts/dev-env.sh"
cargo test --manifest-path "$root/backend/Cargo.toml" --locked --lib admission::tests
cargo build --manifest-path "$root/backend/Cargo.toml" --locked --bin likerts-server
node "$root/tests/admission.mjs"
