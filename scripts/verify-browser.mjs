import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const baseUrl = process.env.LIKERTS_BROWSER_URL || 'http://127.0.0.1:4173';
const artifactDirectory = new URL('../design-qa-artifacts/', import.meta.url);
const widths = [320, 768, 1440];
const report = [];

await fs.mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 844 : 1000 }, locale: 'en-US' });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedResponses = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const newStudy = page.getByRole('button', { name: 'New study' });
    const editBrief = page.getByRole('button', { name: 'Edit brief' });
    await newStudy.waitFor();
    await editBrief.waitFor();
    assert.equal(await newStudy.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(9, 103, 247)', 'New study must be visually prominent');
    assert.equal(await editBrief.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(9, 103, 247)', 'Edit brief must be visually prominent');
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth), true, `${width}px layout overflows`);
    assert.equal(consoleErrors.length, 0, `${width}px console errors: ${consoleErrors.join('; ')}`);
    assert.equal(pageErrors.length, 0, `${width}px page errors: ${pageErrors.join('; ')}`);
    assert.equal(failedResponses.length, 0, `${width}px failed resources: ${failedResponses.join('; ')}`);

    await editBrief.click();
    const quick = page.getByRole('radio', { name: /Quick/i });
    const deep = page.getByRole('radio', { name: /Deep/i });
    await quick.waitFor();
    assert.equal(await quick.isChecked(), true, 'Quick must be the default');
    await deep.check();
    assert.equal(await deep.isChecked(), true, 'Deep must be selectable');
    await page.getByRole('button', { name: 'Run study' }).waitFor();
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth), true, `${width}px composer overflows`);

    const activeTab = page.getByRole('tab', { name: 'Report' });
    await activeTab.focus();
    await activeTab.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'Segments' }).getAttribute('aria-selected'), 'true', 'tab keyboard navigation failed');

    const screenshot = new URL(`implementation-v2-${width}.png`, artifactDirectory);
    await page.screenshot({ path: fileURLToPath(screenshot), fullPage: true });

    if (width === 768) {
      await page.getByLabel('Interface language').selectOption('ar-SA');
      await page.waitForFunction(() => document.documentElement.dir === 'rtl');
      assert.equal(await page.locator('html').getAttribute('lang'), 'ar-SA');
      assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth), true, 'RTL layout overflows');
      await page.screenshot({ path: fileURLToPath(new URL('implementation-v2-rtl.png', artifactDirectory)), fullPage: true });
    }

    report.push({ width, noOverflow: true, prominentNewStudy: true, prominentEditBrief: true, quickDefault: true, deepSelectable: true, keyboardTabs: true, consoleErrors: 0, pageErrors: 0, failedResponses: 0 });
    await context.close();
  }
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify({ baseUrl, report }, null, 2)}\n`);
