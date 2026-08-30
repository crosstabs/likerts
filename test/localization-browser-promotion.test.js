import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs, { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LOCALIZATION_REGISTRY_VERSION,
} from '../shared/localization.mjs';
import {
  LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE,
  LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS,
  LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS,
  LOCALIZATION_BROWSER_API_MODE,
  LOCALIZATION_BROWSER_EVIDENCE_MODE,
  LOCALIZATION_BROWSER_METHOD_IDS,
  LOCALIZATION_BROWSER_METHOD_RESULT_KINDS,
  createLocalizationBrowserAttestation,
} from '../server/localization-browser-attestation.js';
import {
  LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
  LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
  LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
  LOCALIZATION_JOURNEY_FLOWS,
  LOCALIZATION_JOURNEY_GATE_VERSION,
} from '../server/localization-scorecard.js';
import { buildBrowserArtifactManifest } from '../server/browser-artifact-binding.js';
import { buildBrowserAttestationBundle } from '../server/browser-attestation-bundle.js';
import {
  LOCALIZATION_BROWSER_PROMOTION_SCHEMA_VERSION,
  canonicalLocalizationBrowserPromotionJson,
  createLocalizationBrowserPromotionArtifact,
  derivePublishedLocalizationBrowserAttestation,
  validateLocalizationBrowserPromotion,
} from '../server/localization-browser-promotion.js';
import { runBrowserAttestationPromotionCli } from '../scripts/promote-browser-attestation.mjs';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const BUILD_ID = 'localization-promotion-test-20260829';
const ARTIFACT_DIGEST = `sha256:${'a'.repeat(64)}`;
const BUNDLE_DIGEST = `sha256:${'b'.repeat(64)}`;
const signerKeys = generateKeyPairSync('ed25519');
const trustedPromotionKeys = {
  'release-operator-01': signerKeys.publicKey.export({ type: 'spki', format: 'pem' }),
};

function accessibilitySurfaceChecks(deep) {
  return (deep
    ? LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS
    : LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS).map((surfaceId) => ({
    surfaceId,
    snapshotCount: ['specialized-method-results', 'specialized-method-handoffs'].includes(surfaceId) ? 10 : 1,
    violations: 0,
  }));
}

function sampleChecks(quality) {
  return {
    staticDetailRegistryMatched: true,
    staticDetailQualityBadgesMatched: true,
    ctaMatched: true,
    composerOpenedFromCta: true,
    autoRunApiCalls: 0,
    promptMatched: true,
    audienceMatched: true,
    researchMethod: 'GENERAL_LIKERT',
    staleMethodFieldCount: 0,
    lineageNoticeLocalized: true,
    lineageNoticeSource: 'static-sample-library',
    lineageNoticeAutomatedQaStatus: quality.automatedQaStatus,
    lineageNoticeNativeReviewStatus: quality.nativeReviewStatus,
    requestApiCalls: 1,
    requestMethodConfigPresent: false,
    requestCanonicalLineageMatched: true,
    responseRunLineageMatched: true,
    responseMetaLineageMatched: true,
    responseReproducibilityLineageMatched: true,
    responsePersistenceInputLineageMatched: true,
    responsePersistenceRunLineageMatched: true,
    evidencePackStudyLineageMatched: true,
    evidencePackResultLineageMatched: true,
    evidencePackTopLevelLineageMatched: true,
    qualitativeProjectExportLineageMatched: true,
    qualitativeRunRecordLineageMatched: true,
    localStorageLineageMatched: true,
    restoredWithoutSampleQuery: true,
    restoredReportMatched: true,
    restoredLineageNoticeMatched: true,
    restoreApiCalls: 0,
    observedHumanResponses: false,
    participantPanelConnected: false,
  };
}

