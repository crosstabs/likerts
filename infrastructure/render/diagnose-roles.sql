\set ON_ERROR_STOP on
select r.rolname,
       r.rolcanlogin,
       r.rolsuper,
       r.rolinherit,
       r.rolcreaterole,
       r.rolcreatedb,
       r.rolbypassrls,
       (select count(*) from pg_auth_members m where m.member = r.oid) as memberships,
       exists(select 1 from pg_database d where d.datname = current_database() and d.datdba = r.oid) as owns_database,
       exists(select 1 from pg_namespace n where n.nspname = 'likerts' and n.nspowner = r.oid) as owns_schema,
       exists(select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'likerts' and c.relowner = r.oid) as owns_tables
from pg_roles r
where r.rolname in ('likerts_runtime', 'likerts_webhook_worker', 'likerts_migration_owner')
order by r.rolname;
