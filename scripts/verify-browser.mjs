import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { strFromU8, unzipSync } from 'fflate';
import { sampleStudies } from '../content/sample-studies.mjs';
import {
  assertBrowserArtifactOutputOutsideRoot,
  buildBrowserArtifactManifest,
  createBrowserArtifactResponseVerifier,
  verifyServedBrowserArtifactManifest,
} from '../server/browser-artifact-binding.js';
import { buildHumanResearchHandoff } from '../server/human-research-handoff.js';
import { METHOD_RESULT_DISCLOSURE, validateMethodResult } from '../server/method-results.js';
import { RESEARCH_METHOD_IDS, buildResearchDesign, methodConfigSchema } from '../server/research-methods.js';
import { canonicalSampleLineageForSample } from '../server/sample-lineage.js';
import { CURRENT_LOCALIZATION_CATALOG_HASH } from '../server/localization-catalog-hash.js';
import { requestSchema } from '../server/synthetic-study-pipeline.js';
import {
  LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE,
  LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_DEEP_SURFACE_IDS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS,
  LOCALIZATION_BROWSER_API_MODE,
  LOCALIZATION_BROWSER_ATTESTED_FLOW_IDS,
  LOCALIZATION_BROWSER_EVIDENCE_MODE,
  LOCALIZATION_BROWSER_METHOD_IDS,
  LOCALIZATION_BROWSER_METHOD_RESULT_KINDS,
  LOCALIZATION_JOURNEY_GATE_VERSION,
  createLocalizationBrowserAttestation,
  validateLocalizationBrowserAttestation,
} from '../server/localization-browser-attestation.js';
import { CJK_LOCALE_IDS, LOCALE_CAPABILITIES, LOCALIZATION_REGISTRY_VERSION } from '../shared/localization.mjs';
import { ENGLISH_UI_CATALOG, UI_CATALOG_KEY_SET } from '../src/i18nCatalog.mjs';

const baseUrl = process.env.LIKERTS_BROWSER_URL || 'http://127.0.0.1:4173';
const baseOrigin = new URL(baseUrl).origin;
const automatedAccessibilityTags = LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS;
const viewportMatrix = [
  { width: 320, height: 844 },
  { width: 375, height: 900 },
  { width: 768, height: 1000 },
  { width: 1440, height: 1000 },
];
const fullJourneyWidthByLocale = Object.freeze({ 'zh-CN': 320, 'ja-JP': 375, 'ko-KR': 768 });
const cjkLocales = CJK_LOCALE_IDS.map((locale) => {
  const registryEntry = LOCALE_CAPABILITIES[locale];
  assert.ok(registryEntry, `${locale} must be present in the localization registry.`);
  return {
    locale,
    htmlLang: registryEntry.htmlLang,
    fullJourneyWidth: fullJourneyWidthByLocale[locale],
    uiCopyStatus: registryEntry.release.copyStatus,
    uiNativeReviewStatus: registryEntry.release.nativeReview.statusByCapability.ui,
  };
});
const samplesByLocale = Object.freeze(Object.fromEntries(cjkLocales.map(({ locale }) => [
  locale,
  Object.freeze(sampleStudies.filter((sample) => sample.locale === locale)),
])));
for (const { locale } of cjkLocales) assert.ok(samplesByLocale[locale].length, `${locale} must have a registered static sample.`);
const requiredSamplesByLocale = cjkLocales.map(({ locale }) => ({
  localeId: locale,
  samples: samplesByLocale[locale].map((sample) => {
    const lineage = canonicalSampleLineageForSample(sample);
    return {
      stableId: sample.stableId,
      slug: sample.slug,
      sampleSchemaVersion: sample.schemaVersion,
      quality: {
        automatedQaStatus: lineage.automatedQa.status,
        nativeReviewStatus: lineage.nativeReview.status,
      },
    };
  }),
}));
const specializedMethodIds = LOCALIZATION_BROWSER_METHOD_IDS;
const resultKindByMethod = Object.freeze({
  GENERAL_LIKERT: 'DIRECTIONAL_DISTRIBUTION',
  CONCEPT_TEST: 'DIRECTIONAL_DISTRIBUTION',
  PURCHASE_INTENT: 'DIRECTIONAL_DISTRIBUTION',
  MESSAGE_TEST: 'DIRECTIONAL_DISTRIBUTION',
  CLAIMS_TEST: 'DIRECTIONAL_DISTRIBUTION',
  UX_EXPECTATION_TEST: 'DIRECTIONAL_DISTRIBUTION',
  FEATURE_PRIORITIZATION: 'RANKED_ITEMS',
  BRAND_POSITIONING: 'ATTRIBUTE_MATRIX',
  PRICE_SENSITIVITY: 'PRICE_LADDER',
  SURVEY_PRETEST: 'INSTRUMENT_REVIEW',
  INTERVIEW_GUIDE: 'INTERVIEW_GUIDE',
});
const primaryQuestionTypeByMethod = Object.freeze({
  GENERAL_LIKERT: 'SINGLE_SELECT',
  CONCEPT_TEST: 'SINGLE_SELECT',
  PURCHASE_INTENT: 'SINGLE_SELECT',
  MESSAGE_TEST: 'SINGLE_SELECT',
  CLAIMS_TEST: 'SINGLE_SELECT',
  UX_EXPECTATION_TEST: 'SINGLE_SELECT',
  FEATURE_PRIORITIZATION: 'RANK_ORDER',
  BRAND_POSITIONING: 'MATRIX_SINGLE_SELECT',
  PRICE_SENSITIVITY: 'MATRIX_SINGLE_SELECT',
  SURVEY_PRETEST: 'OPEN_TEXT',
  INTERVIEW_GUIDE: 'OPEN_TEXT',
});
assert.deepEqual(
  RESEARCH_METHOD_IDS.filter((methodId) => methodId !== 'GENERAL_LIKERT'),
  specializedMethodIds,
  'The browser method matrix must stay aligned with the server research-method registry.',
);
assert.deepEqual(
  [...new Set(Object.values(resultKindByMethod))].sort(),
  [...LOCALIZATION_BROWSER_METHOD_RESULT_KINDS],
  'The browser result matrix must stay aligned with the signed method-result contract.',
);
// Every CJK locale executes the complete core journey at all four viewport
// cells. One designated cell per locale additionally executes every specialized
// method and the full static-sample persistence/lineage suite.
const allMatrix = cjkLocales.flatMap((locale) => viewportMatrix.map((viewport) => ({
  ...locale,
  ...viewport,
  fullJourney: true,
  deepJourney: viewport.width === locale.fullJourneyWidth,
})));
const localeFilter = new Set((process.env.VERIFY_BROWSER_LOCALES || '').split(',').map((value) => value.trim()).filter(Boolean));
const matrix = localeFilter.size ? allMatrix.filter((entry) => localeFilter.has(entry.locale)) : allMatrix;
assert.ok(matrix.length, 'VERIFY_BROWSER_LOCALES did not match a browser matrix locale.');
const screenshotSetting = process.env.VERIFY_BROWSER_SCREENSHOTS || '';
const screenshotDirectory = screenshotSetting
  ? path.resolve(screenshotSetting === '1' || screenshotSetting === 'true' ? 'design-qa-artifacts' : screenshotSetting)
  : '';
const attestationOutputPath = process.env.LIKERTS_BROWSER_ATTESTATION_OUT
  ? path.resolve(process.env.LIKERTS_BROWSER_ATTESTATION_OUT)
  : '';
const attestationBuildDirectory = path.resolve(process.env.LIKERTS_BROWSER_BUILD_DIRECTORY || 'dist');
const attestationBuildId = String(process.env.LIKERTS_BROWSER_BUILD_ID || '').trim();
const attestationPublicationStatus = String(process.env.LIKERTS_BROWSER_ATTESTATION_PUBLICATION_STATUS || 'CI_ARTIFACT').trim();
if (attestationOutputPath) {
  assert.equal(
    localeFilter.size,
    0,
    'Browser attestations require the complete 3-locale × 4-viewport matrix; VERIFY_BROWSER_LOCALES is for unsigned diagnostics only.',
  );
  await assertBrowserArtifactOutputOutsideRoot({
    rootDirectory: attestationBuildDirectory,
    outputPath: attestationOutputPath,
  });
}
const report = [];
const startedAt = Date.now();
const attestationArtifactManifest = attestationOutputPath
  ? await buildBrowserArtifactManifest(attestationBuildDirectory)
  : null;
if (attestationArtifactManifest) {
  const initialServedArtifact = await verifyServedBrowserArtifactManifest({
    manifest: attestationArtifactManifest,
    candidateUrl: baseUrl,
  });
  assert.equal(
    initialServedArtifact.verifiedFileCount,
    attestationArtifactManifest.files.length,
    'Every hashed build file must be served byte-for-byte by the browser candidate before the signed matrix begins.',
  );
}

// These strings deliberately retain their provenance: prompt/audience/concept
// are supplied study inputs; source* fields are source text; takeaway, response,
// and segmentAnswer are explicitly model-generated. The fixture never treats a
// generated answer as a participant quotation or invents translated source text.
const fixtures = Object.freeze({
  'zh-CN': Object.freeze({
    market: 'China', marketId: 'CN', countryCode: 'CN',
    prompt: '对于未来 36 个月内计划换车的城市公寓住户，这项家庭充电服务的采用意愿有多高？',
    audience: '中国城市公寓住户，25–54 岁，预计 36 个月内更换车辆',
    concept: '提供安装、维护和透明月费的家庭电动车充电服务，适合城市公寓住户。',
    title: '家庭充电服务的采用意愿',
    takeaway: '模型生成的方向性结果显示，安装可行性和月费透明度是继续验证的关键条件。',
    sourceTitle: '国家统计局：城镇人口与住房统计',
    sourceExcerpt: '城镇家庭住房与人口结构的公开统计摘录。',
    intendedPopulation: '未来 36 个月内计划换车的中国城市公寓成年住户',
    segmentLabel: '一线城市公寓住户',
    response: '如果安装条件清楚且费用稳定，我会把它列入换车预算。',
    responseProfile: '模型构建细分：城市通勤者',
    segmentAnswer: '模型生成的观点是：安装许可和停车位安排会显著影响这类细分人群的考虑。',
    segmentBasis: '基于公开住房结构来源、研究假设和模型推断。',
    matrix: { focalBrand: '安心充电', comparators: ['城市电力', '易充'], attributes: ['安装安心度', '费用透明度', '售后支持'] },
    currency: 'CNY', priceUnit: '每月', purchasePrice: 199, pricePoints: [99, 199, 299],
    category: '家庭电动车充电服务', purchaseChannel: '服务商网站', purchaseHorizon: '未来十二个月内', referenceAlternative: '继续使用公共充电站',
    message: '在城市公寓安装家用充电设施，月费清晰，并提供持续维护。', intendedAction: '查看安装资格',
    claim: '安装完成后，每月服务费用保持清晰且稳定。', uxContext: '首次在线预约安装', device: '手机浏览器',
    decisionContext: '选择下一阶段的服务投资', selectionConstraint: '按对安装决策的重要性从高到低排序',
    scaleLabels: ['非常低', '较低', '中等', '较高', '非常高'],
    sourceLanguage: 'zh', xlsxFirstSheet: '说明', localeScript: /[\u3400-\u9fff]/,
  }),
  'ja-JP': Object.freeze({
    market: 'Japan', marketId: 'JP', countryCode: 'JP',
    prompt: '36か月以内に車の買い替えを予定する都市部の集合住宅居住者は、この家庭用充電サービスをどの程度利用しそうですか？',
    audience: '日本の都市部の集合住宅居住者、25～54歳、36か月以内に車を買い替える予定',
    concept: '都市部の集合住宅向けに、設置、保守、明確な月額料金を含む家庭用EV充電サービス。',
    title: '家庭用充電サービスの利用意向',
    takeaway: 'モデル生成の方向性では、設置可否と月額料金の透明性が人による検証で確認すべき条件として示された。',
    sourceTitle: '総務省統計局：住宅・土地統計調査',
    sourceExcerpt: '都市部の集合住宅と世帯構成に関する公表統計の抜粋。',
    intendedPopulation: '36か月以内に車の買い替えを予定する日本の都市部集合住宅の成人居住者',
    segmentLabel: '大都市圏の集合住宅居住者',
    response: '設置の条件と費用が明確なら、買い替えの候補として検討したいです。',
    responseProfile: 'モデル構築セグメント：都市部の通勤者',
    segmentAnswer: 'モデル生成の視点では、管理組合の承認と駐車場の条件がこのセグメントの判断を左右します。',
    segmentBasis: '公表住宅統計、研究上の仮定、モデル推論に基づく。',
    matrix: { focalBrand: '安心充電', comparators: ['都市電力', 'かんたん充電'], attributes: ['設置の安心感', '料金の明確さ', 'サポート体制'] },
    currency: 'JPY', priceUnit: '月額', purchasePrice: 2_980, pricePoints: [1_980, 2_980, 3_980],
    category: '家庭用EV充電サービス', purchaseChannel: '事業者ウェブサイト', purchaseHorizon: '今後12か月以内', referenceAlternative: '公共充電器を引き続き利用する',
    message: '都市部の集合住宅に家庭用充電器を設置し、明確な月額料金と継続保守を提供します。', intendedAction: '設置条件を確認する',
    claim: '設置後の月額サービス料金は明確で安定しています。', uxContext: '初めてオンラインで設置を予約する場面', device: 'スマートフォンのブラウザ',
    decisionContext: '次期のサービス投資を選ぶ', selectionConstraint: '設置判断への重要度が高い順に並べる',
    scaleLabels: ['非常に低い', '低い', '中程度', '高い', '非常に高い'],
    sourceLanguage: 'ja', xlsxFirstSheet: '説明', localeScript: /[\u3040-\u30ff]/,
  }),
  'ko-KR': Object.freeze({
    market: 'South Korea', marketId: 'KR', countryCode: 'KR',
    prompt: '36개월 안에 차량 교체를 예상하는 도시 아파트 거주자는 이 가정용 충전 서비스를 얼마나 이용할 가능성이 있습니까?',
    audience: '대한민국 도시 아파트 거주자, 25–54세, 36개월 안에 차량 교체 예정',
    concept: '도시 아파트 거주자를 위해 설치, 유지보수, 명확한 월 요금을 제공하는 가정용 EV 충전 서비스입니다.',
    title: '가정용 충전 서비스 이용 의향',
    takeaway: '모델 생성 방향성은 설치 가능성과 월 요금의 투명성이 사람 대상 검증에서 확인할 핵심 조건임을 시사합니다.',
    sourceTitle: '통계청: 주택 및 인구 통계', sourceExcerpt: '도시 아파트와 가구 구조에 관한 공개 통계 발췌입니다.',
    intendedPopulation: '36개월 안에 차량 교체를 예상하는 대한민국 도시 아파트 성인 거주자',
    segmentLabel: '수도권 아파트 거주자', response: '설치 조건과 비용이 분명하다면 차량 교체 예산에 포함해 보겠습니다.',
    responseProfile: '모델 구성 세그먼트: 도시 통근자',
    segmentAnswer: '모델 생성 관점에서는 주차 공간과 관리 주체의 승인이 이 세그먼트의 판단에 큰 영향을 줍니다.',
    segmentBasis: '공개 주택 통계, 연구 가정 및 모델 추론에 기반합니다.',
    matrix: { focalBrand: '안심충전', comparators: ['도시전력', '간편충전'], attributes: ['설치 신뢰', '요금 투명성', '사후 지원'] },
    currency: 'KRW', priceUnit: '월간', purchasePrice: 29_900, pricePoints: [19_900, 29_900, 39_900],
    category: '가정용 전기차 충전 서비스', purchaseChannel: '서비스 제공업체 웹사이트', purchaseHorizon: '향후 12개월 이내', referenceAlternative: '공용 충전기를 계속 이용',
    message: '도시 아파트에 가정용 충전기를 설치하고 명확한 월 요금과 지속적인 유지보수를 제공합니다.', intendedAction: '설치 자격 확인하기',
    claim: '설치 후 월 서비스 요금은 명확하고 안정적으로 유지됩니다.', uxContext: '처음 온라인으로 설치를 예약하는 상황', device: '스마트폰 브라우저',
    decisionContext: '다음 단계 서비스 투자 선택', selectionConstraint: '설치 결정에 중요한 순서로 높은 항목부터 정렬',
    scaleLabels: ['매우 낮음', '낮음', '보통', '높음', '매우 높음'],
    sourceLanguage: 'ko', xlsxFirstSheet: '안내', localeScript: /[\uac00-\ud7af]/,
  }),
});

