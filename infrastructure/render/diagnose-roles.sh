#!/bin/sh
set -eu
: "${LIKERTS_MIGRATION_DATABASE_URL:?Migration database URL required}"
exec psql -X --dbname="$LIKERTS_MIGRATION_DATABASE_URL" --set ON_ERROR_STOP=1 --file=/opt/likerts/render/diagnose-roles.sql
