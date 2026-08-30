import { createHash, createPublicKey, verify as verifyCryptographicSignature } from 'node:crypto';

import { CURRENT_LOCALIZATION_CATALOG_HASH } from './localization-catalog-hash.js';

import {
  ASEAN_LANGUAGE_LOCALE_IDS,
  CJK_LOCALE_IDS,
  LOCALIZATION_CAPABILITIES,
  LOCALE_CAPABILITIES,
  LOCALIZATION_REGISTRY_VERSION,
} from '../shared/localization.mjs';

export const NATIVE_REVIEW_EVIDENCE_SCHEMA_VERSION = 'native-review-evidence-v1';
export const NATIVE_REVIEW_INTAKE_SCHEMA_VERSION = 'native-review-intake-v1';
export const NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES = Object.freeze({
  NOT_PROVIDED: 'NOT_PROVIDED',
  DECLARATIONS_ONLY: 'DECLARATIONS_ONLY',
  INVALID: 'INVALID',
  EXPIRED: 'EXPIRED',
  STALE_BINDING: 'STALE_BINDING',
  ELIGIBLE: 'ELIGIBLE',
});
export const CJK_COMPLETED_REVIEW_PACKET_SCHEMA_VERSION = 'likerts-completed-cjk-native-review-packet-v1';
export const CJK_COMPLETED_REVIEW_PACKET_VERSION = 'cjk-completed-review-packet-v1.1.0';
export const CJK_NATIVE_REVIEW_PROGRAM = 'cjk-native-review';
export const ASEAN_NATIVE_REVIEW_PROGRAM = 'asean-native-review';
export const ASEAN_COMPLETED_REVIEW_PACKET_SCHEMA_VERSION = 'likerts-completed-asean-native-review-packet-v1';
export const ASEAN_COMPLETED_REVIEW_PACKET_VERSION = 'asean-completed-review-packet-v1.0.0';
export const DEFAULT_NATIVE_REVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const DEFAULT_NATIVE_REVIEW_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
export const MAX_NATIVE_REVIEW_PACKET_BYTES = 1_048_576;

export const CJK_NATIVE_REVIEW_GLOSSARY_VERSION = 'cjk-glossary-v1.0.0';
export const CJK_NATIVE_REVIEW_REQUIRED_AREAS = Object.freeze([
  'meaning',
  'tone',
  'terminology',
  'placeholder',
  'scale-anchor',
  'disclosure',
  'truncation',
  'interaction-label',
  'cultural-assumption',
  'accessibility',
  'script',
  'source-provenance',
  'market-or-retrieval',
  'technical-token',
]);
export const CJK_NATIVE_REVIEW_REQUIRED_JOURNEY_IDS = Object.freeze([
  'first-run',
  'study-setup',
  'research-methods',
  'respondent-instrument',
  'results',
  'population-frame',
  'evidence',
  'retrieval',
  'stability',
  'qualitative',
  'sample-library',
]);
export const CJK_NATIVE_REVIEW_REQUIRED_VIEWPORTS = Object.freeze([320, 375, 768, 1440]);
export const CJK_NATIVE_REVIEW_ACCESSIBILITY_REQUIREMENTS = Object.freeze([
  'document lang and direction are correct',
  'every control has a localized accessible name',
  'visible focus remains visible at all viewports',
  'keyboard order matches visual order',
  'expanded/collapsed state is announced',
  'validation and live-region messages are localized',
  'charts have a readable table or text alternative',
  'CJK text does not clip or create page-level horizontal overflow',
  'technical identifiers may wrap safely without changing content',
  'Korean syllable clusters are not orphaned by unsafe word-breaking',
]);
export const CJK_NATIVE_REVIEW_PROVENANCE_REQUIREMENTS = Object.freeze([
  'locale',
  'market',
  'catalogHash',
  'glossaryVersion',
  'buildId',
  'productVersion',
  'promptVersion',
  'modelVersions',
  'sourceSnapshotDate',
  'browserGateEvidenceReference',
  'reviewer',
  'reviewedAt',
  'approvalReference',
]);
export const CJK_NATIVE_REVIEW_RECHECK_REQUIREMENTS = Object.freeze([
  'blocking-findings-resolved',
  'blocking-findings-rechecked',
  'automated-checks-rerun-after-resolution',
]);
export const ASEAN_NATIVE_REVIEW_GLOSSARY_VERSION = 'asean-glossary-v1.0.0';
export const ASEAN_NATIVE_REVIEW_REQUIRED_AREAS = Object.freeze([
  'meaning',
  'tone',
  'terminology',
  'placeholder',
  'scale-anchor',
  'disclosure',
  'accessibility',
  'truncation',
  'script',
  'font',
  'input-method',
  'line-break',
  'cultural-assumption',
  'source-provenance',
  'market-or-retrieval',
  'technical-token',
  'population-evidence',
]);
export const ASEAN_NATIVE_REVIEW_REQUIRED_JOURNEY_IDS = Object.freeze([
  'market-locale-selection',
  'first-run',
  'terminology',
  'survey-methods',
  'respondent-instrument',
  'results',
  'population-frame',
  'evidence',
  'retrieval',
  'script-input-layout',
  'sample-library',
]);
export const ASEAN_NATIVE_REVIEW_REQUIRED_VIEWPORTS = Object.freeze([320, 375, 768, 1440]);
export const ASEAN_NATIVE_REVIEW_ACCESSIBILITY_REQUIREMENTS = Object.freeze([
  'document lang and direction are correct',
  'every control has a localized accessible name when copy exists',
  'visible focus remains visible',
  'keyboard order matches visual order',
  'IME and keyboard focus do not reset',
  'expanded/collapsed state is announced',
  'validation and live-region messages are localized',
  'charts have a readable table or text alternative',
  'long strings do not clip or cause page-level overflow',
  'technical identifiers wrap without content changes',
  'touch targets remain usable at mobile widths',
  'zoom/reflow keeps primary actions available',
]);
export const ASEAN_NATIVE_REVIEW_PROVENANCE_REQUIREMENTS = Object.freeze([
  'locale',
  'market',
  'catalogHash',
  'glossaryVersion',
  'buildId',
  'productVersion',
  'promptVersion',
  'modelVersions',
  'sourceSnapshotDate',
  'browserGateEvidenceReference',
  'reviewer',
  'reviewedAt',
  'approvalReference',
]);
export const ASEAN_NATIVE_REVIEW_RECHECK_REQUIREMENTS = Object.freeze([
  'blocking-findings-resolved',
  'blocking-findings-rechecked',
  'automated-checks-rerun-after-resolution',
]);

