import {
  LOCALIZATION_REGISTRY_VERSION,
  LocalizationCapabilityError,
  MARKET_CAPABILITIES,
  MARKET_ROLLOUT_STATUSES,
  requireLocaleCapability,
  resolveMarket,
} from '../shared/localization.mjs';

export const STUDY_LOCALIZATION_SCHEMA_VERSION = 'study-localization-v1';
export const RETRIEVAL_LOCALE_POLICIES = Object.freeze(['ANY', 'PREFER', 'REQUIRE']);

export class LocalizationRequestError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = 'LocalizationRequestError';
    this.code = code;
    this.path = Object.freeze([...path]);
    this.publicMessage = message;
  }

  toPublicIssue() {
    return { code: this.code, path: [...this.path], message: this.publicMessage };
  }
}

export function publicLocalizationIssue(error) {
  if (error instanceof LocalizationRequestError) return error.toPublicIssue();
  return {
    code: 'INVALID_LOCALIZATION',
    path: ['localization'],
    message: 'The study localization settings are invalid.',
  };
}

function fail(code, path, message) {
  throw new LocalizationRequestError(code, path, message);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed, path) {
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
  if (unsupported) fail('UNSUPPORTED_LOCALIZATION_FIELD', [...path, unsupported], 'The study localization settings contain an unsupported field.');
}

function normalizeCapabilityEntry(value, capability, path) {
  try {
    return requireLocaleCapability(value, capability);
  } catch (error) {
    if (!(error instanceof LocalizationCapabilityError)) throw error;
    const code = error.code === 'INVALID_LOCALE' ? 'INVALID_LOCALE' : error.code;
    fail(code, path, `The requested ${capability} locale is not supported.`);
  }
}

const normalizeCapabilityLocale = (value, capability, path) => normalizeCapabilityEntry(value, capability, path).id;

function releaseSnapshot(value, capability, path) {
  const entry = normalizeCapabilityEntry(value, capability, path);
  return {
    runtimeStatus: entry.capabilities[capability],
    copyStatus: entry.release.copyStatus,
    nativeReviewStatus: 'review-pending',
    releaseEligible: false,
    reviewer: null,
    reviewedAt: null,
    glossaryVersion: null,
    populationEvidenceStatus: entry.release.populationEvidenceStatus,
    attitudinalValidationStatus: entry.release.attitudinalValidationStatus,
  };
}

function normalizeLocaleList(value, capability, path) {
  if (!Array.isArray(value) || value.length > 4) fail('INVALID_LOCALE_LIST', path, 'Locale preferences must be an array of at most four supported locales.');
  const locales = value.map((locale, index) => normalizeCapabilityLocale(locale, capability, [...path, index]));
  if (new Set(locales).size !== locales.length) fail('DUPLICATE_LOCALE', path, 'Locale preferences must not contain duplicates.');
  return locales;
}

const comparableText = (value) => String(value).normalize('NFKC').trim().toLocaleLowerCase('en-US');

function registeredRetrievalLocation(marketId, value) {
  const requested = comparableText(value);
  return MARKET_CAPABILITIES[marketId]?.retrievalLocations.find((location) => comparableText(location) === requested) || null;
}

function normalizeMarket(value, path) {
  try {
    const entry = resolveMarket(value);
    if (entry.status !== MARKET_ROLLOUT_STATUSES.ENABLED) {
      fail('MARKET_NOT_ENABLED', path, 'The requested market is registered but is not enabled for study execution.');
    }
    return {
      id: entry.id,
      kind: 'registered',
      label: entry.englishLabel,
      countryCode: entry.countryCode,
      searchLocation: entry.retrievalGeography?.location || '',
      retrievalGeography: entry.retrievalGeography ? { ...entry.retrievalGeography } : null,
    };
  } catch (error) {
    if (!(error instanceof LocalizationCapabilityError)) throw error;
    fail(error.code, path, 'The requested market is not supported.');
  }
}