const hash = (character) => character.repeat(64);

const assertNoHorizontalOverflow = async (page, label) => {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  if (Math.max(dimensions.documentScrollWidth, dimensions.bodyScrollWidth) <= dimensions.viewport) return;
  const diagnostics = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    bodyClientWidth: document.body.clientWidth,
    offenders: [...document.querySelectorAll('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { selector: element.id ? `#${element.id}` : element.classList.length ? `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}` : element.tagName.toLowerCase(), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
      })
      .filter((rect) => rect.right > window.innerWidth + 1 || rect.left < -1)
      .slice(0, 12),
    scrollContainers: [document.documentElement, document.body, ...document.querySelectorAll('body *')]
      .map((element) => ({
        selector: element === document.documentElement ? 'html' : element === document.body ? 'body' : element.id ? `#${element.id}` : element.classList.length ? `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}` : element.tagName.toLowerCase(),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
      }))
      .filter((item) => item.scrollWidth > item.clientWidth + 1)
      .sort((left, right) => (right.scrollWidth - right.clientWidth) - (left.scrollWidth - left.clientWidth))
      .slice(0, 12),
  }));
  assert.fail(`${label} page horizontal overflow: ${JSON.stringify({ ...dimensions, ...diagnostics })}`);
};

const assertVisible = async (locator, message) => {
  await locator.waitFor({ state: 'visible' });
  assert.equal(await locator.isVisible(), true, message);
};

const assertScript = (value, fixture, message) => assert.match(String(value), fixture.localeScript, message);
const normalizedEnglishUiCopy = new Set(Object.values(ENGLISH_UI_CATALOG).map((value) => value.replace(/\s+/g, ' ').trim()));
const rawUiCatalogKeys = new Set(UI_CATALOG_KEY_SET);
const obviousEnglishFallback = /\b(?:the|this|your|with|without|from|before|after|research|source|model|people|language|selected|requires|available|not|and|for|of|is|are)\b/i;
const expectedScriptCharacters = Object.freeze({
  zh: /\p{Script=Han}/gu,
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  ko: /\p{Script=Hangul}/gu,
});

function assertLocalizedVisibleCopy(value, fixture, message) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  assert.ok(normalized.length > 0, `${message} is non-empty`);
  assert.equal(normalizedEnglishUiCopy.has(normalized), false, `${message} is not an English catalog fallback`);
  assert.equal(rawUiCatalogKeys.has(normalized), false, `${message} is not a raw catalog key`);
  assert.doesNotMatch(normalized, obviousEnglishFallback, `${message} contains no obvious English sentence fallback`);
  const requestedScriptCount = normalized.match(expectedScriptCharacters[fixture.sourceLanguage])?.length || 0;
  assert.ok(requestedScriptCount >= 2, `${message} contains substantive requested-script copy`);
  const unexpectedLatinTokens = (normalized.match(/\b[A-Za-z][A-Za-z0-9_-]*\b/g) || []).filter(
    (token) => !/^[A-Z][A-Z0-9_-]*$/.test(token)
      && !/^[A-Za-z]+(?:[-_][A-Za-z0-9]+)+$/.test(token),
  );
  assert.deepEqual(unexpectedLatinTokens, [], `${message} contains no untranslated Latin word tokens`);
}

const assertLocalizedControlLabel = assertLocalizedVisibleCopy;

async function assertLocalizedTextNodes(locator, fixture, message, { minimum = 1, requireVisible = true } = {}) {
  const count = await locator.count();
  assert.ok(count >= minimum, `${message} exposes at least ${minimum} text node(s)`);
  for (let index = 0; index < count; index += 1) {
    const node = locator.nth(index);
    if (requireVisible) assert.equal(await node.isVisible(), true, `${message} ${index + 1} is visible`);
    assertLocalizedVisibleCopy(await node.textContent(), fixture, `${message} ${index + 1}`);
  }
}

const assertKeyboardFocus = async (locator, message) => {
  await locator.focus();
  const focus = await locator.evaluate((element) => ({
    active: document.activeElement === element,
    focusVisible: element.matches(':focus-visible'),
    visibleIndicator: [element, element.parentElement, element.parentElement?.parentElement]
      .filter(Boolean)
      .some((candidate) => {
        const style = getComputedStyle(candidate);
        const outlineVisible = style.outlineStyle !== 'none'
          && Number.parseFloat(style.outlineWidth) > 0
          && style.outlineColor !== 'transparent'
          && style.outlineColor !== 'rgba(0, 0, 0, 0)';
        const shadowVisible = style.boxShadow !== 'none'
          && style.boxShadow !== 'rgba(0, 0, 0, 0) 0px 0px 0px 0px';
        return (candidate.matches(':focus-visible') || candidate.matches(':focus-within'))
          && (outlineVisible || shadowVisible);
      }),
  }));
  assert.equal(focus.active, true, `${message} receives keyboard focus`);
  assert.equal(focus.focusVisible, true, `${message} exposes a visible focus state`);
  assert.equal(focus.visibleIndicator, true, `${message} paints a non-transparent focus indicator`);
};

const decodeDownload = (artifact) => new TextDecoder('utf-8').decode(artifact.bytes);

const assertHumanHandoffExports = ({ artifacts, fixture, locale, label, methodId, runId }) => {
  const csv = decodeDownload(artifacts.csv);
  assertScript(csv, fixture, `${label} CSV contains localized respondent-facing content`);
  assert.match(csv, /Q_PRIMARY/, `${label} CSV preserves the canonical primary-question id`);
  assert.match(csv, /human-instrument-v1/, `${label} CSV preserves the canonical instrument id`);

  const text = decodeDownload(artifacts.txt);
  assertScript(text, fixture, `${label} text brief contains localized content`);
  assert.doesNotMatch(text, /\[SINGLE_SELECT\]/, `${label} text brief does not expose a raw question-type id as its human label`);
  assert.match(
    text,
    /(?:Technical type ID|类型技术 ID|種別の技術 ID|유형 기술 ID): SINGLE_SELECT/,
    `${label} text brief preserves the canonical question-type id in an explicit technical field`,
  );

  const receipt = JSON.parse(decodeDownload(artifacts.json));
  assert.equal(receipt.exportLocale, locale, `${label} JSON receipt export locale`);
  assert.equal(receipt.schemaVersion, 'human-research-handoff-v1', `${label} JSON receipt schema`);
  assert.match(receipt.handoffId, /^hrh_[a-f0-9]{24}$/, `${label} JSON receipt canonical handoff id`);
  assert.equal(receipt.lineage?.runId, runId, `${label} JSON receipt preserves the canonical run id`);
  assert.equal(receipt.lineage?.researchMethod, methodId, `${label} JSON receipt preserves the research method`);
  assert.equal(receipt.questionnaire?.instrumentVersion, 'human-instrument-v1', `${label} JSON receipt instrument schema`);
  assert.ok(receipt.questionnaire?.questionRecords?.some((entry) => entry.record?.questionId === 'Q_PRIMARY'), `${label} JSON receipt primary question`);
  assert.ok(JSON.stringify(receipt.questionnaire).includes(handoffNeedleFor(methodConfigFixture(fixture, methodId))), `${label} JSON receipt preserves the authored respondent-facing stimulus`);
  assertScript(`${receipt.banner} ${receipt.boundary}`, fixture, `${label} JSON receipt contains localized planning labels`);

  const xlsxFiles = unzipSync(new Uint8Array(artifacts.xlsx.bytes));
  assert.ok(xlsxFiles['xl/workbook.xml'], `${label} XLSX workbook manifest`);
  assert.ok(xlsxFiles['xl/worksheets/sheet1.xml'], `${label} XLSX first worksheet`);
  const workbook = strFromU8(xlsxFiles['xl/workbook.xml']);
  assert.match(workbook, new RegExp(`name="${fixture.xlsxFirstSheet}"`), `${label} XLSX uses localized sheet labels`);
  assertScript(workbook, fixture, `${label} XLSX workbook sheet labels use requested script`);
  const worksheetContent = Object.entries(xlsxFiles)
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .map(([, bytes]) => strFromU8(bytes))
    .join('\n');
  assert.match(worksheetContent, /Q_PRIMARY/, `${label} XLSX preserves the canonical primary-question id`);
  assertScript(worksheetContent, fixture, `${label} XLSX worksheet content contains localized respondent-facing copy`);
};

function methodConfigFixture(fixture, methodId) {
  switch (methodId) {
    case 'CONCEPT_TEST':
      return { method: methodId, concept: { id: 'concept-1', text: fixture.concept } };
    case 'PURCHASE_INTENT':
      return { method: methodId, offer: { id: 'offer-1', text: fixture.concept }, category: fixture.category, price: { amount: fixture.purchasePrice, currency: fixture.currency, unit: fixture.priceUnit }, channel: fixture.purchaseChannel, purchaseHorizon: fixture.purchaseHorizon, referenceAlternative: fixture.referenceAlternative };
    case 'MESSAGE_TEST':
      return { method: methodId, message: { id: 'message-1', text: fixture.message }, intendedAction: fixture.intendedAction, exposureContext: fixture.uxContext };
    case 'CLAIMS_TEST':
      return { method: methodId, claim: { id: 'claim-1', text: fixture.claim }, claimStatus: 'UNVERIFIED', exposureContext: fixture.uxContext };
    case 'UX_EXPECTATION_TEST':
      return { method: methodId, taskScenario: { id: 'task-1', text: fixture.prompt }, userGoal: fixture.intendedAction, experienceDescription: fixture.concept, context: fixture.uxContext, device: fixture.device };
    case 'FEATURE_PRIORITIZATION':
      return { method: methodId, features: fixture.matrix.attributes.map((text, index) => ({ id: `feature-${index + 1}`, text })), decisionContext: fixture.decisionContext, selectionConstraint: fixture.selectionConstraint };
    case 'BRAND_POSITIONING':
      return { method: methodId, focalBrand: { id: 'focal-brand', label: fixture.matrix.focalBrand }, comparatorBrands: fixture.matrix.comparators.map((label, index) => ({ id: `brand-${index + 1}`, label })), category: fixture.category, attributes: fixture.matrix.attributes.map((label, index) => ({ id: `attribute-${index + 1}`, label })) };
    case 'PRICE_SENSITIVITY':
      return { method: methodId, offer: { id: 'offer-1', text: fixture.concept }, category: fixture.category, currency: fixture.currency, unit: fixture.priceUnit, channel: fixture.purchaseChannel, purchaseHorizon: fixture.purchaseHorizon, referenceAlternative: fixture.referenceAlternative, pricePoints: fixture.pricePoints.map((amount, index) => ({ id: `price-${index + 1}`, amount })) };
    case 'SURVEY_PRETEST':
      return { method: methodId, studyObjective: fixture.prompt, targetPopulation: fixture.audience, surveyQuestions: [{ id: 'question-1', text: fixture.prompt }] };
    case 'INTERVIEW_GUIDE':
      return { method: methodId, researchObjective: fixture.prompt, participantContext: fixture.audience, topics: fixture.matrix.attributes.slice(0, 2).map((label, index) => ({ id: `topic-${index + 1}`, label })) };
    default:
      throw new TypeError(`Unsupported browser research method fixture: ${methodId}`);
  }
}

function methodAuthoringPlan(fixture, methodId) {
  const config = methodConfigFixture(fixture, methodId);
  switch (methodId) {
    case 'CONCEPT_TEST': return { fields: { 'concept-stimulus': config.concept.text }, selects: {}, lists: {} };
    case 'PURCHASE_INTENT': return { fields: { 'purchase-offer': config.offer.text, 'purchase-category': config.category, 'purchase-price': config.price.amount, 'purchase-currency': config.price.currency, 'purchase-unit': config.price.unit, 'purchase-channel': config.channel, 'purchase-horizon': config.purchaseHorizon, 'purchase-alternative': config.referenceAlternative }, selects: {}, lists: {} };
    case 'MESSAGE_TEST': return { fields: { 'message-stimulus': config.message.text, 'intended-action': config.intendedAction, 'message-exposure-context': config.exposureContext }, selects: {}, lists: {} };
    case 'CLAIMS_TEST': return { fields: { 'claim-stimulus': config.claim.text, 'claim-exposure-context': config.exposureContext }, selects: { 'claim-status': config.claimStatus }, lists: {} };
    case 'UX_EXPECTATION_TEST': return { fields: { 'task-scenario': config.taskScenario.text, 'user-goal': config.userGoal, 'experience-description': config.experienceDescription, 'ux-context': config.context, 'ux-device': config.device }, selects: {}, lists: {} };
    case 'FEATURE_PRIORITIZATION': return { fields: { 'decision-context': config.decisionContext, 'selection-constraint': config.selectionConstraint }, selects: {}, lists: { 'feature-items': config.features.map((item) => item.text) } };
    case 'BRAND_POSITIONING': return { fields: { 'focal-brand': config.focalBrand.label, 'brand-category': config.category }, selects: {}, lists: { 'comparator-brands': config.comparatorBrands.map((item) => item.label), 'brand-attributes': config.attributes.map((item) => item.label) } };
    case 'PRICE_SENSITIVITY': return { fields: { 'price-offer': config.offer.text, 'price-category': config.category, 'price-currency': config.currency, 'price-unit': config.unit, 'price-channel': config.channel, 'price-horizon': config.purchaseHorizon, 'price-alternative': config.referenceAlternative }, selects: {}, lists: { 'price-points': config.pricePoints.map((item) => item.amount) } };
    case 'SURVEY_PRETEST': return { fields: { 'study-objective': config.studyObjective, 'target-population': config.targetPopulation }, selects: {}, lists: { 'survey-questions': config.surveyQuestions.map((item) => item.text) } };
    case 'INTERVIEW_GUIDE': return { fields: { 'research-objective': config.researchObjective, 'participant-context': config.participantContext }, selects: {}, lists: { 'interview-topics': config.topics.map((item) => item.label), 'sensitive-areas': [] } };
    default: throw new TypeError(`Unsupported browser authoring plan: ${methodId}`);
  }
}

function handoffNeedleFor(config) {
  switch (config.method) {
    case 'CONCEPT_TEST': return config.concept.text;
    case 'PURCHASE_INTENT': return config.offer.text;
    case 'MESSAGE_TEST': return config.message.text;
    case 'CLAIMS_TEST': return config.claim.text;
    case 'UX_EXPECTATION_TEST': return config.taskScenario.text;
    case 'FEATURE_PRIORITIZATION': return config.features[0].text;
    case 'BRAND_POSITIONING': return config.focalBrand.label;
    case 'PRICE_SENSITIVITY': return config.offer.text;
    case 'SURVEY_PRETEST': return config.surveyQuestions[0].text;
    case 'INTERVIEW_GUIDE': return config.topics[0].label;
    default: throw new TypeError(`Unsupported handoff fixture: ${config.method}`);
  }
}

