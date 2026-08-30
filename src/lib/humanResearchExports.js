import { strToU8, zipSync } from 'fflate';
import { createUiCatalog, resolveUiMessage } from '../i18nCatalog.mjs';
import { formatLocalizedCurrency, formatLocalizedNumber, formatPercentagePoints } from './localizedFormatting.js';

export const HUMAN_RESEARCH_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const HUMAN_RESEARCH_DRAFT_BANNER = 'DRAFT FOR HUMAN RESEARCH — NO PARTICIPANTS RECRUITED';

const MAX_CELL_CHARACTERS = 32_000;
const MAX_WORKBOOK_BYTES = 5_000_000;
const MAX_INPUT_NODES = 50_000;
const MAX_INPUT_CHARACTERS = 2_000_000;
const MAX_ARRAY_ITEMS = 5_000;
const MAX_WORKBOOK_ROWS = 10_000;
const MAX_WORKBOOK_CELLS = 80_000;
const SHEET_NAMES = ['README', 'QUESTIONNAIRE', 'OPTIONS', 'SCREENING LOGIC', 'QUOTAS', 'RECRUITMENT', 'ANALYSIS PLAN', 'LINEAGE'];
const QUESTION_RECORD_VERSION = 'human-research-question-v1';
const STIMULUS_RECORD_VERSION = 'human-research-stimulus-v1';

const EXPORT_COPY = Object.freeze({
  en: Object.freeze({
    banner: HUMAN_RESEARCH_DRAFT_BANNER,
    boundary: null,
    sheetNames: SHEET_NAMES,
    questionnaire: 'QUESTIONNAIRE', items: 'Items', questionRecords: 'QUESTION RECORDS', stimulusRecords: 'STIMULUS RECORDS', screening: 'SCREENING', quotas: 'QUOTAS AND INCIDENCE', samplePlan: 'SAMPLE PLAN', sampleStatus: 'Sample-plan status', sampleRecommendationCode: 'Sample recommendation code', sampleInstruction: 'Sample-plan instruction', nominalFullSampleReference: 'Nominal full-sample reference (planning only)', actualQuota: 'Actual quota', populationReference: 'Population reference only', purposiveCoverage: 'Purposive coverage reference', targetShare: 'Target share', referenceShare: 'Reference share', sourceShare: 'Source share', planningCompletes: 'Planning completes', recruitment: 'RECRUITMENT', analysisPlan: 'ANALYSIS PLAN', missing: 'MISSING OR UNSUPPORTED', notRecorded: 'Not recorded',
    workbook: Object.freeze({ field: 'Field', value: 'Value', plan: 'Plan', handoffId: 'Handoff ID', version: 'Version', generatedAt: 'Generated at', status: 'Status', contentStatus: 'Content status', questionnaire: 'Questionnaire', observedHumanResponses: 'Observed human responses', panelConnected: 'Panel booked or connected', intendedPopulation: 'Intended population', geography: 'Geography', recommendedCompletes: 'Recommended completes', nominalFullSampleReference: 'Nominal full-sample reference', sampleStatus: 'Sample-plan status', sampleRecommendationCode: 'Sample recommendation code', sampleRecommendation: 'Sample recommendation', sampleBasis: 'Sample basis', sampleParameters: 'Sample parameters', sampleDisclosure: 'Sample disclosure', incidenceStatus: 'Incidence status', incidenceEstimate: 'Incidence estimate', incidenceDisclosure: 'Incidence disclosure', panelConnection: 'Panel connection', recruitmentDisclosure: 'Recruitment disclosure', instruction: 'Instruction', providerOption: 'Provider option' }),
    primaryLine: (statistics) => `Primary: ${statistics.join(', ')}`,
    frozenLine: (value) => `Human analysis frozen before synthetic comparison: ${value}`,
  }),
  zh: Object.freeze({
    banner: '真人研究草案——尚未招募任何参与者',
    boundary: '真人研究交接资料——仅供规划。Likerts 尚未招募、筛选、联系或调查任何人。在研究人员和样本提供方确认前，样本量、发生率、可行性、时间和成本均为规划估计。',
    sheetNames: ['说明', '问卷', '选项', '筛选逻辑', '配额', '招募', '分析计划', '沿革'],
    questionnaire: '问卷', items: '项目', questionRecords: '问题记录', stimulusRecords: '刺激材料记录', screening: '筛选', quotas: '配额与发生率', samplePlan: '样本计划', sampleStatus: '样本计划状态', sampleRecommendationCode: '样本建议代码', sampleInstruction: '样本计划说明', nominalFullSampleReference: '名义全样本参考值（仅供规划）', actualQuota: '实际样本配额', populationReference: '仅总体参考', purposiveCoverage: '目的性覆盖参考', targetShare: '目标比例', referenceShare: '参考比例', sourceShare: '来源比例', planningCompletes: '规划完成数', recruitment: '招募', analysisPlan: '分析计划', missing: '缺失或不受支持的项目', notRecorded: '未记录',
    workbook: Object.freeze({ field: '字段', value: '值', plan: '计划', handoffId: '交接资料 ID', version: '版本', generatedAt: '生成时间', status: '状态', contentStatus: '内容状态', questionnaire: '问卷', observedHumanResponses: '已观察到的真人回答', panelConnected: '已预订或连接样本', intendedPopulation: '目标总体', geography: '地理范围', recommendedCompletes: '建议完成样本数', nominalFullSampleReference: '名义全样本参考值', sampleStatus: '样本计划状态', sampleRecommendationCode: '样本建议代码', sampleRecommendation: '样本建议', sampleBasis: '样本量依据', sampleParameters: '样本参数', sampleDisclosure: '样本说明', incidenceStatus: '发生率状态', incidenceEstimate: '发生率估计', incidenceDisclosure: '发生率说明', panelConnection: '样本连接', recruitmentDisclosure: '招募说明', instruction: '说明', providerOption: '样本提供方选项' }),
    primaryLine: (statistics) => `主要分析：${statistics.join('、')}`,
    frozenLine: (value) => `在与合成结果比较前冻结真人研究分析：${value}`,
  }),
  ja: Object.freeze({
    banner: '実参加者調査の草案 — 参加者は募集されていません',
    boundary: '実参加者調査への引き継ぎ資料 — 計画用途に限ります。Likerts は参加者の募集、選別、連絡、調査を行っていません。標本数、出現率、実施可能性、日程、費用は、研究者と調査会社が確認するまで計画上の推定値です。',
    sheetNames: ['説明', '質問票', '選択肢', 'スクリーニング', '割付', '募集', '分析計画', '系譜'],
    questionnaire: '質問票', items: '項目', questionRecords: '質問レコード', stimulusRecords: '刺激素材レコード', screening: 'スクリーニング', quotas: '割付と出現率', samplePlan: '標本計画', sampleStatus: '標本計画の状態', sampleRecommendationCode: '標本設計の推奨コード', sampleInstruction: '標本設計の指示', nominalFullSampleReference: '名目上の全標本参照値（計画用途のみ）', actualQuota: '実査割付', populationReference: '母集団の参照値のみ', purposiveCoverage: '目的抽出によるカバレッジ参照', targetShare: '目標比率', referenceShare: '参照比率', sourceShare: '出典比率', planningCompletes: '計画完了数', recruitment: '募集', analysisPlan: '分析計画', missing: '不足または未対応の項目', notRecorded: '未記録',
    workbook: Object.freeze({ field: '項目', value: '値', plan: '計画', handoffId: '引き継ぎ ID', version: 'バージョン', generatedAt: '生成日時', status: '状態', contentStatus: '内容状態', questionnaire: '質問票', observedHumanResponses: '観測された実参加者の回答', panelConnected: 'パネルの予約・接続', intendedPopulation: '対象母集団', geography: '地域', recommendedCompletes: '推奨完了数', nominalFullSampleReference: '名目上の全標本参照値', sampleStatus: '標本計画の状態', sampleRecommendationCode: '標本設計の推奨コード', sampleRecommendation: '標本設計の推奨', sampleBasis: '標本設計の根拠', sampleParameters: '標本パラメータ', sampleDisclosure: '標本に関する説明', incidenceStatus: '出現率の状態', incidenceEstimate: '出現率の推定', incidenceDisclosure: '出現率に関する説明', panelConnection: 'パネル接続', recruitmentDisclosure: '募集に関する説明', instruction: '手順', providerOption: '調査会社候補' }),
    primaryLine: (statistics) => `主要分析：${statistics.join('、')}`,
    frozenLine: (value) => `合成結果との比較前に実参加者調査の分析を固定：${value}`,
  }),
  ko: Object.freeze({
    banner: '실제 참여자 연구 초안 — 참여자를 모집하지 않았습니다',
    boundary: '실제 참여자 연구 인계 자료 — 계획 용도로만 사용합니다. Likerts는 누구도 모집, 선별, 연락 또는 조사하지 않았습니다. 표본 수, 발생률, 실행 가능성, 일정과 비용은 연구자와 제공업체가 확인하기 전까지 계획 추정치입니다.',
    sheetNames: ['안내', '설문지', '선택지', '스크리닝 로직', '할당', '모집', '분석 계획', '계보'],
    questionnaire: '설문지', items: '항목', questionRecords: '질문 레코드', stimulusRecords: '자극물 레코드', screening: '스크리닝', quotas: '할당 및 발생률', samplePlan: '표본 계획', sampleStatus: '표본 계획 상태', sampleRecommendationCode: '표본 권고 코드', sampleInstruction: '표본 설계 지침', nominalFullSampleReference: '명목상 전체 표본 기준값(계획용)', actualQuota: '실제 표본 할당', populationReference: '모집단 참고용', purposiveCoverage: '목적 표집 범위 참고', targetShare: '목표 비율', referenceShare: '참조 비율', sourceShare: '출처 비율', planningCompletes: '계획 완료 수', recruitment: '모집', analysisPlan: '분석 계획', missing: '누락되었거나 지원되지 않는 항목', notRecorded: '기록되지 않음',
    workbook: Object.freeze({ field: '필드', value: '값', plan: '계획', handoffId: '인계 자료 ID', version: '버전', generatedAt: '생성 시각', status: '상태', contentStatus: '콘텐츠 상태', questionnaire: '설문지', observedHumanResponses: '관찰된 실제 참여자 응답', panelConnected: '패널 예약 또는 연결', intendedPopulation: '의도한 모집단', geography: '지역', recommendedCompletes: '권장 완료 표본 수', nominalFullSampleReference: '명목상 전체 표본 기준값', sampleStatus: '표본 계획 상태', sampleRecommendationCode: '표본 권고 코드', sampleRecommendation: '표본 권고', sampleBasis: '표본 근거', sampleParameters: '표본 매개변수', sampleDisclosure: '표본 안내', incidenceStatus: '발생률 상태', incidenceEstimate: '발생률 추정', incidenceDisclosure: '발생률 안내', panelConnection: '패널 연결', recruitmentDisclosure: '모집 안내', instruction: '지침', providerOption: '제공업체 선택지' }),
    primaryLine: (statistics) => `주요 분석: ${statistics.join(', ')}`,
    frozenLine: (value) => `합성 결과와 비교하기 전에 실제 참여자 분석을 고정함: ${value}`,
  }),
});

