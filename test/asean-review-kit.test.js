import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ASEAN_LANGUAGE_LOCALE_IDS,
  ASEAN_MARKET_IDS,
  LOCALIZATION_CAPABILITIES,
  LOCALIZATION_RELEASE_STATUSES,
  MARKET_CAPABILITIES,
  LOCALE_CAPABILITIES,
} from '../shared/localization.mjs';
import {
  ASEAN_COMPLETED_REVIEW_PACKET_SCHEMA_VERSION,
  ASEAN_COMPLETED_REVIEW_PACKET_VERSION,
  ASEAN_NATIVE_REVIEW_PROGRAM,
  nativeReviewProgramContract,
} from '../server/native-review-evidence.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const glossary = readJson('../docs/localization-review-kit/asean-glossary-v1.json');
const packet = readJson('../docs/localization-review-kit/asean-review-packet-v1.json');
const evidenceTemplate = readJson('../docs/localization-review-kit/asean-native-review-evidence-template.json');

const EXPECTED_LOCALES = [
  'en-SG', 'ms-SG', 'zh-Hans-SG', 'ta-SG',
  'id-ID', 'ms-MY', 'en-MY', 'fil-PH', 'en-PH', 'th-TH', 'vi-VN',
  'ms-BN', 'km-KH', 'lo-LA', 'my-MM',
];
const EXPECTED_MARKETS = ['SG', 'ID', 'MY', 'PH', 'TH', 'VN', 'BN', 'KH', 'LA', 'MM'];
const EXPECTED_SCRIPTS = {
  'en-SG': ['Latin'], 'ms-SG': ['Latin'], 'zh-Hans-SG': ['Han'], 'ta-SG': ['Tamil'],
  'id-ID': ['Latin'], 'ms-MY': ['Latin'], 'en-MY': ['Latin'], 'fil-PH': ['Latin'], 'en-PH': ['Latin'],
  'th-TH': ['Thai'], 'vi-VN': ['Latin'], 'ms-BN': ['Latin'], 'km-KH': ['Khmer'],
  'lo-LA': ['Lao'], 'my-MM': ['Myanmar'],
};

test('ASEAN rollout assets are versioned and have exact ordered coverage', () => {
  assert.equal(glossary.schemaVersion, 'likerts-native-review-glossary-v1');
  assert.equal(glossary.glossaryVersion, 'asean-glossary-v1.0.0');
  assert.equal(glossary.status, 'unsupported');
  assert.equal(glossary.translationStatus, 'not-provided');
  assert.deepEqual(glossary.requiredSections, ['provenance', 'capabilities', 'reviewRules', 'surveyMethods', 'termInventory', 'locales']);
  assert.deepEqual(glossary.capabilities, LOCALIZATION_CAPABILITIES);

  assert.equal(packet.schemaVersion, 'likerts-native-review-packet-v1');
  assert.equal(packet.packetVersion, 'asean-review-packet-v1.0.0');
  assert.equal(packet.status, 'review-pending');
  assert.equal(packet.copyStatus, 'unsupported');
  assert.equal(packet.translationStatus, 'not-provided');
  assert.equal(packet.sourceArtifacts.nativeReviewEvidenceTemplate, 'docs/localization-review-kit/asean-native-review-evidence-template.json');
  assert.deepEqual(packet.locales, EXPECTED_LOCALES);
  assert.deepEqual(packet.markets, EXPECTED_MARKETS);
  assert.deepEqual(packet.capabilities, LOCALIZATION_CAPABILITIES);
  for (const section of packet.requiredSections) assert.ok(packet[section], `missing packet section ${section}`);
  assert.deepEqual(packet.rolloutOrder.firstLocales, ['en-SG', 'ms-SG', 'zh-Hans-SG', 'ta-SG']);
  assert.deepEqual(packet.rolloutOrder.nextLocales, ['id-ID', 'ms-MY', 'en-MY', 'fil-PH', 'en-PH', 'th-TH', 'vi-VN']);
  assert.deepEqual(packet.rolloutOrder.roadmapLocales, ['ms-BN', 'km-KH', 'lo-LA', 'my-MM']);

  const contract = nativeReviewProgramContract(ASEAN_NATIVE_REVIEW_PROGRAM);
  assert.equal(packet.completedPacketSchema.schemaVersion, ASEAN_COMPLETED_REVIEW_PACKET_SCHEMA_VERSION);
  assert.equal(packet.completedPacketSchema.packetVersion, ASEAN_COMPLETED_REVIEW_PACKET_VERSION);
  assert.equal(packet.completedPacketSchema.reviewProgram, ASEAN_NATIVE_REVIEW_PROGRAM);
  assert.equal(packet.completedPacketSchema.status, 'completed');
  assert.deepEqual(contract.localeIds, ASEAN_LANGUAGE_LOCALE_IDS);
  assert.deepEqual(packet.completedPacketSchema.evidenceRecordFields, ['id', 'kind', 'summary', 'contentDigest']);
  assert.match(packet.completedPacketSchema.evidenceContentBinding, /does not fetch.*independently verify/i);
  assert.match(packet.completedPacketSchema.releaseBoundary, /never enables a locale/i);
  assert.equal(evidenceTemplate.artifact.reviewProgram, ASEAN_NATIVE_REVIEW_PROGRAM);
  assert.equal(evidenceTemplate.artifact.glossaryVersion, contract.glossaryVersion);
  assert.equal(evidenceTemplate.artifact.locale, null);
  assert.equal(evidenceTemplate.signature, null);
});

