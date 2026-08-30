import {
  LOCALE_CAPABILITIES,
  MARKET_CAPABILITIES,
  MARKET_ROLLOUT_STATUSES,
  listLocalesForCapability,
  marketLocaleSupport,
} from '../../shared/localization.mjs';

const optionsForCapability = (capability) => Object.freeze(listLocalesForCapability(capability).map((entry) => Object.freeze({
  value: entry.id,
  label: entry.englishLabel,
  nativeLabel: entry.nativeLabel,
  dir: entry.dir,
  htmlLang: entry.htmlLang,
  capability,
  runtimeStatus: entry.capabilities[capability],
  copyStatus: entry.release.copyStatus,
  // These are declarations only. A registry declaration is intentionally not
  // release evidence; server scorecards remain the authority for eligibility.
  nativeReviewStatus: entry.release.nativeReview.statusByCapability[capability],
  releaseEligible: false,
})));

// Interface, report, and source selectors each consult their own capability
// slice. This prevents a planned locale from becoming selectable by accident.
export const languageOptions = optionsForCapability('ui');
export const reportLanguageOptions = optionsForCapability('report');
export const sourceLanguageOptions = optionsForCapability('source');
export const retrievalLanguageOptions = optionsForCapability('retrieval');
export const instrumentLanguageOptions = optionsForCapability('instrument');

// Keep the legacy display value because persisted studies and the API accept
// market labels, but derive every selectable entry from the shared registry.
// In particular, Global must never acquire a US search geography by default.
export const studyMarketOptions = Object.freeze(Object.values(MARKET_CAPABILITIES)
  .filter((market) => market.status === MARKET_ROLLOUT_STATUSES.ENABLED)
  .map((market) => {
    const support = marketLocaleSupport(market);
    const localeLabels = (localeIds) => Object.freeze(localeIds.map(
      (localeId) => LOCALE_CAPABILITIES[localeId]?.nativeLabel || localeId,
    ));
    return Object.freeze({
      id: market.id,
      value: market.englishLabel,
      region: market.countryCode,
      currencyCode: market.currencyCode,
      searchCountry: market.retrievalGeography?.countryCode || null,
      searchLocation: market.retrievalGeography?.location || '',
      status: market.status,
      supportMode: support.supportMode,
      primaryLocaleIds: Object.freeze([...market.primaryLocaleIds]),
      enabledLocaleIds: Object.freeze([...support.enabledLocaleIds]),
      fullyEnabledLocaleIds: Object.freeze([...support.fullyEnabledLocaleIds]),
      partialLocaleIds: Object.freeze([...support.partialLocaleIds]),
      outputEnabledLocaleIds: Object.freeze([...support.outputEnabledLocaleIds]),
      plannedLocaleIds: Object.freeze([...support.plannedLocaleIds]),
      primaryLocaleLabels: localeLabels(market.primaryLocaleIds),
      outputEnabledLocaleLabels: localeLabels(support.outputEnabledLocaleIds),
      plannedLocaleLabels: localeLabels(support.plannedLocaleIds),
      outputEnabledLocales: Object.freeze(support.outputEnabledLocaleIds.map((localeId) => {
        const entry = LOCALE_CAPABILITIES[localeId];
        return Object.freeze({
          value: entry.id,
          nativeLabel: entry.nativeLabel,
          htmlLang: entry.htmlLang,
        });
      })),
      plannedLocales: Object.freeze(support.plannedLocaleIds.map((localeId) => {
        const entry = LOCALE_CAPABILITIES[localeId];
        return Object.freeze({
          value: entry.id,
          nativeLabel: entry.nativeLabel,
          htmlLang: entry.htmlLang,
        });
      })),
      preferredRetrievalLanguages: Object.freeze([...market.preferredRetrievalLanguages]),
    });
  }));
