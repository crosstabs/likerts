import { createPublicKey } from 'node:crypto';

import { CURRENT_LOCALIZATION_CATALOG_HASH } from './localization-catalog-hash.js';

import { LOCALIZATION_REGISTRY_VERSION } from '../shared/localization.mjs';
import {
  LOCALIZATION_JOURNEY_GATE_VERSION,
  LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
  LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
  LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
  LOCALIZATION_JOURNEY_FLOWS,
} from './localization-scorecard.js';
import { validateLocalizationBrowserAttestation } from './localization-browser-attestation.js';
import { validateLocalizationBrowserPromotion } from './localization-browser-promotion.js';
import { loadNativeReviewReleaseEvidence } from './native-review-release-evidence-adapter.js';
import { CJK_NATIVE_REVIEW_PROGRAM, nativeReviewProgramContract } from './native-review-evidence.js';
import {
  createPinnedPublicHttpsFetch,
  createPublicAddressResolver,
  isPublicHttpsHostname,
  normalizePinnedHostname,
  resolvePublicPinnedAuthorityAddresses,
} from './public-address-pinned-https.js';

export const LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV = 'LIKERTS_LOCALIZATION_RELEASE_EVIDENCE_JSON';
export const LOCALIZATION_RELEASE_EVIDENCE_CONFIG_SCHEMA_VERSION = 'localization-release-evidence-source-v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_PUBLIC_KEY_BYTES = 16 * 1024;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:;\s*charset=utf-8)?$/i;
const NATIVE_BINDING_FIELDS = Object.freeze([
  'locale',
  'catalogHash',
  'buildId',
  'browserGateEvidenceReference',
  'approvalReference',
  'reviewedProductVersion',
  'reviewedPromptVersion',
  'reviewPacketDigest',
  'reviewPacketReference',
]);

export const DEFAULT_LOCALIZATION_BROWSER_RELEASE_EVIDENCE_POLICY = deepFreeze({
  deadlineMs: 15_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
});

export class LocalizationReleaseEvidenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocalizationReleaseEvidenceError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new LocalizationReleaseEvidenceError(code, message, details);
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required, optional = []) {
  if (!plainObject(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function snapshotJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    fail(
      'LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID',
      'Localization release-evidence configuration must contain only JSON data.',
    );
  }
}

function exactHttpsUrl(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `${field} must be an exact public HTTPS URL.`);
  }
  if (typeof value !== 'string'
    || url.href !== value
    || url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || !isPublicHttpsHostname(url.hostname)) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `${field} must be an exact public HTTPS URL.`);
  }
  return url;
}

function validateEd25519PublicKey(value, field) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > MAX_PUBLIC_KEY_BYTES) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `${field} must be a bounded Ed25519 public-key PEM.`);
  }
  try {
    const key = createPublicKey(value);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw new TypeError('not Ed25519');
  } catch {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `${field} must be a valid Ed25519 public-key PEM.`);
  }
}

function validateBuildIdentity(value) {
  if (!exactKeys(value, ['id', 'artifactDigest'])
    || typeof value.id !== 'string'
    || !ID_PATTERN.test(value.id)
    || !SHA256_PATTERN.test(value.artifactDigest || '')) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'browser.buildIdentity must contain an exact build ID and SHA-256 artifact digest.');
  }
}

function validatePromotionKeys(value) {
  if (!plainObject(value)) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'browser.trustedPromotionKeys must be a non-empty trusted key map.');
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 32) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'browser.trustedPromotionKeys must contain one to 32 trusted keys.');
  }
  for (const [signerId, publicKeyPem] of entries) {
    if (!ID_PATTERN.test(signerId)) {
      fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'browser.trustedPromotionKeys contains an invalid signer ID.');
    }
    validateEd25519PublicKey(publicKeyPem, `browser.trustedPromotionKeys.${signerId}`);
  }
}

