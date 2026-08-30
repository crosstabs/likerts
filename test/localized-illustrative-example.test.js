import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { initialStudy } from '../src/data.js';
import {
  cjkIllustrativeExampleLocales,
  illustrativeExampleFor,
} from '../src/lib/localizedIllustrativeExample.js';

const expectedScript = Object.freeze({
  'zh-CN': /\p{Script=Han}/u,
  'ja-JP': /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  'ko-KR': /\p{Script=Hangul}/u,
});

const expectedMarket = Object.freeze({
  'zh-CN': 'China',
  'ja-JP': 'Japan',
  'ko-KR': 'South Korea',
});

test('each CJK interface locale receives a localized illustrative study and result', () => {
  assert.deepEqual(cjkIllustrativeExampleLocales, ['zh-CN', 'ja-JP', 'ko-KR']);

  for (const locale of cjkIllustrativeExampleLocales) {
    const example = illustrativeExampleFor(locale);
    const visibleContent = [
      example.study.prompt,
      example.study.audience,
      example.study.concept,
      example.study.assumptions,
      example.result.title,
      example.result.summary,
      example.result.takeaway,
      example.result.confidenceNote,
      example.result.audienceSummary.audienceLabel,
      example.result.audienceSummary.contextLabel,
      ...example.result.audienceSummary.attributes.flatMap(({ label, value }) => [label, value]),
      ...example.result.segments.map(({ label }) => label),
      ...example.result.responses.flatMap(({ profile, quote }) => [profile, quote]),
    ];

    assert.equal(example.study.outputLocale, locale);
    assert.equal(example.study.instrumentLocale, locale);
    assert.equal(example.study.market, expectedMarket[locale]);
    assert.equal(example.result.meta.outputLocale, locale);
    assert.equal(example.result.meta.market, expectedMarket[locale]);
    assert.equal(example.result.populationFrame.languages.outputLocale, locale);
    assert.equal(example.result.populationFrame.intendedPopulation, example.study.audience);
    assert.notEqual(example.study.prompt, initialStudy.prompt);
    assert.ok(visibleContent.every((value) => typeof value === 'string' && expectedScript[locale].test(value)), `${locale} contains an unlocalized illustrative field`);
    assert.equal(Object.isFrozen(example), true);
    assert.equal(Object.isFrozen(example.result.responses), true);
  }
});

test('non-CJK locales retain the default illustrative example without pretending it was translated', () => {
  const example = illustrativeExampleFor('en-US');
  assert.equal(example.study, initialStudy);
  assert.equal(example.study.outputLocale, 'en-US');
});

test('the example report is derived from the current interface locale and remounts on locale changes', () => {
  const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /useMemo\(\(\) => illustrativeExampleFor\(uiLocale\), \[uiLocale\]\)/);
  assert.match(source, /const displayedStudy = exampleOpen \? illustrativeExample\.study : activeStudy;/);
  assert.match(source, /const displayedResult = exampleOpen \? illustrativeExample\.result : result;/);
  assert.match(source, /key=\{`\$\{displayedResult\.meta\?\.runId \|\| 'seed'\}:\$\{displayedResult\.meta\?\.outputLocale \|\| 'unknown'\}`\}/);
});
