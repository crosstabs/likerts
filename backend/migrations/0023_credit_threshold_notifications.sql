-- Explicitly opted-in account notifications share the durable signed delivery
-- transport, never a response ID. Existing endpoints remain response-only.
alter table likerts.webhook_endpoints add column event_types text[] not null default array['response.accepted']::text[];
alter table likerts.webhook_endpoints add constraint webhook_event_types check (
  array_ndims(event_types)=1 and array_position(event_types,null) is null and
  cardinality(event_types) between 1 and 2 and
  event_types <@ array['response.accepted','credits.threshold_reached']::text[] and
  not (cardinality(event_types)=2 and event_types[1]=event_types[2])
);
alter table likerts.webhook_events alter column response_id drop not null;
alter table likerts.webhook_events add column event_type text not null default 'response.accepted';
alter table likerts.webhook_events add column credit_bucket text;
alter table likerts.webhook_events add column credit_generation uuid;
alter table likerts.webhook_events add column credit_threshold integer;
alter table likerts.webhook_events add constraint webhook_event_reference check (
  (event_type='response.accepted' and response_id is not null and credit_bucket is null and credit_generation is null and credit_threshold is null)
  or (event_type='credits.threshold_reached' and response_id is null and credit_bucket is not null and credit_bucket in ('promotional','paid') and credit_generation is not null and credit_threshold is not null and credit_threshold in (80,90,100))
);
create unique index webhook_credit_threshold_once on likerts.webhook_events(workspace_id,credit_bucket,credit_generation,credit_threshold) where event_type='credits.threshold_reached';

-- At most two rows per workspace. A bucket's positive available-balance increase
-- starts its own generation; a paid top-up never resets promotional thresholds.
create table likerts.credit_notification_state (
  workspace_id text not null references likerts.workspaces(id),
  bucket text not null check(bucket in ('promotional','paid')),
  generation_id uuid not null,
  baseline bigint not null check(baseline>=0),
  high_water integer not null default 0 check(high_water in (0,80,90,100)),
  primary key(workspace_id,bucket)
);
alter table likerts.credit_notification_state enable row level security;
alter table likerts.credit_notification_state force row level security;
create policy credit_notification_state_tenant on likerts.credit_notification_state for all
  using(workspace_id=nullif(current_setting('likerts.workspace_id',true),''))
  with check(workspace_id=nullif(current_setting('likerts.workspace_id',true),''));
revoke all on likerts.credit_notification_state from public;

create or replace function likerts.enqueue_response_webhooks() returns trigger language plpgsql as $$
declare event_id uuid := gen_random_uuid(); reference jsonb;
begin
  if not exists(select 1 from likerts.webhook_endpoints where workspace_id=new.workspace_id and enabled and revoked_at is null and 'response.accepted'=any(event_types)) then return new; end if;
  select jsonb_build_object('id',event_id,'type','response.accepted','eventVersion',1,'createdAt',new.accepted_at,
    'data',jsonb_build_object('responseId',new.id,'collectionId',new.collection_id,'surveyId',c.survey_id,'surveyVersion',c.version))
    into reference from likerts.collections c where c.workspace_id=new.workspace_id and c.id=new.collection_id;
  insert into likerts.webhook_events(workspace_id,id,response_id,body,created_at,expires_at)
    values(new.workspace_id,event_id,new.id,reference::text,new.accepted_at,new.accepted_at+interval '7 days');
  insert into likerts.webhook_deliveries(workspace_id,id,endpoint_id,event_id)
    select new.workspace_id,gen_random_uuid(),id,event_id from likerts.webhook_endpoints
    where workspace_id=new.workspace_id and enabled and revoked_at is null and 'response.accepted'=any(event_types);
  return new;
end $$;

create function likerts.enqueue_credit_threshold_notifications() returns trigger
language plpgsql security definer set search_path=pg_catalog,likerts as $$
declare bucket_name text; delta bigint; raw_balance bigint; current_balance bigint; previous_balance bigint;
  state likerts.credit_notification_state; threshold integer; event_id uuid; reference jsonb;
  previous_workspace text := current_setting('likerts.workspace_id',true);
