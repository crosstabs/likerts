import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createUiCatalog } from '../src/i18nCatalog.mjs';
import { languageOptions } from '../src/lib/localizationUiCatalog.js';

test('sample-lineage notice is localized for every enabled UI locale without CJK English fallback', () => {
  const english = createUiCatalog('en-US');
  for (const option of languageOptions) {
    const catalog = createUiCatalog(option.value);
    assert.equal(typeof catalog.sampleLineageTitle, 'string', `${option.value} title`);
    assert.equal(typeof catalog.sampleAutomatedQaPassed, 'string', `${option.value} automated QA label`);
    assert.equal(typeof catalog.sampleLineageNotice, 'string', `${option.value} notice`);
    assert.match(catalog.sampleLineageNotice, /\{automatedQaStatus\}/, `${option.value} automated QA placeholder`);
    assert.match(catalog.sampleLineageNotice, /\{nativeReviewStatus\}/, `${option.value} native-review placeholder`);
  }
  for (const locale of ['zh-CN', 'ja-JP', 'ko-KR']) {
    const catalog = createUiCatalog(locale);
    assert.notEqual(catalog.sampleLineageNotice, english.sampleLineageNotice, `${locale} uses localized notice copy`);
    assert.doesNotMatch(catalog.sampleLineageNotice, /This brief started from a public sample|No run starts automatically/, `${locale} has no English notice fallback`);
  }
});

test('StudyComposer renders a read-only accessible sample-lineage notice with stable data attributes', async () => {
  const [composer, styles] = await Promise.all([
    readFile(new URL('../src/components/StudyComposer.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(composer, /data-sample-lineage=\{lineage\.source/);
  assert.match(composer, /data-sample-slug=\{lineage\.slug/);
  assert.match(composer, /data-automated-qa-status=\{lineage\.automatedQa/);
  assert.match(composer, /data-native-review-status=\{lineage\.nativeReview/);
  assert.match(composer, /role="note"/);
  assert.match(composer, /tabIndex="0"/);
  assert.doesNotMatch(composer.match(/function SampleLineageNotice[\s\S]*?\n}\n\nexport function StudyComposer/)?.[0] || '', /<button/);
  assert.match(styles, /\.sample-lineage-notice:focus-visible/);
  assert.match(styles, /\.sample-lineage-notice p \{[^}]*font-size: 12px[^}]*line-height: 1\.5[^}]*overflow-wrap: anywhere/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.composer/);
});