function buildMockMethodResult({ fixture, methodConfig, researchDesign }) {
  const base = {
    contractVersion: 'method-result-v1',
    disclosure: METHOD_RESULT_DISCLOSURE,
    accessibleLabel: fixture.title,
    summary: fixture.takeaway,
  };
  let result;
  switch (methodConfig.method) {
    case 'GENERAL_LIKERT':
    case 'CONCEPT_TEST':
    case 'PURCHASE_INTENT':
    case 'MESSAGE_TEST':
    case 'CLAIMS_TEST':
    case 'UX_EXPECTATION_TEST':
      result = { ...base, kind: 'DIRECTIONAL_DISTRIBUTION', scale: { id: researchDesign.scale.id, labels: fixture.scaleLabels }, distribution: [8, 12, 11, 30, 39] };
      break;
    case 'FEATURE_PRIORITIZATION':
      result = { ...base, kind: 'RANKED_ITEMS', rankingLabel: fixture.decisionContext, items: methodConfig.features.map((item, index) => ({ id: item.id, label: item.text, rank: index + 1, rationale: fixture.takeaway })) };
      break;
    case 'BRAND_POSITIONING': {
      const attributes = methodConfig.attributes.map((attribute) => ({ ...attribute }));
      result = { ...base, kind: 'ATTRIBUTE_MATRIX', matrixLabel: methodConfig.focalBrand.label, attributes, brands: [methodConfig.focalBrand, ...methodConfig.comparatorBrands].map((brand, brandIndex) => ({ id: brand.id, label: brand.label, associations: attributes.map((attribute, attributeIndex) => ({ attributeId: attribute.id, level: brandIndex === 0 && attributeIndex < 2 ? 'HIGH' : attributeIndex === 1 ? 'MEDIUM' : 'LOW', accessibleLabel: `${brand.label}：${attribute.label}` })) })) };
      break;
    }
    case 'PRICE_SENSITIVITY': {
      const distributions = [[8, 12, 11, 30, 39], [10, 15, 15, 30, 30], [15, 20, 20, 25, 20]];
      result = { ...base, kind: 'PRICE_LADDER', scale: { id: researchDesign.scale.id, labels: fixture.scaleLabels }, priceContext: { currency: methodConfig.currency, unit: methodConfig.unit }, points: methodConfig.pricePoints.map((point, index) => ({ id: point.id, label: `${point.amount} ${methodConfig.currency} ${methodConfig.unit}`, amount: point.amount, distribution: distributions[index] })) };
      break;
    }
    case 'SURVEY_PRETEST':
      result = { ...base, kind: 'INSTRUMENT_REVIEW', issues: [{ id: 'issue-1', questionId: methodConfig.surveyQuestions[0].id, severity: 'MEDIUM', category: fixture.title, explanation: fixture.takeaway, revisionSuggestion: fixture.response }], coverageGaps: [fixture.segmentBasis], suggestedCognitiveProbes: [fixture.prompt] };
      break;
    case 'INTERVIEW_GUIDE':
      result = { ...base, kind: 'INTERVIEW_GUIDE', opening: fixture.segmentBasis, questions: methodConfig.topics.map((topic, index) => ({ id: `guide-${index + 1}`, topicId: topic.id, prompt: index === 0 ? fixture.prompt : fixture.response, probes: [fixture.takeaway] })), moderatorNotes: [fixture.uxContext], consentAndAccessibilityNotes: [fixture.segmentBasis], closing: fixture.response };
      break;
    default:
      throw new TypeError(`Unsupported browser method-result fixture: ${methodConfig.method}`);
  }
  const validation = validateMethodResult(result);
  assert.equal(validation.success, true, `${methodConfig.method} mock result must satisfy method-result-v1: ${validation.error?.message || ''}`);
  return validation.data;
}

function localizedPopulationFrame(fixture, locale) {
  const sourceId = `official-${fixture.marketId.toLowerCase()}-housing`;
  return {
    frameVersion: 'population-frame-v1', intendedPopulation: fixture.intendedPopulation,
    geography: { market: fixture.market, countryCode: fixture.countryCode }, languages: { outputLocale: locale, sourceLanguages: [fixture.sourceLanguage] }, characteristics: [{ id: 'housing', label: fixture.segmentLabel }],
    officialSourceDatasets: [{ id: sourceId, title: fixture.sourceTitle, publisher: fixture.sourceTitle, url: `https://official.example.invalid/${fixture.marketId.toLowerCase()}/housing`, coverageDate: '2026-01-01', verificationStatus: 'CURATED_OFFICIAL' }],
    marginalDistributions: [{ variable: 'age', label: fixture.segmentLabel, sourceDatasetId: sourceId, categories: [{ value: '25–34', share: 0.38 }, { value: '35–54', share: 0.62 }] }],
    knownIntersections: [{ variables: ['age', 'housing'], status: 'PARTIAL' }], populationCells: [],
    weighting: { method: 'RAKING_IPF', status: 'CONVERGED', diagnostics: { iterations: 7, tolerance: 0.001, maxAbsoluteError: 0.002, minWeight: 0.72, maxWeight: 1.28, effectiveCellCount: 24 } },
    unsupportedCharacteristics: [fixture.segmentLabel], coverageDate: '2026-01-01',
    populationFit: { scoreVersion: 'population-fit-v1', status: 'MEASURED', overall: 74, components: { geographyCoverage: 100, marginalCoverage: 75, intersectionCoverage: 40, sourceQuality: 100, sourceRecency: 100, weightingQuality: 80 }, formula: 'POPULATION_FIT_V1' },
    disclaimer: 'Demographic and language fit do not prove attitudinal accuracy.',
  };
}

function buildMockStudyPayload(locale, runIndex, requestPayload) {
  const fixture = fixtures[locale];
  const normalizedRequest = requestSchema.parse(requestPayload);
  const localization = structuredClone(normalizedRequest.localization);
  const methodConfig = requestPayload.methodConfig ? structuredClone(requestPayload.methodConfig) : null;
  const resultMethodConfig = methodConfig || { method: requestPayload.researchMethod };
  const input = {
    prompt: requestPayload.prompt,
    audience: requestPayload.audience,
    assumptions: requestPayload.assumptions,
    market: requestPayload.market,
    outputLocale: locale,
    localization,
    researchMethod: requestPayload.researchMethod,
    ...(methodConfig ? { methodConfig } : {}),
    ...(requestPayload.sampleLineage ? { sampleLineage: structuredClone(requestPayload.sampleLineage) } : {}),
  };
  const researchDesign = buildResearchDesign(input, { distribution: [8, 12, 11, 30, 39] });
  assert.equal(researchDesign.resultKind, resultKindByMethod[input.researchMethod], `${input.researchMethod} design result kind`);
  const methodResult = buildMockMethodResult({ fixture, methodConfig: resultMethodConfig, researchDesign });
  const populationFrame = localizedPopulationFrame(fixture, locale);
  const runId = `browser_${locale.replace('-', '_')}_${runIndex}`;
  const studyId = `browser_study_${locale.replace('-', '_')}`;
  const evidenceHash = hash(runIndex % 2 ? 'a' : 'b');
  const inputHash = createHash('sha256').update(JSON.stringify({ prompt: input.prompt, audience: input.audience, localization: input.localization, researchMethod: input.researchMethod, methodConfig, sampleLineage: input.sampleLineage || null })).digest('hex');
  const reproducibility = { inputHash, inputHashVersion: 'study-input-v3', evidenceHash, populationFrameHash: hash('d'), researchDesignHash: createHash('sha256').update(JSON.stringify(researchDesign)).digest('hex'), modelCardHash: hash('f'), runtimeVersion: 'synthetic-research-v2.browser-fixture', researchMethod: input.researchMethod, localization, localizationRegistryVersion: localization.registryVersion, sampleLineage: input.sampleLineage || null, promptVersions: { panel: 'panel-v4' }, schemaVersions: { panel: 'study-schema-v1' }, modelRoutes: [{ stage: 'panel', model: 'mock/cjk-browser-fixture' }] };
  const source = { id: 'source-1', title: fixture.sourceTitle, url: `https://official.example.invalid/${fixture.marketId.toLowerCase()}/housing`, excerpt: fixture.sourceExcerpt, originalLanguage: fixture.sourceLanguage, evidenceClass: 'RETRIEVED_SOURCE', acquisition: 'RETRIEVED' };
  const handoff = buildHumanResearchHandoff({ input, frame: { neutralQuestion: input.prompt }, researchDesign, populationFrame, study: { cautions: [fixture.takeaway] }, reproducibility, evidenceCatalog: [source], studyId, runId, generatedAt: '2026-08-29T12:00:00.000Z' });
  if (input.researchMethod === 'GENERAL_LIKERT') {
    assert.equal(handoff.status, 'BLOCKED', 'GENERAL_LIKERT handoff remains blocked until a specialized human-research method is authored');
    assert.ok(handoff.blockingIssues.includes('GENERAL_LIKERT_REQUIRES_SPECIALIZED_METHOD'), 'GENERAL_LIKERT handoff records its method-design blocker');
  } else {
    assert.equal(handoff.status, 'READY_FOR_RESEARCHER_REVIEW', `${input.researchMethod} handoff must be a reviewable draft`);
    assert.deepEqual(handoff.blockingIssues, [], `${input.researchMethod} handoff must not hide respondent-copy blockers`);
    assert.equal(handoff.questionnaire.language, locale, `${input.researchMethod} handoff instrument locale`);
    assert.ok(handoff.questionnaire.questions.some((question) => question.questionId === 'Q_PRIMARY' && question.type === primaryQuestionTypeByMethod[input.researchMethod]), `${input.researchMethod} handoff primary question contract`);
    assertScript(JSON.stringify(handoff.questionnaire), fixture, `${input.researchMethod} handoff questionnaire uses requested script`);
  }
  const modelCard = { cardVersion: 'likerts-model-card-v1', purpose: 'DIRECTIONAL_SYNTHETIC_RESEARCH', permittedUse: 'HYPOTHESIS_GENERATION_AND_RESEARCH_PLANNING', prohibitedUses: ['Population estimation', 'Claims of observed attitudes', 'Synthetic confidence intervals'], populationGrounding: 'RAKING_IPF', populationFrameHash: reproducibility.populationFrameHash, attitudinalValidation: 'NOT_VALIDATED', disclosure: 'DEMOGRAPHIC_AND_LANGUAGE_FIT_DO_NOT_PROVE_ATTITUDINAL_ACCURACY' };
  const modelLineage = ['framing', 'panel', 'adjudication'].map((stage) => ({ stage, requestedModel: 'mock/cjk-browser-fixture', resolvedModel: 'mock/cjk-browser-fixture', status: 'completed' }));
  const run = {
    studyId, runId, clientRunId: requestPayload.clientRunId || null, inputHash: reproducibility.inputHash, localization,
    credibility: { evidenceMode: 'EXA_GATEWAY', reviewCompleted: true, limitations: [fixture.takeaway], stability: { applicable: true, cellCount: 6, maxPercentagePointSpread: 3, meanJensenShannonDivergence: 0.012 } },
    evidence: { mode: 'EXA_GATEWAY', evidenceHash, catalog: [source], ledger: [source] }, populationFrame, modelCard, researchDesign,
    methodResult, sampleLineage: input.sampleLineage || null,
    humanResearchHandoff: handoff, reproducibility, stability: { applicable: true, cellCount: 6, maxPercentagePointSpread: 3, meanJensenShannonDivergence: 0.012 },
    stages: [{ stage: 'framing', status: 'completed' }, { stage: 'panel', status: 'completed' }, { stage: 'adjudication', status: 'completed' }], modelLineage,
  };
  const study = {
    title: fixture.title, summary: fixture.takeaway, takeaway: fixture.takeaway, audienceSummary: { audienceLabel: input.audience, contextLabel: input.market, attributes: [] },
    ...(methodResult.kind === 'DIRECTIONAL_DISTRIBUTION' ? {
      distribution: [...methodResult.distribution],
      segments: [{ id: 'segment-urban', kind: 'MODEL_CONSTRUCTED', label: fixture.segmentLabel, values: [6, 10, 12, 29, 43], boundary: 'MODEL_CONSTRUCTED_NOT_OBSERVED' }, { id: 'segment-budget', kind: 'MODEL_CONSTRUCTED', label: fixture.responseProfile, values: [10, 14, 12, 28, 36], boundary: 'MODEL_CONSTRUCTED_NOT_OBSERVED' }],
      responses: [{ score: 5, profile: fixture.responseProfile, quote: fixture.response, disclosure: 'MODEL_GENERATED_PERSPECTIVE_NOT_PARTICIPANT_QUOTATION' }, { score: 4, profile: fixture.segmentLabel, quote: fixture.takeaway, disclosure: 'MODEL_GENERATED_PERSPECTIVE_NOT_PARTICIPANT_QUOTATION' }],
    } : { segments: [], responses: [] }),
    cautions: [fixture.takeaway],
  };
  return {
    study,
    run,
    meta: { studyId, runId, generatedAt: '2026-08-29T12:00:00.000Z', outputLocale: locale, localization, modelLineage, sampleLineage: input.sampleLineage || null, reproducibility, provenance: reproducibility },
    persistence: {
      status: 'session-only',
      durableStoreConfigured: false,
      retrieval: null,
      note: 'Fixture-backed browser evidence; no durable server store is configured.',
      clientRecord: { input, study, run },
    },
  };
}

function buildSegmentPerspectivePayload(locale, request, responseIndex) {
  const fixture = fixtures[locale];
  const history = Array.isArray(request.history) ? request.history : [];
  return {
    conversationId: request.conversationId || `conversation_${locale.replace('-', '_')}`, turnId: `turn_${responseIndex}`, answer: fixture.segmentAnswer, basisSummary: fixture.segmentBasis,
    evidenceUsed: [{ id: 'source-1', title: fixture.sourceTitle, url: `https://official.example.invalid/${fixture.marketId.toLowerCase()}/housing`, excerpt: fixture.sourceExcerpt, originalLanguage: fixture.sourceLanguage }], assumptionsUsed: [{ id: 'assumption-1', text: fixture.concept }], context: { evidenceHash: hash('a'), populationFrameHash: hash('d') }, disclosure: 'MODEL_GENERATED_PERSPECTIVE_NOT_PARTICIPANT_QUOTATION', testReceipt: { intent: request.intent || 'FOLLOW_UP', historyTurns: history.length },
  };
}

const expectDownload = async (page, trigger, extension, label) => {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), new RegExp(`\\.${extension}$`, 'i'), `${label} ${extension} download filename`);
  const downloadedPath = await download.path();
  assert.ok(downloadedPath, `${label} ${extension} download has a readable local artifact`);
  const bytes = await fs.readFile(downloadedPath);
  assert.ok(bytes.byteLength > 0, `${label} ${extension} download is non-empty`);
  return { download, bytes };
};

const tab = async (page, id, label) => {
  const button = page.locator(`#result-tab-${id}`);
  if (await button.isVisible()) {
    await button.click();
  } else {
    const picker = page.locator('#result-section-picker');
    await assertVisible(picker, `${label} compact ${id} section picker`);
    await picker.selectOption(id);
  }
  await page.locator('#result-panel').waitFor({ state: 'visible' });
};

function createAccessibilitySurfaceEvidence({ page, label, deepCoverage }) {
  const expectedSurfaceIds = deepCoverage
    ? [...LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS]
    : [...LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS];
  assert.deepEqual(
    [...LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS],
    [...LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS, ...LOCALIZATION_BROWSER_ACCESSIBILITY_DEEP_SURFACE_IDS],
    'The canonical browser accessibility surface registry preserves core surfaces before deep-only surfaces.',
  );
  assert.equal(new Set(expectedSurfaceIds).size, expectedSurfaceIds.length, 'Each browser accessibility surface id is unique.');

  const checksBySurfaceId = new Map(expectedSurfaceIds.map((surfaceId) => [surfaceId, {
    surfaceId,
    snapshotCount: 0,
    violations: 0,
  }]));
  let engineVersion = null;
  const expectedSnapshots = new Map(LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS.map((surfaceId) => [surfaceId, 1]));
  if (deepCoverage) {
    expectedSnapshots.set('required-source-error', 1);
    expectedSnapshots.set('specialized-method-results', specializedMethodIds.length);
    expectedSnapshots.set('specialized-method-handoffs', specializedMethodIds.length);
    expectedSnapshots.set('static-sample-detail', 1);
    expectedSnapshots.set('restored-sample-project', 1);
  }

  return {
    async snapshot(surfaceId) {
      const check = checksBySurfaceId.get(surfaceId);
      assert.ok(check, `${label} ${surfaceId} is a declared accessibility surface for this matrix cell.`);
      const results = await new AxeBuilder({ page }).withTags([...automatedAccessibilityTags]).analyze();
      const violations = results.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodeCount: nodes.length,
        targets: nodes.slice(0, 8).flatMap((node) => node.target).sort(),
      })).sort((left, right) => left.id.localeCompare(right.id) || String(left.impact).localeCompare(String(right.impact)));
      check.snapshotCount += 1;
      check.violations += violations.length;
      assert.deepEqual(violations, [], `${label} ${surfaceId} automated WCAG 2.1 A/AA violations: ${JSON.stringify(violations)}`);
      if (engineVersion) assert.equal(results.testEngine.version, engineVersion, `${label} axe engine version remains stable across surfaces`);
      else engineVersion = results.testEngine.version;
    },

    finalize() {
      assert.ok(engineVersion, `${label} records an axe engine version after scanning accessibility surfaces.`);
      const surfaceChecks = expectedSurfaceIds.map((surfaceId) => ({ ...checksBySurfaceId.get(surfaceId) }));
      for (const check of surfaceChecks) {
        assert.equal(
          check.snapshotCount,
          expectedSnapshots.get(check.surfaceId),
          `${label} ${check.surfaceId} accessibility snapshot coverage`,
        );
      }
      return {
        engine: LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE,
        engineVersion,
        rulesetTags: [...automatedAccessibilityTags],
        surfaceChecks,
        violations: surfaceChecks.reduce((total, check) => total + check.violations, 0),
      };
    },
  };
}

