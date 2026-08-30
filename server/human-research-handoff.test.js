import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHumanResearchHandoff } from './human-research-handoff.js';

const populationFrame = {
  frameVersion: 'population-frame-v1',
  intendedPopulation: 'Adults expecting to replace a vehicle within 36 months',
  geography: { market: 'Spain', countryCode: 'ES' },
  languages: { outputLocale: 'en-US', sourceLanguages: ['es'] },
  officialSourceDatasets: [{ id: 'ine-age', title: 'Age structure', coverageDate: '2026-01-01' }],
  marginalDistributions: [{ variable: 'age', label: 'Age', sourceDatasetId: 'ine-age', categories: [{ value: '18–34', share: 0.3 }, { value: '35–54', share: 0.45 }, { value: '55+', share: 0.25 }] }],
  knownIntersections: [],
  weighting: { method: 'RAKING_IPF', status: 'CONVERGED' },
  unsupportedCharacteristics: ['Vehicle replacement timing among apartment residents'],
  coverageDate: '2026-01-01',
};

const input = {
  prompt: 'How likely are you to buy this electric vehicle charging plan?',
  audience: populationFrame.intendedPopulation,
  market: 'Spain',
  outputLocale: 'en-US',
  researchMethod: 'PURCHASE_INTENT',
  methodConfig: {
    method: 'PURCHASE_INTENT',
    offer: { id: 'offer-1', text: '=A home EV charging service with installation and support.' },
    category: 'Home EV charging',
    price: { amount: 49, currency: 'EUR', unit: 'per month' },
    channel: 'Online purchase',
    purchaseHorizon: 'Within 36 months',
    referenceAlternative: 'Arrange a charger independently',
  },
};

const researchDesign = {
  methodId: 'PURCHASE_INTENT',
  methodVersion: 'purchase-intent-v1',
  estimand: 'Stated purchase likelihood for the exact priced offer',
  scale: { id: 'PURCHASE_INTENT_5', anchors: ['Definitely would not', 'Probably would not', 'Might or might not', 'Probably would', 'Definitely would'] },
  humanValidation: { recommendedMethod: 'Sampled purchase-intent survey', minimumChecks: ['category eligibility', 'priced intent'] },
};

const handoff = buildHumanResearchHandoff({
  input,
  frame: { neutralQuestion: 'How likely would you be to purchase this exact offer?' },
  researchDesign,
  populationFrame,
  study: { cautions: ['Stated intent is hypothetical.'] },
  reproducibility: {
    inputHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), populationFrameHash: 'c'.repeat(64), researchDesignHash: 'd'.repeat(64), modelCardHash: 'e'.repeat(64), runtimeVersion: 'runtime-v1', promptVersions: { panel: 'panel-v4' }, schemaVersions: { panel: 'study-schema-v1' }, modelRoutes: [],
  },
  evidenceCatalog: [{ id: 'evidence-upload-1', clientMaterialId: 'material-1234567890abcdef1234', title: 'notes.txt', sourceKind: 'UPLOADED_TEXT', contentHandling: 'BOUNDED_RAW_TEXT', detectedType: 'txt', declaredMime: 'text/plain', verificationStatus: 'UNVERIFIED', clientContentHash: 'f'.repeat(64), contentHash: '1'.repeat(64), originalCharacterCount: 120, truncated: false }],
  studyId: 'study-1',
  runId: 'run-1',
  generatedAt: '2026-08-29T12:00:00.000Z',
});

function handoffFor(methodInput, designOverrides = {}) {
  return buildHumanResearchHandoff({
    input: methodInput,
    frame: { neutralQuestion: methodInput.prompt || 'Neutral framing should not replace the method construct.' },
    researchDesign: {
      methodId: methodInput.researchMethod,
      methodVersion: `${methodInput.researchMethod.toLowerCase().replaceAll('_', '-')}-v1`,
      estimand: `${methodInput.researchMethod} estimand`,
      scale: { id: `${methodInput.researchMethod}_5`, anchors: ['1', '2', '3', '4', '5'] },
      humanValidation: { recommendedMethod: `${methodInput.researchMethod} human validation`, minimumChecks: ['review'] },
      ...designOverrides,
    },
    populationFrame,
    study: { cautions: [] },
    reproducibility: handoff.sourceStudy,
    evidenceCatalog: [],
    studyId: `study-${methodInput.researchMethod}`,
    runId: `run-${methodInput.researchMethod}`,
    generatedAt: handoff.generatedAt,
  });
}

const respondentFacingCopy = (questionnaire) => [
  questionnaire.title,
  questionnaire.disclosure,
  ...questionnaire.stimuli.map((stimulus) => stimulus.text),
  ...questionnaire.questions.flatMap((question) => [
    question.text,
    question.instruction,
    ...question.options.map((option) => option.label),
    ...(question.items || []).map((item) => item.text),
  ]),
].filter((value) => typeof value === 'string' && value.length).join(' ');

const collectedIds = (questionnaire) => new Set([
  ...questionnaire.stimuli.map((stimulus) => stimulus.stimulusId),
  ...questionnaire.questions.flatMap((question) => question.provenance.sourceIds),
  ...questionnaire.questions.flatMap((question) => question.options.map((option) => option.code)),
  ...questionnaire.questions.flatMap((question) => (question.items || []).map((item) => item.itemId)),
]);