begin
  -- The triggering ledger INSERT already passed its RLS/owner boundary. Derive
  -- scope from that row so owner reconciliation and restore work under FORCE RLS.
  perform set_config('likerts.workspace_id',new.workspace_id,true);
  -- Existing credit guard holds this same transaction lock before insertion.
  perform pg_advisory_xact_lock(hashtextextended('billing:'||new.workspace_id,0));
  foreach bucket_name in array array['promotional','paid'] loop
    delta := case when bucket_name='promotional' then new.promotional_delta else new.paid_delta end;
    if delta=0 then continue; end if;
    select coalesce(sum(case when bucket_name='promotional' then promotional_delta else paid_delta end),0)
      into raw_balance from likerts.response_credits where workspace_id=new.workspace_id;
    current_balance := greatest(raw_balance,0);
    previous_balance := greatest(raw_balance-delta,0);
    select * into state from likerts.credit_notification_state where workspace_id=new.workspace_id and bucket=bucket_name for update;
    if not found then
      insert into likerts.credit_notification_state(workspace_id,bucket,generation_id,baseline)
        values(new.workspace_id,bucket_name,gen_random_uuid(),previous_balance) returning * into state;
    end if;
    if current_balance>previous_balance then
      update likerts.credit_notification_state set generation_id=gen_random_uuid(),baseline=current_balance,high_water=0
        where workspace_id=new.workspace_id and bucket=bucket_name;
      continue;
    end if;
    if state.baseline=0 then continue; end if;
    foreach threshold in array array[80,90,100] loop
      -- Decimal-free comparison. Refunds/reversals count as balance depletion,
      -- not as additional accepted or billed responses.
      if threshold>state.high_water and current_balance::numeric*100<=state.baseline::numeric*(100-threshold) then
        if exists(select 1 from likerts.webhook_endpoints where workspace_id=new.workspace_id and enabled and revoked_at is null and 'credits.threshold_reached'=any(event_types)) then
          event_id := gen_random_uuid();
          reference := jsonb_build_object('id',event_id,'type','credits.threshold_reached','eventVersion',1,'createdAt',new.created_at,
            'data',jsonb_build_object('workspaceId',new.workspace_id,'bucket',bucket_name,'generationId',state.generation_id,'thresholdPercent',threshold));
          insert into likerts.webhook_events(workspace_id,id,event_type,credit_bucket,credit_generation,credit_threshold,body,created_at,expires_at)
            values(new.workspace_id,event_id,'credits.threshold_reached',bucket_name,state.generation_id,threshold,reference::text,new.created_at,new.created_at+interval '7 days');
          insert into likerts.webhook_deliveries(workspace_id,id,endpoint_id,event_id)
            select new.workspace_id,gen_random_uuid(),id,event_id from likerts.webhook_endpoints
            where workspace_id=new.workspace_id and enabled and revoked_at is null and 'credits.threshold_reached'=any(event_types);
        end if;
        update likerts.credit_notification_state set high_water=threshold where workspace_id=new.workspace_id and bucket=bucket_name;
      end if;
    end loop;
  end loop;
  perform set_config('likerts.workspace_id',coalesce(previous_workspace,''),true);
  return new;
end $$;
create trigger credit_threshold_outbox after insert on likerts.response_credits for each row execute function likerts.enqueue_credit_threshold_notifications();

create function likerts.erase_credit_notification_state() returns trigger
language plpgsql security definer set search_path=pg_catalog,likerts as $$
declare previous_workspace text := current_setting('likerts.workspace_id',true);
begin
  if new.deleted_at is not null then
    -- Workspace mutation authorization precedes this trigger; no caller-selected
    -- tenant is accepted. Restore the connection's prior scope before returning.
    perform set_config('likerts.workspace_id',new.id,true);
    delete from likerts.credit_notification_state where workspace_id=new.id;
    perform set_config('likerts.workspace_id',coalesce(previous_workspace,''),true);
  end if;
  return new;
end $$;
create trigger workspace_credit_notification_erasure after update of deleted_at on likerts.workspaces for each row execute function likerts.erase_credit_notification_state();
revoke all on function likerts.enqueue_credit_threshold_notifications(),likerts.erase_credit_notification_state() from public;
