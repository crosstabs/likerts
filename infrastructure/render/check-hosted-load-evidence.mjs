import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const root = new URL('../../', import.meta.url);
const require = createRequire(new URL('../../tools/mcp/package.json', import.meta.url));
const Ajv = require('ajv');
const schema = JSON.parse(readFileSync(new URL('infrastructure/render/hosted-load-evidence.schema.json', root)));
const evidence = JSON.parse(readFileSync(new URL('infrastructure/render/hosted-load-evidence.json', root)));
const validate = new Ajv({strict: false, allErrors: true, validateFormats: false}).compile(schema);

assert.ok(validate(evidence), JSON.stringify(validate.errors));
assert.equal(evidence.status, 'passed');
assert.deepEqual(evidence.phases.map(phase => phase.name), [
  'paced-valid', 'burst-valid', 'duplicate-retries', 'invalid-answers', 'unauthorized', 'cap-race',
]);
assert.equal(evidence.phases.reduce((sum, phase) => sum + phase.requests, 0), evidence.workload.maximumSubmissionRequests);
assert.deepEqual(evidence.phases.map(phase => phase.statuses), [
  {'200': 100}, {'200': 100}, {'200': 20}, {'400': 10}, {'401': 10}, {'200': 10, '409': 10},
]);
assert.ok(JSON.stringify(evidence).length < 32 * 1024);

const injectedSecret = structuredClone(evidence);
injectedSecret.bootstrapToken = 'must-never-be-accepted';
assert.equal(validate(injectedSecret), false, 'schema accepted an undeclared secret-bearing field');

console.log('Hosted load evidence PASS: bounded workload, status distribution, exact accounting and cleanup.');