async function assertReportTabKeyboardNavigation(page, label) {
  const tablist = page.locator('[role="tablist"]');
  if (!await tablist.isVisible()) return;
  const overview = page.locator('#result-tab-overview');
  const segments = page.locator('#result-tab-segments');
  const method = page.locator('#result-tab-method');
  await assertVisible(overview, `${label} report overview tab`);
  await assertVisible(segments, `${label} report segments tab`);
  await assertVisible(method, `${label} report method tab`);
  await overview.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => {
    const tab = document.querySelector('#result-tab-segments');
    return tab?.getAttribute('aria-selected') === 'true' && document.activeElement === tab;
  });
  assert.equal(await segments.evaluate((element) => document.activeElement === element), true, `${label} ArrowRight activates and focuses the next report tab`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => {
    const tab = document.querySelector('#result-tab-overview');
    return tab?.getAttribute('aria-selected') === 'true' && document.activeElement === tab;
  });
  assert.equal(await overview.evaluate((element) => document.activeElement === element), true, `${label} ArrowLeft activates and focuses the prior report tab`);
  await page.keyboard.press('End');
  await page.waitForFunction(() => {
    const tab = document.querySelector('#result-tab-method');
    return tab?.getAttribute('aria-selected') === 'true' && document.activeElement === tab;
  });
  assert.equal(await method.evaluate((element) => document.activeElement === element), true, `${label} End activates and focuses the final report tab`);
  await page.keyboard.press('Home');
  await page.waitForFunction(() => {
    const tab = document.querySelector('#result-tab-overview');
    return tab?.getAttribute('aria-selected') === 'true' && document.activeElement === tab;
  });
  assert.equal(await overview.evaluate((element) => document.activeElement === element), true, `${label} Home activates and focuses the first report tab`);
}

async function assertKeyboardDetailsToggle(page, details, label) {
  const summary = details.locator('summary');
  await assertVisible(summary, `${label} handoff disclosure summary`);
  await summary.focus();
  assert.equal(await summary.evaluate((element) => document.activeElement === element), true, `${label} handoff disclosure receives keyboard focus`);
  await page.keyboard.press('Space');
  await page.waitForFunction((element) => element.open, await details.elementHandle());
  assert.equal(await details.evaluate((element) => element.open), true, `${label} Space opens the handoff disclosure`);
  await page.keyboard.press('Enter');
  await page.waitForFunction((element) => !element.open, await details.elementHandle());
  assert.equal(await details.evaluate((element) => element.open), false, `${label} Enter closes the handoff disclosure`);
}

async function configureCjkStudy(page, fixture, locale, htmlLang, label) {
  await page.locator('#research-question').fill(fixture.prompt);
  await page.locator('#audience').fill(fixture.audience);
  await page.locator('#concept-stimulus').fill(fixture.concept);
  const context = page.locator('details.composer-context');
  await context.locator(':scope > summary').click();
  await page.locator('#market').selectOption(fixture.market);
  await page.locator('#report-language').selectOption(locale);
  await page.locator('#instrument-language').selectOption(locale);
  const sourceLanguages = page.locator('#source-languages');
  const sourceDetails = sourceLanguages.locator('details');
  if (!await sourceDetails.evaluate((element) => element.open)) await sourceDetails.locator('summary').click();
  const sourceLanguageOption = sourceLanguages.locator(`label:has(span[lang="${htmlLang}"])`);
  await sourceLanguageOption.click();
  assert.equal(await sourceLanguageOption.locator('input[type="checkbox"]').isChecked(), true, `${label} requested source locale checked`);
  await page.locator('#retrieval-policy').selectOption('REQUIRE');
  const retrievalLocales = page.locator('#retrieval-locales');
  const retrievalDetails = retrievalLocales.locator('details');
  if (!await retrievalDetails.evaluate((element) => element.open)) await retrievalDetails.locator('summary').click();
  const retrievalLocaleOption = retrievalLocales.locator(`label:has(span[lang="${htmlLang}"])`);
  await retrievalLocaleOption.click();
  assert.equal(await retrievalLocaleOption.locator('input[type="checkbox"]').isChecked(), true, `${label} requested retrieval locale checked`);
  await assertNoHorizontalOverflow(page, `${label} configured composer`);
}

async function assertMockRequestContract(route, fixture, locale, capturedStudyRequests, label) {
  const payload = route.request().postDataJSON();
  if (payload.researchMethod === 'GENERAL_LIKERT') {
    const sample = samplesByLocale[locale].find((entry) => entry.stableId === payload.sampleLineage?.stableId
      && entry.slug === payload.sampleLineage?.slug);
    assert.ok(sample, `${label} GENERAL_LIKERT request identifies a registered locale sample`);
    const canonicalLineage = canonicalSampleLineageForSample(sample);
    assert.equal(payload.prompt, sample.request.prompt, `${label} sample request preserves the exact registered prompt`);
    assert.equal(payload.audience, sample.request.audience, `${label} sample request preserves the exact registered audience`);
    assert.equal(payload.assumptions, sample.request.assumptions, `${label} sample request preserves registered assumptions`);
    assert.equal(payload.panelSize, 100, `${label} sample request preserves the UI's non-respondent legacy panel field`);
    assert.deepEqual(payload.sourceUrls, [], `${label} curated static context URLs do not leak into the editable run`);
    assert.deepEqual(payload.evidence, [], `${label} sample run carries no unverified client research material`);
    assert.equal(payload.evidencePolicy, 'AUTO', `${label} sample request uses the UI evidence policy`);
    assert.equal(payload.market, sample.request.market, `${label} sample request market alias`);
    assert.equal(payload.outputLocale, locale, `${label} sample request output locale alias`);
    assert.deepEqual(payload.sourceLanguages, sample.request.sourceLanguages, `${label} sample request source locale aliases`);
    assert.equal(payload.searchCountry, sample.request.searchCountry, `${label} sample request search country alias`);
    assert.equal(payload.searchLocation, sample.request.searchLocation, `${label} sample request search location alias`);
    assert.deepEqual(payload.localization, sample.localization, `${label} sample request canonical localization`);
    assert.equal(payload.researchMode, 'deep', `${label} sample request research mode`);
    assert.equal(Object.hasOwn(payload, 'methodConfig'), false, `${label} GENERAL_LIKERT sample request has no stale methodConfig`);
    assert.deepEqual(payload.sampleLineage, canonicalLineage, `${label} sample request carries canonical registry-derived lineage`);
    assert.match(payload.clientRunId, /^lk_[A-Za-z0-9]+$/, `${label} sample request carries a client run id`);
    const parsedRequest = requestSchema.safeParse(payload);
    assert.equal(parsedRequest.success, true, `${label} sample request satisfies the strict synthetic-study contract: ${parsedRequest.error?.message || ''}`);
    capturedStudyRequests.push(payload);
    return;
  }
  assert.equal(payload.prompt, fixture.prompt, `${label} synthetic study must retain supplied CJK question`);
  assert.equal(payload.audience, fixture.audience, `${label} synthetic study must retain supplied CJK audience`);
  assert.equal(payload.localization?.schemaVersion, 'study-localization-v1', `${label} canonical localization schema`);
  assert.equal(payload.localization?.marketId, fixture.marketId, `${label} market id`);
  assert.equal(payload.localization?.reportLocale, locale, `${label} report locale`);
  assert.equal(payload.localization?.instrumentLocale, locale, `${label} instrument locale`);
  assert.deepEqual(payload.localization?.sourceLocales, [locale], `${label} source locales`);
  assert.equal(payload.localization?.retrieval?.policy, 'REQUIRE', `${label} retrieval policy`);
  assert.ok(payload.localization?.retrieval?.locales?.includes(locale), `${label} retrieval language`);
  assert.ok(specializedMethodIds.includes(payload.researchMethod), `${label} supported specialized research method`);
  assert.deepEqual(payload.methodConfig, methodConfigFixture(fixture, payload.researchMethod), `${label} ${payload.researchMethod} methodConfig preserves the authored instrument inputs`);
  const parsedMethodConfig = methodConfigSchema.safeParse(payload.methodConfig);
  assert.equal(parsedMethodConfig.success, true, `${label} ${payload.researchMethod} methodConfig satisfies the strict server contract: ${parsedMethodConfig.error?.message || ''}`);
  assertScript(JSON.stringify(payload.methodConfig), fixture, `${label} ${payload.researchMethod} methodConfig contains requested-locale authoring copy`);
  capturedStudyRequests.push(payload);
}

async function assertRequiredSourceNoMatchRequestContract(route, locale, capturedStudyRequests, label) {
  const payload = route.request().postDataJSON();
  const parsedRequest = requestSchema.safeParse(payload);
  assert.equal(parsedRequest.success, true, `${label} source no-match request satisfies the strict synthetic-study contract: ${parsedRequest.error?.message || ''}`);
  assert.equal(payload.localization?.reportLocale, locale, `${label} source no-match report locale`);
  assert.equal(payload.localization?.instrumentLocale, locale, `${label} source no-match instrument locale`);
  assert.deepEqual(payload.localization?.sourceLocales, [locale], `${label} source no-match preserves the authored source language`);
  assert.equal(payload.localization?.retrieval?.policy, 'REQUIRE', `${label} source no-match uses fail-closed retrieval`);
  assert.deepEqual(payload.localization?.retrieval?.locales, ['en-US'], `${label} source no-match exercises a distinct retrieval language`);
  capturedStudyRequests.push(payload);
}

async function runRequiredSourceNoMatchJourney({ page, fixture, locale, htmlLang, label, armFailure, accessibility }) {
  const sourceLanguages = page.locator('#source-languages');
  const retrievalLocales = page.locator('#retrieval-locales');
  const retrievalDetails = retrievalLocales.locator('details');
  if (!await retrievalDetails.evaluate((element) => element.open)) await retrievalDetails.locator('summary').click();

  const requestedRetrieval = retrievalLocales.locator(`label:has(span[lang="${htmlLang}"])`);
  const englishRetrieval = retrievalLocales.locator('label:has(span[lang="en-US"])');
  assert.equal(await requestedRetrieval.locator('input[type="checkbox"]').isChecked(), true, `${label} source no-match starts with requested retrieval locale`);
  await requestedRetrieval.click();
  await englishRetrieval.click();
  assert.equal(await requestedRetrieval.locator('input[type="checkbox"]').isChecked(), false, `${label} source no-match removes the matching retrieval locale`);
  assert.equal(await englishRetrieval.locator('input[type="checkbox"]').isChecked(), true, `${label} source no-match selects a distinct retrieval locale`);

  const sourceSummary = (await sourceLanguages.locator('summary span').textContent()).trim();
  const retrievalSummary = (await retrievalLocales.locator('summary span').textContent()).trim();
  assert.notEqual(sourceSummary, retrievalSummary, `${label} source and retrieval language summaries visibly differ`);
  assertLocalizedVisibleCopy(sourceSummary, fixture, `${label} source-language summary remains localized`);
  assert.match(retrievalSummary, /English/i, `${label} retrieval-language summary exposes the distinct English locale`);

  const requireWarning = page.locator('.retrieval-policy-field .localization-mismatch');
  await assertVisible(requireWarning, `${label} fail-closed retrieval warning`);
  assertLocalizedVisibleCopy(await requireWarning.textContent(), fixture, `${label} fail-closed retrieval warning is localized`);

  armFailure();
  await page.locator('.run-button').click();
  const alert = page.locator('.generation-error[role="alert"]');
  await assertVisible(alert, `${label} required-source no-match alert`);
  const alertText = await alert.textContent();
  assert.match(alertText, /REQUIRED_SOURCE_LANGUAGE_UNAVAILABLE/, `${label} no-match alert exposes the stable recovery code`);
  assertLocalizedVisibleCopy(alertText, fixture, `${label} no-match alert is localized`);
  assert.equal(await page.locator('.research-report').count(), 0, `${label} no-match does not fabricate a research report`);
  assert.equal(await page.locator('.run-progress').count(), 0, `${label} no-match exits the run state`);
  await accessibility.snapshot('required-source-error');

  await englishRetrieval.click();
  await requestedRetrieval.click();
  assert.equal(await englishRetrieval.locator('input[type="checkbox"]').isChecked(), false, `${label} no-match diagnostic removes the distinct retrieval locale`);
  assert.equal(await requestedRetrieval.locator('input[type="checkbox"]').isChecked(), true, `${label} no-match diagnostic restores the requested retrieval locale`);
}

async function assertLocalizedMethodAuthoring({ page, fixture, methodId, label }) {
  const methodSelect = page.locator('#research-method');
  await methodSelect.selectOption(methodId);
  const selectedOption = methodSelect.locator('option:checked');
  const methodLabel = (await selectedOption.textContent()).trim();
  assertLocalizedControlLabel(methodLabel, fixture, `${label} ${methodId} localized method label`);
  assertLocalizedVisibleCopy(await page.locator('#research-method-hint').textContent(), fixture, `${label} ${methodId} localized method description`);

  const plan = methodAuthoringPlan(fixture, methodId);
  for (const [fieldId, value] of Object.entries(plan.fields)) {
    const field = page.locator(`#${fieldId}`);
    await assertVisible(field, `${label} ${methodId} ${fieldId} authoring control`);
    assertLocalizedControlLabel(await page.locator(`label[for="${fieldId}"]`).textContent(), fixture, `${label} ${methodId} ${fieldId} localized field label`);
    await field.fill(String(value));
  }
  for (const [fieldId, value] of Object.entries(plan.selects)) {
    const field = page.locator(`#${fieldId}`);
    await assertVisible(field, `${label} ${methodId} ${fieldId} authoring selector`);
    assertLocalizedControlLabel(await page.locator(`label[for="${fieldId}"]`).textContent(), fixture, `${label} ${methodId} ${fieldId} localized selector label`);
    await field.selectOption(String(value));
    assertLocalizedVisibleCopy(await field.locator('option:checked').textContent(), fixture, `${label} ${methodId} ${fieldId} localized selected option`);
  }
  for (const [fieldId, values] of Object.entries(plan.lists)) {
    const fieldset = page.locator(`#${fieldId}`);
    await assertVisible(fieldset, `${label} ${methodId} ${fieldId} authoring list`);
    assertLocalizedControlLabel(await fieldset.locator('legend').textContent(), fixture, `${label} ${methodId} ${fieldId} localized list label`);
    const inputs = fieldset.locator('input');
    assert.equal(await inputs.count(), values.length, `${label} ${methodId} ${fieldId} expected item count`);
    for (const [index, value] of values.entries()) {
      assertLocalizedVisibleCopy(await inputs.nth(index).getAttribute('aria-label'), fixture, `${label} ${methodId} ${fieldId} item ${index + 1} localized control name`);
      await inputs.nth(index).fill(String(value));
      assertLocalizedVisibleCopy(
        await fieldset.locator('.method-list-row button').nth(index).getAttribute('aria-label'),
        fixture,
        `${label} ${methodId} ${fieldId} item ${index + 1} localized remove action`,
      );
    }
    assertLocalizedVisibleCopy(await fieldset.locator(':scope > button.add-source').textContent(), fixture, `${label} ${methodId} ${fieldId} localized add action`);
  }

  await page.waitForFunction(() => document.querySelectorAll('.readiness-issue').length === 0);
  await assertNoHorizontalOverflow(page, `${label} ${methodId} authoring surface`);
  return methodLabel;
}

