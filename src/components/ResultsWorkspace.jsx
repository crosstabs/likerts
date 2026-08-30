import { useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  BookmarkSimple,
  ChartLineUp,
  Check,
  CheckCircle,
  Copy,
  Export,
  FileText,
  GlobeHemisphereWest,
  Info,
  LinkSimple,
  PencilSimple,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import { markets, researchMethodMetadata, responseScale } from '../data.js';
import { getLanguageName, useI18n } from '../i18n.jsx';
import {
  formatLocalizedCurrency,
  formatLocalizedDate,
  formatLocalizedDateTime,
  formatLocalizedList,
  formatLocalizedNumber,
  formatPercentagePoints,
  localizedPluralCategory,
} from '../lib/localizedFormatting.js';
import { researchSignalsFor } from '../lib/researchMeta.js';
import { resolveInputHashLineage } from '../lib/inputHashLineage.js';
import { compareRepeatRuns } from '../lib/repeatRunStability.js';
import { thrownErrorCode } from '../lib/publicRequestError.js';
import { formatDisplayDate } from '../lib/displayDates.js';

const formatEvidenceClass = (value = 'UNRECORDED') => value
  .toLowerCase()
  .replaceAll('_', ' ')
  .replace(/^./, (letter) => letter.toUpperCase());

const statusKeys = Object.freeze({
  NONE: 'statusNone',
  NOT_APPLIED: 'statusNotApplied',
  NOT_APPLICABLE: 'statusNotApplicable',
  INVALID_INPUT: 'statusInvalidInput',
  CONVERGED: 'statusConverged',
  UNMEASURED: 'notMeasured',
  MEASURED: 'statusMeasured',
  PARTIAL: 'statusPartial',
  CURATED_OFFICIAL: 'statusCuratedOfficial',
  USER_DECLARED_OFFICIAL: 'statusUserDeclaredOfficial',
  UNVERIFIED: 'statusUnverified',
  CONTEXT_ONLY: 'statusContextOnly',
  NOT_VALIDATED: 'statusNotValidated',
  BLOCKED_REQUIRES_QUESTIONNAIRE_REVISION: 'statusBlockedRequiresRevision',
  FIELD_DRAFT_REQUIRES_REVIEW: 'statusFieldDraftRequiresReview',
  BLOCKED: 'statusBlocked',
  READY_FOR_RESEARCHER_REVIEW: 'statusReadyForResearcherReview',
  SINGLE_SELECT: 'statusSingleSelect',
  RANK_ORDER: 'statusRankOrder',
  MATRIX_SINGLE_SELECT: 'statusMatrixSingleSelect',
  OPEN_TEXT: 'statusOpenText',
  STIMULUS: 'statusStimulus',
  INSTRUCTION: 'statusInstruction',
  METHOD_TEMPLATE: 'statusMethodTemplate',
  USER_INPUT: 'statusUserInput',
  MODEL_FRAMING: 'statusModelFraming',
  DRAFT: 'statusDraft',
  REQUIRES_RESEARCHER_OPERATIONALIZATION: 'statusRequiresResearcherOperationalization',
  MONITOR_ONLY: 'statusMonitorOnly',
  POPULATION_REFERENCE_ONLY: 'statusPopulationReferenceOnly',
  FULL_DISTRIBUTION: 'statusFullDistribution',
  FULL_DISTRIBUTIONS: 'statusFullDistribution',
  TOP_TWO_BOX: 'statusTopTwoBox',
  INSUFFICIENT_RUNS: 'statusInsufficientRuns',
  NOT_COMPARABLE: 'statusNotComparable',
  COMPARABLE: 'statusComparable',
  RAKING_IPF: 'statusRakingIpf',
  POST_STRATIFICATION: 'statusPostStratification',
  PRIOR_ONLY: 'evidenceModePriorOnly',
  EXA_GATEWAY: 'evidenceModeGateway',
  MODEL_ONLY: 'evidenceModeModelOnly',
  COMPLETED: 'completed',
  FAILED: 'statusFailed',
  RUNNING: 'statusRunning',
  IN_PROGRESS: 'inProgress',
  PENDING: 'statusPending',
  QUEUED: 'queued',
  HIGH: 'severityHIGH',
  MEDIUM: 'severityMEDIUM',
  LOW: 'severityLOW',
  RESEARCHER_DESIGN_REQUIRED: 'statusResearcherDesignRequired',
  TARGETS_UNAVAILABLE: 'statusTargetsUnavailable',
  PLANNING_ESTIMATE: 'statusPlanningEstimate',
  UNESTIMATED: 'statusUnestimated',
  FULL_RANK_ORDER: 'statFullRankOrder',
  FIRST_RANK_COUNT: 'statFirstRankCount',
  MEAN_RANK: 'statMeanRank',
  ATTRIBUTE_BRAND_SELECTION_MATRIX: 'statAttributeBrandSelectionMatrix',
  FULL_DISTRIBUTION_BY_PRICE_POINT: 'statFullDistributionByPricePoint',
  TOP_TWO_BOX_BY_PRICE_POINT: 'statTopTwoBoxByPricePoint',
  QUESTION_COMPREHENSION_ISSUES: 'statQuestionComprehensionIssues',
  REVISION_THEMES: 'statRevisionThemes',
  GUIDE_PILOT_FEEDBACK: 'statGuidePilotFeedback',
  TOPIC_THEMATIC_SUMMARY: 'statTopicThematicSummary',
  TOPIC_COVERAGE: 'statTopicCoverage',
  REVISION_NEEDS: 'statRevisionNeeds',
  PARTICIPANT_DISPOSITIONS: 'reportingParticipantDispositions',
  EXCLUSIONS: 'reportingExclusions',
  BREAKOFF: 'reportingBreakoff',
  UNWEIGHTED_BASES: 'reportingUnweightedBases',
  WEIGHTED_BASES_IF_APPLICABLE: 'reportingWeightedBasesIfApplicable',
  TOP_TWO_BOX_WITH_BASES: 'reportingTopTwoBoxWithBases',
  OBSERVED_INCIDENCE: 'reportingObservedIncidence',
  FULL_RANK_ORDERS: 'reportingFullRankOrders',
  FIRST_RANK_COUNTS: 'reportingFirstRankCounts',
  MEAN_RANKS: 'reportingMeanRanks',
  BRAND_FAMILIARITY_BASES: 'reportingBrandFamiliarityBases',
  FULL_DISTRIBUTIONS_BY_PRICE_POINT: 'reportingFullDistributionsByPricePoint',
  TOP_TWO_BOX_BY_PRICE_POINT_WITH_BASES: 'reportingTopTwoBoxByPricePointWithBases',
  FORCED_CHOICE_LIMITATION: 'reportingForcedChoiceLimitation',
  PRESENTATION_ORDER_LIMITATION: 'reportingPresentationOrderLimitation',
  PRICE_EXPOSURE_ORDER: 'reportingPriceExposureOrder',
  PARTICIPANT_CHARACTERISTICS: 'reportingParticipantCharacteristics',
  RESPONSE_MAPPING_ISSUES: 'reportingResponseMappingIssues',
  ITERATION_HISTORY: 'reportingIterationHistory',
  TOPIC_THEMATIC_SUMMARIES: 'reportingTopicThematicSummaries',
  NEGATIVE_OR_DISCONFIRMING_CASES: 'reportingNegativeOrDisconfirmingCases',
  STOPPING_RULE: 'reportingStoppingRule',
  QUESTION_SEQUENCE_ISSUES: 'reportingQuestionSequenceIssues',
  SENSITIVE_TOPIC_HANDLING: 'reportingSensitiveTopicHandling',
  REVISION_LOG: 'reportingRevisionLog',
});
const localizedStatus = (value, t) => {
  if (!value) return t('statusNotRecorded');
  const token = String(value).trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
  return statusKeys[token] ? t(statusKeys[token]) : t('statusCode', { status: String(value) });
};
const recruitmentInstructionKeysBySet = Object.freeze({
  SURVEY_FIELDING: ['recruitmentInstructionReview', 'recruitmentInstructionEthics', 'recruitmentInstructionProviders', 'recruitmentInstructionSoftLaunch', 'recruitmentInstructionFreezeRules', 'recruitmentInstructionMonitor'],
  COGNITIVE_PRETEST: ['recruitmentInstructionCognitiveReview', 'recruitmentInstructionEthics', 'recruitmentInstructionCognitivePretestScope', 'recruitmentInstructionCognitivePretestRounds', 'recruitmentInstructionCognitivePretestDocument', 'recruitmentInstructionCognitiveSeparate'],
  QUALITATIVE_INTERVIEWS: ['recruitmentInstructionQualitativeReview', 'recruitmentInstructionEthics', 'recruitmentInstructionQualitativeSampling', 'recruitmentInstructionQualitativeGuide', 'recruitmentInstructionQualitativeStopping', 'recruitmentInstructionQualitativeSeparate'],
});
const enumToken = (value) => String(value || '').trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
const handoffBlockingIssueKeys = Object.freeze({
  UNSUPPORTED_HANDOFF_LOCALE_REQUIRES_HUMAN_TRANSLATION: 'handoffBlockerUnsupportedLocale',
  REPORT_INSTRUMENT_LOCALE_MISMATCH_REQUIRES_TRANSLATION_REVIEW: 'handoffBlockerLocaleMismatch',
  GENERAL_LIKERT_REQUIRES_SPECIALIZED_METHOD: 'handoffBlockerSpecializedMethodRequired',
  PRIMARY_ITEM_OUTPUT_LOCALE_SCRIPT_MISMATCH: 'handoffBlockerPrimaryScriptMismatch',
  METHOD_CONFIG_REQUIRED_FOR_HANDOFF: 'handoffBlockerMethodConfigRequired',
  METHOD_SPECIFIC_HANDOFF_TEMPLATE_MISSING: 'handoffBlockerTemplateMissing',
  RESPONDENT_FACING_USER_COPY_LOCALE_SCRIPT_MISMATCH: 'handoffBlockerRespondentCopyMismatch',
});
const localizedHandoffBlockingIssue = (value, t) => t(handoffBlockingIssueKeys[enumToken(value)] || 'handoffBlockerUnknown');
const localizedHandoffPrice = (price, locale) => {
  if (!price || !Number.isFinite(price.amount)) return null;
  try {
    return formatLocalizedCurrency(price.amount, price.currency, locale);
  } catch {
    return null;
  }
};
const respondentStimulusText = (stimulus) => {
  const text = String(stimulus?.text || '');
  if (!stimulus?.price) return text;
  const rawPriceLine = `${stimulus.price.amount} ${stimulus.price.currency} ${stimulus.price.unit}`.trim();
  return text.split(/\r?\n/).filter((line) => line.trim() !== rawPriceLine).join('\n');
};
const localizedCoverageShare = (value, locale) => {
  const numericValue = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(numericValue)) return null;
  const percentage = Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue;
  return formatPercentagePoints(percentage, locale);
};
const estimandStatisticKeys = Object.freeze({
  FULL_DISTRIBUTION: 'statusFullDistribution',
  TOP_TWO_BOX: 'statusTopTwoBox',
  FULL_RANK_ORDER: 'statFullRankOrder',
  FIRST_RANK_COUNT: 'statFirstRankCount',
  MEAN_RANK: 'statMeanRank',
  ATTRIBUTE_BRAND_SELECTION_MATRIX: 'statAttributeBrandSelectionMatrix',
  FULL_DISTRIBUTION_BY_PRICE_POINT: 'statFullDistributionByPricePoint',
  TOP_TWO_BOX_BY_PRICE_POINT: 'statTopTwoBoxByPricePoint',
  QUESTION_COMPREHENSION_ISSUES: 'statQuestionComprehensionIssues',
  REVISION_THEMES: 'statRevisionThemes',
  GUIDE_PILOT_FEEDBACK: 'statGuidePilotFeedback',
  TOPIC_THEMATIC_SUMMARY: 'statTopicThematicSummary',
  TOPIC_COVERAGE: 'statTopicCoverage',
  REVISION_NEEDS: 'statRevisionNeeds',
});
const analysisReportingKeys = Object.freeze({
  PARTICIPANT_DISPOSITIONS: 'reportingParticipantDispositions',
  EXCLUSIONS: 'reportingExclusions',
  BREAKOFF: 'reportingBreakoff',
  UNWEIGHTED_BASES: 'reportingUnweightedBases',
  WEIGHTED_BASES_IF_APPLICABLE: 'reportingWeightedBasesIfApplicable',
  FULL_DISTRIBUTIONS: 'reportingFullDistributions',
  TOP_TWO_BOX_WITH_BASES: 'reportingTopTwoBoxWithBases',
  OBSERVED_INCIDENCE: 'reportingObservedIncidence',
  FULL_RANK_ORDERS: 'reportingFullRankOrders',
  FIRST_RANK_COUNTS: 'reportingFirstRankCounts',
  MEAN_RANKS: 'reportingMeanRanks',
  ATTRIBUTE_BRAND_SELECTION_MATRIX: 'reportingAttributeBrandSelectionMatrix',
  BRAND_FAMILIARITY_BASES: 'reportingBrandFamiliarityBases',
  FULL_DISTRIBUTIONS_BY_PRICE_POINT: 'reportingFullDistributionsByPricePoint',
  TOP_TWO_BOX_BY_PRICE_POINT_WITH_BASES: 'reportingTopTwoBoxByPricePointWithBases',
  FORCED_CHOICE_LIMITATION: 'reportingForcedChoiceLimitation',
  PRESENTATION_ORDER_LIMITATION: 'reportingPresentationOrderLimitation',
  PRICE_EXPOSURE_ORDER: 'reportingPriceExposureOrder',
  PARTICIPANT_CHARACTERISTICS: 'reportingParticipantCharacteristics',
  QUESTION_COMPREHENSION_ISSUES: 'reportingQuestionComprehensionIssues',
  RESPONSE_MAPPING_ISSUES: 'reportingResponseMappingIssues',
  REVISION_THEMES: 'reportingRevisionThemes',
  ITERATION_HISTORY: 'reportingIterationHistory',
  TOPIC_THEMATIC_SUMMARIES: 'reportingTopicThematicSummaries',
  TOPIC_COVERAGE: 'reportingTopicCoverage',
  NEGATIVE_OR_DISCONFIRMING_CASES: 'reportingNegativeOrDisconfirmingCases',
  STOPPING_RULE: 'reportingStoppingRule',
  GUIDE_PILOT_FEEDBACK: 'reportingGuidePilotFeedback',
  QUESTION_SEQUENCE_ISSUES: 'reportingQuestionSequenceIssues',
  SENSITIVE_TOPIC_HANDLING: 'reportingSensitiveTopicHandling',
  REVISION_LOG: 'reportingRevisionLog',
});
const localizedHandoffEnum = (value, keys, t) => {
  const token = enumToken(value);
  return keys[token] ? t(keys[token]) : localizedStatus(value, t);
};
const sampleRecommendationKeys = Object.freeze({
  CONFIGURE_SUPPORTED_METHOD_BEFORE_SIZING: 'sampleRecommendationConfigureMethod',
  NOMINAL_FULL_SAMPLE_PROPORTION_REFERENCE_ONLY: 'sampleRecommendationNominalReference',
  NOMINAL_EXPECTATION_SURVEY_REFERENCE_ONLY: 'sampleRecommendationExpectationReference',
  FREEZE_RANK_OR_CHOICE_DESIGN_BEFORE_SIZING: 'sampleRecommendationRankDesign',
  FREEZE_BRAND_MATRIX_DESIGN_BEFORE_SIZING: 'sampleRecommendationBrandDesign',
  FREEZE_PRICE_EXPOSURE_DESIGN_BEFORE_SIZING: 'sampleRecommendationPriceDesign',
  PLAN_ITERATIVE_COGNITIVE_PRETEST_ROUNDS: 'sampleRecommendationCognitiveRounds',
  PLAN_PURPOSIVE_GUIDE_PILOT_AND_STOPPING_RULE: 'sampleRecommendationGuidePilot',
});
const lineageLabelKeys = Object.freeze({
  framing: 'frame',
  panel: 'simulate',
  review: 'review',
  adjudication: 'independentReview',
  'respondent-cell': 'modelCells',
  'independent-model-call': 'modelCells',
  'evidence-and-bias-critic': 'independentReview',
  'segment-perspective': 'syntheticSegmentExploration',
});
const localizedLineageLabel = (value, t) => {
  if (!value) return null;
  const token = String(value).trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  return lineageLabelKeys[token] ? t(lineageLabelKeys[token]) : t('statusCode', { status: String(value) });
};
const shortModel = (value, t) => {
  const model = String(value || '').trim();
  if (!model) return t('statusNotRecorded');
  if (model.toLowerCase() === 'not run') return t('notStarted');
  return model.split('/').at(-1);
};
const populationComponentKeys = Object.freeze({
  geographyCoverage: 'geographyCoverageComponent',
  marginalCoverage: 'marginalCoverageComponent',
  intersectionCoverage: 'intersectionCoverageComponent',
  sourceQuality: 'sourceQualityComponent',
  sourceRecency: 'sourceRecencyComponent',
  weightingQuality: 'weightingQualityComponent',
});
const safeLocalizedDate = (value, locale, t, includeTime = false) => formatDisplayDate(value, locale, t('statusNotRecorded'), includeTime);
const researchMethodLabel = (value, t) => {
  const metadata = researchMethodMetadata(value);
  return metadata ? t(metadata.titleKey) : localizedStatus(value, t);
};
const researchMethodDescription = (value, t) => {
  const metadata = researchMethodMetadata(value);
  return metadata ? t(metadata.descriptionKey) : t('methodSpecificModelOutput');
};
const researchMethodRequiredInputKeys = Object.freeze({
  GENERAL_LIKERT: ['question', 'audience'],
  CONCEPT_TEST: ['conceptStimulus', 'question', 'audience'],
  PURCHASE_INTENT: ['exactOffer', 'category', 'price', 'currency', 'priceUnit', 'purchaseChannel', 'purchaseHorizon', 'referenceAlternative'],
  MESSAGE_TEST: ['messageStimulus', 'intendedAction', 'question', 'audience'],
  CLAIMS_TEST: ['claimStimulus', 'claimStatus', 'question', 'audience'],
  UX_EXPECTATION_TEST: ['taskScenario', 'userGoal', 'experienceDescription', 'question', 'audience'],
  FEATURE_PRIORITIZATION: ['stableFeatureIds', 'decisionContext', 'selectionConstraint'],
  BRAND_POSITIONING: ['focalBrand', 'comparatorBrandRange', 'category', 'suppliedAttributeRange'],
  PRICE_SENSITIVITY: ['exactOffer', 'category', 'currency', 'priceUnit', 'purchaseChannel', 'purchaseHorizon', 'referenceAlternative', 'ascendingPricePointRange'],
  SURVEY_PRETEST: ['studyObjective', 'targetPopulation', 'surveyQuestionsStableReferences'],
  INTERVIEW_GUIDE: ['researchObjective', 'participantContext', 'stableTopicIds'],
});
const researchMethodHumanValidationKeys = Object.freeze({
  GENERAL_LIKERT: 'humanValidationGeneralLikert',
  CONCEPT_TEST: 'humanValidationConceptTest',
  PURCHASE_INTENT: 'humanValidationPurchaseIntent',
  MESSAGE_TEST: 'humanValidationMessageTest',
  CLAIMS_TEST: 'humanValidationClaimsTest',
  UX_EXPECTATION_TEST: 'humanValidationUxExpectation',
  FEATURE_PRIORITIZATION: 'humanValidationFeaturePrioritization',
  BRAND_POSITIONING: 'humanValidationBrandPositioning',
  PRICE_SENSITIVITY: 'humanValidationPriceSensitivity',
  SURVEY_PRETEST: 'humanValidationSurveyPretest',
  INTERVIEW_GUIDE: 'humanValidationInterviewGuide',
});
const localizedRequiredInputs = (design, locale, t) => {
  const keys = researchMethodRequiredInputKeys[design?.methodId] || [];
  return keys.length ? formatLocalizedList(keys.map((key) => t(key)), locale) : t('statusNotRecorded');
};
const localizedMarketLabel = (value, locale, t, countryCode = null) => {
  const market = markets.find((entry) => entry.value === value);
  const region = countryCode || market?.region;
  if (region) return new Intl.DisplayNames([locale], { type: 'region' }).of(region);
  return market?.id === 'GLOBAL' || value === 'Global' ? t('global') : value;
};
const knownLimitKeys = Object.freeze({
  'Web sources are untrusted retrieved text, not independent validation.': 'limitationWebSourcesUntrusted',
  'No externally acquired source evidence was used.': 'limitationNoExternalEvidence',
  'The simulated panel is not a human sample.': 'limitationSyntheticPanel',
  'This method result is model-generated and is not a human study.': 'limitationMethodResult',
  'No observed human responses are included.': 'limitationNoObservedHuman',
  'Segments and verbatims are model-generated hypotheses.': 'limitationSegmentsModelGenerated',
});
const localizedKnownLimit = (value, t) => knownLimitKeys[value] ? t(knownLimitKeys[value]) : value;
const localizedNormalization = (value, key, t) => {
  if (key) return t(key);
  if (value === 'Not applicable to this result kind.') return t('normalizationNotApplicable');
  if (value === 'Percentages are normalized to sum to 100.') return t('normalizationPercentSum');
  return value || t('statusNotRecorded');
};
const isRuntimeUntitledSource = (value) => ['Untitled source', 'User-provided evidence'].includes(value);
const localizedSourceFallback = (source, index, locale, t) => isRuntimeUntitledSource(source?.title || source?.sourceTitle)
  ? t('evidenceClaimSourceNumber', { count: formatLocalizedNumber(index + 1, locale) })
  : source?.title || source?.sourceTitle || source?.claim || source?.sourceUrl;
