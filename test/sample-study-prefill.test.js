import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleStudies } from '../content/sample-studies.mjs';
import { sampleStudyPrefillFromSearch } from '../src/lib/sampleStudyPrefill.js';
import { LOCALIZATION_REGISTRY_VERSION } from '../shared/localization.mjs';

test('a sample-study link produces a safe editable brief without starting a run', () => {
  const sample = sampleStudies.find((study) => study.locale === 'ja-JP');
  const prefill = sampleStudyPrefillFromSearch(`?sample=${encodeURIComponent(sample.slug)}`);

  assert.equal(prefill.sampleSlug, sample.slug);
  assert.equal(prefill.study.prompt, sample.request.prompt);
  assert.equal(prefill.study.audience, sample.request.audience);
  assert.equal(prefill.study.outputLocale, 'ja-JP');
  assert.equal(prefill.study.researchMode, 'deep');
  assert.equal(prefill.study.market, 'Japan');
  assert.equal(prefill.study.localization.marketId, 'JP');
  assert.equal(prefill.study.localization.reportLocale, 'ja-JP');
  assert.equal(prefill.study.retrievalPolicy, 'PREFER');
  assert.deepEqual(prefill.study.retrievalLocales, ['ja-JP']);
  assert.equal(prefill.study.instrumentLocale, '');
  assert.equal(prefill.study.localizationReceipt.registryVersion, LOCALIZATION_REGISTRY_VERSION);
  assert.equal(prefill.study.localizationRegistryVersion, LOCALIZATION_REGISTRY_VERSION);
  assert.equal(prefill.study.sampleQuality.automatedQa.status, 'passed');
  assert.equal(prefill.study.sampleQuality.automatedQa.scope, 'sample-brief-contract');
  assert.equal(prefill.study.sampleQuality.nativeReview.status, 'review-pending');
  assert.equal(prefill.study.sampleLineage.source, 'static-sample-library');
  assert.equal(prefill.study.sampleLineage.stableId, sample.stableId);
  assert.equal(prefill.study.sampleLineage.slug, sample.slug);
  assert.equal(prefill.study.sampleLineage.sampleSchemaVersion, sample.schemaVersion);
  assert.equal(prefill.study.sampleLineage.localizationRegistryVersion, LOCALIZATION_REGISTRY_VERSION);
  assert.equal(prefill.study.sampleLineage.localizationReceipt.report.locale, 'ja-JP');
  assert.equal(prefill.study.sampleLineage.nativeReview.scope, 'sample-brief-copy');
  assert.equal(Object.isFrozen(prefill.study.sampleLineage), true);
  assert.equal(prefill.rerunBlocked, null);
  assert.deepEqual(prefill.study.sources, []);
  assert.equal(prefill.shouldOpenBrief, true);
  assert.equal(prefill.shouldRun, false);
});

test('sample prefill does not inherit a new-study method or unrelated default concept', () => {
  const sample = sampleStudies.find((study) => study.locale === 'ja-JP');
  const prefill = sampleStudyPrefillFromSearch(`?sample=${encodeURIComponent(sample.slug)}`);

  assert.equal(prefill.study.researchMethod, 'GENERAL_LIKERT');
  assert.equal(prefill.study.concept, '');
  assert.deepEqual(prefill.study.featureItems, []);
  assert.deepEqual(prefill.study.pricePoints, []);
});

test('sample prefill ignores unknown, duplicate, and oversized identifiers', () => {
  assert.equal(sampleStudyPrefillFromSearch('?sample=not-a-real-study'), null);
  assert.equal(sampleStudyPrefillFromSearch('?sample=a&sample=b'), null);
  assert.equal(sampleStudyPrefillFromSearch(`?sample=${'x'.repeat(101)}`), null);
  assert.equal(sampleStudyPrefillFromSearch('?prompt=Ignore%20the%20catalog'), null);
});

