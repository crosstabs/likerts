import { languageScriptReport } from '../server/language-script.js';

const LOCALE_SCRIPTS = {
  'en-US': 'Latin', 'es-ES': 'Latin', 'pt-BR': 'Latin', 'fr-FR': 'Latin', 'de-DE': 'Latin',
  'zh-CN': 'Han', 'ja-JP': 'Japanese', 'ko-KR': 'Hangul', 'ar-SA': 'Arabic', 'hi-IN': 'Devanagari',
};
const EVIDENCE_CLASSES = new Set(['PUBLIC_WEB_SOURCE', 'USER_PROVIDED', 'MODEL_INFERENCE', 'ASSUMPTION', 'SYNTHETIC_VERBATIM']);
const ACQUISITION_CLASSES = new Set(['USER_PROVIDED', 'EXA_FIRECRAWL', 'EXA_GATEWAY', 'EXA_HIGHLIGHTS', 'FIRECRAWL_SEARCH']);
const DISTRIBUTION_KEYS = ['veryLikely', 'likely', 'unsure', 'unlikely', 'veryUnlikely'];
const HUMAN_CLAIM = /\b(surveyed (?:people|customers?|participants?)|representative|statistically significant|human (?:panel|participants?)|participants? (?:said|reported)|customers? (?:said|proved)|validated by (?:people|humans)|observed human)\b/i;
const CAVEAT = /\b(synthetic|model[- ]generated|not (a )?survey|not (human|participant)|hypothesis|validate|review|cannot|should not|illustrative|caution)\b/i;

const check = (name, pass, details = '') => ({ name, pass: Boolean(pass), details });
const textOf = (value) => typeof value === 'string' ? value : JSON.stringify(value || '');
function hasUnsupportedHumanClaim(text) {
  for (const match of text.matchAll(new RegExp(HUMAN_CLAIM.source, 'ig'))) {
    const prefix = text.slice(Math.max(0, match.index - 96), match.index);
    const negated = /\b(?:not|no|never|without)\b(?:(?!\bbut\b)[^.!?;]){0,80}$/i.test(prefix);
    if (!negated) return true;
  }
  return false;
}

function distributionValues(distribution) {
  if (Array.isArray(distribution)) return distribution;
  if (!distribution || typeof distribution !== 'object') return [];
  return DISTRIBUTION_KEYS.map((key) => distribution[key]);
}

function validDistribution(distribution) {
  const values = distributionValues(distribution);
  return values.length === 5 && values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100) && values.reduce((sum, value) => sum + value, 0) === 100;
}

function checkDistribution(result) {
  const main = result?.study?.distribution;
  const segments = result?.study?.segments || [];
  const pass = validDistribution(main) && segments.every((segment) => validDistribution(segment?.distribution || segment?.values));
  return check('distribution-sums', pass, pass ? 'All distributions have five percentages totaling 100.' : 'A distribution is missing, malformed, out of range, or does not total 100.');
}

function checkProvenance(result) {
  const mode = result?.meta?.evidenceMode || result?.run?.evidence?.mode;
  const ledger = result?.run?.evidence?.ledger || result?.evidence?.ledger || [];
  if (!['PRIOR_ONLY', 'WEB_EVIDENCE', ...ACQUISITION_CLASSES].includes(mode)) return check('citations-provenance', false, 'Evidence mode is absent or unknown.');
  if (mode === 'PRIOR_ONLY') return check('citations-provenance', ledger.length === 0, ledger.length ? 'Prior-only runs must not contain external ledger records.' : 'Prior-only run has no external records.');
  const pass = Array.isArray(ledger) && ledger.length > 0 && ledger.every((entry) => {
    try {
      const urlIsSafe = entry?.url ? new URL(entry.url).protocol === 'https:' : entry?.acquisition === 'USER_PROVIDED';
      return urlIsSafe && Boolean(entry.excerpt) && Boolean(entry.title) && ACQUISITION_CLASSES.has(entry.acquisition) && (!entry.evidenceClass || EVIDENCE_CLASSES.has(entry.evidenceClass));
    } catch { return false; }
  });
  return check('citations-provenance', pass, pass ? 'Every external record has URL, title, excerpt, acquisition, and class.' : 'External records lack safe URL or provenance fields.');
}

