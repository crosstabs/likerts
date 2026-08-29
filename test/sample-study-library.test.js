import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  SAMPLE_STUDY_SCHEMA_VERSION,
  sampleStudies,
  supportedSampleStudyLocales,
  validateSampleStudyRegistry,
} from '../content/sample-studies.mjs';
import {
  buildSampleStudyArtifacts,
  sanitizeCapturedStudy,
} from '../scripts/build-sample-studies.mjs';
import { buildCapturePlan } from '../scripts/capture-sample-studies.mjs';

test('the public sample-study registry is complete, unique, and validated', () => {
  assert.equal(SAMPLE_STUDY_SCHEMA_VERSION, '1.0');
  assert.equal(Object.isFrozen(sampleStudies), true);
  assert.equal(sampleStudies.length, 10);
  assert.deepEqual(sampleStudies.map((study) => study.locale).sort(), [...supportedSampleStudyLocales].sort());
  assert.equal(new Set(sampleStudies.map((study) => study.slug)).size, sampleStudies.length);
  assert.ok(new Set(sampleStudies.map((study) => study.industry)).size >= 6);
  assert.doesNotThrow(() => validateSampleStudyRegistry(sampleStudies));
});

test('every brief preserves the synthetic-research honesty boundary and a valid capture request', () => {
  for (const study of sampleStudies) {
    assert.match(study.disclosure, /synthetic|synth[eé]tique|model-generated|合成|sint[eé]tic|synthetisch|합성|تركيبي|संश्लेषित/i);
    assert.ok(study.humanValidation.length >= 30, 'Human-validation guidance must be concrete and substantial.');
    assert.doesNotMatch(study.disclosure, /representative|causal|statistically significant|observed human sample/i);
    assert.equal(study.request.outputLocale, study.locale);
    assert.equal(study.request.researchMode, 'DEEP');
    assert.equal(study.request.evidencePolicy, 'AUTO');
    assert.equal(study.curatedContextUrls.length >= 2 && study.curatedContextUrls.length <= 4, true);
    assert.equal(study.curatedContextUrls.every((url) => url.startsWith('https://')), true);
    assert.equal(study.request.panelSize >= 50 && study.request.panelSize <= 500, true);
    assert.equal(study.request.prompt.length >= 12, true);
  }
});

test('captured pipeline results are frozen, auditable, and stripped of secrets and session-only fields', () => {
  const captured = sanitizeCapturedStudy(sampleStudies[0], {
    study: {
      title: 'Illustrative workspace adoption',
      summary: 'This directional synthetic output is for hypothesis exploration only.',
      takeaway: 'Validate onboarding barriers with human research before product decisions.',
      distribution: [10, 15, 20, 30, 25],
      confidence: 'Low',
      confidenceNote: 'Synthetic only; validate with human research.',
      audienceSummary: { audienceLabel: 'Operations leaders', contextLabel: 'Small teams', attributes: [] },
      segments: [], responses: [], cautions: ['Synthetic output is not observed human evidence.'],
    },
    meta: {
      generatedAt: '2026-08-28T00:00:00.000Z', runtimeVersion: 'synthetic-research-v2.4',
      modelLineage: [{ stage: 'panel', requestedModel: 'openai/gpt-5.4-mini', resolvedModel: 'openai/gpt-5.4-mini', status: 'completed' }],
      economics: { currency: 'USD', gatewayCost: { exactTotalUsd: '0.0123', reporting: 'complete' } },
      evidenceMode: 'EXA_GATEWAY', stability: { cellCount: 2, meanJensenShannonDivergence: 0.02, maxPercentagePointSpread: 5, interpretation: 'Model agreement only.' }, ensemble: { plannedCells: 2, completedCells: 2, failedCells: 0, aggregation: 'mean' },
      provenance: { inputHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), disclaimer: 'Model generation is non-deterministic.' },
      apiKey: 'must-not-leak',
    },
    run: { runId: 'run_should_not_publish', clientRunId: 'client_secret', economics: { currency: 'USD', gatewayCost: { exactTotalUsd: '0.0123', reporting: 'complete' } }, evidence: { mode: 'EXA_GATEWAY', ledger: [{ title: 'Public source', url: 'https://example.com/source', excerpt: 'Relevant public evidence about password controls.', acquisition: 'EXA_GATEWAY', contentHash: 'c'.repeat(64) }], external: { events: [{ provider: 'vercel-ai-gateway', operation: 'exa-search', outcome: 'completed' }] } } },
    persistence: { status: 'session-only', clientRecord: { token: 'must-not-leak' } },
  });

  assert.equal(Object.isFrozen(captured), true);
  assert.deepEqual(captured.study.distribution, [10, 15, 20, 30, 25]);
  assert.equal(captured.study.distribution.reduce((sum, value) => sum + value, 0), 100);
  assert.equal(captured.provenance.inputHash, 'a'.repeat(64));
  assert.equal(captured.cost.gatewayCost.exactTotalUsd, '0.0123');
  assert.equal(captured.modelLineage[0].resolvedModel, 'openai/gpt-5.4-mini');
  assert.equal(captured.evidence.ledger[0].url, 'https://example.com/source');
  assert.equal(captured.evidence.gatewaySearchCompleted, true);
  assert.equal(captured.stability.cellCount, 2);
  assert.equal(JSON.stringify(captured).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(captured).includes('session-only'), false);
});

