import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildSampleStudyArtifacts } from '../scripts/build-sample-studies.mjs';

const cjkSamples = Object.freeze([
  {
    locale: 'zh-CN',
    slug: 'smart-ev-data-controls-china',
    capture: 'smart-ev-data-controls-china.json',
    quality: '自动质量检查: 已通过',
    nativeReview: '母语审核: 审核待定',
    localeName: '中文（中国）',
    market: '中国',
    industry: '电动出行',
    perspectiveDisclosure: '模型生成的观点，不是参与者引语。',
    stability: '这些稳定性指标只描述模型生成单元之间的一致性，不衡量人类确定性。',
    segmentBoundary: '这是模型构建的分析分群，不是观察到的参与者群体。',
    sourceLanguage: '来源语言',
  },
  {
    locale: 'ja-JP',
    slug: 'mobile-checkin-business-hotels-japan',
    capture: 'mobile-checkin-business-hotels-japan.json',
    quality: '自動品質確認: 合格',
    nativeReview: 'ネイティブレビュー: レビュー待ち',
    localeName: '日本語（日本）',
    market: '日本',
    industry: '旅行',
    perspectiveDisclosure: 'モデルが生成した視点であり、参加者の発言ではありません。',
    stability: 'この安定性指標は、モデル生成セル間の一致度だけを示し、人の確実性を測るものではありません。',
    segmentBoundary: 'これはモデルが構築した分析セグメントであり、観測された参加者集団ではありません。',
    sourceLanguage: '出典の言語',
  },
  {
    locale: 'ko-KR',
    slug: 'ad-supported-ott-plan-south-korea',
    capture: 'ad-supported-ott-plan-south-korea.json',
    quality: '자동 품질 검사: 통과',
    nativeReview: '원어민 검토: 검토 대기',
    localeName: '한국어(대한민국)',
    market: '대한민국',
    industry: '미디어',
    perspectiveDisclosure: '모델이 생성한 관점이며 참여자 인용이 아닙니다.',
    stability: '이 안정성 지표는 모델 생성 셀 간의 일치도만 설명하며 사람의 확실성을 측정하지 않습니다.',
    segmentBoundary: '이는 모델이 구성한 분석 세그먼트이며 관찰된 참여자 집단이 아닙니다.',
    sourceLanguage: '출처 언어',
  },
]);

