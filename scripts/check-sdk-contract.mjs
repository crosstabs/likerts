import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../contracts/sdk-behavior.json', import.meta.url)));
const compatibility = JSON.parse(readFileSync(new URL('../contracts/sdk-compatibility.json', import.meta.url)));
assert.equal(fixture.contractVersion, 1);
assert.deepEqual(fixture.supportedSchemaVersions, [1, 2]);
assert.equal(fixture.transport.defaultTimeoutMilliseconds, 15000);
assert.equal(fixture.transport.redirects, 'reject');
assert.equal(fixture.transport.automaticRetries, 0);

const expected = new Set([
  'validation.required', 'validation.selection-bounds', 'lifecycle.cancellation',
  'transport.timeout', 'transport.redirect', 'transport.https', 'retry.ambiguous',
  'callback.success', 'schema.unknown'
]);
assert.deepEqual(new Set(fixture.scenarios.map(({id}) => id)), expected);
assert.equal(compatibility.contractVersion,1);
assert.equal(compatibility.cache.defaultMaxAgeMilliseconds,300000);
assert.equal(compatibility.cache.staleOnRefreshError,false);
assert.deepEqual(compatibility.currentFleet.installations.map(({target})=>target),['web','react_native','ios','android','flutter']);
assert.equal(compatibility.mixedOldAndNew.installations.some(({schemaVersions})=>!schemaVersions.includes(2)),true);

const suites = [
  'sdks/web/test/client.test.mjs',
  'sdks/react-native/test/Client.test.ts',
  'sdks/ios/Tests/LikertsTests/ContractTests.swift',
  'sdks/android/src/test/kotlin/com/likerts/sdk/ContractTest.kt',
  'sdks/flutter/test/likerts_test.dart'
];
for (const suite of suites) {
  const source = readFileSync(new URL(`../${suite}`, import.meta.url), 'utf8');
  assert.match(source, /sdk-behavior\.json/, `${suite} does not consume the shared fixture`);
  for (const id of expected) assert.match(source, new RegExp(`SDK-CONTRACT: ${id.replace('.', '\\.')}`), `${suite} does not declare ${id}`);
}
console.log(`SDK behavior contract valid: ${expected.size} shared scenarios across ${suites.length} platforms.`);