test('human handoff is a versioned field draft with no recruitment or observed-response claim', () => {
  assert.equal(handoff.schemaVersion, 'human-research-handoff-v1');
  assert.equal(handoff.status, 'READY_FOR_RESEARCHER_REVIEW');
  assert.equal(handoff.contentStatus, 'FIELD_DRAFT_REQUIRES_REVIEW');
  assert.match(handoff.boundary, /has not recruited, screened, contacted, or surveyed anyone/i);
  assert.equal(handoff.sourceStudy.observedHumanResponses, false);
  assert.equal(handoff.sourceStudy.runId, 'run-1');
  assert.equal(handoff.questionnaire.questions.some((question) => question.analysisRole === 'PRIMARY_OUTCOME'), true);
  assert.equal(handoff.questionnaire.questions.some((question) => question.type === 'STIMULUS'), true);
  assert.equal(handoff.researchGrounding.materials[0].clientMaterialId, 'material-1234567890abcdef1234');
  assert.equal(handoff.researchGrounding.materials[0].evidenceId, 'evidence-upload-1');
  assert.match(handoff.researchGrounding.disclosure, /do not authenticate/i);
  assert.equal(handoff.screeningPlan.terminationLogic.length, 1);
  assert.equal(handoff.screeningPlan.terminationLogic[0].action, 'TERMINATE_NO_CONSENT');
  assert.equal(handoff.screeningPlan.terminationLogic[0].reasonCode, 'CONSENT_NOT_GRANTED');
  assert.match(handoff.screeningPlan.terminationLogic[0].denominatorTreatment, /EXCLUDE_BEFORE/);
  assert.equal(handoff.analysisPlan.exclusions.some((item) => /consent not granted/i.test(item)), false);
});

test('directional survey sample size is transparent planning math and incidence never comes from synthetic output', () => {
  assert.equal(handoff.samplePlan.status, 'PLANNING_ESTIMATE');
  assert.equal(handoff.samplePlan.recommendedCompletes, 385);
  assert.equal(handoff.samplePlan.parameters.assumedProportion, 0.5);
  assert.equal(handoff.samplePlan.parameters.nominalPrecisionPp, 5);
  assert.match(handoff.samplePlan.recommendation, /nominal full-sample.*reference only/i);
  assert.equal(handoff.samplePlan.recommendationKind, 'POINT_REFERENCE');
  assert.equal(handoff.samplePlan.scope, 'FULL_SAMPLE_PRIMARY_PROPORTION');
  assert.equal(handoff.samplePlan.precisionClaimAllowed, false);
  assert.equal(handoff.samplePlan.parameters.designEffect, null);
  assert.match(handoff.samplePlan.disclosure, /simple-random-sample-equivalent calculation/i);
  assert.equal(handoff.incidencePlan.status, 'UNESTIMATED');
  assert.equal(handoff.incidencePlan.pointEstimate, null);
  assert.match(handoff.incidencePlan.disclosure, /Synthetic response percentages are never used/i);
});

test('population marginals remain monitor-only when the screened denominator is unproven', () => {
  assert.equal(handoff.quotaPlan.status, 'TARGETS_UNAVAILABLE');
  assert.equal(handoff.quotaPlan.targets.length, 0);
  assert.equal(handoff.quotaPlan.monitorTargets[0].denominatorMatch, 'UNVERIFIED');
  assert.equal(handoff.quotaPlan.monitorTargets[0].collectionStatus, 'NOT_INCLUDED_IN_INSTRUMENT');
  assert.equal(handoff.quotaPlan.weightingPlan.status, 'TARGETS_UNAVAILABLE');
  assert.deepEqual(handoff.quotaPlan.weightingPlan.targets, []);
  assert.equal(handoff.quotaPlan.targetCompletes, null);
  assert.deepEqual(handoff.quotaPlan.monitorTargets[0].categories.map((category) => category.referenceShare), [0.3, 0.45, 0.25]);
  assert.equal(handoff.quotaPlan.monitorTargets[0].type, 'POPULATION_REFERENCE_ONLY');
  assert.equal(handoff.quotaPlan.monitorTargets[0].categories.some((category) => Object.hasOwn(category, 'targetCompletes')), false);
  assert.ok(handoff.missingFields.includes('Defensible achieved-sample quota targets'));
});

test('purchase-intent handoff preserves exact offer conditions and rejects sales forecasting', () => {
  const serialized = JSON.stringify(handoff);
  assert.match(serialized, /49 EUR per month/);
  assert.match(serialized, /Online purchase/);
  assert.match(serialized, /Within 36 months/);
  assert.match(serialized, /Arrange a charger independently/);
  assert.match(serialized, /not observed conversion, demand, revenue, or market size/i);
  assert.equal(serialized.includes('200 personas'), false);
});

test('general Likert handoff blocks incompatible constructs and unexpected locale scripts', () => {
  const common = { researchMethod: 'GENERAL_LIKERT', methodConfig: { method: 'GENERAL_LIKERT' }, audience: 'Adults', market: 'Japan' };
  const generalDesign = { ...researchDesign, methodId: 'GENERAL_LIKERT', methodVersion: 'general-likert-v1' };
  const incompatible = buildHumanResearchHandoff({ input: { ...common, prompt: 'How satisfied are you with the service?', outputLocale: 'en-US' }, frame: { neutralQuestion: 'How satisfied are you with the service?' }, researchDesign: generalDesign, populationFrame, study: { cautions: [] }, reproducibility: handoff.sourceStudy, studyId: 'study-2', runId: 'run-2', generatedAt: handoff.generatedAt });
  assert.equal(incompatible.status, 'BLOCKED');
  assert.ok(incompatible.blockingIssues.includes('GENERAL_LIKERT_REQUIRES_SPECIALIZED_METHOD'));
  assert.equal(incompatible.samplePlan.status, 'BLOCKED');
  assert.equal(incompatible.samplePlan.recommendedCompletes, null);

  const scriptMismatch = buildHumanResearchHandoff({ input: { ...common, prompt: 'How likely are you to adopt this?', outputLocale: 'en-US', localization: { report: { locale: 'en-US' }, instrument: { locale: 'ja-JP' } } }, frame: { neutralQuestion: 'How likely are you to adopt this?' }, researchDesign: generalDesign, populationFrame, study: { cautions: [] }, reproducibility: handoff.sourceStudy, studyId: 'study-3', runId: 'run-3', generatedAt: handoff.generatedAt });
  assert.equal(scriptMismatch.status, 'BLOCKED');
  assert.ok(scriptMismatch.blockingIssues.includes('PRIMARY_ITEM_OUTPUT_LOCALE_SCRIPT_MISMATCH'));
  assert.equal(scriptMismatch.questionnaire.language, 'ja-JP');
  assert.match(scriptMismatch.questionnaire.questions.find((question) => question.questionId === 'S_CONSENT').text, /研究/);
});

