import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalizationRequestError,
  STUDY_LOCALIZATION_SCHEMA_VERSION,
  assertLocalizationExecutionAllowed,
  compatibilityAliasesForLocalization,
  normalizeLocalizationRequest,
} from './localization-request.js';

const pendingRelease = {
  runtimeStatus: 'enabled',
  copyStatus: 'machine-drafted',
  nativeReviewStatus: 'review-pending',
  releaseEligible: false,
  reviewer: null,
  reviewedAt: null,
  glossaryVersion: null,
  populationEvidenceStatus: 'unmeasured',
  attitudinalValidationStatus: 'unsupported',
};

test('canonical study localization resolves to one deeply frozen receipt', () => {
  const receipt = normalizeLocalizationRequest({
    localization: {
      schemaVersion: STUDY_LOCALIZATION_SCHEMA_VERSION,
      marketId: 'JP',
      reportLocale: 'ja-jp',
      sourceLocales: ['ja', 'en'],
      retrieval: { policy: 'REQUIRE', locales: ['ja', 'en'] },
      instrumentLocale: 'ja-JP',
    },
  });

  assert.deepEqual(receipt, {
    schemaVersion: 'study-localization-v1',
    registryVersion: 'localization-capabilities-v2',
    inputMode: 'canonical',
    market: {
      id: 'JP',
      kind: 'registered',
      label: 'Japan',
      countryCode: 'JP',
      searchLocation: 'Japan',
      retrievalGeography: { countryCode: 'JP', location: 'Japan' },
    },
    report: { locale: 'ja-JP', release: pendingRelease },
    source: { locales: ['ja-JP', 'en-US'] },
    retrieval: { policy: 'REQUIRE', locales: ['ja-JP', 'en-US'] },
    instrument: { locale: 'ja-JP', release: pendingRelease },
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.market.retrievalGeography), true);
  assert.equal(Object.isFrozen(receipt.report.release), true);
  assert.equal(Object.isFrozen(receipt.source.locales), true);
  assert.equal(Object.isFrozen(receipt.retrieval.locales), true);
});

test('legacy localization resolves deterministically and can be projected back to compatibility aliases', () => {
  const receipt = normalizeLocalizationRequest({
    market: 'Japan',
    outputLocale: 'ja',
    sourceLanguages: ['ja', 'en'],
    searchCountry: 'jp',
    searchLocation: 'Japan',
  });

  assert.equal(receipt.inputMode, 'legacy');
  assert.deepEqual(receipt.market, {
    id: 'JP',
    kind: 'registered',
    label: 'Japan',
    countryCode: 'JP',
    searchLocation: 'Japan',
    retrievalGeography: { countryCode: 'JP', location: 'Japan' },
  });
  assert.deepEqual(receipt.report, { locale: 'ja-JP', release: pendingRelease });
  assert.deepEqual(receipt.source, { locales: ['ja-JP', 'en-US'] });
  assert.deepEqual(receipt.retrieval, { policy: 'PREFER', locales: ['ja-JP', 'en-US'] });
  assert.deepEqual(receipt.instrument, { locale: 'ja-JP', release: pendingRelease });
  assert.deepEqual(compatibilityAliasesForLocalization(receipt), {
    market: 'Japan',
    outputLocale: 'ja-JP',
    sourceLanguages: ['ja-JP', 'en-US'],
    searchCountry: 'JP',
    searchLocation: 'Japan',
  });
});

test('legacy defaults are global English without an implicit country or location', () => {
  const receipt = normalizeLocalizationRequest({});
  assert.deepEqual(receipt.market, {
    id: 'GLOBAL',
    kind: 'registered',
    label: 'Global',
    countryCode: null,
    searchLocation: '',
    retrievalGeography: null,
  });
  assert.deepEqual(receipt.report, { locale: 'en-US', release: pendingRelease });
  assert.deepEqual(receipt.retrieval, { policy: 'ANY', locales: [] });
  assert.deepEqual(compatibilityAliasesForLocalization(receipt), {
    market: 'Global',
    outputLocale: 'en-US',
    sourceLanguages: [],
    searchLocation: '',
  });
});

