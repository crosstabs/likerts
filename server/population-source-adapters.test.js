import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { runLocalPopulationSourceAdapter } from './population-source-adapters.js';

const fixture = (name) => new URL(`../test/fixtures/population-data/${name}`, import.meta.url);
const execFileAsync = promisify(execFile);

test('a dry-run local adapter produces a deterministic, fully auditable import report', async () => {
  const input = {
    adapterPath: fixture('invented-adapter.json'),
    sourcePath: fixture('invented-population.csv'),
  };
  const first = await runLocalPopulationSourceAdapter(input);
  const second = await runLocalPopulationSourceAdapter(input);

  assert.deepEqual(first, second);
  assert.equal(first.mode, 'DRY_RUN');
  assert.equal(first.status, 'READY_FOR_REGISTRY_REVIEW');
  assert.deepEqual(first.schemaDrift, {
    status: 'MATCH',
    expectedColumns: ['AGE_GROUP', 'RESIDENCE_STATUS', 'COUNT'],
    actualColumns: ['AGE_GROUP', 'RESIDENCE_STATUS', 'COUNT'],
    missingColumns: [],
    unexpectedColumns: [],
  });
  assert.deepEqual(first.filters, [{
    field: 'RESIDENCE_STATUS', operator: 'EQUALS', value: 'usual', includedRows: 4, excludedRows: 1,
  }]);
  assert.equal(first.denominator.value, 1000);
  assert.deepEqual(first.exclusions, ['Temporary residents are excluded by the declared residence-status filter.']);
  assert.deepEqual(first.rounding, { method: 'HALF_UP_WITH_FINAL_BALANCE', decimalPlaces: 8 });
  assert.deepEqual(first.result.categories.map(({ code, share }) => ({ code, share })), [
    { code: '18-34', share: 0.4 },
    { code: '35+', share: 0.6 },
  ]);
  assert.equal(first.recodes[0].sourceField, 'AGE_GROUP');
  assert.match(first.hashes.sourceArtifact, /^[a-f0-9]{64}$/);
  assert.match(first.hashes.adapterConfiguration, /^[a-f0-9]{64}$/);
  assert.match(first.hashes.dryRunReport, /^[a-f0-9]{64}$/);
});

test('schema drift is reported and blocks transformation before any registry claim is produced', async () => {
  const report = await runLocalPopulationSourceAdapter({
    adapterPath: fixture('invented-adapter.json'),
    sourcePath: fixture('invented-population-schema-drift.csv'),
  });

  assert.equal(report.status, 'SCHEMA_DRIFT');
  assert.deepEqual(report.schemaDrift.missingColumns, ['RESIDENCE_STATUS']);
  assert.deepEqual(report.schemaDrift.unexpectedColumns, ['RESIDENCY']);
  assert.equal(report.denominator, null);
  assert.equal(report.result, null);
});

test('the import CLI is explicitly dry-run only and emits the adapter report as JSON', async () => {
  const script = fileURLToPath(new URL('../scripts/import-population-data.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    script,
    '--dry-run',
    '--adapter', fileURLToPath(fixture('invented-adapter.json')),
    '--source', fileURLToPath(fixture('invented-population.csv')),
  ]);

  assert.equal(stderr, '');
  const report = JSON.parse(stdout);
  assert.equal(report.mode, 'DRY_RUN');
  assert.equal(report.status, 'READY_FOR_REGISTRY_REVIEW');
});
