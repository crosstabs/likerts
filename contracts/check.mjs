// Run after npm ci --prefix tools/mcp. Reuses its pinned AJV dependency.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../tools/mcp/package.json', import.meta.url));
const Ajv = require('ajv/dist/2020').default;
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const spec = read('openapi.json');
const registry = read('../tools/capabilities.json');
const operations = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({path, method:method.toUpperCase(), name:op.operationId, op})));
assert.equal(new Set(operations.map(o=>o.name)).size, operations.length, 'Duplicate operationId');
const projected = entries => entries.map(({path,method,name})=>`${method} ${path} ${name}`).sort();
assert.deepEqual(projected(operations.filter(o=>o.name!=='health' && o.op['x-interface-exempt']!==true)), projected(registry), 'API/MCP/CLI capability parity');
for (const capability of registry) {
  const operation = operations.find(o=>o.name===capability.name).op;
  assert.deepEqual(operation.security, [{[capability.auth+'Bearer']:[]}], capability.name+' credential contract');
}
const ajv = new Ajv({strict:false,allErrors:true});
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat('uri', value => {try {new URL(value);return true;} catch {return false;}});
ajv.addFormat('date-time', value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)));
const validator = name => ajv.compile({$ref:`#/components/schemas/${name}`,components:spec.components});
// Compile every component so unresolved schema references fail even when not used by fixtures.
for (const name of Object.keys(spec.components.schemas)) validator(name);
const draft = read('survey.example.json');
const submission = read('response.example.json');
const compatibility = read('sdk-compatibility.json');
const sdkCapabilities = {installations:[compatibility.currentFleet.installations[0]]};
const validateSdkCapabilities = validator('SdkCapabilities');
assert.ok(validateSdkCapabilities(compatibility.currentFleet),JSON.stringify(validateSdkCapabilities.errors));
assert.ok(validateSdkCapabilities(compatibility.mixedOldAndNew),JSON.stringify(validateSdkCapabilities.errors));
const validateDraft = validator('DraftInput');
assert.ok(validateDraft(draft), JSON.stringify(validateDraft.errors));
const validateSurveyCreate = validator('SurveyCreateInput');
assert.ok(validateSurveyCreate({idempotencyKey:'contract-survey-create',...draft}), JSON.stringify(validateSurveyCreate.errors));
assert.equal(validateSurveyCreate(draft), false, 'Survey creation requires an idempotency key');
const validateCollectionCreate = validator('CollectionInput');
assert.ok(validateCollectionCreate({idempotencyKey:'contract-collection-create',surveyId:'survey-id',version:1,placement:'checkout',sdkCapabilities}), JSON.stringify(validateCollectionCreate.errors));
const validatePublish = validator('PublishInput');
assert.ok(validatePublish({revision:1,sdkCapabilities:compatibility.mixedOldAndNew}),JSON.stringify(validatePublish.errors));
assert.equal(validatePublish({revision:1}),false,'Publication requires an SDK capability declaration');
const validateExportInput = validator('ExportInput');
assert.ok(validateExportInput({idempotencyKey:'contract-export',format:'csv',collectionId:'123e4567-e89b-12d3-a456-426614174001'}),JSON.stringify(validateExportInput.errors));
assert.equal(validateExportInput({idempotencyKey:'contract-export',format:'xlsx'}),false,'Unsupported export formats fail');
const validateSubmission = validator('Submission');
assert.ok(validateSubmission(submission),JSON.stringify(validateSubmission.errors));
const validateResponsePage = validator('ResponsePage');
assert.ok(validateResponsePage({items:[{
  receipt:{responseId:'123e4567-e89b-12d3-a456-426614174000',collectionId:'123e4567-e89b-12d3-a456-426614174001',accepted:true,chargedCents:1},
  answers:{rating:5},metadata:{},acceptedAt:'2026-09-08T12:00:00Z'
}],nextCursor:'opaque'}),JSON.stringify(validateResponsePage.errors));
assert.equal(validateResponsePage({items:[],nextCursor:null,unexpected:true}),false,'Response pages reject unknown fields');
assert.equal(new Set(draft.questions.map(q=>q.type)).size,6,'Fixture must cover six question types');
const bad = structuredClone(draft); bad.questions[0].type='arbitrary_script';
assert.equal(validateDraft(bad),false,'Unknown question type must fail');
assert.equal(validateSubmission({...submission,unexpected:true}),false,'Unknown top-level field must fail');
assert.equal(validateSubmission({...submission,idempotencyKey:''}),false,'Empty idempotency key must fail');
console.log(`Contract passed: ${registry.length} API/MCP/CLI operations, ${Object.keys(spec.components.schemas).length} schemas, six-type draft and submission fixtures.`);
const expanded = read('expanded-survey.example.json');
assert.ok(validateDraft(expanded), JSON.stringify(validateDraft.errors));
assert.ok(validateSubmission(read('expanded-response.example.json')), JSON.stringify(validateSubmission.errors));
const invalidQuestion = (question, reason) => assert.equal(validateDraft({title:'Invalid draft',questions:[question]}),false,reason);
const nps = expanded.questions.find(q=>q.preset==='nps');
const yesNo = expanded.questions.find(q=>q.preset==='yes_no');
const bounded = expanded.questions.find(q=>q.type==='multiple_choice');
invalidQuestion({...nps,min:1},'NPS requires 0–10');
invalidQuestion({...yesNo,options:[{id:'yes',label:'Yes'},{id:'yes',label:'Again'}]},'Yes/no requires both stable option IDs');
invalidQuestion({...yesNo,preset:'nps'},'Wrong preset for choice');
invalidQuestion({...bounded,minSelections:-1},'Selection bounds are nonnegative');
invalidQuestion({...bounded,maxSelections:1.5},'Selection bounds are integers');
invalidQuestion({...nps,labels:{'01':'Leading zero'}},'Labels use canonical integer keys');
invalidQuestion({...nps,labels:{'0':' '}},'Labels are nonblank');
invalidQuestion({...bounded,labels:{}},'Labels only belong on scales');
invalidQuestion({...nps,preset:null},'Explicit null is invalid');
console.log('Expanded contract passed: NPS, labeled scales, yes/no and selection-bound shapes; backend owns relational range/count checks.');
const conditional = read('conditional-survey.example.json');
assert.ok(validateDraft(conditional), JSON.stringify(validateDraft.errors));
assert.ok(validateSubmission(read('conditional-response.example.json')), JSON.stringify(validateSubmission.errors));
for (const visibleWhen of [
  {questionId:'return',operator:'unsupported'},
  {questionId:'return',operator:'equals'},
  {questionId:'return',operator:'answered',value:'no'},
  null,
]) {
  const invalid=structuredClone(conditional);invalid.questions[1].visibleWhen=visibleWhen;
  assert.equal(validateDraft(invalid),false,JSON.stringify(visibleWhen));
}
console.log('Conditional contract passed: typed single-predicate schema, required/forbidden values and shared fixtures.');
const advanced = read('advanced-survey.example.json');
assert.ok(validateDraft(advanced),JSON.stringify(validateDraft.errors));
assert.ok(validateSubmission(read('advanced-response.example.json')),JSON.stringify(validateSubmission.errors));
for(const question of [
  {...advanced.questions[0],options:[advanced.questions[0].options[0]]},
  {...advanced.questions[1],matrixMode:'unsupported'},
  {...advanced.questions[1],rows:[]},
  {...advanced.questions[2],total:0},
  {...advanced.questions[2],items:[]},
]) invalidQuestion(question,'Invalid advanced structure');
console.log('Advanced contract passed: ranking, matrix and constant-sum structural bounds; backend owns dynamic membership and sum checks.');
await import('./check-release.mjs');
