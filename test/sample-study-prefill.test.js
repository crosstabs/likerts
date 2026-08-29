import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleStudies } from '../content/sample-studies.mjs';
import { sampleStudyPrefillFromSearch } from '../src/lib/sampleStudyPrefill.js';

test('a sample-study link produces a safe editable brief without starting a run', () => {
  const sample = sampleStudies.find((study) => study.locale === 'ja-JP');
  const prefill = sampleStudyPrefillFromSearch(`?sample=${encodeURIComponent(sample.slug)}`);

  assert.equal(prefill.sampleSlug, sample.slug);
  assert.equal(prefill.study.prompt, sample.request.prompt);
  assert.equal(prefill.study.audience, sample.request.audience);
  assert.equal(prefill.study.outputLocale, 'ja-JP');
  assert.equal(prefill.study.researchMode, 'deep');
  assert.equal(prefill.study.market, 'Japan');
  assert.deepEqual(prefill.study.sources, []);
  assert.equal(prefill.shouldOpenBrief, true);
  assert.equal(prefill.shouldRun, false);
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
