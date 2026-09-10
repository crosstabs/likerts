import assert from 'node:assert/strict';
import test from 'node:test';
import { collectStatus, components } from '../lib/status.mjs';
import { authorizedMonitor, alertDestination, runMonitor } from '../api/monitor.js';

const healthy = url => Response.json(url.includes('clerk.') ? { keys: [{ kty: 'RSA', n: 'public', e: 'AQAB' }] }
  : url.includes('-mcp.') ? { status: 'ok', service: 'likerts-mcp' } : { status: 'ok', storage: 'postgresql' });
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
  const result = await runMonitor({ environment, probe, fetcher: async (_, options) => { assert.equal(options.redirect, 'manual'); assert.equal(options.body.includes('omit-me'), false); return new Response('', { status: 302 }); } });
  assert.equal(result.body.alert, 'delivery_failed');
});
test('monitor distinguishes missing receiver, healthy, receiver acceptance and delivery failure', async () => {
  assert.equal((await runMonitor({ environment: {} })).body.status, 'not_armed');
  const environment = { LIKERTS_ALERT_WEBHOOK_URL: 'https://alerts.example.com/hook', LIKERTS_ALERT_RECEIVER_ORIGIN: 'https://alerts.example.com' };
  const probe = async () => ({ status: 'degraded', checkedAt: new Date().toISOString(), components: [] });
  assert.equal((await runMonitor({ environment, probe, fetcher: async () => new Response(null, { status: 204 }) })).body.alert, 'receiver_accepted');
  assert.equal((await runMonitor({ environment, probe, fetcher: async () => { throw new Error('secret'); } })).body.alert, 'delivery_failed');
  assert.equal((await runMonitor({ environment, probe: async () => ({ status: 'reachable' }), fetcher: () => assert.fail('must not notify when healthy') })).body.alert, 'not_needed');
});
