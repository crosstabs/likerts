import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ASEAN_LANGUAGE_LOCALE_IDS,
  LOCALIZATION_CAPABILITY_STATUSES,
  LOCALIZATION_RELEASE_STATUSES,
  LOCALE_CAPABILITIES,
} from '../shared/localization.mjs';
import {
  ASEAN_NATIVE_REVIEW_PROGRAM,
  nativeReviewProgramContract,
  validateNativeReviewEvidence,
} from '../server/native-review-evidence.js';
import { runNativeReviewIntakeCli } from '../scripts/import-native-review-evidence.mjs';
import { createNativeReviewReleaseFixture } from './helpers/native-review-release-fixture.js';

test('ASEAN native-review evidence is structurally valid but does not alter planned runtime release state', () => {
  assert.deepEqual(nativeReviewProgramContract(ASEAN_NATIVE_REVIEW_PROGRAM).localeIds, ASEAN_LANGUAGE_LOCALE_IDS);
  const fixture = createNativeReviewReleaseFixture({
    reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    locale: 'en-SG',
  });
  const result = validateNativeReviewEvidence(fixture.envelope, {
    trustedReviewerKeys: fixture.trustedReviewerKeys,
    expectedBindings: fixture.expectedBindings,
    reviewPacketBytes: fixture.packetBytes,
    expectedReviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    now: fixture.now,
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.reviewProgram, ASEAN_NATIVE_REVIEW_PROGRAM);
  assert.equal(result.value.status, 'EVIDENCE_VALIDATED');
  assert.equal(LOCALE_CAPABILITIES['en-SG'].capabilities.ui, LOCALIZATION_CAPABILITY_STATUSES.PLANNED);
  assert.equal(LOCALE_CAPABILITIES['en-SG'].release.copyStatus, LOCALIZATION_RELEASE_STATUSES.UNSUPPORTED);
  assert.equal(LOCALE_CAPABILITIES['en-SG'].release.nativeReview.status, LOCALIZATION_RELEASE_STATUSES.REVIEW_PENDING);
});

test('ASEAN native-review rejects cross-program artifacts, unknown locales, and keys scoped to another program locale', () => {
  const fixture = createNativeReviewReleaseFixture({
    reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    locale: 'en-SG',
  });
  const base = {
    trustedReviewerKeys: fixture.trustedReviewerKeys,
    expectedBindings: fixture.expectedBindings,
    reviewPacketBytes: fixture.packetBytes,
    expectedReviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    now: fixture.now,
  };
  const cjkFixture = createNativeReviewReleaseFixture({ locale: 'ja-JP' });
  const crossProgram = validateNativeReviewEvidence(cjkFixture.envelope, {
    ...base,
    expectedBindings: cjkFixture.expectedBindings,
    trustedReviewerKeys: cjkFixture.trustedReviewerKeys,
  });
  assert.equal(crossProgram.ok, false);
  assert.ok(crossProgram.errors.some((item) => item.code === 'UNSUPPORTED_REVIEW_PROGRAM'));

  const cjkPacket = validateNativeReviewEvidence(fixture.envelope, {
    ...base,
    reviewPacketBytes: cjkFixture.packetBytes,
  });
  assert.equal(cjkPacket.ok, false);
  assert.ok(cjkPacket.errors.some((item) => item.code === 'REVIEW_PACKET_DIGEST_MISMATCH'));

  const unknownLocale = validateNativeReviewEvidence({
    ...fixture.envelope,
    artifact: { ...fixture.envelope.artifact, locale: 'en-XX' },
  }, {
    ...base,
    expectedBindings: { ...fixture.expectedBindings, locale: 'en-XX' },
  });
  assert.equal(unknownLocale.ok, false);
  assert.ok(unknownLocale.errors.some((item) => item.code === 'UNSUPPORTED_LOCALE'));

  const wrongKeyScope = validateNativeReviewEvidence(fixture.envelope, {
    ...base,
    trustedReviewerKeys: {
      ...fixture.trustedReviewerKeys,
      [fixture.envelope.artifact.reviewerId]: {
        ...fixture.trustedReviewerKeys[fixture.envelope.artifact.reviewerId],
        allowedLocales: ['id-ID'],
      },
    },
  });
  assert.equal(wrongKeyScope.ok, false);
  assert.ok(wrongKeyScope.errors.some((item) => item.code === 'UNTRUSTED_OR_INVALID_SIGNATURE'));

  const cjkShapedKey = validateNativeReviewEvidence(fixture.envelope, {
    ...base,
    trustedReviewerKeys: {
      [fixture.envelope.artifact.reviewerId]: {
        publicKeyPem: fixture.trustedReviewerKeys[fixture.envelope.artifact.reviewerId].publicKeyPem,
        allowedLocales: ['en-SG'],
      },
    },
  });
  assert.equal(cjkShapedKey.ok, false);
  assert.ok(cjkShapedKey.errors.some((item) => item.code === 'UNTRUSTED_OR_INVALID_SIGNATURE'));
});

test('ASEAN native-review CLI accepts its explicit program and leaves the registry untouched', async () => {
  const fixture = createNativeReviewReleaseFixture({
    reviewProgram: ASEAN_NATIVE_REVIEW_PROGRAM,
    locale: 'en-SG',
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'likerts-asean-native-review-'));
  const input = path.join(directory, 'review.json');
  const reviewPacket = path.join(directory, 'completed-review-packet.json');
  const output = path.join(directory, 'receipt.json');
  await fs.writeFile(input, JSON.stringify(fixture.envelope), 'utf8');
  await fs.writeFile(reviewPacket, fixture.packetBytes);
  let stderr = '';

  const exitCode = await runNativeReviewIntakeCli({
    argv: [
      '--review-program', ASEAN_NATIVE_REVIEW_PROGRAM,
      '--input', input,
      '--output', output,
      '--review-packet', reviewPacket,
      '--review-packet-reference', fixture.expectedBindings.reviewPacketReference,
      '--expected-locale', fixture.locale,
      '--expected-catalog-hash', fixture.expectedBindings.catalogHash,
      '--expected-build-id', fixture.expectedBindings.buildId,
      '--expected-browser-evidence-reference', fixture.expectedBindings.browserGateEvidenceReference,
      '--expected-approval-reference', fixture.expectedBindings.approvalReference,
      '--expected-product-version', fixture.expectedBindings.reviewedProductVersion,
      '--expected-prompt-version', fixture.expectedBindings.reviewedPromptVersion,
    ],
    env: { LIKERTS_NATIVE_REVIEWER_KEYS_JSON: JSON.stringify(fixture.trustedReviewerKeys) },
    now: fixture.now,
    stdout: { write() {} },
    stderr: { write(value) { stderr += value; } },
  });

  assert.equal(exitCode, 0, stderr);
  assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).reviewProgram, ASEAN_NATIVE_REVIEW_PROGRAM);
  assert.equal(LOCALE_CAPABILITIES['en-SG'].release.nativeReview.reviewer, null);
});
