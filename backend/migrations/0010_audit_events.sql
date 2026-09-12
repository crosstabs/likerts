create table likerts.audit_events (
    workspace_id text not null references likerts.workspaces(id),
    id bigserial not null,
    request_id uuid not null,
    occurred_at timestamptz not null default now(),
    actor_kind text not null check (actor_kind in ('human', 'service', 'development', 'system')),
    actor_hash bytea check (actor_hash is null or octet_length(actor_hash) = 32),
    action text not null check (length(action) between 1 and 100),
    resource_type text not null check (length(resource_type) between 1 and 64),
    resource_id text check (resource_id is null or length(resource_id) between 1 and 255),
    outcome text not null check (outcome in ('succeeded', 'denied', 'failed')),
    primary key (workspace_id, id)
);

create index audit_events_workspace_time_idx
    on likerts.audit_events(workspace_id, occurred_at desc, id desc);

alter table likerts.audit_events enable row level security;
alter table likerts.audit_events force row level security;

create policy audit_events_tenant_read on likerts.audit_events
    for select
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

create policy audit_events_tenant_insert on likerts.audit_events
    for insert
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

revoke all on likerts.audit_events from public;
