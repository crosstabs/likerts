import {webhookExamples} from './webhook-examples.mjs';
// Synthetic, independent operation examples. Replace IDs with returned resources.
const surveyId='10000000-0000-4000-8000-000000000001';
const collectionId='10000000-0000-4000-8000-000000000002';
const responseId='10000000-0000-4000-8000-000000000003';
const exportId='10000000-0000-4000-8000-000000000004';
const credentialId='10000000-0000-4000-8000-000000000005';
const grantId='10000000-0000-4000-8000-000000000006';
const settlementId='10000000-0000-4000-8000-000000000007';
const createdAt='2026-09-08T12:00:00Z', expiresAt='2026-09-09T12:00:00Z';
const questions=[{id:'rating',type:'scale',label:'How was your experience?',required:true,min:1,max:5}];
const draft={title:'Checkout feedback',questions};
const survey={id:surveyId,revision:1,...draft};
const sdkCapabilities={installations:[{target:'web',sdkVersion:'0.0.1',schemaVersions:[1,2]}]};
const version={surveyId,version:1,...draft,sdkCapabilities};
const collection={id:collectionId,surveyId,version:1,placement:'checkout',token:'10000000-0000-4000-8000-000000000008',accepting:true,expiresAt:null,responseCap:100,revoked:false,sdkCapabilities};
const receipt={responseId,collectionId,accepted:true,chargedCents:1};
const response={receipt,answers:{rating:5},metadata:{channel:'app'},acceptedAt:createdAt};
const usage={acceptedResponses:1,chargedCents:1,unpaidExposureCents:0,monthAcceptedResponses:1,monthChargedCents:1,monthlySpendCapCents:500,unpaidExposureCapCents:500,remainingMonthlyCents:500,remainingExposureCents:500,acceptingPaidResponses:true,blockedReason:null,credits:{promotionalCredits:999,paidCredits:0,availableCredits:999,promotionalResponses:1,paidResponses:0,monthPaidResponses:0}};
const job={id:exportId,format:'json',status:'queued',createdAt,expiresAt,responseCount:null,contentSha256:null,manifest:null,errorCode:null};
const manifest={formatVersion:1,responseCount:0,snapshotUpperSequence:0,collectionId:null,acceptedFrom:null,acceptedTo:null,schemas:[]};
const credential={id:credentialId,workspaceId:'example-workspace',name:'Backend collector',scopes:['surveys:read'],expiresAt,revoked:false};
const grant={id:grantId,workspaceId:'example-workspace',subject:'user_2example',clientId:'oauth_app_2example',audience:'https://api.example.com',scopes:['surveys:read'],expiresAt,revoked:false};
const settlement={id:settlementId,amountCents:500,currency:'usd',status:'succeeded',providerIntentId:'pi_synthetic_example',failureCode:null};
const entry=(input,output,note)=>({input,output,note});
export const examples={
  ...webhookExamples,
  surveys_create:entry({idempotencyKey:'survey-create-001',...draft},survey,'Retain this key and identical draft for an ambiguous retry.'),
  surveys_list:entry({},[survey],'Lists the selected workspace.'),
  surveys_update:entry({id:surveyId,revision:1,...draft},{...survey,revision:2},'Use the latest revision; a stale revision returns 409.'),
  surveys_publish:entry({id:surveyId,revision:1,sdkCapabilities},version,'Declare every installed SDK group before publication.'),
  collections_create:entry({idempotencyKey:'collection-create-001',surveyId,version:1,placement:'checkout',responseCap:100,sdkCapabilities},collection,'Store the returned collection token securely; it cannot manage the workspace.'),
  collections_update:entry({id:collectionId,accepting:false},{id:collectionId,accepting:false,revoked:false},'Close acceptance; alternatively use revoke:true alone for irreversible revocation.'),
  collections_security_update:entry({id:collectionId,allowedOrigins:['https://app.example.com'],requestsPerMinute:6000},{collectionId,allowedOrigins:['https://app.example.com'],requestsPerMinute:6000},'Origins are exact browser policy. Customer authentication still belongs to the host app.'),
  collections_get:entry({id:collectionId},{id:collectionId,surveyId,version:1,placement:'checkout',schema:{schemaVersion:1,...draft}},'Use the collection credential, never a management token in a respondent app.'),
  responses_submit:entry({id:collectionId,idempotencyKey:'completed-response-001',answers:{rating:5},metadata:{channel:'app'}},receipt,'An accepted new response incurs one cent; identical retries return the same receipt.'),
  responses_list:entry({limit:100,collectionId},{items:[response],nextCursor:null},'Continue with nextCursor and the same filters; it fixes a snapshot boundary.'),
  responses_delete:entry({id:responseId},{},'Permanently erases raw answers/metadata and revokes affected exports; usage remains.'),
  exports_create:entry({idempotencyKey:'export-001',format:'json',collectionId},job,'Poll exports_get until ready; CSV is also supported.'),
  exports_get:entry({id:exportId},job,'Poll until ready; polling resumes queued jobs and reclaims expired execution leases within this workspace.'),
  exports_download:entry({id:exportId},{contentType:'application/json',fileName:'responses.json',contentBase64:'W10=',contentSha256:'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',manifest},'Decode base64 and verify SHA-256; this synthetic example is an empty JSON array.'),
  exports_revoke:entry({id:exportId},{},'Revocation is irreversible; the stored object is removed.'),
  retention_run:entry({},{responsesErased:0,exportsRevoked:0},'Runs one bounded batch; repeat until neither count is positive.'),
  workspace_delete:entry({}, {},'Destructive: tombstones the current workspace and revokes its capabilities.'),
  memberships_list:entry({},[{subject:'user_2example',role:'reader',grantedAt:createdAt}],'Requires owner authorization.'),
  memberships_put:entry({subject:'user_2example',role:'reader'},{},'Requires an existing verified subject; grants/replaces this workspace role.'),
  memberships_revoke:entry({subject:'user_2example'},{},'Revokes access on subsequent requests.'),
  service_credentials_list:entry({},[credential],'Returns metadata only, never existing secret values.'),
  service_credentials_create:entry({name:credential.name,scopes:credential.scopes,expiresAt},{credential,token:'synthetic-example-not-a-real-credential'},'The token is returned once. Replace the illustrative expiry with a future timestamp.'),
  service_credentials_revoke:entry({id:credentialId},{},'Revokes the credential immediately and irreversibly.'),
  oauth_grants_create:entry({subject:grant.subject,clientId:grant.clientId,scopes:grant.scopes,expiresAt},grant,'Records consent; this operation does not itself mint an OAuth access token.'),
  oauth_grants_revoke:entry({id:grantId},{},'Revokes the scoped grant for subsequent API requests.'),
  billing_limits_update:entry({monthlySpendCapCents:500,unpaidExposureCapCents:500},usage,'Monthly cap limits paid-credit consumption; promotional credits remain usable. Unpaid exposure describes legacy postpaid usage.'),
  billing_account_put:entry({providerCustomerId:'cus_synthetic_example',providerPaymentMethodId:'pm_synthetic_example'},{},'Use customer/payment-method IDs from the configured test provider; never send card details.'),
  billing_settlements_list:entry({},[settlement],'Lists durable settlement batches; chargedCents alone is not cash collected.'),
  billing_settlements_create:entry({idempotencyKey:'settlement-001'},settlement,'May submit a real test-mode charge. Requires eligible unsettled usage and a configured provider account.'),
  billing_settlements_reconcile:entry({id:settlementId},settlement,'Retrieves provider state and reconciles local settlement accounting.'),
  billing_settlements_refund:entry({id:settlementId,amountCents:500,reason:'Customer-requested refund',idempotencyKey:'refund-001'},{...settlement,status:'refunded'},'Requests a provider refund and records its immutable adjustment.'),
  usage_get:entry({},usage,'Gross usage remains one cent per accepted response; credits fund acceptance, promo first. No double billing on retry or later settlement.')
};
