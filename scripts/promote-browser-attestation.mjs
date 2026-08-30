#!/usr/bin/env node

import { createPrivateKey, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BrowserArtifactBindingError,
  validatePortableBrowserArtifactManifest,
  verifyPortableBrowserArtifactManifestBytes,
} from '../server/browser-artifact-binding.js';
import { verifyBrowserAttestationBundle } from '../server/browser-attestation-bundle.js';
import {
  LocalizationBrowserPromotionError,
  canonicalLocalizationBrowserPromotionJson,
  createLocalizationBrowserPromotionArtifact,
  derivePublishedLocalizationBrowserAttestation,
  hashLocalizationBrowserPromotion,
  validateLocalizationBrowserPromotion,
} from '../server/localization-browser-promotion.js';

const MAX_PRIVATE_KEY_BYTES = 65_536;
const REQUIRED_OPTIONS = Object.freeze([
  '--bundle',
  '--evidence-url',
  '--promotion-url',
  '--signer-id',
  '--private-key-file',
  '--output',
]);

function fail(code, message, cause) {
  throw new LocalizationBrowserPromotionError(code, message, cause ? { cause } : undefined);
}

function usage() {
  return [
    'Usage:',
    '  npm run attestation:promote -- --bundle <verified-ci-bundle> --evidence-url <immutable-attestation-url> --promotion-url <immutable-promotion-url> --signer-id <trusted-signer-id> --private-key-file <ed25519-private-key.pem> --output <new-or-empty-directory>',
    '',
    'This command stages local files only. It never uploads evidence or deploys.',
    '',
  ].join('\n');
}

function parseOptions(argv) {
  if (!Array.isArray(argv)) fail('PROMOTION_CLI_ARGUMENTS_INVALID', 'Promotion CLI arguments must be an array.');
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--help' || option === '-h') return { help: true };
    if (!REQUIRED_OPTIONS.includes(option)) {
      fail('PROMOTION_CLI_ARGUMENTS_INVALID', `Unknown promotion option: ${option || '<empty>'}.`);
    }
    if (Object.hasOwn(options, option)) fail('PROMOTION_CLI_ARGUMENTS_INVALID', `Promotion option ${option} was supplied more than once.`);
    const value = argv[index + 1];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      fail('PROMOTION_CLI_ARGUMENTS_INVALID', `Promotion option ${option} requires a value.`);
    }
    options[option] = value;
    index += 1;
  }
  for (const option of REQUIRED_OPTIONS) {
    if (!Object.hasOwn(options, option)) fail('PROMOTION_CLI_ARGUMENTS_INVALID', `Promotion option ${option} is required.`);
  }
  return options;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function trustedPromotionKeys(env) {
  const serialized = String(env?.LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON || '').trim();
  if (!serialized) {
    fail('PROMOTION_TRUSTED_KEYS_REQUIRED', 'LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON must contain trusted Ed25519 public keys.');
  }
  try {
    const keys = JSON.parse(serialized);
    if (!plainObject(keys) || Object.keys(keys).length === 0
      || Object.values(keys).some((value) => typeof value !== 'string' || !value.trim())) {
      fail('PROMOTION_TRUSTED_KEYS_INVALID', 'LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON must be a non-empty JSON object of PEM public keys.');
    }
    return keys;
  } catch (error) {
    if (error instanceof LocalizationBrowserPromotionError) throw error;
    fail('PROMOTION_TRUSTED_KEYS_INVALID', 'LIKERTS_LOCALIZATION_PROMOTION_KEYS_JSON must be valid JSON.', error);
  }
}

function resolvedNow(now) {
  const candidate = typeof now === 'function' ? now() : now;
  const date = candidate instanceof Date ? candidate : new Date(candidate ?? Date.now());
  if (!Number.isFinite(date.getTime())) fail('PROMOTION_TIME_INVALID', 'Promotion signing time must be a valid Date.');
  return date;
}

