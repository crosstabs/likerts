import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { sampleStudies } from '../content/sample-studies.mjs';
import { requireLocaleCapability } from '../shared/localization.mjs';
import { requestSchema, runStudyPipeline } from '../server/synthetic-study-pipeline.js';
import {
  canonicalSampleLineageForSample,
  projectSampleNativeReviewAuthority,
  projectStaticSampleNativeReviewDeclaration,
} from '../server/sample-lineage.js';

const sample = sampleStudies.find((entry) => entry.locale === 'en-US');
const lineage = canonicalSampleLineageForSample(sample);

test('sample native-review lineage reads the sample capability rather than the report receipt', () => {
  const sampleCapability = requireLocaleCapability(sample.locale, 'sample');
  assert.equal(lineage.nativeReview.status, 'review-pending');
  assert.equal(sampleCapability.release.nativeReview.statusByCapability.sample, 'review-pending');
  assert.equal(lineage.nativeReview.scope, 'sample-brief-copy');
  assert.equal(lineage.nativeReview.authority, 'registry-declared');
  assert.equal(lineage.nativeReview.releaseEligible, false);
  assert.equal(lineage.localizationReceipt.report.locale, sample.request.outputLocale);
});

test('static sample declarations remain separate from packet-validated release authority', () => {
  const declared = structuredClone(requireLocaleCapability('ja-JP', 'sample'));
  declared.release.copyStatus = 'native-reviewed';
  declared.release.nativeReview.status = 'native-reviewed';
  declared.release.nativeReview.statusByCapability = Object.fromEntries(
    Object.keys(declared.release.nativeReview.statusByCapability).map((capability) => [capability, 'native-reviewed']),
  );

  assert.deepEqual(projectStaticSampleNativeReviewDeclaration(declared), {
    status: 'native-reviewed',
    copyStatus: 'native-reviewed',
    authority: 'registry-declared',
    releaseEligible: false,
  });

  assert.deepEqual(projectSampleNativeReviewAuthority(declared), {
    status: 'review-pending',
    copyStatus: 'machine-drafted',
    authority: 'evidence-qualified',
    releaseEligible: false,
  });
  assert.deepEqual(projectSampleNativeReviewAuthority(declared, {
    status: 'ELIGIBLE',
    releaseEligible: true,
  }), {
    status: 'native-reviewed',
    copyStatus: 'native-reviewed',
    authority: 'evidence-qualified',
    releaseEligible: true,
  });
});

