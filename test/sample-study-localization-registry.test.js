import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { sampleStudies } from '../content/sample-studies.mjs';
import { CJK_LOCALE_IDS, requireLocaleCapability } from '../shared/localization.mjs';
import { buildSampleStudyArtifacts } from '../scripts/build-sample-studies.mjs';
import { auditSampleStudyCaptures } from '../scripts/verify-sample-study-content.mjs';
import { sampleStudyRegistryEntries } from '../server/sample-study-catalog.js';

const scriptErrorFor = (locale) => `study narrative does not match ${locale} script expectations`;

test('static sample documents use registry-backed HTML language and direction metadata', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'likerts-sample-locale-metadata-'));

  try {
    await buildSampleStudyArtifacts({ studies: sampleStudies, outputDirectory });
    const catalog = JSON.parse(await readFile(join(outputDirectory, 'studies', 'index.json'), 'utf8'));

    for (const study of sampleStudies) {
      const locale = requireLocaleCapability(study.locale, 'sample');
      const localeDirectory = study.locale.toLowerCase();
      const documentTag = `<html lang="${locale.htmlLang}" dir="${locale.dir}">`;
      const hub = await readFile(join(outputDirectory, localeDirectory, 'studies', 'index.html'), 'utf8');
      const detail = await readFile(join(outputDirectory, localeDirectory, 'studies', study.slug, 'index.html'), 'utf8');

      assert.ok(hub.includes(documentTag), `${study.locale} hub metadata`);
      assert.ok(detail.includes(documentTag), `${study.locale} detail metadata`);

      const relatedLinks = [...detail.matchAll(/class="related-study-link"[^>]* lang="([^"]+)" hreflang="([^"]+)"/g)];
      assert.ok(relatedLinks.length > 0, `${study.locale} related studies`);
      for (const [, htmlLang, relatedLocale] of relatedLinks) {
        assert.equal(htmlLang, requireLocaleCapability(relatedLocale, 'sample').htmlLang);
      }
    }

    const localeNames = Object.fromEntries(catalog.studies.map((entry) => [entry.locale, entry.localeName]));
    for (const study of sampleStudies.filter((entry) => entry.locale !== 'zh-CN')) {
      assert.equal(localeNames[study.locale], requireLocaleCapability(study.locale, 'sample').nativeLabel);
    }
    assert.equal(localeNames['zh-CN'], '中文（中国）', 'preserves the existing sample-library presentation label');
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('capture script validation consumes registry policy and fails closed outside sample admission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-sample-script-policy-'));
  const brief = sampleStudies.find((study) => study.locale === 'en-US');
  const capture = JSON.parse(await readFile(new URL('../content/sample-study-captures/ai-copilot-pilot-small-business-us.json', import.meta.url), 'utf8'));
  const capturePath = join(directory, `${brief.slug}.json`);

  try {
    await writeFile(capturePath, `${JSON.stringify(capture)}\n`);
    const baseline = await auditSampleStudyCaptures({ directory, studies: [brief] });
    assert.equal(baseline.results[0].errors.includes(scriptErrorFor('en-US')), false);

    const contaminated = structuredClone(capture);
    contaminated.study.title += ' ภาษาไทย';
    await writeFile(capturePath, `${JSON.stringify(contaminated)}\n`);
    const sharedPolicy = await auditSampleStudyCaptures({ directory, studies: [brief] });
    assert.ok(sharedPolicy.results[0].errors.includes(scriptErrorFor('en-US')), 'registry-disallowed Thai script is rejected');

    await writeFile(capturePath, `${JSON.stringify(capture)}\n`);
    for (const locale of ['id-ID', 'nl-NL']) {
      const unsupportedBrief = { ...brief, locale };
      const unsupported = await auditSampleStudyCaptures({ directory, studies: [unsupportedBrief] });
      assert.ok(unsupported.results[0].errors.includes(scriptErrorFor(locale)), `${locale} cannot bypass sample locale admission`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fallback sample catalog preserves the one-shot CJK interface locale handoff', () => {
  for (const entry of sampleStudyRegistryEntries) {
    const url = new URL(entry.runYourOwnUrl, 'https://likerts.example');
    assert.equal(url.searchParams.get('sample'), entry.slug);
    assert.equal(
      url.searchParams.get('uiLocale'),
      CJK_LOCALE_IDS.includes(entry.locale) ? entry.locale : null,
      entry.locale,
    );
  }
});

test('capture script validation checks audience-summary and response fields independently', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-sample-field-script-policy-'));
  const brief = sampleStudies.find((study) => study.locale === 'zh-CN');
  const original = JSON.parse(await readFile(new URL('../content/sample-study-captures/smart-ev-data-controls-china.json', import.meta.url), 'utf8'));
  const capturePath = join(directory, `${brief.slug}.json`);

  try {
    for (const mutate of [
      (capture) => { capture.study.audienceSummary.audienceLabel = 'English-only audience label'; },
      (capture) => { capture.study.audienceSummary.attributes[0].value = 'English-only audience attribute'; },
      (capture) => { capture.study.responses[0].quote = 'English-only generated response'; },
    ]) {
      const capture = structuredClone(original);
      mutate(capture);
      await writeFile(capturePath, `${JSON.stringify(capture)}\n`);
      const report = await auditSampleStudyCaptures({ directory, studies: [brief] });
      assert.ok(report.results[0].errors.includes(scriptErrorFor(brief.locale)));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('capture script validation permits script-neutral numeric audience attributes without masking narrative fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-sample-neutral-script-policy-'));
  const brief = sampleStudies.find((study) => study.locale === 'de-DE');
  const original = JSON.parse(await readFile(new URL('../content/sample-study-captures/waermepumpe-angebot-bestandsheim-deutschland.json', import.meta.url), 'utf8'));
  const capturePath = join(directory, `${brief.slug}.json`);

  try {
    assert.equal(original.study.audienceSummary.attributes.some((attribute) => attribute.value === '200'), true);
    await writeFile(capturePath, `${JSON.stringify(original)}\n`);
    const report = await auditSampleStudyCaptures({ directory, studies: [brief] });
    assert.equal(report.results[0].errors.includes(scriptErrorFor(brief.locale)), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('capture verification rejects human-cohort claims in model-generated summaries and takeaways', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-sample-human-cohort-'));
  const brief = sampleStudies.find((study) => study.locale === 'en-US');
  const original = JSON.parse(await readFile(new URL('../content/sample-study-captures/ai-copilot-pilot-small-business-us.json', import.meta.url), 'utf8'));
  const capturePath = join(directory, `${brief.slug}.json`);

  try {
    const capture = structuredClone(original);
    capture.study.takeaway = 'Respondents preferred the guarded concept.';
    await writeFile(capturePath, `${JSON.stringify(capture)}\n`);
    const report = await auditSampleStudyCaptures({ directory, studies: [brief] });
    assert.ok(report.results[0].errors.includes('study.takeaway uses human-cohort language for model-generated output'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
