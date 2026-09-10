// Bounded synthetic hosted rehearsal. No run occurs when this module is imported.
import { randomUUID, createHash } from 'node:crypto';
import { lstat, open, mkdir, writeFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const MAX_RATE = 5;
const MAX_CONCURRENCY = 8;
const MAX_HTTP_REQUESTS = 3600;
const PROMO_PER_WORKSPACE = 1000;
const MAX_OWN_ACCEPTANCES = 900;
const safeError = code => new Error(code);
const requireValue = (condition, code) => { if (!condition) throw safeError(code); };

export function validateConfig(input, options = {}) {
  requireValue(input && typeof input === 'object' && Array.isArray(input.workspaces), 'workspace_file_invalid');
  const rate = Number(options.rate ?? 5);
  const durationSeconds = Number(options.durationSeconds ?? 600);
  requireValue(Number.isFinite(rate) && rate >= 0.1 && rate <= MAX_RATE, 'rate_out_of_bounds');
  requireValue(Number.isInteger(durationSeconds) && durationSeconds >= 60 && durationSeconds <= 600, 'duration_out_of_bounds');
  requireValue(input.workspaces.length >= 1 && input.workspaces.length <= 10, 'workspace_count_out_of_bounds');
  const ids = new Set(), tokens = new Set();
  for (const entry of input.workspaces) {
    requireValue(entry && /^hosted-launch-[a-z0-9-]{1,100}$/.test(entry.workspaceId ?? ''), 'invalid_disposable_workspace_name');
    requireValue(entry.disposable === true, 'disposable_attestation_required');
    requireValue(typeof entry.bootstrapToken === 'string' && entry.bootstrapToken.length >= 16 && entry.bootstrapToken.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(entry.bootstrapToken), 'invalid_bootstrap_credential');
    requireValue(!ids.has(entry.workspaceId) && !tokens.has(entry.bootstrapToken), 'duplicate_workspace_or_credential');
    ids.add(entry.workspaceId); tokens.add(entry.bootstrapToken);
  }
  const plan = makePlan(input.workspaces.length, rate, durationSeconds);
  requireValue(plan.perWorkspaceMaximumAccepted.every(count => count <= MAX_OWN_ACCEPTANCES), 'insufficient_pristine_workspaces');
  return { workspaces: input.workspaces, rate, durationSeconds, plan };
}

export function makePlan(workspaceCount, rate = 5, durationSeconds = 600) {
  const slots = Math.floor(rate * durationSeconds);
  const counts = Array(workspaceCount).fill(1); // One duplicate seed per workspace.
  const phases = { valid: 0, duplicate: 0, invalid: 0 };
  for (let slot = 0; slot < slots; slot++) {
    const kind = kindFor(slot);
    phases[kind]++;
    if (kind === 'valid') counts[Math.floor(slot / 20) % workspaceCount]++;
  }
  return { durationSeconds, maximumAggregateRequestsPerSecond: MAX_RATE, targetSubmissionRequestsPerSecond: rate,
    maximumConcurrency: MAX_CONCURRENCY, scheduledSubmissionSlots: slots,
    maximumSubmissionAttempts: slots + workspaceCount, maximumHttpRequests: MAX_HTTP_REQUESTS,
    seedSubmissions: workspaceCount, phases, perWorkspaceMaximumAccepted: counts,
    maximumPromotionalResponses: counts.reduce((a, b) => a + b, 0), maximumPaidExposureCents: 0,
    concurrentExportJobs: 2, usageCheckIntervalSeconds: 60 };
}
const kindFor = slot => slot % 20 === 19 ? 'invalid' : slot % 10 === 9 ? 'duplicate' : 'valid';

export async function loadPrivateWorkspaceFile(path) {
  requireValue(typeof path === 'string' && path.length > 0, 'workspace_file_required');
  const info = await lstat(path);
  requireValue(info.isFile() && !info.isSymbolicLink(), 'workspace_file_must_be_regular');
  requireValue((info.mode & 0o077) === 0, 'workspace_file_must_be_private');
  requireValue(info.size <= 64 * 1024, 'workspace_file_too_large');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const checked = await handle.stat();
    requireValue(checked.ino === info.ino && checked.dev === info.dev && (checked.mode & 0o077) === 0, 'workspace_file_changed');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}

export function isPristineUsage(usage) {
  return usage?.acceptedResponses === 0 && usage.chargedCents === 0 && usage.unpaidExposureCents === 0
    && usage.credits?.promotionalCredits === PROMO_PER_WORKSPACE
    && usage.credits.promotionalResponses === 0 && usage.credits.paidCredits === 0
    && usage.credits.paidCreditDebt === 0 && usage.credits.paidResponses === 0;
}
const hasZeroPaidExposure = usage => usage?.credits?.paidCredits === 0 && usage.credits.paidCreditDebt === 0
  && usage.credits.paidResponses === 0 && usage.unpaidExposureCents === 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const percentile = (values, p) => values.length ? Math.round([...values].sort((a,b) => a-b)[Math.ceil(values.length*p)-1] * 1000)/1000 : null;
function summarize(records, seconds) {
  const statuses = {};
  for (const record of records) statuses[record.status] = (statuses[record.status] ?? 0) + 1;
  const sent = records.filter(record => record.dispatched);
  return { scheduledSlots: records.length, dispatchedRequests: sent.length, seconds,
    deliveredRequestsPerSecond: seconds > 0 ? sent.length/seconds : 0, statuses,
    latencyMs: { p50: percentile(sent.map(r=>r.ms),.5), p95: percentile(sent.map(r=>r.ms),.95), p99: percentile(sent.map(r=>r.ms),.99) },
    scheduleLagP95Ms: percentile(sent.map(r=>r.scheduleLagMs ?? 0),.95) };
}

export async function runHosted(config, { base, output }) {
  config = validateConfig(config, {rate: config.rate, durationSeconds: config.durationSeconds});
  const origin = new URL(base);
  requireValue(origin.protocol === 'https:' && origin.origin === base && !origin.username && !origin.password, 'hosted_origin_must_be_exact_https');
  requireValue(typeof output === 'string' && output.length > 0, 'evidence_output_required');
  const stop = new AbortController();
  const evidence = { schemaVersion: 1, measuredAt: new Date().toISOString(), base, status: 'failed',
    workload: { ...config.plan, workspaceCount: config.workspaces.length }, phases: {}, exports: [], accounting: null,
    totalHttpRequests: 0, failures: [], cleanup: { verifiedPristine: 0, tombstoned: 0, credentialDenialsVerified: 0, unverifiedNotDeleted: 0, issuedCredentialRevocations: 0 },
    limitations: ['Bounded synthetic developer-preview rehearsal, not general capacity, a customer SLA, replica-placement or failover evidence.',
      'All request types share a strict maximum 5 RPS dispatch limiter; management/export traffic can reduce delivered submission rate.',
      'Client latency includes network transit. No real respondent data, purchases or paid response exposure are intended.',
      'Only supplied, explicitly disposable workspace names with verified pristine usage and matching credential binding are eligible for workspace cleanup.',
      'No callback target or alert receiver is used. Private export contents and all credentials are excluded from this aggregate evidence.'] };
  const failures = new Set();
  const states = config.workspaces.map(entry => ({ ...entry, verified: false, childToken: undefined, credentialId: undefined, acceptedIds: new Set(), exports: [], unknownAcceptances: 0 }));
  const records = { valid: [], duplicate: [], invalid: [] };
  let nextDispatchAt = 0, gate = Promise.resolve(), active = 0, maximumObservedConcurrency = 0;
  const onSignal = () => { failures.add('operator_abort'); stop.abort(); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  function fail(code) { failures.add(code); stop.abort(); throw safeError(code); }
  async function request(state, path, { method='GET', token=state.childToken ?? state.bootstrapToken, body, cleanup=false, deadline=Infinity, scheduledAt }={}) {
    if (stop.signal.aborted && !cleanup) return {status:'aborted',ms:0,dispatched:false};
    // Serialize admissions, not response bodies: no catch-up burst after stalls.
    let release;
    const prior=gate; gate=new Promise(resolveGate=>{release=resolveGate;});
    await prior;
    try {
      while (active >= MAX_CONCURRENCY) {
        if ((!cleanup && stop.signal.aborted) || performance.now() >= deadline) return {status:'skipped_concurrency',ms:0,dispatched:false};
        await sleep(20);
      }
      if (performance.now() < nextDispatchAt) await sleep(nextDispatchAt-performance.now());
      if (performance.now() >= deadline) return {status:'skipped_deadline',ms:0,dispatched:false};
      if (stop.signal.aborted && !cleanup) return {status:'aborted',ms:0,dispatched:false};
      if (evidence.totalHttpRequests >= MAX_HTTP_REQUESTS && !cleanup) return {status:'request_budget_exhausted',ms:0,dispatched:false};
      nextDispatchAt=performance.now()+1000/MAX_RATE; active++; maximumObservedConcurrency=Math.max(maximumObservedConcurrency,active); evidence.totalHttpRequests++;
    } finally { release(); }
    const started=performance.now();
    try {
      const signal=cleanup ? AbortSignal.timeout(15_000) : AbortSignal.any([stop.signal,AbortSignal.timeout(15_000)]);
      const response=await fetch(`${base}${path}`, { method, headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
        ...(body === undefined ? {} : {body:JSON.stringify(body)}), redirect:'manual', signal });
      let size=0; const chunks=[]; const reader=response.body?.getReader();
      if (reader) for (;;) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();return {status:'oversized',ms:performance.now()-started,dispatched:true};}chunks.push(value); }
      let value=null;try {value=JSON.parse(Buffer.concat(chunks).toString());}catch{}
      return {status:response.status,value,ms:performance.now()-started,dispatched:true,scheduleLagMs:scheduledAt === undefined ? 0 : started-scheduledAt};
    } catch { return {status:stop.signal.aborted&&!cleanup?'aborted':'transport_error',ms:performance.now()-started,dispatched:true,scheduleLagMs:scheduledAt === undefined ? 0 : started-scheduledAt}; }
    finally { active--; }
  }
  async function expect(state,path,options,status,code) {
    const response=await request(state,path,options);
    if(response.status!==status) fail(code);
    return response.value;
  }
  const sdkCapabilities={installations:[{target:'web',sdkVersion:'0.0.3',schemaVersions:[1,2,3,4,5]}]};
  function recordReceipt(state,result,kind) {
    if(kind==='invalid') { if(result.status!==400) fail('invalid_submission_not_rejected');return; }
    if(result.status!==200 || result.value?.accepted!==true || result.value?.chargedCents!==1 || typeof result.value?.responseId!=='string') {
      if(result.dispatched) state.unknownAcceptances++;
      fail('acceptance_or_receipt_failed');
    }
    if(kind==='duplicate' && result.value.responseId!==state.seedResponseId) fail('duplicate_receipt_mismatch');
    if(kind==='valid' && state.acceptedIds.has(result.value.responseId)) fail('unexpected_duplicate_valid_receipt');
    state.acceptedIds.add(result.value.responseId);
  }
  const submit=(state,key,answers={rating:5},options={})=>request(state,`/v1/collections/${state.collection.id}/responses`,{
    method:'POST',token:state.collection.token,body:{idempotencyKey:key,answers,metadata:{source:'synthetic-hosted-sustained'}},...options});
  let sustainedStart=null, sustainedEnd=null;
  try {
    // Verify every supplied workspace before starting the sustained workload.
    for (const [index,state] of states.entries()) {
      const baseline=await expect(state,'/v1/usage',{},200,'baseline_unavailable');
      requireValue(isPristineUsage(baseline),'workspace_not_pristine');
      const surveys=await expect(state,'/v1/surveys',{},200,'survey_inventory_unavailable');
      requireValue(Array.isArray(surveys) && surveys.length===0,'workspace_has_existing_surveys');
      const issued=await expect(state,'/v1/service-credentials',{method:'POST',body:{name:'hosted-sustained-rehearsal',
        scopes:['surveys:read','surveys:write','collections:write','responses:read','usage:read','exports:read','exports:write','identity:write'],
        expiresAt:new Date(Date.now()+3600_000).toISOString()}},201,'credential_issue_failed');
      // Track only the exact child created by this run, even if binding later fails.
      if(typeof issued?.credential?.id==='string') state.credentialId=issued.credential.id;
      requireValue(issued?.credential?.workspaceId===state.workspaceId && typeof issued.token==='string','workspace_binding_failed');
      state.childToken=issued.token;
      const confirmed=await expect(state,'/v1/usage',{},200,'bound_baseline_unavailable');
      requireValue(isPristineUsage(confirmed),'bound_workspace_not_pristine');
      state.verified=true; evidence.cleanup.verifiedPristine++;
      const survey=await expect(state,'/v1/surveys',{method:'POST',body:{idempotencyKey:randomUUID(),title:'Synthetic sustained acceptance',questions:[{id:'rating',type:'scale',label:'Synthetic rating',required:true,min:1,max:5}]}},201,'survey_create_failed');
      const published=await expect(state,`/v1/surveys/${survey.id}/publish`,{method:'POST',body:{revision:survey.revision,sdkCapabilities}},200,'survey_publish_failed');
      state.collection=await expect(state,'/v1/collections',{method:'POST',body:{idempotencyKey:randomUUID(),surveyId:survey.id,version:published.version,
        placement:'hosted-sustained',responseCap:config.plan.perWorkspaceMaximumAccepted[index]+1,sdkCapabilities}},201,'collection_create_failed');
      requireValue(typeof state.collection?.id==='string' && typeof state.collection.token==='string','collection_credential_missing');
      state.seedKey=randomUUID();
      const seed=await submit(state,state.seedKey);recordReceipt(state,seed,'valid');state.seedResponseId=seed.value.responseId;
    }
    sustainedStart=performance.now(); const deadline=sustainedStart+config.durationSeconds*1000;
    async function waitUntil(time) { while(!stop.signal.aborted && performance.now()<time) await sleep(Math.min(250,time-performance.now())); }
    const background = [];
    // Two independently authenticated private exports run while submissions continue.
    for (const [jobIndex,fraction] of [0.25,0.65].entries()) background.push((async()=>{
      await waitUntil(sustainedStart+config.durationSeconds*1000*fraction);if(stop.signal.aborted)return;
      const state=states[jobIndex%states.length];const started=performance.now();
      const job=await expect(state,'/v1/exports',{method:'POST',body:{idempotencyKey:randomUUID(),format:'json',collectionId:state.collection.id}},202,'export_create_failed');
      requireValue(typeof job?.id==='string','export_job_missing');state.exports.push(job.id);
      let status=job;
      for(let poll=0;poll<30 && status.status!=='ready';poll++) {
        if(stop.signal.aborted)return;
        requireValue(status.status!=='failed','export_job_failed');
        await waitUntil(Math.min(deadline,performance.now()+2000));
        requireValue(performance.now()<deadline,'export_not_ready_in_window');
        status=await expect(state,`/v1/exports/${job.id}`,{},200,'export_poll_failed');
      }
      requireValue(status.status==='ready','export_poll_budget_exhausted');
      const denied=await request(state,`/v1/exports/${job.id}/download`,{token:'invalid-synthetic-export-credential'});
      requireValue(denied.status===401,'private_export_not_denied');
      const bundle=await expect(state,`/v1/exports/${job.id}/download`,{},200,'export_download_failed');
      requireValue(typeof bundle?.contentBase64==='string' && typeof bundle.contentSha256==='string','export_bundle_invalid');
      const bytes=Buffer.from(bundle.contentBase64,'base64');
      requireValue(createHash('sha256').update(bytes).digest('hex')===bundle.contentSha256,'export_checksum_mismatch');
      requireValue(Number.isInteger(bundle.manifest?.responseCount) && bundle.manifest.responseCount>=1 && bundle.manifest.responseCount<=MAX_OWN_ACCEPTANCES,'export_manifest_invalid');
      evidence.exports.push({ready:true,unauthorizedDenied:true,checksumVerified:true,responseCount:bundle.manifest.responseCount,bytes:bytes.length,seconds:(performance.now()-started)/1000});
    })().catch(error=>{failures.add(/^[a-z_]+$/.test(error.message)?error.message:'export_phase_failed');stop.abort();}));
    background.push((async()=>{
      for(let next=sustainedStart+60_000;next<deadline;next+=60_000){
        await waitUntil(next);if(stop.signal.aborted)return;
        for(const state of states){const usage=await expect(state,'/v1/usage',{},200,'periodic_usage_failed');requireValue(hasZeroPaidExposure(usage),'paid_exposure_detected');}
        console.log(`Hosted sustained rehearsal: ${Math.round((performance.now()-sustainedStart)/1000)} seconds elapsed; ${Object.values(records).reduce((n,rows)=>n+rows.filter(r=>r.dispatched).length,0)} submission attempts recorded.`);
      }
    })().catch(error=>{failures.add(/^[a-z_]+$/.test(error.message)?error.message:'usage_phase_failed');stop.abort();}));
    const pending=new Set();
    for(let slot=0;slot<config.plan.scheduledSubmissionSlots && !stop.signal.aborted;slot++){
      const scheduledAt=sustainedStart+slot*1000/config.rate;
      await waitUntil(scheduledAt);if(stop.signal.aborted)break;
      const kind=kindFor(slot); const state=states[Math.floor(slot/20)%states.length];
      if(performance.now()>=deadline){records[kind].push({status:'skipped_deadline',ms:0,dispatched:false});continue;}
      if(pending.size>=MAX_CONCURRENCY){records[kind].push({status:'skipped_concurrency',ms:0,dispatched:false});continue;}
      const task=(async()=>{
        const result=await submit(state,kind==='duplicate'?state.seedKey:randomUUID(),kind==='invalid'?{rating:99}:{rating:5},{scheduledAt,deadline});
        records[kind].push({status:result.status,ms:result.ms,dispatched:result.dispatched,scheduleLagMs:result.scheduleLagMs});
        if(result.dispatched && !stop.signal.aborted)recordReceipt(state,result,kind);
      })().catch(error=>{failures.add(/^[a-z_]+$/.test(error.message)?error.message:'submission_phase_failed');stop.abort();});
      pending.add(task);task.finally(()=>pending.delete(task));
    }
    await waitUntil(deadline);sustainedEnd=performance.now();
    await Promise.allSettled([...pending,...background]);
    if(stop.signal.aborted) throw safeError('sustained_window_aborted');
    requireValue(evidence.exports.length===2,'concurrent_export_evidence_incomplete');
    const sums={uniqueAcceptedReceipts:0,acceptedResponses:0,chargedCents:0,promotionalResponses:0,promotionalCreditsRemaining:0,paidCredits:0,paidCreditDebt:0,paidResponses:0,unpaidExposureCents:0};
    for(const state of states){
      const usage=await expect(state,'/v1/usage',{},200,'final_accounting_unavailable');
      requireValue(hasZeroPaidExposure(usage),'paid_exposure_detected');
      requireValue(usage.acceptedResponses===state.acceptedIds.size && usage.chargedCents===state.acceptedIds.size
        && usage.credits.promotionalResponses===state.acceptedIds.size && usage.credits.promotionalCredits===PROMO_PER_WORKSPACE-state.acceptedIds.size,'accounting_invariant_failed');
      sums.uniqueAcceptedReceipts+=state.acceptedIds.size;sums.acceptedResponses+=usage.acceptedResponses;sums.chargedCents+=usage.chargedCents;
      sums.promotionalResponses+=usage.credits.promotionalResponses;sums.promotionalCreditsRemaining+=usage.credits.promotionalCredits;
    }
    evidence.accounting=sums;
  } catch(error) { failures.add(/^[a-z_]+$/.test(error.message)?error.message:'unexpected_runner_failure');stop.abort(); }
  finally {
    stop.abort();
    if(sustainedStart!==null){const seconds=((sustainedEnd??performance.now())-sustainedStart)/1000;for(const [kind,values] of Object.entries(records))evidence.phases[kind]=summarize(values,seconds);
      evidence.sustained=summarize(Object.values(records).flat(),seconds);evidence.sustained.completedRequestedWindow=seconds>=config.durationSeconds;}
    for(const state of states){
      if(!state.verified){
        evidence.cleanup.unverifiedNotDeleted++;
        if(state.credentialId){const revoked=await request(state,`/v1/service-credentials/${encodeURIComponent(state.credentialId)}`,{method:'DELETE',token:state.bootstrapToken,cleanup:true});if(revoked.status===204)evidence.cleanup.issuedCredentialRevocations++;else failures.add('unverified_child_revoke_unconfirmed');}
        continue;
      }
      for(const id of state.exports){const revoked=await request(state,`/v1/exports/${encodeURIComponent(id)}`,{method:'DELETE',cleanup:true});if(revoked.status!==204 && revoked.status!==404 && revoked.status!==410)failures.add('export_revoke_unconfirmed');}
      let acknowledged=false,denied=false;
      for(let attempt=0;attempt<3;attempt++){
        const deleted=await request(state,'/v1/workspace',{method:'DELETE',token:state.bootstrapToken,cleanup:true});acknowledged ||= deleted.status===204;
        const original=await request(state,'/v1/usage',{token:state.bootstrapToken,cleanup:true});const child=await request(state,'/v1/usage',{cleanup:true});
        denied=original.status===401&&child.status===401;if(acknowledged&&denied)break;
      }
      if(acknowledged)evidence.cleanup.tombstoned++;if(denied)evidence.cleanup.credentialDenialsVerified++;
      if(!acknowledged||!denied)failures.add('workspace_cleanup_not_verified');
    }
    evidence.maximumObservedConcurrency=maximumObservedConcurrency;
    evidence.failures=[...failures];evidence.status=failures.size===0?'passed':'failed';evidence.finishedAt=new Date().toISOString();
    await mkdir(dirname(resolve(output)),{recursive:true});const temp=`${output}.${randomUUID()}.tmp`;
    await writeFile(temp,JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,output);
    process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
  }
  console.log(`Hosted sustained rehearsal ${evidence.status}; private evidence contains aggregate metrics only.`);
  return evidence;
}

