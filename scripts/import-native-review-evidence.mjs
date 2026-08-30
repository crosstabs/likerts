import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURRENT_LOCALIZATION_CATALOG_HASH } from '../server/localization-catalog-hash.js';
import {
  MAX_NATIVE_REVIEW_PACKET_BYTES,
  CJK_NATIVE_REVIEW_PROGRAM,
  nativeReviewProgramContract,
  parseNativeReviewEvidenceJsonBytes,
  validateNativeReviewEvidence,
} from '../server/native-review-evidence.js';

const MAX_EVIDENCE_BYTES = MAX_NATIVE_REVIEW_PACKET_BYTES;
const REQUIRED_OPTIONS = Object.freeze({
  '--input': 'input',
  '--output': 'output',
  '--review-packet': 'reviewPacket',
  '--review-packet-reference': 'reviewPacketReference',
  '--expected-locale': 'locale',
  '--expected-catalog-hash': 'catalogHash',
  '--expected-build-id': 'buildId',
  '--expected-browser-evidence-reference': 'browserGateEvidenceReference',
  '--expected-approval-reference': 'approvalReference',
  '--expected-product-version': 'reviewedProductVersion',
  '--expected-prompt-version': 'reviewedPromptVersion',
});
const OPTIONAL_OPTIONS = Object.freeze({
  '--review-program': 'reviewProgram',
});

function parseOptions(argv) {
  const parsed = { reviewProgram: CJK_NATIVE_REVIEW_PROGRAM };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    const option = REQUIRED_OPTIONS[name] || OPTIONAL_OPTIONS[name];
    if (!option) throw new Error(`Unknown native-review intake option: ${name ?? '(missing)'}.`);
    if (Object.hasOwn(parsed, option) && !(name === '--review-program' && parsed.reviewProgram === CJK_NATIVE_REVIEW_PROGRAM)) {
      throw new Error(`${name} must be provided exactly once.`);
    }
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) throw new Error(`${name} requires an explicit value.`);
    parsed[option] = value;
  }
  for (const [name, key] of Object.entries(REQUIRED_OPTIONS)) {
    if (!Object.hasOwn(parsed, key)) throw new Error(`${name} is required for native-review intake.`);
  }
  return parsed;
}

function trustedKeys(raw, reviewProgram) {
  const program = nativeReviewProgramContract(reviewProgram);
  if (!program) throw new Error('--review-program must name a supported native-review program.');
  if (!raw) throw new Error('LIKERTS_NATIVE_REVIEWER_KEYS_JSON is required and must map reviewer IDs to explicitly program-scoped public-key and locale entries.');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('LIKERTS_NATIVE_REVIEWER_KEYS_JSON must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0
    || Object.entries(parsed).some(([reviewerId, entry]) => {
      const allowedLocales = entry?.allowedLocales;
      const legacyCjkKey = reviewProgram === CJK_NATIVE_REVIEW_PROGRAM
        && JSON.stringify(Object.keys(entry || {}).sort()) === JSON.stringify(['allowedLocales', 'publicKeyPem']);
      const programScopedKey = JSON.stringify(Object.keys(entry || {}).sort()) === JSON.stringify(['allowedLocales', 'publicKeyPem', 'reviewProgram'])
        && entry?.reviewProgram === reviewProgram;
      return typeof reviewerId !== 'string' || !reviewerId
        || !entry || typeof entry !== 'object' || Array.isArray(entry)
        || (!legacyCjkKey && !programScopedKey)
        || typeof entry.publicKeyPem !== 'string' || !entry.publicKeyPem.includes('PUBLIC KEY')
        || !Array.isArray(allowedLocales) || allowedLocales.length === 0
        || allowedLocales.some((locale) => typeof locale !== 'string' || !program.localeIds.includes(locale))
        || new Set(allowedLocales).size !== allowedLocales.length;
    })) {
    throw new Error(`LIKERTS_NATIVE_REVIEWER_KEYS_JSON must contain reviewer entries explicitly scoped to ${reviewProgram} and its canonical locale IDs; legacy reviewerId-to-PEM strings are rejected.`);
  }
  return parsed;
}

