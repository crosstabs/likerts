create table likerts.credit_checkouts (
    workspace_id text not null references likerts.workspaces(id),
    id uuid not null,
    idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 128),
    amount_cents bigint not null check (amount_cents between 500 and 100000),
    response_credits bigint not null check (response_credits = amount_cents),
    status text not null check (status in ('pending','open','paid','failed','expired')),
    provider_session_id text check (provider_session_id is null or length(provider_session_id) between 1 and 255),
    provider_session_hash bytea check (provider_session_hash is null or octet_length(provider_session_hash) = 32),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (workspace_id,id),
    unique (id),
    unique (workspace_id,idempotency_key),
    unique (provider_session_id),
    check ((provider_session_id is null) = (provider_session_hash is null))
);

create table likerts.credit_checkout_events (
    workspace_id text not null,
    checkout_id uuid not null,
    provider_event_id text not null check (length(provider_event_id) between 1 and 255),
    event_type text not null check (length(event_type) between 1 and 100),
    payload_hash bytea not null check (octet_length(payload_hash) = 32),
    received_at timestamptz not null default now(),
    primary key (workspace_id,provider_event_id),
    unique (provider_event_id),
    foreign key (workspace_id,checkout_id) references likerts.credit_checkouts(workspace_id,id)
);

alter table likerts.credit_checkouts enable row level security;
alter table likerts.credit_checkouts force row level security;
alter table likerts.credit_checkout_events enable row level security;
alter table likerts.credit_checkout_events force row level security;

create policy credit_checkouts_tenant on likerts.credit_checkouts for all
using (workspace_id=nullif(current_setting('likerts.workspace_id',true),''))
with check (workspace_id=nullif(current_setting('likerts.workspace_id',true),''));
create policy credit_checkouts_provider_lookup on likerts.credit_checkouts for select
using (provider_session_hash=decode(nullif(current_setting('likerts.checkout_session_hash',true),''),'hex'));
create policy credit_checkout_events_tenant on likerts.credit_checkout_events for all
using (workspace_id=nullif(current_setting('likerts.workspace_id',true),''))
with check (workspace_id=nullif(current_setting('likerts.workspace_id',true),''));

revoke all on likerts.credit_checkouts,likerts.credit_checkout_events from public;

create function likerts.apply_credit_checkout_event(
    session_hash bytea,
    provider_event text,
    provider_event_type text,
    event_payload_hash bytea,
    event_amount bigint,
    event_currency text,
    event_payment_status text,
    event_client_reference text
) returns table(workspace_id text, checkout_id uuid, checkout_status text)
language plpgsql security definer set search_path=pg_catalog,likerts as $$
declare
    checkout likerts.credit_checkouts;
    inserted bigint;
begin
    if octet_length(session_hash) <> 32 or octet_length(event_payload_hash) <> 32 then
        raise exception using errcode='23514',message='invalid_checkout_event_hash';
    end if;
    perform set_config('likerts.checkout_session_hash',encode(session_hash,'hex'),true);
    select * into strict checkout from likerts.credit_checkouts where provider_session_hash=session_hash for update;
    if event_client_reference<>checkout.id::text then
        raise exception using errcode='23514',message='checkout_reference_mismatch';
    end if;
    perform set_config('likerts.workspace_id',checkout.workspace_id,true);
    insert into likerts.credit_checkout_events(workspace_id,checkout_id,provider_event_id,event_type,payload_hash)
    values(checkout.workspace_id,checkout.id,provider_event,provider_event_type,event_payload_hash)
    on conflict(provider_event_id) do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
        if provider_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
            if event_currency<>'usd' or event_amount<>checkout.amount_cents then
                raise exception using errcode='23514',message='checkout_event_mismatch';
            end if;
            if event_payment_status='paid' then
                update likerts.credit_checkouts as cc set status='paid',updated_at=now()
                where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id and cc.status in ('pending','open');
                insert into likerts.response_credits(workspace_id,idempotency_key,kind,paid_delta,reason_code)
                values(checkout.workspace_id,'checkout:'||checkout.id,'purchase',checkout.response_credits,'stripe_checkout')
                on conflict do nothing;
            elsif provider_event_type='checkout.session.async_payment_succeeded' then
                raise exception using errcode='23514',message='checkout_event_mismatch';
            end if;
        elsif provider_event_type in ('checkout.session.async_payment_failed','checkout.session.expired') then
            update likerts.credit_checkouts as cc
            set status=case when provider_event_type='checkout.session.expired' then 'expired' else 'failed' end,updated_at=now()
            where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id and cc.status in ('pending','open');
        end if;
    end if;
    return query select checkout.workspace_id,checkout.id,
        (select cc.status from likerts.credit_checkouts cc where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id);
end $$;

revoke all on function likerts.apply_credit_checkout_event(bytea,text,text,bytea,bigint,text,text,text) from public;
create trigger audit_credit_checkouts after insert or update on likerts.credit_checkouts
for each row execute function likerts.append_management_audit();
