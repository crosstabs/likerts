#!/bin/sh
set -eu
: "${LIKERTS_MIGRATION_DATABASE_URL:?Owner database URL required only on the migration job}"
[ "$#" -eq 2 ] || { echo 'usage: verify-export-reclaim.sh WORKSPACE IDEMPOTENCY_UUID' >&2; exit 2; }
workspace=$1
idempotency_key=$2
case "$workspace" in hosted-launch-export-[a-z0-9]*) ;; *) echo 'Invalid rehearsal workspace' >&2; exit 2;; esac
case "$workspace" in *[!a-z0-9-]*) echo 'Invalid rehearsal workspace' >&2; exit 2;; esac
[ "${#workspace}" -le 128 ] || { echo 'Invalid rehearsal workspace' >&2; exit 2; }
case "$idempotency_key" in ????????-????-????-????-????????????) ;; *) echo 'Invalid idempotency UUID' >&2; exit 2;; esac
case "$idempotency_key" in *[!a-fA-F0-9-]*) echo 'Invalid idempotency UUID' >&2; exit 2;; esac

query_job() {
  psql -X --dbname="$LIKERTS_MIGRATION_DATABASE_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align \
    --set workspace="$workspace" --set idempotency_key="$idempotency_key" <<'SQL'
-- complete_export clears lease_id. The durable winning lease is encoded in
-- object_key, never inferred from the cleared live lease column.
select status || '|' ||
  case when status='ready' then coalesce(split_part(object_key,'.',2),'')
       else coalesce(lease_id::text,'') end || '|' ||
  case when status='ready' and lease_id is null and lease_expires_at is null
    and object_key = id::text || '.' || split_part(object_key,'.',2) || '.export'
    and split_part(object_key,'.',2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then 't' else 'f' end
from likerts.export_jobs
where workspace_id=:'workspace' and idempotency_key=:'idempotency_key';
SQL
}

initial_lease=
attempt=0
while [ "$attempt" -lt 600 ]; do
  row=$(query_job)
  status=${row%%|*}
  remainder=${row#*|}
  lease=${remainder%%|*}
  if [ "$status" = running ] && [ -n "$lease" ]; then
    initial_lease=$lease
    break
  fi
  [ "$status" != ready ] || { echo 'Export completed before initial lease observation' >&2; exit 1; }
  attempt=$((attempt+1))
  sleep 0.1
done
[ -n "$initial_lease" ] || { echo 'Initial export lease not observed' >&2; exit 1; }

attempt=0
while [ "$attempt" -lt 720 ]; do
  row=$(query_job)
  status=${row%%|*}
  remainder=${row#*|}
  final_lease=${remainder%%|*}
  object_matches=${remainder#*|}
  if [ "$status" = ready ]; then
    [ "$object_matches" = t ] || { echo 'Published object is not fenced to the final lease' >&2; exit 1; }
    [ "$final_lease" != "$initial_lease" ] || { echo 'Export completed under its initial lease; no reclaim proved' >&2; exit 1; }
    echo 'Hosted export lease reclaim verified without disclosing lease identifiers'
    exit 0
  fi
  case "$status" in queued|running|'') ;; *) echo 'Export reached an unexpected terminal state' >&2; exit 1;; esac
  attempt=$((attempt+1))
  sleep 1
done
echo 'Timed out waiting for reclaimed export completion' >&2
exit 1