test('packet and glossary locale records match the shared registry without enabling locales', () => {
  assert.deepEqual(Object.keys(glossary.locales), EXPECTED_LOCALES);
  const matrixByLocale = new Map(packet.localeMatrix.map((entry) => [entry.locale, entry]));
  assert.equal(matrixByLocale.size, EXPECTED_LOCALES.length);

  for (const localeId of EXPECTED_LOCALES) {
    assert.ok(ASEAN_LANGUAGE_LOCALE_IDS.includes(localeId));
    const registryEntry = LOCALE_CAPABILITIES[localeId];
    const matrix = matrixByLocale.get(localeId);
    const glossaryEntry = glossary.locales[localeId];
    assert.ok(registryEntry, `missing registry locale ${localeId}`);
    assert.equal(matrix.market, registryEntry.marketId);
    assert.deepEqual(matrix.expectedScripts, registryEntry.scriptPolicy.expected);
    assert.deepEqual(matrix.capabilities, registryEntry.capabilities);
    assert.equal(matrix.copyStatus, registryEntry.release.copyStatus);
    assert.equal(matrix.nativeReviewStatus, registryEntry.release.nativeReview.status);
    assert.equal(matrix.copyStatus, LOCALIZATION_RELEASE_STATUSES.UNSUPPORTED);
    assert.equal(matrix.nativeReviewStatus, LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING);
    assert.equal(matrix.reviewer, null);
    assert.equal(matrix.reviewedAt, null);
    assert.equal(glossaryEntry.market, registryEntry.marketId);
    assert.deepEqual([glossaryEntry.script], registryEntry.scriptPolicy.expected);
    assert.equal(glossaryEntry.translationStatus, 'not-provided');
    assert.equal(glossaryEntry.reviewStatus, 'review-pending');
    assert.equal(glossaryEntry.reviewer, null);
    assert.equal(glossaryEntry.reviewedAt, null);
    for (const capability of LOCALIZATION_CAPABILITIES) {
      assert.equal(registryEntry.capabilities[capability], 'planned', `${localeId}/${capability}`);
      assert.equal(registryEntry.release.nativeReview.statusByCapability[capability], 'review-pending', `${localeId}/${capability} review`);
    }
  }
  for (const [localeId, scripts] of Object.entries(EXPECTED_SCRIPTS)) assert.deepEqual(matrixByLocale.get(localeId).expectedScripts, scripts);
});

test('market routing is distinct from locale support and matches registry values', () => {
  assert.deepEqual(packet.marketsRouting.map((entry) => entry.market), EXPECTED_MARKETS);
  for (const route of packet.marketsRouting) {
    assert.ok(ASEAN_MARKET_IDS.includes(route.market));
    const registryMarket = MARKET_CAPABILITIES[route.market];
    assert.equal(route.registryStatus, registryMarket.status);
    assert.equal(route.countryCode, registryMarket.countryCode);
    assert.equal(route.retrievalGeography, registryMarket.retrievalGeography.countryCode);
    assert.deepEqual(route.primaryLocales, registryMarket.primaryLocaleIds);
    assert.equal(route.localeSupport, 'none');
    assert.match(route.supportMode, /^MARKET_(?:ROUTING_ONLY|ROUTING_PLANNED_ONLY|ROADMAP_ONLY)$/);
  }
  assert.equal(packet.marketLocaleBoundary.currentConclusion.includes('No ASEAN locale is runnable'), true);
  assert.match(packet.marketLocaleBoundary.marketRoutingMeaning, /planned and roadmap market records.*rejected at runtime/i);
  assert.equal(packet.marketsRouting[0].supportMode, 'MARKET_ROUTING_ONLY');
});

