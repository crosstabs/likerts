import { methodConfigForStudy } from '../data.js';
import {
  instrumentLanguageOptions,
  reportLanguageOptions,
  retrievalLanguageOptions,
  sourceLanguageOptions,
  studyMarketOptions,
} from './localizationUiCatalog.js';

const trimmed = (value) => String(value || '').trim();
const lengthBetween = (value, minimum, maximum) => {
  const length = trimmed(value).length;
  return length >= minimum && length <= maximum;
};
const optionalLengthBetween = (value, minimum, maximum) => !trimmed(value) || lengthBetween(value, minimum, maximum);
const addLengthIssue = (issues, fieldId, labelKey, value, minimum, maximum) => {
  const length = trimmed(value).length;
  if (length < minimum) issues.push({ fieldId, labelKey, reasonKey: 'readinessAtLeastCharacters', variables: { count: minimum } });
  else if (length > maximum) issues.push({ fieldId, labelKey, reasonKey: 'readinessAtMostCharacters', variables: { count: maximum } });
};
const addOptionalLengthIssue = (issues, fieldId, labelKey, value, minimum, maximum) => {
  if (trimmed(value)) addLengthIssue(issues, fieldId, labelKey, value, minimum, maximum);
};
const addRequiredLengthIssue = (issues, fieldId, labelKey, value, minimum, maximum) => {
  addLengthIssue(issues, fieldId, labelKey, value, minimum, maximum);
};
const addListIssues = (issues, { items, fieldId, labelKey, itemLabelKey, minimum, maximum, valueKey, minLength, maxLength, prefix }) => {
  const list = Array.isArray(items) ? items : [];
  if (list.length < minimum) issues.push({ fieldId, labelKey, reasonKey: 'readinessAtLeastItems', variables: { count: minimum } });
  if (list.length > maximum) issues.push({ fieldId, labelKey, reasonKey: 'readinessAtMostItems', variables: { count: maximum } });
  if (new Set(list.map((item) => item?.id)).size !== list.length) issues.push({ fieldId, labelKey, reasonKey: 'readinessUniqueItems' });
  list.forEach((item, index) => {
    const itemFieldId = `${prefix}-${item?.id || index + 1}`;
    addRequiredLengthIssue(issues, itemFieldId, itemLabelKey, item?.[valueKey], minLength, maxLength);
  });
};

/**
 * Returns user-facing readiness issues without changing the API's boolean
 * readiness contract. The composer uses these issues to explain and focus
 * invalid fields; `isResearchMethodReady` remains the source of truth for the
 * request contract.
 */
