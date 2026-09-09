import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import { capabilities } from './client.js';

type Schema = Record<string, any>;
const spec = JSON.parse(readFileSync(new URL('../../../contracts/openapi.json', import.meta.url), 'utf8'));
const Ajv = createRequire(import.meta.url)('ajv/dist/2020').default;
const ajv = new Ajv({strict: false, allErrors: true});
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addFormat('date-time', (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)));
ajv.addFormat('uri', (value: string) => {try {new URL(value);return true;} catch {return false;}});

// Inline local references so MCP clients need no external schema resolver.
function inline(value: any, ancestors: string[] = []): any {
  if (Array.isArray(value)) return value.map(item => inline(item, ancestors));
  if (value && typeof value === 'object') {
    if (value.$ref) {
      if (!value.$ref.startsWith('#/components/schemas/') || ancestors.includes(value.$ref)) throw new Error('Unsupported or recursive contract reference');
      const schema = spec.components.schemas[value.$ref.split('/').at(-1)];
      if (!schema) throw new Error('Missing contract schema');
      return inline(schema, [...ancestors, value.$ref]);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inline(item, ancestors)]));
  }
  return value;
}

export interface OperationContract {
  inputSchema: Schema & {type: 'object'};
  outputSchema: Schema & {type: 'object'};
  validateInput: ValidateFunction;
  validateOutput: ValidateFunction;
}
export const operationContracts = new Map<string, OperationContract>();
for (const capability of capabilities) {
  const operation = spec.paths[capability.path]?.[capability.method.toLowerCase()];
  if (operation?.operationId !== capability.name) throw new Error(`Missing OpenAPI capability ${capability.name}`);
  const body: Schema = inline(operation.requestBody?.content?.['application/json']?.schema ?? {type: 'object', properties: {}, additionalProperties: false});
  if (body.type !== 'object') throw new Error('Capability body must be an object');
  const parameters: any[] = operation.parameters ?? [];
  const properties = {...body.properties};
  const required = [...(body.required ?? [])];
  for (const parameter of parameters) {
    if (!['path', 'query'].includes(parameter.in)) continue;
    if (parameter.name in properties) throw new Error('Ambiguous body/path/query input field');
    properties[parameter.name] = inline(parameter.schema);
    if (parameter.required) required.push(parameter.name);
  }
  const parameterCount = parameters.filter(p => ['path','query'].includes(p.in) && p.required).length;
  const inputSchema: Schema & {type:'object'} = {...body, type: 'object', properties, required, additionalProperties: false};
  if (inputSchema.minProperties !== undefined) inputSchema.minProperties += parameterCount;
  if (inputSchema.maxProperties !== undefined) inputSchema.maxProperties += parameterCount;
  const successes = Object.entries(operation.responses).filter(([status]) => /^2\d\d$/.test(status));
  if (successes.length !== 1) throw new Error('Capability must have one explicit success response');
  const [status, response] = successes[0] as [string, any];
  const resultSchema = status === '204' ? {type: 'object', additionalProperties: false} : inline(response.content?.['application/json']?.schema);
  if (!resultSchema) throw new Error('Missing successful output schema');
  const outputSchema = {type: 'object' as const, properties: {result: resultSchema}, required: ['result'], additionalProperties: false};
  operationContracts.set(capability.name, {inputSchema, outputSchema, validateInput: ajv.compile(inputSchema), validateOutput: ajv.compile(outputSchema)});
}
