import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatLocalizedCurrency,
  formatLocalizedDate,
  formatLocalizedDateTime,
  formatLocalizedList,
  formatLocalizedNumber,
  formatPercentagePoints,
  localizedPluralCategory,
} from '../src/lib/localizedFormatting.js';

test('CJK display formatting uses the selected locale without changing canonical machine values', () => {
  const iso = '2026-08-29T12:34:56.000Z';
  for (const locale of ['zh-CN', 'ja-JP', 'ko-KR']) {
    assert.equal(formatLocalizedNumber(1234567.5, locale), new Intl.NumberFormat(locale).format(1234567.5));
    assert.equal(formatPercentagePoints(27.5, locale), new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(0.275));
    assert.equal(formatLocalizedDate(iso, locale), new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso)));
    assert.equal(formatLocalizedDateTime(iso, locale), new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)));
    assert.equal(formatLocalizedList(['A', 'B', 'C'], locale), new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(['A', 'B', 'C']));
    assert.equal(typeof localizedPluralCategory(2, locale), 'string');
  }
  assert.equal(iso, '2026-08-29T12:34:56.000Z');
  assert.match(formatLocalizedCurrency(1234.5, 'JPY', 'ja-JP'), /1,235|1,234\.5/);
});

test('display formatters fail closed for planned locales and malformed values', () => {
  assert.throws(() => formatLocalizedNumber(12, 'id-ID'), /not enabled for ui/i);
  assert.throws(() => formatPercentagePoints(Number.NaN, 'ja-JP'), /finite number/i);
  assert.throws(() => formatLocalizedCurrency(1, 'US', 'en-US'), /three-letter/i);
  assert.throws(() => formatLocalizedDate('not-a-date', 'ko-KR'), /valid Date/i);
  assert.throws(() => formatLocalizedList(['valid', 2], 'zh-CN'), /array of strings/i);
});