test('static sample publishers consume the registry-declared canonical lineage projection', async () => {
  const [builder, catalog] = await Promise.all([
    readFile(new URL('../scripts/build-sample-studies.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../server/sample-study-catalog.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(builder, /status:\s*review\.statusByCapability\.sample/);
  assert.doesNotMatch(catalog, /status:\s*review\.statusByCapability\.sample/);
  assert.match(builder, /canonicalSampleLineageForSample\(brief\)\.nativeReview/);
  assert.match(catalog, /canonicalSampleLineageForSample\(study\)\.nativeReview/);
  assert.doesNotMatch(catalog, /projectSampleNativeReviewAuthority\(locale\)/);
});

function editedSampleRequest(sampleLineage = lineage) {
  return {
    prompt: 'Would a locally edited research question be clear enough for an exploratory test?',
    audience: 'Decision-makers at small organizations evaluating internal workflow tools',
    panelSize: 100,
    researchMode: 'QUICK',
    researchMethod: 'GENERAL_LIKERT',
    assumptions: 'This is an editable derivative of a public sample, not a replay.',
    evidencePolicy: 'PRIOR_ONLY',
    localization: {
      schemaVersion: 'study-localization-v1',
      marketId: 'JP',
      reportLocale: 'ja-JP',
      sourceLocales: ['ja-JP'],
      retrieval: { policy: 'PREFER', locales: ['ja-JP'] },
      instrumentLocale: 'ja-JP',
    },
    sampleLineage,
  };
}

test('sample lineage is canonical to the registered source but allows an edited current localization', () => {
  const parsed = requestSchema.parse(editedSampleRequest());

  assert.equal(parsed.localization.market.id, 'JP');
  assert.equal(parsed.localization.report.locale, 'ja-JP');
  assert.equal(parsed.sampleLineage.slug, sample.slug);
  assert.equal(parsed.sampleLineage.localizationReceipt.market.id, 'US');
  assert.equal(parsed.sampleLineage.localizationReceipt.report.locale, 'en-US');
  assert.equal(parsed.sampleLineage.automatedQa.status, 'passed');
  assert.equal(parsed.sampleLineage.automatedQa.scope, 'sample-brief-contract');
  assert.equal(parsed.sampleLineage.nativeReview.scope, 'sample-brief-copy');
  assert.equal(parsed.sampleLineage.nativeReview.authority, 'registry-declared');
  assert.equal(parsed.sampleLineage.nativeReview.releaseEligible, false);
});

test('sample lineage request validation fails closed for malformed, conflicting, and invented provenance', () => {
  const malformed = editedSampleRequest({ source: 'static-sample-library' });
  assert.equal(requestSchema.safeParse(malformed).success, false);

  const conflicting = structuredClone(lineage);
  conflicting.localizationReceipt.report.locale = 'ja-JP';
  const conflictResult = requestSchema.safeParse(editedSampleRequest(conflicting));
  assert.equal(conflictResult.success, false);
  assert.ok(conflictResult.error.issues.some((issue) => issue.path[0] === 'sampleLineage'));

  const invented = structuredClone(lineage);
  invented.stableId = 'SS-EN-US-999';
  assert.equal(requestSchema.safeParse(editedSampleRequest(invented)).success, false);
});

test('pipeline input validation also rejects a lineage tampered after request parsing', async () => {
  const input = requestSchema.parse(editedSampleRequest());
  const tampered = structuredClone(input);
  tampered.sampleLineage.automatedQa.scope = 'generated-run-quality';

  await assert.rejects(
    () => runStudyPipeline(tampered),
    (error) => error?.statusCode === 400 && /sample lineage/i.test(error.message),
  );
});

test('sample lineage reaches run, reproducibility, and session evidence metadata without asserting human validation', async () => {
  const input = requestSchema.parse({
    ...editedSampleRequest(),
    localization: sample.localization,
  });
  const result = await runStudyPipeline(input, {
    env: {},
    generate: async (options) => {
      if (options.system.includes('research-methods framer')) {
        return {
          output: {
            neutralQuestion: 'How likely is adoption under the stated controls?',
            decisionContext: 'Explore a directional hypothesis before human research.',
            panelDimensions: ['workflow fit', 'data protection', 'review effort'],
            assumptions: ['This is synthetic only.', 'No human responses were observed.'],
            evidenceBoundary: 'No external evidence was acquired for this focused contract test.',
          },
          response: { modelId: 'test/framer' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      if (options.system.includes('separate evidence-alignment')) {
        return {
          output: { decision: 'accepted', critiqueSummary: 'No unsupported human claim was found.', credibilityLevel: 'illustrative-only', evidenceAlignment: 'not-assessed', weakClaims: [], biasSignals: [] },
          response: { modelId: 'test/critic' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      return {
        output: {
          title: 'Directional adoption hypothesis',
          summary: 'This model-generated directional result is for hypothesis exploration rather than a human finding.',
          takeaway: 'Validate this assumption with appropriate observed human research before decisions.',
          distribution: [12, 18, 24, 28, 18],
          confidence: 'Low',
          confidenceNote: 'Model-generated direction only; it is not observed human evidence.',
          audienceSummary: { audienceLabel: 'Small organization decision-makers', contextLabel: 'Internal workflow tools', attributes: [{ label: 'Scope', value: 'Exploratory' }, { label: 'Evidence', value: 'Prior only' }, { label: 'Boundary', value: 'Synthetic' }] },
          segments: [{ label: 'Control-focused', values: [12, 18, 24, 28, 18] }, { label: 'Cost-focused', values: [18, 22, 25, 21, 14] }, { label: 'Workflow-focused', values: [9, 14, 21, 33, 23] }, { label: 'Cautious', values: [25, 27, 22, 17, 9] }],
          responses: [{ score: 1, profile: 'Cautious planner', quote: 'I would need clear safeguards before testing it.' }, { score: 2, profile: 'Operations lead', quote: 'The review burden would need to stay manageable.' }, { score: 4, profile: 'Workflow owner', quote: 'A controlled trial could be useful for drafting.' }, { score: 5, profile: 'Early adopter', quote: 'The safeguards make an exploratory trial more credible.' }],
          cautions: ['This output is model-generated, not observed human evidence.', 'Validate with real participants before decisions.'],
        },
        response: { modelId: 'test/panel' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  });

  assert.deepEqual(result.run.sampleLineage, lineage);
  assert.deepEqual(result.meta.sampleLineage, lineage);
  assert.deepEqual(result.run.reproducibility.sampleLineage, lineage);
  assert.deepEqual(result.persistence.clientRecord.input.sampleLineage, lineage);
  assert.equal(result.run.reproducibility.sampleLineage.observedHumanResponses, undefined);
  assert.equal(result.run.modelCard.observedHumanResponses, false);
});