test('sample prefill returns a fresh mutable brief on every read', () => {
  const sample = sampleStudies[0];
  const first = sampleStudyPrefillFromSearch(`?sample=${sample.slug}`);
  const second = sampleStudyPrefillFromSearch(`?sample=${sample.slug}`);
  first.study.prompt = 'Changed locally';
  first.study.sourceLanguages.push('fr-FR');

  assert.equal(second.study.prompt, sample.request.prompt);
  assert.deepEqual(second.study.sourceLanguages, sample.request.sourceLanguages);
});

test('unresolved legacy localization remains viewable but is blocked before a rerun can be prepared', () => {
  const legacy = structuredClone(sampleStudies[0]);
  legacy.slug = 'legacy-unresolved-localization';
  delete legacy.localization;
  delete legacy.request.localization;
  delete legacy.request.outputLocale;

  const prefill = sampleStudyPrefillFromSearch(`?sample=${legacy.slug}`, [legacy]);

  assert.equal(prefill.shouldOpenBrief, true);
  assert.equal(prefill.shouldRun, false);
  assert.equal(prefill.rerunBlocked.code, 'LOCALIZATION_UNRESOLVED');
  assert.equal(prefill.study.sampleRerunBlock.code, 'LOCALIZATION_UNRESOLVED');
  assert.equal(prefill.study.outputLocale, '');
});

test('conflicting canonical and legacy localization aliases block rerun rather than choosing one', () => {
  const conflicted = structuredClone(sampleStudies[0]);
  conflicted.slug = 'conflicted-sample-localization';
  conflicted.request.market = 'Japan';
  delete conflicted.request.searchCountry;
  delete conflicted.request.searchLocation;

  const prefill = sampleStudyPrefillFromSearch(`?sample=${conflicted.slug}`, [conflicted]);

  assert.equal(prefill.rerunBlocked.code, 'LOCALIZATION_ALIAS_CONFLICT');
  assert.equal(prefill.study.sampleRerunBlock.code, 'LOCALIZATION_ALIAS_CONFLICT');
});

test('a canonical-only sample resolves without manufacturing conflicting legacy aliases', () => {
  const canonicalOnly = structuredClone(sampleStudies[0]);
  canonicalOnly.slug = 'canonical-only-sample-localization';
  delete canonicalOnly.localization;
  for (const field of ['market', 'outputLocale', 'sourceLanguages', 'searchCountry', 'searchLocation']) {
    delete canonicalOnly.request[field];
  }

  const prefill = sampleStudyPrefillFromSearch(`?sample=${canonicalOnly.slug}`, [canonicalOnly]);

  assert.equal(prefill.rerunBlocked, null);
  assert.equal(prefill.study.localization.marketId, 'US');
  assert.equal(prefill.study.outputLocale, 'en-US');
  assert.deepEqual(prefill.study.sourceLanguages, ['en-US']);
});

test('a legacy custom sample keeps its localization receipt for display but is explicitly rerun-blocked', () => {
  const custom = structuredClone(sampleStudies[0]);
  custom.slug = 'legacy-custom-market-sample';
  delete custom.localization;
  delete custom.request.localization;
  Object.assign(custom.request, {
    market: 'Quebec retail',
    outputLocale: 'fr-FR',
    sourceLanguages: ['fr-FR'],
    searchCountry: 'CA',
    searchLocation: 'Montreal, Quebec',
  });

  const prefill = sampleStudyPrefillFromSearch(`?sample=${custom.slug}`, [custom]);

  assert.equal(prefill.rerunBlocked.code, 'UNKNOWN_MARKET');
  assert.equal(prefill.study.sampleRerunBlock.code, 'UNKNOWN_MARKET');
  assert.equal(prefill.study.market, 'Quebec retail');
  assert.equal(prefill.study.localizationReceipt.market.id, 'LEGACY_CUSTOM');
  assert.equal(prefill.study.localizationReceipt.market.searchLocation, 'Montreal, Quebec');
});
