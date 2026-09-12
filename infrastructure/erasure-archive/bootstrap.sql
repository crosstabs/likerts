\set ON_ERROR_STOP on
\getenv archiver_password LIKERTS_BOOTSTRAP_ARCHIVER_PASSWORD
select format('create role likerts_erasure_archiver login noinherit nobypassrls nocreatedb nocreaterole password %L', :'archiver_password')
where not exists(select 1 from pg_roles where rolname='likerts_erasure_archiver') \gexec