function normalizeCanonicalLocalization(localization) {
  if (!plainObject(localization)) fail('INVALID_LOCALIZATION', ['localization'], 'Study localization must be an object.');
  assertOnlyKeys(localization, ['schemaVersion', 'marketId', 'searchLocation', 'reportLocale', 'sourceLocales', 'retrieval', 'instrumentLocale'], ['localization']);
  if (localization.schemaVersion !== STUDY_LOCALIZATION_SCHEMA_VERSION) fail('UNSUPPORTED_LOCALIZATION_VERSION', ['localization', 'schemaVersion'], 'The study localization schema version is not supported.');

  let market = normalizeMarket(localization.marketId, ['localization', 'marketId']);
  if (Object.hasOwn(localization, 'searchLocation')) {
    if (typeof localization.searchLocation !== 'string' || localization.searchLocation.trim().length > 120) {
      fail('INVALID_SEARCH_LOCATION', ['localization', 'searchLocation'], 'Search location must be a string of at most 120 characters.');
    }
    let searchLocation = localization.searchLocation.trim();
    if (market.countryCode === null && searchLocation) {
      fail('INVALID_SEARCH_LOCATION', ['localization', 'searchLocation'], 'Global studies cannot declare a country-specific search location.');
    }
    if (market.countryCode && !searchLocation) {
      fail('INVALID_SEARCH_LOCATION', ['localization', 'searchLocation'], 'A registered country market needs a non-empty search location.');
    }
    if (market.countryCode) {
      const registeredLocation = registeredRetrievalLocation(market.id, searchLocation);
      if (!registeredLocation) {
        fail('MARKET_LOCATION_MISMATCH', ['localization', 'searchLocation'], 'Search location is not registered for the selected market.');
      }
      searchLocation = registeredLocation;
    }
    market = {
      ...market,
      searchLocation,
      retrievalGeography: market.countryCode ? { countryCode: market.countryCode, location: searchLocation } : null,
    };
  }
  const reportLocale = normalizeCapabilityLocale(localization.reportLocale, 'report', ['localization', 'reportLocale']);
  const sourceLocales = normalizeLocaleList(localization.sourceLocales, 'source', ['localization', 'sourceLocales']);
  const instrumentLocale = normalizeCapabilityLocale(localization.instrumentLocale, 'instrument', ['localization', 'instrumentLocale']);

  if (!plainObject(localization.retrieval)) fail('INVALID_RETRIEVAL_LOCALIZATION', ['localization', 'retrieval'], 'Retrieval localization must be an object.');
  assertOnlyKeys(localization.retrieval, ['policy', 'locales'], ['localization', 'retrieval']);
  const policy = typeof localization.retrieval.policy === 'string' ? localization.retrieval.policy.toUpperCase() : '';
  if (!RETRIEVAL_LOCALE_POLICIES.includes(policy)) fail('INVALID_RETRIEVAL_POLICY', ['localization', 'retrieval', 'policy'], 'Retrieval policy must be ANY, PREFER, or REQUIRE.');
  const retrievalLocales = normalizeLocaleList(localization.retrieval.locales, 'retrieval', ['localization', 'retrieval', 'locales']);
  if (policy === 'ANY' && retrievalLocales.length) fail('RETRIEVAL_POLICY_CONFLICT', ['localization', 'retrieval'], 'ANY retrieval cannot include locale preferences.');
  if (policy !== 'ANY' && !retrievalLocales.length) fail('RETRIEVAL_POLICY_CONFLICT', ['localization', 'retrieval'], 'PREFER and REQUIRE retrieval need at least one locale.');

  return {
    schemaVersion: STUDY_LOCALIZATION_SCHEMA_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    inputMode: 'canonical',
    market,
    report: { locale: reportLocale, release: releaseSnapshot(reportLocale, 'report', ['localization', 'reportLocale']) },
    source: { locales: sourceLocales },
    retrieval: { policy, locales: retrievalLocales },
    instrument: { locale: instrumentLocale, release: releaseSnapshot(instrumentLocale, 'instrument', ['localization', 'instrumentLocale']) },
  };
}

function normalizeCountry(value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value.trim())) fail('INVALID_SEARCH_COUNTRY', path, 'Search country must be a two-letter country code.');
  return value.trim().toUpperCase();
}