async function main(){
  const input=await loadPrivateWorkspaceFile(process.env.LIKERTS_HOSTED_WORKSPACES_FILE);
  const config=validateConfig(input,{rate:process.env.LIKERTS_HOSTED_TARGET_RPS,durationSeconds:process.env.LIKERTS_HOSTED_DURATION_SECONDS});
  if(process.argv.includes('--dry-run')){console.log(JSON.stringify({mode:'dry-run',networkRequests:0,workspaceCount:config.workspaces.length,plan:config.plan},null,2));return;}
  requireValue(typeof process.env.LIKERTS_HOSTED_EVIDENCE_OUTPUT==='string' && resolve(process.env.LIKERTS_HOSTED_EVIDENCE_OUTPUT)!==resolve(process.env.LIKERTS_HOSTED_WORKSPACES_FILE),'evidence_must_not_overwrite_credentials');
  const evidence=await runHosted(config,{base:process.env.LIKERTS_HOSTED_BASE_URL,output:process.env.LIKERTS_HOSTED_EVIDENCE_OUTPUT});
  if(evidence.status!=='passed')process.exitCode=1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){main().catch(error=>{console.error(/^[a-z_]+$/.test(error.message)?error.message:'hosted_sustained_configuration_or_evidence_failure');process.exitCode=1;});}
