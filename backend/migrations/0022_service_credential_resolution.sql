-- Resolve the bearer credential before a workspace context exists. The runtime
-- role cannot safely discover that context through tenant RLS itself, so this
-- one-statement resolver establishes the capability context and exposes only
-- the workspace and scopes for one live credential hash. It runs with the
-- caller's privileges; FORCE RLS remains in effect.
create function likerts.resolve_service_credential(credential_hash bytea)
returns table(workspace_id text, scopes text[])
language plpgsql
volatile
security invoker
set search_path=pg_catalog,likerts
as $$
begin
    if octet_length(credential_hash)<>32 then
        return;
    end if;
    perform set_config('likerts.service_token_hash',encode(credential_hash,'hex'),true);
    return query
        select credential.workspace_id, credential.scopes
        from likerts.service_credentials credential
        where credential.token_hash=credential_hash
          and credential.revoked_at is null
          and credential.expires_at>now()
        limit 1;
end
$$;

revoke all on function likerts.resolve_service_credential(bytea) from public;
