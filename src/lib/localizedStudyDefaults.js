const DEFAULTS_BY_LOCALE = Object.freeze({
  'en-US': Object.freeze({ priceUnit: 'per month' }),
  'es-ES': Object.freeze({ priceUnit: 'al mes' }),
  'pt-BR': Object.freeze({ priceUnit: 'por mês' }),
  'fr-FR': Object.freeze({ priceUnit: 'par mois' }),
  'de-DE': Object.freeze({ priceUnit: 'pro Monat' }),
  'zh-CN': Object.freeze({ priceUnit: '每月' }),
  'ja-JP': Object.freeze({ priceUnit: '月額' }),
  'ko-KR': Object.freeze({ priceUnit: '월' }),
  'ar-SA': Object.freeze({ priceUnit: 'شهرياً' }),
  'hi-IN': Object.freeze({ priceUnit: 'प्रति माह' }),
});

export function localizedStudyDefaults(locale) {
  return DEFAULTS_BY_LOCALE[locale] || DEFAULTS_BY_LOCALE['en-US'];
}

export const localizedStudyDefaultLocales = Object.freeze(Object.keys(DEFAULTS_BY_LOCALE));