async function assertMethodResultSurface({ page, fixture, methodId, label }) {
  const kind = resultKindByMethod[methodId];
  const selector = {
    DIRECTIONAL_DISTRIBUTION: '.overview-view',
    RANKED_ITEMS: '.method-result--ranked-items',
    ATTRIBUTE_MATRIX: '.method-result--attribute-matrix',
    PRICE_LADDER: '.method-result--price-ladder',
    INSTRUMENT_REVIEW: '.method-result--instrument-review',
    INTERVIEW_GUIDE: '.method-result--interview-guide',
  }[kind];
  const surface = page.locator(selector);
  await assertVisible(surface, `${label} ${methodId} ${kind} result surface`);
  assertScript(await surface.textContent(), fixture, `${label} ${methodId} localized method result`);

  if (kind === 'DIRECTIONAL_DISTRIBUTION') {
    await assertLocalizedTextNodes(surface.locator('.executive-read bdi'), fixture, `${label} ${methodId} localized generated summary`);
    await assertLocalizedTextNodes(surface.locator('.synthetic-rationale strong bdi'), fixture, `${label} ${methodId} localized generated profile`);
    await assertLocalizedTextNodes(surface.locator('.synthetic-rationale p bdi'), fixture, `${label} ${methodId} localized generated response`);
    const chart = surface.locator('.distribution[role="img"]').first();
    await assertVisible(chart, `${label} ${methodId} directional chart`);
    assertLocalizedVisibleCopy(await chart.getAttribute('aria-label'), fixture, `${label} ${methodId} localized chart alternative`);
  } else if (kind === 'RANKED_ITEMS') {
    assert.equal(await surface.locator('.ranked-items-list > li').count(), 3, `${label} ranked result preserves all authored features`);
    await assertLocalizedTextNodes(surface.locator('.method-result-header bdi'), fixture, `${label} ${methodId} localized generated summary`);
    await assertLocalizedTextNodes(surface.locator('#ranked-items-title'), fixture, `${label} ${methodId} localized ranking label`);
    await assertLocalizedTextNodes(surface.locator('.ranked-items-list strong'), fixture, `${label} ${methodId} localized ranked items`);
    await assertLocalizedTextNodes(surface.locator('.ranked-items-list p'), fixture, `${label} ${methodId} localized ranking rationales`);
  } else if (kind === 'ATTRIBUTE_MATRIX') {
    await assertLocalizedTextNodes(surface.locator('.method-result-header bdi'), fixture, `${label} ${methodId} localized generated summary`);
    await assertLocalizedTextNodes(surface.locator('#attribute-matrix-title'), fixture, `${label} ${methodId} localized matrix label`);
    const table = surface.locator('table.attribute-matrix-table');
    await assertVisible(table, `${label} attribute matrix semantic table`);
    assert.equal(await table.locator('thead th[scope="col"]').count(), fixture.matrix.attributes.length + 1, `${label} table exposes scoped column headers`);
    assert.equal(await table.locator('tbody th[scope="row"]').count(), fixture.matrix.comparators.length + 1, `${label} table exposes scoped row headers`);
    assert.ok((await table.textContent()).includes(fixture.matrix.focalBrand), `${label} table preserves the focal brand`);
    await assertLocalizedTextNodes(table.locator('thead th[scope="col"]'), fixture, `${label} ${methodId} localized matrix column labels`);
    await assertLocalizedTextNodes(table.locator('tbody th[scope="row"]'), fixture, `${label} ${methodId} localized matrix row labels`);
  } else if (kind === 'PRICE_LADDER') {
    assert.equal(await surface.locator('.price-ladder-list > article').count(), fixture.pricePoints.length, `${label} price ladder preserves all authored price points`);
    await assertLocalizedTextNodes(surface.locator('.method-result-header bdi'), fixture, `${label} ${methodId} localized generated summary`);
    await assertLocalizedTextNodes(surface.locator('.price-ladder-list small'), fixture, `${label} ${methodId} localized price-point labels`);
  } else if (kind === 'INSTRUMENT_REVIEW') {
    assert.equal(await surface.locator('.instrument-issue-list > li').count(), 1, `${label} instrument review renders its localized issue`);
    await assertLocalizedTextNodes(surface.locator('.method-result-header bdi'), fixture, `${label} ${methodId} localized generated summary`);
    await assertLocalizedTextNodes(surface.locator('.instrument-issue-list strong').first(), fixture, `${label} ${methodId} localized issue category`);
    await assertLocalizedTextNodes(surface.locator('.instrument-issue-list > li > p'), fixture, `${label} ${methodId} localized issue explanation`);
    await assertLocalizedTextNodes(surface.locator('.instrument-issue-list blockquote'), fixture, `${label} ${methodId} localized revision suggestion`);
    await assertLocalizedTextNodes(surface.locator('.method-result-columns li'), fixture, `${label} ${methodId} localized review detail`);
  } else if (kind === 'INTERVIEW_GUIDE') {
    assert.equal(await surface.locator('.guide-question-list > li').count(), 2, `${label} interview guide preserves both authored topics`);
    await assertLocalizedTextNodes(surface.locator('.method-result-header bdi'), fixture, `${label} ${methodId} localized generated summary`);
    await assertLocalizedTextNodes(surface.locator('.guide-bookend p'), fixture, `${label} ${methodId} localized guide bookends`);
    await assertLocalizedTextNodes(surface.locator('.guide-question-list > li > div > p'), fixture, `${label} ${methodId} localized guide questions`);
    const probeGroups = surface.locator('.guide-question-list details');
    for (let index = 0; index < await probeGroups.count(); index += 1) await probeGroups.nth(index).locator('summary').click();
    await assertLocalizedTextNodes(surface.locator('.guide-question-list details li'), fixture, `${label} ${methodId} localized guide probes`);
    await assertLocalizedTextNodes(surface.locator('.method-result-columns li'), fixture, `${label} ${methodId} localized moderator and consent notes`);
  }
  await assertNoHorizontalOverflow(page, `${label} ${methodId} result`);
}

async function assertMethodHandoffSurface({ page, fixture, locale, methodId, methodLabel, label, runId, keyboardDownload = false }) {
  await tab(page, 'method', `${label} ${methodId}`);
  const design = page.locator('.research-design');
  await assertVisible(design, `${label} ${methodId} research design`);
  const designHeading = await design.locator('h3').textContent();
  assert.ok(designHeading.includes(methodLabel), `${label} ${methodId} localized method name reaches the research design`);
  assertLocalizedControlLabel(designHeading, fixture, `${label} ${methodId} localized research-design heading`);

  const toggle = page.locator('.human-validation-button');
  await assertVisible(toggle, `${label} ${methodId} human-validation control`);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const handoff = page.locator('#human-research-handoff');
  await assertVisible(handoff, `${label} ${methodId} human-research handoff`);
  const respondentCopy = await handoff.locator('.handoff-questionnaire').textContent();
  assertLocalizedVisibleCopy(respondentCopy, fixture, `${label} ${methodId} localized respondent-facing handoff`);
  const authoredNeedle = handoffNeedleFor(methodConfigFixture(fixture, methodId));
  const authoredHandoffSurface = methodId === 'INTERVIEW_GUIDE'
    ? handoff.locator('.handoff-questionnaire')
    : handoff.locator('.handoff-stimuli');
  const authoredHandoffCopy = authoredHandoffSurface.locator('bdi').filter({ hasText: authoredNeedle }).first();
  await assertVisible(authoredHandoffCopy, `${label} ${methodId} authored handoff content`);
  assert.ok((await authoredHandoffCopy.textContent()).includes(authoredNeedle), `${label} ${methodId} handoff DOM preserves the exact authored content`);

  const downloads = handoff.locator('.handoff-downloads button');
  assert.equal(await downloads.count(), 4, `${label} ${methodId} all handoff export controls`);
  assert.ok(await downloads.nth(3).isEnabled(), `${label} ${methodId} JSON handoff export is enabled`);
  const artifact = await expectDownload(page, async () => {
    if (keyboardDownload) {
      await downloads.nth(3).focus();
      assert.equal(await downloads.nth(3).evaluate((element) => document.activeElement === element), true, `${label} ${methodId} JSON handoff download receives keyboard focus`);
      await page.keyboard.press('Enter');
      return;
    }
    await downloads.nth(3).click();
  }, 'json', `${label} ${methodId} handoff receipt`);
  const receipt = JSON.parse(decodeDownload(artifact));
  assert.equal(receipt.exportLocale, locale, `${label} ${methodId} receipt locale`);
  assert.equal(receipt.lineage?.researchMethod, methodId, `${label} ${methodId} receipt method lineage`);
  assert.equal(receipt.lineage?.runId, runId, `${label} ${methodId} receipt run lineage`);
  assert.equal(receipt.observedHumanResponses, false, `${label} ${methodId} receipt does not claim observed responses`);
  assert.equal(receipt.participantPanelConnected, false, `${label} ${methodId} receipt does not claim a connected panel`);
  assert.equal(receipt.questionnaire?.instrumentVersion, 'human-instrument-v1', `${label} ${methodId} receipt instrument schema`);
  const primary = receipt.questionnaire?.questionRecords?.find((entry) => entry.record?.questionId === 'Q_PRIMARY')?.record;
  assert.equal(primary?.type, primaryQuestionTypeByMethod[methodId], `${label} ${methodId} method-specific primary question type`);
  assert.ok(JSON.stringify(receipt.questionnaire).includes(authoredNeedle), `${label} ${methodId} receipt preserves the authored respondent-facing stimulus`);
  assertScript(JSON.stringify(receipt.questionnaire), fixture, `${label} ${methodId} receipt contains localized instrument copy`);
  await assertNoHorizontalOverflow(page, `${label} ${methodId} handoff`);
}

async function runRemainingMethodJourneys({ page, fixture, locale, label, mockedCalls, accessibility }) {
  for (const methodId of specializedMethodIds.filter((candidate) => candidate !== 'CONCEPT_TEST')) {
    await page.locator('.report-actions button').first().click();
    await assertVisible(page.locator('.composer'), `${label} reopened composer for ${methodId}`);
    const methodLabel = await assertLocalizedMethodAuthoring({ page, fixture, methodId, label });
    const priorRunCount = mockedCalls.study.length;
    await page.locator('.run-button').click();
    await assertVisible(page.locator('.research-report'), `${label} ${methodId} completed report`);
    assert.equal(mockedCalls.study.length, priorRunCount + 1, `${label} ${methodId} crosses the synthetic-study request boundary once`);
    assert.equal(mockedCalls.study.at(-1).researchMethod, methodId, `${label} ${methodId} request captured`);
    await assertMethodResultSurface({ page, fixture, methodId, label });
    await accessibility.snapshot('specialized-method-results');
    await assertMethodHandoffSurface({ page, fixture, locale, methodId, methodLabel, label, runId: mockedCalls.responses.at(-1).runId });
    await accessibility.snapshot('specialized-method-handoffs');
    mockedCalls.browserMethods.push(methodId);
  }
}

const methodSpecificControlIds = Object.freeze([
  'concept-stimulus',
  'purchase-offer', 'purchase-category', 'purchase-price', 'purchase-currency', 'purchase-unit', 'purchase-channel', 'purchase-horizon', 'purchase-alternative',
  'message-stimulus', 'intended-action', 'message-exposure-context',
  'claim-stimulus', 'claim-status', 'claim-exposure-context',
  'task-scenario', 'user-goal', 'experience-description', 'ux-context', 'ux-device',
  'feature-items', 'decision-context', 'selection-constraint',
  'focal-brand', 'comparator-brands', 'brand-category', 'brand-attributes',
  'price-offer', 'price-category', 'price-currency', 'price-unit', 'price-channel', 'price-horizon', 'price-alternative', 'price-points',
  'study-objective', 'target-population', 'survey-questions',
  'research-objective', 'participant-context', 'interview-topics', 'sensitive-areas',
]);

async function assertSampleLineageNotice(page, fixture, sample, lineage, label) {
  const notice = page.locator('.sample-lineage-notice');
  await assertVisible(notice, `${label} localized sample-lineage notice`);
  assert.equal(await notice.getAttribute('data-sample-lineage'), lineage.source, `${label} notice canonical lineage source`);
  assert.equal(await notice.getAttribute('data-sample-slug'), sample.slug, `${label} notice registered sample slug`);
  assert.equal(await notice.getAttribute('data-automated-qa-status'), lineage.automatedQa.status, `${label} notice canonical automated-QA status`);
  assert.equal(await notice.getAttribute('data-native-review-status'), lineage.nativeReview.status, `${label} notice canonical native-review status`);
  assertLocalizedVisibleCopy(await notice.textContent(), fixture, `${label} localized sample-lineage notice copy`);
}

