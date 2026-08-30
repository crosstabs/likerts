import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertExactUiCatalogCoverage,
  CJK_UI_CATALOGS,
  CJK_UI_CANONICAL_TECHNICAL_KEYS,
  CJK_UI_COPY_PROVENANCE,
  CJK_UI_LOCALES,
  createUiCatalog,
  ENABLED_UI_CATALOGS,
  ENABLED_UI_LOCALE_IDS,
  ENGLISH_UI_CATALOG,
  languageOptions,
  MissingUiVariableError,
  MissingUiTranslationError,
  resolveUiMessage,
  UnsupportedUiLocaleError,
  UI_CATALOG_KEY_SET,
  uiCatalogCoverage,
} from '../src/i18nCatalog.mjs';
import { LOCALE_CAPABILITIES } from '../shared/localization.mjs';

test('enabled interface UI catalogs are capability-driven and complete', () => {
  const enabledUiLocales = languageOptions.map((option) => option.value);
  assert.deepEqual(enabledUiLocales, ['en-US', 'zh-CN', 'ja-JP', 'ko-KR']);
  assert.deepEqual(ENABLED_UI_LOCALE_IDS, enabledUiLocales);
  assert.deepEqual(Object.keys(ENABLED_UI_CATALOGS), enabledUiLocales);

  for (const locale of enabledUiLocales) {
    const catalog = ENABLED_UI_CATALOGS[locale];
    const coverage = uiCatalogCoverage(ENGLISH_UI_CATALOG, catalog);
    assert.deepEqual(Object.keys(catalog).sort(), UI_CATALOG_KEY_SET);
    assert.equal(coverage.exactKeySet, true);
    assert.equal(coverage.placeholderParity, true);
    assert.equal(coverage.stringsOnly, true);
    assert.deepEqual(coverage.missing, []);
    assert.deepEqual(coverage.extra, []);
    assert.deepEqual(coverage.placeholderMismatch, []);
    assert.deepEqual(coverage.nonString, []);
    if (locale !== 'en-US') assert.deepEqual(coverage.unintendedEnglishIdentical, []);
  }
});

test('UI catalog and message resolution reject unsupported locale identifiers', () => {
  for (const locale of ['zh-TW', 'id-ID', 'fr-CA', 'es-ES']) {
    assert.throws(
      () => createUiCatalog(locale),
      (error) => error instanceof UnsupportedUiLocaleError && error.locale === locale,
    );
    assert.throws(
      () => resolveUiMessage(ENGLISH_UI_CATALOG, 'run', {}, locale),
      (error) => error instanceof UnsupportedUiLocaleError && error.locale === locale,
    );
    assert.throws(
      () => resolveUiMessage({ run: 'Localized-looking run label' }, 'run', {}, locale),
      (error) => error instanceof UnsupportedUiLocaleError && error.locale === locale,
    );
  }

  assert.equal(createUiCatalog('en-US').run, ENGLISH_UI_CATALOG.run);
  assert.equal(resolveUiMessage({}, 'run', {}, 'en-US'), ENGLISH_UI_CATALOG.run);
});

test('CJK UI catalogs have the exact English key set and placeholder parity', () => {
  for (const locale of CJK_UI_LOCALES) {
    const catalog = CJK_UI_CATALOGS[locale];
    const coverage = uiCatalogCoverage(ENGLISH_UI_CATALOG, catalog);

    assert.deepEqual(Object.keys(catalog).sort(), UI_CATALOG_KEY_SET);
    assert.equal(coverage.exactKeySet, true);
    assert.equal(coverage.placeholderParity, true);
    assert.equal(coverage.stringsOnly, true);
    assert.deepEqual(coverage.englishIdentical, CJK_UI_CANONICAL_TECHNICAL_KEYS);
    assert.deepEqual(coverage.unintendedEnglishIdentical, []);
    const release = LOCALE_CAPABILITIES[locale].release;
    assert.deepEqual(CJK_UI_COPY_PROVENANCE[locale], {
      copyStatus: release.copyStatus,
      nativeReviewStatus: release.nativeReview.statusByCapability.ui,
    });
    assert.match(catalog.copyStatusNativeReviewed, /native-reviewed/);
  }
});

