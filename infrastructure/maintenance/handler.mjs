import { createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const digest = value => createHash('sha256').update(value).digest();
const failure = code => Object.assign(new Error(code), { safeCode: code });
const integer = value => Number.isSafeInteger(value) && value >= 0;
const archiveFailureCodes = {
  Configuration: 'archive_configuration', Database: 'archive_database', Storage: 'archive_storage',
  InvalidArchive: 'archive_invalid', CoverageUnproven: 'archive_coverage_unproven',
  FenceReleased: 'archive_fence_released', Capacity: 'archive_capacity', StaleLease: 'archive_stale_lease',
};
const archiveFailureLines = new Map(Object.entries(archiveFailureCodes).map(([category, code]) =>
  [`erasure_archive failed category=${category}; inspect restricted operational diagnostics`, code]));
const roleKeys = {
  cleanup: ['LIKERTS_CLEANUP_DATABASE_URL', 'LIKERTS_VERCEL_BLOB_TOKEN', 'LIKERTS_EXPORT_PREFIX'],
  archive: ['LIKERTS_ERASURE_DATABASE_URL', 'LIKERTS_ERASURE_BLOB_TOKEN', 'LIKERTS_ERASURE_SOURCE_ID', 'LIKERTS_ERASURE_NAMESPACE'],
};
const statusRoleKeys = {
  cleanup: ['LIKERTS_CLEANUP_DATABASE_URL'],
  archive: ['LIKERTS_ERASURE_DATABASE_URL', 'LIKERTS_ERASURE_SOURCE_ID'],
};
const forbidden = ['DATABASE_URL', 'LIKERTS_MIGRATION_DATABASE_URL', 'LIKERTS_WEBHOOK_DATABASE_URL', 'LIKERTS_COLLECTION_CREDENTIAL_KEY', 'LIKERTS_WEBHOOK_CREDENTIAL_KEY'];

export function childEnvironment(kind, environment, certificateFile, action = 'run') {
  if (forbidden.some(key => environment[key]) || roleKeys[kind === 'cleanup' ? 'archive' : 'cleanup'].some(key => environment[key])) {
    throw failure('credential_boundary_failed');
  }
  const result = { SSL_CERT_FILE: certificateFile, LANG: 'C.UTF-8' };
  const allowed = action === 'status' ? statusRoleKeys[kind] : roleKeys[kind];
  for (const key of allowed) {
    if (!environment[key]) throw failure('configuration_missing');
    result[key] = environment[key];
  }
  if (action === 'run' && kind === 'cleanup') result.LIKERTS_EXPORT_STORE = 'vercel_blob';
  else if (action === 'run') result.LIKERTS_ERASURE_BATCH_SIZE = '100';
  return result;
}

// Raw stdout/stderr never reach application logs or HTTP responses. No shell,
// inherited credentials, user-selected arguments, or process-global env writes.
export function runChild(binary, args, environment, timeoutMs, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let output = '', errorOutput = '', bytes = 0, errorBytes = 0, problem, hardKill;
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
      else errorOutput += data.toString('utf8');
    });
    child.once('error', () => { problem = 'worker_start_failed'; });
    child.once('close', (code, signal) => {
      clearTimeout(deadline); clearTimeout(hardKill);
      // Match the entire fixed Rust diagnostic, optionally with its final LF.
      // Provider bodies, additional lines, unknown categories and identifiers
      // never become diagnostics. A timeout/output limit takes precedence.
      const category = code === 1 && archiveFailureLines.get(errorOutput.replace(/\n$/, ''));
      if (problem || code !== 0) reject(failure(problem || (signal ? 'worker_terminated' : category || 'worker_failed')));
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

function parseCleanupStatus(output) {
  let value;
  try { value = JSON.parse(output); } catch { throw failure('worker_output_invalid'); }
  const cleanup = value?.cleanup;
  const retention = value?.retention;
  if (!cleanup || !retention || !integer(cleanup.pendingObjects) || !integer(cleanup.retryingObjects)
    || !integer(cleanup.tombstones) || !integer(cleanup.oldestDueSeconds)
    || !integer(retention.dueWorkspaces) || !integer(retention.oldestDueSeconds)
    || !(retention.lastCompletedAt === null || (typeof retention.lastCompletedAt === 'string'
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(retention.lastCompletedAt)
      && Number.isFinite(Date.parse(retention.lastCompletedAt))))) throw failure('worker_output_invalid');
  return { pendingObjects: cleanup.pendingObjects, retryingObjects: cleanup.retryingObjects,
    tombstones: cleanup.tombstones, oldestDueSeconds: cleanup.oldestDueSeconds,
    dueWorkspaces: retention.dueWorkspaces, oldestRetentionSeconds: retention.oldestDueSeconds,
    lastCompletedAt: retention.lastCompletedAt };
}

function parseArchiveStatus(output) {
  let value;
  try { value = JSON.parse(output); } catch { throw failure('worker_output_invalid'); }
  const counters = ['pendingEvents', 'coveredEvents', 'oldestPendingSeconds', 'uncheckpointedEvents',
    'oldestUncheckpointedSeconds', 'retryingEvents', 'activeLeases', 'staleLeases', 'pendingCheckpointAgeSeconds'];
  if (!counters.every(key => integer(value?.[key])) || typeof value?.pendingCheckpoint !== 'boolean'
    || !(value.fenceId === null || typeof value.fenceId === 'string')
    || !(value.checkpointId === null || typeof value.checkpointId === 'string')) throw failure('worker_output_invalid');
  // IDs and hashes prove continuity only to the private verifier. The monitor
  // receives aggregate state and booleans, never source or checkpoint material.
  return { pendingEvents: value.pendingEvents, coveredEvents: value.coveredEvents,
    oldestPendingSeconds: value.oldestPendingSeconds, uncheckpointedEvents: value.uncheckpointedEvents,
    oldestUncheckpointedSeconds: value.oldestUncheckpointedSeconds, retryingEvents: value.retryingEvents,
    activeLeases: value.activeLeases, staleLeases: value.staleLeases,
    pendingCheckpoint: value.pendingCheckpoint, pendingCheckpointAgeSeconds: value.pendingCheckpointAgeSeconds,
    fenced: value.fenceId !== null, checkpointed: value.checkpointId !== null };
}

function requestAction(request) {
  if (typeof request?.url !== 'string' || request.url.endsWith('?')) return null;
  let target;
  try { target = new URL(request.url, 'https://maintenance.invalid'); } catch { return null; }
  if (target.hash) return null;
  const pathAndQuery = `${target.pathname}${target.search}`;
  if (pathAndQuery === '/api/status' || pathAndQuery === '/api/run?likerts_action=status') return 'status';
  return pathAndQuery === '/api/run' ? 'run' : null;
}

function requestHeader(request, name) {
  const headers = request?.headers;
  if (typeof headers?.get === 'function') return headers.get(name);
  return headers?.[name];
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
    const action = requestAction(request);
    const secret = action === 'status' ? environment.LIKERTS_MONITOR_SECRET : environment.CRON_SECRET;
    const credential = action === 'status'
      ? requestHeader(request, 'x-likerts-monitor-secret')
      : requestHeader(request, 'authorization');
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256) return send(503, { ok: false, error: 'configuration_missing' });
    if (action === 'status' && secret === environment.CRON_SECRET) return send(503, { ok: false, error: 'configuration_missing' });
    const expected = action === 'status' ? secret : `Bearer ${secret}`;
    if (typeof credential !== 'string' || credential.length > 1024 || !timingSafeEqual(digest(credential), digest(expected))) return send(401, { ok: false, error: 'unauthorized' });
    if (request.method !== 'GET' || action === null) return send(400, { ok: false, error: 'invalid_request' });
    try {
      const binary = await verify(directory, kind);
      const childEnv = childEnvironment(kind, environment, fileURLToPath(new URL('ca-certificates.crt', directory)), action);
      if (action === 'status') {
        const status = kind === 'archive'
          ? parseArchiveStatus(await execute(binary, ['monitor-status'], childEnv, 30000))
          : parseCleanupStatus(await execute(binary, ['status'], childEnv, 20000));
        return send(200, { ok: true, kind, status });
      }
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
      const allowed = ['credential_boundary_failed', 'configuration_missing', 'bundle_invalid', 'worker_timeout', 'worker_output_limit', 'worker_start_failed', 'worker_failed', 'worker_terminated', 'worker_output_invalid', ...Object.values(archiveFailureCodes)];
      return send(503, { ok: false, error: allowed.includes(error?.safeCode) ? error.safeCode : 'maintenance_failed' });
    }
  };
}