test('handoff blocks report and instrument locale divergence while retaining each locale in lineage', () => {
  const localization = { schemaVersion: 'study-localization-v1', report: { locale: 'en-US' }, instrument: { locale: 'es-ES' } };
  const mismatchedLocale = buildHumanResearchHandoff({
    input: { ...input, localization },
    frame: { neutralQuestion: 'How likely would you be to purchase this exact offer?' },
    researchDesign,
    populationFrame,
    study: { cautions: [] },
    reproducibility: handoff.sourceStudy,
    studyId: 'study-locale-mismatch',
    runId: 'run-locale-mismatch',
    generatedAt: handoff.generatedAt,
  });

  assert.equal(mismatchedLocale.status, 'BLOCKED');
  assert.ok(mismatchedLocale.blockingIssues.includes('REPORT_INSTRUMENT_LOCALE_MISMATCH_REQUIRES_TRANSLATION_REVIEW'));
  assert.equal(mismatchedLocale.sourceStudy.outputLocale, 'en-US');
  assert.equal(mismatchedLocale.sourceStudy.reportLocale, 'en-US');
  assert.equal(mismatchedLocale.sourceStudy.instrumentLocale, 'es-ES');
  assert.equal(mismatchedLocale.sourceStudy.localizationReceipt, localization);
  assert.equal(mismatchedLocale.questionnaire.language, 'es-ES');
  assert.equal(mismatchedLocale.questionnaire.languageValidation.templateLocaleSupported, true);
  assert.match(mismatchedLocale.questionnaire.title, /cuestionario/i);
  assert.match(mismatchedLocale.questionnaire.questions.find((question) => question.questionId === 'Q_PRIMARY').text, /probabilidad/i);
});

test('CJK instrument locales generate script-appropriate respondent-facing drafts', () => {
  const expectedScript = {
    'zh-CN': { script: /[\u3400-\u9fff]/, offer: '带安装和支持的家用电动车充电服务。', category: '家用电动车充电', unit: '每月', channel: '线上购买', purchaseHorizon: '未来三十六个月内', referenceAlternative: '自行安排充电器' },
    'ja-JP': { script: /[\u3040-\u30ff]/, offer: '設置とサポートを含む家庭用電気自動車充電サービス。', category: '家庭用電気自動車充電', unit: '月額', channel: 'オンライン購入', purchaseHorizon: '今後三十六か月以内', referenceAlternative: '自分で充電器を手配する' },
    'ko-KR': { script: /[\uac00-\ud7af]/, offer: '설치와 지원을 포함한 가정용 전기차 충전 서비스.', category: '가정용 전기차 충전', unit: '월간', channel: '온라인 구매', purchaseHorizon: '향후 삼십육 개월 이내', referenceAlternative: '충전기를 직접 준비함' },
  };
  for (const [instrumentLocale, localeCase] of Object.entries(expectedScript)) {
    const localized = buildHumanResearchHandoff({
      input: {
        ...input,
        outputLocale: instrumentLocale,
        methodConfig: {
          ...input.methodConfig,
          offer: { id: input.methodConfig.offer.id, text: localeCase.offer },
          category: localeCase.category,
          price: { ...input.methodConfig.price, unit: localeCase.unit },
          channel: localeCase.channel,
          purchaseHorizon: localeCase.purchaseHorizon,
          referenceAlternative: localeCase.referenceAlternative,
        },
        localization: { report: { locale: instrumentLocale }, instrument: { locale: instrumentLocale } },
      },
      frame: { neutralQuestion: input.prompt },
      researchDesign,
      populationFrame,
      study: { cautions: [] },
      reproducibility: handoff.sourceStudy,
      studyId: `study-${instrumentLocale}`,
      runId: `run-${instrumentLocale}`,
      generatedAt: handoff.generatedAt,
    });
    const respondentCopy = respondentFacingCopy(localized.questionnaire);
    assert.equal(localized.questionnaire.language, instrumentLocale);
    assert.equal(localized.questionnaire.languageValidation.templateLocaleSupported, true);
    assert.equal(localized.questionnaire.languageValidation.status, 'HUMAN_TRANSLATION_REVIEW_REQUIRED');
    assert.match(respondentCopy, localeCase.script);
    assert.doesNotMatch(respondentCopy, /\b(Yes|No|How|Please|Thank|Definitely|Probably|purchase|offer|Not sure)\b/i);
  }
});

