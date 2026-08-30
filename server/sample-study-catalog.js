import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_STUDY_SCHEMA_VERSION, sampleStudies } from '../content/sample-studies.mjs';
import { CJK_LOCALE_IDS } from '../shared/localization.mjs';
import { normalizeLocalizationRequest } from './localization-request.js';
import {
  canonicalSampleLineageForSample,
} from './sample-lineage.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicRoot = resolve(root, 'public');
const siteOrigin = 'https://likerts.com';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SAMPLE_STUDY_CATALOG_URI = 'likerts://sample-studies/catalog';
export const sampleStudyResourceUri = (slug) => `likerts://sample-studies/${slug}`;

const localeNames = Object.freeze({
  'en-US': 'English (US)',
  'es-ES': 'Español (España)',
  'pt-BR': 'Português (Brasil)',
  'fr-FR': 'Français (France)',
  'de-DE': 'Deutsch (Deutschland)',
  'zh-CN': '中文（中国）',
  'ja-JP': '日本語（日本）',
  'ko-KR': '한국어(대한민국)',
  'ar-SA': 'العربية (السعودية)',
  'hi-IN': 'हिन्दी (भारत)',
});

const industryNames = Object.freeze({
  'workplace-ai': 'Workplace AI',
  'electric-mobility': 'Electric mobility',
  'financial-services': 'Financial services',
  'consumer-products': 'Consumer products',
  housing: 'Home energy',
  travel: 'Travel',
  media: 'Media',
  education: 'Education',
  agriculture: 'Agriculture',
});

const localePath = (locale) => `/${locale.toLowerCase()}/studies/`;
const studyPath = (study) => `${localePath(study.locale)}${study.slug}/`;
const appEntryUrl = (study) => {
  const params = new URLSearchParams({ sample: study.slug });
  if (CJK_LOCALE_IDS.includes(study.locale)) params.set('uiLocale', study.locale);
  return `/?${params.toString()}`;
};

function canonicalLocalizationFor(study) {
  const localization = study?.localization || study?.request?.localization;
  if (!localization) {
    return {
      localization: null,
      localizationRegistryVersion: null,
      rerun: {
        allowed: false,
        block: {
          code: 'LOCALIZATION_UNRESOLVED',
          message: 'This legacy sample has no resolvable localization record and cannot be rerun.',
        },
      },
    };
  }
  try {
    const receipt = normalizeLocalizationRequest({
      localization,
      market: study.request?.market,
      outputLocale: study.request?.outputLocale,
      sourceLanguages: study.request?.sourceLanguages,
      searchCountry: study.request?.searchCountry,
      searchLocation: study.request?.searchLocation,
    });
    return {
      localization: receipt,
      localizationRegistryVersion: receipt.registryVersion,
      rerun: { allowed: true, block: null },
    };
  } catch (error) {
    return {
      localization: null,
      localizationRegistryVersion: null,
      rerun: {
        allowed: false,
        block: {
          code: error?.code || 'LOCALIZATION_UNRESOLVED',
          message: 'This sample localization cannot be resolved and cannot be rerun.',
        },
      },
    };
  }
}

function nativeReviewFor(study) {
  try {
    const review = canonicalSampleLineageForSample(study).nativeReview;
    return {
      status: review.status,
      reviewer: null,
      reviewedAt: null,
      glossaryVersion: null,
      copyStatus: review.copyStatus,
      authority: review.authority,
      releaseEligible: review.releaseEligible,
    };
  } catch {
    return {
      status: 'unresolved',
      reviewer: null,
      reviewedAt: null,
      glossaryVersion: null,
      copyStatus: 'unresolved',
      authority: 'unresolved',
      releaseEligible: false,
    };
  }
}

function qualityFor(study, status = 'pending-editorial-capture', suppliedQuality) {
  const automatedQa = suppliedQuality?.automatedQa?.status
    ? suppliedQuality.automatedQa
    : {
      // Legacy catalog status is capture/build lineage, never a proxy for
      // copyStatus or native review.
      status: status.startsWith('automated-qa-passed') ? 'passed' : 'pending',
      checkedAt: suppliedQuality?.automatedQa?.checkedAt || null,
    };
  return { automatedQa, nativeReview: nativeReviewFor(study) };
}

