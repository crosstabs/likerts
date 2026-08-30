import {
  CJK_NATIVE_REVIEW_PROGRAM,
  MAX_NATIVE_REVIEW_PACKET_BYTES,
  canonicalNativeReviewEvidenceJson,
  nativeReviewProgramContract,
  parseNativeReviewEvidenceJsonBytes,
  validateNativeReviewEvidence,
} from './native-review-evidence.js';
import {
  createPinnedPublicHttpsFetch,
  createPublicAddressResolver,
  normalizePinnedHostname,
  resolvePublicPinnedAuthorityAddresses,
} from './public-address-pinned-https.js';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:;\s*charset=utf-8)?$/i;
const MAX_SOURCE_FILES = 30;
const MAX_TOTAL_BYTES = MAX_SOURCE_FILES * MAX_NATIVE_REVIEW_PACKET_BYTES;
const EXPECTED_BINDING_FIELDS = Object.freeze([
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

export const DEFAULT_NATIVE_REVIEW_RELEASE_EVIDENCE_POLICY = deepFreeze({
  deadlineMs: 15_000,
  maxFileBytes: MAX_NATIVE_REVIEW_PACKET_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
});

export class NativeReviewReleaseEvidenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'NativeReviewReleaseEvidenceError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new NativeReviewReleaseEvidenceError(code, message, details);
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || ArrayBuffer.isView(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function snapshotPlainJson(value, code, message) {
  try {
    return JSON.parse(canonicalNativeReviewEvidenceJson(value));
  } catch {
    fail(code, message);
  }
}

function exactKeys(value, required, optional = []) {
  if (!plainObject(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function exactHttpsUrl(value, resourceName) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('NATIVE_REVIEW_SOURCE_CONFIG_INVALID', `${resourceName} must be an exact HTTPS URL.`);
  }
  if (typeof value !== 'string'
    || url.href !== value
    || url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash) {
    fail(
      'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
      `${resourceName} must be a canonical HTTPS URL without credentials, query parameters, or a fragment.`,
    );
  }
  return url;
}

function exactAllowedOrigin(value) {
  let origin;
  try {
    origin = new URL(value);
  } catch {
    fail('NATIVE_REVIEW_SOURCE_CONFIG_INVALID', 'allowedOrigin must be an exact HTTPS origin.');
  }
  if (typeof value !== 'string'
    || origin.protocol !== 'https:'
    || origin.origin !== value
    || origin.pathname !== '/'
    || origin.username
    || origin.password
    || origin.search
    || origin.hash) {
    fail('NATIVE_REVIEW_SOURCE_CONFIG_INVALID', 'allowedOrigin must be an exact HTTPS origin.');
  }
  return origin.origin;
}

function normalizeSourceConfig(sourceConfig, program) {
  const snapshot = snapshotPlainJson(
    sourceConfig,
    'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
    'Configured native-review sources must contain only plain JSON data.',
  );
  const localeIds = plainObject(snapshot) ? Object.keys(snapshot) : [];
  if (localeIds.length === 0
    || localeIds.length > program.localeIds.length
    || localeIds.some((localeId) => !program.localeIds.includes(localeId))) {
    fail(
      'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
      `Configured native-review sources must select one to ${program.localeIds.length} canonical ${program.id} locales.`,
    );
  }

  const normalized = {};
  for (const localeId of localeIds) {
    const source = snapshot[localeId];
    if (!exactKeys(source, ['envelopeUrl', 'packetUrl', 'expectedBindings'], ['allowedOrigin'])
      || !exactKeys(source.expectedBindings, EXPECTED_BINDING_FIELDS)
      || source.expectedBindings.locale !== localeId
      || !SHA256_PATTERN.test(source.expectedBindings.reviewPacketDigest || '')) {
      fail(
        'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
        `Native-review source ${localeId} must declare exact envelopeUrl, packetUrl, and locale-bound expectedBindings.`,
        { localeId },
      );
    }
    const envelopeUrl = exactHttpsUrl(source.envelopeUrl, `${localeId} envelopeUrl`);
    const packetUrl = exactHttpsUrl(source.packetUrl, `${localeId} packetUrl`);
    if (envelopeUrl.origin !== packetUrl.origin) {
      fail(
        'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
        `Native-review envelope and packet URLs for ${localeId} must share one origin.`,
        { localeId },
      );
    }
    if (source.allowedOrigin !== undefined && exactAllowedOrigin(source.allowedOrigin) !== envelopeUrl.origin) {
      fail(
        'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
        `Native-review URLs for ${localeId} must match allowedOrigin.`,
        { localeId },
      );
    }
    const digestHex = source.expectedBindings.reviewPacketDigest.slice('sha256:'.length);
    if (!envelopeUrl.pathname.split('/').includes(digestHex)
      || !packetUrl.pathname.split('/').includes(digestHex)) {
      fail(
        'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
        `Native-review envelope and packet URLs for ${localeId} must contain the expected packet sha256 digest as an exact path segment.`,
        { localeId },
      );
    }
    normalized[localeId] = {
      envelopeUrl: envelopeUrl.href,
      packetUrl: packetUrl.href,
      expectedBindings: source.expectedBindings,
    };
  }
  return deepFreeze(normalized);
}

function normalizePolicy(policy) {
  if (policy === null || policy === undefined) return DEFAULT_NATIVE_REVIEW_RELEASE_EVIDENCE_POLICY;
  const snapshot = snapshotPlainJson(
    policy,
    'NATIVE_REVIEW_FETCH_POLICY_INVALID',
    'Native-review fetch policy must contain only plain JSON data.',
  );
  if (!exactKeys(snapshot, ['deadlineMs', 'maxFileBytes', 'maxTotalBytes'])
    || !Number.isSafeInteger(snapshot.deadlineMs) || snapshot.deadlineMs <= 0 || snapshot.deadlineMs > 60_000
    || !Number.isSafeInteger(snapshot.maxFileBytes) || snapshot.maxFileBytes <= 0
    || snapshot.maxFileBytes > MAX_NATIVE_REVIEW_PACKET_BYTES
    || !Number.isSafeInteger(snapshot.maxTotalBytes) || snapshot.maxTotalBytes <= 0
    || snapshot.maxTotalBytes > MAX_TOTAL_BYTES) {
    fail('NATIVE_REVIEW_FETCH_POLICY_INVALID', 'Native-review fetch policy exceeds its deadline or byte ceilings.');
  }
  return deepFreeze(snapshot);
}

async function withinDeadline(promise, deadlineAt, controller, localeId) {
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  if (remainingMs === 0) {
    controller.abort();
    fail('NATIVE_REVIEW_SOURCE_TIMEOUT', 'Native-review source loading exceeded its aggregate deadline.', { localeId });
  }
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new NativeReviewReleaseEvidenceError(
            'NATIVE_REVIEW_SOURCE_TIMEOUT',
            'Native-review source loading exceeded its aggregate deadline.',
            { localeId },
          ));
        }, remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function pinnedSourceFetch(sourceUrl, {
  controller,
  createEvidenceResolver,
  deadlineAt,
  httpsRequestImpl,
  localeId,
}) {
  const timeoutMs = Math.max(0, deadlineAt - Date.now());
  if (timeoutMs === 0) {
    controller.abort();
    fail('NATIVE_REVIEW_SOURCE_TIMEOUT', 'Native-review source loading exceeded its aggregate deadline.', { localeId });
  }
  const hostname = normalizePinnedHostname(sourceUrl);
  let addresses;
  try {
    addresses = await resolvePublicPinnedAuthorityAddresses(
      hostname,
      createEvidenceResolver,
      timeoutMs,
    );
  } catch (error) {
    if (error?.code === 'PUBLIC_HTTPS_RESOLUTION_TIMEOUT') {
      controller.abort();
      fail('NATIVE_REVIEW_SOURCE_TIMEOUT', 'Native-review source loading exceeded its aggregate deadline.', { localeId });
    }
    if (error?.code === 'PUBLIC_HTTPS_RESOLUTION_UNSAFE') {
      fail(
        'NATIVE_REVIEW_SOURCE_ADDRESS_UNSAFE',
        'Native-review source authorities must resolve only to globally routable addresses.',
        { localeId, hostname },
      );
    }
    fail(
      'NATIVE_REVIEW_SOURCE_RESOLUTION_FAILED',
      'Native-review source authority resolution failed before HTTPS transport was opened.',
      { localeId, hostname },
    );
  }
  try {
    return createPinnedPublicHttpsFetch(
      { authorityOrigin: sourceUrl.origin, hostname, addresses },
      { httpsRequestImpl },
    );
  } catch {
    fail(
      'NATIVE_REVIEW_PINNED_TRANSPORT_UNAVAILABLE',
      'Native-review sources require HTTPS transport pinned to prevalidated public addresses.',
      { localeId, hostname },
    );
  }
}

function abortAndCancelResponse(controller, response) {
  controller.abort();
  try {
    const cancellation = response?.body?.cancel?.();
    cancellation?.catch?.(() => {});
  } catch {
    // Cleanup must not replace or delay the authoritative typed response error.
  }
}

async function readBoundedJsonResponse(response, expectedUrl, {
  aggregate,
  controller,
  deadlineAt,
  localeId,
  maxFileBytes,
  maxTotalBytes,
  resourceName,
}) {
  if (!response || typeof response !== 'object'
    || response.status !== 200
    || response.url !== expectedUrl
    || response.redirected === true) {
    abortAndCancelResponse(controller, response);
    fail(
      'NATIVE_REVIEW_SOURCE_RESPONSE_INVALID',
      `${resourceName} must return status 200 from the exact configured URL without a redirect.`,
      { localeId, resourceName },
    );
  }
  const contentType = response.headers?.get?.('content-type');
  if (typeof contentType !== 'string' || !JSON_CONTENT_TYPE_PATTERN.test(contentType.trim())) {
    abortAndCancelResponse(controller, response);
    fail(
      'NATIVE_REVIEW_SOURCE_RESPONSE_INVALID',
      `${resourceName} must return the application/json UTF-8 content type.`,
      { localeId, resourceName },
    );
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    abortAndCancelResponse(controller, response);
    fail('NATIVE_REVIEW_SOURCE_RESPONSE_INVALID', `${resourceName} must provide a readable response body.`, {
      localeId,
      resourceName,
    });
  }

  const chunks = [];
  let fileBytes = 0;
  try {
    while (true) {
      const { done, value } = await withinDeadline(reader.read(), deadlineAt, controller, localeId);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        fail('NATIVE_REVIEW_SOURCE_RESPONSE_INVALID', `${resourceName} returned a non-byte response body.`, {
          localeId,
          resourceName,
        });
      }
      fileBytes += value.byteLength;
      aggregate.bytes += value.byteLength;
      if (fileBytes > maxFileBytes) {
        fail('NATIVE_REVIEW_SOURCE_FILE_TOO_LARGE', `${resourceName} exceeds the per-file byte limit.`, {
          localeId,
          resourceName,
        });
      }
      if (aggregate.bytes > maxTotalBytes) {
        fail('NATIVE_REVIEW_SOURCE_TOTAL_TOO_LARGE', 'Native-review sources exceed the aggregate byte limit.');
      }
      chunks.push(value.slice());
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  }
  if (fileBytes === 0) {
    fail('NATIVE_REVIEW_SOURCE_RESPONSE_INVALID', `${resourceName} must not be empty.`, { localeId, resourceName });
  }
  const bytes = new Uint8Array(fileBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
    }), options.deadlineAt, options.controller, options.localeId);
  } catch (error) {
    if (error instanceof NativeReviewReleaseEvidenceError) throw error;
    fail('NATIVE_REVIEW_SOURCE_UNAVAILABLE', `${options.resourceName} could not be loaded.`, {
      localeId: options.localeId,
      resourceName: options.resourceName,
    });
  }
  return readBoundedJsonResponse(response, url, options);
}

