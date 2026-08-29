import fs from 'node:fs/promises';
import { evaluationFixtures } from '../evals/fixtures.js';
import { evaluateResult } from '../evals/scoring.js';

export async function readCapturedResults(path) {
  const text = await fs.readFile(path, 'utf8');
  if (path.endsWith('.jsonl')) return text.split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((row) => !row.summary);
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function scoreCapturedResults(capturedResults, fixtures = evaluationFixtures) {
  if (!Array.isArray(capturedResults)) return { status: 'invalid', runs: 0, passed: 0, rows: [], errors: ['Captured results must be an array.'] };
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const rows = capturedResults.map((captured, index) => {
    const result = captured?.result || captured;
    const fixture = byId.get(captured?.fixtureId) || fixtures[index] || {};
    return { fixtureId: captured?.fixtureId || fixture.id || `capture-${index + 1}`, score: evaluateResult(result, fixture) };
  });
  return { status: 'completed', runs: rows.length, passed: rows.filter((row) => row.score.pass).length, averageScore: rows.length ? Number((rows.reduce((sum, row) => sum + row.score.score, 0) / rows.length).toFixed(4)) : null, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('Usage: node scripts/eval-offline.js <captured-results.json|.jsonl>\n');
    process.exitCode = 1;
  } else {
    readCapturedResults(path).then((captured) => process.stdout.write(`${JSON.stringify(scoreCapturedResults(captured))}\n`)).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