test('respondent-instrument locale admission is exact and never maps zh-TW to the zh-CN template', () => {
  const unsupported = handoffFor({
    prompt: '这个概念清楚吗？',
    audience: '成年人',
    market: 'Taiwan',
    outputLocale: 'zh-TW',
    localization: { report: { locale: 'zh-TW' }, instrument: { locale: 'zh-TW' } },
    researchMethod: 'CONCEPT_TEST',
    methodConfig: { method: 'CONCEPT_TEST', concept: { id: 'concept-zh-tw', text: '一项家用充电服务。' } },
  });

  assert.equal(unsupported.status, 'BLOCKED');
  assert.ok(unsupported.blockingIssues.includes('UNSUPPORTED_HANDOFF_LOCALE_REQUIRES_HUMAN_TRANSLATION'));
  assert.deepEqual(unsupported.questionnaire.questions, []);
  assert.deepEqual(unsupported.questionnaire.stimuli, []);
  assert.equal(respondentFacingCopy(unsupported.questionnaire), '');
});

test('CJK handoffs fail closed for English respondent stimulus while valid localized specialized methods remain ready', () => {
  const englishStimulus = handoffFor({
    prompt: '这条信息是否清楚？',
    audience: '成年人',
    market: 'China',
    outputLocale: 'zh-CN',
    localization: { report: { locale: 'zh-CN' }, instrument: { locale: 'zh-CN' } },
    researchMethod: 'MESSAGE_TEST',
    methodConfig: {
      method: 'MESSAGE_TEST',
      message: { id: 'message-english', text: 'ENGLISH-STIMULUS-ONLY' },
      intendedAction: '开始免费试用',
      exposureContext: '网站首页',
    },
  });
  assert.equal(englishStimulus.status, 'BLOCKED');
  assert.ok(englishStimulus.blockingIssues.includes('RESPONDENT_FACING_USER_COPY_LOCALE_SCRIPT_MISMATCH'));
  assert.deepEqual(englishStimulus.questionnaire.questions, []);
  assert.deepEqual(englishStimulus.questionnaire.stimuli, []);

  const englishDevice = handoffFor({
    prompt: '这个任务容易完成吗？',
    audience: '成年人',
    market: 'China',
    outputLocale: 'zh-CN',
    localization: { report: { locale: 'zh-CN' }, instrument: { locale: 'zh-CN' } },
    researchMethod: 'UX_EXPECTATION_TEST',
    methodConfig: {
      method: 'UX_EXPECTATION_TEST',
      taskScenario: { id: 'export-report', text: '管理员导出上个月的账户活动。' },
      userGoal: '为财务团队创建报告',
      experienceDescription: '浏览器仪表板包含报告页面和 CSV 导出操作。',
      device: 'Laptop browser with keyboard shortcuts',
    },
  });
  assert.equal(englishDevice.status, 'BLOCKED');
  assert.ok(englishDevice.blockingIssues.includes('RESPONDENT_FACING_USER_COPY_LOCALE_SCRIPT_MISMATCH'));
  assert.deepEqual(englishDevice.questionnaire.questions, []);
  assert.deepEqual(englishDevice.questionnaire.stimuli, []);

  const validCases = [
    {
      input: {
        prompt: '这条信息是否清楚？', audience: '成年人', market: 'China', outputLocale: 'zh-CN', localization: { report: { locale: 'zh-CN' }, instrument: { locale: 'zh-CN' } }, researchMethod: 'MESSAGE_TEST',
        methodConfig: { method: 'MESSAGE_TEST', message: { id: 'message-cn', text: '将每月报告集中到一个共享工作区。' }, intendedAction: '开始免费试用', exposureContext: '网站首页' },
      },
      expectedScript: /[\u3400-\u9fff]/,
    },
    {
      input: {
        prompt: 'どの機能が重要ですか？', audience: '管理者', market: 'Japan', outputLocale: 'ja-JP', localization: { report: { locale: 'ja-JP' }, instrument: { locale: 'ja-JP' } }, researchMethod: 'FEATURE_PRIORITIZATION',
        methodConfig: { method: 'FEATURE_PRIORITIZATION', features: [{ id: 'setup', text: '設定のしやすさ' }, { id: 'export', text: 'データの書き出し' }, { id: 'sharing', text: 'チーム共有' }], decisionContext: '次の製品投資を選ぶ', selectionConstraint: 'すべての機能を優先順位順に並べてください' },
      },
      expectedScript: /[\u3040-\u30ff]/,
    },
    {
      input: {
        prompt: '인터뷰 가이드를 만드세요.', audience: '최근 평가자', market: 'South Korea', outputLocale: 'ko-KR', localization: { report: { locale: 'ko-KR' }, instrument: { locale: 'ko-KR' } }, researchMethod: 'INTERVIEW_GUIDE',
        methodConfig: { method: 'INTERVIEW_GUIDE', researchObjective: '온보딩 장벽 이해', participantContext: '최근 소프트웨어 평가자', topics: [{ id: 'context', label: '현재 상황' }, { id: 'barriers', label: '주요 장벽' }], sensitiveAreas: ['사업 재정'] },
      },
      expectedScript: /[\uac00-\ud7af]/,
    },
  ];

  for (const validCase of validCases) {
    const localized = handoffFor(validCase.input, { scale: null });
    assert.equal(localized.status, 'READY_FOR_RESEARCHER_REVIEW', validCase.input.researchMethod);
    assert.match(respondentFacingCopy(localized.questionnaire), validCase.expectedScript);
  }
});

