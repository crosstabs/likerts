#!/bin/sh
set -eu
: "${LIKERTS_MIGRATION_DATABASE_URL:?Owner database URL required only on the migration job}"
if [ "${LIKERTS_MANAGED_DATABASE_ROLES:-0}" != "1" ]; then
  : "${LIKERTS_BOOTSTRAP_RUNTIME_PASSWORD:?Initial API role password required}"
  : "${LIKERTS_BOOTSTRAP_WORKER_PASSWORD:?Initial worker role password required}"
fi
test -z "${DATABASE_URL:-}${LIKERTS_WEBHOOK_DATABASE_URL:-}${LIKERTS_COLLECTION_CREDENTIAL_KEY:-}${LIKERTS_WEBHOOK_CREDENTIAL_KEY:-}${LIKERTS_VERCEL_BLOB_TOKEN:-}" || { echo 'Application secrets forbidden on migration job' >&2; exit 1; }
case "$LIKERTS_MIGRATION_DATABASE_URL" in *'?sslmode=require'|*'?sslmode=verify-full') ;; *) echo 'Explicit database TLS mode required' >&2; exit 1;; esac
/usr/local/bin/likerts-migrate
# PGDATABASE avoids putting the owner DSN in process arguments. Suppress SQL error
# detail from general job logs: controlled operator diagnosis uses DB logs.
export PGDATABASE="$LIKERTS_MIGRATION_DATABASE_URL"
scripts="bootstrap.sql provision-runtime.sql provision-worker.sql"
if [ "${LIKERTS_MANAGED_DATABASE_ROLES:-0}" = "1" ]; then
  # Render creates managed login roles through its credential API. The grant
  # scripts still reject privileged roles, memberships, and object ownership.
  scripts="provision-runtime.sql provision-worker.sql"
fi
for script in $scripts; do
  if ! psql -X --set ON_ERROR_STOP=1 --set runtime_role=likerts_runtime --file="/opt/likerts/render/$script" >/dev/null 2>&1; then
    echo "Restricted database provisioning failed at $script; stop deployment" >&2
    exit 1
  fi
done
echo 'Migration and restricted role provisioning completed'