/**
 * Loads exact operator-selected native-review artifacts. Request data is not an
 * input to this interface. Missing source configuration intentionally means no
 * evidence; every configured source otherwise succeeds or throws a typed error.
 */
export async function loadNativeReviewReleaseEvidence({
  sourceConfig = null,
  trustedReviewerKeys = null,
  reviewProgram = CJK_NATIVE_REVIEW_PROGRAM,
  createEvidenceResolver = createPublicAddressResolver,
  httpsRequestImpl,
  fetchPolicy = null,
  now = new Date(),
} = {}) {
  if (sourceConfig === null || sourceConfig === undefined) return null;
  const program = nativeReviewProgramContract(reviewProgram);
  if (!program) {
    fail('NATIVE_REVIEW_SOURCE_CONFIG_INVALID', 'Configured native-review sources must declare a supported review program.');
  }
  const sources = normalizeSourceConfig(sourceConfig, program);
  const trustedKeys = snapshotPlainJson(
    trustedReviewerKeys,
    'NATIVE_REVIEW_TRUST_CONFIG_INVALID',
    'Trusted native-review public keys must contain only plain JSON data.',
  );
  if (!plainObject(trustedKeys) || Object.keys(trustedKeys).length === 0) {
    fail('NATIVE_REVIEW_TRUST_CONFIG_INVALID', 'Configured native-review sources require trusted reviewer public keys.');
  }
  if (typeof createEvidenceResolver !== 'function'
    || (httpsRequestImpl !== undefined && typeof httpsRequestImpl !== 'function')) {
    fail(
      'NATIVE_REVIEW_PINNED_TRANSPORT_UNAVAILABLE',
      'Configured native-review sources require cancelable DNS resolution and pinned HTTPS request primitives.',
    );
  }
  const policy = normalizePolicy(fetchPolicy);
  const controller = new AbortController();
  const deadlineAt = Date.now() + policy.deadlineMs;
  const deadlineTimer = setTimeout(() => controller.abort(), policy.deadlineMs);
  const aggregate = { bytes: 0 };
  const nativeReviewEvidenceByLocale = {};
  const nativeReviewBindingsByLocale = {};

  try {
    for (const [localeId, source] of Object.entries(sources)) {
      const sourceFetch = await pinnedSourceFetch(new URL(source.envelopeUrl), {
        controller,
        createEvidenceResolver,
        deadlineAt,
        httpsRequestImpl,
        localeId,
      });
      const common = {
        aggregate,
        controller,
        deadlineAt,
        localeId,
        maxFileBytes: policy.maxFileBytes,
        maxTotalBytes: policy.maxTotalBytes,
      };
      const envelopeBytes = await fetchJsonBytes(sourceFetch, source.envelopeUrl, {
        ...common,
        resourceName: 'native-review envelope',
      });
      const packetBytes = await fetchJsonBytes(sourceFetch, source.packetUrl, {
        ...common,
        resourceName: 'native-review packet',
      });
      let envelope;
      try {
        envelope = parseNativeReviewEvidenceJsonBytes(envelopeBytes);
      } catch {
        fail('NATIVE_REVIEW_ENVELOPE_INVALID', 'Native-review envelope must be strict UTF-8 JSON.', { localeId });
      }
      const packetCopy = packetBytes.slice();
      const validation = validateNativeReviewEvidence(envelope, {
        trustedReviewerKeys: trustedKeys,
        expectedBindings: source.expectedBindings,
        reviewPacketBytes: packetCopy,
        expectedReviewProgram: program.id,
        now,
      });
      if (!validation.ok || validation.value.status !== 'EVIDENCE_VALIDATED') {
        fail(
          'NATIVE_REVIEW_EVIDENCE_INVALID',
          'Native-review evidence failed signature, packet, freshness, or operator-binding validation.',
          { localeId, validationCodes: validation.errors?.map((error) => error.code) || [] },
        );
      }
      nativeReviewEvidenceByLocale[localeId] = {
        envelope: JSON.parse(canonicalNativeReviewEvidenceJson(envelope)),
        reviewPacketBytes: packetCopy.slice(),
      };
      nativeReviewBindingsByLocale[localeId] = structuredClone(source.expectedBindings);
    }
  } finally {
    clearTimeout(deadlineTimer);
    controller.abort();
  }

  return deepFreeze({
    nativeReviewProgram: program.id,
    nativeReviewEvidenceByLocale,
    nativeReviewBindingsByLocale,
    trustedNativeReviewerKeys: trustedKeys,
  });
}

export function createNativeReviewReleaseEvidenceProvider(options = {}) {
  const captured = {
    ...options,
    sourceConfig: options.sourceConfig === null || options.sourceConfig === undefined
      ? null
      : snapshotPlainJson(
        options.sourceConfig,
        'NATIVE_REVIEW_SOURCE_CONFIG_INVALID',
        'Configured native-review sources must contain only plain JSON data.',
      ),
    trustedReviewerKeys: options.trustedReviewerKeys === null || options.trustedReviewerKeys === undefined
      ? options.trustedReviewerKeys
      : snapshotPlainJson(
        options.trustedReviewerKeys,
        'NATIVE_REVIEW_TRUST_CONFIG_INVALID',
        'Trusted native-review public keys must contain only plain JSON data.',
      ),
    fetchPolicy: options.fetchPolicy === null || options.fetchPolicy === undefined
      ? options.fetchPolicy
      : snapshotPlainJson(
        options.fetchPolicy,
        'NATIVE_REVIEW_FETCH_POLICY_INVALID',
        'Native-review fetch policy must contain only plain JSON data.',
      ),
  };
  return async function provideNativeReviewReleaseEvidence() {
    return loadNativeReviewReleaseEvidence(captured);
  };
}
