create schema if not exists likerts;

create table likerts.workspaces (
    id text primary key,
    created_at timestamptz not null default now(),
    check (length(btrim(id)) between 1 and 200)
);

create table likerts.surveys (
    workspace_id text not null references likerts.workspaces(id),
    id uuid not null,
    revision bigint not null check (revision > 0),
    title text not null check (length(btrim(title)) between 1 and 200),
    questions jsonb not null check (jsonb_typeof(questions) = 'array'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (workspace_id, id),
    unique (id)
);

create table likerts.survey_versions (
    workspace_id text not null,
    survey_id uuid not null,
    version bigint not null check (version > 0),
    title text not null check (length(btrim(title)) between 1 and 200),
    questions jsonb not null check (jsonb_typeof(questions) = 'array'),
    published_at timestamptz not null default now(),
    primary key (workspace_id, survey_id, version),
    foreign key (workspace_id, survey_id)
        references likerts.surveys(workspace_id, id)
);

create table likerts.collections (
    workspace_id text not null,
    id uuid not null,
    survey_id uuid not null,
    version bigint not null,
    placement text not null check (length(btrim(placement)) between 1 and 200),
    token_hash bytea not null check (octet_length(token_hash) = 32),
    accepting boolean not null default true,
    created_at timestamptz not null default now(),
    primary key (workspace_id, id),
    unique (id),
    unique (token_hash),
    foreign key (workspace_id, survey_id, version)
        references likerts.survey_versions(workspace_id, survey_id, version)
);

create index collections_workspace_created_idx
    on likerts.collections(workspace_id, created_at, id);

create table likerts.responses (
    workspace_id text not null,
    id uuid not null,
    collection_id uuid not null,
    idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 128),
    answers jsonb not null check (jsonb_typeof(answers) = 'object'),
    metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
    accepted_at timestamptz not null default now(),
    primary key (workspace_id, id),
    unique (id),
    unique (workspace_id, collection_id, idempotency_key),
    foreign key (workspace_id, collection_id)
        references likerts.collections(workspace_id, id)
);

create index responses_workspace_accepted_idx
    on likerts.responses(workspace_id, accepted_at, id);
create index responses_collection_accepted_idx
    on likerts.responses(workspace_id, collection_id, accepted_at, id);

create table likerts.usage_entries (
    workspace_id text not null,
    response_id uuid not null,
    amount_cents bigint not null check (amount_cents = 1),
    created_at timestamptz not null default now(),
    primary key (workspace_id, response_id),
    foreign key (workspace_id, response_id)
        references likerts.responses(workspace_id, id)
);

create index usage_entries_workspace_created_idx
    on likerts.usage_entries(workspace_id, created_at, response_id);

revoke all on schema likerts from public;
revoke all on all tables in schema likerts from public;
