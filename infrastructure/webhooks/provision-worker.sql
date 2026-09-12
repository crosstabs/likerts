-- Credit threshold events are ID-only. Never grant response_credits or
-- credit_notification_state: balances and generation baselines remain private.
\set ON_ERROR_STOP on
begin;
do $$
begin
    if not exists(select 1 from pg_roles where rolname='likerts_webhook_worker' and rolcanlogin and not rolsuper and not rolbypassrls and not rolinherit and not rolcreatedb and not rolcreaterole) then
        raise exception 'Provision likerts_webhook_worker as LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE first';
    end if;
    if exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='likerts_webhook_worker') then
        raise exception 'Webhook worker must not have role memberships';
    end if;
    if exists(select 1 from pg_roles r where r.rolname='likerts_webhook_worker' and (
        exists(select 1 from pg_database d where d.datname=current_database() and d.datdba=r.oid) or
        exists(select 1 from pg_namespace n where n.nspname='likerts' and n.nspowner=r.oid) or
        exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='likerts' and c.relowner=r.oid))) then
        raise exception 'Webhook worker must not own its database, schema or tables';
    end if;
end $$;
revoke all on all tables in schema likerts from likerts_webhook_worker;
revoke all on all sequences in schema likerts from likerts_webhook_worker;
revoke all on all functions in schema likerts from likerts_webhook_worker;
revoke create on schema likerts from likerts_webhook_worker;
grant connect on database :"DBNAME" to likerts_webhook_worker;
grant usage on schema likerts to likerts_webhook_worker;
grant select on likerts.webhook_endpoints to likerts_webhook_worker;
grant select,delete on likerts.webhook_events to likerts_webhook_worker;
grant select,update on likerts.webhook_deliveries to likerts_webhook_worker;
grant select,insert,update on likerts.webhook_attempts to likerts_webhook_worker;
commit;
