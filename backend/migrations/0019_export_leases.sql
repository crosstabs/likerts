-- Existing interrupted attempts become eligible for an authorized status/retry
-- request. Deploy with old export workers drained: pre-lease binaries cannot claim.
alter table likerts.export_jobs add column lease_id uuid, add column lease_expires_at timestamptz;
alter table likerts.export_jobs add constraint export_running_requires_lease
  check(status<>'running' or (lease_id is not null and lease_expires_at is not null)) not valid;
-- NOT VALID permits pre-migration orphan rows under FORCE RLS. Every new write is
-- checked; claim/reaper treats a legacy NULL lease as expired without global reads.
create index export_jobs_workspace_lease_idx on likerts.export_jobs(workspace_id,lease_expires_at) where status='running';
-- Existing forced tenant RLS, exact runtime grants and mutation audit apply.