async function readPrivateKey(filePath) {
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (error) {
    fail('PROMOTION_PRIVATE_KEY_UNREADABLE', 'The promotion private-key file could not be read.', error);
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PRIVATE_KEY_BYTES) {
    fail('PROMOTION_PRIVATE_KEY_INVALID', 'The promotion private-key file must be a non-empty PEM file no larger than 64 KiB.');
  }
  try {
    const privateKey = createPrivateKey(await fs.readFile(resolved, 'utf8'));
    if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
      fail('PROMOTION_PRIVATE_KEY_INVALID', 'The promotion key must be an Ed25519 private key.');
    }
    return privateKey;
  } catch (error) {
    if (error instanceof LocalizationBrowserPromotionError) throw error;
    fail('PROMOTION_PRIVATE_KEY_INVALID', 'The promotion private-key file must contain a valid Ed25519 PEM key.', error);
  }
}

async function readCanonicalBundleAttestation(bundleDirectory, artifactDigest) {
  const artifactHash = artifactDigest.slice('sha256:'.length);
  const target = path.join(path.resolve(bundleDirectory), artifactHash, 'attestation.json');
  let text;
  try {
    text = await fs.readFile(target, 'utf8');
  } catch (error) {
    fail('PROMOTION_CI_ATTESTATION_UNREADABLE', 'The verified CI bundle is missing its canonical attestation.', error);
  }
  let attestation;
  try {
    attestation = JSON.parse(text);
  } catch (error) {
    fail('PROMOTION_CI_ATTESTATION_INVALID', 'The verified CI bundle attestation is not valid JSON.', error);
  }
  if (text !== `${canonicalLocalizationBrowserPromotionJson(attestation)}\n`) {
    fail('PROMOTION_CI_ATTESTATION_NONCANONICAL', 'The verified CI bundle attestation is not canonical JSON.');
  }
  return attestation;
}

async function readCanonicalBundleArtifactManifest(bundleDirectory, artifactDigest) {
  const artifactHash = artifactDigest.slice('sha256:'.length);
  const target = path.join(path.resolve(bundleDirectory), artifactHash, 'artifact-manifest.json');
  let bytes;
  try {
    bytes = Buffer.from(await fs.readFile(target));
  } catch (error) {
    fail('PROMOTION_ARTIFACT_MANIFEST_UNREADABLE', 'The verified CI bundle is missing its canonical artifact manifest.', error);
  }
  const text = bytes.toString('utf8');
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    fail('PROMOTION_ARTIFACT_MANIFEST_INVALID', 'The verified CI bundle artifact manifest is not valid JSON.', error);
  }
  if (!bytes.equals(Buffer.from(`${canonicalLocalizationBrowserPromotionJson(manifest)}\n`))) {
    fail('PROMOTION_ARTIFACT_MANIFEST_NONCANONICAL', 'The verified CI bundle artifact manifest is not canonical JSON.');
  }
  if (manifest.artifactDigest !== artifactDigest) {
    fail('PROMOTION_ARTIFACT_MANIFEST_MISMATCH', 'The verified CI bundle artifact manifest does not match the signed browser artifact.');
  }
  let relativePaths;
  try {
    relativePaths = validatePortableBrowserArtifactManifest(manifest);
  } catch (error) {
    if (!(error instanceof BrowserArtifactBindingError)) throw error;
    fail('PROMOTION_ARTIFACT_MANIFEST_INVALID', `The verified CI bundle artifact manifest is malformed (${error.code}).`, error);
  }
  const artifactRoot = path.join(path.resolve(bundleDirectory), artifactHash, 'artifact');
  const files = [];
  for (const relativePath of relativePaths) {
    try {
      files.push({
        relativePath,
        bytes: await fs.readFile(path.join(artifactRoot, ...relativePath.split('/'))),
      });
    } catch (error) {
      fail('PROMOTION_ARTIFACT_MANIFEST_MISMATCH', `The verified CI bundle artifact is missing a file declared by artifact-manifest.json: ${relativePath}.`, error);
    }
  }
  try {
    verifyPortableBrowserArtifactManifestBytes({ manifest, files });
  } catch (error) {
    if (!(error instanceof BrowserArtifactBindingError)) throw error;
    fail('PROMOTION_ARTIFACT_MANIFEST_MISMATCH', `The verified CI bundle artifact manifest no longer binds the signed browser artifact (${error.code}).`, error);
  }
  return bytes;
}

