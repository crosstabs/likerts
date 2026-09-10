// Explicit, bounded synthetic acceptance; importing this module performs no I/O.
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadPrivateWorkspaceFile,isPristineUsage} from './check-hosted-sustained.mjs';

const fail = code => { throw new Error(code); };
const requireValue = (condition,code) => { if(!condition) fail(code); };
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const token = value => typeof value==='string' && value.length>=16 && value.length<=4096 && !/[\s\x00-\x1f\x7f]/.test(value);
function httpsUrl(value) {
  try {const url=new URL(value);requireValue(url.protocol==='https:' && !url.username && !url.password && !url.hash && !url.search && (!url.port || url.port==='443'),'url_invalid');return url;}
  catch {fail('url_invalid');}
}
export function validateConfig(input,base) {
  requireValue(input && typeof input==='object','configuration_required');
  requireValue(/^hosted-launch-[a-z0-9-]{1,100}$/.test(input.workspaceId??''),'workspace_name_invalid');
  requireValue(input.disposable===true && input.receiverOwned===true,'synthetic_ownership_attestation_required');
  requireValue(uuid(input.endpointId),'endpoint_id_invalid');
  requireValue(token(input.bootstrapToken) && token(input.verifierToken),'credential_invalid');
  const origin=httpsUrl(base),receiver=httpsUrl(input.receiverUrl),verifier=httpsUrl(input.verifierUrl);
  requireValue(origin.origin===base,'api_origin_required');
  requireValue(receiver.origin===verifier.origin && receiver.pathname==='/api/receive' && verifier.pathname==='/api/events','isolated_receiver_contract_required');
  requireValue(receiver.origin!==origin.origin,'independent_receiver_required');
  return {...input,base};
}
export function verifyThresholds(records,deliveries) {
  requireValue(Array.isArray(records) && records.length===3,'three_receiver_events_required');
  const ids=new Set(),thresholds=new Set(),generations=new Set();
  for(const event of records) {
    requireValue(event && uuid(event.eventId) && uuid(event.deliveryId) && uuid(event.attemptId) && uuid(event.generationId),'receiver_event_ids_invalid');
    requireValue(event.eventType==='credits.threshold_reached' && event.signatureVerified===true && event.bucket==='promotional','signed_promotional_event_required');
    requireValue([80,90,100].includes(event.thresholdPercent),'threshold_invalid');
    requireValue(!ids.has(event.eventId),'receiver_event_not_deduped');
    ids.add(event.eventId);thresholds.add(event.thresholdPercent);generations.add(event.generationId);
    requireValue(deliveries.some(d=>d.id===event.deliveryId && d.eventId===event.eventId && d.status==='delivered'),'receiver_delivery_mismatch');
  }
  requireValue(thresholds.size===3 && generations.size===1,'independent_threshold_or_generation_mismatch');
  requireValue(deliveries.length===3 && deliveries.every(d=>ids.has(d.eventId)),'unexpected_delivery');
  return {thresholds:[80,90,100],uniqueEvents:3,generations:1,signaturesVerified:3};
}
const sleep = ms => new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
export async function runHosted(input,{base,output}) {
  const config=validateConfig(input,base);
  requireValue(typeof output==='string' && output.length>0,'evidence_output_required');
  const evidence={schemaVersion:1,measuredAt:new Date().toISOString(),base,status:'failed',
    workspaceDigest:createHash('sha256').update(config.workspaceId).digest('hex'),
    limits:{maximumAcceptedResponses:1000,maximumPaidExposureCents:0,maximumAggregateRequestsPerSecond:5,maximumConcurrentSubmissions:4,maximumHttpRequests:1300},
    acceptedResponses:0,totalHttpRequests:0,thresholds:null,accounting:null,
    cleanup:{workspaceBindingVerified:false,endpointRevoked:false,workspaceTombstoned:false,credentialDenialVerified:false},
    failures:[],limitations:['Synthetic same-account HTTPS receiver; not customer-owned DNS or network-enforced egress proof.','Promotional thresholds only. Paid top-up/refund generation semantics are covered by isolated PostgreSQL tests, not financial actions in this runner.','No proof of email/SMS delivery to an owner. Customer receiver routing is separate.','Bounded1000-response functional run, not a general capacity or failover claim.']};
  let verified=false,childToken,childId,collection,nextAt=0,queue=Promise.resolve(),halted=false;
  const stop=()=>{halted=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const recordFailure=error=>{const code=/^[a-z0-9_]+$/.test(error?.message??'')?error.message:'acceptance_failed';if(!evidence.failures.includes(code))evidence.failures.push(code);};
  async function request(path,{method='GET',body,credential=childToken??config.bootstrapToken,receiver=false,cleanup=false}={}) {
    let release;const prior=queue;queue=new Promise(r=>{release=r;});await prior;
    try {
      requireValue(cleanup || !halted,'operator_aborted');
      requireValue(evidence.totalHttpRequests<1300,'request_budget_exhausted');
      await sleep(nextAt-Date.now());nextAt=Date.now()+200;evidence.totalHttpRequests++;
    }finally{release();}
    let response;
    try {response=await fetch(receiver?config.verifierUrl:base+path,{method,headers:{authorization:`Bearer ${receiver?config.verifierToken:credential}`,'content-type':'application/json','x-likerts-workspace':config.workspaceId},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',signal:AbortSignal.timeout(15000)});}
    catch {fail('transport_failure');}
    const parts=[];let length=0;const reader=response.body?.getReader();
    if(reader)for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>128*1024){await reader.cancel();fail('response_too_large');}parts.push(value);}
    let value=null;try{value=JSON.parse(Buffer.concat(parts).toString());}catch{}
    return {status:response.status,value};
  }
  async function expect(path,options,status,code) {const result=await request(path,options);requireValue(result.status===status,code);return result.value;}
  const receiverEvents=()=>expect('',{receiver:true},200,'verifier_unavailable');
  try {
    requireValue(isPristineUsage(await expect('/v1/usage',{},200,'baseline_unavailable')),'workspace_not_pristine');
    const surveys=await expect('/v1/surveys',{},200,'survey_inventory_unavailable');
    requireValue(Array.isArray(surveys)&&surveys.length===0,'workspace_has_surveys');
    const issued=await expect('/v1/service-credentials',{method:'POST',body:{name:'hosted-credit-threshold-acceptance',scopes:['surveys:read','surveys:write','collections:write','usage:read','identity:write','webhooks:read','webhooks:write'],expiresAt:new Date(Date.now()+3600000).toISOString()}},201,'child_credential_failed');
    if(uuid(issued?.credential?.id))childId=issued.credential.id;
    requireValue(issued?.credential?.workspaceId===config.workspaceId && token(issued.token),'workspace_binding_failed');
    childToken=issued.token;
    requireValue(isPristineUsage(await expect('/v1/usage',{},200,'bound_usage_unavailable')),'bound_workspace_not_pristine');
    const endpoints=await expect('/v1/webhook-endpoints',{},200,'endpoint_inventory_unavailable');
    requireValue(Array.isArray(endpoints)&&endpoints.length===1,'isolated_endpoint_required');
    const endpoint=endpoints[0];
    requireValue(endpoint.id===config.endpointId && endpoint.url===config.receiverUrl && endpoint.enabled===false && endpoint.revoked===false && JSON.stringify(endpoint.eventTypes)===JSON.stringify(['credits.threshold_reached']),'preconfigured_credit_endpoint_required');
    const initial=await receiverEvents();requireValue(initial?.receivedCount===0&&Array.isArray(initial.events)&&initial.events.length===0,'verifier_not_empty');
    verified=true;evidence.cleanup.workspaceBindingVerified=true;
    const fleet={installations:[{target:'web',sdkVersion:'0.0.3',schemaVersions:[1,2,3,4,5]}]};
    const survey=await expect('/v1/surveys',{method:'POST',body:{idempotencyKey:randomUUID(),title:'Synthetic credit threshold acceptance',questions:[{id:'score',type:'scale',label:'Synthetic score',required:true,min:1,max:5}]}},201,'survey_create_failed');
    const version=await expect(`/v1/surveys/${survey.id}/publish`,{method:'POST',body:{revision:survey.revision,sdkCapabilities:fleet}},200,'publish_failed');
    collection=await expect('/v1/collections',{method:'POST',body:{idempotencyKey:randomUUID(),surveyId:survey.id,version:version.version,placement:'synthetic-credit-threshold',responseCap:1000,sdkCapabilities:fleet}},201,'collection_create_failed');
    requireValue(uuid(collection?.id)&&token(collection.token),'collection_credential_missing');
    await expect(`/v1/webhook-endpoints/${config.endpointId}`,{method:'PATCH',body:{enabled:true}},200,'endpoint_enable_failed');
    const receipts=new Set();
    for(let start=0;start<1000;start+=4) {
      requireValue(!halted,'operator_aborted');
      const results=await Promise.allSettled(Array.from({length:Math.min(4,1000-start)},async()=>{
        const receipt=await expect(`/v1/collections/${collection.id}/responses`,{method:'POST',credential:collection.token,body:{idempotencyKey:randomUUID(),answers:{score:5},metadata:{source:'synthetic-credit-threshold'}}},200,'response_acceptance_failed');
        requireValue(receipt.accepted===true&&receipt.chargedCents===1&&uuid(receipt.responseId)&&!receipts.has(receipt.responseId),'receipt_invalid');
        receipts.add(receipt.responseId);evidence.acceptedResponses++;
      }));
      const rejected=results.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;
      if(evidence.acceptedResponses%100===0) {
        const usage=await expect('/v1/usage',{},200,'usage_reconciliation_failed');
        requireValue(usage.credits?.paidCredits===0&&usage.credits.paidCreditDebt===0&&usage.credits.paidResponses===0&&usage.unpaidExposureCents===0,'unexpected_paid_exposure');
        requireValue(usage.acceptedResponses===evidence.acceptedResponses&&usage.credits.promotionalCredits===1000-evidence.acceptedResponses,'acceptance_ledger_mismatch');
        if(evidence.acceptedResponses===700 || evidence.acceptedResponses>=800) {
          const queued=await expect(`/v1/webhook-deliveries?endpointId=${config.endpointId}&limit=100`,{},200,'crossing_delivery_status_failed');
          requireValue(Array.isArray(queued)&&queued.length===(evidence.acceptedResponses<800?0:(evidence.acceptedResponses-700)/100),'threshold_crossing_count_mismatch');
        }
        console.log(`Synthetic credit threshold acceptance: ${evidence.acceptedResponses}/1000 free replies; no paid exposure.`);
      }
    }
    const usage=await expect('/v1/usage',{},200,'final_usage_failed');
    requireValue(usage.acceptedResponses===1000&&usage.credits.promotionalCredits===0&&usage.credits.promotionalResponses===1000&&usage.blockedReason==='credits_exhausted','final_credit_balance_mismatch');
    evidence.accounting={acceptedResponses:usage.acceptedResponses,promotionalCreditsRemaining:0,promotionalResponses:1000,paidResponses:0,paidCredits:0,unpaidExposureCents:0};
    for(let poll=0;poll<60;poll++) {
      const received=await receiverEvents();
      const deliveries=await expect(`/v1/webhook-deliveries?endpointId=${config.endpointId}&limit=100`,{},200,'delivery_status_failed');
      requireValue(Array.isArray(received?.events)&&Number.isInteger(received.receivedCount)&&received.receivedCount>=0&&received.events.length<=3,'verifier_response_invalid');
      if(received.events.length===3 && deliveries.every(d=>d.status==='delivered')) {
        evidence.thresholds=verifyThresholds(received.events,deliveries);evidence.thresholds.receiverRecordedEvents=received.receivedCount;break;
      }
      requireValue(!deliveries.some(d=>['failed','cancelled'].includes(d.status)),'delivery_failed');
      await sleep(2000);
    }
    requireValue(evidence.thresholds!==null,'threshold_delivery_timeout');
    evidence.status='passed';
  }catch(error){recordFailure(error);}
  finally {
    if(verified) {
      for(const [path,method,body,key]of [
        [`/v1/webhook-endpoints/${config.endpointId}`,'PATCH',{revoke:true},'endpointRevoked'],
        ['/v1/workspace','DELETE',undefined,'workspaceTombstoned']
      ])try{const result=await request(path,{method,body,cleanup:true});requireValue(result.status===(method==='DELETE'?204:200),'cleanup_failed');evidence.cleanup[key]=true;}catch(error){recordFailure(error);}
      if(evidence.cleanup.workspaceTombstoned)try{evidence.cleanup.credentialDenialVerified=(await request('/v1/usage',{cleanup:true,credential:config.bootstrapToken})).status===401;requireValue(evidence.cleanup.credentialDenialVerified,'cleanup_credential_not_denied');}catch(error){recordFailure(error);}
    } else if(childId) {
      // The only mutation rolled back before binding is this exact issued child.
      try{await expect(`/v1/service-credentials/${childId}`,{method:'DELETE',credential:config.bootstrapToken,cleanup:true},204,'child_cleanup_failed');}catch(error){recordFailure(error);}
    }
    if(evidence.failures.length)evidence.status='failed';
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  }
  return evidence;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const input=await loadPrivateWorkspaceFile(process.env.LIKERTS_HOSTED_THRESHOLD_INPUT);
    const result=await runHosted(input,{base:process.env.LIKERTS_HOSTED_BASE_URL,output:process.env.LIKERTS_HOSTED_EVIDENCE_OUTPUT});
    console.log(`Hosted credit notifications: ${result.status}; ${result.acceptedResponses} synthetic replies; ${result.thresholds?.uniqueEvents??0} verified events.`);
    if(result.status!=='passed')process.exitCode=1;
  }catch(error){console.error(/^[a-z0-9_]+$/.test(error?.message??'')?error.message:'configuration_failed');process.exitCode=1;}
}