test('required retrieval copy discloses provider metadata plus script corroboration rather than language identification', () => {
  assert.match(ENGLISH_UI_CATALOG.retrievalRequire, /provider language metadata.*script check/i);
  assert.match(ENGLISH_UI_CATALOG.retrievalRequireWarning, /not language identification/i);
  assert.match(CJK_UI_CATALOGS['zh-CN'].retrievalRequireWarning, /不是语言识别/);
  assert.match(CJK_UI_CATALOGS['ja-JP'].retrievalRequireWarning, /言語識別ではありません/);
  assert.match(CJK_UI_CATALOGS['ko-KR'].retrievalRequireWarning, /언어 식별이 아닙니다/);
});

test('CJK catalog coverage fails closed for a missing key or placeholder mismatch', () => {
  const missing = { ...CJK_UI_CATALOGS['zh-CN'] };
  delete missing.populationFrame;
  assert.throws(
    () => assertExactUiCatalogCoverage('zh-CN', ENGLISH_UI_CATALOG, missing),
    /missing: populationFrame/,
  );

  const placeholderMismatch = {
    ...CJK_UI_CATALOGS['ja-JP'],
    readySources: '情報源と前提の準備ができました。',
  };
  assert.throws(
    () => assertExactUiCatalogCoverage('ja-JP', ENGLISH_UI_CATALOG, placeholderMismatch),
    /placeholder mismatch: readySources/,
  );
});

test('CJK resolution never falls back to an English message or raw key', () => {
  for (const locale of CJK_UI_LOCALES) {
    assert.throws(
      () => resolveUiMessage(CJK_UI_CATALOGS[locale], 'missingCatalogKey', {}, locale),
      (error) => error instanceof MissingUiTranslationError
        && error.locale === locale
        && error.key === 'missingCatalogKey',
    );
  }

  assert.equal(resolveUiMessage({}, 'run', {}, 'en-US'), ENGLISH_UI_CATALOG.run);
});

test('UI interpolation fails closed when required runtime variables are missing', () => {
  for (const locale of CJK_UI_LOCALES) {
    assert.throws(
      () => resolveUiMessage(CJK_UI_CATALOGS[locale], 'readySources', { sources: 2 }, locale),
      (error) => error instanceof MissingUiVariableError
        && error.locale === locale
        && error.key === 'readySources'
        && error.missingVariables.includes('assumptions'),
    );
  }
  assert.throws(
    () => resolveUiMessage(ENGLISH_UI_CATALOG, 'readySources', undefined, 'en-US'),
    (error) => error instanceof MissingUiVariableError
      && error.missingVariables.join(',') === 'assumptions,sources',
  );
});

test('CJK catalogs contain no obvious English sentence fallback and retain technical tokens', () => {
  const obviousEnglish = /\b(?:the|this|your|with|without|from|before|after|research|source|model|people|language|selected|requires|available|not|and|for|of|is|are)\b/i;
  const allowedCanonicalStatusKeys = new Set(['nativeReviewPending']);

  for (const locale of CJK_UI_LOCALES) {
    const catalog = CJK_UI_CATALOGS[locale];
    const offenders = Object.entries(catalog)
      .filter(([key, message]) => !allowedCanonicalStatusKeys.has(key) && obviousEnglish.test(message))
      .map(([key]) => key);
    assert.deepEqual(offenders, [], `${locale} contains obvious English copy at ${offenders.join(', ')}`);
    assert.match(catalog.copyStatusMachineDrafted, /machine-drafted/);
    assert.match(catalog.researchFileLimits, /PDF/);
    assert.match(catalog.researchFileLimits, /DOCX/);
    assert.match(catalog.researchFileLimits, /XLSX/);
    assert.match(catalog.stabilityJsd, /^JSD \{value\}$/);
  }
});

test('CJK catalogs reject cross-script copy contamination', () => {
  const unexpectedScripts = {
    'zh-CN': /[\u3040-\u30ff\uac00-\ud7af]/u,
    'ja-JP': /[\uac00-\ud7af]/u,
    'ko-KR': /[\u3040-\u30ff]/u,
  };

  for (const locale of CJK_UI_LOCALES) {
    const offenders = Object.entries(CJK_UI_CATALOGS[locale])
      .filter(([, message]) => unexpectedScripts[locale].test(message))
      .map(([key]) => key);
    assert.deepEqual(offenders, [], `${locale} contains cross-script copy at ${offenders.join(', ')}`);
  }
});

