-- Process liveness only: no tenant, endpoint, payload, credential, host or provider data.
create table likerts.callback_worker_heartbeats (
    singleton boolean primary key default true check (singleton),
    heartbeat_at timestamptz not null
);
revoke all on likerts.callback_worker_heartbeats from public;

-- Only the directly authenticated restricted worker login can advance liveness.
-- The function accepts no caller values and uses the database clock exclusively.
create function likerts.record_callback_worker_heartbeat() returns void
language plpgsql security definer
set search_path = pg_catalog, likerts
as $$
declare observed_at timestamptz := clock_timestamp();
begin
    if session_user <> 'likerts_webhook_worker' then
        raise insufficient_privilege using message='callback heartbeat requires worker login';
    end if;
    insert into likerts.callback_worker_heartbeats(singleton,heartbeat_at)
    values(true,observed_at)
    on conflict(singleton) do update set heartbeat_at=excluded.heartbeat_at;
end $$;
revoke all on function likerts.record_callback_worker_heartbeat() from public;

-- The runtime sees one fixed classification through a separately authenticated
-- HTTP route, never the singleton row or its process metadata.
create function likerts.callback_worker_status() returns text
language sql security definer
set search_path = pg_catalog, likerts
as $$
    select case
        when max(heartbeat_at) is null then 'unavailable'
        when max(heartbeat_at) > clock_timestamp() then 'unavailable'
        when max(heartbeat_at) <= clock_timestamp() - interval '120 seconds' then 'stale'
        else 'reachable'
    end
    from likerts.callback_worker_heartbeats
$$;
revoke all on function likerts.callback_worker_status() from public;