function normalizeLegacyMarket(input) {
  const suppliedMarket = input.market ?? 'Global';
  if (typeof suppliedMarket !== 'string' || suppliedMarket.trim().length < 2 || suppliedMarket.trim().length > 120) {
    fail('MISSING_MARKET', ['market'], 'A registered market or explicit legacy custom market is required.');
  }
  const marketLabel = suppliedMarket.trim();
  const hasCountry = Object.hasOwn(input, 'searchCountry') && input.searchCountry !== undefined && input.searchCountry !== null && String(input.searchCountry).trim() !== '';
  const hasLocation = Object.hasOwn(input, 'searchLocation') && typeof input.searchLocation === 'string' && input.searchLocation.trim() !== '';
  const countryCode = hasCountry ? normalizeCountry(input.searchCountry, ['searchCountry']) : null;
  const searchLocation = hasLocation ? input.searchLocation.trim() : '';

  let registered;
  try {
    registered = resolveMarket(marketLabel);
  } catch (error) {
    if (!(error instanceof LocalizationCapabilityError)) throw error;
    if (!hasCountry || !hasLocation || searchLocation.length > 120) {
      fail('UNKNOWN_MARKET', ['market'], 'An unknown legacy market requires an explicit two-letter country and location.');
    }
    const registeredCountry = Object.values(MARKET_CAPABILITIES).find((entry) => entry.countryCode === countryCode);
    if (registeredCountry && registeredCountry.status !== MARKET_ROLLOUT_STATUSES.ENABLED) {
      fail('MARKET_NOT_ENABLED', ['searchCountry'], 'This market is registered but is not enabled for study execution.');
    }
    return {
      id: 'LEGACY_CUSTOM',
      kind: 'legacy-custom',
      label: marketLabel,
      countryCode,
      searchLocation,
      retrievalGeography: { countryCode, location: searchLocation },
    };
  }

  if (registered.status !== MARKET_ROLLOUT_STATUSES.ENABLED) {
    fail('MARKET_NOT_ENABLED', ['market'], 'The requested market is registered but is not enabled for study execution.');
  }

  if (countryCode && countryCode !== registered.countryCode) {
    fail('MARKET_COUNTRY_MISMATCH', ['searchCountry'], 'Search country does not match the registered market.');
  }
  const registeredLocation = registered.retrievalGeography?.location || '';
  const resolvedLocation = hasLocation
    ? registeredRetrievalLocation(registered.id, searchLocation)
    : registeredLocation;
  if (hasLocation && !resolvedLocation) {
    fail('MARKET_LOCATION_MISMATCH', ['searchLocation'], 'Search location is not registered for the selected market.');
  }
  return {
    id: registered.id,
    kind: 'registered',
    label: registered.englishLabel,
    countryCode: registered.countryCode,
    searchLocation: resolvedLocation,
    retrievalGeography: registered.countryCode ? { countryCode: registered.countryCode, location: resolvedLocation } : null,
  };
}

function normalizeLegacyLocalization(input) {
  const market = normalizeLegacyMarket(input);
  const outputLocale = input.outputLocale ?? 'en-US';
  const reportLocale = normalizeCapabilityLocale(outputLocale, 'report', ['outputLocale']);
  const sourceLocales = normalizeLocaleList(input.sourceLanguages ?? [], 'source', ['sourceLanguages']);
  return {
    schemaVersion: STUDY_LOCALIZATION_SCHEMA_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    inputMode: 'legacy',
    market,
    report: { locale: reportLocale, release: releaseSnapshot(reportLocale, 'report', ['outputLocale']) },
    source: { locales: sourceLocales },
    retrieval: { policy: sourceLocales.length ? 'PREFER' : 'ANY', locales: [...sourceLocales] },
    instrument: {
      locale: normalizeCapabilityLocale(outputLocale, 'instrument', ['outputLocale']),
      release: releaseSnapshot(outputLocale, 'instrument', ['outputLocale']),
    },
  };
}

const LEGACY_LOCALIZATION_FIELDS = Object.freeze(['market', 'outputLocale', 'sourceLanguages', 'searchCountry', 'searchLocation']);

function assertMatchingLegacyAliases(input, canonicalReceipt) {
  if (!LEGACY_LOCALIZATION_FIELDS.some((field) => Object.hasOwn(input, field))) return canonicalReceipt;
  const legacyReceipt = normalizeLegacyLocalization(input);
  const conflicts = [];
  if (Object.hasOwn(input, 'market') && legacyReceipt.market.id !== canonicalReceipt.market.id) conflicts.push('market');
  if (Object.hasOwn(input, 'outputLocale') && legacyReceipt.report.locale !== canonicalReceipt.report.locale) conflicts.push('outputLocale');
  if (Object.hasOwn(input, 'sourceLanguages') && JSON.stringify(legacyReceipt.source.locales) !== JSON.stringify(canonicalReceipt.source.locales)) conflicts.push('sourceLanguages');
  if (Object.hasOwn(input, 'searchCountry') && legacyReceipt.market.countryCode !== canonicalReceipt.market.countryCode) conflicts.push('searchCountry');
  if (Object.hasOwn(input, 'searchLocation') && comparableText(legacyReceipt.market.searchLocation) !== comparableText(canonicalReceipt.market.searchLocation)) conflicts.push('searchLocation');
  if (conflicts.length) {
    fail(
      'LOCALIZATION_ALIAS_CONFLICT',
      [conflicts[0]],
      'Canonical localization and legacy localization aliases must resolve to the same values.',
    );
  }
  return { ...canonicalReceipt, inputMode: 'canonical-with-legacy' };
}

export function normalizeLocalizationRequest(input) {
  if (!plainObject(input)) fail('INVALID_LOCALIZATION_REQUEST', ['localization'], 'The study request must be an object.');
  const receipt = Object.hasOwn(input, 'localization')
    ? assertMatchingLegacyAliases(input, normalizeCanonicalLocalization(input.localization))
    : normalizeLegacyLocalization(input);
  if (receipt.retrieval.policy === 'REQUIRE' && String(input.evidencePolicy || '').toUpperCase() === 'PRIOR_ONLY') {
    fail('RETRIEVAL_POLICY_CONFLICT', ['evidencePolicy'], 'Required retrieval locales cannot be combined with PRIOR_ONLY evidence policy.');
  }
  return deepFreeze(receipt);
}

