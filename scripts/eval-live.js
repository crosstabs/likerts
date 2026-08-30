import fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { evaluationFixtures } from '../evals/fixtures.js';
import { evaluateResult } from '../evals/scoring.js';

const DEFAULT_URL = 'http://localhost:3000/api/synthetic-study';
const DEFAULT_MAX_RUNS = 3;
const DEFAULT_MAX_COST_USD = 1;
const DEFAULT_ESTIMATED_COST_USD = 0.25;
const DEFAULT_MAX_DURATION_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 200_000;
export const LIVE_EVAL_HARD_CAPS = Object.freeze({
  maxRuns: 5,
  maxCostUsd: 5,
  maxDurationMs: 300_000,
  maxOutputBytes: 1_000_000,
});

const NON_SECRET_USAGE_FIELDS = new Set(['tokenusage', 'inputtokens', 'outputtokens', 'totaltokens', 'reasoningtokens', 'cachedinputtokens']);

export function redactForEvaluation(value) {
  if (Array.isArray(value)) return value.map(redactForEvaluation);
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 2000 ? `${value.slice(0, 2000)}…[truncated]` : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalizedKey = key.replaceAll(/[-_]/g, '').toLowerCase();
    if (/authorization|api[-_]?key|secret|password|bearer/i.test(key) || (/token/i.test(key) && !NON_SECRET_USAGE_FIELDS.has(normalizedKey))) return [key, '[REDACTED]'];
    return [key, redactForEvaluation(item)];
  }));
}

function fixtureInput(fixture) {
  return {
    prompt: fixture.prompt,
    audience: fixture.audience,
    market: fixture.market,
    outputLocale: fixture.locale,
    researchMode: fixture.depth.toLowerCase() === 'deep' ? 'deep' : 'quick',
    evidencePolicy: fixture.mode === 'PRIOR_ONLY' ? 'PRIOR_ONLY' : 'AUTO',
    panelSize: fixture.panelSize || (fixture.depth === 'Deep' ? 200 : 100),
    assumptions: 'Synthetic evaluation fixture; no personal data; directional hypothesis only.',
  };
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerOption(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function enforceIntegerCap(value, { name, minimum = 1, hardMaximum }) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer of at least ${minimum}.`);
  if (value > hardMaximum) throw new Error(`${name} hard cap is ${hardMaximum}.`);
  return value;
}

function enforceNumberCap(value, { name, minimum = 0, hardMaximum }) {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} must be at least ${minimum}.`);
  if (value > hardMaximum) throw new Error(`${name} hard cap is ${hardMaximum}.`);
  return value;
}

function summarizeScore(score) {
  const checks = Array.isArray(score?.checks) ? score.checks : [];
  return {
    pass: Boolean(score?.pass),
    score: Number.isFinite(score?.score) ? score.score : 0,
    failedChecks: checks.filter((check) => !check.pass).map((check) => check.name),
  };
}

function publicFailureMessage(error) {
  if (error?.name === 'AbortError') return 'duration cap exceeded';
  const message = error instanceof Error ? error.message : String(error || '');
  return /^HTTP \d{3}$/.test(message) ? message : 'request failed';
}

export async function runLiveEvaluation({
  enabled = process.env.LIKERTS_EVAL_LIVE === '1',
  url = process.env.LIKERTS_EVAL_URL || DEFAULT_URL,
  fixtures = evaluationFixtures.slice(0, integerOption(process.env.LIKERTS_EVAL_FIXTURE_LIMIT || process.env.LIKERTS_EVAL_MAX_RUNS, DEFAULT_MAX_RUNS)),
  maxRuns = integerOption(process.env.LIKERTS_EVAL_MAX_RUNS, DEFAULT_MAX_RUNS),
  maxCostUsd = finiteNumber(process.env.LIKERTS_EVAL_MAX_COST_USD, DEFAULT_MAX_COST_USD),
  estimatedCostPerRunUsd = finiteNumber(process.env.LIKERTS_EVAL_ESTIMATED_COST_USD, DEFAULT_ESTIMATED_COST_USD),
  maxDurationMs = integerOption(process.env.LIKERTS_EVAL_MAX_DURATION_MS, DEFAULT_MAX_DURATION_MS),
  maxOutputBytes = integerOption(process.env.LIKERTS_EVAL_OUTPUT_MAX_BYTES, DEFAULT_MAX_OUTPUT_BYTES),
  outputPath = process.env.LIKERTS_EVAL_OUTPUT || 'evals/live-results.jsonl',
  fetchImpl = fetch,
} = {}) {
  if (!enabled) return { status: 'disabled', reason: 'Set LIKERTS_EVAL_LIVE=1 to enable paid/live calls.', runs: 0 };
  enforceIntegerCap(maxRuns, { name: 'max-runs', hardMaximum: LIVE_EVAL_HARD_CAPS.maxRuns });
  enforceIntegerCap(maxDurationMs, { name: 'duration cap', minimum: 1_000, hardMaximum: LIVE_EVAL_HARD_CAPS.maxDurationMs });
  enforceIntegerCap(maxOutputBytes, { name: 'output cap', minimum: 512, hardMaximum: LIVE_EVAL_HARD_CAPS.maxOutputBytes });
  enforceNumberCap(maxCostUsd, { name: 'max-cost', hardMaximum: LIVE_EVAL_HARD_CAPS.maxCostUsd });
  let targetUrl;
  try { targetUrl = new URL(url); } catch { throw new Error('url must be a valid HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('url must be a valid HTTP(S) URL.');
  if (fixtures.length > maxRuns) throw new Error(`Requested ${fixtures.length} runs exceeds max-runs cap ${maxRuns}.`);
  if (!Number.isFinite(estimatedCostPerRunUsd) || estimatedCostPerRunUsd < 0) throw new Error('estimated cost must be a non-negative number.');
  const estimatedCostUsd = fixtures.length * estimatedCostPerRunUsd;
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < 0 || estimatedCostUsd > maxCostUsd) throw new Error(`Estimated cost ${estimatedCostUsd.toFixed(2)} exceeds max-cost cap ${maxCostUsd}.`);

  const rows = [];
  const evaluationStartedAt = Date.now();
  for (const fixture of fixtures) {
    const remainingMs = maxDurationMs - (Date.now() - evaluationStartedAt);
    if (remainingMs <= 0) throw new Error(`Live eval duration cap ${maxDurationMs}ms exceeded.`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    timeout.unref?.();
    const startedAt = Date.now();
    let result;
    let error = null;
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fixtureInput(fixture)), signal: controller.signal });
      if (!response?.ok) throw new Error(`HTTP ${response?.status || 'unknown'}`);
      result = await response.json();
    } catch (caught) {
      error = publicFailureMessage(caught);
    } finally {
      clearTimeout(timeout);
    }
    const score = result ? evaluateResult(result, fixture) : { pass: false, score: 0, checks: [], errors: [error] };
    rows.push({
      fixtureId: fixture.id,
      locale: fixture.locale,
      mode: fixture.mode,
      depth: fixture.depth,
      durationMs: Date.now() - startedAt,
      score: summarizeScore(score),
      error,
    });
  }
  const summary = { status: 'completed', url, runs: rows.length, passed: rows.filter((row) => row.score.pass).length, estimatedCostUsd, rows: rows.length };
  const output = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n${JSON.stringify({ summary })}\n`;
  if (Buffer.byteLength(output, 'utf8') > maxOutputBytes) throw new Error(`Live eval output would exceed output cap ${maxOutputBytes} bytes.`);
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output, 'utf8');
  return { ...summary, outputPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveEvaluation().then((report) => {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
