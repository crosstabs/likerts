import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateReleaseCandidate } from '../evals/release-gates.js';

const MAX_BUNDLE_BYTES = 1_048_576;

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function trustedKeys(raw, name) {
  if (!raw) throw new Error(`${name} is required and must contain a JSON object of trusted signer IDs to public PEM keys.`);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${name} must be valid JSON.`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0 || Object.values(parsed).some((key) => typeof key !== 'string' || !key.includes('PUBLIC KEY'))) throw new Error(`${name} must contain at least one public PEM key.`);
  return parsed;
}

async function readRepositoryBundle(bundlePath, cwd) {
  if (!bundlePath) throw new Error('Usage: npm run eval:release -- --bundle <signed-release-bundle.json>');
  const repositoryRoot = await fs.realpath(cwd);
  const resolved = await fs.realpath(path.resolve(repositoryRoot, bundlePath));
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) throw new Error('The release bundle must resolve inside the checked-out repository.');
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BUNDLE_BYTES) throw new Error(`The release bundle must be a non-empty JSON file no larger than ${MAX_BUNDLE_BYTES} bytes.`);
  return JSON.parse(await fs.readFile(resolved, 'utf8'));
}

export async function runReleaseGateCli({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const bundle = await readRepositoryBundle(option(argv, '--bundle'), cwd);
    const result = evaluateReleaseCandidate({
      baseline: bundle.baseline,
      current: bundle.current,
      editorialReviews: bundle.editorialReviews,
      policyApproval: bundle.policyApproval,
      trustedReviewerKeys: trustedKeys(env.LIKERTS_RELEASE_REVIEWER_KEYS_JSON, 'LIKERTS_RELEASE_REVIEWER_KEYS_JSON'),
      trustedPolicyApproverKeys: trustedKeys(env.LIKERTS_RELEASE_APPROVER_KEYS_JSON, 'LIKERTS_RELEASE_APPROVER_KEYS_JSON'),
    });
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.releaseAllowed ? 0 : 2;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Release gate failed.'}\n`);
    return 2;
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) process.exitCode = await runReleaseGateCli();
