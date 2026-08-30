#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LocalizationDeploymentSmokeError,
  runLocalizationDeploymentSmoke,
} from '../server/localization-deployment-smoke.js';
import {
  LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV,
  LocalizationReleaseEvidenceError,
  readLocalizationReleaseEvidenceConfig,
} from '../server/localization-release-evidence-provider.js';
import { loadNativeReviewReleaseEvidence } from '../server/native-review-release-evidence-adapter.js';
import { CJK_NATIVE_REVIEW_PROGRAM } from '../server/native-review-evidence.js';

function strictBoolean(value, name) {
  if (value === undefined || value === '') return false;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new LocalizationDeploymentSmokeError(
    'LOCALIZATION_SMOKE_CONFIG_INVALID',
    `${name} must be true, false, 1, or 0.`,
  );
}

function expectedBuildIdentity(env) {
  const id = String(env.LIKERTS_LOCALIZATION_EXPECTED_BUILD_ID || '').trim();
  const artifactDigest = String(env.LIKERTS_LOCALIZATION_EXPECTED_ARTIFACT_DIGEST || '').trim();
  if (!id && !artifactDigest) return null;
  if (!id || !artifactDigest) {
    throw new LocalizationDeploymentSmokeError(
      'LOCALIZATION_SMOKE_CONFIG_INVALID',
      'Expected localization build id and artifact digest must be supplied together.',
    );
  }
  return { id, artifactDigest };
}

function expectedPromotionBinding(env) {
  const ciEvidenceId = String(env.LIKERTS_LOCALIZATION_EXPECTED_CI_EVIDENCE_ID || '').trim();
  const bundleDigest = String(env.LIKERTS_LOCALIZATION_EXPECTED_BUNDLE_DIGEST || '').trim();
  if (!ciEvidenceId && !bundleDigest) return null;
  if (!ciEvidenceId || !bundleDigest) {
    throw new LocalizationDeploymentSmokeError(
      'LOCALIZATION_SMOKE_CONFIG_INVALID',
      'Expected localization CI evidence ID and bundle digest must be supplied together.',
    );
  }
  return { ciEvidenceId, bundleDigest };
}

function expectedEvidenceAuthority(env) {
  const evidenceUrl = String(env.LIKERTS_LOCALIZATION_EXPECTED_EVIDENCE_URL || '').trim();
  const promotionUrl = String(env.LIKERTS_LOCALIZATION_EXPECTED_PROMOTION_URL || '').trim();
  if (!evidenceUrl && !promotionUrl) return null;
  if (!evidenceUrl || !promotionUrl) {
    throw new LocalizationDeploymentSmokeError(
      'LOCALIZATION_SMOKE_CONFIG_INVALID',
      'Expected localization evidence and promotion URLs must be supplied together.',
    );
  }
  return { evidenceUrl, promotionUrl };
}

function trustedPromotionKeys(env) {
  const serialized = String(env.LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON || '').trim();
  if (!serialized) return null;
  try {
    const keys = JSON.parse(serialized);
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)
      || Object.getPrototypeOf(keys) !== Object.prototype
      || Object.keys(keys).length === 0
      || Object.values(keys).some((value) => typeof value !== 'string' || !value.trim())) {
      throw new Error('shape');
    }
    return keys;
  } catch {
    throw new LocalizationDeploymentSmokeError(
      'LOCALIZATION_SMOKE_CONFIG_INVALID',
      'LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON must be a non-empty JSON object of trusted PEM public keys.',
    );
  }
}

function createNativeReviewEvidenceLoader({
  env,
  readReleaseEvidenceConfig = readLocalizationReleaseEvidenceConfig,
  loadNativeReviewEvidence = loadNativeReviewReleaseEvidence,
}) {
  const rawConfig = env?.[LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV];
  if (rawConfig === undefined || rawConfig === null || String(rawConfig).trim() === '') return null;

  let config;
  try {
    config = readReleaseEvidenceConfig(env);
  } catch (error) {
    if (!(error instanceof LocalizationReleaseEvidenceError)) throw error;
    throw new LocalizationDeploymentSmokeError(
      'LOCALIZATION_SMOKE_CONFIG_INVALID',
      'Localization release-evidence authority configuration is invalid.',
      { sourceCode: error.code },
    );
  }

  return async function loadIndependentNativeReviewEvidence() {
    return loadNativeReviewEvidence({
      sourceConfig: config.nativeReview.sourceConfig,
      trustedReviewerKeys: config.nativeReview.trustedReviewerKeys,
      reviewProgram: config.nativeReview.reviewProgram ?? CJK_NATIVE_REVIEW_PROGRAM,
    });
  };
}

export async function runLocalizationDeploymentSmokeCli({
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  runSmoke = runLocalizationDeploymentSmoke,
  readReleaseEvidenceConfig = readLocalizationReleaseEvidenceConfig,
  loadNativeReviewEvidence = loadNativeReviewReleaseEvidence,
} = {}) {
  try {
    const promotionBinding = expectedPromotionBinding(env);
    const evidenceAuthority = expectedEvidenceAuthority(env);
    const nativeReviewEvidenceLoader = createNativeReviewEvidenceLoader({
      env,
      readReleaseEvidenceConfig,
      loadNativeReviewEvidence,
    });
    const smokeOptions = {
      baseUrl: env.LIKERTS_DEPLOYMENT_URL,
      expectedBuildIdentity: expectedBuildIdentity(env),
      expectedCiEvidenceId: promotionBinding?.ciEvidenceId || null,
      expectedBundleDigest: promotionBinding?.bundleDigest || null,
      expectedEvidenceUrl: evidenceAuthority?.evidenceUrl || null,
      expectedPromotionUrl: evidenceAuthority?.promotionUrl || null,
      trustedPromotionKeys: trustedPromotionKeys(env),
      requireReleaseReady: strictBoolean(
        env.LIKERTS_LOCALIZATION_REQUIRE_RELEASE_READY,
        'LIKERTS_LOCALIZATION_REQUIRE_RELEASE_READY',
      ),
    };
    if (nativeReviewEvidenceLoader !== null) {
      smokeOptions.nativeReviewEvidenceLoader = nativeReviewEvidenceLoader;
    }
    const report = await runSmoke(smokeOptions);
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error) {
    const payload = error instanceof LocalizationDeploymentSmokeError
      ? { status: 'FAILED', code: error.code, message: error.message, details: error.details }
      : { status: 'FAILED', code: 'LOCALIZATION_SMOKE_FAILED', message: error?.message || 'Unknown failure' };
    stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runLocalizationDeploymentSmokeCli();
}
