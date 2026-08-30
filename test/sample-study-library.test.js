import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  SAMPLE_STUDY_SCHEMA_VERSION,
  sampleStudies,
  supportedSampleStudyLocales,
  validateSampleStudyRegistry,
} from '../content/sample-studies.mjs';
import { LOCALIZATION_REGISTRY_VERSION } from '../shared/localization.mjs';
import {
  assertStaticSampleLocalizationCopy,
  buildSampleStudyArtifacts,
  resolveStaticSampleQualityStatus,
  sanitizeCapturedStudy,
} from '../scripts/build-sample-studies.mjs';
import { buildCapturePlan } from '../scripts/capture-sample-studies.mjs';
import { getSampleStudy, readSampleStudyCatalog } from '../server/sample-study-catalog.js';

test('the public sample-study registry is complete, unique, and validated', () => {
  assert.equal(SAMPLE_STUDY_SCHEMA_VERSION, '1.1');
  assert.equal(Object.isFrozen(sampleStudies), true);
  assert.equal(sampleStudies.length, 10);
  assert.ok(sampleStudies.every((study) => supportedSampleStudyLocales.includes(study.locale)));
  assert.equal(new Set(sampleStudies.map((study) => study.slug)).size, sampleStudies.length);
  assert.ok(new Set(sampleStudies.map((study) => study.industry)).size >= 6);
  assert.doesNotThrow(() => validateSampleStudyRegistry(sampleStudies));
});

test('every brief preserves the synthetic-research honesty boundary and a valid capture request', () => {
  for (const study of sampleStudies) {
    assert.match(study.disclosure, /synthetic|synth[eé]tique|model-generated|合成|sint[eé]tic|synthetisch|합성|تركيبي|संश्लेषित/i);
    assert.ok(study.humanValidation.length >= 30, 'Human-validation guidance must be concrete and substantial.');
    assert.doesNotMatch(study.disclosure, /representative|causal|statistically significant|observed human sample/i);
    assert.equal(study.request.outputLocale, study.locale);
    assert.equal(study.request.researchMode, 'DEEP');
    assert.equal(study.request.evidencePolicy, 'AUTO');
    assert.equal(study.localizationRegistryVersion, LOCALIZATION_REGISTRY_VERSION);
    assert.deepEqual(study.request.localization, study.localization);
    assert.equal(study.localization.reportLocale, study.locale);
    assert.equal(study.curatedContextUrls.length >= 2 && study.curatedContextUrls.length <= 4, true);
    assert.equal(study.curatedContextUrls.every((url) => url.startsWith('https://')), true);
    assert.equal(study.request.panelSize >= 50 && study.request.panelSize <= 500, true);
    assert.equal(study.request.prompt.length >= 12, true);
  }
});

test('sample admission is registry-backed and does not impose one study per locale', () => {
  const duplicateLocale = structuredClone(sampleStudies[0]);
  duplicateLocale.slug = 'ai-copilot-pilot-small-business-us-followup';
  duplicateLocale.stableId = 'SS-EN-US-002';
  assert.doesNotThrow(() => validateSampleStudyRegistry([...sampleStudies, duplicateLocale]));

  const plannedLocale = structuredClone(sampleStudies[0]);
  plannedLocale.locale = 'id-ID';
  assert.throws(
    () => validateSampleStudyRegistry([plannedLocale]),
    /Sample-study locale admission failed: Locale id-ID is not enabled for sample/,
  );
});

test('static sample localization fails closed when a locale lacks renderer copy', () => {
  assert.doesNotThrow(() => assertStaticSampleLocalizationCopy(supportedSampleStudyLocales));
  assert.throws(
    () => assertStaticSampleLocalizationCopy(['en-US', 'id-ID']),
    /Missing static sample UI catalog for id-ID/,
  );
});

