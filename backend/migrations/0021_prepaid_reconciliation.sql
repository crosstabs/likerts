alter table likerts.credit_checkouts
    add column provider_payment_intent_id text
        check(provider_payment_intent_id is null or length(provider_payment_intent_id) between 1 and 255),
    add column provider_payment_intent_hash bytea
        check(provider_payment_intent_hash is null or octet_length(provider_payment_intent_hash)=32),
    add column purchase_credit_id uuid,
    add column provider_withheld_cents bigint not null default 0
        check(provider_withheld_cents between 0 and amount_cents),
    add foreign key(workspace_id,purchase_credit_id)
        references likerts.response_credits(workspace_id,id),
    add unique(provider_payment_intent_id),
    add unique(provider_payment_intent_hash),
    add check((provider_payment_intent_id is null)=(provider_payment_intent_hash is null));

alter table likerts.workspaces add column prepaid_dispute_open boolean not null default false;

create table likerts.credit_payment_objects (
    workspace_id text not null,
    checkout_id uuid not null,
    provider_object_id text not null check(length(provider_object_id) between 1 and 255),
    kind text not null check(kind in ('refund','dispute')),
    amount_cents bigint not null check(amount_cents>=0),
    currency text not null check(currency='usd'),
    status text not null check(length(status)<=64),
    updated_at timestamptz not null default now(),
    primary key(workspace_id,provider_object_id),
    unique(provider_object_id),
    foreign key(workspace_id,checkout_id)
        references likerts.credit_checkouts(workspace_id,id)
);

alter table likerts.credit_payment_objects enable row level security;
alter table likerts.credit_payment_objects force row level security;
create policy credit_payment_objects_tenant on likerts.credit_payment_objects for all
using(workspace_id=nullif(current_setting('likerts.workspace_id',true),''))
with check(workspace_id=nullif(current_setting('likerts.workspace_id',true),''));
revoke all on likerts.credit_payment_objects from public;

create policy credit_checkouts_payment_lookup on likerts.credit_checkouts for select
using(provider_payment_intent_hash=decode(nullif(current_setting('likerts.payment_intent_hash',true),''),'hex'));

-- Provider adjustments are the only credit entries allowed to express debt. They
-- are inserted only by the signed-event security-definer function below.
do $$ declare constraint_name text; begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid='likerts.response_credits'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop execute format('alter table likerts.response_credits drop constraint %I',constraint_name); end loop;
end; $$;
alter table likerts.response_credits
  add constraint response_credits_kind_v2 check(kind in ('grant','purchase','consumption','refund','reversal','correction','provider_adjustment')),
  add constraint response_credits_reference_v2 check((kind in ('refund','reversal','provider_adjustment'))=(reference_id is not null)),
  add constraint response_credits_consumption_response_v2 check((kind='consumption')=(response_id is not null)),
  add constraint response_credits_consumption_delta_v2 check(kind<>'consumption' or (promotional_delta=-1 and paid_delta=0) or (promotional_delta=0 and paid_delta=-1)),
  add constraint response_credits_grant_delta_v2 check(kind<>'grant' or (promotional_delta>0 and paid_delta=0)),
  add constraint response_credits_purchase_delta_v2 check(kind<>'purchase' or (paid_delta>0 and promotional_delta=0)),
  add constraint response_credits_refund_delta_v2 check(kind<>'refund' or (paid_delta<0 and promotional_delta=0 and reference_id is not null)),
  add constraint response_credits_provider_delta_v2 check(kind<>'provider_adjustment' or (paid_delta<>0 and promotional_delta=0 and reference_id is not null)),
  add constraint response_credits_reversal_reference_v2 check(kind<>'reversal' or reference_id is not null);