const NATIVE_REVIEW_PROGRAM_CONTRACTS = Object.freeze({
  [CJK_NATIVE_REVIEW_PROGRAM]: Object.freeze({
    id: CJK_NATIVE_REVIEW_PROGRAM,
    localeIds: CJK_LOCALE_IDS,
    completedPacketSchemaVersion: CJK_COMPLETED_REVIEW_PACKET_SCHEMA_VERSION,
    completedPacketVersion: CJK_COMPLETED_REVIEW_PACKET_VERSION,
    glossaryVersion: CJK_NATIVE_REVIEW_GLOSSARY_VERSION,
    requiredAreas: CJK_NATIVE_REVIEW_REQUIRED_AREAS,
    requiredJourneyIds: CJK_NATIVE_REVIEW_REQUIRED_JOURNEY_IDS,
    requiredViewports: CJK_NATIVE_REVIEW_REQUIRED_VIEWPORTS,
    accessibilityRequirements: CJK_NATIVE_REVIEW_ACCESSIBILITY_REQUIREMENTS,
    provenanceRequirements: CJK_NATIVE_REVIEW_PROVENANCE_REQUIREMENTS,
    recheckRequirements: CJK_NATIVE_REVIEW_RECHECK_REQUIREMENTS,
    requiresCurrentCatalogHash: true,
  }),
  [ASEAN_NATIVE_REVIEW_PROGRAM]: Object.freeze({
    id: ASEAN_NATIVE_REVIEW_PROGRAM,
    localeIds: ASEAN_LANGUAGE_LOCALE_IDS,
    completedPacketSchemaVersion: ASEAN_COMPLETED_REVIEW_PACKET_SCHEMA_VERSION,
    completedPacketVersion: ASEAN_COMPLETED_REVIEW_PACKET_VERSION,
    glossaryVersion: ASEAN_NATIVE_REVIEW_GLOSSARY_VERSION,
    requiredAreas: ASEAN_NATIVE_REVIEW_REQUIRED_AREAS,
    requiredJourneyIds: ASEAN_NATIVE_REVIEW_REQUIRED_JOURNEY_IDS,
    requiredViewports: ASEAN_NATIVE_REVIEW_REQUIRED_VIEWPORTS,
    accessibilityRequirements: ASEAN_NATIVE_REVIEW_ACCESSIBILITY_REQUIREMENTS,
    provenanceRequirements: ASEAN_NATIVE_REVIEW_PROVENANCE_REQUIREMENTS,
    recheckRequirements: ASEAN_NATIVE_REVIEW_RECHECK_REQUIREMENTS,
    requiresCurrentCatalogHash: false,
  }),
});

export function nativeReviewProgramContract(reviewProgram) {
  return NATIVE_REVIEW_PROGRAM_CONTRACTS[reviewProgram] || null;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const MAX_CANONICAL_SNAPSHOT_BYTES = MAX_NATIVE_REVIEW_PACKET_BYTES;
const MAX_CANONICAL_NODES = 25_000;
const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_ARRAY_LENGTH = 10_000;
const ARTIFACT_FIELDS = Object.freeze([
  'schemaVersion',
  'reviewProgram',
  'registryVersion',
  'locale',
  'reviewerId',
  'reviewedAt',
  'glossaryVersion',
  'catalogHash',
  'buildId',
  'reviewedProductVersion',
  'reviewedPromptVersion',
  'reviewPacketDigest',
  'reviewPacketReference',
  'completionSummary',
  'capabilityScope',
  'reviewCoverage',
  'findingsLog',
  'blockingFindingsResolved',
  'browserGateEvidenceReference',
  'approvalReference',
]);
const FINDING_FIELDS = Object.freeze(['id', 'severity', 'status', 'summary', 'evidenceReference']);
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
const COMPLETION_ENTRY_FIELDS = Object.freeze(['id', 'completed', 'evidenceReference']);
const COMPLETION_SUMMARY_FIELDS = Object.freeze([
  'journeys',
  'viewports',
  'capabilities',
  'reviewAreas',
  'accessibilityRequirements',
  'provenanceRequirements',
  'recheckRequirements',
  'blockingFindingRechecks',
]);
const COMPLETED_PACKET_FIELDS = Object.freeze([
  'schemaVersion',
  'packetVersion',
  'reviewProgram',
  'status',
  'locale',
  'reviewPacketReference',
  'provenance',
  'completionSummary',
  'findings',
  'evidenceRecords',
]);
const COMPLETED_PACKET_PROVENANCE_FIELDS = Object.freeze([
  'locale',
  'market',
  'catalogHash',
  'glossaryVersion',
  'buildId',
  'reviewedProductVersion',
  'reviewedPromptVersion',
  'modelVersions',
  'sourceSnapshotDate',
  'browserGateEvidenceReference',
  'reviewerId',
  'reviewedAt',
  'approvalReference',
]);
const COMPLETED_PACKET_FINDING_FIELDS = Object.freeze([
  'id',
  'locale',
  'capability',
  'journeyId',
  'severity',
  'category',
  'status',
  'summary',
  'sourceText',
  'proposedText',
  'rationale',
  'evidenceReference',
  'reviewerId',
  'resolvedAt',
  'recheckEvidence',
]);
const PACKET_EVIDENCE_RECORD_FIELDS = Object.freeze(['id', 'kind', 'summary', 'contentDigest']);
const PACKET_EVIDENCE_KINDS = Object.freeze(['completion', 'finding', 'recheck', 'browser-gate', 'approval']);
const PACKET_FINDING_SEVERITIES = Object.freeze(['blocking', 'high', 'medium', 'low']);
const PACKET_FINDING_STATUSES = Object.freeze(['open', 'accepted', 'resolved', 'wont-fix', 'needs-context']);

const clone = (value) => structuredClone(value);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  try {
    return plainObject(value)
      && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
  } catch {
    return false;
  }
}

function nonEmptyText(value, maximum = 512) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maximum
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isoDateTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isoDate(value) {
  return typeof value === 'string'
    && DATE_PATTERN.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);
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

function uniqueKnownValues(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item) => typeof item === 'string' && expected.includes(item))
    && new Set(value).size === expected.length;
}

function uniqueAllowedLocales(value, program) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((locale) => typeof locale === 'string' && program.localeIds.includes(locale))
    && new Set(value).size === value.length;
}

function expectedBindingsValid(value, program) {
  return exactKeys(value, EXPECTED_BINDING_FIELDS)
    && typeof value.locale === 'string'
    && program.localeIds.includes(value.locale)
    && typeof value.catalogHash === 'string'
    && SHA256_PATTERN.test(value.catalogHash)
    && typeof value.buildId === 'string'
    && ID_PATTERN.test(value.buildId)
    && nonEmptyText(value.browserGateEvidenceReference)
    && nonEmptyText(value.approvalReference)
    && typeof value.reviewedProductVersion === 'string'
    && ID_PATTERN.test(value.reviewedProductVersion)
    && typeof value.reviewedPromptVersion === 'string'
    && ID_PATTERN.test(value.reviewedPromptVersion)
    && typeof value.reviewPacketDigest === 'string'
    && SHA256_PATTERN.test(value.reviewPacketDigest)
    && nonEmptyText(value.reviewPacketReference);
}

