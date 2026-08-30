import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  assertBrowserArtifactOutputOutsideRoot,
  buildBrowserArtifactManifest,
  compareCanonicalBrowserArtifactPaths,
} from './browser-artifact-binding.js';
import {
  LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION,
  validateLocalizationBrowserAttestation,
} from './localization-browser-attestation.js';
import {
  LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
  LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
  LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
  LOCALIZATION_JOURNEY_FLOWS,
  LOCALIZATION_JOURNEY_GATE_VERSION,
} from './localization-scorecard.js';
import { LOCALIZATION_REGISTRY_VERSION } from '../shared/localization.mjs';

export const LOCALIZATION_BROWSER_ATTESTATION_BUNDLE_SCHEMA_VERSION = 'localization-browser-attestation-bundle-v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export class BrowserAttestationBundleError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'BrowserAttestationBundleError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new BrowserAttestationBundleError(code, message, cause ? { cause } : undefined);
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Bundle values must be JSON-compatible plain objects.');
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digestBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function updateAggregateDigest(digest, relativePath, bytes) {
  digest.update(`${Buffer.byteLength(relativePath)}\0${relativePath}\0${bytes.length}\0`);
  digest.update(bytes);
}

function aggregateDigest(files) {
  const digest = createHash('sha256');
  for (const file of files) updateAggregateDigest(digest, file.relativePath, file.bytes);
  return `sha256:${digest.digest('hex')}`;
}

function portableArtifactManifest(manifest) {
  return {
    schemaVersion: 'browser-artifact-manifest-v1',
    artifactDigest: manifest.artifactDigest,
    files: manifest.files.map(({ relativePath, byteLength, contentDigest }) => ({
      relativePath,
      byteLength,
      contentDigest,
    })),
  };
}

function attestationEvidenceDigest(attestation) {
  const { evidenceId: _evidenceId, ...payload } = attestation;
  return digestBytes(Buffer.from(canonicalJson(payload)));
}

function validatePortableAttestation(attestation, { now = new Date() } = {}) {
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    fail('BUNDLE_ATTESTATION_INVALID', 'The attestation is not a JSON object.');
  }
  if (attestation.schemaVersion !== LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION
    || attestation.status !== 'PASSED'
    || attestation.publication?.status !== 'CI_ARTIFACT'
    || attestation.publication?.evidenceUrl !== null) {
    fail('BUNDLE_ATTESTATION_NOT_CI_ARTIFACT', 'Only a passed, unpublished CI_ARTIFACT attestation may be bundled locally.');
  }
  if (!SHA256_PATTERN.test(attestation.evidenceId || '')
    || attestationEvidenceDigest(attestation) !== attestation.evidenceId) {
    fail('BUNDLE_ATTESTATION_DIGEST_INVALID', 'The attestation evidenceId does not match its canonical JSON payload.');
  }
  if (!attestation.build || typeof attestation.build !== 'object'
    || typeof attestation.build.id !== 'string' || !attestation.build.id.trim()
    || !SHA256_PATTERN.test(attestation.build.artifactDigest || '')) {
    fail('BUNDLE_BUILD_IDENTITY_INVALID', 'The attestation build identity is missing or malformed.');
  }
  const validation = validateLocalizationBrowserAttestation(attestation, {
    suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
    registryVersion: LOCALIZATION_REGISTRY_VERSION,
    buildIdentity: {
      id: attestation.build.id,
      artifactDigest: attestation.build.artifactDigest,
    },
    requiredLocaleIds: LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
    requiredViewports: LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
    requiredSamplesByLocale: LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
    allowedFlowIds: LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id),
    now,
  });
  if (!validation.ok || validation.published) {
    fail(
      'BUNDLE_ATTESTATION_CONTRACT_INVALID',
      `The attestation does not satisfy the canonical unpublished browser-evidence contract (${validation.code || 'PUBLICATION_INVALID'}).`,
    );
  }
}

function portableManifestJson(manifest) {
  return `${canonicalJson(manifest)}\n`;
}

function contentAddressedPrefix(artifactDigest) {
  return artifactDigest.slice('sha256:'.length);
}

function assertRelativeBundlePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.startsWith('/')
    || relativePath !== path.posix.normalize(relativePath)
    || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('BUNDLE_FILE_SET_INVALID', `The bundle contains an unsafe path: ${relativePath || '<unknown>'}.`);
  }
}

async function readJson(filePath, code) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    fail(code, `Could not read bundle file: ${filePath}.`, error);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(code, `Bundle file is not valid JSON: ${filePath}.`, error);
  }
}

function parseCanonicalJson(bytes, label) {
  const text = bytes.toString('utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail('BUNDLE_JSON_INVALID', `${label} is not valid JSON.`, error);
  }
  if (text !== `${canonicalJson(value)}\n`) {
    fail('BUNDLE_JSON_NONCANONICAL', `${label} is not canonical JSON.`);
  }
  return value;
}

function pathIsWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function lstatIfExists(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertOutputLeafAbsent(outputDirectory) {
  if (await lstatIfExists(outputDirectory)) {
    fail('BUNDLE_OUTPUT_EXISTS', 'Bundle output path must not already exist.');
  }
}

async function resolveExistingAncestor(targetPath) {
  const missingSegments = [];
  let cursor = path.resolve(targetPath);
  while (true) {
    try {
      return {
        existingAncestor: await fs.realpath(cursor),
        missingSegments: missingSegments.reverse(),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function ensureStableRealDirectory(directoryPath, expectedRealPath, code, message) {
  const stat = await lstatIfExists(directoryPath);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    fail(code, message);
  }
  const realPath = await fs.realpath(directoryPath);
  if (realPath !== expectedRealPath) fail(code, message);
  return realPath;
}

async function ensureValidatedOutputParent(outputDirectory, buildRoot) {
  const outputParent = path.dirname(outputDirectory);
  const { existingAncestor, missingSegments } = await resolveExistingAncestor(outputParent);
  if (pathIsWithin(buildRoot, existingAncestor)) {
    fail('ARTIFACT_OUTPUT_PATH_CONTAINED', 'Browser attestation output resolves inside the hashed build directory.');
  }
  let currentPath = existingAncestor;
  for (const segment of missingSegments) {
    currentPath = path.join(currentPath, segment);
    try {
      await fs.mkdir(currentPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        fail('BUNDLE_OUTPUT_INVALID', `Could not prepare the bundle output parent: ${currentPath}.`, error);
      }
    }
    const stat = await lstatIfExists(currentPath);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      fail('BUNDLE_OUTPUT_INVALID', `The bundle output parent must resolve through real directories only: ${currentPath}.`);
    }
    const realPath = await fs.realpath(currentPath);
    if (pathIsWithin(buildRoot, realPath)) {
      fail('ARTIFACT_OUTPUT_PATH_CONTAINED', 'Browser attestation output resolves inside the hashed build directory.');
    }
    currentPath = realPath;
  }
  return ensureStableRealDirectory(
    currentPath,
    currentPath,
    'BUNDLE_OUTPUT_INVALID',
    'The bundle output parent changed while it was being prepared.',
  );
}

async function createBundleStagingDirectory(outputParent) {
  let stagingDirectory;
  try {
    stagingDirectory = await fs.mkdtemp(path.join(outputParent, '.bundle-stage-'));
    await fs.chmod(stagingDirectory, 0o700);
  } catch (error) {
    fail('BUNDLE_OUTPUT_INVALID', 'Could not create a private staging directory for the bundle output.', error);
  }
  const realStagingDirectory = await fs.realpath(stagingDirectory);
  return { stagingDirectory, realStagingDirectory };
}

async function ensureStagingSubdirectory(stagingDirectory, relativeDirectory) {
  let currentPath = stagingDirectory;
  for (const segment of relativeDirectory.split('/')) {
    if (!segment) continue;
    currentPath = path.join(currentPath, segment);
    try {
      await fs.mkdir(currentPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        fail('BUNDLE_OUTPUT_INVALID', `Could not prepare the bundle staging directory: ${currentPath}.`, error);
      }
    }
    const stat = await lstatIfExists(currentPath);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      fail('BUNDLE_OUTPUT_INVALID', `Bundle staging paths must remain directories: ${currentPath}.`);
    }
    const realPath = await fs.realpath(currentPath);
    if (!pathIsWithin(stagingDirectory, realPath)) {
      fail('BUNDLE_OUTPUT_INVALID', `Bundle staging paths escaped the staging directory: ${currentPath}.`);
    }
    currentPath = realPath;
  }
}

async function writeExclusiveFile(targetPath, bytes) {
  try {
    await fs.writeFile(targetPath, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('BUNDLE_OUTPUT_WRITE_CONFLICT', `Refusing to overwrite a preexisting bundle path: ${targetPath}.`, error);
    }
    fail('BUNDLE_OUTPUT_INVALID', `Could not write bundle file: ${targetPath}.`, error);
  }
}

async function finalizeBundledOutput({
  buildRoot,
  outputDirectory,
  outputParent,
  stagingDirectory,
  realStagingDirectory,
}) {
  await ensureStableRealDirectory(
    stagingDirectory,
    realStagingDirectory,
    'BUNDLE_OUTPUT_FINALIZATION_RACE',
    'The bundle staging directory changed before the staged bundle could be published.',
  );
  await ensureStableRealDirectory(
    outputParent,
    outputParent,
    'BUNDLE_OUTPUT_FINALIZATION_RACE',
    'The bundle output parent changed before the staged bundle could be published.',
  );
  await assertOutputLeafAbsent(outputDirectory);
  try {
    await fs.rename(stagingDirectory, outputDirectory);
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
      fail('BUNDLE_OUTPUT_EXISTS', 'Bundle output path must not already exist.', error);
    }
    fail('BUNDLE_OUTPUT_FINALIZATION_RACE', 'Could not publish the staged bundle output safely.', error);
  }
  const realOutputDirectory = await fs.realpath(outputDirectory);
  if (pathIsWithin(buildRoot, realOutputDirectory)) {
    fail('ARTIFACT_OUTPUT_PATH_CONTAINED', 'Browser attestation output resolves inside the hashed build directory.');
  }
  if (path.dirname(realOutputDirectory) !== outputParent) {
    fail('BUNDLE_OUTPUT_FINALIZATION_RACE', 'The bundle output resolved outside its validated parent directory.');
  }
  return realOutputDirectory;
}

async function invokeTestHook(testHooks, name, payload) {
  if (typeof testHooks?.[name] === 'function') {
    await testHooks[name](payload);
  }
}

export async function buildBrowserAttestationBundle({
  attestationPath,
  artifactDirectory,
  outputDirectory,
  now = new Date(),
  testHooks = null,
} = {}) {
  if (!attestationPath || !artifactDirectory || !outputDirectory) {
    fail('BUNDLE_INPUT_REQUIRED', 'attestationPath, artifactDirectory, and outputDirectory are required.');
  }

  const resolvedArtifactDirectory = path.resolve(artifactDirectory);
  const resolvedAttestationPath = path.resolve(attestationPath);
  const { outputPath: safeOutputDirectory } = await assertBrowserArtifactOutputOutsideRoot({
    rootDirectory: resolvedArtifactDirectory,
    outputPath: path.resolve(outputDirectory),
  });

  const attestation = await readJson(resolvedAttestationPath, 'BUNDLE_ATTESTATION_INVALID');
  validatePortableAttestation(attestation, { now });
  const artifactManifest = await buildBrowserArtifactManifest(resolvedArtifactDirectory);
  if (attestation.build.artifactDigest !== artifactManifest.artifactDigest) {
    fail('BUNDLE_ARTIFACT_DIGEST_MISMATCH', 'Attestation and artifact directory have different content digests.');
  }

  const portableManifest = portableArtifactManifest(artifactManifest);
  const contentAddressedDirectory = contentAddressedPrefix(artifactManifest.artifactDigest);
  const attestationBundlePath = `${contentAddressedDirectory}/attestation.json`;
  const artifactManifestBundlePath = `${contentAddressedDirectory}/artifact-manifest.json`;
  const payloadFiles = [
    { relativePath: attestationBundlePath, bytes: Buffer.from(`${canonicalJson(attestation)}\n`) },
    { relativePath: artifactManifestBundlePath, bytes: Buffer.from(portableManifestJson(portableManifest)) },
    ...artifactManifest.files.map((entry) => ({
      relativePath: path.posix.join(contentAddressedDirectory, 'artifact', entry.relativePath),
      bytes: Buffer.from(entry.bytes),
    })),
  ].sort((left, right) => (
    compareCanonicalBrowserArtifactPaths(left.relativePath, right.relativePath)
  ));

  const manifest = {
    schemaVersion: LOCALIZATION_BROWSER_ATTESTATION_BUNDLE_SCHEMA_VERSION,
    publicationStatus: 'CI_ARTIFACT',
    published: false,
    attestationPath: attestationBundlePath,
    artifactManifestPath: artifactManifestBundlePath,
    evidenceId: attestation.evidenceId,
    artifactDigest: artifactManifest.artifactDigest,
    files: payloadFiles.map((file) => ({
      relativePath: file.relativePath,
      byteLength: file.bytes.length,
      contentDigest: digestBytes(file.bytes),
    })),
    bundleDigest: aggregateDigest(payloadFiles),
  };
  const bundleManifestBytes = Buffer.from(portableManifestJson(manifest));
  const buildRoot = path.resolve(resolvedArtifactDirectory);
  await assertOutputLeafAbsent(safeOutputDirectory);
  const outputParent = await ensureValidatedOutputParent(safeOutputDirectory, buildRoot);
  const { stagingDirectory, realStagingDirectory } = await createBundleStagingDirectory(outputParent);
  let publishedOutput = false;
  try {
    await invokeTestHook(testHooks, 'afterStagingDirectoryCreated', {
      stagingDirectory,
      outputDirectory: safeOutputDirectory,
      outputParent,
    });
    for (const file of payloadFiles) {
      assertRelativeBundlePath(file.relativePath);
      await ensureStableRealDirectory(
        stagingDirectory,
        realStagingDirectory,
        'BUNDLE_OUTPUT_INVALID',
        'The bundle staging directory changed while files were being written.',
      );
      const target = path.join(stagingDirectory, ...file.relativePath.split('/'));
      await ensureStagingSubdirectory(realStagingDirectory, path.posix.dirname(file.relativePath));
      await invokeTestHook(testHooks, 'beforePayloadWrite', {
        relativePath: file.relativePath,
        targetPath: target,
        stagingDirectory,
        outputDirectory: safeOutputDirectory,
      });
      await writeExclusiveFile(target, file.bytes);
    }
    await ensureStableRealDirectory(
      stagingDirectory,
      realStagingDirectory,
      'BUNDLE_OUTPUT_INVALID',
      'The bundle staging directory changed while the manifest was being written.',
    );
    await writeExclusiveFile(
      path.join(realStagingDirectory, 'bundle-manifest.json'),
      bundleManifestBytes,
    );
    await invokeTestHook(testHooks, 'beforeFinalize', {
      stagingDirectory,
      outputDirectory: safeOutputDirectory,
      outputParent,
    });
    const finalOutputDirectory = await finalizeBundledOutput({
      buildRoot,
      outputDirectory: safeOutputDirectory,
      outputParent,
      stagingDirectory,
      realStagingDirectory,
    });
    publishedOutput = true;
    return {
      bundleDirectory: finalOutputDirectory,
      bundleDigest: manifest.bundleDigest,
      artifactDigest: manifest.artifactDigest,
      evidenceId: manifest.evidenceId,
      fileCount: manifest.files.length,
      publicationStatus: manifest.publicationStatus,
      published: false,
    };
  } finally {
    if (!publishedOutput) {
      await fs.rm(stagingDirectory, { recursive: true, force: true });
    }
  }
}

function validateBundleManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.schemaVersion !== LOCALIZATION_BROWSER_ATTESTATION_BUNDLE_SCHEMA_VERSION
    || manifest.publicationStatus !== 'CI_ARTIFACT'
    || manifest.published !== false
    || !SHA256_PATTERN.test(manifest.bundleDigest || '')
    || !SHA256_PATTERN.test(manifest.artifactDigest || '')
    || !SHA256_PATTERN.test(manifest.evidenceId || '')
    || !Array.isArray(manifest.files) || manifest.files.length < 2) {
    fail('BUNDLE_MANIFEST_INVALID', 'The browser attestation bundle manifest is missing or malformed.');
  }
  const contentAddressedDirectory = contentAddressedPrefix(manifest.artifactDigest);
  if (manifest.attestationPath !== `${contentAddressedDirectory}/attestation.json`
    || manifest.artifactManifestPath !== `${contentAddressedDirectory}/artifact-manifest.json`) {
    fail('BUNDLE_MANIFEST_INVALID', 'Bundle paths must be rooted at the artifact content address.');
  }
  const paths = manifest.files.map((entry) => entry?.relativePath);
  if (paths.some((relativePath) => {
    try {
      assertRelativeBundlePath(relativePath);
      return false;
    } catch {
      return true;
    }
  }) || new Set(paths).size !== paths.length
    || paths.some((relativePath, index) => (
      index > 0 && compareCanonicalBrowserArtifactPaths(relativePath, paths[index - 1]) <= 0
    ))) {
    fail('BUNDLE_FILE_SET_INVALID', 'Bundle manifest paths must be unique, normalized, and sorted.');
  }
  if (!paths.includes(manifest.attestationPath) || !paths.includes(manifest.artifactManifestPath)) {
    fail('BUNDLE_FILE_SET_INVALID', 'Bundle manifest must include attestation.json and artifact-manifest.json.');
  }
  const artifactPrefix = `${contentAddressedDirectory}/artifact/`;
  if (paths.some((relativePath) => relativePath !== manifest.attestationPath
    && relativePath !== manifest.artifactManifestPath
    && !relativePath.startsWith(artifactPrefix))) {
    fail('BUNDLE_FILE_SET_INVALID', 'Bundle manifest contains payload outside its attestation, artifact manifest, or artifact tree.');
  }
}

