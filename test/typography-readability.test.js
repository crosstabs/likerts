import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const stylesheetPaths = Object.freeze([
  '../src/styles.css',
  '../public/static-site.css',
  '../public/study-library.css',
]);

const toPixels = (value, unit) => unit === 'rem' ? value * 16 : value;

const numericDeclaration = (block, property) => {
  const match = block.match(new RegExp(`${property}:\\s*([0-9.]+)(px|rem)`));
  return match ? toPixels(Number(match[1]), match[2]) : null;
};

const assertRuleFloor = (source, selector, property, floor) => {
  let searchFrom = 0;
  let actual = null;
  while (actual === null) {
    const selectorIndex = source.indexOf(selector, searchFrom);
    assert.notEqual(selectorIndex, -1, `Missing numeric ${property} declaration for selector: ${selector}`);
    const openBrace = source.indexOf('{', selectorIndex + selector.length);
    const closeBrace = source.indexOf('}', openBrace + 1);
    assert.ok(openBrace > selectorIndex && closeBrace > openBrace, `Malformed typography rule: ${selector}`);
    actual = numericDeclaration(source.slice(openBrace + 1, closeBrace), property);
    searchFrom = selectorIndex + selector.length;
  }
  assert.ok(actual >= floor, `${selector} ${property} must be at least ${floor}px; received ${actual}px`);
};

test('shipped stylesheets enforce a 12px absolute visible-text floor', async () => {
  for (const relativePath of stylesheetPaths) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    const violations = [];

    for (const declaration of source.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
      for (const value of declaration[1].matchAll(/([0-9]*\.?[0-9]+)(px|rem)/g)) {
        const pixels = toPixels(Number(value[1]), value[2]);
        if (pixels >= 12) continue;
        const line = source.slice(0, declaration.index).split('\n').length;
        violations.push({ line, value: value[0], declaration: declaration[0].trim() });
      }
    }

    assert.deepEqual(violations, [], `${relativePath} contains font sizes below the 12px readability floor`);
  }
});

test('interactive research surfaces preserve the semantic type hierarchy', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assertRuleFloor(styles, 'body', 'font-size', 16);
  assertRuleFloor(styles, '.field label', 'font-size', 14);
  assertRuleFloor(styles, '.public-footer', 'font-size', 14);
  assertRuleFloor(styles, '.field textarea', 'font-size', 14);
  assertRuleFloor(styles, '.field textarea, .input-wrap, .select-wrap, .counter', 'min-height', 44);
  assertRuleFloor(styles, '.research-upload-button', 'font-size', 14);
  assertRuleFloor(styles, '.research-upload-button', 'min-height', 44);
  assertRuleFloor(styles, '.report-actions button', 'font-size', 14);
  assertRuleFloor(styles, '.report-actions button', 'min-height', 44);
  assertRuleFloor(styles, '.executive-read p', 'font-size', 16);
  assertRuleFloor(styles, '.perspective-answer > p', 'font-size', 16);
  assertRuleFloor(styles, '.population-summary > p', 'font-size', 16);
});

test('static research pages keep controls and dense study data readable', async () => {
  const staticStyles = await readFile(new URL('../public/static-site.css', import.meta.url), 'utf8');
  const libraryStyles = await readFile(new URL('../public/study-library.css', import.meta.url), 'utf8');

  assertRuleFloor(staticStyles, 'body', 'font-size', 16);
  assertRuleFloor(staticStyles, '.header-cta,.button', 'font-size', 14);
  assertRuleFloor(staticStyles, '.header-cta,.button', 'min-height', 44);
  assertRuleFloor(staticStyles, 'td', 'font-size', 14);

  assertRuleFloor(libraryStyles, '.study-library-page', 'font-size', 16);
  assertRuleFloor(libraryStyles, '.sl-button', 'font-size', 14);
  assertRuleFloor(libraryStyles, '.sl-button', 'min-height', 44);
  assertRuleFloor(libraryStyles, '.study-filter-field label', 'font-size', 14);
  assertRuleFloor(libraryStyles, '.study-filter-field :is(select, input)', 'font-size', 16);
  assertRuleFloor(libraryStyles, '.study-filter-field :is(select, input)', 'min-height', 44);
  assertRuleFloor(libraryStyles, '.study-table-row', 'font-size', 14);
  assertRuleFloor(libraryStyles, '.study-table-row .study-title', 'font-size', 16);
  assertRuleFloor(libraryStyles, '.study-breadcrumbs', 'font-size', 14);
  assertRuleFloor(libraryStyles, '.study-detail-heading .study-question', 'font-size', 16);
  assertRuleFloor(libraryStyles, '.source-card a', 'font-size', 14);
  assertRuleFloor(libraryStyles, '.rail-more', 'min-height', 44);
});

test('static research pages retain readable reflow at narrow and zoomed viewports', async () => {
  const staticStyles = await readFile(new URL('../public/static-site.css', import.meta.url), 'utf8');
  const libraryStyles = await readFile(new URL('../public/study-library.css', import.meta.url), 'utf8');

  assert.match(staticStyles, /@media \(max-width:220px\)/);
  assert.match(staticStyles, /\.step > \* \{ min-width:0; overflow-wrap:anywhere; \}/);
  assert.match(libraryStyles, /\.source-card a \{[^}]*max-width: 100%;[^}]*overflow-wrap: anywhere; word-break: break-word;/);
  assert.match(libraryStyles, /@media \(max-width: 220px\)/);
  assert.match(libraryStyles, /\.study-table-row \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(libraryStyles, /@media \(max-width: 220px\) \{[\s\S]*?\.distribution-labels \{ display: none; \}/);
});
