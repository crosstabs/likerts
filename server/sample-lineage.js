import { sampleStudies } from '../content/sample-studies.mjs';
import { requireLocaleCapability } from '../shared/localization.mjs';
import { normalizeLocalizationRequest } from './localization-request.js';

export const SAMPLE_LINEAGE_SCHEMA_VERSION = 'sample-lineage-v2';
export const SAMPLE_LINEAGE_SOURCE = 'static-sample-library';
export const SAMPLE_AUTOMATED_QA_SCOPE = 'sample-brief-contract';
export const SAMPLE_NATIVE_REVIEW_SCOPE = 'sample-brief-copy';
export const SAMPLE_STATIC_NATIVE_REVIEW_AUTHORITY = 'registry-declared';
export const SAMPLE_RELEASE_NATIVE_REVIEW_AUTHORITY = 'evidence-qualified';

export class SampleLineageError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = 'SampleLineageError';
    this.code = code;
    this.path = Object.freeze([...path]);
    this.publicMessage = message;
  }
}

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fail(code, path, message) {
  throw new SampleLineageError(code, path, message);
}

function originalLocalizationReceipt(sample) {
  const request = sample?.request || {};
  return normalizeLocalizationRequest({
    ...(sample?.localization || request.localization ? { localization: sample.localization || request.localization } : {}),
    ...(Object.hasOwn(request, 'market') ? { market: request.market } : {}),
    ...(Object.hasOwn(request, 'outputLocale') ? { outputLocale: request.outputLocale } : {}),
    ...(Object.hasOwn(request, 'sourceLanguages') ? { sourceLanguages: request.sourceLanguages } : {}),
    ...(Object.hasOwn(request, 'searchCountry') ? { searchCountry: request.searchCountry } : {}),
    ...(Object.hasOwn(request, 'searchLocation') ? { searchLocation: request.searchLocation } : {}),
  });
}

export function projectStaticSampleNativeReviewDeclaration(sampleLocale) {
  const declaredSampleStatus = sampleLocale?.release?.nativeReview?.statusByCapability?.sample;
  const declaredCopyStatus = sampleLocale?.release?.copyStatus;
  const nativeReviewed = declaredSampleStatus === 'native-reviewed'
    && declaredCopyStatus === 'native-reviewed';
  return {
    status: nativeReviewed ? 'native-reviewed' : 'review-pending',
    copyStatus: nativeReviewed
      ? 'native-reviewed'
      : declaredCopyStatus === 'unsupported'
        ? 'unsupported'
        : 'machine-drafted',
    authority: SAMPLE_STATIC_NATIVE_REVIEW_AUTHORITY,
    // Static sample artifacts cannot validate a signed packet, freshness, or
    // exact-build bindings. Their declared copy status is never a release claim.
    releaseEligible: false,
  };
}

export function projectSampleNativeReviewAuthority(sampleLocale, nativeReviewEligibility = null) {
  const declaredSampleStatus = sampleLocale?.release?.nativeReview?.statusByCapability?.sample;
  const declaredCopyStatus = sampleLocale?.release?.copyStatus;
  const evidenceEligible = nativeReviewEligibility?.status === 'ELIGIBLE'
    && nativeReviewEligibility?.releaseEligible === true;
  const nativeReviewed = evidenceEligible
    && declaredSampleStatus === 'native-reviewed'
    && declaredCopyStatus === 'native-reviewed';
  return {
    status: nativeReviewed ? 'native-reviewed' : 'review-pending',
    copyStatus: nativeReviewed
      ? 'native-reviewed'
      : declaredCopyStatus === 'unsupported'
        ? 'unsupported'
        : 'machine-drafted',
    authority: SAMPLE_RELEASE_NATIVE_REVIEW_AUTHORITY,
    releaseEligible: nativeReviewed,
  };
}

/**
 * Returns the sole accepted provenance record for a current static sample.
 * "passed" applies only to the catalogued brief contract; it never attests to
 * a generated run, observed responses, or human validation.
 */
export function canonicalSampleLineageForSample(sample) {
  if (!sample || typeof sample !== 'object') throw new TypeError('A registered sample is required for sample lineage.');
  const localizationReceipt = originalLocalizationReceipt(sample);
  const sampleLocale = requireLocaleCapability(sample.locale, 'sample');
  const declaredNativeReview = projectStaticSampleNativeReviewDeclaration(sampleLocale);
  return deepFreeze({
    schemaVersion: SAMPLE_LINEAGE_SCHEMA_VERSION,
    source: SAMPLE_LINEAGE_SOURCE,
    stableId: sample.stableId,
    slug: sample.slug,
    sampleSchemaVersion: sample.schemaVersion,
    localizationRegistryVersion: localizationReceipt.registryVersion,
    localizationReceipt,
    automatedQa: {
      status: 'passed',
      scope: SAMPLE_AUTOMATED_QA_SCOPE,
    },
    nativeReview: {
      status: declaredNativeReview.status,
      scope: SAMPLE_NATIVE_REVIEW_SCOPE,
      copyStatus: declaredNativeReview.copyStatus,
      authority: declaredNativeReview.authority,
      releaseEligible: declaredNativeReview.releaseEligible,
    },
  });
}

function registeredSampleFor(value) {
  if (!plainObject(value)) fail('INVALID_SAMPLE_LINEAGE', ['sampleLineage'], 'Sample lineage must be an object.');
  const stableId = typeof value.stableId === 'string' ? value.stableId : '';
  const slug = typeof value.slug === 'string' ? value.slug : '';
  const byStableId = sampleStudies.find((sample) => sample.stableId === stableId);
  const bySlug = sampleStudies.find((sample) => sample.slug === slug);
  if (!byStableId || !bySlug || byStableId !== bySlug) {
    fail('UNKNOWN_SAMPLE_LINEAGE', ['sampleLineage'], 'Sample lineage must identify one current registered public sample.');
  }
  return byStableId;
}

/**
 * Rejects caller-authored provenance unless it is byte-for-byte equivalent to
 * the current registered sample lineage. The run may still use edited prompt,
 * audience, market, or localization fields; this receipt records origin only.
 */
export function validateSampleLineage(value) {
  const sample = registeredSampleFor(value);
  const expected = canonicalSampleLineageForSample(sample);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail('SAMPLE_LINEAGE_CONFLICT', ['sampleLineage'], 'Sample lineage must match the current registered public sample and its original localization receipt.');
  }
  return expected;
}

export const sampleLineage = Object.freeze({
  canonicalSampleLineageForSample,
  projectStaticSampleNativeReviewDeclaration,
  validateSampleLineage,
});
