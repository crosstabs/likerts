import { buildLocalizationScorecard } from './localization-scorecard.js';
import { CJK_NATIVE_REVIEW_PROGRAM, nativeReviewProgramContract } from './native-review-evidence.js';

const BROWSER_RELEASE_EVIDENCE_FIELDS = Object.freeze([
  'journeyAttestation',
  'journeyPromotion',
  'trustedPromotionKeys',
  'buildIdentity',
]);

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function releaseEvidenceScorecardOptions(context) {
  if (context === null || context === undefined) return {};
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || !Object.hasOwn(context, 'nativeReviewEvidenceByLocale')
    || !Object.hasOwn(context, 'nativeReviewBindingsByLocale')
    || !Object.hasOwn(context, 'trustedNativeReviewerKeys')
    || !Object.keys(context).every((key) => [
      'nativeReviewProgram',
      'nativeReviewEvidenceByLocale',
      'nativeReviewBindingsByLocale',
      'trustedNativeReviewerKeys',
      ...BROWSER_RELEASE_EVIDENCE_FIELDS,
    ].includes(key))
    || !plainRecord(context.nativeReviewEvidenceByLocale)
    || !plainRecord(context.nativeReviewBindingsByLocale)
    || !plainRecord(context.trustedNativeReviewerKeys)) {
    throw new TypeError('Localization release-evidence provider returned an invalid native-review context.');
  }
  const options = {
    nativeReviewProgram: context.nativeReviewProgram ?? CJK_NATIVE_REVIEW_PROGRAM,
    nativeReviewEvidenceByLocale: context.nativeReviewEvidenceByLocale,
    nativeReviewBindingsByLocale: context.nativeReviewBindingsByLocale,
    trustedNativeReviewerKeys: context.trustedNativeReviewerKeys,
  };
  if (!nativeReviewProgramContract(options.nativeReviewProgram)) {
    throw new TypeError('Localization release-evidence provider returned an unsupported native-review program.');
  }
  const suppliedBrowserFields = BROWSER_RELEASE_EVIDENCE_FIELDS.filter(
    (field) => Object.hasOwn(context, field),
  );
  if (suppliedBrowserFields.length === 0) return options;
  if (suppliedBrowserFields.length !== BROWSER_RELEASE_EVIDENCE_FIELDS.length) {
    throw new TypeError('Localization release-evidence provider returned a partial browser context.');
  }
  return {
    ...options,
    journeyAttestation: context.journeyAttestation,
    journeyPromotion: context.journeyPromotion,
    trustedPromotionKeys: context.trustedPromotionKeys,
    buildIdentity: context.buildIdentity,
  };
}

export function buildLocalizationScorecardFromReleaseEvidence(context, { now = new Date() } = {}) {
  const options = releaseEvidenceScorecardOptions(context);
  const scorecard = buildLocalizationScorecard({
    ...options,
    now,
  });
  const browserEvidenceSupplied = BROWSER_RELEASE_EVIDENCE_FIELDS.every((field) => Object.hasOwn(context || {}, field));
  if (browserEvidenceSupplied && scorecard.automatedJourneyVerification.status !== 'PUBLISHED') {
    throw new TypeError('Localization release-evidence browser context did not project as published evidence.');
  }
  return scorecard;
}
