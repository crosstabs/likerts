import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startBrowserFixture } from './browser-server.mjs';

const require = createRequire(import.meta.url);
const playwright = require('playwright');
const engines = (process.env.LIKERTS_BROWSER_ENGINES ?? 'chromium,firefox,webkit').split(',');
assert.ok(engines.length && engines.every(name => ['chromium','firefox','webkit'].includes(name)), 'Select chromium, firefox and/or webkit');
const evidence = process.env.LIKERTS_BROWSER_EVIDENCE_DIR ? resolve(process.env.LIKERTS_BROWSER_EVIDENCE_DIR) : await mkdtemp(join(tmpdir(), 'likerts-web-browsers-'));
await mkdir(evidence, { recursive: true });
const outcomes = [];
for (const engine of engines) {
  for (const rtl of [false, true]) {
    const name = `${engine}-${rtl ? 'rtl' : 'ltr'}`;
    // macOS WebKit follows Safari's Option-Tab preference for all controls.
    const tabKey = engine === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
    let browser, fixture, page;
    let phase = 'setup';
    try {
      browser = await playwright[engine].launch({ headless: true });
      fixture = await startBrowserFixture({ rtl });
      page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [], consoleErrors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error','warning'].includes(message.type())) consoleErrors.push(message.text()); });
      phase = 'behavior';
      await page.goto(fixture.url);
      assert.equal(await page.title(), 'Likerts browser integration');
      await page.locator('form').waitFor();
      const form = page.locator('form');
      assert.notEqual(await form.getAttribute('aria-labelledby'), null);
      assert.notEqual(await form.getAttribute('aria-describedby'), null);
      assert.equal(await form.evaluate(element => element.classList.contains('customer-survey')), true);
      assert.equal(await page.locator('label').evaluateAll(labels => labels.every(label => !!label.control && label.control.id === label.htmlFor)), true);
      assert.equal(await form.evaluate(element => getComputedStyle(element).direction), rtl ? 'rtl' : 'ltr');
      const { authorText, messages } = fixture;
      const rating = page.getByLabel(authorText.rating, { exact: true });
      const comment = page.getByLabel(authorText.comment, { exact: true });
      const focused = async locator => assert.equal(await locator.evaluate(element => element === document.activeElement), true, `Expected keyboard focus on ${await locator.evaluate(element => element.id || element.textContent)}`);
      // Reset at the document boundary, then use only keyboard movement/input.
      await page.locator('body').focus();
      await page.keyboard.press(tabKey); await focused(rating);
      // Native select type-ahead works across engines without opening an OS
      // popup. RTL choices have numeric prefixes for this keyboard path.
      await page.keyboard.press(rtl ? '1' : 'g');
      await page.keyboard.press(tabKey); await focused(comment);
      assert.equal(await rating.inputValue(), 'good');
      await page.keyboard.insertText(rtl ? 'نص تجريبي' : 'Faster receipts');
      await page.keyboard.press(tabKey);
      if (rtl) {
        const next = page.getByRole('button', { name: messages.next, exact: true });
        await focused(next); await page.keyboard.press('Enter');
        const followup = page.getByLabel(authorText.followup, { exact: true });
        await followup.waitFor({ state: 'visible' });
        assert.equal(await rating.isVisible(), false);
        await page.locator('body').focus();
        await page.keyboard.press(tabKey); await focused(followup);
        await page.keyboard.type('5');
        await page.keyboard.press(tabKey);
        await focused(page.getByRole('button', { name: messages.back, exact: true }));
        await page.keyboard.press('Enter');
        await rating.waitFor({ state: 'visible' });
        assert.equal(await rating.inputValue(), 'good');
        assert.equal(await comment.inputValue(), 'نص تجريبي');
        await page.locator('body').focus();
        await page.keyboard.press(tabKey); await focused(rating);
        await page.keyboard.press(tabKey); await focused(comment);
        await page.keyboard.press(tabKey); await focused(next);
        await page.keyboard.press('Enter');
        await followup.waitFor({ state: 'visible' });
        assert.equal(await followup.inputValue(), '5');
        await page.locator('body').focus();
        await page.keyboard.press(tabKey); await focused(followup);
        await page.keyboard.press(tabKey);
        await focused(page.getByRole('button', { name: messages.back, exact: true }));
        await page.keyboard.press(tabKey);
      }
      const submit = page.getByRole('button', { name: messages.submit, exact: true });
      await focused(submit);
      await page.keyboard.press('Enter');
      await page.locator('.likerts-status').filter({ hasText: messages.submitted }).waitFor();
      const result = await page.evaluate(() => fetch('/result.json').then(response => response.json()));
      assert.equal(result.acceptedResponses, 1);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].answers.rating, 'good');
      assert.equal(result.items[0].answers.comment, rtl ? 'نص تجريبي' : 'Faster receipts');
      if (rtl) assert.equal(result.items[0].answers.followup, 5);
      assert.equal(result.items[0].receipt.responseId, await page.locator('#receipt').textContent());
      assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
      assert.equal(await page.locator('[style]').count(), 0, 'Renderer must not inject inline styling');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      // Screenshot preparation can inject a caret stylesheet in WebKit and
      // empty style attributes elsewhere. Keep it out of the CSP assertion.
      await page.screenshot({ path: join(evidence, `${name}-mobile.png`), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: join(evidence, `${name}-desktop.png`), fullPage: true });
      await page.evaluate(() => window.disposeSurvey());
      assert.equal(await page.locator('form').count(), 0);
      const outcome = { case: name, status: 'passed', browserVersion: browser.version(), acceptedResponses: 1, keyboard: true, tabKey, csp: true, unmounted: true };
      outcomes.push(outcome);
      console.log(`PASS ${name}: labels, keyboard input/submission${rtl ? ', multipage back/next' : ''}, real response, CSP, mobile width and clean unmount`);
    } catch (error) {
      const status = phase === 'setup' ? 'setup_failed' : 'behavior_failed';
      outcomes.push({ case: name, status, error: String(error.message).slice(0, 1500) });
      console.error(`${status.toUpperCase()} ${name}: ${error.message}`);
      if (page) await page.screenshot({ path: join(evidence, `${name}-failure.png`), fullPage: true }).catch(() => {});
    } finally {
      await browser?.close().catch(() => {});
      await fixture?.stop();
    }
  }
}
await writeFile(join(evidence, 'results.json'), JSON.stringify({ measuredAt: new Date().toISOString(), platform: process.platform, arch: process.arch, playwrightVersion: require('playwright/package.json').version, outcomes, limits: ['Headless desktop browser engines with a narrow viewport; no physical iOS/Android device or assistive-technology certification.', 'Arabic example copy is unreviewed synthetic text.'] }, null, 2) + '\n');
console.log(`Browser evidence: ${evidence}`);
if (outcomes.some(outcome => outcome.status === 'behavior_failed')) process.exitCode = 1;
else if (outcomes.some(outcome => outcome.status === 'setup_failed')) process.exitCode = 2;