const HUMAN_EXPORT_COPY = Object.freeze({
  en: Object.freeze({
    yes: 'Yes', no: 'No', reviewed: 'Reviewed', reviewRequired: 'Researcher review required', stimuli: 'STIMULI', blockingIssues: 'BLOCKING ISSUES', price: 'Price', priceUnit: 'Price unit', required: 'Required', questionType: 'Question type', analysisRole: 'Analysis role', provenance: 'Provenance', priceDisplay: 'Price display', priceAmount: 'Price amount', primaryAnalysis: 'Primary analysis', reportingPlan: 'Reporting plan', humanAnalysisFrozen: 'Human analysis frozen before synthetic comparison', screeningCriterion: 'Screening criterion', terminationRule: 'Termination rule', equals: 'Equals', terminateNoConsent: 'End interview—consent not granted', terminateIneligible: 'End interview—ineligible', recordType: 'Record type', source: 'Source', status: 'Status', operator: 'Operator', action: 'Action', targetType: 'Target type', denominatorStatus: 'Denominator status', technicalReference: 'Technical reference', technicalQuestionId: 'Technical question ID', technicalStimulusId: 'Technical stimulus ID', technicalItemId: 'Technical item ID', technicalTypeId: 'Technical type ID', technicalStatusId: 'Technical status ID', technicalRecommendationId: 'Technical recommendation ID', technicalStatisticIds: 'Technical statistic IDs', technicalReportingIds: 'Technical reporting IDs', technicalBoolean: 'Technical boolean', technicalPlanJson: 'Technical analysis-plan JSON', technicalCurrencyId: 'Technical currency ID', technicalRecordType: 'Technical record type', technicalRecordVersion: 'Technical record version', technicalRecordsNote: 'The canonical records below are technical metadata for implementation and audit.', roleLabels: Object.freeze({ SCREENER: 'Screening', PRIMARY_OUTCOME: 'Primary outcome', SECONDARY_OUTCOME: 'Secondary outcome', OPEN_END: 'Open-ended follow-up', CLASSIFICATION: 'Classification' }),
  }),
  zh: Object.freeze({
    yes: '是', no: '否', reviewed: '已审查', reviewRequired: '需要研究人员审查', stimuli: '刺激材料', blockingIssues: '阻断问题', price: '价格', priceUnit: '价格单位', required: '必答', questionType: '问题类型', analysisRole: '分析用途', provenance: '来源', priceDisplay: '价格显示', priceAmount: '价格数值', primaryAnalysis: '主要分析', reportingPlan: '报告计划', humanAnalysisFrozen: '与合成结果比较前冻结真人研究分析', screeningCriterion: '筛选标准', terminationRule: '终止规则', equals: '等于', terminateNoConsent: '结束访谈——未获得同意', terminateIneligible: '结束访谈——不符合资格', recordType: '记录类型', source: '来源', status: '状态', operator: '运算符', action: '操作', targetType: '目标类型', denominatorStatus: '分母状态', technicalReference: '技术参考', technicalQuestionId: '问题技术 ID', technicalStimulusId: '刺激材料技术 ID', technicalItemId: '项目技术 ID', technicalTypeId: '类型技术 ID', technicalStatusId: '状态技术 ID', technicalRecommendationId: '建议技术 ID', technicalStatisticIds: '统计量技术 ID', technicalReportingIds: '报告项技术 ID', technicalBoolean: '技术布尔值', technicalPlanJson: '分析计划技术 JSON', technicalCurrencyId: '货币技术 ID', technicalRecordType: '记录类型技术值', technicalRecordVersion: '记录技术版本', technicalRecordsNote: '以下规范记录是供实施和审计使用的技术元数据。', roleLabels: Object.freeze({ SCREENER: '筛选', PRIMARY_OUTCOME: '主要结果', SECONDARY_OUTCOME: '次要结果', OPEN_END: '开放式追问', CLASSIFICATION: '分类' }),
  }),
  ja: Object.freeze({
    yes: 'はい', no: 'いいえ', reviewed: '確認済み', reviewRequired: '研究者によるレビューが必要', stimuli: '刺激素材', blockingIssues: 'ブロック項目', price: '価格', priceUnit: '価格単位', required: '必須', questionType: '質問形式', analysisRole: '分析上の役割', provenance: '出所', priceDisplay: '価格表示', priceAmount: '価格数値', primaryAnalysis: '主要分析', reportingPlan: '報告計画', humanAnalysisFrozen: '合成結果との比較前に実参加者調査の分析を固定', screeningCriterion: 'スクリーニング基準', terminationRule: '終了ルール', equals: '等しい', terminateNoConsent: '面接終了 — 同意なし', terminateIneligible: '面接終了 — 対象外', recordType: 'レコード種別', source: '出所', status: '状態', operator: '演算子', action: '処理', targetType: '対象種別', denominatorStatus: '分母の状態', technicalReference: '技術参照', technicalQuestionId: '質問の技術 ID', technicalStimulusId: '刺激素材の技術 ID', technicalItemId: '項目の技術 ID', technicalTypeId: '種別の技術 ID', technicalStatusId: '状態の技術 ID', technicalRecommendationId: '推奨の技術 ID', technicalStatisticIds: '統計量の技術 ID', technicalReportingIds: '報告項目の技術 ID', technicalBoolean: '技術ブール値', technicalPlanJson: '分析計画の技術 JSON', technicalCurrencyId: '通貨の技術 ID', technicalRecordType: 'レコード種別の技術値', technicalRecordVersion: 'レコードの技術バージョン', technicalRecordsNote: '以下の正規レコードは、実装と監査に用いる技術メタデータです。', roleLabels: Object.freeze({ SCREENER: 'スクリーニング', PRIMARY_OUTCOME: '主要評価項目', SECONDARY_OUTCOME: '副次評価項目', OPEN_END: '自由回答の追加質問', CLASSIFICATION: '分類' }),
  }),
  ko: Object.freeze({
    yes: '예', no: '아니요', reviewed: '검토됨', reviewRequired: '연구자 검토 필요', stimuli: '자극물', blockingIssues: '차단 문제', price: '가격', priceUnit: '가격 단위', required: '필수', questionType: '질문 유형', analysisRole: '분석 역할', provenance: '출처', priceDisplay: '가격 표시', priceAmount: '가격 금액', primaryAnalysis: '주요 분석', reportingPlan: '보고 계획', humanAnalysisFrozen: '합성 결과와 비교하기 전에 실제 참여자 분석 확정', screeningCriterion: '스크리닝 기준', terminationRule: '종료 규칙', equals: '같음', terminateNoConsent: '인터뷰 종료 — 동의하지 않음', terminateIneligible: '인터뷰 종료 — 대상 아님', recordType: '레코드 유형', source: '출처', status: '상태', operator: '연산자', action: '조치', targetType: '대상 유형', denominatorStatus: '분모 상태', technicalReference: '기술 참조', technicalQuestionId: '질문 기술 ID', technicalStimulusId: '자극물 기술 ID', technicalItemId: '항목 기술 ID', technicalTypeId: '유형 기술 ID', technicalStatusId: '상태 기술 ID', technicalRecommendationId: '권고 기술 ID', technicalStatisticIds: '통계량 기술 ID', technicalReportingIds: '보고 항목 기술 ID', technicalBoolean: '기술 불리언 값', technicalPlanJson: '분석 계획 기술 JSON', technicalCurrencyId: '통화 기술 ID', technicalRecordType: '레코드 유형 기술 값', technicalRecordVersion: '레코드 기술 버전', technicalRecordsNote: '아래의 정규 레코드는 구현 및 감사를 위한 기술 메타데이터입니다.', roleLabels: Object.freeze({ SCREENER: '스크리닝', PRIMARY_OUTCOME: '주요 결과', SECONDARY_OUTCOME: '보조 결과', OPEN_END: '개방형 후속 질문', CLASSIFICATION: '분류' }),
  }),
});

const exportLanguage = (handoff) => String(handoff?.questionnaire?.language || handoff?.sourceStudy?.instrumentLocale || handoff?.sourceStudy?.outputLocale || 'en').split('-')[0].toLowerCase();
const exportCopyFor = (handoff) => EXPORT_COPY[exportLanguage(handoff)] || EXPORT_COPY.en;
const humanExportCopyFor = (handoff) => HUMAN_EXPORT_COPY[exportLanguage(handoff)] || HUMAN_EXPORT_COPY.en;
const exportBoundaryFor = (handoff, copy) => copy.boundary || handoff.boundary;
const HUMAN_EXPORT_LOCALES = new Set(['en-US', 'zh-CN', 'ja-JP', 'ko-KR']);
const exportLocaleFor = (handoff) => {
  const locale = String(handoff?.questionnaire?.language || handoff?.sourceStudy?.instrumentLocale || handoff?.sourceStudy?.outputLocale || 'en-US');
  return HUMAN_EXPORT_LOCALES.has(locale) ? locale : 'en-US';
};

const HUMAN_TOKEN_MESSAGE_KEYS = Object.freeze({
  NONE: 'statusNone', NOT_APPLIED: 'statusNotApplied', NOT_APPLICABLE: 'statusNotApplicable', UNVERIFIED: 'statusUnverified', BLOCKED_REQUIRES_QUESTIONNAIRE_REVISION: 'statusBlockedRequiresRevision', FIELD_DRAFT_REQUIRES_REVIEW: 'statusFieldDraftRequiresReview', BLOCKED: 'statusBlocked', READY_FOR_RESEARCHER_REVIEW: 'statusReadyForResearcherReview', SINGLE_SELECT: 'statusSingleSelect', RANK_ORDER: 'statusRankOrder', MATRIX_SINGLE_SELECT: 'statusMatrixSingleSelect', OPEN_TEXT: 'statusOpenText', STIMULUS: 'statusStimulus', STIMULUS_CONTENT: 'statusStimulus', INSTRUCTION: 'statusInstruction', METHOD_TEMPLATE: 'statusMethodTemplate', USER_INPUT: 'statusUserInput', MODEL_FRAMING: 'statusModelFraming', DRAFT: 'statusDraft', REQUIRES_RESEARCHER_OPERATIONALIZATION: 'statusRequiresResearcherOperationalization', RESEARCHER_DESIGN_REQUIRED: 'statusResearcherDesignRequired', TARGETS_UNAVAILABLE: 'statusTargetsUnavailable', PLANNING_ESTIMATE: 'statusPlanningEstimate', UNESTIMATED: 'statusUnestimated', POPULATION_REFERENCE_ONLY: 'statusPopulationReferenceOnly', FULL_DISTRIBUTION: 'statusFullDistribution', TOP_TWO_BOX: 'statusTopTwoBox', FULL_RANK_ORDER: 'statFullRankOrder', FIRST_RANK_COUNT: 'statFirstRankCount', MEAN_RANK: 'statMeanRank', ATTRIBUTE_BRAND_SELECTION_MATRIX: 'statAttributeBrandSelectionMatrix', FULL_DISTRIBUTION_BY_PRICE_POINT: 'statFullDistributionByPricePoint', TOP_TWO_BOX_BY_PRICE_POINT: 'statTopTwoBoxByPricePoint', QUESTION_COMPREHENSION_ISSUES: 'statQuestionComprehensionIssues', REVISION_THEMES: 'statRevisionThemes', GUIDE_PILOT_FEEDBACK: 'statGuidePilotFeedback', TOPIC_THEMATIC_SUMMARY: 'statTopicThematicSummary', TOPIC_COVERAGE: 'statTopicCoverage', REVISION_NEEDS: 'statRevisionNeeds', PARTICIPANT_DISPOSITIONS: 'reportingParticipantDispositions', EXCLUSIONS: 'reportingExclusions', BREAKOFF: 'reportingBreakoff', UNWEIGHTED_BASES: 'reportingUnweightedBases', WEIGHTED_BASES_IF_APPLICABLE: 'reportingWeightedBasesIfApplicable', FULL_DISTRIBUTIONS: 'reportingFullDistributions', TOP_TWO_BOX_WITH_BASES: 'reportingTopTwoBoxWithBases', OBSERVED_INCIDENCE: 'reportingObservedIncidence', FULL_RANK_ORDERS: 'reportingFullRankOrders', FIRST_RANK_COUNTS: 'reportingFirstRankCounts', MEAN_RANKS: 'reportingMeanRanks', BRAND_FAMILIARITY_BASES: 'reportingBrandFamiliarityBases', FULL_DISTRIBUTIONS_BY_PRICE_POINT: 'reportingFullDistributionsByPricePoint', TOP_TWO_BOX_BY_PRICE_POINT_WITH_BASES: 'reportingTopTwoBoxByPricePointWithBases', FORCED_CHOICE_LIMITATION: 'reportingForcedChoiceLimitation', PRESENTATION_ORDER_LIMITATION: 'reportingPresentationOrderLimitation', PRICE_EXPOSURE_ORDER: 'reportingPriceExposureOrder', PARTICIPANT_CHARACTERISTICS: 'reportingParticipantCharacteristics', RESPONSE_MAPPING_ISSUES: 'reportingResponseMappingIssues', ITERATION_HISTORY: 'reportingIterationHistory', TOPIC_THEMATIC_SUMMARIES: 'reportingTopicThematicSummaries', NEGATIVE_OR_DISCONFIRMING_CASES: 'reportingNegativeOrDisconfirmingCases', STOPPING_RULE: 'reportingStoppingRule', QUESTION_SEQUENCE_ISSUES: 'reportingQuestionSequenceIssues', SENSITIVE_TOPIC_HANDLING: 'reportingSensitiveTopicHandling', REVISION_LOG: 'reportingRevisionLog',
  CONFIGURE_SUPPORTED_METHOD_BEFORE_SIZING: 'sampleRecommendationConfigureMethod', NOMINAL_FULL_SAMPLE_PROPORTION_REFERENCE_ONLY: 'sampleRecommendationNominalReference', NOMINAL_EXPECTATION_SURVEY_REFERENCE_ONLY: 'sampleRecommendationExpectationReference', FREEZE_RANK_OR_CHOICE_DESIGN_BEFORE_SIZING: 'sampleRecommendationRankDesign', FREEZE_BRAND_MATRIX_DESIGN_BEFORE_SIZING: 'sampleRecommendationBrandDesign', FREEZE_PRICE_EXPOSURE_DESIGN_BEFORE_SIZING: 'sampleRecommendationPriceDesign', PLAN_ITERATIVE_COGNITIVE_PRETEST_ROUNDS: 'sampleRecommendationCognitiveRounds', PLAN_PURPOSIVE_GUIDE_PILOT_AND_STOPPING_RULE: 'sampleRecommendationGuidePilot',
  UNSUPPORTED_HANDOFF_LOCALE_REQUIRES_HUMAN_TRANSLATION: 'handoffBlockerUnsupportedLocale', REPORT_INSTRUMENT_LOCALE_MISMATCH_REQUIRES_TRANSLATION_REVIEW: 'handoffBlockerLocaleMismatch', GENERAL_LIKERT_REQUIRES_SPECIALIZED_METHOD: 'handoffBlockerSpecializedMethodRequired', PRIMARY_ITEM_OUTPUT_LOCALE_SCRIPT_MISMATCH: 'handoffBlockerPrimaryScriptMismatch', METHOD_CONFIG_REQUIRED_FOR_HANDOFF: 'handoffBlockerMethodConfigRequired', METHOD_SPECIFIC_HANDOFF_TEMPLATE_MISSING: 'handoffBlockerTemplateMissing', RESPONDENT_FACING_USER_COPY_LOCALE_SCRIPT_MISMATCH: 'handoffBlockerRespondentCopyMismatch',
});
const canonicalToken = (value) => String(value || '').trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
const humanTokenLabel = (value, handoff, humanCopy = humanExportCopyFor(handoff)) => {
  const token = canonicalToken(value);
  if (!token) return exportCopyFor(handoff).notRecorded;
  if (token === 'REVIEWED') return humanCopy.reviewed;
  if (humanCopy.roleLabels[token]) return humanCopy.roleLabels[token];
  const key = HUMAN_TOKEN_MESSAGE_KEYS[token];
  if (!key) return humanCopy.reviewRequired;
  const locale = exportLocaleFor(handoff);
  return resolveUiMessage(createUiCatalog(locale), key, undefined, locale);
};
const humanBoolean = (value, humanCopy) => value === true ? humanCopy.yes : value === false ? humanCopy.no : humanCopy.reviewRequired;
const localizedExportNumber = (value, handoff, copy) => {
  if (!Number.isFinite(value)) return copy.notRecorded;
  try { return formatLocalizedNumber(value, exportLocaleFor(handoff)); } catch { return copy.notRecorded; }
};
const localizedExportPrice = (value, handoff, copy) => {
  if (!value || !Number.isFinite(value.amount)) return copy.notRecorded;
  try {
    const price = formatLocalizedCurrency(value.amount, value.currency, exportLocaleFor(handoff));
    return value.unit ? `${price} · ${value.unit}` : price;
  } catch {
    return copy.notRecorded;
  }
};
const localizedQuestionItemText = (item, handoff, copy, priceContext) => Number.isFinite(item?.amount) && (item?.currency || priceContext?.currency)
  ? localizedExportPrice({ ...priceContext, ...item }, handoff, copy)
  : item?.text || copy.notRecorded;
