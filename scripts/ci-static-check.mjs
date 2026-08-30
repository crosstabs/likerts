import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const skippedDirectories = new Set(['.git', '.vercel', 'dist', 'node_modules', 'design-concepts', 'design-qa-artifacts']);
const syntaxExtensions = new Set(['.js', '.mjs']);
const requiredFiles = [
  'api/health.js',
  'server/api-boundary.js',
  'server/admission-store.js',
  'server/upstash-admission-store.js',
  'server/runtime-admission-store.js',
  'server/runtime-config.js',
  'server/observability.js',
  'scripts/eval-live.js',
  'docs/production-readiness-runbook.md',
  '.github/workflows/production-readiness.yml',
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...await collectFiles(join(directory, entry.name)));
      continue;
    }
    if (entry.isFile()) files.push(join(directory, entry.name));
  }
  return files;
}

async function assertFileExists(path) {
  await readFile(join(repoRoot, path), 'utf8');
}

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Syntax check failed for ${relative(repoRoot, file)}\n${result.stderr || result.stdout}`);
  }
}

async function checkWorkflow() {
  const workflow = await readFile(join(repoRoot, '.github/workflows/production-readiness.yml'), 'utf8');
  if (/eval:live|LIKERTS_EVAL_LIVE:\s*["']?1/i.test(workflow)) {
    throw new Error('CI workflow must not enable live evaluations.');
  }
  if (/vercel\s+deploy|npx\s+vercel|--prod/i.test(workflow)) {
    throw new Error('CI workflow must not deploy.');
  }
}

async function main() {
  await Promise.all(requiredFiles.map(assertFileExists));
  await checkWorkflow();

  const files = await collectFiles(repoRoot);
  for (const file of files) {
    if (syntaxExtensions.has(extname(file))) checkSyntax(file);
  }

  process.stdout.write(`Static check passed for ${files.length} files.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