function validateBrowser(value) {
  if (!exactKeys(value, ['buildIdentity', 'attestationUrl', 'promotionUrl', 'trustedPromotionKeys'])) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'browser must contain exact build, immutable URLs, and trusted promotion keys.');
  }
  validateBuildIdentity(value.buildIdentity);
  const attestationUrl = exactHttpsUrl(value.attestationUrl, 'browser.attestationUrl');
  const promotionUrl = exactHttpsUrl(value.promotionUrl, 'browser.promotionUrl');
  const artifactHash = value.buildIdentity.artifactDigest.slice('sha256:'.length);
  const attestationDirectory = attestationUrl.pathname.slice(0, attestationUrl.pathname.lastIndexOf('/') + 1);
  const promotionDirectory = promotionUrl.pathname.slice(0, promotionUrl.pathname.lastIndexOf('/') + 1);
  if (attestationUrl.origin !== promotionUrl.origin
    || attestationDirectory !== promotionDirectory
    || !attestationUrl.pathname.endsWith(`/${artifactHash}/attestation.json`)
    || !promotionUrl.pathname.endsWith(`/${artifactHash}/promotion.json`)) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'browser URLs must share one immutable artifact directory matching the configured digest.');
  }
  validatePromotionKeys(value.trustedPromotionKeys);
}

function exactHttpsOrigin(value, field) {
  let origin;
  try {
    origin = new URL(value);
  } catch {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `${field} must be an exact public HTTPS origin.`);
  }
  if (typeof value !== 'string'
    || origin.protocol !== 'https:'
    || origin.origin !== value
    || origin.pathname !== '/'
    || origin.username
    || origin.password
    || origin.search
    || origin.hash
    || !isPublicHttpsHostname(origin.hostname)) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `${field} must be an exact public HTTPS origin.`);
  }
  return origin.origin;
}

function validateNativeReviewKeys(value, program) {
  if (!plainObject(value)) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'nativeReview.trustedReviewerKeys must be a non-empty reviewer key map.');
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 64) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'nativeReview.trustedReviewerKeys must contain one to 64 reviewer keys.');
  }
  for (const [reviewerId, entry] of entries) {
    const legacyCjkKey = program.id === CJK_NATIVE_REVIEW_PROGRAM
      && exactKeys(entry, ['publicKeyPem', 'allowedLocales']);
    const programScopedKey = exactKeys(entry, ['publicKeyPem', 'allowedLocales', 'reviewProgram'])
      && entry?.reviewProgram === program.id;
    if (!ID_PATTERN.test(reviewerId)
      || (!legacyCjkKey && !programScopedKey)
      || !Array.isArray(entry.allowedLocales)
      || entry.allowedLocales.length === 0
      || entry.allowedLocales.some((localeId) => !program.localeIds.includes(localeId))
      || new Set(entry.allowedLocales).size !== entry.allowedLocales.length) {
      fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `nativeReview.trustedReviewerKeys contains an invalid ${program.id} reviewer scope.`);
    }
    validateEd25519PublicKey(entry.publicKeyPem, `nativeReview.trustedReviewerKeys.${reviewerId}`);
  }
}

