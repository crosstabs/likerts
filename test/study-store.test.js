import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleStudies } from '../content/sample-studies.mjs';
import { canonicalSampleLineageForSample } from '../server/sample-lineage.js';
import { getLatestRun, readRuns, validateRestoredRunLineage } from '../src/lib/studyStore.js';

const STORAGE_KEY = 'likerts:runs:v2';

function installStorage(value = '[]') {
  const storage = {
    value,
    getItem() { return this.value; },
    setItem(_key, next) { this.value = next; },
  };
  globalThis.localStorage = storage;
  return storage;
}

function completeRun(lineage) {
  return {
    id: 'run_valid',
    status: 'complete',
    study: { sampleLineage: lineage },
    result: {
      meta: { sampleLineage: lineage },
      run: { sampleLineage: lineage, reproducibility: { sampleLineage: lineage } },
      reproducibility: { sampleLineage: lineage },
    },
  };
}

test('restored runs validate every present lineage copy and quarantine malformed/conflicting complete records', () => {
  const lineage = canonicalSampleLineageForSample(sampleStudies[0]);
  const valid = completeRun(lineage);
  const malformed = { ...valid, id: 'run_malformed', result: { meta: { sampleLineage: { ...lineage, slug: 'forged-sample' } } } };
  const conflicting = { ...valid, id: 'run_conflicting', result: { ...valid.result, meta: { sampleLineage: canonicalSampleLineageForSample(sampleStudies[1]) } } };
  installStorage(JSON.stringify([malformed, conflicting, valid]));

  const visible = readRuns();
  assert.deepEqual(visible.map((run) => run.id), ['run_valid']);
  assert.equal(getLatestRun().id, 'run_valid');
  assert.doesNotThrow(() => validateRestoredRunLineage(valid));
});

test('local cache keeps legacy runs without lineage while rejecting malformed lineage when present', () => {
  const legacy = { id: 'run_legacy', status: 'complete', study: {}, result: {} };
  const malformed = { id: 'run_malformed', status: 'complete', result: { meta: { sampleLineage: 'not-an-envelope' } } };
  const storage = installStorage(JSON.stringify([malformed, legacy]));
  assert.deepEqual(readRuns().map((run) => run.id), ['run_legacy']);
  assert.equal(storage.getItem(STORAGE_KEY), JSON.stringify([malformed, legacy]), 'quarantine does not claim local data is signed or silently rewrite it');
});

test('a present null lineage cannot mask a canonical lineage copy', () => {
  const lineage = canonicalSampleLineageForSample(sampleStudies[0]);
  const run = completeRun(lineage);
  run.result.meta.sampleLineage = null;
  installStorage(JSON.stringify([run]));
  assert.equal(readRuns().length, 0);
});