test('Singapore is admitted as market-routing-only with an explicit SG retrieval geography', () => {
  const receipt = normalizeLocalizationRequest({
    localization: {
      schemaVersion: STUDY_LOCALIZATION_SCHEMA_VERSION,
      marketId: 'SG',
      reportLocale: 'en-US',
      sourceLocales: ['en-US'],
      retrieval: { policy: 'PREFER', locales: ['en-US'] },
      instrumentLocale: 'en-US',
    },
  });

  assert.equal(receipt.market.id, 'SG');
  assert.equal(receipt.market.countryCode, 'SG');
  assert.deepEqual(receipt.market.retrievalGeography, { countryCode: 'SG', location: 'Singapore' });
  assert.equal(receipt.report.locale, 'en-US');
  assert.equal(receipt.instrument.locale, 'en-US');
  assert.deepEqual(compatibilityAliasesForLocalization(receipt), {
    market: 'Singapore',
    outputLocale: 'en-US',
    sourceLanguages: ['en-US'],
    searchCountry: 'SG',
    searchLocation: 'Singapore',
  });
});

test('legacy registered subregions and explicit custom markets preserve geography without a US fallback', () => {
  const tokyo = normalizeLocalizationRequest({
    market: 'Japan', outputLocale: 'ja-JP', searchCountry: 'JP', searchLocation: 'Tokyo',
  });
  assert.deepEqual(tokyo.market.retrievalGeography, { countryCode: 'JP', location: 'Tokyo' });

  assert.throws(
    () => normalizeLocalizationRequest({
      market: 'Japan', outputLocale: 'ja-JP', searchCountry: 'JP', searchLocation: 'California, United States',
    }),
    (error) => error instanceof LocalizationRequestError
      && error.code === 'MARKET_LOCATION_MISMATCH'
      && error.path.join('.') === 'searchLocation',
  );

  const custom = normalizeLocalizationRequest({
    market: 'Quebec retail', outputLocale: 'fr-FR', searchCountry: 'CA', searchLocation: 'Montreal, Quebec',
  });
  assert.deepEqual(custom.market, {
    id: 'LEGACY_CUSTOM',
    kind: 'legacy-custom',
    label: 'Quebec retail',
    countryCode: 'CA',
    searchLocation: 'Montreal, Quebec',
    retrievalGeography: { countryCode: 'CA', location: 'Montreal, Quebec' },
  });

  for (const request of [
    { market: 'Unknown', outputLocale: 'en-US' },
    { market: 'Unknown', outputLocale: 'en-US', searchCountry: 'US' },
    { market: 'Global', outputLocale: 'en-US', searchCountry: 'US' },
    { market: 'Japan', outputLocale: 'ja-JP', searchCountry: 'US' },
  ]) {
    assert.throws(() => normalizeLocalizationRequest(request), LocalizationRequestError);
  }
});

test('canonical search locations are bounded by the selected market registry', () => {
  const localization = {
    schemaVersion: STUDY_LOCALIZATION_SCHEMA_VERSION,
    marketId: 'JP',
    reportLocale: 'ja-JP',
    sourceLocales: ['ja-JP'],
    retrieval: { policy: 'PREFER', locales: ['ja-JP'] },
    instrumentLocale: 'ja-JP',
  };

  assert.equal(normalizeLocalizationRequest({
    localization: { ...localization, searchLocation: 'tokyo' },
  }).market.searchLocation, 'Tokyo');

  assert.throws(
    () => normalizeLocalizationRequest({
      localization: { ...localization, searchLocation: 'California, United States' },
    }),
    (error) => error instanceof LocalizationRequestError
      && error.code === 'MARKET_LOCATION_MISMATCH'
      && error.path.join('.') === 'localization.searchLocation',
  );
});

test('unresolved legacy custom markets remain displayable but are not executable', () => {
  const receipt = normalizeLocalizationRequest({
    market: 'Quebec retail',
    outputLocale: 'fr-FR',
    searchCountry: 'CA',
    searchLocation: 'Montreal, Quebec',
  });

  assert.equal(receipt.market.id, 'LEGACY_CUSTOM');
  assert.equal(receipt.market.kind, 'legacy-custom');
  assert.throws(
    () => assertLocalizationExecutionAllowed(receipt),
    (error) => error instanceof LocalizationRequestError
      && error.code === 'UNKNOWN_MARKET'
      && error.path.join('.') === 'market',
  );
});