const formatPercentagePointDelta = (value, locale, t) => t('percentagePointsShort', {
  value: formatLocalizedNumber(value, locale, { maximumFractionDigits: 1 }),
});
const localizedLegacyEnsemble = (value, locale, t) => {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)\s+models?(?:\s*·\s*(.+))?$/i);
  if (!match) return value;
  const agreement = match[2]?.trim();
  const localizedAgreement = /^\d+(?:\.\d+)?%$/.test(agreement || '')
    ? formatPercentagePoints(Number.parseFloat(agreement), locale)
    : /^(?:high|medium|low)$/i.test(agreement || '')
      ? localizedStatus(agreement, t)
      : agreement;
  return `${t('modelCount', { count: formatLocalizedNumber(Number.parseFloat(match[1]), locale) })}${localizedAgreement ? ` · ${localizedAgreement}` : ''}`;
};
const purchaseResponseScale = [
  { key: 'definitelyWouldNot', tone: 'negative-strong' },
  { key: 'probablyWouldNot', tone: 'negative' },
  { key: 'mightOrMightNot', tone: 'neutral' },
  { key: 'probablyWould', tone: 'positive' },
  { key: 'definitelyWould', tone: 'positive-strong' },
];
const methodResponseScales = Object.freeze({
  PURCHASE_INTENT: purchaseResponseScale,
  PRICE_SENSITIVITY: purchaseResponseScale,
  MESSAGE_TEST: [
    { key: 'notAtAllCompelling', tone: 'negative-strong' },
    { key: 'slightlyCompelling', tone: 'negative' },
    { key: 'neitherCompelling', tone: 'neutral' },
    { key: 'compelling', tone: 'positive' },
    { key: 'veryCompelling', tone: 'positive-strong' },
  ],
  CLAIMS_TEST: [
    { key: 'notAtAllBelievable', tone: 'negative-strong' },
    { key: 'slightlyBelievable', tone: 'negative' },
    { key: 'neitherBelievable', tone: 'neutral' },
    { key: 'believable', tone: 'positive' },
    { key: 'veryBelievable', tone: 'positive-strong' },
  ],
  UX_EXPECTATION_TEST: [
    { key: 'veryDifficult', tone: 'negative-strong' },
    { key: 'difficult', tone: 'negative' },
    { key: 'neitherDifficultNorEasy', tone: 'neutral' },
    { key: 'easy', tone: 'positive' },
    { key: 'veryEasy', tone: 'positive-strong' },
  ],
});
const responseScaleFor = (design) => methodResponseScales[design?.methodId] || responseScale;
const topTwoLabelKeys = Object.freeze({
  PURCHASE_INTENT: 'probablyOrDefinitelyWould',
  PRICE_SENSITIVITY: 'probablyOrDefinitelyWould',
  MESSAGE_TEST: 'compellingOrVeryCompelling',
  CLAIMS_TEST: 'believableOrVeryBelievable',
  UX_EXPECTATION_TEST: 'easyOrVeryEasy',
});
const topTwoLabelKeyFor = (design) => topTwoLabelKeys[design?.methodId] || 'likelyOrVeryLikely';
const isValidFivePointDistribution = (value) => Array.isArray(value)
  && value.length === 5
  && value.every((item) => Number.isFinite(item) && item >= 0 && item <= 100)
  && Math.abs(value.reduce((sum, item) => sum + item, 0) - 100) <= 0.1;
const directionalDistributionFor = (result) => {
  if (result?.methodResult) {
    return result.methodResult.kind === 'DIRECTIONAL_DISTRIBUTION'
      && isValidFivePointDistribution(result.methodResult.distribution)
      ? result.methodResult.distribution
      : null;
  }
  return isValidFivePointDistribution(result?.distribution) ? result.distribution : null;
};
const hasDisplayText = (value) => typeof value === 'string' && value.trim().length > 0;
const isValidMethodResult = (methodResult) => {
  if (!methodResult || typeof methodResult !== 'object') return false;
  switch (methodResult.kind) {
    case 'DIRECTIONAL_DISTRIBUTION': return isValidFivePointDistribution(methodResult.distribution);
    case 'RANKED_ITEMS': return Array.isArray(methodResult.items) && methodResult.items.length > 0
      && methodResult.items.every((item) => item && hasDisplayText(item.id) && hasDisplayText(item.label) && Number.isInteger(item.rank) && item.rank >= 1);
    case 'ATTRIBUTE_MATRIX': return Array.isArray(methodResult.attributes) && methodResult.attributes.length > 0
      && Array.isArray(methodResult.brands) && methodResult.brands.length > 0
      && methodResult.attributes.every((item) => item && hasDisplayText(item.id) && hasDisplayText(item.label))
      && methodResult.brands.every((brand) => brand && hasDisplayText(brand.id) && hasDisplayText(brand.label) && Array.isArray(brand.associations));
    case 'PRICE_LADDER': return Array.isArray(methodResult.points) && methodResult.points.length > 0
      && methodResult.points.every((point) => point && hasDisplayText(point.id) && Number.isFinite(point.amount) && isValidFivePointDistribution(point.distribution));
    case 'INSTRUMENT_REVIEW': return Array.isArray(methodResult.issues)
      && Array.isArray(methodResult.coverageGaps) && Array.isArray(methodResult.suggestedCognitiveProbes);
    case 'INTERVIEW_GUIDE': return hasDisplayText(methodResult.opening) && hasDisplayText(methodResult.closing)
      && Array.isArray(methodResult.questions) && methodResult.questions.length > 0
      && methodResult.questions.every((question) => question && hasDisplayText(question.id) && hasDisplayText(question.prompt) && Array.isArray(question.probes));
    default: return false;
  }
};
const scaleLabel = (item, t) => item.key ? t(item.key) : item.label || t('statusNotRecorded');
const sourceEntriesFor = (result) => (result.evidence || []).filter((entry) => entry.sourceUrl);
const evidenceClaimKeysById = Object.freeze({
  'seed-distribution': 'finalLikertDistribution',
  'seed-segment': 'audienceSegmentDifferences',
  'seed-theme': 'responseScoreReasons',
  'model-method-result': 'methodSpecificModelOutput',
  'model-distribution': 'finalLikertDistribution',
  'model-segments': 'audienceSegmentDifferences',
  'model-verbatims': 'responseScoreReasons',
});
const sourceLabel = (source, index, locale, t) => {
  if (source.claimKey) return t(source.claimKey, {
    ...(source.claimVariables || {}),
    ...(Number.isFinite(source.claimVariables?.count) ? { count: formatLocalizedNumber(source.claimVariables.count, locale) } : {}),
  });
  if (isRuntimeUntitledSource(source.sourceTitle || source.claim)) return t('evidenceClaimSourceNumber', { count: formatLocalizedNumber(index + 1, locale) });
  if (source.sourceTitle || source.claim) return source.sourceTitle || source.claim;
  try {
    return new URL(source.sourceUrl).hostname;
  } catch {
    return source.sourceUrl;
  }
};

