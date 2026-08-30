import { normalizeLocalizationRequest } from '../../server/localization-request.js';

const canonicalInputFromReceipt = (receipt) => ({
  schemaVersion: receipt.schemaVersion,
  marketId: receipt.market.id,
  ...(receipt.market.countryCode && receipt.market.searchLocation !== receipt.market.label
    ? { searchLocation: receipt.market.searchLocation }
    : {}),
  reportLocale: receipt.report.locale,
  sourceLocales: [...receipt.source.locales],
  retrieval: {
    policy: receipt.retrieval.policy,
    locales: [...receipt.retrieval.locales],
  },
  instrumentLocale: receipt.instrument.locale,
});

function localizationDraft(study = {}) {
  const sourceLocales = Array.isArray(study.sourceLanguages) ? [...study.sourceLanguages] : [];
  const hasExplicitRetrieval = Object.hasOwn(study, 'retrievalPolicy');
  const policy = hasExplicitRetrieval
    ? String(study.retrievalPolicy || '').toUpperCase()
    : sourceLocales.length ? 'PREFER' : 'ANY';
  const configuredRetrievalLocales = Array.isArray(study.retrievalLocales)
    ? [...study.retrievalLocales]
    : [...sourceLocales];

  return {
    reportLocale: study.outputLocale,
    sourceLocales,
    retrieval: {
      policy,
      locales: policy === 'ANY' ? [] : configuredRetrievalLocales,
    },
    instrumentLocale: study.instrumentLocale || study.outputLocale,
  };
}

/** Adds explicit UI state to legacy locally persisted studies. */
export function normalizeStudyLocalizationState(study = {}, fallbackLocale = 'en-US') {
  const sourceLanguages = Array.isArray(study.sourceLanguages) ? [...study.sourceLanguages] : [];
  const outputLocale = study.outputLocale || fallbackLocale;
  const hasRetrievalPolicy = Object.hasOwn(study, 'retrievalPolicy');
  return {
    ...study,
    outputLocale,
    sourceLanguages,
    retrievalPolicy: hasRetrievalPolicy
      ? String(study.retrievalPolicy || '').toUpperCase()
      : sourceLanguages.length ? 'PREFER' : 'ANY',
    retrievalLocales: Object.hasOwn(study, 'retrievalLocales') && Array.isArray(study.retrievalLocales)
      ? [...study.retrievalLocales]
      : [...sourceLanguages],
    // Empty means “follow report” in UI state; the canonical request always
    // receives the resolved concrete locale.
    instrumentLocale: Object.hasOwn(study, 'instrumentLocale') ? (study.instrumentLocale || '') : '',
  };
}

/**
 * Builds and re-validates the exact localization contract sent by the web UI.
 * Legacy aliases are included only as compatibility fields and must resolve to
 * the same values, so the browser cannot silently diverge from the API/MCP path.
 */
export function prepareStudyLocalization(study, marketOption, evidencePolicy = 'AUTO') {
  if (!marketOption?.id || !marketOption?.value) {
    throw new TypeError('The selected market is not enabled for study execution.');
  }
  const draft = localizationDraft(study);
  const restoredMarket = study.localizationReceipt?.market;
  const restoredLocation = restoredMarket?.id === marketOption.id
    && restoredMarket?.kind === 'registered'
    && restoredMarket?.countryCode === (marketOption.searchCountry || null)
    && typeof restoredMarket.searchLocation === 'string'
    && restoredMarket.searchLocation.trim().length > 0
    && restoredMarket.searchLocation.trim().length <= 120
    ? restoredMarket.searchLocation.trim()
    : null;
  const searchLocation = restoredLocation || marketOption.searchLocation || '';
  const localization = {
    schemaVersion: 'study-localization-v1',
    marketId: marketOption.id,
    ...(searchLocation !== (marketOption.searchLocation || '') ? { searchLocation } : {}),
    ...draft,
  };
  const aliases = {
    market: marketOption.value,
    outputLocale: draft.reportLocale,
    sourceLanguages: [...draft.sourceLocales],
    ...(marketOption.searchCountry ? { searchCountry: marketOption.searchCountry } : {}),
    searchLocation,
  };
  const receipt = normalizeLocalizationRequest({
    localization,
    ...aliases,
    evidencePolicy,
  });

  return Object.freeze({
    localization: Object.freeze(canonicalInputFromReceipt(receipt)),
    aliases: Object.freeze(aliases),
    receipt,
  });
}

export const studyLocalization = Object.freeze({ normalizeStudyLocalizationState, prepareStudyLocalization });
