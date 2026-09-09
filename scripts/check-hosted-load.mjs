// Bounded hosted acceptance, not a capacity or availability benchmark.
// Supply a pristine temporary workspace from bootstrap-rehearsal.sh. Credentials
// enter only through environment variables and never enter evidence or logs.
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';

const base = process.env.LIKERTS_HOSTED_BASE_URL;
const bootstrapToken = process.env.LIKERTS_HOSTED_BOOTSTRAP_TOKEN;
const workspace = process.env.LIKERTS_HOSTED_TEMP_WORKSPACE;
const output = process.env.LIKERTS_HOSTED_EVIDENCE_OUTPUT;
if (!base || !bootstrapToken || !output || !/^hosted-launch-[a-z0-9-]+$/.test(workspace ?? '')) {
  console.error('Missing hosted load configuration or invalid temporary workspace name');
  process.exit(1);
}
const origin = new URL(base);
if (origin.protocol !== 'https:' || origin.origin !== base || origin.username || origin.password) {
  console.error('Hosted API must be an exact HTTPS origin');
  process.exit(1);
}
const evidence = {
  schemaVersion: 1, measuredAt: new Date().toISOString(), base, temporaryWorkspace: workspace,
  status: 'failed', workload: {pacedResponses: 100, pacedRequestsPerSecond: 5,
    burstResponses: 100, maximumConcurrency: 10, duplicateRequests: 20,
    invalidRequests: 10, unauthorizedRequests: 10, capRaceRequests: 20,
    capRaceAcceptances: 10, expectedAcceptedResponses: 211, maximumSubmissionRequests: 260},
  phases: [], accounting: null, failures: [],
  cleanup: {workspaceTombstoned: false, bootstrapDenied: false, childDenied: false},
  limitations: ['Short bounded rehearsal within one workspace promotional grant; not sustained capacity, failover, SLA or cost evidence.',
    'Client latency includes internet transit from the runner. Load-balancer replica placement is not asserted.',
    'No real respondent data or paid credit purchases. Cleanup verification checks API denial after workspace tombstoning.'],
};
const fail = code => { throw new Error(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const headers = token => ({authorization: `Bearer ${token}`, 'content-type': 'application/json'});
const request = async (path, {method = 'GET', token = bootstrapToken, body} = {}) => {
  const started = performance.now();
  try {
    const response = await fetch(`${base}${path}`, {method, headers: headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(15_000)});
    const reader = response.body?.getReader();
    let size = 0; const chunks = [];
    if (reader) for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > 1024 * 1024) { await reader.cancel(); return {status: 'oversized', ms: performance.now() - started}; }
      chunks.push(value);
    }
    let value = null;
    try { value = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    return {status: response.status, value, ms: performance.now() - started};
  } catch { return {status: 'transport_error', ms: performance.now() - started}; }
};
const expect = async (path, options, status, code) => {
  const result = await request(path, options);
  requireValue(result.status === status, code);
  return result.value;
};
const phase = async (name, count, concurrency, work, intervalMs = 0) => {
  const started = performance.now(); let next = 0; const results = [];
  await Promise.all(Array.from({length: concurrency}, async () => {
    for (;;) {
      const index = next++; if (index >= count) return;
      const scheduled = started + index * intervalMs;
      if (scheduled > performance.now()) await sleep(scheduled - performance.now());
      const result = await work(index);
      results.push({...result, scheduledMs: performance.now() - scheduled});
    }
  }));
  const seconds = (performance.now() - started) / 1000;
  const percentile = (values, p) => Math.round(values.sort((a,b) => a-b)[Math.ceil(values.length*p)-1] * 1000)/1000;
  const statuses = {};
  for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  evidence.phases.push({name, requests: count, concurrency, targetRequestsPerSecond: intervalMs ? 1000/intervalMs : null,
    seconds, requestsPerSecond: count/seconds, statuses,
    latencyMs: {p50: percentile(results.map(r=>r.ms), .5), p95: percentile(results.map(r=>r.ms), .95), p99: percentile(results.map(r=>r.ms), .99)},
    scheduledLatencyP95Ms: intervalMs ? percentile(results.map(r=>r.scheduledMs), .95) : null});
  return results;
};
let ownedWorkspace = false; let childToken;
try {
  const issued = await expect('/v1/service-credentials', {method:'POST', body:{name:'hosted-bounded-load',
    scopes:['surveys:read','surveys:write','collections:write','responses:read','usage:read','identity:write'],
    expiresAt:new Date(Date.now()+3600_000).toISOString()}}, 201, 'credential_issue_failed');
  requireValue(issued?.credential?.workspaceId === workspace && typeof issued.token === 'string', 'workspace_binding_failed');
  childToken = issued.token;
  const baseline = await expect('/v1/usage', {token:childToken}, 200, 'baseline_unavailable');
  requireValue(baseline.acceptedResponses === 0 && baseline.chargedCents === 0 && baseline.credits?.promotionalCredits === 1000
    && baseline.credits.paidCredits === 0 && baseline.credits.paidCreditDebt === 0 && baseline.credits.paidResponses === 0,
    'workspace_not_pristine');
  ownedWorkspace = true;
  const management = {token:childToken};
  const sdkCapabilities = {installations:[{target:'web',sdkVersion:'0.0.3',schemaVersions:[1,2,3,4,5]}]};
  const survey = await expect('/v1/surveys', {...management,method:'POST',body:{idempotencyKey:randomUUID(),
    title:'Synthetic hosted load acceptance',questions:[{id:'rating',type:'scale',label:'Synthetic rating',required:true,min:1,max:5}]}},201,'survey_create_failed');
  const version = await expect(`/v1/surveys/${survey.id}/publish`, {...management,method:'POST',body:{revision:survey.revision,sdkCapabilities}},200,'publication_failed');
  const collection = async cap => expect('/v1/collections', {...management,method:'POST',body:{idempotencyKey:randomUUID(),
    surveyId:survey.id,version:version.version,placement:'hosted-bounded-load',responseCap:cap,sdkCapabilities}},201,'collection_create_failed');
  const main = await collection(201); const race = await collection(10);
  const submit = (c,key,answers={rating:5},token=c.token) => request(`/v1/collections/${c.id}/responses`, {method:'POST',token,body:{idempotencyKey:key,answers,metadata:{source:'synthetic-hosted-load'}}});
  const acceptedIds = new Set();
  const record = results => { for (const r of results) if (r.status === 200) {
    requireValue(r.value?.accepted === true && r.value.chargedCents === 1 && typeof r.value.responseId === 'string','receipt_invalid');
    acceptedIds.add(r.value.responseId);
  }};
  const paced = await phase('paced-valid',100,10,()=>submit(main,randomUUID()),200);
  record(paced); requireValue(paced.every(r=>r.status===200),'paced_acceptance_failed');
  const burst = await phase('burst-valid',100,10,()=>submit(main,randomUUID()));
  record(burst); requireValue(burst.every(r=>r.status===200),'burst_acceptance_failed');
  const duplicateKey = randomUUID();
  const duplicates = await phase('duplicate-retries',20,10,()=>submit(main,duplicateKey));
  record(duplicates); requireValue(duplicates.every(r=>r.status===200) && new Set(duplicates.map(r=>r.value?.responseId)).size===1,'duplicate_invariant_failed');
  // Use a separate collection so validation executes before an already-full cap.
  const rejected = await collection(1);
  const invalid = await phase('invalid-answers',10,5,()=>submit(rejected,randomUUID(),{rating:99}));
  requireValue(invalid.every(r=>r.status===400),'validation_denial_failed');
  const unauthorized = await phase('unauthorized',10,5,()=>submit(rejected,randomUUID(),{rating:5},'invalid-synthetic-capability'));
  requireValue(unauthorized.every(r=>r.status===401),'authentication_denial_failed');
  const caps = await phase('cap-race',20,10,()=>submit(race,randomUUID()));
  record(caps);
  requireValue(caps.filter(r=>r.status===200).length===10 && caps.filter(r=>r.status===409).length===10,'cap_invariant_failed');
  const usage = await expect('/v1/usage',management,200,'accounting_unavailable');
  evidence.accounting = {uniqueAcceptedReceipts:acceptedIds.size,acceptedResponses:usage.acceptedResponses,
    chargedCents:usage.chargedCents,promotionalResponses:usage.credits.promotionalResponses,
    promotionalCreditsRemaining:usage.credits.promotionalCredits,paidCredits:usage.credits.paidCredits,
    paidCreditDebt:usage.credits.paidCreditDebt,paidResponses:usage.credits.paidResponses,unpaidExposureCents:usage.unpaidExposureCents};
  requireValue(acceptedIds.size===211 && usage.acceptedResponses===211 && usage.chargedCents===211
    && usage.credits.promotionalResponses===211 && usage.credits.promotionalCredits===789
    && usage.credits.paidCredits===0 && usage.credits.paidCreditDebt===0 && usage.credits.paidResponses===0
    && usage.unpaidExposureCents===0,'accounting_invariant_failed');
} catch (error) {
  evidence.failures.push(/^[a-z_]+$/.test(error.message) ? error.message : 'unexpected_runner_failure');
} finally {
  if (ownedWorkspace) {
    let deletionAcknowledged = false;
    for (let attempt=0;attempt<3;attempt++) {
      const deleted = await request('/v1/workspace',{method:'DELETE'});
      deletionAcknowledged ||= deleted.status===204;
      const bootstrap = await request('/v1/usage');
      const child = await request('/v1/usage',{token:childToken});
      evidence.cleanup.bootstrapDenied = bootstrap.status===401;
      evidence.cleanup.childDenied = child.status===401;
      evidence.cleanup.workspaceTombstoned = deletionAcknowledged && evidence.cleanup.bootstrapDenied && evidence.cleanup.childDenied;
      if (evidence.cleanup.workspaceTombstoned) break;
    }
    if (!evidence.cleanup.workspaceTombstoned) evidence.failures.push('cleanup_not_verified');
  } else evidence.failures.push('cleanup_not_authorized_for_unverified_workspace');
  evidence.status = evidence.failures.length===0 ? 'passed' : 'failed';
  await writeFile(output,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
}
console.log(`Hosted bounded load ${evidence.status}; evidence contains aggregate metrics only`);
if (evidence.status!=='passed') process.exitCode=1;
