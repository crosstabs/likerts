\set ON_ERROR_STOP on
begin;
set local likerts.workspace_id='webhook-a';
insert into likerts.workspaces(id) values('webhook-a');
set local likerts.workspace_id='webhook-b';
insert into likerts.workspaces(id) values('webhook-b');
commit;
insert into likerts.surveys(workspace_id,id,revision,title,questions) values
 ('webhook-a','00000000-0000-4000-8000-000000000001',1,'A','[]'),
 ('webhook-b','00000000-0000-4000-8000-000000000002',1,'B','[]');
insert into likerts.survey_versions(workspace_id,survey_id,version,title,questions,sdk_capabilities) select workspace_id,id,1,title,questions,'{"installations":[{"target":"web","sdkVersion":"0.0.1","schemaVersions":[1,2]}]}'::jsonb from likerts.surveys;
insert into likerts.collections(workspace_id,id,survey_id,version,placement,token_hash,sdk_capabilities) values
 ('webhook-a','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',1,'app',decode(repeat('a1',32),'hex'),'{"installations":[{"target":"web","sdkVersion":"0.0.1","schemaVersions":[1,2]}]}'),
 ('webhook-b','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002',1,'app',decode(repeat('b1',32),'hex'),'{"installations":[{"target":"web","sdkVersion":"0.0.1","schemaVersions":[1,2]}]}');
insert into likerts.webhook_endpoints(workspace_id,id,url,enabled,key_id,key_hash) values
 ('webhook-a','00000000-0000-4000-8000-000000000021','https://hooks.customer-a.com/',true,'00000000-0000-4000-8000-000000000031',decode(repeat('a2',32),'hex')),
 ('webhook-b','00000000-0000-4000-8000-000000000022','https://hooks.customer-b.com/',true,'00000000-0000-4000-8000-000000000032',decode(repeat('b2',32),'hex'));
insert into likerts.responses(workspace_id,id,collection_id,idempotency_key,answers,metadata) values
 ('webhook-a','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000011','once','{"private":"never deliver me"}','{"private":"never deliver me"}'),
 ('webhook-b','00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000012','once','{}','{}');
insert into likerts.responses(workspace_id,id,collection_id,idempotency_key,answers,metadata) values
 ('webhook-a','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000011','once','{}','{}') on conflict do nothing;
do $$ begin
    assert (select count(*) from likerts.webhook_events)=2,'events must deduplicate with response acceptance';
    assert (select count(*) from likerts.webhook_deliveries)=2,'one delivery per enabled endpoint';
    assert not exists(select 1 from likerts.webhook_events where body like '%private%' or body like '%never deliver%'),'events must contain references only';
end $$;
begin;
insert into likerts.responses(workspace_id,id,collection_id,idempotency_key,answers,metadata) values
 ('webhook-a','00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000011','rollback','{}','{}');
rollback;
do $$ begin assert (select count(*) from likerts.webhook_events)=2,'outbox must roll back with the response';end $$;
set role likerts_webhook_api_test;
begin;
set local likerts.workspace_id='webhook-a';
do $$ begin
    assert (select count(*) from likerts.webhook_events)=1,'runtime reads must remain tenant scoped';
    assert not exists(select 1 from likerts.webhook_endpoints where workspace_id='webhook-b'),'endpoint isolation';
    assert not pg_has_role(current_user,'likerts_webhook_worker','member'),'runtime cannot assume worker role';
end $$;
commit;
do $$ begin assert (select count(*) from likerts.webhook_events)=0,'runtime cannot discover worker-wide rows without tenant context';end $$;
reset role;
set role likerts_webhook_worker;
do $$ begin
    assert (select count(*) from likerts.webhook_events)=2,'worker may discover ID-only events';
    assert (select count(*) from likerts.webhook_deliveries)=2,'worker may discover pending deliveries';
    assert not has_table_privilege(current_user,'likerts.responses','select'),'worker cannot read responses';
    assert not has_table_privilege(current_user,'likerts.survey_versions','select'),'worker cannot read questions';
    assert not has_table_privilege(current_user,'likerts.usage_entries','select'),'worker cannot read response counters';
    assert not has_table_privilege(current_user,'likerts.workspace_memberships','select'),'worker cannot read identity';
    assert not has_table_privilege(current_user,'likerts.export_jobs','select'),'worker cannot read exports';
    assert not has_table_privilege(current_user,'likerts.audit_events','select'),'worker cannot read audit';
    assert not has_table_privilege(current_user,'likerts.webhook_endpoints','update'),'worker cannot alter endpoints or signing generations';
    assert not has_table_privilege(current_user,'likerts.webhook_requests','select'),'worker cannot reconstruct management idempotency references';
    assert not has_schema_privilege(current_user,'likerts','create'),'worker cannot migrate schema';
end $$;
begin;
set local likerts.workspace_id='webhook-a';
do $$ declare deleted integer; begin
    delete from likerts.webhook_events where expires_at>now();
    get diagnostics deleted = row_count;
    assert deleted=0,'worker must not gain tenant DELETE policy by setting workspace context';
end $$;
commit;
reset role;
update likerts.responses set answers=null,metadata=null,raw_deleted_at=now() where workspace_id='webhook-a';
do $$ begin assert (select count(*) from likerts.webhook_events)=1,'erasure removes pending event and delivery';end $$;
update likerts.workspaces set deleted_at=now() where id='webhook-b';
do $$ begin assert (select count(*) from likerts.webhook_events)=0,'workspace deletion removes pending callbacks';assert not exists(select 1 from likerts.webhook_endpoints where workspace_id='webhook-b'),'workspace deletion removes endpoint URLs and key references';end $$;
