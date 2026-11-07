import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLiveServer, PRODUCTION_LIMITS, readServiceConfiguration } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const production = { NODE_ENV: 'production', LIKERTS_LIVE_DATABASE_URL: 'postgresql://fixture.invalid/live', LIKERTS_LIVE_PUBLIC_ORIGIN: 'https://game.example.invalid', LIKERTS_LIVE_ORIGINS: 'https://game.example.invalid' };
const admission = () => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url') });

test('Production startup uses conservative explicit ceilings without borrowing survey configuration', () => {
  const value = readServiceConfiguration(production);
  assert.deepEqual(value.limits, PRODUCTION_LIMITS);
  assert.equal(value.limits.maxRooms, 4); assert.equal(value.limits.maxPlayers, 12);
  assert.equal(value.limits.maxSockets, 64); assert.equal(value.limits.maxSocketsPerRoom, 26); assert.equal(value.limits.maxSocketsPerMember, 2);
  assert.throws(() => readServiceConfiguration({ ...production, LIKERTS_LIVE_DATABASE_URL: '', DATABASE_URL: 'postgresql://survey.invalid/private' }), /dedicated persistent/);
  assert.throws(() => readServiceConfiguration({ ...production, LIKERTS_LIVE_ORIGINS: '' }), /HTTPS public/);
  const local = readServiceConfiguration({ LIKERTS_LIVE_SQLITE_PATH: '/tmp/synthetic-live-config.sqlite' });
  assert.equal(local.limits.maxPlayers, 50, 'The reviewed engine ceiling remains available only in development');
  assert.equal(local.host, '127.0.0.1');
});

test('Invalid, fractional, inconsistent and untested production caps fail before a service starts', () => {
  for (const [name, value] of [
    ['MAX_ROOMS', '5'], ['MAX_PLAYERS', '13'], ['MAX_PLAYERS', '8'], ['MAX_PLAYERS', '1'], ['MAX_SOCKETS', '65'],
    ['MAX_SOCKETS_PER_ROOM', '27'], ['MAX_SOCKETS_PER_MEMBER', '3'], ['MAX_ROOMS', '0'],
    ['MAX_ROOMS', '1.5'], ['MAX_ROOMS', '1e3'], ['MAX_ROOMS', '-1'], ['MAX_ROOMS', 'four'],
    ['READINESS_INTERVAL_MS', '1'], ['READINESS_MAX_AGE_MS', '1000'], ['MAX_BODY_BYTES', '1'], ['MAX_FRAME_BYTES', '1'], ['MAX_BUFFERED_BYTES', '1'],
  ]) assert.throws(() => readServiceConfiguration({ ...production, [`LIKERTS_LIVE_${name}`]: value }), name);
  assert.throws(() => readServiceConfiguration({ ...production, LIKERTS_LIVE_MAX_SOCKETS_PER_ROOM: '12' }), /dedicated host/);
  assert.throws(() => readServiceConfiguration({ ...production, LIKERTS_LIVE_MAX_SOCKETS: '16' }), /Socket ceilings/);
  const lower = readServiceConfiguration({ ...production, LIKERTS_LIVE_MAX_ROOMS: '2' });
  assert.equal(lower.limits.maxPlayers, 12); assert.equal(lower.limits.maxRooms, 2);
  assert.throws(() => readServiceConfiguration({ LIKERTS_LIVE_SQLITE_PATH: '/tmp/synthetic.sqlite', PORT: '4311suffix' }), /port/);
});

test('Production factory cannot bypass launch ceilings through a programmatic override', async () => {
  const store = { kind: 'postgres', transact() {}, admit() {}, consumeBudget() {}, count() { throw new Error('Must not query'); } };
  await assert.rejects(createLiveServer({ store, catalogue, production: true, origins: [production.LIKERTS_LIVE_PUBLIC_ORIGIN], publicOrigin: production.LIKERTS_LIVE_PUBLIC_ORIGIN, limits: { maxPlayers: 50 } }), /resource limit/);
});