function registryEntry(study) {
  const lineage = canonicalLocalizationFor(study);
  return {
    slug: study.slug,
    stableId: study.stableId,
    locale: study.locale,
    localeName: localeNames[study.locale] || study.locale,
    industry: study.industry,
    industryName: industryNames[study.industry] || study.industry,
    title: study.title,
    description: study.description,
    question: study.request.prompt,
    audience: study.request.audience,
    disclosure: study.disclosure,
    humanValidation: study.humanValidation,
    canonicalUrl: `${siteOrigin}${studyPath(study)}`,
    detailUrl: studyPath(study),
    dataUrl: `${studyPath(study)}study.json`,
    runYourOwnUrl: appEntryUrl(study),
    localization: lineage.localization,
    localizationRegistryVersion: lineage.localizationRegistryVersion,
    sampleLineage: canonicalSampleLineageForSample(study),
    quality: qualityFor(study),
    rerun: lineage.rerun,
    status: 'pending-editorial-capture',
    capturedAt: null,
    evidenceMode: null,
    sourceCount: 0,
    modelCellCount: null,
    gatewayCostUsd: null,
    distribution: null,
    confidence: null,
  };
}

export const sampleStudyRegistryEntries = Object.freeze(sampleStudies.map(registryEntry).sort((left, right) => left.slug.localeCompare(right.slug)));

function annotateCatalogEntry(entry) {
  const registered = sampleStudies.find((study) => study.slug === entry?.slug);
  if (!registered) {
    const quality = qualityFor(entry || {}, entry?.status, entry?.quality);
    return {
      ...entry,
      localization: null,
      localizationRegistryVersion: null,
      sampleLineage: null,
      quality,
      runYourOwnUrl: null,
      status: quality.automatedQa.status === 'passed' ? 'automated-qa-passed' : 'pending-editorial-capture',
      rerun: {
        allowed: false,
        block: {
          code: 'LOCALIZATION_UNRESOLVED',
          message: 'This legacy sample has no registered localization record and cannot be rerun.',
        },
      },
    };
  }
  const fallback = registryEntry(registered);
  const quality = qualityFor(registered, entry.status, entry.quality);
  return {
    ...entry,
    stableId: entry.stableId || fallback.stableId,
    localization: fallback.localization,
    localizationRegistryVersion: fallback.localizationRegistryVersion,
    sampleLineage: fallback.sampleLineage,
    quality,
    status: quality.automatedQa.status === 'passed' ? 'automated-qa-passed' : 'pending-editorial-capture',
    rerun: fallback.rerun,
  };
}

function annotateCatalog(catalog) {
  const studies = Array.isArray(catalog?.studies) ? catalog.studies.map(annotateCatalogEntry) : [];
  return { ...catalog, studies };
}

async function readPublicJson(path) {
  const normalizedPath = path.replace(/^\//, '');
  return JSON.parse(await readFile(resolve(publicRoot, normalizedPath), 'utf8'));
}

export async function readSampleStudyCatalog() {
  try {
    return annotateCatalog(await readPublicJson('/studies/index.json'));
  } catch {
    return {
      schemaVersion: SAMPLE_STUDY_SCHEMA_VERSION,
      generatedFrom: 'curated-sample-study-registry',
      studies: sampleStudyRegistryEntries,
    };
  }
}

export async function listSampleStudies({ locale, industry, limit = 50 } = {}) {
  const catalog = await readSampleStudyCatalog();
  const boundedLimit = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 50));
  const studies = catalog.studies
    .filter((study) => !locale || study.locale === locale)
    .filter((study) => !industry || study.industry === industry)
    .slice(0, boundedLimit);
  return { ...catalog, studies, filters: { locale: locale || null, industry: industry || null, limit: boundedLimit } };
}

export async function getSampleStudy(slug) {
  if (typeof slug !== 'string' || slug.length > 100 || !slugPattern.test(slug)) return null;
  const catalog = await readSampleStudyCatalog();
  const entry = catalog.studies.find((study) => study.slug === slug);
  if (!entry) return null;
  try {
    const record = await readPublicJson(entry.dataUrl);
    return {
      ...record,
      status: entry.status,
      localization: entry.localization,
      localizationRegistryVersion: entry.localizationRegistryVersion,
      quality: entry.quality,
      rerun: entry.rerun,
      sampleLineage: entry.sampleLineage,
      // Preserve old record content as viewable evidence; only the explicit
      // rerun state is upgraded by the catalog adapter.
    };
  } catch {
    const brief = sampleStudies.find((study) => study.slug === slug);
    if (!brief) return null;
    return {
      schemaVersion: SAMPLE_STUDY_SCHEMA_VERSION,
      brief,
      localization: entry.localization,
      localizationRegistryVersion: entry.localizationRegistryVersion,
      quality: entry.quality,
      rerun: entry.rerun,
      sampleLineage: entry.sampleLineage,
      capture: null,
      status: 'pending-editorial-capture',
      htmlUrl: entry.detailUrl,
      dataUrl: entry.dataUrl,
      canonicalUrl: entry.canonicalUrl,
      curatedContextCandidates: brief.curatedContextUrls.map((url) => ({ url, status: 'candidate-not-confirmed-as-runtime-evidence' })),
    };
  }
}
