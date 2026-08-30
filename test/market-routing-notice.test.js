import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CJK_UI_CATALOGS,
  CJK_UI_LOCALES,
  ENGLISH_UI_CATALOG,
  resolveUiMessage,
} from '../src/i18nCatalog.mjs';
import { studyMarketOptions } from '../src/lib/localizationUiCatalog.js';

test('Singapore remains market-routing-only and the composer exposes that boundary', async () => {
  const [composer, styles] = await Promise.all([
    readFile(new URL('../src/components/StudyComposer.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ]);
  const singapore = studyMarketOptions.find((market) => market.id === 'SG');

  assert.equal(singapore.supportMode, 'MARKET_ROUTING_ONLY');
  assert.deepEqual(singapore.enabledLocaleIds, []);
  assert.deepEqual(singapore.plannedLocaleIds, ['en-SG', 'ms-SG', 'zh-Hans-SG', 'ta-SG']);
  assert.match(composer, /function MarketLocaleStatusCard/);
  assert.match(composer, /market\?\.supportMode === 'MARKET_ROUTING_ONLY'/);
  assert.match(composer, /market\?\.supportMode === 'MARKET_AND_LOCALIZED_OUTPUT'/);
  assert.match(composer, /role="status"/);
  assert.match(composer, /marketRoutingOnlyTitle/);
  assert.match(composer, /marketRoutingOnlyLocalesLabel/);
  assert.match(composer, /marketRoutingOnlyLanguageState/);
  assert.match(composer, /marketLocalizedOutputTitle/);
  assert.match(composer, /marketLocalizedOutputLocalesLabel/);
  assert.match(composer, /marketLocalizedOutputLanguageState/);
  assert.match(composer, /marketRoutingOnlyCurrencyNote/);
  assert.match(composer, /useMarketCurrency/);
  assert.match(composer, /market\?\.id !== 'GLOBAL'/);
  assert.match(composer, /if \(!showMarketBoundary && !showCurrencySuggestion\) return null/);
  assert.match(styles, /\.market-locale-status/);
});

test('routing-only and localized-output notice copy is localized and interpolates runtime language state', () => {
  const variables = {
    market: 'Singapore',
    countryCode: 'SG',
    outputLocales: 'Español (España)',
    interfaceLanguage: '한국어(대한민국)',
    reportLanguage: '한국어(대한민국)',
    instrumentLanguage: '한국어(대한민국)',
    currentCurrency: 'KRW',
    marketCurrency: 'SGD',
    currency: 'SGD',
  };

  assert.match(
    resolveUiMessage(ENGLISH_UI_CATALOG, 'marketRoutingOnlyBody', variables, 'en-US'),
    /Population framing and retrieval use Singapore/,
  );
  assert.match(
    resolveUiMessage(ENGLISH_UI_CATALOG, 'marketLocalizedOutputBody', variables, 'en-US'),
    /enabled for Español/,
  );

  for (const locale of CJK_UI_LOCALES) {
    for (const key of [
      'marketRoutingOnlyTitle',
      'marketRoutingOnlyBody',
      'marketRoutingOnlyLocalesLabel',
      'marketRoutingOnlyLanguageState',
      'marketLocalizedOutputTitle',
      'marketLocalizedOutputBody',
      'marketLocalizedOutputLocalesLabel',
      'marketLocalizedOutputLanguageState',
      'marketRoutingOnlyCurrencyNote',
      'useMarketCurrency',
    ]) {
      assert.equal(typeof CJK_UI_CATALOGS[locale][key], 'string', `${locale} missing ${key}`);
      assert.notEqual(CJK_UI_CATALOGS[locale][key], ENGLISH_UI_CATALOG[key], `${locale} left ${key} in English`);
      assert.doesNotThrow(() => resolveUiMessage(CJK_UI_CATALOGS[locale], key, variables, locale));
    }
  }
});