async function fixture(t, limits = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-live-health-'));
  let clock = Date.now(), fail = false, held = null, counts = 0, budgets = 0;
  const store = await openStore({ sqlitePath: join(directory, 'rooms.sqlite'), databaseURL: '', production: false, now: () => clock });
  const actualCount = store.count.bind(store), actualBudget = store.consumeBudget.bind(store);
  store.count = async () => { counts++; if (held) return await held; if (fail) throw new Error('PRIVATE_READINESS_FIXTURE'); return actualCount(); };
  store.consumeBudget = async options => { budgets++; return actualBudget(options); };
  const app = await createLiveServer({ store, catalogue, now: () => clock, limits: { readinessIntervalMs: 300_000, readinessMaxAgeMs: 600_000, ...limits } });
  const { origin } = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await app.close(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, body) => {
    const response = await fetch(origin + '/api/live' + path, { method: body ? 'POST' : 'GET', headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  return { app, request, get counts() { return counts; }, get budgets() { return budgets; }, advance(ms) { clock += ms; }, fail(value) { fail = value; }, hold(promise) { held = promise; } };
}

test('Anonymous health and liveness bursts issue zero per-request database queries or shared-budget writes', async t => {
  const f = await fixture(t);
  assert.equal(f.counts, 1, 'Readiness checks once before serving');
  const responses = await Promise.all(Array.from({ length: 64 }, (_, index) => f.request(index % 2 ? '/health' : '/liveness')));
  assert.ok(responses.every(result => result.status === 200));
  assert.equal(f.counts, 1, 'A health request burst must not amplify into SQL');
  assert.equal(f.budgets, 0, 'Caching must not be defeated by a database-backed health rate limiter');
});

test('Stale or failed readiness returns 503 while pure liveness remains independent, then readiness recovers', async t => {
  const f = await fixture(t);
  f.advance(600_001);
  assert.equal((await f.request('/health')).status, 503); assert.equal(f.counts, 1);
  assert.equal((await f.request('/liveness')).status, 200);
  f.fail(true); await f.app.probeReadiness();
  const failed = await f.request('/health');
  assert.equal(failed.status, 503); assert.equal(failed.body.rooms, null);
  assert.equal(JSON.stringify(failed).includes('PRIVATE_READINESS_FIXTURE'), false);
  f.fail(false); await f.app.probeReadiness();
  assert.equal((await f.request('/health')).status, 200); assert.equal(f.counts, 3);
});

test('Concurrent readiness refreshes share one in-flight aggregate probe', async t => {
  const f = await fixture(t);
  let release;
  f.hold(new Promise(resolve => { release = resolve; }));
  const first = f.app.probeReadiness(), second = f.app.probeReadiness();
  try {
    assert.equal(first, second); assert.equal(f.counts, 2);
    assert.equal((await f.request('/health')).status, 200, 'A fresh cached result is usable during one pending refresh');
  } finally { release(0); await first; f.hold(null); }
  assert.equal((await f.request('/health')).status, 200);
});

test('Cached health has a local request ceiling without database amplification', async t => {
  const f = await fixture(t, { healthPerMinute: 2 });
  assert.equal((await f.request('/health')).status, 200);
  assert.equal((await f.request('/liveness')).status, 200);
  assert.equal((await f.request('/health')).status, 429);
  assert.equal(f.counts, 1); assert.equal(f.budgets, 0);
});

test('Actual capacity metadata clamps the default and rejects oversized admissions without changing the engine ceiling', async t => {
  const f = await fixture(t, { maxPlayers: 4 });
  const metadata = await f.request('/catalogue'); assert.deepEqual(metadata.body.limits, { maxPlayers: 4, defaultCapacity: 4 });
  const denied = await f.request('/rooms', { ...admission(), settings: { capacity: 5 } });
  assert.equal(denied.status, 400); assert.equal(denied.body.error.code, 'capacity_unavailable');
  const accepted = await f.request('/rooms', { ...admission(), settings: {} });
  assert.equal(accepted.status, 201); assert.equal(accepted.body.state.settings.capacity, 4);
  for (const settings of [null, [], 'invalid']) assert.equal((await f.request('/rooms', { ...admission(), settings })).status, 400);
});
