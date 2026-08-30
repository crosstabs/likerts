import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLocalizationScorecard } from '../server/localization-scorecard.js';
import { buildLocalizationScorecardFromReleaseEvidence } from '../server/localization-scorecard-service.js';

const TEST_NOW = new Date('2026-08-30T12:00:00.000Z');

test('release-evidence scorecard service preserves the honest pending projection', () => {
  assert.deepEqual(
    buildLocalizationScorecardFromReleaseEvidence(null, { now: TEST_NOW }),
    buildLocalizationScorecard({ now: TEST_NOW }),
  );
});

test('release-evidence scorecard service rejects malformed and partial provider contexts', () => {
  assert.throws(
    () => buildLocalizationScorecardFromReleaseEvidence({}, { now: TEST_NOW }),
    /invalid native-review context/,
  );
  assert.throws(
    () => buildLocalizationScorecardFromReleaseEvidence({
      nativeReviewEvidenceByLocale: {},
      nativeReviewBindingsByLocale: {},
      trustedNativeReviewerKeys: {},
      journeyAttestation: {},
    }, { now: TEST_NOW }),
    /partial browser context/,
  );
  assert.throws(
    () => buildLocalizationScorecardFromReleaseEvidence({
      nativeReviewEvidenceByLocale: {},
      nativeReviewBindingsByLocale: {},
      trustedNativeReviewerKeys: {},
      journeyAttestation: {},
      journeyPromotion: {},
      trustedPromotionKeys: {},
      buildIdentity: {},
    }, { now: TEST_NOW }),
    /did not project as published evidence/,
  );
});
