import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('publishes a crawlable research standards contract', async () => {
  const page = await read('public/research-standards/index.html');

  assert.match(page, /<link rel="canonical" href="https:\/\/likerts\.com\/research-standards\/"/);
  assert.match(page, /<h1>[^<]*research standards[^<]*<\/h1>/i);
  assert.match(page, /Quick mode/i);
  assert.match(page, /Deep mode/i);
  assert.match(page, /not deterministic/i);
  assert.match(page, /not human respondents/i);
  assert.match(page, /cost/i);
  assert.match(page, /repeatab/i);
  assert.match(page, /href="\/api\/mcp"/);
});

test('exposes the standards page to search and agent crawlers', async () => {
  const [sitemap, llms, llmsFull] = await Promise.all([
    read('public/sitemap.xml'),
    read('public/llms.txt'),
    read('public/llms-full.txt'),
  ]);

  for (const document of [sitemap, llms, llmsFull]) {
    assert.match(document, /https:\/\/likerts\.com\/research-standards\//);
  }
  assert.match(llmsFull, /Quick mode/i);
  assert.match(llmsFull, /Deep mode/i);
  assert.match(llmsFull, /not deterministic/i);
});

test('public metadata does not overstate source freshness or proprietary panel grounding', async () => {
  const documents = await Promise.all([
    read('index.html'),
    read('public/llms.txt'),
    read('public/llms-full.txt'),
    read('public/methodology/index.html'),
    read('public/synthetic-market-research/index.html'),
    read('public/og-likerts.svg'),
  ]);
  const combined = documents.join('\n');

  assert.doesNotMatch(combined, /current (?:web )?sources?/i);
  assert.doesNotMatch(combined, /Qualtrics Panel Edge/i);
});

test('positions Likerts around free synthetic data for market research without weakening disclosures', async () => {
  const [homepage, app, start, catalog, results, categoryPage, builder] = await Promise.all([
    read('index.html'),
    read('src/App.jsx'),
    read('src/components/FirstRunStart.jsx'),
    read('src/i18nCatalog.mjs'),
    read('src/components/ResultsWorkspace.jsx'),
    read('public/synthetic-market-research/index.html'),
    read('scripts/build-sample-studies.mjs'),
  ]);

  assert.match(homepage, /<title>Free Synthetic Data for Market Research \| Likerts<\/title>/);
  assert.match(homepage, /Generate free synthetic data for market research:/);
  assert.match(homepage, /Model-generated, not human survey evidence\./);
  assert.match(app, /document\.title = `\$\{t\('hero'\)\} \| Likerts`;/);
  assert.match(app, /<span>Likerts — Free Synthetic Research<\/span>/);
  assert.doesNotMatch(app, /Likerts · \{t\('directional'\)\}/);

  assert.match(start, /<h1 id="first-run-start-title">\{t\('firstRunTitle'\)\}<\/h1>/);
  assert.match(app, /\{!showStartState \? <h1 className="sr-only">\{t\('hero'\)\}<\/h1> : null\}/);
  assert.match(catalog, /'For market researchers · free · no account required', 'Free synthetic market research'/);
  assert.match(catalog, /Generate synthetic data for concept tests, audience hypotheses, messages, pricing, and research planning/);
  assert.match(catalog, /Model-generated synthetic data—not observed survey responses, a representative sample, or evidence about a real population\./);
  assert.match(results, /humanFollowUp \|\| t\('directional'\)/);

  assert.match(categoryPage, /<title>Synthetic Data for Market Research: Free Tool \| Likerts<\/title>/);
  assert.match(categoryPage, /<h1>Synthetic data for market research—what it is and how to use it<\/h1>/);
  assert.match(categoryPage, /No people are surveyed\./);
  assert.match(categoryPage, /Likerts — Free Synthetic Research/);
  assert.match(builder, /'en-US': 'Likerts — Free Synthetic Research'/);
  assert.match(builder, /title: 'Synthetic Market Research Examples'/);
});
