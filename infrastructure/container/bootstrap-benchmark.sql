-- Expand only the disposable smoke fixture after its restricted-scope checks pass.
update likerts.service_credentials
set scopes = array['surveys:read','surveys:write','collections:write','responses:read','usage:read','exports:read','exports:write']
where workspace_id = 'container-smoke';
