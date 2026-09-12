#!/bin/sh
set -eu
: "${LIKERTS_MIGRATION_DATABASE_URL:?Owner database URL required only on the migration job}"
[ "$#" -eq 3 ] || { echo 'usage: bootstrap-rehearsal.sh WORKSPACE CREDENTIAL_UUID TOKEN_SHA256' >&2; exit 2; }
workspace=$1
credential_id=$2
token_hash=$3
case "$workspace" in hosted-launch-[a-z0-9]*) ;; *) echo 'Invalid rehearsal workspace' >&2; exit 2;; esac
case "$credential_id" in ????????-????-????-????-????????????) ;; *) echo 'Invalid credential UUID' >&2; exit 2;; esac
case "$token_hash" in *[!0-9a-f]*|'') echo 'Invalid token digest' >&2; exit 2;; esac
[ "${#token_hash}" -eq 64 ] || { echo 'Invalid token digest' >&2; exit 2; }

psql -X --dbname="$LIKERTS_MIGRATION_DATABASE_URL" --set ON_ERROR_STOP=1 \
  --set workspace="$workspace" --set credential_id="$credential_id" --set token_hash="$token_hash" <<'SQL' >/dev/null
begin;
select set_config('likerts.workspace_id', :'workspace', true);
insert into likerts.workspaces(id) values(:'workspace');
insert into likerts.service_credentials(workspace_id,id,name,token_hash,scopes,expires_at)
values(
  :'workspace', :'credential_id', 'launch-rehearsal', decode(:'token_hash','hex'),
  array[
    'surveys:read','surveys:write','collections:write','responses:read','responses:write',
    'exports:read','exports:write','usage:read','identity:write',
    'webhooks:read','webhooks:write'
  ],
  now()+interval '2 hours'
);
commit;
SQL
echo 'Hosted rehearsal workspace provisioned'
