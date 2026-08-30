import { sampleStudies } from '../../content/sample-studies.mjs';
import { assertLocalizationExecutionAllowed, normalizeLocalizationRequest } from '../../server/localization-request.js';
import { canonicalSampleLineageForSample } from '../../server/sample-lineage.js';
import { initialStudy } from '../data.js';

const SAMPLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function canonicalInputFromReceipt(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    marketId: receipt.market.id,
    ...(receipt.market.countryCode && receipt.market.searchLocation !== receipt.market.label
      ? { searchLocation: receipt.market.searchLocation }
      : {}),
    reportLocale: receipt.report.locale,
    sourceLocales: [...receipt.source.locales],
    retrieval: { policy: receipt.retrieval.policy, locales: [...receipt.retrieval.locales] },
    instrumentLocale: receipt.instrument.locale,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rerunBlock(error, fallbackCode = 'LOCALIZATION_UNRESOLVED') {
  const code = typeof error?.code === 'string' ? error.code : fallbackCode;
  return Object.freeze({
    code,
    message: `This sample cannot be rerun because its localization is unresolved (${code}).`,
  });
}

function sampleQuality(sampleLineage) {
  return {
    automatedQa: {
      status: sampleLineage.automatedQa.status,
      scope: sampleLineage.automatedQa.scope,
    },
    nativeReview: {
      status: sampleLineage.nativeReview.status,
      scope: sampleLineage.nativeReview.scope,
      copyStatus: sampleLineage.nativeReview.copyStatus,
    },
  };
}

// Static samples use the generic Likert contract unless and until their
// registry declares a method-specific configuration. Do not inherit the
// interactive new-study defaults, which include an unrelated English concept.
const generalLikertMethodFields = Object.freeze({
  researchMethod: 'GENERAL_LIKERT',
  concept: '',
  offer: '',
  category: '',
  priceAmount: '',
  currency: '',
  priceUnit: '',
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
  featureItems: [],
  decisionContext: '',
  selectionConstraint: '',
  focalBrand: '',
  comparatorBrands: [],
  brandAttributes: [],
  pricePoints: [],
  studyObjective: '',
  targetPopulation: '',
  surveyQuestions: [],
  researchObjective: '',
  participantContext: '',
  interviewTopics: [],
  sensitiveAreas: [],
});

function resolveSampleLocalization(sample) {
  const request = sample?.request || {};
  const suppliedCanonical = request.localization || sample?.localization;
  // Do not let the legacy request normalizer apply its old English/Global
  // defaults. A legacy sample is only rerunnable when all locale aliases are
  // explicitly present and can be resolved deterministically.
  if (!suppliedCanonical && (!Object.hasOwn(request, 'market')
    || !Object.hasOwn(request, 'outputLocale')
    || !Array.isArray(request.sourceLanguages))) {
    return { receipt: null, block: rerunBlock(null) };
  }
  let receipt;
  try {
    const legacyAliases = Object.fromEntries(
      ['market', 'outputLocale', 'sourceLanguages', 'searchCountry', 'searchLocation']
        .filter((field) => Object.hasOwn(request, field))
        .map((field) => [field, request[field]]),
    );
    receipt = normalizeLocalizationRequest({
      ...(suppliedCanonical ? { localization: suppliedCanonical } : {}),
      ...legacyAliases,
    });
    assertLocalizationExecutionAllowed(receipt);
    return { receipt, block: null };
  } catch (error) {
    return { receipt: receipt || null, block: rerunBlock(error) };
  }
}

function unresolvedStudy(request, block, receipt = null) {
  return {
    ...initialStudy,
    prompt: typeof request.prompt === 'string' ? request.prompt : '',
    audience: typeof request.audience === 'string' ? request.audience : '',
    market: typeof request.market === 'string' ? request.market : '',
    outputLocale: typeof request.outputLocale === 'string' ? request.outputLocale : '',
    sourceLanguages: Array.isArray(request.sourceLanguages) ? [...request.sourceLanguages] : [],
    panelSize: Number.isInteger(request.panelSize) ? request.panelSize : initialStudy.panelSize,
    researchMode: String(request.researchMode || initialStudy.researchMode).toLowerCase(),
    sources: [],
    assumptions: typeof request.assumptions === 'string' ? request.assumptions : '',
    sampleQuality: {
      automatedQa: { status: 'pending', checkedAt: null },
      nativeReview: { status: 'unresolved', reviewer: null, reviewedAt: null, glossaryVersion: null, copyStatus: 'unresolved' },
    },
    sampleRerunBlock: block,
    ...(receipt ? {
      localization: canonicalInputFromReceipt(receipt),
      localizationReceipt: clone(receipt),
      localizationRegistryVersion: receipt.registryVersion,
    } : {}),
  };
}

export function sampleStudyPrefillFromSearch(search, studies = sampleStudies) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const sampleValues = params.getAll('sample');
  if (sampleValues.length !== 1) return null;

  const sampleSlug = sampleValues[0];
  if (sampleSlug.length > 100 || !SAMPLE_SLUG.test(sampleSlug)) return null;
  const sample = studies.find((candidate) => candidate.slug === sampleSlug);
  if (!sample) return null;

  const request = sample.request || {};
  const { receipt, block } = resolveSampleLocalization(sample);
  if (block) {
    return {
      sampleSlug,
      shouldOpenBrief: true,
      shouldRun: false,
      rerunBlocked: block,
      study: unresolvedStudy(request, block, receipt),
    };
  }
  const localization = canonicalInputFromReceipt(receipt);
  let sampleLineage;
  try {
    sampleLineage = canonicalSampleLineageForSample(sample);
  } catch (error) {
    const lineageBlock = rerunBlock(error, 'SAMPLE_LINEAGE_UNRESOLVED');
    return {
      sampleSlug,
      shouldOpenBrief: true,
      shouldRun: false,
      rerunBlocked: lineageBlock,
      study: unresolvedStudy(request, lineageBlock),
    };
  }
  return {
    sampleSlug,
    shouldOpenBrief: true,
    shouldRun: false,
    rerunBlocked: null,
    study: {
      ...initialStudy,
      ...generalLikertMethodFields,
      prompt: request.prompt,
      audience: request.audience,
      market: receipt.market.label,
      outputLocale: receipt.report.locale,
      sourceLanguages: [...receipt.source.locales],
      retrievalPolicy: receipt.retrieval.policy,
      retrievalLocales: [...receipt.retrieval.locales],
      instrumentLocale: receipt.instrument.locale === receipt.report.locale ? '' : receipt.instrument.locale,
      localization,
      localizationReceipt: clone(receipt),
      localizationRegistryVersion: receipt.registryVersion,
      sampleLineage,
      sampleQuality: sampleQuality(sampleLineage),
      panelSize: request.panelSize,
      researchMode: String(request.researchMode || 'quick').toLowerCase(),
      sources: [...(request.sourceUrls || [])],
      assumptions: request.assumptions || '',
    },
  };
}