test('static sample quality copy resolves native-reviewed for every published locale', () => {
  const expected = {
    'en-US': 'native-language reviewed',
    'es-ES': 'revisado por hablante nativo',
    'pt-BR': 'revisado por falante nativo',
    'fr-FR': 'révisé par un locuteur natif',
    'de-DE': 'muttersprachlich geprüft',
    'zh-CN': '已由母语人士审核',
    'ja-JP': 'ネイティブによるレビュー済み',
    'ko-KR': '원어민 검토 완료',
    'ar-SA': 'تمت المراجعة بواسطة متحدث أصلي',
    'hi-IN': 'मूल-भाषी द्वारा समीक्षित',
  };

  assert.deepEqual(Object.keys(expected).sort(), [...supportedSampleStudyLocales].sort());
  for (const [locale, label] of Object.entries(expected)) {
    assert.equal(resolveStaticSampleQualityStatus(locale, 'native-reviewed'), label);
  }
  assert.throws(
    () => resolveStaticSampleQualityStatus('en-US', 'not-a-real-status'),
    /Missing static sample localization copy for en-US: quality status not-a-real-status/,
  );
});

test('catalog adapters retain legacy static records while attaching canonical localization and separate review state', async () => {
  const catalog = await readSampleStudyCatalog();
  const entry = catalog.studies.find((candidate) => candidate.slug === sampleStudies[0].slug);
  const record = await getSampleStudy(sampleStudies[0].slug);

  assert.equal(entry.localization.registryVersion, LOCALIZATION_REGISTRY_VERSION);
  assert.equal(entry.quality.nativeReview.status, 'review-pending');
  assert.equal(entry.quality.nativeReview.authority, 'registry-declared');
  assert.equal(entry.quality.nativeReview.releaseEligible, false);
  assert.equal(entry.rerun.allowed, true);
  assert.equal(record.localization.registryVersion, LOCALIZATION_REGISTRY_VERSION);
  assert.equal(record.quality.automatedQa.status, 'passed');
  assert.equal(record.sampleLineage.source, 'static-sample-library');
  assert.equal(record.sampleLineage.stableId, sampleStudies[0].stableId);
  assert.equal(record.sampleLineage.slug, sampleStudies[0].slug);
});