const handoffPriceContext = (handoff) => {
  const priceStimulus = (handoff.questionnaire?.stimuli || []).find((stimulus) => stimulus?.type === 'PRICE_LADDER_OFFER' && stimulus.currency);
  return priceStimulus ? { currency: priceStimulus.currency, unit: priceStimulus.unit } : null;
};
const humanStimulusText = (stimulus) => {
  const text = String(stimulus?.text || '');
  if (!stimulus?.price) return text;
  const rawPriceLine = `${stimulus.price.amount} ${stimulus.price.currency} ${stimulus.price.unit}`.trim();
  return text.split(/\r?\n/).filter((line) => line.trim() !== rawPriceLine).join('\n');
};

const PLANNING_REPLACEMENTS = Object.freeze({
  zh: Object.freeze({
    'This is an unvalidated field draft generated from the study brief and method template. Review all respondent-facing language and stimuli, obtain any required ethics and privacy approvals, and cognitively pretest it before launch.': '这是根据研究简报和方法模板生成、尚未验证的现场执行草案。启动前请审查所有面向受访者的语言和刺激材料，完成所需的伦理与隐私审批，并进行认知预测试。',
    'Client-reported content hashes identify browser-supplied material but do not authenticate its origin. Server excerpt hashes identify the bounded text used in this run.': '客户端报告的内容哈希用于标识浏览器提供的材料，但不能认证其来源。服务器摘录哈希用于标识本次运行使用的有限文本。',
    'No uploaded research material was recorded.': '未记录上传的研究材料。',
    'Participation requires informed consent.': '参与研究必须获得知情同意。',
    'No weighting variable is activated until a questionnaire item or provider metadata field is mapped to the exact target categories and the denominator is reviewed.': '在问卷题目或样本提供方元数据字段映射到确切目标类别且分母经过审查之前，不启用任何加权变量。',
    'No defensible achieved-sample quota is available until source denominators are shown to match the screened intended population. Quotas and weighting do not make an opt-in or non-probability panel representative.': '在证明来源分母与筛选后的目标总体一致之前，无法提供可辩护的实际样本配额。配额和加权不能使自愿加入或非概率样本具有代表性。',
    'This is a planning calculation under stated assumptions, not a synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information.': '这是基于所述假设的规划计算，不是合成置信区间、真人研究结果或精度保证。招募方法、加权、排除、未回应和亚组分析都可能降低有效信息量。',
    'Incidence is unknown unless supported by a cited observed source or dated provider quote. Synthetic response percentages are never used to estimate eligibility.': '除非有引用的观察来源或注明日期的样本提供方报价支持，否则发生率未知。绝不使用合成回答百分比估算资格率。',
    'Have a human researcher review and cognitively pretest the instrument.': '由真人研究人员审查问卷并进行认知预测试。',
    'Complete applicable ethics, privacy, consent, accessibility, and data-protection review.': '完成适用的伦理、隐私、同意、无障碍和数据保护审查。',
    'Ask providers for feasibility using the exact screener and monitor targets; do not share synthetic segment labels as recruitable identities.': '使用确切筛选问卷和监控目标向样本提供方询问可行性；不得将合成细分标签作为可招募身份。',
    'Run a small soft launch before full fielding.': '在全面执行前进行小规模试运行。',
    'Freeze duplicate, speeding, straight-lining, open-text quality, exclusion, and weighting rules before inspecting substantive outcomes.': '在查看实质性结果前，冻结重复作答、过快作答、直线作答、开放题质量、排除和加权规则。',
    'Monitor incidence, quota fill, breakoff, exclusions, and respondent compensation.': '监控发生率、配额完成、退出、排除和受访者报酬。',
    'No participant panel is booked or connected. Provider links are suggestions, not endorsements or integrations; audience availability, feasibility, price, timing, and terms must be confirmed directly.': '未预订或连接任何参与者样本。样本提供方链接仅为建议，并非认可或集成；受众可用性、可行性、价格、时间和条款必须直接确认。',
    'Representative-sample options and prescreeners vary by market and must be confirmed directly.': '代表性样本选项和预筛选条件因市场而异，必须直接确认。',
    'Audience availability, feasibility, price, timing, and terms must be confirmed directly.': '受众可用性、可行性、价格、时间和条款必须直接确认。',
    'Human translation and locale review': '人工翻译与本地化审查',
    'Defensible achieved-sample quota targets': '可辩护的实际样本配额目标',
    'Observed or provider-quoted incidence': '观察到的或样本提供方报价中的发生率',
    'Survey duration after cognitive pretest': '认知预测试后的问卷时长',
    'Provider feasibility, price, and timing': '样本提供方的可行性、价格和时间',
    'Preregistered subgroup power requirements': '预注册的亚组统计功效要求',
    'Ethics, privacy, and jurisdictional approval status': '伦理、隐私和司法辖区审批状态',
    'Stated purchase intent is not observed conversion, demand, revenue, or market size.': '陈述的购买意向并非观察到的转化、需求、收入或市场规模。',
  }),
  ja: Object.freeze({
    'This is an unvalidated field draft generated from the study brief and method template. Review all respondent-facing language and stimuli, obtain any required ethics and privacy approvals, and cognitively pretest it before launch.': '調査概要と手法テンプレートから生成した、未検証の実査用草案です。開始前に回答者向けの文言と刺激素材をすべて確認し、必要な倫理・プライバシー承認を得て、認知的プリテストを実施してください。',
    'Client-reported content hashes identify browser-supplied material but do not authenticate its origin. Server excerpt hashes identify the bounded text used in this run.': 'クライアント申告のコンテンツハッシュはブラウザから提供された資料を識別しますが、出所を認証するものではありません。サーバーの抜粋ハッシュは、この実行で使用した限定テキストを識別します。',
    'No uploaded research material was recorded.': 'アップロードされた調査資料は記録されていません。',
    'Participation requires informed consent.': '参加にはインフォームド・コンセントが必要です。',
    'No weighting variable is activated until a questionnaire item or provider metadata field is mapped to the exact target categories and the denominator is reviewed.': '質問項目または調査会社のメタデータ項目が正確な対象カテゴリに対応付けられ、分母が確認されるまで、ウェイト変数は有効にしません。',
    'No defensible achieved-sample quota is available until source denominators are shown to match the screened intended population. Quotas and weighting do not make an opt-in or non-probability panel representative.': '情報源の分母がスクリーニング後の対象母集団と一致すると確認されるまで、正当化できる回収割付は設定できません。割付やウェイトによって、オプトインまたは非確率パネルが代表標本になるわけではありません。',
    'This is a planning calculation under stated assumptions, not a synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information.': 'これは明示した仮定に基づく計画計算であり、合成信頼区間、実参加者の結果、精度保証ではありません。募集方法、ウェイト、除外、無回答、サブグループ分析によって有効情報量は減少し得ます。',
    'Incidence is unknown unless supported by a cited observed source or dated provider quote. Synthetic response percentages are never used to estimate eligibility.': '引用可能な観測情報源または日付入りの調査会社見積もりがない限り、出現率は不明です。合成回答の割合を適格率の推定には使用しません。',
    'Have a human researcher review and cognitively pretest the instrument.': '人の研究者が質問票を確認し、認知的プリテストを実施してください。',
    'Complete applicable ethics, privacy, consent, accessibility, and data-protection review.': '該当する倫理、プライバシー、同意、アクセシビリティ、データ保護の審査を完了してください。',
    'Ask providers for feasibility using the exact screener and monitor targets; do not share synthetic segment labels as recruitable identities.': '正確なスクリーナーと監視目標を用いて調査会社に実施可能性を確認し、合成セグメント名を募集対象の属性として共有しないでください。',
    'Run a small soft launch before full fielding.': '本調査の前に小規模なソフトローンチを実施してください。',
    'Freeze duplicate, speeding, straight-lining, open-text quality, exclusion, and weighting rules before inspecting substantive outcomes.': '実質的な結果を見る前に、重複、早すぎる回答、同一選択、自由回答品質、除外、ウェイトのルールを固定してください。',
    'Monitor incidence, quota fill, breakoff, exclusions, and respondent compensation.': '出現率、割付充足、中断、除外、回答者報酬を監視してください。',
    'No participant panel is booked or connected. Provider links are suggestions, not endorsements or integrations; audience availability, feasibility, price, timing, and terms must be confirmed directly.': '参加者パネルは予約・接続されていません。調査会社へのリンクは候補の提示であり、推奨や連携を意味しません。対象者の確保、実施可能性、価格、日程、条件は直接確認してください。',
    'Representative-sample options and prescreeners vary by market and must be confirmed directly.': '代表標本の選択肢と事前スクリーナーは市場によって異なるため、直接確認が必要です。',
    'Audience availability, feasibility, price, timing, and terms must be confirmed directly.': '対象者の確保、実施可能性、価格、日程、条件は直接確認が必要です。',
    'Human translation and locale review': '人による翻訳とロケール確認',
    'Defensible achieved-sample quota targets': '正当化可能な回収割付目標',
    'Observed or provider-quoted incidence': '観測または調査会社見積もりによる出現率',
    'Survey duration after cognitive pretest': '認知的プリテスト後の調査時間',
    'Provider feasibility, price, and timing': '調査会社の実施可能性、価格、日程',
    'Preregistered subgroup power requirements': '事前登録したサブグループ検出力要件',
    'Ethics, privacy, and jurisdictional approval status': '倫理、プライバシー、管轄上の承認状況',
    'Stated purchase intent is not observed conversion, demand, revenue, or market size.': '表明された購入意向は、観測された転換、需要、売上、市場規模ではありません。',
  }),
  ko: Object.freeze({
    'This is an unvalidated field draft generated from the study brief and method template. Review all respondent-facing language and stimuli, obtain any required ethics and privacy approvals, and cognitively pretest it before launch.': '연구 브리프와 방법 템플릿에서 생성된 검증 전 현장 조사 초안입니다. 시작 전에 응답자에게 보이는 모든 문구와 자극물을 검토하고, 필요한 윤리 및 개인정보 승인을 받은 뒤 인지 사전검사를 수행하세요.',
    'Client-reported content hashes identify browser-supplied material but do not authenticate its origin. Server excerpt hashes identify the bounded text used in this run.': '클라이언트가 보고한 콘텐츠 해시는 브라우저에서 제공된 자료를 식별하지만 출처를 인증하지는 않습니다. 서버 발췌 해시는 이번 실행에 사용된 제한된 텍스트를 식별합니다.',
    'No uploaded research material was recorded.': '업로드된 연구 자료가 기록되지 않았습니다.',
    'Participation requires informed consent.': '참여에는 충분한 설명에 근거한 동의가 필요합니다.',
    'No weighting variable is activated until a questionnaire item or provider metadata field is mapped to the exact target categories and the denominator is reviewed.': '설문 문항 또는 제공업체 메타데이터 필드가 정확한 목표 범주에 매핑되고 분모가 검토되기 전에는 가중 변수를 활성화하지 않습니다.',
    'No defensible achieved-sample quota is available until source denominators are shown to match the screened intended population. Quotas and weighting do not make an opt-in or non-probability panel representative.': '출처 분모가 스크리닝된 목표 모집단과 일치한다고 확인되기 전에는 방어 가능한 실제 표본 할당을 제시할 수 없습니다. 할당과 가중으로 자발 참여 또는 비확률 패널이 대표성을 갖게 되지는 않습니다.',
    'This is a planning calculation under stated assumptions, not a synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information.': '명시된 가정에 따른 계획 계산이며 합성 신뢰구간, 실제 참여자 결과 또는 정밀도 보장이 아닙니다. 모집 방식, 가중, 제외, 무응답과 하위집단 분석은 유효 정보량을 줄일 수 있습니다.',
    'Incidence is unknown unless supported by a cited observed source or dated provider quote. Synthetic response percentages are never used to estimate eligibility.': '인용 가능한 관찰 출처 또는 날짜가 있는 제공업체 견적이 없으면 발생률은 알 수 없습니다. 합성 응답 비율을 적격률 추정에 사용하지 않습니다.',
    'Have a human researcher review and cognitively pretest the instrument.': '사람 연구자가 설문을 검토하고 인지 사전검사를 수행하세요.',
    'Complete applicable ethics, privacy, consent, accessibility, and data-protection review.': '해당되는 윤리, 개인정보, 동의, 접근성 및 데이터 보호 검토를 완료하세요.',
    'Ask providers for feasibility using the exact screener and monitor targets; do not share synthetic segment labels as recruitable identities.': '정확한 스크리너와 모니터링 목표로 제공업체에 실행 가능성을 문의하고, 합성 세그먼트 이름을 모집 가능한 정체성으로 공유하지 마세요.',
    'Run a small soft launch before full fielding.': '본 조사 전에 소규모 소프트 론치를 진행하세요.',
    'Freeze duplicate, speeding, straight-lining, open-text quality, exclusion, and weighting rules before inspecting substantive outcomes.': '실질적 결과를 보기 전에 중복, 과속 응답, 동일 응답, 주관식 품질, 제외 및 가중 규칙을 확정하세요.',
    'Monitor incidence, quota fill, breakoff, exclusions, and respondent compensation.': '발생률, 할당 충족, 중도 이탈, 제외 및 응답자 보상을 모니터링하세요.',
    'No participant panel is booked or connected. Provider links are suggestions, not endorsements or integrations; audience availability, feasibility, price, timing, and terms must be confirmed directly.': '참여자 패널을 예약하거나 연결하지 않았습니다. 제공업체 링크는 제안일 뿐 보증이나 연동이 아닙니다. 대상 가용성, 실행 가능성, 가격, 일정과 조건을 직접 확인해야 합니다.',
    'Representative-sample options and prescreeners vary by market and must be confirmed directly.': '대표 표본 옵션과 사전 스크리너는 시장마다 다르므로 직접 확인해야 합니다.',
    'Audience availability, feasibility, price, timing, and terms must be confirmed directly.': '대상 가용성, 실행 가능성, 가격, 일정과 조건을 직접 확인해야 합니다.',
    'Human translation and locale review': '사람의 번역 및 로케일 검토',
    'Defensible achieved-sample quota targets': '방어 가능한 실제 표본 할당 목표',
    'Observed or provider-quoted incidence': '관찰되었거나 제공업체가 견적한 발생률',
    'Survey duration after cognitive pretest': '인지 사전검사 후 설문 소요 시간',
    'Provider feasibility, price, and timing': '제공업체 실행 가능성, 가격 및 일정',
    'Preregistered subgroup power requirements': '사전 등록된 하위집단 검정력 요건',
    'Ethics, privacy, and jurisdictional approval status': '윤리, 개인정보 및 관할 승인 상태',
    'Stated purchase intent is not observed conversion, demand, revenue, or market size.': '진술된 구매 의향은 관찰된 전환, 수요, 매출 또는 시장 규모가 아닙니다.',
  }),
});

