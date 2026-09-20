import assert from 'node:assert/strict';
import test from 'node:test';
import { collectStatus, components } from '../lib/status.mjs';
import { authorizedMonitor, alertDestination, runMonitor } from '../api/monitor.js';
import { collectMaintenanceStatus } from '../lib/monitor-probe.mjs';
import { MAX_ALERT_ATTEMPTS, MONITOR_STATE_SCHEMA_VERSION, monitorStore, parseState, prepareState, readHeartbeat } from '../lib/monitor-state.mjs';

const healthy = url => Response.json(url.includes('clerk.') ? { keys: [{ kty: 'RSA', n: 'public', e: 'AQAB' }] }
  : url.includes('-mcp.') ? { status: 'ok', service: 'likerts-mcp' } : { status: 'ok', storage: 'postgresql' });
const armed = {
  LIKERTS_MONITOR_ARMED: '1',
  LIKERTS_MONITOR_RESPONDER_ID: 'launch-owner',
  LIKERTS_ALERT_WEBHOOK_URL: 'https://alerts.example.com/hook',
  LIKERTS_ALERT_RECEIVER_ORIGIN: 'https://alerts.example.com',
};
const maintenanceHealthy = async () => [
  { id: 'cleanup', status: 'reachable' }, { id: 'archive', status: 'reachable' },
];
function memoryStore(initial = null) {
  let state = initial;
  let activeLease = null;
  return {
    async acquire() { activeLease = 'lease'; return { lease: activeLease, previous: state }; },
    async save(lease, next) { assert.equal(lease, activeLease); state = parseState(JSON.stringify(next)); },
    async read() { return state; },
  };
}
test('status checks real response contracts with fixed unauthenticated targets', async () => {
  const requested = [];
  const result = await collectStatus({ fetcher: async (url, options) => { requested.push(url); assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit'); return healthy(url); } });
  assert.deepEqual(requested, components.map(c => c.url));
  assert.equal(result.status, 'reachable');
  assert.equal(result.components.length, 3);
});
test('unhealthy, redirect and malformed upstream responses cannot claim health or expose data', async () => {
  for (const bad of [() => new Response('private exception', { status: 500 }), () => new Response('', { status: 302 }), () => Response.json({ status: 'ok', secret: 'private exception' }), () => new Response('x'.repeat(33000))]) {
    const result = await collectStatus({ fetcher: async url => url.includes('-api.') ? bad() : healthy(url) });
    assert.equal(result.status, 'degraded');
    assert.equal(result.components[0].status, 'unavailable');
    assert.equal(JSON.stringify(result).includes('private exception'), false);
  }
});
test('timeout and transport failure remain bounded unavailable results', async () => {
  const result = await collectStatus({ fetcher: async () => { throw new Error('private-url-and-secret'); } });
  assert.equal(result.status, 'degraded');
  assert.equal(result.components.every(c => c.status === 'unavailable'), true);
  assert.equal(JSON.stringify(result).includes('private-url'), false);
});
test('monitor requires a configured long secret and exact bearer value', () => {
  const secret = 'x'.repeat(40);
  assert.equal(authorizedMonitor(`Bearer ${secret}`, secret), true);
  for (const header of ['', `bearer ${secret}`, `Bearer ${'y'.repeat(40)}`]) assert.equal(authorizedMonitor(header, secret), false);
  assert.equal(authorizedMonitor('Bearer short', 'short'), false);
  assert.equal(authorizedMonitor('', undefined), false);
});
test('alert receiver requires explicit exact origin and forbids redirects and raw errors', async () => {
  const environment = { LIKERTS_ALERT_WEBHOOK_URL: 'https://alerts.example.com/private', LIKERTS_ALERT_RECEIVER_ORIGIN: 'https://alerts.example.com' };
  assert.equal(alertDestination(environment), environment.LIKERTS_ALERT_WEBHOOK_URL);
  assert.equal(alertDestination({ ...environment, LIKERTS_ALERT_RECEIVER_ORIGIN: 'https://other.example.com' }), null);
  assert.equal(alertDestination({ ...environment, LIKERTS_ALERT_WEBHOOK_URL: 'http://alerts.example.com/private' }), null);
  const probe = async () => ({ status: 'degraded', checkedAt: new Date().toISOString(), components: [{ id: 'collection', status: 'unavailable', private: 'omit-me' }] });
  const result = await runMonitor({ environment: { ...environment, LIKERTS_MONITOR_ARMED: '1', LIKERTS_MONITOR_RESPONDER_ID: 'launch-owner' }, probe,
    admissionProbe: async () => ({ id: 'admission', status: 'not_configured' }), maintenanceProbe: maintenanceHealthy, store: memoryStore(),
    fetcher: async (_, options) => { assert.equal(options.redirect, 'manual'); assert.equal(options.body.includes('omit-me'), false); return new Response('', { status: 302 }); } });
  assert.equal(result.body.alert, 'delivery_failed');
});
test('monitor distinguishes missing receiver, healthy, receiver acceptance and delivery failure', async () => {
  assert.equal((await runMonitor({ environment: {} })).body.status, 'not_armed');
  const probe = async () => ({ status: 'degraded', checkedAt: new Date().toISOString(), components: [] });
  assert.equal((await runMonitor({ environment: armed, probe, admissionProbe: async () => ({ id: 'admission', status: 'not_configured' }), maintenanceProbe: maintenanceHealthy,
    store: memoryStore(), fetcher: async () => new Response(null, { status: 204 }) })).body.alert, 'receiver_accepted');
  assert.equal((await runMonitor({ environment: armed, probe, admissionProbe: async () => ({ id: 'admission', status: 'not_configured' }), maintenanceProbe: maintenanceHealthy,
    store: memoryStore(), fetcher: async () => { throw new Error('secret'); } })).body.alert, 'delivery_failed');
  assert.equal((await runMonitor({ environment: armed, probe: async () => ({ status: 'reachable', components: [
      { id: 'collection', status: 'reachable' }, { id: 'agents', status: 'reachable' }, { id: 'identity', status: 'reachable' },
    ] }), admissionProbe: async () => ({ id: 'admission', status: 'reachable' }), maintenanceProbe: maintenanceHealthy,
    store: memoryStore(), fetcher: () => assert.fail('must not notify when healthy') })).body.alert, 'not_needed');
});

test('maintenance probes require exact Vercel status targets and classify bounded backlog', async () => {
  const environment = {
    LIKERTS_CLEANUP_STATUS_URL: 'https://likerts-cleanup.vercel.app/api/status', LIKERTS_CLEANUP_STATUS_TOKEN: 'c'.repeat(40),
    LIKERTS_CLEANUP_STATUS_ORIGIN: 'https://likerts-cleanup.vercel.app',
    LIKERTS_ARCHIVE_STATUS_URL: 'https://likerts-erasure-archive.vercel.app/api/status', LIKERTS_ARCHIVE_STATUS_TOKEN: 'a'.repeat(40),
    LIKERTS_ARCHIVE_STATUS_ORIGIN: 'https://likerts-erasure-archive.vercel.app',
  };
  const requested = [];
  const result = await collectMaintenanceStatus({ environment, fetcher: async (url, options) => {
    requested.push(url); assert.match(options.headers.authorization, /^Bearer [ac]{40}$/);
    return url.includes('cleanup') ? Response.json({ ok: true, kind: 'cleanup', status: { pendingObjects: 1,
      retryingObjects: 0, tombstones: 4, oldestDueSeconds: 100, dueWorkspaces: 1,
      oldestRetentionSeconds: 100, lastCompletedAt: null } })
      : Response.json({ ok: true, kind: 'archive', status: { pendingEvents: 1, coveredEvents: 5954,
        oldestPendingSeconds: 1801, uncheckpointedEvents: 0, oldestUncheckpointedSeconds: 0,
        retryingEvents: 0, activeLeases: 0, staleLeases: 0, pendingCheckpoint: false,
        pendingCheckpointAgeSeconds: 0, fenced: false, checkpointed: true } });
  } });
  assert.equal(requested.length, 2);
  assert.deepEqual(result, [{ id: 'cleanup', status: 'reachable' }, { id: 'archive', status: 'backlog' }]);
  assert.deepEqual(await collectMaintenanceStatus({ environment: { LIKERTS_CLEANUP_STATUS_URL: 'http://private/api/status',
    LIKERTS_CLEANUP_STATUS_ORIGIN: 'http://private', LIKERTS_CLEANUP_STATUS_TOKEN: 'x'.repeat(40) } }), [
    { id: 'cleanup', status: 'invalid_configuration' }, { id: 'archive', status: 'not_configured' },
  ]);
});

test('maintenance probes reject cache, wrong origins, credentials and inconsistent checkpoints', async () => {
  const base = {
    LIKERTS_CLEANUP_STATUS_URL: 'https://cleanup.vercel.app/api/status',
    LIKERTS_CLEANUP_STATUS_ORIGIN: 'https://cleanup.vercel.app', LIKERTS_CLEANUP_STATUS_TOKEN: 'c'.repeat(40),
    LIKERTS_ARCHIVE_STATUS_URL: 'https://archive.vercel.app/api/status',
    LIKERTS_ARCHIVE_STATUS_ORIGIN: 'https://archive.vercel.app', LIKERTS_ARCHIVE_STATUS_TOKEN: 'a'.repeat(40),
  };
  const cached = await collectMaintenanceStatus({ environment: base, fetcher: async () => new Response('{}', {
    status: 200, headers: { 'x-vercel-cache': 'HIT' },
  }) });
  assert.equal(cached.every(value => value.status === 'cached_response'), true);
  const denied = await collectMaintenanceStatus({ environment: base, fetcher: async () => new Response('', { status: 401 }) });
  assert.equal(denied.every(value => value.status === 'credential_rejected'), true);
  const inconsistent = await collectMaintenanceStatus({ environment: base, fetcher: async url => url.includes('cleanup')
    ? Response.json({ ok: true, kind: 'cleanup', status: { pendingObjects: 0, retryingObjects: 0, tombstones: 0,
      oldestDueSeconds: 0, dueWorkspaces: 0, oldestRetentionSeconds: 0, lastCompletedAt: null } })
    : Response.json({ ok: true, kind: 'archive', status: { pendingEvents: 0, coveredEvents: 1,
      oldestPendingSeconds: 0, uncheckpointedEvents: 0, oldestUncheckpointedSeconds: 0,
      retryingEvents: 0, activeLeases: 0, staleLeases: 0, pendingCheckpoint: false,
      pendingCheckpointAgeSeconds: 0, fenced: false, checkpointed: false } }) });
  assert.deepEqual(inconsistent, [{ id: 'cleanup', status: 'reachable' }, { id: 'archive', status: 'invalid_response' }]);
  assert.equal((await collectMaintenanceStatus({ environment: {
    LIKERTS_ARCHIVE_STATUS_URL: base.LIKERTS_ARCHIVE_STATUS_URL,
    LIKERTS_ARCHIVE_STATUS_TOKEN: base.LIKERTS_ARCHIVE_STATUS_TOKEN,
    LIKERTS_ARCHIVE_STATUS_ORIGIN: 'https://preview.vercel.app',
  } }))[1].status, 'invalid_configuration');
});

test('monitor degrades when maintenance coverage is absent', async () => {
  const result = await runMonitor({ environment: armed, probe: async () => ({ components: [
    { id: 'collection', status: 'reachable' }, { id: 'agents', status: 'reachable' }, { id: 'identity', status: 'reachable' },
  ] }), admissionProbe: async () => ({ id: 'admission', status: 'not_configured' }),
  maintenanceProbe: async () => [{ id: 'cleanup', status: 'not_configured' }, { id: 'archive', status: 'not_configured' }],
  store: memoryStore(), fetcher: async () => new Response(null, { status: 204 }) });
  assert.equal(result.body.status, 'degraded');
  assert.equal(result.body.coverage, 'reachability_only');
  assert.deepEqual(result.body.maintenance, [{ id: 'cleanup', status: 'not_configured' }, { id: 'archive', status: 'not_configured' }]);
});

test('six-component monitor state keeps stable incidents and emits one recovery', () => {
  const components = [
    { id: 'collection', status: 'unavailable' }, { id: 'agents', status: 'reachable' },
    { id: 'identity', status: 'reachable' }, { id: 'admission', status: 'reachable' },
    { id: 'cleanup', status: 'reachable' }, { id: 'archive', status: 'reachable' },
  ];
  const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003'];
  const uuid = () => ids.shift();
  const degraded = prepareState(null, 'degraded', components, 'admission_and_maintenance_db', 1_000, uuid);
  const incident = degraded.incidentId;
  const event = degraded.notification.eventId;
  degraded.notification.accepted = true;
  const repeated = prepareState(degraded, 'degraded', components, 'admission_and_maintenance_db', 2_000, uuid);
  assert.equal(repeated.incidentId, incident); assert.equal(repeated.notification.eventId, event);
  const recovered = prepareState(repeated, 'reachable', components.map(value => ({ ...value, status: 'reachable' })), 'admission_and_maintenance_db', 3_000, uuid);
  assert.equal(recovered.notification.event, 'dependency_recovered');
  assert.equal(recovered.notification.incidentId, incident);
  assert.doesNotThrow(() => parseState(JSON.stringify(recovered)));
  assert.throws(() => parseState(JSON.stringify({ ...recovered, coverage: 'invented' })), /monitor_state_unavailable/);
});

test('heartbeat distinguishes missing, pending, degraded, current and future state', async () => {
  assert.equal((await readHeartbeat({ store: { read: async () => null }, now: () => 1_000 })).body.status, 'missing_signal');
  const base = { version: MONITOR_STATE_SCHEMA_VERSION, completedAt: 1_000, health: 'reachable', coverage: 'admission_and_maintenance_db', incidentId: null, notification: null };
  assert.equal((await readHeartbeat({ store: { read: async () => base }, now: () => 2_000 })).body.status, 'current');
  assert.equal((await readHeartbeat({ store: { read: async () => ({ ...base, health: 'degraded' }) }, now: () => 2_000 })).body.status, 'degraded');
  const pending = prepareState(base, 'degraded', [{ id: 'collection', status: 'unavailable' }], 'admission_and_maintenance_db', 1_500,
    () => '10000000-0000-4000-8000-000000000010');
  pending.completedAt = 1_500;
  assert.equal((await readHeartbeat({ store: { read: async () => pending }, now: () => 2_000 })).body.status, 'alert_delivery_pending');
  assert.equal((await readHeartbeat({ store: { read: async () => ({ ...base, completedAt: 70_001 }) }, now: () => 1_000 })).body.status, 'state_unavailable');
});

test('a changed degraded component set emits a new event in the same incident', () => {
  const ids = ['10000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000021',
    '10000000-0000-4000-8000-000000000022'];
  const firstComponents = [{ id: 'collection', status: 'unavailable' }, { id: 'archive', status: 'reachable' }];
  const first = prepareState(null, 'degraded', firstComponents, 'admission_and_maintenance_db', 1_000, () => ids.shift());
  first.notification.accepted = true;
  const changed = prepareState(first, 'degraded', [{ id: 'collection', status: 'reachable' },
    { id: 'archive', status: 'backlog' }], 'admission_and_maintenance_db', 2_000, () => ids.shift());
  assert.equal(changed.incidentId, first.incidentId);
  assert.notEqual(changed.notification.eventId, first.notification.eventId);
  assert.equal(changed.notification.accepted, false);
  assert.deepEqual(changed.notification.components, [{ id: 'collection', status: 'reachable' }, { id: 'archive', status: 'backlog' }]);
});

test('v2 Redis keys isolate expanded state from v1 rollback readers', async () => {
  const keys = [];
  const store = monitorStore({ environment: {
    LIKERTS_MONITOR_STATE_REDIS_URL: 'https://fixture.upstash.io',
    LIKERTS_MONITOR_STATE_REDIS_TOKEN: 't'.repeat(32), LIKERTS_MONITOR_STATE_NAMESPACE: 'a'.repeat(32),
  }, fetcher: async (_, options) => {
    const command = JSON.parse(options.body); keys.push(...command.slice(3, 5));
    return Response.json({ result: [1, ''] });
  } });
  await store.acquire();
  assert.equal(keys.length, 2);
  assert.equal(keys.every(key => key.includes(':v2:')), true);
  assert.throws(() => parseState(JSON.stringify({ version: 1, completedAt: 0, health: 'reachable',
    coverage: 'admission', incidentId: null, notification: null })), /monitor_state_unavailable/);
});

test('alert attempts are durable and stop after the fixed retry budget', async () => {
  const store = memoryStore();
  const degraded = async () => ({ components: [
    { id: 'collection', status: 'unavailable' }, { id: 'agents', status: 'reachable' }, { id: 'identity', status: 'reachable' },
  ] });
  for (let attempt = 0; attempt < MAX_ALERT_ATTEMPTS; attempt++) {
    const result = await runMonitor({ environment: armed, probe: degraded,
      admissionProbe: async () => ({ id: 'admission', status: 'reachable' }), maintenanceProbe: maintenanceHealthy,
      store, fetcher: async () => { throw new Error('ambiguous receiver failure'); } });
    assert.equal(result.body.alert, 'delivery_failed');
  }
  const exhausted = await runMonitor({ environment: armed, probe: degraded,
    admissionProbe: async () => ({ id: 'admission', status: 'reachable' }), maintenanceProbe: maintenanceHealthy,
    store, fetcher: () => assert.fail('must not send beyond retry budget') });
  assert.equal(exhausted.body.alert, 'retry_exhausted');
});