function completeReferencedCoverage(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry) => exactKeys(entry, COMPLETION_ENTRY_FIELDS)
      && expected.includes(entry.id)
      && entry.completed === true
      && nonEmptyText(entry.evidenceReference))
    && new Set(value.map((entry) => entry.id)).size === expected.length;
}

function canonicalSignatureBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.byteLength === 64 && bytes.toString('base64') === value ? bytes : null;
}

function ownEnumerableDataDescriptors(value, { array = false } = {}) {
  const validPrototype = array
    ? Object.getPrototypeOf(value) === Array.prototype
    : plainObject(value);
  if (!validPrototype) return null;

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length) return null;

  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get !== undefined || descriptor.set !== undefined) {
      return null;
    }
    if (!array || key !== 'length') {
      if (!descriptor.enumerable) return null;
    }
  }
  return descriptors;
}

/**
 * Canonicalizes only ordinary JSON data. Descriptor values are copied without
 * invoking getters, so validation can never sign one live object and return
 * fields read later from a different one. Transparent proxies cannot be
 * distinguished by JavaScript, but their observed data are reduced to this
 * immutable JSON snapshot before any validation or signature operation.
 */
function canonicalizePlainJson(value) {
  const stack = new Set();
  const state = { nodes: 0 };

  function visit(current, depth) {
    if (depth > MAX_CANONICAL_DEPTH || (state.nodes += 1) > MAX_CANONICAL_NODES) throw new TypeError('snapshot exceeds native-review limits');
    if (current === null) return 'null';
    if (typeof current === 'string') {
      if (current.length > MAX_CANONICAL_SNAPSHOT_BYTES) throw new TypeError('snapshot string is too large');
      const serialized = JSON.stringify(current);
      if (serialized.length > MAX_CANONICAL_SNAPSHOT_BYTES) throw new TypeError('snapshot string is too large');
      return serialized;
    }
    if (typeof current === 'boolean') return current ? 'true' : 'false';
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('snapshot has a non-finite number');
      return JSON.stringify(current);
    }
    if (!current || typeof current !== 'object' || stack.has(current)) throw new TypeError('snapshot is not plain JSON data');

    stack.add(current);
    try {
      if (Array.isArray(current)) {
        const descriptors = ownEnumerableDataDescriptors(current, { array: true });
        const length = descriptors?.length?.value;
        if (!descriptors || !Number.isSafeInteger(length) || length < 0 || length > MAX_CANONICAL_ARRAY_LENGTH
          || Object.keys(descriptors).length !== length + 1) {
          throw new TypeError('snapshot array is not plain JSON data');
        }
        const values = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor) throw new TypeError('snapshot array has a hole');
          values.push(visit(descriptor.value, depth + 1));
        }
        const serialized = `[${values.join(',')}]`;
        if (serialized.length > MAX_CANONICAL_SNAPSHOT_BYTES) throw new TypeError('snapshot is too large');
        return serialized;
      }

      const descriptors = ownEnumerableDataDescriptors(current);
      if (!descriptors) throw new TypeError('snapshot object is not plain JSON data');
      const serialized = `{${Object.keys(descriptors).sort().map((key) => {
        const encodedKey = JSON.stringify(key);
        if (encodedKey.length > MAX_CANONICAL_SNAPSHOT_BYTES) throw new TypeError('snapshot key is too large');
        return `${encodedKey}:${visit(descriptors[key].value, depth + 1)}`;
      }).join(',')}}`;
      if (serialized.length > MAX_CANONICAL_SNAPSHOT_BYTES) throw new TypeError('snapshot is too large');
      return serialized;
    } finally {
      stack.delete(current);
    }
  }

  try {
    return visit(value, 0);
  } catch {
    return null;
  }
}

function snapshotPlainJson(value) {
  const canonical = canonicalizePlainJson(value);
  if (canonical === null) return null;
  try {
    return { canonical, value: JSON.parse(canonical) };
  } catch {
    return null;
  }
}

function snapshotEnvelope(envelope) {
  try {
    const descriptors = ownEnumerableDataDescriptors(envelope);
    if (!descriptors || JSON.stringify(Object.keys(descriptors).sort()) !== JSON.stringify(['artifact', 'signature'])) return null;
    const artifactCanonical = canonicalizePlainJson(descriptors.artifact.value);
    if (artifactCanonical === null) return null;
    return {
      artifactCanonical,
      artifact: JSON.parse(artifactCanonical),
      signature: descriptors.signature.value,
    };
  } catch {
    return null;
  }
}

function trustedReviewerEntries(value, program) {
  const snapshot = snapshotPlainJson(value)?.value;
  if (!plainObject(snapshot) || Object.keys(snapshot).length === 0) return null;
  for (const [reviewerId, entry] of Object.entries(snapshot)) {
    const legacyCjkKey = program.id === CJK_NATIVE_REVIEW_PROGRAM
      && exactKeys(entry, ['publicKeyPem', 'allowedLocales']);
    const programScopedKey = exactKeys(entry, ['publicKeyPem', 'allowedLocales', 'reviewProgram'])
      && entry.reviewProgram === program.id;
    if (!ID_PATTERN.test(reviewerId)
      || (!legacyCjkKey && !programScopedKey)
      || typeof entry.publicKeyPem !== 'string'
      || !entry.publicKeyPem.includes('PUBLIC KEY')
      || !uniqueAllowedLocales(entry.allowedLocales, program)) {
      return null;
    }
  }
  return snapshot;
}

function signedEnvelopeValid(artifact, artifactCanonical, trustedReviewers, signatureBytes) {
  try {
    const trustedReviewer = trustedReviewers?.[artifact.reviewerId];
    if (!trustedReviewer || !trustedReviewer.allowedLocales.includes(artifact.locale)) return false;
    const publicKey = createPublicKey(trustedReviewer.publicKeyPem);
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') return false;
    return verifyCryptographicSignature(null, Buffer.from(artifactCanonical, 'utf8'), publicKey, signatureBytes);
  } catch {
    return false;
  }
}

function findingProjection(finding) {
  return {
    id: finding.id,
    severity: finding.severity,
    status: finding.status,
    summary: finding.summary,
  };
}

