import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchSupportedLocale,
  removeConsumedInterfaceLocale,
  resolveInterfaceLocale,
  resolveInterfaceLocalePreference,
  resolveSupportedLocalePreference,
  setInterfaceLocaleInSearch,
} from '../src/lib/interfaceLocale.js';

const supportedLocales = ['en-US', 'zh-CN', 'ja-JP', 'ko-KR'];
const supportedReportLocales = ['en-US', 'es-ES', 'pt-BR', 'fr-FR', 'de-DE', 'zh-CN', 'ja-JP', 'ko-KR', 'ar-SA', 'hi-IN'];

test('a supported saved interface locale takes precedence', () => {
  assert.equal(resolveInterfaceLocale({
    savedLocale: 'ja-JP',
    browserLocales: ['ko-KR'],
    supportedLocales,
  }), 'ja-JP');
});

test('an explicit supported interface locale from a static entry link takes precedence', () => {
  assert.equal(resolveInterfaceLocale({
    requestedLocale: 'zh-CN',
    savedLocale: 'ja-JP',
    browserLocales: ['en-US'],
    supportedLocales,
  }), 'zh-CN');
  assert.equal(resolveInterfaceLocale({
    requestedLocale: 'zh-TW',
    savedLocale: 'ja-JP',
    browserLocales: ['en-US'],
    supportedLocales,
  }), 'ja-JP', 'an unenabled request cannot select a sibling locale');
});

test('shareable interface-locale URLs retain unrelated parameters and replace only the locale', () => {
  assert.equal(setInterfaceLocaleInSearch({
    search: '?sample=smart-ev-data-controls-china&uiLocale=zh-CN&ref=library',
    locale: 'ja-JP',
  }), '?sample=smart-ev-data-controls-china&uiLocale=ja-JP&ref=library');
  assert.equal(setInterfaceLocaleInSearch({
    search: '?sample=smart-ev-data-controls-china&ref=library',
    locale: 'ko-KR',
  }), '?sample=smart-ev-data-controls-china&ref=library&uiLocale=ko-KR');
});

test('unsupported interface-locale entries can be removed without losing unrelated parameters', () => {
  assert.equal(removeConsumedInterfaceLocale({
    search: '?sample=smart-ev-data-controls-china&uiLocale=zh-TW&ref=library',
  }), '?sample=smart-ev-data-controls-china&ref=library');
  assert.equal(removeConsumedInterfaceLocale({ search: '?uiLocale=' }), '');
});

test('preference details distinguish explicit entry, saved, browser, and fallback sources', () => {
  assert.deepEqual(resolveInterfaceLocalePreference({ requestedLocale: 'ja', supportedLocales }), {
    locale: 'ja-JP',
    source: 'requested',
  });
  assert.deepEqual(resolveInterfaceLocalePreference({ savedLocale: 'ko', supportedLocales }), {
    locale: 'ko-KR',
    source: 'saved',
  });
  assert.deepEqual(resolveInterfaceLocalePreference({ browserLocales: ['zh-Hans'], supportedLocales }), {
    locale: 'zh-CN',
    source: 'browser',
  });
  assert.deepEqual(resolveInterfaceLocalePreference({ browserLocales: ['th-TH'], supportedLocales }), {
    locale: 'en-US',
    source: 'fallback',
  });
});

test('unsupported uiLocale values cannot become a report default through the UI query channel', () => {
  assert.equal(matchSupportedLocale('es-ES', supportedLocales), null);
  assert.equal(matchSupportedLocale('zh-TW', supportedLocales), null);
  assert.equal(matchSupportedLocale('ja-JP', supportedLocales), 'ja-JP');
  assert.equal(resolveSupportedLocalePreference({
    requestedLocale: matchSupportedLocale('es-ES', supportedLocales),
    browserLocales: ['en-US'],
    supportedLocales: supportedReportLocales,
  }), 'en-US');
});

test('an unsupported saved locale is ignored in favor of an exact browser candidate', () => {
  assert.equal(resolveInterfaceLocale({
    savedLocale: 'zh-TW',
    browserLocales: ['de-DE', 'ko-KR'],
    supportedLocales,
  }), 'ko-KR');
});

test('later browser candidates remain eligible after an unsupported first preference', () => {
  assert.equal(resolveInterfaceLocale({
    browserLocales: ['fr-CA', 'ja-JP'],
    supportedLocales,
  }), 'ja-JP');
});

test('browser-derived report defaults can use output-only locales without enabling interface UI', () => {
  assert.equal(resolveInterfaceLocale({
    requestedLocale: 'es-ES',
    browserLocales: [],
    supportedLocales,
  }), 'en-US');
  assert.equal(resolveSupportedLocalePreference({
    requestedLocale: 'es-ES',
    browserLocales: [],
    supportedLocales: supportedReportLocales,
  }), 'es-ES');
  assert.equal(resolveInterfaceLocale({
    browserLocales: ['fr-CA', 'fr-FR'],
    supportedLocales,
  }), 'en-US');
  assert.equal(resolveSupportedLocalePreference({
    browserLocales: ['fr-CA', 'fr-FR'],
    supportedLocales: supportedReportLocales,
  }), 'fr-FR');
  assert.equal(resolveSupportedLocalePreference({
    browserLocales: ['es-MX'],
    supportedLocales: supportedReportLocales,
  }), 'en-US');
});

test('regional siblings are never inferred from a shared base language', () => {
  for (const browserLocale of ['zh-TW', 'zh-HK', 'fr-CA', 'pt-PT']) {
    assert.equal(resolveInterfaceLocale({ browserLocales: [browserLocale], supportedLocales }), 'en-US');
  }
});

test('only registry-declared neutral and script aliases resolve to enabled production locales', () => {
  for (const [candidate, expected] of [
    ['en', 'en-US'],
    ['ja', 'ja-JP'],
    ['ko', 'ko-KR'],
    ['zh', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
  ]) {
    assert.equal(matchSupportedLocale(candidate, supportedLocales), expected, candidate);
    assert.equal(resolveInterfaceLocale({ browserLocales: [candidate], supportedLocales }), expected, candidate);
  }

  for (const candidate of ['zh-TW', 'zh-HK', 'fr-CA', 'pt-PT']) {
    assert.equal(matchSupportedLocale(candidate, supportedLocales), null, candidate);
  }
});

test('exact supported locale matching is case-insensitive and returns the registry form', () => {
  assert.equal(resolveInterfaceLocale({ browserLocales: ['ZH-cn'], supportedLocales }), 'zh-CN');
});

test('no supported candidate falls back to explicit English', () => {
  assert.equal(resolveInterfaceLocale({ browserLocales: ['th-TH'], supportedLocales }), 'en-US');
});

test('the fallback itself must be explicitly supported', () => {
  assert.throws(() => resolveInterfaceLocale({
    browserLocales: [],
    supportedLocales: ['ja-JP'],
  }), /fallback must be explicitly supported/i);
});
