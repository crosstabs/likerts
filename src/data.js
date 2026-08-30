import { studyMarketOptions } from './lib/localizationUiCatalog.js';

export const responseScale = [
  { key: 'veryUnlikely', label: 'Very unlikely', tone: 'negative-strong' },
  { key: 'unlikely', label: 'Unlikely', tone: 'negative' },
  { key: 'notSure', label: 'Not sure', tone: 'neutral' },
  { key: 'likely', label: 'Likely', tone: 'positive' },
  { key: 'veryLikely', label: 'Very likely', tone: 'positive-strong' },
];

const researchMethodRegistry = Object.freeze({
  GENERAL_LIKERT: Object.freeze({ id: 'GENERAL_LIKERT', titleKey: 'generalLikertLegacy', descriptionKey: 'generalLikertLegacyDescription', resultKind: 'DIRECTIONAL_DISTRIBUTION', segmentPerspectiveEligible: true }),
  CONCEPT_TEST: Object.freeze({ id: 'CONCEPT_TEST', titleKey: 'conceptIntentTest', descriptionKey: 'conceptIntentTestDescription', resultKind: 'DIRECTIONAL_DISTRIBUTION', segmentPerspectiveEligible: true }),
  PURCHASE_INTENT: Object.freeze({ id: 'PURCHASE_INTENT', titleKey: 'purchaseIntentTest', descriptionKey: 'purchaseIntentTestDescription', resultKind: 'DIRECTIONAL_DISTRIBUTION', segmentPerspectiveEligible: true }),
  MESSAGE_TEST: Object.freeze({ id: 'MESSAGE_TEST', titleKey: 'messageTest', descriptionKey: 'messageTestDescription', resultKind: 'DIRECTIONAL_DISTRIBUTION', segmentPerspectiveEligible: true }),
  CLAIMS_TEST: Object.freeze({ id: 'CLAIMS_TEST', titleKey: 'claimsTest', descriptionKey: 'claimsTestDescription', resultKind: 'DIRECTIONAL_DISTRIBUTION', segmentPerspectiveEligible: true }),
  UX_EXPECTATION_TEST: Object.freeze({ id: 'UX_EXPECTATION_TEST', titleKey: 'uxExpectationTest', descriptionKey: 'uxExpectationTestDescription', resultKind: 'DIRECTIONAL_DISTRIBUTION', segmentPerspectiveEligible: true }),
  FEATURE_PRIORITIZATION: Object.freeze({ id: 'FEATURE_PRIORITIZATION', titleKey: 'featurePrioritization', descriptionKey: 'featurePrioritizationDescription', resultKind: 'RANKED_ITEMS', segmentPerspectiveEligible: false }),
  BRAND_POSITIONING: Object.freeze({ id: 'BRAND_POSITIONING', titleKey: 'brandPositioning', descriptionKey: 'brandPositioningDescription', resultKind: 'ATTRIBUTE_MATRIX', segmentPerspectiveEligible: false }),
  PRICE_SENSITIVITY: Object.freeze({ id: 'PRICE_SENSITIVITY', titleKey: 'priceSensitivity', descriptionKey: 'priceSensitivityDescription', resultKind: 'PRICE_LADDER', segmentPerspectiveEligible: false }),
  SURVEY_PRETEST: Object.freeze({ id: 'SURVEY_PRETEST', titleKey: 'surveyPretest', descriptionKey: 'surveyPretestDescription', resultKind: 'INSTRUMENT_REVIEW', segmentPerspectiveEligible: false }),
  INTERVIEW_GUIDE: Object.freeze({ id: 'INTERVIEW_GUIDE', titleKey: 'interviewGuide', descriptionKey: 'interviewGuideDescription', resultKind: 'INTERVIEW_GUIDE', segmentPerspectiveEligible: false }),
});

export const researchMethods = Object.freeze(Object.values(researchMethodRegistry).filter((method) => method.id !== 'GENERAL_LIKERT'));

export function researchMethodMetadata(method) {
  return researchMethodRegistry[method] || null;
}

