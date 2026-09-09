alter table likerts.collections
    add column expires_at timestamptz,
    add column response_cap bigint check (response_cap > 0),
    add column accepted_count bigint not null default 0 check (accepted_count >= 0),
    add column revoked_at timestamptz,
    add constraint collections_count_within_cap
        check (response_cap is null or accepted_count <= response_cap),
    add constraint collections_expiry_after_creation
        check (expires_at is null or expires_at > created_at);

create index collections_active_workspace_idx
    on likerts.collections(workspace_id, expires_at, id)
    where accepting and revoked_at is null;