const ADDITIONAL_PLANNING_REPLACEMENTS = Object.freeze({
  zh: Object.freeze({
    'Treat 385 as a nominal full-sample reference for the expected-ease self-report only. Size an observed usability study separately from its task protocol, participant variation, accessibility needs, and iteration plan.': '仅将 385 视为预期易用性自我报告的名义全样本参考值。应根据任务方案、参与者差异、无障碍需求和迭代计划，单独确定观察式可用性研究的样本量。',
    'Treat 385 as a nominal full-sample single-proportion reference only; recalculate for the actual recruitment, subgroup, weighting, and analysis design.': '仅将 385 视为名义全样本单比例参考值；应按实际招募、亚组、加权和分析设计重新计算。',
    'This is a nominal simple-random-sample-equivalent calculation under stated assumptions, not a recommended field target, synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information. Expected ease is not observed usability.': '这是基于既定假设的名义简单随机样本等效计算，不是建议的现场目标、合成置信区间、真人研究结果或精度保证。招募方式、加权、排除、未回应和亚组分析都可能降低有效信息量。预期易用性并非观察到的可用性。',
    'This is a nominal simple-random-sample-equivalent calculation under stated assumptions, not a recommended field target, synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information.': '这是基于既定假设的名义简单随机样本等效计算，不是建议的现场目标、合成置信区间、真人研究结果或精度保证。招募方式、加权、排除、未回应和亚组分析都可能降低有效信息量。',
    'Have a researcher calculate the target from the frozen design, estimand, smallest decision-relevant difference, multiplicity policy, subgroup plan, and expected effective sample size.': '由研究人员根据冻结后的设计、估计量、最小决策相关差异、多重比较政策、亚组计划和预期有效样本量计算目标。',
    'Likerts does not invent a universal numeric target for a rank, matrix, or repeated-price design. The design must be frozen before a defensible power or precision calculation is possible.': 'Likerts 不会为排序、矩阵或重复价格设计虚构通用数值目标。必须先冻结设计，才能进行可辩护的统计功效或精度计算。',
    'Plan iterative cognitive-interview rounds across the priority participant variations, revising between rounds and documenting the stopping rule.': '针对优先参与者差异规划迭代认知访谈轮次，在轮次之间修订并记录停止规则。',
    'Set a purposive interview plan from the research objective, participant variation, topic complexity, analysis depth, and a documented stopping rule.': '根据研究目标、参与者差异、主题复杂度、分析深度和记录在案的停止规则，制定目的性访谈计划。',
    'A qualitative interview count is not a precision calculation. Likerts leaves the numeric target unset until a researcher defines the sampling and stopping logic.': '定性访谈数量不是精度计算。在研究人员定义抽样和停止逻辑之前，Likerts 不设置数值目标。',
    'Choose and configure a supported research method before setting a sample-size target.': '在设定样本量目标之前，选择并配置受支持的研究方法。',
    'No numeric sample recommendation is produced for a blocked or generic instrument.': '对于被阻止或通用的研究工具，不提供数值样本建议。',
    'Choose a supported method and complete its design.': '选择受支持的方法并完成其设计。',
    'No numeric sample recommendation is available for this method.': '此方法没有可用的数值样本建议。',
    'Statistical quotas are not applicable to this qualitative planning mode. A researcher must define purposive coverage across relevant participant variations; official population shares are context, not recruitment targets.': '统计配额不适用于此定性规划模式。研究人员必须针对相关参与者差异定义目的性覆盖；官方人口比例仅作背景参考，并非招募目标。',
    'No defensible achieved-sample quota is available until source denominators are shown to match the screened intended population. Population shares are reference values, not quotas. Quotas and weighting do not make an opt-in or non-probability panel representative.': '在证明来源分母与筛选后的目标总体一致之前，无法提供可辩护的实际样本配额。人口比例是参考值而非配额。配额和加权不能使自愿加入或非概率样本具有代表性。',
    'Weighting is not applied to a cognitive pretest or interview-guide pilot.': '不对认知预测试或访谈指南试点应用加权。',
    'Have a human researcher review the cognitive-interview protocol and every supplied survey item.': '由真人研究人员审查认知访谈方案和每一项提供的调查题目。',
    'Complete applicable ethics, privacy, consent, accessibility, recording, and data-protection review.': '完成适用的伦理、隐私、同意、无障碍、录音和数据保护审查。',
    'Recruit purposively across the participant variations most likely to change comprehension or response mapping.': '在最可能改变理解或回答映射的参与者差异中进行目的性招募。',
    'Run iterative rounds, record item-level comprehension and response-mapping issues, and revise between rounds.': '开展迭代轮次，记录题目层面的理解和回答映射问题，并在轮次之间修订。',
    'Freeze an issue-resolution or stopping rule before declaring the pretest complete.': '在宣布预测试完成前，冻结问题解决或停止规则。',
    'Keep pilot feedback separate from substantive survey findings.': '将试点反馈与实质性调查发现分开。',
    'Have a human researcher review and pilot the interview guide before substantive fieldwork.': '在实质性现场研究前，由真人研究人员审查并试运行访谈指南。',
    'Complete applicable ethics, privacy, consent, accessibility, recording, safeguarding, and data-protection review.': '完成适用的伦理、隐私、同意、无障碍、录音、安全保障和数据保护审查。',
    'Recruit purposively across the participant variations relevant to the guide objective.': '针对与指南目标相关的参与者差异进行目的性招募。',
    'Pilot the sequence, probes, timing, sensitive-topic handling, and moderator instructions.': '试运行问题顺序、追问、时长、敏感主题处理和主持人说明。',
    'Document revisions and a stopping rule for guide piloting before substantive interviews begin.': '在实质性访谈开始前，记录指南试点的修订和停止规则。',
    'Do not analyze guide-pilot answers as substantive participant findings.': '不得将指南试点回答作为实质性参与者发现进行分析。',
    'No participant recruitment is booked or connected. Provider links are suggestions, not endorsements or integrations; audience availability, accessibility, compensation, timing, and terms must be confirmed directly.': '未预订或连接参与者招募。样本提供方链接仅为建议，并非认可或集成；受众可用性、无障碍、报酬、时间和条款必须直接确认。',
    'Ask providers for feasibility using the exact screener and population-reference dimensions; do not share synthetic segment labels as recruitable identities.': '使用确切的筛选问卷和总体参考维度向样本提供方询问可行性；不得将合成细分标签作为可招募身份分享。',
    'Monitor incidence, recruitment progress, breakoff, exclusions, and respondent compensation.': '监控发生率、招募进展、退出、排除和受访者报酬。',
    'The draft is a forced-choice matrix. Brand familiarity, a none/not-sure response, neutral ordering, randomization, and denominator rules must be reviewed before fielding.': '该草案为强制选择矩阵。现场执行前必须审查品牌熟悉度、无/不确定选项、中性排序、随机化和分母规则。',
    'The draft presents every supplied price in ascending order. It is not a randomized monadic or Gabor–Granger design; a researcher must define exposure, branching, allocation, and order capture before using those methods.': '该草案按升序呈现每个提供的价格。它不是随机单体或 Gabor–Granger 设计；使用这些方法前，研究人员必须定义暴露、分支、分配和顺序记录。',
    'The handoff measures expected ease only. It does not observe task success, time, assistance, friction, or accessibility outcomes; size and run an observed task study separately if usability validation is intended.': '该交接资料仅衡量预期易用性。它不观察任务成功、时间、协助、摩擦或无障碍结果；如果要验证可用性，应单独确定并执行观察式任务研究。',
    'Pilot responses are used to revise the guide and are not substantive participant findings.': '试点回答用于修订指南，并非实质性参与者发现。',
    'Method-specific sample-size or qualitative stopping-rule design': '方法特定的样本量或定性停止规则设计',
    'Brand familiarity, none/not-sure handling, and neutral matrix order': '品牌熟悉度、无/不确定处理和中性矩阵顺序',
    'Price exposure, branching, allocation, and presentation-order plan': '价格暴露、分支、分配和呈现顺序计划',
    'Observed task protocol if usability validation is intended': '若计划验证可用性，则需观察式任务方案',
  }),
  ja: Object.freeze({
    'Treat 385 as a nominal full-sample reference for the expected-ease self-report only. Size an observed usability study separately from its task protocol, participant variation, accessibility needs, and iteration plan.': '385 は期待される使いやすさの自己報告に関する名目上の全標本参照値としてのみ扱ってください。観察型ユーザビリティ調査は、タスク手順、参加者の多様性、アクセシビリティ要件、反復計画に基づき別途設計してください。',
    'Treat 385 as a nominal full-sample single-proportion reference only; recalculate for the actual recruitment, subgroup, weighting, and analysis design.': '385 は名目上の全標本・単一比率の参照値としてのみ扱い、実際の募集、サブグループ、ウェイト、分析設計に合わせて再計算してください。',
    'This is a nominal simple-random-sample-equivalent calculation under stated assumptions, not a recommended field target, synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information. Expected ease is not observed usability.': 'これは明示した仮定に基づく名目上の単純無作為標本等価計算であり、推奨する実査目標、合成信頼区間、実参加者の結果、精度保証ではありません。募集方法、ウェイト、除外、無回答、サブグループ分析によって有効情報量は減少し得ます。期待される使いやすさは観察されたユーザビリティではありません。',
    'This is a nominal simple-random-sample-equivalent calculation under stated assumptions, not a recommended field target, synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information.': 'これは明示した仮定に基づく名目上の単純無作為標本等価計算であり、推奨する実査目標、合成信頼区間、実参加者の結果、精度保証ではありません。募集方法、ウェイト、除外、無回答、サブグループ分析によって有効情報量は減少し得ます。',
    'Have a researcher calculate the target from the frozen design, estimand, smallest decision-relevant difference, multiplicity policy, subgroup plan, and expected effective sample size.': '研究者が、固定した設計、推定量、意思決定に必要な最小差、多重性方針、サブグループ計画、想定有効標本サイズから目標を算出してください。',
    'Likerts does not invent a universal numeric target for a rank, matrix, or repeated-price design. The design must be frozen before a defensible power or precision calculation is possible.': 'Likerts は順位、行列、反復価格の設計に対して普遍的な数値目標を作りません。正当化可能な検出力または精度計算の前に設計を固定する必要があります。',
    'Plan iterative cognitive-interview rounds across the priority participant variations, revising between rounds and documenting the stopping rule.': '優先する参加者の多様性をまたいで反復的な認知インタビューを計画し、各回の間で改訂し、停止ルールを記録してください。',
    'Set a purposive interview plan from the research objective, participant variation, topic complexity, analysis depth, and a documented stopping rule.': '研究目的、参加者の多様性、トピックの複雑さ、分析の深さ、記録した停止ルールに基づき、目的抽出によるインタビュー計画を設定してください。',
    'A qualitative interview count is not a precision calculation. Likerts leaves the numeric target unset until a researcher defines the sampling and stopping logic.': '定性インタビュー数は精度計算ではありません。研究者が抽出と停止のロジックを定義するまで、Likerts は数値目標を設定しません。',
    'Choose and configure a supported research method before setting a sample-size target.': '標本サイズの目標を設定する前に、対応する調査手法を選択して設定してください。',
    'No numeric sample recommendation is produced for a blocked or generic instrument.': 'ブロックされた、または汎用的な調査票については数値の標本推奨を作成しません。',
    'Choose a supported method and complete its design.': '対応する手法を選択し、その設計を完了してください。',
    'No numeric sample recommendation is available for this method.': 'この手法には数値の標本推奨はありません。',
    'Statistical quotas are not applicable to this qualitative planning mode. A researcher must define purposive coverage across relevant participant variations; official population shares are context, not recruitment targets.': '統計的な割付はこの定性計画モードには適用しません。研究者は関連する参加者の多様性にわたる目的抽出のカバレッジを定義する必要があり、公式の母集団比率は文脈情報であって募集目標ではありません。',
    'No defensible achieved-sample quota is available until source denominators are shown to match the screened intended population. Population shares are reference values, not quotas. Quotas and weighting do not make an opt-in or non-probability panel representative.': '情報源の分母がスクリーニング後の対象母集団と一致すると示されるまで、正当化できる回収標本の割付は設定できません。母集団比率は参照値であり、割付ではありません。割付やウェイトによって、オプトインまたは非確率パネルが代表的になるわけではありません。',
    'Weighting is not applied to a cognitive pretest or interview-guide pilot.': '認知的プリテストまたはインタビューガイドのパイロットにはウェイトを適用しません。',
    'Have a human researcher review the cognitive-interview protocol and every supplied survey item.': '人の研究者が認知インタビュー手順と提供されたすべての調査項目を確認してください。',
    'Complete applicable ethics, privacy, consent, accessibility, recording, and data-protection review.': '該当する倫理、プライバシー、同意、アクセシビリティ、録音、データ保護の審査を完了してください。',
    'Recruit purposively across the participant variations most likely to change comprehension or response mapping.': '理解や回答マッピングを変えやすい参加者の多様性にわたって目的抽出で募集してください。',
    'Run iterative rounds, record item-level comprehension and response-mapping issues, and revise between rounds.': '反復ラウンドを実施し、項目別の理解と回答マッピングの問題を記録し、ラウンド間で改訂してください。',
    'Freeze an issue-resolution or stopping rule before declaring the pretest complete.': 'プリテスト完了を宣言する前に、問題解決または停止ルールを固定してください。',
    'Keep pilot feedback separate from substantive survey findings.': 'パイロットのフィードバックは実質的な調査結果と分けてください。',
    'Have a human researcher review and pilot the interview guide before substantive fieldwork.': '実質的な実査の前に、人の研究者がインタビューガイドを確認し、パイロットを実施してください。',
    'Complete applicable ethics, privacy, consent, accessibility, recording, safeguarding, and data-protection review.': '該当する倫理、プライバシー、同意、アクセシビリティ、録音、安全保護、データ保護の審査を完了してください。',
    'Recruit purposively across the participant variations relevant to the guide objective.': 'ガイドの目的に関連する参加者の多様性にわたって目的抽出で募集してください。',
    'Pilot the sequence, probes, timing, sensitive-topic handling, and moderator instructions.': '順序、追加質問、所要時間、センシティブな話題の扱い、モデレーター指示をパイロットしてください。',
    'Document revisions and a stopping rule for guide piloting before substantive interviews begin.': '実質的なインタビュー開始前に、ガイドのパイロットに関する改訂と停止ルールを記録してください。',
    'Do not analyze guide-pilot answers as substantive participant findings.': 'ガイドのパイロット回答を実質的な参加者の知見として分析しないでください。',
    'No participant recruitment is booked or connected. Provider links are suggestions, not endorsements or integrations; audience availability, accessibility, compensation, timing, and terms must be confirmed directly.': '参加者募集は予約・接続されていません。調査会社へのリンクは候補の提示であり、推奨や連携を意味しません。対象者の確保、アクセシビリティ、謝礼、日程、条件は直接確認してください。',
    'Ask providers for feasibility using the exact screener and population-reference dimensions; do not share synthetic segment labels as recruitable identities.': '正確なスクリーナーと母集団参照の次元を用いて調査会社に実施可能性を確認し、合成セグメント名を募集対象の属性として共有しないでください。',
    'Monitor incidence, recruitment progress, breakoff, exclusions, and respondent compensation.': '出現率、募集の進捗、中断、除外、回答者謝礼を監視してください。',
    'The draft is a forced-choice matrix. Brand familiarity, a none/not-sure response, neutral ordering, randomization, and denominator rules must be reviewed before fielding.': 'この草案は強制選択の行列です。実査前に、ブランド親近性、なし／不明の回答、中立的な順序、ランダム化、分母ルールを確認する必要があります。',
    'The draft presents every supplied price in ascending order. It is not a randomized monadic or Gabor–Granger design; a researcher must define exposure, branching, allocation, and order capture before using those methods.': 'この草案は提供されたすべての価格を昇順で提示します。これはランダム化単一提示や Gabor–Granger の設計ではありません。これらの手法を使う前に、研究者が接触、分岐、割当、順序の記録を定義する必要があります。',
    'The handoff measures expected ease only. It does not observe task success, time, assistance, friction, or accessibility outcomes; size and run an observed task study separately if usability validation is intended.': 'この引き継ぎ資料は期待される容易さのみを測定します。タスク成功、時間、支援、摩擦、アクセシビリティの結果は観察しません。ユーザビリティ検証を行う場合は、観察型タスク調査を別途設計・実施してください。',
    'Pilot responses are used to revise the guide and are not substantive participant findings.': 'パイロット回答はガイド改訂に用い、実質的な参加者の知見ではありません。',
    'Method-specific sample-size or qualitative stopping-rule design': '手法固有の標本サイズまたは定性調査の停止ルール設計',
    'Brand familiarity, none/not-sure handling, and neutral matrix order': 'ブランド親近性、なし／不明の扱い、中立的な行列順序',
    'Price exposure, branching, allocation, and presentation-order plan': '価格接触、分岐、割当、提示順序の計画',
    'Observed task protocol if usability validation is intended': 'ユーザビリティ検証を意図する場合の観察型タスク手順',
  }),
  ko: Object.freeze({
    'Treat 385 as a nominal full-sample reference for the expected-ease self-report only. Size an observed usability study separately from its task protocol, participant variation, accessibility needs, and iteration plan.': '385는 예상 용이성 자기보고의 명목상 전체 표본 기준값으로만 다루세요. 관찰형 사용성 연구는 과업 절차, 참여자 변이, 접근성 요구 및 반복 계획에 따라 별도로 설계해야 합니다.',
    'Treat 385 as a nominal full-sample single-proportion reference only; recalculate for the actual recruitment, subgroup, weighting, and analysis design.': '385는 명목상 전체 표본 단일 비율 기준값으로만 다루고 실제 모집, 하위집단, 가중 및 분석 설계에 맞춰 다시 계산하세요.',
    'This is a nominal simple-random-sample-equivalent calculation under stated assumptions, not a recommended field target, synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information. Expected ease is not observed usability.': '이는 명시된 가정에 따른 명목상 단순무작위표본 등가 계산이며 권장 현장 목표, 합성 신뢰구간, 실제 참여자 결과 또는 정밀도 보장이 아닙니다. 모집 방식, 가중, 제외, 무응답 및 하위집단 분석은 유효 정보량을 줄일 수 있습니다. 예상 용이성은 관찰된 사용성이 아닙니다.',
    'This is a nominal simple-random-sample-equivalent calculation under stated assumptions, not a recommended field target, synthetic confidence interval, human result, or guarantee of precision. Recruitment method, weighting, exclusions, nonresponse, and subgroup analysis can reduce effective information.': '이는 명시된 가정에 따른 명목상 단순무작위표본 등가 계산이며 권장 현장 목표, 합성 신뢰구간, 실제 참여자 결과 또는 정밀도 보장이 아닙니다. 모집 방식, 가중, 제외, 무응답 및 하위집단 분석은 유효 정보량을 줄일 수 있습니다.',
    'Have a researcher calculate the target from the frozen design, estimand, smallest decision-relevant difference, multiplicity policy, subgroup plan, and expected effective sample size.': '연구자가 확정된 설계, 추정량, 의사결정에 필요한 최소 차이, 다중성 정책, 하위집단 계획 및 예상 유효 표본 크기를 바탕으로 목표를 계산해야 합니다.',
    'Likerts does not invent a universal numeric target for a rank, matrix, or repeated-price design. The design must be frozen before a defensible power or precision calculation is possible.': 'Likerts는 순위, 행렬 또는 반복 가격 설계에 대해 보편적인 수치 목표를 만들어 내지 않습니다. 방어 가능한 검정력 또는 정밀도 계산 전에 설계를 확정해야 합니다.',
    'Plan iterative cognitive-interview rounds across the priority participant variations, revising between rounds and documenting the stopping rule.': '우선 참여자 변이에 걸쳐 반복적 인지 인터뷰 라운드를 계획하고 라운드 사이에 수정하며 중단 규칙을 문서화하세요.',
    'Set a purposive interview plan from the research objective, participant variation, topic complexity, analysis depth, and a documented stopping rule.': '연구 목표, 참여자 변이, 주제 복잡성, 분석 깊이 및 문서화된 중단 규칙을 바탕으로 목적 표집 인터뷰 계획을 수립하세요.',
    'A qualitative interview count is not a precision calculation. Likerts leaves the numeric target unset until a researcher defines the sampling and stopping logic.': '정성 인터뷰 수는 정밀도 계산이 아닙니다. 연구자가 표집 및 중단 논리를 정의할 때까지 Likerts는 수치 목표를 설정하지 않습니다.',
    'Choose and configure a supported research method before setting a sample-size target.': '표본 크기 목표를 정하기 전에 지원되는 연구 방법을 선택하고 구성하세요.',
    'No numeric sample recommendation is produced for a blocked or generic instrument.': '차단되었거나 일반적인 도구에는 수치 표본 권고를 제공하지 않습니다.',
    'Choose a supported method and complete its design.': '지원되는 방법을 선택하고 설계를 완료하세요.',
    'No numeric sample recommendation is available for this method.': '이 방법에는 수치 표본 권고가 없습니다.',
    'Statistical quotas are not applicable to this qualitative planning mode. A researcher must define purposive coverage across relevant participant variations; official population shares are context, not recruitment targets.': '통계적 할당은 이 정성 계획 모드에 적용되지 않습니다. 연구자는 관련 참여자 변이에 걸친 목적 표집 범위를 정의해야 하며, 공식 모집단 비율은 맥락 정보일 뿐 모집 목표가 아닙니다.',
    'No defensible achieved-sample quota is available until source denominators are shown to match the screened intended population. Population shares are reference values, not quotas. Quotas and weighting do not make an opt-in or non-probability panel representative.': '출처 분모가 스크리닝된 목표 모집단과 일치한다고 확인되기 전에는 방어 가능한 실제 표본 할당을 제시할 수 없습니다. 모집단 비율은 기준값이지 할당이 아닙니다. 할당과 가중으로 자발 참여 또는 비확률 패널이 대표성을 갖게 되지는 않습니다.',
    'Weighting is not applied to a cognitive pretest or interview-guide pilot.': '인지 사전검사 또는 인터뷰 가이드 파일럿에는 가중을 적용하지 않습니다.',
    'Have a human researcher review the cognitive-interview protocol and every supplied survey item.': '사람 연구자가 인지 인터뷰 절차와 제공된 모든 설문 항목을 검토하세요.',
    'Complete applicable ethics, privacy, consent, accessibility, recording, and data-protection review.': '해당되는 윤리, 개인정보, 동의, 접근성, 녹음 및 데이터 보호 검토를 완료하세요.',
    'Recruit purposively across the participant variations most likely to change comprehension or response mapping.': '이해 또는 응답 매핑을 바꿀 가능성이 높은 참여자 변이에 걸쳐 목적 표집으로 모집하세요.',
    'Run iterative rounds, record item-level comprehension and response-mapping issues, and revise between rounds.': '반복 라운드를 진행하고 항목 수준의 이해 및 응답 매핑 문제를 기록하며 라운드 사이에 수정하세요.',
    'Freeze an issue-resolution or stopping rule before declaring the pretest complete.': '사전검사 완료를 선언하기 전에 문제 해결 또는 중단 규칙을 확정하세요.',
    'Keep pilot feedback separate from substantive survey findings.': '파일럿 피드백을 실질적인 설문 결과와 분리하세요.',
    'Have a human researcher review and pilot the interview guide before substantive fieldwork.': '실질적인 현장 조사 전에 사람 연구자가 인터뷰 가이드를 검토하고 파일럿을 수행하세요.',
    'Complete applicable ethics, privacy, consent, accessibility, recording, safeguarding, and data-protection review.': '해당되는 윤리, 개인정보, 동의, 접근성, 녹음, 보호 조치 및 데이터 보호 검토를 완료하세요.',
    'Recruit purposively across the participant variations relevant to the guide objective.': '가이드 목표와 관련된 참여자 변이에 걸쳐 목적 표집으로 모집하세요.',
    'Pilot the sequence, probes, timing, sensitive-topic handling, and moderator instructions.': '순서, 탐침 질문, 시간, 민감한 주제 처리 및 진행자 지침을 파일럿으로 검토하세요.',
    'Document revisions and a stopping rule for guide piloting before substantive interviews begin.': '실질적인 인터뷰를 시작하기 전에 가이드 파일럿의 수정 사항과 중단 규칙을 문서화하세요.',
    'Do not analyze guide-pilot answers as substantive participant findings.': '가이드 파일럿 응답을 실질적인 참여자 발견으로 분석하지 마세요.',
    'No participant recruitment is booked or connected. Provider links are suggestions, not endorsements or integrations; audience availability, accessibility, compensation, timing, and terms must be confirmed directly.': '참여자 모집을 예약하거나 연결하지 않았습니다. 제공업체 링크는 제안일 뿐 보증이나 연동이 아닙니다. 대상 가용성, 접근성, 보상, 일정과 조건을 직접 확인해야 합니다.',
    'Ask providers for feasibility using the exact screener and population-reference dimensions; do not share synthetic segment labels as recruitable identities.': '정확한 스크리너와 모집단 기준 차원을 사용해 제공업체에 실행 가능성을 문의하고, 합성 세그먼트 이름을 모집 가능한 정체성으로 공유하지 마세요.',
    'Monitor incidence, recruitment progress, breakoff, exclusions, and respondent compensation.': '발생률, 모집 진행, 중도 이탈, 제외 및 응답자 보상을 모니터링하세요.',
    'The draft is a forced-choice matrix. Brand familiarity, a none/not-sure response, neutral ordering, randomization, and denominator rules must be reviewed before fielding.': '이 초안은 강제 선택 행렬입니다. 현장 조사 전에 브랜드 친숙도, 없음/모름 응답, 중립 순서, 무작위화 및 분모 규칙을 검토해야 합니다.',
    'The draft presents every supplied price in ascending order. It is not a randomized monadic or Gabor–Granger design; a researcher must define exposure, branching, allocation, and order capture before using those methods.': '이 초안은 제공된 모든 가격을 오름차순으로 제시합니다. 이는 무작위 단일 제시 또는 Gabor–Granger 설계가 아니며, 이러한 방법을 사용하기 전에 연구자가 노출, 분기, 할당 및 순서 기록을 정의해야 합니다.',
    'The handoff measures expected ease only. It does not observe task success, time, assistance, friction, or accessibility outcomes; size and run an observed task study separately if usability validation is intended.': '이 인계 자료는 예상 용이성만 측정합니다. 과업 성공, 시간, 도움, 마찰 또는 접근성 결과를 관찰하지 않습니다. 사용성 검증이 목적이라면 관찰형 과업 연구를 별도로 설계하고 수행하세요.',
    'Pilot responses are used to revise the guide and are not substantive participant findings.': '파일럿 응답은 가이드 수정에 사용하며 실질적인 참여자 발견이 아닙니다.',
    'Method-specific sample-size or qualitative stopping-rule design': '방법별 표본 크기 또는 정성 중단 규칙 설계',
    'Brand familiarity, none/not-sure handling, and neutral matrix order': '브랜드 친숙도, 없음/모름 처리 및 중립 행렬 순서',
    'Price exposure, branching, allocation, and presentation-order plan': '가격 노출, 분기, 할당 및 제시 순서 계획',
    'Observed task protocol if usability validation is intended': '사용성 검증이 목적일 때의 관찰형 과업 절차',
  }),
});

