import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { buildHumanResearchHandoff } from '../server/human-research-handoff.js';
import { formatLocalizedCurrency, formatPercentagePoints } from '../src/lib/localizedFormatting.js';
import {
  HUMAN_RESEARCH_XLSX_MIME,
  humanResearchBriefText,
  humanResearchHandoffToCsv,
  humanResearchHandoffToXlsx,
  humanResearchReceiptJson,
  safeHandoffFilename,
} from '../src/lib/humanResearchExports.js';

const boundary = 'Human research handoff—planning materials only. Likerts has not recruited, screened, contacted, or surveyed anyone.';
const handoff = {
  schemaVersion: 'human-research-handoff-v1', handoffId: 'hrh_test', generatedAt: '2026-08-29T12:00:00.000Z', status: 'READY_FOR_RESEARCHER_REVIEW', contentStatus: 'FIELD_DRAFT_REQUIRES_REVIEW', boundary,
  sourceStudy: { studyId: 'study-1', runId: '../run dangerous', inputHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), populationFrameHash: 'c'.repeat(64), researchDesignHash: 'd'.repeat(64), modelCardHash: 'e'.repeat(64), researchMethod: 'CONCEPT_TEST', researchMethodVersion: 'concept-test-v1', market: 'Saudi Arabia', outputLocale: 'ar-SA', observedHumanResponses: false },
  researchGrounding: { status: 'UNVERIFIED_MATERIALS_INCLUDED', materials: [{ evidenceId: 'evidence_123', clientMaterialId: 'material-1234567890abcdef1234', title: 'notes.txt', sourceKind: 'UPLOADED_TEXT', contentHandling: 'BOUNDED_RAW_TEXT', detectedType: 'txt', verificationStatus: 'UNVERIFIED', clientReportedContentHash: 'f'.repeat(64), serverExcerptHash: '1'.repeat(64), originalCharacterCount: 200, truncated: false }], disclosure: 'Client-reported hashes are not authenticated provenance.' },
  intendedPopulation: 'بالغون مهتمون بالخدمة', geography: { market: 'Saudi Arabia', countryCode: 'SA' },
  questionnaire: {
    instrumentVersion: 'human-instrument-v1', title: 'مسودة استبيان', language: 'ar-SA', estimatedMinutes: null, hasPlaceholders: true, disclosure: 'Unvalidated field draft.',
    stimuli: [{ stimulusId: 'concept-1', type: 'CONCEPT', text: '=SUM(A1) & <script> "quoted"', provenance: 'USER_INPUT', reviewFlags: ['PRESENT_EXACTLY_AS_SUPPLIED'] }],
    questions: [
      { questionId: 'S_CONSENT', sectionId: 'SCREENING', order: 1, type: 'SINGLE_SELECT', text: 'هل توافق؟', instruction: null, isRequired: true, stimulusId: null, options: [{ code: '1', label: 'نعم', order: 1 }, { code: '2', label: 'لا', order: 2 }], displayConditions: [], variableName: 's_consent', analysisRole: 'SCREENER', provenance: { class: 'METHOD_TEMPLATE', sourceIds: [] }, reviewFlags: [] },
      { questionId: 'Q_PRIMARY', sectionId: 'MAIN', order: 30, type: 'SINGLE_SELECT', text: '@HYPERLINK("bad")\n😀', instruction: null, isRequired: true, stimulusId: 'concept-1', options: [{ code: '1', label: 'غير محتمل', order: 1 }, { code: '5', label: 'محتمل جداً', order: 5 }], displayConditions: [], variableName: 'q_primary', analysisRole: 'PRIMARY_OUTCOME', provenance: { class: 'METHOD_TEMPLATE', sourceIds: [] }, reviewFlags: ['COGNITIVE_PRETEST_REQUIRED'] },
    ],
  },
  screeningPlan: { criteria: [{ criterionId: 'CONSENT', source: 'METHOD_TEMPLATE', status: 'DRAFT', rationale: 'Consent required.', questionId: 'S_CONSENT' }], terminationLogic: [{ ruleId: 'TERM_CONSENT', when: { questionId: 'S_CONSENT', operator: 'EQ', values: ['2'] }, action: 'TERMINATE_INELIGIBLE', reasonCode: 'CONSENT_NOT_GRANTED' }], sensitiveDataReviewRequired: true },
  quotaPlan: { status: 'TARGETS_UNAVAILABLE', targetCompletes: 385, targets: [], monitorTargets: [], weightingPlan: { status: 'TARGETS_UNAVAILABLE', method: 'NONE', targets: [], realisedWeightEffectiveSampleSize: null }, disclosure: 'No defensible quota.' },
  samplePlan: { status: 'PLANNING_ESTIMATE', basis: 'NOMINAL_SINGLE_PROPORTION_PRECISION', recommendedCompletes: 385, parameters: { confidenceLevel: 0.95, zScore: 1.96, assumedProportion: 0.5, nominalPrecisionPp: 5, designEffect: 1, designEffectStatus: 'UNADJUSTED' }, calculation: { formula: 'ceil(z² × p × (1-p) / e²)', baseCompletes: 385 }, disclosure: 'Planning calculation only.' },
  incidencePlan: { status: 'UNESTIMATED', pointEstimate: null, range: null, basis: 'NONE', source: null, disclosure: 'Synthetic percentages are never used.' },
  recruitmentPlan: { instructions: ['Researcher review', 'Soft launch'], providerRelationship: 'LINK_ONLY_NOT_INTEGRATED', noPanelBooked: true, disclosure: 'No panel booked.' },
  analysisPlan: { version: 'human-analysis-plan-v1', primaryEstimand: { variable: 'q_primary', statistics: ['FULL_DISTRIBUTION', 'TOP_TWO_BOX'], topTwoCodes: ['4', '5'] }, exclusions: ['Consent not granted'], missingData: { itemNonresponse: 'REPORT' }, weighting: { status: 'TARGETS_UNAVAILABLE', method: 'NONE', targets: [] }, openTextCoding: { planned: true }, syntheticComparison: { role: 'SECONDARY', humanAnalysisFrozenBeforeComparison: true }, reporting: ['FULL_DISTRIBUTIONS'] },
  providerLinks: [{ providerId: 'PROLIFIC', name: 'Prolific', relationship: 'LINK_ONLY_NOT_INTEGRATED', suitability: 'POSSIBLE_MATCH', url: 'https://example.com/provider', limitations: ['Check availability.'] }],
  unsupportedCharacteristics: ['Income'], missingFields: ['Incidence'], disclosures: [boundary],
};