create or replace function likerts.guard_response_credit_insert() returns trigger language plpgsql as $$
declare
  promo bigint;
  paid bigint;
  original likerts.response_credits;
  already_refunded bigint;
  provider_withheld bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('billing:'||new.workspace_id,0));
  select coalesce(sum(r.promotional_delta),0),coalesce(sum(r.paid_delta),0)
    into promo,paid from likerts.response_credits r where r.workspace_id=new.workspace_id;
  if promo+new.promotional_delta<0 or (paid+new.paid_delta<0 and new.kind<>'provider_adjustment' and new.kind<>'purchase') then
    raise exception using errcode='P0001',message='response_credit_balance_exhausted';
  end if;
  if new.kind='consumption' and ((promo>0 and new.promotional_delta<>-1) or (promo=0 and new.paid_delta<>-1)) then
    raise exception using errcode='23514',message='response_credit_source_order';
  end if;
  if new.kind in ('refund','reversal','provider_adjustment') then
    select * into strict original from likerts.response_credits r where r.workspace_id=new.workspace_id and r.id=new.reference_id;
    if new.kind='reversal' and (new.promotional_delta<>-original.promotional_delta or new.paid_delta<>-original.paid_delta or original.kind in ('refund','reversal','consumption','provider_adjustment')
      or exists(select 1 from likerts.credit_checkouts c where c.workspace_id=new.workspace_id and c.purchase_credit_id=original.id)) then
      raise exception using errcode='23514',message='invalid_response_credit_reversal';
    end if;
    if new.kind='refund' then
      select coalesce(-sum(r.paid_delta),0) into already_refunded from likerts.response_credits r where r.workspace_id=new.workspace_id and r.reference_id=new.reference_id and r.kind='refund';
      if original.kind<>'purchase' or already_refunded-new.paid_delta>original.paid_delta
        or exists(select 1 from likerts.response_credits r where r.workspace_id=new.workspace_id and r.reference_id=new.reference_id and r.kind='reversal')
        or exists(select 1 from likerts.credit_checkouts c where c.workspace_id=new.workspace_id and c.purchase_credit_id=original.id) then
        raise exception using errcode='23514',message='invalid_response_credit_refund';
      end if;
    elsif new.kind='provider_adjustment' then
      select coalesce(-sum(r.paid_delta),0) into provider_withheld from likerts.response_credits r where r.workspace_id=new.workspace_id and r.reference_id=new.reference_id and r.kind='provider_adjustment';
      if original.kind<>'purchase' or provider_withheld-new.paid_delta<0 or provider_withheld-new.paid_delta>original.paid_delta then
        raise exception using errcode='23514',message='invalid_provider_credit_adjustment';
      end if;
    elsif exists(select 1 from likerts.response_credits r where r.workspace_id=new.workspace_id and r.reference_id=new.reference_id and r.kind in ('refund','provider_adjustment')) then
      raise exception using errcode='23514',message='adjusted_response_credit_cannot_reverse';
    end if;
  end if;
  return new;
end; $$;

