import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateConfig, loadPrivateWorkspaceFile, isPristineUsage } from '../scripts/check-hosted-sustained.mjs';
const exec=promisify(execFile);
const input=()=>({workspaces:Array.from({length:4},(_,i)=>({workspaceId:`hosted-launch-sustained-test-${i}`,bootstrapToken:`synthetic-private-token-${i}`,disposable:true}))});

test('default sustained plan cannot consume a paid response or exceed configured attempt bounds',()=>{
  const config=validateConfig(input());
  assert.equal(config.durationSeconds,600);
  assert.equal(config.plan.scheduledSubmissionSlots,3000);
  assert.equal(config.plan.maximumSubmissionAttempts,3004);
  assert.deepEqual(config.plan.phases,{valid:2700,duplicate:150,invalid:150});
  assert.equal(config.plan.maximumPromotionalResponses,2704);
  assert.ok(config.plan.perWorkspaceMaximumAccepted.every(count=>count+1<1000));
  assert.equal(config.plan.maximumAggregateRequestsPerSecond,5);
  assert.equal(config.plan.maximumPaidExposureCents,0);
  assert.throws(()=>validateConfig({workspaces:input().workspaces.slice(0,3)}),/insufficient_pristine_workspaces/);
});

test('configuration fails closed for names, attestation, duplicates and excessive load',()=>{
  for(const [key,value] of [['workspaceId','real-customer'],['disposable',false],['bootstrapToken','token\nheader']]){
    const config=input();config.workspaces[0][key]=value;assert.throws(()=>validateConfig(config));
  }
  const config=input();config.workspaces[1]=config.workspaces[0];assert.throws(()=>validateConfig(config),/duplicate_workspace_or_credential/);
  for(const rate of [0,5.1,NaN,Infinity])assert.throws(()=>validateConfig(input(),{rate}),/rate_out_of_bounds/);
  for(const durationSeconds of [0,59,601,Infinity])assert.throws(()=>validateConfig(input(),{durationSeconds}),/duration_out_of_bounds/);
});

test('a paid, already-used or uncertain workspace is never pristine',()=>{
  const baseline={acceptedResponses:0,chargedCents:0,unpaidExposureCents:0,credits:{promotionalCredits:1000,promotionalResponses:0,paidCredits:0,paidCreditDebt:0,paidResponses:0}};
  assert.equal(isPristineUsage(baseline),true);
  assert.equal(isPristineUsage(null),false);
  for(const key of ['acceptedResponses','chargedCents','unpaidExposureCents'])assert.equal(isPristineUsage({...baseline,[key]:1}),false);
  for(const key of ['promotionalResponses','paidCredits','paidCreditDebt','paidResponses'])assert.equal(isPristineUsage({...baseline,credits:{...baseline.credits,[key]:1}}),false);
  assert.equal(isPristineUsage({...baseline,credits:{...baseline.credits,promotionalCredits:999}}),false);
});

test('credential file must be private and regular; dry run emits no identifiers or credentials',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'likerts-sustained-validation-'));
  try{
    const file=join(dir,'workspaces.json');await writeFile(file,JSON.stringify(input()),{mode:0o600});
    assert.equal((await loadPrivateWorkspaceFile(file)).workspaces.length,4);
    const alias=join(dir,'alias.json');await symlink(file,alias);await assert.rejects(loadPrivateWorkspaceFile(alias),/workspace_file_must_be_regular/);
    await chmod(file,0o644);await assert.rejects(loadPrivateWorkspaceFile(file),/workspace_file_must_be_private/);await chmod(file,0o600);
    const {stdout,stderr}=await exec(process.execPath,['scripts/check-hosted-sustained.mjs','--dry-run'],{
      cwd:new URL('../',import.meta.url),env:{PATH:process.env.PATH,LIKERTS_HOSTED_WORKSPACES_FILE:file},
    });
    assert.equal(stderr,'');const result=JSON.parse(stdout);assert.equal(result.networkRequests,0);assert.equal(result.workspaceCount,4);
    assert.doesNotMatch(stdout,/synthetic-private-token|hosted-launch-sustained-test|bootstrapToken/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