function interviewGuideHandoff(locale = 'en-US') {
  return buildHumanResearchHandoff({
    input: {
      prompt: 'Prepare a pilot interview guide.', audience: 'Recent software evaluators', market: 'United States', outputLocale: locale, researchMethod: 'INTERVIEW_GUIDE',
      methodConfig: { method: 'INTERVIEW_GUIDE', researchObjective: 'Understand onboarding barriers', participantContext: 'Recent software evaluators', topics: [{ id: 'context', label: 'Current context' }, { id: 'barriers', label: 'Onboarding barriers' }] },
    },
    frame: { neutralQuestion: 'Neutral framing is not used for an interview guide.' },
    researchDesign: { methodId: 'INTERVIEW_GUIDE', methodVersion: 'interview-guide-v1', estimand: 'Interview-guide pilot quality', scale: null, humanValidation: { recommendedMethod: 'Pilot interviews', minimumChecks: ['guide review'] } },
    populationFrame: {
      intendedPopulation: 'Recent software evaluators', geography: { market: 'United States', countryCode: 'US' }, officialSourceDatasets: [{ id: 'official-age', title: 'Age profile', coverageDate: '2026-01-01' }],
      marginalDistributions: [{ variable: 'age', label: 'Age', sourceDatasetId: 'official-age', categories: [{ value: '18-34', share: 0.3 }, { value: '35-54', share: 0.45 }, { value: '55+', share: 0.25 }] }], unsupportedCharacteristics: [],
    },
    study: { cautions: [] }, reproducibility: handoff.sourceStudy, evidenceCatalog: [], studyId: 'study-interview-guide', runId: 'run-interview-guide', generatedAt: handoff.generatedAt,
  });
}

function csvRows(csv) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') cell += character;
  }
  return rows;
}

function humanReadableWorkbookText(files) {
  return Object.entries(files)
    .filter(([path]) => /^xl\/worksheets\/sheet[1-7]\.xml$/.test(path))
    .map(([, bytes]) => strFromU8(bytes))
    .join('\n');
}