async function runSampleJourneys({ page, fixture, locale, viewport, label, mockedCalls, accessibility }) {
  for (const sample of samplesByLocale[locale]) {
    const sampleLabel = `${label} ${sample.stableId}`;
    const lineage = canonicalSampleLineageForSample(sample);
    const localePath = locale.toLowerCase();
    const detailPath = `/${localePath}/studies/${sample.slug}/index.html`;
    const registryPath = `/${localePath}/studies/index.json`;
    const expectedCta = `/?sample=${sample.slug}&uiLocale=${locale}`;
    const expectedHtmlLang = cjkLocales.find((entry) => entry.locale === locale)?.htmlLang || locale;

    await page.goto(new URL(detailPath, baseOrigin).href, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('html').getAttribute('lang'), expectedHtmlLang, `${sampleLabel} static detail document language`);
    const staticMain = page.locator('main');
    await assertVisible(staticMain, `${sampleLabel} static detail main landmark`);
    await assertVisible(page.locator('.study-detail-heading h1'), `${sampleLabel} static detail title`);
    await assertVisible(staticMain.locator('h1').first(), `${sampleLabel} static detail main heading`);
    assert.equal((await page.locator('.study-detail-heading h1').textContent()).trim(), sample.title, `${sampleLabel} static detail title matches the registry`);
    assert.equal((await page.locator('.study-question').textContent()).trim(), sample.request.prompt, `${sampleLabel} static detail prompt matches the registry`);
    const staticBadges = page.locator('.study-detail-heading .study-quality-badges');
    await assertVisible(staticBadges, `${sampleLabel} static quality badges`);
    assert.equal(await staticBadges.getAttribute('data-automated-qa-status'), lineage.automatedQa.status, `${sampleLabel} static automated-QA status`);
    assert.equal(await staticBadges.getAttribute('data-native-review-status'), lineage.nativeReview.status, `${sampleLabel} static native-review status`);
    const receiptText = (await page.locator('.rail-list').allTextContents()).join(' ');
    assert.ok(receiptText.includes(sample.stableId), `${sampleLabel} static detail shows its stable registry id`);
    assert.ok(receiptText.includes(lineage.localizationRegistryVersion), `${sampleLabel} static detail shows its localization registry version`);
    await assertNoHorizontalOverflow(page, `${sampleLabel} static detail`);
    await accessibility.snapshot('static-sample-detail');

    const registryResponse = await page.request.get(new URL(registryPath, baseOrigin).href);
    assert.equal(registryResponse.ok(), true, `${sampleLabel} locale registry is readable`);
    const registry = await registryResponse.json();
    const registryEntry = registry.studies?.find((entry) => entry.stableId === sample.stableId && entry.slug === sample.slug);
    assert.ok(registryEntry, `${sampleLabel} exact stableId/slug is registered`);
    assert.equal(registryEntry.runYourOwnUrl, expectedCta, `${sampleLabel} registry CTA`);
    assert.equal(registryEntry.quality?.automatedQa?.status, lineage.automatedQa.status, `${sampleLabel} registry automated-QA status`);
    assert.equal(registryEntry.quality?.nativeReview?.status, lineage.nativeReview.status, `${sampleLabel} registry native-review status`);

    const cta = page.locator(`.study-detail-actions a.sl-button-primary[href="${expectedCta}"]`);
    await assertVisible(cta, `${sampleLabel} run-your-own CTA`);
    await cta.focus();
    assert.equal(await cta.evaluate((element) => document.activeElement === element), true, `${sampleLabel} run-your-own CTA receives keyboard focus`);
    const callsBeforeCta = mockedCalls.study.length;
    await Promise.all([
      page.waitForURL((url) => url.origin === baseOrigin && url.pathname === '/' && url.searchParams.get('sample') === sample.slug),
      page.keyboard.press('Enter'),
    ]);
    await assertVisible(page.locator('.composer'), `${sampleLabel} CTA-opened composer`);
    await page.waitForFunction(({ htmlLang, uiLocale }) => document.documentElement.lang === htmlLang
      && document.querySelector('.language-picker select')?.value === uiLocale, { htmlLang: expectedHtmlLang, uiLocale: locale });
    assert.equal(await page.locator('html').getAttribute('lang'), expectedHtmlLang, `${sampleLabel} CTA preserves the CJK interface document language`);
    assert.equal(await page.locator('.language-picker select').inputValue(), locale, `${sampleLabel} CTA preserves the CJK interface locale`);
    await page.waitForFunction((expectedLocale) => new URLSearchParams(window.location.search).get('uiLocale') === expectedLocale, locale);
    assert.equal(new URL(page.url()).searchParams.get('uiLocale'), locale, `${sampleLabel} CTA keeps the canonical interface locale shareable`);
    assert.equal(mockedCalls.study.length - callsBeforeCta, 0, `${sampleLabel} CTA does not auto-run the sample`);
    assert.equal(await page.locator('.research-report').count(), 0, `${sampleLabel} CTA does not fabricate a report`);
    assert.equal(await page.locator('#research-question').inputValue(), sample.request.prompt, `${sampleLabel} exact sample prompt prefill`);
    assert.equal(await page.locator('#audience').inputValue(), sample.request.audience, `${sampleLabel} exact sample audience prefill`);
    assert.equal(await page.locator('#research-method').inputValue(), 'GENERAL_LIKERT', `${sampleLabel} static sample uses GENERAL_LIKERT`);
    const staleMethodFieldCount = await page.locator(methodSpecificControlIds.map((id) => `#${id}`).join(', ')).count();
    assert.equal(staleMethodFieldCount, 0, `${sampleLabel} composer has no stale concept or specialized-method fields`);
    await assertSampleLineageNotice(page, fixture, sample, lineage, sampleLabel);
    await assertNoHorizontalOverflow(page, `${sampleLabel} sample composer`);

    const callsBeforeRun = mockedCalls.study.length;
    await page.locator('.run-button').click();
    await assertVisible(page.locator('.research-report'), `${sampleLabel} fixture-backed sample report`);
    assert.equal(mockedCalls.study.length - callsBeforeRun, 1, `${sampleLabel} explicit run crosses the fixture route exactly once`);
    const requestPayload = mockedCalls.study.at(-1);
    const responsePayload = mockedCalls.responses.at(-1)?.rawPayload;
    assert.equal(requestPayload.researchMethod, 'GENERAL_LIKERT', `${sampleLabel} outbound request method`);
    assert.deepEqual(requestPayload.sampleLineage, lineage, `${sampleLabel} outbound canonical lineage`);
    assert.ok(responsePayload, `${sampleLabel} raw fixture response is retained for lineage assertions`);
    assert.deepEqual(responsePayload.run?.sampleLineage, lineage, `${sampleLabel} response run lineage`);
    assert.deepEqual(responsePayload.meta?.sampleLineage, lineage, `${sampleLabel} response meta lineage`);
    assert.deepEqual(responsePayload.run?.reproducibility?.sampleLineage, lineage, `${sampleLabel} response reproducibility lineage`);
    assert.deepEqual(responsePayload.meta?.reproducibility?.sampleLineage, lineage, `${sampleLabel} response meta reproducibility lineage`);
    assert.deepEqual(responsePayload.meta?.provenance?.sampleLineage, lineage, `${sampleLabel} response provenance lineage`);
    assert.deepEqual(responsePayload.persistence?.clientRecord?.input?.sampleLineage, lineage, `${sampleLabel} response client-record input lineage`);
    assert.deepEqual(responsePayload.persistence?.clientRecord?.run?.sampleLineage, lineage, `${sampleLabel} response client-record run lineage`);
    assert.deepEqual(responsePayload.persistence?.clientRecord?.run?.reproducibility?.sampleLineage, lineage, `${sampleLabel} response client-record reproducibility lineage`);
    assert.deepEqual(responsePayload.run?.humanResearchHandoff?.sourceStudy?.sampleLineage, lineage, `${sampleLabel} response handoff source-study lineage`);

    const evidencePack = await expectDownload(page, () => page.locator('.report-actions button').nth(1).click(), 'json', `${sampleLabel} evidence pack`);
    const evidencePackJson = JSON.parse(decodeDownload(evidencePack));
    assert.deepEqual(evidencePackJson.study?.sampleLineage, lineage, `${sampleLabel} evidence-pack client study lineage`);
    assert.deepEqual(evidencePackJson.result?.meta?.sampleLineage, lineage, `${sampleLabel} evidence-pack result lineage`);
    assert.deepEqual(evidencePackJson.result?.meta?.reproducibility?.sampleLineage, lineage, `${sampleLabel} evidence-pack reproducibility lineage`);
    assert.deepEqual(evidencePackJson.lineage?.sampleLineage, lineage, `${sampleLabel} evidence-pack top-level lineage`);

    await tab(page, 'segments', sampleLabel);
    const projectExportButton = page.locator('.qualitative-project-actions button').first();
    await assertVisible(projectExportButton, `${sampleLabel} qualitative project export`);
    await page.waitForFunction(() => !document.querySelector('.qualitative-project-actions button')?.disabled);
    const projectArtifact = await expectDownload(page, () => projectExportButton.click(), 'json', `${sampleLabel} qualitative project`);
    const projectExport = JSON.parse(decodeDownload(projectArtifact));
    assert.equal(projectExport.presentationVersion, 'qualitative-project-presentation-v1', `${sampleLabel} qualitative project presentation schema`);
    assert.equal(projectExport.exportType, 'LIKERTS_QUALITATIVE_PROJECT_PRESENTATION', `${sampleLabel} qualitative project presentation type`);
    assert.equal(projectExport.localizationReceipt?.interfaceLocale, locale, `${sampleLabel} qualitative project interface locale`);
    assert.equal(projectExport.localizationReceipt?.outputLocale, sample.request.outputLocale, `${sampleLabel} qualitative project output locale`);
    assert.equal(projectExport.localizationReceipt?.localized, true, `${sampleLabel} qualitative project has localized presentation copy`);
    assert.equal(projectExport.localizationReceipt?.canonicalRunLocalizationReceiptStatus, 'RECORDED', `${sampleLabel} qualitative project records canonical localization lineage`);
    const expectedLocalizationReceipt = evidencePackJson.result?.meta?.localizationReceipt || evidencePackJson.result?.meta?.localization || responsePayload.run?.localization;
    assert.deepEqual(projectExport.localizationReceipt?.canonicalRunLocalizationReceipt, expectedLocalizationReceipt, `${sampleLabel} qualitative project canonical localization receipt`);
    assert.equal(projectExport.market?.countryCode, fixture.countryCode, `${sampleLabel} qualitative project canonical country`);
    assert.equal(projectExport.market?.name, new Intl.DisplayNames([locale], { type: 'region' }).of(fixture.countryCode), `${sampleLabel} qualitative project localized market name`);
    assert.equal(projectExport.outputLocale, sample.request.outputLocale, `${sampleLabel} qualitative project top-level output locale`);
    assert.equal(projectExport.evidenceHash, evidencePackJson.result?.meta?.hashes?.evidence || evidencePackJson.result?.meta?.evidenceHash || null, `${sampleLabel} qualitative project evidence lineage`);
    assert.equal(projectExport.populationFrameHash, evidencePackJson.result?.meta?.hashes?.populationFrame || evidencePackJson.result?.meta?.populationFrameHash || null, `${sampleLabel} qualitative project population lineage`);
    assert.deepEqual(projectExport.sampleLineage, lineage, `${sampleLabel} qualitative project top-level sample lineage`);
    assert.deepEqual(projectExport.lineage?.sampleLineage, lineage, `${sampleLabel} qualitative project presentation lineage`);
    assertScript(projectExport.disclosures?.join(' ') || '', fixture, `${sampleLabel} qualitative project localized disclosures`);
    const canonicalProjectExport = projectExport.canonicalProjectExport;
    assert.ok(canonicalProjectExport?.project, `${sampleLabel} qualitative project preserves its canonical import package`);
    const qualitativeRunRecord = canonicalProjectExport.project.records?.find((record) => record.kind === 'run' && record.lineage?.runId === responsePayload.run.runId);
    assert.ok(qualitativeRunRecord, `${sampleLabel} qualitative project export contains its run record`);
    assert.deepEqual(qualitativeRunRecord.data?.sampleLineage, lineage, `${sampleLabel} qualitative run data lineage`);
    assert.deepEqual(qualitativeRunRecord.lineage?.sampleLineage, lineage, `${sampleLabel} qualitative run record lineage`);
    assert.equal(qualitativeRunRecord.data?.method, 'GENERAL_LIKERT', `${sampleLabel} qualitative run record method`);
    assert.equal(qualitativeRunRecord.data?.observedHumanResponse, false, `${sampleLabel} qualitative export has no observed response claim`);

    const storedRun = await page.evaluate((runId) => {
      const runs = JSON.parse(localStorage.getItem('likerts:runs:v2') || '[]');
      return runs.find((entry) => entry.status === 'complete' && entry.result?.meta?.runId === runId) || null;
    }, responsePayload.run.runId);
    assert.ok(storedRun, `${sampleLabel} completed run is present in local storage`);
    assert.deepEqual(storedRun.study?.sampleLineage, lineage, `${sampleLabel} local-storage study lineage`);
    assert.deepEqual(storedRun.result?.meta?.sampleLineage, lineage, `${sampleLabel} local-storage result lineage`);
    assert.deepEqual(storedRun.result?.meta?.reproducibility?.sampleLineage, lineage, `${sampleLabel} local-storage reproducibility lineage`);

    const callsBeforeRestore = mockedCalls.study.length;
    await page.evaluate(() => window.history.replaceState(null, '', '/'));
    assert.equal(new URL(page.url()).search, '', `${sampleLabel} restore navigation removes the sample query`);
    await page.reload({ waitUntil: 'networkidle' });
    await assertVisible(page.locator('.research-report'), `${sampleLabel} queryless reload restores the report`);
    assert.equal((await page.locator('#report-title').textContent()).trim(), sample.request.prompt, `${sampleLabel} queryless reload restores the exact sample report`);
    assert.equal(mockedCalls.study.length - callsBeforeRestore, 0, `${sampleLabel} queryless restore makes no synthetic-study call`);
    await page.locator('.report-actions button').first().click();
    await assertVisible(page.locator('.composer'), `${sampleLabel} restored brief composer`);
    assert.equal(await page.locator('#research-question').inputValue(), sample.request.prompt, `${sampleLabel} restored exact prompt`);
    assert.equal(await page.locator('#audience').inputValue(), sample.request.audience, `${sampleLabel} restored exact audience`);
    assert.equal(await page.locator('#research-method').inputValue(), 'GENERAL_LIKERT', `${sampleLabel} restored GENERAL_LIKERT method`);
    await assertSampleLineageNotice(page, fixture, sample, lineage, `${sampleLabel} restored`);
    assert.equal(mockedCalls.study.length - callsBeforeRestore, 0, `${sampleLabel} restored composer and lineage notice make no synthetic-study call`);
    await assertNoHorizontalOverflow(page, `${sampleLabel} restored composer`);
    await accessibility.snapshot('restored-sample-project');

    mockedCalls.sampleCoverage.push({
      stableId: sample.stableId,
      slug: sample.slug,
      sampleSchemaVersion: sample.schemaVersion,
      quality: {
        automatedQaStatus: lineage.automatedQa.status,
        nativeReviewStatus: lineage.nativeReview.status,
      },
      checks: {
        staticDetailRegistryMatched: true,
        staticDetailQualityBadgesMatched: true,
        ctaMatched: true,
        composerOpenedFromCta: true,
        autoRunApiCalls: 0,
        promptMatched: true,
        audienceMatched: true,
        researchMethod: 'GENERAL_LIKERT',
        staleMethodFieldCount,
        lineageNoticeLocalized: true,
        lineageNoticeSource: lineage.source,
        lineageNoticeAutomatedQaStatus: lineage.automatedQa.status,
        lineageNoticeNativeReviewStatus: lineage.nativeReview.status,
        requestApiCalls: 1,
        requestMethodConfigPresent: false,
        requestCanonicalLineageMatched: true,
        responseRunLineageMatched: true,
        responseMetaLineageMatched: true,
        responseReproducibilityLineageMatched: true,
        responsePersistenceInputLineageMatched: true,
        responsePersistenceRunLineageMatched: true,
        evidencePackStudyLineageMatched: true,
        evidencePackResultLineageMatched: true,
        evidencePackTopLevelLineageMatched: true,
        qualitativeProjectExportLineageMatched: true,
        qualitativeRunRecordLineageMatched: true,
        localStorageLineageMatched: true,
        restoredWithoutSampleQuery: true,
        restoredReportMatched: true,
        restoredLineageNoticeMatched: true,
        restoreApiCalls: 0,
        observedHumanResponses: false,
        participantPanelConnected: false,
      },
    });
  }
  return {
    localeId: locale,
    viewport: { ...viewport },
    status: 'PASSED',
    samples: mockedCalls.sampleCoverage.map((entry) => structuredClone(entry)),
  };
}

