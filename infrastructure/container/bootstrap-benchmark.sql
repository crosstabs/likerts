-- Expand only the disposable smoke fixture after its restricted-scope checks pass.
update likerts.service_credentials
set scopes = array['surveys:read','surveys:write','collections:write','responses:read','usage:read','exports:read','exports:write']
where workspace_id = 'container-smoke';

-- Synthetic load is not a paid customer: explicitly raise both independent caps
-- so the benchmark measures collection capacity instead of the USD 5 default.
update likerts.workspaces
set monthly_spend_cap_cents=1000000,unpaid_exposure_cap_cents=1000000,billing_paused=false
where id='container-smoke';