function releaseEligibilityResult(status, { releaseEligible = false, receipt = null, errors = [] } = {}) {
  return deepFreeze({
    status,
    releaseEligible,
    receipt: receipt ? clone(receipt) : null,
    errors: clone(errors),
  });
}

function nativeReviewRegistryProjection(entry) {
  try {
    const nativeReview = entry?.release?.nativeReview;
    return {
      reviewer: nativeReview?.reviewer,
      reviewedAt: nativeReview?.reviewedAt,
      glossaryVersion: nativeReview?.glossaryVersion,
      capabilityScope: [...(nativeReview?.capabilityScope || [])],
      reviewedProductVersion: nativeReview?.reviewedProductVersion,
      reviewedPromptVersion: nativeReview?.reviewedPromptVersion,
      findingsLog: (nativeReview?.findingsLog || []).map(findingProjection),
      blockingFindingsResolved: nativeReview?.blockingFindingsResolved,
    };
  } catch {
    return null;
  }
}

function metadataReleaseEligible(entry, capability) {
  const nativeReview = entry?.release?.nativeReview;
  return entry?.capabilities?.[capability] === 'enabled'
    && entry?.release?.copyStatus === 'native-reviewed'
    && nativeReview?.status === 'native-reviewed'
    && nativeReview?.statusByCapability?.[capability] === 'native-reviewed'
    && Array.isArray(nativeReview?.capabilityScope)
    && nativeReview.capabilityScope.includes(capability)
    && nativeReview.blockingFindingsResolved === true;
}

function nowMilliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.parse(value);
}

function projectCompletedPacketFinding(finding) {
  return {
    id: finding.id,
    severity: finding.severity === 'blocking' ? 'blocking' : 'non-blocking',
    status: finding.status === 'resolved' ? 'resolved' : 'open',
    summary: finding.summary,
    evidenceReference: finding.evidenceReference,
  };
}

function error(code, message) {
  return { code, message };
}

function rejected(errors) {
  return { ok: false, errors };
}

/**
 * The signing string is compact JSON, with object keys sorted by JavaScript's
 * default UTF-16 code-unit ordering, array order preserved, and scalar strings
 * escaped by JSON.stringify. Sign the UTF-8 bytes of this exact string.
 */
export function canonicalNativeReviewEvidenceJson(value) {
  const canonical = canonicalizePlainJson(value);
  if (canonical === null) throw new TypeError('Native-review evidence must contain only plain JSON data properties.');
  return canonical;
}

export function hashNativeReviewEvidence(value) {
  return `sha256:${createHash('sha256').update(canonicalNativeReviewEvidenceJson(value), 'utf8').digest('hex')}`;
}

function parseStrictJsonText(text) {
  let index = 0;
  const fail = () => { throw new SyntaxError('invalid strict JSON'); };
  const skipWhitespace = () => {
    while (index < text.length && /[\u0020\u000A\u000D\u0009]/.test(text[index])) index += 1;
  };
  const isHex = (character) => typeof character === 'string' && /^[0-9a-fA-F]$/.test(character);

  function parseString() {
    if (text[index] !== '"') fail();
    const start = index;
    index += 1;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      if (code <= 0x1F) fail();
      if (code === 0x5C) {
        const escaped = text[index + 1];
        if (!'"\\/bfnrtu'.includes(escaped || '')) fail();
        if (escaped === 'u') {
          for (let offset = 2; offset <= 5; offset += 1) if (!isHex(text[index + offset])) fail();
          index += 6;
        } else {
          index += 2;
        }
      } else {
        index += 1;
      }
    }
    fail();
  }

  function parseNumber() {
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match || match.index !== 0) fail();
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail();
    return value;
  }

  function parseArray(depth) {
    index += 1;
    const result = [];
    skipWhitespace();
    if (text[index] === ']') {
      index += 1;
      return result;
    }
    while (true) {
      result.push(parseValue(depth + 1));
      if (result.length > MAX_CANONICAL_ARRAY_LENGTH) fail();
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return result;
      }
      if (text[index] !== ',') fail();
      index += 1;
      skipWhitespace();
    }
  }

  function parseObject(depth) {
    index += 1;
    const result = Object.create(null);
    const keys = new Set();
    skipWhitespace();
    if (text[index] === '}') {
      index += 1;
      return result;
    }
    while (true) {
      const key = parseString();
      if (keys.has(key)) fail();
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ':') fail();
      index += 1;
      const value = parseValue(depth + 1);
      Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return result;
      }
      if (text[index] !== ',') fail();
      index += 1;
      skipWhitespace();
    }
  }

  function parseValue(depth) {
    if (depth > MAX_CANONICAL_DEPTH) fail();
    skipWhitespace();
    if (text[index] === '"') return parseString();
    if (text[index] === '{') return parseObject(depth);
    if (text[index] === '[') return parseArray(depth);
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return null;
    }
    return parseNumber();
  }

  const value = parseValue(0);
  skipWhitespace();
  if (index !== text.length) fail();
  return value;
}

export function parseNativeReviewEvidenceJsonBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_NATIVE_REVIEW_PACKET_BYTES) {
    throw new TypeError(`Native-review JSON bytes must be non-empty and no larger than ${MAX_NATIVE_REVIEW_PACKET_BYTES} bytes.`);
  }
  return parseStrictJsonText(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function parseCompletedPacketBytes(reviewPacketBytes) {
  if (!(reviewPacketBytes instanceof Uint8Array) || reviewPacketBytes.byteLength === 0) {
    return { errors: [error('INVALID_REVIEW_PACKET_BYTES', 'reviewPacketBytes must contain exact non-empty completed packet bytes.')] };
  }
  if (reviewPacketBytes.byteLength > MAX_NATIVE_REVIEW_PACKET_BYTES) {
    return { errors: [error('REVIEW_PACKET_TOO_LARGE', `reviewPacketBytes must be no larger than ${MAX_NATIVE_REVIEW_PACKET_BYTES} bytes.`)] };
  }
  try {
    return { value: parseNativeReviewEvidenceJsonBytes(reviewPacketBytes) };
  } catch {
    return { errors: [error('INVALID_REVIEW_PACKET_SCHEMA', 'reviewPacketBytes must be valid UTF-8 strict JSON for a completed native-review packet.')] };
  }
}

function canonicalValuesEqual(left, right) {
  const leftCanonical = canonicalizePlainJson(left);
  const rightCanonical = canonicalizePlainJson(right);
  return leftCanonical !== null && leftCanonical === rightCanonical;
}

function packetFindingValid(finding, packet, artifact, program) {
  if (!exactKeys(finding, COMPLETED_PACKET_FINDING_FIELDS)
    || typeof finding.id !== 'string' || !ID_PATTERN.test(finding.id)
    || finding.locale !== packet.locale
    || !LOCALIZATION_CAPABILITIES.includes(finding.capability)
    || !program.requiredJourneyIds.includes(finding.journeyId)
    || !PACKET_FINDING_SEVERITIES.includes(finding.severity)
    || !program.requiredAreas.includes(finding.category)
    || !PACKET_FINDING_STATUSES.includes(finding.status)
    || !nonEmptyText(finding.summary, 1_000)
    || !nonEmptyText(finding.sourceText, 4_000)
    || !nonEmptyText(finding.proposedText, 4_000)
    || !nonEmptyText(finding.rationale, 4_000)
    || !nonEmptyText(finding.evidenceReference)
    || finding.reviewerId !== artifact.reviewerId) {
    return false;
  }
  if (finding.status === 'resolved') {
    return isoDateTime(finding.resolvedAt) && nonEmptyText(finding.recheckEvidence);
  }
  return finding.resolvedAt === null && finding.recheckEvidence === null;
}

function packetEvidenceRecordMap(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 1_000) return null;
  const byId = new Map();
  for (const record of records) {
    if (!exactKeys(record, PACKET_EVIDENCE_RECORD_FIELDS)
      || !nonEmptyText(record.id)
      || !PACKET_EVIDENCE_KINDS.includes(record.kind)
      || !nonEmptyText(record.summary, 1_000)
      || typeof record.contentDigest !== 'string'
      || !SHA256_PATTERN.test(record.contentDigest)
      || byId.has(record.id)) {
      return null;
    }
    byId.set(record.id, record);
  }
  return byId;
}

