import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { LocalizationDeploymentSmokeError } from '../server/localization-deployment-smoke.js';
import { CURRENT_LOCALIZATION_CATALOG_HASH } from '../server/localization-catalog-hash.js';

const buildId = 'localization-cli-smoke-build-20260830';
const artifactDigest = `sha256:${'a'.repeat(64)}`;
const catalogHash = CURRENT_LOCALIZATION_CATALOG_HASH;
const reviewPacketDigest = `sha256:${'c'.repeat(64)}`;

function createReleaseEvidenceEnvironment({ reviewProgram = 'cjk-native-review' } = {}) {
  const promotionKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  const reviewerKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  const artifactHash = artifactDigest.slice('sha256:'.length);
  const attestationUrl = `https://evidence.example.com/localization/${artifactHash}/attestation.json`;
  const promotionUrl = `https://evidence.example.com/localization/${artifactHash}/promotion.json`;
  const reviewPacketHash = reviewPacketDigest.slice('sha256:'.length);
  const locale = reviewProgram === 'asean-native-review' ? 'en-SG' : 'ja-JP';
  const reviewerId = reviewProgram === 'asean-native-review' ? 'reviewer-asean-sg-01' : 'reviewer-ja-01';

  return {
    LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON: JSON.stringify({
      schemaVersion: 'localization-release-evidence-source-v1',
      browser: {
        buildIdentity: { id: buildId, artifactDigest },
        attestationUrl,
        promotionUrl,
        trustedPromotionKeys: { 'release-operator-01': promotionKey },
      },
      nativeReview: {
        ...(reviewProgram === 'cjk-native-review' ? {} : { reviewProgram }),
        sourceConfig: {
          [locale]: {
            envelopeUrl: `https://native-evidence.example.com/native/${reviewPacketHash}/envelope.json`,
            packetUrl: `https://native-evidence.example.com/native/${reviewPacketHash}/packet.json`,
            allowedOrigin: 'https://native-evidence.example.com',
            expectedBindings: {
              locale,
              catalogHash,
              buildId,
              browserGateEvidenceReference: attestationUrl,
              approvalReference: 'approval-native-01',
              reviewedProductVersion: 'likerts-20260830',
              reviewedPromptVersion: 'prompt-20260830',
              reviewPacketDigest,
              reviewPacketReference: 'native-review-packet-01',
            },
          },
        },
        trustedReviewerKeys: {
          [reviewerId]: {
            publicKeyPem: reviewerKey,
            allowedLocales: [locale],
            ...(reviewProgram === 'cjk-native-review' ? {} : { reviewProgram }),
          },
        },
      },
    }),
  };
}

function writableCollector() {
  let value = '';
  return {
    write(chunk) {
      value += chunk;
    },
    read() {
      return value;
    },
  };
}

test('release smoke CLI passes independently loaded native-review evidence to the smoke runner', async () => {
  const { runLocalizationDeploymentSmokeCli } = await import('../scripts/smoke-localization-deployment.mjs');
  const stdout = writableCollector();
  const stderr = writableCollector();
  const expectedEvidence = Object.freeze({ source: 'independent-native-review' });
  let loadedConfig = null;

  const result = await runLocalizationDeploymentSmokeCli({
    env: createReleaseEvidenceEnvironment(),
    stdout,
    stderr,
    loadNativeReviewEvidence: async ({ sourceConfig, trustedReviewerKeys, reviewProgram }) => {
      loadedConfig = { sourceConfig, trustedReviewerKeys, reviewProgram };
      return expectedEvidence;
    },
    runSmoke: async ({ nativeReviewEvidenceLoader }) => {
      assert.equal(typeof nativeReviewEvidenceLoader, 'function');
      assert.equal(await nativeReviewEvidenceLoader(), expectedEvidence);
      return { status: 'READY' };
    },
  });

  assert.equal(result, 0);
  assert.deepEqual(JSON.parse(stdout.read()), { status: 'READY' });
  assert.equal(stderr.read(), '');
  assert.deepEqual(Object.keys(loadedConfig.sourceConfig), ['ja-JP']);
  assert.deepEqual(Object.keys(loadedConfig.trustedReviewerKeys), ['reviewer-ja-01']);
  assert.equal(loadedConfig.reviewProgram, 'cjk-native-review');
});

test('release smoke CLI preserves an explicit ASEAN review program for its independent loader', async () => {
  const { runLocalizationDeploymentSmokeCli } = await import('../scripts/smoke-localization-deployment.mjs');
  const stdout = writableCollector();
  const stderr = writableCollector();
  let loadedProgram = null;

  const result = await runLocalizationDeploymentSmokeCli({
    env: createReleaseEvidenceEnvironment({ reviewProgram: 'asean-native-review' }),
    stdout,
    stderr,
    loadNativeReviewEvidence: async ({ reviewProgram }) => {
      loadedProgram = reviewProgram;
      return Object.freeze({ nativeReviewProgram: reviewProgram });
    },
    runSmoke: async ({ nativeReviewEvidenceLoader }) => {
      assert.equal((await nativeReviewEvidenceLoader()).nativeReviewProgram, 'asean-native-review');
      return { status: 'PENDING' };
    },
  });

  assert.equal(result, 0);
  assert.equal(loadedProgram, 'asean-native-review');
  assert.deepEqual(JSON.parse(stdout.read()), { status: 'PENDING' });
  assert.equal(stderr.read(), '');
});

test('release smoke CLI leaves a review-claiming scorecard failed when independent native authority is missing', async () => {
  const { runLocalizationDeploymentSmokeCli } = await import('../scripts/smoke-localization-deployment.mjs');
  const stdout = writableCollector();
  const stderr = writableCollector();

  const result = await runLocalizationDeploymentSmokeCli({
    env: {},
    stdout,
    stderr,
    runSmoke: async ({ nativeReviewEvidenceLoader }) => {
      if (typeof nativeReviewEvidenceLoader !== 'function') {
        throw new LocalizationDeploymentSmokeError(
          'LOCALIZATION_SMOKE_NATIVE_REVIEW_AUTHORITY_REQUIRED',
          'A scorecard that claims native review requires independent native-review evidence.',
        );
      }
      throw new Error('Expected no independent native-review authority.');
    },
  });

  assert.equal(result, 1);
  assert.equal(stdout.read(), '');
  assert.equal(JSON.parse(stderr.read()).code, 'LOCALIZATION_SMOKE_NATIVE_REVIEW_AUTHORITY_REQUIRED');
});

test('release smoke CLI rejects invalid native authority configuration before running smoke', async () => {
  const { runLocalizationDeploymentSmokeCli } = await import('../scripts/smoke-localization-deployment.mjs');
  const stdout = writableCollector();
  const stderr = writableCollector();

  const result = await runLocalizationDeploymentSmokeCli({
    env: { LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON: '{not-json' },
    stdout,
    stderr,
    runSmoke: async () => { throw new Error('Smoke must not run with invalid authority configuration.'); },
  });

  assert.equal(result, 1);
  assert.equal(stdout.read(), '');
  const payload = JSON.parse(stderr.read());
  assert.equal(payload.code, 'LOCALIZATION_SMOKE_CONFIG_INVALID');
  assert.equal(payload.details.sourceCode, 'LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID');
});
