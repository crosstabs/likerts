import assert from 'node:assert/strict';
import test from 'node:test';

import { studyMarketOptions } from '../src/lib/localizationUiCatalog.js';
import { normalizeStudyLocalizationState, prepareStudyLocalization } from '../src/lib/studyLocalization.js';
import { normalizeLocalizationRequest } from '../server/localization-request.js';

const market = (id) => studyMarketOptions.find((entry) => entry.id === id);

test('ordinary studies produce the complete canonical localization contract', () => {
  const prepared = prepareStudyLocalization({
    outputLocale: 'ja-JP',
    sourceLanguages: ['en-US', 'ja-JP'],
    retrievalPolicy: 'REQUIRE',
    retrievalLocales: ['ja-JP'],
    instrumentLocale: 'ko-KR',
  }, market('JP'));

  assert.deepEqual(prepared.localization, {
    schemaVersion: 'study-localization-v1',
    marketId: 'JP',
    reportLocale: 'ja-JP',
    sourceLocales: ['en-US', 'ja-JP'],
    retrieval: { policy: 'REQUIRE', locales: ['ja-JP'] },
    instrumentLocale: 'ko-KR',
  });
  assert.equal(prepared.receipt.inputMode, 'canonical-with-legacy');
  assert.equal(prepared.aliases.searchCountry, 'JP');
});

test('new Global studies retain null retrieval geography and independent defaults', () => {
  const prepared = prepareStudyLocalization({
    outputLocale: 'zh-CN',
    sourceLanguages: [],
    retrievalPolicy: 'ANY',
    retrievalLocales: ['en-US'],
    instrumentLocale: 'zh-CN',
  }, market('GLOBAL'));

  assert.deepEqual(prepared.localization.retrieval, { policy: 'ANY', locales: [] });
  assert.equal(prepared.receipt.market.retrievalGeography, null);
  assert.equal(Object.hasOwn(prepared.aliases, 'searchCountry'), false);
});

test('Singapore market routing stays enabled without implying a Singapore locale', () => {
  const singapore = market('SG');
  const prepared = prepareStudyLocalization({
    outputLocale: 'en-US',
    sourceLanguages: ['en-US'],
    retrievalPolicy: 'PREFER',
    retrievalLocales: ['en-US'],
    instrumentLocale: 'en-US',
  }, singapore);

  assert.equal(singapore.supportMode, 'MARKET_ROUTING_ONLY');
  assert.equal(singapore.currencyCode, 'SGD');
  assert.deepEqual(singapore.enabledLocaleIds, []);
  assert.equal(prepared.localization.marketId, 'SG');
  assert.deepEqual(prepared.receipt.market.retrievalGeography, { countryCode: 'SG', location: 'Singapore' });
  assert.equal(prepared.aliases.searchCountry, 'SG');
  assert.equal(prepared.aliases.searchLocation, 'Singapore');
});

test('legacy restored studies retain the previous source-to-retrieval default only during migration', () => {
  const migrated = normalizeStudyLocalizationState({
    outputLocale: 'es-ES',
    sourceLanguages: ['es-ES'],
  });
  const prepared = prepareStudyLocalization(migrated, market('ES'));

  assert.deepEqual(prepared.localization.retrieval, { policy: 'PREFER', locales: ['es-ES'] });
  assert.equal(prepared.localization.instrumentLocale, 'es-ES');
  assert.equal(migrated.instrumentLocale, '');
});

test('restored registered subregions retain their bounded same-country retrieval location', () => {
  const localizationReceipt = normalizeLocalizationRequest({
    market: 'Japan',
    outputLocale: 'ja-JP',
    sourceLanguages: ['ja-JP'],
    searchCountry: 'JP',
    searchLocation: 'Tokyo',
  });
  const prepared = prepareStudyLocalization({
    outputLocale: 'ja-JP',
    sourceLanguages: ['ja-JP'],
    retrievalPolicy: 'PREFER',
    retrievalLocales: ['ja-JP'],
    instrumentLocale: '',
    localizationReceipt,
  }, market('JP'));

  assert.equal(prepared.localization.searchLocation, 'Tokyo');
  assert.equal(prepared.aliases.searchLocation, 'Tokyo');
  assert.deepEqual(prepared.receipt.market.retrievalGeography, { countryCode: 'JP', location: 'Tokyo' });
});

test('Require and Prefer fail closed when no retrieval locale is selected', () => {
  assert.throws(
    () => prepareStudyLocalization({
      outputLocale: 'en-US',
      sourceLanguages: [],
      retrievalPolicy: 'REQUIRE',
      retrievalLocales: [],
      instrumentLocale: 'en-US',
    }, market('US')),
    (error) => error?.code === 'RETRIEVAL_POLICY_CONFLICT',
  );
});

test('planned locales and unknown restored markets cannot bypass UI admission', () => {
  assert.throws(
    () => prepareStudyLocalization({
      outputLocale: 'id-ID',
      sourceLanguages: [],
      retrievalPolicy: 'ANY',
      retrievalLocales: [],
      instrumentLocale: 'id-ID',
    }, market('GLOBAL')),
    (error) => error?.code === 'UNSUPPORTED_REPORT_LOCALE',
  );
  assert.throws(
    () => prepareStudyLocalization({ outputLocale: 'en-US' }, undefined),
    /not enabled/,
  );
});
