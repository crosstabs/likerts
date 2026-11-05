import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const publicRoot = new URL('../public/', import.meta.url);
const html = await readFile(new URL('index.html', publicRoot), 'utf8');
const css = await readFile(new URL('game/marketing.css', publicRoot), 'utf8');
const origin = 'https://likerts.com';
const pageURL = `${origin}/`;
const document = new JSDOM(html, { url: pageURL }).window.document;

async function localFile(pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  for (const name of [relative, `${relative}.html`, `${relative}/index.html`]) {
    const file = new URL(name, publicRoot);
    try { if ((await stat(file)).isFile()) return file; } catch { /* next clean route */ }
  }
  assert.fail(`No public file for ${pathname}`);
}

test('game marketing media and navigation resolve from the main homepage URL', async () => {
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


test('homepage promotion preserves survey entry points and legacy game links', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.redirects, [{ source: '/game', destination: '/', permanent: true }],
    'Only the old game landing route redirects; support, assets and survey services retain their paths');
  assert.equal(document.querySelector('meta[property="og:url"]').content, pageURL);
  assert.equal(document.querySelector('a[href="/surveys"]').textContent, 'Survey software');
  const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /script-src 'none'/);
  const survey = new JSDOM(await readFile(await localFile('/surveys'), 'utf8')) .window.document;
  assert.match(survey.querySelector('h1').textContent, /Feedback belongs/);
  assert.ok(survey.querySelector('#preview-form'), 'The local survey demo survives relocation');
  assert.ok(survey.querySelector('a[href="/"]'), 'The survey page keeps a route back to the game');
  for (const pathname of ['/surveys', '/docs', '/docs/api', '/demo', '/downloads', '/preview', '/app', '/status', '/game/support']) {
    const target = new JSDOM(await readFile(await localFile(pathname), 'utf8'), { url: `${origin}${pathname}` }).window.document;
    for (const link of target.querySelectorAll('a[href]')) {
      const url = new URL(link.href);
      if (url.origin !== origin) continue;
      const file = await localFile(url.pathname);
      if (url.hash) {
        const linked = new JSDOM(await readFile(file, 'utf8')).window.document;
        assert.ok(linked.getElementById(decodeURIComponent(url.hash.slice(1))), `${pathname} links to a missing fragment: ${link.href}`);
      }
    }
    if (!pathname.startsWith('/game/')) {
      assert.equal(target.querySelector('a.wordmark').getAttribute('href'), '/surveys', `${pathname} retains survey navigation`);
    }
  }
});
