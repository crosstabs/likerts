import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateConfig,verifyThresholds} from '../scripts/check-hosted-credit-notifications.mjs';
const valid=()=>({workspaceId:'hosted-launch-credits-123',disposable:true,receiverOwned:true,bootstrapToken:'synthetic-workspace-token',verifierToken:'synthetic-verifier-token',endpointId:randomUUID(),receiverUrl:'https://owned-fixture.vercel.app/api/receive',verifierUrl:'https://owned-fixture.vercel.app/api/events'});
test('hosted runner requires owned disposable workspace and exact independently hosted receiver contract',()=>{
 assert.equal(validateConfig(valid(),'https://api.likerts.example').workspaceId,'hosted-launch-credits-123');
 for(const patch of [{workspaceId:'customer-bank'},{disposable:false},{receiverOwned:false},{endpointId:'path/escape'},{bootstrapToken:'secret\nvalue'},{verifierUrl:'https://other.example/api/events'},{receiverUrl:'https://owned-fixture.vercel.app/api/receive?token=secret'},{verifierUrl:'https://user:pass@owned-fixture.vercel.app/api/events'}]) assert.throws(()=>validateConfig({...valid(),...patch},'https://api.likerts.example'));
 assert.throws(()=>validateConfig(valid(),'https://api.likerts.example/path'));
 assert.throws(()=>validateConfig(valid(),'https://owned-fixture.vercel.app'));
});
function receipts(){const generationId=randomUUID();const events=[80,90,100].map(thresholdPercent=>({eventId:randomUUID(),deliveryId:randomUUID(),attemptId:randomUUID(),eventType:'credits.threshold_reached',signatureVerified:true,bucket:'promotional',generationId,thresholdPercent}));return {events,deliveries:events.map(e=>({id:e.deliveryId,eventId:e.eventId,status:'delivered'}))};}
test('receiver proof must cover every threshold in one generation and match delivered API IDs',()=>{
 const {events,deliveries}=receipts();assert.equal(verifyThresholds(events,deliveries).signaturesVerified,3);
 for(const patch of [{signatureVerified:false},{bucket:'paid'},{generationId:randomUUID()},{eventId:events[1].eventId},{thresholdPercent:90},{deliveryId:randomUUID()}]) assert.throws(()=>verifyThresholds([{...events[0],...patch},...events.slice(1)],deliveries));
 assert.throws(()=>verifyThresholds(events,[{...deliveries[0],status:'queued'},...deliveries.slice(1)]));
 assert.throws(()=>verifyThresholds(events.slice(1),deliveries));
});
test('failed workspace binding cleans only the exact child and never deletes a workspace or enables delivery',async()=>{
 const {runHosted}=await import('../scripts/check-hosted-credit-notifications.mjs');
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'likerts-credit-runner-'));const output=join(directory,'evidence.json');
 const config=valid(),child=randomUUID(),requests=[],original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  const path=new URL(url).pathname;requests.push({path,method:options.method});
  if(path==='/v1/usage')return Response.json({acceptedResponses:0,chargedCents:0,unpaidExposureCents:0,credits:{promotionalCredits:1000,promotionalResponses:0,paidCredits:0,paidCreditDebt:0,paidResponses:0}});
  if(path==='/v1/surveys')return Response.json([]);
  if(path==='/v1/service-credentials')return Response.json({credential:{id:child,workspaceId:'unverified-other'},token:'synthetic-child-token'},{status:201});
  if(path===`/v1/service-credentials/${child}`&&options.method==='DELETE')return new Response(null,{status:204});
  throw new Error('unexpected_test_request');
 };
 try {
  const result=await runHosted(config,{base:'https://api.likerts.example',output});
  assert.equal(result.status,'failed');assert.deepEqual(result.failures,['workspace_binding_failed']);
  assert.equal(result.cleanup.workspaceTombstoned,false);assert.equal(result.cleanup.workspaceBindingVerified,false);
  assert(!requests.some(r=>r.path==='/v1/workspace'||r.path.startsWith('/v1/webhook-endpoints')));
  assert.deepEqual(requests.at(-1),{path:`/v1/service-credentials/${child}`,method:'DELETE'});
  const recorded=await readFile(output,'utf8');assert(!recorded.includes(config.bootstrapToken));assert(!recorded.includes(config.verifierToken));
 }finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
