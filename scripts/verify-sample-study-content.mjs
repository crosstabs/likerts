import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleStudies } from '../content/sample-studies.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const captureDirectory = resolve(root, 'content/sample-study-captures');
const secretKeyPattern = /(?:api[-_]?key|authorization|cookie|password|secret|client[-_]?run[-_]?id)$/i;
const dangerousHostPattern = /(^|\.)(localhost|local|internal)$|^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[0-1])\./i;

const scriptRules = {
  'en-US': { required: /[A-Za-z]/, forbidden: /[\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/ },
  'es-ES': { required: /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/, forbidden: /[\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/ },
  'pt-BR': { required: /[A-Za-zÁÀÃÂÇÉÊÍÓÔÕÚáàãâçéêíóôõú]/, forbidden: /[\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/ },
  'fr-FR': { required: /[A-Za-zÀÂÇÉÈÊËÎÏÔÛÙÜŸàâçéèêëîïôûùüÿ]/, forbidden: /[\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/ },
  'de-DE': { required: /[A-Za-zÄÖÜẞäöüß]/, forbidden: /[\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/ },
  'zh-CN': { required: /[\u3400-\u9fff]/, forbidden: /[\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\uac00-\ud7af]/ },
  'ja-JP': { required: /[\u3040-\u30ff\u3400-\u9fff]/, forbidden: /[\u0600-\u06ff\u0900-\u097f\uac00-\ud7af]/ },
  'ko-KR': { required: /[\uac00-\ud7af]/, forbidden: /[\u0600-\u06ff\u0900-\u097f\u3040-\u30ff]/ },
  'ar-SA': { required: /[\u0600-\u06ff]/, forbidden: /[\u0900-\u097f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/ },
  'hi-IN': { required: /[\u0900-\u097f]/, forbidden: /[\u0600-\u06ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/ },
};

const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const strings = (value) => {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(strings);
};
const exactlyFivePercentages = (value) => Array.isArray(value) && value.length === 5 && value.every((item) => Number.isInteger(item) && item >= 0) && value.reduce((sum, item) => sum + item, 0) === 100;

function publicUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && Boolean(url.hostname) && !dangerousHostPattern.test(url.hostname);
  } catch { return false; }
}

function findSecretKeys(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    const own = secretKeyPattern.test(key) ? [childPath] : [];
    return [...own, ...findSecretKeys(child, childPath)];
  });
}

function collectStudyNarrative(capture) {
  const study = capture.study || {};
  return [study.title, study.summary, study.takeaway, study.confidenceNote, ...(study.cautions || []), ...(study.responses || []).flatMap((response) => [response.profile, response.quote]), ...(study.segments || []).map((segment) => segment.label)].filter(Boolean).join('\n');
}

function truncationWarnings(capture) {
  const study = capture.study || {};
  return [
    ['title', study.title, 72], ['summary', study.summary, 240], ['takeaway', study.takeaway, 360], ['confidenceNote', study.confidenceNote, 180],
  ].filter(([, value, maximum]) => typeof value === 'string' && value.length >= maximum).map(([field]) => `${field} reaches its capture limit and may be truncated`);
}

function validateCapture(capture, brief, file) {
  const errors = [];
  const warnings = [];
  const add = (condition, message) => { if (!condition) errors.push(message); };
  add(capture?.briefSlug === brief.slug, 'brief slug does not match registry');
  add(capture?.stableId === brief.stableId, 'stable ID does not match registry');
  add(typeof capture?.studyId === 'string' && /^study_[A-Za-z0-9-]+$/.test(capture.studyId), 'missing or malformed study ID');
  add(typeof capture?.runId === 'string' && /^run_[A-Za-z0-9-]+$/.test(capture.runId), 'missing or malformed run ID');
  add(typeof capture?.capturedAt === 'string' && !Number.isNaN(Date.parse(capture.capturedAt)), 'missing or malformed capture timestamp');
  add(exactlyFivePercentages(capture?.study?.distribution), 'study distribution must be five nonnegative integers totaling 100');
  add(exactlyFivePercentages(capture?.ensemble?.distribution), 'ensemble distribution must be five nonnegative integers totaling 100');
  add(capture?.provenance?.researchMode === 'DEEP', 'capture is not a DEEP run');
  add(Number.isInteger(capture?.ensemble?.completedCells) && capture.ensemble.completedCells >= 2, 'fewer than two completed DEEP cells');
  add(capture?.evidence?.gatewaySearchCompleted === true, 'missing completed Gateway Exa search');
  const ledger = capture?.evidence?.ledger;
  add(Array.isArray(ledger) && ledger.length > 0, 'evidence ledger is empty');
  if (Array.isArray(ledger)) ledger.forEach((entry, index) => {
    add(typeof entry?.title === 'string' && entry.title.trim().length > 0, `evidence ledger entry ${index + 1} has no title`);
    add(typeof entry?.excerpt === 'string' && entry.excerpt.trim().length > 0, `evidence ledger entry ${index + 1} has no excerpt`);
    add(publicUrl(entry?.url), `evidence ledger entry ${index + 1} has a malformed or non-public URL`);
  });
  add(capture?.verification?.status === 'completed', 'critic did not complete');
  add(typeof capture?.provenance?.runtimeVersion === 'string' && capture.provenance.runtimeVersion.length > 0, 'missing runtime provenance');
  add(/^[a-f0-9]{64}$/i.test(capture?.provenance?.inputHash || ''), 'missing or malformed input hash');
  add(/^[a-f0-9]{64}$/i.test(capture?.provenance?.evidenceHash || ''), 'missing or malformed evidence hash');
  add(Object.keys(capture?.provenance?.promptVersions || {}).length > 0 && Object.keys(capture?.provenance?.schemaVersions || {}).length > 0, 'missing prompt/schema provenance');
  add(typeof capture?.cost?.currency === 'string' && capture.cost.currency.length > 0, 'missing cost currency');
  add(typeof capture?.cost?.gatewayCost?.exactTotalUsd === 'string' && /^\d+(?:\.\d+)?$/.test(capture.cost.gatewayCost.exactTotalUsd), 'missing exact Gateway cost');
  add(capture?.cost?.gatewayCost?.reporting === 'complete', 'Gateway cost reporting is not complete');
  add(typeof capture?.stability?.metricVersion === 'string' && capture.stability.metricVersion.length > 0, 'missing stability metric version');
  add(Number.isInteger(capture?.stability?.cellCount) && capture.stability.cellCount >= 2, 'missing stability cell count');
  add(asNumber(capture?.stability?.meanJensenShannonDivergence) !== null && capture.stability.meanJensenShannonDivergence >= 0, 'missing stability disagreement metric');
  add(asNumber(capture?.stability?.maxPercentagePointSpread) !== null && capture.stability.maxPercentagePointSpread >= 0, 'missing stability spread metric');
  const rule = scriptRules[brief.locale];
  const narrative = collectStudyNarrative(capture);
  add(Boolean(rule?.required?.test(narrative)) && !rule?.forbidden?.test(narrative), `study narrative does not match ${brief.locale} script expectations`);
  const secretKeys = findSecretKeys(capture);
  add(secretKeys.length === 0, `secret-shaped keys present: ${secretKeys.join(', ')}`);
  warnings.push(...truncationWarnings(capture));
  if (capture?.verification?.decision === 'flagged' || capture?.verification?.evidenceAlignment === 'partially-aligned') warnings.push(`critic ${capture.verification.decision || 'review'}: ${capture.verification.evidenceAlignment || 'not assessed'}`);
  if (capture?.stability?.maxPercentagePointSpread >= 15) warnings.push(`high model-cell spread: ${capture.stability.maxPercentagePointSpread} percentage points`);
  return { file, slug: brief.slug, locale: brief.locale, capture, errors, warnings };
}

export async function auditSampleStudyCaptures({ directory = captureDirectory, studies = sampleStudies } = {}) {
  let files;
  try { files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort(); } catch (error) { throw new Error(`Cannot read capture directory: ${error.message}`); }
  const expected = new Map(studies.map((study) => [study.slug, study]));
  const results = [];
  const seen = new Set();
  for (const file of files) {
    let capture;
    try { capture = JSON.parse(await readFile(resolve(directory, file), 'utf8')); } catch (error) { results.push({ file, slug: file.replace(/\.json$/, ''), locale: '?', capture: null, errors: [`invalid JSON: ${error.message}`], warnings: [] }); continue; }
    const brief = expected.get(capture?.briefSlug);
    if (!brief) { results.push({ file, slug: capture?.briefSlug || file, locale: '?', capture, errors: ['capture has no matching registry brief'], warnings: [] }); continue; }
    seen.add(brief.slug);
    results.push(validateCapture(capture, brief, file));
  }
  for (const brief of studies) if (!seen.has(brief.slug)) results.push({ file: null, slug: brief.slug, locale: brief.locale, capture: null, errors: ['missing capture'], warnings: [] });
  const exactGatewayCostUsd = results.reduce((sum, result) => sum + Number(result.capture?.cost?.gatewayCost?.exactTotalUsd || 0), 0);
  return { results: results.sort((left, right) => left.slug.localeCompare(right.slug)), exactGatewayCostUsd: Number(exactGatewayCostUsd.toFixed(8)) };
}

function printReport(report) {
  for (const result of report.results) {
    const capture = result.capture;
    const status = result.errors.length ? 'FAIL' : 'PASS';
    const evidence = capture?.evidence?.ledger?.length ?? 0;
    const cost = capture?.cost?.gatewayCost?.exactTotalUsd ?? '—';
    const cells = capture?.ensemble?.completedCells ?? '—';
    const critic = capture?.verification?.status ?? '—';
    const quality = capture?.verification?.evidenceAlignment ?? '—';
    const stability = capture?.stability?.meanJensenShannonDivergence ?? '—';
    process.stdout.write(`${status} ${result.slug} | evidence:${evidence} | cells:${cells} | critic:${critic}/${quality} | jsd:${stability} | cost:$${cost}\n`);
    for (const error of result.errors) process.stdout.write(`  ERROR ${error}\n`);
    for (const warning of result.warnings) process.stdout.write(`  WARN ${warning}\n`);
  }
  process.stdout.write(`TOTAL exact Gateway cost: $${report.exactGatewayCostUsd.toFixed(8)}\n`);
  const failures = report.results.filter((result) => result.errors.length).length;
  process.stdout.write(`${failures ? 'FAILED' : 'PASSED'} ${report.results.length} sample-study capture(s).\n`);
  return failures;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = await auditSampleStudyCaptures();
  process.exitCode = printReport(report) ? 1 : 0;
}
