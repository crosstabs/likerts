#!/bin/sh
set -eu
: "${LIKERTS_MIGRATION_DATABASE_URL:?Owner database URL required only on the migration job}"
if [ "${LIKERTS_MANAGED_DATABASE_ROLES:-0}" != "1" ]; then
  : "${LIKERTS_BOOTSTRAP_RUNTIME_PASSWORD:?Initial API role password required}"
  : "${LIKERTS_BOOTSTRAP_WORKER_PASSWORD:?Initial worker role password required}"
fi
test -z "${LIKERTS_ADMISSION_REST_TOKEN:-}${DATABASE_URL:-}${LIKERTS_WEBHOOK_DATABASE_URL:-}${LIKERTS_COLLECTION_CREDENTIAL_KEY:-}${LIKERTS_WEBHOOK_CREDENTIAL_KEY:-}${LIKERTS_VERCEL_BLOB_TOKEN:-}${LIKERTS_STRIPE_SECRET_KEY:-}${LIKERTS_STRIPE_WEBHOOK_SECRET:-}${LIKERTS_STRIPE_LIVE_MODE:-}${LIKERTS_CHECKOUT_RETURN_ORIGIN:-}" || { echo 'Application secrets forbidden on migration job' >&2; exit 1; }
case "$LIKERTS_MIGRATION_DATABASE_URL" in *'?sslmode=require'|*'?sslmode=verify-full') ;; *) echo 'Explicit database TLS mode required' >&2; exit 1;; esac
/usr/local/bin/likerts-migrate
# Suppress SQL error detail from general job logs: controlled operator diagnosis
# uses database logs. The URI is read from the job-only environment.
scripts="bootstrap.sql provision-runtime.sql provision-worker.sql"
if [ "${LIKERTS_MANAGED_DATABASE_ROLES:-0}" = "1" ]; then
  # Render creates managed login roles through its credential API. The grant
  # scripts still reject privileged roles, memberships, and object ownership.
  scripts="provision-runtime.sql provision-worker.sql"
fi
for script in $scripts; do
  if ! psql -X --dbname="$LIKERTS_MIGRATION_DATABASE_URL" --set ON_ERROR_STOP=1 --set runtime_role=likerts_runtime --file="/opt/likerts/render/$script" >/dev/null 2>&1; then
    echo "Restricted database provisioning failed at $script; stop deployment" >&2
    exit 1
  fi
done
echo 'Migration and restricted role provisioning completed'
