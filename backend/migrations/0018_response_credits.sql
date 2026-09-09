-- Append-only response credits. Gross one-cent usage remains immutable and is
-- not a second charge for responses funded by this ledger.
create table likerts.response_credits (
  workspace_id text not null references likerts.workspaces(id),
  id uuid not null default gen_random_uuid(),
  idempotency_key text not null check(length(btrim(idempotency_key)) between 1 and 128),
  kind text not null check(kind in ('grant','purchase','consumption','refund','reversal','correction')),
  promotional_delta bigint not null default 0,
  paid_delta bigint not null default 0,
  response_id uuid,
  reference_id uuid,
  reason_code text not null check(reason_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  primary key(workspace_id,id),
  unique(workspace_id,idempotency_key),
  foreign key(workspace_id,response_id) references likerts.responses(workspace_id,id),
  foreign key(workspace_id,reference_id) references likerts.response_credits(workspace_id,id),
  check(promotional_delta between -1000000000 and 1000000000 and paid_delta between -1000000000 and 1000000000),
  check((kind in ('refund','reversal'))=(reference_id is not null)),
  check(promotional_delta<>0 or paid_delta<>0),
  check((kind='consumption')=(response_id is not null)),
  check(kind<>'consumption' or (promotional_delta=-1 and paid_delta=0) or (promotional_delta=0 and paid_delta=-1)),
  check(kind<>'grant' or (promotional_delta>0 and paid_delta=0)),
  check(kind<>'purchase' or (paid_delta>0 and promotional_delta=0)),
  check(kind<>'refund' or (paid_delta<0 and promotional_delta=0 and reference_id is not null)),
  check(kind<>'reversal' or reference_id is not null)
);
create unique index response_credits_one_consumption on likerts.response_credits(workspace_id,response_id) where response_id is not null;
create unique index response_credits_one_reversal on likerts.response_credits(workspace_id,reference_id) where kind='reversal';
create index response_credits_balance on likerts.response_credits(workspace_id,created_at) include(promotional_delta,paid_delta);
alter table likerts.response_credits enable row level security;
alter table likerts.response_credits force row level security;
create policy response_credits_read on likerts.response_credits for select using(workspace_id=nullif(current_setting('likerts.workspace_id',true),''));
-- Runtime can debit one accepted response, but cannot mint/refund/correct credits.
create policy response_credits_insert on likerts.response_credits for insert with check(
  workspace_id=nullif(current_setting('likerts.workspace_id',true),'') and
  (kind='consumption' or current_user=pg_get_userbyid((select relowner from pg_class where oid='likerts.response_credits'::regclass)))
);
revoke all on likerts.response_credits from public;

create function likerts.guard_response_credit_insert() returns trigger language plpgsql as $$
declare promo bigint; paid bigint; original likerts.response_credits; already_refunded bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('billing:'||new.workspace_id,0));
  select coalesce(sum(promotional_delta),0),coalesce(sum(paid_delta),0) into promo,paid from likerts.response_credits where workspace_id=new.workspace_id;
  if promo+new.promotional_delta<0 or paid+new.paid_delta<0 then raise exception using errcode='P0001',message='response_credit_balance_exhausted';end if;
  if new.kind='consumption' and ((promo>0 and new.promotional_delta<>-1) or (promo=0 and new.paid_delta<>-1)) then raise exception using errcode='23514',message='response_credit_source_order';end if;
  if new.kind in ('refund','reversal') then
    select * into strict original from likerts.response_credits where workspace_id=new.workspace_id and id=new.reference_id;
    if new.kind='reversal' and (new.promotional_delta<>-original.promotional_delta or new.paid_delta<>-original.paid_delta or original.kind in ('refund','reversal','consumption')) then raise exception using errcode='23514',message='invalid_response_credit_reversal';end if;
    if new.kind='refund' then
      select coalesce(-sum(paid_delta),0) into already_refunded from likerts.response_credits where workspace_id=new.workspace_id and reference_id=new.reference_id and kind='refund';
      if original.kind<>'purchase' or already_refunded-new.paid_delta>original.paid_delta or exists(select 1 from likerts.response_credits where workspace_id=new.workspace_id and reference_id=new.reference_id and kind='reversal') then raise exception using errcode='23514',message='invalid_response_credit_refund';end if;
    elsif exists(select 1 from likerts.response_credits where workspace_id=new.workspace_id and reference_id=new.reference_id and kind='refund') then raise exception using errcode='23514',message='refunded_response_credit_cannot_reverse';end if;
  end if;
  return new;
end $$;
create trigger response_credit_guard before insert on likerts.response_credits for each row execute function likerts.guard_response_credit_insert();
create function likerts.reject_response_credit_mutation() returns trigger language plpgsql as $$ begin raise exception using errcode='42501',message='response_credit_ledger_is_append_only';end $$;
create trigger response_credit_immutable before update or delete on likerts.response_credits for each row execute function likerts.reject_response_credit_mutation();
create trigger audit_response_credits after insert on likerts.response_credits for each row execute function likerts.append_management_audit();

-- This is the only runtime-callable mint: fixed amount, fixed unique key, own live
-- workspace only. It also initializes older workspaces lazily without rewriting
-- their historical usage or bypassing forced RLS during migration.
create function likerts.ensure_response_credit_onboarding(workspace text) returns void
language plpgsql security definer set search_path=pg_catalog,likerts as $$
begin
  if workspace is distinct from nullif(current_setting('likerts.workspace_id',true),'') or not exists(select 1 from likerts.workspaces where id=workspace and deleted_at is null) then raise exception using errcode='42501',message='response_credit_workspace_denied';end if;
  perform pg_advisory_xact_lock(hashtextextended('billing:'||workspace,0));
  if not exists(select 1 from likerts.response_credits where workspace_id=workspace and idempotency_key='onboarding_v1') then
    insert into likerts.response_credits(workspace_id,idempotency_key,kind,promotional_delta,reason_code) values(workspace,'onboarding_v1','grant',1000,'onboarding');
  end if;
end $$;
create function likerts.onboard_response_credits() returns trigger language plpgsql as $$ begin perform likerts.ensure_response_credit_onboarding(new.id);return new;end $$;
create trigger workspace_response_credits after insert on likerts.workspaces for each row execute function likerts.onboard_response_credits();
revoke all on function likerts.guard_response_credit_insert(),likerts.reject_response_credit_mutation(),likerts.ensure_response_credit_onboarding(text),likerts.onboard_response_credits() from public;