const localizedPlanningText = (value, handoff) => {
  if (typeof value !== 'string') return value;
  const language = exportLanguage(handoff);
  const replacements = { ...(ADDITIONAL_PLANNING_REPLACEMENTS[language] || {}), ...(PLANNING_REPLACEMENTS[language] || {}) };
  if (!replacements) return value;
  return Object.entries(replacements).reduce((text, [source, replacement]) => text.replaceAll(source, replacement), value);
};
const localizedExportValue = (value, handoff) => {
  if (typeof value === 'string') return localizedPlanningText(value, handoff);
  if (Array.isArray(value)) return value.map((item) => localizedExportValue(item, handoff));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizedExportValue(item, handoff)]));
  return value;
};

const cleanXmlText = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, MAX_CELL_CHARACTERS);
const escapeXml = (value) => cleanXmlText(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const formulaSafeText = (value) => {
  const text = cleanXmlText(value);
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
};
const csvCell = (value) => `"${formulaSafeText(value).replaceAll('"', '""')}"`;
const flatten = (value) => Array.isArray(value) ? value.map((item) => typeof item === 'object' ? JSON.stringify(item) : item).join(' | ') : value && typeof value === 'object' ? JSON.stringify(value) : value ?? '';
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => typeof value[key] !== 'undefined').map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const questionItems = (question) => question.items || [];
const questionItemsJson = (question) => question.items === undefined ? '' : stableJson(question.items);
const questionItemsText = (question, label, handoff, copy, humanCopy, priceContext) => questionItems(question).length
  ? `\n   ${label}:\n${questionItems(question).map((item) => `   - ${localizedQuestionItemText(item, handoff, copy, priceContext)}\n     ${humanCopy.technicalItemId}: ${item.itemId}`).join('\n')}`
  : '';
