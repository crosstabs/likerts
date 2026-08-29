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
