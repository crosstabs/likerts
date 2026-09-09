import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';

const [phase,statePath,evidencePath]=process.argv.slice(2);
const base=process.env.LIKERTS_REHEARSAL_BASE_URL;
const managementToken=process.env.LIKERTS_REHEARSAL_MANAGEMENT_TOKEN;
assert.ok(base&&managementToken&&statePath,'missing rehearsal configuration');
const managementHeaders={authorization:`Bearer ${managementToken}`,'content-type':'application/json'};

async function call(path,{method='GET',body,headers=managementHeaders}={}){
 const response=await fetch(`${base}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const text=await response.text();let value=text;try{value=text?JSON.parse(text):null}catch{}
 return {status:response.status,value,headers:response.headers};
}
async function ok(path,options,expected){const result=await call(path,options);assert.equal(result.status,expected??(options?.method==='POST'?201:200),`${path}: ${result.status} ${JSON.stringify(result.value)}`);return result.value}

if(phase==='setup'){
 const fixture=JSON.parse(await readFile(new URL('./rehearsal-fixture.json',import.meta.url)));
 const survey=await ok('/v1/surveys',{method:'POST',body:{idempotencyKey:'rel-survey',title:fixture.title,questions:fixture.questions}},201);
 const version=await ok(`/v1/surveys/${survey.id}/publish`,{method:'POST',body:{revision:survey.revision,sdkCapabilities:fixture.sdkCapabilities}},200);
 const collection=await ok('/v1/collections',{method:'POST',body:{idempotencyKey:'rel-collection',surveyId:survey.id,version:version.version,placement:'release-rehearsal',responseCap:100,sdkCapabilities:fixture.sdkCapabilities}},201);
 await writeFile(statePath,JSON.stringify({surveyId:survey.id,collectionId:collection.id,collectionToken:collection.token},null,2));
 console.log('Release rehearsal fixture created');
}else if(phase==='finalize'){
 const state=JSON.parse(await readFile(statePath));const id=state.collectionId;const token=state.collectionToken;
 const publicHeaders={authorization:`Bearer ${token}`,'content-type':'application/json'};
 const usageAfterSdks=await ok('/v1/usage',{},200);assert.equal(usageAfterSdks.chargedCents,5);assert.equal(usageAfterSdks.credits.promotionalCredits,995);assert.equal(usageAfterSdks.unpaidExposureCents,0);

 const duplicate={idempotencyKey:'rel-concurrent-duplicate',answers:{comment:'one intent'},metadata:{path:'concurrency'}};
 const concurrent=await Promise.all(Array.from({length:8},()=>call(`/v1/collections/${id}/responses`,{method:'POST',headers:publicHeaders,body:duplicate})));
 assert.ok(concurrent.every(item=>item.status===200));assert.equal(new Set(concurrent.map(item=>item.value.responseId)).size,1);
 const responseId=concurrent[0].value.responseId;
 const conflict=await call(`/v1/collections/${id}/responses`,{method:'POST',headers:publicHeaders,body:{...duplicate,answers:{comment:'changed'}}});assert.equal(conflict.status,409);
 const invalid=await call(`/v1/collections/${id}/responses`,{method:'POST',headers:publicHeaders,body:{idempotencyKey:'rel-invalid',answers:{},metadata:{}}});assert.ok([400,422].includes(invalid.status));
 const usage=await ok('/v1/usage',{},200);assert.equal(usage.chargedCents,6);assert.equal(usage.acceptedResponses,6);assert.equal(usage.credits.promotionalResponses,6);assert.equal(usage.credits.promotionalCredits,994);assert.equal(usage.credits.paidResponses,0);assert.equal(usage.unpaidExposureCents,0);

 const responses=await ok(`/v1/responses?collectionId=${encodeURIComponent(id)}&limit=100`,{},200);assert.equal(responses.items.length,6);
 const exportJob=await ok('/v1/exports',{method:'POST',body:{idempotencyKey:'rel-export',format:'json',collectionId:id}},202);
 let exportStatus;for(let attempt=0;attempt<100;attempt++){exportStatus=await ok(`/v1/exports/${exportJob.id}`,{},200);if(exportStatus.status==='ready')break;await new Promise(resolve=>setTimeout(resolve,50))}
 assert.equal(exportStatus.status,'ready');
 const download=await ok(`/v1/exports/${exportJob.id}/download`,{},200);const exported=JSON.parse(Buffer.from(download.contentBase64,'base64').toString());assert.equal(exported.responses.length,6);

 await ok('/v1/billing/account',{method:'PUT',body:{providerCustomerId:'cus_local',providerPaymentMethodId:'pm_fail'}},204);
 // Current promotional/prepaid responses cannot also be billed by postpaid settlement.
 const noDebt=await call('/v1/billing/settlements',{method:'POST',body:{idempotencyKey:'rel-no-double-charge'}});assert.equal(noDebt.status,400);
 assert.deepEqual((await ok('/v1/usage',{},200)).credits,usage.credits);
 // Seed an explicit pre-credit migration fixture; never delete a current credit debit.
 const container=process.env.LIKERTS_REHEARSAL_DATABASE_CONTAINER;assert.match(container??'',/^likerts-release-rehearsal-[0-9]+$/);
 execFileSync('docker',['exec','-i',container,'psql','-X','--username','postgres','--set','ON_ERROR_STOP=1','--set',`collection=${id}`],{encoding:'utf8',stdio:['pipe','pipe','pipe'],input:`
BEGIN;
SELECT set_config('likerts.workspace_id','release-rehearsal',true);
WITH historical AS (
 INSERT INTO likerts.responses(workspace_id,id,collection_id,idempotency_key,answers,metadata,accepted_at)
 VALUES('release-rehearsal',gen_random_uuid(),:'collection'::uuid,'rel-historical-postpaid','{}','{}','2020-01-01') RETURNING workspace_id,id
) INSERT INTO likerts.usage_entries(workspace_id,response_id,amount_cents,created_at) SELECT workspace_id,id,1,'2020-01-01' FROM historical;
COMMIT;
`});
 assert.equal((await ok('/v1/usage',{},200)).unpaidExposureCents,1);
 const failed=await ok('/v1/billing/settlements',{method:'POST',body:{idempotencyKey:'rel-settlement'}},200);assert.equal(failed.status,'failed');assert.equal(failed.amountCents,1);
 const paused=await ok('/v1/usage',{},200);assert.equal(paused.acceptingPaidResponses,false);assert.equal(paused.blockedReason,'billing_paused');
 const blocked=await call(`/v1/collections/${id}/responses`,{method:'POST',headers:publicHeaders,body:{idempotencyKey:'rel-blocked',answers:{comment:'must remain unbilled'},metadata:{}}});assert.equal(blocked.status,402);
 const timestamp=Math.floor(Date.now()/1000);const event={id:'evt_rel_recovery',type:'payment_intent.succeeded',data:{object:{id:failed.providerIntentId,last_payment_error:null}}};const body=JSON.stringify(event);const signature=createHmac('sha256','local-webhook-secret').update(`${timestamp}.${body}`).digest('hex');
 const recovered=await fetch(`${base}/v1/webhooks/stripe`,{method:'POST',headers:{'content-type':'application/json','stripe-signature':`t=${timestamp},v1=${signature}`},body});assert.equal(recovered.status,204);
 const settled=await ok('/v1/usage',{},200);assert.equal(settled.acceptingPaidResponses,true);assert.equal(settled.unpaidExposureCents,0);assert.equal(settled.chargedCents,7);assert.deepEqual(settled.credits,usage.credits);

 await ok(`/v1/collections/${id}/security`,{method:'PUT',body:{allowedOrigins:[],requestsPerMinute:1}},200);
 const throttled=await call(`/v1/collections/${id}/responses`,{method:'POST',headers:publicHeaders,body:{idempotencyKey:'rel-throttled',answers:{comment:'rate limit'},metadata:{}}});assert.equal(throttled.status,429);assert.equal(throttled.headers.get('retry-after'),'60');
 assert.equal((await ok('/v1/usage',{},200)).chargedCents,7);assert.deepEqual((await ok('/v1/usage',{},200)).credits,usage.credits);

 await ok(`/v1/responses/${responseId}`,{method:'DELETE'},204);
 assert.equal((await ok('/v1/usage',{},200)).chargedCents,7);assert.deepEqual((await ok('/v1/usage',{},200)).credits,usage.credits);
 assert.equal((await call(`/v1/exports/${exportJob.id}/download`)).status,410);
 await ok(`/v1/collections/${id}`,{method:'PATCH',body:{revoke:true}},200);
 assert.equal((await call(`/v1/collections/${id}`,{headers:publicHeaders})).status,410);
 await ok('/v1/workspace',{method:'DELETE'},204);
 assert.equal((await call('/v1/usage')).status,401);

 const evidence={gate:'REL-01A',localOnly:true,fixture:'release/rehearsal-fixture.json',sdkSubmissions:5,durableResponses:7,currentAcceptedResponses:6,historicalPostpaidFixtureResponses:1,chargedCents:7,promotionalCreditsConsumed:6,promotionalCreditsRemaining:994,paidCreditsConsumed:0,checks:['create/publish','five SDK fetch+submit','concurrent duplicate','conflict and invalid unbilled','retrieve/export','prepaid responses excluded from postpaid settlement','historical one-cent postpaid payment failure and signed recovery','throttling unbilled','raw deletion preserves usage and revokes export','collection revocation','workspace deletion invalidates management access'],remaining:['Clerk and Stripe sandboxes','hosted staging','physical-device matrix']};
 await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');console.log('REL-01A local lifecycle passed');
}else throw new Error(`unknown phase ${phase}`);
