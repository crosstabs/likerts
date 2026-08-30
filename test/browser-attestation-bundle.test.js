import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildBrowserAttestationBundle,
  verifyBrowserAttestationBundle,
} from '../server/browser-attestation-bundle.js';
import {
  buildBrowserArtifactManifest,
  compareCanonicalBrowserArtifactPaths,
} from '../server/browser-artifact-binding.js';
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
import { LOCALIZATION_REGISTRY_VERSION } from '../shared/localization.mjs';

const FIXED_NOW = new Date('2026-08-30T12:00:00.000Z');

function accessibilitySurfaceChecks(deep) {
  return (deep
    ? LOCALIZATION_BROWSER_ACCESSIBILITY_SURFACE_IDS
    : LOCALIZATION_BROWSER_ACCESSIBILITY_CORE_SURFACE_IDS).map((surfaceId) => ({
    surfaceId,
    snapshotCount: ['specialized-method-results', 'specialized-method-handoffs'].includes(surfaceId) ? 10 : 1,
    violations: 0,
  }));
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function aggregateManifestDigest(bundleDirectory, entries) {
  const digest = createHash('sha256');
  for (const entry of entries) {
    const bytes = await readFile(path.join(bundleDirectory, ...entry.relativePath.split('/')));
    digest.update(`${Buffer.byteLength(entry.relativePath)}\0${entry.relativePath}\0${bytes.length}\0`);
    digest.update(bytes);
  }
  return `sha256:${digest.digest('hex')}`;
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

async function fixture(t, { unicodePaths = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'likerts-attestation-bundle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactDirectory = path.join(root, 'dist');
  const evidenceDirectory = path.join(root, 'evidence');
  await writeFile(path.join(root, 'placeholder'), 'unused');
  await mkdir(path.join(artifactDirectory, 'assets'), { recursive: true });
  await writeFile(path.join(artifactDirectory, 'index.html'), '<main>candidate</main>\n');
  await writeFile(path.join(artifactDirectory, 'assets', 'app.js'), 'globalThis.ready = true;\n');
  if (unicodePaths) {
    await writeFile(path.join(artifactDirectory, 'z.js'), 'ascii path\n');
    await writeFile(path.join(artifactDirectory, 'ä.js'), 'unicode path\n');
  }

  const { artifactDigest } = await buildBrowserArtifactManifest(artifactDirectory);
  const attestation = createLocalizationBrowserAttestation({
    suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    verifiedAt: '2026-08-29T12:00:00.000Z',
    build: {
      id: 'local-test-build-20260829',
      artifactDigest,
      candidateUrl: 'http://127.0.0.1:4173/',
    },
    publication: { status: 'CI_ARTIFACT', evidenceUrl: null },
    execution: {
      evidenceMode: 'FIXTURE_BACKED_UI_REQUEST_CONTRACT',
      apiMode: 'IN_PROCESS_FIXTURES_UNKNOWN_API_ABORTED',
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
  const attestationPath = path.join(root, 'attestation.json');
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
  return { artifactDirectory, evidenceDirectory, attestationPath, artifactDigest, attestation };
}

function bundleIdentityForLocale(input, outputDirectory, locale) {
  const moduleUrl = new URL('../server/browser-attestation-bundle.js', import.meta.url).href;
  const script = `
    import { readFile } from 'node:fs/promises';
    import path from 'node:path';
    import { buildBrowserAttestationBundle } from ${JSON.stringify(moduleUrl)};
    const [attestationPath, artifactDirectory, outputDirectory] = process.argv.slice(1);
    const receipt = await buildBrowserAttestationBundle({
      attestationPath,
      artifactDirectory,
      outputDirectory,
      now: new Date(${JSON.stringify(FIXED_NOW.toISOString())}),
    });
    const manifest = JSON.parse(await readFile(path.join(outputDirectory, 'bundle-manifest.json'), 'utf8'));
    process.stdout.write(JSON.stringify({
      artifactDigest: receipt.artifactDigest,
      bundleDigest: receipt.bundleDigest,
      relativePaths: manifest.files.map((entry) => entry.relativePath),
    }));
  `;
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    script,
    input.attestationPath,
    input.artifactDirectory,
    outputDirectory,
  ], {
    encoding: 'utf8',
    env: { ...process.env, LANG: locale, LC_ALL: locale },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('bundle generation is deterministic, portable, and explicitly unpublished', async (t) => {
  const input = await fixture(t);
  const firstOutput = path.join(input.evidenceDirectory, 'first');
  const secondOutput = path.join(input.evidenceDirectory, 'second');
  const first = await buildBrowserAttestationBundle({
    attestationPath: input.attestationPath,
    artifactDirectory: input.artifactDirectory,
    outputDirectory: firstOutput,
    now: FIXED_NOW,
  });
  const second = await buildBrowserAttestationBundle({
    attestationPath: input.attestationPath,
    artifactDirectory: input.artifactDirectory,
    outputDirectory: secondOutput,
    now: FIXED_NOW,
  });

  assert.equal(first.publicationStatus, 'CI_ARTIFACT');
  assert.equal(first.published, false);
  assert.equal(first.bundleDigest, second.bundleDigest);
  assert.equal(await readFile(path.join(firstOutput, 'bundle-manifest.json'), 'utf8'), await readFile(path.join(secondOutput, 'bundle-manifest.json'), 'utf8'));
  const bundleManifest = JSON.parse(await readFile(path.join(firstOutput, 'bundle-manifest.json'), 'utf8'));
  assert.equal(bundleManifest.attestationPath, `${input.artifactDigest.slice('sha256:'.length)}/attestation.json`);
  assert.deepEqual(await verifyBrowserAttestationBundle(firstOutput, { now: FIXED_NOW }), {
    ok: true,
    bundleDirectory: path.resolve(firstOutput),
    bundleDigest: first.bundleDigest,
    artifactDigest: input.artifactDigest,
    evidenceId: input.attestation.evidenceId,
    verifiedFileCount: 4,
    publicationStatus: 'CI_ARTIFACT',
    published: false,
  });
});

test('bundle identity uses one canonical Unicode path order across process locales', async (t) => {
  const input = await fixture(t, { unicodePaths: true });
  const english = bundleIdentityForLocale(
    input,
    path.join(input.evidenceDirectory, 'english'),
    'en_US.UTF-8',
  );
  const swedish = bundleIdentityForLocale(
    input,
    path.join(input.evidenceDirectory, 'swedish'),
    'sv_SE.UTF-8',
  );

  assert.deepEqual(english, swedish);
  const artifactPrefix = `${input.artifactDigest.slice('sha256:'.length)}/artifact/`;
  assert.deepEqual(
    english.relativePaths.filter((relativePath) => relativePath.startsWith(artifactPrefix)),
    [
      `${artifactPrefix}assets/app.js`,
      `${artifactPrefix}index.html`,
      `${artifactPrefix}z.js`,
      `${artifactPrefix}ä.js`,
    ],
  );
});

test('bundle verification detects payload tampering and refuses published attestations', async (t) => {
  const input = await fixture(t);
  const output = path.join(input.evidenceDirectory, 'bundle');
  await buildBrowserAttestationBundle({
    attestationPath: input.attestationPath,
    artifactDirectory: input.artifactDirectory,
    outputDirectory: output,
    now: FIXED_NOW,
  });

  await writeFile(path.join(output, input.artifactDigest.slice('sha256:'.length), 'artifact', 'index.html'), 'tampered\n');
  await assert.rejects(
    verifyBrowserAttestationBundle(output, { now: FIXED_NOW }),
    (error) => error?.code === 'BUNDLE_FILE_DIGEST_MISMATCH',
  );

  await writeFile(path.join(output, 'unmanifested.txt'), 'extra\n');
  await assert.rejects(
    verifyBrowserAttestationBundle(output, { now: FIXED_NOW }),
    (error) => error?.code === 'BUNDLE_FILE_SET_MISMATCH',
  );

  const publishedAttestation = structuredClone(input.attestation);
  publishedAttestation.publication = { status: 'PUBLISHED', evidenceUrl: 'https://example.invalid/immutable/attestation.json' };
  const { evidenceId: _evidenceId, ...publishedPayload } = publishedAttestation;
  publishedAttestation.evidenceId = sha256(Buffer.from(canonicalJson(publishedPayload)));
  await writeFile(input.attestationPath, JSON.stringify(publishedAttestation));
  await assert.rejects(
    buildBrowserAttestationBundle({
      attestationPath: input.attestationPath,
      artifactDirectory: input.artifactDirectory,
      outputDirectory: path.join(input.evidenceDirectory, 'published'),
      now: FIXED_NOW,
    }),
    (error) => error?.code === 'BUNDLE_ATTESTATION_NOT_CI_ARTIFACT',
  );
});

test('bundle output cannot be placed inside the hashed artifact directory', async (t) => {
  const input = await fixture(t);
  await assert.rejects(
    buildBrowserAttestationBundle({
      attestationPath: input.attestationPath,
      artifactDirectory: input.artifactDirectory,
      outputDirectory: path.join(input.artifactDirectory, 'evidence'),
      now: FIXED_NOW,
    }),
    (error) => error?.code === 'ARTIFACT_OUTPUT_PATH_CONTAINED',
  );
});

test('bundle generation refuses a preexisting output leaf', async (t) => {
  const input = await fixture(t);
  const output = path.join(input.evidenceDirectory, 'bundle');
  await mkdir(input.evidenceDirectory, { recursive: true });
  await writeFile(output, 'occupied\n');

  await assert.rejects(
    buildBrowserAttestationBundle({
      attestationPath: input.attestationPath,
      artifactDirectory: input.artifactDirectory,
      outputDirectory: output,
      now: FIXED_NOW,
    }),
    (error) => error?.code === 'BUNDLE_OUTPUT_EXISTS',
  );

  assert.equal(await readFile(output, 'utf8'), 'occupied\n');
});

test('bundle generation refuses a preexisting output symlink leaf', async (t) => {
  const input = await fixture(t);
  const redirectedDirectory = path.join(input.evidenceDirectory, 'redirected');
  const output = path.join(input.evidenceDirectory, 'bundle');
  await mkdir(redirectedDirectory, { recursive: true });
  await symlink(redirectedDirectory, output);

  await assert.rejects(
    buildBrowserAttestationBundle({
      attestationPath: input.attestationPath,
      artifactDirectory: input.artifactDirectory,
      outputDirectory: output,
      now: FIXED_NOW,
    }),
    (error) => error?.code === 'BUNDLE_OUTPUT_EXISTS',
  );

  assert.deepEqual(await readdir(redirectedDirectory), []);
});

test('bundle generation refuses an injected staged symlink leaf before payload write', async (t) => {
  const input = await fixture(t);
  const output = path.join(input.evidenceDirectory, 'bundle');
  const redirectedDirectory = path.join(input.evidenceDirectory, 'redirected');
  await mkdir(redirectedDirectory, { recursive: true });
  let injected = false;

  await assert.rejects(
    buildBrowserAttestationBundle({
      attestationPath: input.attestationPath,
      artifactDirectory: input.artifactDirectory,
      outputDirectory: output,
      now: FIXED_NOW,
      testHooks: {
        async beforePayloadWrite({ relativePath, targetPath }) {
          if (injected || !relativePath.endsWith('/artifact/index.html')) return;
          injected = true;
          await symlink(path.join(redirectedDirectory, 'captured-index.html'), targetPath);
        },
      },
    }),
    (error) => error?.code === 'BUNDLE_OUTPUT_WRITE_CONFLICT',
  );

  assert.equal(injected, true);
  assert.deepEqual(await readdir(redirectedDirectory), []);
  await assert.rejects(
    readFile(path.join(output, 'bundle-manifest.json'), 'utf8'),
    (error) => error?.code === 'ENOENT',
  );
});

test('bundle generation refuses an output leaf swap before staged publish', async (t) => {
  const input = await fixture(t);
  const output = path.join(input.evidenceDirectory, 'bundle');
  const redirectedDirectory = path.join(input.evidenceDirectory, 'redirected');
  await mkdir(redirectedDirectory, { recursive: true });
  let swapped = false;

  await assert.rejects(
    buildBrowserAttestationBundle({
      attestationPath: input.attestationPath,
      artifactDirectory: input.artifactDirectory,
      outputDirectory: output,
      now: FIXED_NOW,
      testHooks: {
        async beforeFinalize({ outputDirectory }) {
          if (swapped) return;
          swapped = true;
          await symlink(redirectedDirectory, outputDirectory);
        },
      },
    }),
    (error) => error?.code === 'BUNDLE_OUTPUT_EXISTS',
  );

  assert.equal(swapped, true);
  assert.deepEqual(await readdir(redirectedDirectory), []);
});

test('bundle generation refuses a staging-directory swap before publish', async (t) => {
  const input = await fixture(t);
  const output = path.join(input.evidenceDirectory, 'bundle');
  const redirectedDirectory = path.join(input.evidenceDirectory, 'redirected');
  await mkdir(redirectedDirectory, { recursive: true });
  let swapped = false;

  await assert.rejects(
    buildBrowserAttestationBundle({
      attestationPath: input.attestationPath,
      artifactDirectory: input.artifactDirectory,
      outputDirectory: output,
      now: FIXED_NOW,
      testHooks: {
        async beforeFinalize({ stagingDirectory }) {
          if (swapped) return;
          swapped = true;
          await rename(stagingDirectory, `${stagingDirectory}-moved`);
          await symlink(redirectedDirectory, stagingDirectory);
        },
      },
    }),
    (error) => error?.code === 'BUNDLE_OUTPUT_FINALIZATION_RACE',
  );

  assert.equal(swapped, true);
  assert.deepEqual(await readdir(redirectedDirectory), []);
  await assert.rejects(
    readFile(path.join(output, 'bundle-manifest.json'), 'utf8'),
    (error) => error?.code === 'ENOENT',
  );
});

test('bundle verification refuses manifested payload outside the content-addressed artifact tree', async (t) => {
  const input = await fixture(t);
  const output = path.join(input.evidenceDirectory, 'manifested-extra');
  await buildBrowserAttestationBundle({
    attestationPath: input.attestationPath,
    artifactDirectory: input.artifactDirectory,
    outputDirectory: output,
    now: FIXED_NOW,
  });

  const manifestPath = path.join(output, 'bundle-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const relativePath = `${input.artifactDigest.slice('sha256:'.length)}/extra-manifested.txt`;
  const bytes = Buffer.from('manifested but not permitted\n');
  await writeFile(path.join(output, ...relativePath.split('/')), bytes);
  manifest.files.push({
    relativePath,
    byteLength: bytes.length,
    contentDigest: sha256(bytes),
  });
  manifest.files.sort((left, right) => (
    compareCanonicalBrowserArtifactPaths(left.relativePath, right.relativePath)
  ));
  manifest.bundleDigest = await aggregateManifestDigest(output, manifest.files);
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`);

  await assert.rejects(
    verifyBrowserAttestationBundle(output, { now: FIXED_NOW }),
    (error) => error?.code === 'BUNDLE_FILE_SET_INVALID',
  );
});

test('bundle verification rejects a non-canonical root manifest', async (t) => {
  const input = await fixture(t);
  const output = path.join(input.evidenceDirectory, 'noncanonical-root');
  await buildBrowserAttestationBundle({
    attestationPath: input.attestationPath,
    artifactDirectory: input.artifactDirectory,
    outputDirectory: output,
    now: FIXED_NOW,
  });

  const manifestPath = path.join(output, 'bundle-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await assert.rejects(
    verifyBrowserAttestationBundle(output, { now: FIXED_NOW }),
    (error) => error?.code === 'BUNDLE_JSON_NONCANONICAL',
  );
});

test('bundle generation refuses a digest-valid attestation without the canonical journeys', async (t) => {
  const input = await fixture(t);
  const incomplete = structuredClone(input.attestation);
  incomplete.matrix = [];
  incomplete.flowEvidence = [];
  incomplete.methodCoverage = [];
  incomplete.sampleCoverage = [];
  const { evidenceId: _evidenceId, ...payload } = incomplete;
  incomplete.evidenceId = sha256(Buffer.from(canonicalJson(payload)));
  await writeFile(input.attestationPath, `${JSON.stringify(incomplete, null, 2)}\n`);
  await assert.rejects(
    buildBrowserAttestationBundle({
      attestationPath: input.attestationPath,
      artifactDirectory: input.artifactDirectory,
      outputDirectory: path.join(input.evidenceDirectory, 'incomplete'),
      now: FIXED_NOW,
    }),
    (error) => error?.code === 'BUNDLE_ATTESTATION_CONTRACT_INVALID',
  );
});