function ciAttestation({
  buildId = BUILD_ID,
  artifactDigest = ARTIFACT_DIGEST,
  catalogHash,
} = {}) {
  return createLocalizationBrowserAttestation({
    suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    catalogHash,
    verifiedAt: '2026-08-29T12:00:00.000Z',
    build: {
      id: buildId,
      artifactDigest,
      candidateUrl: 'https://candidate.example.test/builds/localization-promotion-test-20260829/',
    },
    publication: { status: 'CI_ARTIFACT', evidenceUrl: null },
    execution: {
      evidenceMode: LOCALIZATION_BROWSER_EVIDENCE_MODE,
      apiMode: LOCALIZATION_BROWSER_API_MODE,
      externalNetworkAllowed: false,
      liveBackendValidated: false,
      liveModelValidated: false,
      observedHumanResponses: false,
      participantPanelConnected: false,
    },
    matrix: LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS.flatMap((localeId) => (
      LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS.map((viewport, viewportIndex) => ({
        localeId,
        viewport,
        journey: 'FULL_JOURNEY',
        status: 'PASSED',
        failures: {
          unmockedApiRequests: 0,
          externalRequests: 0,
          consoleErrors: 0,
          pageErrors: 0,
          failedResponses: 0,
          failedRequests: 0,
        },
        accessibility: {
          engine: LOCALIZATION_BROWSER_ACCESSIBILITY_ENGINE,
          engineVersion: '4.11.0',
          rulesetTags: [...LOCALIZATION_BROWSER_ACCESSIBILITY_RULESET_TAGS],
          surfaceChecks: accessibilitySurfaceChecks(viewportIndex === 0),
          violations: 0,
        },
      }))
    )),
    flowEvidence: LOCALIZATION_JOURNEY_FLOWS.flatMap((flow) => (
      LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS.map((localeId) => ({
        flowId: flow.id,
        localeId,
        status: 'PASSED',
        viewports: flow.id === 'first-run-and-authoring'
          ? LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS
          : [LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS[0]],
      }))
    )),
    methodCoverage: LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS.map((localeId) => ({
      localeId,
      methodIds: LOCALIZATION_BROWSER_METHOD_IDS,
      resultKinds: LOCALIZATION_BROWSER_METHOD_RESULT_KINDS,
      localizedAuthoringSurfaces: LOCALIZATION_BROWSER_METHOD_IDS.length,
      localizedResultSurfaces: LOCALIZATION_BROWSER_METHOD_IDS.length,
      localizedHandoffDrafts: LOCALIZATION_BROWSER_METHOD_IDS.length,
      methodSpecificReceiptDownloads: LOCALIZATION_BROWSER_METHOD_IDS.length,
      observedHumanResponses: false,
      participantPanelConnected: false,
    })),
    sampleCoverage: LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS.map((entry) => ({
      localeId: entry.localeId,
      viewport: LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS[0],
      status: 'PASSED',
      samples: entry.samples.map((sample) => ({
        ...structuredClone(sample),
        checks: sampleChecks(sample.quality),
      })),
    })),
  });
}

function promotionFixture({ signedAt = '2026-08-30T11:59:00.000Z' } = {}) {
  const ci = ciAttestation();
  const artifactHash = ARTIFACT_DIGEST.slice('sha256:'.length);
  const publishedEvidenceUrl = `https://evidence.example.test/localization/${artifactHash}/attestation.json`;
  const promotionRecordUrl = `https://evidence.example.test/localization/${artifactHash}/promotion.json`;
  const published = derivePublishedLocalizationBrowserAttestation(ci, { publishedEvidenceUrl });
  const bundle = {
    ok: true,
    bundleDigest: BUNDLE_DIGEST,
    artifactDigest: ARTIFACT_DIGEST,
    evidenceId: ci.evidenceId,
    publicationStatus: 'CI_ARTIFACT',
    published: false,
  };
  const artifact = createLocalizationBrowserPromotionArtifact({
    ciAttestation: ci,
    ciBundle: bundle,
    publishedAttestation: published,
    promotionRecordUrl,
    signerId: 'release-operator-01',
    signedAt,
  });
  const envelope = {
    artifact,
    signature: sign(null, Buffer.from(canonicalLocalizationBrowserPromotionJson(artifact)), signerKeys.privateKey).toString('base64'),
  };
  return { ci, bundle, published, promotionRecordUrl, envelope };
}

