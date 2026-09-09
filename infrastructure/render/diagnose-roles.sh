#!/bin/sh
set -eu
: "${LIKERTS_MIGRATION_DATABASE_URL:?Migration database URL required}"
export PGDATABASE="$LIKERTS_MIGRATION_DATABASE_URL"
exec psql -X --set ON_ERROR_STOP=1 --file=/opt/likerts/render/diagnose-roles.sql