test('the static builder produces deterministic catalog and detail JSON for captured samples', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'likerts-studies-'));
  const capture = sanitizeCapturedStudy(sampleStudies[0], {
    study: {
      title: 'Illustrative workspace adoption', summary: 'This directional synthetic output is for hypothesis exploration only.',
      takeaway: 'Validate onboarding barriers with human research before product decisions.', distribution: [10, 15, 20, 30, 25],
      confidence: 'Low', confidenceNote: 'Synthetic only; validate with human research.', audienceSummary: { audienceLabel: 'Operations leaders', contextLabel: 'Small teams', attributes: [] }, segments: [], responses: [], cautions: ['Synthetic output is not observed human evidence.'],
    },
    meta: { generatedAt: '2026-08-28T00:00:00.000Z', runtimeVersion: 'synthetic-research-v2.4', evidenceMode: 'EXA_GATEWAY', stability: { cellCount: 2, meanJensenShannonDivergence: 0.02, maxPercentagePointSpread: 5, interpretation: 'Model agreement only.' }, ensemble: { plannedCells: 2, completedCells: 2, failedCells: 0, aggregation: 'mean' }, modelLineage: [{ stage: 'panel', requestedModel: 'openai/gpt-5.4-mini', resolvedModel: 'openai/gpt-5.4-mini', status: 'completed' }], economics: { currency: 'USD', gatewayCost: { exactTotalUsd: '0.0123', reporting: 'complete' } }, provenance: { inputHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), disclaimer: 'Model generation is non-deterministic.' } },
    run: { evidence: { mode: 'EXA_GATEWAY', ledger: [{ title: 'Public source', url: 'https://example.com/source', excerpt: 'Relevant public evidence.', acquisition: 'EXA_GATEWAY', contentHash: 'c'.repeat(64) }], external: { events: [{ provider: 'vercel-ai-gateway', operation: 'exa-search', outcome: 'completed' }] } } },
  });
  try {
    const first = await buildSampleStudyArtifacts({ studies: sampleStudies, captures: [capture], outputDirectory });
    const catalogFirst = await readFile(join(outputDirectory, 'studies', 'index.json'), 'utf8');
    const second = await buildSampleStudyArtifacts({ studies: sampleStudies, captures: [capture], outputDirectory });
    const catalogSecond = await readFile(join(outputDirectory, 'studies', 'index.json'), 'utf8');
    const detailPath = join(outputDirectory, sampleStudies[0].locale.toLowerCase(), 'studies', sampleStudies[0].slug);
    const detail = JSON.parse(await readFile(join(detailPath, 'study.json'), 'utf8'));
    const detailHtml = await readFile(join(detailPath, 'index.html'), 'utf8');

    assert.equal(first.studyCount, 10);
    assert.equal(first.capturedCount, 1);
    assert.deepEqual(first, second);
    assert.equal(catalogFirst, catalogSecond);
    assert.equal(detail.schemaVersion, '1.0');
    assert.equal(detail.capture.provenance.inputHash, 'a'.repeat(64));
    assert.equal(detail.htmlUrl, `/${sampleStudies[0].locale.toLowerCase()}/studies/${sampleStudies[0].slug}/`);
    assert.equal(detail.dataUrl, `/${sampleStudies[0].locale.toLowerCase()}/studies/${sampleStudies[0].slug}/study.json`);
    assert.equal(detail.curatedContextCandidates[0].status, 'candidate-not-confirmed-as-runtime-evidence');
    assert.match(detailHtml, /Synthetic, model-generated hypothesis/i);
    assert.match(detailHtml, /Machine-readable study JSON/i);
    assert.equal(detail.capture.study.distribution.reduce((sum, value) => sum + value, 0), 100);
    assert.equal(JSON.stringify(detail).includes('must-not-leak'), false);
    await assert.rejects(
      readFile(join(outputDirectory, 'studies', 'industry', sampleStudies[0].industry, 'index.html'), 'utf8'),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('live capture is explicitly opt-in and has bounded runs and cost before it can call a provider', () => {
  assert.throws(() => buildCapturePlan({ env: {}, argv: [] }), /LIKERTS_CAPTURE_SAMPLE_STUDIES=1/);
  const plan = buildCapturePlan({
    env: {
      LIKERTS_CAPTURE_SAMPLE_STUDIES: '1', LIKERTS_CAPTURE_MAX_RUNS: '2',
      LIKERTS_CAPTURE_MAX_ESTIMATED_COST_USD: '0.40', LIKERTS_CAPTURE_MAX_ACTUAL_COST_USD: '0.40',
      LIKERTS_CAPTURE_ESTIMATED_COST_PER_STUDY_USD: '0.10',
    },
    argv: ['--slug', sampleStudies[0].slug, '--url', 'https://likerts.com/api/synthetic-study'],
  });
  assert.equal(plan.mode, 'endpoint');
  assert.equal(plan.studies.length, 1);
  assert.equal(plan.maxRuns, 2);
  assert.equal(plan.concurrency, 1);
  assert.equal(plan.url, 'https://likerts.com/api/synthetic-study');
  assert.throws(() => buildCapturePlan({ env: { LIKERTS_CAPTURE_SAMPLE_STUDIES: '1' }, argv: [] }), /cost cap/i);
});
