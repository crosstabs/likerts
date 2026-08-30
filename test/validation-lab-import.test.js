import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  createInventedValidationFixture,
} from '../evals/validation-lab-fixtures.js';
import {
  generateValidationScorecard,
  prepareOfflineBenchmark,
  scoreOfflineBenchmark,
} from '../scripts/validation-lab-offline.js';

const execFile = promisify(execFileCallback);
const root = new URL('../', import.meta.url);

test('offline benchmark preparation emits only a blind synthetic brief from a versioned eligible import', () => {
  const fixture = createInventedValidationFixture();
  const prepared = prepareOfflineBenchmark(fixture.syntheticImport);

  assert.equal(prepared.status, 'ACCEPTED');
  assert.equal(prepared.syntheticBrief.caseId, fixture.preregistration.caseId);
  assert.equal(JSON.stringify(prepared.syntheticBrief).includes('humanOutcome'), false);
  assert.equal(JSON.stringify(prepared.syntheticBrief).includes(fixture.reveal.nonce), false);
  assert.equal(JSON.stringify(prepared.syntheticBrief).includes('Invented human reference'), false);
  assert.equal(prepared.dryRun, true);
});

test('offline benchmark preparation rejects leakage, ineligibility, and unversioned input before a synthetic run', () => {
  const fixture = createInventedValidationFixture();
  const leakage = structuredClone(fixture.syntheticImport);
  leakage.reveal = fixture.reveal;

  const ineligible = structuredClone(fixture.syntheticImport);
  ineligible.preregistration.eligibility.status = 'INELIGIBLE';

  const unversioned = structuredClone(fixture.syntheticImport);
  delete unversioned.importVersion;

  for (const input of [leakage, ineligible, unversioned]) {
    const prepared = prepareOfflineBenchmark(input);
    assert.equal(prepared.status, 'REJECTED');
    assert.equal(prepared.syntheticBrief, undefined);
  }
});

test('offline scoring preserves failed runs, includes calibration lineage, and produces a machine-readable scoped scorecard', () => {
  const fixture = createInventedValidationFixture();
  const comparison = scoreOfflineBenchmark({
    syntheticImport: fixture.syntheticImport,
    syntheticRuns: fixture.syntheticRuns,
    reveal: fixture.reveal,
    evaluator: fixture.evaluator,
  });
  const scorecard = generateValidationScorecard([comparison]);

  assert.equal(comparison.comparisonStatus, 'COMPLETED');
  assert.equal(comparison.failedRuns, 1);
  assert.equal(comparison.calibrationDate, '2026-08-29');
  assert.equal(comparison.lineage.runtimeVersion, 'invented-runtime-v1');
  assert.equal(comparison.lineage.promptVersions.panel, 'invented-prompt-v1');
  assert.equal(comparison.lineage.schemaVersions.panel, 'invented-schema-v1');
  assert.equal(scorecard.status, 'COMPLETED_COMPARISONS_AVAILABLE');
  assert.equal(scorecard.comparisons.length, 1);
  assert.match(JSON.stringify(scorecard), /INVENTED_FIXTURE_ONLY/);
  assert.equal('accuracy' in scorecard, false);
});

test('post-run scoring rejects unversioned synthetic records and missing calibration dates', () => {
  const fixture = createInventedValidationFixture();
  const unversionedRuns = structuredClone(fixture.syntheticRuns);
  delete unversionedRuns[0].runVersion;
  const noCalibrationDate = structuredClone(fixture.evaluator);
  delete noCalibrationDate.calibrationDate;

  const unversioned = scoreOfflineBenchmark({ syntheticImport: fixture.syntheticImport, syntheticRuns: unversionedRuns, reveal: fixture.reveal, evaluator: fixture.evaluator });
  const missingCalibration = scoreOfflineBenchmark({ syntheticImport: fixture.syntheticImport, syntheticRuns: fixture.syntheticRuns, reveal: fixture.reveal, evaluator: noCalibrationDate });

  assert.equal(unversioned.comparisonStatus, 'INVALIDATED');
  assert.match(unversioned.reason, /unversioned/i);
  assert.equal(missingCalibration.comparisonStatus, 'INVALIDATED');
  assert.match(missingCalibration.reason, /calibration date/i);
});

test('an empty machine-readable scorecard preserves the all-unsupported zero state', () => {
  const scorecard = generateValidationScorecard([]);
  assert.equal(scorecard.status, 'NO_COMPLETED_BENCHMARKS');
  assert.deepEqual(scorecard.unsupportedMarkets, ['ALL']);
  assert.deepEqual(scorecard.unsupportedQuestionTypes, ['ALL']);
  assert.equal(scorecard.publicationStatus, 'NOT_PUBLISHED');
});

test('the CLI dry run emits a blind brief without making a synthetic call', async () => {
  const fixture = createInventedValidationFixture();
  const directory = await mkdtemp(join(tmpdir(), 'likerts-validation-lab-'));
  const importPath = join(directory, 'synthetic-import.json');
  try {
    await writeFile(importPath, JSON.stringify(fixture.syntheticImport), 'utf8');
    const { stdout } = await execFile(process.execPath, ['scripts/validation-lab-offline.js', '--dry-run', importPath], { cwd: root.pathname });
    const report = JSON.parse(stdout);
    assert.equal(report.status, 'ACCEPTED');
    assert.equal(report.dryRun, true);
    assert.equal(stdout.includes('humanOutcome'), false);
    assert.equal(stdout.includes(fixture.reveal.nonce), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
