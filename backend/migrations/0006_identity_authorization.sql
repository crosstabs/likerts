create table likerts.workspace_memberships (
    workspace_id text not null references likerts.workspaces(id),
    subject text not null,
    role text not null check (role in ('owner', 'editor', 'reader')),
    granted_at timestamptz not null default now(),
    revoked_at timestamptz,
    primary key (workspace_id, subject),
    check (length(btrim(subject)) between 1 and 255)
);

create index workspace_memberships_subject_active_idx
    on likerts.workspace_memberships(subject, workspace_id)
    where revoked_at is null;

create table likerts.oauth_grants (
    workspace_id text not null references likerts.workspaces(id),
    id uuid not null,
    subject text not null,
    client_id text not null,
    audience text not null,
    scopes text[] not null,
    granted_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    primary key (workspace_id, id),
    unique (id),
    check (length(btrim(subject)) between 1 and 255),
    check (length(btrim(client_id)) between 1 and 255),
    check (length(btrim(audience)) between 1 and 500),
    check (cardinality(scopes) between 1 and 32),
    check (expires_at > granted_at)
);

create index oauth_grants_subject_active_idx
    on likerts.oauth_grants(subject, workspace_id, expires_at)
    where revoked_at is null;

create table likerts.service_credentials (
    workspace_id text not null references likerts.workspaces(id),
    id uuid not null,
    name text not null,
    token_hash bytea not null check (octet_length(token_hash) = 32),
    scopes text[] not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    primary key (workspace_id, id),
    unique (id),
    unique (token_hash),
    check (length(btrim(name)) between 1 and 100),
    check (cardinality(scopes) between 1 and 32),
    check (expires_at > created_at)
);

alter table likerts.workspace_memberships enable row level security;
alter table likerts.workspace_memberships force row level security;
alter table likerts.oauth_grants enable row level security;
alter table likerts.oauth_grants force row level security;
alter table likerts.service_credentials enable row level security;
alter table likerts.service_credentials force row level security;

create policy workspace_memberships_tenant on likerts.workspace_memberships
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

create policy oauth_grants_tenant on likerts.oauth_grants
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

create policy oauth_grants_capability_read on likerts.oauth_grants
    for select
    using (
        id::text = nullif(current_setting('likerts.oauth_grant_id', true), '')
    );

create policy service_credentials_tenant on likerts.service_credentials
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

create policy service_credentials_capability_read on likerts.service_credentials
    for select
    using (
        token_hash = decode(
            nullif(current_setting('likerts.service_token_hash', true), ''),
            'hex'
        )
    );

revoke all on likerts.workspace_memberships from public;
revoke all on likerts.oauth_grants from public;
revoke all on likerts.service_credentials from public;
