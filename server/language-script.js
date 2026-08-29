const SCRIPT_PATTERNS = Object.freeze({
  Arabic: /\p{Script=Arabic}/u,
  Devanagari: /\p{Script=Devanagari}/u,
  Han: /\p{Script=Han}/u,
  Hiragana: /\p{Script=Hiragana}/u,
  Katakana: /\p{Script=Katakana}/u,
  Hangul: /\p{Script=Hangul}/u,
  Latin: /\p{Script=Latin}/u,
});

const LANGUAGE_RULES = Object.freeze({
  en: { expected: ['Latin'], disallowed: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul'] },
  es: { expected: ['Latin'], disallowed: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul'] },
  pt: { expected: ['Latin'], disallowed: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul'] },
  fr: { expected: ['Latin'], disallowed: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul'] },
  de: { expected: ['Latin'], disallowed: ['Arabic', 'Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul'] },
  ar: { expected: ['Arabic'], disallowed: ['Devanagari', 'Han', 'Hiragana', 'Katakana', 'Hangul'] },
  hi: { expected: ['Devanagari'], disallowed: ['Arabic', 'Han', 'Hiragana', 'Katakana', 'Hangul'] },
  ja: { expected: ['Han', 'Hiragana', 'Katakana'], disallowed: ['Arabic', 'Devanagari', 'Hangul'] },
  zh: { expected: ['Han'], disallowed: ['Arabic', 'Devanagari', 'Hiragana', 'Katakana', 'Hangul'] },
  ko: { expected: ['Hangul'], disallowed: ['Arabic', 'Devanagari', 'Hiragana', 'Katakana'] },
});

function naturalLanguageText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(naturalLanguageText).join(' ');
  if (!value || typeof value !== 'object') return '';
  return Object.values(value).map(naturalLanguageText).join(' ');
}

export function languageScriptReport(value, locale) {
  const language = String(locale || '').toLowerCase().split('-')[0];
  const rule = LANGUAGE_RULES[language];
  if (!rule) return { checked: false, expectedScripts: [], hasExpectedScript: null, unexpectedScripts: [], pass: true };
  const text = naturalLanguageText(value);
  const unexpectedScripts = rule.disallowed.filter((script) => SCRIPT_PATTERNS[script].test(text));
  const hasExpectedScript = rule.expected.some((script) => SCRIPT_PATTERNS[script].test(text));
  return { checked: true, expectedScripts: rule.expected, hasExpectedScript, unexpectedScripts, pass: hasExpectedScript && unexpectedScripts.length === 0 };
}