test('CJK static artifacts localize presentation, fail closed on critic flags, and preserve canonical records', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'likerts-cjk-static-ux-'));
  const captures = await Promise.all(cjkSamples.map(async ({ capture }) => JSON.parse(await readFile(new URL(`../content/sample-study-captures/${capture}`, import.meta.url), 'utf8'))));

  try {
    await buildSampleStudyArtifacts({ captures, outputDirectory });

    for (const sample of cjkSamples) {
      const localeDirectory = sample.locale.toLowerCase();
      const detailPath = join(outputDirectory, localeDirectory, 'studies', sample.slug, 'index.html');
      const detail = await readFile(detailPath, 'utf8');
      const hub = await readFile(join(outputDirectory, localeDirectory, 'studies', 'index.html'), 'utf8');
      const capture = captures.find((candidate) => candidate.briefSlug === sample.slug);
      const record = JSON.parse(await readFile(join(outputDirectory, localeDirectory, 'studies', sample.slug, 'study.json'), 'utf8'));

      assert.equal(capture.verification.decision, 'flagged', `${sample.locale} fixture exercises the review-flag path`);
      assert.equal(record.capture.verification.decision, 'flagged', `${sample.locale} JSON preserves the canonical verification enum`);
      assert.equal(record.capture.study.takeaway, capture.study.takeaway, `${sample.locale} JSON preserves the canonical takeaway`);

      assert.equal(detail.includes(capture.study.takeaway), false, `${sample.locale} flagged takeaway is not a result summary`);
      assert.match(detail, /class="study-review-boundary"/, `${sample.locale} has a conservative review boundary`);
      assert.match(detail, /<dl class="study-meta"><div><dt>[^<]+<\/dt><dd>/, `${sample.locale} detail metadata uses valid definition-list children`);
      assert.doesNotMatch(detail, /<dl class="study-meta"><span>/, `${sample.locale} detail metadata has no invalid direct span child`);
      assert.match(detail, /class="critic-evidence"/, `${sample.locale} labels flagged claims as critic evidence`);
      assert.ok(detail.indexOf(capture.verification.critiqueSummary) > detail.indexOf('critic-evidence'), `${sample.locale} critique remains inside the labelled critic evidence section`);
      assert.equal(detail.includes('>flagged<'), false, `${sample.locale} never renders the raw verification enum`);
      assert.equal(detail.includes('4 undefined'), false, `${sample.locale} never renders the broken cohort-cell fallback`);

      assert.ok(detail.includes(sample.quality), `${sample.locale} localizes the automated-QA status exactly`);
      assert.ok(detail.includes(sample.nativeReview), `${sample.locale} keeps native review distinct from automated QA`);
      assert.match(detail, /data-automated-qa-scope="sample-brief-contract"/, `${sample.locale} exposes the exact automated-QA scope`);
      assert.equal(record.quality.automatedQa.scope, 'sample-brief-contract', `${sample.locale} preserves the QA scope in its JSON receipt`);
      assert.equal(record.capture.quality.automatedQa.scope, 'sample-brief-contract', `${sample.locale} preserves the QA scope in its captured JSON receipt`);
      assert.ok(detail.includes(sample.localeName), `${sample.locale} uses a locale-scoped breadcrumb`);
      assert.ok(detail.includes(`href="/${localeDirectory}/studies/"`), `${sample.locale} detail breadcrumb links to its locale hub`);
      assert.ok(detail.includes(`href="/${localeDirectory}/studies/#library-table"`), `${sample.locale} browse link stays in its locale scope`);
      assert.ok(detail.includes(sample.market), `${sample.locale} presents the market in the output locale`);
      assert.ok(detail.includes(sample.industry), `${sample.locale} presents the industry in the output locale`);
      assert.ok(hub.includes(sample.industry), `${sample.locale} hub presents the industry in the output locale`);
      assert.ok(detail.includes(sample.perspectiveDisclosure), `${sample.locale} localizes the fixed model-perspective disclosure`);
      assert.ok(detail.includes(sample.stability), `${sample.locale} localizes the fixed stability explanation`);
      assert.ok(record.capture.study.responses.every((response) => response.disclosure === sample.perspectiveDisclosure), `${sample.locale} localizes JSON response safeguards`);
      assert.ok(record.capture.study.segments.every((segment) => segment.boundary === sample.segmentBoundary), `${sample.locale} localizes JSON segment safeguards`);
      assert.equal(record.capture.stability.interpretation, sample.stability, `${sample.locale} localizes JSON stability safeguards`);
      assert.equal(record.capture.verification.note.includes('independent external verification'), false, `${sample.locale} does not leave the JSON verification safeguard in English`);
      assert.equal(record.capture.modelCard.disclosure.includes('attitudinal accuracy'), false, `${sample.locale} does not leave the JSON accuracy safeguard in English`);
      assert.ok(record.capture.evidence.ledger.every((source) => source.sourceLanguage && source.titleLanguage && source.excerptLanguage), `${sample.locale} records source, title, and excerpt language metadata`);
      assert.match(detail, new RegExp(`href="/\\?sample=${sample.slug}&uiLocale=${sample.locale}"`), `${sample.locale} rerun link pins the supported interface locale`);
      assert.match(detail, new RegExp(`href="/\\?uiLocale=${sample.locale}"`), `${sample.locale} static app links pin the supported interface locale`);
      assert.match(detail, /href="\/methodology\/" hreflang="en-US" aria-label=/, `${sample.locale} marks English-only documentation links`);
      assert.match(detail, /<span lang="en-US">English \(US\)<\/span>/, `${sample.locale} exposes the English destination label with language semantics`);
      assert.match(detail, /class="source-language" data-source-language="(?:en|zh|ja|ko)"/, `${sample.locale} labels source language in the rendered ledger`);
      assert.ok(detail.includes(sample.sourceLanguage), `${sample.locale} localizes the source-language label`);
      assert.match(detail, /class="related-study-link" href="[^"]+" lang="[^"]+" hreflang="[^"]+" aria-label=/, `${sample.locale} exposes related-study language metadata`);
      assert.match(detail, new RegExp(`<time datetime="${capture.capturedAt}">`), `${sample.locale} keeps the canonical receipt time in datetime`);
      assert.equal(detail.includes(`<time datetime="${capture.capturedAt}">${capture.capturedAt}</time>`), false, `${sample.locale} formats the human-visible receipt time`);
      assert.ok((detail.match(/href="\/research-standards\//g) || []).length >= 2, `${sample.locale} retains Research standards in the mobile fallback footer`);
      assert.ok(detail.includes(capture.evidence.ledger[0].title), `${sample.locale} allows canonical source content under the source ledger label`);
      assert.ok(detail.includes(capture.modelLineage[0].resolvedModel), `${sample.locale} allows canonical technical model identifiers under model disagreement`);

      assert.doesNotMatch(detail, /Automated QA passed · human editorial review pending|Model-generated perspective—not a participant quotation\.|Lower divergence and spread indicate greater agreement|Flagged — not a result summary|Critic evidence|Review boundary|This run was flagged/, `${sample.locale} has no English product-copy fallback`);
      assert.match(hub, /<table class="study-table"[^>]*aria-label=/, `${sample.locale} hub uses a native table`);
      assert.match(hub, /<thead><tr class="study-table-header">[\s\S]*?<th scope="col">/, `${sample.locale} hub supplies native column headers`);
      assert.match(hub, /<tbody><tr class="study-table-row"/, `${sample.locale} hub supplies native body rows`);
      assert.doesNotMatch(hub, /role="table"|role="row"|role="cell"/, `${sample.locale} hub avoids incomplete ARIA-table semantics`);
      assert.match(detail, /<meta property="og:image:alt" content="[^"\n]*[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/, `${sample.locale} localizes Open Graph metadata`);
      assert.match(detail, /"@type":"BreadcrumbList"[\s\S]*"name":"[^"\n]*[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/, `${sample.locale} localizes JSON-LD breadcrumb metadata`);
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('CJK static question copy remains readable at a 320px viewport without changing desktop rules', async () => {
  const styles = await readFile(new URL('../public/study-library.css', import.meta.url), 'utf8');
  const qualityBadges = styles.match(/\.study-quality-badges \{([^}]+)\}/)?.[1] || '';
  assert.match(qualityBadges, /display:\s*inline-flex/);
  assert.match(qualityBadges, /flex-wrap:\s*wrap/);
  assert.match(qualityBadges, /gap:\s*4px 12px/);

  const mobileCjkQuestionRule = styles.match(/@media \(max-width: 480px\) \{[\s\S]*?html:lang\(zh-Hans-CN\) \.study-detail-heading \.study-question,[\s\S]*?html:lang\(ko-KR\) \.study-detail-heading \.study-question \{([^}]+)\}/)?.[1] || '';

  assert.match(mobileCjkQuestionRule, /min-height:\s*4\.8em/);
  assert.match(mobileCjkQuestionRule, /font-size:\s*16px/);
  assert.match(mobileCjkQuestionRule, /line-height:\s*1\.7/);
  const desktopQuestionRule = styles.match(/\.study-detail-heading \.study-question \{([^}]+)\}/)?.[1] || '';
  assert.doesNotMatch(desktopQuestionRule, /min-height/, 'desktop question layout keeps its original compact height');

  const breadcrumbLink = styles.match(/\.study-breadcrumbs a \{([^}]+)\}/)?.[1] || '';
  const railMore = styles.match(/\.rail-more \{([^}]+)\}/)?.[1] || '';
  assert.match(breadcrumbLink, /min-height:\s*24px/);
  assert.match(railMore, /min-height:\s*44px/);

  const staticStyles = await readFile(new URL('../public/static-site.css', import.meta.url), 'utf8');
  const footerLink = staticStyles.match(/\.footer-nav a \{([^}]+)\}/)?.[1] || '';
  assert.match(footerLink, /min-height:\s*24px/);
  assert.match(styles, /\.study-library-page \.header-cta \{ color:\s*#fff; \}/);
  assert.match(styles, /\.study-detail-disclosure \{[^}]*color:\s*var\(--sl-blue-dark\)/);
  assert.match(styles, /\.study-detail-disclosure strong \{ color:\s*var\(--sl-blue-dark\); \}/);
});

test('synthetic perspectives keep disclosure, quote, and attribution in the readable content column on mobile', async () => {
  const styles = await readFile(new URL('../public/study-library.css', import.meta.url), 'utf8');
  const disclosureRule = styles.match(/\.perspective > small \{([^}]+)\}/)?.[1] || '';
  const quoteRule = styles.match(/\.perspective blockquote \{([^}]+)\}/)?.[1] || '';
  const citationRule = styles.match(/\.perspective cite \{([^}]+)\}/)?.[1] || '';
  assert.match(disclosureRule, /grid-column:\s*2\s*\/\s*-1/);
  assert.match(quoteRule, /grid-column:\s*2/);
  assert.match(citationRule, /grid-column:\s*3/);

  const mobileRules = styles.match(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(mobileRules, /\.perspective > small,\s*\.perspective blockquote,\s*\.perspective cite\s*\{\s*grid-column:\s*2/);
});

test('the semantic study table becomes a width-contained card list on mobile', async () => {
  const styles = await readFile(new URL('../public/study-library.css', import.meta.url), 'utf8');
  const mobileRules = styles.match(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(mobileRules, /\.study-table,\s*\.study-table tbody\s*\{[^}]*display:\s*block[^}]*width:\s*100%/);
  assert.match(mobileRules, /\.study-table thead\s*\{\s*display:\s*none/);
  assert.match(mobileRules, /\.study-table-row\s*\{[^}]*width:\s*100%/);
  assert.match(mobileRules, /\.featured-study-footer > span\s*\{[^}]*width:\s*100%[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/);
});

test('the static browser verifier discovers a real study row instead of a hub navigation link', async () => {
  const verifier = await readFile(new URL('../scripts/verify-study-library-browser.mjs', import.meta.url), 'utf8');
  assert.match(verifier, /discoveryPage\.locator\(['"]\[data-study-link\]['"]\)\.first\(\)/);
  assert.doesNotMatch(verifier, /\[data-study-link\][^'"\n]*,[^'"\n]*a\[href\*=/);
});