test('all specialized methods own the primary construct and preserve supplied IDs and items', () => {
  const cases = [
    {
      input: { prompt: 'How clear is this concept?', audience: 'Adults', market: 'US', outputLocale: 'en-US', researchMethod: 'CONCEPT_TEST', methodConfig: { method: 'CONCEPT_TEST', concept: { id: 'concept-1', text: 'A clearly described service concept.' } } },
      expectedTitle: /concept-test/i,
      expectedPrimary: /using or adopting this concept/i,
      exactIds: ['concept-1'],
      exactTexts: ['A clearly described service concept.'],
    },
    {
      input,
      designOverrides: researchDesign,
      expectedTitle: /purchase-intent/i,
      expectedPrimary: /purchase it within 36 months/i,
      exactIds: ['offer-1'],
      exactTexts: ['=A home EV charging service with installation and support.\n49 EUR per month\nOnline purchase\nWithin 36 months\nArrange a charger independently'],
    },
    {
      input: { prompt: 'Which message motivates signup?', audience: 'Admins', market: 'US', outputLocale: 'en-US', researchMethod: 'MESSAGE_TEST', methodConfig: { method: 'MESSAGE_TEST', message: { id: 'message-a', text: 'Move your monthly reporting from scattered spreadsheets into one shared workspace.' }, intendedAction: 'Start a free trial', exposureContext: 'Website hero' } },
      expectedTitle: /message-test/i,
      expectedPrimary: /compelling.*Start a free trial/i,
      exactIds: ['message-a'],
      exactTexts: ['Move your monthly reporting from scattered spreadsheets into one shared workspace.'],
    },
    {
      input: { prompt: 'Is this claim credible?', audience: 'Finance leads', market: 'US', outputLocale: 'en-US', researchMethod: 'CLAIMS_TEST', methodConfig: { method: 'CLAIMS_TEST', claim: { id: 'claim-a', text: 'Our service reduces routine reporting time by half.' }, claimStatus: 'UNVERIFIED' } },
      expectedTitle: /claims-test/i,
      expectedPrimary: /believable.*claim/i,
      exactIds: ['claim-a'],
      exactTexts: ['Our service reduces routine reporting time by half.'],
      assertExtra: (specialized) => assert.equal(specialized.questionnaire.stimuli[0].declaredClaimStatus, 'UNVERIFIED'),
    },
    {
      input: { prompt: 'Will admins expect this flow to be easy?', audience: 'Admins', market: 'US', outputLocale: 'en-US', researchMethod: 'UX_EXPECTATION_TEST', methodConfig: { method: 'UX_EXPECTATION_TEST', taskScenario: { id: 'first-export', text: 'A first-time administrator exports the prior month of account activity.' }, userGoal: 'Create a report for the finance team', experienceDescription: 'A browser dashboard with a reports section and CSV export action.', device: 'Laptop browser' } },
      expectedTitle: /UX-expectation/i,
      expectedPrimary: /easy or difficult.*Create a report for the finance team/i,
      exactIds: ['first-export'],
      exactTexts: ['A first-time administrator exports the prior month of account activity.'],
      assertExtra: (specialized) => assert.equal(specialized.questionnaire.stimuli[0].experienceDescription, 'A browser dashboard with a reports section and CSV export action.'),
    },
    {
      input: { prompt: 'Which features matter most?', audience: 'Admins', market: 'US', outputLocale: 'en-US', researchMethod: 'FEATURE_PRIORITIZATION', methodConfig: { method: 'FEATURE_PRIORITIZATION', features: [{ id: 'setup', text: 'Fast setup' }, { id: 'export', text: 'Data export' }, { id: 'sharing', text: 'Team sharing' }], decisionContext: 'Choose the next product investment', selectionConstraint: 'Rank every feature from highest to lowest priority' } },
      designOverrides: { scale: null },
      expectedTitle: /feature-prioritization/i,
      expectedPrimary: /Rank these features.*highest to lowest priority/i,
      expectedType: 'RANK_ORDER',
      exactIds: ['setup', 'export', 'sharing'],
      exactTexts: ['Fast setup', 'Data export', 'Team sharing'],
    },
    {
      input: { prompt: 'How is the brand positioned?', audience: 'Software buyers', market: 'US', outputLocale: 'en-US', researchMethod: 'BRAND_POSITIONING', methodConfig: { method: 'BRAND_POSITIONING', focalBrand: { id: 'our-brand', label: 'Our Brand' }, comparatorBrands: [{ id: 'brand-a', label: 'Brand A' }, { id: 'brand-b', label: 'Brand B' }], category: 'Project management software', attributes: [{ id: 'value', label: 'Value' }, { id: 'easy', label: 'Ease of use' }, { id: 'secure', label: 'Security' }] } },
      designOverrides: { scale: null },
      expectedTitle: /brand-positioning/i,
      expectedPrimary: /which brand.*Project management software.*attribute/i,
      expectedType: 'MATRIX_SINGLE_SELECT',
      exactIds: ['our-brand', 'brand-a', 'brand-b', 'value', 'easy', 'secure'],
      exactTexts: ['Our Brand', 'Brand A', 'Brand B', 'Value', 'Ease of use', 'Security'],
    },
    {
      input: { prompt: 'What is price sensitivity?', audience: 'Small business owners', market: 'US', outputLocale: 'en-US', researchMethod: 'PRICE_SENSITIVITY', methodConfig: { method: 'PRICE_SENSITIVITY', offer: { id: 'offer-a', text: 'A monthly reporting workspace for small business owners.' }, category: 'Reporting software', currency: 'EUR', unit: 'per month', channel: 'Direct website', purchaseHorizon: 'Within the next three months', referenceAlternative: 'Spreadsheets', pricePoints: [{ id: 'price-10', amount: 10 }, { id: 'price-15', amount: 15 }, { id: 'price-20', amount: 20 }] } },
      expectedTitle: /price-sensitivity/i,
      expectedPrimary: /For each supplied price.*purchase the exact offer/i,
      expectedType: 'MATRIX_SINGLE_SELECT',
      exactIds: ['offer-a', 'price-10', 'price-15', 'price-20'],
      exactTexts: ['A monthly reporting workspace for small business owners.\nReporting software\nDirect website\nWithin the next three months\nSpreadsheets', '10 EUR per month', '15 EUR per month', '20 EUR per month'],
      assertExtra: (specialized) => assert.deepEqual(
        specialized.questionnaire.questions.find((question) => question.questionId === 'Q_PRIMARY').items,
        [
          { itemId: 'price-10', amount: 10, currency: 'EUR', unit: 'per month', text: '10 EUR per month' },
          { itemId: 'price-15', amount: 15, currency: 'EUR', unit: 'per month', text: '15 EUR per month' },
          { itemId: 'price-20', amount: 20, currency: 'EUR', unit: 'per month', text: '20 EUR per month' },
        ],
      ),
    },
    {
      input: { prompt: 'Which survey questions need revision?', audience: 'Small business administrators', market: 'US', outputLocale: 'en-US', researchMethod: 'SURVEY_PRETEST', methodConfig: { method: 'SURVEY_PRETEST', studyObjective: 'Understand account-management satisfaction', targetPopulation: 'Small business administrators', surveyQuestions: [{ id: 'q-satisfaction', text: 'How satisfied are you with account management?' }, { id: 'q-renewal', text: 'How likely are you to renew this year?' }] } },
      designOverrides: { scale: null },
      expectedTitle: /cognitive-pretest guide/i,
      expectedPrimary: /survey question.*hard to answer/i,
      expectedType: 'OPEN_TEXT',
      exactIds: ['q-satisfaction', 'q-renewal'],
      exactTexts: ['How satisfied are you with account management?', 'How likely are you to renew this year?'],
    },
    {
      input: { prompt: 'Create an interview guide.', audience: 'Recent evaluators', market: 'US', outputLocale: 'en-US', researchMethod: 'INTERVIEW_GUIDE', methodConfig: { method: 'INTERVIEW_GUIDE', researchObjective: 'Understand onboarding barriers', participantContext: 'Recent small-business software evaluators', topics: [{ id: 'context', label: 'Current context' }, { id: 'barriers', label: 'Barriers' }], sensitiveAreas: ['Business finances'] } },
      designOverrides: { scale: null },
      expectedTitle: /interview guide/i,
      expectedPrimary: /Current context/i,
      expectedType: 'OPEN_TEXT',
      exactIds: ['context', 'barriers'],
      exactTexts: ['Current context', 'Barriers', 'Business finances'],
    },
  ];
  const expectedConstructs = {
    CONCEPT_TEST: 'CONCEPT_ADOPTION_INTENT',
    PURCHASE_INTENT: 'STATED_PURCHASE_INTENT_FOR_EXACT_OFFER',
    MESSAGE_TEST: 'MESSAGE_COMPELLINGNESS',
    CLAIMS_TEST: 'CLAIM_BELIEVABILITY',
    UX_EXPECTATION_TEST: 'EXPECTED_TASK_EASE',
    FEATURE_PRIORITIZATION: 'FEATURE_PRIORITY_RANKING',
    BRAND_POSITIONING: 'BRAND_ATTRIBUTE_ASSOCIATION',
    PRICE_SENSITIVITY: 'STATED_PURCHASE_INTENT_BY_SUPPLIED_PRICE',
    SURVEY_PRETEST: 'QUESTION_COMPREHENSION_AND_REVISION_NEEDS',
    INTERVIEW_GUIDE: 'INTERVIEW_GUIDE_PILOT_QUALITY',
  };
  const nominalProportionMethods = new Set(['CONCEPT_TEST', 'PURCHASE_INTENT', 'MESSAGE_TEST', 'CLAIMS_TEST', 'UX_EXPECTATION_TEST']);
  const qualitativeMethods = new Set(['SURVEY_PRETEST', 'INTERVIEW_GUIDE']);

  for (const methodCase of cases) {
    const specialized = handoffFor(methodCase.input, methodCase.designOverrides);
    const primary = specialized.questionnaire.questions.find((question) => question.questionId === 'Q_PRIMARY');
    const ids = collectedIds(specialized.questionnaire);
    const respondentCopy = respondentFacingCopy(specialized.questionnaire);
    assert.equal(specialized.status, 'READY_FOR_RESEARCHER_REVIEW', methodCase.input.researchMethod);
    assert.equal(specialized.questionnaire.languageValidation.status, 'HUMAN_TRANSLATION_REVIEW_REQUIRED');
    assert.ok(specialized.lifecycle.blockingIssues.includes('TRANSLATION_REVIEW'));
    assert.match(specialized.questionnaire.title, methodCase.expectedTitle, methodCase.input.researchMethod);
    assert.ok(primary, methodCase.input.researchMethod);
    assert.equal(primary.analysisRole, 'PRIMARY_OUTCOME');
    assert.equal(primary.provenance.class, 'METHOD_TEMPLATE');
    assert.equal(primary.type, methodCase.expectedType || 'SINGLE_SELECT');
    assert.match(primary.text, methodCase.expectedPrimary, methodCase.input.researchMethod);
    assert.doesNotMatch(primary.text, /Neutral framing should not replace|Which features matter most|Create an interview guide/i);
    assert.equal(specialized.analysisPlan.primaryEstimand.construct, expectedConstructs[methodCase.input.researchMethod]);
    const expectedExecutionMode = nominalProportionMethods.has(methodCase.input.researchMethod)
      ? 'QUANT_SURVEY'
      : qualitativeMethods.has(methodCase.input.researchMethod)
        ? methodCase.input.researchMethod === 'SURVEY_PRETEST' ? 'COGNITIVE_PRETEST' : 'INTERVIEW_GUIDE_PILOT'
        : 'QUANT_COMPLEX_DESIGN';
    assert.equal(specialized.executionMode, expectedExecutionMode);
    assert.equal(specialized.analysisPlan.executionMode, expectedExecutionMode);
    assert.ok(specialized.lifecycle.blockingIssues.includes('SAMPLE_DESIGN_REVIEW'));
    if (['FEATURE_PRIORITIZATION', 'BRAND_POSITIONING', 'SURVEY_PRETEST', 'INTERVIEW_GUIDE'].includes(methodCase.input.researchMethod)) assert.equal(specialized.analysisPlan.primaryEstimand.topTwoCodes, null);
    if (nominalProportionMethods.has(methodCase.input.researchMethod)) {
      assert.equal(specialized.samplePlan.status, 'PLANNING_ESTIMATE');
      assert.equal(specialized.samplePlan.recommendedCompletes, 385);
      assert.match(specialized.samplePlan.disclosure, /not a recommended field target, synthetic confidence interval/i);
    } else {
      assert.equal(specialized.samplePlan.status, 'RESEARCHER_DESIGN_REQUIRED');
      assert.equal(specialized.samplePlan.recommendedCompletes, null);
      assert.equal(specialized.samplePlan.calculation, null);
      assert.ok(specialized.samplePlan.requiredInputs.length >= 4);
      assert.ok(specialized.missingFields.includes('Method-specific sample-size or qualitative stopping-rule design'));
    }
    if (qualitativeMethods.has(methodCase.input.researchMethod)) {
      assert.equal(specialized.analysisPlan.weighting.status, 'NOT_APPLICABLE');
      assert.equal(specialized.analysisPlan.reporting.includes('FULL_DISTRIBUTIONS'), false);
      assert.equal(specialized.quotaPlan.status, 'NOT_APPLICABLE');
      assert.deepEqual(specialized.quotaPlan.monitorTargets, []);
      assert.equal(specialized.quotaPlan.coverageDimensions[0].categories[0].sourceShare, 0.3);
      assert.ok(specialized.lifecycle.blockingIssues.includes('SAMPLING_COVERAGE_REVIEW'));
      assert.doesNotMatch(specialized.recruitmentPlan.instructions.join(' '), /quota fill|straight-lining|weighting/i);
    } else {
      assert.equal(specialized.quotaPlan.status, 'TARGETS_UNAVAILABLE');
      assert.ok(specialized.lifecycle.blockingIssues.includes('DENOMINATOR_REVIEW'));
    }
    if (methodCase.input.researchMethod === 'BRAND_POSITIONING') {
      assert.equal(specialized.analysisPlan.methodProtocol.mode, 'FORCED_CHOICE_BRAND_ATTRIBUTE_MATRIX');
      assert.equal(specialized.analysisPlan.methodProtocol.familiarityMeasured, false);
      assert.ok(specialized.lifecycle.blockingIssues.includes('BRAND_MATRIX_DESIGN_REVIEW'));
      assert.ok(specialized.questionnaire.questions.find((question) => question.questionId === 'Q_PRIMARY').reviewFlags.includes('BRAND_FAMILIARITY_AND_OPT_OUT_REVIEW_REQUIRED'));
    }
    if (methodCase.input.researchMethod === 'PRICE_SENSITIVITY') {
      assert.equal(specialized.analysisPlan.methodProtocol.mode, 'SIMULTANEOUS_DESCRIPTIVE_PRICE_LADDER');
      assert.equal(specialized.analysisPlan.methodProtocol.randomized, false);
      assert.ok(specialized.lifecycle.blockingIssues.includes('PRICE_EXPOSURE_DESIGN_REVIEW'));
      assert.equal(specialized.analysisPlan.reporting.includes('PRICE_EXPOSURE_ORDER'), false);
    }
    if (methodCase.input.researchMethod === 'UX_EXPECTATION_TEST') {
      assert.equal(specialized.analysisPlan.methodProtocol.mode, 'EXPECTATION_SURVEY');
      assert.equal(specialized.analysisPlan.methodProtocol.observedTaskTestIncluded, false);
      assert.match(specialized.samplePlan.recommendation, /expected-ease self-report only/i);
    }
    if (methodCase.input.researchMethod === 'INTERVIEW_GUIDE') {
      assert.equal(specialized.analysisPlan.methodProtocol.mode, 'INTERVIEW_GUIDE_PILOT');
      assert.equal(specialized.analysisPlan.openTextCoding.planned, false);
      assert.equal(specialized.analysisPlan.reporting.includes('TOPIC_THEMATIC_SUMMARIES'), false);
    }
    for (const id of methodCase.exactIds) assert.ok(ids.has(id), `${methodCase.input.researchMethod} dropped ${id}`);
    for (const text of methodCase.exactTexts) assert.ok(respondentCopy.includes(text), `${methodCase.input.researchMethod} changed or omitted ${text}`);
    methodCase.assertExtra?.(specialized);
  }
});