test('captured pipeline results are frozen, auditable, and stripped of secrets and session-only fields', () => {
  const captured = sanitizeCapturedStudy(sampleStudies[0], {
    study: {
      title: 'Illustrative workspace adoption',
      summary: 'This directional synthetic output is for hypothesis exploration only.',
      takeaway: 'Validate onboarding barriers with human research before product decisions.',
      distribution: [10, 15, 20, 30, 25],
      confidence: 'Low',
      confidenceNote: 'Synthetic only; validate with human research.',
      audienceSummary: { audienceLabel: 'Operations leaders', contextLabel: 'Small teams', attributes: [] },
      segments: [], responses: [], cautions: ['Synthetic output is not observed human evidence.'],
    },
    meta: {
      generatedAt: '2026-08-28T00:00:00.000Z', runtimeVersion: 'synthetic-research-v2.4',
      modelLineage: [{ stage: 'panel', requestedModel: 'openai/gpt-5.4-mini', resolvedModel: 'openai/gpt-5.4-mini', status: 'completed' }],
      economics: { currency: 'USD', gatewayCost: { exactTotalUsd: '0.0123', reporting: 'complete' } },
      evidenceMode: 'EXA_GATEWAY', stability: { cellCount: 2, meanJensenShannonDivergence: 0.02, maxPercentagePointSpread: 5, interpretation: 'Model agreement only.' }, ensemble: { plannedCells: 2, completedCells: 2, failedCells: 0, aggregation: 'mean' },
      provenance: { inputHash: 'a'.repeat(64), inputHashVersion: 'study-input-v3', evidenceHash: 'b'.repeat(64), disclaimer: 'Model generation is non-deterministic.' },
      apiKey: 'must-not-leak',
    },
    run: { runId: 'run_should_not_publish', clientRunId: 'client_secret', economics: { currency: 'USD', gatewayCost: { exactTotalUsd: '0.0123', reporting: 'complete' } }, evidence: { mode: 'EXA_GATEWAY', ledger: [{ title: 'Public source', url: 'https://example.com/source', excerpt: 'Relevant public evidence about password controls.', acquisition: 'EXA_GATEWAY', contentHash: 'c'.repeat(64) }], external: { events: [{ provider: 'vercel-ai-gateway', operation: 'exa-search', outcome: 'completed' }] } } },
    persistence: { status: 'session-only', clientRecord: { token: 'must-not-leak' } },
  });

  assert.equal(Object.isFrozen(captured), true);
  assert.deepEqual(captured.study.distribution, [10, 15, 20, 30, 25]);
  assert.equal(captured.study.distribution.reduce((sum, value) => sum + value, 0), 100);
  assert.equal(captured.provenance.inputHash, 'a'.repeat(64));
  assert.equal(captured.provenance.inputHashVersion, 'study-input-v3');
  assert.equal(captured.provenance.inputHashLineage.status, 'CURRENT_VERSIONED');
  assert.equal(captured.provenance.inputHashLineage.crossVersionComparable, false);
  assert.equal(captured.cost.gatewayCost.exactTotalUsd, '0.0123');
  assert.equal(captured.modelLineage[0].resolvedModel, 'openai/gpt-5.4-mini');
  assert.equal(captured.evidence.ledger[0].url, 'https://example.com/source');
  assert.equal(captured.evidence.gatewaySearchCompleted, true);
  assert.equal(captured.stability.cellCount, 2);
  assert.equal(captured.populationFrame.frameVersion, 'population-frame-v1');
  assert.equal(captured.localization.registryVersion, LOCALIZATION_REGISTRY_VERSION);
  assert.equal(captured.sampleLineage.source, 'static-sample-library');
  assert.equal(captured.sampleLineage.slug, sampleStudies[0].slug);
  assert.equal(captured.localization.report.locale, sampleStudies[0].locale);
  assert.equal(captured.quality.automatedQa.status, 'passed');
  assert.equal(captured.quality.nativeReview.status, 'review-pending');
  assert.equal(captured.provenance.localizationRegistryVersion, LOCALIZATION_REGISTRY_VERSION);
  assert.equal(captured.populationFrame.populationFit.status, 'UNMEASURED');
  assert.match(captured.populationFrame.disclaimer, /attitudinal accuracy/i);
  assert.equal(captured.modelCard.attitudinalValidation, 'NOT_VALIDATED');
  assert.equal(captured.researchDesign.methodId, 'GENERAL_LIKERT');
  assert.equal(captured.researchDesign.chartId, 'FIVE_POINT_DIRECTIONAL_DISTRIBUTION');
  assert.ok(captured.study.segments.every((segment) => !('sample' in segment)));
  assert.equal(JSON.stringify(captured).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(captured).includes('session-only'), false);
});

