\set ON_ERROR_STOP on
\getenv runtime_password LIKERTS_BOOTSTRAP_RUNTIME_PASSWORD
\getenv worker_password LIKERTS_BOOTSTRAP_WORKER_PASSWORD
-- Non-superuser owners can create these restricted roles. Never alter an existing
-- role's attributes to hide unsafe prior provisioning; canonical grants reject it.
select format('create role likerts_runtime login noinherit nobypassrls nocreatedb nocreaterole password %L', :'runtime_password')
where not exists(select 1 from pg_roles where rolname='likerts_runtime') \gexec
select format('create role likerts_webhook_worker login noinherit nobypassrls nocreatedb nocreaterole password %L', :'worker_password')
where not exists(select 1 from pg_roles where rolname='likerts_webhook_worker') \gexec
