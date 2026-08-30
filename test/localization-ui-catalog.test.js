import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASEAN_LANGUAGE_LOCALE_IDS,
  LOCALE_CAPABILITIES,
  LOCALIZATION_CAPABILITY_STATUSES,
  MARKET_CAPABILITIES,
  MARKET_ROLLOUT_STATUSES,
  listLocalesForCapability,
  resolveMarketSupportMode,
} from '../shared/localization.mjs';
import {
  instrumentLanguageOptions,
  languageOptions,
  reportLanguageOptions,
  retrievalLanguageOptions,
  sourceLanguageOptions,
  studyMarketOptions,
} from '../src/lib/localizationUiCatalog.js';

const localizedOutputOnlyLocales = ['es-ES', 'pt-BR', 'fr-FR', 'de-DE', 'ar-SA', 'hi-IN'];

test('study language catalogs are generated from enabled capability slices', () => {
  for (const [options, capability] of [
    [languageOptions, 'ui'],
    [reportLanguageOptions, 'report'],
    [sourceLanguageOptions, 'source'],
    [retrievalLanguageOptions, 'retrieval'],
    [instrumentLanguageOptions, 'instrument'],
  ]) {
    assert.deepEqual(options.map((option) => option.value), listLocalesForCapability(capability).map((entry) => entry.id));
    assert.equal(Object.isFrozen(options), true);
    assert.ok(options.every((option) => option.runtimeStatus === LOCALIZATION_CAPABILITY_STATUSES.ENABLED));
    assert.ok(options.every((option) => option.copyStatus === LOCALE_CAPABILITIES[option.value].release.copyStatus));
    assert.ok(options.every((option) => option.nativeReviewStatus === LOCALE_CAPABILITIES[option.value].release.nativeReview.statusByCapability[capability]));
    assert.ok(options.every((option) => option.releaseEligible === false));
    assert.ok(options.every((option) => !ASEAN_LANGUAGE_LOCALE_IDS.includes(option.value)));
  }
});

test('language options project declared release metadata without granting release eligibility', () => {
  for (const [options, capability] of [
    [languageOptions, 'ui'],
    [reportLanguageOptions, 'report'],
    [sourceLanguageOptions, 'source'],
    [retrievalLanguageOptions, 'retrieval'],
    [instrumentLanguageOptions, 'instrument'],
  ]) {
    for (const option of options) {
      const release = LOCALE_CAPABILITIES[option.value].release;
      assert.equal(option.copyStatus, release.copyStatus);
      assert.equal(option.nativeReviewStatus, release.nativeReview.statusByCapability[capability]);
      // Registry declarations are not server scorecard evidence.
      assert.equal(option.releaseEligible, false);
    }
  }
});

test('incomplete non-CJK catalogs are excluded from UI while preserving localized output selectors', () => {
  assert.deepEqual(languageOptions.map((option) => option.value), ['en-US', 'zh-CN', 'ja-JP', 'ko-KR']);
  assert.ok(localizedOutputOnlyLocales.every((locale) => !languageOptions.some((option) => option.value === locale)));

  for (const options of [reportLanguageOptions, sourceLanguageOptions, retrievalLanguageOptions, instrumentLanguageOptions]) {
    assert.ok(localizedOutputOnlyLocales.every((locale) => options.some((option) => option.value === locale)));
  }
  assert.ok(localizedOutputOnlyLocales.every((locale) => listLocalesForCapability('sample').some((entry) => entry.id === locale)));
});

test('study market catalog includes only enabled registry markets and preserves Global geography null', () => {
  const enabled = Object.values(MARKET_CAPABILITIES).filter((market) => market.status === MARKET_ROLLOUT_STATUSES.ENABLED);
  assert.deepEqual(studyMarketOptions.map((market) => market.id), enabled.map((market) => market.id));
  assert.equal(Object.isFrozen(studyMarketOptions), true);
  assert.ok(studyMarketOptions.every((market) => market.status === MARKET_ROLLOUT_STATUSES.ENABLED));
  assert.equal(studyMarketOptions.find((market) => market.id === 'GLOBAL')?.searchCountry, null);
  assert.equal(studyMarketOptions.find((market) => market.id === 'GLOBAL')?.searchLocation, '');
  assert.ok(studyMarketOptions.every((market) => !['ID', 'MY', 'PH', 'TH', 'VN', 'BN', 'KH', 'LA', 'MM'].includes(market.id)));
  assert.equal(studyMarketOptions.find((market) => market.id === 'US')?.searchCountry, 'US');
});

