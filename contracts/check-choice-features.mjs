import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const Ajv=createRequire(new URL('../tools/mcp/package.json',import.meta.url))('ajv/dist/2020').default;
const spec=read('openapi.json'),ajv=new Ajv({strict:false,allErrors:true});
const validator=name=>ajv.compile({$ref:`#/components/schemas/${name}`,components:spec.components});
const draft=read('choice-survey.example.json'),submission=read('choice-response.example.json');
const validateDraft=validator('DraftInput'),validateSubmission=validator('Submission');
assert(validateDraft(draft),JSON.stringify(validateDraft.errors));assert(validateSubmission(submission),JSON.stringify(validateSubmission.errors));
for(const replacement of [null,{maxLength:0},{maxLength:10001},{maxLength:10,script:'x'}]){const bad=structuredClone(draft);bad.questions[0].options[2].other=replacement;assert.equal(validateDraft(bad),false,JSON.stringify(replacement));}
for(const replacement of [false,'yes',null]){const bad=structuredClone(draft);bad.questions[0].options[3].exclusive=replacement;assert.equal(validateDraft(bad),false);}
for(const answer of [{selected:[1],otherText:{}},{selected:['other'],otherText:{other:1}},{selected:['other'],otherText:{},unexpected:true}])assert.equal(validateSubmission({...submission,answers:{reasons:answer}}),false);
console.log('Choice feature OpenAPI: typed v3 fields and structured answer examples validate; malformed fields/answer shapes fail.');