export function resultKindForResearchMethod(method) {
  return researchMethodMetadata(method)?.resultKind || null;
}

export function segmentPerspectiveEligibleFor(method) {
  return researchMethodMetadata(method)?.segmentPerspectiveEligible === true;
}

const trimmed = (value) => String(value || '').trim();
const optionalText = (value, key) => trimmed(value) ? { [key]: trimmed(value) } : {};
const listItems = (items, valueKey, prefix) => (Array.isArray(items) ? items : [])
  .map((item, index) => ({ id: trimmed(item?.id) || `${prefix}-${index + 1}`, [valueKey]: trimmed(item?.[valueKey]) }))
  .filter((item) => item[valueKey]);

export function methodConfigForStudy(study) {
  const method = study?.researchMethod || 'GENERAL_LIKERT';
  switch (method) {
    case 'GENERAL_LIKERT': return null;
    case 'CONCEPT_TEST':
      return { method, concept: { id: 'concept-1', text: trimmed(study.concept) } };
    case 'PURCHASE_INTENT':
      return { method, offer: { id: 'offer-1', text: trimmed(study.offer) }, category: trimmed(study.category), price: { amount: Number(study.priceAmount), currency: trimmed(study.currency).toUpperCase(), unit: trimmed(study.priceUnit) }, channel: trimmed(study.purchaseChannel), purchaseHorizon: trimmed(study.purchaseHorizon), referenceAlternative: trimmed(study.referenceAlternative) };
    case 'MESSAGE_TEST':
      return { method, message: { id: 'message-1', text: trimmed(study.message) }, intendedAction: trimmed(study.intendedAction), ...optionalText(study.exposureContext, 'exposureContext') };
    case 'CLAIMS_TEST':
      return { method, claim: { id: 'claim-1', text: trimmed(study.claim) }, claimStatus: study.claimStatus || 'NOT_SUPPLIED', ...optionalText(study.exposureContext, 'exposureContext') };
    case 'UX_EXPECTATION_TEST':
      return { method, taskScenario: { id: 'task-1', text: trimmed(study.taskScenario) }, userGoal: trimmed(study.userGoal), experienceDescription: trimmed(study.experienceDescription), ...optionalText(study.uxContext, 'context'), ...optionalText(study.device, 'device') };
    case 'FEATURE_PRIORITIZATION':
      return { method, features: listItems(study.featureItems, 'text', 'feature'), decisionContext: trimmed(study.decisionContext), selectionConstraint: trimmed(study.selectionConstraint) };
    case 'BRAND_POSITIONING':
      return { method, focalBrand: { id: 'focal-brand', label: trimmed(study.focalBrand) }, comparatorBrands: listItems(study.comparatorBrands, 'label', 'brand'), category: trimmed(study.category), attributes: listItems(study.brandAttributes, 'label', 'attribute') };
    case 'PRICE_SENSITIVITY':
      return { method, offer: { id: 'offer-1', text: trimmed(study.offer) }, category: trimmed(study.category), currency: trimmed(study.currency).toUpperCase(), unit: trimmed(study.priceUnit), channel: trimmed(study.purchaseChannel), purchaseHorizon: trimmed(study.purchaseHorizon), referenceAlternative: trimmed(study.referenceAlternative), pricePoints: (Array.isArray(study.pricePoints) ? study.pricePoints : []).map((point, index) => ({ id: trimmed(point?.id) || `price-${index + 1}`, amount: Number(point?.amount) })) };
    case 'SURVEY_PRETEST':
      return { method, studyObjective: trimmed(study.studyObjective), targetPopulation: trimmed(study.targetPopulation), surveyQuestions: listItems(study.surveyQuestions, 'text', 'question') };
    case 'INTERVIEW_GUIDE': {
      const sensitiveAreas = listItems(study.sensitiveAreas, 'text', 'sensitive-area').map((item) => item.text);
      return { method, researchObjective: trimmed(study.researchObjective), participantContext: trimmed(study.participantContext), topics: listItems(study.interviewTopics, 'label', 'topic'), ...(sensitiveAreas.length ? { sensitiveAreas } : {}) };
    }
    default:
      return null;
  }
}