const htmlLanguageTag = (value) => {
  const tag = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : undefined;
};

function OutboundLink({ children, className, href, lang }) {
  const { t } = useI18n();
  return (
    <a className={className} href={href} lang={lang} rel="noreferrer" target="_blank">
      <bdi dir="auto">{children}</bdi>
      <ArrowSquareOut aria-hidden="true" size={14} />
      <span className="sr-only"> {t('opensInNewWindow')}</span>
    </a>
  );
}

const reviewCompletedFor = (result) => {
  if (result.credibility?.reviewCompleted !== undefined) return Boolean(result.credibility.reviewCompleted);
  const lineage = result.meta?.lineage || result.meta?.modelLineage || [];
  return lineage.some((item) => {
    const role = String(item.role || item.stage || '').toLowerCase();
    const status = String(item.status || '').toLowerCase();
    return (role.includes('review') || role.includes('adjudication')) && status === 'completed';
  });
};

function DistributionBar({ values = [], compact = false, scale = responseScale }) {
  const { locale, t } = useI18n();
  return (
    <div className={`distribution ${compact ? 'is-compact' : ''}`} role="img" aria-label={formatLocalizedList(values.map((value, i) => `${scaleLabel(scale[i] || {}, t)}: ${formatPercentagePoints(value, locale)}`), locale)}>
      {values.map((value, index) => (
        <div className={`distribution-segment ${scale[index]?.tone || 'neutral'}`} key={scale[index]?.key || index} style={{ width: `${value}%` }} title={`${scaleLabel(scale[index] || {}, t)}: ${formatPercentagePoints(value, locale)}`}>
          {!compact && value >= 7 ? <span>{formatPercentagePoints(value, locale)}</span> : null}
        </div>
      ))}
    </div>
  );
}

function ResearchDesignReadout({ design }) {
  const { locale, t } = useI18n();
  if (!design) return null;
  return (
    <section className="research-design-readout" aria-labelledby="research-design-title">
      <div><p className="section-kicker">{t('researchMethod')}</p><h3 id="research-design-title">{researchMethodLabel(design.methodId, t)}</h3></div>
      <dl>
        <div><dt>{t('primaryOutcome')}</dt><dd>{design.primaryOutcome ? `${formatPercentagePoints(design.primaryOutcome.value, locale)} · ${researchMethodLabel(design.methodId, t)}` : t('notAssessed')}</dd></div>
        <div><dt>{t('estimand')}</dt><dd>{researchMethodDescription(design.methodId, t)}</dd></div>
      </dl>
      <p><Info size={15} /> {t('methodDisclosure')}</p>
    </section>
  );
}

function HumanValidationNextStep({ onExploreSegments, onValidateWithPeople, runComplete }) {
  const { t } = useI18n();
  const actionLabel = runComplete ? t('validateWithPeople') : t('seeHumanValidationPlan');
  const boundary = runComplete ? t('humanResearchDraftBoundary') : t('humanValidationPlanAfterRun');

  return (
    <section className="next-steps result-validation-next-step" aria-labelledby="next-steps-title">
      <div className="next-steps-heading">
        <p className="section-kicker">{t('hypothesisNext')}</p>
        <h2 id="next-steps-title">{t('nextSteps')}</h2>
        {runComplete ? <p className="sr-only" id="human-validation-next-step-note">{boundary}</p> : <p className="human-draft-boundary" id="human-validation-next-step-note"><WarningCircle aria-hidden="true" size={18} /> {boundary}</p>}
      </div>
      <div className="next-step-actions">
        {onExploreSegments ? <button className="next-step-explore" onClick={onExploreSegments} type="button"><ChartLineUp size={18} /> {t('exploreModeledSegment')}</button> : null}
        <button aria-describedby="human-validation-next-step-note" className="next-step-validate" onClick={onValidateWithPeople} type="button"><UsersThree size={18} /> {actionLabel}</button>
      </div>
    </section>
  );
}

function ResultContractError() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="result-contract-error-title" className="method-result-contract-error" role="alert">
      <WarningCircle aria-hidden="true" size={20} />
      <div><h2 id="result-contract-error-title">{t('resultContractErrorTitle')}</h2><p>{t('resultContractErrorBody')}</p></div>
    </section>
  );
}