test('a trusted signed promotion binds a verified CI bundle to its deterministically derived published attestation', () => {
  const fixture = promotionFixture();

  const validation = validateLocalizationBrowserPromotion(fixture.envelope, {
    trustedPromotionKeys,
    ciAttestation: fixture.ci,
    ciBundle: fixture.bundle,
    publishedAttestation: fixture.published,
    now: NOW,
  });

  assert.equal(fixture.envelope.artifact.schemaVersion, LOCALIZATION_BROWSER_PROMOTION_SCHEMA_VERSION);
  assert.equal(fixture.envelope.artifact.ciEvidenceId, fixture.ci.evidenceId);
  assert.equal(fixture.envelope.artifact.publishedEvidenceId, fixture.published.evidenceId);
  assert.equal(validation.ok, true);
  assert.equal(validation.value.promotionRecordUrl, fixture.promotionRecordUrl);
});

test('promotion fails closed when a digest-valid CI attestation targets a stale catalog', () => {
  const staleAttestation = ciAttestation({ catalogHash: `sha256:${'f'.repeat(64)}` });

  assert.throws(
    () => derivePublishedLocalizationBrowserAttestation(staleAttestation, {
      publishedEvidenceUrl: `https://evidence.example.test/localization/${ARTIFACT_DIGEST.slice('sha256:'.length)}/attestation.json`,
    }),
    (error) => error?.code === 'PROMOTION_CI_ATTESTATION_INVALID',
  );
});

test('promotion validation fails closed on a stateful artifact accessor', () => {
  const fixture = promotionFixture();
  const envelope = structuredClone(fixture.envelope);
  let reads = 0;
  Object.defineProperty(envelope.artifact, 'buildId', {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return reads <= 2 ? BUILD_ID : 'tampered-after-signature';
    },
  });

  const validation = validateLocalizationBrowserPromotion(envelope, {
    trustedPromotionKeys,
    now: NOW,
  });

  assert.equal(validation.ok, false);
  assert.equal(reads, 0);
});

test('promotion validation rejects signature, key, time, URL, and CI-binding bypasses', () => {
  const fixture = promotionFixture();
  const options = {
    trustedPromotionKeys,
    ciAttestation: fixture.ci,
    ciBundle: fixture.bundle,
    publishedAttestation: fixture.published,
    now: NOW,
  };
  const malformedSignature = {
    ...fixture.envelope,
    signature: fixture.envelope.signature.replace(/=+$/, ''),
  };
  assert.equal(validateLocalizationBrowserPromotion(malformedSignature, options).code, 'PROMOTION_SIGNATURE_ENCODING_INVALID');

  const mismatchedBinding = structuredClone(fixture.envelope);
  mismatchedBinding.artifact.bundleDigest = `sha256:${'d'.repeat(64)}`;
  mismatchedBinding.signature = sign(
    null,
    Buffer.from(canonicalLocalizationBrowserPromotionJson(mismatchedBinding.artifact)),
    signerKeys.privateKey,
  ).toString('base64');
  assert.equal(validateLocalizationBrowserPromotion(mismatchedBinding, options).code, 'PROMOTION_CI_BINDING_MISMATCH');

  const forgedCiEvidence = structuredClone(fixture.envelope);
  forgedCiEvidence.artifact.ciEvidenceId = `sha256:${'e'.repeat(64)}`;
  forgedCiEvidence.signature = sign(
    null,
    Buffer.from(canonicalLocalizationBrowserPromotionJson(forgedCiEvidence.artifact)),
    signerKeys.privateKey,
  ).toString('base64');
  assert.equal(validateLocalizationBrowserPromotion(forgedCiEvidence, {
    trustedPromotionKeys,
    publishedAttestation: fixture.published,
    now: NOW,
  }).code, 'PROMOTION_CI_BINDING_MISMATCH');

  const rsaKeys = generateKeyPairSync('rsa', { modulusLength: 512 });
  assert.equal(validateLocalizationBrowserPromotion(fixture.envelope, {
    ...options,
    trustedPromotionKeys: {
      'release-operator-01': rsaKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    },
  }).code, 'PROMOTION_SIGNATURE_INVALID');

  assert.equal(validateLocalizationBrowserPromotion(promotionFixture({
    signedAt: '2026-07-30T11:59:00.000Z',
  }).envelope, options).code, 'PROMOTION_TOO_OLD');
  assert.equal(validateLocalizationBrowserPromotion(promotionFixture({
    signedAt: '2026-08-30T12:05:00.001Z',
  }).envelope, options).code, 'PROMOTION_FROM_FUTURE');

  assert.throws(() => createLocalizationBrowserPromotionArtifact({
    ciAttestation: fixture.ci,
    ciBundle: fixture.bundle,
    publishedAttestation: fixture.published,
    promotionRecordUrl: 'https://evidence.example.test/localization/latest/promotion.json',
    signerId: 'release-operator-01',
    signedAt: '2026-08-30T11:59:00.000Z',
  }), (error) => error?.code === 'PROMOTION_ARTIFACT_INVALID');
});

