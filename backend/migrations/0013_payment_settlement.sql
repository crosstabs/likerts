create table likerts.billing_accounts (
    workspace_id text primary key references likerts.workspaces(id),
    provider_customer_id text not null check (length(provider_customer_id) between 1 and 255),
    provider_payment_method_id text not null check (length(provider_payment_method_id) between 1 and 255),
    configured_at timestamptz not null default now()
);

create table likerts.settlement_batches (
    workspace_id text not null references likerts.workspaces(id),
    id uuid not null,
    idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 128),
    amount_cents bigint not null check (amount_cents > 0),
    currency text not null default 'usd' check (currency = 'usd'),
    status text not null check (status in ('pending','submitted','succeeded','failed','refunded')),
    provider_intent_id text check (provider_intent_id is null or length(provider_intent_id) between 1 and 255),
    provider_intent_hash bytea check (provider_intent_hash is null or octet_length(provider_intent_hash) = 32),
    failure_code text check (failure_code is null or length(failure_code) between 1 and 100),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (workspace_id,id),
    unique (id),
    unique (workspace_id,idempotency_key),
    unique (provider_intent_id),
    check ((provider_intent_id is null) = (provider_intent_hash is null))
);

create table likerts.settlement_usage (
    workspace_id text not null,
    settlement_id uuid not null,
    response_id uuid not null,
    amount_cents bigint not null check (amount_cents = 1),
    primary key (workspace_id,response_id),
    foreign key (workspace_id,settlement_id) references likerts.settlement_batches(workspace_id,id),
    foreign key (workspace_id,response_id) references likerts.usage_entries(workspace_id,response_id)
);

create table likerts.payment_events (
    workspace_id text not null references likerts.workspaces(id),
    provider_event_id text not null check (length(provider_event_id) between 1 and 255),
    event_type text not null check (length(event_type) between 1 and 100),
    payload_hash bytea not null check (octet_length(payload_hash) = 32),
    received_at timestamptz not null default now(),
    processed_at timestamptz not null default now(),
    primary key (workspace_id,provider_event_id),
    unique (provider_event_id)
);

create table likerts.billing_adjustments (
    workspace_id text not null,
    id uuid not null,
    settlement_id uuid not null,
    kind text not null check (kind in ('refund','credit','debit')),
    amount_cents bigint not null check (amount_cents > 0),
    provider_reference text check (provider_reference is null or length(provider_reference) between 1 and 255),
    reason text not null check (length(btrim(reason)) between 1 and 500),
    created_at timestamptz not null default now(),
    primary key (workspace_id,id),
    unique (id),
    unique (provider_reference),
    foreign key (workspace_id,settlement_id) references likerts.settlement_batches(workspace_id,id)
);

create index settlement_batches_workspace_created_idx on likerts.settlement_batches(workspace_id,created_at,id);
create index payment_events_workspace_received_idx on likerts.payment_events(workspace_id,received_at,provider_event_id);
create index billing_adjustments_workspace_created_idx on likerts.billing_adjustments(workspace_id,created_at,id);

alter table likerts.billing_accounts enable row level security;
alter table likerts.billing_accounts force row level security;
alter table likerts.settlement_batches enable row level security;
alter table likerts.settlement_batches force row level security;
alter table likerts.settlement_usage enable row level security;
alter table likerts.settlement_usage force row level security;
alter table likerts.payment_events enable row level security;
alter table likerts.payment_events force row level security;
alter table likerts.billing_adjustments enable row level security;
alter table likerts.billing_adjustments force row level security;

create policy billing_accounts_tenant on likerts.billing_accounts for all using (workspace_id=nullif(current_setting('likerts.workspace_id',true),'')) with check (workspace_id=nullif(current_setting('likerts.workspace_id',true),''));
create policy settlement_batches_tenant on likerts.settlement_batches for all using (workspace_id=nullif(current_setting('likerts.workspace_id',true),'')) with check (workspace_id=nullif(current_setting('likerts.workspace_id',true),''));
create policy settlement_batches_provider_lookup on likerts.settlement_batches for select using (provider_intent_hash=decode(nullif(current_setting('likerts.payment_intent_hash',true),''),'hex'));
create policy settlement_usage_tenant on likerts.settlement_usage for all using (workspace_id=nullif(current_setting('likerts.workspace_id',true),'')) with check (workspace_id=nullif(current_setting('likerts.workspace_id',true),''));
create policy payment_events_tenant on likerts.payment_events for all using (workspace_id=nullif(current_setting('likerts.workspace_id',true),'')) with check (workspace_id=nullif(current_setting('likerts.workspace_id',true),''));
create policy billing_adjustments_tenant on likerts.billing_adjustments for all using (workspace_id=nullif(current_setting('likerts.workspace_id',true),'')) with check (workspace_id=nullif(current_setting('likerts.workspace_id',true),''));

revoke all on likerts.billing_accounts,likerts.settlement_batches,likerts.settlement_usage,likerts.payment_events,likerts.billing_adjustments from public;