async function runFullJourney({ page, fixture, locale, viewport, label, mockedCalls, accessibility, deepCoverage = false }) {
  const conceptMethodLabel = await assertLocalizedMethodAuthoring({ page, fixture, methodId: 'CONCEPT_TEST', label });
  const runButton = page.locator('.run-button');
  await assertVisible(runButton, `${label} run study control`);
  await runButton.click();
  await assertVisible(page.locator('.research-report'), `${label} completed research report`);
  await assertVisible(page.locator('#report-title'), `${label} report title`);
  await assertVisible(page.getByText(fixture.takeaway, { exact: true }).first(), `${label} model-generated report takeaway`);
  assertScript(await page.locator('#report-title').textContent(), fixture, `${label} localized user question rendered`);
  assertScript(await page.getByText(fixture.takeaway, { exact: true }).first().textContent(), fixture, `${label} localized model output rendered`);
  const chart = page.locator('.topline-section .distribution[role="img"]');
  await assertVisible(chart, `${label} chart text alternative`);
  const chartTextAlternative = await chart.getAttribute('aria-label');
  assert.ok(chartTextAlternative?.trim(), `${label} chart has a non-empty text alternative`);
  assertScript(chartTextAlternative, fixture, `${label} chart text alternative is localized`);
  await assertMethodResultSurface({ page, fixture, methodId: 'CONCEPT_TEST', label });
  await assertNoHorizontalOverflow(page, `${label} report overview`);
  await assertReportTabKeyboardNavigation(page, label);
  await accessibility.snapshot('results-overview');
  if (deepCoverage) await accessibility.snapshot('specialized-method-results');

  const evidencePack = await expectDownload(page, () => page.locator('.report-actions button').nth(1).click(), 'json', `${label} evidence pack`);
  const evidencePackJson = JSON.parse(decodeDownload(evidencePack));
  assert.equal(evidencePackJson.study?.outputLocale, locale, `${label} evidence pack output locale`);
  assert.equal(evidencePackJson.result?.meta?.outputLocale, locale, `${label} evidence pack result locale`);
  assert.equal(evidencePackJson.study?.localizationReceipt?.schemaVersion, 'study-localization-v1', `${label} evidence pack canonical localization receipt`);
  assert.equal(evidencePackJson.study?.localizationReceipt?.market?.id, fixture.marketId, `${label} evidence pack canonical market id`);
  assert.equal(evidencePackJson.result?.meta?.inputHashVersion, 'study-input-v3', `${label} evidence pack input-hash version`);
  assert.equal(evidencePackJson.result?.meta?.inputHashLineage?.status, 'CURRENT_VERSIONED', `${label} evidence pack input-hash lineage status`);
  assert.equal(evidencePackJson.lineage?.inputHashLineage?.version, 'study-input-v3', `${label} evidence pack top-level input-hash lineage`);
  assertScript(`${evidencePackJson.study?.prompt} ${evidencePackJson.result?.takeaway}`, fixture, `${label} evidence pack retains localized user and model text`);
  // Same input hash + second fixture run exercises the product's stability comparison.
  const callsBeforeReplay = mockedCalls.study.length;
  const replayResponsePromise = page.waitForResponse((response) => {
    try {
      return new URL(response.url()).pathname === '/api/synthetic-study'
        && response.request().method() === 'POST';
    } catch {
      return false;
    }
  });
  await page.locator('.report-actions button').nth(2).click();
  await replayResponsePromise;
  assert.equal(mockedCalls.study.length, callsBeforeReplay + 1, `${label} replay must make exactly one mocked synthetic-study call`);
  const replayRunId = mockedCalls.responses.at(-1)?.runId;
  assert.ok(replayRunId, `${label} replay response exposes a run identity`);
  await page.waitForFunction(
    (expectedRunId) => document.querySelector('.run-id')?.textContent?.includes(expectedRunId),
    replayRunId,
  );
  await assertVisible(page.locator('.research-report'), `${label} replayed report`);

  await tab(page, 'stability', label);
  await assertVisible(page.locator('.stability-view'), `${label} stability panel`);
  await assertVisible(page.locator('.stability-runs article').nth(1), `${label} second repeat-run distribution`);
  await assertNoHorizontalOverflow(page, `${label} stability`);
  await accessibility.snapshot('stability');

  await tab(page, 'evidence', label);
  await assertVisible(page.locator('.evidence-view'), `${label} evidence ledger`);
  await assertVisible(page.getByText(fixture.sourceTitle, { exact: true }).first(), `${label} source title remains source text`);
  await assertVisible(page.getByText(fixture.sourceExcerpt, { exact: true }).first(), `${label} source excerpt remains source text`);
  assertScript(await page.getByText(fixture.sourceTitle, { exact: true }).first().textContent(), fixture, `${label} CJK source title`);
  assert.equal(await page.locator(`.evidence-row a[lang="${fixture.sourceLanguage}"]`).first().getAttribute('lang'), fixture.sourceLanguage, `${label} source title language metadata`);
  assert.equal(await page.locator(`.evidence-row bdi[lang="${fixture.sourceLanguage}"]`).first().getAttribute('lang'), fixture.sourceLanguage, `${label} source excerpt language metadata`);
  await assertNoHorizontalOverflow(page, `${label} evidence ledger`);
  await accessibility.snapshot('evidence-ledger');

  await tab(page, 'population', label);
  await assertVisible(page.locator('.population-view'), `${label} population frame`);
  await assertVisible(page.getByText(fixture.intendedPopulation, { exact: true }), `${label} intended population`);
  await assertVisible(page.locator('.population-source-list'), `${label} official datasets`);
  await assertNoHorizontalOverflow(page, `${label} population frame`);
  await accessibility.snapshot('population-frame');

  await tab(page, 'segments', label);
  await assertVisible(page.locator('.segment-table'), `${label} modeled segments`);
  await page.locator('.segment-explore-button').first().click();
  await assertVisible(page.locator('.segment-perspective'), `${label} segment follow-up`);
  await page.locator('.perspective-starters button').first().click();
  const followUp = page.locator('.perspective-question-field textarea');
  await followUp.fill(fixture.prompt);
  await page.locator('.perspective-submit').click();
  await assertVisible(page.getByText(fixture.segmentAnswer, { exact: true }), `${label} model-generated segment answer`);
  assertScript(await page.getByText(fixture.segmentAnswer, { exact: true }).textContent(), fixture, `${label} segment answer script`);
  await page.locator('.perspective-answer details summary').click();
  await assertVisible(page.getByText(fixture.segmentBasis, { exact: true }), `${label} segment evidence basis`);
  const qualitativeSourceExcerpt = page.locator(`.perspective-answer details[open] .perspective-basis bdi[lang="${fixture.sourceLanguage}"]`).filter({ hasText: fixture.sourceExcerpt }).last();
  await assertVisible(qualitativeSourceExcerpt, `${label} segment source excerpt`);
  assert.equal(await qualitativeSourceExcerpt.textContent(), fixture.sourceExcerpt, `${label} qualitative source excerpt remains exact source text`);
  assert.equal(await qualitativeSourceExcerpt.getAttribute('lang'), fixture.sourceLanguage, `${label} qualitative source language metadata`);
  // Submit a second objection follow-up. The mocked endpoint records the exact
  // request so this checks conversation continuity rather than only rendering.
  await page.locator('.perspective-starters button').first().click();
  await followUp.fill(fixture.concept);
  await page.locator('.perspective-submit').click();
  await assertVisible(page.locator('.perspective-transcript > li').nth(1), `${label} second segment follow-up transcript`);
  await expectDownload(page, () => page.locator('.qualitative-project-actions button').first().click(), 'json', `${label} qualitative project`);
  await assertNoHorizontalOverflow(page, `${label} segment exploration`);
  await accessibility.snapshot('qualitative-exploration');

  await tab(page, 'method', label);
  await assertVisible(page.locator('.model-card'), `${label} Model Card`);
  await assertVisible(page.getByText('study-input-v3', { exact: true }), `${label} input-hash version is visible`);
  await assertVisible(page.locator('.research-design'), `${label} research design`);
  assert.ok((await page.locator('.research-design h3').textContent()).includes(conceptMethodLabel), `${label} localized concept-test name reaches the research design`);
  if (await page.locator('.human-validation-button').getAttribute('aria-expanded') !== 'true') await page.locator('.human-validation-button').click();
  await assertVisible(page.locator('#human-research-handoff'), `${label} human-research handoff`);
  const handoff = page.locator('#human-research-handoff');
  const respondentCopy = await handoff.locator('.handoff-questionnaire').textContent();
  assertLocalizedVisibleCopy(respondentCopy, fixture, `${label} CJK respondent-facing handoff draft`);
  const authoredNeedle = handoffNeedleFor(methodConfigFixture(fixture, 'CONCEPT_TEST'));
  const authoredHandoffCopy = handoff.locator('.handoff-stimuli bdi').filter({ hasText: authoredNeedle }).first();
  await assertVisible(authoredHandoffCopy, `${label} CONCEPT_TEST authored handoff content`);
  assert.ok((await authoredHandoffCopy.textContent()).includes(authoredNeedle), `${label} CONCEPT_TEST handoff DOM preserves the exact authored content`);
  await assertKeyboardDetailsToggle(page, handoff.locator('details').nth(1), `${label} CONCEPT_TEST`);
  const handoffDownloads = handoff.locator('.handoff-downloads button');
  assert.equal(await handoffDownloads.count(), 4, `${label} all human-research export controls`);
  const handoffArtifacts = {};
  for (const [index, extension] of ['csv', 'xlsx', 'txt', 'json'].entries()) {
    handoffArtifacts[extension] = await expectDownload(page, async () => {
      if (extension === 'json') {
        await handoffDownloads.nth(index).focus();
        assert.equal(await handoffDownloads.nth(index).evaluate((element) => document.activeElement === element), true, `${label} human handoff JSON download receives keyboard focus`);
        await page.keyboard.press('Enter');
        return;
      }
      await handoffDownloads.nth(index).click();
    }, extension, `${label} human handoff`);
  }
  assertHumanHandoffExports({ artifacts: handoffArtifacts, fixture, locale, label, methodId: 'CONCEPT_TEST', runId: `browser_${locale.replace('-', '_')}_2` });
  await assertNoHorizontalOverflow(page, `${label} Model Card and handoff`);
  await accessibility.snapshot('research-design-and-human-handoff');
  if (deepCoverage) await accessibility.snapshot('specialized-method-handoffs');
  mockedCalls.browserMethods.push('CONCEPT_TEST');

  assert.equal(mockedCalls.segment.length, 2, `${label} two mocked qualitative answers`);
  const [firstSegmentRequest, secondSegmentRequest] = mockedCalls.segment;
  assert.equal(firstSegmentRequest.intent, 'OBJECTION', `${label} objection mode survives request boundary`);
  assert.equal(firstSegmentRequest.question, fixture.prompt, `${label} first user follow-up retained without translation`);
  assert.equal(firstSegmentRequest.history.length, 0, `${label} first follow-up has an empty prior transcript`);
  assert.equal(secondSegmentRequest.intent, 'OBJECTION', `${label} follow-up objection mode survives request boundary`);
  assert.equal(secondSegmentRequest.question, fixture.concept, `${label} second user follow-up retained without translation`);
  assert.equal(secondSegmentRequest.conversationId, `conversation_${locale.replace('-', '_')}`, `${label} follow-up retains its conversation id`);
  assert.equal(secondSegmentRequest.history.length, 2, `${label} follow-up retains the prior question and model answer`);
  if (!deepCoverage) {
    assert.deepEqual(mockedCalls.browserMethods, ['CONCEPT_TEST'], `${label} responsive core journey records its concept-method coverage`);
    return null;
  }

  await runRemainingMethodJourneys({ page, fixture, locale, label, mockedCalls, accessibility });

  assert.deepEqual(mockedCalls.browserMethods, specializedMethodIds, `${label} browser exercises every specialized research method in registry order`);
  assert.deepEqual([...new Set(mockedCalls.responses.map((entry) => entry.methodId))], specializedMethodIds, `${label} mock responses cover every specialized method`);
  assert.deepEqual([...new Set(mockedCalls.responses.map((entry) => entry.resultKind))].sort(), [...new Set(Object.values(resultKindByMethod))].sort(), `${label} mock responses cover all six method-result kinds`);
  for (const methodId of specializedMethodIds) {
    const evidence = mockedCalls.responses.findLast((entry) => entry.methodId === methodId);
    assert.ok(evidence, `${label} ${methodId} response evidence`);
    assert.equal(evidence.handoffLanguage, locale, `${label} ${methodId} localized handoff evidence`);
    assert.equal(evidence.primaryQuestionType, primaryQuestionTypeByMethod[methodId], `${label} ${methodId} primary instrument evidence`);
  }
  return runSampleJourneys({ page, fixture, locale, viewport, label, mockedCalls, accessibility });
}

