export const LOCALIZATION_REGISTRY_VERSION = 'localization-capabilities-v2';

export const LOCALIZATION_CAPABILITIES = Object.freeze([
  'ui',
  'report',
  'source',
  'retrieval',
  'instrument',
  'sample',
]);

export const LOCALIZATION_CAPABILITY_STATUSES = Object.freeze({
  ENABLED: 'enabled',
  PLANNED: 'planned',
  DISABLED: 'disabled',
});

export const LOCALIZATION_RELEASE_STATUSES = Object.freeze({
  MACHINE_DRAFTED: 'machine-drafted',
  REVIEW_PENDING: 'review-pending',
  NATIVE_REVIEWED: 'native-reviewed',
  UNMEASURED: 'unmeasured',
  PARTIAL: 'partial',
  READY: 'ready',
  UNSUPPORTED: 'unsupported',
  VALIDATED: 'validated',
});

export const MARKET_ROLLOUT_STATUSES = Object.freeze({
  ENABLED: 'enabled',
  PLANNED: 'planned',
  ROADMAP: 'roadmap',
});

export const MARKET_SUPPORT_MODES = Object.freeze({
  GLOBAL_SCOPE: 'GLOBAL_SCOPE',
  MARKET_ROUTING_ONLY: 'MARKET_ROUTING_ONLY',
  MARKET_AND_LOCALIZED_OUTPUT: 'MARKET_AND_LOCALIZED_OUTPUT',
  MARKET_AND_ONE_OR_MORE_LOCALES: 'MARKET_AND_ONE_OR_MORE_LOCALES',
  PLANNED_OR_ROADMAP_MARKET: 'PLANNED_OR_ROADMAP_MARKET',
});

export const CJK_LOCALE_IDS = Object.freeze(['zh-CN', 'ja-JP', 'ko-KR']);
export const ASEAN_MARKET_IDS = Object.freeze(['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN']);
export const ASEAN_LANGUAGE_LOCALE_IDS = Object.freeze([
  'ms-BN', 'km-KH', 'id-ID', 'lo-LA', 'ms-MY', 'en-MY', 'my-MM', 'fil-PH', 'en-PH',
  'en-SG', 'ms-SG', 'zh-Hans-SG', 'ta-SG', 'th-TH', 'vi-VN',
]);

export class LocalizationCapabilityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocalizationCapabilityError';
    this.code = code;
    Object.assign(this, details);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const enabledCapabilities = () => Object.fromEntries(
  LOCALIZATION_CAPABILITIES.map((capability) => [capability, LOCALIZATION_CAPABILITY_STATUSES.ENABLED]),
);

const plannedCapabilities = () => Object.fromEntries(
  LOCALIZATION_CAPABILITIES.map((capability) => [capability, LOCALIZATION_CAPABILITY_STATUSES.PLANNED]),
);

const localizedOutputCapabilities = () => ({
  ...enabledCapabilities(),
  ui: LOCALIZATION_CAPABILITY_STATUSES.PLANNED,
});

const machineDraftRelease = () => ({
  copyStatus: LOCALIZATION_RELEASE_STATUSES.MACHINE_DRAFTED,
  nativeReview: {
    status: LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING,
    reviewer: null,
    reviewedAt: null,
    glossaryVersion: null,
    capabilityScope: [],
    reviewedProductVersion: null,
    reviewedPromptVersion: null,
    findingsLog: [],
    blockingFindingsResolved: false,
    statusByCapability: Object.fromEntries(
      LOCALIZATION_CAPABILITIES.map((capability) => [capability, LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING]),
    ),
  },
  populationEvidenceStatus: LOCALIZATION_RELEASE_STATUSES.UNMEASURED,
  attitudinalValidationStatus: LOCALIZATION_RELEASE_STATUSES.UNSUPPORTED,
  attitudinalValidationEvidence: null,
});

const plannedRelease = () => ({
  ...machineDraftRelease(),
  copyStatus: LOCALIZATION_RELEASE_STATUSES.UNSUPPORTED,
});

const locale = ({ id, englishLabel, nativeLabel, marketId = id.split('-').at(-1), dir = 'ltr', htmlLang = id, aliases = [], expectedScripts, disallowedScripts = [], capabilities = enabledCapabilities(), release = null }) => {
  const allCapabilitiesPlanned = Object.values(capabilities).every(
    (status) => status === LOCALIZATION_CAPABILITY_STATUSES.PLANNED,
  );
  return {
    id,
    marketId,
    englishLabel,
    nativeLabel,
    dir,
    htmlLang,
    aliases: [...new Set([...aliases, ...(htmlLang === id ? [] : [htmlLang])])],
    scriptPolicy: { expected: expectedScripts, disallowed: disallowedScripts },
    capabilities,
    release: release || (allCapabilitiesPlanned ? plannedRelease() : machineDraftRelease()),
  };
};

const latinDisallowed = ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Khmer', 'Lao', 'Myanmar', 'Tamil', 'Thai'];