test('CJK catalogs cover deterministic Evidence Ledger fallback claims', () => {
  const claimKeys = [
    'evidenceClaimSourceNumber',
    'methodSpecificModelOutput',
    'finalLikertDistribution',
    'audienceSegmentDifferences',
    'responseScoreReasons',
  ];

  for (const locale of CJK_UI_LOCALES) {
    for (const key of claimKeys) {
      assert.equal(typeof CJK_UI_CATALOGS[locale][key], 'string');
      assert.notEqual(CJK_UI_CATALOGS[locale][key], ENGLISH_UI_CATALOG[key]);
    }
  }
});

test('CJK catalogs translate every human-handoff estimand and reporting enum', () => {
  const handoffKeys = [
    'statFullRankOrder', 'statFirstRankCount', 'statMeanRank', 'statAttributeBrandSelectionMatrix',
    'statFullDistributionByPricePoint', 'statTopTwoBoxByPricePoint', 'statQuestionComprehensionIssues',
    'statRevisionThemes', 'statGuidePilotFeedback', 'statTopicThematicSummary', 'statTopicCoverage', 'statRevisionNeeds', 'reportingParticipantDispositions',
    'reportingExclusions', 'reportingBreakoff', 'reportingUnweightedBases', 'reportingWeightedBasesIfApplicable',
    'reportingFullDistributions', 'reportingTopTwoBoxWithBases', 'reportingObservedIncidence', 'reportingFullRankOrders',
    'reportingFirstRankCounts', 'reportingMeanRanks', 'reportingAttributeBrandSelectionMatrix', 'reportingBrandFamiliarityBases',
    'reportingFullDistributionsByPricePoint', 'reportingTopTwoBoxByPricePointWithBases', 'reportingForcedChoiceLimitation', 'reportingPresentationOrderLimitation', 'reportingPriceExposureOrder',
    'reportingParticipantCharacteristics', 'reportingQuestionComprehensionIssues', 'reportingResponseMappingIssues',
    'reportingRevisionThemes', 'reportingIterationHistory', 'reportingTopicThematicSummaries', 'reportingTopicCoverage',
    'reportingNegativeOrDisconfirmingCases', 'reportingStoppingRule', 'reportingGuidePilotFeedback', 'reportingQuestionSequenceIssues', 'reportingSensitiveTopicHandling', 'reportingRevisionLog',
  ];
  for (const locale of CJK_UI_LOCALES) {
    for (const key of handoffKeys) {
      assert.equal(typeof CJK_UI_CATALOGS[locale][key], 'string', `${locale} missing ${key}`);
      assert.notEqual(CJK_UI_CATALOGS[locale][key], ENGLISH_UI_CATALOG[key], `${locale} left ${key} in English`);
    }
  }
});

test('CJK catalogs cover method-aware recruitment and qualitative coverage copy', () => {
  const keys = [
    'coverageDimensions', 'coverageVariable', 'coverageCategory', 'coverageSourceShare', 'qualitativePurposiveCoverage',
    'nominalFullSampleReference', 'samplePlanStatus', 'sampleRecommendationConfigureMethod',
    'sampleRecommendationNominalReference', 'sampleRecommendationExpectationReference',
    'sampleRecommendationRankDesign', 'sampleRecommendationBrandDesign', 'sampleRecommendationPriceDesign',
    'sampleRecommendationCognitiveRounds', 'sampleRecommendationGuidePilot',
    'probablyOrDefinitelyWould', 'compellingOrVeryCompelling', 'believableOrVeryBelievable',
    'easyOrVeryEasy', 'resultContractErrorTitle', 'resultContractErrorBody',
    'recruitmentInstructionCognitivePretestScope', 'recruitmentInstructionCognitivePretestRounds',
    'recruitmentInstructionCognitivePretestDocument', 'recruitmentInstructionCognitiveReview',
    'recruitmentInstructionCognitiveSeparate', 'recruitmentInstructionQualitativeSampling',
    'recruitmentInstructionQualitativeGuide', 'recruitmentInstructionQualitativeStopping',
    'recruitmentInstructionQualitativeReview', 'recruitmentInstructionQualitativeSeparate',
    'missingMethodSampleDesign', 'missingBrandMatrixDesign', 'missingPriceExposureDesign',
    'missingObservedTaskProtocol', 'statusNotApplicable', 'statusPopulationReferenceOnly',
    'handoffInstructionContractError',
  ];
  for (const locale of CJK_UI_LOCALES) {
    for (const key of keys) {
      assert.equal(typeof CJK_UI_CATALOGS[locale][key], 'string', `${locale} missing ${key}`);
      assert.notEqual(CJK_UI_CATALOGS[locale][key], ENGLISH_UI_CATALOG[key], `${locale} left ${key} in English`);
    }
  }
});