function validatePacketEvidenceReferences(packet, artifact, evidenceRecords) {
  const errors = [];
  const requireRecord = (reference, kind, label) => {
    if (evidenceRecords.get(reference)?.kind !== kind) {
      errors.push(error('UNRESOLVED_PACKET_EVIDENCE_REFERENCE', `${label} must resolve to a ${kind} evidenceRecords entry in the completed packet.`));
    }
  };
  for (const [section, entries] of Object.entries(artifact.completionSummary)) {
    const kind = section === 'blockingFindingRechecks' ? 'recheck' : 'completion';
    if (!Array.isArray(entries)) {
      errors.push(error('UNRESOLVED_PACKET_EVIDENCE_REFERENCE', `${section} must be an array of signed completion references.`));
      continue;
    }
    for (const entry of entries) requireRecord(entry.evidenceReference, kind, `${section}/${entry.id}`);
  }
  if (!Array.isArray(artifact.findingsLog)) {
    errors.push(error('UNRESOLVED_PACKET_EVIDENCE_REFERENCE', 'findingsLog must be an array of signed finding references.'));
  } else {
    for (const finding of artifact.findingsLog) requireRecord(finding.evidenceReference, 'finding', `finding/${finding.id}`);
  }
  requireRecord(artifact.browserGateEvidenceReference, 'browser-gate', 'browserGateEvidenceReference');
  requireRecord(artifact.approvalReference, 'approval', 'approvalReference');
  for (const finding of packet.findings) {
    if (finding.status === 'resolved') requireRecord(finding.recheckEvidence, 'recheck', `finding recheck/${finding.id}`);
  }
  return errors;
}

function validateCompletedPacket(packet, artifact, program) {
  const errors = [];
  const packetError = (message) => errors.push(error('INVALID_REVIEW_PACKET_SCHEMA', message));
  if (!exactKeys(packet, COMPLETED_PACKET_FIELDS)) {
    packetError(`Completed review-packet fields must exactly match the ${program.id} completed-packet schema.`);
    return errors;
  }
  if (packet.schemaVersion !== program.completedPacketSchemaVersion
    || packet.packetVersion !== program.completedPacketVersion
    || packet.reviewProgram !== program.id
    || packet.status !== 'completed') {
    packetError(`Completed packet must declare ${program.completedPacketSchemaVersion}, ${program.completedPacketVersion}, ${program.id}, and completed status.`);
  }
  if (!program.localeIds.includes(packet.locale) || packet.locale !== artifact.locale) {
    packetError(`Completed packet locale must be an allowed ${program.id} locale matching the signed artifact.`);
  }
  if (packet.reviewPacketReference !== artifact.reviewPacketReference) {
    packetError('Completed packet reviewPacketReference must match the signed artifact.');
  }
  const provenance = packet.provenance;
  if (!exactKeys(provenance, COMPLETED_PACKET_PROVENANCE_FIELDS)) {
    packetError(`Completed packet provenance fields must exactly match the ${program.id} completed-packet schema.`);
  } else {
    if (provenance.locale !== packet.locale || provenance.market !== LOCALE_CAPABILITIES[packet.locale]?.marketId
      || provenance.catalogHash !== artifact.catalogHash
      || provenance.glossaryVersion !== artifact.glossaryVersion
      || provenance.buildId !== artifact.buildId
      || provenance.reviewedProductVersion !== artifact.reviewedProductVersion
      || provenance.reviewedPromptVersion !== artifact.reviewedPromptVersion
      || provenance.browserGateEvidenceReference !== artifact.browserGateEvidenceReference
      || provenance.reviewerId !== artifact.reviewerId
      || provenance.reviewedAt !== artifact.reviewedAt
      || provenance.approvalReference !== artifact.approvalReference
      || !Array.isArray(provenance.modelVersions)
      || provenance.modelVersions.length === 0
      || provenance.modelVersions.some((version) => typeof version !== 'string' || !ID_PATTERN.test(version))
      || !isoDate(provenance.sourceSnapshotDate)) {
      packetError('Completed packet provenance must be concrete and exactly bound to the signed artifact locale and release candidate.');
    }
  }
  if (!exactKeys(packet.completionSummary, COMPLETION_SUMMARY_FIELDS)
    || !canonicalValuesEqual(packet.completionSummary, artifact.completionSummary)) {
    packetError('Completed packet completionSummary must exactly match the signed artifact completion declarations.');
  }
  if (!Array.isArray(packet.findings) || packet.findings.length > 500) {
    packetError('Completed packet findings must be an array of at most 500 structured findings.');
  } else {
    const ids = new Set();
    for (const finding of packet.findings) {
      if (!packetFindingValid(finding, packet, artifact, program) || ids.has(finding?.id)) {
        packetError('Each completed packet finding must be locale-bound, structured, and use a supported severity/status/category.');
        break;
      }
      ids.add(finding.id);
    }
    const projected = packet.findings.map(projectCompletedPacketFinding);
    if (!canonicalValuesEqual(projected, artifact.findingsLog)) {
      packetError('Artifact findingsLog must be the documented projection of the completed packet findings.');
    }
    const blockingRecheckEntries = packet.completionSummary?.blockingFindingRechecks;
    const blockingRechecks = new Map(Array.isArray(blockingRecheckEntries)
      ? blockingRecheckEntries.map((entry) => [entry.id, entry.evidenceReference])
      : []);
    for (const finding of packet.findings) {
      if (finding?.severity === 'blocking' && finding?.status === 'resolved'
        && blockingRechecks.get(finding.id) !== finding.recheckEvidence) {
        packetError('Each resolved blocking packet finding must use the matching signed blockingFindingRechecks evidence reference.');
        break;
      }
    }
  }
  const evidenceRecords = packetEvidenceRecordMap(packet.evidenceRecords);
  if (!evidenceRecords) {
    packetError('Completed packet evidenceRecords must be unique structured records with an ID, kind, summary, and sha256 contentDigest.');
  } else if (errors.length === 0) {
    errors.push(...validatePacketEvidenceReferences(packet, artifact, evidenceRecords));
  }
  return errors;
}

