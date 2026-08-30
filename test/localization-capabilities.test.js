import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASEAN_LANGUAGE_LOCALE_IDS,
  LOCALIZATION_CAPABILITIES,
  LOCALIZATION_CAPABILITY_STATUSES,
  LocalizationCapabilityError,
  LOCALIZATION_REGISTRY_VERSION,
  LOCALIZATION_RELEASE_STATUSES,
  LOCALE_CAPABILITIES,
  MARKET_CAPABILITIES,
  MARKET_SUPPORT_MODES,
  assertLocaleReleaseInvariants,
  assertLocalizationRegistryInvariants,
  isAttitudinalValidationEligible,
  isLocaleReleaseEligible,
  listLocalesForCapability,
  marketLocaleSupport,
  requireLocaleCapability,
  requireNativeReviewedLocale,
  resolveMarket,
} from '../shared/localization.mjs';

const localizedOutputOnlyLocales = ['es-ES', 'pt-BR', 'fr-FR', 'de-DE', 'ar-SA', 'hi-IN'];

test('the localization registry exposes one immutable CJK and ASEAN capability matrix', () => {
  assert.equal(LOCALIZATION_REGISTRY_VERSION, 'localization-capabilities-v2');
  assert.equal(Object.isFrozen(LOCALE_CAPABILITIES), true);
  assert.equal(Object.isFrozen(MARKET_CAPABILITIES), true);

  for (const locale of ['zh-CN', 'ja-JP', 'ko-KR']) {
    const entry = LOCALE_CAPABILITIES[locale];
    assert.ok(entry, `${locale} must be registered.`);
    assert.equal(Object.isFrozen(entry), true);
    assert.deepEqual(entry.capabilities, {
      ui: 'enabled',
      report: 'enabled',
      source: 'enabled',
      retrieval: 'enabled',
      instrument: 'enabled',
      sample: 'enabled',
    });
    assert.equal(entry.release.copyStatus, 'machine-drafted');
    assert.equal(entry.release.nativeReview.status, 'review-pending');
    assert.equal(entry.release.attitudinalValidationStatus, 'unsupported');
    assert.equal(isLocaleReleaseEligible(entry, 'ui'), false);
  }

  assert.deepEqual(
    ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN'].filter((id) => MARKET_CAPABILITIES[id]),
    ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN'],
  );
  assert.equal(MARKET_CAPABILITIES.GLOBAL.retrievalGeography, null);
  assert.deepEqual(MARKET_CAPABILITIES.GLOBAL.retrievalLocations, []);
  assert.equal(MARKET_CAPABILITIES.GLOBAL.currencyCode, null);
  assert.ok(Object.values(MARKET_CAPABILITIES).filter((market) => market.id !== 'GLOBAL').every((market) => /^[A-Z]{3}$/.test(market.currencyCode)));
});

test('non-CJK localized output locales fail closed for interface UI only', () => {
  for (const locale of localizedOutputOnlyLocales) {
    const entry = LOCALE_CAPABILITIES[locale];
    assert.ok(entry, `${locale} must be registered.`);
    assert.deepEqual(entry.capabilities, {
      ui: 'planned',
      report: 'enabled',
      source: 'enabled',
      retrieval: 'enabled',
      instrument: 'enabled',
      sample: 'enabled',
    });
    assert.equal(entry.release.copyStatus, 'machine-drafted');
    assert.equal(entry.release.nativeReview.status, 'review-pending');
    assert.equal(isLocaleReleaseEligible(entry, 'ui'), false);
    assert.throws(
      () => requireLocaleCapability(locale, 'ui'),
      (error) => error instanceof LocalizationCapabilityError
        && error.code === 'UNSUPPORTED_UI_LOCALE'
        && error.locale === locale
        && error.status === LOCALIZATION_CAPABILITY_STATUSES.PLANNED,
    );
    for (const capability of ['report', 'source', 'retrieval', 'instrument', 'sample']) {
      assert.equal(requireLocaleCapability(locale, capability), entry);
    }
  }

  assert.ok(localizedOutputOnlyLocales.every((locale) => !listLocalesForCapability('ui').some((entry) => entry.id === locale)));
  assert.ok(localizedOutputOnlyLocales.every((locale) => listLocalesForCapability('report').some((entry) => entry.id === locale)));
  assert.ok(localizedOutputOnlyLocales.every((locale) => listLocalesForCapability('sample').some((entry) => entry.id === locale)));
});

