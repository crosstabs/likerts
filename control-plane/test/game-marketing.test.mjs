import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const publicRoot = new URL('../public/', import.meta.url);
const html = await readFile(new URL('game/index.html', publicRoot), 'utf8');
const css = await readFile(new URL('game/marketing.css', publicRoot), 'utf8');
const origin = 'https://likerts.com';
const pageURL = `${origin}/game`;
const document = new JSDOM(html, { url: pageURL }).window.document;

async function localFile(pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  for (const name of [relative, `${relative}.html`, `${relative}/index.html`]) {
    const file = new URL(name, publicRoot);
    try { if ((await stat(file)).isFile()) return file; } catch { /* next clean route */ }
  }
  assert.fail(`No public file for ${pathname}`);
}

test('game marketing media and navigation resolve from the actual clean game URL', async () => {
  for (const element of document.querySelectorAll('[href], [src]')) {
    const value = element.getAttribute('href') ?? element.getAttribute('src');
    const url = new URL(value, pageURL);
    if (url.protocol === 'mailto:') {
      assert.equal(url.pathname, 'support@crosstabs.com');
      assert.equal(url.searchParams.has('body'), false, 'No game content belongs in a prepared contact link');
      continue;
    }
    assert.equal(url.origin, origin, `Unexpected external dependency or destination: ${value}`);
    const file = await localFile(url.pathname);
    if (url.hash) {
      const target = new JSDOM(await readFile(file, 'utf8')).window.document;
      assert.ok(target.getElementById(decodeURIComponent(url.hash.slice(1))), `Missing fragment: ${value}`);
    }
  }
  for (const img of document.images) {
    assert.ok(img.alt.trim(), 'Product images need meaningful alternatives');
    const bytes = await readFile(await localFile(new URL(img.src).pathname));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), Number(img.getAttribute('width')));
    assert.equal(bytes.readUInt32BE(20), Number(img.getAttribute('height')));
  }
});

test('the consumer page offers real actions and accurate pre-release capabilities', () => {
  const text = document.body.textContent.replace(/\s+/g, ' ');
  assert.match(text, /Coming to iPhone & Messages/);
  assert.match(text, /interface and game writing are in English/);
  assert.match(text, /Both players need Likerts for Messages/);
  assert.match(text, /encoded, not encrypted/);
  assert.match(text, /AI selects reviewed English writing/);
  assert.match(text, /compatible Apple Intelligence hardware, iOS 26 or later/);
  assert.match(text, /does not deliver a report/);
  assert.equal(document.querySelectorAll('form, input, button, script').length, 0,
    'This page must not pretend to be a playable game, collect a waitlist or load tracking code');
  for (const link of document.querySelectorAll('a')) {
    assert.doesNotMatch(link.href, /apps\.apple\.com|itunes\.apple\.com/);
    assert.doesNotMatch(link.textContent, /download now|get it on the app store/i);
  }
  assert.equal(new URL(document.querySelector('link[rel="canonical"]').href).href, pageURL);
});

test('game marketing has keyboard entry, semantic landmarks and a reduced-motion alternative', () => {
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.equal(document.querySelector('h1').textContent.replace(/\s+/g, ' ').trim(), 'Who knows you best?');
  const main = document.querySelector('main');
  assert.equal(document.querySelector('.skip').hash, `#${main.id}`);
  assert.equal(main.getAttribute('tabindex'), '-1');
  assert.ok(document.querySelector('nav[aria-label]'));
  assert.ok(document.querySelector('details#privacy > summary'));
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none\s*!important/);
  assert.doesNotMatch(css, /animation[^;{}]*\binfinite\b/);
});