/**
 * Validates a signed human-review record for an explicitly selected review program. A positive
 * result is deliberately only an intake receipt: changing release metadata
 * remains an explicit, separately reviewed registry edit.
 */
export function validateNativeReviewEvidence(envelope, {
  trustedReviewerKeys,
  expectedBindings,
  reviewPacketBytes,
  expectedReviewProgram = CJK_NATIVE_REVIEW_PROGRAM,
  now = Date.now,
  maxAgeMs = DEFAULT_NATIVE_REVIEW_MAX_AGE_MS,
  maxFutureSkewMs = DEFAULT_NATIVE_REVIEW_MAX_FUTURE_SKEW_MS,
} = {}) {
  const envelopeSnapshot = snapshotEnvelope(envelope);
  if (!envelopeSnapshot || !exactKeys(envelopeSnapshot.artifact, ARTIFACT_FIELDS)) {
    return rejected([error('INVALID_ENVELOPE', 'Native-review evidence must be a plain, accessor-free signed artifact envelope.')]);
  }

  const artifact = envelopeSnapshot.artifact;
  const errors = [];
  const program = nativeReviewProgramContract(expectedReviewProgram);
  if (!program) {
    errors.push(error('INVALID_EXPECTED_REVIEW_PROGRAM', 'expectedReviewProgram must name a supported native-review program.'));
  }
  const validationProgram = program || NATIVE_REVIEW_PROGRAM_CONTRACTS[CJK_NATIVE_REVIEW_PROGRAM];
  const nowMs = resolveNowMilliseconds(now);
  const timePolicyValid = Number.isFinite(nowMs)
    && Number.isFinite(new Date(nowMs).getTime())
    && validDuration(maxAgeMs)
    && validDuration(maxFutureSkewMs);
  if (!timePolicyValid) {
    errors.push(error('INVALID_TIME_POLICY', 'now, maxAgeMs, and maxFutureSkewMs must define a finite, non-negative review freshness policy.'));
  }
  const expectedBindingSnapshot = snapshotPlainJson(expectedBindings)?.value;
  if (!expectedBindingsValid(expectedBindingSnapshot, validationProgram)) {
    errors.push(error(
      'INVALID_EXPECTED_BINDINGS',
      `expectedBindings must declare exactly: ${EXPECTED_BINDING_FIELDS.join(', ')}.`,
    ));
  } else {
    for (const field of EXPECTED_BINDING_FIELDS) {
      if (artifact[field] !== expectedBindingSnapshot[field]) {
        errors.push(error('EXPECTED_BINDING_MISMATCH', `${field} does not match the operator-declared expected binding.`));
      }
    }
  }
  if (artifact.schemaVersion !== NATIVE_REVIEW_EVIDENCE_SCHEMA_VERSION) {
    errors.push(error('UNSUPPORTED_SCHEMA_VERSION', `schemaVersion must be ${NATIVE_REVIEW_EVIDENCE_SCHEMA_VERSION}.`));
  }
  if (artifact.reviewProgram !== validationProgram.id) {
    errors.push(error('UNSUPPORTED_REVIEW_PROGRAM', `This intake expects ${validationProgram.id} evidence and does not accept a relabeled or cross-program packet.`));
  }
  if (artifact.registryVersion !== LOCALIZATION_REGISTRY_VERSION) {
    errors.push(error('REGISTRY_VERSION_MISMATCH', `registryVersion must match ${LOCALIZATION_REGISTRY_VERSION}.`));
  }
  if (!validationProgram.localeIds.includes(artifact.locale)) {
    errors.push(error('UNSUPPORTED_LOCALE', `The ${validationProgram.id} intake accepts only its canonical locale IDs.`));
  }
  if (typeof artifact.reviewerId !== 'string' || !ID_PATTERN.test(artifact.reviewerId)) {
    errors.push(error('INVALID_REVIEWER_ID', 'reviewerId must be a stable reviewer identifier.'));
  }
  if (!isoDateTime(artifact.reviewedAt)) {
    errors.push(error('INVALID_REVIEWED_AT', 'reviewedAt must be the canonical UTC form YYYY-MM-DDTHH:mm:ss.sssZ.'));
  } else if (timePolicyValid) {
    const reviewedAtMs = Date.parse(artifact.reviewedAt);
    if (nowMs - reviewedAtMs > maxAgeMs) {
      errors.push(error('REVIEW_EVIDENCE_TOO_OLD', 'reviewedAt is older than the configured maximum evidence age.'));
    }
    if (reviewedAtMs - nowMs > maxFutureSkewMs) {
      errors.push(error('REVIEW_EVIDENCE_FROM_FUTURE', 'reviewedAt exceeds the configured future clock-skew allowance.'));
    }
    if (!Number.isFinite(new Date(reviewedAtMs + maxAgeMs).getTime())) {
      errors.push(error('INVALID_TIME_POLICY', 'maxAgeMs must yield a representable receipt expiration time.'));
    }
  }
  if (artifact.glossaryVersion !== validationProgram.glossaryVersion) {
    errors.push(error('GLOSSARY_VERSION_MISMATCH', `glossaryVersion must be ${validationProgram.glossaryVersion}.`));
  }
  if (typeof artifact.catalogHash !== 'string' || !SHA256_PATTERN.test(artifact.catalogHash)) {
    errors.push(error('INVALID_CATALOG_HASH', 'catalogHash must be a sha256 digest.'));
  } else if (validationProgram.requiresCurrentCatalogHash && artifact.catalogHash !== CURRENT_LOCALIZATION_CATALOG_HASH) {
    errors.push(error('CATALOG_HASH_MISMATCH', 'catalogHash does not match the canonical catalog and registry provenance in this candidate.'));
  }
  for (const [field, value] of Object.entries({
    buildId: artifact.buildId,
    reviewedProductVersion: artifact.reviewedProductVersion,
    reviewedPromptVersion: artifact.reviewedPromptVersion,
  })) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
      errors.push(error('INVALID_VERSION_REFERENCE', `${field} must be a stable, non-empty version identifier.`));
    }
  }
  if (typeof artifact.reviewPacketDigest !== 'string' || !SHA256_PATTERN.test(artifact.reviewPacketDigest)
    || !nonEmptyText(artifact.reviewPacketReference)) {
    errors.push(error('INVALID_REVIEW_PACKET_BINDING', 'reviewPacketDigest and reviewPacketReference must identify the signed completed review packet.'));
  }

  let reviewPacketByteVerification = 'NOT_SUPPLIED';
  let reviewPacketSchemaValidation = 'NOT_SUPPLIED';
  if (reviewPacketBytes !== undefined) {
    reviewPacketByteVerification = 'NOT_VERIFIED';
    reviewPacketSchemaValidation = 'NOT_PERFORMED';
    const parsedPacket = parseCompletedPacketBytes(reviewPacketBytes);
    if (parsedPacket.errors) {
      errors.push(...parsedPacket.errors);
    } else {
      const suppliedPacketDigest = `sha256:${createHash('sha256').update(reviewPacketBytes).digest('hex')}`;
      if (suppliedPacketDigest !== artifact.reviewPacketDigest) {
        errors.push(error('REVIEW_PACKET_DIGEST_MISMATCH', 'reviewPacketDigest does not match the supplied completed packet bytes.'));
      } else {
        reviewPacketByteVerification = 'HASH_VERIFIED';
        const packetErrors = validateCompletedPacket(parsedPacket.value, artifact, validationProgram);
        if (packetErrors.length) {
          errors.push(...packetErrors);
        } else {
          reviewPacketSchemaValidation = 'COMPLETED_PACKET_VALIDATED';
        }
      }
    }
  }

  if (!uniqueKnownValues(artifact.capabilityScope, LOCALIZATION_CAPABILITIES)) {
    errors.push(error('INCOMPLETE_CAPABILITY_SCOPE', 'capabilityScope must include every localization capability exactly once.'));
  }
  if (!uniqueKnownValues(artifact.reviewCoverage, validationProgram.requiredAreas)) {
    errors.push(error('INCOMPLETE_REVIEW_COVERAGE', `reviewCoverage must include every required ${validationProgram.id} review area exactly once.`));
  }
  if (!exactKeys(artifact.completionSummary, COMPLETION_SUMMARY_FIELDS)) {
    errors.push(error('INVALID_COMPLETION_SUMMARY', 'completionSummary must contain only the canonical signed completion sections.'));
  }
  const completionRequirements = [
    ['journeys', validationProgram.requiredJourneyIds, 'INCOMPLETE_JOURNEY_COMPLETIONS'],
    ['viewports', validationProgram.requiredViewports, 'INCOMPLETE_VIEWPORT_COMPLETIONS'],
    ['capabilities', LOCALIZATION_CAPABILITIES, 'INCOMPLETE_CAPABILITY_COMPLETIONS'],
    ['reviewAreas', validationProgram.requiredAreas, 'INCOMPLETE_REVIEW_AREA_COMPLETIONS'],
    ['accessibilityRequirements', validationProgram.accessibilityRequirements, 'INCOMPLETE_ACCESSIBILITY_COMPLETIONS'],
    ['provenanceRequirements', validationProgram.provenanceRequirements, 'INCOMPLETE_PROVENANCE_COMPLETIONS'],
    ['recheckRequirements', validationProgram.recheckRequirements, 'INCOMPLETE_RECHECK_COMPLETIONS'],
  ];
  for (const [section, requiredIds, errorCode] of completionRequirements) {
    if (!completeReferencedCoverage(artifact.completionSummary?.[section], requiredIds)) {
      errors.push(error(errorCode, `${section} must attest every canonical requirement exactly once with completed=true and an evidence reference.`));
    }
  }
  if (!Array.isArray(artifact.findingsLog) || artifact.findingsLog.length > 500) {
    errors.push(error('INVALID_FINDINGS_LOG', 'findingsLog must be an array with at most 500 structured findings.'));
  } else {
    const findingIds = new Set();
    for (const finding of artifact.findingsLog) {
      if (!exactKeys(finding, FINDING_FIELDS)
        || typeof finding.id !== 'string' || !ID_PATTERN.test(finding.id)
        || !['blocking', 'non-blocking'].includes(finding.severity)
        || !['open', 'resolved'].includes(finding.status)
        || !nonEmptyText(finding.summary, 1_000)
        || !nonEmptyText(finding.evidenceReference)) {
        errors.push(error('INVALID_FINDING', 'Each finding must have an ID, registry-safe severity/status/summary, and an evidence reference.'));
        break;
      }
      if (findingIds.has(finding.id)) {
        errors.push(error('DUPLICATE_FINDING_ID', 'Finding IDs must be unique within one review artifact.'));
        break;
      }
      findingIds.add(finding.id);
    }
    if (artifact.findingsLog.some((finding) => finding?.severity === 'blocking' && finding?.status !== 'resolved')) {
      errors.push(error('BLOCKING_FINDINGS_UNRESOLVED', 'Blocking findings must be resolved and rechecked before intake.'));
    }
  }
  const resolvedBlockingFindingIds = Array.isArray(artifact.findingsLog)
    ? artifact.findingsLog
      .filter((finding) => finding?.severity === 'blocking' && finding?.status === 'resolved')
      .map((finding) => finding.id)
    : [];
  if (!completeReferencedCoverage(artifact.completionSummary?.blockingFindingRechecks, resolvedBlockingFindingIds)) {
    errors.push(error(
      'INCOMPLETE_BLOCKING_FINDING_RECHECKS',
      'blockingFindingRechecks must attest every resolved blocking finding exactly once with an evidence reference.',
    ));
  }
  if (artifact.blockingFindingsResolved !== true) {
    errors.push(error('BLOCKING_RESOLUTION_NOT_CONFIRMED', 'blockingFindingsResolved must be true for an intake-ready record.'));
  }
  for (const [field, value] of Object.entries({
    browserGateEvidenceReference: artifact.browserGateEvidenceReference,
    approvalReference: artifact.approvalReference,
  })) {
    if (!nonEmptyText(value)) errors.push(error('MISSING_EVIDENCE_REFERENCE', `${field} must identify the reviewer or browser evidence record.`));
  }
  const signatureBytes = canonicalSignatureBytes(envelopeSnapshot.signature);
  const trustedReviewers = trustedReviewerEntries(trustedReviewerKeys, validationProgram);
  if (!signatureBytes) {
    errors.push(error('INVALID_SIGNATURE_ENCODING', 'signature must be the canonical padded Base64 encoding of exactly 64 Ed25519 signature bytes.'));
  } else if (!signedEnvelopeValid(artifact, envelopeSnapshot.artifactCanonical, trustedReviewers, signatureBytes)) {
    errors.push(error('UNTRUSTED_OR_INVALID_SIGNATURE', `The record must be signed by a configured trusted ${validationProgram.id} reviewer key scoped to this locale.`));
  }
  if (errors.length) return rejected(errors);

  const validatedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(Date.parse(artifact.reviewedAt) + maxAgeMs).toISOString();
  const registryProjection = {
    reviewer: artifact.reviewerId,
    reviewedAt: artifact.reviewedAt,
    glossaryVersion: artifact.glossaryVersion,
    capabilityScope: [...artifact.capabilityScope],
    reviewedProductVersion: artifact.reviewedProductVersion,
    reviewedPromptVersion: artifact.reviewedPromptVersion,
    findingsLog: artifact.findingsLog.map(findingProjection),
    blockingFindingsResolved: artifact.blockingFindingsResolved,
  };
  const declarationsOnly = reviewPacketBytes === undefined;

  return {
    ok: true,
    value: {
      schemaVersion: NATIVE_REVIEW_INTAKE_SCHEMA_VERSION,
      status: declarationsOnly ? 'DECLARATIONS_ONLY' : 'EVIDENCE_VALIDATED',
      evidenceId: `sha256:${createHash('sha256').update(envelopeSnapshot.artifactCanonical, 'utf8').digest('hex')}`,
      reviewProgram: artifact.reviewProgram,
      registryVersion: artifact.registryVersion,
      locale: artifact.locale,
      reviewerId: artifact.reviewerId,
      reviewedAt: artifact.reviewedAt,
      validatedAt,
      expiresAt,
      policy: {
        maxAgeMs,
        maxFutureSkewMs,
        packetRequiredForEvidenceValidated: true,
      },
      catalogHash: artifact.catalogHash,
      buildId: artifact.buildId,
      browserGateEvidenceReference: artifact.browserGateEvidenceReference,
      approvalReference: artifact.approvalReference,
      reviewedProductVersion: artifact.reviewedProductVersion,
      reviewedPromptVersion: artifact.reviewedPromptVersion,
      reviewPacketDigest: artifact.reviewPacketDigest,
      reviewPacketReference: artifact.reviewPacketReference,
      reviewPacketByteVerification,
      reviewPacketSchemaValidation,
      completionSummary: clone(artifact.completionSummary),
      registryProjection: clone(registryProjection),
      registryMutation: 'NOT_PERFORMED',
      releaseDecision: 'NOT_EVALUATED',
      nextAction: declarationsOnly
        ? 'This is a declarations-only receipt. Supply and validate the exact completed review-packet bytes before treating any evidence as validated; an authorized maintainer must still independently verify the human review and exact registry change.'
        : 'An authorized maintainer must independently verify the human review, packet contents, cited evidence, and exact registry change before any status can change.',
    },
  };
}

