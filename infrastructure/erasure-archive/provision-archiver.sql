\set ON_ERROR_STOP on
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='likerts_erasure_archiver' and rolcanlogin and not rolsuper and not rolbypassrls and not rolinherit and not rolcreatedb and not rolcreaterole) then
    raise exception 'Provision likerts_erasure_archiver as a restricted LOGIN NOINHERIT NOBYPASSRLS first';
  end if;
  if exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='likerts_erasure_archiver') then raise exception 'Archiver must not have role memberships'; end if;
  if exists(select 1 from pg_roles r where r.rolname='likerts_erasure_archiver' and (
    exists(select 1 from pg_database d where d.datname=current_database() and d.datdba=r.oid) or
    exists(select 1 from pg_namespace n where n.nspname='likerts' and n.nspowner=r.oid) or
    exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='likerts' and c.relowner=r.oid))) then raise exception 'Archiver must not own database, schema or tables'; end if;
end $$;
revoke all on all tables in schema likerts from likerts_erasure_archiver;
revoke all on all sequences in schema likerts from likerts_erasure_archiver;
revoke all on all functions in schema likerts from likerts_erasure_archiver;
revoke create on schema likerts from likerts_erasure_archiver;
grant connect on database :"DBNAME" to likerts_erasure_archiver;
grant usage on schema likerts to likerts_erasure_archiver;
grant execute on function likerts.erasure_archive_status(),likerts.claim_erasure_archive(),likerts.finish_erasure_archive(uuid,uuid,text),likerts.retry_erasure_archive(uuid,uuid),likerts.prepare_erasure_checkpoint(),likerts.finish_erasure_checkpoint(uuid,text),likerts.fence_erasure_source(uuid,text),likerts.release_erasure_source(uuid,uuid,text) to likerts_erasure_archiver;
commit;