test('complex quantitative handoffs require a frozen design instead of inventing a universal n', () => {
  const complexCases = [
    {
      researchMethod: 'FEATURE_PRIORITIZATION',
      methodConfig: { method: 'FEATURE_PRIORITIZATION', features: [{ id: 'a', text: 'Feature A' }, { id: 'b', text: 'Feature B' }, { id: 'c', text: 'Feature C' }], decisionContext: 'Roadmap choice', selectionConstraint: 'Rank all features' },
      expectedReporting: 'FULL_RANK_ORDERS',
    },
    {
      researchMethod: 'BRAND_POSITIONING',
      methodConfig: { method: 'BRAND_POSITIONING', focalBrand: { id: 'focal', label: 'Focal' }, comparatorBrands: [{ id: 'a', label: 'Brand A' }, { id: 'b', label: 'Brand B' }], category: 'Software', attributes: [{ id: 'easy', label: 'Easy' }, { id: 'secure', label: 'Secure' }, { id: 'value', label: 'Value' }] },
      expectedReporting: 'ATTRIBUTE_BRAND_SELECTION_MATRIX',
    },
    {
      researchMethod: 'PRICE_SENSITIVITY',
      methodConfig: { method: 'PRICE_SENSITIVITY', offer: { id: 'offer', text: 'A complete reporting workspace for small businesses.' }, category: 'Software', currency: 'USD', unit: 'per month', channel: 'Website', purchaseHorizon: 'Within three months', referenceAlternative: 'Spreadsheets', pricePoints: [{ id: 'p1', amount: 10 }, { id: 'p2', amount: 20 }, { id: 'p3', amount: 30 }] },
      expectedReporting: 'FULL_DISTRIBUTIONS_BY_PRICE_POINT',
    },
  ];
  for (const methodCase of complexCases) {
    const specialized = handoffFor({ prompt: 'Method-specific question', audience: 'Relevant adults', market: 'US', outputLocale: 'en-US', ...methodCase });
    assert.equal(specialized.samplePlan.status, 'RESEARCHER_DESIGN_REQUIRED', methodCase.researchMethod);
    assert.equal(specialized.samplePlan.recommendedCompletes, null, methodCase.researchMethod);
    assert.equal(specialized.samplePlan.calculation, null, methodCase.researchMethod);
    assert.match(specialized.samplePlan.disclosure, /does not invent a universal numeric target/i);
    assert.ok(specialized.analysisPlan.reporting.includes(methodCase.expectedReporting));
    assert.equal(specialized.analysisPlan.reporting.includes('FULL_DISTRIBUTIONS'), false);
  }
});

