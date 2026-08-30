import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CJK_LOCALE_IDS,
  LOCALIZATION_CAPABILITIES,
  LOCALIZATION_RELEASE_STATUSES,
  LOCALE_CAPABILITIES,
} from '../shared/localization.mjs';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const glossary = readJson('../docs/localization-review-kit/cjk-glossary-v1.json');
const packet = readJson('../docs/localization-review-kit/cjk-review-packet-v1.json');
const checklist = readFileSync(new URL('../docs/localization-review-kit/cjk-native-review-checklist-v1.md', import.meta.url), 'utf8');
const capabilities = new Set(LOCALIZATION_CAPABILITIES);

const REQUIRED_TERM_IDS = [
  'synthetic-research',
  'model-generated-perspective',
  'not-participant-quotation',
  'population-frame',
  'population-fit',
  'attitudinal-accuracy',
  'evidence-ledger',
  'original-language',
  'retrieval-geography',
  'respondent-instrument',
  'human-validation',
  'machine-drafted',
  'review-pending',
  'unsupported',
  'raking-ipf',
  'concept-testing',
  'message-testing',
  'claims-testing',
  'purchase-intent',
  'price-sensitivity',
  'feature-prioritization',
  'brand-positioning',
  'ux-expectation',
  'survey-pretesting',
  'interview-guide',
];

const REQUIRED_DISCLOSURES = [
  'syntheticPerspective',
  'demographicFitNotAccuracy',
  'sourceNotGroundTruth',
  'originalLanguage',
  'modeledSegment',
  'humanValidationRequired',
  'unsupportedLocale',
];

const REQUIRED_SCALE_IDS = [
  'fivePointLikelihood',
  'fivePointPurchaseIntent',
  'fivePointCompelling',
  'fivePointCredibility',
  'fivePointEase',
];

