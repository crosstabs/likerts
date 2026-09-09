// Synthetic receiver configuration. These values never contact a real customer endpoint.
const id='10000000-0000-4000-8000-000000000041',keyId='10000000-0000-4000-8000-000000000042',deliveryId='10000000-0000-4000-8000-000000000043',eventId='10000000-0000-4000-8000-000000000044';
const endpoint={id,url:'https://hooks.customer.com/likerts',enabled:false,revoked:false,keyId,createdAt:'2026-09-09T00:00:00Z'};
const credential={endpoint,signingSecret:'whsec_'+'a'.repeat(43)};
const delivery={id:deliveryId,endpointId:id,eventId,status:'failed',attempts:7,replayCount:0,nextAttemptAt:'2026-09-10T00:00:00Z',lastStatus:503,failureCode:'attempts_exhausted',expiresAt:'2026-09-16T00:00:00Z'};
const entry=(input,output,note)=>({input,output,note});
export const webhookExamples={
 webhook_endpoints_create:entry({idempotencyKey:'webhook-create-001',url:endpoint.url},credential,'Creates disabled. Install the returned signing secret on your receiver, then explicitly enable. An identical idempotency retry reconstructs the original generation.'),
 webhook_endpoints_list:entry({},[endpoint],'Lists up to 100 workspace endpoints, including revoked entries. Signing secrets are never listed.'),
 webhook_endpoints_update:entry({id,enabled:true},{...endpoint,enabled:true},'Enable only after configuring verification. Use enabled:false to pause, or revoke:true to permanently cancel queued deliveries; an in-flight HTTP request cannot be recalled.'),
 webhook_endpoints_rotate:entry({id,idempotencyKey:'webhook-rotate-001'},{endpoint:{...endpoint,keyId:'10000000-0000-4000-8000-000000000045'},signingSecret:'whsec_'+'b'.repeat(43)},'Install the new generation and retain the old receiver secret for five minutes. New claims use the new generation; identical rotation retries return the original protected result.'),
 webhook_deliveries_list:entry({endpointId:id,limit:100},[delivery],'Inspect delivery status. Continue with after equal to the last returned UUID for a stable ordering of existing rows; this operational list is not a response snapshot.'),
 webhook_deliveries_get:entry({id:deliveryId},delivery,'Read attempts, retry time and fixed failure code. Receiver bodies and survey answers are never exposed through delivery status.'),
 webhook_deliveries_replay:entry({id:deliveryId,idempotencyKey:'webhook-replay-001'},{...delivery,status:'queued',attempts:0,replayCount:1,lastStatus:null,failureCode:null},'Requeue a completed or failed delivery before seven-day expiry, up to three times. The event ID remains unchanged; receivers deduplicate business processing by that ID.')
};
