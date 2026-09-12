import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {operationContracts} from '../tools/mcp/dist/contract.js';
import {examples} from './example-data.mjs';
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const spec=read('openapi.json'),registry=read('../tools/capabilities.json'),exemptions=read('interface-exemptions.json'),codes=read('error-codes.json');
const operations=Object.entries(spec.paths).flatMap(([path,methods])=>Object.entries(methods).map(([method,op])=>({path,method:method.toUpperCase(),op})));
const key=x=>`${x.method} ${x.path}`;
assert.equal(new Set(registry.map(c=>c.name)).size,registry.length);
assert.deepEqual(spec.components.schemas.ToolError.properties.error.oneOf[0].properties.operation.enum.slice().sort(),registry.map(c=>c.name).sort(),'Every capability must be represented in structured tool errors');
assert.deepEqual(Object.keys(examples).sort(),registry.map(c=>c.name).sort(),'Every capability needs an input and output example');
assert.deepEqual(operations.filter(x=>x.op['x-interface-exempt']).map(key).sort(),exemptions.map(key).sort(),'Every transport exemption needs a reviewed reason');
assert.ok(exemptions.every(e=>e.reason.length>20));

// Verify current Axum registration, including chained methods. This deliberately
// fails if router construction changes beyond this bounded parser's grammar.
const source=readFileSync(new URL('../backend/src/main.rs',import.meta.url),'utf8');
const router=source.split('let router = Router::new()')[1]?.split('.with_state(app)')[0];
assert.ok(router,'Router inventory parser requires review after routing refactors');
const routes=[];
const pattern=/\.route\(\s*"([^"]+)"\s*,/g;
for(const match of router.matchAll(pattern)){
  let end=match.index+match[0].length,depth=1,quoted=false,escaped=false;
  for(;end<router.length&&depth;end++){const ch=router[end];if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;}else if(ch==='"')quoted=true;else if(ch==='(')depth++;else if(ch===')')depth--;}
  assert.equal(depth,0,'Unclosed route declaration');
  const expression=router.slice(match.index+match[0].length,end-1);
  const methods=[...expression.matchAll(/\b(get|post|put|patch|delete|options|head|trace)\s*\(/g)].map(m=>m[1].toUpperCase());
  assert.ok(methods.length,'Unrecognized route-method construction');
  routes.push(...methods.map(method=>({method,path:match[1]})));
}
assert.equal([...router.matchAll(/\.route\(/g)].length,[...router.matchAll(pattern)].length,'Nonliteral route requires explicit inventory support');
assert.deepEqual(routes.map(key).sort(),operations.map(key).sort(),'Registered HTTP routes and OpenAPI must match exactly');
const documentedCodes=Object.values(codes).flat().sort();
const errorSources=source+readFileSync(new URL('../backend/src/admission.rs',import.meta.url),'utf8');
const mappedCodes=[...errorSources.matchAll(/StatusCode::[A-Z_]+\s*,\s*"([a-z_]+)"/g)].map(m=>m[1]);
mappedCodes.push('payload_too_large','unsupported_media_type');
assert.deepEqual([...new Set(mappedCodes)].sort(),documentedCodes,'New backend error codes require documentation and examples');
assert.deepEqual(spec.components.schemas.Error.properties.error.properties.code.enum.slice().sort(),documentedCodes);

const Ajv=createRequire(new URL('../tools/mcp/package.json',import.meta.url))('ajv/dist/2020').default;
const ajv=new Ajv({strict:false});
const errorValidator=ajv.compile({$ref:'#/components/schemas/Error',components:spec.components});
for(const c of registry){
  const operation=spec.paths[c.path][c.method.toLowerCase()],contract=operationContracts.get(c.name),example=examples[c.name];
  assert.ok(contract.validateInput(example.input),`${c.name} input: ${JSON.stringify(contract.validateInput.errors)}`);
  assert.ok(contract.validateOutput({result:example.output}),`${c.name} output: ${JSON.stringify(contract.validateOutput.errors)}`);
  assert.ok(example.note.length>20,`${c.name} needs useful usage guidance`);
  const expectedBody={...example.input};if(c.path.includes('{id}'))delete expectedBody.id;
  if(operation.requestBody?.content?.['application/json'])assert.deepEqual(operation.requestBody.content['application/json'].example,expectedBody,`${c.name} OpenAPI body example`);
  for(const[status,response]of Object.entries(operation.responses))if(/^2\d\d$/.test(status)&&status!=='204')assert.deepEqual(response.content?.['application/json']?.example,example.output,`${c.name} OpenAPI result example`);
  assert.equal(contract.validateInput({...example.input,unexpectedContractField:true}),false,`${c.name} rejects unknown arguments`);
  for(const required of contract.inputSchema.required){const missing=structuredClone(example.input);delete missing[required];assert.equal(contract.validateInput(missing),false,`${c.name} requires ${required}`);}
  for(const status of ['400','401','500',...(c.auth==='management'?['403']:[]),...(operation.requestBody?.required?['413','415']:[])])assert.ok(operation.responses[status],`${c.name} missing ${status} response`);
  for(const[status,response]of Object.entries(operation.responses)){
    if(!/^[45]\d\d$/.test(status))continue;
    const json=response.content?.['application/json'];assert.equal(json?.schema?.$ref,'#/components/schemas/Error',`${c.name}/${status} error schema`);
    assert.ok(errorValidator(json.example),`${c.name}/${status} error example`);
    assert.ok(codes[status].includes(json.example.error.code),`${c.name}/${status} error code/status agreement`);
  }
  if(c.auth==='management')assert.ok(spec.components.schemas.OAuthScope.enum.includes(operation['x-required-scope']),`${c.name} scope must be documented`);
}
for(const status of ['409','410','429'])assert.ok(spec.paths['/v1/collections/{id}/responses'].post.responses[status],`Submission missing ${status}`);
console.log(`Release contract passed: ${registry.length} typed capabilities, ${routes.length} exact HTTP registrations, ${documentedCodes.length} structured API error codes.`);