function validateNativeReviewSourceConfig(value, browser, program) {
  if (!plainObject(value)) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `nativeReview.sourceConfig must map canonical ${program.id} locales.`);
  }
  const localeIds = Object.keys(value);
  if (localeIds.length === 0 || localeIds.length > program.localeIds.length
    || localeIds.some((localeId) => !program.localeIds.includes(localeId))) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `nativeReview.sourceConfig must map one to ${program.localeIds.length} canonical ${program.id} locales.`);
  }
  for (const localeId of localeIds) {
    const source = value[localeId];
    if (!exactKeys(source, ['envelopeUrl', 'packetUrl', 'expectedBindings'], ['allowedOrigin'])
      || !exactKeys(source.expectedBindings, NATIVE_BINDING_FIELDS)
      || source.expectedBindings.locale !== localeId
      || !SHA256_PATTERN.test(source.expectedBindings.reviewPacketDigest || '')
      || !SHA256_PATTERN.test(source.expectedBindings.catalogHash || '')
      || typeof source.expectedBindings.approvalReference !== 'string' || !source.expectedBindings.approvalReference
      || typeof source.expectedBindings.reviewedProductVersion !== 'string' || !source.expectedBindings.reviewedProductVersion
      || typeof source.expectedBindings.reviewedPromptVersion !== 'string' || !source.expectedBindings.reviewedPromptVersion
      || typeof source.expectedBindings.buildId !== 'string' || !source.expectedBindings.buildId
      || typeof source.expectedBindings.browserGateEvidenceReference !== 'string' || !source.expectedBindings.browserGateEvidenceReference
      || typeof source.expectedBindings.reviewPacketReference !== 'string' || !source.expectedBindings.reviewPacketReference) {
      fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `nativeReview.sourceConfig.${localeId} has invalid expected bindings.`);
    }
    if (program.requiresCurrentCatalogHash
      && (source.expectedBindings.buildId !== browser.buildIdentity.id
        || source.expectedBindings.browserGateEvidenceReference !== browser.attestationUrl
        || source.expectedBindings.catalogHash !== CURRENT_LOCALIZATION_CATALOG_HASH)) {
      fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `nativeReview.sourceConfig.${localeId} must bind the CJK program to the configured browser candidate and catalog.`);
    }
    const envelopeUrl = exactHttpsUrl(source.envelopeUrl, `nativeReview.sourceConfig.${localeId}.envelopeUrl`);
    const packetUrl = exactHttpsUrl(source.packetUrl, `nativeReview.sourceConfig.${localeId}.packetUrl`);
    const packetHash = source.expectedBindings.reviewPacketDigest.slice('sha256:'.length);
    if (envelopeUrl.origin !== packetUrl.origin
      || !envelopeUrl.pathname.split('/').includes(packetHash)
      || !packetUrl.pathname.split('/').includes(packetHash)) {
      fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `nativeReview.sourceConfig.${localeId} must bind both URLs to the packet digest.`);
    }
    if (source.allowedOrigin !== undefined) {
      const allowedOrigin = exactHttpsOrigin(source.allowedOrigin, `nativeReview.sourceConfig.${localeId}.allowedOrigin`);
      if (allowedOrigin !== envelopeUrl.origin) {
        fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', `nativeReview.sourceConfig.${localeId}.allowedOrigin must match its evidence URLs.`);
      }
    }
  }
}

function validateNativeReview(value, browser) {
  if (!exactKeys(value, ['sourceConfig', 'trustedReviewerKeys'], ['reviewProgram'])) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'nativeReview must contain exact program-bound sources and trusted reviewer keys.');
  }
  const reviewProgram = value.reviewProgram ?? CJK_NATIVE_REVIEW_PROGRAM;
  const program = nativeReviewProgramContract(reviewProgram);
  if (!program) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'nativeReview.reviewProgram must name a supported review program.');
  }
  if (program.id !== CJK_NATIVE_REVIEW_PROGRAM && value.reviewProgram !== program.id) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'Non-CJK native-review evidence requires an explicit reviewProgram binding.');
  }
  validateNativeReviewSourceConfig(value.sourceConfig, browser, program);
  validateNativeReviewKeys(value.trustedReviewerKeys, program);
}

/**
 * Reads the server-only release-evidence configuration. An absent value is the
 * deliberate pending state; any present value is validated before it can be
 * used to project release evidence.
 */
export function readLocalizationReleaseEvidenceConfig(env = process.env) {
  const raw = env?.[LOCALIZATION_RELEASE_EVIDENCE_CONFIG_ENV];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_CONFIG_BYTES) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'Localization release-evidence configuration must be a bounded JSON object.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'Localization release-evidence configuration must be valid JSON.');
  }
  const config = snapshotJson(parsed);
  if (!exactKeys(config, ['schemaVersion', 'browser', 'nativeReview'])
    || config.schemaVersion !== LOCALIZATION_RELEASE_EVIDENCE_CONFIG_SCHEMA_VERSION) {
    fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'Localization release-evidence configuration must use the supported strict schema.');
  }
  validateBrowser(config.browser);
  validateNativeReview(config.nativeReview, config.browser);
  return deepFreeze(config);
}