test('the static builder produces deterministic catalog and detail JSON for captured samples', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'likerts-studies-'));
  const capture = sanitizeCapturedStudy(sampleStudies[0], {
    study: {
      title: 'Illustrative workspace adoption', summary: 'This directional synthetic output is for hypothesis exploration only.',
      takeaway: 'Validate onboarding barriers with human research before product decisions.', distribution: [10, 15, 20, 30, 25],
      confidence: 'Low', confidenceNote: 'Synthetic only; validate with human research.', audienceSummary: { audienceLabel: 'Operations leaders', contextLabel: 'Small teams', attributes: [] }, segments: [], responses: [], cautions: ['Synthetic output is not observed human evidence.'],
    },
    meta: { generatedAt: '2026-08-28T00:00:00.000Z', runtimeVersion: 'synthetic-research-v2.4', evidenceMode: 'EXA_GATEWAY', stability: { cellCount: 2, meanJensenShannonDivergence: 0.02, maxPercentagePointSpread: 5, interpretation: 'Model agreement only.' }, ensemble: { plannedCells: 2, completedCells: 2, failedCells: 0, aggregation: 'mean' }, modelLineage: [{ stage: 'panel', requestedModel: 'openai/gpt-5.4-mini', resolvedModel: 'openai/gpt-5.4-mini', status: 'completed' }], economics: { currency: 'USD', gatewayCost: { exactTotalUsd: '0.0123', reporting: 'complete' } }, provenance: { inputHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), disclaimer: 'Model generation is non-deterministic.' } },
    run: { evidence: { mode: 'EXA_GATEWAY', ledger: [{ title: 'Public source', url: 'https://example.com/source', excerpt: 'Relevant public evidence.', acquisition: 'EXA_GATEWAY', contentHash: 'c'.repeat(64) }], external: { events: [{ provider: 'vercel-ai-gateway', operation: 'exa-search', outcome: 'completed' }] } } },
  });
  const legacyCapture = JSON.parse(JSON.stringify(capture));
  delete legacyCapture.populationFrame;
  delete legacyCapture.modelCard;
  legacyCapture.study.segments = [{ label: 'Legacy pseudo-sample', sample: 200, values: [10, 15, 20, 30, 25] }];
  legacyCapture.study.responses = [{ score: 4, profile: 'Legacy generated profile', quote: 'Legacy generated answer.' }];
  try {
    const first = await buildSampleStudyArtifacts({ studies: sampleStudies, captures: [legacyCapture], outputDirectory });
    const catalogFirst = await readFile(join(outputDirectory, 'studies', 'index.json'), 'utf8');
    const second = await buildSampleStudyArtifacts({ studies: sampleStudies, captures: [legacyCapture], outputDirectory });
    const catalogSecond = await readFile(join(outputDirectory, 'studies', 'index.json'), 'utf8');
    const detailPath = join(outputDirectory, sampleStudies[0].locale.toLowerCase(), 'studies', sampleStudies[0].slug);
    const detail = JSON.parse(await readFile(join(detailPath, 'study.json'), 'utf8'));
    const detailHtml = await readFile(join(detailPath, 'index.html'), 'utf8');

    assert.equal(first.studyCount, 10);
    assert.equal(first.capturedCount, 1);
    assert.deepEqual(first, second);
    assert.equal(catalogFirst, catalogSecond);
    assert.equal(detail.schemaVersion, '1.1');
    assert.equal(detail.sampleLineage.source, 'static-sample-library');
    assert.equal(detail.sampleLineage.slug, sampleStudies[0].slug);
    assert.deepEqual(detail.capture.sampleLineage, detail.sampleLineage);
    assert.equal(detail.capture.provenance.inputHash, 'a'.repeat(64));
    assert.equal(detail.capture.provenance.inputHashVersion, 'legacy-unversioned');
    assert.equal(detail.capture.provenance.inputHashLineage.status, 'LEGACY_UNVERSIONED');
    assert.equal(detail.htmlUrl, `/${sampleStudies[0].locale.toLowerCase()}/studies/${sampleStudies[0].slug}/`);
    assert.equal(detail.dataUrl, `/${sampleStudies[0].locale.toLowerCase()}/studies/${sampleStudies[0].slug}/study.json`);
    assert.equal(detail.curatedContextCandidates[0].status, 'candidate-not-confirmed-as-runtime-evidence');
    assert.match(detailHtml, /Synthetic, model-generated hypothesis/i);
    assert.match(detailHtml, /Machine-readable study JSON/i);
    assert.doesNotMatch(detailHtml, /\b200\s+(simulation units|respondents|participants)\b/i);
    assert.ok(detail.capture.study.segments.every((segment) => !('sample' in segment)));
    assert.ok(detail.capture.study.responses.every((response) => response.disclosure === 'Model-generated perspective—not a participant quotation.'));
    assert.equal(detail.capture.populationFrame.frameVersion, 'population-frame-v1');
    assert.equal(detail.capture.researchDesign.methodId, 'GENERAL_LIKERT');
    assert.equal(detail.localization.registryVersion, LOCALIZATION_REGISTRY_VERSION);
    assert.equal(detail.quality.automatedQa.status, 'passed');
    assert.equal(detail.quality.nativeReview.status, 'review-pending');
    assert.equal(detail.quality.nativeReview.authority, 'registry-declared');
    assert.equal(detail.quality.nativeReview.releaseEligible, false);
    assert.equal(detail.rerun.allowed, true);
    assert.match(detailHtml, /data-automated-qa-status="passed"/);
    assert.match(detailHtml, /data-native-review-status="review-pending"/);
    assert.match(detailHtml, /data-native-review-authority="registry-declared"/);
    assert.match(detailHtml, /data-native-review-release-eligible="false"/);
    assert.equal(detail.capture.study.distribution.reduce((sum, value) => sum + value, 0), 100);
    assert.equal(JSON.stringify(detail).includes('must-not-leak'), false);
    await assert.rejects(
      readFile(join(outputDirectory, 'studies', 'industry', sampleStudies[0].industry, 'index.html'), 'utf8'),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('static acquisition routes and social metadata are localized without false hub translations', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'likerts-static-acquisition-'));
  try {
    await buildSampleStudyArtifacts({ studies: sampleStudies, outputDirectory });
    const locales = ['en-US', 'zh-CN', 'ja-JP', 'ko-KR'];
    const completeCardCopy = {
      'en-US': ['Explore your question. Then field it with people.', 'plan for human validation.'],
      'zh-CN': ['围绕明确的受众、决策和假设形成合成研究假设。'],
      'ja-JP': ['対象者、意思決定、前提を明確にして検証計画を整えます。'],
      'ko-KR': ['대상, 의사결정, 가정을 바탕으로 검증 계획을 준비합니다.'],
    };
    for (const locale of locales) {
      const route = locale.toLowerCase();
      const html = await readFile(join(outputDirectory, route, 'index.html'), 'utf8');
      assert.match(html, new RegExp(`<link rel="canonical" href="https://likerts\\.com/${route}/"`));
      assert.match(html, new RegExp(`<meta property="og:locale" content="${locale.replace('-', '_')}"`));
      assert.match(html, /<meta property="og:image:type" content="image\/png"/);
      assert.match(html, /<meta name="twitter:image:alt" content="[^"]+"/);
      assert.match(html, /href="\/favicon\.ico" type="image\/x-icon" sizes="any"/);
      assert.match(html, /href="\/favicon-32\.png" type="image\/png" sizes="32x32"/);
      assert.match(html, /href="\/favicon-16\.png" type="image\/png" sizes="16x16"/);
      assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/);
      assert.match(html, /<script type="application\/ld\+json">.*"inLanguage":"(?:en-US|zh-CN|ja-JP|ko-KR)"/);
      for (const alternate of locales) assert.match(html, new RegExp(`hreflang="${alternate}" href="https://likerts\\.com/${alternate.toLowerCase()}/"`));
      assert.match(html, /hreflang="x-default" href="https:\/\/likerts\.com\/en-us\/"/);
      assert.doesNotMatch(html, /<a href="\/?(?:\?uiLocale=[^"]+)?" aria-current="page">/);
      const card = await readFile(join(outputDirectory, 'social', `likerts-${route}-v1.png`));
      assert.deepEqual(card.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      assert.equal(card.readUInt32BE(16), 1200);
      assert.equal(card.readUInt32BE(20), 630);
      const svg = await readFile(join(outputDirectory, 'social', `likerts-${route}-v1.svg`), 'utf8');
      if (locale === 'en-US') assert.match(svg, /aria-label="Explore your question\. Then field it with people\. —/);
      assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="300" y="516" width="340" height="29"/);
      const cardText = svg.replace(/<[^>]+>/g, '');
      const renderedCopy = locale === 'en-US' ? svg : cardText;
      for (const copy of completeCardCopy[locale]) assert.match(renderedCopy, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    const aggregateHub = await readFile(join(outputDirectory, 'studies', 'index.html'), 'utf8');
    assert.match(aggregateHub, /<a href="\/studies\/" aria-current="page">Sample studies<\/a>/);
    const brandStrip = await readFile(join(outputDirectory, 'social', 'brand-line-en-v1.png'));
    assert.equal(brandStrip.readUInt32BE(16), 680);
    assert.equal(brandStrip.readUInt32BE(20), 58);

    const scopedHub = await readFile(join(outputDirectory, 'zh-cn', 'studies', 'index.html'), 'utf8');
    assert.doesNotMatch(scopedHub, /<link rel="alternate" hreflang=/);
    assert.match(scopedHub, /<a href="\/zh-cn\/studies\/" aria-current="page">/);

    const detail = await readFile(join(outputDirectory, 'zh-cn', 'studies', 'smart-ev-data-controls-china', 'index.html'), 'utf8');
    assert.match(detail, /social\/study-smart-ev-data-controls-china-v1\.png/);
    assert.match(detail, /<meta property="og:locale" content="zh_CN"/);
    assert.match(detail, /<a href="\/zh-cn\/studies\/" aria-current="location">/);
    assert.doesNotMatch(detail, /<a href="\/zh-cn\/studies\/" aria-current="page">/);

    for (const study of sampleStudies) {
      const detailPath = join(outputDirectory, study.locale.toLowerCase(), 'studies', study.slug, 'study.json');
      const sourceTitle = JSON.parse(await readFile(detailPath, 'utf8')).brief.title;
      const svg = await readFile(join(outputDirectory, 'social', `study-${study.slug}-v1.svg`), 'utf8');
      assert.match(svg, /<image href="data:image\/png;base64,[^"]+" x="300" y="516" width="340" height="29"/);
      const titleLines = [...svg.matchAll(/<text x="300" y="(?:236|288|340)"[^>]*font-size="42"[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
      const cjkTitle = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(sourceTitle);
      const renderedTitle = titleLines.join(cjkTitle ? '' : ' ');
      assert.ok(
        renderedTitle === sourceTitle || (renderedTitle.endsWith('…') && sourceTitle.startsWith(renderedTitle.slice(0, -1))),
        `${study.slug} card title must be complete or visibly ellipsized`,
      );
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('social-card fallback supports Linux builds and rejects stale checked-in assets', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'likerts-social-fallback-'));
  const staleOutputDirectory = await mkdtemp(join(tmpdir(), 'likerts-social-stale-output-'));
  const fallbackDirectory = await mkdtemp(join(tmpdir(), 'likerts-social-stale-assets-'));
  const tamperedDirectory = await mkdtemp(join(tmpdir(), 'likerts-social-tampered-assets-'));
  try {
    await buildSampleStudyArtifacts({ studies: sampleStudies, outputDirectory, socialCardRasterizerAvailable: false });
    const fallbackCard = await readFile(join(outputDirectory, 'social', 'likerts-en-us-v1.png'));
    assert.deepEqual(fallbackCard.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    await cp(join(process.cwd(), 'public', 'social'), fallbackDirectory, { recursive: true });
    const manifestPath = join(fallbackDirectory, 'social-card-manifest-v1.json');
    const staleManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    staleManifest.cards['likerts-en-us-v1.png'].sourceSha256 = '0'.repeat(64);
    await writeFile(manifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);
    await assert.rejects(
      buildSampleStudyArtifacts({ studies: sampleStudies, outputDirectory: staleOutputDirectory, socialCardRasterizerAvailable: false, socialCardFallbackDirectory: fallbackDirectory }),
      /sources or PNG integrity/i,
    );

    await cp(join(process.cwd(), 'public', 'social'), tamperedDirectory, { recursive: true });
    const tamperedCardPath = join(tamperedDirectory, 'likerts-en-us-v1.png');
    const tamperedCard = await readFile(tamperedCardPath);
    tamperedCard[tamperedCard.length - 20] ^= 1;
    await writeFile(tamperedCardPath, tamperedCard);
    assert.equal(tamperedCard.readUInt32BE(16), 1200);
    assert.equal(tamperedCard.readUInt32BE(20), 630);
    await assert.rejects(
      buildSampleStudyArtifacts({ studies: sampleStudies, outputDirectory: staleOutputDirectory, socialCardRasterizerAvailable: false, socialCardFallbackDirectory: tamperedDirectory }),
      /sources or PNG integrity/i,
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
    await rm(staleOutputDirectory, { recursive: true, force: true });
    await rm(fallbackDirectory, { recursive: true, force: true });
    await rm(tamperedDirectory, { recursive: true, force: true });
  }
});

test('static detail pages localize quality and localization-lineage labels for every published locale', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'likerts-studies-localization-'));
  const expectedLabels = {
    'en-US': { automatedQa: 'Automated QA', nativeReview: 'Native review', registry: 'Localization registry' },
    'es-ES': { automatedQa: 'Control de calidad automatizado', nativeReview: 'Revisión por hablante nativo', registry: 'Registro de localización' },
    'pt-BR': { automatedQa: 'Controle de qualidade automatizado', nativeReview: 'Revisão por falante nativo', registry: 'Registro de localização' },
    'fr-FR': { automatedQa: 'Assurance qualité automatisée', nativeReview: 'Révision par locuteur natif', registry: 'Registre de localisation' },
    'de-DE': { automatedQa: 'Automatisierte Qualitätssicherung', nativeReview: 'Muttersprachliche Prüfung', registry: 'Lokalisierungsregister' },
    'zh-CN': { automatedQa: '自动质量检查', nativeReview: '母语审核', registry: '本地化登记' },
    'ja-JP': { automatedQa: '自動品質確認', nativeReview: 'ネイティブレビュー', registry: 'ローカリゼーション登録簿' },
    'ko-KR': { automatedQa: '자동 품질 검사', nativeReview: '원어민 검토', registry: '현지화 레지스트리' },
    'ar-SA': { automatedQa: 'فحص الجودة الآلي', nativeReview: 'مراجعة متحدث أصلي', registry: 'سجل الترجمة المحلية' },
    'hi-IN': { automatedQa: 'स्वचालित गुणवत्ता जांच', nativeReview: 'मूल-भाषी समीक्षा', registry: 'स्थानीयकरण रजिस्ट्री' },
  };

  try {
    await buildSampleStudyArtifacts({ studies: sampleStudies, outputDirectory });

    assert.deepEqual(Object.keys(expectedLabels).sort(), [...supportedSampleStudyLocales].sort());
    for (const study of sampleStudies) {
      const labels = expectedLabels[study.locale];
      const html = await readFile(join(outputDirectory, study.locale.toLowerCase(), 'studies', study.slug, 'index.html'), 'utf8');
      const detail = JSON.parse(await readFile(join(outputDirectory, study.locale.toLowerCase(), 'studies', study.slug, 'study.json'), 'utf8'));

      assert.deepEqual(detail.brief, study, `${study.locale} source-language brief remains frozen`);
      assert.ok(html.includes(`study-quality-badge-automated">${labels.automatedQa}:`), `${study.locale} automated QA label`);
      assert.ok(html.includes(`study-quality-badge-native">${labels.nativeReview}:`), `${study.locale} native-review label`);
      assert.ok(html.includes(`<dt>${labels.registry}</dt>`), `${study.locale} localization-registry label`);
      assert.match(html, /data-automated-qa-status="pending"/);
      assert.match(html, /data-native-review-status="review-pending"/);
      assert.match(html, /data-native-review-authority="registry-declared"/);
      assert.match(html, /data-native-review-release-eligible="false"/);
      if (study.locale !== 'en-US') {
        assert.equal(html.includes('study-quality-badge-automated">Automated QA:'), false, `${study.locale} must not show the English automated-QA label`);
        assert.equal(html.includes('study-quality-badge-native">Native review:'), false, `${study.locale} must not show the English native-review label`);
        assert.equal(html.includes('<dt>Localization registry</dt>'), false, `${study.locale} must not show the English localization-registry label`);
      }
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('live capture is explicitly opt-in and has bounded runs and cost before it can call a provider', () => {
  assert.throws(() => buildCapturePlan({ env: {}, argv: [] }), /LIKERTS_CAPTURE_SAMPLE_STUDIES=1/);
  const plan = buildCapturePlan({
    env: {
      LIKERTS_CAPTURE_SAMPLE_STUDIES: '1', LIKERTS_CAPTURE_MAX_RUNS: '2',
      LIKERTS_CAPTURE_MAX_ESTIMATED_COST_USD: '0.40', LIKERTS_CAPTURE_MAX_ACTUAL_COST_USD: '0.40',
      LIKERTS_CAPTURE_ESTIMATED_COST_PER_STUDY_USD: '0.10',
    },
    argv: ['--slug', sampleStudies[0].slug, '--url', 'https://likerts.com/api/synthetic-study'],
  });
  assert.equal(plan.mode, 'endpoint');
  assert.equal(plan.studies.length, 1);
  assert.equal(plan.maxRuns, 2);
  assert.equal(plan.concurrency, 1);
  assert.equal(plan.url, 'https://likerts.com/api/synthetic-study');
  assert.throws(() => buildCapturePlan({ env: { LIKERTS_CAPTURE_SAMPLE_STUDIES: '1' }, argv: [] }), /cost cap/i);
});