export function studyReadinessIssues(study = {}) {
  const issues = [];
  addRequiredLengthIssue(issues, 'research-question', 'question', study.prompt, 12, Number.POSITIVE_INFINITY);
  addRequiredLengthIssue(issues, 'audience', 'audience', study.audience, 3, Number.POSITIVE_INFINITY);

  const hasLocalizationState = ['market', 'outputLocale', 'sourceLanguages', 'retrievalPolicy', 'retrievalLocales', 'instrumentLocale']
    .some((field) => Object.hasOwn(study, field));
  if (hasLocalizationState) {
    const optionValues = (options) => new Set(options.map((option) => option.value));
    const reportLocales = optionValues(reportLanguageOptions);
    const sourceLocales = optionValues(sourceLanguageOptions);
    const retrievalLocales = optionValues(retrievalLanguageOptions);
    const instrumentLocales = optionValues(instrumentLanguageOptions);
    const selectedSources = Array.isArray(study.sourceLanguages) ? study.sourceLanguages : [];
    const selectedRetrievalLocales = Array.isArray(study.retrievalLocales) ? study.retrievalLocales : [];
    const retrievalPolicy = String(study.retrievalPolicy || '').toUpperCase();
    if (!studyMarketOptions.some((market) => market.value === study.market)) issues.push({ fieldId: 'market', labelKey: 'market', reasonKey: 'readinessSelectOption' });
    if (!reportLocales.has(study.outputLocale)) issues.push({ fieldId: 'report-language', labelKey: 'reportLanguage', reasonKey: 'readinessSelectOption' });
    if (selectedSources.length > 4 || new Set(selectedSources).size !== selectedSources.length || selectedSources.some((locale) => !sourceLocales.has(locale))) issues.push({ fieldId: 'source-languages', labelKey: 'sourceLanguage', reasonKey: 'readinessSelectOption' });
    if (!['ANY', 'PREFER', 'REQUIRE'].includes(retrievalPolicy)) issues.push({ fieldId: 'retrieval-policy', labelKey: 'retrievalPolicy', reasonKey: 'readinessSelectOption' });
    if (retrievalPolicy !== 'ANY' && (!selectedRetrievalLocales.length || selectedRetrievalLocales.length > 4 || new Set(selectedRetrievalLocales).size !== selectedRetrievalLocales.length || selectedRetrievalLocales.some((locale) => !retrievalLocales.has(locale)))) {
      issues.push({ fieldId: 'retrieval-locales', labelKey: 'retrievalLanguage', reasonKey: 'retrievalLocaleRequired' });
    }
    const effectiveInstrumentLocale = study.instrumentLocale || study.outputLocale;
    if (!instrumentLocales.has(effectiveInstrumentLocale)) issues.push({ fieldId: 'instrument-language', labelKey: 'instrumentLanguage', reasonKey: 'readinessSelectOption' });
  }

  const method = study.researchMethod || 'GENERAL_LIKERT';
  const config = methodConfigForStudy(study);
  switch (method) {
    case 'GENERAL_LIKERT':
      break;
    case 'CONCEPT_TEST':
      addRequiredLengthIssue(issues, 'concept-stimulus', 'conceptStimulus', config?.concept?.text, 20, 2_000);
      break;
    case 'PURCHASE_INTENT':
      addRequiredLengthIssue(issues, 'purchase-offer', 'exactOffer', config?.offer?.text, 20, 2_000);
      addRequiredLengthIssue(issues, 'purchase-category', 'category', config?.category, 3, 160);
      if (!Number.isFinite(config?.price?.amount) || config.price.amount <= 0 || config.price.amount > 1_000_000_000) issues.push({ fieldId: 'purchase-price', labelKey: 'price', reasonKey: 'readinessPositiveNumber' });
      if (!/^[A-Z]{3}$/.test(config?.price?.currency || '')) issues.push({ fieldId: 'purchase-currency', labelKey: 'currency', reasonKey: 'readinessValidCurrency' });
      addRequiredLengthIssue(issues, 'purchase-unit', 'priceUnit', config?.price?.unit, 2, 120);
      addRequiredLengthIssue(issues, 'purchase-channel', 'purchaseChannel', config?.channel, 3, 160);
      addRequiredLengthIssue(issues, 'purchase-horizon', 'purchaseHorizon', config?.purchaseHorizon, 3, 160);
      addRequiredLengthIssue(issues, 'purchase-alternative', 'referenceAlternative', config?.referenceAlternative, 3, 500);
      break;
    case 'MESSAGE_TEST':
      addRequiredLengthIssue(issues, 'message-stimulus', 'messageStimulus', config?.message?.text, 20, 2_000);
      addRequiredLengthIssue(issues, 'intended-action', 'intendedAction', config?.intendedAction, 3, 300);
      addOptionalLengthIssue(issues, 'message-exposure-context', 'exposureContext', config?.exposureContext, 3, 500);
      break;
    case 'CLAIMS_TEST':
      addRequiredLengthIssue(issues, 'claim-stimulus', 'claimStimulus', config?.claim?.text, 10, 2_000);
      if (!['UNVERIFIED', 'USER_DECLARED_SUBSTANTIATED', 'NOT_SUPPLIED'].includes(config?.claimStatus)) issues.push({ fieldId: 'claim-status', labelKey: 'claimStatus', reasonKey: 'readinessSelectOption' });
      addOptionalLengthIssue(issues, 'claim-exposure-context', 'exposureContext', config?.exposureContext, 3, 500);
      break;
    case 'UX_EXPECTATION_TEST':
      addRequiredLengthIssue(issues, 'task-scenario', 'taskScenario', config?.taskScenario?.text, 20, 2_000);
      addRequiredLengthIssue(issues, 'user-goal', 'userGoal', config?.userGoal, 3, 300);
      addRequiredLengthIssue(issues, 'experience-description', 'experienceDescription', config?.experienceDescription, 10, 2_000);
      addOptionalLengthIssue(issues, 'ux-context', 'experienceContext', config?.context, 3, 500);
      addOptionalLengthIssue(issues, 'ux-device', 'device', config?.device, 2, 160);
      break;
    case 'FEATURE_PRIORITIZATION':
      addListIssues(issues, { items: config?.features, fieldId: 'feature-items', labelKey: 'features', itemLabelKey: 'feature', minimum: 3, maximum: 8, valueKey: 'text', minLength: 3, maxLength: 500, prefix: 'feature' });
      addRequiredLengthIssue(issues, 'decision-context', 'decisionContext', config?.decisionContext, 3, 500);
      addRequiredLengthIssue(issues, 'selection-constraint', 'selectionConstraint', config?.selectionConstraint, 3, 300);
      break;
    case 'BRAND_POSITIONING':
      addRequiredLengthIssue(issues, 'focal-brand', 'focalBrand', config?.focalBrand?.label, 2, 160);
      addRequiredLengthIssue(issues, 'brand-category', 'category', config?.category, 3, 160);
      addListIssues(issues, { items: config?.comparatorBrands, fieldId: 'comparator-brands', labelKey: 'comparatorBrands', itemLabelKey: 'comparatorBrand', minimum: 2, maximum: 5, valueKey: 'label', minLength: 2, maxLength: 160, prefix: 'brand' });
      if (config?.focalBrand && Array.isArray(config.comparatorBrands) && new Set([config.focalBrand.id, ...config.comparatorBrands.map((item) => item.id)]).size !== config.comparatorBrands.length + 1) {
        issues.push({ fieldId: 'comparator-brands', labelKey: 'comparatorBrands', reasonKey: 'readinessUniqueItems' });
      }
      addListIssues(issues, { items: config?.attributes, fieldId: 'brand-attributes', labelKey: 'attributes', itemLabelKey: 'attribute', minimum: 3, maximum: 6, valueKey: 'label', minLength: 2, maxLength: 160, prefix: 'attribute' });
      break;
    case 'PRICE_SENSITIVITY':
      addRequiredLengthIssue(issues, 'price-offer', 'exactOffer', config?.offer?.text, 20, 2_000);
      addRequiredLengthIssue(issues, 'price-category', 'category', config?.category, 3, 160);
      if (!/^[A-Z]{3}$/.test(config?.currency || '')) issues.push({ fieldId: 'price-currency', labelKey: 'currency', reasonKey: 'readinessValidCurrency' });
      addRequiredLengthIssue(issues, 'price-unit', 'priceUnit', config?.unit, 2, 120);
      addRequiredLengthIssue(issues, 'price-channel', 'purchaseChannel', config?.channel, 3, 160);
      addRequiredLengthIssue(issues, 'price-horizon', 'purchaseHorizon', config?.purchaseHorizon, 3, 160);
      addRequiredLengthIssue(issues, 'price-alternative', 'referenceAlternative', config?.referenceAlternative, 3, 500);
      addListIssues(issues, { items: config?.pricePoints, fieldId: 'price-points', labelKey: 'ascendingPricePoints', itemLabelKey: 'pricePoint', minimum: 3, maximum: 8, valueKey: 'amount', minLength: 0, maxLength: Number.POSITIVE_INFINITY, prefix: 'price' });
      if (Array.isArray(config?.pricePoints)) {
        config.pricePoints.forEach((point, index) => {
          if (!Number.isFinite(point?.amount) || point.amount <= 0 || point.amount > 1_000_000_000) issues.push({ fieldId: `price-${point?.id || index + 1}`, labelKey: 'pricePoint', reasonKey: 'readinessPositiveNumber' });
          if (index > 0 && Number.isFinite(point?.amount) && Number.isFinite(config.pricePoints[index - 1]?.amount) && point.amount <= config.pricePoints[index - 1].amount) issues.push({ fieldId: `price-${point?.id || index + 1}`, labelKey: 'pricePoint', reasonKey: 'readinessAscending' });
        });
      }
      break;
    case 'SURVEY_PRETEST':
      addRequiredLengthIssue(issues, 'study-objective', 'studyObjective', config?.studyObjective, 3, 500);
      addRequiredLengthIssue(issues, 'target-population', 'targetPopulation', config?.targetPopulation, 3, 500);
      addListIssues(issues, { items: config?.surveyQuestions, fieldId: 'survey-questions', labelKey: 'surveyQuestions', itemLabelKey: 'surveyQuestion', minimum: 1, maximum: 50, valueKey: 'text', minLength: 3, maxLength: 2_000, prefix: 'question' });
      break;
    case 'INTERVIEW_GUIDE':
      addRequiredLengthIssue(issues, 'research-objective', 'researchObjective', config?.researchObjective, 3, 500);
      addRequiredLengthIssue(issues, 'participant-context', 'participantContext', config?.participantContext, 3, 500);
      addListIssues(issues, { items: config?.topics, fieldId: 'interview-topics', labelKey: 'interviewTopics', itemLabelKey: 'topic', minimum: 2, maximum: 8, valueKey: 'label', minLength: 2, maxLength: 300, prefix: 'topic' });
      addListIssues(issues, {
        items: (Array.isArray(study.sensitiveAreas) ? study.sensitiveAreas : [])
          .filter((item) => item && typeof item === 'object' && trimmed(item.text))
          .map((item, index) => ({ id: trimmed(item.id) || `sensitive-area-${index + 1}`, text: item.text })),
        fieldId: 'sensitive-areas',
        labelKey: 'sensitiveAreas',
        itemLabelKey: 'sensitiveArea',
        minimum: 0,
        maximum: 8,
        valueKey: 'text',
        minLength: 2,
        maxLength: 300,
        prefix: 'sensitive-area',
      });
      break;
    default:
      issues.push({ fieldId: 'research-method', labelKey: 'researchMethod', reasonKey: 'readinessSelectOption' });
  }

  return issues;
}

export const studyReadiness = Object.freeze({ studyReadinessIssues, lengthBetween, optionalLengthBetween });