export function assertLocalizationExecutionAllowed(receipt) {
  if (!plainObject(receipt)
    || receipt.schemaVersion !== STUDY_LOCALIZATION_SCHEMA_VERSION
    || receipt.registryVersion !== LOCALIZATION_REGISTRY_VERSION
    || !['canonical', 'canonical-with-legacy', 'legacy'].includes(receipt.inputMode)
    || !plainObject(receipt.market)
    || !plainObject(receipt.report)
    || !plainObject(receipt.source)
    || !plainObject(receipt.retrieval)
    || !plainObject(receipt.instrument)) {
    fail('INVALID_LOCALIZATION_RECEIPT', ['localization'], 'A valid localization receipt is required for study execution.');
  }
  if (receipt.market.id === 'LEGACY_CUSTOM' || receipt.market.kind === 'legacy-custom') {
    fail(
      'UNKNOWN_MARKET',
      ['market'],
      'This legacy market can be viewed, but it must be mapped to an enabled registered market before running a study.',
    );
  }

  const registeredMarket = MARKET_CAPABILITIES[receipt.market.id];
  if (!registeredMarket) {
    fail('UNKNOWN_MARKET', ['market'], 'The localization receipt does not reference a registered market.');
  }
  if (registeredMarket.status !== MARKET_ROLLOUT_STATUSES.ENABLED) {
    fail('MARKET_NOT_ENABLED', ['market'], 'The localization receipt references a market that is not enabled for study execution.');
  }

  const searchLocation = typeof receipt.market.searchLocation === 'string'
    ? receipt.market.searchLocation.trim()
    : null;
  const expectedCountry = registeredMarket.countryCode;
  const geography = receipt.market.retrievalGeography;
  const marketShapeMatches = receipt.market.kind === 'registered'
    && receipt.market.label === registeredMarket.englishLabel
    && receipt.market.countryCode === expectedCountry
    && searchLocation !== null
    && searchLocation.length <= 120
    && (expectedCountry === null
      ? searchLocation === '' && geography === null
      : searchLocation.length > 0
        && plainObject(geography)
        && geography.countryCode === expectedCountry
        && geography.location === searchLocation);
  if (!marketShapeMatches) {
    fail('INVALID_LOCALIZATION_RECEIPT', ['localization', 'market'], 'The localization receipt market does not match the registered market.');
  }

  let expected;
  try {
    expected = normalizeCanonicalLocalization({
      schemaVersion: receipt.schemaVersion,
      marketId: receipt.market.id,
      searchLocation: receipt.market.searchLocation,
      reportLocale: receipt.report.locale,
      sourceLocales: receipt.source.locales,
      retrieval: receipt.retrieval,
      instrumentLocale: receipt.instrument.locale,
    });
  } catch (error) {
    if (error instanceof LocalizationRequestError) throw error;
    fail('INVALID_LOCALIZATION_RECEIPT', ['localization'], 'The localization receipt could not be verified.');
  }

  const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  if (!sameJson(receipt.report, expected.report)
    || !sameJson(receipt.source, expected.source)
    || !sameJson(receipt.retrieval, expected.retrieval)
    || !sameJson(receipt.instrument, expected.instrument)) {
    fail('INVALID_LOCALIZATION_RECEIPT', ['localization'], 'The localization receipt does not match the current locale registry.');
  }

  // Every executable request uses one of the market registry's bounded retrieval locations.
  if (receipt.inputMode !== 'legacy'
    && !sameJson(receipt.market.retrievalGeography, expected.market.retrievalGeography)) {
    fail('INVALID_LOCALIZATION_RECEIPT', ['localization', 'market'], 'Canonical localization geography must match the registered market.');
  }
  return receipt;
}

export function compatibilityAliasesForLocalization(receipt) {
  if (!plainObject(receipt)
    || receipt.schemaVersion !== STUDY_LOCALIZATION_SCHEMA_VERSION
    || !plainObject(receipt.market)
    || !plainObject(receipt.report)
    || !plainObject(receipt.source)) {
    fail('INVALID_LOCALIZATION_RECEIPT', ['localization'], 'A valid localization receipt is required.');
  }
  return deepFreeze({
    market: receipt.market.label,
    outputLocale: receipt.report.locale,
    sourceLanguages: [...receipt.source.locales],
    ...(receipt.market.countryCode ? { searchCountry: receipt.market.countryCode } : {}),
    searchLocation: receipt.market.searchLocation,
  });
}
