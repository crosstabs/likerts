import { createHash } from 'node:crypto';

import {
  CJK_LOCALE_IDS,
  LOCALIZATION_REGISTRY_VERSION,
  LOCALE_CAPABILITIES,
} from '../shared/localization.mjs';
import { CJK_UI_CATALOGS } from '../src/i18nCatalog.mjs';

export const LOCALIZATION_CATALOG_HASH_SCHEMA_VERSION = 'localization-catalog-hash-v1';

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Localization catalog hash values must be JSON-compatible plain objects.');
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sortedStringRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain string record.`);
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.some(([key, text]) => !key || typeof text !== 'string')) {
    throw new TypeError(`${label} must contain only non-empty keys and string values.`);
  }
  return Object.fromEntries(entries);
}

function nativeReviewProjection(nativeReview) {
  return {
    status: nativeReview.status,
    reviewer: nativeReview.reviewer,
    reviewedAt: nativeReview.reviewedAt,
    glossaryVersion: nativeReview.glossaryVersion,
    capabilityScope: [...nativeReview.capabilityScope].sort(),
    reviewedProductVersion: nativeReview.reviewedProductVersion,
    reviewedPromptVersion: nativeReview.reviewedPromptVersion,
    findingsLog: structuredClone(nativeReview.findingsLog),
    blockingFindingsResolved: nativeReview.blockingFindingsResolved,
    statusByCapability: sortedStringRecord(
      nativeReview.statusByCapability,
      'native-review capability status',
    ),
  };
}

export function localizationCatalogHashPayload({
  registryVersion = LOCALIZATION_REGISTRY_VERSION,
  catalogs = CJK_UI_CATALOGS,
  localeCapabilities = LOCALE_CAPABILITIES,
} = {}) {
  if (typeof registryVersion !== 'string' || !registryVersion) {
    throw new TypeError('Localization registry version is required for the catalog hash.');
  }
  const locales = [...CJK_LOCALE_IDS].sort().map((localeId) => {
    const entry = localeCapabilities[localeId];
    if (!entry || !entry.release?.nativeReview || !catalogs[localeId]) {
      throw new TypeError(`Localization catalog hash input is missing ${localeId}.`);
    }
    return {
      localeId,
      htmlLang: entry.htmlLang,
      direction: entry.dir,
      nativeLabel: entry.nativeLabel,
      capabilities: sortedStringRecord(entry.capabilities, `${localeId} capability status`),
      copyProvenance: {
        copyStatus: entry.release.copyStatus,
        nativeReview: nativeReviewProjection(entry.release.nativeReview),
      },
      messages: sortedStringRecord(catalogs[localeId], `${localeId} UI catalog`),
    };
  });
  return {
    schemaVersion: LOCALIZATION_CATALOG_HASH_SCHEMA_VERSION,
    registryVersion,
    locales,
  };
}

export function deriveLocalizationCatalogHash(options = {}) {
  const payload = localizationCatalogHashPayload(options);
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
}

export const CURRENT_LOCALIZATION_CATALOG_HASH = deriveLocalizationCatalogHash();