function exportFidelityHandoff() {
  const fidelity = structuredClone(handoff);
  fidelity.packageVersion = 'human-research-package-v1';
  fidelity.packageHashes = {
    questionnaire: '1'.repeat(64),
    screener: '2'.repeat(64),
    quota: '3'.repeat(64),
    recruitment: '4'.repeat(64),
    analysis: '5'.repeat(64),
    sourceLineage: '6'.repeat(64),
    package: '7'.repeat(64),
  };
  fidelity.questionnaire.stimuli = [
    {
      stimulusId: 'ux-first-export',
      type: 'UX_TASK_SCENARIO',
      text: '=A first-time administrator exports the prior month of account activity.',
      provenance: 'USER_INPUT',
      reviewFlags: ['PRESENT_EXACTLY_AS_SUPPLIED'],
      userGoal: 'Create a report for the finance team.',
      experienceDescription: 'A browser dashboard with a reports section and a CSV export action.',
      context: 'Month-end finance reporting.',
      device: { type: 'LAPTOP_BROWSER', operatingSystem: 'macOS', viewport: '1440x900' },
    },
    {
      stimulusId: 'priced-offer-1',
      type: 'PRICED_OFFER',
      text: 'EV charging installation and support for 49 EUR per month.',
      provenance: 'USER_INPUT',
      reviewFlags: ['PRESENT_EXACTLY_AS_SUPPLIED'],
      price: { amount: 49, currency: 'EUR', unit: 'per month' },
      category: 'Home EV charging',
      channel: 'Online purchase',
      purchaseHorizon: 'Within 36 months',
      referenceAlternative: 'Arrange a charger independently',
    },
  ];
  fidelity.questionnaire.questions[1] = {
    ...fidelity.questionnaire.questions[1],
    stimulusId: 'ux-first-export',
    items: [{ itemId: 'task-ease', text: 'Expected task ease', responseFormat: 'SINGLE_SELECT', anchor: 'Very easy' }],
  };
  return fidelity;
}