const hasLength = (value, minimum, maximum = Number.POSITIVE_INFINITY) => {
  const length = trimmed(value).length;
  return length >= minimum && length <= maximum;
};
const hasOptionalLength = (value, minimum, maximum) => !trimmed(value) || hasLength(value, minimum, maximum);
const inRange = (items, minimum, maximum) => Array.isArray(items) && items.length >= minimum && items.length <= maximum;
const hasUniqueIds = (items) => Array.isArray(items) && new Set(items.map((item) => item.id)).size === items.length;

export function isResearchMethodReady(study) {
  const method = study?.researchMethod || 'GENERAL_LIKERT';
  const config = methodConfigForStudy(study);
  switch (method) {
    case 'GENERAL_LIKERT': return true;
    case 'CONCEPT_TEST': return hasLength(config.concept.text, 20, 2_000);
    case 'PURCHASE_INTENT': return hasLength(config.offer.text, 20, 2_000) && hasLength(config.category, 3, 160) && Number.isFinite(config.price.amount) && config.price.amount > 0 && config.price.amount <= 1_000_000_000 && /^[A-Z]{3}$/.test(config.price.currency) && hasLength(config.price.unit, 2, 120) && hasLength(config.channel, 3, 160) && hasLength(config.purchaseHorizon, 3, 160) && hasLength(config.referenceAlternative, 3, 500);
    case 'MESSAGE_TEST': return hasLength(config.message.text, 20, 2_000) && hasLength(config.intendedAction, 3, 300) && hasOptionalLength(config.exposureContext, 3, 500);
    case 'CLAIMS_TEST': return hasLength(config.claim.text, 10, 2_000) && ['UNVERIFIED', 'USER_DECLARED_SUBSTANTIATED', 'NOT_SUPPLIED'].includes(config.claimStatus) && hasOptionalLength(config.exposureContext, 3, 500);
    case 'UX_EXPECTATION_TEST': return hasLength(config.taskScenario.text, 20, 2_000) && hasLength(config.userGoal, 3, 300) && hasLength(config.experienceDescription, 10, 2_000) && hasOptionalLength(config.context, 3, 500) && hasOptionalLength(config.device, 2, 160);
    case 'FEATURE_PRIORITIZATION': return inRange(config.features, 3, 8) && hasUniqueIds(config.features) && config.features.every((item) => hasLength(item.text, 3, 500)) && hasLength(config.decisionContext, 3, 500) && hasLength(config.selectionConstraint, 3, 300);
    case 'BRAND_POSITIONING': {
      const brandIds = [config.focalBrand.id, ...config.comparatorBrands.map((item) => item.id)];
      return hasLength(config.focalBrand.label, 2, 160) && inRange(config.comparatorBrands, 2, 5) && new Set(brandIds).size === brandIds.length && config.comparatorBrands.every((item) => hasLength(item.label, 2, 160)) && hasLength(config.category, 3, 160) && inRange(config.attributes, 3, 6) && hasUniqueIds(config.attributes) && config.attributes.every((item) => hasLength(item.label, 2, 160));
    }
    case 'PRICE_SENSITIVITY': return hasLength(config.offer.text, 20, 2_000) && hasLength(config.category, 3, 160) && /^[A-Z]{3}$/.test(config.currency) && hasLength(config.unit, 2, 120) && hasLength(config.channel, 3, 160) && hasLength(config.purchaseHorizon, 3, 160) && hasLength(config.referenceAlternative, 3, 500) && inRange(config.pricePoints, 3, 8) && hasUniqueIds(config.pricePoints) && config.pricePoints.every((point, index) => Number.isFinite(point.amount) && point.amount > 0 && point.amount <= 1_000_000_000 && (index === 0 || point.amount > config.pricePoints[index - 1].amount));
    case 'SURVEY_PRETEST': return hasLength(config.studyObjective, 3, 500) && hasLength(config.targetPopulation, 3, 500) && inRange(config.surveyQuestions, 1, 50) && hasUniqueIds(config.surveyQuestions) && config.surveyQuestions.every((item) => hasLength(item.text, 3, 2_000));
    case 'INTERVIEW_GUIDE': return hasLength(config.researchObjective, 3, 500) && hasLength(config.participantContext, 3, 500) && inRange(config.topics, 2, 8) && hasUniqueIds(config.topics) && config.topics.every((item) => hasLength(item.label, 2, 300)) && inRange(config.sensitiveAreas || [], 0, 8) && (config.sensitiveAreas || []).every((item) => hasLength(item, 2, 300));
    default: return false;
  }
}

