import { LOCALE_CAPABILITIES } from '../../shared/localization.mjs';

export const DEFAULT_INTERFACE_LOCALE = 'en-US';

const registeredLocaleAliases = new Map();
for (const entry of Object.values(LOCALE_CAPABILITIES)) {
  for (const alias of entry.aliases) {
    const [canonicalAlias] = Intl.getCanonicalLocales(alias);
    registeredLocaleAliases.set(canonicalAlias.toLowerCase(), entry.id);
  }
}

function supportedLocaleLookup(supportedLocales) {
  if (!Array.isArray(supportedLocales)) return new Map();
  return new Map(supportedLocales
    .filter((locale) => typeof locale === 'string' && locale.trim())
    .map((locale) => [locale.toLowerCase(), locale]));
}

function exactSupportedLocale(candidate, lookup) {
  if (typeof candidate !== 'string') return null;
  return lookup.get(candidate.trim().toLowerCase()) || null;
}

function aliasedSupportedLocale(candidate, lookup) {
  if (typeof candidate !== 'string') return null;
  let canonicalCandidate;
  try {
    [canonicalCandidate] = Intl.getCanonicalLocales(candidate.trim());
  } catch {
    return null;
  }
  const registeredLocale = registeredLocaleAliases.get(canonicalCandidate?.toLowerCase());
  return registeredLocale ? lookup.get(registeredLocale.toLowerCase()) || null : null;
}

function supportedLocale(candidate, lookup) {
  return exactSupportedLocale(candidate, lookup) || aliasedSupportedLocale(candidate, lookup);
}

export function removeConsumedInterfaceLocale({ search = '' } = {}) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  if (!params.has('uiLocale')) return typeof search === 'string' ? search : '';
  params.delete('uiLocale');
  const remaining = params.toString();
  return remaining ? `?${remaining}` : '';
}

export function setInterfaceLocaleInSearch({ search = '', locale } = {}) {
  if (typeof locale !== 'string' || !locale.trim()) {
    throw new TypeError('A non-empty interface locale is required.');
  }
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  params.set('uiLocale', locale.trim());
  return `?${params.toString()}`;
}

export function matchSupportedLocale(candidate, supportedLocales = []) {
  return supportedLocale(candidate, supportedLocaleLookup(supportedLocales));
}

/**
 * Resolve a locale preference against an explicit support list without
 * inferring one region from another.
 * `zh-TW`, for example, must never silently become `zh-CN` merely because
 * both tags begin with `zh`.
 */
export function resolveInterfaceLocalePreference({
  requestedLocale,
  savedLocale,
  browserLocales = [],
  supportedLocales = [],
  fallbackLocale = DEFAULT_INTERFACE_LOCALE,
} = {}) {
  const lookup = supportedLocaleLookup(supportedLocales);
  const supportedFallback = exactSupportedLocale(fallbackLocale, lookup);
  if (!supportedFallback) throw new TypeError('The interface-locale fallback must be explicitly supported.');

  const requested = supportedLocale(requestedLocale, lookup);
  if (requested) return { locale: requested, source: 'requested' };

  const saved = supportedLocale(savedLocale, lookup);
  if (saved) return { locale: saved, source: 'saved' };

  for (const candidate of Array.isArray(browserLocales) ? browserLocales : []) {
    const supported = supportedLocale(candidate, lookup);
    if (supported) return { locale: supported, source: 'browser' };
  }
  return { locale: supportedFallback, source: 'fallback' };
}

export function resolveSupportedLocalePreference(options = {}) {
  return resolveInterfaceLocalePreference(options).locale;
}

export function resolveInterfaceLocale(options = {}) {
  return resolveSupportedLocalePreference(options);
}
