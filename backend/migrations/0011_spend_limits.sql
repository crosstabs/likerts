alter table likerts.workspaces
    add column monthly_spend_cap_cents bigint not null default 500
        check (monthly_spend_cap_cents between 0 and 1000000000),
    add column unpaid_exposure_cap_cents bigint not null default 500
        check (unpaid_exposure_cap_cents between 0 and 1000000000),
    add column billing_paused boolean not null default false;

create index usage_entries_workspace_month_idx
    on likerts.usage_entries(workspace_id, created_at)
    include (amount_cents);
