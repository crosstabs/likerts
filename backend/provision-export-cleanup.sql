\set ON_ERROR_STOP on
-- Create the LOGIN role separately and set its password via a secret manager.
-- No answers, tenant tables or generic SQL execution privilege is granted.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='likerts_export_cleanup' and rolcanlogin and not (rolsuper or rolbypassrls or rolinherit or rolcreatedb or rolcreaterole or rolreplication)) then
    raise exception 'Create a restricted LOGIN NOINHERIT NOBYPASSRLS cleanup role first';
  end if;
  if exists(select 1 from pg_roles r where r.rolname='likerts_export_cleanup' and (
    exists(select 1 from pg_auth_members where member=r.oid) or
    exists(select 1 from pg_database where datname=current_database() and datdba=r.oid) or
    exists(select 1 from pg_namespace where nspname='likerts' and nspowner=r.oid) or
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='likerts' and p.proowner=r.oid) or
    exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='likerts' and c.relowner=r.oid))) then
    raise exception 'Cleanup role must not have memberships or own application objects';
  end if;
end $$;
revoke all on all tables in schema likerts from likerts_export_cleanup;
revoke all on all sequences in schema likerts from likerts_export_cleanup;
revoke all on all functions in schema likerts from likerts_export_cleanup;
revoke create on schema likerts from likerts_export_cleanup;
-- Table REVOKE does not remove separately granted column privileges.
do $$ declare relation record; columns text; begin
  for relation in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='likerts' and c.relkind in ('r','p','v','m','f') loop
    select string_agg(quote_ident(attname),',') into columns from pg_attribute where attrelid=relation.oid and attnum>0 and not attisdropped;
    if columns is not null then execute format('revoke all (%s) on table likerts.%I from likerts_export_cleanup',columns,relation.relname); end if;
  end loop;
end $$;
grant usage on schema likerts to likerts_export_cleanup;
grant connect on database :"DBNAME" to likerts_export_cleanup;
grant execute on function likerts.claim_export_cleanup(),likerts.finish_export_cleanup(text,uuid,boolean),likerts.export_cleanup_status() to likerts_export_cleanup;
grant execute on function likerts.run_scheduled_retention(),likerts.retention_schedule_status() to likerts_export_cleanup;
commit;