export const markets = studyMarketOptions;

export const runStages = [
  {
    id: 'frame',
    shortLabel: 'Frame',
    label: 'Brief parsed',
    description: 'Turn the objective into a testable Likert item.',
  },
  {
    id: 'ground',
    shortLabel: 'Search',
    label: 'Evidence checked',
    description: 'Separate supplied sources, assumptions, and model inference.',
  },
  {
    id: 'simulate',
    shortLabel: 'Simulate',
    label: 'Panel simulated',
    description: 'Generate disagreement across separate model-run cells.',
  },
  {
    id: 'review',
    shortLabel: 'Review',
    label: 'Model review',
    description: 'Challenge unsupported claims and calibrate the final read.',
  },
];

export const initialStudy = {
  prompt: 'How likely are you to adopt a four-day workweek if salary and output expectations remain unchanged?',
  audience: 'Knowledge workers in organisations with 50–1,000 employees · Ages 25–54',
  market: 'Global',
  outputLocale: 'en-US',
  sourceLanguages: [],
  retrievalPolicy: 'ANY',
  retrievalLocales: [],
  instrumentLocale: '',
  panelSize: 200,
  researchMethod: 'CONCEPT_TEST',
  concept: 'A four-day workweek with unchanged salary and clear output expectations, without materially longer working days.',
  offer: '',
  category: '',
  priceAmount: '',
  currency: 'USD',
  priceUnit: 'per month',
  purchaseChannel: '',
  purchaseHorizon: '',
  referenceAlternative: '',
  message: '',
  intendedAction: '',
  exposureContext: '',
  claim: '',
  claimStatus: 'NOT_SUPPLIED',
  taskScenario: '',
  userGoal: '',
  experienceDescription: '',
  uxContext: '',
  device: '',
  featureItems: [
    { id: 'feature-1', text: '' },
    { id: 'feature-2', text: '' },
    { id: 'feature-3', text: '' },
  ],
  decisionContext: '',
  selectionConstraint: '',
  focalBrand: '',
  comparatorBrands: [{ id: 'brand-1', label: '' }, { id: 'brand-2', label: '' }],
  brandAttributes: [{ id: 'attribute-1', label: '' }, { id: 'attribute-2', label: '' }, { id: 'attribute-3', label: '' }],
  pricePoints: [{ id: 'price-1', amount: '' }, { id: 'price-2', amount: '' }, { id: 'price-3', amount: '' }],
  studyObjective: '',
  targetPopulation: '',
  surveyQuestions: [{ id: 'question-1', text: '' }],
  researchObjective: '',
  participantContext: '',
  interviewTopics: [{ id: 'topic-1', label: '' }, { id: 'topic-2', label: '' }],
  sensitiveAreas: [],
  researchMode: 'quick',
  sources: [],
  assumptions: 'Salary remains unchanged; employers keep clear output expectations; the working day does not become materially longer.',
  distribution: [7, 11, 14, 32, 36],
};

export const segmentRows = [
  { id: 'segment-1', kind: 'MODEL_CONSTRUCTED', label: 'Ages 25–34', values: [5, 9, 12, 34, 40], boundary: 'This is a model-constructed analytical segment, not an observed participant group.' },
  { id: 'segment-2', kind: 'MODEL_CONSTRUCTED', label: 'Ages 35–54', values: [8, 13, 16, 31, 32], boundary: 'This is a model-constructed analytical segment, not an observed participant group.' },
  { id: 'segment-3', kind: 'MODEL_CONSTRUCTED', label: 'Remote-first', values: [4, 8, 12, 34, 42], boundary: 'This is a model-constructed analytical segment, not an observed participant group.' },
  { id: 'segment-4', kind: 'MODEL_CONSTRUCTED', label: 'Office-first', values: [10, 14, 16, 30, 30], boundary: 'This is a model-constructed analytical segment, not an observed participant group.' },
];