test('ASEAN language locales remain planned and runtime-disabled', () => {
  for (const locale of ASEAN_LANGUAGE_LOCALE_IDS) {
    const entry = LOCALE_CAPABILITIES[locale];
    assert.ok(entry, `${locale} must be represented in the rollout plan.`);
    assert.deepEqual(new Set(Object.values(entry.capabilities)), new Set(['planned']));
    assert.equal(entry.release.copyStatus, 'unsupported');
    assert.equal(Object.isFrozen(entry.capabilities), true);
    assert.equal(Object.isFrozen(entry.scriptPolicy.expected), true);
    for (const capability of LOCALIZATION_CAPABILITIES) {
      assert.throws(
        () => requireLocaleCapability(locale, capability),
        (error) => error instanceof LocalizationCapabilityError
          && error.code === `UNSUPPORTED_${capability.toUpperCase()}_LOCALE`
          && error.status === 'planned',
      );
    }
  }
});

test('locale capability resolution is canonical and fails closed', () => {
  assert.equal(requireLocaleCapability('zh-cn', 'report'), LOCALE_CAPABILITIES['zh-CN']);
  assert.equal(requireLocaleCapability('ja', 'retrieval'), LOCALE_CAPABILITIES['ja-JP']);
  assert.equal(requireLocaleCapability('zh-Hans-CN', 'ui'), LOCALE_CAPABILITIES['zh-CN']);
  assert.deepEqual(
    listLocalesForCapability('report').filter((entry) => ['zh-CN', 'ja-JP', 'ko-KR'].includes(entry.id)).map((entry) => entry.id),
    ['zh-CN', 'ja-JP', 'ko-KR'],
  );
  assert.equal(listLocalesForCapability('report').some((entry) => entry.id === 'id-ID'), false);

  assert.throws(
    () => requireLocaleCapability('id-ID', 'report'),
    (error) => error instanceof LocalizationCapabilityError
      && error.code === 'UNSUPPORTED_REPORT_LOCALE'
      && error.locale === 'id-ID'
      && error.status === 'planned',
  );
  assert.throws(
    () => requireLocaleCapability('fr-CA', 'report'),
    (error) => error instanceof LocalizationCapabilityError && error.code === 'UNKNOWN_LOCALE',
  );
  assert.throws(
    () => requireLocaleCapability('ASEAN', 'report'),
    (error) => error instanceof LocalizationCapabilityError && error.code === 'UNKNOWN_LOCALE',
  );
  assert.throws(
    () => requireNativeReviewedLocale('zh-CN', 'ui'),
    (error) => error instanceof LocalizationCapabilityError
      && error.code === 'NATIVE_REVIEW_REQUIRED'
      && error.status === 'review-pending',
  );
});

test('market resolution supports stable IDs and declared aliases without a Global fallback', () => {
  assert.equal(assertLocalizationRegistryInvariants(), true);
  for (const [value, id] of [
    ['jp', 'JP'], ['Japan', 'JP'], ['Singapore', 'SG'], ['Indonesia', 'ID'],
    ['Malaysia', 'MY'], ['Thailand', 'TH'], ['Viet Nam', 'VN'], ['Philippines', 'PH'],
  ]) {
    const entry = resolveMarket(value);
    assert.equal(entry, MARKET_CAPABILITIES[id]);
    assert.equal(entry.retrievalGeography.countryCode, id);
  }
  assert.equal(resolveMarket('Global').retrievalGeography, null);
  assert.deepEqual(MARKET_CAPABILITIES.JP.retrievalLocations, ['Japan', 'Tokyo']);
  assert.deepEqual(MARKET_CAPABILITIES.SG.preferredRetrievalLanguages, ['en', 'ms', 'zh', 'ta']);
  assert.equal(MARKET_CAPABILITIES.SG.currencyCode, 'SGD');
  assert.deepEqual(MARKET_CAPABILITIES.MY.primaryLocaleIds, ['ms-MY', 'en-MY']);
  assert.equal(marketLocaleSupport(MARKET_CAPABILITIES.GLOBAL).supportMode, MARKET_SUPPORT_MODES.GLOBAL_SCOPE);
  assert.equal(marketLocaleSupport(MARKET_CAPABILITIES.SG).supportMode, MARKET_SUPPORT_MODES.MARKET_ROUTING_ONLY);
  assert.equal(marketLocaleSupport(MARKET_CAPABILITIES.ES).supportMode, MARKET_SUPPORT_MODES.MARKET_AND_LOCALIZED_OUTPUT);
  assert.equal(Object.values(MARKET_CAPABILITIES).some((market) => market.preferredRetrievalLanguages.includes('en-US')), false);
  assert.deepEqual(
    ['ID', 'MY', 'PH', 'TH', 'VN'].map((id) => MARKET_CAPABILITIES[id].status),
    ['planned', 'planned', 'planned', 'planned', 'planned'],
  );
  assert.deepEqual(
    ['BN', 'KH', 'LA', 'MM'].map((id) => MARKET_CAPABILITIES[id].status),
    ['roadmap', 'roadmap', 'roadmap', 'roadmap'],
  );

  assert.throws(
    () => resolveMarket('Quebec retail'),
    (error) => error instanceof LocalizationCapabilityError
      && error.code === 'UNKNOWN_MARKET'
      && error.market === 'Quebec retail',
  );
});

