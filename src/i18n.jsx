import { createContext, useContext, useMemo } from 'react';
import {
  createUiCatalog,
  getLanguageName,
  instrumentLanguageOptions,
  languageOptions,
  reportLanguageOptions,
  retrievalLanguageOptions,
  resolveUiMessage,
  sourceLanguageOptions,
} from './i18nCatalog.mjs';

export {
  getLanguageName,
  instrumentLanguageOptions,
  languageOptions,
  reportLanguageOptions,
  retrievalLanguageOptions,
  sourceLanguageOptions,
};

const defaultCatalog = createUiCatalog('en-US');
const I18nContext = createContext({ locale: 'en-US', htmlLang: 'en-US', dir: 'ltr', t: (key, variables) => resolveUiMessage(defaultCatalog, key, variables) });

export function I18nProvider({ locale, children }) {
  const value = useMemo(() => {
    const option = languageOptions.find((item) => item.value === locale) || languageOptions[0];
    const dictionary = createUiCatalog(option.value);
    return {
      locale: option.value,
      htmlLang: option.htmlLang,
      dir: option.dir,
      t: (key, variables) => resolveUiMessage(dictionary, key, variables, option.value),
    };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