function pathIsContained(parentPath, candidatePath) {
  const relation = path.relative(parentPath, candidatePath);
  return relation === '' || (!relation.startsWith(`..${path.sep}`) && relation !== '..' && !path.isAbsolute(relation));
}

async function assertOutputLeafNotSymlink(targetPath) {
  try {
    if ((await fs.lstat(targetPath)).isSymbolicLink()) {
      fail('PROMOTION_OUTPUT_SYMLINK', 'Promotion output must not be a symbolic link.');
    }
  } catch (error) {
    if (error instanceof LocalizationBrowserPromotionError) throw error;
    if (error?.code !== 'ENOENT') fail('PROMOTION_OUTPUT_INVALID', 'Promotion output path could not be inspected safely.', error);
  }
}

async function nearestExistingAncestor(targetPath) {
  let current = targetPath;
  while (true) {
    try {
      await fs.lstat(current);
      return current;
    } catch (error) {
      if (error?.code !== 'ENOENT') fail('PROMOTION_OUTPUT_INVALID', 'Promotion output path could not be resolved safely.', error);
      const parent = path.dirname(current);
      if (parent === current) fail('PROMOTION_OUTPUT_INVALID', 'Promotion output has no existing ancestor directory.');
      current = parent;
    }
  }
}

async function assertOutputOutsideVerifiedBundle(resolvedOutput, sourceBundleDirectory) {
  let resolvedSource;
  try {
    resolvedSource = await fs.realpath(sourceBundleDirectory);
  } catch (error) {
    fail('PROMOTION_BUNDLE_UNREADABLE', 'The verified CI bundle directory could not be resolved.', error);
  }
  await assertOutputLeafNotSymlink(resolvedOutput);
  const existingAncestor = await nearestExistingAncestor(resolvedOutput);
  let realAncestor;
  try {
    realAncestor = await fs.realpath(existingAncestor);
  } catch (error) {
    fail('PROMOTION_OUTPUT_INVALID', 'Promotion output ancestor could not be resolved safely.', error);
  }
  const realOutput = path.resolve(realAncestor, path.relative(existingAncestor, resolvedOutput));
  if (pathIsContained(resolvedSource, realOutput)) {
    fail('PROMOTION_OUTPUT_CONTAINED', 'Promotion output must not resolve inside the verified CI bundle.');
  }
}

async function ensureEmptyOutputDirectory(outputDirectory, sourceBundleDirectory) {
  const resolvedOutput = path.resolve(outputDirectory);
  await assertOutputOutsideVerifiedBundle(resolvedOutput, sourceBundleDirectory);
  try {
    const stat = await fs.lstat(resolvedOutput);
    if (stat.isSymbolicLink()) {
      fail('PROMOTION_OUTPUT_SYMLINK', 'Promotion output must not be a symbolic link.');
    }
    if (!stat.isDirectory()) fail('PROMOTION_OUTPUT_INVALID', 'Promotion output must be a directory.');
    if ((await fs.readdir(resolvedOutput)).length > 0) {
      fail('PROMOTION_OUTPUT_NOT_EMPTY', 'Promotion output must be a new or empty directory.');
    }
  } catch (error) {
    if (error instanceof LocalizationBrowserPromotionError) throw error;
    if (error?.code !== 'ENOENT') fail('PROMOTION_OUTPUT_INVALID', 'Promotion output could not be prepared.', error);
    await fs.mkdir(resolvedOutput, { recursive: true });
  }
  await assertOutputOutsideVerifiedBundle(resolvedOutput, sourceBundleDirectory);
  const finalStat = await fs.lstat(resolvedOutput);
  if (finalStat.isSymbolicLink() || !finalStat.isDirectory()) {
    fail('PROMOTION_OUTPUT_SYMLINK', 'Promotion output changed into an unsafe symbolic-link target.');
  }
  return resolvedOutput;
}

/**
 * Signs a promotion only after independently verifying the source CI bundle,
 * then stages the canonical public records locally. It has no upload or
 * deployment capability.
 */