function normalizeBrowserPolicy(policy) {
  if (policy === null || policy === undefined) return DEFAULT_LOCALIZATION_BROWSER_RELEASE_EVIDENCE_POLICY;
  const snapshot = snapshotJson(policy);
  if (!exactKeys(snapshot, ['deadlineMs', 'maxFileBytes', 'maxTotalBytes'])
    || !Number.isSafeInteger(snapshot.deadlineMs) || snapshot.deadlineMs <= 0 || snapshot.deadlineMs > 60_000
    || !Number.isSafeInteger(snapshot.maxFileBytes) || snapshot.maxFileBytes <= 0
    || snapshot.maxFileBytes > DEFAULT_LOCALIZATION_BROWSER_RELEASE_EVIDENCE_POLICY.maxFileBytes
    || !Number.isSafeInteger(snapshot.maxTotalBytes) || snapshot.maxTotalBytes < snapshot.maxFileBytes
    || snapshot.maxTotalBytes > DEFAULT_LOCALIZATION_BROWSER_RELEASE_EVIDENCE_POLICY.maxTotalBytes) {
    fail('LOCALIZATION_BROWSER_EVIDENCE_INVALID', 'Browser release-evidence fetch policy exceeds its fixed ceilings.');
  }
  return deepFreeze(snapshot);
}

function browserSourceConfigSnapshot(browserConfig) {
  const snapshot = snapshotJson(browserConfig);
  try {
    validateBrowser(snapshot);
  } catch (error) {
    if (error instanceof LocalizationReleaseEvidenceError) {
      throw new LocalizationReleaseEvidenceError(
        'LOCALIZATION_BROWSER_EVIDENCE_INVALID',
        'Browser release-evidence source configuration is invalid.',
      );
    }
    throw error;
  }
  return deepFreeze(snapshot);
}

function resolveValidationNow(now) {
  try {
    const value = typeof now === 'function' ? now() : now;
    if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime());
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  } catch {
    // Converted below to a typed configuration/evidence failure.
  }
  fail('LOCALIZATION_BROWSER_EVIDENCE_INVALID', 'Browser release-evidence validation requires a valid current time.');
}

async function withinDeadline(promise, deadlineAt, controller) {
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  if (remainingMs === 0) {
    controller.abort();
    fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', 'Browser release evidence exceeded its aggregate deadline.');
  }
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new LocalizationReleaseEvidenceError(
            'LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE',
            'Browser release evidence exceeded its aggregate deadline.',
          ));
        }, remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function abortAndCancelResponse(controller, response) {
  controller.abort();
  try {
    const cancellation = response?.body?.cancel?.();
    cancellation?.catch?.(() => {});
  } catch {
    // Cleanup cannot replace the release-evidence failure.
  }
}

async function readBoundedJsonResponse(response, expectedUrl, {
  aggregate,
  controller,
  deadlineAt,
  maxFileBytes,
  maxTotalBytes,
  resourceName,
}) {
  if (!response || typeof response !== 'object'
    || response.status !== 200
    || response.url !== expectedUrl
    || response.redirected === true) {
    abortAndCancelResponse(controller, response);
    fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', `${resourceName} must return exact non-redirected HTTPS JSON.`);
  }
  const contentType = response.headers?.get?.('content-type');
  if (typeof contentType !== 'string' || !JSON_CONTENT_TYPE_PATTERN.test(contentType.trim())) {
    abortAndCancelResponse(controller, response);
    fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', `${resourceName} must return application/json encoded as UTF-8.`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    abortAndCancelResponse(controller, response);
    fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', `${resourceName} did not provide a readable response body.`);
  }
  const chunks = [];
  let fileBytes = 0;
  try {
    while (true) {
      const { done, value } = await withinDeadline(reader.read(), deadlineAt, controller);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', `${resourceName} returned a non-byte response body.`);
      }
      fileBytes += value.byteLength;
      aggregate.bytes += value.byteLength;
      if (fileBytes > maxFileBytes || aggregate.bytes > maxTotalBytes) {
        fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', 'Browser release evidence exceeded its byte ceiling.');
      }
      chunks.push(value.slice());
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  }
  if (fileBytes === 0) {
    fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', `${resourceName} must not be empty.`);
  }
  const bytes = new Uint8Array(fileBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseStrictJson(bytes, resourceName) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('LOCALIZATION_BROWSER_EVIDENCE_INVALID', `${resourceName} must contain strict UTF-8 JSON.`);
  }
}