test('the promotion CLI verifies a CI bundle then stages its exact canonical artifact manifest with the signed records', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'likerts-promotion-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactDirectory = path.join(root, 'dist');
  const bundleDirectory = path.join(root, 'bundle');
  const stageDirectory = path.join(root, 'stage');
  const ciPath = path.join(root, 'ci-attestation.json');
  await mkdir(path.join(artifactDirectory, 'assets'), { recursive: true });
  await writeFile(path.join(artifactDirectory, 'index.html'), '<main>promotion</main>\n');
  await writeFile(path.join(artifactDirectory, 'assets', 'app.js'), 'globalThis.promotion = true;\n');
  const artifactManifest = await buildBrowserArtifactManifest(artifactDirectory);
  const ci = ciAttestation({ artifactDigest: artifactManifest.artifactDigest });
  await writeFile(ciPath, `${JSON.stringify(ci, null, 2)}\n`);
  await buildBrowserAttestationBundle({
    attestationPath: ciPath,
    artifactDirectory,
    outputDirectory: bundleDirectory,
    now: NOW,
  });
  const artifactHash = artifactManifest.artifactDigest.slice('sha256:'.length);
  const privateKeyPath = path.join(root, 'promotion-private-key.pem');
  await writeFile(privateKeyPath, signerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  let stdout = '';
  let stderr = '';

  const exitCode = await runBrowserAttestationPromotionCli({
    argv: [
      '--bundle', bundleDirectory,
      '--evidence-url', `https://evidence.example.test/localization/${artifactHash}/attestation.json`,
      '--promotion-url', `https://evidence.example.test/localization/${artifactHash}/promotion.json`,
      '--signer-id', 'release-operator-01',
      '--private-key-file', privateKeyPath,
      '--output', stageDirectory,
    ],
    env: { LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON: JSON.stringify(trustedPromotionKeys) },
    now: NOW,
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } },
  });

  assert.equal(exitCode, 0, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.publicationPrepared, true);
  assert.equal(result.uploaded, false);
  assert.deepEqual(
    (await readdir(stageDirectory)).sort(),
    ['artifact-manifest.json', 'attestation.json', 'promotion.json'],
  );
  const bundledArtifactManifestText = await readFile(
    path.join(bundleDirectory, artifactHash, 'artifact-manifest.json'),
    'utf8',
  );
  const stagedArtifactManifestText = await readFile(
    path.join(stageDirectory, 'artifact-manifest.json'),
    'utf8',
  );
  const stagedAttestationText = await readFile(path.join(stageDirectory, 'attestation.json'), 'utf8');
  const stagedPromotionText = await readFile(path.join(stageDirectory, 'promotion.json'), 'utf8');
  const stagedArtifactManifest = JSON.parse(stagedArtifactManifestText);
  const stagedAttestation = JSON.parse(stagedAttestationText);
  const stagedPromotion = JSON.parse(stagedPromotionText);
  assert.equal(stagedArtifactManifestText, bundledArtifactManifestText);
  assert.equal(
    stagedArtifactManifestText,
    `${canonicalLocalizationBrowserPromotionJson(stagedArtifactManifest)}\n`,
  );
  assert.equal(stagedAttestationText, `${canonicalLocalizationBrowserPromotionJson(stagedAttestation)}\n`);
  assert.equal(stagedPromotionText, `${canonicalLocalizationBrowserPromotionJson(stagedPromotion)}\n`);
  assert.equal(stagedArtifactManifest.artifactDigest, stagedAttestation.build.artifactDigest);
  assert.equal(stagedPromotion.artifact.publishedEvidenceId, stagedAttestation.evidenceId);
});

