import assert from 'node:assert/strict';
import test from 'node:test';
import { getLanguageName } from '../src/i18nCatalog.mjs';
import { formatDisplayDate } from '../src/lib/displayDates.js';

test('CJK presentation names generic source-language tags in the UI locale', () => {
  for (const [locale, language] of [['zh-CN', 'en'], ['ja-JP', 'ja'], ['ko-KR', 'ko']]) {
    const expected = new Intl.DisplayNames([locale], { type: 'language' }).of(language);
    assert.equal(getLanguageName(language, locale), expected);
  }
});

test('display dates fail closed to the localized not-recorded status', () => {
  for (const [locale, fallback] of [['zh-CN', '未记录'], ['ja-JP', '未記録'], ['ko-KR', '기록되지 않음']]) {
    assert.equal(formatDisplayDate('malformed-date', locale, fallback), fallback);
    assert.equal(formatDisplayDate(null, locale, fallback), fallback);
  }
});
