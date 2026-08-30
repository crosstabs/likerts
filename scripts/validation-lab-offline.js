import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  VALIDATION_LAB_VERSION,
  buildBlindSyntheticBrief,
  createOutcomeCommitment,
  createPreregistrationHash,
  createSyntheticBriefHash,
  createValidationRunLineage,
  scoreValidationCase,
  summarizeValidationCases,
  validateValidationPreregistration,
} from '../evals/validation-lab.js';

export const VALIDATION_IMPORT_VERSION = 'validation-lab-import-v1';
export const VALIDATION_SEAL_VERSION = 'validation-lab-seal-v1';
export const VALIDATION_NONCE_REGISTRY_VERSION = 'validation-lab-nonce-registry-v1';
export const VALIDATION_OUTCOME_EXTRACTOR_VERSION = 'validation-outcome-extractor-v1';
export const VALIDATION_EXECUTION_PLAN_VERSION = 'validation-execution-plan-v1';
export const VALIDATION_EXECUTION_BUNDLE_VERSION = 'validation-execution-bundle-v1';
export const VALIDATION_PUBLIC_CASE_VERSION = 'validation-public-case-v1';
export const VALIDATION_PUBLIC_SCORECARD_VERSION = 'validation-public-scorecard-v1';

const FORBIDDEN_SYNTHETIC_KEYS = new Set([
  'humanoutcome', 'humanresults', 'reveal', 'nonce', 'outcomenonce', 'observedhumanoutcome', 'observedresult',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstForbiddenKey(value, path = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = firstForbiddenKey(value[index], `${path}[${index}]`);
      if (nested) return nested;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_SYNTHETIC_KEYS.has(key.replaceAll(/[-_]/g, '').toLowerCase())) return `${path}.${key}`;
    const nested = firstForbiddenKey(item, `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

function rejected(reason) {
  return {
    importVersion: VALIDATION_IMPORT_VERSION,
    status: 'REJECTED',
    reason,
    boundary: 'No synthetic execution may start from a rejected import. Observed human outcomes are withheld until post-run scoring.',
  };
}

function pathIsInside(root, candidate) {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

async function lstatIfPresent(path) {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureRootDirectory(path, { label, mode } = {}) {
  const existing = await lstatIfPresent(path);
  if (existing?.isSymbolicLink()) throw new TypeError(`${label} must not be a symbolic link.`);
  if (existing && !existing.isDirectory()) throw new TypeError(`${label} must be a directory.`);
  if (!existing) await fs.mkdir(path, { recursive: true, mode });
  const created = await fs.lstat(path);
  if (created.isSymbolicLink() || !created.isDirectory()) throw new TypeError(`${label} must be a real directory, not a symbolic link.`);
  if (mode !== undefined) await fs.chmod(path, mode);
  return fs.realpath(path);
}

async function ensureDirectoryChain(root, target, { label, mode, canonicalRoot, forbiddenRoot } = {}) {
  if (!pathIsInside(root, target)) throw new TypeError(`${label} must remain inside its configured root.`);
  const segments = relative(resolve(root), resolve(target)).split(/[/\\]/).filter(Boolean);
  let current = resolve(root);
  for (const segment of segments) {
    current = join(current, segment);
    const existing = await lstatIfPresent(current);
    if (existing?.isSymbolicLink()) throw new TypeError(`${label} contains a symbolic link.`);
    if (existing && !existing.isDirectory()) throw new TypeError(`${label} contains a non-directory ancestor.`);
    if (!existing) await fs.mkdir(current, { mode });
    const created = await fs.lstat(current);
    if (created.isSymbolicLink() || !created.isDirectory()) throw new TypeError(`${label} contains a symbolic link or non-directory ancestor.`);
    if (mode !== undefined) await fs.chmod(current, mode);
    const canonical = await fs.realpath(current);
    if (!pathIsInside(canonicalRoot, canonical) || (forbiddenRoot && pathIsInside(forbiddenRoot, canonical))) {
      throw new TypeError(`${label} resolves outside its canonical root.`);
    }
  }
}

async function validateOpenedPath(handle, path, { label, canonicalRoot, forbiddenRoot } = {}) {
  const pathStat = await fs.lstat(path);
  const handleStat = await handle.stat();
  if (pathStat.isSymbolicLink()) throw new TypeError(`${label} must not be a symbolic link.`);
  if (pathStat.dev !== handleStat.dev || pathStat.ino !== handleStat.ino) throw new TypeError(`${label} changed while it was being opened.`);
  const canonical = await fs.realpath(path);
  if (!pathIsInside(canonicalRoot, canonical) || (forbiddenRoot && pathIsInside(forbiddenRoot, canonical))) {
    throw new TypeError(`${label} resolves outside its canonical root.`);
  }
}

async function writeExclusiveNoFollow(path, contents, { label, mode, canonicalRoot, forbiddenRoot } = {}) {
  const existing = await lstatIfPresent(path);
  if (existing?.isSymbolicLink()) throw new TypeError(`${label} must not be a symbolic link.`);
  if (existing) throw new TypeError(`${label} already exists.`);
  const noFollow = constants.O_NOFOLLOW || 0;
  let handle;
  try {
    handle = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, mode);
    await validateOpenedPath(handle, path, { label, canonicalRoot, forbiddenRoot });
    await handle.writeFile(contents, 'utf8');
    await handle.chmod(mode);
    await handle.sync();
  } catch (error) {
    if (error?.code === 'ELOOP') throw new TypeError(`${label} must not be a symbolic link.`);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readJsonNoFollow(path, { label, canonicalRoot, forbiddenRoot } = {}) {
  const existing = await lstatIfPresent(path);
  if (!existing) return null;
  if (existing.isSymbolicLink()) throw new TypeError(`${label} must not be a symbolic link.`);
  if (!existing.isFile()) throw new TypeError(`${label} must be a regular file.`);
  const noFollow = constants.O_NOFOLLOW || 0;
  let handle;
  try {
    handle = await fs.open(path, constants.O_RDONLY | noFollow);
    await validateOpenedPath(handle, path, { label, canonicalRoot, forbiddenRoot });
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error?.code === 'ELOOP') throw new TypeError(`${label} must not be a symbolic link.`);
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function sealValidationArtifacts({
  preregistration,
  humanOutcome,
  nonce,
  publicRoot,
  privateRoot,
  publicPreregistrationPath,
  privateRevealPath,
} = {}) {
  if (typeof nonce !== 'string' || nonce.length < 32 || new Set(nonce).size < 12 || !/[a-z]/i.test(nonce) || !/\d/.test(nonce)) {
    throw new TypeError('A strong nonce of at least 32 characters with sufficient character diversity is required.');
  }
  if (![publicRoot, privateRoot, publicPreregistrationPath, privateRevealPath].every((value) => typeof value === 'string' && value.length)) {
    throw new TypeError('Public/private roots and artifact paths are required.');
  }
  if (!pathIsInside(publicRoot, publicPreregistrationPath)) throw new TypeError('The public preregistration path must be inside the configured public root.');
  if (pathIsInside(publicRoot, privateRevealPath)) throw new TypeError('A private reveal path must never be inside the public root.');
  if (!pathIsInside(privateRoot, privateRevealPath)) throw new TypeError('The private reveal path must be inside the configured ignored private root.');

  const canonicalPublicRoot = await ensureRootDirectory(publicRoot, { label: 'The public root' });
  const canonicalPrivateRoot = await ensureRootDirectory(privateRoot, { label: 'The ignored private root', mode: 0o700 });
  if (pathIsInside(canonicalPublicRoot, canonicalPrivateRoot) || pathIsInside(canonicalPrivateRoot, canonicalPublicRoot)) {
    throw new TypeError('The ignored private root must not overlap the canonical public root.');
  }
  await ensureDirectoryChain(privateRoot, dirname(privateRevealPath), {
    label: 'The private reveal path',
    mode: 0o700,
    canonicalRoot: canonicalPrivateRoot,
    forbiddenRoot: canonicalPublicRoot,
  });
  await ensureDirectoryChain(publicRoot, dirname(publicPreregistrationPath), {
    label: 'The public preregistration path',
    canonicalRoot: canonicalPublicRoot,
    forbiddenRoot: canonicalPrivateRoot,
  });

  const nonceRegistryPath = join(privateRoot, 'nonce-registry.json');
  const nonceRegistry = await readJsonNoFollow(nonceRegistryPath, {
    label: 'The private nonce registry',
    canonicalRoot: canonicalPrivateRoot,
    forbiddenRoot: canonicalPublicRoot,
  }) || { registryVersion: VALIDATION_NONCE_REGISTRY_VERSION, nonceFingerprints: [] };
  if (nonceRegistry.registryVersion !== VALIDATION_NONCE_REGISTRY_VERSION || !Array.isArray(nonceRegistry.nonceFingerprints)) {
    throw new TypeError('The private nonce registry is malformed or unsupported.');
  }
  const nonceFingerprint = createHash('sha256').update(`validation-lab-nonce\0${nonce}`).digest('hex');
  if (nonceRegistry.nonceFingerprints.includes(nonceFingerprint)) throw new TypeError('This sealing nonce has already been used.');

  const publicPreregistration = structuredClone(preregistration);
  publicPreregistration.outcomeCommitment = createOutcomeCommitment(humanOutcome, nonce, publicPreregistration);
  publicPreregistration.syntheticBriefHash = createSyntheticBriefHash(publicPreregistration);
  const validationError = validateValidationPreregistration(publicPreregistration);
  if (validationError) throw new TypeError(validationError);
  const preregistrationHash = createPreregistrationHash(publicPreregistration);
  const publicArtifact = {
    artifactVersion: VALIDATION_SEAL_VERSION,
    artifactType: 'PUBLIC_VALIDATION_PREREGISTRATION',
    preregistrationHash,
    preregistration: publicPreregistration,
  };
  const privateRevealBundle = {
    artifactVersion: VALIDATION_SEAL_VERSION,
    artifactType: 'PRIVATE_VALIDATION_REVEAL',
    caseId: publicPreregistration.caseId,
    protocolVersion: publicPreregistration.protocolVersion,
    preregistrationHash,
    outcomeCommitment: publicPreregistration.outcomeCommitment,
    nonce,
    humanOutcome: structuredClone(humanOutcome),
  };

  await writeExclusiveNoFollow(privateRevealPath, `${JSON.stringify(privateRevealBundle, null, 2)}\n`, {
    label: 'The private reveal artifact',
    mode: 0o600,
    canonicalRoot: canonicalPrivateRoot,
    forbiddenRoot: canonicalPublicRoot,
  });
  await writeExclusiveNoFollow(publicPreregistrationPath, `${JSON.stringify(publicArtifact, null, 2)}\n`, {
    label: 'The public preregistration artifact',
    mode: 0o644,
    canonicalRoot: canonicalPublicRoot,
    forbiddenRoot: canonicalPrivateRoot,
  });
  nonceRegistry.nonceFingerprints.push(nonceFingerprint);
  nonceRegistry.nonceFingerprints.sort();
  const nonceRegistryTemporaryPath = join(privateRoot, `.nonce-registry-${nonceFingerprint}.tmp`);
  await writeExclusiveNoFollow(nonceRegistryTemporaryPath, `${JSON.stringify(nonceRegistry, null, 2)}\n`, {
    label: 'The temporary private nonce registry',
    mode: 0o600,
    canonicalRoot: canonicalPrivateRoot,
    forbiddenRoot: canonicalPublicRoot,
  });
  const existingRegistry = await lstatIfPresent(nonceRegistryPath);
  if (existingRegistry?.isSymbolicLink()) throw new TypeError('The private nonce registry must not be a symbolic link.');
  await fs.rename(nonceRegistryTemporaryPath, nonceRegistryPath);
  await fs.chmod(nonceRegistryPath, 0o600);
  return { status: 'SEALED', publicArtifact, privateRevealBundle, nonceFingerprint };
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === '') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new TypeError('The CSV source has an unterminated quoted field.');
  if (field !== '' || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length < 2 || rows[0].some((header) => !header)) throw new TypeError('The CSV source requires a header and at least one record.');
  const headers = rows[0];
  if (new Set(headers).size !== headers.length) throw new TypeError('The CSV source has duplicate headers.');
  return rows.slice(1).filter((values) => values.some((value) => value !== '')).map((values, rowIndex) => {
    if (values.length !== headers.length) throw new TypeError(`CSV row ${rowIndex + 2} does not match the header width.`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function exactPercentages(records, responseField, responseCodes, weightField) {
  const totals = responseCodes.map(() => 0);
  let totalWeight = 0;
  for (const record of records) {
    const codeIndex = responseCodes.indexOf(record[responseField]);
    if (codeIndex < 0) throw new TypeError(`Field ${responseField} contains an unconfigured response code.`);
    const weight = Number(record[weightField]);
    if (!Number.isFinite(weight) || weight <= 0) throw new TypeError(`Field ${weightField} must contain finite positive weights.`);
    totals[codeIndex] += weight;
    totalWeight += weight;
  }
  if (!totalWeight) throw new TypeError(`Field ${responseField} has no included weighted records.`);
  const percentages = totals.slice(0, -1).map((value) => Number(((value / totalWeight) * 100).toFixed(4)));
  percentages.push(Number((100 - percentages.reduce((sum, value) => sum + value, 0)).toFixed(4)));
  return { distribution: percentages, unweightedBase: records.length, weightedBase: Number(totalWeight.toFixed(4)) };
}

export async function extractConfiguredHumanOutcomeFromFile({ sourcePath, config } = {}) {
  if (!isRecord(config) || config.extractorVersion !== VALIDATION_OUTCOME_EXTRACTOR_VERSION) throw new TypeError('The outcome extractor config is unversioned or unsupported.');
  if (!['CSV', 'JSON'].includes(config.sourceFormat)) throw new TypeError('The configured source format is unsupported.');
  if (!Array.isArray(config.questions) || !config.questions.length || !Array.isArray(config.filters) || !Array.isArray(config.groups)) throw new TypeError('Configured questions, filters, and groups are required.');
  if (new Set(config.questions.map((question) => question?.questionId)).size !== config.questions.length) throw new TypeError('Configured extraction requires unique question IDs.');
  if (new Set(config.groups.map((group) => group?.groupId)).size !== config.groups.length) throw new TypeError('Configured extraction requires unique group IDs.');
  if (![config.weightField, config.dateField].every((field) => typeof field === 'string' && field.length)) throw new TypeError('Configured weight and date fields are required.');
  const source = await fs.readFile(sourcePath, 'utf8');
  let records;
  if (config.sourceFormat === 'CSV') records = parseCsv(source);
  else {
    if (typeof config.recordsPath !== 'string' || !config.recordsPath.length) throw new TypeError('JSON extraction requires an explicit records path.');
    const path = config.recordsPath.split('.');
    if (path.some((segment) => !segment || ['__proto__', 'prototype', 'constructor'].includes(segment))) throw new TypeError('The configured JSON records path is malformed.');
    let value = JSON.parse(source);
    for (const segment of path) {
      if (!isRecord(value) || !Object.hasOwn(value, segment)) throw new TypeError('The configured JSON records path does not exist.');
      value = value[segment];
    }
    if (!Array.isArray(value) || !value.length || !value.every(isRecord)) throw new TypeError('The configured JSON records path must identify a non-empty object array.');
    records = value;
  }
  const included = records.filter((record) => config.filters.every((filter) => record[filter.field] === filter.equals));
  if (!included.length) throw new TypeError('The configured filters did not include any records.');
  const dates = included.map((record) => record[config.dateField]);
  if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)))) throw new TypeError('The configured date field must contain ISO calendar dates.');
  const questions = config.questions.map((question) => {
    if (!question || typeof question.questionId !== 'string' || typeof question.responseField !== 'string' || !Array.isArray(question.responseCodes) || question.responseCodes.length < 2 || new Set(question.responseCodes).size !== question.responseCodes.length) throw new TypeError('Each configured question requires a unique ID, response field, and ordered unique response codes.');
    const aggregate = exactPercentages(included, question.responseField, question.responseCodes, config.weightField);
    const subgroups = config.groups.map((group) => {
      if (!group || typeof group.groupId !== 'string' || typeof group.field !== 'string' || !Object.hasOwn(group, 'equals')) throw new TypeError('Each configured group requires a unique ID, field, and exact value.');
      const groupRecords = included.filter((record) => record[group.field] === group.equals);
      return { groupId: group.groupId, ...exactPercentages(groupRecords, question.responseField, question.responseCodes, config.weightField) };
    });
    return { questionId: question.questionId, responseCodes: [...question.responseCodes], ...aggregate, subgroups };
  });
  return {
    extractorVersion: VALIDATION_OUTCOME_EXTRACTOR_VERSION,
    sourceFormat: config.sourceFormat,
    mappingMode: 'CONFIGURED_EXACT_ONLY',
    sourceHash: createHash('sha256').update(source).digest('hex'),
    configHash: hashArtifact(config),
    inputRecordCount: records.length,
    includedRecordCount: included.length,
    excludedRecordCount: records.length - included.length,
    fieldStart: [...dates].sort()[0],
    fieldEnd: [...dates].sort().at(-1),
    weightField: config.weightField,
    humanOutcome: { questions },
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hashArtifact(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function planBlindValidationExecution({
  syntheticImport,
  repeatCount,
  subgroupIds,
  evidenceVariants,
  hardCaps,
} = {}) {
  const preparation = prepareOfflineBenchmark(syntheticImport);
  if (preparation.status !== 'ACCEPTED') return { ...preparation, planVersion: VALIDATION_EXECUTION_PLAN_VERSION, items: [], planHash: null };
  if (!Number.isInteger(repeatCount) || repeatCount <= 0) throw new TypeError('A positive integer repeat count is required.');
  if (!Array.isArray(subgroupIds) || !subgroupIds.length || !subgroupIds.every((value) => typeof value === 'string' && value.length) || new Set(subgroupIds).size !== subgroupIds.length) throw new TypeError('Unique configured subgroup IDs are required.');
  if (!Array.isArray(evidenceVariants) || !evidenceVariants.length || new Set(evidenceVariants.map((variant) => variant?.variantId)).size !== evidenceVariants.length) throw new TypeError('Unique configured evidence variants are required.');
  for (const variant of evidenceVariants) {
    if (!variant || typeof variant.variantId !== 'string' || !/^[a-f0-9]{64}$/.test(variant.evidenceHash || '') || !Number.isFinite(variant.estimatedCostUsd) || variant.estimatedCostUsd < 0) throw new TypeError('Each evidence variant requires an ID, SHA-256 evidence hash, and finite non-negative cost estimate.');
  }
  if (!hardCaps || !Number.isInteger(hardCaps.maxCalls) || hardCaps.maxCalls <= 0 || !Number.isFinite(hardCaps.maxCostUsd) || hardCaps.maxCostUsd < 0) throw new TypeError('Positive call and non-negative cost hard caps are required.');

  const questions = [...preparation.syntheticBrief.questions].sort((left, right) => left.questionId.localeCompare(right.questionId));
  const groups = [...subgroupIds].sort();
  const variants = evidenceVariants.map((variant) => ({ ...variant })).sort((left, right) => left.variantId.localeCompare(right.variantId));
  const frozenLineage = createValidationRunLineage(syntheticImport.preregistration);
  const items = [];
  for (const question of questions) {
    for (let repeatIndex = 1; repeatIndex <= repeatCount; repeatIndex += 1) {
      for (const subgroupId of groups) {
        for (const variant of variants) {
          const identity = { caseId: preparation.syntheticBrief.caseId, questionId: question.questionId, repeatIndex, subgroupId, evidenceVariantId: variant.variantId };
          const planItemId = hashArtifact({ planVersion: VALIDATION_EXECUTION_PLAN_VERSION, syntheticBriefHash: preparation.syntheticBriefHash, evidenceHash: variant.evidenceHash, ...identity });
          items.push({
            planItemId,
            ...identity,
            evidenceHash: variant.evidenceHash,
            estimatedCostUsd: variant.estimatedCostUsd,
            lineage: { ...structuredClone(frozenLineage), ...identity, evidenceHash: variant.evidenceHash, planItemId },
          });
        }
      }
    }
  }
  const callCount = items.length;
  const estimatedCostUsd = Number(items.reduce((sum, item) => sum + item.estimatedCostUsd, 0).toFixed(6));
  if (callCount > hardCaps.maxCalls || estimatedCostUsd > hardCaps.maxCostUsd) {
    return {
      planVersion: VALIDATION_EXECUTION_PLAN_VERSION,
      status: 'REJECTED',
      reason: 'The blind execution matrix exceeds a configured hard cap.',
      caseId: preparation.syntheticBrief.caseId,
      syntheticBriefHash: preparation.syntheticBriefHash,
      callCount,
      estimatedCostUsd,
      hardCaps: structuredClone(hardCaps),
      items: [],
      planHash: null,
    };
  }
  const plan = {
    planVersion: VALIDATION_EXECUTION_PLAN_VERSION,
    status: 'PLANNED',
    caseId: preparation.syntheticBrief.caseId,
    syntheticBriefHash: preparation.syntheticBriefHash,
    axisCounts: { questions: questions.length, repeats: repeatCount, subgroups: groups.length, evidenceVariants: variants.length },
    callCount,
    estimatedCostUsd,
    hardCaps: structuredClone(hardCaps),
    items,
  };
  return { ...plan, planHash: hashArtifact(plan) };
}

export function assembleBlindValidationExecution({ plan, results } = {}) {
  if (!isRecord(plan) || plan.planVersion !== VALIDATION_EXECUTION_PLAN_VERSION || plan.status !== 'PLANNED' || !Array.isArray(plan.items)) throw new TypeError('A completed blind execution plan is required.');
  const { planHash, ...planBody } = plan;
  if (!/^[a-f0-9]{64}$/.test(planHash || '') || hashArtifact(planBody) !== planHash) throw new TypeError('The blind execution plan hash does not match its contents.');
  if (!Array.isArray(results)) throw new TypeError('Captured execution results must be an array.');
  if (new Set(plan.items.map((item) => item.planItemId)).size !== plan.items.length) throw new TypeError('The blind execution plan contains duplicate item IDs.');
  if (new Set(results.map((result) => result?.planItemId)).size !== results.length) throw new TypeError('Captured execution results contain duplicate plan item IDs.');
  const plannedIds = new Set(plan.items.map((item) => item.planItemId));
  const resultById = new Map();
  for (const result of results) {
    if (!isRecord(result) || !plannedIds.has(result.planItemId)) throw new TypeError('A captured execution result does not belong to this plan.');
    if (!['COMPLETED', 'FAILED'].includes(result.status)) throw new TypeError('Captured execution status must be COMPLETED or FAILED.');
    if (result.status === 'COMPLETED' && !isRecord(result.output)) throw new TypeError('A completed execution result requires an output object.');
    if (result.status === 'FAILED' && (typeof result.failureCode !== 'string' || !result.failureCode.length)) throw new TypeError('A failed execution result requires a failure code.');
    if (result.planHash && result.planHash !== planHash) throw new TypeError('A captured execution result has mismatched plan lineage.');
    if (result.syntheticBriefHash && result.syntheticBriefHash !== plan.syntheticBriefHash) throw new TypeError('A captured execution result has mismatched synthetic-brief lineage.');
    resultById.set(result.planItemId, structuredClone(result));
  }

  let missingCount = 0;
  const items = plan.items.map((item) => {
    let execution = resultById.get(item.planItemId);
    if (!execution) {
      missingCount += 1;
      execution = { planItemId: item.planItemId, status: 'FAILED', failureCode: 'MISSING_RESULT', reason: 'No captured result was supplied for this planned execution item.' };
    }
    return {
      planItemId: item.planItemId,
      status: execution.status,
      execution,
      lineage: { ...structuredClone(item.lineage), planVersion: plan.planVersion, planHash },
    };
  });
  const completedCount = items.filter((item) => item.status === 'COMPLETED').length;
  const failedCount = items.length - completedCount;
  const bundle = {
    bundleVersion: VALIDATION_EXECUTION_BUNDLE_VERSION,
    status: failedCount ? 'ASSEMBLED_WITH_FAILURES' : 'ASSEMBLED',
    caseId: plan.caseId,
    planHash,
    syntheticBriefHash: plan.syntheticBriefHash,
    plannedCount: plan.callCount,
    completedCount,
    failedCount,
    missingCount,
    items,
  };
  return { ...bundle, bundleHash: hashArtifact(bundle) };
}

function jsonClone(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('The public artifact must be JSON serializable.');
  return JSON.parse(serialized);
}

export function createPublicValidationCaseArtifact(comparison) {
  if (!isRecord(comparison) || typeof comparison.caseId !== 'string' || !comparison.caseId.length) throw new TypeError('A public case requires a non-empty case ID.');
  if (!['COMPLETED', 'ABORTED', 'FAILED', 'INVALIDATED'].includes(comparison.comparisonStatus)) throw new TypeError('The public case comparison status is unsupported.');
  const leakage = firstForbiddenKey(comparison);
  if (leakage) throw new TypeError(`Public case material contains forbidden reveal data at ${leakage}.`);
  const body = {
    caseArtifactVersion: VALIDATION_PUBLIC_CASE_VERSION,
    artifactType: 'PUBLIC_VALIDATION_CASE',
    caseId: comparison.caseId,
    comparison: jsonClone(comparison),
  };
  return { ...body, artifactHash: hashArtifact(body) };
}

function publicCaseStatus(comparison) {
  if (comparison.comparisonStatus === 'INVALIDATED') return 'INVALIDATED';
  if (['ABORTED', 'FAILED'].includes(comparison.comparisonStatus)) return 'FAILED';
  if (comparison.outcome === 'NOT_ASSESSED') return 'NOT_ASSESSED';
  return 'COMPLETED';
}

const PUBLIC_AGGREGATE_METRICS = [
  'meanAbsolutePercentagePointError',
  'topTwoBoxAbsoluteError',
  'rankOrderAgreement',
  'segmentDirectionAgreement',
  'meanTotalVariationDistancePp',
  'meanJensenShannonDivergence',
];

function publicAggregateScope(comparison) {
  const lineage = isRecord(comparison.lineage) ? comparison.lineage : {};
  return {
    market: typeof comparison.market === 'string' ? comparison.market : null,
    language: typeof comparison.language === 'string' ? comparison.language : null,
    population: typeof lineage.population === 'string' ? lineage.population : null,
    weighting: typeof lineage.weighting === 'string' ? lineage.weighting : null,
    researchMethod: typeof lineage.researchMethod === 'string' ? lineage.researchMethod : null,
    datasetDescriptorHash: typeof lineage.datasetDescriptorHash === 'string' ? lineage.datasetDescriptorHash : null,
    datasetId: typeof lineage.dataset?.id === 'string' ? lineage.dataset.id : null,
    datasetVersion: typeof lineage.dataset?.version === 'string' ? lineage.dataset.version : null,
    fieldStart: typeof lineage.dataset?.fieldStart === 'string' ? lineage.dataset.fieldStart : null,
    fieldEnd: typeof lineage.dataset?.fieldEnd === 'string' ? lineage.dataset.fieldEnd : null,
    questionWordingHash: typeof lineage.questionWordingHash === 'string' ? lineage.questionWordingHash : null,
    responseScaleHash: typeof lineage.responseScaleHash === 'string' ? lineage.responseScaleHash : null,
    questionTypes: Array.isArray(comparison.questionTypes)
      ? [...new Set(comparison.questionTypes.filter((value) => typeof value === 'string' && value.length))].sort()
      : [],
    runtimeVersion: typeof lineage.runtimeVersion === 'string' ? lineage.runtimeVersion : null,
    promptVersions: isRecord(lineage.promptVersions) ? jsonClone(lineage.promptVersions) : null,
    schemaVersions: isRecord(lineage.schemaVersions) ? jsonClone(lineage.schemaVersions) : null,
    modelRoutes: Array.isArray(lineage.modelRoutes)
      ? [...new Set(lineage.modelRoutes.filter((value) => typeof value === 'string' && value.length))].sort()
      : [],
  };
}

function completePublicAggregateScope(scope) {
  return [scope.market, scope.language, scope.population, scope.weighting, scope.researchMethod, scope.runtimeVersion,
    scope.datasetDescriptorHash, scope.datasetId, scope.datasetVersion, scope.fieldStart, scope.fieldEnd,
    scope.questionWordingHash, scope.responseScaleHash]
    .every((value) => typeof value === 'string' && value.length)
    && scope.questionTypes.length > 0
    && scope.modelRoutes.length > 0
    && isRecord(scope.promptVersions)
    && Object.keys(scope.promptVersions).length > 0
    && isRecord(scope.schemaVersions)
    && Object.keys(scope.schemaVersions).length > 0;
}

function aggregatePublicCases(completed, minimumAggregateCases, scope) {
  if (completed.length < minimumAggregateCases) {
    return {
      status: 'SUPPRESSED_UNDERPOWERED',
      minimumCaseCount: minimumAggregateCases,
      eligibleCaseCount: completed.length,
      metrics: null,
      reason: `At least ${minimumAggregateCases} completed and assessed public cases are required for aggregate metrics.`,
    };
  }
  if (!completePublicAggregateScope(scope)) {
    return {
      status: 'SUPPRESSED_SCOPE_INCOMPLETE',
      minimumCaseCount: minimumAggregateCases,
      eligibleCaseCount: completed.length,
      metrics: null,
      reason: 'Aggregate metrics require an explicit market, language, population, weighting method, research method, exact question wording and scale fingerprints, dataset identity and field dates, question-type set, runtime, prompt, schema, and model-route scope.',
    };
  }
  const metrics = {};
  const metricCaseCounts = {};
  for (const field of PUBLIC_AGGREGATE_METRICS) {
    const values = completed.map((item) => item.metrics?.[field]).filter(Number.isFinite);
    metricCaseCounts[field] = values.length;
    metrics[field] = values.length >= minimumAggregateCases
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
      : null;
  }
  return {
    status: 'AVAILABLE',
    minimumCaseCount: minimumAggregateCases,
    eligibleCaseCount: completed.length,
    scope,
    metricCaseCounts,
    metrics,
  };
}

export function generatePublicValidationScorecardArtifact(caseArtifacts = [], { minimumAggregateCases = 3 } = {}) {
  if (!Array.isArray(caseArtifacts)) throw new TypeError('Public case artifacts must be an array.');
  if (!Number.isInteger(minimumAggregateCases) || minimumAggregateCases <= 0) throw new TypeError('A positive integer aggregate case threshold is required.');
  const cases = caseArtifacts.map((caseArtifact) => {
    if (!isRecord(caseArtifact) || caseArtifact.caseArtifactVersion !== VALIDATION_PUBLIC_CASE_VERSION || caseArtifact.artifactType !== 'PUBLIC_VALIDATION_CASE') throw new TypeError('A public case artifact is unversioned or unsupported.');
    const { artifactHash, ...body } = caseArtifact;
    if (!/^[a-f0-9]{64}$/.test(artifactHash || '') || hashArtifact(body) !== artifactHash) throw new TypeError(`Public case artifact ${caseArtifact.caseId || '(unknown)'} failed its immutable hash check.`);
    if (!isRecord(caseArtifact.comparison) || caseArtifact.comparison.caseId !== caseArtifact.caseId) throw new TypeError('A public case artifact has mismatched case identity.');
    return {
      artifactHash,
      caseArtifactVersion: caseArtifact.caseArtifactVersion,
      caseStatus: publicCaseStatus(caseArtifact.comparison),
      ...jsonClone(caseArtifact.comparison),
    };
  }).sort((left, right) => left.caseId.localeCompare(right.caseId) || left.artifactHash.localeCompare(right.artifactHash));
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) throw new TypeError('Public case artifacts contain duplicate case IDs.');

  const caseCounts = { COMPLETED: 0, FAILED: 0, INVALIDATED: 0, NOT_ASSESSED: 0 };
  for (const item of cases) caseCounts[item.caseStatus] += 1;
  const completed = cases.filter((item) => item.caseStatus === 'COMPLETED');
  const scopedCompleted = completed.map((item) => {
    const scope = publicAggregateScope(item);
    return { item, scope, scopeKey: canonicalJson(scope) };
  });
  const scopeGroups = new Map();
  for (const entry of scopedCompleted) {
    const group = scopeGroups.get(entry.scopeKey) || { scope: entry.scope, items: [] };
    group.items.push(entry.item);
    scopeGroups.set(entry.scopeKey, group);
  }
  const stratifiedAggregates = [...scopeGroups.values()]
    .map(({ scope, items }) => ({
      scopeHash: hashArtifact(scope),
      scope,
      caseIds: items.map((item) => item.caseId).sort(),
      ...aggregatePublicCases(items, minimumAggregateCases, scope),
    }))
    .sort((left, right) => left.scopeHash.localeCompare(right.scopeHash));
  let aggregates;
  if (completed.length < minimumAggregateCases) {
    aggregates = aggregatePublicCases(completed, minimumAggregateCases, scopedCompleted[0]?.scope || publicAggregateScope({}));
  } else if (scopeGroups.size !== 1) {
    aggregates = {
      status: 'SUPPRESSED_MIXED_SCOPES',
      minimumCaseCount: minimumAggregateCases,
      eligibleCaseCount: completed.length,
      distinctScopeCount: scopeGroups.size,
      metrics: null,
      reason: 'Completed cases span different benchmark scopes. Cross-market, cross-language, cross-population, cross-method, cross-question-type, or cross-model pooling is prohibited.',
    };
  } else {
    aggregates = aggregatePublicCases(completed, minimumAggregateCases, scopedCompleted[0].scope);
  }
  const scorecard = {
    scorecardVersion: VALIDATION_PUBLIC_SCORECARD_VERSION,
    artifactType: 'PUBLIC_VALIDATION_SCORECARD',
    status: completed.length ? 'COMPLETED_COMPARISONS_AVAILABLE' : 'NO_COMPLETED_BENCHMARKS',
    publicationStatus: 'NOT_PUBLISHED',
    generationMode: 'DETERMINISTIC_OFFLINE_LOCAL_ONLY',
    caseCounts,
    cases,
    aggregates,
    stratifiedAggregates,
    boundary: 'Every supplied public case artifact is shown. Aggregate metrics require both the declared minimum completed-case base and one exact market, language, population, weighting, method, question wording, response scale, dataset field-date, question-type, runtime, prompt, schema, and model-route scope. Mixed scopes are never pooled. No universal performance or representativeness claim is implied.',
  };
  const artifact = { ...scorecard, artifactHash: hashArtifact(scorecard) };
  return { artifact, bytes: `${canonicalJson(artifact)}\n` };
}

/**
 * The only preparation path permitted before synthetic execution. It accepts a
 * preregistration and returns a brief that intentionally cannot contain the
 * observed outcome, reveal nonce, or dataset descriptor.
 */
export function prepareOfflineBenchmark(syntheticImport) {
  if (!isRecord(syntheticImport) || syntheticImport.importVersion !== VALIDATION_IMPORT_VERSION) return rejected('The synthetic import is unversioned or unsupported.');
  if (syntheticImport.stage !== 'SYNTHETIC_EXECUTION') return rejected('The import stage must be SYNTHETIC_EXECUTION.');
  if (Object.keys(syntheticImport).some((key) => !['importVersion', 'stage', 'preregistration'].includes(key))) return rejected('The synthetic import has fields outside the sealed pre-run contract.');
  const leakage = firstForbiddenKey(syntheticImport);
  if (leakage) return rejected(`The synthetic import contains forbidden revealed-outcome material at ${leakage}.`);
  const preregistrationError = validateValidationPreregistration(syntheticImport.preregistration);
  if (preregistrationError) return rejected(preregistrationError);
  const syntheticBrief = buildBlindSyntheticBrief(syntheticImport.preregistration);
  return {
    importVersion: VALIDATION_IMPORT_VERSION,
    status: 'ACCEPTED',
    dryRun: true,
    syntheticBrief,
    syntheticBriefHash: syntheticBrief.syntheticBriefHash,
    boundary: 'This offline preparation call makes no model, network, hosted-service, or human-data request. Submit only synthetic outputs for later scoring.',
  };
}

/**
 * Post-run only: score already-captured synthetic runs against a separately
 * supplied reveal. This function never generates a synthetic result.
 */
export function scoreOfflineBenchmark({ syntheticImport, syntheticRuns, reveal, evaluator } = {}) {
  const preparation = prepareOfflineBenchmark(syntheticImport);
  if (preparation.status !== 'ACCEPTED') return { ...preparation, comparisonStatus: 'INVALIDATED', outcome: 'NOT_ASSESSED', metrics: null };
  const report = scoreValidationCase({ preregistration: syntheticImport.preregistration, syntheticRuns, reveal, evaluator });
  return {
    ...report,
    ...(syntheticImport.preregistration.fixtureOnly === true ? { fixtureStatus: 'INVENTED_FIXTURE_ONLY' } : {}),
    offlineImportVersion: VALIDATION_IMPORT_VERSION,
    syntheticPreparationHash: preparation.syntheticBriefHash,
  };
}

export function generateValidationScorecard(comparisons = []) {
  const scorecard = summarizeValidationCases(comparisons);
  return {
    ...scorecard,
    scorecardVersion: VALIDATION_LAB_VERSION,
    generationMode: 'OFFLINE_LOCAL_ONLY',
    publicationStatus: 'NOT_PUBLISHED',
    boundary: `${scorecard.boundary} This machine-readable artifact is an offline local scorecard and is not a public calibration claim.`,
  };
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    values[argument.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return values;
}

async function main(argv) {
  const args = parseArguments(argv);
  if (args.seal && args.preregistration && args['human-outcome'] && args['nonce-file'] && args['public-root'] && args['private-root'] && args['public-artifact'] && args['private-reveal']) {
    const sealed = await sealValidationArtifacts({
      preregistration: await readJson(args.preregistration),
      humanOutcome: await readJson(args['human-outcome']),
      nonce: (await fs.readFile(args['nonce-file'], 'utf8')).trim(),
      publicRoot: args['public-root'],
      privateRoot: args['private-root'],
      publicPreregistrationPath: args['public-artifact'],
      privateRevealPath: args['private-reveal'],
    });
    process.stdout.write(`${JSON.stringify({
      status: sealed.status,
      publicArtifact: args['public-artifact'],
      privateReveal: args['private-reveal'],
      preregistrationHash: sealed.publicArtifact.preregistrationHash,
      outcomeCommitment: sealed.publicArtifact.preregistration.outcomeCommitment,
    })}\n`);
    return 0;
  }
  if (args['dry-run']) {
    const report = prepareOfflineBenchmark(await readJson(args['dry-run']));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.status === 'ACCEPTED' ? 0 : 1;
  }
  if (args.import && args.runs && args.reveal && args.evaluator) {
    const comparison = scoreOfflineBenchmark({
      syntheticImport: await readJson(args.import),
      syntheticRuns: await readJson(args.runs),
      reveal: await readJson(args.reveal),
      evaluator: await readJson(args.evaluator),
    });
    const scorecard = generateValidationScorecard([comparison]);
    if (args.output) await fs.writeFile(args.output, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(scorecard)}\n`);
    return comparison.comparisonStatus === 'INVALIDATED' ? 1 : 0;
  }
  process.stderr.write('Usage: node scripts/validation-lab-offline.js --seal --preregistration <json> --human-outcome <json> --nonce-file <txt> --public-root <dir> --private-root <ignored-dir> --public-artifact <json> --private-reveal <json>\n   or: node scripts/validation-lab-offline.js --dry-run <synthetic-import.json>\n   or: node scripts/validation-lab-offline.js --import <synthetic-import.json> --runs <synthetic-runs.json> --reveal <sealed-reveal.json> --evaluator <evaluator.json> [--output <local-scorecard.json>]\n');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
