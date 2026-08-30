#!/usr/bin/env node
import { runLocalPopulationSourceAdapter } from '../server/population-source-adapters.js';

function argumentsFrom(argv) {
  const parsed = { dryRun: false, adapterPath: null, sourcePath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') parsed.dryRun = true;
    else if (argument === '--adapter') parsed.adapterPath = argv[++index] || null;
    else if (argument === '--source') parsed.sourcePath = argv[++index] || null;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!parsed.dryRun) throw new Error('This importer is dry-run only; pass --dry-run explicitly.');
  if (!parsed.adapterPath || !parsed.sourcePath) throw new Error('Usage: import-population-data.mjs --dry-run --adapter <local-json> --source <local-csv>');
  return parsed;
}

try {
  const input = argumentsFrom(process.argv.slice(2));
  const report = await runLocalPopulationSourceAdapter(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === 'SCHEMA_DRIFT') process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