export async function stageBrowserAttestationPromotion({
  bundleDirectory,
  publishedEvidenceUrl,
  promotionRecordUrl,
  signerId,
  privateKey,
  trustedKeys,
  outputDirectory,
  now = new Date(),
} = {}) {
  if (!bundleDirectory || !publishedEvidenceUrl || !promotionRecordUrl || !signerId || !privateKey || !trustedKeys || !outputDirectory) {
    fail('PROMOTION_INPUT_REQUIRED', 'bundleDirectory, publishedEvidenceUrl, promotionRecordUrl, signerId, privateKey, trustedKeys, and outputDirectory are required.');
  }
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    fail('PROMOTION_PRIVATE_KEY_INVALID', 'The promotion key must be an Ed25519 private key.');
  }
  const signingTime = resolvedNow(now);
  const ciBundle = await verifyBrowserAttestationBundle(bundleDirectory, { now: signingTime });
  const ciAttestation = await readCanonicalBundleAttestation(bundleDirectory, ciBundle.artifactDigest);
  const artifactManifestBytes = await readCanonicalBundleArtifactManifest(
    bundleDirectory,
    ciBundle.artifactDigest,
  );
  const publishedAttestation = derivePublishedLocalizationBrowserAttestation(ciAttestation, { publishedEvidenceUrl });
  const artifact = createLocalizationBrowserPromotionArtifact({
    ciAttestation,
    ciBundle,
    publishedAttestation,
    promotionRecordUrl,
    signerId,
    signedAt: signingTime.toISOString(),
  });
  const envelope = {
    artifact,
    signature: sign(null, Buffer.from(canonicalLocalizationBrowserPromotionJson(artifact)), privateKey).toString('base64'),
  };
  const validation = validateLocalizationBrowserPromotion(envelope, {
    trustedPromotionKeys: trustedKeys,
    ciAttestation,
    ciBundle,
    publishedAttestation,
    now: signingTime,
  });
  if (!validation.ok) {
    fail('PROMOTION_SIGNED_RECORD_INVALID', `The generated promotion record failed validation (${validation.code}).`);
  }
  const stagedOutput = await ensureEmptyOutputDirectory(outputDirectory, bundleDirectory);
  await fs.writeFile(
    path.join(stagedOutput, 'artifact-manifest.json'),
    artifactManifestBytes,
    { flag: 'wx' },
  );
  await fs.writeFile(
    path.join(stagedOutput, 'attestation.json'),
    `${canonicalLocalizationBrowserPromotionJson(publishedAttestation)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  await fs.writeFile(
    path.join(stagedOutput, 'promotion.json'),
    `${canonicalLocalizationBrowserPromotionJson(envelope)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  return Object.freeze({
    outputDirectory: stagedOutput,
    publicationPrepared: true,
    uploaded: false,
    bundleDigest: artifact.bundleDigest,
    ciEvidenceId: artifact.ciEvidenceId,
    publishedEvidenceId: artifact.publishedEvidenceId,
    publishedEvidenceUrl: artifact.publishedEvidenceUrl,
    promotionRecordId: validation.promotionRecordId || hashLocalizationBrowserPromotion(artifact),
    promotionRecordUrl: artifact.promotionRecordUrl,
    signerId: artifact.signerId,
    signedAt: artifact.signedAt,
  });
}

export async function runBrowserAttestationPromotionCli({
  argv = process.argv.slice(2),
  env = process.env,
  now = new Date(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const options = parseOptions(argv);
    if (options.help) {
      stdout.write(usage());
      return 0;
    }
    const result = await stageBrowserAttestationPromotion({
      bundleDirectory: options['--bundle'],
      publishedEvidenceUrl: options['--evidence-url'],
      promotionRecordUrl: options['--promotion-url'],
      signerId: options['--signer-id'],
      privateKey: await readPrivateKey(options['--private-key-file']),
      trustedKeys: trustedPromotionKeys(env),
      outputDirectory: options['--output'],
      now,
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error?.code || 'PROMOTION_FAILED'}: ${error?.message || 'Browser evidence promotion failed.'}\n`);
    return 2;
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  process.exitCode = await runBrowserAttestationPromotionCli();
}
