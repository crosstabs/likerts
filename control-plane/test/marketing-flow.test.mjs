import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/marketing.js', import.meta.url), 'utf8');
function page() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://likerts.com/' });
  dom.window.fetch = () => { throw new Error('Marketing previews must not send answers'); };
  dom.window.eval(script);
  return dom;
}

test('landing preview validates, displays the chosen answer locally, and resets', () => {
  const dom = page();
  const { document } = dom.window;
  const form = document.getElementById('preview-form');
  const result = document.getElementById('preview-complete');
  const submit = document.getElementById('preview-submit');
  submit.click();
  assert.equal(result.hidden, true, 'An unanswered survey cannot complete');
  document.querySelector('input[value="4"]').click();
  submit.click();
  assert.equal(form.hidden, true);
  assert.equal(result.hidden, false);
  assert.deepEqual(JSON.parse(document.getElementById('preview-payload').textContent), { answers: { rating: 4 } });
  assert.match(document.getElementById('preview-status').textContent, /Nothing was sent or stored/);
  assert.equal(document.activeElement.id, 'preview-reset');
  document.getElementById('preview-reset').click();
  assert.equal(form.hidden, false);
  assert.equal(result.hidden, true);
  assert.equal(form.querySelector(':checked'), null);
  assert.equal(document.getElementById('preview-payload').textContent, '');
  assert.equal(document.activeElement.value, '1');
  dom.window.close();
});

test('actual landing tabs switch examples and support arrow, Home and End navigation', () => {
  const dom = page();
  const { document, KeyboardEvent } = dom.window;
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs[1].click();
  assert.match(document.getElementById('interface-code').textContent, /likerts call usage_get/);
  tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(document.activeElement.id, 'tab-api');
  assert.match(document.getElementById('interface-code').textContent, /POST \/v1\/surveys/);
  assert.equal(document.getElementById('interface-panel').getAttribute('aria-labelledby'), 'tab-api');
  assert.deepEqual(tabs.map(tab => tab.tabIndex), [-1, -1, 0]);
  tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(document.activeElement.id, 'tab-mcp');
  tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(document.activeElement.id, 'tab-api');
  dom.window.close();
});

test('mobile navigation opens, closes on selection and returns focus on Escape', () => {
  const dom = page();
  const { document, KeyboardEvent } = dom.window;
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById(toggle.getAttribute('aria-controls'));
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(nav.classList.contains('is-open'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, toggle);
  toggle.click();
  nav.querySelector('a').click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(nav.classList.contains('is-open'), false);
  dom.window.close();
});
