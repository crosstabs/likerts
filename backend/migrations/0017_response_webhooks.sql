-- Response callbacks only. Signing secrets are reconstructed from a separate runtime key;
-- only their SHA-256 digests and nonsecret generation UUIDs enter PostgreSQL.
create table likerts.webhook_endpoints (
    workspace_id text not null references likerts.workspaces(id),
    id uuid not null,
    url text not null check (length(url) between 1 and 2048),
    enabled boolean not null default false,
    key_id uuid not null,
    key_hash bytea not null check (octet_length(key_hash)=32),
    created_at timestamptz not null default now(),
    revoked_at timestamptz,
    primary key (workspace_id,id),
    check (revoked_at is null or not enabled)
);
create table likerts.webhook_events (
    workspace_id text not null,
    id uuid not null,
    response_id uuid not null,
    body text not null check (octet_length(body)<=4096 and jsonb_typeof(body::jsonb)='object'),
    created_at timestamptz not null,
    expires_at timestamptz not null,
    primary key(workspace_id,id),
    unique(workspace_id,response_id),
    foreign key(workspace_id,response_id) references likerts.responses(workspace_id,id) on delete cascade
);
create table likerts.webhook_deliveries (
    workspace_id text not null,
    id uuid not null,
    endpoint_id uuid not null,
    event_id uuid not null,
    status text not null default 'queued' check(status in ('queued','running','delivered','failed','cancelled')),
    attempts integer not null default 0 check(attempts between 0 and 7),
    replay_count integer not null default 0 check(replay_count between 0 and 3),
    next_attempt_at timestamptz not null default now(),
    lease_until timestamptz,
    current_attempt_id uuid,
    last_status integer check(last_status between 100 and 599),
    failure_code text check(length(failure_code)<=64),
    primary key(workspace_id,id),
    unique(workspace_id,endpoint_id,event_id),
    foreign key(workspace_id,endpoint_id) references likerts.webhook_endpoints(workspace_id,id) on delete cascade,
    foreign key(workspace_id,event_id) references likerts.webhook_events(workspace_id,id) on delete cascade
);
create index webhook_delivery_due on likerts.webhook_deliveries(next_attempt_at,id) where status in ('queued','running');
create unique index webhook_one_active_endpoint on likerts.webhook_deliveries(workspace_id,endpoint_id) where status='running';
create table likerts.webhook_attempts (
    workspace_id text not null,
    id uuid not null,
    delivery_id uuid not null,
    attempt_number integer not null check(attempt_number between 1 and 7),
    replay_count integer not null check(replay_count between 0 and 3),
    key_id uuid not null,
    key_hash bytea not null check(octet_length(key_hash)=32),
    signature_timestamp bigint not null,
    status text not null check(status in ('running','delivered','retry','failed','expired','cancelled')),
    http_status integer check(http_status between 100 and 599),
    failure_code text check(length(failure_code)<=64),
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    primary key(workspace_id,id),
    unique(workspace_id,delivery_id,replay_count,attempt_number),
    foreign key(workspace_id,delivery_id) references likerts.webhook_deliveries(workspace_id,id) on delete cascade
);
create table likerts.webhook_requests (
    workspace_id text not null references likerts.workspaces(id),
    operation text not null check(operation in ('create','rotate','replay')),
    idempotency_key text not null check(length(btrim(idempotency_key)) between 1 and 128),
    payload_hash bytea not null check(octet_length(payload_hash)=32),
    -- Endpoint/delivery snapshots and protected key references; never a signing secret.
    resource_id uuid not null,
    response jsonb not null check(jsonb_typeof(response)='object' and not response ? 'signingSecret'),
    key_id uuid,
    key_hash bytea check(key_hash is null or octet_length(key_hash)=32),
    created_at timestamptz not null default now(),
    primary key(workspace_id,operation,idempotency_key)
);