async function readBundlePayload(bundleDirectory, entry) {
  const target = path.join(bundleDirectory, ...entry.relativePath.split('/'));
  let bytes;
  try {
    bytes = await fs.readFile(target);
  } catch (error) {
    fail('BUNDLE_FILE_MISSING', `Bundle payload is missing: ${entry.relativePath}.`, error);
  }
  if (bytes.length !== entry.byteLength || digestBytes(bytes) !== entry.contentDigest) {
    fail('BUNDLE_FILE_DIGEST_MISMATCH', `Bundle payload does not match its manifest: ${entry.relativePath}.`);
  }
  return { relativePath: entry.relativePath, bytes };
}

async function discoverBundleFiles(bundleDirectory) {
  const files = [];
  async function visit(directory, relativeDirectory = '') {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      fail('BUNDLE_DIRECTORY_UNREADABLE', `Could not read bundle directory: ${directory}.`, error);
    }
    entries.sort((left, right) => compareCanonicalBrowserArtifactPaths(left.name, right.name));
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else fail('BUNDLE_ENTRY_UNSUPPORTED', `Bundle contains a non-regular filesystem entry: ${relativePath}.`);
    }
  }
  await visit(bundleDirectory);
  return files.sort(compareCanonicalBrowserArtifactPaths);
}

