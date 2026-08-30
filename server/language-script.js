import {
  LOCALE_CAPABILITIES,
  LocalizationCapabilityError,
  canonicalizeLocale,
} from '../shared/localization.mjs';

const SCRIPT_PATTERNS = Object.freeze({
  Arabic: /\p{Script=Arabic}/u,
  Devanagari: /\p{Script=Devanagari}/u,
  Han: /\p{Script=Han}/u,
  Hiragana: /\p{Script=Hiragana}/u,
  Katakana: /\p{Script=Katakana}/u,
  Hangul: /\p{Script=Hangul}/u,
  Khmer: /\p{Script=Khmer}/u,
  Lao: /\p{Script=Lao}/u,
  Latin: /\p{Script=Latin}/u,
  Myanmar: /\p{Script=Myanmar}/u,
  Tamil: /\p{Script=Tamil}/u,
  Thai: /\p{Script=Thai}/u,
});

function scriptPolicyFor(locale) {
  let canonicalLocale;
  try {
    canonicalLocale = canonicalizeLocale(locale);
  } catch (error) {
    if (error instanceof LocalizationCapabilityError) return null;
    throw error;
  }
  const exact = LOCALE_CAPABILITIES[canonicalLocale];
  if (exact) return exact.scriptPolicy;

  // Script validation may receive a syntactically valid regional locale from an
  // imported artifact. Reuse a registered policy only when every record for the
  // same language agrees; otherwise fail open as unchecked rather than guessing.
  const language = canonicalLocale.split('-')[0];
  const candidates = Object.values(LOCALE_CAPABILITIES)
    .filter((entry) => entry.id.split('-')[0] === language)
    .map((entry) => entry.scriptPolicy);
  if (!candidates.length) return null;
  const signature = JSON.stringify(candidates[0]);
  return candidates.every((candidate) => JSON.stringify(candidate) === signature)
    ? candidates[0]
    : null;
}

function pathMatches(pattern, path) {
  return Array.isArray(pattern)
    && pattern.length === path.length
    && pattern.every((part, index) => part === '*' || part === path[index]);
}

function exactValueIsExempt(value, path, exemptions) {
  return exemptions.some((exemption) => exemption?.value === value && pathMatches(exemption.path, path));
}

function naturalLanguageText(value, exemptions = [], path = []) {
  if (typeof value === 'string') return exactValueIsExempt(value, path, exemptions) ? '' : value;
  if (Array.isArray(value)) return value.map((child, index) => naturalLanguageText(child, exemptions, [...path, index])).join(' ');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value).map(([key, child]) => naturalLanguageText(child, exemptions, [...path, key])).join(' ');
}

export function languageScriptReport(value, locale, options = {}) {
  const rule = scriptPolicyFor(locale);
  if (!rule) return { checked: false, expectedScripts: [], hasExpectedScript: null, unexpectedScripts: [], pass: true };
  const exemptions = Array.isArray(options?.exactValueExemptions) ? options.exactValueExemptions : [];
  const text = naturalLanguageText(value, exemptions);
  const unexpectedScripts = rule.disallowed.filter((script) => SCRIPT_PATTERNS[script].test(text));
  const hasExpectedScript = rule.expected.some((script) => SCRIPT_PATTERNS[script].test(text));
  return { checked: true, expectedScripts: rule.expected, hasExpectedScript, unexpectedScripts, pass: hasExpectedScript && unexpectedScripts.length === 0 };
}