const questionRecord = (question) => ({ recordType: 'QUESTION', recordVersion: QUESTION_RECORD_VERSION, record: question });
const stimulusRecord = (stimulus) => ({ recordType: 'STIMULUS', recordVersion: STIMULUS_RECORD_VERSION, record: stimulus });
const versionedRecordsText = (records, label, humanCopy) => records.length
  ? `\n\n${label}\n${humanCopy.technicalRecordsNote}\n${records.map(({ recordType, recordVersion, record }) => `- ${humanCopy.technicalRecordType}: ${recordType}; ${humanCopy.technicalRecordVersion}: ${recordVersion}\n  ${stableJson(record)}`).join('\n')}`
  : '';
const packageIntegrity = (handoff) => ({
  version: handoff.packageVersion ?? null,
  integrity: {
    packageHash: handoff.packageHashes?.package ?? handoff.packageHash ?? null,
    partHashes: handoff.packageHashes || {},
  },
});
const recommendedCompletesForExport = (samplePlan, copy) => samplePlan.recommendedCompletes === null ? copy.notRecorded : samplePlan.recommendedCompletes;
const samplePlanText = (samplePlan, handoff, copy, humanCopy) => {
  const recommendation = localizedPlanningText(samplePlan.recommendation, handoff);
  const lines = [
    `${copy.sampleStatus}: ${humanTokenLabel(samplePlan.status, handoff, humanCopy)}`,
    `${humanCopy.technicalStatusId}: ${samplePlan.status || copy.notRecorded}`,
    `${copy.sampleRecommendationCode}: ${humanTokenLabel(samplePlan.recommendationCode, handoff, humanCopy)}`,
    `${humanCopy.technicalRecommendationId}: ${samplePlan.recommendationCode || copy.notRecorded}`,
  ];
  if (samplePlan.recommendedCompletes === null) lines.push(`${copy.sampleInstruction}: ${recommendation || copy.notRecorded}`);
  else lines.push(`${copy.nominalFullSampleReference}: ${localizedExportNumber(samplePlan.recommendedCompletes, handoff, copy)}. ${recommendation || ''}`.trim());
  if (samplePlan.disclosure) lines.push(localizedPlanningText(samplePlan.disclosure, handoff));
  return lines.join('\n');
};
const localizedQuotaShare = (value, handoff, copy) => Number.isFinite(value)
  ? formatPercentagePoints(value * 100, exportLocaleFor(handoff))
  : copy.notRecorded;
const localizedQuotaCount = (value, handoff, copy) => Number.isFinite(value)
  ? localizedExportNumber(value, handoff, copy)
  : copy.notRecorded;
const quotaRowsText = (quotaPlan, handoff, copy) => [
  ...(quotaPlan.targets || []).flatMap((target) => target.categories.map((category) => `${copy.actualQuota}: ${target.variable}/${category.code} — ${copy.targetShare}: ${localizedQuotaShare(category.targetShare, handoff, copy)}; ${copy.planningCompletes}: ${localizedQuotaCount(category.targetCompletes, handoff, copy)}`)),
  ...(quotaPlan.monitorTargets || []).flatMap((target) => target.categories.map((category) => `${copy.populationReference}: ${target.variable}/${category.code} — ${copy.referenceShare}: ${localizedQuotaShare(category.referenceShare, handoff, copy)}`)),
  ...(quotaPlan.coverageDimensions || []).flatMap((dimension) => dimension.categories.map((category) => `${copy.purposiveCoverage}: ${dimension.variable}/${category.code} — ${copy.sourceShare}: ${localizedQuotaShare(category.sourceShare, handoff, copy)}`)),
].join('\n');

function preflightHandoff(handoff) {
  const validQuestionItems = (items) => items === undefined || (Array.isArray(items)
    && items.every((item) => item && typeof item === 'object' && typeof item.itemId === 'string' && item.itemId.trim().length > 0 && typeof item.text === 'string' && item.text.trim().length > 0)
    && new Set(items.map((item) => item.itemId)).size === items.length);
  const valid = handoff && typeof handoff === 'object'
    && handoff.sourceStudy && typeof handoff.sourceStudy === 'object'
    && handoff.questionnaire && Array.isArray(handoff.questionnaire.questions)
    && Array.isArray(handoff.questionnaire.stimuli) && handoff.questionnaire.stimuli.every((stimulus) => stimulus && typeof stimulus === 'object' && Array.isArray(stimulus.reviewFlags))
    && handoff.questionnaire.questions.every((question) => question && typeof question === 'object' && Array.isArray(question.options) && question.options.every((option) => option && typeof option === 'object') && validQuestionItems(question.items) && Array.isArray(question.displayConditions) && question.displayConditions.every((condition) => condition && typeof condition === 'object') && Array.isArray(question.provenance?.sourceIds) && Array.isArray(question.reviewFlags))
    && handoff.screeningPlan && Array.isArray(handoff.screeningPlan.criteria) && Array.isArray(handoff.screeningPlan.terminationLogic)
    && handoff.screeningPlan.criteria.every((criterion) => criterion && typeof criterion === 'object')
    && handoff.screeningPlan.terminationLogic.every((rule) => rule && typeof rule === 'object' && rule.when && Array.isArray(rule.when.values))
    && handoff.quotaPlan && Array.isArray(handoff.quotaPlan.targets) && Array.isArray(handoff.quotaPlan.monitorTargets)
    && [...handoff.quotaPlan.targets, ...handoff.quotaPlan.monitorTargets].every((target) => target && typeof target === 'object' && Array.isArray(target.categories) && target.categories.every((category) => category && typeof category === 'object'))
    && (handoff.quotaPlan.coverageDimensions === undefined || (Array.isArray(handoff.quotaPlan.coverageDimensions) && handoff.quotaPlan.coverageDimensions.every((dimension) => dimension && typeof dimension === 'object' && Array.isArray(dimension.categories) && dimension.categories.every((category) => category && typeof category === 'object'))))
    && handoff.samplePlan && (handoff.samplePlan.recommendedCompletes === null || (Number.isInteger(handoff.samplePlan.recommendedCompletes) && handoff.samplePlan.recommendedCompletes >= 1))
    && handoff.incidencePlan && typeof handoff.incidencePlan === 'object'
    && handoff.recruitmentPlan && Array.isArray(handoff.recruitmentPlan.instructions)
    && handoff.analysisPlan && Array.isArray(handoff.analysisPlan.primaryEstimand?.statistics)
    && Array.isArray(handoff.analysisPlan.reporting)
    && Array.isArray(handoff.providerLinks) && handoff.providerLinks.every((provider) => provider && typeof provider === 'object' && Array.isArray(provider.limitations))
    && (!handoff.researchGrounding || (Array.isArray(handoff.researchGrounding.materials) && handoff.researchGrounding.materials.every((material) => material && typeof material === 'object')))
    && (handoff.packageVersion === undefined || typeof handoff.packageVersion === 'string')
    && (handoff.packageHashes === undefined || (handoff.packageHashes && typeof handoff.packageHashes === 'object' && !Array.isArray(handoff.packageHashes) && Object.values(handoff.packageHashes).every((hash) => typeof hash === 'string')))
    && Array.isArray(handoff.missingFields) && Array.isArray(handoff.disclosures);
  if (!valid) throw new TypeError('Invalid human-research handoff: required structured planning fields are missing.');
  let nodes = 0;
  let characters = 0;
  const visit = (value, depth = 0) => {
    nodes += 1;
    if (nodes > MAX_INPUT_NODES || depth > 24) throw new RangeError('The human-research export is too complex.');
    if (typeof value === 'string') {
      if (value.length > MAX_CELL_CHARACTERS) throw new RangeError('A human-research export cell exceeded 32,000 characters.');
      characters += value.length;
      if (characters > MAX_INPUT_CHARACTERS) throw new RangeError('The human-research export exceeded the 2,000,000-character limit.');
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) throw new RangeError('A human-research export collection exceeded 5,000 items.');
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => { visit(key, depth + 1); visit(item, depth + 1); });
  };
  visit(handoff);
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function inlineCell(value, rowIndex, columnIndex, style) {
  const address = `${columnName(columnIndex)}${rowIndex}`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${address}" s="${style}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${address}" t="b" s="${style}"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${address}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(formulaSafeText(value))}</t></is></c>`;
}