export const syntheticResponses = [
  {
    score: 5,
    profile: 'Remote-first product manager · 31',
    quote: 'A shorter week would be compelling if priorities were clearer and the same workload was not compressed into longer days.',
  },
  {
    score: 4,
    profile: 'Hybrid operations lead · 43',
    quote: 'I would support a trial if customer coverage and handoffs had a credible plan.',
  },
  {
    score: 3,
    profile: 'Finance specialist · 36',
    quote: 'The idea is attractive, but month-end workload makes the practical effect hard to judge.',
  },
  {
    score: 2,
    profile: 'Client services director · 51',
    quote: 'I would worry that the fifth day simply becomes unofficial availability without reducing expectations.',
  },
].map((response) => ({ ...response, disclosure: 'Model-generated perspective—not a participant quotation.' }));

export const initialPopulationFrame = {
  frameVersion: 'population-frame-v1',
  intendedPopulation: initialStudy.audience,
  geography: { market: initialStudy.market, countryCode: null },
  languages: { outputLocale: initialStudy.outputLocale, sourceLanguages: [] },
  characteristics: [],
  officialSourceDatasets: [],
  marginalDistributions: [],
  knownIntersections: [],
  populationCells: [],
  weighting: {
    method: 'NONE',
    status: 'NOT_APPLIED',
    diagnostics: { iterations: null, tolerance: null, maxAbsoluteError: null, minWeight: null, maxWeight: null, effectiveCellCount: null },
  },
  unsupportedCharacteristics: ['Demographic and firmographic characteristics were not supplied as structured population data.'],
  coverageDate: null,
  populationFit: {
    scoreVersion: 'population-fit-v1',
    status: 'UNMEASURED',
    overall: null,
    components: { geographyCoverage: null, marginalCoverage: null, intersectionCoverage: null, sourceQuality: null, sourceRecency: null, weightingQuality: null },
    formula: 'No aggregate is calculated until supported population variables and source datasets are present.',
  },
  disclaimer: 'Demographic fit does not prove attitudinal accuracy. Synthetic results remain model-generated hypotheses until validated with real people.',
};

export const initialModelCard = {
  cardVersion: 'likerts-model-card-v1',
  purpose: 'Directional synthetic research for hypothesis generation and research planning.',
  permittedUse: 'Explore model-generated hypotheses before validation with real people.',
  prohibitedUses: ['Population estimation', 'Claims of observed attitudes', 'Synthetic confidence intervals'],
  populationGrounding: 'NONE',
  populationFrameHash: null,
  attitudinalValidation: 'NOT_VALIDATED',
  disclosure: initialPopulationFrame.disclaimer,
};

export const initialResearchDesign = {
  templateVersion: 'research-method-contract-v1',
  methodId: 'CONCEPT_TEST',
  methodVersion: 'concept-test-v1',
  designType: 'MONADIC_CONCEPT_TEST',
  estimand: 'Model-generated stated likelihood after exposure to one supplied concept',
  chartId: 'FIVE_POINT_CONCEPT_INTENT',
  resultKind: 'DIRECTIONAL_DISTRIBUTION',
  segmentPerspectiveEligible: true,
  stimulus: { id: 'concept-1', text: initialStudy.concept },
  instrument: {
    requiredInputs: ['concept stimulus', 'research question', 'intended audience'],
    includedQuestions: [
      { id: 'concept-intent', purpose: 'Explore stated likelihood after concept exposure.' },
      { id: 'concept-drivers', purpose: 'Surface model-generated reasons, objections, and uncertainties for human follow-up.' },
    ],
  },
  primaryOutcome: { id: 'top-two-box', label: 'Likely / very likely after concept exposure', value: 68, unit: 'percentage points of a model-generated directional distribution' },
  criticRubric: { id: 'concept-test-critic-v1', criteria: ['concept clarity', 'question neutrality', 'hypothetical-bias disclosure', 'no representative or human-response claims'] },
  humanValidation: { required: true, recommendedMethod: 'Monadic concept survey with cognitive interviews', rationale: 'Real participants must establish comprehension, relevance, intent, and objection incidence.', minimumChecks: ['stimulus comprehension', 'concept relevance', 'sampled adoption intent', 'open-ended objections'] },
  cautions: ['Concept intent is hypothetical and model-generated.'],
  disclosure: 'Method-specific output is model-generated direction, not a human measurement.',
};