test('study market catalog exposes locale support without enabling planned ASEAN languages', () => {
  const singapore = studyMarketOptions.find((market) => market.id === 'SG');
  assert.equal(singapore.supportMode, 'MARKET_ROUTING_ONLY');
  assert.deepEqual(singapore.enabledLocaleIds, []);
  assert.deepEqual(singapore.fullyEnabledLocaleIds, []);
  assert.deepEqual(singapore.plannedLocaleIds, ['en-SG', 'ms-SG', 'zh-Hans-SG', 'ta-SG']);
  assert.equal(singapore.currencyCode, 'SGD');
  assert.deepEqual(singapore.plannedLocaleLabels, ['English (Singapore)', 'Bahasa Melayu (Singapura)', '简体中文（新加坡）', 'தமிழ் (சிங்கப்பூர்)']);
  assert.deepEqual(singapore.plannedLocales.map((locale) => [locale.value, locale.htmlLang]), [
    ['en-SG', 'en-SG'],
    ['ms-SG', 'ms-SG'],
    ['zh-Hans-SG', 'zh-Hans-SG'],
    ['ta-SG', 'ta-SG'],
  ]);

  const japan = studyMarketOptions.find((market) => market.id === 'JP');
  assert.equal(japan.supportMode, 'MARKET_AND_ONE_OR_MORE_LOCALES');
  assert.deepEqual(japan.enabledLocaleIds, ['ja-JP']);
  assert.deepEqual(japan.fullyEnabledLocaleIds, ['ja-JP']);
  assert.deepEqual(japan.partialLocaleIds, []);
  assert.deepEqual(japan.outputEnabledLocaleIds, ['ja-JP']);
  assert.deepEqual(japan.plannedLocaleIds, []);
});

test('markets with localized output but planned UI are not mislabeled routing-only', () => {
  const spain = studyMarketOptions.find((market) => market.id === 'ES');
  assert.equal(spain.supportMode, 'MARKET_AND_LOCALIZED_OUTPUT');
  assert.deepEqual(spain.enabledLocaleIds, ['es-ES']);
  assert.deepEqual(spain.fullyEnabledLocaleIds, []);
  assert.deepEqual(spain.partialLocaleIds, ['es-ES']);
  assert.deepEqual(spain.outputEnabledLocaleIds, ['es-ES']);
  assert.deepEqual(spain.outputEnabledLocaleLabels, ['Español (España)']);
  assert.deepEqual(spain.outputEnabledLocales.map((locale) => [locale.value, locale.htmlLang]), [['es-ES', 'es-ES']]);
  assert.deepEqual(spain.plannedLocaleIds, []);

  for (const marketId of ['BR', 'FR', 'DE', 'IN', 'SA']) {
    const market = studyMarketOptions.find((entry) => entry.id === marketId);
    assert.equal(market.supportMode, 'MARKET_AND_LOCALIZED_OUTPUT');
    assert.deepEqual(market.fullyEnabledLocaleIds, []);
    assert.deepEqual(market.partialLocaleIds, market.outputEnabledLocaleIds);
    assert.equal(market.outputEnabledLocaleIds.length, 1);
  }
});

test('an enabled market remains routing-only until at least one primary locale is fully enabled', () => {
  assert.equal(resolveMarketSupportMode({
    marketId: 'PARTIAL_TEST',
    marketStatus: MARKET_ROLLOUT_STATUSES.ENABLED,
    fullyEnabledLocaleIds: [],
    // A partially enabled locale must not suppress the market boundary notice.
    enabledLocaleIds: ['partial-test'],
  }), 'MARKET_ROUTING_ONLY');
});