export const LOCALE_CAPABILITIES = deepFreeze({
  'en-US': locale({ id: 'en-US', englishLabel: 'English (United States)', nativeLabel: 'English (US)', aliases: ['en'], expectedScripts: ['Latin'], disallowedScripts: latinDisallowed }),
  'es-ES': locale({ id: 'es-ES', englishLabel: 'Spanish (Spain)', nativeLabel: 'Español (España)', aliases: ['es'], expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: localizedOutputCapabilities() }),
  'pt-BR': locale({ id: 'pt-BR', englishLabel: 'Portuguese (Brazil)', nativeLabel: 'Português (Brasil)', aliases: ['pt'], expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: localizedOutputCapabilities() }),
  'fr-FR': locale({ id: 'fr-FR', englishLabel: 'French (France)', nativeLabel: 'Français (France)', aliases: ['fr'], expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: localizedOutputCapabilities() }),
  'de-DE': locale({ id: 'de-DE', englishLabel: 'German (Germany)', nativeLabel: 'Deutsch (Deutschland)', aliases: ['de'], expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: localizedOutputCapabilities() }),
  'zh-CN': locale({ id: 'zh-CN', englishLabel: 'Chinese (Simplified, China)', nativeLabel: '简体中文（中国）', htmlLang: 'zh-Hans-CN', aliases: ['zh', 'zh-Hans'], expectedScripts: ['Han'], disallowedScripts: ['Arabic', 'Devanagari', 'Hiragana', 'Katakana', 'Hangul', 'Khmer', 'Lao', 'Myanmar', 'Tamil', 'Thai'] }),
  'ja-JP': locale({ id: 'ja-JP', englishLabel: 'Japanese (Japan)', nativeLabel: '日本語（日本）', aliases: ['ja'], expectedScripts: ['Han', 'Hiragana', 'Katakana'], disallowedScripts: ['Arabic', 'Devanagari', 'Hangul', 'Khmer', 'Lao', 'Myanmar', 'Tamil', 'Thai'] }),
  'ko-KR': locale({ id: 'ko-KR', englishLabel: 'Korean (South Korea)', nativeLabel: '한국어(대한민국)', aliases: ['ko'], expectedScripts: ['Hangul'], disallowedScripts: ['Arabic', 'Devanagari', 'Hiragana', 'Katakana', 'Khmer', 'Lao', 'Myanmar', 'Tamil', 'Thai'] }),
  'ar-SA': locale({ id: 'ar-SA', englishLabel: 'Arabic (Saudi Arabia)', nativeLabel: 'العربية (السعودية)', dir: 'rtl', aliases: ['ar'], expectedScripts: ['Arabic'], disallowedScripts: ['Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Khmer', 'Lao', 'Myanmar', 'Tamil', 'Thai'], capabilities: localizedOutputCapabilities() }),
  'hi-IN': locale({ id: 'hi-IN', englishLabel: 'Hindi (India)', nativeLabel: 'हिन्दी (भारत)', aliases: ['hi'], expectedScripts: ['Devanagari'], disallowedScripts: ['Arabic', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Khmer', 'Lao', 'Myanmar', 'Tamil', 'Thai'], capabilities: localizedOutputCapabilities() }),

  // ASEAN locale records are deliberately non-runnable until each capability has
  // its own translated assets and QA. Markets may exist before language support.
  'ms-BN': locale({ id: 'ms-BN', englishLabel: 'Malay (Brunei)', nativeLabel: 'Bahasa Melayu (Brunei)', expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: plannedCapabilities() }),
  'km-KH': locale({ id: 'km-KH', englishLabel: 'Khmer (Cambodia)', nativeLabel: 'ខ្មែរ (កម្ពុជា)', expectedScripts: ['Khmer'], disallowedScripts: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Lao', 'Myanmar', 'Tamil', 'Thai'], capabilities: plannedCapabilities() }),
  'id-ID': locale({ id: 'id-ID', englishLabel: 'Indonesian (Indonesia)', nativeLabel: 'Bahasa Indonesia', expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: plannedCapabilities() }),
  'lo-LA': locale({ id: 'lo-LA', englishLabel: 'Lao (Laos)', nativeLabel: 'ລາວ (ລາວ)', expectedScripts: ['Lao'], disallowedScripts: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Khmer', 'Myanmar', 'Tamil', 'Thai'], capabilities: plannedCapabilities() }),
  'ms-MY': locale({ id: 'ms-MY', englishLabel: 'Malay (Malaysia)', nativeLabel: 'Bahasa Melayu (Malaysia)', expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: plannedCapabilities() }),
  'en-MY': locale({ id: 'en-MY', englishLabel: 'English (Malaysia)', nativeLabel: 'English (Malaysia)', expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: plannedCapabilities() }),
  'my-MM': locale({ id: 'my-MM', englishLabel: 'Burmese (Myanmar)', nativeLabel: 'မြန်မာ (မြန်မာ)', expectedScripts: ['Myanmar'], disallowedScripts: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Khmer', 'Lao', 'Tamil', 'Thai'], capabilities: plannedCapabilities() }),
  'fil-PH': locale({ id: 'fil-PH', englishLabel: 'Filipino (Philippines)', nativeLabel: 'Filipino (Pilipinas)', expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: plannedCapabilities() }),
  'en-PH': locale({ id: 'en-PH', englishLabel: 'English (Philippines)', nativeLabel: 'English (Philippines)', expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: plannedCapabilities() }),
  'en-SG': locale({ id: 'en-SG', englishLabel: 'English (Singapore)', nativeLabel: 'English (Singapore)', expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: plannedCapabilities() }),
  'ms-SG': locale({ id: 'ms-SG', englishLabel: 'Malay (Singapore)', nativeLabel: 'Bahasa Melayu (Singapura)', expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: plannedCapabilities() }),
  'zh-Hans-SG': locale({ id: 'zh-Hans-SG', englishLabel: 'Chinese (Simplified, Singapore)', nativeLabel: '简体中文（新加坡）', expectedScripts: ['Han'], disallowedScripts: ['Arabic', 'Devanagari', 'Hiragana', 'Katakana', 'Hangul', 'Khmer', 'Lao', 'Myanmar', 'Tamil', 'Thai'], capabilities: plannedCapabilities() }),
  'ta-SG': locale({ id: 'ta-SG', englishLabel: 'Tamil (Singapore)', nativeLabel: 'தமிழ் (சிங்கப்பூர்)', expectedScripts: ['Tamil'], disallowedScripts: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Khmer', 'Lao', 'Myanmar', 'Thai'], capabilities: plannedCapabilities() }),
  'th-TH': locale({ id: 'th-TH', englishLabel: 'Thai (Thailand)', nativeLabel: 'ไทย (ประเทศไทย)', expectedScripts: ['Thai'], disallowedScripts: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Khmer', 'Lao', 'Myanmar', 'Tamil'], capabilities: plannedCapabilities() }),
  'vi-VN': locale({ id: 'vi-VN', englishLabel: 'Vietnamese (Vietnam)', nativeLabel: 'Tiếng Việt (Việt Nam)', expectedScripts: ['Latin'], disallowedScripts: latinDisallowed, capabilities: plannedCapabilities() }),
});

const market = ({ id, englishLabel, countryCode, currencyCode = null, status = MARKET_ROLLOUT_STATUSES.ENABLED, legacyNames = [], primaryLocaleIds = [], preferredRetrievalLanguages = [], retrievalLocations = [] }) => ({
  id,
  englishLabel,
  countryCode,
  currencyCode,
  status,
  legacyNames,
  retrievalGeography: countryCode ? { countryCode, location: englishLabel } : null,
  retrievalLocations: countryCode ? [...new Set([englishLabel, ...retrievalLocations])] : [],
  primaryLocaleIds,
  preferredRetrievalLanguages,
});

export const MARKET_CAPABILITIES = deepFreeze({
  GLOBAL: market({ id: 'GLOBAL', englishLabel: 'Global', countryCode: null, legacyNames: ['Global'] }),
  US: market({ id: 'US', englishLabel: 'United States', countryCode: 'US', currencyCode: 'USD', legacyNames: ['United States'], primaryLocaleIds: ['en-US'], preferredRetrievalLanguages: ['en'] }),
  GB: market({ id: 'GB', englishLabel: 'United Kingdom', countryCode: 'GB', currencyCode: 'GBP', legacyNames: ['United Kingdom'], preferredRetrievalLanguages: ['en'] }),
  CA: market({ id: 'CA', englishLabel: 'Canada', countryCode: 'CA', currencyCode: 'CAD', legacyNames: ['Canada'], preferredRetrievalLanguages: ['en', 'fr'] }),
  BR: market({ id: 'BR', englishLabel: 'Brazil', countryCode: 'BR', currencyCode: 'BRL', legacyNames: ['Brazil'], primaryLocaleIds: ['pt-BR'], preferredRetrievalLanguages: ['pt'] }),
  MX: market({ id: 'MX', englishLabel: 'Mexico', countryCode: 'MX', currencyCode: 'MXN', legacyNames: ['Mexico'], preferredRetrievalLanguages: ['es'] }),
  ES: market({ id: 'ES', englishLabel: 'Spain', countryCode: 'ES', currencyCode: 'EUR', legacyNames: ['Spain'], primaryLocaleIds: ['es-ES'], preferredRetrievalLanguages: ['es'] }),
  FR: market({ id: 'FR', englishLabel: 'France', countryCode: 'FR', currencyCode: 'EUR', legacyNames: ['France'], primaryLocaleIds: ['fr-FR'], preferredRetrievalLanguages: ['fr'] }),
  DE: market({ id: 'DE', englishLabel: 'Germany', countryCode: 'DE', currencyCode: 'EUR', legacyNames: ['Germany'], primaryLocaleIds: ['de-DE'], preferredRetrievalLanguages: ['de'] }),
  IN: market({ id: 'IN', englishLabel: 'India', countryCode: 'IN', currencyCode: 'INR', legacyNames: ['India'], primaryLocaleIds: ['hi-IN'], preferredRetrievalLanguages: ['hi', 'en'] }),
  CN: market({ id: 'CN', englishLabel: 'China', countryCode: 'CN', currencyCode: 'CNY', legacyNames: ['China'], primaryLocaleIds: ['zh-CN'], preferredRetrievalLanguages: ['zh'] }),
  JP: market({ id: 'JP', englishLabel: 'Japan', countryCode: 'JP', currencyCode: 'JPY', legacyNames: ['Japan'], primaryLocaleIds: ['ja-JP'], preferredRetrievalLanguages: ['ja'], retrievalLocations: ['Tokyo'] }),
  KR: market({ id: 'KR', englishLabel: 'South Korea', countryCode: 'KR', currencyCode: 'KRW', legacyNames: ['South Korea', 'Korea'], primaryLocaleIds: ['ko-KR'], preferredRetrievalLanguages: ['ko'] }),
  AU: market({ id: 'AU', englishLabel: 'Australia', countryCode: 'AU', currencyCode: 'AUD', legacyNames: ['Australia'], preferredRetrievalLanguages: ['en'] }),
  SA: market({ id: 'SA', englishLabel: 'Saudi Arabia', countryCode: 'SA', currencyCode: 'SAR', legacyNames: ['Saudi Arabia'], primaryLocaleIds: ['ar-SA'], preferredRetrievalLanguages: ['ar'] }),
  AE: market({ id: 'AE', englishLabel: 'United Arab Emirates', countryCode: 'AE', currencyCode: 'AED', legacyNames: ['United Arab Emirates'], preferredRetrievalLanguages: ['ar', 'en'] }),
  ZA: market({ id: 'ZA', englishLabel: 'South Africa', countryCode: 'ZA', currencyCode: 'ZAR', legacyNames: ['South Africa'], preferredRetrievalLanguages: ['en'] }),

  BN: market({ id: 'BN', englishLabel: 'Brunei', countryCode: 'BN', currencyCode: 'BND', status: MARKET_ROLLOUT_STATUSES.ROADMAP, legacyNames: ['Brunei', 'Brunei Darussalam'], primaryLocaleIds: ['ms-BN'], preferredRetrievalLanguages: ['ms', 'en'] }),
  KH: market({ id: 'KH', englishLabel: 'Cambodia', countryCode: 'KH', currencyCode: 'KHR', status: MARKET_ROLLOUT_STATUSES.ROADMAP, legacyNames: ['Cambodia'], primaryLocaleIds: ['km-KH'], preferredRetrievalLanguages: ['km', 'en'] }),
  ID: market({ id: 'ID', englishLabel: 'Indonesia', countryCode: 'ID', currencyCode: 'IDR', status: MARKET_ROLLOUT_STATUSES.PLANNED, legacyNames: ['Indonesia'], primaryLocaleIds: ['id-ID'], preferredRetrievalLanguages: ['id', 'en'] }),
  LA: market({ id: 'LA', englishLabel: 'Laos', countryCode: 'LA', currencyCode: 'LAK', status: MARKET_ROLLOUT_STATUSES.ROADMAP, legacyNames: ['Laos', 'Lao PDR'], primaryLocaleIds: ['lo-LA'], preferredRetrievalLanguages: ['lo', 'en'] }),
  MY: market({ id: 'MY', englishLabel: 'Malaysia', countryCode: 'MY', currencyCode: 'MYR', status: MARKET_ROLLOUT_STATUSES.PLANNED, legacyNames: ['Malaysia'], primaryLocaleIds: ['ms-MY', 'en-MY'], preferredRetrievalLanguages: ['ms', 'en'] }),
  MM: market({ id: 'MM', englishLabel: 'Myanmar', countryCode: 'MM', currencyCode: 'MMK', status: MARKET_ROLLOUT_STATUSES.ROADMAP, legacyNames: ['Myanmar', 'Burma'], primaryLocaleIds: ['my-MM'], preferredRetrievalLanguages: ['my', 'en'] }),
  PH: market({ id: 'PH', englishLabel: 'Philippines', countryCode: 'PH', currencyCode: 'PHP', status: MARKET_ROLLOUT_STATUSES.PLANNED, legacyNames: ['Philippines'], primaryLocaleIds: ['fil-PH', 'en-PH'], preferredRetrievalLanguages: ['fil', 'en'] }),
  SG: market({ id: 'SG', englishLabel: 'Singapore', countryCode: 'SG', currencyCode: 'SGD', legacyNames: ['Singapore'], primaryLocaleIds: ['en-SG', 'ms-SG', 'zh-Hans-SG', 'ta-SG'], preferredRetrievalLanguages: ['en', 'ms', 'zh', 'ta'] }),
  TH: market({ id: 'TH', englishLabel: 'Thailand', countryCode: 'TH', currencyCode: 'THB', status: MARKET_ROLLOUT_STATUSES.PLANNED, legacyNames: ['Thailand'], primaryLocaleIds: ['th-TH'], preferredRetrievalLanguages: ['th', 'en'] }),
  VN: market({ id: 'VN', englishLabel: 'Vietnam', countryCode: 'VN', currencyCode: 'VND', status: MARKET_ROLLOUT_STATUSES.PLANNED, legacyNames: ['Vietnam', 'Viet Nam'], primaryLocaleIds: ['vi-VN'], preferredRetrievalLanguages: ['vi', 'en'] }),
});

export function resolveMarketSupportMode({ marketId, marketStatus, fullyEnabledLocaleIds = [], outputEnabledLocaleIds = [] }) {
  if (marketId === 'GLOBAL') return MARKET_SUPPORT_MODES.GLOBAL_SCOPE;
  if (marketStatus !== MARKET_ROLLOUT_STATUSES.ENABLED) return MARKET_SUPPORT_MODES.PLANNED_OR_ROADMAP_MARKET;
  if (fullyEnabledLocaleIds.length > 0) return MARKET_SUPPORT_MODES.MARKET_AND_ONE_OR_MORE_LOCALES;
  if (outputEnabledLocaleIds.length > 0) return MARKET_SUPPORT_MODES.MARKET_AND_LOCALIZED_OUTPUT;
  return MARKET_SUPPORT_MODES.MARKET_ROUTING_ONLY;
}

export function marketLocaleSupport(entry) {
  const primaryLocaleIds = Array.isArray(entry?.primaryLocaleIds) ? entry.primaryLocaleIds : [];
  const capabilitiesFor = (localeId) => LOCALE_CAPABILITIES[localeId]?.capabilities || {};
  const capabilityStatuses = (localeId) => Object.values(capabilitiesFor(localeId));
  const enabledLocaleIds = primaryLocaleIds.filter((localeId) => capabilityStatuses(localeId).some(
    (status) => status === LOCALIZATION_CAPABILITY_STATUSES.ENABLED,
  ));
  const fullyEnabledLocaleIds = primaryLocaleIds.filter((localeId) => capabilityStatuses(localeId).length > 0 && capabilityStatuses(localeId).every(
    (status) => status === LOCALIZATION_CAPABILITY_STATUSES.ENABLED,
  ));
  const partialLocaleIds = enabledLocaleIds.filter((localeId) => !fullyEnabledLocaleIds.includes(localeId));
  const outputEnabledLocaleIds = primaryLocaleIds.filter((localeId) => {
    const capabilities = capabilitiesFor(localeId);
    return ['report', 'source', 'retrieval', 'instrument', 'sample'].every(
      (capability) => capabilities[capability] === LOCALIZATION_CAPABILITY_STATUSES.ENABLED,
    );
  });
  const plannedLocaleIds = primaryLocaleIds.filter((localeId) => capabilityStatuses(localeId).length > 0 && capabilityStatuses(localeId).every(
    (status) => status === LOCALIZATION_CAPABILITY_STATUSES.PLANNED,
  ));
  const supportMode = resolveMarketSupportMode({
    marketId: entry?.id,
    marketStatus: entry?.status,
    fullyEnabledLocaleIds,
    outputEnabledLocaleIds,
  });
  return deepFreeze({
    supportMode,
    enabledLocaleIds,
    fullyEnabledLocaleIds,
    partialLocaleIds,
    outputEnabledLocaleIds,
    plannedLocaleIds,
  });
}

const localeAliases = new Map();
for (const entry of Object.values(LOCALE_CAPABILITIES)) {
  for (const alias of entry.aliases) {
    const canonicalAlias = Intl.getCanonicalLocales(alias)[0];
    const existing = localeAliases.get(canonicalAlias);
    if (existing && existing !== entry.id) throw new TypeError(`Locale alias ${alias} is assigned more than once.`);
    localeAliases.set(canonicalAlias, entry.id);
  }
}

const normalizeMarketKey = (value) => String(value).normalize('NFKC').trim().toLocaleLowerCase('en-US');
const marketAliases = new Map();
for (const entry of Object.values(MARKET_CAPABILITIES)) {
  for (const alias of [entry.englishLabel, ...entry.legacyNames]) {
    const normalizedAlias = normalizeMarketKey(alias);
    const existing = marketAliases.get(normalizedAlias);
    if (existing && existing !== entry.id) throw new TypeError(`Market alias ${alias} is assigned more than once.`);
    marketAliases.set(normalizedAlias, entry.id);
  }
}

function requireKnownCapability(capability) {
  if (!LOCALIZATION_CAPABILITIES.includes(capability)) {
    throw new LocalizationCapabilityError(
      'UNKNOWN_CAPABILITY',
      `Unknown localization capability: ${String(capability)}.`,
      { capability },
    );
  }
}

export function canonicalizeLocale(value) {
  const requestedLocale = typeof value === 'string' ? value.trim() : '';
  let canonicalLocale;
  try {
    [canonicalLocale] = Intl.getCanonicalLocales(requestedLocale);
  } catch {
    throw new LocalizationCapabilityError(
      'INVALID_LOCALE',
      'Use a structurally valid BCP-47 locale.',
      { requestedLocale: value },
    );
  }
  if (!canonicalLocale) {
    throw new LocalizationCapabilityError(
      'INVALID_LOCALE',
      'Use a structurally valid BCP-47 locale.',
      { requestedLocale: value },
    );
  }
  return localeAliases.get(canonicalLocale) || canonicalLocale;
}

export function requireLocaleCapability(value, capability) {
  requireKnownCapability(capability);
  const canonicalLocale = canonicalizeLocale(value);
  const entry = LOCALE_CAPABILITIES[canonicalLocale];
  if (!entry) {
    throw new LocalizationCapabilityError(
      'UNKNOWN_LOCALE',
      `Locale ${canonicalLocale} is not registered.`,
      { requestedLocale: value, locale: canonicalLocale, capability },
    );
  }
  const status = entry.capabilities[capability];
  if (status !== LOCALIZATION_CAPABILITY_STATUSES.ENABLED) {
    throw new LocalizationCapabilityError(
      `UNSUPPORTED_${capability.toUpperCase()}_LOCALE`,
      `Locale ${canonicalLocale} is not enabled for ${capability}.`,
      { requestedLocale: value, locale: canonicalLocale, capability, status },
    );
  }
  return entry;
}

export function listLocalesForCapability(capability) {
  requireKnownCapability(capability);
  return Object.freeze(Object.values(LOCALE_CAPABILITIES).filter(
    (entry) => entry.capabilities[capability] === LOCALIZATION_CAPABILITY_STATUSES.ENABLED,
  ));
}

export function hasCompleteNativeReviewDeclaration(value, capability) {
  requireKnownCapability(capability);
  let entry;
  if (typeof value === 'string') {
    const canonicalLocale = canonicalizeLocale(value);
    entry = LOCALE_CAPABILITIES[canonicalLocale];
  } else {
    entry = value;
  }
  if (!entry || entry !== LOCALE_CAPABILITIES[entry.id]) return false;
  const nativeReview = entry.release.nativeReview;
  return entry.capabilities[capability] === LOCALIZATION_CAPABILITY_STATUSES.ENABLED
    && entry.release.copyStatus === LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED
    && nativeReview.status === LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED
    && nativeReview.statusByCapability[capability] === LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED
    && nativeReviewEvidenceComplete(nativeReview, capability);
}

// This dependency-free registry is shipped to browsers and cannot verify the
// signed packet bytes, reviewer key, expiry, or final-build bindings required
// for a release decision. Callers that need authoritative eligibility must use
// the server-side native-review evaluator. The shared/client projection is
// deliberately fail-closed even when registry declarations are complete.
export function isLocaleReleaseEligible(value, capability) {
  hasCompleteNativeReviewDeclaration(value, capability);
  return false;
}

const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const validIsoDate = (value) => {
  const candidate = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(candidate)) return false;
  const [year, month, day] = candidate.slice(0, 10).split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  return calendarDate === candidate.slice(0, 10) && !Number.isNaN(Date.parse(candidate));
};

function nativeReviewEvidenceComplete(nativeReview, capability) {
  if (!nativeReview || !Array.isArray(nativeReview.capabilityScope)
    || !nativeReview.capabilityScope.includes(capability)
    || !nonEmptyString(nativeReview.reviewer)
    || !validIsoDate(nativeReview.reviewedAt)
    || !nonEmptyString(nativeReview.glossaryVersion)
    || !nonEmptyString(nativeReview.reviewedProductVersion)
    || !nonEmptyString(nativeReview.reviewedPromptVersion)
    || !Array.isArray(nativeReview.findingsLog)
    || typeof nativeReview.blockingFindingsResolved !== 'boolean'
    || nativeReview.blockingFindingsResolved !== true) return false;
  return nativeReview.findingsLog.every((finding) => finding
    && typeof finding === 'object'
    && !Array.isArray(finding)
    && nonEmptyString(finding.id)
    && ['blocking', 'non-blocking'].includes(finding.severity)
    && ['open', 'resolved'].includes(finding.status)
    && nonEmptyString(finding.summary))
    && !nativeReview.findingsLog.some((finding) => finding.severity === 'blocking' && finding.status !== 'resolved');
}

export function isAttitudinalValidationEligible(entry) {
  if (!entry || entry.release?.attitudinalValidationStatus !== LOCALIZATION_RELEASE_STATUSES.VALIDATED) return false;
  const evidence = entry.release.attitudinalValidationEvidence;
  const scope = evidence?.calibrationScope;
  const fieldDates = scope?.fieldDates;
  let scopeLocale;
  try {
    scopeLocale = canonicalizeLocale(scope?.locale);
  } catch {
    return false;
  }
  const marketId = typeof scope?.marketId === 'string' ? scope.marketId.trim().toUpperCase() : '';
  const questionTypes = Array.isArray(scope?.questionTypes) ? scope.questionTypes : [];
  const fieldStart = Date.parse(fieldDates?.start);
  const fieldEnd = Date.parse(fieldDates?.end);
  return nonEmptyString(evidence?.comparisonId)
    && validIsoDate(evidence?.calibrationDate)
    && scope
    && scopeLocale === entry.id
    && marketId === entry.marketId
    && MARKET_CAPABILITIES[marketId]?.status === MARKET_ROLLOUT_STATUSES.ENABLED
    && nonEmptyString(scope.marketId)
    && nonEmptyString(scope.population)
    && nonEmptyString(scope.method)
    && questionTypes.length > 0
    && new Set(questionTypes).size === questionTypes.length
    && questionTypes.every(nonEmptyString)
    && nonEmptyString(scope.wording)
    && nonEmptyString(scope.scale)
    && fieldDates
    && validIsoDate(fieldDates.start)
    && validIsoDate(fieldDates.end)
    && fieldEnd >= fieldStart;
}

export function requireNativeReviewedLocale(value, capability) {
  const entry = requireLocaleCapability(value, capability);
  const status = entry.release.nativeReview.statusByCapability[capability];
  if (!isLocaleReleaseEligible(entry, capability)) {
    throw new LocalizationCapabilityError(
      'NATIVE_REVIEW_REQUIRED',
      `Locale ${entry.id} has not completed native review for ${capability}.`,
      { locale: entry.id, capability, status },
    );
  }
  return entry;
}

export function resolveMarket(value) {
  const requestedMarket = typeof value === 'string' ? value.trim() : '';
  const stableId = requestedMarket.toUpperCase();
  const marketId = MARKET_CAPABILITIES[stableId]
    ? stableId
    : marketAliases.get(normalizeMarketKey(requestedMarket));
  if (!marketId) {
    throw new LocalizationCapabilityError(
      'UNKNOWN_MARKET',
      `Market ${requestedMarket || '(empty)'} is not registered.`,
      { market: value },
    );
  }
  return MARKET_CAPABILITIES[marketId];
}

function invariant(condition, message) {
  if (!condition) throw new TypeError(`Invalid localization registry: ${message}`);
}

export function assertLocaleReleaseInvariants(entry) {
  const release = entry?.release;
  invariant(release && typeof release === 'object', `locale ${entry?.id || '(unknown)'} must declare release metadata.`);

  const nativeReview = release.nativeReview;
  invariant(nativeReview && typeof nativeReview === 'object', `locale ${entry?.id || '(unknown)'} must declare native-review metadata.`);
  const capabilityNames = [...LOCALIZATION_CAPABILITIES].sort();
  const capabilityStatuses = nativeReview.statusByCapability || {};
  invariant([LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING, LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED].includes(nativeReview.status), `locale ${entry.id} has an invalid native-review status.`);
  invariant(JSON.stringify(Object.keys(capabilityStatuses || {}).sort()) === JSON.stringify(capabilityNames), `locale ${entry.id} must declare review status for every capability.`);
  invariant(Object.values(capabilityStatuses || {}).every((status) => [LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING, LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED].includes(status)), `locale ${entry.id} has an invalid capability review status.`);

  const reviewedCapabilities = Object.entries(capabilityStatuses)
    .filter(([, status]) => status === LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED)
    .map(([capability]) => capability)
    .sort();
  const aggregateStatus = reviewedCapabilities.length === capabilityNames.length
    ? LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED
    : LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING;
  invariant(nativeReview.status === aggregateStatus, `locale ${entry.id} aggregate native-review status must equal the per-capability statuses.`);
  invariant(Array.isArray(nativeReview.capabilityScope), `locale ${entry.id} native review must declare a capability scope.`);
  invariant(JSON.stringify([...new Set(nativeReview.capabilityScope)].sort()) === JSON.stringify(nativeReview.capabilityScope.slice().sort()), `locale ${entry.id} native-review capability scope must be unique.`);
  invariant(nativeReview.capabilityScope.every((capability) => capabilityNames.includes(capability)), `locale ${entry.id} native-review capability scope contains an unknown capability.`);
  invariant(JSON.stringify(nativeReview.capabilityScope.slice().sort()) === JSON.stringify(reviewedCapabilities), `locale ${entry.id} native-review capability scope must match reviewed capabilities.`);
  invariant(Array.isArray(nativeReview.findingsLog), `locale ${entry.id} native review must declare a findings log.`);
  invariant(nativeReview.findingsLog.every((finding) => finding
    && typeof finding === 'object'
    && !Array.isArray(finding)
    && nonEmptyString(finding.id)
    && ['blocking', 'non-blocking'].includes(finding.severity)
    && ['open', 'resolved'].includes(finding.status)
    && nonEmptyString(finding.summary)), `locale ${entry.id} native-review findings must be structured.`);

  const claimsNativeReview = reviewedCapabilities.length > 0;
  if (claimsNativeReview) {
    invariant(nonEmptyString(nativeReview.reviewer), `locale ${entry.id} native review requires an attributed reviewer.`);
    invariant(validIsoDate(nativeReview.reviewedAt), `locale ${entry.id} native review requires a valid review date.`);
    invariant(nonEmptyString(nativeReview.glossaryVersion), `locale ${entry.id} native review requires a glossary version.`);
    invariant(nonEmptyString(nativeReview.reviewedProductVersion), `locale ${entry.id} native review requires a reviewed product version.`);
    invariant(nonEmptyString(nativeReview.reviewedPromptVersion), `locale ${entry.id} native review requires a reviewed prompt version.`);
    invariant(nativeReview.blockingFindingsResolved === true, `locale ${entry.id} native review requires confirmation that blocking findings are resolved.`);
    invariant(!nativeReview.findingsLog.some((finding) => finding.severity === 'blocking' && finding.status !== 'resolved'), `locale ${entry.id} native review cannot leave blocking findings open.`);
  } else {
    invariant(nativeReview.reviewer === null && nativeReview.reviewedAt === null && nativeReview.glossaryVersion === null, `locale ${entry.id} pending review must not imply reviewer evidence.`);
    invariant(nativeReview.reviewedProductVersion === null && nativeReview.reviewedPromptVersion === null, `locale ${entry.id} pending review must not imply reviewed versions.`);
    invariant(nativeReview.blockingFindingsResolved === false, `locale ${entry.id} pending review must not confirm resolved blockers.`);
    invariant(nativeReview.findingsLog.length === 0, `locale ${entry.id} pending review must not imply findings.`);
  }

  invariant([LOCALIZATION_RELEASE_STATUSES.UNSUPPORTED, LOCALIZATION_RELEASE_STATUSES.VALIDATED].includes(release.attitudinalValidationStatus), `locale ${entry.id} has an invalid attitudinal-validation status.`);
  if (release.attitudinalValidationStatus === LOCALIZATION_RELEASE_STATUSES.VALIDATED) {
    invariant(isAttitudinalValidationEligible(entry), `locale ${entry.id} validated attitudinal status requires structured held-out validation evidence.`);
  } else {
    invariant(release.attitudinalValidationEvidence === null, `locale ${entry.id} unsupported attitudinal status must not imply validation evidence.`);
  }
  return true;
}

function isDeeplyFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(value).every((child) => isDeeplyFrozen(child, seen));
}

export function assertLocalizationRegistryInvariants() {
  invariant(LOCALIZATION_REGISTRY_VERSION === 'localization-capabilities-v2', 'registry version must change deliberately.');
  invariant(isDeeplyFrozen(LOCALIZATION_CAPABILITIES), 'capability names must be deeply frozen.');
  invariant(isDeeplyFrozen(LOCALIZATION_CAPABILITY_STATUSES), 'capability statuses must be deeply frozen.');
  invariant(isDeeplyFrozen(LOCALIZATION_RELEASE_STATUSES), 'release statuses must be deeply frozen.');
  invariant(isDeeplyFrozen(MARKET_ROLLOUT_STATUSES), 'market rollout statuses must be deeply frozen.');
  invariant(isDeeplyFrozen(MARKET_SUPPORT_MODES), 'market support modes must be deeply frozen.');
  invariant(isDeeplyFrozen(LOCALE_CAPABILITIES), 'locale records must be deeply frozen.');
  invariant(isDeeplyFrozen(MARKET_CAPABILITIES), 'market records must be deeply frozen.');

  const allowedStatuses = new Set(Object.values(LOCALIZATION_CAPABILITY_STATUSES));
  const allowedRolloutStatuses = new Set(Object.values(MARKET_ROLLOUT_STATUSES));
  const capabilityNames = [...LOCALIZATION_CAPABILITIES].sort();
  for (const [id, entry] of Object.entries(LOCALE_CAPABILITIES)) {
    invariant(entry.id === id, `locale key ${id} must match its ID.`);
    invariant(Intl.getCanonicalLocales(id)[0] === id, `locale ${id} must be canonical BCP-47.`);
    invariant(['ltr', 'rtl'].includes(entry.dir), `locale ${id} must declare text direction.`);
    invariant(Intl.getCanonicalLocales(entry.htmlLang)[0] === entry.htmlLang, `locale ${id} must declare a canonical htmlLang.`);
    invariant(canonicalizeLocale(entry.htmlLang) === id, `locale ${id} htmlLang must resolve back to the locale record.`);
    invariant(Array.isArray(entry.scriptPolicy.expected) && entry.scriptPolicy.expected.length > 0, `locale ${id} must declare expected scripts.`);
    invariant(entry.scriptPolicy.expected.every((script) => !entry.scriptPolicy.disallowed.includes(script)), `locale ${id} script policy must not both expect and disallow a script.`);
    invariant(JSON.stringify(Object.keys(entry.capabilities).sort()) === JSON.stringify(capabilityNames), `locale ${id} must declare every capability exactly once.`);
    invariant(Object.values(entry.capabilities).every((status) => allowedStatuses.has(status)), `locale ${id} has an unknown capability status.`);
    invariant([LOCALIZATION_RELEASE_STATUSES.UNSUPPORTED, LOCALIZATION_RELEASE_STATUSES.MACHINE_DRAFTED, LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED].includes(entry.release.copyStatus), `locale ${id} has an invalid copy status.`);
    if (entry.release.copyStatus === LOCALIZATION_RELEASE_STATUSES.UNSUPPORTED) {
      invariant(Object.values(entry.capabilities).every((status) => status !== LOCALIZATION_CAPABILITY_STATUSES.ENABLED), `locale ${id} unsupported copy cannot expose an enabled capability.`);
      invariant(entry.release.nativeReview.status === LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING, `locale ${id} unsupported copy cannot imply native review.`);
    }
    if (entry.release.copyStatus === LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED) {
      invariant(entry.release.nativeReview.status === LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED, `locale ${id} native-reviewed copy requires native-review status.`);
    }
    if (entry.release.nativeReview.status === LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED) {
      invariant(entry.release.copyStatus === LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED, `locale ${id} native-review status requires native-reviewed copy.`);
    }
    invariant([LOCALIZATION_RELEASE_STATUSES.UNMEASURED, LOCALIZATION_RELEASE_STATUSES.PARTIAL, LOCALIZATION_RELEASE_STATUSES.READY].includes(entry.release.populationEvidenceStatus), `locale ${id} has an invalid population-evidence status.`);
    invariant(assertLocaleReleaseInvariants(entry), `locale ${id} release metadata is inconsistent.`);
  }

  for (const id of CJK_LOCALE_IDS) {
    invariant(LOCALE_CAPABILITIES[id], `CJK locale ${id} is required.`);
    invariant(Object.values(LOCALE_CAPABILITIES[id].capabilities).every((status) => status === LOCALIZATION_CAPABILITY_STATUSES.ENABLED), `CJK locale ${id} must be enabled.`);
  }
  for (const id of ASEAN_LANGUAGE_LOCALE_IDS) {
    invariant(LOCALE_CAPABILITIES[id], `ASEAN locale ${id} is required.`);
    invariant(Object.values(LOCALE_CAPABILITIES[id].capabilities).every((status) => status === LOCALIZATION_CAPABILITY_STATUSES.PLANNED), `ASEAN locale ${id} must remain planned until separately enabled.`);
    invariant(LOCALE_CAPABILITIES[id].release.copyStatus === LOCALIZATION_RELEASE_STATUSES.UNSUPPORTED, `ASEAN locale ${id} must not imply drafted copy before its catalog exists.`);
  }

  for (const [id, entry] of Object.entries(MARKET_CAPABILITIES)) {
    invariant(entry.id === id, `market key ${id} must match its ID.`);
    invariant(allowedRolloutStatuses.has(entry.status), `market ${id} has an unknown rollout status.`);
    if (id === 'GLOBAL') {
      invariant(entry.countryCode === null && entry.currencyCode === null && entry.retrievalGeography === null && entry.retrievalLocations.length === 0, 'Global must not imply retrieval geography, locations, or currency.');
    } else {
      invariant(/^[A-Z]{2}$/.test(entry.countryCode), `market ${id} must declare a two-letter country code.`);
      invariant(/^[A-Z]{3}$/.test(entry.currencyCode), `market ${id} must declare a three-letter currency code.`);
      invariant(entry.retrievalGeography?.countryCode === entry.countryCode, `market ${id} retrieval geography must match its country.`);
      invariant(typeof entry.retrievalGeography?.location === 'string' && entry.retrievalGeography.location.length > 0, `market ${id} must declare a retrieval location.`);
      invariant(entry.retrievalLocations.includes(entry.retrievalGeography.location), `market ${id} retrieval locations must include its default location.`);
      invariant(entry.retrievalLocations.every((location) => typeof location === 'string' && location.trim() === location && location.length > 0 && location.length <= 120), `market ${id} retrieval locations must be bounded non-empty strings.`);
      invariant(new Set(entry.retrievalLocations.map(normalizeMarketKey)).size === entry.retrievalLocations.length, `market ${id} retrieval locations must be unique.`);
    }
    invariant(new Set(entry.legacyNames.map(normalizeMarketKey)).size === entry.legacyNames.length, `market ${id} legacy names must be unique.`);
    invariant(new Set(entry.primaryLocaleIds).size === entry.primaryLocaleIds.length, `market ${id} primary locales must be unique.`);
    invariant(entry.primaryLocaleIds.every((localeId) => LOCALE_CAPABILITIES[localeId]?.marketId === id), `market ${id} primary locales must resolve to the same market.`);
    invariant(new Set(entry.preferredRetrievalLanguages).size === entry.preferredRetrievalLanguages.length, `market ${id} retrieval languages must be unique.`);
    invariant(entry.preferredRetrievalLanguages.every((language) => Intl.getCanonicalLocales(language)[0] === language && !language.includes('-')), `market ${id} retrieval preferences must use neutral language tags, not another market's regional locale.`);
  }
  for (const id of ASEAN_MARKET_IDS) invariant(MARKET_CAPABILITIES[id], `ASEAN market ${id} is required.`);
  for (const id of ['ID', 'MY', 'PH', 'TH', 'VN']) invariant(MARKET_CAPABILITIES[id].status === MARKET_ROLLOUT_STATUSES.PLANNED, `ASEAN launch market ${id} must remain planned.`);
  for (const id of ['BN', 'KH', 'LA', 'MM']) invariant(MARKET_CAPABILITIES[id].status === MARKET_ROLLOUT_STATUSES.ROADMAP, `ASEAN market ${id} must remain roadmap-only.`);
  return true;
}

assertLocalizationRegistryInvariants();