test('CJK catalogs exactly localize human-handoff stimulus presentation labels', () => {
  const expected = {
    'zh-CN': { stimuliForReview: '待审查刺激材料', stimulusIdentifier: '刺激材料标识符', stimulusType: '刺激材料类型' },
    'ja-JP': { stimuliForReview: 'レビュー用刺激素材', stimulusIdentifier: '刺激素材識別子', stimulusType: '刺激素材の種類' },
    'ko-KR': { stimuliForReview: '검토용 자극물', stimulusIdentifier: '자극물 식별자', stimulusType: '자극물 유형' },
  };
  assert.deepEqual(
    {
      stimuliForReview: ENGLISH_UI_CATALOG.stimuliForReview,
      stimulusIdentifier: ENGLISH_UI_CATALOG.stimulusIdentifier,
      stimulusType: ENGLISH_UI_CATALOG.stimulusType,
    },
    { stimuliForReview: 'Stimuli for review', stimulusIdentifier: 'Stimulus ID', stimulusType: 'Stimulus type' },
  );
  for (const locale of CJK_UI_LOCALES) {
    for (const [key, value] of Object.entries(expected[locale])) {
      assert.equal(CJK_UI_CATALOGS[locale][key], value, `${locale} must exactly localize ${key}`);
      assert.notEqual(CJK_UI_CATALOGS[locale][key], ENGLISH_UI_CATALOG[key], `${locale} must not fall back to English for ${key}`);
    }
  }
});

test('CJK catalogs exactly localize human-handoff blocker explanations and technical-reference labels', () => {
  const expected = {
    'zh-CN': {
      technicalReference: '技术参考',
      handoffBlockerUnsupportedLocale: '所选问卷语言需要先由人工翻译，才能用于现场调研。',
      handoffBlockerLocaleMismatch: '报告语言与问卷语言必须一致，或完成有记录的翻译审查。',
      handoffBlockerSpecializedMethodRequired: '请先选择一种专用研究方法，再创建可用于现场调研的问卷。',
      handoffBlockerPrimaryScriptMismatch: '主要问题与所选问卷语言不匹配。',
      handoffBlockerMethodConfigRequired: '请先完成所选方法的设置，再创建可用于现场调研的问卷。',
      handoffBlockerTemplateMissing: '此方法没有可用的真人研究问卷模板。',
      handoffBlockerRespondentCopyMismatch: '部分面向受访者的文本与所选问卷语言不匹配。',
      handoffBlockerUnknown: '此问卷需要研究人员审查后才能用于现场调研。',
    },
    'ja-JP': {
      technicalReference: '技術参照',
      handoffBlockerUnsupportedLocale: '選択した質問票の言語は、実査前に人による翻訳が必要です。',
      handoffBlockerLocaleMismatch: 'レポートと質問票の言語を一致させるか、記録に残る翻訳レビューを完了してください。',
      handoffBlockerSpecializedMethodRequired: '実査可能な質問票を作成する前に、専用の調査手法を選択してください。',
      handoffBlockerPrimaryScriptMismatch: '主要質問が選択した質問票の言語と一致していません。',
      handoffBlockerMethodConfigRequired: '実査可能な質問票を作成する前に、選択した手法の設定を完了してください。',
      handoffBlockerTemplateMissing: 'この手法に対応する実参加者調査用の質問票テンプレートはありません。',
      handoffBlockerRespondentCopyMismatch: '回答者向けテキストの一部が、選択した質問票の言語と一致していません。',
      handoffBlockerUnknown: 'この質問票を実査に使う前に、研究者によるレビューが必要です。',
    },
    'ko-KR': {
      technicalReference: '기술 참조',
      handoffBlockerUnsupportedLocale: '선택한 설문지 언어는 현장 조사 전에 사람의 번역이 필요합니다.',
      handoffBlockerLocaleMismatch: '보고서와 설문지 언어를 일치시키거나 기록 가능한 번역 검토를 완료해야 합니다.',
      handoffBlockerSpecializedMethodRequired: '현장 조사용 설문지를 만들기 전에 전용 연구 방법을 선택하세요.',
      handoffBlockerPrimaryScriptMismatch: '주요 질문이 선택한 설문지 언어와 일치하지 않습니다.',
      handoffBlockerMethodConfigRequired: '현장 조사용 설문지를 만들기 전에 선택한 방법 설정을 완료하세요.',
      handoffBlockerTemplateMissing: '이 방법에 사용할 수 있는 실제 참여자 연구 설문지 템플릿이 없습니다.',
      handoffBlockerRespondentCopyMismatch: '일부 응답자용 텍스트가 선택한 설문지 언어와 일치하지 않습니다.',
      handoffBlockerUnknown: '이 설문지를 현장 조사에 사용하려면 연구자 검토가 필요합니다.',
    },
  };
  for (const locale of CJK_UI_LOCALES) {
    for (const [key, value] of Object.entries(expected[locale])) {
      assert.equal(CJK_UI_CATALOGS[locale][key], value, `${locale} must exactly localize ${key}`);
      assert.notEqual(CJK_UI_CATALOGS[locale][key], ENGLISH_UI_CATALOG[key], `${locale} must not fall back to English for ${key}`);
    }
  }
});