async function fetchJsonBytes(fetchImpl, url, options) {
  let response;
  try {
    response = await withinDeadline(fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: options.controller.signal,
    }), options.deadlineAt, options.controller);
  } catch (error) {
    if (error instanceof LocalizationReleaseEvidenceError) throw error;
    fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', `${options.resourceName} could not be loaded.`);
  }
  return readBoundedJsonResponse(response, url, options);
}

async function createBrowserSourceFetch(browser, {
  createEvidenceResolver,
  deadlineAt,
  httpsRequestImpl,
}) {
  const attestationUrl = new URL(browser.attestationUrl);
  const timeoutMs = Math.max(0, deadlineAt - Date.now());
  if (timeoutMs === 0) {
    fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', 'Browser release evidence exceeded its aggregate deadline.');
  }
  const hostname = normalizePinnedHostname(attestationUrl);
  let addresses;
  try {
    addresses = await resolvePublicPinnedAuthorityAddresses(hostname, createEvidenceResolver, timeoutMs);
  } catch {
    fail(
      'LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE',
      'Browser release-evidence authority could not be resolved to public pinned addresses.',
    );
  }
  try {
    return createPinnedPublicHttpsFetch(
      { authorityOrigin: attestationUrl.origin, hostname, addresses },
      { httpsRequestImpl },
    );
  } catch {
    fail(
      'LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE',
      'Browser release evidence requires a pinned HTTPS transport.',
    );
  }
}

/**
 * Loads the operator-configured immutable browser release evidence. Both files
 * are fetched only from one DNS-pinned authority; no request input is accepted.
 */