function DirectionalOverview({ onExploreSegments, onValidateWithPeople, result, runComplete }) {
  const { locale, t } = useI18n();
  const methodResult = result.methodResult?.kind === 'DIRECTIONAL_DISTRIBUTION' ? result.methodResult : null;
  const distribution = directionalDistributionFor(result);
  if (!distribution) return <ResultContractError />;
  const scale = responseScaleFor(result.researchDesign);
  const topTwoLabelKey = topTwoLabelKeyFor(result.researchDesign);
  const likely = distribution[3] + distribution[4];
  const unlikely = distribution[0] + distribution[1];
  const unsure = distribution[2];
  const humanFollowUp = result.adjudication?.humanFollowUp || result.methodology?.humanFollowUp;
  const positiveResponses = (result.responses || []).filter((response) => response.score >= 4);
  const drivers = (positiveResponses.length ? positiveResponses : result.responses || []).slice(0, 4);
  const changeFactors = [
    humanFollowUp || t('directional'),
    ...(result.methodology?.knownLimits || result.cautions || []).map((limit) => localizedKnownLimit(limit, t)),
  ].filter(Boolean).slice(0, 4);

  return (
    <div className="overview-view">
      <section className="topline-section" aria-labelledby="topline-title">
        <div className="topline-heading">
          <div>
            <p className="section-kicker" id="topline-title">{t('topLineFinding')}</p>
            <p className="headline-number"><strong>{formatPercentagePoints(likely, locale)}</strong> <span>{t(topTwoLabelKey)}</span></p>
          </div>
          <p className="synthetic-disclosure">{t('syntheticDisclosure')} <Info size={15} /></p>
        </div>

        <div className="chart-area">
          <div className="scale-labels" aria-hidden="true">
            {scale.map((response, index) => (
              <div key={response.key}><span>{scaleLabel(response, t)}</span><i className={response.tone}>{index + 1}</i></div>
            ))}
          </div>
          <DistributionBar scale={scale} values={distribution} />
          <div className="bracket-row" aria-hidden="true">
            <span className="negative-bracket">{formatPercentagePoints(unlikely, locale)} {t('unlikely')}</span>
            <span className="neutral-bracket">{formatPercentagePoints(unsure, locale)} {t('unsure')}</span>
            <span className="positive-bracket">{formatPercentagePoints(likely, locale)} {t(topTwoLabelKey)}</span>
          </div>
        </div>

        <div className="executive-read"><strong>{t('executiveInterpretation')}</strong><p><bdi dir="auto">{result.takeaway || methodResult?.summary}</bdi></p></div>
        <ResearchDesignReadout design={result.researchDesign} />
      </section>

      <section className="insight-section">
        <h2><ChartLineUp size={20} /> {t('appearsDrive')}</h2>
        <div className="insight-rows">
          {drivers.map((response, index) => (
            <article className="synthetic-rationale" key={`${response.profile}-${response.score}`}>
              <span className="insight-state positive-state"><Check size={13} weight="bold" /></span>
              <div>
                <span className="synthetic-rationale-label">{t('modelGeneratedPerspective')}</span>
                <strong><bdi dir="auto">{response.profile}</bdi></strong>
                <p><bdi dir="auto">{response.quote}</bdi></p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="insight-section change-section">
        <h2><WarningCircle size={20} /> {t('couldChange')}</h2>
        <div className="insight-rows">
          {changeFactors.map((factor, index) => (
            <article key={factor}>
              <span className="insight-state warning-state">−</span>
              <strong>{index === 0 ? t('humanValidation') : `${t('knownLimitation')} ${index}`}</strong>
              <p><bdi dir="auto">{factor}</bdi></p>
              <span className="inference-marker">{t('modelInference')}</span>
            </article>
          ))}
        </div>
      </section>

      <div className="hypothesis-callout">
        <Info size={20} />
        <p><strong>{t('hypothesis')}</strong><span>{t('hypothesisNext')}</span></p>
      </div>

      <HumanValidationNextStep onExploreSegments={onExploreSegments} onValidateWithPeople={onValidateWithPeople} runComplete={runComplete} />
    </div>
  );
}

function MethodResultHeader({ methodResult, researchDesign }) {
  const { t } = useI18n();
  return (
    <header className="method-result-header">
      <p className="section-kicker">{t('topLineFinding')}</p>
      <h2>{researchMethodLabel(researchDesign?.methodId, t)}</h2>
      <p><bdi dir="auto">{methodResult.summary}</bdi></p>
      <span><Info size={15} /> {t('methodDisclosure')}</span>
    </header>
  );
}

function RankedItemsResult({ methodResult, researchDesign }) {
  const { t } = useI18n();
  const items = [...(methodResult.items || [])].sort((left, right) => left.rank - right.rank);
  return (
    <div className="method-result-view method-result--ranked-items">
      <MethodResultHeader methodResult={methodResult} researchDesign={researchDesign} />
      <section aria-labelledby="ranked-items-title" className="method-result-section">
        <h3 id="ranked-items-title">{methodResult.rankingLabel || t('rankedItems')}</h3>
        <ol className="ranked-items-list">
          {items.map((item) => <li key={item.id}><span>{item.rank}</span><div><strong>{item.label}</strong>{item.rationale ? <p>{item.rationale}</p> : null}<small>{item.id}</small></div></li>)}
        </ol>
      </section>
      <ResearchDesignReadout design={researchDesign} />
    </div>
  );
}

function AttributeMatrixResult({ methodResult, researchDesign }) {
  const { t } = useI18n();
  return (
    <div className="method-result-view method-result--attribute-matrix">
      <MethodResultHeader methodResult={methodResult} researchDesign={researchDesign} />
      <section aria-labelledby="attribute-matrix-title" className="method-result-section">
        <h3 id="attribute-matrix-title">{methodResult.matrixLabel || t('attributeMatrix')}</h3>
        <div aria-labelledby="attribute-matrix-title" className="method-table-scroll" role="region" tabIndex="0">
          <table className="attribute-matrix-table">
            <caption className="sr-only">{methodResult.matrixLabel || t('attributeMatrix')}</caption>
            <thead><tr><th scope="col">{t('brand')}</th>{(methodResult.attributes || []).map((attribute) => <th key={attribute.id} scope="col">{attribute.label}</th>)}</tr></thead>
            <tbody>{(methodResult.brands || []).map((brand) => <tr key={brand.id}><th scope="row">{brand.label}</th>{(methodResult.attributes || []).map((attribute) => { const association = brand.associations?.find((item) => item.attributeId === attribute.id); const level = t(`association${association?.level || 'LOW'}`); return <td key={attribute.id}><span aria-label={t('associationLevelForAttribute', { level, attribute: attribute.label })} className={`association-level is-${String(association?.level || 'LOW').toLowerCase()}`}>{level}</span></td>; })}</tr>)}</tbody>
          </table>
        </div>
      </section>
      <ResearchDesignReadout design={researchDesign} />
    </div>
  );
}

function PriceLadderResult({ methodResult, researchDesign }) {
  const { locale, t } = useI18n();
  const scale = responseScaleFor({ methodId: 'PRICE_SENSITIVITY' });
  return (
    <div className="method-result-view method-result--price-ladder">
      <MethodResultHeader methodResult={methodResult} researchDesign={researchDesign} />
      <section aria-labelledby="price-ladder-title" className="method-result-section">
        <div className="method-section-heading"><h3 id="price-ladder-title">{t('priceLadder')}</h3><span>{methodResult.priceContext?.unit}</span></div>
        <div className="price-ladder-list">
          {(methodResult.points || []).map((point) => {
            const positive = (point.distribution?.[3] || 0) + (point.distribution?.[4] || 0);
            return <article key={point.id}><div><strong>{formatLocalizedCurrency(point.amount, methodResult.priceContext?.currency || 'USD', locale)}</strong><span>{formatPercentagePoints(positive, locale)} {t('positiveIntent')}</span></div><DistributionBar compact scale={scale} values={point.distribution} /><small>{point.label}</small></article>;
          })}
        </div>
        <div className="method-scale-key">{scale.map((item) => <span key={item.key}><i className={item.tone} />{scaleLabel(item, t)}</span>)}</div>
      </section>
      <ResearchDesignReadout design={researchDesign} />
    </div>
  );
}

function InstrumentReviewResult({ methodResult, researchDesign }) {
  const { t } = useI18n();
  return (
    <div className="method-result-view method-result--instrument-review">
      <MethodResultHeader methodResult={methodResult} researchDesign={researchDesign} />
      <section aria-labelledby="instrument-issues-title" className="method-result-section">
        <div className="method-section-heading"><h3 id="instrument-issues-title">{t('instrumentIssues')}</h3><span>{methodResult.issues?.length || 0}</span></div>
        {methodResult.issues?.length ? <ol className="instrument-issue-list">{methodResult.issues.map((issue) => <li key={issue.id}><div><span className={`severity is-${issue.severity.toLowerCase()}`}>{t(`severity${issue.severity}`)}</span><strong>{issue.category}</strong><small>{issue.questionId}</small></div><p>{issue.explanation}</p><blockquote><strong>{t('revisionSuggestion')}</strong>{issue.revisionSuggestion}</blockquote></li>)}</ol> : <p className="empty-method-result">{t('noInstrumentIssues')}</p>}
      </section>
      <div className="method-result-columns">
        <section><h3>{t('coverageGaps')}</h3>{methodResult.coverageGaps?.length ? <ul>{methodResult.coverageGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : <p>{t('noneRecorded')}</p>}</section>
        <section><h3>{t('cognitiveProbes')}</h3>{methodResult.suggestedCognitiveProbes?.length ? <ul>{methodResult.suggestedCognitiveProbes.map((probe) => <li key={probe}>{probe}</li>)}</ul> : <p>{t('noneRecorded')}</p>}</section>
      </div>
      <ResearchDesignReadout design={researchDesign} />
    </div>
  );
}

function InterviewGuideResult({ methodResult, researchDesign }) {
  const { t } = useI18n();
  return (
    <div className="method-result-view method-result--interview-guide">
      <MethodResultHeader methodResult={methodResult} researchDesign={researchDesign} />
      <section className="guide-bookend"><h3>{t('opening')}</h3><p>{methodResult.opening}</p></section>
      <section aria-labelledby="guide-questions-title" className="method-result-section"><h3 id="guide-questions-title">{t('guideQuestions')}</h3><ol className="guide-question-list">{(methodResult.questions || []).map((question, index) => <li key={question.id}><span>{index + 1}</span><div><small>{question.topicId}</small><p>{question.prompt}</p>{question.probes?.length ? <details><summary>{t('probes')} · {question.probes.length}</summary><ul>{question.probes.map((probe) => <li key={probe}>{probe}</li>)}</ul></details> : null}</div></li>)}</ol></section>
      <div className="method-result-columns">
        <section><h3>{t('moderatorNotes')}</h3><ul>{(methodResult.moderatorNotes || []).map((note) => <li key={note}>{note}</li>)}</ul></section>
        <section><h3>{t('consentAccessibility')}</h3><ul>{(methodResult.consentAndAccessibilityNotes || []).map((note) => <li key={note}>{note}</li>)}</ul></section>
      </div>
      <section className="guide-bookend"><h3>{t('closing')}</h3><p>{methodResult.closing}</p></section>
      <ResearchDesignReadout design={researchDesign} />
    </div>
  );
}

function MethodResultOverview({ onExploreSegments, onValidateWithPeople, result, runComplete }) {
  const methodResult = result.methodResult;
  if (methodResult && !isValidMethodResult(methodResult)) return <ResultContractError />;
  const kind = methodResult?.kind || (directionalDistributionFor(result) ? 'DIRECTIONAL_DISTRIBUTION' : null);

  let resultView;
  switch (kind) {
    case 'DIRECTIONAL_DISTRIBUTION': return <DirectionalOverview onExploreSegments={onExploreSegments} onValidateWithPeople={onValidateWithPeople} result={result} runComplete={runComplete} />;
    case 'RANKED_ITEMS': resultView = <RankedItemsResult methodResult={methodResult} researchDesign={result.researchDesign} />; break;
    case 'ATTRIBUTE_MATRIX': resultView = <AttributeMatrixResult methodResult={methodResult} researchDesign={result.researchDesign} />; break;
    case 'PRICE_LADDER': resultView = <PriceLadderResult methodResult={methodResult} researchDesign={result.researchDesign} />; break;
    case 'INSTRUMENT_REVIEW': resultView = <InstrumentReviewResult methodResult={methodResult} researchDesign={result.researchDesign} />; break;
    case 'INTERVIEW_GUIDE': resultView = <InterviewGuideResult methodResult={methodResult} researchDesign={result.researchDesign} />; break;
    default: return <ResultContractError />;
  }

  return <>{resultView}{runComplete ? <HumanValidationNextStep onValidateWithPeople={onValidateWithPeople} runComplete /> : null}</>;
}

function QualitativeProjectControls({ projectState, onClearProject, onExportProject, onImportProject }) {
  const { locale, t } = useI18n();
  const importRef = useRef(null);
  const status = projectState?.status || 'idle';
  const ready = status === 'ready';
  const unsupported = status === 'unsupported';
  const stats = projectState?.stats || { conversationCount: 0, interviewTurnPairs: 0, materialCount: 0 };

  return (
    <section className="qualitative-project-panel" aria-label={t('localProjectTitle')}>
      <div className="qualitative-project-heading">
        <div>
          <p className="section-kicker">{t('localProject')}</p>
          <h3>{t('localProjectTitle')}</h3>
        </div>
        <span>{ready ? t('localProjectReady', { turns: formatLocalizedNumber(stats.interviewTurnPairs, locale), conversations: formatLocalizedNumber(stats.conversationCount, locale) }) : t('localProjectPending')}</span>
      </div>
      <p className="qualitative-project-note">{unsupported ? t('localProjectUnsupported') : t('localProjectNote')}</p>
      <p className="qualitative-project-disclosure"><Info size={15} /> {t('localProjectDisclosure')}</p>
      <dl className="qualitative-project-stats">
        <div><dt>{t('savedConversations')}</dt><dd>{formatLocalizedNumber(stats.conversationCount, locale)}</dd></div>
        <div><dt>{t('savedTurnPairs')}</dt><dd>{formatLocalizedNumber(stats.interviewTurnPairs, locale)}</dd></div>
        <div><dt>{t('savedMaterials')}</dt><dd>{formatLocalizedNumber(stats.materialCount, locale)}</dd></div>
      </dl>
      <div className="qualitative-project-actions">
        <button disabled={!ready} onClick={onExportProject} type="button">{t('exportLocalProject')}</button>
        <button disabled={unsupported} onClick={() => importRef.current?.click()} type="button">{t('importLocalProject')}</button>
        <button disabled={!ready} onClick={onClearProject} type="button">{t('clearLocalProject')}</button>
        <input
          accept="application/json"
          hidden
          onChange={(event) => {
            const [file] = event.target.files || [];
            if (file) onImportProject(file);
            event.target.value = '';
          }}
          ref={importRef}
          type="file"
        />
      </div>
      {projectState?.error ? <p className="perspective-error" role="alert">{projectState.error}</p> : null}
    </section>
  );
}

function Segments({ baseStimulus, canExplore, conversations, onAskSegmentPerspective, onClearProject, onExportProject, onImportProject, projectState, researchDesign, segments, selectedSegmentId, setConversations, setSelectedSegmentId }) {
  const { locale, t } = useI18n();
  const scale = responseScaleFor(researchDesign);
  const topTwoLabelKey = topTwoLabelKeyFor(researchDesign);
  const questionRef = useRef(null);
  const selectedSegment = (segments || []).find((segment) => segment.id === selectedSegmentId) || null;
  const defaultConversation = {
    conversationId: null,
    turns: [],
    draft: '',
    intent: 'FOLLOW_UP',
    sending: false,
    error: '',
    comparisonA: baseStimulus || '',
    comparisonB: '',
    changedCondition: '',
    fixedConditions: t('defaultFixedConditions'),
  };
  const conversation = selectedSegment ? { ...defaultConversation, ...(conversations[selectedSegment.id] || {}) } : null;

  useEffect(() => {
    if (selectedSegmentId) questionRef.current?.focus();
  }, [selectedSegmentId]);

  if (!(segments || []).every((segment) => segment && isValidFivePointDistribution(segment.values))) return <ResultContractError />;

  const updateConversation = (updates) => {
    if (!selectedSegment) return;
    setConversations((previous) => ({
      ...previous,
      [selectedSegment.id]: { ...conversation, ...updates },
    }));
  };

  const selectSegment = (segment) => {
    setSelectedSegmentId(segment.id);
    setConversations((previous) => previous[segment.id] ? previous : {
      ...previous,
      [segment.id]: {
        ...defaultConversation,
      },
    });
  };

  const chooseIntent = (intent) => {
    const starters = {
      OBJECTION: t('objectionStarter'),
      COUNTERFACTUAL: t('counterfactualStarter'),
      CONCEPT_COMPARISON: t('comparisonStarter'),
    };
    updateConversation({ intent, draft: starters[intent] || '', error: '' });
    window.requestAnimationFrame(() => questionRef.current?.focus());
  };

  const readyToSend = Boolean(conversation?.draft.trim())
    && !conversation?.sending
    && (conversation?.intent !== 'COUNTERFACTUAL' || Boolean(conversation.changedCondition.trim() && conversation.fixedConditions.trim()))
    && (conversation?.intent !== 'CONCEPT_COMPARISON' || Boolean(conversation.comparisonA.trim().length >= 10 && conversation.comparisonB.trim().length >= 10));

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedSegment || !readyToSend) return;
    const history = conversation.turns.flatMap((turn) => [
      { role: 'user', text: turn.question, intent: turn.intent },
      { role: 'assistant', turnId: turn.response.turnId, text: turn.response.answer, evidenceRefs: turn.response.evidenceUsed.map((item) => item.id), assumptionRefs: turn.response.assumptionsUsed.map((item) => item.id) },
    ]);
    updateConversation({ sending: true, error: '' });
    try {
      const response = await onAskSegmentPerspective({
        segment: selectedSegment,
        question: conversation.draft.trim(),
        intent: conversation.intent,
        history,
        conversationId: conversation.conversationId,
        expectedTurnIndex: conversation.turns.length,
        parentTurnId: conversation.turns.at(-1)?.response.turnId || null,
        stimuli: conversation.intent === 'CONCEPT_COMPARISON' ? [
          { id: 'comparison-a', text: conversation.comparisonA.trim() },
          { id: 'comparison-b', text: conversation.comparisonB.trim() },
        ] : [],
        counterfactual: conversation.intent === 'COUNTERFACTUAL' ? {
          changedVariables: [conversation.changedCondition.trim()],
          fixedConditions: [conversation.fixedConditions.trim()],
        } : undefined,
      });
      setConversations((previous) => ({
        ...previous,
        [selectedSegment.id]: {
          ...conversation,
          conversationId: response.conversationId,
          turns: [...conversation.turns, { question: conversation.draft.trim(), intent: conversation.intent, response }],
          draft: '',
          sending: false,
          error: '',
        },
      }));
    } catch (error) {
      updateConversation({
        sending: false,
        error: `${t('perspectiveError')} ${t('statusCode', { status: thrownErrorCode(error, 'SEGMENT_PERSPECTIVE_ERROR') })}`,
      });
    }
  };

  return (
    <div className="secondary-view">
      <div className="view-intro"><div><p className="section-kicker">{t('segments')}</p><h2 id="segments-title" tabIndex="-1">{t('segmentsTitle')}</h2></div><p>{t('segmentsNote')}</p></div>
      <div className="segment-table">
        <div className="segment-header"><span>{t('segmentLabel')}</span><span>{t('directionalDistribution')}</span><span>{t(topTwoLabelKey)}</span></div>
        {(segments || []).map((segment) => {
          const likely = segment.values[3] + segment.values[4];
          const likelyLabel = formatPercentagePoints(likely, locale);
          return <div className="segment-row" key={segment.id || segment.label}><div><strong><bdi dir="auto">{segment.label}</bdi></strong><small>{t('modelConstructedSegment')}</small>{canExplore && segment.id ? <button aria-label={`${t('exploreModeledSegment')}: ${segment.label}`} className="segment-explore-button" onClick={() => selectSegment(segment)} type="button">{t('exploreSegment')}</button> : null}</div><DistributionBar compact scale={scale} values={segment.values} /><strong aria-label={`${likelyLabel} ${t(topTwoLabelKey)}`} className="segment-score">{likelyLabel} <span className="segment-score-label">{t(topTwoLabelKey)}</span></strong></div>;
        })}
      </div>
      {canExplore ? <QualitativeProjectControls onClearProject={onClearProject} onExportProject={onExportProject} onImportProject={onImportProject} projectState={projectState} /> : null}
      {selectedSegment && conversation ? <section className="segment-perspective" aria-labelledby="segment-perspective-title">
        <div className="segment-perspective-heading"><div><p className="section-kicker">{t('syntheticSegmentExploration')}</p><h3 id="segment-perspective-title">{t('followUpSegment')}</h3></div><span><bdi dir="auto">{selectedSegment.label}</bdi></span></div>
        <p className="segment-boundary">{t('modeledSegmentNote')}</p>
        {conversation.turns.length ? <ol className="perspective-transcript">{conversation.turns.map((turn) => <li key={turn.response.turnId}>
          <div className="perspective-question"><strong>{t('yourQuestion')}</strong><p><bdi dir="auto">{turn.question}</bdi></p></div>
          <article className="perspective-answer">
            <span className="synthetic-rationale-label">{t('modelGeneratedPerspective')}</span>
            <p><bdi dir="auto">{turn.response.answer}</bdi></p>
            <small><bdi dir="auto">{turn.response.basisSummary}</bdi></small>
            <details>
              <summary>{t('evidenceAndAssumptions')}</summary>
              <div className="perspective-basis">
                <div><strong>{t('sources')}</strong>{turn.response.evidenceUsed.length ? <ul>{turn.response.evidenceUsed.map((source, index) => <li key={source.id}>{source.url ? <OutboundLink href={source.url} lang={source.title ? htmlLanguageTag(source.originalLanguage) : undefined}>{localizedSourceFallback(source, index, locale, t)}</OutboundLink> : <span><bdi dir="auto" lang={source.title ? htmlLanguageTag(source.originalLanguage) : undefined}>{localizedSourceFallback(source, index, locale, t)}</bdi></span>}<small><bdi dir="auto" lang={htmlLanguageTag(source.originalLanguage)}>{source.excerpt}</bdi></small></li>)}</ul> : <p>{t('noPerspectiveEvidence')}</p>}</div>
                <div><strong>{t('assumptionsUsed')}</strong>{turn.response.assumptionsUsed.length ? <ul>{turn.response.assumptionsUsed.map((assumption) => <li key={assumption.id}><bdi dir="auto">{assumption.text}</bdi></li>)}</ul> : <p>{t('noAssumptionsRecorded')}</p>}</div>
                <dl><div><dt>{t('evidenceHash')}</dt><dd className="hash-value">{turn.response.context.evidenceHash || t('noEvidenceHash')}</dd></div><div><dt>{t('populationFrameHash')}</dt><dd className="hash-value">{turn.response.context.populationFrameHash || t('statusNotRecorded')}</dd></div></dl>
                <p>{t('clientSuppliedContextNote')}</p>
              </div>
            </details>
          </article>
        </li>)}</ol> : null}
        <p aria-live="polite" className="sr-only">{conversation.sending ? t('generatingPerspective') : conversation.turns.length ? t('perspectiveReady') : ''}</p>
        <form aria-busy={conversation.sending} className="segment-perspective-form" onSubmit={submit}>
          <div className="perspective-starters" aria-label={t('perspectiveModes')}>
            <button onClick={() => chooseIntent('OBJECTION')} type="button">{t('testObjection')}</button>
            <button onClick={() => chooseIntent('COUNTERFACTUAL')} type="button">{t('exploreCounterfactual')}</button>
            <button onClick={() => chooseIntent('CONCEPT_COMPARISON')} type="button">{t('compareConcepts')}</button>
          </div>
          {conversation.intent === 'COUNTERFACTUAL' ? <div className="perspective-conditions"><label>{t('changedCondition')}<input disabled={conversation.sending} onChange={(event) => updateConversation({ changedCondition: event.target.value })} value={conversation.changedCondition} /></label><label>{t('fixedConditions')}<input disabled={conversation.sending} onChange={(event) => updateConversation({ fixedConditions: event.target.value })} value={conversation.fixedConditions} /></label></div> : null}
          {conversation.intent === 'CONCEPT_COMPARISON' ? <div className="perspective-conditions"><label>{t('conceptA')}<textarea disabled={conversation.sending} onChange={(event) => updateConversation({ comparisonA: event.target.value })} rows="3" value={conversation.comparisonA} /></label><label>{t('conceptB')}<textarea disabled={conversation.sending} onChange={(event) => updateConversation({ comparisonB: event.target.value })} rows="3" value={conversation.comparisonB} /></label></div> : null}
          <label className="perspective-question-field">{t('askFollowUp')}<textarea disabled={conversation.sending} maxLength="600" onChange={(event) => updateConversation({ draft: event.target.value })} placeholder={t('followUpPlaceholder')} ref={questionRef} rows="4" value={conversation.draft} /></label>
          {conversation.error ? <p className="perspective-error" role="alert">{conversation.error}</p> : null}
          <button className="perspective-submit" disabled={!readyToSend} type="submit">{conversation.sending ? t('generatingPerspective') : conversation.error ? t('retry') : t('sendQuestion')}</button>
        </form>
      </section> : null}
    </div>
  );
}

function Verbatims({ responses }) {
  const { t } = useI18n();
  return (
    <div className="secondary-view">
      <div className="view-intro"><div><p className="section-kicker">{t('syntheticVerbatims')}</p><h2>{t('possibleReasoning')}</h2></div><p>{t('verbatimNote')}</p></div>
      <div className="response-list">
        {responses.map((response) => (
          <article className="synthetic-rationale synthetic-verbatim" key={`${response.profile}-${response.score}`}><span className={`response-score ${responseScale[response.score - 1].tone}`}>{response.score}</span><div><span className="synthetic-rationale-label">{t('modelGeneratedPerspective')}</span><p><bdi dir="auto">{response.quote}</bdi></p><small><bdi dir="auto">{response.profile}</bdi> · {t('modelInference')}</small></div></article>
        ))}
      </div>
    </div>
  );
}

function Evidence({ entries, evidenceMeta }) {
  const { locale, t } = useI18n();
  const evidenceClassLabels = {
    'model inference': t('modelInference'),
    'user assumption': t('assumptions'),
    'provided source': t('sources'),
    'retrieved source': t('sources'),
    'provided research material': t('providedResearchMaterial'),
    'synthetic verbatim theme': t('syntheticVerbatims'),
  };
  const localizedClaim = (entry) => {
    const claimKey = entry.claimKey || evidenceClaimKeysById[entry.id];
    return claimKey
      ? t(claimKey, {
        ...(entry.claimVariables || {}),
        ...(Number.isFinite(entry.claimVariables?.count) ? { count: formatLocalizedNumber(entry.claimVariables.count, locale) } : {}),
      })
      : (entry.sourceUrl || entry.sourceKind
        ? entry.claim
        : ['zh-CN', 'ja-JP', 'ko-KR'].includes(locale) ? t('statusNotRecorded') : entry.claim);
  };
  const localizedTrace = (entry) => {
    if (entry.traceKey) return t(entry.traceKey);
    const id = String(entry.id || '').toLowerCase();
    const evidenceClass = String(entry.evidenceClass || '').toLowerCase().replaceAll('_', ' ');
    if (entry.sourceKind || evidenceClass.includes('provided research material')) return t('uploadedMaterialTrace');
    if (entry.sourceUrl || id.startsWith('source-')) return t('sourceTrace');
    if (evidenceClass.includes('assumption') || id.startsWith('assumption-')) return t('assumptionTrace');
    if (evidenceClass.includes('verbatim') || id.includes('theme') || id.includes('verbatim')) return t('verbatimTrace');
    if (id.includes('segment')) return t('segmentTrace');
    return t('distributionTrace');
  };
  const localizedRisk = (entry) => {
    if (entry.riskKey) return t(entry.riskKey);
    const id = String(entry.id || '').toLowerCase();
    const evidenceClass = String(entry.evidenceClass || '').toLowerCase().replaceAll('_', ' ');
    if (entry.sourceKind || evidenceClass.includes('provided research material')) return t('uploadedMaterialRisk');
    if (entry.sourceUrl || id.startsWith('source-')) return t('groundingRisk');
    if (evidenceClass.includes('assumption') || id.startsWith('assumption-')) return t('requiresValidation');
    if (evidenceClass.includes('verbatim') || id.includes('theme') || id.includes('verbatim')) return t('notInterviewNote');
    if (id.includes('segment')) return t('segmentNotSampled');
    return t('notRepresentative');
  };
  return (
    <div className="secondary-view evidence-view">
      <div className="view-intro"><div><p className="section-kicker">{t('evidenceLedger')}</p><h2>{t('traceClaimBasis')}</h2></div><p>{evidenceMeta?.mode === 'PRIOR_ONLY' ? t('noSourcesNote') : t('evidenceLedgerNote')}</p></div>
      <div className="evidence-table">
        <div className="evidence-header"><span>{t('claimOrSource')}</span><span>{t('evidenceClassLabel')}</span><span>{t('traceLabel')}</span><span>{t('riskLabel')}</span></div>
        {entries.map((entry, index) => (
          <div className="evidence-row" key={entry.id || `${entry.claim}-${index}`}>
            <div>
              {entry.sourceUrl ? <OutboundLink href={entry.sourceUrl} lang={htmlLanguageTag(entry.originalLanguage)}>{localizedClaim(entry) || entry.sourceTitle || entry.sourceUrl}</OutboundLink> : <strong><bdi dir="auto" lang={htmlLanguageTag(entry.originalLanguage)}>{localizedClaim(entry)}</bdi></strong>}
              {entry.excerpt ? <small><bdi dir="auto" lang={htmlLanguageTag(entry.originalLanguage)}>{entry.excerpt}</bdi></small> : null}
              {entry.originalLanguage ? <small className="source-language">{t('sourceLanguageLabel')} · {getLanguageName(entry.originalLanguage, locale)}</small> : null}
            </div>
            <span className={`evidence-class ${formatEvidenceClass(entry.evidenceClass).replaceAll(' ', '-').toLowerCase()}`}>{evidenceClassLabels[String(entry.evidenceClass || '').toLowerCase().replaceAll('_', ' ')] || localizedStatus(entry.evidenceClass, t)}</span>
            <span>{localizedTrace(entry)}</span><span>{localizedRisk(entry)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PopulationFrame({ frame }) {
  const { locale, t } = useI18n();
  if (!frame) {
    return <div className="secondary-view"><div className="view-intro"><div><p className="section-kicker">{t('population')}</p><h2>{t('populationFrame')}</h2></div><p>{t('populationFrameMissing')}</p></div></div>;
  }
  const fit = frame.populationFit || {};
  const localizedFitStatus = localizedStatus(fit.status, t);
  const fitLabel = Number.isFinite(fit.overall) ? `${formatLocalizedNumber(fit.overall, locale)}/${formatLocalizedNumber(100, locale)} · ${localizedFitStatus}` : localizedFitStatus;
  const sourceLanguages = frame.languages?.sourceLanguages?.length ? formatLocalizedList(frame.languages.sourceLanguages.map((language) => getLanguageName(language, locale)), locale) : t('notSupplied');
  return (
    <div className="secondary-view population-view">
      <div className="view-intro"><div><p className="section-kicker">{t('population')}</p><h2>{t('populationFrame')}</h2></div><p>{t('populationFrameNote')}</p></div>
      <section className="population-summary" aria-labelledby="population-intended-title">
        <h3 id="population-intended-title">{t('intendedPopulation')}</h3>
        <p><bdi dir="auto">{frame.intendedPopulation}</bdi></p>
        <dl>
          <div><dt>{t('geography')}</dt><dd>{frame.geography?.market ? localizedMarketLabel(frame.geography.market, locale, t, frame.geography.countryCode) : t('notSupplied')}{frame.geography?.countryCode ? ` · ${frame.geography.countryCode}` : ''}</dd></div>
          <div><dt>{t('reportLanguage')}</dt><dd>{frame.languages?.outputLocale ? getLanguageName(frame.languages.outputLocale, locale) : t('notSupplied')}</dd></div>
          <div><dt>{t('sourceLanguageLabel')}</dt><dd>{sourceLanguages}</dd></div>
          <div><dt>{t('coverageDate')}</dt><dd>{safeLocalizedDate(frame.coverageDate, locale, t)}</dd></div>
          <div><dt>{t('weightingMethod')}</dt><dd>{localizedStatus(frame.weighting?.method, t)} · {localizedStatus(frame.weighting?.status, t)}</dd></div>
          <div><dt>{t('populationFit')}</dt><dd>{fitLabel}</dd></div>
        </dl>
      </section>

      <section className="population-section">
        <h3>{t('officialDatasets')}</h3>
        {frame.officialSourceDatasets?.length ? <ul className="population-source-list">{frame.officialSourceDatasets.map((source) => <li key={source.id}><OutboundLink href={source.url}>{source.title}</OutboundLink><span><bdi dir="auto">{source.publisher} · {safeLocalizedDate(source.coverageDate, locale, t)} · {localizedStatus(source.verificationStatus, t)}</bdi></span></li>)}</ul> : <p>{t('noOfficialDatasets')}</p>}
      </section>

      <section className="population-section">
        <h3>{t('marginalDistributions')}</h3>
        {frame.marginalDistributions?.length ? <div className="population-margins">{frame.marginalDistributions.map((marginal) => <div key={marginal.variable}><strong><bdi dir="auto">{marginal.label}</bdi></strong><span><bdi dir="auto">{formatLocalizedList(marginal.categories.map((category) => `${category.value} ${formatPercentagePoints(category.share * 100, locale)}`), locale)}</bdi></span></div>)}</div> : <p>{t('noMarginals')}</p>}
      </section>

      <section className="population-section">
        <h3>{t('knownIntersections')}</h3>
        <p>{frame.knownIntersections?.length ? `${formatLocalizedNumber(frame.knownIntersections.length, locale)} ${t(localizedPluralCategory(frame.knownIntersections.length, locale) === 'one' ? 'intersectionRecordOne' : 'intersectionRecords')}` : t('noIntersections')}</p>
      </section>

      <section className="population-fit-components">
        <h3>{t('fitComponents')}</h3>
        <dl>{Object.entries(fit.components || {}).map(([key, value]) => <div key={key}><dt>{populationComponentKeys[key] ? t(populationComponentKeys[key]) : t('statusCode', { status: key })}</dt><dd>{Number.isFinite(value) ? `${formatLocalizedNumber(value, locale)}/${formatLocalizedNumber(100, locale)}` : t('notMeasured')}</dd></div>)}</dl>
        <p>{t('populationFitFormula')}</p>
      </section>

      <section className="known-limits"><strong>{t('unsupportedCharacteristics')}</strong><ul>{(frame.unsupportedCharacteristics?.length ? frame.unsupportedCharacteristics : [t('noneRecorded')]).map((item) => <li key={item}><bdi dir="auto">{item === 'Demographic and firmographic characteristics were not supplied as structured population data.' ? t('unsupportedStructuredPopulation') : item}</bdi></li>)}</ul></section>
      <p className="population-disclaimer" role="note"><WarningCircle size={18} /> {t('populationFrameDisclaimer')}</p>
    </div>
  );
}

function ModelCard({ result }) {
  const { t } = useI18n();
  const card = result.modelCard || result.meta?.modelCard;
  if (!card) return <section className="model-card"><h3>{t('modelCard')}</h3><p>{t('modelCardMissing')}</p></section>;
  const methodSpecific = card.resultKind && card.resultKind !== 'DIRECTIONAL_DISTRIBUTION';
  const prohibitedUseKeys = {
    'Population estimation': 'prohibitedPopulationEstimation',
    'Claims of observed attitudes': 'prohibitedObservedAttitudes',
    'Synthetic confidence intervals': 'prohibitedSyntheticConfidenceIntervals',
    'Substitution for consequential human research': 'prohibitedConsequentialSubstitution',
  };
  return (
    <section className="model-card">
      <h3>{t('modelCard')}</h3>
      <dl>
        <div><dt>{t('cardVersion')}</dt><dd>{card.cardVersion || t('statusNotRecorded')}</dd></div>
        <div><dt>{t('purpose')}</dt><dd>{t(methodSpecific ? 'modelCardPurposeMethod' : 'modelCardPurposeDirectional')}</dd></div>
        <div><dt>{t('permittedUse')}</dt><dd>{t(methodSpecific ? 'modelCardPermittedMethod' : 'modelCardPermittedDirectional')}</dd></div>
        <div><dt>{t('populationGrounding')}</dt><dd>{localizedStatus(card.populationGrounding, t)}</dd></div>
        <div><dt>{t('attitudinalValidation')}</dt><dd>{localizedStatus(card.attitudinalValidation, t)}</dd></div>
        <div><dt>{t('populationFrameHash')}</dt><dd className="hash-value">{card.populationFrameHash || t('statusNotRecorded')}</dd></div>
      </dl>
      {card.prohibitedUses?.length ? <div className="known-limits"><strong>{t('prohibitedUses')}</strong><ul>{card.prohibitedUses.map((item) => <li key={item}>{prohibitedUseKeys[item] ? t(prohibitedUseKeys[item]) : <bdi dir="auto">{item}</bdi>}</li>)}</ul></div> : null}
      <p className="population-disclaimer" role="note">{t('modelCardDisclosure')}</p>
    </section>
  );
}

function ResearchDesign({ design, handoffAvailable = false, handoffOpen = false, onToggleHandoff }) {
  const { locale, t } = useI18n();
  if (!design) return <section className="research-design"><h3 id="research-design-method-title" tabIndex="-1">{t('researchDesign')}</h3><p>{t('researchDesignMissing')}</p></section>;
  return (
    <section className="research-design" aria-labelledby="research-design-method-title">
      <h3 id="research-design-method-title" tabIndex="-1">{t('researchDesign')} · {researchMethodLabel(design.methodId, t)}</h3>
      <dl>
        <div><dt>{t('templateVersion')}</dt><dd>{design.templateVersion} · {design.methodVersion}</dd></div>
        <div><dt>{t('estimand')}</dt><dd>{researchMethodDescription(design.methodId, t)}</dd></div>
        <div><dt>{t('chartPlan')}</dt><dd><bdi dir="auto">{design.chartId || t('statusNotRecorded')}</bdi></dd></div>
        <div><dt>{t('requiredInputs')}</dt><dd>{localizedRequiredInputs(design, locale, t)}</dd></div>
      </dl>
      <div className="research-design-columns">
        <div><strong>{t('includedQuestions')}</strong><ul>{(design.instrument?.includedQuestions || []).map((item) => <li key={item.id}><b>{item.id}</b> · {t('methodQuestionPurpose', { method: researchMethodLabel(design.methodId, t) })}</li>)}</ul></div>
        <div><strong>{t('criticCriteria')}</strong><p>{t('methodCriticSummary')}</p></div>
      </div>
      <div className="research-validation" role="note"><strong>{t('humanValidationRequired')}</strong><p>{researchMethodHumanValidationKeys[design.methodId] ? t(researchMethodHumanValidationKeys[design.methodId]) : t('methodHumanValidationSummary', { method: researchMethodLabel(design.methodId, t) })}</p><span>{t('methodHumanValidationRationale')}</span><ul><li>{t('methodHumanValidationChecks')}</li></ul>{handoffAvailable ? <button aria-controls="human-research-handoff" aria-expanded={handoffOpen} className="human-validation-button" onClick={onToggleHandoff} type="button"><UsersThree size={16} /> {t('validateWithPeople')}</button> : null}</div>
      <p className="population-disclaimer"><Info size={17} /> {t('methodDisclosure')}</p>
    </section>
  );
}

function HumanResearchQuestionItems({ language, priceContext, question }) {
  const { locale, t } = useI18n();
  const items = Array.isArray(question.items) ? question.items : [];
  if (!items.length) return null;

  const itemListLabel = question.type === 'RANK_ORDER'
    ? t('rankOrderItems')
    : question.type === 'MATRIX_SINGLE_SELECT'
      ? t('matrixRows')
      : t('questionItems');
  const ItemList = question.type === 'RANK_ORDER' ? 'ol' : 'ul';
  const itemListId = `${question.questionId}-items`;
  const itemLanguage = htmlLanguageTag(language);

  return (
    <div className="handoff-question-items">
      <strong id={itemListId}>{itemListLabel}</strong>
      <ItemList aria-labelledby={itemListId}>
        {items.map((item, index) => {
          const itemId = item?.itemId || item?.id || `item-${index + 1}`;
          const structuredPrice = Number.isFinite(item?.amount) ? { ...priceContext, ...item } : item;
          const itemPrice = localizedHandoffPrice(structuredPrice, locale);
          const itemText = itemPrice || item?.text || item?.label || (item?.amount != null ? formatLocalizedNumber(item.amount, locale) : t('statusNotRecorded'));
          return <li key={itemId}><bdi dir="auto" lang={itemLanguage}>{itemText}</bdi>{itemPrice && structuredPrice?.unit ? <span className="handoff-price-unit">{t('priceUnit')}: <bdi dir="auto" lang={itemLanguage}>{structuredPrice.unit}</bdi></span> : null}<small><span>{t('technicalReference')}:</span> <code><bdi dir="ltr">{itemId}</bdi></code></small></li>;
        })}
      </ItemList>
    </div>
  );
}

function HumanResearchHandoff({ handoff, onExport }) {
  const { locale, t } = useI18n();
  const titleRef = useRef(null);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { titleRef.current?.focus(); }, []);

  const exportDraft = async (format) => {
    if (!recruitmentContractValid) {
      setError(t('handoffInstructionContractError'));
      return;
    }
    setExporting(format);
    setError('');
    try {
      await onExport(format, handoff);
    } catch {
      setError(t('handoffExportError'));
    } finally {
      setExporting('');
    }
  };

  const monitorTargets = handoff.quotaPlan?.monitorTargets || [];
  const recruitmentInstructionSet = enumToken(handoff.recruitmentPlan?.instructionSet);
  const recruitmentInstructionKeys = recruitmentInstructionKeysBySet[recruitmentInstructionSet] || null;
  const recruitmentContractValid = Array.isArray(recruitmentInstructionKeys);
  const quotaStatus = enumToken(handoff.quotaPlan?.status);
  const coverageDimensions = Array.isArray(handoff.quotaPlan?.coverageDimensions)
    ? handoff.quotaPlan.coverageDimensions
    : [];
  const stimuli = Array.isArray(handoff.questionnaire?.stimuli)
    ? handoff.questionnaire.stimuli
    : [];
  const priceStimulus = stimuli.find((stimulus) => stimulus?.type === 'PRICE_LADDER_OFFER' && stimulus.currency);
  const priceContext = priceStimulus
    ? { currency: priceStimulus.currency, unit: priceStimulus.unit }
    : null;
  const stimulusLanguage = htmlLanguageTag(handoff.questionnaire?.language);
  const sampleRecommendationKey = sampleRecommendationKeys[enumToken(handoff.samplePlan?.recommendationCode)];
  const sampleIsPointReference = enumToken(handoff.samplePlan?.recommendationKind) === 'POINT_REFERENCE';
  const missingFieldKeys = {
    'Human translation and locale review': 'missingHumanTranslation',
    'Defensible achieved-sample quota targets': 'missingQuotaTargets',
    'Observed or provider-quoted incidence': 'missingIncidence',
    'Survey duration after cognitive pretest': 'missingSurveyDuration',
    'Provider feasibility, price, and timing': 'missingProviderFeasibility',
    'Method-specific sample-size or qualitative stopping-rule design': 'missingMethodSampleDesign',
    'Preregistered subgroup power requirements': 'missingSubgroupPower',
    'Brand familiarity, none/not-sure handling, and neutral matrix order': 'missingBrandMatrixDesign',
    'Price exposure, branching, allocation, and presentation-order plan': 'missingPriceExposureDesign',
    'Observed task protocol if usability validation is intended': 'missingObservedTaskProtocol',
    'Ethics, privacy, and jurisdictional approval status': 'missingApprovals',
  };
  return (
    <section className="human-research-handoff" id="human-research-handoff" aria-labelledby="human-research-handoff-title">
      <header>
        <div><p className="section-kicker">{t('validateWithPeople')}</p><h3 id="human-research-handoff-title" ref={titleRef} tabIndex="-1">{t('humanResearchDraft')}</h3></div>
        <span>{localizedStatus(handoff.contentStatus, t)}</span>
      </header>
      <p className="human-draft-boundary" role="note"><WarningCircle size={18} /> {t('humanResearchDraftBoundary')}</p>
      <dl className="handoff-summary">
        <div><dt>{t('handoffStatus')}</dt><dd>{localizedStatus(handoff.status, t)}</dd></div>
        <div><dt>{t(sampleIsPointReference ? 'nominalFullSampleReference' : 'samplePlanStatus')}</dt><dd>{Number.isFinite(handoff.samplePlan?.recommendedCompletes) ? formatLocalizedNumber(handoff.samplePlan.recommendedCompletes, locale) : localizedStatus(handoff.samplePlan?.status, t)}</dd></div>
        <div><dt>{t('observedHumanResponses')}</dt><dd>{t('none')}</dd></div>
        <div><dt>{t('monitorOnlyTargets')}</dt><dd>{monitorTargets.length ? formatLocalizedNumber(monitorTargets.length, locale) : t('none')}</dd></div>
        <div><dt>{t('planningRecommendation')}</dt><dd>{sampleRecommendationKey ? t(sampleRecommendationKey) : localizedStatus(handoff.samplePlan?.status, t)}</dd></div>
      </dl>

      <div className="handoff-sections">
        <details open><summary>{t('questionnaireForReview')} · {formatLocalizedNumber(handoff.questionnaire?.questions?.length || 0, locale)}</summary>{stimuli.length ? <section className="handoff-stimuli" aria-labelledby="handoff-stimuli-title"><h4 id="handoff-stimuli-title">{t('stimuliForReview')} · {formatLocalizedNumber(stimuli.length, locale)}</h4><ul>{stimuli.map((stimulus) => { const price = localizedHandoffPrice(stimulus.price, locale); return <li key={stimulus.stimulusId}><article><dl className="handoff-stimulus-metadata"><div><dt>{t('stimulusIdentifier')}</dt><dd><code><bdi dir="ltr">{stimulus.stimulusId}</bdi></code></dd></div><div><dt>{t('stimulusType')}</dt><dd><code><bdi dir="ltr">{stimulus.type}</bdi></code></dd></div>{price ? <div><dt>{t('price')}</dt><dd><bdi dir="auto">{price}</bdi></dd></div> : null}{price && stimulus.price?.unit ? <div><dt>{t('priceUnit')}</dt><dd><bdi dir="auto" lang={stimulusLanguage}>{stimulus.price.unit}</bdi></dd></div> : null}</dl><p className="handoff-stimulus-copy"><bdi dir="auto" lang={stimulusLanguage}>{respondentStimulusText(stimulus)}</bdi></p></article></li>; })}</ul></section> : null}<ol className="handoff-questionnaire">{(handoff.questionnaire?.questions || []).map((question) => <li key={question.questionId}><strong>{question.questionId} · {localizedStatus(question.type, t)}</strong><p><bdi dir="auto">{question.text}</bdi></p>{question.options?.length ? <small><bdi dir="auto">{formatLocalizedList(question.options.map((option) => `${option.code}. ${option.label}`), locale)}</bdi></small> : null}<HumanResearchQuestionItems language={handoff.questionnaire?.language} priceContext={priceContext} question={question} /><span>{localizedStatus(question.provenance?.class, t)}</span></li>)}</ol></details>
        <details><summary>{t('screeningCriteria')}</summary><ul>{(handoff.screeningPlan?.criteria || []).map((criterion) => <li key={criterion.criterionId}><strong>{criterion.criterionId}</strong><span><bdi dir="auto">{criterion.criterionId === 'CONSENT' ? t('consentRequired') : criterion.rationale}</bdi></span><small>{localizedStatus(criterion.status, t)}</small></li>)}</ul></details>
        <details><summary>{t('quotasAndIncidence')}</summary>{quotaStatus === 'NOT_APPLICABLE' ? <p>{t('qualitativePurposiveCoverage')}</p> : <><p>{t('noDefensibleQuota')}</p><p>{t('incidenceNotEstimated')}</p></>}{coverageDimensions.length ? <section className="quota-coverage" aria-labelledby="coverage-dimensions-title"><h4 id="coverage-dimensions-title">{t('coverageDimensions')}</h4><table><caption className="sr-only">{t('coverageDimensions')}</caption><thead><tr><th scope="col">{t('coverageVariable')}</th><th scope="col">{t('coverageCategory')}</th><th scope="col">{t('coverageSourceShare')}</th></tr></thead><tbody>{coverageDimensions.flatMap((dimension, dimensionIndex) => (Array.isArray(dimension?.categories) ? dimension.categories : []).map((category, categoryIndex) => <tr key={`${dimension?.variable || dimensionIndex}-${category?.code || categoryIndex}`}><th scope="row"><bdi dir="auto">{dimension?.label || dimension?.variable || t('statusNotRecorded')}</bdi></th><td><bdi dir="auto">{category?.label || category?.code || t('statusNotRecorded')}</bdi></td><td>{localizedCoverageShare(category?.sourceShare, locale) || t('statusNotRecorded')}</td></tr>))}</tbody></table></section> : null}{monitorTargets.map((target) => <div className="monitor-target" key={target.quotaId}><strong><bdi dir="auto">{target.label || target.variable} · {localizedStatus(target.type, t)}</bdi></strong><span><bdi dir="auto">{formatLocalizedList(target.categories.map((category) => `${category.code}: ${localizedCoverageShare(category.referenceShare ?? category.targetShare, locale) || t('statusNotRecorded')}`), locale)}</bdi></span></div>)}</details>
        <details><summary>{t('recruitmentInstructions')}</summary>{recruitmentContractValid ? <><ol>{recruitmentInstructionKeys.map((key) => <li key={key}>{t(key)}</li>)}</ol><strong>{t('providerOptions')}</strong><div className="provider-links">{(handoff.providerLinks || []).map((provider) => <OutboundLink href={provider.url} key={provider.providerId}>{provider.name}</OutboundLink>)}</div><p>{t('outboundProviderNote')}</p></> : <p className="handoff-error" role="alert">{t('handoffInstructionContractError')}</p>}</details>
        <details><summary>{t('analysisPlan')}</summary><p><strong>{t('primaryOutcome')}:</strong> {formatLocalizedList((handoff.analysisPlan?.primaryEstimand?.statistics || []).map((item) => localizedHandoffEnum(item, estimandStatisticKeys, t)), locale)}</p><ul>{(handoff.analysisPlan?.reporting || []).map((item) => <li key={item}>{localizedHandoffEnum(item, analysisReportingKeys, t)}</li>)}</ul></details>
      </div>

      {handoff.blockingIssues?.length ? <div className="handoff-missing is-blocking"><strong>{t('blockingIssues')}</strong><ul className="handoff-blocker-list">{handoff.blockingIssues.map((issue) => <li key={issue}><span><bdi dir="auto">{localizedHandoffBlockingIssue(issue, t)}</bdi></span><small><span>{t('technicalReference')}:</span> <code><bdi dir="ltr">{issue}</bdi></code></small></li>)}</ul></div> : null}
      <div className="handoff-missing"><strong>{t('missingFields')}</strong><ul>{(handoff.missingFields || []).map((field) => <li key={field}>{missingFieldKeys[field] ? t(missingFieldKeys[field]) : t('statusNotRecorded')}</li>)}</ul></div>
      <div className="handoff-downloads" aria-label={t('humanResearchDraft')}>
        <button disabled={Boolean(exporting) || !recruitmentContractValid} onClick={() => exportDraft('csv')} type="button"><Export size={16} /> {t('downloadCsvSpec')}</button>
        <button disabled={Boolean(exporting) || !recruitmentContractValid} onClick={() => exportDraft('xlsx')} type="button"><Export size={16} /> {t('downloadXlsxSpec')}</button>
        <button disabled={Boolean(exporting) || !recruitmentContractValid} onClick={() => exportDraft('txt')} type="button"><Export size={16} /> {t('downloadResearchBrief')}</button>
        <button disabled={Boolean(exporting) || !recruitmentContractValid} onClick={() => exportDraft('json')} type="button"><Export size={16} /> {t('downloadHandoffReceipt')}</button>
      </div>
      {error ? <p className="handoff-error" role="alert">{error}</p> : null}
    </section>
  );
}

function Method({ handoffOpen, onExportHumanHandoff, onToggleHandoff, result, runComplete }) {
  const { locale, t } = useI18n();
  const methodology = result.methodology || {};
  const lineage = result.meta?.lineage || result.meta?.modelLineage || [];
  const hashes = result.meta?.hashes || {};
  const inputHash = hashes.input || result.meta?.inputHash || null;
  const inputHashLineage = result.meta?.inputHashLineage || resolveInputHashLineage({
    hash: inputHash,
    version: hashes.inputVersion || result.meta?.inputHashVersion,
  });
  const handoffAvailable = Boolean(runComplete && result.humanResearchHandoff && onExportHumanHandoff);
  return (
    <div className="secondary-view">
      <section className="audit-details" aria-labelledby="audit-details-title">
        <div className="view-intro audit-details-heading"><div><p className="section-kicker">{t('methodologyLineage')}</p><h2 id="audit-details-title">{t('auditableReplay')}</h2></div><p>{t('replayNote')}</p></div>
        <div className="audit-details-trace">
          <div className="method-grid">
            <dl>
              <div><dt>{t('runId')}</dt><dd><bdi dir="auto">{result.meta?.runId || t('statusNotRecorded')}</bdi></dd></div><div><dt>{t('generatedAt')}</dt><dd><bdi dir="auto">{result.meta?.generatedAt === 'Illustrative seed' ? t('exampleReportLabel') : safeLocalizedDate(result.meta?.generatedAt, locale, t, true)}</bdi></dd></div><div><dt>{t('promptVersion')}</dt><dd><bdi dir="auto">{methodology.promptVersion || t('statusNotRecorded')}</bdi></dd></div><div><dt>{t('schemaVersion')}</dt><dd><bdi dir="auto">{methodology.schemaVersion || t('statusNotRecorded')}</bdi></dd></div><div><dt>{t('normalizationLabel')}</dt><dd><bdi dir="auto">{localizedNormalization(methodology.normalization, methodology.normalizationKey, t)}</bdi></dd></div><div><dt>{t('evidenceHash')}</dt><dd className="hash-value"><bdi dir="auto">{hashes.evidence || result.meta?.evidenceHash || t('noEvidenceHash')}</bdi></dd></div><div><dt>{t('inputHash')}</dt><dd className="hash-value"><bdi dir="auto">{inputHash || t('noInputHash')}</bdi>{inputHashLineage.version ? <small><bdi dir="auto">{inputHashLineage.version}</bdi></small> : null}</dd></div><div><dt>{t('populationFrameHash')}</dt><dd className="hash-value"><bdi dir="auto">{hashes.populationFrame || result.meta?.populationFrameHash || t('statusNotRecorded')}</bdi></dd></div>
            </dl>
            <div className="lineage-list"><strong>{t('modelLineage')}</strong>{lineage.map((item, index) => <div key={`${item.role || item.stage}-${index}`}><span><bdi dir="auto">{localizedLineageLabel(item.role || item.stage, t) || t('stageNumber', { number: formatLocalizedNumber(index + 1, locale) })}</bdi></span><b><bdi dir="auto">{shortModel(item.resolvedModel || item.model || item.requestedModel, t)}</bdi></b><small><bdi dir="auto">{item.status ? localizedStatus(item.status, t) : item.provider || t('completed')}</bdi></small></div>)}{!lineage.length ? <p>{t('noLineage')}</p> : null}</div>
          </div>
          <ResearchDesign design={result.researchDesign} handoffAvailable={handoffAvailable} handoffOpen={handoffOpen} onToggleHandoff={onToggleHandoff} />
          {handoffAvailable && handoffOpen ? <HumanResearchHandoff handoff={result.humanResearchHandoff} onExport={onExportHumanHandoff} /> : null}
        </div>
        <div className="audit-details-boundaries">
          <div className="known-limits"><strong>{t('knownLimits')}</strong><ul>{(methodology.knownLimits || result.cautions || []).map((limit) => <li key={limit}><bdi dir="auto">{localizedKnownLimit(limit, t)}</bdi></li>)}</ul></div>
          <ModelCard result={result} />
        </div>
      </section>
    </div>
  );
}

function Stability({ result, repeatRuns }) {
  const { locale, t } = useI18n();
  const repeat = compareRepeatRuns(repeatRuns);
  const withinRun = result.meta?.stability || result.credibility?.stability || null;
  const convergenceLabel = repeat.convergence === 'LOW_VARIATION'
    ? t('lowVariation')
    : repeat.convergence === 'MATERIAL_VARIATION'
      ? t('materialVariation')
      : t('notAssessed');

  return (
    <div className="secondary-view stability-view">
      <div className="view-intro"><div><p className="section-kicker">{t('stability')}</p><h2>{t('repeatRunStability')}</h2></div><p>{t('repeatRunNote')}</p></div>
      <section className="stability-summary" aria-labelledby="repeat-stability-title">
        <h3 id="repeat-stability-title">{t('repeatRunComparison')}</h3>
        <dl>
          <div><dt>{t('completedRuns')}</dt><dd>{formatLocalizedNumber(repeat.runCount, locale)}</dd></div>
          <div><dt>{t('comparisonStatus')}</dt><dd>{localizedStatus(repeat.status, t)}</dd></div>
          <div><dt>{t('variationLabel')}</dt><dd>{convergenceLabel}</dd></div>
          <div><dt>{t('evidenceSensitivity')}</dt><dd>{repeat.lineage.evidenceChanged ? t('evidenceChanged') : t('evidenceStable')}</dd></div>
          <div><dt>{t('maxCategorySpread')}</dt><dd>{repeat.metrics ? formatPercentagePointDelta(repeat.metrics.maxPercentagePointSpread, locale, t) : t('notAssessed')}</dd></div>
          <div><dt>{t('topTwoBoxSpread')}</dt><dd>{repeat.metrics ? formatPercentagePointDelta(repeat.metrics.topTwoBoxSpread, locale, t) : t('notAssessed')}</dd></div>
          <div><dt>{t('pairwiseJsd')}</dt><dd>{repeat.metrics ? formatLocalizedNumber(repeat.metrics.meanPairwiseJensenShannonDivergence, locale, { maximumFractionDigits: 4 }) : t('notAssessed')}</dd></div>
          <div><dt>{t('thresholds')}</dt><dd>{t('publishedThresholdSummary', { category: formatLocalizedNumber(repeat.thresholds.maxPercentagePointSpread, locale), topTwoBox: formatLocalizedNumber(repeat.thresholds.topTwoBoxSpread, locale) })}</dd></div>
        </dl>
      </section>
      <section className="stability-runs">
        <h3>{t('runDistributions')}</h3>
        {repeatRuns.length ? repeatRuns.map((run, index) => <article key={run.meta?.runId || index}><div><strong>{run.meta?.runId || `${t('runLabel')} ${formatLocalizedNumber(index + 1, locale)}`}</strong><small>{run.meta?.evidenceHash || t('noEvidenceHash')}</small></div><DistributionBar compact scale={responseScaleFor(run.researchDesign)} values={run.distribution} /></article>) : <p>{t('replayForStability')}</p>}
      </section>
      <section className="within-run-stability">
        <h3>{t('withinRunStability')}</h3>
        <p>{withinRun?.applicable ? `${formatLocalizedNumber(withinRun.cellCount || 0, locale)} ${t('modelCells')} · ${Number.isFinite(withinRun.maxPercentagePointSpread) ? formatPercentagePointDelta(withinRun.maxPercentagePointSpread, locale, t) : t('notAssessed')} · ${t('stabilityJsd', { value: Number.isFinite(withinRun.meanJensenShannonDivergence) ? formatLocalizedNumber(withinRun.meanJensenShannonDivergence, locale, { maximumFractionDigits: 4 }) : t('notAssessed') })}` : t('stabilityNotEstimated')}</p>
      </section>
      <p className="population-disclaimer"><Info size={17} /> {t('repeatRunDisclaimer')}</p>
    </div>
  );
}

function CopyRunId({ value }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const field = document.createElement('textarea');
      field.value = value;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return <><button aria-label={copied ? t('copied') : t('copyRunId')} className="copy-run-id" disabled={!value} onClick={copy} title={copied ? t('copied') : t('copyRunId')} type="button">{copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}</button><span aria-live="polite" className="sr-only">{copied ? t('copied') : ''}</span></>;
}

function EvidenceIndex({ result, onInspectEvidence, onInspectPopulation, runComplete }) {
  const { locale, t } = useI18n();
  const sources = sourceEntriesFor(result);
  const researchMaterials = (result.evidence || []).filter((entry) => entry.sourceKind || String(entry.evidenceClass || '').toLowerCase().replaceAll('_', ' ').includes('provided research material'));
  const credibility = result.credibility || {};
  const lineage = result.meta?.lineage || result.meta?.modelLineage || [];
  const reviewComplete = reviewCompletedFor(result);
  const sourceCount = sources.length;
  const runId = runComplete ? result.meta?.runId || '' : '';
  const populationFit = result.populationFrame?.populationFit;
  const localizedFitStatus = localizedStatus(populationFit?.status, t);
  const fitLabel = Number.isFinite(populationFit?.overall) ? `${formatLocalizedNumber(populationFit.overall, locale)}/${formatLocalizedNumber(100, locale)} · ${localizedFitStatus}` : localizedFitStatus;

  return (
    <aside className="evidence-index" aria-label={t('evidenceAtGlance')}>
      <h2>{t('evidenceAtGlance')}</h2>
      <dl className="trust-metrics">
        <div><dt>{t('sources')}</dt><dd className={sourceCount ? 'metric-good' : 'metric-caution'}>{sourceCount ? formatLocalizedNumber(sourceCount, locale) : t('noExternalSources')}</dd></div>
        <div><dt>{t('researchMaterials')}</dt><dd className={researchMaterials.length ? 'metric-caution' : ''}><button className="metric-link" disabled={!researchMaterials.length} onClick={onInspectEvidence} type="button">{researchMaterials.length ? formatLocalizedNumber(researchMaterials.length, locale) : t('none')}</button></dd></div>
        <div><dt>{t('populationFit')}</dt><dd className="metric-caution"><button className="metric-link" onClick={onInspectPopulation} type="button">{fitLabel}</button></dd></div>
        <div><dt>{t('modelReview')}</dt><dd className={reviewComplete ? 'metric-good' : 'metric-caution'}>{reviewComplete ? t('completed') : t('notStarted')}</dd></div>
      </dl>

      <section className="source-index">
        <div className="index-heading"><h3>{t('sources')}</h3><button onClick={onInspectEvidence} type="button">{formatLocalizedNumber(sourceCount, locale)} {t('sourceRecords')} <ArrowSquareOut size={14} /></button></div>
        {sources.length ? <ol>{sources.map((source, index) => <li key={source.id || source.sourceUrl}><span className="source-number">{formatLocalizedNumber(index + 1, locale)}</span><div><OutboundLink href={source.sourceUrl} lang={htmlLanguageTag(source.originalLanguage)}>{sourceLabel(source, index, locale, t)}</OutboundLink><small><bdi dir="auto">{source.originalLanguage ? `${t('sourceLanguageLabel')} · ${getLanguageName(source.originalLanguage, locale)}` : t('publicWebSource')}</bdi>{source.excerpt ? <> · <bdi dir="auto" lang={htmlLanguageTag(source.originalLanguage)}>{source.excerpt}</bdi></> : null}</small></div></li>)}</ol> : <p className="empty-index">{t('noSourcesNote')}</p>}
      </section>

      <section className="model-lineage">
        <h3>{t('modelLineage')}</h3>
        <ol>{lineage.slice(0, 3).map((item, index) => <li key={`${item.role || item.stage}-${index}`}><span>{formatLocalizedNumber(index + 1, locale)}</span><div><strong>{localizedLineageLabel(item.role || item.stage, t) || t('stageNumber', { number: formatLocalizedNumber(index + 1, locale) })}</strong><p>{shortModel(item.resolvedModel || item.model || item.requestedModel, t)}</p><small>{item.status ? localizedStatus(item.status, t) : item.provider || t('statusNotRecorded')}</small></div></li>)}</ol>
      </section>

      <section className="run-details">
        <h3>{t('runDetails')}</h3>
        <dl><div><dt>{t('runId')}</dt><dd>{runId || t('statusNotRecorded')} <CopyRunId value={runId} /></dd></div><div><dt>{t('reportLanguage')}</dt><dd>{getLanguageName(result.meta?.outputLocale || 'en-US', locale)}</dd></div><div><dt>{t('evidenceMode')}</dt><dd>{localizedStatus(credibility.evidenceMode || result.meta?.evidenceMode || 'MODEL_ONLY', t)}</dd></div><div><dt>{t('saved')}</dt><dd><BookmarkSimple size={14} /> {result.meta?.persistence === 'durable' ? t('durable') : result.meta?.persistence === 'local' ? t('local') : t('session')}</dd></div></dl>
      </section>
    </aside>
  );
}

function ResearchSignals({ result }) {
  const { locale, t } = useI18n();
  const signals = researchSignalsFor(result);
  const hasSignals = Object.values(signals).some(Boolean);
  if (!hasSignals) return null;
  const stability = signals.stability && typeof signals.stability === 'object'
    ? signals.stability.applicable
      ? [Number.isFinite(signals.stability.maxPercentagePointSpread) ? formatPercentagePointDelta(signals.stability.maxPercentagePointSpread, locale, t) : null, Number.isFinite(signals.stability.meanJensenShannonDivergence) ? t('stabilityJsd', { value: formatLocalizedNumber(signals.stability.meanJensenShannonDivergence, locale, { maximumFractionDigits: 4 }) }) : null].filter(Boolean).join(' · ') || t('stabilityMeasured')
      : t('stabilityNotEstimated')
    : /^(?:high|medium|low)$/i.test(signals.stability || '') ? localizedStatus(signals.stability, t) : signals.stability;
  const ensemble = signals.ensemble && typeof signals.ensemble === 'object'
    ? `${formatLocalizedNumber(signals.ensemble.completedCells, locale)} / ${formatLocalizedNumber(signals.ensemble.plannedCells, locale)}`
    : localizedLegacyEnsemble(signals.ensemble, locale, t);
  const cost = signals.ownerCost
    ? formatLocalizedCurrency(signals.ownerCost.amount, signals.ownerCost.currency, locale, { maximumFractionDigits: 4 })
    : null;

  return (
    <section className="research-signals" aria-label={t('researchSignals')}>
      <h3>{t('researchSignals')}</h3>
      <dl>
        {stability ? <div><dt>{t('stability')}</dt><dd>{stability}</dd></div> : null}
        {ensemble ? <div><dt>{t('ensemble')}</dt><dd>{ensemble}</dd></div> : null}
        {signals.provenance ? <div><dt>{t('provenance')}</dt><dd className="hash-value">{signals.provenance}</dd></div> : null}
        {cost ? <div><dt>{signals.ownerCost.estimated ? t('estimatedGatewayCost') : t('exactGatewayCost')}</dt><dd title={t('gatewayCostNote')}>{cost}</dd></div> : null}
        {signals.sourceFreshness ? <div><dt>{t('sourceDate')}</dt><dd>{safeLocalizedDate(signals.sourceFreshness, locale, t)}</dd></div> : null}
      </dl>
    </section>
  );
}

export function ResultsWorkspace({
  activeStudy,
  result,
  repeatRuns = [],
  runComplete,
  running,
  onAskSegmentPerspective,
  onClearQualitativeProject,
  onEditBrief,
  onExport,
  onExportHumanHandoff,
  onHumanValidationOpen,
  onExportQualitativeProject,
  onImportQualitativeProject,
  onReplay,
  qualitativeProject,
  segmentConversations = {},
  selectedSegmentId,
  setSegmentConversations,
  setSelectedSegmentId,
}) {
  const { dir, locale, t } = useI18n();
  const [activeTab, setActiveTab] = useState('overview');
  const [handoffOpen, setHandoffOpen] = useState(false);
  const directionalResult = !result.methodResult || result.methodResult.kind === 'DIRECTIONAL_DISTRIBUTION';
  const tabs = directionalResult
    ? ['overview', 'segments', 'verbatims', 'evidence', 'population', 'stability', 'method']
    : ['overview', 'evidence', 'population', 'method'];
  const entries = result.evidence?.length ? result.evidence : [];
  const sourceCount = sourceEntriesFor(result).length;
  const reviewComplete = reviewCompletedFor(result);
  const generatedAt = result.meta?.generatedAt && result.meta.generatedAt !== 'Illustrative seed' ? result.meta.generatedAt : null;
  const segmentPerspectiveEligible = Boolean(result.researchDesign?.segmentPerspectiveEligible === true && runComplete && onAskSegmentPerspective && result.meta?.studyId && result.meta?.runId);
  const handoffAvailable = Boolean(runComplete && result.humanResearchHandoff && onExportHumanHandoff);

  const focusWorkspace = (id) => window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  const exploreModeledSegments = () => {
    setActiveTab('segments');
    focusWorkspace('segments-title');
  };
  const validateWithPeople = () => {
    onHumanValidationOpen?.({ handoffAvailable });
    setHandoffOpen(handoffAvailable);
    setActiveTab('method');
    focusWorkspace(handoffAvailable ? 'human-research-handoff-title' : 'research-design-method-title');
  };

  const handleTabKeyDown = (event, index) => {
    const keyMoves = dir === 'rtl' ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowLeft: -1, ArrowRight: 1 };
    let nextIndex = index;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key in keyMoves) nextIndex = (index + keyMoves[event.key] + tabs.length) % tabs.length;
    else return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`result-tab-${nextTab}`)?.focus());
  };

  return (
    <section className="research-report" aria-label={t('reportTab')}>
      <header className="report-toolbar">
        <div className="report-status"><CheckCircle size={18} weight={runComplete ? 'fill' : 'regular'} /><strong>{runComplete ? t('completed') : t('illustrativePreview')}</strong><span>·</span><span>{sourceCount ? `${formatLocalizedNumber(sourceCount, locale)} ${t('sourceRecords')}` : t('noExternalSources')}</span><span>·</span><span>{reviewComplete ? t('modelReviewed') : `${t('modelReview')} · ${t('notStarted')}`}</span></div>
        <p className="run-id">{runComplete ? `${t('runId')}: ${result.meta?.runId || t('notStarted')}${generatedAt ? ` · ${safeLocalizedDate(generatedAt, locale, t, true)}` : ''}` : t('exampleReportLabel')}</p>
        {runComplete ? <div className="report-actions"><button disabled={running} onClick={onEditBrief} type="button"><PencilSimple size={18} /> {t('editBrief')}</button><button onClick={onExport} type="button"><Export size={18} /> {t('export')}</button><button disabled={running} onClick={onReplay} type="button"><ArrowCounterClockwise size={18} /> {t('replay')}</button></div> : null}
      </header>

      <div className="report-frame">
        <div className="report-main">
          <header className="report-heading">
            <h2 id="report-title"><bdi dir="auto">{activeStudy.prompt}</bdi></h2>
            <div className="study-scope" aria-label={t('market')}><span><GlobeHemisphereWest size={17} /> <bdi dir="auto">{localizedMarketLabel(activeStudy.market, locale, t)}</bdi></span><span><UsersThree size={17} /> <bdi dir="auto">{activeStudy.audience}</bdi></span><span><FileText size={17} /> {getLanguageName(activeStudy.outputLocale, locale)} {t('outputLabel')}</span></div>
          </header>

          <ResearchSignals result={result} />

          <label className="result-section-picker" htmlFor="result-section-picker">
            <span>{t('reportSection')}</span>
            <select id="result-section-picker" onChange={(event) => setActiveTab(event.target.value)} value={activeTab}>
              {tabs.map((tab) => <option key={tab} value={tab}>{tab === 'overview' ? t('reportTab') : t(tab)}</option>)}
            </select>
          </label>

          <div className="tabs" role="tablist" aria-label={t('reportSection')}>
            {tabs.map((tab, index) => <button aria-controls="result-panel" aria-selected={activeTab === tab} className={activeTab === tab ? 'is-active' : ''} id={`result-tab-${tab}`} key={tab} onClick={() => setActiveTab(tab)} onKeyDown={(event) => handleTabKeyDown(event, index)} role="tab" tabIndex={activeTab === tab ? 0 : -1} type="button">{tab === 'overview' ? t('reportTab') : t(tab)}</button>)}
          </div>

          <div aria-labelledby={`result-tab-${activeTab}`} className="result-body" id="result-panel" role="tabpanel" tabIndex="0">
            {activeTab === 'overview' ? <MethodResultOverview onExploreSegments={exploreModeledSegments} onValidateWithPeople={validateWithPeople} result={result} runComplete={runComplete} /> : null}
            {activeTab === 'segments' ? <Segments baseStimulus={result.researchDesign?.stimulus?.text || activeStudy.concept || activeStudy.offer || activeStudy.message || activeStudy.claim || activeStudy.taskScenario || ''} canExplore={segmentPerspectiveEligible} conversations={segmentConversations} onAskSegmentPerspective={onAskSegmentPerspective} onClearProject={onClearQualitativeProject} onExportProject={onExportQualitativeProject} onImportProject={onImportQualitativeProject} projectState={qualitativeProject} researchDesign={result.researchDesign} segments={result.segments || []} selectedSegmentId={selectedSegmentId} setConversations={setSegmentConversations} setSelectedSegmentId={setSelectedSegmentId} /> : null}
            {activeTab === 'verbatims' ? <Verbatims responses={result.responses || []} /> : null}
            {activeTab === 'evidence' && <Evidence entries={entries} evidenceMeta={result.evidenceMeta} />}
            {activeTab === 'population' && <PopulationFrame frame={result.populationFrame} />}
            {activeTab === 'stability' && <Stability repeatRuns={repeatRuns} result={result} />}
            {activeTab === 'method' && <Method handoffOpen={handoffOpen} onExportHumanHandoff={onExportHumanHandoff} onToggleHandoff={() => setHandoffOpen((open) => !open)} result={result} runComplete={runComplete} />}
          </div>
        </div>
        <EvidenceIndex onInspectEvidence={() => setActiveTab('evidence')} onInspectPopulation={() => setActiveTab('population')} result={result} runComplete={runComplete} />
      </div>

      <footer className="report-footer-note"><LinkSimple size={15} /> {t('syntheticMethodNote')}</footer>
    </section>
  );
}