if (screenshotDirectory) await fs.mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  for (const entry of matrix) {
    const caseStartedAt = Date.now();
    const fixture = fixtures[entry.locale];
    const context = await browser.newContext({ locale: entry.locale, viewport: { width: entry.width, height: entry.height }, acceptDownloads: true });
    // Each matrix entry starts fresh once, while same-origin navigation and
    // reloads inside the cell must retain the local run for persistence checks.
    await context.addInitScript(() => {
      const marker = 'likerts:browser-matrix-cell-initialized';
      if (sessionStorage.getItem(marker) === '1') return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem(marker, '1');
    });

    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const consoleErrors = [];
    const pageErrors = [];
    const failedResponses = [];
    const failedRequests = [];
    const unmockedApiRequests = [];
    const externalRequests = [];
    const browserArtifactResponseChecks = [];
    const browserArtifactResponseErrors = [];
    const browserArtifactResponseReceipts = [];
    const verifyBrowserArtifactResponse = attestationArtifactManifest
      ? createBrowserArtifactResponseVerifier({ manifest: attestationArtifactManifest, candidateUrl: baseUrl })
      : null;
    const mockedCalls = { study: [], responses: [], segment: [], browserMethods: [], sampleCoverage: [] };
    let runIndex = 0;
    let segmentIndex = 0;
    let nextSyntheticStudyError = null;
    let expectedSyntheticFailureResponses = 0;
    let handledSyntheticFailureResponses = 0;
    const label = `${entry.locale} ${entry.width}px`;
    const accessibilityEvidence = createAccessibilitySurfaceEvidence({
      page,
      label,
      deepCoverage: entry.deepJourney,
    });

    // Only in-process fixtures are permitted. Unknown API routes are aborted so
    // the gate cannot silently contact a real backend.
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/synthetic-study') {
        if (nextSyntheticStudyError) {
          const expectedError = nextSyntheticStudyError;
          nextSyntheticStudyError = null;
          await assertRequiredSourceNoMatchRequestContract(route, entry.locale, mockedCalls.study, label);
          expectedSyntheticFailureResponses += 1;
          await route.fulfill({ status: expectedError.status, contentType: 'application/json', body: JSON.stringify({ code: expectedError.code, error: expectedError.message }) });
          return;
        }
        await assertMockRequestContract(route, fixture, entry.locale, mockedCalls.study, label);
        runIndex += 1;
        const requestPayload = route.request().postDataJSON();
        const responsePayload = buildMockStudyPayload(entry.locale, runIndex, requestPayload);
        const primaryQuestion = responsePayload.run.humanResearchHandoff.questionnaire.questions.find((question) => question.questionId === 'Q_PRIMARY');
        mockedCalls.responses.push({
          methodId: responsePayload.run.researchDesign.methodId,
          resultKind: responsePayload.run.methodResult.kind,
          runId: responsePayload.run.runId,
          handoffLanguage: responsePayload.run.humanResearchHandoff.questionnaire.language,
          primaryQuestionType: primaryQuestion?.type,
          ...(responsePayload.run.researchDesign.methodId === 'GENERAL_LIKERT' ? { rawPayload: responsePayload } : {}),
        });
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(responsePayload) });
        return;
      }
      if (url.pathname === '/api/segment-perspective') {
        const payload = route.request().postDataJSON();
        mockedCalls.segment.push(payload);
        segmentIndex += 1;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(buildSegmentPerspectivePayload(entry.locale, payload, segmentIndex)) });
        return;
      }
      unmockedApiRequests.push(route.request().url());
      await route.abort();
    });
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        const responseUrl = new URL(response.url());
        if (response.status() === 424
          && responseUrl.pathname === '/api/synthetic-study'
          && handledSyntheticFailureResponses < expectedSyntheticFailureResponses) handledSyntheticFailureResponses += 1;
        else failedResponses.push(`${response.status()} ${response.url()}`);
      }
      if (!verifyBrowserArtifactResponse) return;
      const responseUrl = new URL(response.url());
      if (responseUrl.origin !== baseOrigin || responseUrl.pathname.startsWith('/api/')) return;
      const check = (async () => {
        const status = response.status();
        const bytes = status === 200 ? await response.body() : null;
        browserArtifactResponseReceipts.push(verifyBrowserArtifactResponse({
          responseUrl: response.url(),
          status,
          bytes,
        }));
      })().catch((error) => {
        browserArtifactResponseErrors.push(`${error?.code || error?.name || 'ERROR'}: ${error?.message || String(error)}`);
      });
      browserArtifactResponseChecks.push(check);
    });
    page.on('requestfailed', (request) => { failedRequests.push(`${request.failure()?.errorText || 'request failed'} ${request.url()}`); });
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('http') && new URL(url).origin !== baseOrigin) externalRequests.push(url);
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const skipLink = page.locator('.app-skip-link');
    await page.locator('body').focus();
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.activeElement?.classList.contains('app-skip-link'));
    assert.equal(await skipLink.evaluate((element) => document.activeElement === element), true, `${label} initial Tab focuses the skip link`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'workspace');
    assert.equal(await page.locator('#workspace').evaluate((element) => document.activeElement === element), true, `${label} skip link moves keyboard focus to the workspace main landmark`);
    const firstRunStart = page.locator('#first-run-start-button');
    await assertVisible(firstRunStart, `${label} first-run start action`);
    await page.waitForFunction((expectedHtmlLang) => document.documentElement.lang === expectedHtmlLang, entry.htmlLang);
    assert.equal(await page.locator('html').getAttribute('lang'), entry.htmlLang, `${label} html lang`);
    assert.equal(await page.locator('html').getAttribute('dir'), 'ltr', `${label} direction`);
    assert.equal(await page.locator('#research-question').count(), 0, `${label} must start before the composer`);
    await assertNoHorizontalOverflow(page, `${label} before composer`);

    const interfaceStatus = page.locator('#interface-localization-status');
    await assertVisible(interfaceStatus, `${label} interface localization status`);
    assert.equal(await interfaceStatus.getAttribute('data-copy-status'), entry.uiCopyStatus, `${label} copy status`);
    assert.equal(await interfaceStatus.getAttribute('data-native-review-status'), entry.uiNativeReviewStatus, `${label} native review status`);
    const interfaceLanguage = page.locator('.language-picker select');
    await assertVisible(interfaceLanguage, `${label} interface language control`);
    await assertKeyboardFocus(interfaceLanguage, `${label} interface language control`);
    await accessibilityEvidence.snapshot('first-run');

    await assertKeyboardFocus(firstRunStart, `${label} first-run start action`);
    await page.keyboard.press('Enter');
    const question = page.locator('#research-question');
    await assertVisible(question, `${label} research question`);
    await page.waitForFunction(() => document.activeElement?.id === 'research-question');
    assert.equal(await page.locator('body').evaluate((body, status) => body.textContent.includes(status), entry.uiCopyStatus), true, `${label} copy status metadata`);
    assert.equal(await page.locator('body').evaluate((body, status) => body.textContent.includes(status), entry.uiNativeReviewStatus), true, `${label} native review metadata`);

    const readinessStatus = page.locator('#composer-readiness');
    assert.equal(await readinessStatus.getAttribute('role'), 'status', `${label} readiness uses a live status role`);
    assert.equal(await readinessStatus.getAttribute('aria-live'), 'polite', `${label} readiness announces changes politely`);
    const initialReadinessText = await readinessStatus.textContent();
    await question.fill(fixture.prompt);
    await page.waitForFunction((previous) => document.querySelector('#composer-readiness')?.textContent !== previous, initialReadinessText);
    assert.notEqual(await readinessStatus.textContent(), initialReadinessText, `${label} readiness live text changes after valid input`);
    await question.fill('');

    const researchMethod = page.locator('#research-method');
    await assertKeyboardFocus(researchMethod, `${label} research-method control`);
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.activeElement?.id === 'research-question');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.activeElement?.id === 'audience');

    const firstReadinessIssue = page.locator('.readiness-issue').first();
    await assertVisible(firstReadinessIssue, `${label} readiness issue`);
    await assertKeyboardFocus(firstReadinessIssue, `${label} readiness issue`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'research-question');
    assert.equal(await question.evaluate((element) => document.activeElement === element), true, `${label} readiness focus`);

    const optionalContext = page.locator('details.composer-context');
    await optionalContext.locator(':scope > summary').click();
    const marketControl = page.locator('#market');
    const reportLanguage = page.locator('#report-language');
    const instrumentLanguage = page.locator('#instrument-language');
    const retrievalPolicy = page.locator('#retrieval-policy');
    await assertVisible(marketControl, `${label} market control`);
    await assertVisible(reportLanguage, `${label} report language control`);
    await assertVisible(instrumentLanguage, `${label} instrument language control`);
    await assertVisible(retrievalPolicy, `${label} retrieval policy control`);
    await assertKeyboardFocus(marketControl, `${label} market control`);
    await assertKeyboardFocus(reportLanguage, `${label} report language control`);
    await assertKeyboardFocus(instrumentLanguage, `${label} instrument language control`);
    await assertKeyboardFocus(retrievalPolicy, `${label} retrieval policy control`);
    await assertVisible(page.locator('#source-languages'), `${label} source language control`);
    const sourceLanguages = page.locator('#source-languages');
    const sourceDetails = sourceLanguages.locator('details');
    await sourceDetails.locator('summary').click();
    assert.equal(await sourceDetails.getAttribute('open'), '', `${label} source language details must be open`);
    const sourceCheckbox = sourceLanguages.locator('input[type="checkbox"]').first();
    await assertVisible(sourceCheckbox, `${label} source language checkbox`);
    const sourceInitiallyChecked = await sourceCheckbox.isChecked();
    await sourceDetails.locator('summary').focus();
    await page.keyboard.press('Tab');
    await assertKeyboardFocus(sourceCheckbox, `${label} source language checkbox`);
    await page.keyboard.press('Space');
    await page.waitForFunction((checked) => document.querySelector('#source-languages input[type="checkbox"]')?.checked !== checked, sourceInitiallyChecked);
    assert.notEqual(await sourceCheckbox.isChecked(), sourceInitiallyChecked, `${label} source language toggles with Space`);
    await page.keyboard.press('Space');
    await page.waitForFunction((checked) => document.querySelector('#source-languages input[type="checkbox"]')?.checked === checked, sourceInitiallyChecked);
    assert.equal(await sourceCheckbox.isChecked(), sourceInitiallyChecked, `${label} source language restores with Space`);
    const localizationMetadata = page.locator(`[data-copy-status="${entry.uiCopyStatus}"][data-native-review-status="${entry.uiNativeReviewStatus}"]:visible`);
    assert.ok(await localizationMetadata.count() > 0, `${label} visible localization metadata`);
    await assertVisible(localizationMetadata.first(), `${label} visible localization metadata`);
    await assertNoHorizontalOverflow(page, `${label} after composer`);

    await optionalContext.locator(':scope > summary').click();
    await configureCjkStudy(page, fixture, entry.locale, entry.htmlLang, label);
    await accessibilityEvidence.snapshot('study-authoring');
    if (entry.deepJourney) {
      await runRequiredSourceNoMatchJourney({
        page,
        fixture,
        locale: entry.locale,
        htmlLang: entry.htmlLang,
        label,
        accessibility: accessibilityEvidence,
        armFailure: () => {
          nextSyntheticStudyError = {
            status: 424,
            code: 'REQUIRED_SOURCE_LANGUAGE_UNAVAILABLE',
            message: 'No external source satisfied both the configured provider-declared primary language and registered-script compatibility check.',
          };
        },
      });
    }
    const sampleCoverage = await runFullJourney({
      page,
      fixture,
      locale: entry.locale,
      viewport: { width: entry.width, height: entry.height },
      label,
      mockedCalls,
      accessibility: accessibilityEvidence,
      deepCoverage: entry.deepJourney,
    });
    const accessibility = accessibilityEvidence.finalize();
    if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, `localization-gate-${entry.locale}-${entry.width}.png`), fullPage: true });

    if (verifyBrowserArtifactResponse) {
      await page.waitForLoadState('networkidle');
      await Promise.all(browserArtifactResponseChecks);
      assert.ok(browserArtifactResponseReceipts.length > 0, `${label} Chromium must load one or more manifest-bound artifact responses`);
      assert.equal(browserArtifactResponseErrors.length, 0, `${label} Chromium artifact binding errors: ${browserArtifactResponseErrors.join('; ')}`);
    }

    const expectedRequiredSourceConsoleErrors = consoleErrors.filter((message) => /^Failed to load resource: the server responded with a status of 424 \(Failed Dependency\)$/.test(message));
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !expectedRequiredSourceConsoleErrors.includes(message));
    assert.ok(expectedRequiredSourceConsoleErrors.length <= expectedSyntheticFailureResponses, `${label} unexpected count of browser-generated 424 console messages`);
    assert.equal(unmockedApiRequests.length, 0, `${label} unmocked API requests: ${unmockedApiRequests.join('; ')}`);
    assert.equal(externalRequests.length, 0, `${label} external network requests: ${externalRequests.join('; ')}`);
    assert.equal(unexpectedConsoleErrors.length, 0, `${label} console errors: ${unexpectedConsoleErrors.join('; ')}`);
    assert.equal(pageErrors.length, 0, `${label} page errors: ${pageErrors.join('; ')}`);
    assert.equal(failedResponses.length, 0, `${label} failed resources: ${failedResponses.join('; ')}`);
    assert.equal(failedRequests.length, 0, `${label} failed requests: ${failedRequests.join('; ')}`);
    assert.equal(handledSyntheticFailureResponses, expectedSyntheticFailureResponses, `${label} expected required-source no-match responses are accounted for`);
    assert.equal(expectedSyntheticFailureResponses, entry.deepJourney ? 1 : 0, `${label} required-source no-match browser coverage`);

    report.push({
      width: entry.width, height: entry.height, locale: entry.locale, htmlLang: entry.htmlLang, direction: 'ltr', firstRun: true, composer: true, fullJourney: true, deepJourney: entry.deepJourney,
      noOverflowBeforeComposer: true, noOverflowAfterComposer: true, readinessFocus: 'research-question', sourceLanguageDetails: true, sourceLanguageCheckboxFocus: true, localizationControls: true, machineDrafted: true, reviewPending: true,
      requiredSourceNoMatch: entry.deepJourney ? 'PASSED' : 'COVERED_BY_LOCALE_DEEP_CELL',
      accessibility,
      expectedRequiredSourceConsoleErrors: expectedRequiredSourceConsoleErrors.length,
      ...(verifyBrowserArtifactResponse ? { browserArtifactResponsesVerified: browserArtifactResponseReceipts.length } : {}),
      ...({
        mockedStudyRuns: mockedCalls.study.length,
        mockedSegmentPerspectives: mockedCalls.segment.length,
        report: true,
        chartTextAlternative: true,
        evidenceLedger: true,
        populationFrame: true,
        stability: true,
        segmentFollowUp: true,
        modelCard: true,
        humanResearchHandoff: true,
        semanticTable: true,
        ...(sampleCoverage ? { sampleCoverage } : {}),
        ...(entry.deepJourney ? { methodCoverage: {
          methodIds: [...mockedCalls.browserMethods],
          resultKinds: [...new Set(mockedCalls.responses.map((entry) => entry.resultKind))].sort(),
          localizedAuthoringSurfaces: mockedCalls.browserMethods.length,
          localizedResultSurfaces: mockedCalls.browserMethods.length,
          localizedHandoffDrafts: mockedCalls.browserMethods.length,
          methodSpecificReceiptDownloads: mockedCalls.browserMethods.length,
          observedHumanResponses: false,
          participantPanelConnected: false,
        } } : {}),
        exports: ['evidence-pack.json', 'qualitative-project.json', 'csv', 'xlsx', 'txt', 'json'],
      }),
      unmockedApiRequests: 0, externalRequests: 0, consoleErrors: 0, pageErrors: 0, failedResponses: 0, failedRequests: 0, failedResources: 0,
      durationMs: Date.now() - caseStartedAt,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

let attestationSummary = null;
if (attestationOutputPath) {
  assert.ok(attestationBuildId, 'LIKERTS_BROWSER_BUILD_ID is required when writing a browser attestation.');
  assert.equal(report.length, allMatrix.length, 'Browser attestations require every cell in the complete 3-locale × 4-viewport matrix.');
  assert.equal(
    attestationPublicationStatus,
    'CI_ARTIFACT',
    'The browser runner may emit CI_ARTIFACT evidence only; publication requires a separate immutable evidence step.',
  );
  assert.ok(attestationArtifactManifest, 'Signed browser evidence requires a preflight build artifact manifest.');
  const artifactDigest = attestationArtifactManifest.artifactDigest;
  const testedLocales = [...new Set(report.map((entry) => entry.locale))];
  const matrixEvidence = report.map((entry) => ({
    localeId: entry.locale,
    viewport: { width: entry.width, height: entry.height },
    journey: entry.fullJourney ? 'FULL_JOURNEY' : 'AUTHORING_LAYOUT',
    status: 'PASSED',
    failures: {
      unmockedApiRequests: entry.unmockedApiRequests,
      externalRequests: entry.externalRequests,
      consoleErrors: entry.consoleErrors,
      pageErrors: entry.pageErrors,
      failedResponses: entry.failedResponses,
      failedRequests: entry.failedRequests,
    },
    accessibility: entry.accessibility,
  }));
  const flowEvidence = LOCALIZATION_BROWSER_ATTESTED_FLOW_IDS.flatMap((flowId) => testedLocales.flatMap((localeId) => {
    const localeEntries = report.filter((entry) => entry.locale === localeId);
    const viewports = (flowId === 'first-run-and-authoring'
      ? localeEntries
      : flowId === 'samples-persistence-and-lineage'
        ? localeEntries.filter((entry) => entry.sampleCoverage?.status === 'PASSED')
        : flowId === 'research-methods-and-instrument'
          ? localeEntries.filter((entry) => entry.deepJourney && entry.methodCoverage)
          : localeEntries.filter((entry) => entry.fullJourney))
      .map((entry) => ({ width: entry.width, height: entry.height }));
    return viewports.length ? [{ flowId, localeId, status: 'PASSED', viewports }] : [];
  }));
  const methodCoverage = report.filter((entry) => entry.deepJourney && entry.methodCoverage).map((entry) => ({
    localeId: entry.locale,
    methodIds: entry.methodCoverage.methodIds,
    resultKinds: entry.methodCoverage.resultKinds,
    localizedAuthoringSurfaces: entry.methodCoverage.localizedAuthoringSurfaces,
    localizedResultSurfaces: entry.methodCoverage.localizedResultSurfaces,
    localizedHandoffDrafts: entry.methodCoverage.localizedHandoffDrafts,
    methodSpecificReceiptDownloads: entry.methodCoverage.methodSpecificReceiptDownloads,
    observedHumanResponses: entry.methodCoverage.observedHumanResponses,
    participantPanelConnected: entry.methodCoverage.participantPanelConnected,
  }));
  const sampleCoverage = report.filter((entry) => entry.sampleCoverage).map((entry) => entry.sampleCoverage);
  const attestation = createLocalizationBrowserAttestation({
    suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    catalogHash: CURRENT_LOCALIZATION_CATALOG_HASH,
    verifiedAt: new Date().toISOString(),
    build: {
      id: attestationBuildId,
      artifactDigest,
      candidateUrl: baseUrl,
    },
    publication: { status: 'CI_ARTIFACT', evidenceUrl: null },
    execution: {
      evidenceMode: LOCALIZATION_BROWSER_EVIDENCE_MODE,
      apiMode: LOCALIZATION_BROWSER_API_MODE,
      externalNetworkAllowed: false,
      liveBackendValidated: false,
      liveModelValidated: false,
      observedHumanResponses: false,
      participantPanelConnected: false,
    },
    matrix: matrixEvidence,
    flowEvidence,
    methodCoverage,
    sampleCoverage,
  });
  const validation = validateLocalizationBrowserAttestation(attestation, {
    suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    buildIdentity: { id: attestationBuildId, artifactDigest },
    requiredLocaleIds: cjkLocales.map((entry) => entry.locale),
    requiredViewports: viewportMatrix,
    requiredSamplesByLocale,
    allowedFlowIds: LOCALIZATION_BROWSER_ATTESTED_FLOW_IDS,
    now: new Date(attestation.verifiedAt),
  });
  assert.equal(validation.ok, true, `Generated browser attestation must satisfy the canonical v4 validator: ${validation.code || 'unknown error'}`);
  assert.deepEqual(validation.verifiedFlowIds, [...LOCALIZATION_BROWSER_ATTESTED_FLOW_IDS], 'Generated browser attestation covers every declared v4 flow.');

  // The output parent may have appeared or changed while Chromium was
  // running. Materialize and resolve it again at the final boundary, then use
  // the canonical path so a swapped alias cannot redirect the evidence write
  // into the artifact after its digest has been verified.
  await fs.mkdir(path.dirname(attestationOutputPath), { recursive: true });
  const { outputPath: resolvedAttestationOutputPath } = await assertBrowserArtifactOutputOutsideRoot({
    rootDirectory: attestationBuildDirectory,
    outputPath: attestationOutputPath,
  });
  const finalArtifactManifest = await buildBrowserArtifactManifest(attestationBuildDirectory);
  assert.equal(
    finalArtifactManifest.artifactDigest,
    attestationArtifactManifest.artifactDigest,
    'The browser build directory changed while the signed matrix was running.',
  );
  assert.deepEqual(
    finalArtifactManifest.files.map(({ relativePath, byteLength, contentDigest }) => ({ relativePath, byteLength, contentDigest })),
    attestationArtifactManifest.files.map(({ relativePath, byteLength, contentDigest }) => ({ relativePath, byteLength, contentDigest })),
    'The browser build directory gained, lost, or changed files while the signed matrix was running.',
  );
  const finalServedArtifact = await verifyServedBrowserArtifactManifest({
    manifest: attestationArtifactManifest,
    candidateUrl: baseUrl,
  });
  assert.equal(
    finalServedArtifact.verifiedFileCount,
    attestationArtifactManifest.files.length,
    'Every hashed build file must still be served byte-for-byte immediately before attestation output.',
  );
  assert.deepEqual(
    finalServedArtifact.verifiedPaths,
    attestationArtifactManifest.files.map((entry) => entry.relativePath),
    'The served browser artifact file set must exactly match the hashed build manifest.',
  );
  await fs.writeFile(resolvedAttestationOutputPath, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
  attestationSummary = {
    outputPath: resolvedAttestationOutputPath,
    evidenceId: attestation.evidenceId,
    artifactDigest,
    artifactFilesVerified: finalServedArtifact.verifiedFileCount,
    publicationStatus: attestation.publication.status,
    flowIds: LOCALIZATION_BROWSER_ATTESTED_FLOW_IDS,
  };
}

process.stdout.write(`${JSON.stringify({ baseUrl, matrix, screenshots: Boolean(screenshotDirectory), durationMs: Date.now() - startedAt, report, attestation: attestationSummary }, null, 2)}\n`);
