import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_STUDY_SCHEMA_VERSION, sampleStudies } from '../content/sample-studies.mjs';

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

function registryEntry(study) {
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
    runYourOwnUrl: `/?sample=${encodeURIComponent(study.slug)}`,
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

async function readPublicJson(path) {
  const normalizedPath = path.replace(/^\//, '');
  return JSON.parse(await readFile(resolve(publicRoot, normalizedPath), 'utf8'));
}

export async function readSampleStudyCatalog() {
  try {
    return await readPublicJson('/studies/index.json');
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
    return await readPublicJson(entry.dataUrl);
  } catch {
    const brief = sampleStudies.find((study) => study.slug === slug);
    if (!brief) return null;
    return {
      schemaVersion: SAMPLE_STUDY_SCHEMA_VERSION,
      brief,
      capture: null,
      status: 'pending-editorial-capture',
      htmlUrl: entry.detailUrl,
      dataUrl: entry.dataUrl,
      canonicalUrl: entry.canonicalUrl,
      curatedContextCandidates: brief.curatedContextUrls.map((url) => ({ url, status: 'candidate-not-confirmed-as-runtime-evidence' })),
    };
  }
}
