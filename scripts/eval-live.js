import fs from 'node:fs/promises';
import { evaluationFixtures } from '../evals/fixtures.js';
import { evaluateResult } from '../evals/scoring.js';

const DEFAULT_URL = 'http://localhost:3000/api/synthetic-study';
const DEFAULT_MAX_RUNS = 3;
const DEFAULT_MAX_COST_USD = 1;
const DEFAULT_ESTIMATED_COST_USD = 0.25;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 2000 ? `${value.slice(0, 2000)}…[truncated]` : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/authorization|api[-_]?key|secret|token|password/i.test(key)) return [key, '[REDACTED]'];
    return [key, redact(item)];
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

export async function runLiveEvaluation({
  enabled = process.env.LIKERTS_EVAL_LIVE === '1',
  url = process.env.LIKERTS_EVAL_URL || DEFAULT_URL,
  fixtures = evaluationFixtures.slice(0, Number(process.env.LIKERTS_EVAL_FIXTURE_LIMIT || process.env.LIKERTS_EVAL_MAX_RUNS || DEFAULT_MAX_RUNS)),
  maxRuns = Number(process.env.LIKERTS_EVAL_MAX_RUNS || DEFAULT_MAX_RUNS),
  maxCostUsd = Number(process.env.LIKERTS_EVAL_MAX_COST_USD || DEFAULT_MAX_COST_USD),
  estimatedCostPerRunUsd = Number(process.env.LIKERTS_EVAL_ESTIMATED_COST_USD || DEFAULT_ESTIMATED_COST_USD),
  outputPath = process.env.LIKERTS_EVAL_OUTPUT || 'evals/live-results.jsonl',
  fetchImpl = fetch,
} = {}) {
  if (!enabled) return { status: 'disabled', reason: 'Set LIKERTS_EVAL_LIVE=1 to enable paid/live calls.', runs: 0 };
  if (!Number.isInteger(maxRuns) || maxRuns < 1) throw new Error('max-runs must be a positive integer.');
  let targetUrl;
  try { targetUrl = new URL(url); } catch { throw new Error('url must be a valid HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('url must be a valid HTTP(S) URL.');
  if (fixtures.length > maxRuns) throw new Error(`Requested ${fixtures.length} runs exceeds max-runs cap ${maxRuns}.`);
  if (!Number.isFinite(estimatedCostPerRunUsd) || estimatedCostPerRunUsd < 0) throw new Error('estimated cost must be a non-negative number.');
  const estimatedCostUsd = fixtures.length * estimatedCostPerRunUsd;
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < 0 || estimatedCostUsd > maxCostUsd) throw new Error(`Estimated cost ${estimatedCostUsd.toFixed(2)} exceeds max-cost cap ${maxCostUsd}.`);

  const rows = [];
  for (const fixture of fixtures) {
    const startedAt = Date.now();
    let result;
    let error = null;
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fixtureInput(fixture)) });
      if (!response?.ok) throw new Error(`HTTP ${response?.status || 'unknown'}`);
      result = await response.json();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'request failed';
    }
    const score = result ? evaluateResult(result, fixture) : { pass: false, score: 0, checks: [], errors: [error] };
    rows.push(redact({ fixtureId: fixture.id, locale: fixture.locale, mode: fixture.mode, depth: fixture.depth, durationMs: Date.now() - startedAt, score, result, error }));
  }
  const summary = { status: 'completed', url, runs: rows.length, passed: rows.filter((row) => row.score.pass).length, estimatedCostUsd, rows: rows.length };
  await fs.writeFile(outputPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n${JSON.stringify({ summary })}\n`, 'utf8');
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
