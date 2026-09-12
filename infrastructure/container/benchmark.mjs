import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

const [base, db, apiContainer, output] = process.argv.slice(2);
assert.ok(base && db && apiContainer && output, 'requires API URL, database/API container names and output path');
const token = 'likerts-container-smoke-service-token-v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (program, args) => execFileSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const sql = statement => command('docker', ['exec', db, 'psql', '--username', 'postgres', '--dbname', 'likerts', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', statement]);
const query = async (path, { credential = token, method = 'GET', body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, bytes: Buffer.byteLength(text), json };
};
const checked = async (path, options, status = 200) => {
  const result = await query(path, options);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.json)}`);
  return result.json;
};
const percentile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)] : 0;
const round = n => Math.round(n * 1000) / 1000;
const stats = () => command('docker', ['stats', '--no-stream', '--format', '{{json .}}', apiContainer, db]).split('\n').map(JSON.parse).map(({ Name, CPUPerc, MemUsage, MemPerc, NetIO, BlockIO, PIDs }) => ({ component: Name === apiContainer ? 'api' : 'postgres', cpuPercent: CPUPerc, memory: MemUsage, memoryPercent: MemPerc, network: NetIO, blockIo: BlockIO, pids: PIDs }));
const storage = () => JSON.parse(sql(`select json_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'responseRows',(select count(*) from likerts.responses),
  'usageRows',(select count(*) from likerts.usage_entries),
  'tenantRelationBytes',(select coalesce(sum(pg_total_relation_size(c.oid)),0) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='likerts' and c.relkind='r'),
  'responseRelationBytes',pg_total_relation_size('likerts.responses'),
  'usageRelationBytes',pg_total_relation_size('likerts.usage_entries'),
  'walLsn',pg_current_wal_lsn()::text
)`));
const details = JSON.parse(command('docker', ['inspect', apiContainer]))[0];
const dockerHost = JSON.parse(command('docker', ['info', '--format', '{{json .}}']));
const report = {
  measuredAt: new Date().toISOString(),
  environment: {
    imageId: details.Image, architecture: command('docker', ['image', 'inspect', details.Image, '--format', '{{.Architecture}}']),
    dockerCpuCount: dockerHost.NCPU, dockerMemoryBytes: dockerHost.MemTotal,
    apiCpuLimit: details.HostConfig.NanoCpus / 1e9, apiMemoryLimitBytes: details.HostConfig.Memory,
    postgresVersion: sql('show server_version'),
    postgresSettings: JSON.parse(sql("select json_build_object('fsync',current_setting('fsync'),'synchronousCommit',current_setting('synchronous_commit'),'fullPageWrites',current_setting('full_page_writes'))")),
    client: `Node ${process.version}, host → loopback Docker port`,
  },
  limitations: [
    'Local single API and PostgreSQL containers share one Docker VM; this is not an AWS latency, RDS, Multi-AZ, failover or SLA measurement.',
    'Client runs on the host; host scheduling, Docker networking and concurrent host activity affect results.',
    'Exports use the local object store and JSON/base64 download path, not S3.',
    'Short runs do not establish sustained RDS CPU-credit behavior, vacuum equilibrium or long-term capacity.',
    'Docker resource readings are snapshots, not peak usage or per-request CPU allocation.',
  ], phases: [], exports: [],
};

const capabilities = { installations: [{ target: 'web', sdkVersion: '0.0.1', schemaVersions: [1, 2] }] };
const fixture = {
  idempotencyKey: 'benchmark-survey-v1', title: 'Representative embedded checkout feedback',
  questions: [
    { id: 'nps', label: 'Recommend us', type: 'scale', min: 0, max: 10, preset: 'nps', required: true },
    { id: 'return', label: 'Return?', type: 'single_choice', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], required: true },
    { id: 'improvements', label: 'Improve', type: 'multiple_choice', options: ['speed','service','price','quality'].map(id => ({ id, label: id })), maxSelections: 3 },
    { id: 'comment', label: 'Comment', type: 'text', maxLength: 1024 },
    { id: 'amount', label: 'Amount', type: 'number' },
    { id: 'date', label: 'Date', type: 'date' },
  ],
};
const survey = await checked('/v1/surveys', { method: 'POST', body: fixture }, 201);
const version = await checked(`/v1/surveys/${survey.id}/publish`, { method: 'POST', body: { revision: 1, sdkCapabilities: capabilities } });
const makeCollection = async (key, cap) => checked('/v1/collections', { method: 'POST', body: {
  idempotencyKey: key, surveyId: survey.id, version: version.version, placement: key,
  sdkCapabilities: capabilities, ...(cap === undefined ? {} : { responseCap: cap }),
} }, 201);
const collection = await makeCollection('benchmark-main');
const pseudorandom = (key, bytes) => Array.from({ length: Math.ceil(bytes / 64) }, (_, index) => createHash('sha256').update(`${key}:${index}`).digest('hex')).join('').slice(0, bytes);
const submission = key => ({ idempotencyKey: key, answers: {
  nps: 8, return: 'yes', improvements: ['speed','service'], comment: pseudorandom(key, 512), amount: 23.75, date: '2026-09-08',
}, metadata: { store: 'store-001', session: pseudorandom(key, 128), version: 'benchmark-v1' } });
const bodyBytes = Buffer.byteLength(JSON.stringify(submission('representative-000000')));
report.fixture = { questionCount: fixture.questions.length, submissionJsonBytes: bodyBytes, commentCharacters: 512, sessionCharacters: 128 };
const before = storage();
report.before = before;
report.idleResourceSnapshot = stats();

async function phase(name, count, concurrency, request, pace = 0) {
  const started = performance.now();
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      const scheduled = started + (pace ? index * 1000 / pace : 0);
      if (pace) await sleep(Math.max(0, scheduled - performance.now()));
      const requestStart = performance.now();
      try {
        const result = await request(index);
        results.push({ status: result.status, latency: performance.now() - requestStart, scheduledLatency: performance.now() - scheduled, bytes: result.bytes });
      } catch (error) {
        results.push({ status: 'transport_error', latency: performance.now() - requestStart, scheduledLatency: performance.now() - scheduled, bytes: 0, error: error.name });
      }
    }
  }));
  const seconds = (performance.now() - started) / 1000;
  const statuses = {};
  for (const result of results) statuses[result.status] = (statuses[result.status] ?? 0) + 1;
  const summary = {
    name, requests: count, concurrency, targetRequestsPerSecond: pace || null, seconds: round(seconds),
    requestsPerSecond: round(count / seconds), statuses,
    latencyMs: Object.fromEntries([['p50',.5],['p95',.95],['p99',.99]].map(([name,q]) => [name,round(percentile(results.map(r => r.latency),q))])),
    ...(pace ? { scheduledLatencyP95Ms: round(percentile(results.map(r => r.scheduledLatency),.95)) } : {}),
    responseBytes: results.reduce((sum,r) => sum + r.bytes,0), resourcesAfter: stats(),
  };
  report.phases.push(summary);
  console.log(`${name}: ${summary.requestsPerSecond} req/s, p95 ${summary.latencyMs.p95} ms, ${JSON.stringify(statuses)}`);
  return summary;
}
const submit = (key, options = {}) => query(`/v1/collections/${collection.id}/responses`, { method: 'POST', credential: collection.token, body: submission(key), ...options });
const paced = await phase('paced-valid-100-rps', 3000, 100, index => submit(`paced-${index}`), 100);
const burst = await phase('burst-valid', 1000, 100, index => submit(`burst-${index}`));
const duplicates = await phase('identical-retries', 500, 100, () => submit('same-retry-key'));
const validBeforeAbuse = await checked('/v1/usage');
const afterValid = storage();
report.afterValid = afterValid;
await phase('invalid-answer', 1000, 100, index => submit(`invalid-${index}`, { body: { ...submission(`invalid-${index}`), answers: { nps: 999 } } }));
await phase('unauthorized-token', 1000, 100, index => submit(`unauthorized-${index}`, { credential: 'invalid-collection-token' }));
await phase('oversized-body', 200, 25, index => submit(`oversize-${index}`, { body: { ...submission(`oversize-${index}`), metadata: { oversized: 'x'.repeat(70 * 1024) } } }));
const afterAbuse = await checked('/v1/usage');
assert.deepEqual(afterAbuse, validBeforeAbuse, 'invalid/unauthorized/oversized requests changed usage');
report.afterAbuse = storage();
const capped = await makeCollection('benchmark-capped', 25);
const cap = await phase('response-cap-race', 200, 100, index => query(`/v1/collections/${capped.id}/responses`, {
  method: 'POST', credential: capped.token, body: submission(`cap-${index}`),
}));
const afterAcceptance = storage();
report.afterAcceptance = afterAcceptance;
const usage = await checked('/v1/usage');
const accepted = Number(afterAcceptance.responseRows) - Number(before.responseRows);
assert.equal(usage.acceptedResponses, accepted);
assert.equal(usage.monthAcceptedResponses, accepted);
assert.equal(afterAcceptance.usageRows - before.usageRows, accepted);
assert.equal(cap.statuses[200], 25, 'cap did not accept exactly 25');
assert.equal(cap.statuses[409], 175, 'cap did not reject remaining requests');
assert.equal(duplicates.statuses[200], 500, 'retry receipt behavior changed');
assert.equal(accepted, (paced.statuses[200] ?? 0) + (burst.statuses[200] ?? 0) + 1 + 25);
assert.equal(report.phases.reduce((sum,p) => sum + (p.statuses.transport_error ?? 0) + Object.entries(p.statuses).filter(([s]) => Number(s) >= 500).reduce((n,[,c]) => n+c,0),0), 0, 'transport or server errors occurred');
report.accounting = { acceptedResponses: accepted, monthAcceptedResponses: usage.monthAcceptedResponses, abuseChangedUsage: false };
report.storage = {
  relationGrowthBytes: afterAcceptance.tenantRelationBytes - before.tenantRelationBytes,
  physicalRelationBytesPerAcceptedResponse: round((afterAcceptance.tenantRelationBytes - before.tenantRelationBytes) / accepted),
  responseRelationBytesPerAcceptedResponse: round((afterAcceptance.responseRelationBytes - before.responseRelationBytes) / accepted),
  validOnlyRelationBytesPerAcceptedResponse: round((afterValid.tenantRelationBytes - before.tenantRelationBytes) / (afterValid.responseRows - before.responseRows)),
  abuseRelationGrowthBytes: report.afterAbuse.tenantRelationBytes - afterValid.tenantRelationBytes,
  walGrowthBytes: Number(sql(`select pg_wal_lsn_diff('${afterAcceptance.walLsn}'::pg_lsn,'${before.walLsn}'::pg_lsn)`)),
};
for (const format of ['csv','json']) {
  const started = performance.now();
  const job = await checked('/v1/exports', { method: 'POST', body: { idempotencyKey: `benchmark-export-${format}`, format } }, 202);
  let current;
  for (let i = 0; i < 600; i++) {
    current = await checked(`/v1/exports/${job.id}`);
    if (current.status === 'ready' || current.status === 'failed') break;
    await sleep(100);
  }
  assert.equal(current.status, 'ready', JSON.stringify(current));
  assert.equal(current.responseCount, accepted);
  const readyMs = performance.now() - started;
  const downloadStart = performance.now();
  const download = await query(`/v1/exports/${job.id}/download`);
  assert.equal(download.status, 200);
  const decoded = Buffer.from(download.json.contentBase64, 'base64');
  assert.equal(createHash('sha256').update(decoded).digest('hex'), download.json.contentSha256);
  report.exports.push({ format, responses: accepted, readyMs: round(readyMs), downloadMs: round(performance.now() - downloadStart), objectBytes: decoded.length, wireBytes: download.bytes, resourcesAfter: stats() });
  console.log(`${format} export: ${decoded.length} object bytes, ${round(readyMs)} ms ready`);
}
report.afterExports = storage();
report.abuse = {
  rejectedRequests: report.phases.filter(p => ['invalid-answer','unauthorized-token','oversized-body'].includes(p.name)).reduce((n,p) => n+p.requests,0),
  rateLimitedRequests: report.phases.reduce((n,p) => n+(p.statuses[429] ?? 0),0),
  note: 'Rejected requests consumed CPU/database/network work but created no usage. Absence of 429 is not abuse protection; rate-limit and hosted-edge controls need separate verification.',
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report,null,2)}\n`);
console.log(`Saved measured evidence to ${output}`);
