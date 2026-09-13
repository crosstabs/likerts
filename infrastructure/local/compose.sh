#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
state="${LIKERTS_LOCAL_STATE_DIR:-$root/.tools/local-compose}"
project="${LIKERTS_LOCAL_PROJECT:-likerts-local}"
if [[ ! "$project" =~ ^likerts-local(-[a-z0-9]+)*$ ]]; then
  echo 'Local project must be likerts-local or likerts-local-<lowercase suffix>.' >&2
  exit 1
fi
umask 077
mkdir -p "$state"
state="$(cd "$state" && pwd)"
if [ ! -e "$state/.env" ]; then
  # Never replace existing credentials: PostgreSQL volumes retain their passwords.
  (
    set -o noclobber
    {
      for name in POSTGRES_PASSWORD MIGRATOR_PASSWORD RUNTIME_PASSWORD TOKEN; do
        printf 'LIKERTS_LOCAL_%s=%s\n' "$name" "$(openssl rand -hex 32)"
      done
      for name in COLLECTION_KEY WEBHOOK_KEY; do
        printf 'LIKERTS_LOCAL_%s=%s\n' "$name" "$(openssl rand -base64 32 | tr -d '\n')"
      done
    } > "$state/.env"
  )
fi
if [ -n "${LIKERTS_COMPOSE_BIN:-}" ]; then
  compose=("$LIKERTS_COMPOSE_BIN")
else
  compose=(docker compose)
fi
exec "${compose[@]}" --project-name "$project" --env-file "$state/.env" --file "$root/compose.yaml" "$@"
