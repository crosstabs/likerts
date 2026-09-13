import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const digest = value => createHash('sha256').update(value).digest();
const failure = code => Object.assign(new Error(code), { safeCode: code });
const integer = value => Number.isSafeInteger(value) && value >= 0;
const roleKeys = {
  cleanup: ['LIKERTS_CLEANUP_DATABASE_URL', 'LIKERTS_VERCEL_BLOB_TOKEN', 'LIKERTS_EXPORT_PREFIX'],
  archive: ['LIKERTS_ERASURE_DATABASE_URL', 'LIKERTS_ERASURE_BLOB_TOKEN', 'LIKERTS_ERASURE_SOURCE_ID', 'LIKERTS_ERASURE_NAMESPACE'],
};
const forbidden = ['DATABASE_URL', 'LIKERTS_MIGRATION_DATABASE_URL', 'LIKERTS_WEBHOOK_DATABASE_URL', 'LIKERTS_COLLECTION_CREDENTIAL_KEY', 'LIKERTS_WEBHOOK_CREDENTIAL_KEY'];

export function childEnvironment(kind, environment, certificateFile) {
  if (forbidden.some(key => environment[key]) || roleKeys[kind === 'cleanup' ? 'archive' : 'cleanup'].some(key => environment[key])) {
    throw failure('credential_boundary_failed');
  }
  const result = { SSL_CERT_FILE: certificateFile, LANG: 'C.UTF-8' };
  for (const key of roleKeys[kind]) {
    if (!environment[key]) throw failure('configuration_missing');
    result[key] = environment[key];
  }
  if (kind === 'cleanup') result.LIKERTS_EXPORT_STORE = 'vercel_blob';
  else result.LIKERTS_ERASURE_BATCH_SIZE = '100';
  return result;
}

// stdout/stderr never reach application logs or HTTP responses. No shell,
// inherited credentials, user-selected arguments, or process-global env writes.
export function runChild(binary, args, environment, timeoutMs, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let output = '', bytes = 0, errorBytes = 0, problem, hardKill;
    const child = spawnProcess(binary, args, { env: environment, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = code => {
      if (problem) return;
      problem = code;
      child.kill('SIGTERM');
      hardKill = setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const deadline = setTimeout(() => stop('worker_timeout'), timeoutMs);
    child.stdout.on('data', data => {
      bytes += data.length;
      if (bytes > 65536) stop('worker_output_limit');
      else output += data.toString('utf8');
    });
    child.stderr.on('data', data => {
      errorBytes += data.length;
      if (errorBytes > 8192) stop('worker_output_limit');
    });
    child.once('error', () => { problem = 'worker_start_failed'; });
    child.once('close', code => {
      clearTimeout(deadline); clearTimeout(hardKill);
      if (problem || code !== 0) reject(failure(problem || 'worker_failed'));
      else resolve(output);
    });
  });
}

export async function verifyBundle(directory, kind) {
  try {
    const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
    const binary = new URL('worker', directory);
    if (process.platform !== 'linux' || manifest.arch !== process.arch || manifest.kind !== kind || manifest.sourceDirty !== false || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)) throw failure('bundle_invalid');
    const bytes = await readFile(binary);
    if (digest(bytes).toString('hex') !== manifest.sha256) throw failure('bundle_invalid');
    return fileURLToPath(binary);
  } catch { throw failure('bundle_invalid'); }
}

function parseCleanup(output) {
  const lines = output.trim().split('\n');
  if (lines.length !== 2 || !lines[0].startsWith('retention=') || !/^cleanup_worked=(true|false)$/.test(lines[1])) throw failure('worker_output_invalid');
  let retention;
  try { retention = JSON.parse(lines[0].slice(10)); } catch { throw failure('worker_output_invalid'); }
  if (typeof retention.worked !== 'boolean' || (retention.worked && (!integer(retention.responsesErased) || !integer(retention.exportsRevoked)))) throw failure('worker_output_invalid');
  return { retention: { worked: retention.worked, responsesErased: retention.worked ? retention.responsesErased : 0, exportsRevoked: retention.worked ? retention.exportsRevoked : 0 }, deleted: lines[1] === 'cleanup_worked=true' };
}
function parseArchive(output) {
  let value;
  try { value = JSON.parse(output); } catch { throw failure('worker_output_invalid'); }
  if ((value.checkpoint !== null && (typeof value.checkpoint?.id !== 'string' || typeof value.checkpoint?.sha256 !== 'string')) || value.operation !== 'drain' || !integer(value.archivedThisRun) || !integer(value.status?.pendingEvents) || !integer(value.status?.coveredEvents) || !integer(value.status?.oldestPendingSeconds)) throw failure('worker_output_invalid');
  // Deliberately omit source, object, event, checkpoint and fence identifiers.
  return { archived: value.archivedThisRun, pending: value.status.pendingEvents, covered: value.status.coveredEvents, oldestPendingSeconds: value.status.oldestPendingSeconds, checkpointWritten: value.checkpoint !== null };
}

export function makeHandler(kind, directory, dependencies = {}) {
  if (!Object.hasOwn(roleKeys, kind)) throw new Error('unknown maintenance kind');
  const execute = dependencies.execute || runChild;
  const verify = dependencies.verify || verifyBundle;
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || Date.now;
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    const send = (status, value) => { response.statusCode = status; response.end(JSON.stringify(value)); };
    const secret = environment.CRON_SECRET;
    const authorization = request.headers.authorization;
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256) return send(503, { ok: false, error: 'configuration_missing' });
    if (typeof authorization !== 'string' || authorization.length > 1024 || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) return send(401, { ok: false, error: 'unauthorized' });
    if (request.method !== 'GET' || request.url !== '/api/run') return send(400, { ok: false, error: 'invalid_request' });
    try {
      const binary = await verify(directory, kind);
      const childEnv = childEnvironment(kind, environment, fileURLToPath(new URL('ca-certificates.crt', directory)));
      const started = now();
      if (kind === 'archive') {
        const result = parseArchive(await execute(binary, ['drain'], childEnv, 200000));
        return send(200, { ok: true, kind, ...result });
      }
      let rounds = 0, deleted = 0, responsesErased = 0, exportsRevoked = 0, idle = false;
      // Stop before another potentially 45-second operation would exceed our
      // 200-second budget. Each invocation is also capped at 20 work rounds.
      while (rounds < 20 && now() - started < 155000) {
        const result = parseCleanup(await execute(binary, ['once'], childEnv, 45000));
        rounds++;
        deleted += Number(result.deleted);
        responsesErased += result.retention.responsesErased || 0;
        exportsRevoked += result.retention.exportsRevoked || 0;
        if (!result.deleted && !result.retention.worked) { idle = true; break; }
      }
      return send(200, { ok: true, kind, rounds, deleted, responsesErased, exportsRevoked, idle, budgetExhausted: !idle });
    } catch (error) {
      // Even unknown exceptions and provider error bodies are never serialized.
      const allowed = ['credential_boundary_failed', 'configuration_missing', 'bundle_invalid', 'worker_timeout', 'worker_output_limit', 'worker_start_failed', 'worker_failed', 'worker_output_invalid'];
      return send(503, { ok: false, error: allowed.includes(error?.safeCode) ? error.safeCode : 'maintenance_failed' });
    }
  };
}
