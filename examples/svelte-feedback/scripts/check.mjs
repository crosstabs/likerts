import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));
const framework = pkg.name.includes('vue') ? 'vue' : 'svelte';
const origin = process.env.LIKERTS_EXAMPLE_ORIGIN, api = process.env.LIKERTS_API_URL;
const management = process.env.LIKERTS_TOKEN, screenshots = process.env.LIKERTS_EXAMPLE_SCREENSHOT_DIR;
if (!origin || !api || !management || !screenshots) throw new Error('Use npm run check.');
await mkdir(screenshots, { recursive: true });
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await scan(path);
    else assert(!(await readFile(path)).includes(Buffer.from(management)), 'Management token in bundle.');
  }
}
await scan(join(here, 'dist'));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], consoleErrors = [], leaks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleErrors.push(message.text()); });
page.on('request', request => { if (JSON.stringify(request.headers()).includes(management) || (request.postData() ?? '').includes(management)) leaks.push('request'); });
try {
  await page.goto(origin);
  assert.match(await page.title(), new RegExp(framework, 'i'));
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('.likerts-form').count(), 0);
  assert(await page.getByRole('button', { name: 'Give feedback' }).isDisabled());
  await page.getByRole('checkbox').check();
  await page.route(`${origin}/api/feedback/config`, route => route.fulfill({ status: 503, body: '{}' }), { times: 1 });
  await page.getByRole('button', { name: 'Give feedback' }).focus(); await page.keyboard.press('Enter');
  await page.getByText('Could not load this collection.').waitFor();
  await page.getByRole('button', { name: 'Try loading again' }).click();
  await page.locator('.likerts-form').waitFor();
  for (let iteration = 0; iteration < 3; iteration++) {
    const old = await page.locator('.likerts-form').elementHandle();
    await page.getByRole('button', { name: 'Close feedback' }).click();
    await page.getByText('Feedback is closed.', { exact: true }).waitFor();
    assert.equal(await old.evaluate(element => element.isConnected), false);
    assert.equal(await page.locator('.likerts-form').count(), 0);
    await page.getByRole('button', { name: 'Give feedback' }).click();
    await page.locator('.likerts-form').waitFor();
    assert.equal(await page.locator('.likerts-form').count(), 1);
  }
  // Closing while a config response is held must never mount a late renderer.
  await page.getByRole('button', { name: 'Close feedback' }).click();
  let releaseConfig, reachedConfig;
  const configHeld = new Promise(resolve => { reachedConfig = resolve; });
  const configRelease = new Promise(resolve => { releaseConfig = resolve; });
  await page.route(`${origin}/api/feedback/config`, async route => {
    const upstream = await route.fetch(); reachedConfig(); await configRelease;
    await route.fulfill({ response: upstream }).catch(() => {});
  }, { times: 1 });
  await page.getByRole('button', { name: 'Give feedback' }).click();
  await configHeld;
  await page.getByText('Loading feedback…', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close feedback' }).click();
  releaseConfig();
  await page.getByText('Feedback is closed.', { exact: true }).waitFor();
  assert.equal(await page.locator('.likerts-form').count(), 0);
  await page.getByRole('button', { name: 'Give feedback' }).click();
  await page.locator('.likerts-form').waitFor();
  await page.getByLabel('How easy was it?').fill('5');
  await page.getByLabel('What could improve?').fill(`Synthetic ${framework} check`);
  await page.screenshot({ path: join(screenshots, `${framework}-desktop.png`), fullPage: true });

  // The API accepts before the UI unmounts. Delivering the delayed reply must
  // not update the removed component; reopening explicitly reconciles by retry.
  const submissions = [];
  let accepted, releaseReceipt;
  const apiAccepted = new Promise(resolve => { accepted = resolve; });
  const receiptRelease = new Promise(resolve => { releaseReceipt = resolve; });
  await page.route(`${api}/v1/collections/*/responses`, async route => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      const result = await route.fetch(); assert.equal(result.status(), 200);
      accepted(); await receiptRelease;
      await route.fulfill({ response: result }).catch(() => {});
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await apiAccepted;
  await page.getByRole('button', { name: 'Close feedback' }).click();
  releaseReceipt();
  await page.getByText('Feedback is closed.', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('receipt').count(), 0, 'Late completion updated closed UI.');
  await page.getByRole('button', { name: 'Give feedback' }).click();
  await page.getByRole('button', { name: 'Retry original submission' }).click();
  await page.getByText('Feedback accepted.', { exact: true }).waitFor();
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[0], submissions[1]);
  const id = await page.getByTestId('receipt').textContent();
  await page.getByRole('button', { name: 'Read it from the backend' }).click();
  await page.getByTestId('record').filter({ hasText: id }).waitFor();
  const record = JSON.parse(await page.getByTestId('record').textContent());
  assert.equal(record.receipt.responseId, id);
  assert.equal(record.answers.rating, 5);
  assert.equal(record.metadata.framework, framework);
  const response = await fetch(`${api}/v1/responses?collectionId=${process.env.LIKERTS_COLLECTION_ID}`, { headers: { Authorization: `Bearer ${management}` } });
  assert.equal((await response.json()).items.length, 1);
  for (const path of ['/api/feedback/config', `/api/feedback/response?id=${id}`]) {
    assert.equal((await fetch(`${origin}${path}`, { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
  }
  const config = await (await fetch(`${origin}/api/feedback/config`)).text();
  assert(!config.includes(management));
  assert(!(await page.content()).includes(management));
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(screenshots, `${framework}-mobile-receipt.png`), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors.filter(value => !/Failed to load resource:.*(?:503|ERR_FAILED|ERR_ABORTED)/.test(value)), []);
  assert.deepEqual(leaks, []);
  console.log(`PASS ${framework}: production build, eligibility/keyboard mount, error/recovery, three cleanup/remount cycles, loading cancellation, accepted-but-delayed reply cancellation, exact retry, one real response/readback, no management leak, local/origin gates, desktop/mobile, no unexpected console/runtime errors.`);
} finally { await browser.close(); }
