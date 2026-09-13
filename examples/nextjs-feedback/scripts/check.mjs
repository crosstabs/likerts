import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const origin = process.env.LIKERTS_EXAMPLE_ORIGIN;
const apiOrigin = process.env.LIKERTS_API_URL;
const management = process.env.LIKERTS_TOKEN;
const screenshots = process.env.LIKERTS_EXAMPLE_SCREENSHOT_DIR;
if (!origin || !apiOrigin || !management || !screenshots) throw new Error('Run through npm run check.');
await mkdir(screenshots, { recursive: true });
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else assert(!(await readFile(path)).includes(Buffer.from(management)), 'Management credential leaked to static output.');
  }
}
await scan('.next/static');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const consoleErrors = [];
const leaks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (['error', 'warning'].includes(message.type())) consoleErrors.push(message.text());
});
page.on('request', request => {
  if (JSON.stringify(request.headers()).includes(management) || (request.postData() ?? '').includes(management)) leaks.push('request');
});
try {
  await page.goto(origin);
  assert.match(await page.title(), /Next.js feedback example/);
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('.likerts-form').count(), 0, 'Must not mount before user action.');
  assert(!(await page.content()).includes(management), 'Management credential leaked to HTML/RSC.');

  // A failed collection GET renders a recoverable state; no write has occurred.
  await page.route(`${apiOrigin}/v1/collections/*`, route => route.fulfill({ status: 503,
    headers: { 'Access-Control-Allow-Origin': origin }, body: '{}' }), { times: 1 });
  await page.getByRole('button', { name: 'Give feedback' }).focus();
  await page.keyboard.press('Enter');
  await page.getByText('Could not load this collection.').waitFor();
  await page.getByRole('button', { name: 'Try loading again' }).click();
  await page.locator('.likerts-form').waitFor();
  const oldForm = await page.locator('.likerts-form').elementHandle();
  await page.getByRole('link', { name: 'Continue browsing' }).click();
  await page.getByRole('heading', { name: 'A fresh page.' }).waitFor();
  assert.equal(await oldForm.evaluate(form => form.isConnected), false, 'Renderer must be removed on navigation.');
  await page.getByRole('link', { name: 'Back to checkout' }).click();
  assert.equal(await page.locator('.likerts-form').count(), 0, 'Return must require explicit feedback action.');
  await page.getByRole('button', { name: 'Give feedback' }).click();
  await page.locator('.likerts-form').waitFor();
  assert.equal(await page.locator('.likerts-form').count(), 1, 'Only one renderer after remount.');
  await page.getByLabel('How easy was it?').fill('5');
  await page.getByLabel('What could improve?').fill('Synthetic Next.js check');
  await page.screenshot({ path: join(screenshots, 'nextjs-desktop.png'), fullPage: true });

  // The API accepts the first request but its reply is lost. Retry after client
  // navigation must send the exact same payload/key, then show one stored record.
  const submissions = [];
  await page.route(`${apiOrigin}/v1/collections/*/responses`, async route => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) { const result = await route.fetch(); assert.equal(result.status(), 200); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('button', { name: 'Retry original submission' }).waitFor();
  await page.getByRole('link', { name: 'Continue browsing' }).click();
  await page.getByRole('link', { name: 'Back to checkout' }).click();
  await page.getByRole('button', { name: 'Give feedback' }).click();
  await page.getByRole('button', { name: 'Retry original submission' }).click();
  await page.getByText('Feedback accepted.', { exact: true }).waitFor();
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[0], submissions[1], 'Ambiguous retry changed key/payload.');
  const receipt = await page.getByTestId('receipt').textContent();
  await page.getByRole('button', { name: 'Read it from the backend' }).click();
  await page.getByTestId('record').filter({ hasText: receipt }).waitFor();
  const stored = JSON.parse(await page.getByTestId('record').textContent());
  assert.equal(stored.receipt.responseId, receipt);
  assert.equal(stored.answers.rating, 5);
  assert.equal(stored.metadata.framework, 'nextjs');
  const response = await fetch(`${apiOrigin}/v1/responses?collectionId=${process.env.LIKERTS_COLLECTION_ID}`, { headers: { Authorization: `Bearer ${management}` } });
  assert.equal((await response.json()).items.length, 1, 'Retry created duplicate response.');
  const denial = await fetch(`${origin}/api/feedback/config`, { headers: { Origin: 'https://attacker.invalid' } });
  assert.equal(denial.status, 403);
  const retrievalDenial = await fetch(`${origin}/api/feedback/response?id=${receipt}`, { headers: { Origin: 'https://attacker.invalid' } });
  assert.equal(retrievalDenial.status, 403);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile overflow.');
  await page.screenshot({ path: join(screenshots, 'nextjs-mobile-receipt.png'), fullPage: true });
  assert.deepEqual(errors, [], 'Browser runtime errors.');
  assert.deepEqual(consoleErrors.filter(message => !/Failed to load resource:.*(?:503|ERR_FAILED)/.test(message)), [], 'Unexpected browser console errors.');
  assert.deepEqual(leaks, [], 'Management credential in browser traffic.');
  console.log('PASS: production page, explicit mount, collection failure/recovery, navigation cleanup/remount, lost-reply retry across navigation, one real response, server readback, origin denials, no management credential in HTML/static/client requests, mobile width, no page errors.');
} finally { await browser.close(); }