do $$
declare relation text;
begin
    foreach relation in array array['webhook_endpoints','webhook_events','webhook_deliveries','webhook_attempts','webhook_requests'] loop
        execute format('alter table likerts.%I enable row level security',relation);
        execute format('alter table likerts.%I force row level security',relation);
        execute format('create policy %I on likerts.%I for all using (current_user <> ''likerts_webhook_worker'' and workspace_id = nullif(current_setting(''likerts.workspace_id'', true), '''')) with check (current_user <> ''likerts_webhook_worker'' and workspace_id = nullif(current_setting(''likerts.workspace_id'', true), ''''))',relation||'_tenant',relation);
        execute format('revoke all on likerts.%I from public',relation);
    end loop;
end $$;
-- A distinct NOINHERIT/NOBYPASSRLS worker login is provisioned separately.
-- Its cross-workspace policies are limited to callback configuration and ID-only events.
create policy webhook_endpoints_worker_read on likerts.webhook_endpoints for select using(current_user='likerts_webhook_worker');
create policy webhook_events_worker_read on likerts.webhook_events for select using(current_user='likerts_webhook_worker');
create policy webhook_events_worker_cleanup on likerts.webhook_events for delete using(current_user='likerts_webhook_worker' and expires_at<=now());
create policy webhook_deliveries_worker_read on likerts.webhook_deliveries for select using(current_user='likerts_webhook_worker');
create policy webhook_deliveries_worker_update on likerts.webhook_deliveries for update using(current_user='likerts_webhook_worker') with check(current_user='likerts_webhook_worker');
create policy webhook_attempts_worker_read on likerts.webhook_attempts for select using(current_user='likerts_webhook_worker');
create policy webhook_attempts_worker_insert on likerts.webhook_attempts for insert with check(current_user='likerts_webhook_worker');
create policy webhook_attempts_worker_update on likerts.webhook_attempts for update using(current_user='likerts_webhook_worker') with check(current_user='likerts_webhook_worker');

create function likerts.enqueue_response_webhooks() returns trigger language plpgsql as $$
declare event_id uuid := gen_random_uuid();
    reference jsonb;
begin
    if not exists(select 1 from likerts.webhook_endpoints where workspace_id=new.workspace_id and enabled and revoked_at is null) then return new; end if;
    select jsonb_build_object('id',event_id,'type','response.accepted','eventVersion',1,'createdAt',new.accepted_at,
        'data',jsonb_build_object('responseId',new.id,'collectionId',new.collection_id,'surveyId',c.survey_id,'surveyVersion',c.version))
      into reference from likerts.collections c where c.workspace_id=new.workspace_id and c.id=new.collection_id;
    insert into likerts.webhook_events(workspace_id,id,response_id,body,created_at,expires_at)
        values(new.workspace_id,event_id,new.id,reference::text,new.accepted_at,new.accepted_at+interval '7 days');
    insert into likerts.webhook_deliveries(workspace_id,id,endpoint_id,event_id)
        select new.workspace_id,gen_random_uuid(),id,event_id from likerts.webhook_endpoints where workspace_id=new.workspace_id and enabled and revoked_at is null;
    return new;
end $$;
create trigger response_webhook_outbox after insert on likerts.responses for each row execute function likerts.enqueue_response_webhooks();

create function likerts.erase_response_webhooks() returns trigger language plpgsql as $$
begin
    if new.raw_deleted_at is not null then delete from likerts.webhook_events where workspace_id=new.workspace_id and response_id=new.id; end if;
    return new;
end $$;
create trigger response_webhook_erasure after update of raw_deleted_at on likerts.responses for each row execute function likerts.erase_response_webhooks();
create function likerts.revoke_workspace_webhooks() returns trigger language plpgsql as $$
begin
    if new.deleted_at is not null then
        delete from likerts.webhook_events where workspace_id=new.id;
        delete from likerts.webhook_endpoints where workspace_id=new.id;
        delete from likerts.webhook_requests where workspace_id=new.id;
    end if;
    return new;
end $$;
create trigger workspace_webhook_erasure after update of deleted_at on likerts.workspaces for each row execute function likerts.revoke_workspace_webhooks();
create trigger audit_webhook_endpoints after insert or update or delete on likerts.webhook_endpoints for each row execute function likerts.append_management_audit();
revoke all on function likerts.enqueue_response_webhooks() from public;
revoke all on function likerts.erase_response_webhooks() from public;
revoke all on function likerts.revoke_workspace_webhooks() from public;