export const initialResult = {
  title: 'Likelihood to adopt',
  summary: 'A majority of this audience responded positively to the idea in your research question.',
  takeaway: 'The illustrative panel suggests a positive directional signal. Use human follow-up research to test operational trade-offs and whether the preference persists under realistic constraints.',
  distribution: initialStudy.distribution,
  methodResult: {
    contractVersion: 'method-result-v1',
    kind: 'DIRECTIONAL_DISTRIBUTION',
    disclosure: 'Method-specific output is model-generated direction, not a human measurement.',
    accessibleLabel: 'Model-generated stated likelihood after exposure to one supplied concept',
    summary: 'A directional synthetic distribution for hypothesis exploration.',
    scale: { id: 'CONCEPT_INTENT_5', labels: responseScale.map((item) => item.label) },
    distribution: initialStudy.distribution,
  },
  confidence: 'Low',
  confidenceNote: 'Illustrative seed data shown before the first model-generated study.',
  audienceSummary: {
    audienceLabel: 'Knowledge workers',
    contextLabel: 'Global · Ages 25–54',
    attributes: [
      { label: 'Gender model', value: 'Female 52% · Male 48%' },
      { label: 'Age (mean)', value: '36' },
      { label: 'Work context', value: 'Illustrative global mix' },
    ],
  },
  segments: segmentRows,
  responses: syntheticResponses,
  populationFrame: initialPopulationFrame,
  modelCard: initialModelCard,
  researchDesign: initialResearchDesign,
  cautions: [
    'Illustrative data is not a human-panel estimate.',
    'Validate decisions with human research.',
  ],
  evidence: [
    {
      id: 'seed-distribution',
      claim: '68% likely',
      evidenceClass: 'Model inference',
      trace: 'Brief → illustrative panel → normalized distribution',
      risk: 'Not representative',
      sourceTitle: '',
      sourceUrl: '',
    },
    {
      id: 'seed-segment',
      claim: 'Remote-first segment shows higher simulated interest',
      evidenceClass: 'Model inference',
      trace: 'Audience frame → model-constructed segment',
      risk: 'Segment not sampled',
      sourceTitle: '',
      sourceUrl: '',
    },
    {
      id: 'seed-theme',
      claim: 'Workload and coverage clarity may shape intent',
      evidenceClass: 'Synthetic verbatim theme',
      trace: 'Generated explanations with scores 4–5',
      risk: 'Not customer testimony',
      sourceTitle: '',
      sourceUrl: '',
    },
  ],
  credibility: {
    evidenceCoverage: 0,
    populationFit: 'Unspecified',
    modelAgreement: null,
    status: 'Model-only',
    assumptionCount: 2,
  },
  methodology: {
    promptVersion: 'likerts.seed.v1',
    schemaVersion: '1.0',
    normalization: 'Percentages are normalized to sum to 100.',
    knownLimits: [
      'No observed human responses are included.',
      'Segments and verbatims are model-generated hypotheses.',
    ],
  },
  meta: {
    source: 'Illustrative demo',
    model: 'Seed dataset',
    runId: 'demo_seed',
    generatedAt: 'Illustrative seed',
    persistence: 'session',
    market: 'Global',
    outputLocale: 'en-US',
    lineage: [
      { role: 'Framing', model: 'Not run', provider: '—' },
      { role: 'Panel', model: 'Not run', provider: '—' },
      { role: 'Review', model: 'Not run', provider: '—' },
    ],
  },
};