function sheetXml(rows) {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const height = Math.max(1, rows.length);
  const body = rows.map((row, rowOffset) => {
    const rowIndex = rowOffset + 1;
    const style = rowIndex === 1 ? 1 : rowIndex === 3 ? 2 : rowIndex === 2 ? 3 : 4;
    const height = rowIndex === 1 ? ' ht="30" customHeight="1"' : rowIndex === 2 ? ' ht="60" customHeight="1"' : '';
    return `<row r="${rowIndex}"${height}>${row.map((value, columnIndex) => inlineCell(value, rowIndex, columnIndex, style)).join('')}</row>`;
  }).join('');
  const columns = Array.from({ length: width }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="${index === 0 ? 24 : index === 1 ? 52 : 24}" customWidth="1"/>`).join('');
  const lastColumn = columnName(width - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${height}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${body}</sheetData><mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells></worksheet>`;
}

function baseRows(copy, boundary, headers, dataRows) {
  return [[copy.banner], [boundary], headers, ...dataRows];
}

const technicalWorkbookRow = (row, humanCopy) => {
  const field = String(row?.[0] || '');
  return [
    humanCopy.technicalReference,
    humanCopy.technicalQuestionId,
    humanCopy.technicalStimulusId,
    humanCopy.technicalItemId,
    humanCopy.technicalTypeId,
    humanCopy.technicalStatusId,
    humanCopy.technicalRecommendationId,
    humanCopy.technicalStatisticIds,
    humanCopy.technicalReportingIds,
    humanCopy.technicalBoolean,
    humanCopy.technicalPlanJson,
    humanCopy.technicalCurrencyId,
    humanCopy.technicalRecordType,
    humanCopy.technicalRecordVersion,
  ].some((label) => field.includes(label));
};

const localizeWorkbookDisplayCell = (cell, handoff, humanCopy, row, rowIndex, columnIndex, sheetIndex) => {
  if (rowIndex < 3) return cell;
  if ([0, 5].includes(sheetIndex)) {
    return columnIndex === 1 && !technicalWorkbookRow(row, humanCopy) ? localizedPlanningText(cell, handoff) : cell;
  }
  if (sheetIndex === 3 && [0, 4, 6, 8, 9, 11].includes(columnIndex)) return localizedPlanningText(cell, handoff);
  return cell;
};

function workbookRows(handoff, copy) {
  const boundary = exportBoundaryFor(handoff, copy);
  const labels = copy.workbook;
  const humanCopy = humanExportCopyFor(handoff);
  const priceContext = handoffPriceContext(handoff);
  const questionnaireRows = handoff.questionnaire.questions.map((question) => [
    question.questionId, question.sectionId, question.order,
    humanTokenLabel(question.type, handoff, humanCopy), question.type,
    question.text, question.instruction, question.stimulusId,
    humanBoolean(question.isRequired, humanCopy), question.isRequired,
    question.variableName,
    humanTokenLabel(question.analysisRole, handoff, humanCopy), question.analysisRole,
    humanTokenLabel(question.provenance?.class, handoff, humanCopy), question.provenance?.class,
    (question.provenance?.sourceIds || []).join('|'),
    [...new Set((question.reviewFlags || []).map((flag) => humanTokenLabel(flag, handoff, humanCopy)))].join('|'),
    (question.reviewFlags || []).join('|'),
    questionItems(question).length,
    questionItems(question).map((item) => item.itemId).join('|'),
    questionItems(question).map((item) => localizedQuestionItemText(item, handoff, copy, priceContext)).join('|'),
    questionItemsJson(question), '', '', '', '',
    'QUESTION', QUESTION_RECORD_VERSION, stableJson(question),
  ]);
  const stimulusRows = (handoff.questionnaire.stimuli || []).map((stimulus) => [
    `STIMULUS:${stimulus.stimulusId}`, 'EXPOSURE', '',
    humanTokenLabel('STIMULUS', handoff, humanCopy), stimulus.type,
    humanStimulusText(stimulus), '', stimulus.stimulusId,
    humanCopy.yes, true, '',
    humanTokenLabel('CLASSIFICATION', handoff, humanCopy), 'CLASSIFICATION',
    humanTokenLabel(stimulus.provenance, handoff, humanCopy), stimulus.provenance, '',
    [...new Set((stimulus.reviewFlags || []).map((flag) => humanTokenLabel(flag, handoff, humanCopy)))].join('|'),
    (stimulus.reviewFlags || []).join('|'),
    '', '', '', '',
    stimulus.price ? localizedExportPrice(stimulus.price, handoff, copy) : '',
    stimulus.price?.amount ?? '', stimulus.price?.currency || '', stimulus.price?.unit || '',
    'STIMULUS', STIMULUS_RECORD_VERSION, stableJson(stimulus),
  ]);
  const optionRows = handoff.questionnaire.questions.flatMap((question) => (question.options || []).map((option) => [question.questionId, option.code, option.label, option.order]));
  const screeningRows = [
    ...(handoff.screeningPlan.criteria || []).map((criterion) => [humanCopy.screeningCriterion, 'CRITERION', criterion.criterionId, criterion.questionId, humanTokenLabel(criterion.source, handoff, humanCopy), criterion.source, humanTokenLabel(criterion.status, handoff, humanCopy), criterion.status, criterion.rationale, '', '', '', '', '']),
    ...(handoff.screeningPlan.terminationLogic || []).map((rule) => [humanCopy.terminationRule, 'TERMINATION', rule.ruleId, rule.when?.questionId, '', '', '', '', '', rule.when?.operator === 'EQ' ? humanCopy.equals : humanCopy.reviewRequired, rule.when?.operator, rule.action === 'TERMINATE_NO_CONSENT' ? humanCopy.terminateNoConsent : rule.action === 'TERMINATE_INELIGIBLE' ? humanCopy.terminateIneligible : humanCopy.reviewRequired, rule.action, rule.reasonCode]),
  ];
  const quotaRows = [
    [humanTokenLabel(handoff.quotaPlan.status, handoff, humanCopy), handoff.quotaPlan.status, '', '', '', '', '', '', '', '', '', '', ''],
    ...(handoff.quotaPlan.targets || []).flatMap((target) => target.categories.map((category) => [copy.actualQuota, 'QUOTA', target.quotaId, target.variable, category.code, category.targetShare, category.targetCompletes, target.sourceDatasetId, humanTokenLabel(target.denominatorMatch, handoff, humanCopy), target.denominatorMatch, '', '', ''])),
    ...(handoff.quotaPlan.monitorTargets || []).flatMap((target) => target.categories.map((category) => [humanTokenLabel(target.type || 'POPULATION_REFERENCE_ONLY', handoff, humanCopy), target.type || 'POPULATION_REFERENCE_ONLY', target.quotaId, target.variable, category.code, '', '', target.sourceDatasetId, humanTokenLabel(target.denominatorMatch, handoff, humanCopy), target.denominatorMatch, category.referenceShare, '', ''])),
    ...(handoff.quotaPlan.coverageDimensions || []).flatMap((dimension) => dimension.categories.map((category) => [copy.purposiveCoverage, dimension.type || 'PURPOSIVE_COVERAGE_REFERENCE', '', dimension.variable, category.code, '', '', dimension.sourceDatasetId, dimension.coverageDate || copy.notRecorded, dimension.coverageDate || '', '', dimension.coverageId, category.sourceShare])),
  ];
  const recruitmentRows = [
    [labels.intendedPopulation, handoff.intendedPopulation],
    [labels.geography, flatten(handoff.geography)],
    [labels.sampleStatus, humanTokenLabel(handoff.samplePlan.status, handoff, humanCopy)],
    [humanCopy.technicalStatusId, handoff.samplePlan.status],
    [labels.sampleRecommendationCode, humanTokenLabel(handoff.samplePlan.recommendationCode, handoff, humanCopy)],
    [humanCopy.technicalRecommendationId, handoff.samplePlan.recommendationCode],
    [labels.sampleRecommendation, handoff.samplePlan.recommendation],
    [handoff.samplePlan.recommendedCompletes === null ? labels.recommendedCompletes : labels.nominalFullSampleReference, recommendedCompletesForExport(handoff.samplePlan, copy)],
    [labels.sampleBasis, handoff.samplePlan.basis],
    [`${labels.sampleParameters} — ${humanCopy.technicalReference}`, flatten(handoff.samplePlan.parameters)],
    [labels.sampleDisclosure, handoff.samplePlan.disclosure],
    [labels.incidenceStatus, humanTokenLabel(handoff.incidencePlan.status, handoff, humanCopy)],
    [`${labels.incidenceStatus} — ${humanCopy.technicalStatusId}`, handoff.incidencePlan.status],
    [labels.incidenceEstimate, Number.isFinite(handoff.incidencePlan.pointEstimate) ? localizedExportNumber(handoff.incidencePlan.pointEstimate, handoff, copy) : copy.notRecorded],
    [labels.incidenceDisclosure, handoff.incidencePlan.disclosure],
    [labels.panelConnection, handoff.recruitmentPlan.noPanelBooked ? humanCopy.no : humanCopy.reviewRequired],
    [`${labels.panelConnection} — ${humanCopy.technicalStatusId}`, handoff.recruitmentPlan.noPanelBooked ? 'NONE' : 'NOT_RECORDED'],
    [labels.recruitmentDisclosure, handoff.recruitmentPlan.disclosure],
    ...(handoff.recruitmentPlan.instructions || []).map((instruction, index) => [`${labels.instruction} ${index + 1}`, instruction]),
    ...(handoff.providerLinks || []).flatMap((provider) => [
      [`${labels.providerOption}: ${provider.name}`, `${provider.url} · ${(provider.limitations || []).join(' ')}`],
      [`${labels.providerOption}: ${provider.name} — ${humanCopy.technicalReference}`, `provider_id=${provider.providerId}; relationship_id=${provider.relationship}; suitability_id=${provider.suitability || copy.notRecorded}`],
    ]),
  ];
  const primaryStatistics = handoff.analysisPlan?.primaryEstimand?.statistics || [];
  const reporting = handoff.analysisPlan?.reporting || [];
  const analysisRows = [
    [humanCopy.primaryAnalysis, primaryStatistics.map((value) => humanTokenLabel(value, handoff, humanCopy)).join(' · ')],
    [humanCopy.technicalStatisticIds, primaryStatistics.join('|')],
    [humanCopy.humanAnalysisFrozen, humanBoolean(handoff.analysisPlan?.syntheticComparison?.humanAnalysisFrozenBeforeComparison, humanCopy)],
    [humanCopy.technicalBoolean, handoff.analysisPlan?.syntheticComparison?.humanAnalysisFrozenBeforeComparison],
    [humanCopy.reportingPlan, reporting.map((value) => humanTokenLabel(value, handoff, humanCopy)).join(' · ')],
    [humanCopy.technicalReportingIds, reporting.join('|')],
    [humanCopy.technicalPlanJson, stableJson(handoff.analysisPlan || {})],
  ];
  const lineageRows = [
    [humanCopy.technicalReference, humanCopy.technicalRecordsNote],
    ...Object.entries(handoff.sourceStudy || {}).map(([field, value]) => [field, flatten(value)]),
    ['handoffId', handoff.handoffId],
    ['handoffVersion', handoff.schemaVersion],
    ['humanResearchPackageVersion', handoff.packageVersion ?? ''],
    ['humanResearchPackageHash', packageIntegrity(handoff).integrity.packageHash ?? ''],
    ...Object.entries(packageIntegrity(handoff).integrity.partHashes).sort(([left], [right]) => left.localeCompare(right)).map(([part, hash]) => [`humanResearchPackageHash_${part}`, hash]),
    ['generatedAt', handoff.generatedAt],
    ['contentStatus', handoff.contentStatus],
    ['unsupportedCharacteristics', (handoff.unsupportedCharacteristics || []).join(' | ')],
    ['missingFields', (handoff.missingFields || []).join(' | ')],
    ['blockingIssues', (handoff.blockingIssues || []).join(' | ')],
    ...((handoff.researchGrounding?.materials || []).map((material, index) => [`researchMaterial_${index + 1}`, flatten(material)])),
    ['researchGroundingDisclosure', handoff.researchGrounding?.disclosure || 'No uploaded research material was recorded.'],
    ...((handoff.disclosures || []).map((disclosure, index) => [`disclosure_${index + 1}`, disclosure])),
  ];
  const blockerRows = (handoff.blockingIssues || []).flatMap((issue, index) => [
    [`${humanCopy.blockingIssues} ${index + 1}`, humanTokenLabel(issue, handoff, humanCopy)],
    [`${humanCopy.blockingIssues} ${index + 1} — ${humanCopy.technicalReference}`, issue],
  ]);
  const sheets = [
    baseRows(copy, boundary, [labels.field, labels.value], [[labels.handoffId, handoff.handoffId], [labels.version, handoff.schemaVersion], [labels.generatedAt, handoff.generatedAt], [labels.status, humanTokenLabel(handoff.status, handoff, humanCopy)], [`${labels.status} — ${humanCopy.technicalStatusId}`, handoff.status], [labels.contentStatus, humanTokenLabel(handoff.contentStatus, handoff, humanCopy)], [`${labels.contentStatus} — ${humanCopy.technicalStatusId}`, handoff.contentStatus], [labels.questionnaire, handoff.questionnaire.disclosure], [labels.observedHumanResponses, humanCopy.no], [`${labels.observedHumanResponses} — ${humanCopy.technicalBoolean}`, false], [labels.panelConnected, humanCopy.no], [`${labels.panelConnected} — ${humanCopy.technicalBoolean}`, false], ...blockerRows]),
    baseRows(copy, boundary, ['question_id', 'section_id', 'order', humanCopy.questionType, humanCopy.technicalTypeId, 'question_text', 'instruction_text', 'stimulus_id', humanCopy.required, humanCopy.technicalBoolean, 'variable_name', humanCopy.analysisRole, `${humanCopy.analysisRole} — ${humanCopy.technicalReference}`, humanCopy.provenance, `${humanCopy.provenance} — ${humanCopy.technicalReference}`, 'provenance_source_ids', 'review_flag_labels', 'review_flags_technical_ids', 'item_count', 'item_ids', 'item_display_texts', 'items_json', humanCopy.priceDisplay, humanCopy.priceAmount, humanCopy.technicalCurrencyId, humanCopy.priceUnit, humanCopy.technicalRecordType, humanCopy.technicalRecordVersion, 'record_json'], [...stimulusRows, ...questionnaireRows]),
    baseRows(copy, boundary, ['question_id', 'option_code', 'option_label', 'option_order'], optionRows),
    baseRows(copy, boundary, [humanCopy.recordType, humanCopy.technicalRecordType, 'record_id', 'question_id', humanCopy.source, `${humanCopy.source} — ${humanCopy.technicalReference}`, humanCopy.status, humanCopy.technicalStatusId, 'rationale', humanCopy.operator, `${humanCopy.operator} — ${humanCopy.technicalReference}`, humanCopy.action, `${humanCopy.action} — ${humanCopy.technicalReference}`, 'reason_technical_id'], screeningRows),
    baseRows(copy, boundary, [humanCopy.targetType, `${humanCopy.targetType} — ${humanCopy.technicalReference}`, 'quota_id', 'variable', 'category', 'target_share', 'planning_completes', 'source_dataset_id', humanCopy.denominatorStatus, `${humanCopy.denominatorStatus} — ${humanCopy.technicalReference}`, 'reference_share', 'coverage_id', 'source_share'], quotaRows),
    baseRows(copy, boundary, [labels.field, labels.value], recruitmentRows),
    baseRows(copy, boundary, [labels.field, labels.plan], analysisRows),
    baseRows(copy, boundary, [labels.field, labels.value], lineageRows),
  ];
  return sheets.map((rows, sheetIndex) => rows.map((row, rowIndex) => row.map((cell, columnIndex) => (
    localizeWorkbookDisplayCell(cell, handoff, humanCopy, row, rowIndex, columnIndex, sheetIndex)
  ))));
}

const contentTypesXml = (sheetNames) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetNames.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
const rootRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const workbookXml = (sheetNames) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView/></bookViews><sheets>${sheetNames.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;
const workbookRelationshipsXml = (sheetNames) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetNames.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="13"/><name val="Arial"/></font><font><b/><color rgb="FF08152A"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF021A38"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFD9DEE7"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function humanResearchHandoffToCsv(handoff) {
  preflightHandoff(handoff);
  const copy = exportCopyFor(handoff);
  const headers = ['instrument_version', 'section_id', 'question_id', 'order', 'question_type', 'question_text', 'instruction_text', 'stimulus_id', 'is_required', 'option_code', 'option_label', 'option_order', 'item_id', 'item_text', 'item_amount', 'item_json', 'display_conditions', 'variable_name', 'analysis_role', 'provenance_class', 'provenance_source_ids', 'review_flags', 'record_type', 'record_version', 'record_json'];
  const stimulusRows = handoff.questionnaire.stimuli.map((stimulus) => [
    handoff.questionnaire.instrumentVersion, 'EXPOSURE', `STIMULUS:${stimulus.stimulusId}`, '', 'STIMULUS_CONTENT', stimulus.text, '', stimulus.stimulusId, true,
    '', '', '', '', '', '', '', '', '', 'CLASSIFICATION', stimulus.provenance, '', (stimulus.reviewFlags || []).join('|'), 'STIMULUS', STIMULUS_RECORD_VERSION, stableJson(stimulus),
  ]);
  const questionRows = handoff.questionnaire.questions.flatMap((question) => {
    const options = question.options?.length ? question.options : [];
    const items = questionItems(question);
    const rowCount = Math.max(options.length, items.length, 1);
    return Array.from({ length: rowCount }, (_, index) => {
      const option = options[index];
      const item = items[index];
      return [handoff.questionnaire.instrumentVersion, question.sectionId, question.questionId, question.order, question.type, question.text, question.instruction, question.stimulusId, question.isRequired, option?.code, option?.label, option?.order, item?.itemId, item?.text, item?.amount, item ? stableJson(item) : '', flatten(question.displayConditions), question.variableName, question.analysisRole, question.provenance?.class, (question.provenance?.sourceIds || []).join('|'), (question.reviewFlags || []).join('|'), 'QUESTION', QUESTION_RECORD_VERSION, stableJson(question)];
    });
  });
  return `\uFEFF${csvCell(copy.banner)}\n${csvCell(exportBoundaryFor(handoff, copy))}\n${headers.map(csvCell).join(',')}\n${[...stimulusRows, ...questionRows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function humanResearchHandoffToXlsx(handoff) {
  preflightHandoff(handoff);
  const copy = exportCopyFor(handoff);
  const sheetNames = copy.sheetNames;
  const rows = workbookRows(handoff, copy);
  const rowCount = rows.reduce((sum, sheetRows) => sum + sheetRows.length, 0);
  const cellCount = rows.reduce((sum, sheetRows) => sum + sheetRows.reduce((sheetSum, row) => sheetSum + row.length, 0), 0);
  if (rowCount > MAX_WORKBOOK_ROWS || cellCount > MAX_WORKBOOK_CELLS) throw new RangeError('The human-research workbook exceeded its row or cell limit.');
  if (rows.some((sheetRows) => sheetRows.some((row) => row.some((cell) => String(cell ?? '').length > MAX_CELL_CHARACTERS)))) throw new RangeError('A generated human-research workbook cell exceeded 32,000 characters.');
  const files = {
    '[Content_Types].xml': strToU8(contentTypesXml(sheetNames)),
    '_rels/.rels': strToU8(rootRelationshipsXml),
    'xl/workbook.xml': strToU8(workbookXml(sheetNames)),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelationshipsXml(sheetNames)),
    'xl/styles.xml': strToU8(stylesXml),
  };
  rows.forEach((sheetRows, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheetRows)); });
  const zipped = zipSync(files, { level: 6 });
  if (zipped.byteLength > MAX_WORKBOOK_BYTES) throw new RangeError('The human-research workbook exceeded the 5 MB export limit.');
  return zipped;
}

export function humanResearchBriefText(handoff) {
  preflightHandoff(handoff);
  const copy = exportCopyFor(handoff);
  const humanCopy = humanExportCopyFor(handoff);
  const boundary = exportBoundaryFor(handoff, copy);
  const displayPlanning = (value) => localizedPlanningText(value, handoff);
  const priceContext = handoffPriceContext(handoff);
  const questions = handoff.questionnaire.questions.map((question) => `${localizedExportNumber(question.order, handoff, copy)}. [${humanTokenLabel(question.type, handoff, humanCopy)}] ${question.text}\n   ${humanCopy.technicalQuestionId}: ${question.questionId}\n   ${humanCopy.technicalTypeId}: ${question.type}${question.options?.length ? `\n   ${question.options.map((option) => `${option.code}. ${option.label}`).join(' | ')}` : ''}${questionItemsText(question, copy.items, handoff, copy, humanCopy, priceContext)}`).join('\n');
  const stimuli = (handoff.questionnaire.stimuli || []).map((stimulus) => {
    const price = stimulus.price ? `\n  ${humanCopy.price}: ${localizedExportPrice(stimulus.price, handoff, copy)}\n  ${humanCopy.priceUnit}: ${stimulus.price.unit || copy.notRecorded}` : '';
    return `- ${humanStimulusText(stimulus)}${price}\n  ${humanCopy.technicalStimulusId}: ${stimulus.stimulusId}\n  ${humanCopy.technicalTypeId}: ${stimulus.type}`;
  }).join('\n');
  const screening = (handoff.screeningPlan.criteria || []).map((criterion) => `- ${displayPlanning(criterion.rationale)} (${humanTokenLabel(criterion.status, handoff, humanCopy)})\n  ${humanCopy.technicalReference}: ${criterion.criterionId}\n  ${humanCopy.technicalStatusId}: ${criterion.status}`).join('\n');
  const primaryStatistics = handoff.analysisPlan.primaryEstimand.statistics || [];
  const reporting = handoff.analysisPlan.reporting || [];
  const frozen = handoff.analysisPlan.syntheticComparison.humanAnalysisFrozenBeforeComparison;
  const blockers = (handoff.blockingIssues || []).map((issue) => `- ${humanTokenLabel(issue, handoff, humanCopy)}\n  ${humanCopy.technicalReference}: ${issue}`).join('\n');
  const quotaReferenceText = quotaRowsText(handoff.quotaPlan, handoff, copy);
  const text = `${copy.banner}\n\n${boundary}\n\n${handoff.questionnaire.title}\n${displayPlanning(handoff.questionnaire.disclosure)}\n\n${copy.questionnaire}\n${questions}${stimuli ? `\n\n${humanCopy.stimuli}\n${stimuli}` : ''}\n\n${copy.screening}\n${screening}\n\n${copy.quotas}\n${displayPlanning(handoff.quotaPlan.disclosure)}\n${quotaReferenceText ? `${quotaReferenceText}\n` : ''}${displayPlanning(handoff.incidencePlan.disclosure)}\n\n${copy.samplePlan}\n${samplePlanText(handoff.samplePlan, handoff, copy, humanCopy)}\n\n${copy.recruitment}\n${handoff.recruitmentPlan.instructions.map((instruction) => `- ${displayPlanning(instruction)}`).join('\n')}\n${displayPlanning(handoff.recruitmentPlan.disclosure)}\n\n${copy.analysisPlan}\n${copy.primaryLine(primaryStatistics.map((statistic) => humanTokenLabel(statistic, handoff, humanCopy)))}\n${humanCopy.technicalStatisticIds}: ${primaryStatistics.join('|')}\n${humanCopy.reportingPlan}: ${reporting.map((item) => humanTokenLabel(item, handoff, humanCopy)).join(' · ')}\n${humanCopy.technicalReportingIds}: ${reporting.join('|')}\n${copy.frozenLine(humanBoolean(frozen, humanCopy))}\n${humanCopy.technicalBoolean}: ${String(frozen)}${blockers ? `\n\n${humanCopy.blockingIssues}\n${blockers}` : ''}\n\n${copy.missing}\n${handoff.missingFields.map((field) => `- ${displayPlanning(field)}`).join('\n')}\n`;
  return `${text}${versionedRecordsText(handoff.questionnaire.questions.map(questionRecord), `${copy.questionRecords} — ${humanCopy.technicalReference}`, humanCopy)}${versionedRecordsText(handoff.questionnaire.stimuli.map(stimulusRecord), `${copy.stimulusRecords} — ${humanCopy.technicalReference}`, humanCopy)}\n`;
}

export function humanResearchReceiptJson(handoff) {
  preflightHandoff(handoff);
  const copy = exportCopyFor(handoff);
  return JSON.stringify({
    exportType: 'Likerts human-research handoff receipt',
    exportLocale: handoff.questionnaire.language,
    banner: copy.banner,
    boundary: exportBoundaryFor(handoff, copy),
    schemaVersion: handoff.schemaVersion,
    handoffId: handoff.handoffId,
    generatedAt: handoff.generatedAt,
    status: handoff.status,
    contentStatus: handoff.contentStatus,
    observedHumanResponses: false,
    participantPanelConnected: false,
    lineage: handoff.sourceStudy,
    humanResearchPackage: packageIntegrity(handoff),
    questionnaire: {
      instrumentVersion: handoff.questionnaire.instrumentVersion,
      language: handoff.questionnaire.language,
      questionRecords: handoff.questionnaire.questions.map(questionRecord),
      stimulusRecords: handoff.questionnaire.stimuli.map(stimulusRecord),
    },
    researchGrounding: localizedExportValue(handoff.researchGrounding || { status: 'NONE', materials: [] }, handoff),
    missingFields: localizedExportValue(handoff.missingFields, handoff),
    disclosures: localizedExportValue(handoff.disclosures, handoff),
  }, null, 2);
}

export function safeHandoffFilename(handoff, extension) {
  const runId = String(handoff.sourceStudy?.runId || 'study').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'study';
  const safeExtension = ['csv', 'xlsx', 'txt', 'json'].includes(extension) ? extension : 'json';
  return `likerts-${runId}-human-research-handoff.${safeExtension}`;
}
