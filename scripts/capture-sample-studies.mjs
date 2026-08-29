import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleStudies } from '../content/sample-studies.mjs';
import { requestSchema, runStudyPipeline } from '../server/synthetic-study-pipeline.js';
import { sanitizeCapturedStudy } from './build-sample-studies.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultCaptureDirectory = resolve(root, 'content/sample-study-captures');
const HARD_MAX_RUNS = 10;
const HARD_MAX_CONCURRENCY = 2;
const DEFAULT_ESTIMATED_COST_USD = 0.15;

function parseArgs(argv) {
  const options = { slugs: [], mode: 'local', url: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--slug') options.slugs.push(argv[++index] || '');
    else if (argument === '--url') { options.mode = 'endpoint'; options.url = argv[++index] || ''; }
    else if (argument === '--local') options.mode = 'local';
    else if (argument === '--help') options.help = true;
    else throw new TypeError(`Unknown argument: ${argument}`);
  }
  return options;
}

function positiveDecimal(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new TypeError(`${name} must be a positive USD amount.`);
  return parsed;
}

function boundedInteger(value, fallback, name, maximum) {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new TypeError(`${name} must be an integer from 1 to ${maximum}.`);
  return parsed;
}

function endpointUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('--url must be a valid absolute http(s) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('--url must be a credential-free http(s) URL.');
  return url.toString();
}

/**
 * Plans a capture without touching the network. The two required cost caps make
 * an accidental bulk run impossible, even after the opt-in flag is present.
 */
export function buildCapturePlan({ env = process.env, argv = process.argv.slice(2) } = {}) {
  if (env.LIKERTS_CAPTURE_SAMPLE_STUDIES !== '1') throw new Error('Refusing live capture. Set LIKERTS_CAPTURE_SAMPLE_STUDIES=1 to opt in.');
  const options = parseArgs(argv);
  if (options.help) return { help: true };
  const maxRuns = boundedInteger(env.LIKERTS_CAPTURE_MAX_RUNS, 1, 'LIKERTS_CAPTURE_MAX_RUNS', HARD_MAX_RUNS);
  const concurrency = boundedInteger(env.LIKERTS_CAPTURE_CONCURRENCY, 1, 'LIKERTS_CAPTURE_CONCURRENCY', HARD_MAX_CONCURRENCY);
  const estimatedCostPerStudyUsd = positiveDecimal(env.LIKERTS_CAPTURE_ESTIMATED_COST_PER_STUDY_USD ?? DEFAULT_ESTIMATED_COST_USD, 'LIKERTS_CAPTURE_ESTIMATED_COST_PER_STUDY_USD');
  const maxEstimatedCostUsd = positiveDecimal(env.LIKERTS_CAPTURE_MAX_ESTIMATED_COST_USD, 'LIKERTS_CAPTURE_MAX_ESTIMATED_COST_USD cost cap');
  const maxActualCostUsd = positiveDecimal(env.LIKERTS_CAPTURE_MAX_ACTUAL_COST_USD, 'LIKERTS_CAPTURE_MAX_ACTUAL_COST_USD cost cap');
  const requestedSlugs = options.slugs.length ? new Set(options.slugs) : null;
  const studies = sampleStudies.filter((study) => !requestedSlugs || requestedSlugs.has(study.slug)).slice(0, maxRuns);
  if (!studies.length) throw new TypeError('No registered sample studies match the requested --slug values.');
  if (requestedSlugs && studies.length !== requestedSlugs.size) throw new TypeError('Every --slug must name a registered sample study.');
  const estimatedTotalUsd = Number((studies.length * estimatedCostPerStudyUsd).toFixed(6));
  if (estimatedTotalUsd > maxEstimatedCostUsd || estimatedTotalUsd > maxActualCostUsd) throw new RangeError('The planned capture exceeds the configured estimated or actual cost cap.');
  return Object.freeze({ mode: options.mode, url: options.mode === 'endpoint' ? endpointUrl(options.url) : null, studies, maxRuns, concurrency, estimatedCostPerStudyUsd, estimatedTotalUsd, maxEstimatedCostUsd, maxActualCostUsd });
}

function exactCost(capture, fallback) {
  const reported = Number(capture.cost?.gatewayCost?.exactTotalUsd);
  return Number.isFinite(reported) && reported >= 0 ? reported : fallback;
}

async function callEndpoint(url, request, fetchImpl) {
  const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`Endpoint capture failed with HTTP ${response.status}.`);
  return payload;
}

/** Runs opted-in capture sequentially by default; callers may set concurrency to two only. */
export async function captureSampleStudies(plan, { env = process.env, fetchImpl = fetch, captureDirectory = defaultCaptureDirectory, runPipeline = runStudyPipeline } = {}) {
  if (!plan || !Array.isArray(plan.studies) || !plan.studies.length) throw new TypeError('A capture plan is required.');
  await mkdir(captureDirectory, { recursive: true });
  const captures = [];
  let actualTotalUsd = 0;
  // Keep calls serial so the actual-cost guard is enforceable before each next paid call.
  for (const brief of plan.studies) {
    if (actualTotalUsd + plan.estimatedCostPerStudyUsd > plan.maxActualCostUsd) throw new RangeError('Stopping before the next capture would exceed the actual cost cap.');
    const request = requestSchema.parse({ ...brief.request, sourceUrls: brief.curatedContextUrls });
    const result = plan.mode === 'endpoint'
      ? await callEndpoint(plan.url, request, fetchImpl)
      : await runPipeline(request, { env });
    const capture = sanitizeCapturedStudy(brief, result);
    actualTotalUsd = Number((actualTotalUsd + exactCost(capture, plan.estimatedCostPerStudyUsd)).toFixed(6));
    if (actualTotalUsd > plan.maxActualCostUsd) throw new RangeError('Capture returned a cost above the configured actual cost cap; no further calls were made.');
    await writeFile(resolve(captureDirectory, `${brief.slug}.json`), `${JSON.stringify(capture, null, 2)}\n`);
    captures.push(capture);
  }
  return Object.freeze({ capturedCount: captures.length, actualTotalUsd, captureDirectory, captures });
}

function usage() {
  return [
    'Usage: LIKERTS_CAPTURE_SAMPLE_STUDIES=1 LIKERTS_CAPTURE_MAX_RUNS=1',
    '  LIKERTS_CAPTURE_MAX_ESTIMATED_COST_USD=0.20 LIKERTS_CAPTURE_MAX_ACTUAL_COST_USD=0.20',
    '  npm run studies:capture -- --local',
    'Optional: --url https://host/api/synthetic-study, --slug <registered-slug>, LIKERTS_CAPTURE_CONCURRENCY=1|2',
  ].join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const plan = buildCapturePlan();
  if (plan.help) process.stdout.write(`${usage()}\n`);
  else {
    const result = await captureSampleStudies(plan);
    process.stdout.write(`Captured ${result.capturedCount} study record(s); recorded cost: $${result.actualTotalUsd}.\n`);
  }
}