export async function loadPublishedLocalizationBrowserEvidence({
  browserConfig,
  createEvidenceResolver = createPublicAddressResolver,
  httpsRequestImpl,
  fetchPolicy = null,
  now = new Date(),
} = {}) {
  const browser = browserSourceConfigSnapshot(browserConfig);
  if (typeof createEvidenceResolver !== 'function'
    || (httpsRequestImpl !== undefined && typeof httpsRequestImpl !== 'function')) {
    fail('LOCALIZATION_BROWSER_EVIDENCE_UNAVAILABLE', 'Browser release evidence requires resolver and pinned HTTPS primitives.');
  }
  const policy = normalizeBrowserPolicy(fetchPolicy);
  const validationNow = resolveValidationNow(now);
  const controller = new AbortController();
  const deadlineAt = Date.now() + policy.deadlineMs;
  const deadlineTimer = setTimeout(() => controller.abort(), policy.deadlineMs);
  const aggregate = { bytes: 0 };
  try {
    const sourceFetch = await createBrowserSourceFetch(browser, {
      createEvidenceResolver,
      deadlineAt,
      httpsRequestImpl,
    });
    const common = {
      aggregate,
      controller,
      deadlineAt,
      maxFileBytes: policy.maxFileBytes,
      maxTotalBytes: policy.maxTotalBytes,
    };
    const attestation = parseStrictJson(await fetchJsonBytes(sourceFetch, browser.attestationUrl, {
      ...common,
      resourceName: 'published browser attestation',
    }), 'Published browser attestation');
    const attestationValidation = validateLocalizationBrowserAttestation(attestation, {
      suiteId: LOCALIZATION_JOURNEY_GATE_VERSION,
      registryVersion: LOCALIZATION_REGISTRY_VERSION,
      buildIdentity: browser.buildIdentity,
      requiredLocaleIds: LOCALIZATION_BROWSER_REQUIRED_LOCALE_IDS,
      requiredViewports: LOCALIZATION_BROWSER_REQUIRED_VIEWPORTS,
      requiredSamplesByLocale: LOCALIZATION_BROWSER_SAMPLE_REQUIREMENTS,
      allowedFlowIds: LOCALIZATION_JOURNEY_FLOWS.map((flow) => flow.id),
      now: validationNow,
    });
    if (!attestationValidation.ok
      || attestationValidation.published !== true
      || attestationValidation.value?.publication?.evidenceUrl !== browser.attestationUrl) {
      fail('LOCALIZATION_BROWSER_EVIDENCE_INVALID', 'Published browser attestation failed exact build, publication, or journey validation.');
    }
    const promotion = parseStrictJson(await fetchJsonBytes(sourceFetch, browser.promotionUrl, {
      ...common,
      resourceName: 'published browser promotion',
    }), 'Published browser promotion');
    const promotionValidation = validateLocalizationBrowserPromotion(promotion, {
      trustedPromotionKeys: browser.trustedPromotionKeys,
      publishedAttestation: attestationValidation.value,
      now: validationNow,
    });
    if (!promotionValidation.ok
      || promotionValidation.value?.buildId !== browser.buildIdentity.id
      || promotionValidation.value?.artifactDigest !== browser.buildIdentity.artifactDigest
      || promotionValidation.value?.publishedEvidenceUrl !== browser.attestationUrl
      || promotionValidation.value?.promotionRecordUrl !== browser.promotionUrl) {
      fail('LOCALIZATION_BROWSER_EVIDENCE_INVALID', 'Published browser promotion failed exact signature or immutable-binding validation.');
    }
    return deepFreeze({
      journeyAttestation: attestationValidation.value,
      journeyPromotion: deepFreeze(structuredClone(promotion)),
      trustedPromotionKeys: browser.trustedPromotionKeys,
      buildIdentity: browser.buildIdentity,
    });
  } finally {
    clearTimeout(deadlineTimer);
    controller.abort();
  }
}

/**
 * Creates a zero-argument runtime provider from the server-only environment.
 * It reads no HTTP headers, query parameters, cookies, or request bodies.
 */
export function createLocalizationReleaseEvidenceProvider({
  env = process.env,
  createEvidenceResolver = createPublicAddressResolver,
  httpsRequestImpl,
  browserFetchPolicy = null,
  nativeReviewFetchPolicy = null,
  now = () => new Date(),
} = {}) {
  return async function provideLocalizationReleaseEvidence() {
    const config = readLocalizationReleaseEvidenceConfig(env);
    if (config === null) return null;
    const validationNow = resolveValidationNow(now);
    const [browser, nativeReview] = await Promise.all([
      loadPublishedLocalizationBrowserEvidence({
        browserConfig: config.browser,
        createEvidenceResolver,
        httpsRequestImpl,
        fetchPolicy: browserFetchPolicy,
        now: validationNow,
      }),
      loadNativeReviewReleaseEvidence({
        sourceConfig: config.nativeReview.sourceConfig,
        trustedReviewerKeys: config.nativeReview.trustedReviewerKeys,
        reviewProgram: config.nativeReview.reviewProgram ?? CJK_NATIVE_REVIEW_PROGRAM,
        createEvidenceResolver,
        httpsRequestImpl,
        fetchPolicy: nativeReviewFetchPolicy,
        now: validationNow,
      }),
    ]);
    if (nativeReview === null) {
      fail('LOCALIZATION_RELEASE_EVIDENCE_CONFIG_INVALID', 'Configured release evidence requires native-review sources.');
    }
    return deepFreeze({ ...browser, ...nativeReview });
  };
}
