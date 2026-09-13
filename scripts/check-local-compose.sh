#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
export LIKERTS_LOCAL_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/likerts-local-check.XXXXXX")"
export LIKERTS_LOCAL_PROJECT="likerts-local-check-$(openssl rand -hex 6)"
# Docker chooses an available host port, always on loopback.
export LIKERTS_LOCAL_PORT=0
compose="$root/infrastructure/local/compose.sh"
cleanup() {
  result=$?
  if ! bash "$compose" down --volumes --remove-orphans >/dev/null 2>&1; then
    echo "Cleanup failed for isolated project $LIKERTS_LOCAL_PROJECT; inspect only that project." >&2
    result=1
  fi
  rm -rf "$LIKERTS_LOCAL_STATE_DIR" || result=1
  exit "$result"
}
trap cleanup EXIT
build=(--build)
if [ "${LIKERTS_SKIP_IMAGE_BUILD:-0}" = 1 ]; then build=(--no-build); fi
bash "$compose" config --quiet
bash "$compose" up --detach --wait --wait-timeout 120 "${build[@]}"
endpoint="$(bash "$compose" port api 8080)"
[[ "$endpoint" == 127.0.0.1:* ]]
database_container="$(bash "$compose" ps -q postgres)"
[ -z "$(docker port "$database_container")" ]
export LIKERTS_API_URL="http://$endpoint"
export LIKERTS_TOKEN="$(sed -n 's/^LIKERTS_LOCAL_TOKEN=//p' "$LIKERTS_LOCAL_STATE_DIR/.env")"
bash "$root/scripts/first-response.sh" > "$LIKERTS_LOCAL_STATE_DIR/receipt.json"
# Runtime identity stays restricted and cannot see rows without a tenant setting.
bash "$compose" exec -T postgres sh -ec 'PGPASSWORD="$LIKERTS_LOCAL_RUNTIME_PASSWORD" psql -h 127.0.0.1 -U likerts_runtime -d likerts -v ON_ERROR_STOP=1 -At' <<'SQL'
do $$ begin
  if exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole)) then raise exception 'unsafe runtime'; end if;
  if exists(select 1 from likerts.responses) then raise exception 'unscoped tenant rows visible'; end if;
end $$;
SQL
# Remove/recreate containers while retaining volumes: stronger than process restart.
bash "$compose" down
bash "$compose" up --detach --wait --wait-timeout 120 --no-build
endpoint="$(bash "$compose" port api 8080)"
[[ "$endpoint" == 127.0.0.1:* ]]
export LIKERTS_API_URL="http://$endpoint"
node --input-type=module - "$LIKERTS_LOCAL_STATE_DIR/receipt.json" <<'JS'
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(receipt.accepted, true);
assert.equal(receipt.idempotentRetry, true);
const reply = await fetch(`${process.env.LIKERTS_API_URL}/v1/responses?collectionId=${receipt.collectionId}&limit=10`, {
  headers: { Authorization: `Bearer ${process.env.LIKERTS_TOKEN}` }, signal: AbortSignal.timeout(5000),
});
assert.equal(reply.status, 200);
const response = (await reply.json()).items.find(item => item.receipt.responseId === receipt.responseId);
assert.ok(response, 'the original accepted response must survive recreation');
assert.equal(response.receipt.responseId, receipt.responseId);
assert.equal(response.answers.rating, 5);
console.log('Local Compose passed: loopback API, migration ordering, restricted runtime, first response, identical retry, and persistence after full container recreation.');
JS
