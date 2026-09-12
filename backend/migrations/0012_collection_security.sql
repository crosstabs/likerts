alter table likerts.collections
    add column allowed_origins text[] not null default '{}'
        check (cardinality(allowed_origins) <= 20),
    add column requests_per_minute integer not null default 6000
        check (requests_per_minute between 1 and 100000);

create policy collections_origin_preflight on likerts.collections
    for select
    using (id::text = nullif(current_setting('likerts.collection_id', true), ''));

create table likerts.collection_rate_windows (
    workspace_id text not null,
    collection_id uuid not null,
    window_start timestamptz not null,
    attempts integer not null check (attempts between 1 and 1000000),
    primary key (workspace_id, collection_id, window_start),
    foreign key (workspace_id, collection_id)
        references likerts.collections(workspace_id, id) on delete cascade
);

create index collection_rate_windows_expiry_idx
    on likerts.collection_rate_windows(window_start);

alter table likerts.collection_rate_windows enable row level security;
alter table likerts.collection_rate_windows force row level security;

create policy collection_rate_windows_tenant on likerts.collection_rate_windows
    for all
    using (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''))
    with check (workspace_id = nullif(current_setting('likerts.workspace_id', true), ''));

revoke all on likerts.collection_rate_windows from public;
