import {
  createHash,
  createPublicKey,
  verify as verifyCryptographicSignature,
} from 'node:crypto';

import {
  LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION,
  LOCALIZATION_JOURNEY_GATE_VERSION,
  createLocalizationBrowserAttestation,
} from './localization-browser-attestation.js';
import { CURRENT_LOCALIZATION_CATALOG_HASH } from './localization-catalog-hash.js';
import { LOCALIZATION_REGISTRY_VERSION } from '../shared/localization.mjs';

export const LOCALIZATION_BROWSER_PROMOTION_SCHEMA_VERSION = 'localization-browser-evidence-promotion-v1';
export const LOCALIZATION_BROWSER_PROMOTION_BUNDLE_SCHEMA_VERSION = 'localization-browser-attestation-bundle-v1';
export const LOCALIZATION_BROWSER_PROMOTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const LOCALIZATION_BROWSER_PROMOTION_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const ARTIFACT_FIELDS = Object.freeze([
  'schemaVersion',
  'attestationSchemaVersion',
  'bundleSchemaVersion',
  'suiteId',
  'registryVersion',
  'sourcePublicationStatus',
  'publishedPublicationStatus',
  'buildId',
  'artifactDigest',
  'ciEvidenceId',
  'bundleDigest',
  'publishedEvidenceId',
  'publishedEvidenceUrl',
  'promotionRecordUrl',
  'signerId',
  'signedAt',
]);

export class LocalizationBrowserPromotionError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'LocalizationBrowserPromotionError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new LocalizationBrowserPromotionError(code, message, cause ? { cause } : undefined);
}