test('the promotion CLI rejects a canonical artifact manifest tampered after bundle verification', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'likerts-promotion-manifest-tamper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactDirectory = path.join(root, 'dist');
  const bundleDirectory = path.join(root, 'bundle');
  const stageDirectory = path.join(root, 'stage');
  const ciPath = path.join(root, 'ci-attestation.json');
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(path.join(artifactDirectory, 'index.html'), '<main>manifest tamper</main>\n');
  const artifactManifest = await buildBrowserArtifactManifest(artifactDirectory);
  const ci = ciAttestation({ artifactDigest: artifactManifest.artifactDigest });
  await writeFile(ciPath, `${JSON.stringify(ci, null, 2)}\n`);
  await buildBrowserAttestationBundle({
    attestationPath: ciPath,
    artifactDirectory,
    outputDirectory: bundleDirectory,
    now: NOW,
  });
  const artifactHash = artifactManifest.artifactDigest.slice('sha256:'.length);
  const artifactManifestPath = path.join(bundleDirectory, artifactHash, 'artifact-manifest.json');
  const tamperedManifest = JSON.parse(await readFile(artifactManifestPath, 'utf8'));
  tamperedManifest.files[0].contentDigest = `sha256:${'c'.repeat(64)}`;
  const tamperedManifestText = `${canonicalLocalizationBrowserPromotionJson(tamperedManifest)}\n`;
  const privateKeyPath = path.join(root, 'promotion-private-key.pem');
  await writeFile(privateKeyPath, signerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const originalReadFile = fs.readFile.bind(fs);
  let artifactManifestReads = 0;
  t.mock.method(fs, 'readFile', async (filePath, ...args) => {
    if (path.resolve(filePath) === artifactManifestPath) {
      artifactManifestReads += 1;
      if (artifactManifestReads === 2) return tamperedManifestText;
    }
    return originalReadFile(filePath, ...args);
  });
  let stderr = '';

  const exitCode = await runBrowserAttestationPromotionCli({
    argv: [
      '--bundle', bundleDirectory,
      '--evidence-url', `https://evidence.example.test/localization/${artifactHash}/attestation.json`,
      '--promotion-url', `https://evidence.example.test/localization/${artifactHash}/promotion.json`,
      '--signer-id', 'release-operator-01',
      '--private-key-file', privateKeyPath,
      '--output', stageDirectory,
    ],
    env: { LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON: JSON.stringify(trustedPromotionKeys) },
    now: NOW,
    stdout: { write() {} },
    stderr: { write(value) { stderr += value; } },
  });

  assert.equal(exitCode, 2);
  assert.match(stderr, /PROMOTION_ARTIFACT_MANIFEST_MISMATCH/);
  await assert.rejects(readFile(path.join(stageDirectory, 'artifact-manifest.json')), { code: 'ENOENT' });
});

