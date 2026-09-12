create table likerts.export_jobs (
    workspace_id text not null references likerts.workspaces(id),
    id uuid not null,
    idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 128),
    request_hash bytea not null check (octet_length(request_hash) = 32),
    format text not null check (format in ('csv','json')),
    collection_id uuid,
    accepted_from timestamptz,
    accepted_to timestamptz,
    upper_sequence bigint not null check (upper_sequence >= 0),
    status text not null check (status in ('queued','running','ready','failed','revoked')),
    object_key text,
    response_count bigint,
    content_sha256 text,
    manifest jsonb,
    error_code text,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '24 hours'),
    primary key (workspace_id,id), unique (id), unique (workspace_id,idempotency_key),
    check (accepted_to is null or accepted_from is null or accepted_from < accepted_to),
    check (expires_at > created_at),
    check ((status = 'ready') = (object_key is not null and response_count is not null and content_sha256 is not null and manifest is not null))
);
create index export_jobs_workspace_created_idx on likerts.export_jobs(workspace_id,created_at desc,id);
create unique index export_jobs_one_active_workspace_idx on likerts.export_jobs(workspace_id)
    where status in ('queued','running');
alter table likerts.export_jobs enable row level security;
alter table likerts.export_jobs force row level security;
create policy export_jobs_tenant on likerts.export_jobs for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));
revoke all on likerts.export_jobs from public;
