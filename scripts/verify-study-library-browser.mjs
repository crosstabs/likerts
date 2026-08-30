import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Usage: STUDY_LIBRARY_URL=http://127.0.0.1:4173/studies/ node scripts/verify-study-library-browser.mjs
// Optional: STUDY_LIBRARY_DETAIL_URL can pin a detail URL when the hub has no rows yet.
const requestedUrl = process.env.STUDY_LIBRARY_URL || 'http://127.0.0.1:4173/studies/';
const configuredDetailUrl = process.env.STUDY_LIBRARY_DETAIL_URL;
const widths = [320, 375, 768, 1440];
const report = [];

function inferHubAndDetail(urlString) {
  const url = new URL(urlString);
  const isExplicitIndex = /\/index\.html$/i.test(url.pathname);
  const isDetail = !isExplicitIndex && /\/studies\/[^/]+\/?$/.test(url.pathname);
  if (!isDetail) return { hubUrl: url.toString(), detailUrl: configuredDetailUrl || null };
  const hubUrl = new URL('../', url).toString();
  return { hubUrl, detailUrl: configuredDetailUrl || url.toString() };
}

const inferred = inferHubAndDetail(requestedUrl);
const browser = await chromium.launch({ headless: true });

async function inspectPage(page, pageUrl, kind, width) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  // Auto Ads may keep network activity alive after the static study UI is ready.
  // DOM readiness plus the explicit shell is the stable signal for this surface.
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.study-library-shell').first().waitFor({ state: 'visible' });

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  assert.ok(viewport.scrollWidth <= viewport.clientWidth + 1, `${kind} ${width}px document overflows (${viewport.scrollWidth} > ${viewport.clientWidth})`);
  assert.ok(viewport.bodyScrollWidth <= viewport.clientWidth + 1, `${kind} ${width}px body overflows (${viewport.bodyScrollWidth} > ${viewport.clientWidth})`);

  const primaryActions = page.locator('.library-actions .sl-button-primary, .study-detail-actions .sl-button-primary, .header-cta');
  assert.ok(await primaryActions.filter({ visible: true }).count() > 0, `${kind} ${width}px has no semantic primary study action`);

  const boundaries = page.locator('.library-boundary, [data-boundary]');
  assert.ok(await boundaries.filter({ visible: true }).count() > 0, `${kind} ${width}px has no visible synthetic boundary disclosure`);
  const boundaryText = (await boundaries.first().innerText()).trim();
  assert.ok(boundaryText.length >= 20, `${kind} ${width}px boundary must explain the evidence limit`);

  const charts = page.locator('.distribution-chart');
  assert.ok(await charts.count() > 0, `${kind} ${width}px has no distribution chart`);
  const labelledCharts = page.locator('.distribution-figure .distribution-labels, .distribution-labels, .distribution-chart[aria-label]');
  assert.ok(await labelledCharts.count() > 0, `${kind} ${width}px chart has no accessible/visible labels`);
  const visibleLabelCount = await page.locator('.distribution-labels span, .distribution-legend span').filter({ visible: true }).count();
  let featuredDisclosureContained = null;
  if (kind === 'hub') {
    const featuredDisclosure = page.locator('.featured-study-footer > span').first();
    assert.equal(await featuredDisclosure.count(), 1, `${kind} ${width}px has no featured-study disclosure`);
    featuredDisclosureContained = await featuredDisclosure.evaluate((element) => {
      const elementRect = element.getBoundingClientRect();
      const footerRect = element.parentElement?.getBoundingClientRect();
      if (!footerRect) return false;
      return elementRect.left >= footerRect.left - 1 && elementRect.right <= footerRect.right + 1;
    });
    assert.ok(featuredDisclosureContained, `${kind} ${width}px featured-study disclosure is clipped by its card`);
  }
  if (kind === 'detail') {
    assert.ok(visibleLabelCount >= 5, `${kind} ${width}px needs five visible Likert labels`);
    const quoteWidths = await page.locator('.perspective blockquote').evaluateAll((quotes) => (
      quotes.map((quote) => quote.getBoundingClientRect().width)
    ));
    assert.ok(quoteWidths.length > 0, `${kind} ${width}px has no synthetic-perspective quotes`);
    assert.ok(Math.min(...quoteWidths) >= 160, `${kind} ${width}px synthetic-perspective quote collapsed below 160px`);
  }

  assert.equal(consoleErrors.length, 0, `${kind} ${width}px console errors: ${consoleErrors.join('; ')}`);
  assert.equal(pageErrors.length, 0, `${kind} ${width}px page errors: ${pageErrors.join('; ')}`);
  assert.equal(failedResponses.length, 0, `${kind} ${width}px failed assets/requests: ${failedResponses.join('; ')}`);

  return {
    width,
    kind,
    noOverflow: true,
    semanticPrimaryAction: true,
    chartLabels: visibleLabelCount,
    boundaryDisclosure: true,
    ...(featuredDisclosureContained === null ? {} : { featuredDisclosureContained }),
    consoleErrors: 0,
    pageErrors: 0,
    failedResponses: 0,
  };
}

try {
  // Discover one stable detail URL from the hub, keeping the generator free to choose its slugs.
  if (!inferred.detailUrl) {
    const discoveryContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
    const discoveryPage = await discoveryContext.newPage();
    await discoveryPage.goto(inferred.hubUrl, { waitUntil: 'domcontentloaded' });
    const studyLink = discoveryPage.locator('[data-study-link]').first();
    await studyLink.waitFor({ state: 'visible' });
    const href = await studyLink.getAttribute('href');
    assert.ok(href, 'Hub study row must expose a detail href');
    inferred.detailUrl = new URL(href, inferred.hubUrl).toString();
    await discoveryContext.close();
  }

  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 844 : 1000 }, locale: 'en-US' });
    const hubPage = await context.newPage();
    report.push(await inspectPage(hubPage, inferred.hubUrl, 'hub', width));
    const detailPage = await context.newPage();
    report.push(await inspectPage(detailPage, inferred.detailUrl, 'detail', width));

    // Exercise the logical-property layout in RTL at each breakpoint. This only changes
    // the document direction, and verifies that the rendered page remains contained.
    await detailPage.evaluate(() => {
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = 'ar';
    });
    const rtlState = await detailPage.evaluate(() => ({
      direction: getComputedStyle(document.documentElement).direction,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert.equal(rtlState.direction, 'rtl', `detail ${width}px RTL direction was not applied`);
    assert.ok(rtlState.scrollWidth <= rtlState.clientWidth + 1, `detail ${width}px RTL layout overflows`);
    report.push({ width, kind: 'detail-rtl', noOverflow: true, direction: rtlState.direction });
    await context.close();
  }
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify({ hubUrl: inferred.hubUrl, detailUrl: inferred.detailUrl, report }, null, 2)}\n`);
