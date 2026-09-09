create function likerts.append_management_audit() returns trigger
language plpgsql
as $$
declare
    record_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    workspace text;
    resource text;
    configured_actor text;
begin
    workspace := coalesce(record_data->>'workspace_id', record_data->>'id');
    resource := record_data->>'id';
    configured_actor := nullif(current_setting('likerts.actor_kind', true), '');
    if configured_actor is null or configured_actor not in ('human', 'service', 'development', 'system') then
        configured_actor := 'system';
    end if;
    insert into likerts.audit_events(
        workspace_id, request_id, actor_kind, actor_hash,
        action, resource_type, resource_id, outcome
    ) values (
        workspace,
        coalesce(nullif(current_setting('likerts.request_id', true), '')::uuid, gen_random_uuid()),
        configured_actor,
        case
            when nullif(current_setting('likerts.actor_hash', true), '') is null then null
            else decode(current_setting('likerts.actor_hash', true), 'hex')
        end,
        tg_table_name || '.' || lower(tg_op),
        tg_table_name,
        resource,
        'succeeded'
    );
    return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger audit_surveys
after insert or update or delete on likerts.surveys
for each row execute function likerts.append_management_audit();

create trigger audit_survey_versions
after insert or delete on likerts.survey_versions
for each row execute function likerts.append_management_audit();

create trigger audit_collections_create_delete
after insert or delete on likerts.collections
for each row execute function likerts.append_management_audit();

create trigger audit_collection_management_update
after update of accepting, revoked_at, allowed_origins, requests_per_minute on likerts.collections
for each row execute function likerts.append_management_audit();

create trigger audit_memberships
after insert or update or delete on likerts.workspace_memberships
for each row execute function likerts.append_management_audit();

create trigger audit_oauth_grants
after insert or update or delete on likerts.oauth_grants
for each row execute function likerts.append_management_audit();

create trigger audit_service_credentials
after insert or update or delete on likerts.service_credentials
for each row execute function likerts.append_management_audit();

create trigger audit_export_jobs
after insert or update or delete on likerts.export_jobs
for each row execute function likerts.append_management_audit();

create trigger audit_workspace_management_update
after update of retention_days, monthly_spend_cap_cents,
    unpaid_exposure_cap_cents, billing_paused, deleted_at
on likerts.workspaces
for each row execute function likerts.append_management_audit();

revoke all on function likerts.append_management_audit() from public;