async function readBoundedFile(filePath, label) {
  if (!filePath) throw new Error(`Usage: npm run localization:review:intake -- --input <signed-review.json> --output <receipt.json> (${label} is required).`);
  const resolved = path.resolve(filePath);
  let linkInfo;
  try {
    linkInfo = await fs.lstat(resolved);
  } catch {
    throw new Error(`${label} must be a readable non-empty JSON file no larger than ${MAX_EVIDENCE_BYTES} bytes.`);
  }
  if (linkInfo.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);

  const flags = fsConstants.O_RDONLY | (Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0);
  let handle;
  try {
    handle = await fs.open(resolved, flags);
  } catch (error) {
    if (error?.code === 'ELOOP') throw new Error(`${label} must not be a symbolic link.`);
    throw new Error(`${label} must be a readable non-empty JSON file no larger than ${MAX_EVIDENCE_BYTES} bytes.`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_EVIDENCE_BYTES) {
      throw new Error(`${label} must be a non-empty JSON file no larger than ${MAX_EVIDENCE_BYTES} bytes.`);
    }

    const buffer = Buffer.alloc(MAX_EVIDENCE_BYTES + 1);
    let total = 0;
    while (total < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, total, buffer.byteLength - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total === 0 || total > MAX_EVIDENCE_BYTES) {
      throw new Error(`${label} must be a non-empty JSON file no larger than ${MAX_EVIDENCE_BYTES} bytes.`);
    }
    return buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
}

function parseJsonBytes(bytes, label) {
  try {
    return parseNativeReviewEvidenceJsonBytes(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8 JSON with no duplicate object keys.`);
  }
}

async function readJsonFile(filePath, label) {
  return parseJsonBytes(await readBoundedFile(filePath, label), label);
}

async function readReviewPacketFile(filePath) {
  return readBoundedFile(filePath, 'review packet');
}

async function writeReceipt(filePath, receipt) {
  if (!filePath) throw new Error('Usage: npm run localization:review:intake -- --input <signed-review.json> --output <receipt.json> (output is required).');
  const resolved = path.resolve(filePath);
  await fs.writeFile(resolved, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

export async function runNativeReviewIntakeCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  now,
  maxAgeMs,
  maxFutureSkewMs,
} = {}) {
  try {
    const options = parseOptions(argv);
    const program = nativeReviewProgramContract(options.reviewProgram);
    if (!program) throw new Error('--review-program must name a supported native-review program.');
    if (program.requiresCurrentCatalogHash && options.catalogHash !== CURRENT_LOCALIZATION_CATALOG_HASH) {
      throw new Error('--expected-catalog-hash must match the canonical catalog and registry provenance in this candidate.');
    }
    const evidence = await readJsonFile(options.input, 'input');
    const reviewPacketBytes = await readReviewPacketFile(options.reviewPacket);
    const reviewPacketDigest = `sha256:${createHash('sha256').update(reviewPacketBytes).digest('hex')}`;
    const result = validateNativeReviewEvidence(evidence, {
      trustedReviewerKeys: trustedKeys(env.LIKERTS_NATIVE_REVIEWER_KEYS_JSON, options.reviewProgram),
      reviewPacketBytes,
      expectedReviewProgram: options.reviewProgram,
      now,
      maxAgeMs,
      maxFutureSkewMs,
      expectedBindings: {
        locale: options.locale,
        catalogHash: options.catalogHash,
        buildId: options.buildId,
        browserGateEvidenceReference: options.browserGateEvidenceReference,
        approvalReference: options.approvalReference,
        reviewedProductVersion: options.reviewedProductVersion,
        reviewedPromptVersion: options.reviewedPromptVersion,
        reviewPacketDigest,
        reviewPacketReference: options.reviewPacketReference,
      },
    });
    if (!result.ok) {
      stderr.write(`${result.errors.map((item) => `${item.code}: ${item.message}`).join('\n')}\n`);
      return 2;
    }
    await writeReceipt(options.output, result.value);
    stdout.write(`${JSON.stringify(result.value)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Native-review evidence intake failed.'}\n`);
    return 2;
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) process.exitCode = await runNativeReviewIntakeCli();
