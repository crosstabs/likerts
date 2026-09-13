import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { receive, events, loadConfig, verifyEvent, STORE_SCRIPT, MAX_RECORDS, TTL_SECONDS, FIRST_RECEIPT_HOLD_MS, boundedBytes } from '../lib/receiver.mjs';

const keyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const signingSecret = 'whsec_synthetic_test_secret_not_a_real_key';
const nowMs = Date.parse('2026-09-10T14:00:00Z');
const env = {
  LIKERTS_ACCEPTANCE_NAMESPACE: 'c076c5bc1ab1809c2c353c116a467c3434cc87c98c8dfc35',
  LIKERTS_ACCEPTANCE_ADMIN_TOKEN: 'synthetic_private_admin_token_for_local_tests',
  LIKERTS_ACCEPTANCE_SIGNING_KEYS_JSON: JSON.stringify({ [keyId]: signingSecret }),
  KV_REST_API_URL: 'https://synthetic-test.upstash.io', KV_REST_API_TOKEN: 'synthetic_local_redis_token',
};
const payload = () => ({ id: randomUUID(), type: 'response.accepted', eventVersion: 1,
  createdAt: '2026-09-10T14:00:00Z', data: { responseId: randomUUID(), collectionId: randomUUID(), surveyId: randomUUID(), surveyVersion: 1 } });

function signed(body = payload(), options = {}) {
  const raw = options.raw ?? Buffer.from(JSON.stringify(body));
  const timestamp = String(options.timestamp ?? Math.floor(nowMs / 1000));
  const eventId = options.eventId ?? body.id;
  const headers = new Headers({ 'content-type': 'application/json', 'likerts-event-id': eventId,
    'likerts-delivery-id': randomUUID(), 'likerts-attempt-id': randomUUID(),
    'likerts-signature': `t=${timestamp},kid=${options.keyId ?? keyId},v1=${createHmac('sha256', options.secret ?? signingSecret).update(`${timestamp}.${eventId}.`).update(raw).digest('hex')}` });
  return { raw, headers, request: new Request('https://receiver.example/api/receive', { method: 'POST', headers, body: raw }) };
}
const dependencies = fetcher => ({ env, now: () => nowMs, fetcher });
const adminRequest = token => new Request('https://receiver.example/api/events', { headers: token === undefined ? {} : { authorization: token } });

test('config fails closed; empty signing map is safe for initial empty receipt check', () => {
  const config = loadConfig(env);
  assert.match(config.redisKey, /^likerts:acceptance:[a-f0-9]+:events$/);
  assert.deepEqual(loadConfig({ ...env, LIKERTS_ACCEPTANCE_SIGNING_KEYS_JSON: '{}' }).keys, {});
  for (const change of [
    { LIKERTS_ACCEPTANCE_NAMESPACE: '' }, { LIKERTS_ACCEPTANCE_NAMESPACE: '../shared' },
    { LIKERTS_ACCEPTANCE_ADMIN_TOKEN: 'short' }, { LIKERTS_ACCEPTANCE_SIGNING_KEYS_JSON: '{' },
    { LIKERTS_ACCEPTANCE_SIGNING_KEYS_JSON: JSON.stringify({ bad: signingSecret }) },
    { KV_REST_API_URL: 'https://user:pass@synthetic-test.upstash.io' },
    { KV_REST_API_URL: 'http://synthetic-test.upstash.io' },
    { KV_REST_API_URL: 'https://synthetic-test.upstash.io/unexpected' },
    { KV_REST_API_URL: 'https://untrusted.example' }, { KV_REST_API_TOKEN: '' },
  ]) assert.throws(() => loadConfig({ ...env, ...change }), /receiver_not_configured/);
});

test('raw-byte signatures, skew boundary and header/body IDs are enforced before decoding', () => {
  const sample = signed();
  assert.equal(verifyEvent(sample.raw, sample.headers, loadConfig(env).keys, nowMs).signatureVerified, true);
  assert.throws(() => verifyEvent(Buffer.concat([sample.raw, Buffer.from(' ')]), sample.headers, loadConfig(env).keys, nowMs), /invalid_signature/);
  for (const delta of [-301, 301]) {
    const stale = signed(payload(), { timestamp: Math.floor(nowMs/1000) + delta });
    assert.throws(() => verifyEvent(stale.raw, stale.headers, loadConfig(env).keys, nowMs), /invalid_signature/);
  }
  for (const delta of [-300, 300]) {
    const edge = signed(payload(), { timestamp: Math.floor(nowMs/1000) + delta });
    assert.equal(verifyEvent(edge.raw, edge.headers, loadConfig(env).keys, nowMs).signatureVerified, true);
  }
  for (const sample of [signed(payload(), { keyId: randomUUID() }), signed(payload(), { secret: 'whsec_wrong' }),
    signed(payload(), { eventId: randomUUID() }), signed(payload(), { raw: Buffer.from('{bad JSON') })]) {
    assert.throws(() => verifyEvent(sample.raw, sample.headers, loadConfig(env).keys, nowMs));
  }
  sample.headers.set('likerts-signature', `${sample.headers.get('likerts-signature')},t=1`);
  assert.throws(() => verifyEvent(sample.raw, sample.headers, loadConfig(env).keys, nowMs), /invalid_signature/);
});