test('execution authorization validates the complete receipt against the live registry', () => {
  const japan = normalizeLocalizationRequest({
    market: 'Japan',
    outputLocale: 'ja-JP',
    sourceLanguages: ['ja-JP'],
    searchCountry: 'JP',
    searchLocation: 'Tokyo',
  });

  assert.equal(assertLocalizationExecutionAllowed(japan), japan, 'same-country legacy subregions remain executable');

  const mutations = [
    {
      receipt: { ...japan, market: { ...japan.market, id: 'QUEBEC_CUSTOM', label: 'Quebec retail', countryCode: 'CA', searchLocation: 'Montreal', retrievalGeography: { countryCode: 'CA', location: 'Montreal' } } },
      code: 'UNKNOWN_MARKET',
    },
    {
      receipt: { ...japan, market: { ...japan.market, id: 'ID', label: 'Indonesia', countryCode: 'ID', searchLocation: 'Jakarta', retrievalGeography: { countryCode: 'ID', location: 'Jakarta' } } },
      code: 'MARKET_NOT_ENABLED',
    },
    {
      receipt: { ...japan, market: { ...japan.market, countryCode: 'CA', retrievalGeography: { countryCode: 'CA', location: 'Tokyo' } } },
      code: 'INVALID_LOCALIZATION_RECEIPT',
    },
    {
      receipt: { ...japan, report: { ...japan.report, locale: 'id-ID' } },
      code: 'UNSUPPORTED_REPORT_LOCALE',
    },
    {
      receipt: { ...japan, registryVersion: 'localization-capabilities-v0' },
      code: 'INVALID_LOCALIZATION_RECEIPT',
    },
  ];

  for (const { receipt, code } of mutations) {
    assert.throws(
      () => assertLocalizationExecutionAllowed(receipt),
      (error) => error instanceof LocalizationRequestError && error.code === code,
      code,
    );
  }
});

test('planned markets and locales fail closed and canonical plus legacy aliases must agree', () => {
  assert.throws(
    () => normalizeLocalizationRequest({ market: 'United States', outputLocale: 'id-ID', searchCountry: 'US' }),
    (error) => error instanceof LocalizationRequestError
      && error.code === 'UNSUPPORTED_REPORT_LOCALE'
      && error.path[0] === 'outputLocale',
  );

  const canonicalRequest = (marketId) => ({
    localization: {
      schemaVersion: STUDY_LOCALIZATION_SCHEMA_VERSION,
      marketId,
      reportLocale: 'en-US',
      sourceLocales: ['en-US'],
      retrieval: { policy: 'PREFER', locales: ['en-US'] },
      instrumentLocale: 'en-US',
    },
  });
  for (const marketId of ['ID', 'MY', 'PH', 'TH', 'VN', 'BN', 'KH', 'LA', 'MM']) {
    assert.throws(
      () => normalizeLocalizationRequest(canonicalRequest(marketId)),
      (error) => error instanceof LocalizationRequestError
        && error.code === 'MARKET_NOT_ENABLED'
        && error.path.join('.') === 'localization.marketId',
      `${marketId} must not be admitted through the canonical contract.`,
    );
  }
  for (const market of ['Indonesia', 'Malaysia', 'Philippines', 'Thailand', 'Vietnam', 'Brunei', 'Cambodia', 'Laos', 'Myanmar']) {
    assert.throws(
      () => normalizeLocalizationRequest({ market, outputLocale: 'en-US' }),
      (error) => error instanceof LocalizationRequestError && error.code === 'MARKET_NOT_ENABLED',
      `${market} must not be admitted through the legacy contract.`,
    );
  }
  assert.throws(
    () => normalizeLocalizationRequest({
      market: 'Jakarta retail',
      outputLocale: 'en-US',
      searchCountry: 'ID',
      searchLocation: 'Jakarta',
    }),
    (error) => error instanceof LocalizationRequestError
      && error.code === 'MARKET_NOT_ENABLED'
      && error.path[0] === 'searchCountry',
  );

  const localization = {
    schemaVersion: STUDY_LOCALIZATION_SCHEMA_VERSION,
    marketId: 'JP',
    reportLocale: 'ja-JP',
    sourceLocales: ['ja-JP'],
    retrieval: { policy: 'PREFER', locales: ['ja-JP'] },
    instrumentLocale: 'ja-JP',
  };
  const matched = normalizeLocalizationRequest({
    localization,
    market: 'Japan',
    outputLocale: 'ja',
    sourceLanguages: ['ja'],
    searchCountry: 'JP',
    searchLocation: 'Japan',
  });
  assert.equal(matched.inputMode, 'canonical-with-legacy');

  assert.throws(
    () => normalizeLocalizationRequest({ localization, outputLocale: 'ko-KR' }),
    (error) => error instanceof LocalizationRequestError
      && error.code === 'LOCALIZATION_ALIAS_CONFLICT'
      && error.path[0] === 'outputLocale',
  );

  assert.throws(
    () => normalizeLocalizationRequest({ localization: {
      ...localization,
      retrieval: { policy: 'REQUIRE', locales: ['ja-JP'] },
    }, evidencePolicy: 'PRIOR_ONLY' }),
    (error) => error instanceof LocalizationRequestError
      && error.code === 'RETRIEVAL_POLICY_CONFLICT'
      && error.path[0] === 'evidencePolicy',
  );
});
