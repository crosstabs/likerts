import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('CJK document languages receive script-appropriate font and line-breaking policies', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const staticStyles = await readFile(new URL('../public/static-site.css', import.meta.url), 'utf8');
  const chinese = styles.match(/html:lang\(zh\) body \{([^}]+)\}/)?.[1] || '';
  const japanese = styles.match(/html:lang\(ja\) body \{([^}]+)\}/)?.[1] || '';
  const korean = styles.match(/html:lang\(ko\) body \{([^}]+)\}/)?.[1] || '';

  assert.match(chinese, /PingFang SC/);
  assert.match(chinese, /line-break:\s*strict/);
  assert.match(japanese, /Hiragino Sans/);
  assert.match(japanese, /line-break:\s*strict/);
  assert.match(korean, /Apple SD Gothic Neo/);
  assert.match(korean, /word-break:\s*keep-all/);
  assert.match(korean, /overflow-wrap:\s*break-word/);

  const technicalTokens = styles.match(/\.hash-value \{([^}]+)\}/)?.[1] || '';
  assert.match(technicalTokens, /word-break:\s*break-all/);

  const reportHeadings = styles.match(/html:lang\(zh\) \.report-heading h2,[\s\S]*?html:lang\(ko\) \.report-heading h2 \{([^}]+)\}/)?.[1] || '';
  assert.match(reportHeadings, /line-height:\s*1\.2/);
  assert.match(reportHeadings, /letter-spacing:\s*normal/);

  const firstRunHeading = styles.match(/\.first-run-start h1 \{([^}]+)\}/)?.[1] || '';
  assert.match(firstRunHeading, /text-wrap:\s*balance/);

  const mobileCjkHeadings = styles.match(/@media \(max-width: 430px\) \{[\s\S]*?html:lang\(zh\) \.report-heading h2,[\s\S]*?html:lang\(ko\) \.report-heading h2 \{([^}]+)\}/)?.[1] || '';
  assert.match(mobileCjkHeadings, /font-size:\s*24px/);

  const mobileCjkQuestion = styles.match(/@media \(max-width: 760px\) \{[\s\S]*?html:lang\(zh\) \.question-field textarea,[\s\S]*?html:lang\(ko\) \.question-field textarea \{([^}]+)\}/)?.[1] || '';
  assert.match(mobileCjkQuestion, /height:\s*auto/);
  assert.match(mobileCjkQuestion, /min-height:\s*104px/);

  const newStudyButton = styles.match(/\.new-study-button \{([^}]+)\}/)?.[1] || '';
  assert.match(newStudyButton, /flex:\s*0 0 auto/);
  assert.match(newStudyButton, /white-space:\s*nowrap/);

  const wrappedFocus = styles.match(/\.header-select:focus-within,[\s\S]*?\.source-input:focus-within \{([^}]+)\}/)?.[1] || '';
  assert.match(wrappedFocus, /outline:\s*3px solid #0b5bd3/);
  assert.match(wrappedFocus, /outline-offset:\s*2px/);
  for (const selector of ['.header-select', '.input-wrap', '.select-wrap', '.method-list-row', '.source-input']) {
    assert.match(styles, new RegExp(`${selector.replace('.', '\\.')}:focus-within`));
  }

  const tabletHeader = styles.match(/@media \(max-width: 800px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(tabletHeader, /\.market-selector\s*\{\s*display:\s*none/);
  assert.match(tabletHeader, /\.header-localization-status[^}]*clip:/);
  assert.match(tabletHeader, /\.new-study-button[^}]*font-size:\s*14px/);

  const compactProgress = styles.match(/@media \(max-width: 980px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(compactProgress, /\.run-progress\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(compactProgress, /\.run-progress li\s*\{[^}]*flex-direction:\s*column/);
  assert.match(compactProgress, /\.stage-connector\s*\{[^}]*top:\s*15px/);
  assert.match(compactProgress, /\.run-reference\s*\{[^}]*border-inline-start:\s*0/);

  const narrowNewStudyIcon = styles.match(/@media \(max-width: 430px\) \{[\s\S]*?\.new-study-button svg \{([^}]+)\}/)?.[1] || '';
  assert.match(narrowNewStudyIcon, /display:\s*none/);
  const narrowLanguagePicker = styles.match(/@media \(max-width: 430px\) \{[\s\S]*?\.language-picker select \{([^}]+)\}/)?.[1] || '';
  assert.match(narrowLanguagePicker, /max-width:\s*92px/);

  const staticChinese = staticStyles.match(/html:lang\(zh\) body \{([^}]+)\}/)?.[1] || '';
  const staticJapanese = staticStyles.match(/html:lang\(ja\) body \{([^}]+)\}/)?.[1] || '';
  const staticKorean = staticStyles.match(/html:lang\(ko\) body \{([^}]+)\}/)?.[1] || '';
  assert.match(staticChinese, /PingFang SC/);
  assert.match(staticChinese, /line-break:\s*strict/);
  assert.match(staticJapanese, /Hiragino Sans/);
  assert.match(staticJapanese, /line-break:\s*strict/);
  assert.match(staticKorean, /Apple SD Gothic Neo/);
  assert.match(staticKorean, /word-break:\s*keep-all/);
  assert.match(staticKorean, /overflow-wrap:\s*break-word/);
});
