import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('publishes an honest, machine-readable human-survey benchmark roadmap', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('public/research-standards/benchmark-manifest.json', root), 'utf8'));

  assert.equal(manifest.schemaVersion, '2.0');
  assert.match(manifest.boundary, /not calibration results/i);
  assert.ok(manifest.candidates.length >= 3);

  for (const candidate of manifest.candidates) {
    assert.match(candidate.sourceUrl, /^https:\/\//);
    assert.equal(candidate.status, 'candidate-not-run');
    assert.ok(candidate.access);
    assert.ok(candidate.calibrationUse);
    assert.ok(candidate.lastVerified);
  }
});

test('publishes an explicit Validation Lab zero-state without invented benchmark values', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('public/research-standards/benchmark-manifest.json', root), 'utf8'));
  const lab = manifest.validationLab;

  assert.equal(lab.status, 'NO_COMPLETED_BENCHMARKS');
  assert.equal(lab.latestEvaluationDate, null);
  assert.equal(lab.evaluatedModelPromptVersion, null);
  assert.deepEqual(lab.comparisons, []);
  assert.deepEqual(lab.calibratedMarkets, []);
  assert.deepEqual(lab.calibratedLanguages, []);
  assert.deepEqual(lab.calibratedQuestionTypes, []);
  assert.deepEqual(lab.unsupportedMarkets, ['ALL']);
  assert.deepEqual(lab.unsupportedLanguages, ['ALL']);
  assert.deepEqual(lab.unsupportedQuestionTypes, ['ALL']);
  assert.ok(Object.values(lab.counts).every((value) => value === 0));
  assert.match(lab.boundary, /No accuracy claim is available/);
  assert.deepEqual(lab.metricDefinitions.map((metric) => metric.id), [
    'mean_absolute_percentage_point_error',
    'top_two_box_absolute_error_pp',
    'rank_order_agreement',
    'subgroup_direction_agreement',
    'repeat_run_variation',
    'evidence_sensitivity',
    'evaluation_date_and_version',
  ]);

  const keys = [];
  JSON.stringify(lab, (key, value) => { if (key) keys.push(key); return value; });
  assert.equal(keys.includes('accuracy'), false);
  assert.equal(keys.includes('score'), false);
});

test('links the benchmark roadmap from the public research contract', () => {
  const standards = fs.readFileSync(new URL('public/research-standards/index.html', root), 'utf8');
  const llms = fs.readFileSync(new URL('public/llms-full.txt', root), 'utf8');

  assert.match(standards, /benchmark-manifest\.json/);
  assert.match(standards, /id="validation-lab"/);
  assert.match(standards, /NO_COMPLETED_BENCHMARKS/);
  assert.match(standards, /No accuracy claim is available/);
  assert.match(standards, /All markets/);
  assert.doesNotMatch(standards, /90% accurate/i);
  assert.doesNotMatch(standards, /ground[- ]truth/i);
  assert.match(llms, /benchmark-manifest\.json/);
});
