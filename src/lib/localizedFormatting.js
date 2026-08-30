import { requireLocaleCapability } from '../../shared/localization.mjs';

function displayLocale(locale) {
  return requireLocaleCapability(locale, 'ui').id;
}

function finiteNumber(value, label) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}

export function formatLocalizedNumber(value, locale, options = {}) {
  return new Intl.NumberFormat(displayLocale(locale), options).format(finiteNumber(value, 'Number'));
}

export function formatPercentagePoints(value, locale, options = {}) {
  const percentagePoints = finiteNumber(value, 'Percentage points');
  return new Intl.NumberFormat(displayLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 1,
    ...options,
  }).format(percentagePoints / 100);
}

export function formatLocalizedCurrency(value, currency, locale, options = {}) {
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency.trim())) {
    throw new TypeError('Currency must be a three-letter ISO 4217 code.');
  }
  return new Intl.NumberFormat(displayLocale(locale), {
    style: 'currency',
    currency: currency.trim().toUpperCase(),
    maximumFractionDigits: 2,
    ...options,
  }).format(finiteNumber(value, 'Currency value'));
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Date value must be a valid Date or ISO date string.');
  return date;
}

export function formatLocalizedDate(value, locale, options = {}) {
  return new Intl.DateTimeFormat(displayLocale(locale), {
    dateStyle: 'medium',
    timeZone: 'UTC',
    ...options,
  }).format(validDate(value));
}

export function formatLocalizedDateTime(value, locale, options = {}) {
  return new Intl.DateTimeFormat(displayLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
    ...options,
  }).format(validDate(value));
}

export function formatLocalizedList(values, locale, options = {}) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new TypeError('Localized lists require an array of strings.');
  }
  return new Intl.ListFormat(displayLocale(locale), { style: 'long', type: 'conjunction', ...options }).format(values);
}

export function localizedPluralCategory(value, locale, options = {}) {
  return new Intl.PluralRules(displayLocale(locale), options).select(finiteNumber(value, 'Plural value'));
}