function rejected(code) {
  return Object.freeze({ ok: false, code });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!plainObject(value)) throw new TypeError('Promotion values must be JSON-compatible plain objects.');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function snapshotCanonicalJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || seen.has(value)) {
    throw new TypeError('Promotion values must be acyclic JSON-compatible plain objects.');
  }

  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (descriptorKeys.some((key) => typeof key !== 'string')) {
      throw new TypeError('Promotion values must not contain symbol properties.');
    }
    if (Array.isArray(value)) {
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor
        || !Object.hasOwn(lengthDescriptor, 'value')
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0) {
        throw new TypeError('Promotion arrays must have a valid length.');
      }
      const length = lengthDescriptor.value;
      const indexes = [];
      for (const key of descriptorKeys) {
        if (key === 'length') continue;
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('Promotion values must not contain accessors or hidden properties.');
        }
        if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
          throw new TypeError('Promotion arrays must contain only indexed values.');
        }
        indexes.push(Number(key));
      }
      if (indexes.length !== length || new Set(indexes).size !== length) {
        throw new TypeError('Promotion arrays must not contain holes.');
      }
      indexes.sort((left, right) => left - right);
      return `[${indexes.map((index) => snapshotCanonicalJson(descriptors[String(index)].value, seen)).join(',')}]`;
    }

    for (const key of descriptorKeys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Promotion values must not contain accessors or hidden properties.');
      }
    }
    if (!plainObject(value)) {
      throw new TypeError('Promotion values must be JSON-compatible plain objects.');
    }
    return `{${descriptorKeys.sort().map((key) => `${JSON.stringify(key)}:${snapshotCanonicalJson(descriptors[key].value, seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function snapshotPromotionEnvelope(envelope) {
  if (!plainObject(envelope)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(envelope);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')
    || keys.length !== 2
    || !keys.includes('artifact')
    || !keys.includes('signature')) return null;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
  }

  try {
    const artifactBytes = Buffer.from(snapshotCanonicalJson(descriptors.artifact.value));
    const artifact = JSON.parse(artifactBytes.toString('utf8'));
    return Object.freeze({
      artifact: deepFreeze(artifact),
      artifactBytes,
      signature: descriptors.signature.value,
    });
  } catch {
    return null;
  }
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function attestationEvidenceId(attestation) {
  if (!plainObject(attestation)) return null;
  const { evidenceId: _evidenceId, ...payload } = attestation;
  try {
    return sha256(canonicalJson(payload));
  } catch {
    return null;
  }
}

function canonicalSignatureBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.byteLength === 64 && bytes.toString('base64') === value ? bytes : null;
}

function canonicalIsoDateTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function resolveNowMilliseconds(now) {
  try {
    const resolved = typeof now === 'function' ? now() : now;
    if (resolved instanceof Date) return resolved.getTime();
    return typeof resolved === 'number' ? resolved : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function validDuration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function immutableUrl(value, artifactDigest, filename) {
  try {
    const url = new URL(value);
    const artifactHash = artifactDigest.slice('sha256:'.length);
    const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
    if (url.protocol !== 'https:'
      || url.username || url.password || url.search || url.hash
      || !url.pathname.endsWith(`/${artifactHash}/${filename}`)) return null;
    return { url, directory };
  } catch {
    return null;
  }
}

function immutablePublicationUrlsValid(artifact) {
  const evidence = immutableUrl(artifact.publishedEvidenceUrl, artifact.artifactDigest, 'attestation.json');
  const promotion = immutableUrl(artifact.promotionRecordUrl, artifact.artifactDigest, 'promotion.json');
  return Boolean(evidence && promotion
    && evidence.url.origin === promotion.url.origin
    && evidence.directory === promotion.directory);
}

function basicAttestationValid(attestation, publicationStatus) {
  if (!plainObject(attestation)
    || attestation.schemaVersion !== LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION
    || attestation.catalogHash !== CURRENT_LOCALIZATION_CATALOG_HASH
    || attestation.status !== 'PASSED'
    || !plainObject(attestation.build)
    || typeof attestation.build.id !== 'string'
    || !ID_PATTERN.test(attestation.build.id)
    || !SHA256_PATTERN.test(attestation.build.artifactDigest || '')
    || !exactKeys(attestation.publication, ['status', 'evidenceUrl'])
    || attestation.publication.status !== publicationStatus
    || !SHA256_PATTERN.test(attestation.evidenceId || '')
    || attestationEvidenceId(attestation) !== attestation.evidenceId) return false;
  if (publicationStatus === 'CI_ARTIFACT') return attestation.publication.evidenceUrl === null;
  return typeof attestation.publication.evidenceUrl === 'string';
}

function ciBundleValid(ciBundle) {
  return plainObject(ciBundle)
    && ciBundle.ok === true
    && ciBundle.publicationStatus === 'CI_ARTIFACT'
    && ciBundle.published === false
    && SHA256_PATTERN.test(ciBundle.bundleDigest || '')
    && SHA256_PATTERN.test(ciBundle.artifactDigest || '')
    && SHA256_PATTERN.test(ciBundle.evidenceId || '');
}

function sameJson(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function sourceBundleMatches(ciAttestation, ciBundle) {
  return ciBundleValid(ciBundle)
    && basicAttestationValid(ciAttestation, 'CI_ARTIFACT')
    && ciBundle.artifactDigest === ciAttestation.build.artifactDigest
    && ciBundle.evidenceId === ciAttestation.evidenceId;
}

function artifactShapeAndValuesValid(artifact) {
  if (!exactKeys(artifact, ARTIFACT_FIELDS)
    || artifact.schemaVersion !== LOCALIZATION_BROWSER_PROMOTION_SCHEMA_VERSION
    || artifact.attestationSchemaVersion !== LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION
    || artifact.bundleSchemaVersion !== LOCALIZATION_BROWSER_PROMOTION_BUNDLE_SCHEMA_VERSION
    || artifact.suiteId !== LOCALIZATION_JOURNEY_GATE_VERSION
    || artifact.registryVersion !== LOCALIZATION_REGISTRY_VERSION
    || artifact.sourcePublicationStatus !== 'CI_ARTIFACT'
    || artifact.publishedPublicationStatus !== 'PUBLISHED'
    || !ID_PATTERN.test(artifact.buildId || '')
    || !SHA256_PATTERN.test(artifact.artifactDigest || '')
    || !SHA256_PATTERN.test(artifact.ciEvidenceId || '')
    || !SHA256_PATTERN.test(artifact.bundleDigest || '')
    || !SHA256_PATTERN.test(artifact.publishedEvidenceId || '')
    || !ID_PATTERN.test(artifact.signerId || '')
    || !canonicalIsoDateTime(artifact.signedAt)
    || !immutablePublicationUrlsValid(artifact)) return false;
  return true;
}

function trustedSignatureValid(artifact, trustedPromotionKeys, signatureBytes, artifactBytes) {
  try {
    const signerId = artifact.signerId;
    if (!plainObject(trustedPromotionKeys) || !Object.hasOwn(trustedPromotionKeys, signerId)) return false;
    const configuredKey = trustedPromotionKeys[signerId];
    if (typeof configuredKey !== 'string' || !configuredKey.includes('PUBLIC KEY')) return false;
    const publicKey = createPublicKey(configuredKey);
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') return false;
    return verifyCryptographicSignature(
      null,
      artifactBytes,
      publicKey,
      signatureBytes,
    );
  } catch {
    return false;
  }
}

function expectedPublishedAttestation(ciAttestation, publishedEvidenceUrl) {
  const input = structuredClone(ciAttestation);
  delete input.evidenceId;
  input.publication = { status: 'PUBLISHED', evidenceUrl: publishedEvidenceUrl };
  return createLocalizationBrowserAttestation(input);
}

function expectedCiAttestation(publishedAttestation) {
  const input = structuredClone(publishedAttestation);
  delete input.evidenceId;
  input.publication = { status: 'CI_ARTIFACT', evidenceUrl: null };
  return createLocalizationBrowserAttestation(input);
}

/** Serializes a promotion artifact with the key order that is signed. */
export function canonicalLocalizationBrowserPromotionJson(value) {
  return canonicalJson(value);
}

/** The stable identifier for a signed promotion record's immutable artifact. */
export function hashLocalizationBrowserPromotion(value) {
  return sha256(canonicalJson(value));
}

/**
 * Applies the only allowed publication transformation to a verified CI browser
 * attestation. The original CI attestation stays untouched and content-addressed.
 */
export function derivePublishedLocalizationBrowserAttestation(ciAttestation, { publishedEvidenceUrl } = {}) {
  if (!basicAttestationValid(ciAttestation, 'CI_ARTIFACT')) {
    fail('PROMOTION_CI_ATTESTATION_INVALID', 'A passed canonical CI_ARTIFACT browser attestation is required.');
  }
  if (typeof publishedEvidenceUrl !== 'string' || !publishedEvidenceUrl) {
    fail('PROMOTION_EVIDENCE_URL_REQUIRED', 'A published evidence URL is required.');
  }
  const candidate = {
    artifactDigest: ciAttestation.build.artifactDigest,
    publishedEvidenceUrl,
    promotionRecordUrl: publishedEvidenceUrl.replace(/attestation\.json$/, 'promotion.json'),
  };
  if (!immutablePublicationUrlsValid(candidate)) {
    fail('PROMOTION_EVIDENCE_URL_INVALID', 'Published evidence must use its immutable HTTPS artifact path.');
  }
  return deepFreeze(expectedPublishedAttestation(ciAttestation, publishedEvidenceUrl));
}

/**
 * Creates the exact artifact an authorized release signer must sign. It only
 * accepts the receipt from a successfully verified CI bundle and derives the
 * PUBLISHED attestation instead of accepting an arbitrary published object.
 */
export function createLocalizationBrowserPromotionArtifact({
  ciAttestation,
  ciBundle,
  publishedAttestation,
  promotionRecordUrl,
  signerId,
  signedAt,
} = {}) {
  if (!sourceBundleMatches(ciAttestation, ciBundle)) {
    fail('PROMOTION_CI_BUNDLE_INVALID', 'Promotion requires an exact verified CI bundle and its canonical CI attestation.');
  }
  if (typeof promotionRecordUrl !== 'string' || !promotionRecordUrl) {
    fail('PROMOTION_RECORD_URL_REQUIRED', 'An immutable promotion-record URL is required.');
  }
  const derived = derivePublishedLocalizationBrowserAttestation(ciAttestation, {
    publishedEvidenceUrl: publishedAttestation?.publication?.evidenceUrl,
  });
  if (!sameJson(derived, publishedAttestation)) {
    fail('PROMOTION_PUBLISHED_ATTESTATION_NOT_DERIVED', 'The published attestation must be the deterministic CI publication transformation.');
  }
  const artifact = {
    schemaVersion: LOCALIZATION_BROWSER_PROMOTION_SCHEMA_VERSION,
    attestationSchemaVersion: LOCALIZATION_BROWSER_ATTESTATION_SCHEMA_VERSION,
    bundleSchemaVersion: LOCALIZATION_BROWSER_PROMOTION_BUNDLE_SCHEMA_VERSION,
    suiteId: ciAttestation.suiteId,
    registryVersion: ciAttestation.registryVersion,
    sourcePublicationStatus: 'CI_ARTIFACT',
    publishedPublicationStatus: 'PUBLISHED',
    buildId: ciAttestation.build.id,
    artifactDigest: ciAttestation.build.artifactDigest,
    ciEvidenceId: ciAttestation.evidenceId,
    bundleDigest: ciBundle.bundleDigest,
    publishedEvidenceId: publishedAttestation.evidenceId,
    publishedEvidenceUrl: publishedAttestation.publication.evidenceUrl,
    promotionRecordUrl,
    signerId,
    signedAt,
  };
  if (!artifactShapeAndValuesValid(artifact)) {
    fail('PROMOTION_ARTIFACT_INVALID', 'Promotion fields must match the strict signed-promotion schema.');
  }
  return deepFreeze(artifact);
}

/**
 * Validates an Ed25519-signed promotion record. When the source CI bundle and
 * attestation are supplied, their exact relation is checked as well; deployed
 * consumers validate the signed public record against the published attestation.
 */
export function validateLocalizationBrowserPromotion(envelope, {
  trustedPromotionKeys,
  ciAttestation = null,
  ciBundle = null,
  publishedAttestation = null,
  now = Date.now,
  maxAgeMs = LOCALIZATION_BROWSER_PROMOTION_MAX_AGE_MS,
  maxFutureSkewMs = LOCALIZATION_BROWSER_PROMOTION_MAX_FUTURE_SKEW_MS,
} = {}) {
  try {
    const snapshot = snapshotPromotionEnvelope(envelope);
    if (!snapshot || !exactKeys(snapshot.artifact, ARTIFACT_FIELDS)) {
      return rejected('PROMOTION_ENVELOPE_INVALID');
    }
    const { artifact, artifactBytes } = snapshot;
    if (!artifactShapeAndValuesValid(artifact)) return rejected('PROMOTION_ARTIFACT_INVALID');

    const nowMs = resolveNowMilliseconds(now);
    if (!Number.isFinite(nowMs) || !validDuration(maxAgeMs) || !validDuration(maxFutureSkewMs)) {
      return rejected('PROMOTION_TIME_POLICY_INVALID');
    }
    const signedAtMs = Date.parse(artifact.signedAt);
    if (nowMs - signedAtMs > maxAgeMs) return rejected('PROMOTION_TOO_OLD');
    if (signedAtMs - nowMs > maxFutureSkewMs) return rejected('PROMOTION_FROM_FUTURE');

    const signatureBytes = canonicalSignatureBytes(snapshot.signature);
    if (!signatureBytes) return rejected('PROMOTION_SIGNATURE_ENCODING_INVALID');
    if (!trustedSignatureValid(artifact, trustedPromotionKeys, signatureBytes, artifactBytes)) {
      return rejected('PROMOTION_SIGNATURE_INVALID');
    }

    if ((ciAttestation === null) !== (ciBundle === null)) return rejected('PROMOTION_CI_BINDING_INCOMPLETE');
    if (ciAttestation !== null) {
      if (!sourceBundleMatches(ciAttestation, ciBundle)) return rejected('PROMOTION_CI_BUNDLE_INVALID');
      if (artifact.buildId !== ciAttestation.build.id
        || artifact.artifactDigest !== ciAttestation.build.artifactDigest
        || artifact.ciEvidenceId !== ciAttestation.evidenceId
        || artifact.bundleDigest !== ciBundle.bundleDigest
        || artifact.suiteId !== ciAttestation.suiteId
        || artifact.registryVersion !== ciAttestation.registryVersion) {
        return rejected('PROMOTION_CI_BINDING_MISMATCH');
      }
      const derived = derivePublishedLocalizationBrowserAttestation(ciAttestation, {
        publishedEvidenceUrl: artifact.publishedEvidenceUrl,
      });
      if (artifact.publishedEvidenceId !== derived.evidenceId
        || (publishedAttestation !== null && !sameJson(derived, publishedAttestation))) {
        return rejected('PROMOTION_PUBLISHED_ATTESTATION_MISMATCH');
      }
    }

    if (publishedAttestation !== null) {
      if (!basicAttestationValid(publishedAttestation, 'PUBLISHED')
        || artifact.suiteId !== publishedAttestation.suiteId
        || artifact.registryVersion !== publishedAttestation.registryVersion
        || publishedAttestation.build.id !== artifact.buildId
        || publishedAttestation.build.artifactDigest !== artifact.artifactDigest
        || publishedAttestation.evidenceId !== artifact.publishedEvidenceId
        || publishedAttestation.publication.evidenceUrl !== artifact.publishedEvidenceUrl) {
        return rejected('PROMOTION_PUBLISHED_ATTESTATION_MISMATCH');
      }
      const derivedCi = expectedCiAttestation(publishedAttestation);
      if (derivedCi.evidenceId !== artifact.ciEvidenceId) {
        return rejected('PROMOTION_CI_BINDING_MISMATCH');
      }
    }

    return deepFreeze({
      ok: true,
      code: null,
      promotionRecordId: sha256(artifactBytes),
      value: structuredClone(artifact),
    });
  } catch {
    return rejected('PROMOTION_INVALID');
  }
}