test('unsupported respondent-instrument locales fail closed without English questionnaire fallback', () => {
  const conceptInput = { prompt: 'How clear is this concept?', audience: 'Adults', market: 'Italy', outputLocale: 'en-US', researchMethod: 'CONCEPT_TEST', methodConfig: { method: 'CONCEPT_TEST', concept: { id: 'concept-1', text: 'A clearly described service concept.' } } };
  const conceptDesign = { ...researchDesign, methodId: 'CONCEPT_TEST', methodVersion: 'concept-test-v1' };
  const specialized = buildHumanResearchHandoff({ input: conceptInput, frame: { neutralQuestion: 'How clear is this concept?' }, researchDesign: conceptDesign, populationFrame, study: { cautions: [] }, reproducibility: handoff.sourceStudy, studyId: 'study-4', runId: 'run-4', generatedAt: handoff.generatedAt });
  const primary = specialized.questionnaire.questions.find((question) => question.questionId === 'Q_PRIMARY');
  assert.match(primary.text, /How likely/i);
  assert.equal(primary.provenance.class, 'METHOD_TEMPLATE');
  assert.equal(specialized.questionnaire.languageValidation.status, 'HUMAN_TRANSLATION_REVIEW_REQUIRED');

  const unsupported = buildHumanResearchHandoff({
    input: {
      ...conceptInput,
      outputLocale: 'it-IT',
      methodConfig: { method: 'CONCEPT_TEST', concept: { id: 'concetto-1', text: 'Un servizio di ricarica domestica con installazione e supporto.' } },
      localization: { report: { locale: 'it-IT' }, instrument: { locale: 'it-IT' } },
    },
    frame: { neutralQuestion: 'Quanto è chiaro questo concetto?' },
    researchDesign: conceptDesign,
    populationFrame,
    study: { cautions: [] },
    reproducibility: handoff.sourceStudy,
    studyId: 'study-5',
    runId: 'run-5',
    generatedAt: handoff.generatedAt,
  });
  assert.equal(unsupported.status, 'BLOCKED');
  assert.ok(unsupported.blockingIssues.includes('UNSUPPORTED_HANDOFF_LOCALE_REQUIRES_HUMAN_TRANSLATION'));
  assert.deepEqual(unsupported.questionnaire.questions, []);
  assert.deepEqual(unsupported.questionnaire.stimuli, []);
  assert.equal(unsupported.questionnaire.title, '');
  assert.equal(unsupported.questionnaire.disclosure, '');
  assert.equal(unsupported.questionnaire.languageValidation.templateLocaleSupported, false);
  assert.equal(unsupported.questionnaire.languageValidation.respondentFacingCopySource, 'NONE_BLOCKED');
  assert.ok(unsupported.lifecycle.blockingIssues.includes('TRANSLATION_REVIEW'));
  assert.equal(respondentFacingCopy(unsupported.questionnaire), '');
});

test('handoff carries a draft lifecycle receipt with hashes for every fielding package part', () => {
  assert.equal(handoff.lifecycle.contractVersion, 'human-research-lifecycle-v1');
  assert.equal(handoff.lifecycle.status, 'DRAFT');
  for (const part of ['questionnaire', 'screener', 'quota', 'recruitment', 'analysis', 'sourceLineage']) {
    assert.match(handoff.packageHashes[part], /^[a-f0-9]{64}$/);
  }
  assert.match(handoff.packageHashes.package, /^[a-f0-9]{64}$/);
  assert.ok(handoff.lifecycle.blockingIssues.includes('TRANSLATION_REVIEW'));
  assert.ok(handoff.lifecycle.blockingIssues.includes('ANALYSIS_REVIEW'));
});
