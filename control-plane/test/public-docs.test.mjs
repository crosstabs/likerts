import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { JSDOM } from 'jsdom';
const exec = promisify(execFile);
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const indexablePages = [
  ['../public/index.html', 'https://likerts.com/'],
  ['../public/docs/index.html', 'https://likerts.com/docs'],
  ['../public/docs/api/index.html', 'https://likerts.com/docs/api'],
  ['../public/demo/index.html', 'https://likerts.com/demo'],
  ['../public/downloads/index.html', 'https://likerts.com/downloads'],
  ['../public/preview/index.html', 'https://likerts.com/preview'],
];

test('public pages keep complete crawl, social and structured metadata', async () => {
  await exec(process.execPath, ['scripts/sync-public-seo.mjs', '--check'], { cwd: new URL('../', import.meta.url) });

  for (const [file, canonical] of indexablePages) {
    const dom = new JSDOM(await read(file));
    const { document } = dom.window;
    const description = document.querySelector('meta[name="description"]')?.content;
    assert.ok(document.title, `${file} needs a title`);
    assert.ok(description, `${file} needs a description`);
    assert.equal(document.querySelector('link[rel="canonical"]')?.href, canonical);
    assert.equal(document.querySelectorAll('h1').length, 1, `${file} needs exactly one h1`);

    for (const property of ['og:type', 'og:url', 'og:site_name', 'og:title', 'og:description', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt']) {
      assert.ok(document.querySelector(`meta[property="${property}"]`)?.content, `${file} needs ${property}`);
    }
    for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) {
      assert.ok(document.querySelector(`meta[name="${name}"]`)?.content, `${file} needs ${name}`);
    }
    assert.equal(document.querySelector('meta[property="og:url"]').content, canonical);
    assert.equal(document.querySelector('meta[property="og:title"]').content, document.title);
    assert.equal(document.querySelector('meta[property="og:description"]').content, description);

    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    assert.equal(scripts.length, 1, `${file} needs one JSON-LD graph`);
    const data = JSON.parse(scripts[0].textContent);
    assert.equal(data['@context'], 'https://schema.org');
    assert.ok(data['@graph']?.length >= 2, `${file} needs a populated JSON-LD graph`);

    for (const link of document.querySelectorAll('a[href]')) {
      assert.doesNotMatch(link.getAttribute('href'), /^\/(?:docs(?:\/api)?|demo|downloads|preview|app|status)\/(?:#|$)/, `${file} contains a redirecting internal URL`);
    }
  }

  const sitemap = await read('../public/sitemap.xml');
  for (const [, canonical] of indexablePages) {
    assert.match(sitemap, new RegExp(`<loc>${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
  }
  for (const [file, robots] of [
    ['../public/app/index.html', 'noindex, nofollow'],
    ['../public/status/index.html', 'noindex'],
  ]) {
    const html = await read(file);
    assert.match(html, new RegExp(`name="robots" content="${robots}"`));
    const document = new JSDOM(html).window.document;
    for (const link of document.querySelectorAll('a[href]')) {
      assert.doesNotMatch(link.getAttribute('href'), /^\/(?:docs(?:\/api)?|demo|downloads|preview|app|status)\/(?:#|$)/, `${file} contains a redirecting internal URL`);
    }
  }
});

test('public API snapshots and demo SDK match the current source tree', async () => {
  await exec(process.execPath, ['scripts/sync-public-reference.mjs', '--check'], { cwd: new URL('../', import.meta.url) });
});

test('marketing API example equals the validated create fixture and CLI examples name real capabilities', async () => {
  const script = await read('../public/marketing.js');
  const context = { document: { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => {} } };
  runInNewContext(`${script}\nthis.publicExamples = examples;`, context);
  const apiBody = context.publicExamples.api.code.slice(context.publicExamples.api.code.indexOf('{'));
  const fixture = JSON.parse(await read('../../contracts/examples/surveys_create.input.json'));
  assert.deepEqual(JSON.parse(apiBody), fixture);
  const registry = JSON.parse(await read('../../tools/capabilities.json'));
  const names = new Set(registry.map(operation => operation.name));
  for (const match of `${script}\n${await read('../public/docs/index.html')}`.matchAll(/likerts call ([a-z][a-z_]+)/g)) {
    assert.ok(names.has(match[1]), `Unknown documented capability: ${match[1]}`);
  }
  assert.doesNotMatch(script, /likerts survey create|likerts collection issue|\$ likerts usage/);
});

test('public quickstart declares the capability of the actual demo release and keeps tokens out of inputs', async () => {
  const { LIKERTS_SDK_CAPABILITY } = await import('../public/demo/sdk/index.js');
  const declared = JSON.parse(await read('../public/docs/sdk-capabilities.json'));
  assert.deepEqual(declared.installations, [LIKERTS_SDK_CAPABILITY]);
  const request = JSON.parse(await read('../public/docs/survey-create.json'));
  assert.deepEqual(request, JSON.parse(await read('../../contracts/examples/surveys_create.input.json')));
  assert.equal('token' in request, false);
});

test('sample demo uses released schema fixtures and denies network data connections', async () => {
  const html = await read('../public/demo/index.html');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /No response is sent or persisted/);
  const { examples } = await import('../public/demo/examples.js');
  for (const [name, version, fixture] of [
    ['conditional', 3, 'conditional-survey.example.json'],
    ['advanced', 5, 'advanced-survey.example.json'],
    ['branching', 4, 'branching-survey.example.json'],
  ]) {
    assert.deepEqual(examples[name], { schemaVersion: version, ...JSON.parse(await read(`../../contracts/${fixture}`)) });
  }
});