test('only exact current response event schema is accepted, and rejection performs no storage access', async () => {
  const wrong = [
    { ...payload(), type: 'credits.threshold_reached' }, { ...payload(), eventVersion: 2 },
    { ...payload(), answers: { rating: 5 } }, { ...payload(), createdAt: 'bad' },
    ...[{ surveyVersion: 0 }, { surveyVersion: '1' }, { surveyVersion: 1.5 }, { surveyVersion: 2147483648 }, { responseId: 'bad' }, { collectionId: 'bad' }, { surveyId: 'bad' }, { answers: 'private' }, { workspaceId: 'private' }]
      .map(change => { const body = payload(); return { ...body, data: { ...body.data, ...change } }; }),
  ];
  for (const body of wrong) {
    const result = await receive(signed(body).request, dependencies(() => assert.fail('invalid event reached storage')));
    assert.equal(result.status, 400);
  }
});

test('real PostgreSQL JSON timestamptz offsets and fractional seconds are accepted', () => {
  for (const createdAt of ['2026-09-10T14:00:00+00:00', '2026-09-10T14:00:00.123456+00:00', '2026-09-10T22:00:00.123456+08:00']) {
    const sample = signed({ ...payload(), createdAt });
    assert.equal(verifyEvent(sample.raw, sample.headers, loadConfig(env).keys, nowMs).signatureVerified, true);
  }
  for (const createdAt of ['2026-09-10T14:00:00', '2026-09-10T14:00:00+24:00', '2026-09-10T14:00:00+00:60']) {
    const sample = signed({ ...payload(), createdAt });
    assert.throws(() => verifyEvent(sample.raw, sample.headers, loadConfig(env).keys, nowMs), /invalid_event/);
  }
});

test('only redacted verified receipt is persisted with atomic bounded dedupe, never payload, workspace or secrets', async () => {
  const body = payload(), sample = signed(body); let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, env.KV_REST_API_URL); assert.equal(options.redirect, 'manual');
    assert.equal(options.signal.aborted, false);
    const command = JSON.parse(options.body);
    assert.equal(command[0], 'EVAL'); assert.equal(command[1], STORE_SCRIPT);
    assert.equal(command[2], 1); assert.equal(command[4], body.id);
    assert.equal(command[6], MAX_RECORDS); assert.equal(command[7], TTL_SECONDS);
    const stored = JSON.parse(command[5]);
    assert.deepEqual(Object.keys(stored), ['eventId', 'deliveryId', 'attemptId', 'eventType', 'signatureVerified', 'responseId', 'collectionId', 'surveyId', 'surveyVersion']);
    assert.equal(stored.surveyVersion, 1);
    assert.equal(stored.responseId, body.data.responseId);
    assert.equal(options.body.includes(signingSecret), false);
    assert.equal(options.body.includes(env.LIKERTS_ACCEPTANCE_ADMIN_TOKEN), false);
    return Response.json({ result: [calls === 1 ? 1 : 0, 1] });
  };
  const first = await receive(sample.request, dependencies(fetcher));
  assert.equal(first.status, 204); assert.equal(await first.text(), '');
  const repeated = signed(body);
  const duplicate = await receive(repeated.request, dependencies(fetcher));
  assert.equal(duplicate.status, 204); assert.equal(await duplicate.text(), '');
});

