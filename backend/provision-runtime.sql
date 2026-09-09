-- Run as the database owner after creating a NOINHERIT, NOBYPASSRLS login role.
-- Example: psql --set=runtime_role=likerts_runtime --file=backend/provision-runtime.sql
\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
do $$ begin raise exception 'runtime_role psql variable is required'; end $$;
\endif

select exists (
    select 1 from pg_roles r
    where r.rolname = :'runtime_role'
      and r.rolcanlogin and not r.rolsuper and not r.rolbypassrls
      and not r.rolinherit and not r.rolcreaterole and not r.rolcreatedb
      and not exists (select 1 from pg_auth_members m where m.member = r.oid)
      and not exists (select 1 from pg_namespace n where n.nspname = 'likerts' and n.nspowner = r.oid)
      and not exists (select 1 from pg_database d where d.datname = current_database() and d.datdba = r.oid)
      and not exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'likerts' and c.relowner = r.oid
      )
) as safe_runtime_role \gset
\if :safe_runtime_role
\else
do $$ begin raise exception 'runtime role must be a restricted login without memberships or database/schema/table ownership'; end $$;
\endif

begin;
grant connect on database :"DBNAME" to :"runtime_role";
grant usage on schema likerts to :"runtime_role";
grant select, insert, update on likerts.workspaces to :"runtime_role";
grant select, insert, update on likerts.surveys to :"runtime_role";
grant select, insert, update on likerts.survey_versions to :"runtime_role";
grant select, insert, update on likerts.collections to :"runtime_role";
grant select, insert, update on likerts.responses to :"runtime_role";
grant select, insert on likerts.usage_entries to :"runtime_role";
grant select, insert, delete on likerts.management_requests to :"runtime_role";
grant select, insert, update on likerts.export_jobs to :"runtime_role";
grant select, insert, update, delete on likerts.workspace_memberships to :"runtime_role";
grant select, insert, update, delete on likerts.oauth_grants to :"runtime_role";
grant select, insert, update, delete on likerts.service_credentials to :"runtime_role";
grant select, insert on likerts.deletion_events to :"runtime_role";
grant select, insert, update on likerts.billing_accounts to :"runtime_role";
grant select, insert, update on likerts.settlement_batches to :"runtime_role";
grant select, insert on likerts.settlement_usage to :"runtime_role";
grant select, insert on likerts.payment_events to :"runtime_role";
grant select, insert on likerts.billing_adjustments to :"runtime_role";
grant select, insert on likerts.audit_events to :"runtime_role";
grant usage on sequence likerts.audit_events_id_seq to :"runtime_role";
grant select, insert, update, delete on likerts.collection_rate_windows to :"runtime_role";
grant execute on function likerts.append_management_audit() to :"runtime_role";
grant select, insert, update, delete on likerts.webhook_endpoints, likerts.webhook_events, likerts.webhook_deliveries, likerts.webhook_attempts, likerts.webhook_requests to :"runtime_role";
grant execute on function likerts.enqueue_response_webhooks(), likerts.erase_response_webhooks(), likerts.revoke_workspace_webhooks() to :"runtime_role";
grant select,insert on likerts.response_credits to :"runtime_role";
grant execute on function likerts.ensure_response_credit_onboarding(text), likerts.onboard_response_credits(), likerts.guard_response_credit_insert() to :"runtime_role";
commit;