function reviewedRelease() {
  return {
    copyStatus: LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED,
    nativeReview: {
      status: LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED,
      reviewer: 'reviewer-1',
      reviewedAt: '2026-08-01T00:00:00Z',
      glossaryVersion: 'glossary-v1',
      capabilityScope: [...LOCALIZATION_CAPABILITIES],
      reviewedProductVersion: 'product-v1',
      reviewedPromptVersion: 'prompt-v1',
      findingsLog: [],
      blockingFindingsResolved: true,
      statusByCapability: Object.fromEntries(LOCALIZATION_CAPABILITIES.map((capability) => [capability, LOCALIZATION_RELEASE_STATUSES.NATIVE_REVIEWED])),
    },
    populationEvidenceStatus: LOCALIZATION_RELEASE_STATUSES.UNMEASURED,
    attitudinalValidationStatus: LOCALIZATION_RELEASE_STATUSES.UNSUPPORTED,
    attitudinalValidationEvidence: null,
  };
}

test('all CJK and ASEAN capability cells preserve their release boundary', () => {
  assertLocalizationRegistryInvariants();
  for (const id of ['zh-CN', 'ja-JP', 'ko-KR']) {
    const row = LOCALE_CAPABILITIES[id];
    assert.deepEqual(Object.values(row.capabilities), LOCALIZATION_CAPABILITIES.map(() => 'enabled'));
    assert.equal(row.release.copyStatus, 'machine-drafted');
    assert.equal(row.release.nativeReview.status, 'review-pending');
    assert.deepEqual(Object.values(row.release.nativeReview.statusByCapability), LOCALIZATION_CAPABILITIES.map(() => 'review-pending'));
    assert.equal(isAttitudinalValidationEligible(row), false);
  }
  for (const id of ASEAN_LANGUAGE_LOCALE_IDS) {
    const row = LOCALE_CAPABILITIES[id];
    assert.ok(row, `${id} must remain represented.`);
    assert.ok(Object.values(row.capabilities).every((status) => status === 'planned'));
    assert.equal(row.release.copyStatus, 'unsupported');
    assert.equal(row.release.nativeReview.status, 'review-pending');
    assert.equal(row.release.attitudinalValidationStatus, 'unsupported');
    assert.equal(isAttitudinalValidationEligible(row), false);
  }
});

