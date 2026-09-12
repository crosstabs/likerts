begin;
select set_config('likerts.workspace_id','container-smoke',true);
-- Synthetic fixture, used only against the disposable smoke-test database.
insert into likerts.workspaces (id) values ('container-smoke');
insert into likerts.service_credentials (workspace_id, id, name, token_hash, scopes, expires_at)
values (
    'container-smoke', '00000000-0000-4000-8000-000000000001', 'container smoke',
    sha256(convert_to('likerts-container-smoke-service-token-v1', 'UTF8')),
    array['surveys:read', 'surveys:write'], now() + interval '1 day'
);

commit;