test('CSV specification begins with the field-draft boundary and escapes formula-like cells', () => {
  const csv = humanResearchHandoffToCsv(handoff);
  assert.match(csv.split('\n')[0], /DRAFT FOR HUMAN RESEARCH/);
  assert.match(csv, /question_id/);
  assert.match(csv, /Q_PRIMARY/);
  assert.match(csv, /'@HYPERLINK/);
});

test('XLSX export is a real bounded OOXML package with fixed sheets, lineage, Unicode, and no formulas', () => {
  const bytes = humanResearchHandoffToXlsx(handoff);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength > 2_000);
  assert.ok(bytes.byteLength < 5_000_000);
  const files = unzipSync(bytes);
  for (const path of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet8.xml']) assert.ok(files[path], path);
  const workbook = strFromU8(files['xl/workbook.xml']);
  for (const name of ['README', 'QUESTIONNAIRE', 'OPTIONS', 'SCREENING LOGIC', 'QUOTAS', 'RECRUITMENT', 'ANALYSIS PLAN', 'LINEAGE']) assert.match(workbook, new RegExp(`name="${name}"`));
  const allXml = Object.entries(files).filter(([path]) => path.endsWith('.xml')).map(([, bytesForFile]) => strFromU8(bytesForFile)).join('\n');
  assert.match(allXml, /DRAFT FOR HUMAN RESEARCH/);
  assert.match(allXml, /هل توافق/);
  assert.match(allXml, /😀/);
  assert.match(allXml, /&amp; &lt;script&gt;/);
  assert.match(allXml, /aaaaaaaaaaaaaaaa/);
  assert.match(allXml, /material-1234567890abcdef1234/);
  assert.match(allXml, /<v>385<\/v>/);
  assert.match(allXml, /t="b"[^>]*><v>1<\/v>/);
  assert.doesNotMatch(allXml, /<f(?:\s|>)/);
  assert.doesNotMatch(allXml, /externalLink|vbaProject/i);
  assert.equal(HUMAN_RESEARCH_XLSX_MIME, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('brief, receipt, and filenames preserve planning lineage without unsafe paths', () => {
  const brief = humanResearchBriefText(handoff);
  assert.match(brief, /No panel booked/);
  assert.match(brief, /Nominal full-sample reference \(planning only\): 385/);
  assert.doesNotMatch(brief, /385 completed responses/);
  const receipt = JSON.parse(humanResearchReceiptJson(handoff));
  assert.equal(receipt.observedHumanResponses, false);
  assert.equal(receipt.lineage.inputHash, 'a'.repeat(64));
  assert.equal(safeHandoffFilename(handoff, 'xlsx'), 'likerts-run-dangerous-human-research-handoff.xlsx');
});

test('XLSX keeps actual quotas distinct from population references and purposive coverage', () => {
  const quotaHandoff = structuredClone(handoff);
  quotaHandoff.quotaPlan = {
    ...quotaHandoff.quotaPlan,
    targets: [{ quotaId: 'quota-age', variable: 'age', sourceDatasetId: 'achieved-frame', denominatorMatch: 'REVIEWED', categories: [{ code: '18-34', targetShare: 0.6, targetCompletes: 60 }] }],
    monitorTargets: [{ quotaId: 'reference-age', type: 'POPULATION_REFERENCE_ONLY', variable: 'age', sourceDatasetId: 'official-age', denominatorMatch: 'UNVERIFIED', categories: [{ code: '18-34', referenceShare: 0.3 }] }],
    coverageDimensions: [{ coverageId: 'coverage-age', type: 'PURPOSIVE_COVERAGE_REFERENCE', variable: 'age', sourceDatasetId: 'official-age', categories: [{ code: '18-34', sourceShare: 0.3 }] }],
  };

  const quotaXml = strFromU8(unzipSync(humanResearchHandoffToXlsx(quotaHandoff))['xl/worksheets/sheet5.xml']);
  for (const value of ['target_share', 'reference_share', 'source_share', 'quota-age', 'reference-age', 'coverage-age', 'POPULATION_REFERENCE_ONLY', 'PURPOSIVE_COVERAGE_REFERENCE']) assert.match(quotaXml, new RegExp(value));
  assert.match(quotaXml, /<v>0\.6<\/v>/);
  assert.match(quotaXml, /<v>0\.3<\/v>/);
  assert.match(quotaXml, /<c r="K6" s="4"><v>0\.3<\/v><\/c>/);
  assert.match(quotaXml, /<c r="M7" s="4"><v>0\.3<\/v><\/c>/);

  const brief = humanResearchBriefText(quotaHandoff);
  assert.match(brief, /Actual quota: age\/18-34 — Target share: 60%; Planning completes: 60/);
  assert.match(brief, /Population reference only: age\/18-34 — Reference share: 30%/);
  assert.match(brief, /Purposive coverage reference: age\/18-34 — Source share: 30%/);
});

test('CJK TXT quota presentation localizes labels, shares, and counts without rewriting CSV or XLSX technical fields', () => {
  const cases = {
    'zh-CN': { label: '目标比例', reference: '参考比例' },
    'ja-JP': { label: '目標比率', reference: '参照比率' },
    'ko-KR': { label: '목표 비율', reference: '참조 비율' },
  };
  for (const [locale, expected] of Object.entries(cases)) {
    const localized = structuredClone(handoff);
    localized.questionnaire.language = locale;
    localized.quotaPlan = {
      ...localized.quotaPlan,
      targets: [{ quotaId: 'quota-age', variable: 'age', sourceDatasetId: 'official-age', denominatorMatch: 'REVIEWED', categories: [{ code: '18-34', targetShare: 0.6, targetCompletes: 1234 }] }],
      monitorTargets: [{ quotaId: 'reference-age', type: 'POPULATION_REFERENCE_ONLY', variable: 'age', sourceDatasetId: 'official-age', denominatorMatch: 'REVIEWED', categories: [{ code: '18-34', referenceShare: 0.3 }] }],
    };
    const brief = humanResearchBriefText(localized);
    assert.match(brief, new RegExp(`${expected.label}: ${formatPercentagePoints(60, locale)}`));
    assert.match(brief, new RegExp(`${expected.reference}: ${formatPercentagePoints(30, locale)}`));
    assert.ok(brief.includes(new Intl.NumberFormat(locale).format(1234)), `${locale} TXT formats counts`);
    assert.doesNotMatch(brief, /target_share=|reference_share=|planning_completes=/);

    const xlsx = strFromU8(unzipSync(humanResearchHandoffToXlsx(localized))['xl/worksheets/sheet5.xml']);
    assert.match(xlsx, /target_share/);
    assert.match(xlsx, /<v>0\.6<\/v>/);
  }
});

test('qualitative handoffs keep sample design instructions and purposive coverage without a numeric target', () => {
  const qualitative = interviewGuideHandoff();
  const brief = humanResearchBriefText(qualitative);
  const files = unzipSync(humanResearchHandoffToXlsx(qualitative));
  const quotaXml = strFromU8(files['xl/worksheets/sheet5.xml']);
  const recruitmentXml = strFromU8(files['xl/worksheets/sheet6.xml']);

  assert.match(brief, /Sample-plan status: Researcher design required/);
  assert.match(brief, /Technical status ID: RESEARCHER_DESIGN_REQUIRED/);
  assert.match(brief, /Sample recommendation code: Plan purposive guide piloting and document the stopping rule\./);
  assert.match(brief, /Technical recommendation ID: PLAN_PURPOSIVE_GUIDE_PILOT_AND_STOPPING_RULE/);
  assert.match(brief, /Sample-plan instruction: Set a purposive interview plan/);
  assert.match(brief, /Purposive coverage reference: age\/18-34 — Source share: 30%/);
  assert.doesNotMatch(brief, /Nominal full-sample reference \(planning only\): 385/);
  assert.match(quotaXml, /source_share/);
  assert.match(quotaXml, /PURPOSIVE_COVERAGE_REFERENCE/);
  assert.match(recruitmentXml, /Sample-plan status/);
  assert.match(recruitmentXml, /Set a purposive interview plan/);
});

test('CJK qualitative exports translate known planning disclosures, instructions, and missing fields', () => {
  const cases = {
    'zh-CN': /样本计划状态|制定目的性访谈计划/,
    'ja-JP': /標本計画の状態|目的抽出によるインタビュー計画/,
    'ko-KR': /표본 계획 상태|목적 표집 인터뷰 계획/,
  };
  const serverAuthoredEnglish = [
    'Set a purposive interview plan from the research objective, participant variation, topic complexity, analysis depth, and a documented stopping rule.',
    'A qualitative interview count is not a precision calculation. Likerts leaves the numeric target unset until a researcher defines the sampling and stopping logic.',
    'Statistical quotas are not applicable to this qualitative planning mode. A researcher must define purposive coverage across relevant participant variations; official population shares are context, not recruitment targets.',
    'Have a human researcher review and pilot the interview guide before substantive fieldwork.',
    'Recruit purposively across the participant variations relevant to the guide objective.',
    'Method-specific sample-size or qualitative stopping-rule design',
  ];

  for (const [locale, expected] of Object.entries(cases)) {
    const qualitative = interviewGuideHandoff(locale);
    const brief = humanResearchBriefText(qualitative);
    const workbookText = humanReadableWorkbookText(unzipSync(humanResearchHandoffToXlsx(qualitative)));
    assert.match(brief, expected);
    for (const english of serverAuthoredEnglish) {
      assert.equal(brief.includes(english), false, `${locale} brief leaked ${english}`);
      assert.equal(workbookText.includes(english), false, `${locale} workbook leaked ${english}`);
    }
  }
});

test('CJK handoff exports localize human-facing wrappers while preserving canonical survey columns', () => {
  const cases = {
    'zh-CN': { banner: '真人研究草案', sheet: '问卷', heading: '配额与发生率', workbookField: '字段', itemLabel: '项目', script: /\p{Script=Han}/u },
    'ja-JP': { banner: '実参加者調査の草案', sheet: '質問票', heading: '割付と出現率', workbookField: '項目', itemLabel: '項目', script: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u },
    'ko-KR': { banner: '실제 참여자 연구 초안', sheet: '설문지', heading: '할당 및 발생률', workbookField: '필드', itemLabel: '항목', script: /\p{Script=Hangul}/u },
  };
  const questionnaireDisclosure = 'This is an unvalidated field draft generated from the study brief and method template. Review all respondent-facing language and stimuli, obtain any required ethics and privacy approvals, and cognitively pretest it before launch.';
  const quotaDisclosure = 'No defensible achieved-sample quota is available until source denominators are shown to match the screened intended population. Quotas and weighting do not make an opt-in or non-probability panel representative.';
  const incidenceDisclosure = 'Incidence is unknown unless supported by a cited observed source or dated provider quote. Synthetic response percentages are never used to estimate eligibility.';

  for (const [locale, expected] of Object.entries(cases)) {
    const localized = structuredClone(handoff);
    localized.questionnaire.language = locale;
    localized.questionnaire.title = locale === 'zh-CN' ? '真人研究问卷草案' : locale === 'ja-JP' ? '実参加者調査用アンケート草案' : '실제 참여자 연구 설문 초안';
    localized.questionnaire.disclosure = questionnaireDisclosure;
    localized.quotaPlan.disclosure = quotaDisclosure;
    localized.incidencePlan.disclosure = incidenceDisclosure;
    localized.recruitmentPlan.instructions = ['Have a human researcher review and cognitively pretest the instrument.'];
    localized.missingFields = ['Human translation and locale review'];
    localized.questionnaire.questions[1].items = [{ itemId: 'localized-item', text: 'Respondent-facing item', amount: 49.95 }];

    const csv = humanResearchHandoffToCsv(localized);
    assert.match(csv, expected.script);
    assert.match(csv, new RegExp(expected.banner));
    assert.match(csv, /question_id/);
    assert.doesNotMatch(csv, /DRAFT FOR HUMAN RESEARCH/);

    const brief = humanResearchBriefText(localized);
    assert.match(brief, new RegExp(expected.heading));
    assert.match(brief, new RegExp(`${expected.itemLabel}:`));
    assert.match(brief, expected.script);
    assert.doesNotMatch(brief, /No defensible achieved-sample quota|Have a human researcher review|Human translation and locale review/);

    const files = unzipSync(humanResearchHandoffToXlsx(localized));
    const workbook = strFromU8(files['xl/workbook.xml']);
    const workbookText = humanReadableWorkbookText(files);
    assert.match(workbook, new RegExp(`name="${expected.sheet}"`));
    assert.match(workbookText, expected.script);
    assert.match(workbookText, new RegExp(expected.workbookField));
    assert.doesNotMatch(workbookText, /DRAFT FOR HUMAN RESEARCH|Human translation and locale review/);
    assert.doesNotMatch(workbookText, /Intended population|Recommended completes|Sample disclosure|Panel booked or connected|Provider option:/);

    const receipt = JSON.parse(humanResearchReceiptJson(localized));
    assert.equal(receipt.exportLocale, locale);
    assert.match(receipt.banner, expected.script);
  }
});

test('TXT and XLSX present blocker, boolean, and price values for en-US and CJK while retaining explicit technical fields', () => {
  const cases = {
    'en-US': { unit: 'per month', no: 'No', blocker: 'Complete the selected method setup before creating a fieldable questionnaire.' },
    'zh-CN': { unit: '每月', no: '否', blocker: '请先完成所选方法的设置，再创建可用于现场调研的问卷。' },
    'ja-JP': { unit: '月額', no: 'いいえ', blocker: '実査可能な質問票を作成する前に、選択した手法の設定を完了してください。' },
    'ko-KR': { unit: '월', no: '아니요', blocker: '현장 조사용 설문지를 만들기 전에 선택한 방법 설정을 완료하세요.' },
  };

  for (const [locale, expected] of Object.entries(cases)) {
    const localized = structuredClone(handoff);
    localized.questionnaire.language = locale;
    localized.status = 'BLOCKED';
    localized.blockingIssues = ['METHOD_CONFIG_REQUIRED_FOR_HANDOFF'];
    localized.questionnaire.stimuli = [{
      stimulusId: 'priced-offer',
      type: 'PRICED_OFFER',
      text: `Authored offer copy\n49.95 EUR ${expected.unit}`,
      provenance: 'USER_INPUT',
      reviewFlags: [],
      price: { amount: 49.95, currency: 'EUR', unit: expected.unit },
    }];
    localized.questionnaire.questions[1].items = [{
      itemId: 'price-49',
      text: `49.95 EUR ${expected.unit}`,
      amount: 49.95,
      currency: 'EUR',
      unit: expected.unit,
    }];
    const localizedPrice = formatLocalizedCurrency(49.95, 'EUR', locale);
    const rawPrice = `49.95 EUR ${expected.unit}`;

    const brief = humanResearchBriefText(localized);
    const technicalRecordsStart = brief.indexOf('{"analysisRole"');
    const presentation = brief.slice(0, technicalRecordsStart);
    const technicalRecords = brief.slice(technicalRecordsStart);
    assert.match(presentation, new RegExp(expected.blocker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(presentation.includes(localizedPrice), `${locale} TXT must use locale-aware currency formatting`);
    assert.equal(presentation.includes(rawPrice), false, `${locale} TXT presentation leaked raw price concatenation`);
    assert.match(presentation, /METHOD_CONFIG_REQUIRED_FOR_HANDOFF/);
    assert.match(technicalRecords, /"currency":"EUR"/);
    assert.match(technicalRecords, /"unit":/);

    const files = unzipSync(humanResearchHandoffToXlsx(localized));
    const readmeXml = strFromU8(files['xl/worksheets/sheet1.xml']);
    const questionnaireXml = strFromU8(files['xl/worksheets/sheet2.xml']);
    assert.ok(readmeXml.includes(expected.blocker), `${locale} XLSX must include the localized blocker label`);
    assert.match(readmeXml, /METHOD_CONFIG_REQUIRED_FOR_HANDOFF/);
    assert.ok(readmeXml.includes(expected.no), `${locale} XLSX must include a human-readable boolean label`);
    assert.match(readmeXml, /t="b"[^>]*><v>0<\/v>/);
    assert.ok(questionnaireXml.includes(localizedPrice), `${locale} XLSX must use locale-aware currency formatting`);
    assert.match(questionnaireXml, /Technical currency ID|货币技术 ID|通貨の技術 ID|통화 기술 ID/);
    assert.match(questionnaireXml, /EUR/);
  }
});

test('XLSX localization never rewrites explicit technical JSON, codes, or lineage pass-through values', () => {
  const localized = exportFidelityHandoff();
  const technicalSentinel = 'Have a human researcher review and cognitively pretest the instrument.';
  localized.questionnaire.language = 'zh-CN';
  localized.questionnaire.questions[1].items[0].itemId = technicalSentinel;
  localized.questionnaire.questions[1].items[0].technicalNote = technicalSentinel;
  localized.analysisPlan.technicalNote = technicalSentinel;
  localized.sourceStudy.technicalNote = technicalSentinel;

  const files = unzipSync(humanResearchHandoffToXlsx(localized));
  const questionnaireXml = strFromU8(files['xl/worksheets/sheet2.xml']);
  const analysisXml = strFromU8(files['xl/worksheets/sheet7.xml']);
  const lineageXml = strFromU8(files['xl/worksheets/sheet8.xml']);
  assert.ok((questionnaireXml.match(new RegExp(technicalSentinel, 'g')) || []).length >= 2, 'items_json and record_json must retain the exact technical sentinel');
  assert.ok(analysisXml.includes(technicalSentinel), 'technical analysis-plan JSON must retain the exact sentinel');
  assert.ok(lineageXml.includes(technicalSentinel), 'technical lineage pass-through values must retain the exact sentinel');
  assert.ok(humanResearchBriefText(localized).includes(`项目技术 ID: ${technicalSentinel}`), 'TXT technical IDs must retain the exact sentinel');
  assert.match(questionnaireXml, /PRIMARY_OUTCOME/);
  assert.match(lineageXml, /FIELD_DRAFT_REQUIRES_REVIEW/);
});

test('CSV, XLSX, and text exports preserve optional method-specific questionnaire items', () => {
  const itemized = structuredClone(handoff);
  const baseQuestion = itemized.questionnaire.questions[1];
  itemized.questionnaire.questions = [
    {
      ...baseQuestion,
      questionId: 'Q_RANK',
      type: 'RANK_ORDER',
      text: 'Rank the features.',
      items: [{ itemId: 'feature-fast', text: 'Fast setup', priority: 'HIGH' }],
    },
    {
      ...baseQuestion,
      questionId: 'Q_MATRIX',
      type: 'MATRIX_SINGLE_SELECT',
      text: 'Choose a brand for each attribute.',
      items: [{ itemId: 'attribute-trust', text: 'Trustworthy', scale: 'BRAND_ATTRIBUTE' }],
    },
    {
      ...baseQuestion,
      questionId: 'Q_PRICE',
      type: 'MATRIX_SINGLE_SELECT',
      text: 'Rate each price point.',
      items: [{ itemId: 'price-49', text: '49.95 USD per month', amount: 49.95, currency: 'USD', unit: 'month' }],
    },
    {
      ...baseQuestion,
      questionId: 'Q_PRETEST',
      type: 'OPEN_TEXT',
      text: 'Describe any comprehension difficulty.',
      items: [{ itemId: 'survey-clarity', text: 'How clear was the instruction?', responseFormat: 'OPEN_TEXT' }],
    },
  ];

  const csv = humanResearchHandoffToCsv(itemized);
  assert.match(csv, /item_id/);
  assert.match(csv, /item_json/);
  for (const value of ['feature-fast', 'attribute-trust', 'price-49', 'survey-clarity', '49.95']) assert.match(csv, new RegExp(value));

  const questionnaireXml = strFromU8(unzipSync(humanResearchHandoffToXlsx(itemized))['xl/worksheets/sheet2.xml']);
  assert.match(questionnaireXml, /items_json/);
  for (const value of ['feature-fast', 'attribute-trust', 'price-49', 'survey-clarity', '49.95']) assert.match(questionnaireXml, new RegExp(value));
  assert.match(questionnaireXml, /&quot;amount&quot;/);

  const brief = humanResearchBriefText(itemized);
  assert.match(brief, /Items:/);
  assert.match(brief, /\$49\.95 · month/);
  assert.match(brief, /Technical item ID: price-49/);
  assert.match(brief, /"amount":49\.95,"currency":"USD","itemId":"price-49","text":"49\.95 USD per month","unit":"month"/);
  for (const value of ['feature-fast', 'attribute-trust', 'survey-clarity']) assert.match(brief, new RegExp(value));
});

test('all exports preserve complete versioned questionnaire and stimulus records with package integrity', () => {
  const fidelity = exportFidelityHandoff();
  const uxStimulus = fidelity.questionnaire.stimuli[0];
  const pricedOffer = fidelity.questionnaire.stimuli[1];
  const primaryQuestion = fidelity.questionnaire.questions[1];

  const csv = humanResearchHandoffToCsv(fidelity);
  const [,, headers, ...dataRows] = csvRows(csv);
  const indexFor = (header) => headers.indexOf(header);
  assert.ok(indexFor('record_type') >= 0);
  assert.ok(indexFor('record_version') >= 0);
  assert.ok(indexFor('record_json') >= 0);
  const csvStimulusRecords = dataRows
    .filter((row) => row[indexFor('record_type')] === 'STIMULUS')
    .map((row) => ({ version: row[indexFor('record_version')], record: JSON.parse(row[indexFor('record_json')]) }));
  assert.deepEqual(csvStimulusRecords, [
    { version: 'human-research-stimulus-v1', record: uxStimulus },
    { version: 'human-research-stimulus-v1', record: pricedOffer },
  ]);
  const csvQuestionRecord = dataRows.find((row) => row[indexFor('record_type')] === 'QUESTION' && row[indexFor('question_id')] === primaryQuestion.questionId);
  assert.equal(csvQuestionRecord[indexFor('record_version')], 'human-research-question-v1');
  assert.deepEqual(JSON.parse(csvQuestionRecord[indexFor('record_json')]), primaryQuestion);
  assert.match(csv, /'=?A first-time administrator exports/);

  const brief = humanResearchBriefText(fidelity);
  for (const value of ['QUESTION RECORDS', 'STIMULUS RECORDS', 'experienceDescription', 'LAPTOP_BROWSER', 'referenceAlternative', 'Arrange a charger independently', 'task-ease']) assert.match(brief, new RegExp(value));

  const files = unzipSync(humanResearchHandoffToXlsx(fidelity));
  const questionnaireXml = strFromU8(files['xl/worksheets/sheet2.xml']);
  const lineageXml = strFromU8(files['xl/worksheets/sheet8.xml']);
  for (const value of ['Technical record type', 'Technical record version', 'record_json', 'experienceDescription', 'LAPTOP_BROWSER', 'referenceAlternative', 'task-ease']) assert.match(questionnaireXml, new RegExp(value));
  for (const [part, hash] of Object.entries(fidelity.packageHashes)) {
    assert.match(lineageXml, new RegExp(`humanResearchPackageHash_${part}`));
    assert.match(lineageXml, new RegExp(hash));
  }
  assert.match(lineageXml, /humanResearchPackageVersion/);
  assert.doesNotMatch(questionnaireXml, /<f(?:\s|>)/);

  const receipt = JSON.parse(humanResearchReceiptJson(fidelity));
  assert.deepEqual(receipt.questionnaire.stimulusRecords, [
    { recordType: 'STIMULUS', recordVersion: 'human-research-stimulus-v1', record: uxStimulus },
    { recordType: 'STIMULUS', recordVersion: 'human-research-stimulus-v1', record: pricedOffer },
  ]);
  assert.deepEqual(receipt.questionnaire.questionRecords.find(({ record }) => record.questionId === primaryQuestion.questionId), {
    recordType: 'QUESTION', recordVersion: 'human-research-question-v1', record: primaryQuestion,
  });
  assert.deepEqual(receipt.humanResearchPackage, {
    version: fidelity.packageVersion,
    integrity: { packageHash: fidelity.packageHashes.package, partHashes: fidelity.packageHashes },
  });
});

test('exports render an unavailable recommended-completes value without inventing a number', () => {
  const withoutRecommendation = structuredClone(handoff);
  withoutRecommendation.samplePlan.recommendedCompletes = null;
  withoutRecommendation.samplePlan.calculation.baseCompletes = null;

  const brief = humanResearchBriefText(withoutRecommendation);
  assert.match(brief, /Sample-plan status: Planning estimate/);
  assert.match(brief, /Technical status ID: PLANNING_ESTIMATE/);
  assert.match(brief, /Sample-plan instruction: Not recorded/);
  assert.doesNotMatch(brief, /Nominal full-sample reference \(planning only\): 385\./);

  const recruitmentXml = strFromU8(unzipSync(humanResearchHandoffToXlsx(withoutRecommendation))['xl/worksheets/sheet6.xml']);
  assert.match(recruitmentXml, /Not recorded/);
});

test('XLSX rejects oversized input before compression', () => {
  const oversized = structuredClone(handoff);
  oversized.questionnaire.questions[0].text = 'x'.repeat(32_001);
  assert.throws(() => humanResearchHandoffToXlsx(oversized), /32,000 characters/i);
});

test('exporters reject malformed handoff shapes with a controlled error', () => {
  assert.throws(() => humanResearchHandoffToXlsx({ questionnaire: {} }), /Invalid human-research handoff/);
  assert.throws(() => humanResearchHandoffToCsv({}), /Invalid human-research handoff/);
  for (const mutate of [
    (value) => { value.questionnaire.questions[0].options = {}; },
    (value) => { value.screeningPlan.terminationLogic[0].when.values = {}; },
    (value) => { value.quotaPlan.monitorTargets = [{ categories: {} }]; },
    (value) => { value.samplePlan.recommendedCompletes = 0; },
    (value) => { value.questionnaire.questions[0].options = [null]; },
    (value) => { value.questionnaire.questions[0].items = {}; },
    (value) => { value.questionnaire.questions[0].items = [null]; },
    (value) => { value.questionnaire.questions[0].items = [{ itemId: '', text: 'Missing stable item ID.' }]; },
    (value) => { value.questionnaire.questions[0].items = [{ itemId: 'duplicate', text: 'First.' }, { itemId: 'duplicate', text: 'Second.' }]; },
    (value) => { value.questionnaire.stimuli = [null]; },
    (value) => { value.screeningPlan.criteria = [null]; },
    (value) => { value.quotaPlan.targets = [{ categories: [null] }]; },
    (value) => { value.providerLinks = [null]; },
  ]) {
    const malformed = structuredClone(handoff);
    mutate(malformed);
    assert.throws(() => humanResearchHandoffToXlsx(malformed), /Invalid human-research handoff/);
  }
});