/**
 * Resolves release eligibility from an immutable registry projection and the
 * original signed review bundle. A receipt alone is intentionally insufficient
 * because intake receipts are JSON projections and are not signed envelopes.
 */
export function evaluateNativeReviewEligibility({
  entry,
  capability,
  evidenceBundle = null,
  trustedReviewerKeys = null,
  expectedBindings = null,
  expectedReviewProgram = CJK_NATIVE_REVIEW_PROGRAM,
  now = new Date(),
  maxAgeMs = DEFAULT_NATIVE_REVIEW_MAX_AGE_MS,
  maxFutureSkewMs = DEFAULT_NATIVE_REVIEW_MAX_FUTURE_SKEW_MS,
} = {}) {
  const statuses = NATIVE_REVIEW_RELEASE_ELIGIBILITY_STATUSES;
  if (typeof capability !== 'string' || !LOCALIZATION_CAPABILITIES.includes(capability)) {
    return releaseEligibilityResult(statuses.INVALID, {
      errors: [error('UNKNOWN_CAPABILITY', 'capability must be a canonical localization capability.')],
    });
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return releaseEligibilityResult(statuses.INVALID, {
      errors: [error('INVALID_REGISTRY_ENTRY', 'entry must be the current localization registry record.')],
    });
  }
  if (evidenceBundle === null || evidenceBundle === undefined) {
    return releaseEligibilityResult(statuses.NOT_PROVIDED);
  }
  if (!plainObject(evidenceBundle)
    || !Object.keys(evidenceBundle).every((key) => ['envelope', 'reviewPacketBytes'].includes(key))
    || !Object.hasOwn(evidenceBundle, 'envelope')
    || (Object.hasOwn(evidenceBundle, 'reviewPacketBytes') && evidenceBundle.reviewPacketBytes === null)) {
    return releaseEligibilityResult(statuses.INVALID, {
      errors: [error('INVALID_EVIDENCE_BUNDLE', 'evidenceBundle must contain an envelope and optional exact reviewPacketBytes.')],
    });
  }

  const validation = validateNativeReviewEvidence(evidenceBundle.envelope, {
    trustedReviewerKeys,
    expectedBindings,
    reviewPacketBytes: evidenceBundle.reviewPacketBytes,
    expectedReviewProgram,
    now,
    maxAgeMs,
    maxFutureSkewMs,
  });
  if (!validation.ok) {
    const bindingError = validation.errors.some((item) => item.code === 'EXPECTED_BINDING_MISMATCH');
    const expiredError = validation.errors.some((item) => item.code === 'REVIEW_EVIDENCE_TOO_OLD');
    return releaseEligibilityResult(
      expiredError ? statuses.EXPIRED : bindingError ? statuses.STALE_BINDING : statuses.INVALID,
      { errors: validation.errors },
    );
  }

  const receipt = validation.value;
  if (receipt.status !== 'EVIDENCE_VALIDATED') {
    return releaseEligibilityResult(statuses.DECLARATIONS_ONLY, { receipt });
  }
  const nowMs = nowMilliseconds(now);
  const expiresAtMs = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs) {
    return releaseEligibilityResult(statuses.EXPIRED, { receipt });
  }
  if (receipt.locale !== entry.id
    || !canonicalValuesEqual(receipt.registryProjection, nativeReviewRegistryProjection(entry))) {
    return releaseEligibilityResult(statuses.STALE_BINDING, { receipt });
  }
  if (!metadataReleaseEligible(entry, capability)) {
    return releaseEligibilityResult(statuses.INVALID, { receipt });
  }
  return releaseEligibilityResult(statuses.ELIGIBLE, { releaseEligible: true, receipt });
}