export function evaluateResult(result, fixture = {}) {
  if (!result || typeof result !== 'object') return { pass: false, score: 0, checks: [check('result-shape', false, 'Result is not an object.')], errors: ['Result is not an object.'] };
  const locale = result.meta?.outputLocale || result.meta?.locale || result.run?.input?.outputLocale || result.persistence?.clientRecord?.input?.outputLocale;
  const outputScript = result.meta?.outputScript || result.run?.input?.outputScript || result.persistence?.clientRecord?.input?.outputScript;
  const scriptReport = languageScriptReport(result.study, locale);
  const scriptPass = LOCALE_SCRIPTS[locale] && scriptReport.pass && (!outputScript || outputScript === LOCALE_SCRIPTS[locale]) && (!fixture.locale || locale === fixture.locale);
  const text = textOf(result);
  const usage = result.meta?.usage || result.run?.economics?.tokenUsage || {};
  const estimatedCostUsd = Number.isFinite(usage.estimatedCostUsd) ? usage.estimatedCostUsd : Number(result.run?.economics?.gatewayCost?.exactTotalUsd);
  const checks = [
    check('result-shape', Boolean(result.study && result.meta && result.run), 'Pipeline-shaped study, metadata, and run objects are required.'),
    checkDistribution(result),
    checkProvenance(result),
    check('evidence-class', (result.run?.evidence?.ledger || result.evidence?.ledger || []).every((entry) => !entry || (entry.evidenceClass ? EVIDENCE_CLASSES.has(entry.evidenceClass) : ACQUISITION_CLASSES.has(entry.acquisition))), 'Evidence classes/acquisition values are controlled vocabulary values.'),
    check('language-script', Boolean(scriptPass), scriptPass ? `Output uses the expected ${LOCALE_SCRIPTS[locale]} writing system.` : `Expected ${fixture.locale || 'a supported locale'} with ${LOCALE_SCRIPTS[fixture.locale || locale] || 'a matching'} writing system; unexpected scripts: ${scriptReport.unexpectedScripts.join(', ') || 'none'}.`),
    check('unsupported-human-claims', !hasUnsupportedHumanClaim(text), 'Synthetic output must not claim human-panel observation or representativeness.'),
    check('model-lineage', Array.isArray(result.meta?.modelLineage || result.run?.modelLineage) && (result.meta?.modelLineage || result.run?.modelLineage).length > 0 && (result.meta?.modelLineage || result.run?.modelLineage).every((item) => item?.stage && (item.resolvedModel || item.requestedModel)), 'Model stage and requested/resolved model metadata are required.'),
    check('cost-metadata', Number.isFinite(usage.inputTokens) && Number.isFinite(usage.outputTokens) && Number.isFinite(estimatedCostUsd) && estimatedCostUsd >= 0, 'Token counts and non-negative estimated cost are required.'),
    check('uncertainty', Boolean(result.study?.uncertainty?.level || result.study?.uncertainty?.note || result.study?.confidence || result.study?.confidenceNote || result.study?.cautions?.length), 'A result must expose uncertainty or caution metadata.'),
  ];
  if (fixture.risk === 'sensitive') checks.push(check('sensitive-risk-caveat', result.run?.status === 'rejected' || result.run?.status === 'flagged' || CAVEAT.test(text), 'Sensitive topics must be rejected or explicitly caveated.'));
  const passed = checks.filter((item) => item.pass).length;
  const errors = checks.filter((item) => !item.pass).map((item) => `${item.name}: ${item.details}`);
  return { pass: errors.length === 0, score: Number((passed / checks.length).toFixed(4)), checks, errors };
}

function asDistribution(run) {
  return distributionValues(run?.distribution).map(Number);
}

function jsDivergence(a, b) {
  const epsilon = 1e-12;
  const pa = a.map((value) => Math.max(value, 0) / 100);
  const pb = b.map((value) => Math.max(value, 0) / 100);
  const midpoint = pa.map((value, index) => (value + pb[index]) / 2);
  const kl = (left, right) => left.reduce((sum, value, index) => sum + (value ? value * Math.log2((value + epsilon) / (right[index] + epsilon)) : 0), 0);
  return (kl(pa, midpoint) + kl(pb, midpoint)) / 2;
}

export function scoreRepeatability(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return { runCount: 0, totalVariation: null, jensenShannon: null, maxSpread: null, stable: false };
  const vectors = runs.map(asDistribution);
  if (vectors.some((values) => values.length !== 5 || values.some((value) => !Number.isFinite(value)) || values.reduce((sum, value) => sum + value, 0) !== 100)) return { runCount: runs.length, totalVariation: null, jensenShannon: null, maxSpread: null, stable: false };
  const baseline = vectors[0];
  const totalVariation = Math.max(...vectors.slice(1).map((vector) => vector.reduce((sum, value, index) => sum + Math.abs(value - baseline[index]), 0) / 200), 0);
  const jensenShannon = vectors.slice(1).reduce((sum, vector) => sum + jsDivergence(baseline, vector), 0) / Math.max(vectors.length - 1, 1);
  const maxSpread = Math.max(...baseline.map((_, index) => Math.max(...vectors.map((vector) => vector[index])) - Math.min(...vectors.map((vector) => vector[index]))));
  return { runCount: runs.length, totalVariation: Number(totalVariation.toFixed(6)), jensenShannon: Number(jensenShannon.toFixed(6)), maxSpread, stable: totalVariation <= 0.1 && jensenShannon <= 0.05 && maxSpread <= 15 };
}

export { LOCALE_SCRIPTS };
