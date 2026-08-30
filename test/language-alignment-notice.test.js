import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createUiCatalog } from '../src/i18nCatalog.mjs';
import { languageOptions } from '../src/lib/localizationUiCatalog.js';
import { studyLanguageAlignment } from '../src/lib/studyLanguageAlignment.js';

test('study language alignment treats the report as the default instrument language', () => {
  assert.deepEqual(studyLanguageAlignment({
    interfaceLocale: 'ja-JP',
    reportLocale: 'ja-JP',
    instrumentLocale: '',
  }), {
    interfaceLocale: 'ja-JP',
    reportLocale: 'ja-JP',
    instrumentLocale: 'ja-JP',
    aligned: true,
    mismatchDimensions: [],
  });

  assert.deepEqual(studyLanguageAlignment({
    interfaceLocale: 'zh-CN',
    reportLocale: 'ja-JP',
    instrumentLocale: '',
  }).mismatchDimensions, ['report', 'instrument']);

  assert.deepEqual(studyLanguageAlignment({
    interfaceLocale: 'ko-KR',
    reportLocale: 'ko-KR',
    instrumentLocale: 'ja-JP',
  }).mismatchDimensions, ['instrument']);
});

test('the composer exposes language mismatches outside optional context with alignment and review actions', async () => {
  const [composer, styles] = await Promise.all([
    readFile(new URL('../src/components/StudyComposer.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(composer, /function LanguageAlignmentStatusCard/);
  assert.match(composer, /studyLanguageAlignment/);
  assert.match(composer, /languageAlignmentTitle/);
  assert.match(composer, /alignStudyLanguages/);
  assert.match(composer, /reviewLanguageSettings/);
  assert.match(composer, /open=\{contextOpen\}/);
  assert.match(composer, /document\.getElementById\('report-language'\)\?\.focus\(\)/);
  assert.match(styles, /\.language-alignment-status/);
});

test('language-alignment notice copy exists for every enabled interface locale', () => {
  for (const option of languageOptions) {
    const catalog = createUiCatalog(option.value);
    for (const key of [
      'languageAlignmentTitle',
      'languageAlignmentBody',
      'alignStudyLanguages',
      'reviewLanguageSettings',
    ]) assert.equal(typeof catalog[key], 'string', `${option.value} missing ${key}`);
  }
});
