import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const skippedDirectories = new Set(['.git', '.vercel', 'dist', 'node_modules', 'design-concepts', 'design-qa-artifacts']);
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.svg', '.txt', '.yaml', '.yml']);
const secretPatterns = [
  ['OpenAI API key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['generic private key', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g],
  ['bearer token assignment', /\b(?:authorization|api[_-]?key|secret|password|token)\b\s*[:=]\s*['"][^'"\n]{12,}['"]/gi],
];

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...await collectTextFiles(join(directory, entry.name)));
      continue;
    }
    const file = join(directory, entry.name);
    if (entry.isFile() && textExtensions.has(extname(file))) files.push(file);
  }
  return files;
}

function allowedPlaceholder(match, file) {
  const path = relative(repoRoot, file);
  if (path.endsWith('.test.js') && /\b(?:secret|must-not-leak|key|pw|test-token|Bearer secret)\b/i.test(match)) return true;
  return /\b(?:example|placeholder|redacted|sk-secret|test-token|secret source body)\b/i.test(match);
}

async function scanSecrets() {
  const findings = [];
  for (const file of await collectTextFiles(repoRoot)) {
    const text = await readFile(file, 'utf8');
    for (const [name, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (!allowedPlaceholder(match[0], file)) findings.push(`${relative(repoRoot, file)}: ${name}`);
      }
    }
  }
  if (findings.length) throw new Error(`Potential secrets found:\n${findings.join('\n')}`);
}

async function scanWorkflowForPaidOrDeploySteps() {
  const workflow = await readFile(join(repoRoot, '.github/workflows/production-readiness.yml'), 'utf8');
  if (/eval:live|LIKERTS_EVAL_LIVE:\s*["']?1/i.test(workflow)) {
    throw new Error('CI workflow must not enable live evaluations.');
  }
  if (/vercel\s+deploy|npx\s+vercel|--prod/i.test(workflow)) {
    throw new Error('CI workflow must not deploy.');
  }
}

function runAudit() {
  if (process.env.CI_SECURITY_SKIP_AUDIT === '1') {
    process.stdout.write('npm audit skipped because CI_SECURITY_SKIP_AUDIT=1.\n');
    return;
  }
  const result = spawnSync('npm', ['audit', '--audit-level=high', '--omit=dev'], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`npm audit failed at high severity or above.\n${result.stdout || result.stderr}`);
  }
}

async function main() {
  await scanSecrets();
  await scanWorkflowForPaidOrDeploySteps();
  runAudit();
  process.stdout.write('Security check passed.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