test('the promotion CLI fails closed if the verified artifact manifest becomes missing or artifact-mismatched', async (t) => {
  const cases = [
    {
      name: 'missing',
      expectedCode: 'PROMOTION_ARTIFACT_MANIFEST_UNREADABLE',
      replacement() {
        throw Object.assign(new Error('manifest disappeared'), { code: 'ENOENT' });
      },
    },
    {
      name: 'artifact-mismatched',
      expectedCode: 'PROMOTION_ARTIFACT_MANIFEST_MISMATCH',
      replacement(manifestText) {
        const manifest = JSON.parse(manifestText);
        manifest.artifactDigest = `sha256:${'d'.repeat(64)}`;
        return `${canonicalLocalizationBrowserPromotionJson(manifest)}\n`;
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), `likerts-promotion-manifest-${scenario.name}-`));
      t.after(() => rm(root, { recursive: true, force: true }));
      const artifactDirectory = path.join(root, 'dist');
      const bundleDirectory = path.join(root, 'bundle');
      const stageDirectory = path.join(root, 'stage');
      const ciPath = path.join(root, 'ci-attestation.json');
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(path.join(artifactDirectory, 'index.html'), `<main>${scenario.name}</main>\n`);
      const artifactManifest = await buildBrowserArtifactManifest(artifactDirectory);
      const ci = ciAttestation({ artifactDigest: artifactManifest.artifactDigest });
      await writeFile(ciPath, `${JSON.stringify(ci, null, 2)}\n`);
      await buildBrowserAttestationBundle({
        attestationPath: ciPath,
        artifactDirectory,
        outputDirectory: bundleDirectory,
        now: NOW,
      });
      const artifactHash = artifactManifest.artifactDigest.slice('sha256:'.length);
      const artifactManifestPath = path.join(bundleDirectory, artifactHash, 'artifact-manifest.json');
      const originalManifestText = await readFile(artifactManifestPath, 'utf8');
      const privateKeyPath = path.join(root, 'promotion-private-key.pem');
      await writeFile(privateKeyPath, signerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
      const originalReadFile = fs.readFile.bind(fs);
      let artifactManifestReads = 0;
      t.mock.method(fs, 'readFile', async (filePath, ...args) => {
        if (path.resolve(filePath) === artifactManifestPath) {
          artifactManifestReads += 1;
          if (artifactManifestReads === 2) return scenario.replacement(originalManifestText);
        }
        return originalReadFile(filePath, ...args);
      });
      let stderr = '';

      const exitCode = await runBrowserAttestationPromotionCli({
        argv: [
          '--bundle', bundleDirectory,
          '--evidence-url', `https://evidence.example.test/localization/${artifactHash}/attestation.json`,
          '--promotion-url', `https://evidence.example.test/localization/${artifactHash}/promotion.json`,
          '--signer-id', 'release-operator-01',
          '--private-key-file', privateKeyPath,
          '--output', stageDirectory,
        ],
        env: { LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON: JSON.stringify(trustedPromotionKeys) },
        now: NOW,
        stdout: { write() {} },
        stderr: { write(value) { stderr += value; } },
      });

      assert.equal(exitCode, 2);
      assert.match(stderr, new RegExp(scenario.expectedCode));
      await assert.rejects(readdir(stageDirectory), { code: 'ENOENT' });
    });
  }
});

test('the promotion CLI rejects an output-directory symlink that resolves inside the verified bundle', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'likerts-promotion-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactDirectory = path.join(root, 'dist');
  const bundleDirectory = path.join(root, 'bundle');
  const stageLink = path.join(root, 'stage-link');
  const ciPath = path.join(root, 'ci-attestation.json');
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(path.join(artifactDirectory, 'index.html'), '<main>promotion symlink</main>\n');
  const artifactManifest = await buildBrowserArtifactManifest(artifactDirectory);
  const ci = ciAttestation({ artifactDigest: artifactManifest.artifactDigest });
  await writeFile(ciPath, `${JSON.stringify(ci, null, 2)}\n`);
  await buildBrowserAttestationBundle({
    attestationPath: ciPath,
    artifactDirectory,
    outputDirectory: bundleDirectory,
    now: NOW,
  });
  const artifactHash = artifactManifest.artifactDigest.slice('sha256:'.length);
  const nestedBundleDirectory = path.join(bundleDirectory, artifactHash, 'empty-stage-target');
  await mkdir(nestedBundleDirectory);
  await symlink(nestedBundleDirectory, stageLink, 'dir');
  const privateKeyPath = path.join(root, 'promotion-private-key.pem');
  await writeFile(privateKeyPath, signerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  let stderr = '';

  const exitCode = await runBrowserAttestationPromotionCli({
    argv: [
      '--bundle', bundleDirectory,
      '--evidence-url', `https://evidence.example.test/localization/${artifactHash}/attestation.json`,
      '--promotion-url', `https://evidence.example.test/localization/${artifactHash}/promotion.json`,
      '--signer-id', 'release-operator-01',
      '--private-key-file', privateKeyPath,
      '--output', stageLink,
    ],
    env: { LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON: JSON.stringify(trustedPromotionKeys) },
    now: NOW,
    stdout: { write() {} },
    stderr: { write(value) { stderr += value; } },
  });

  assert.equal(exitCode, 2);
  assert.match(stderr, /PROMOTION_OUTPUT_(?:SYMLINK|CONTAINED)/);
  assert.deepEqual(await readdir(nestedBundleDirectory), []);
});
