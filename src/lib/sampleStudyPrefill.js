import { sampleStudies } from '../../content/sample-studies.mjs';
import { initialStudy, markets } from '../data.js';

const SAMPLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function marketForRequest(request) {
  const exact = markets.find((market) => market.value === request.market);
  if (exact) return exact.value;
  return markets.find((market) => market.searchCountry === request.searchCountry)?.value || 'Global';
}

export function sampleStudyPrefillFromSearch(search, studies = sampleStudies) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const sampleValues = params.getAll('sample');
  if (sampleValues.length !== 1) return null;

  const sampleSlug = sampleValues[0];
  if (sampleSlug.length > 100 || !SAMPLE_SLUG.test(sampleSlug)) return null;
  const sample = studies.find((candidate) => candidate.slug === sampleSlug);
  if (!sample) return null;

  const request = sample.request;
  return {
    sampleSlug,
    shouldOpenBrief: true,
    shouldRun: false,
    study: {
      ...initialStudy,
      prompt: request.prompt,
      audience: request.audience,
      market: marketForRequest(request),
      outputLocale: request.outputLocale,
      sourceLanguages: [...(request.sourceLanguages || [])],
      panelSize: request.panelSize,
      researchMode: String(request.researchMode || 'quick').toLowerCase(),
      sources: [...(request.sourceUrls || [])],
      assumptions: request.assumptions || '',
    },
  };
}