create or replace function likerts.apply_credit_payment_event(
    session_hash bytea,
    payment_hash bytea,
    provider_event text,
    provider_event_type text,
    event_payload_hash bytea,
    provider_object text,
    event_amount bigint,
    event_currency text,
    event_status text,
    event_payment_status text,
    event_client_reference text
) returns table(workspace_id text,checkout_id uuid,checkout_status text)
language plpgsql security definer set search_path=pg_catalog,likerts as $$
declare checkout likerts.credit_checkouts; inserted bigint; purchase uuid; desired bigint; delta bigint; object_kind text; current_kind text; current_status text;
begin
  if octet_length(event_payload_hash)<>32 or event_amount<0 or event_currency<>'usd' then raise exception using errcode='23514',message='invalid_credit_payment_event';end if;
  if provider_event_type like 'checkout.session.%' then
    if session_hash is null or octet_length(session_hash)<>32 then raise exception using errcode='23514',message='invalid_checkout_event_hash';end if;
    perform set_config('likerts.checkout_session_hash',encode(session_hash,'hex'),true);
    select * into strict checkout from likerts.credit_checkouts where provider_session_hash=session_hash for update;
  else
    if payment_hash is null or octet_length(payment_hash)<>32 then raise exception using errcode='23514',message='invalid_payment_event_hash';end if;
    perform set_config('likerts.payment_intent_hash',encode(payment_hash,'hex'),true);
    select * into strict checkout from likerts.credit_checkouts where provider_payment_intent_hash=payment_hash for update;
  end if;
  perform set_config('likerts.workspace_id',checkout.workspace_id,true);
  perform pg_advisory_xact_lock(hashtextextended('billing:'||checkout.workspace_id,0));
  insert into likerts.credit_checkout_events(workspace_id,checkout_id,provider_event_id,event_type,payload_hash)
  values(checkout.workspace_id,checkout.id,provider_event,provider_event_type,event_payload_hash)
  on conflict(provider_event_id) do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then
    if not exists(select 1 from likerts.credit_checkout_events e where e.provider_event_id=provider_event and e.event_type=provider_event_type and e.payload_hash=event_payload_hash and e.checkout_id=checkout.id) then raise exception using errcode='23514',message='conflicting_credit_payment_event';end if;
    return query select checkout.workspace_id,checkout.id,(select cc.status from likerts.credit_checkouts cc where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id); return;
  end if;
  if provider_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    if event_client_reference<>checkout.id::text or event_amount<>checkout.amount_cents or payment_hash is null then raise exception using errcode='23514',message='checkout_event_mismatch';end if;
    update likerts.credit_checkouts cc set status='paid',provider_payment_intent_id=coalesce(cc.provider_payment_intent_id,provider_object),provider_payment_intent_hash=coalesce(cc.provider_payment_intent_hash,payment_hash),updated_at=now()
      where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id and (cc.provider_payment_intent_id is null or cc.provider_payment_intent_id=provider_object) and event_payment_status='paid';
    if event_payment_status<>'paid' then
      update likerts.credit_checkouts cc set provider_payment_intent_id=coalesce(cc.provider_payment_intent_id,provider_object),provider_payment_intent_hash=coalesce(cc.provider_payment_intent_hash,payment_hash),updated_at=now()
        where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id and provider_event_type='checkout.session.completed' and (cc.provider_payment_intent_id is null or cc.provider_payment_intent_id=provider_object);
    end if;
    if not found then raise exception using errcode='23514',message='checkout_payment_mismatch';end if;
    if event_payment_status='paid' then
      insert into likerts.response_credits(workspace_id,idempotency_key,kind,paid_delta,reason_code)
        values(checkout.workspace_id,'checkout:'||checkout.id,'purchase',checkout.response_credits,'stripe_checkout') on conflict do nothing;
      select r.id into strict purchase from likerts.response_credits r where r.workspace_id=checkout.workspace_id and r.idempotency_key='checkout:'||checkout.id;
      update likerts.credit_checkouts cc set purchase_credit_id=purchase where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id;
    elsif provider_event_type='checkout.session.async_payment_succeeded' then raise exception using errcode='23514',message='checkout_event_mismatch';
    end if;
  elsif provider_event_type in ('checkout.session.async_payment_failed','checkout.session.expired') then
    update likerts.credit_checkouts cc set status=case when provider_event_type='checkout.session.expired' then 'expired' else 'failed' end,updated_at=now()
      where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id and cc.status in ('pending','open');
  elsif provider_event_type like 'refund.%' or provider_event_type like 'charge.dispute.%' then
    if checkout.purchase_credit_id is null then raise exception using errcode='P0002',message='checkout_payment_not_bound';end if;
    object_kind=case when provider_event_type like 'refund.%' then 'refund' else 'dispute' end;
    if object_kind='refund' and event_status<>'pending' and event_status<>'requires_action' and event_status<>'succeeded' and event_status<>'failed' and event_status<>'canceled' then raise exception using errcode='23514',message='unsupported_refund_status';end if;
    if object_kind='dispute' and event_status<>'needs_response' and event_status<>'under_review' and event_status<>'won' and event_status<>'lost' and event_status<>'warning_needs_response' and event_status<>'warning_under_review' and event_status<>'warning_closed' then raise exception using errcode='23514',message='unsupported_dispute_status';end if;
    select o.kind,o.status into current_kind,current_status from likerts.credit_payment_objects o where o.workspace_id=checkout.workspace_id and o.provider_object_id=provider_object for update;
    if found then
      if current_kind<>object_kind or not exists(select 1 from likerts.credit_payment_objects o where o.workspace_id=checkout.workspace_id and o.provider_object_id=provider_object and o.checkout_id=checkout.id) then raise exception using errcode='23514',message='payment_object_mismatch';end if;
      update likerts.credit_payment_objects o set amount_cents=greatest(o.amount_cents,event_amount),updated_at=now() where o.workspace_id=checkout.workspace_id and o.provider_object_id=provider_object;
      if (current_kind='refund' and (
        current_status='pending' or current_status='requires_action'
        or (current_status='succeeded' and (event_status='failed' or event_status='canceled'))
      )) or (current_kind='dispute' and (
        current_status<>'won' and current_status<>'lost' and current_status<>'warning_closed'
        and not (
          (current_status='needs_response' or current_status='under_review')
          and (event_status='warning_needs_response' or event_status='warning_under_review' or event_status='warning_closed')
        )
      )) then update likerts.credit_payment_objects o set status=event_status where o.workspace_id=checkout.workspace_id and o.provider_object_id=provider_object;end if;
    else
      insert into likerts.credit_payment_objects(workspace_id,checkout_id,provider_object_id,kind,amount_cents,currency,status) values(checkout.workspace_id,checkout.id,provider_object,object_kind,event_amount,event_currency,event_status);
    end if;
    select least(checkout.amount_cents,coalesce(sum(case when (o.kind='refund' and o.status in ('pending','requires_action','succeeded')) or (o.kind='dispute' and o.status in ('needs_response','under_review','lost')) then o.amount_cents else 0 end),0)) into desired from likerts.credit_payment_objects o where o.workspace_id=checkout.workspace_id and o.checkout_id=checkout.id;
    delta=desired-checkout.provider_withheld_cents;
    if delta<>0 then
      insert into likerts.response_credits(workspace_id,idempotency_key,kind,paid_delta,reference_id,reason_code)
        values(checkout.workspace_id,'provider:'||provider_event,'provider_adjustment',-delta,checkout.purchase_credit_id,case when delta>0 then 'stripe_funds_withheld' else 'stripe_funds_reinstated' end);
    end if;
    update likerts.credit_checkouts cc set provider_withheld_cents=desired,updated_at=now() where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id;
    update likerts.workspaces w set prepaid_dispute_open=exists(select 1 from likerts.credit_payment_objects o where o.workspace_id=checkout.workspace_id and o.kind='dispute' and o.status in ('needs_response','under_review')) where w.id=checkout.workspace_id;
  else raise exception using errcode='23514',message='unsupported_credit_payment_event';
  end if;
  return query select checkout.workspace_id,checkout.id,(select cc.status from likerts.credit_checkouts cc where cc.workspace_id=checkout.workspace_id and cc.id=checkout.id);
end $$;

revoke all on function likerts.apply_credit_payment_event(bytea,bytea,text,text,bytea,text,bigint,text,text,text,text) from public;
create trigger audit_credit_payment_objects after insert or update on likerts.credit_payment_objects for each row execute function likerts.append_management_audit();
drop function likerts.apply_credit_checkout_event(bytea,text,text,bytea,bigint,text,text,text);