test('native review and attitudinal claims fail closed without structured evidence', () => {
  const missingReviewVersion = structuredClone(LOCALE_CAPABILITIES['zh-CN']);
  missingReviewVersion.release = reviewedRelease();
  missingReviewVersion.release.nativeReview.reviewedProductVersion = null;
  assert.throws(() => assertLocaleReleaseInvariants(missingReviewVersion), /reviewed product version/);

  const invalidReviewDate = structuredClone(LOCALE_CAPABILITIES['zh-CN']);
  invalidReviewDate.release = reviewedRelease();
  invalidReviewDate.release.nativeReview.reviewedAt = '2026-02-30';
  assert.throws(() => assertLocaleReleaseInvariants(invalidReviewDate), /valid review date/);

  const openBlocker = structuredClone(LOCALE_CAPABILITIES['zh-CN']);
  openBlocker.release = reviewedRelease();
  openBlocker.release.nativeReview.findingsLog = [{ id: 'finding-1', severity: 'blocking', status: 'open', summary: 'Unresolved terminology issue' }];
  assert.throws(() => assertLocaleReleaseInvariants(openBlocker), /blocking findings/);

  const incoherentAggregate = structuredClone(LOCALE_CAPABILITIES['zh-CN']);
  incoherentAggregate.release = reviewedRelease();
  incoherentAggregate.release.nativeReview.status = LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING;
  assert.throws(() => assertLocaleReleaseInvariants(incoherentAggregate), /aggregate native-review status/);

  const statusOnlyValidation = structuredClone(LOCALE_CAPABILITIES['zh-CN']);
  statusOnlyValidation.release = reviewedRelease();
  statusOnlyValidation.release.attitudinalValidationStatus = LOCALIZATION_RELEASE_STATUSES.VALIDATED;
  statusOnlyValidation.release.attitudinalValidationEvidence = null;
  assert.equal(isAttitudinalValidationEligible(statusOnlyValidation), false);
  assert.throws(() => assertLocaleReleaseInvariants(statusOnlyValidation), /held-out validation evidence/);

  const incompleteValidation = structuredClone(LOCALE_CAPABILITIES['zh-CN']);
  incompleteValidation.release = reviewedRelease();
  incompleteValidation.release.attitudinalValidationStatus = LOCALIZATION_RELEASE_STATUSES.VALIDATED;
  incompleteValidation.release.attitudinalValidationEvidence = {
    comparisonId: 'comparison-1',
    calibrationDate: '2026-08-02',
    calibrationScope: { marketId: 'CN', locale: 'zh-CN', population: 'knowledge workers', method: 'CONCEPT_TEST', questionTypes: ['CONCEPT_INTENT'], wording: 'wording-v1', scale: 'five-point', fieldDates: { start: '2026-07-01', end: '2026-07-31' } },
  };
  assert.equal(isAttitudinalValidationEligible(incompleteValidation), true);
  const missingQuestionTypes = structuredClone(incompleteValidation);
  delete missingQuestionTypes.release.attitudinalValidationEvidence.calibrationScope.questionTypes;
  assert.equal(isAttitudinalValidationEligible(missingQuestionTypes), false);
  incompleteValidation.release.attitudinalValidationEvidence.calibrationScope.fieldDates.end = '';
  assert.equal(isAttitudinalValidationEligible(incompleteValidation), false);
  assert.throws(() => assertLocaleReleaseInvariants(incompleteValidation), /held-out validation evidence/);

  const mismatchedValidation = structuredClone(LOCALE_CAPABILITIES['zh-CN']);
  mismatchedValidation.release = reviewedRelease();
  mismatchedValidation.release.attitudinalValidationStatus = LOCALIZATION_RELEASE_STATUSES.VALIDATED;
  mismatchedValidation.release.attitudinalValidationEvidence = {
    comparisonId: 'comparison-1',
    calibrationDate: '2026-08-02',
    calibrationScope: { marketId: 'ID', locale: 'ja-JP', population: 'knowledge workers', method: 'CONCEPT_TEST', questionTypes: ['CONCEPT_INTENT'], wording: 'wording-v1', scale: 'five-point', fieldDates: { start: '2026-07-01', end: '2026-07-31' } },
  };
  assert.equal(isAttitudinalValidationEligible(mismatchedValidation), false);
  assert.throws(() => assertLocaleReleaseInvariants(mismatchedValidation), /held-out validation evidence/);

  const crossMarketValidation = structuredClone(LOCALE_CAPABILITIES['zh-CN']);
  crossMarketValidation.release = reviewedRelease();
  crossMarketValidation.release.attitudinalValidationStatus = LOCALIZATION_RELEASE_STATUSES.VALIDATED;
  crossMarketValidation.release.attitudinalValidationEvidence = {
    comparisonId: 'comparison-2',
    calibrationDate: '2026-08-02',
    calibrationScope: { marketId: 'US', locale: 'zh-CN', population: 'knowledge workers', method: 'CONCEPT_TEST', questionTypes: ['CONCEPT_INTENT'], wording: 'wording-v1', scale: 'five-point', fieldDates: { start: '2026-07-01', end: '2026-07-31' } },
  };
  assert.equal(isAttitudinalValidationEligible(crossMarketValidation), false);
  assert.throws(() => assertLocaleReleaseInvariants(crossMarketValidation), /held-out validation evidence/);
});
