-- DRILL ONLY: quarantine the restored copy before it can receive traffic.
-- The independently captured journal must cover all deletions since the backup.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() !~ '^likerts_recovery_[a-z0-9_]+$' then
    raise exception 'recovery drill only accepts a likerts_recovery_* database';
  end if;
end $$;
begin;
create temporary table recovery_deletions (like likerts.deletion_events);
copy recovery_deletions from '/tmp/likerts-recovery-deletions.csv' with (format csv,header true);
insert into likerts.deletion_events select * from recovery_deletions
on conflict (workspace_id,kind,resource_id) do nothing;
update likerts.responses r
set answers=null,metadata=null,raw_deleted_at=coalesce(raw_deleted_at,now())
where exists (
  select 1 from recovery_deletions d where d.workspace_id=r.workspace_id
  and (d.kind='workspace' or (d.kind='response' and d.resource_id=r.id::text))
);
update likerts.workspaces w set deleted_at=coalesce(w.deleted_at,now())
where exists(select 1 from recovery_deletions d where d.workspace_id=w.id and d.kind='workspace');
update likerts.surveys s set title='[deleted]',questions='[]'::jsonb
where exists(select 1 from recovery_deletions d where d.workspace_id=s.workspace_id and d.kind='workspace');
update likerts.survey_versions s set title='[deleted]',questions='[]'::jsonb
where exists(select 1 from recovery_deletions d where d.workspace_id=s.workspace_id and d.kind='workspace');
-- Restored capabilities may have been revoked after the snapshot. Fail closed;
-- authoritative current membership/credential reconciliation precedes reopening.
delete from likerts.oauth_grants;
delete from likerts.service_credentials;
delete from likerts.workspace_memberships;
delete from likerts.management_requests;
update likerts.collections set accepting=false,revoked_at=coalesce(revoked_at,now());
update likerts.export_jobs
set status='revoked',object_key=null,response_count=null,content_sha256=null,manifest=null,error_code=null;
-- Quarantine restored callback destinations: a snapshot may predate revocation or key rotation.
-- Require newly provisioned endpoints after identity/receiver reconciliation; never resume an old queue.
update likerts.webhook_endpoints set enabled=false,revoked_at=coalesce(revoked_at,now());
-- Remove every restored response event so no historical callback is sent.
delete from likerts.webhook_events;
delete from likerts.webhook_requests;
commit;
