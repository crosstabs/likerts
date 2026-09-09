create table likerts.management_requests (
    workspace_id text not null references likerts.workspaces(id),
    operation text not null check (operation in ('surveys_create', 'collections_create')),
    idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 128),
    payload_hash bytea not null check (octet_length(payload_hash) = 32),
    response jsonb not null check (jsonb_typeof(response) = 'object'),
    created_at timestamptz not null default now(),
    primary key (workspace_id, operation, idempotency_key)
);

alter table likerts.management_requests enable row level security;
alter table likerts.management_requests force row level security;

create policy management_requests_tenant on likerts.management_requests
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

revoke all on likerts.management_requests from public;