export async function verifyBrowserAttestationBundle(bundleDirectory, { now = new Date() } = {}) {
  if (!bundleDirectory) fail('BUNDLE_INPUT_REQUIRED', 'A bundle directory is required.');
  const resolvedBundleDirectory = path.resolve(bundleDirectory);
  let manifestBytes;
  try {
    manifestBytes = await fs.readFile(path.join(resolvedBundleDirectory, 'bundle-manifest.json'));
  } catch (error) {
    fail('BUNDLE_MANIFEST_INVALID', 'Could not read bundle-manifest.json.', error);
  }
  const manifest = parseCanonicalJson(manifestBytes, 'Bundle manifest');
  validateBundleManifest(manifest);
  const discoveredFiles = await discoverBundleFiles(resolvedBundleDirectory);
  const expectedFiles = [
    'bundle-manifest.json',
    ...manifest.files.map((entry) => entry.relativePath),
  ].sort(compareCanonicalBrowserArtifactPaths);
  if (discoveredFiles.length !== expectedFiles.length
    || discoveredFiles.some((relativePath, index) => relativePath !== expectedFiles[index])) {
    fail('BUNDLE_FILE_SET_MISMATCH', 'The bundle directory contains unmanifested or missing files.');
  }
  const payloadFiles = [];
  for (const entry of manifest.files) payloadFiles.push(await readBundlePayload(resolvedBundleDirectory, entry));
  if (aggregateDigest(payloadFiles) !== manifest.bundleDigest) {
    fail('BUNDLE_DIGEST_MISMATCH', 'The bundle aggregate digest does not match its payload files.');
  }

  const attestationFile = payloadFiles.find((entry) => entry.relativePath === manifest.attestationPath);
  const artifactManifestFile = payloadFiles.find((entry) => entry.relativePath === manifest.artifactManifestPath);
  const attestation = parseCanonicalJson(attestationFile.bytes, 'Bundled attestation');
  validatePortableAttestation(attestation, { now });
  if (attestation.evidenceId !== manifest.evidenceId
    || attestation.build.artifactDigest !== manifest.artifactDigest) {
    fail('BUNDLE_IDENTITY_MISMATCH', 'Bundle identity does not match the attestation.');
  }
  const portableManifest = parseCanonicalJson(artifactManifestFile.bytes, 'Bundled artifact manifest');
  if (portableManifest.schemaVersion !== 'browser-artifact-manifest-v1'
    || portableManifest.artifactDigest !== manifest.artifactDigest
    || !Array.isArray(portableManifest.files)
    || portableManifest.files.some((entry) => {
      try {
        assertRelativeBundlePath(entry?.relativePath);
        return !Number.isInteger(entry.byteLength) || entry.byteLength < 0 || !SHA256_PATTERN.test(entry.contentDigest || '');
      } catch {
        return true;
      }
    })) {
    fail('ARTIFACT_MANIFEST_INVALID', 'The bundled artifact manifest is missing or malformed.');
  }
  const artifactRelativePaths = portableManifest.files.map((entry) => entry.relativePath);
  if (new Set(artifactRelativePaths).size !== artifactRelativePaths.length
    || artifactRelativePaths.some((relativePath, index) => (
      index > 0 && compareCanonicalBrowserArtifactPaths(relativePath, artifactRelativePaths[index - 1]) <= 0
    ))) {
    fail('ARTIFACT_MANIFEST_INVALID', 'The bundled artifact manifest paths must be unique and sorted.');
  }

  const contentAddressedDirectory = contentAddressedPrefix(manifest.artifactDigest);
  const expectedArtifactFiles = portableManifest.files.map((entry) => ({
    relativePath: path.posix.join(contentAddressedDirectory, 'artifact', entry.relativePath),
    byteLength: entry.byteLength,
    contentDigest: entry.contentDigest,
  }));
  const actualArtifactFiles = manifest.files
    .filter((entry) => entry.relativePath.startsWith(`${contentAddressedDirectory}/artifact/`))
    .map(({ relativePath, byteLength, contentDigest }) => ({ relativePath, byteLength, contentDigest }));
  if (canonicalJson(actualArtifactFiles) !== canonicalJson(expectedArtifactFiles)) {
    fail('ARTIFACT_MANIFEST_MISMATCH', 'Bundled artifact files do not match artifact-manifest.json.');
  }
  const artifactPayloadFiles = portableManifest.files.map((entry) => ({
    relativePath: entry.relativePath,
    bytes: payloadFiles.find((file) => file.relativePath === path.posix.join(contentAddressedDirectory, 'artifact', entry.relativePath)).bytes,
  }));
  if (aggregateDigest(artifactPayloadFiles) !== manifest.artifactDigest) {
    fail('ARTIFACT_DIGEST_MISMATCH', 'Bundled artifact bytes do not match their declared aggregate digest.');
  }

  return {
    ok: true,
    bundleDirectory: resolvedBundleDirectory,
    bundleDigest: manifest.bundleDigest,
    artifactDigest: manifest.artifactDigest,
    evidenceId: manifest.evidenceId,
    verifiedFileCount: manifest.files.length,
    publicationStatus: 'CI_ARTIFACT',
    published: false,
  };
}
