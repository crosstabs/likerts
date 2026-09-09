alter table likerts.workspaces
    add column retention_days integer not null default 90 check (retention_days between 1 and 90),
    add column deleted_at timestamptz;

alter table likerts.responses
    add column payload_hash bytea check (payload_hash is null or octet_length(payload_hash) = 32),
    add column raw_deleted_at timestamptz,
    alter column answers drop not null,
    alter column metadata drop not null,
    add constraint responses_raw_erasure_consistent check (
        (answers is null and metadata is null and raw_deleted_at is not null)
        or (answers is not null and metadata is not null and raw_deleted_at is null)
    );

create index responses_retention_due_idx
    on likerts.responses(workspace_id,accepted_at,id)
    where raw_deleted_at is null;

create table likerts.deletion_events (
    workspace_id text not null references likerts.workspaces(id),
    id uuid not null,
    kind text not null check (kind in ('response','export','workspace')),
    resource_id text not null check (length(btrim(resource_id)) between 1 and 200),
    deleted_at timestamptz not null default now(),
    primary key (workspace_id,id),
    unique (id),
    unique (workspace_id,kind,resource_id)
);

create index deletion_events_workspace_deleted_idx
    on likerts.deletion_events(workspace_id,deleted_at,id);

alter table likerts.deletion_events enable row level security;
alter table likerts.deletion_events force row level security;
create policy deletion_events_tenant on likerts.deletion_events for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));
revoke all on likerts.deletion_events from public;