test('CJK-covered callsites localize visible status, grounding, chrome, and stability copy', async () => {
  const [app, composer, chrome, results] = await Promise.all([
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/StudyComposer.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/Chrome.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ResultsWorkspace.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(composer, /t\('researchMaterialBoundary'\)/);
  assert.match(composer, /t\('researchMaterialReadError'/);
  assert.match(composer, /t\('researchMaterialPasteError'\)/);
  assert.doesNotMatch(composer, /setError\([^\n]*\.message/);
  assert.doesNotMatch(composer, /RESEARCH_MATERIAL_BOUNDARY/);
  assert.match(composer, /localizationReleaseLabel\(selectedReportLanguage\.copyStatus, t\)/);
  assert.match(chrome, /aria-label=\{t\('brandHome'\)\}/);
  assert.match(app, /claimKey: 'methodSpecificModelOutput'/);
  assert.doesNotMatch(app, /claim: methodResult\.accessibleLabel/);
  assert.match(app, /exportType: t\('evidencePackExportType'\)/);
  assert.doesNotMatch(results, /readableStatus/);
  assert.doesNotMatch(results, /response\.disclosure \|\|/);
  assert.doesNotMatch(results, /projectState\?\.disclosure \|\|/);
  assert.doesNotMatch(results, /methodResult\.accessibleLabel/);
  assert.doesNotMatch(results, /association\?\.accessibleLabel/);
  assert.doesNotMatch(results, /design\.disclosure \|\|/);
  assert.doesNotMatch(results, /item\.purpose/);
  assert.doesNotMatch(results, /<bdi dir="auto">\{field\}<\/bdi>/);
  assert.match(results, /entry\.claimKey \|\| evidenceClaimKeysById\[entry\.id\]/);
  assert.match(results, /result\.meta\?\.generatedAt === 'Illustrative seed' \? t\('exampleReportLabel'\)/);
  assert.match(results, /localizedLineageLabel\(item\.role \|\| item\.stage, t\)/);
  assert.match(results, /localizedLegacyEnsemble\(signals\.ensemble, locale, t\)/);
  assert.match(results, /safeLocalizedDate\(signals\.sourceFreshness, locale, t\)/);
  assert.match(results, /formatLocalizedNumber\(sourceCount, locale\)/);
  assert.match(results, /safeLocalizedDate\(generatedAt, locale, t, true\)/);
  assert.match(results, /t\('publishedThresholdSummary'/);
  assert.match(results, /t\('repeatRunDisclaimer'\)/);
  assert.doesNotMatch(results, /const shortModel[^\n]*replaceAll/);
});