test('each capability has exact fail-closed enablement evidence and no approval record', () => {
  const current = packet.localeCapabilityEvidence.current;
  assert.deepEqual(Object.keys(current).sort(), ['copyStatus', 'enabled', 'evidenceReference', 'nativeReviewStatus', 'registryStatus'].sort());
  assert.deepEqual(current, { registryStatus: 'planned', copyStatus: 'unsupported', nativeReviewStatus: 'review-pending', enabled: false, evidenceReference: null });
  for (const localeId of EXPECTED_LOCALES) {
    for (const capability of LOCALIZATION_CAPABILITIES) {
      assert.equal(LOCALE_CAPABILITIES[localeId].capabilities[capability], current.registryStatus);
      assert.equal(current.enabled, false);
      assert.equal(current.evidenceReference, null);
    }
  }
  assert.equal(packet.reviewerRecordTemplate.reviewer, null);
  assert.equal(packet.reviewerRecordTemplate.capability, null);
  assert.equal(packet.reviewerRecordTemplate.reviewedAt, null);
  assert.equal(packet.reviewerRecordTemplate.registryVersion, 'localization-capabilities-v2');
  assert.equal(packet.reviewerRecordTemplate.approvalReference, null);
  assert.equal(packet.reviewerRecordTemplate.evidenceReference, null);
  assert.equal(packet.reviewerRecordTemplate.blockingFindingsResolved, false);
  assert.equal(glossary.provenance.humanReviewer, null);
  assert.equal(glossary.provenance.humanReviewDate, null);
  assert.equal(glossary.provenance.approvalReference, null);
});

test('review findings have an explicit lossless-enough projection into registry metadata', () => {
  assert.ok(packet.findingsSchema.requiredFields.includes('summary'));
  assert.equal(packet.findingsSchema.entryTemplate.summary, null);
  assert.deepEqual(packet.findingsSchema.registryProjection.requiredFields, ['id', 'severity', 'status', 'summary']);
  assert.deepEqual(packet.findingsSchema.registryProjection.severity, ['blocking', 'non-blocking']);
  assert.deepEqual(packet.findingsSchema.registryProjection.status, ['open', 'resolved']);
  assert.match(packet.findingsSchema.registryProjection.mappingRule, /human reviewer must confirm/i);
});

test('terminology, survey-method, script, mobile, accessibility, and evidence boundaries are present', () => {
  assert.equal(glossary.termInventory.length >= 15, true);
  assert.equal(glossary.surveyMethods.length, 10);
  assert.deepEqual(glossary.surveyMethods.map((method) => method.id), [
    'concept-testing', 'message-testing', 'claims-testing', 'purchase-intent', 'price-sensitivity',
    'feature-prioritization', 'brand-positioning', 'ux-expectation', 'survey-pretesting', 'interview-guide',
  ]);
  assert.deepEqual(packet.scriptFontInputLineBreakGate.scriptGroups.Latin, ['en-SG', 'ms-SG', 'id-ID', 'ms-MY', 'en-MY', 'fil-PH', 'en-PH', 'vi-VN', 'ms-BN']);
  for (const section of [packet.scriptFontInputLineBreakGate, packet.mobileAccessibilityGate]) {
    assert.ok(section.requiredPerLocale?.length || section.required?.length);
    assert.ok(section.evidenceFields.includes('findingIds'));
  }
  assert.equal(packet.populationEvidenceBoundary.populationStatus, 'unmeasured');
  assert.equal(packet.populationEvidenceBoundary.attitudinalValidationStatus, 'unsupported');
  assert.ok(packet.populationEvidenceBoundary.requiredEvidence.some((item) => /held-out human/i.test(item)));
  assert.ok(packet.journey.some((step) => step.id === 'market-locale-selection'));
  assert.ok(packet.journey.some((step) => step.id === 'survey-methods'));
  assert.ok(packet.journey.some((step) => step.id === 'script-input-layout'));
  assert.ok(packet.journey.some((step) => step.id === 'population-frame'));
  const marketJourney = packet.journey.find((step) => step.id === 'market-locale-selection');
  assert.match(marketJourney.steps.join(' '), /select enabled Singapore only/i);
  assert.match(marketJourney.steps.join(' '), /registry\/API checks/i);
  assert.doesNotMatch(marketJourney.steps.join(' '), /Select each ASEAN market/i);
});

test('glossary contains no supplied translations and all reviewer decisions remain pending', () => {
  const serialized = JSON.stringify(glossary);
  assert.doesNotMatch(serialized, /native-reviewed/);
  assert.doesNotMatch(serialized, /approved|approval granted|launch-ready/i);
  for (const term of glossary.termInventory) {
    assert.equal(Object.hasOwn(term, 'translation'), false);
    assert.equal(Object.hasOwn(term, 'decision'), false);
  }
  for (const entry of Object.values(glossary.locales)) {
    assert.equal(entry.translationStatus, 'not-provided');
    assert.equal(entry.termReview, 'pending');
    assert.equal(entry.scaleAnchorReview, 'pending');
    assert.equal(entry.disclosureReview, 'pending');
    assert.equal(entry.accessibilityLabelReview, 'pending');
  }
});
