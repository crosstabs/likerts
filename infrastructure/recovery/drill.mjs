import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
const [base, db, network, image, output] = process.argv.slice(2);
assert.ok(base && db && network && image && output);
const oldToken='likerts-container-smoke-service-token-v1';
const newToken='synthetic-post-recovery-service-token-v1';
const recovered=`likerts_recovery_${process.pid}`;
const api=`likerts-recovered-api-${process.pid}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024,...options}).trim();
const sql=(query,database='likerts')=>docker(['exec',db,'psql','--username','postgres','--dbname',database,'--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--command',query]);
const request=async(origin,path,{token=oldToken,method='GET',body,status=200}={})=>{
  const response=await fetch(`${origin}${path}`,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const text=await response.text();assert.equal(response.status,status,`${path}: ${text}`);
  return text ? JSON.parse(text):null;
};
const capability={installations:[{target:'web',sdkVersion:'0.0.1',schemaVersions:[1,2]}]};
const survey=await request(base,'/v1/surveys',{method:'POST',status:201,body:{idempotencyKey:'recovery-survey',title:'Recovery fixture',questions:[{id:'score',label:'Score',type:'scale',min:1,max:5,required:true}]}});
const version=await request(base,`/v1/surveys/${survey.id}/publish`,{method:'POST',body:{revision:1,sdkCapabilities:capability}});
const collection=await request(base,'/v1/collections',{method:'POST',status:201,body:{idempotencyKey:'recovery-collection',surveyId:survey.id,version:version.version,placement:'recovery',sdkCapabilities:capability}});
const webhookEndpoint=randomUUID();
sql(`insert into likerts.webhook_endpoints(workspace_id,id,url,enabled,key_id,key_hash,event_types) values ('container-smoke','${webhookEndpoint}','https://hooks.customer.com/recovery',true,'${randomUUID()}',decode(repeat('01',32),'hex'),array['response.accepted','credits.threshold_reached'])`);
const first=await request(base,`/v1/collections/${collection.id}/responses`,{token:collection.token,method:'POST',body:{idempotencyKey:'delete-after-backup',answers:{score:1}}});
const second=await request(base,`/v1/collections/${collection.id}/responses`,{token:collection.token,method:'POST',body:{idempotencyKey:'retain-after-restore',answers:{score:5}}});
assert.equal(sql('select count(*) from likerts.webhook_events'),'2','accepted responses must enter the durable outbox before backup');
// The same backup must quarantine account events as well as response events.
sql("begin; select set_config('likerts.workspace_id','container-smoke',true); insert into likerts.response_credits(workspace_id,idempotency_key,kind,paid_delta,reason_code) values ('container-smoke','recovery-credit-grant','purchase',100,'recovery_fixture'); insert into likerts.response_credits(workspace_id,idempotency_key,kind,paid_delta,reason_code) values ('container-smoke','recovery-credit-deplete','correction',-100,'recovery_fixture'); commit");
assert.equal(sql("select count(*) from likerts.webhook_events where event_type='credits.threshold_reached'"),'3');
const notificationDigestQuery="select md5(string_agg(to_jsonb(s)::text,',' order by bucket)) from likerts.credit_notification_state s where workspace_id='container-smoke'";
const notificationDigest=sql(notificationDigestQuery);
const exported=await request(base,'/v1/exports',{method:'POST',status:202,body:{idempotencyKey:'recovery-export',format:'json'}});
for(let i=0;i<100;i++){
  const job=await request(base,`/v1/exports/${exported.id}`);
  if(job.status==='ready') break;
  assert.notEqual(job.status,'failed');
  await sleep(50);
}
await request(base,`/v1/exports/${exported.id}/download`);
// A second tenant's workspace-erasure journal must also redact its survey data.
const erasedWorkspace=`recovery-erased-${process.pid}`;
const erasedSurvey=randomUUID();
sql(`begin; select set_config('likerts.workspace_id','${erasedWorkspace}',true); insert into likerts.workspaces(id) values ('${erasedWorkspace}'); insert into likerts.surveys(workspace_id,id,revision,title,questions) values ('${erasedWorkspace}','${erasedSurvey}',1,'private workspace fixture','[]'); insert into likerts.survey_versions(workspace_id,survey_id,version,title,questions,sdk_capabilities) select '${erasedWorkspace}','${erasedSurvey}',1,'private workspace fixture','[]',sdk_capabilities from likerts.survey_versions where survey_id='${survey.id}' and version=1; commit`);
const creditDigestQuery="select md5(string_agg(to_jsonb(c)::text,',' order by workspace_id,id)) from likerts.response_credits c";
const creditDigest=sql(creditDigestQuery);
const creditEntries=Number(sql('select count(*) from likerts.response_credits'));
const auditMax=Number(sql('select coalesce(max(id),0) from likerts.audit_events'));
assert.ok(auditMax>0);
const auditDigestQuery=`select md5(string_agg(to_jsonb(a)::text,',' order by id)) from likerts.audit_events a where id<=${auditMax}`;
const auditDigest=sql(auditDigestQuery);
const auditText=sql('select json_agg(a)::text from likerts.audit_events a');
for(const forbidden of [oldToken,newToken,'Recovery fixture','private workspace fixture','delete-after-backup','retain-after-restore']) assert.ok(!auditText.includes(forbidden),'audit must not contain customer payload or tokens');
const started=performance.now();
docker(['exec',db,'pg_dump','--username','postgres','--dbname','likerts','--format=custom','--file=/tmp/likerts-recovery.dump']);
const backupMs=performance.now()-started;
const backupBytes=Number(docker(['exec',db,'stat','-c','%s','/tmp/likerts-recovery.dump']));
const permissions=sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='likerts' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity");
// This deletion intentionally occurs AFTER the base snapshot. Its independent
// journal must be replayed before a restored service is reachable.
sql("update likerts.service_credentials set scopes=array_append(scopes,'responses:write') where workspace_id='container-smoke'");
await request(base,`/v1/responses/${first.responseId}`,{method:'DELETE',status:204});
sql(`insert into likerts.deletion_events(workspace_id,id,kind,resource_id) values ('${erasedWorkspace}','${randomUUID()}','workspace','${erasedWorkspace}')`);
sql("copy likerts.deletion_events to '/tmp/likerts-recovery-deletions.csv' with (format csv,header true)");
const journalEvents=Number(sql('select count(*) from likerts.deletion_events'));
assert.ok(journalEvents>=2,'response deletion and export revocation should be journaled');
sql(`create database ${recovered} owner likerts_migrator`,'postgres');
let recoveryMs;
try{
  const restoreStart=performance.now();
  docker(['exec',db,'pg_restore','--username','postgres','--dbname',recovered,'--exit-on-error','--single-transaction','/tmp/likerts-recovery.dump']);
  assert.equal(sql(auditDigestQuery,recovered),auditDigest,'backup audit records must survive unchanged');
  assert.equal(sql(`select (answers is not null)::int from likerts.responses where id='${first.responseId}'`,recovered),'1','snapshot should predate erasure');
  const replay=await readFile(new URL('./replay.sql',import.meta.url),'utf8');
  docker(['exec','--interactive',db,'psql','--username','postgres','--dbname',recovered,'--set','ON_ERROR_STOP=1'],{input:replay});
  assert.equal(sql(auditDigestQuery,recovered),auditDigest,'quarantine must append without rewriting historical audit');
  assert.equal(sql("select (not has_table_privilege('likerts_runtime','likerts.audit_events','UPDATE') and not has_table_privilege('likerts_runtime','likerts.audit_events','DELETE') and has_function_privilege('likerts_runtime','likerts.append_management_audit()','EXECUTE'))::int",recovered),'1');
  assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(p.proacl) a where n.nspname='likerts' and p.proname='append_management_audit' and a.grantee=0",recovered),'0');
  assert.equal(sql(`select (answers is null and metadata is null)::int from likerts.responses where id='${first.responseId}'`,recovered),'1');
  assert.equal(sql(`select answers->>'score' from likerts.responses where id='${second.responseId}'`,recovered),'5');
  assert.equal(sql(`select (deleted_at is not null)::int from likerts.workspaces where id='${erasedWorkspace}'`,recovered),'1');
  assert.equal(sql(`select count(*) from likerts.surveys where workspace_id='${erasedWorkspace}' and title='[deleted]' and questions='[]'::jsonb`,recovered),'1');
  assert.equal(sql(`select count(*) from likerts.survey_versions where workspace_id='${erasedWorkspace}' and title='[deleted]' and questions='[]'::jsonb`,recovered),'1');
  assert.equal(sql('select count(*) from likerts.usage_entries',recovered),'2');
  assert.equal(sql(creditDigestQuery,recovered),creditDigest,'grants and consumptions survive restore and deletion replay unchanged');
  assert.equal(sql("select has_table_privilege('likerts_webhook_worker','likerts.response_credits','select')::int",recovered),'0');
  assert.equal(sql("select (not has_table_privilege('likerts_runtime','likerts.response_credits','UPDATE') and not has_table_privilege('likerts_runtime','likerts.response_credits','DELETE'))::int",recovered),'1');
  assert.equal(sql('select count(*) from likerts.webhook_events',recovered),'0','restored pending events are quarantined');
  assert.equal(sql(notificationDigestQuery,recovered),notificationDigest,'live workspace generation dedupe survives recovery');
  assert.equal(sql(`select count(*) from likerts.credit_notification_state where workspace_id='${erasedWorkspace}'`,recovered),'0','deleted workspace notification state is erased');
  for(const role of ['likerts_runtime','likerts_webhook_worker']) assert.equal(sql(`select has_table_privilege('${role}','likerts.credit_notification_state','select,insert,update,delete')::int`,recovered),'0','no balance-generation privilege added during recovery');

  assert.equal(sql(`select (not enabled and revoked_at is not null)::int from likerts.webhook_endpoints where id='${webhookEndpoint}'`,recovered),'1','restored endpoints cannot resume outbound delivery');
  assert.equal(sql("select has_table_privilege('likerts_webhook_worker','likerts.responses','select')::int",recovered),'0','worker remains unable to read restored answers');
  assert.equal(sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='likerts' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity",recovered),permissions);
  // Failed transactional DDL must not leave partial objects or advance SQLx state.
  const versions=sql('select count(*) from public._sqlx_migrations',recovered);
  const failed=spawnSync('docker',['exec',db,'psql','--username','postgres','--dbname',recovered,'--set','ON_ERROR_STOP=1','--command','begin; create table likerts.recovery_probe(id bigint); select 1/0; commit;'],{encoding:'utf8'});
  assert.notEqual(failed.status,0);
  assert.equal(sql("select (to_regclass('likerts.recovery_probe') is null)::int",recovered),'1');
  assert.equal(sql('select count(*) from public._sqlx_migrations',recovered),versions);
  const migrationUrl=new URL(process.env.LIKERTS_MIGRATION_DATABASE_URL);migrationUrl.pathname=`/${recovered}`;
  const migrationEnv={...process.env,LIKERTS_MIGRATION_DATABASE_URL:migrationUrl.toString()};
  const migrationArgs=['run','--rm','--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--env','LIKERTS_MIGRATION_DATABASE_URL','--entrypoint','/usr/local/bin/likerts-migrate',image];
  const originalChecksum=sql("select encode(checksum,'hex') from public._sqlx_migrations where version=1",recovered);
  sql("update public._sqlx_migrations set checksum=decode(repeat('00',48),'hex') where version=1",recovered);
  const mismatch=spawnSync('docker',migrationArgs,{encoding:'utf8',env:migrationEnv});assert.notEqual(mismatch.status,0,'checksum mismatch should block promotion');
  sql(`update public._sqlx_migrations set checksum=decode('${originalChecksum}','hex') where version=1`,recovered);
  docker(migrationArgs,{env:migrationEnv});
  // Only a fresh, synthetic post-reconciliation credential can read this copy.
  sql(`insert into likerts.service_credentials(workspace_id,id,name,token_hash,scopes,expires_at) values ('container-smoke','00000000-0000-4000-8000-000000000003','recovery fixture',sha256(convert_to('${newToken}','UTF8')),array['responses:read','usage:read','exports:read'],now()+interval '1 day')`,recovered);
  const runtimeUrl=new URL(process.env.DATABASE_URL);runtimeUrl.pathname=`/${recovered}`;
  docker(['run','--detach','--name',api,'--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/var/lib/likerts/exports:uid=10001,gid=10001,mode=0700','--publish','127.0.0.1::8080','--env','DATABASE_URL','--env','LIKERTS_ADMISSION_MODE=disabled','--env','LIKERTS_ALLOW_DEV_AUTH=1','--env','LIKERTS_COLLECTION_CREDENTIAL_KEY',image],{env:{...process.env,DATABASE_URL:runtimeUrl.toString()}});
  const port=docker(['port',api,'8080/tcp']).split(':').at(-1);
  const origin=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(`${origin}/health`)).ok){ready=true;break}}catch{}await sleep(50)}
  assert.ok(ready,'restored service health failed');
  await request(origin,'/v1/responses',{status:401});
  const page=await request(origin,'/v1/responses',{token:newToken});
  assert.equal(page.items.length,1);assert.equal(page.items[0].receipt.responseId,second.responseId);
  const usage=await request(origin,'/v1/usage',{token:newToken});assert.equal(usage.acceptedResponses,2);assert.equal(usage.chargedCents,2);assert.equal(usage.credits.promotionalCredits,998);assert.equal(usage.credits.promotionalResponses,2);assert.equal(usage.credits.paidCredits,0);assert.equal(usage.unpaidExposureCents,0);assert.equal(sql(creditDigestQuery,recovered),creditDigest,'usage read cannot reissue onboarding grant');
  await request(origin,`/v1/collections/${collection.id}`,{token:collection.token,status:410});
  await request(origin,`/v1/exports/${exported.id}/download`,{token:newToken,status:410});
  recoveryMs=performance.now()-restoreStart;
  const evidence={measuredAt:new Date().toISOString(),imageId:docker(['image','inspect',image,'--format','{{.Id}}']),postgresVersion:sql('show server_version'),backupBytes,backupMs:Math.round(backupMs),restoreAndVerificationMs:Math.round(recoveryMs),journalEvents,restoredAcceptedResponses:2,visibleResponsesAfterReplay:1,ledgerCents:2,creditEntriesPreserved:creditEntries,promotionalCreditsRemaining:998,forcedRlsTables:Number(permissions),appliedMigrations:Number(versions),checks:['logical backup/restore','post-backup deletion journal replay','old service/collection capabilities denied','restored exports revoked','restored response and credit notification endpoints and queues quarantined','credit notification dedupe retained and deleted workspace state erased','worker customer-data denial preserved','retained answer readable after new credential issuance','unchanged one-cent ledger','unchanged promotional grant and consumption ledger','onboarding grant remains idempotent after restore','runtime credit mutation and worker credit read denied','forced RLS preserved','failed transactional DDL rolls back','migration checksum mismatch blocks promotion','correct checksum reruns safely'],limitations:['Tiny local logical-dump fixture; not a managed snapshot/PITR or production RTO/RPO result.','Deletion journal is copied independently in this drill; durable off-database replication and lag monitoring remain a hosted implementation gate.','All restored auth grants/capabilities are quarantined; real identity and payment reconciliation are required before traffic resumes.','No production data or cloud resources were used.']};
  evidence.auditRowsPreserved=Number(sql(`select count(*) from likerts.audit_events where id<=${auditMax}`,recovered));
  evidence.checks.push('workspace deletion tombstone and survey/version redaction','audit rows preserved and runtime append-only grants retained','no public audit-trigger execution','no customer payload or tokens in audit fixture');
  await mkdir(dirname(output),{recursive:true});await writeFile(output,`${JSON.stringify(evidence,null,2)}\n`);
  console.log(`Recovery drill passed: ${backupBytes} backup bytes, ${Math.round(recoveryMs)} ms local restore/replay/verification, ${versions} migrations`);
}finally{
  spawnSync('docker',['rm','--force',api],{stdio:'ignore'});
  sql(`drop database ${recovered} with (force)`,'postgres');
}
