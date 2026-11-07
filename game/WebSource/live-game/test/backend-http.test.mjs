import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLiveServer } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const admission = () => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url') });
async function fixture(t, limits = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-live-http-'));
  let timestamp = Date.now();
  const store = await openStore({ sqlitePath: join(directory, 'fixture.sqlite'), databaseURL: '', production: false, now: () => timestamp });
  const app = await createLiveServer({ store, catalogue, now: () => timestamp, limits });
  const { origin } = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await app.close(); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (method, path, body, token) => {
    const response = await fetch(`${origin}/api/live${path}`, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const action = (member, state, action, extra = {}) => request('POST', `/rooms/${member.code}/actions`, { requestId: randomUUID(), matchId: state.matchId, ...(state.round ? { roundId: state.round.id } : {}), action, ...extra }, member.token);
  return { origin, request, action, advance(ms) { timestamp += ms; }, app };
}

test('Static /play serves only public web files with a same-origin CSP and preserves all other route ownership', async t => {
  const f = await fixture(t);
  for (const path of ['/play', '/play/', '/play/styles.css', '/play/client.mjs']) {
    const response = await fetch(f.origin + path); assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-inline|\*/);
  }
  for (const path of ['/', '/surveys', '/docs', '/app', '/game/support', '/api/status', '/play/%2e%2e/server/app.mjs', '/play/%2e%2e%2fserver%2fstore.mjs', '/play/.env', '/play/PROTOCOL.md']) {
    assert.equal((await fetch(f.origin + path)).status, 404, path);
  }
  const topics = await f.request('GET', '/catalogue');
  assert.equal(topics.status, 200); assert.equal(topics.body.topics.length, 20);
  assert.deepEqual(Object.keys(topics.body).sort(), ['limits', 'locale', 'sha256', 'topics', 'version']);
  assert.deepEqual(topics.body.limits, { maxPlayers: 50, defaultCapacity: 12 });
  assert.equal(topics.body.rounds, undefined, 'Public picker metadata never exposes the internal catalogue/room state');
});

test('A lost creation response can recover while the room quota is full without creating another room', async t => {
  const f = await fixture(t, { maxRooms: 1 });
  const body = { ...admission(), settings: {} };
  const first = await f.request('POST', '/rooms', body); assert.equal(first.status, 201);
  const retry = await f.request('POST', '/rooms', body); assert.equal(retry.status, 201);
  assert.equal(retry.body.code, first.body.code); assert.equal(retry.body.memberId, first.body.memberId);
  assert.notEqual(retry.body.token, first.body.token);
  assert.equal((await f.request('GET', `/rooms/${first.body.code}`, undefined, first.body.token)).status, 401);
  assert.equal((await f.request('POST', '/rooms', { ...admission(), settings: {} })).status, 503);
  assert.equal((await f.request('GET', `/rooms/${retry.body.code}`, undefined, retry.body.token)).status, 200);
});

test('Late answers are rejected while the elapsed timeout remains durably visible', async t => {
  const f = await fixture(t);
  const host = (await f.request('POST', '/rooms', { ...admission(), settings: { answerSeconds: 30, predictSeconds: 30 } })).body;
  const a = (await f.request('POST', `/rooms/${host.code}/join`, { ...admission(), nickname: 'Ari', acceptRoomSharing: true })).body;
  const b = (await f.request('POST', `/rooms/${host.code}/join`, { ...admission(), nickname: 'Bo', acceptRoomSharing: true })).body;
  const state = (await f.action(host, host.state, 'start')).body.state;
  const subject = [a, b].find(member => member.memberId === state.round.subjectId);
  f.advance(30_000);
  assert.equal((await f.action(subject, state, 'answer', { value: 5 })).status, 409);
  const current = (await f.request('GET', `/rooms/${host.code}`, undefined, host.token)).body.state;
  assert.equal(current.phase, 'reveal'); assert.equal(current.reveal.reason, 'subject_timeout');
  assert.equal(current.reveal.answer, null); assert.ok(current.leaderboard.every(row => row.opportunities === 0));
});

test('A lost leave response has an exact terminal retry without restoring revoked room access', async t => {
  const f = await fixture(t);
  const host = (await f.request('POST', '/rooms', { ...admission(), settings: {} })).body;
  const player = (await f.request('POST', `/rooms/${host.code}/join`, { ...admission(), nickname: 'Ari', acceptRoomSharing: true })).body;
  const body = { requestId: randomUUID(), matchId: player.state.matchId, action: 'leave' };
  const left = await f.request('POST', `/rooms/${host.code}/actions`, body, player.token);
  const retry = await f.request('POST', `/rooms/${host.code}/actions`, body, player.token);
  assert.deepEqual(left, { status: 200, body: { state: null, left: true } }); assert.deepEqual(retry, left);
  assert.equal((await f.request('GET', `/rooms/${host.code}`, undefined, player.token)).status, 401);
  assert.equal((await f.request('POST', `/rooms/${host.code}/actions`, { ...body, action: 'heartbeat' }, player.token)).status, 401);
});

test('Disallowed browser origins cannot create rooms or obtain CORS authority', async t => {
  const f = await fixture(t);
  const response = await fetch(f.origin + '/api/live/rooms', { method: 'POST', headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...admission(), settings: {} }) });
  assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null);
  const body = await response.json(); assert.deepEqual(Object.keys(body), ['error']); assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
});
