import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { createLiveServer } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';
import { createClientAddressResolver } from '../deployment/client-address-policy.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const admission = () => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), settings: {} });
async function fixture(t, trusted, limits) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-proxy-'));
  const store = await openStore({ sqlitePath: join(directory, 'test.sqlite'), databaseURL: '', production: false });
  const app = await createLiveServer({ store, catalogue, limits,
    resolveClientAddress: createClientAddressResolver({ LIKERTS_LIVE_TRUSTED_PROXY_ADDRESSES: trusted }) });
  const { origin } = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await app.close(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, origin };
}

test('Untrusted HTTP forwarding headers cannot mint fresh admission budgets', async t => {
  const f = await fixture(t, '192.0.2.1', { createPerMinute: 1 });
  for (const [claimed, status] of [['203.0.113.7', 201], ['203.0.113.8', 429]]) {
    const result = await fetch(f.origin + '/api/live/rooms', { method: 'POST',
      headers: { Origin: f.origin, 'Content-Type': 'application/json', 'X-Forwarded-For': claimed }, body: JSON.stringify(admission()) });
    assert.equal(result.status, status); await result.arrayBuffer();
  }
});

test('A real local append-only reverse proxy defeats caller-controlled leftmost headers', async t => {
  const f = await fixture(t, '127.0.0.1', { createPerMinute: 1 });
  // This is a loopback topology test, not evidence about Render's actual ingress.
  const proxy = createServer((request, response) => {
    const claimed = request.headers['x-forwarded-for'];
    const peer = request.socket.remoteAddress;
    const upstream = httpRequest(f.origin + request.url, { method: request.method,
      headers: { ...request.headers, host: new URL(f.origin).host,
        'x-forwarded-for': claimed ? `${claimed}, ${peer}` : peer } }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); }));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  for (const [claimed, status] of [['203.0.113.7', 201], ['203.0.113.8', 429]]) {
    const response = await fetch(base + '/api/live/rooms', { method: 'POST',
      headers: { Origin: f.origin, 'Content-Type': 'application/json', 'X-Forwarded-For': claimed }, body: JSON.stringify(admission()) });
    assert.equal(response.status, status); await response.arrayBuffer();
  }
});

test('HTTP and WebSocket admission both use the configured resolved identity consistently', async t => {
  const f = await fixture(t, '127.0.0.1', { connectionsPerMinute: 1 });
  const sockets = new Set();
  t.after(() => { for (const socket of sockets) socket.terminate(); });
  async function connect(forwarded) {
    const socket = new WebSocket(f.origin.replace('http:', 'ws:') + '/api/live/socket', {
      origin: f.origin, headers: { 'X-Forwarded-For': forwarded } });
    sockets.add(socket); socket.on('error', () => {});
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned socket handshake timed out')), 2000);
      socket.once('open', () => { clearTimeout(timer); resolve(101); });
      socket.once('unexpected-response', (_, response) => { clearTimeout(timer); response.resume(); socket.terminate(); resolve(response.statusCode); });
    });
  }
  assert.equal(await connect('203.0.113.7'), 101);
  assert.equal(await connect('203.0.113.8'), 101, 'Separate verified append-hop identities have separate admission budgets');
  assert.equal(await connect('caller-spoof, 203.0.113.7'), 429, 'Changing the untrusted prefix cannot reset the same budget');
});