test('CJK native-review assets are versioned, complete, and structurally scoped', () => {
  assert.equal(glossary.schemaVersion, 'likerts-native-review-glossary-v1');
  assert.equal(glossary.glossaryVersion, 'cjk-glossary-v1.0.0');
  assert.deepEqual(glossary.requiredSections, ['provenance', 'capabilities', 'reviewRules', 'locales']);
  for (const section of glossary.requiredSections) assert.ok(glossary[section], `missing glossary section ${section}`);
  assert.deepEqual(glossary.capabilities, LOCALIZATION_CAPABILITIES);

  assert.equal(packet.schemaVersion, 'likerts-native-review-packet-v1');
  assert.equal(packet.packetVersion, 'cjk-review-packet-v1.1.0');
  assert.equal(packet.sourceArtifacts.nativeReviewEvidenceTemplate, 'docs/localization-review-kit/cjk-native-review-evidence-template.json');
  assert.match(checklist, /Packet version: `cjk-review-packet-v1\.1\.0`/);
  assert.match(checklist, /cjk-native-review-evidence-template\.json/);
  assert.deepEqual(packet.requiredSections, [
    'sourceArtifacts', 'locales', 'capabilities', 'reviewerRecordTemplate', 'reviewSetup',
    'journey', 'accessibilityGate', 'findingsSchema', 'provenanceCapture', 'completedPacketSchema',
  ]);
  for (const section of packet.requiredSections) assert.ok(packet[section], `missing packet section ${section}`);
  assert.deepEqual(packet.locales, CJK_LOCALE_IDS);
  assert.deepEqual(packet.capabilities, LOCALIZATION_CAPABILITIES);
  assert.equal(packet.completedPacketSchema.schemaVersion, 'likerts-completed-cjk-native-review-packet-v1');
  assert.equal(packet.completedPacketSchema.packetVersion, 'cjk-completed-review-packet-v1.1.0');
  assert.equal(packet.completedPacketSchema.status, 'completed');
  assert.deepEqual(packet.completedPacketSchema.evidenceRecordFields, ['id', 'kind', 'summary', 'contentDigest']);
  assert.match(packet.completedPacketSchema.evidenceContentBinding, /does not fetch.*independently verify/i);
  assert.deepEqual(packet.completedPacketSchema.findingsProjection.severity, {
    blocking: 'blocking', high: 'non-blocking', medium: 'non-blocking', low: 'non-blocking',
  });
  assert.deepEqual(packet.completedPacketSchema.findingsProjection.status, {
    resolved: 'resolved', open: 'open', accepted: 'open', 'wont-fix': 'open', 'needs-context': 'open',
  });
  assert.match(checklist, /covering all six capabilities/);
  assert.match(checklist, /high`, `medium`, and `low` become `non-blocking`/);
  assert.match(checklist, /`accepted`, `wont-fix`, and `needs-context` all project to `open`/);
});

test('every CJK glossary covers risky terms, capabilities, placeholders, anchors, disclosures, and accessibility labels', () => {
  const expectedPlaceholders = glossary.locales['zh-CN'].placeholders;
  for (const localeId of CJK_LOCALE_IDS) {
    const entry = glossary.locales[localeId];
    assert.ok(entry, `missing glossary locale ${localeId}`);
    assert.equal(entry.locale, localeId);
    assert.equal(entry.reviewStatus, 'review-pending');
    assert.ok(entry.market);
    assert.ok(entry.nativeName);
    assert.deepEqual(entry.placeholders, expectedPlaceholders, `${localeId} placeholder manifest differs`);

    const terms = new Map(entry.terms.map((term) => [term.id, term]));
    assert.equal(terms.size, entry.terms.length, `${localeId} has duplicate glossary IDs`);
    for (const termId of REQUIRED_TERM_IDS) {
      const term = terms.get(termId);
      assert.ok(term, `${localeId} is missing glossary term ${termId}`);
      assert.ok(term.translation && term.translation.trim(), `${localeId} term ${termId} is empty`);
      assert.ok(['low', 'medium', 'high', 'critical'].includes(term.risk), `${localeId} term ${termId} risk missing`);
      assert.ok(term.capabilities.length > 0, `${localeId} term ${termId} has no capability scope`);
      for (const capability of term.capabilities) assert.ok(capabilities.has(capability), `${localeId} term ${termId} has unknown capability ${capability}`);
      assert.equal(term.decision, null, `${localeId} term ${termId} must await a human decision`);
    }
    assert.deepEqual([...terms.keys()].sort(), [...REQUIRED_TERM_IDS].sort(), `${localeId} key-term inventory drifted`);
    assert.deepEqual(Object.keys(entry.scaleAnchors).sort(), [...REQUIRED_SCALE_IDS].sort(), `${localeId} scale-anchor inventory incomplete`);
    for (const scaleId of REQUIRED_SCALE_IDS) assert.equal(entry.scaleAnchors[scaleId].length, 5, `${localeId} ${scaleId} must contain five anchors`);
    for (const disclosure of REQUIRED_DISCLOSURES) assert.ok(entry.disclosures[disclosure]?.trim(), `${localeId} disclosure ${disclosure} missing`);
    for (const label of ['openDetails', 'closeDetails', 'chartAlternative', 'required', 'status', 'focusInstruction']) {
      assert.ok(entry.accessibilityLabels[label]?.trim(), `${localeId} accessibility label ${label} missing`);
    }
  }
});

test('review packet covers all capabilities and the complete journey', () => {
  const covered = new Set(packet.journey.map((step) => step.capability));
  for (const capability of LOCALIZATION_CAPABILITIES) assert.ok(covered.has(capability), `journey has no ${capability} coverage`);
  assert.ok(packet.journey.length >= 10, 'complete journey must have at least ten review sections');
  for (const step of packet.journey) {
    assert.ok(step.id && step.title, 'journey step needs stable ID and title');
    assert.ok(capabilities.has(step.capability), `journey step ${step.id} has unknown capability`);
    assert.ok(step.steps.length >= 2, `journey step ${step.id} needs executable steps`);
    assert.ok(step.check.length >= 2, `journey step ${step.id} needs review checks`);
  }
  for (const method of [
    'Concept testing', 'Message testing', 'Claims testing', 'Purchase-intent testing',
    'Price sensitivity', 'Feature prioritization', 'Brand positioning', 'UX expectation testing',
    'Survey pretesting', 'Interview-guide generation',
  ]) assert.ok(packet.journey.find((step) => step.id === 'research-methods').steps.includes(method), `missing method ${method}`);
  for (const field of ['requiredFields', 'severity', 'category', 'status', 'entryTemplate', 'releaseRule']) assert.ok(packet.findingsSchema[field], `missing findings schema field ${field}`);
  for (const field of packet.findingsSchema.requiredFields) assert.ok(Object.hasOwn(packet.findingsSchema.entryTemplate, field), `finding template missing ${field}`);
  assert.ok(packet.findingsSchema.category.includes('interaction-label'), 'findings must capture interaction labels');
});

test('review assets cannot fabricate native-review evidence or approval', () => {
  assert.equal(glossary.status, 'machine-drafted');
  assert.equal(glossary.nativeReviewStatus, 'review-pending');
  assert.equal(packet.status, 'review-pending');
  const record = packet.reviewerRecordTemplate;
  assert.equal(record.status, 'review-pending');
  assert.equal(record.reviewerId, null);
  assert.equal(record.organization, null);
  assert.equal(record.reviewedAt, null);
  assert.equal(record.reviewedProductVersion, null);
  assert.equal(record.reviewedPromptVersion, null);
  assert.deepEqual(record.capabilityScope, []);
  assert.equal(record.blockingFindingsResolved, false);
  assert.equal(record.approvalReference, null);

  for (const localeId of CJK_LOCALE_IDS) {
    const registryEntry = LOCALE_CAPABILITIES[localeId];
    assert.equal(registryEntry.release.copyStatus, LOCALIZATION_RELEASE_STATUSES.MACHINE_DRAFTED);
    assert.equal(registryEntry.release.nativeReview.status, LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING);
    assert.equal(registryEntry.release.nativeReview.reviewer, null);
    assert.equal(registryEntry.release.nativeReview.reviewedAt, null);
    assert.equal(registryEntry.release.nativeReview.glossaryVersion, null);
    assert.equal(registryEntry.release.nativeReview.blockingFindingsResolved, false);
    for (const capability of LOCALIZATION_CAPABILITIES) assert.equal(registryEntry.release.nativeReview.statusByCapability[capability], LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING);
  }
});
