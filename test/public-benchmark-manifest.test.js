import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('publishes an honest, machine-readable human-survey benchmark roadmap', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('public/research-standards/benchmark-manifest.json', root), 'utf8'));

  assert.equal(manifest.schemaVersion, '1.0');
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

test('links the benchmark roadmap from the public research contract', () => {
  const standards = fs.readFileSync(new URL('public/research-standards/index.html', root), 'utf8');
  const llms = fs.readFileSync(new URL('public/llms-full.txt', root), 'utf8');

  assert.match(standards, /benchmark-manifest\.json/);
  assert.match(llms, /benchmark-manifest\.json/);
});