test('GET authenticates before storage and returns only distinct validated records without metadata leakage', async () => {
  for (const token of [undefined, '', 'Bearer short', 'bearer ' + env.LIKERTS_ACCEPTANCE_ADMIN_TOKEN, 'Bearer wrong-token']) {
    const response = await events(adminRequest(token), dependencies(() => assert.fail('unauthorized storage access')));
    assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const fetcher = async (_, options) => {
    assert.deepEqual(JSON.parse(options.body), ['HVALS', loadConfig(env).redisKey]);
    return Response.json({ result: [] });
  };
  const authorized = () => adminRequest(`Bearer ${env.LIKERTS_ACCEPTANCE_ADMIN_TOKEN}`);
  assert.deepEqual(await (await events(authorized(), dependencies(fetcher))).json(), { events: [], receivedCount: 0 });
  const sample = signed(), record = verifyEvent(sample.raw, sample.headers, loadConfig(env).keys, nowMs);
  assert.deepEqual(await (await events(authorized(), dependencies(async () => Response.json({ result: [JSON.stringify(record)] })))).json(), { events: [record], receivedCount: 1 });
  const corrupt = await events(authorized(), dependencies(async () => Response.json({ result: [JSON.stringify({ ...record, answers: 'must not leak' })] })));
  assert.equal(corrupt.status, 503); assert.equal((await corrupt.text()).includes('must not leak'), false);
});

test('capacity, malformed storage, redirects and transport failures never acknowledge a new receipt', async () => {
  const failures = [
    async () => Response.json({ result: [-1, MAX_RECORDS] }),
    async () => Response.json({ error: 'private provider error' }),
    async () => Response.json({ result: [42, 1] }),
    async () => new Response('private redirect body', { status: 302, headers: { location: 'https://unapproved.example' } }),
    async () => { throw new Error('private connection credentials'); },
  ];
  for (const fetcher of failures) {
    const result = await receive(signed().request, dependencies(fetcher));
    assert.equal(result.status, 503); assert.equal((await result.text()).includes('private'), false);
  }
});

test('method/media/body bounds reject early; body wait ends on abort', async () => {
  const noFetch = dependencies(() => assert.fail('unexpected storage access'));
  assert.equal((await receive(new Request('https://receiver.example/api/receive'), noFetch)).status, 405);
  assert.equal((await events(new Request('https://receiver.example/api/events', { method: 'POST' }), noFetch)).status, 405);
  const oversized = signed(payload(), { raw: Buffer.alloc(4097) });
  assert.equal((await receive(oversized.request, noFetch)).status, 413);
  const wrongType = signed(); wrongType.headers.set('content-type', 'text/plain');
  assert.equal((await receive(new Request('https://receiver.example/api/receive', { method: 'POST', headers: wrongType.headers, body: wrongType.raw }), noFetch)).status, 415);
  const stalled = new ReadableStream({ start() {} });
  const controller = new AbortController();
  const bounded = boundedBytes(stalled, 4096, controller.signal);
  controller.abort();
  await assert.rejects(bounded, /body_timeout/);
});

test('hold is environment-only, fixed at eight seconds, and off by default', async () => {
  assert.equal(loadConfig(env).holdFirstReceipt, false);
  assert.equal(loadConfig({ ...env, LIKERTS_ACCEPTANCE_HOLD_FIRST_RECEIPT: '0' }).holdFirstReceipt, false);
  assert.equal(loadConfig({ ...env, LIKERTS_ACCEPTANCE_HOLD_FIRST_RECEIPT: '1' }).holdFirstReceipt, true);
  for (const value of ['', 'true', '8000', '2']) {
    assert.throws(() => loadConfig({ ...env, LIKERTS_ACCEPTANCE_HOLD_FIRST_RECEIPT: value }), /receiver_not_configured/);
  }
  const sample = signed(); sample.headers.set('likerts-hold-first-receipt', '1');
  const request = new Request('https://receiver.example/api/receive?hold=8000', {
    method: 'POST', headers: sample.headers, body: sample.raw,
  });
  const response = await receive(request, {
    ...dependencies(async () => Response.json({ result: [1, 1] })),
    sleep: () => assert.fail('ordinary receiver unexpectedly held'),
  });
  assert.equal(response.status, 204);
  assert.equal(FIRST_RECEIPT_HOLD_MS, 8000);
});

test('unverified events, capacity and failed storage cannot enter the hold', async () => {
  const holdEnv = { ...env, LIKERTS_ACCEPTANCE_HOLD_FIRST_RECEIPT: '1' };
  const forbidden = () => assert.fail('rejected receipt entered hold');
  assert.equal((await receive(signed(payload(), { secret: 'whsec_wrong' }).request, {
    env: holdEnv, now: () => nowMs, fetcher: () => assert.fail('invalid HMAC reached storage'), sleep: forbidden,
  })).status, 401);
  for (const result of [[-1, MAX_RECORDS], [42, 0]]) {
    assert.equal((await receive(signed().request, {
      env: holdEnv, now: () => nowMs, fetcher: async () => Response.json({ result }), sleep: forbidden,
    })).status, 503);
  }
});

test('first new verified receipt uses the actual eight-second timer', { timeout: 12000 }, async () => {
  const start = performance.now();
  const response = await receive(signed().request, {
    ...dependencies(async () => Response.json({ result: [1, 1] })),
    env: { ...env, LIKERTS_ACCEPTANCE_HOLD_FIRST_RECEIPT: '1' },
  });
  assert.equal(response.status, 204);
  assert.ok(performance.now() - start >= 7900, 'hold ended before eight seconds');
});

test('actual Redis: marker before hold, concurrent duplicate 204s, atomic cap and nonextending TTL', { timeout: 20000, skip: process.env.LIKERTS_RECEIVER_REDIS_TEST !== '1' }, async () => {
  const exec = promisify(execFile);
  const name = `likerts-receiver-test-${randomUUID()}`;
  await exec('docker', ['run', '--pull=never', '--rm', '-d', '--network=none', '--name', name, 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no'], { timeout: 10000 });
  const redis = async (...args) => {
    const { stdout } = await exec('docker', ['exec', name, 'redis-cli', '--json', ...args.map(String)], { maxBuffer: 2 * 1024 * 1024, timeout: 5000 });
    return JSON.parse(stdout);
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try { ready = await redis('PING') === 'PONG'; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ready, true);
    const key = loadConfig(env).redisKey;
    // Exercise real HMAC handlers and real Redis atomic insertion together. The
    // barrier lets GET and parallel retries run while the first 204 is withheld.
    const fetcher = async (_, options) => Response.json({ result: await redis(...JSON.parse(options.body)) });
    const holdEnv = { ...env, LIKERTS_ACCEPTANCE_HOLD_FIRST_RECEIPT: '1' };
    let releaseHold, enteredHold, holds = 0, firstFinished = false;
    const entered = new Promise(resolve => { enteredHold = resolve; });
    const held = new Promise(resolve => { releaseHold = resolve; });
    const deps = { env: holdEnv, now: () => nowMs, fetcher, sleep: async milliseconds => {
      holds++; assert.equal(milliseconds, 8000); enteredHold(); await held;
    } };
    const body = payload(), firstRequest = signed(body);
    const first = receive(firstRequest.request, deps).then(result => { firstFinished = true; return result; });
    let watchdog;
    const deadline = new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('hold/retry test deadline')), 5000); });
    try {
      await Promise.race([entered, deadline]);
      const marker = await (await events(adminRequest(`Bearer ${env.LIKERTS_ACCEPTANCE_ADMIN_TOKEN}`), deps)).json();
      assert.equal(marker.receivedCount, 1);
      assert.equal(marker.events[0].eventId, body.id);
      assert.equal(marker.events[0].attemptId, firstRequest.headers.get('likerts-attempt-id'));
      assert.equal(marker.events[0].signatureVerified, true);
      assert.equal(firstFinished, false, 'first reply preceded the stored marker observation');
      const retries = await Promise.race([Promise.all(Array.from({ length: 20 }, () => receive(signed(body).request, deps))), deadline]);
      assert.ok(retries.every(result => result.status === 204));
      assert.equal(holds, 1, 'duplicate atomic insertions must not hold');
      assert.equal(firstFinished, false, 'duplicates completed while first reply remained held');
      const after = await (await events(adminRequest(`Bearer ${env.LIKERTS_ACCEPTANCE_ADMIN_TOKEN}`), deps)).json();
      assert.deepEqual(after, marker, 'duplicates must preserve the first verified receipt');
    } finally { clearTimeout(watchdog); releaseHold(); await first; }
    assert.equal((await first).status, 204);
    await redis('DEL', key);

    const submit = eventId => redis('EVAL', STORE_SCRIPT, 1, key, eventId, JSON.stringify({ eventId }), MAX_RECORDS, TTL_SECONDS);
    const results = await Promise.all(Array.from({ length: 20 }, () => submit('same-synthetic-event')));
    assert.equal(results.filter(result => result[0] === 1).length, 1);
    assert.equal(results.filter(result => result[0] === 0).length, 19);
    assert.equal(await redis('HLEN', key), 1);
    const ttl = await redis('TTL', key); assert.ok(ttl > 3500 && ttl <= TTL_SECONDS);
    await redis('EXPIRE', key, 60);
    await submit('second-synthetic-event'); await submit('same-synthetic-event');
    assert.ok(await redis('TTL', key) <= 60);
    await redis('DEL', key);
    await redis('EVAL', "for i=1,tonumber(ARGV[1]) do redis.call('HSET', KEYS[1], tostring(i), '{}') end return redis.call('HLEN', KEYS[1])", 1, key, MAX_RECORDS);
    assert.deepEqual(await submit('one-too-many'), [-1, MAX_RECORDS]);
    assert.equal(await redis('HLEN', key), MAX_RECORDS);
  } finally { await exec('docker', ['rm', '-f', name], { timeout: 5000 }); }
});
