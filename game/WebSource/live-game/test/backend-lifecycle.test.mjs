import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createLiveServer } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const admission = () => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url') });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-live-lifecycle-'));
  let timestamp = Date.now();
  const store = await openStore({ sqlitePath: join(directory, 'fixture.sqlite'), databaseURL: '', production: false, now: () => timestamp });
  const app = await createLiveServer({ store, catalogue, now: () => timestamp });
  const { origin } = await app.listen();
  t.after(async () => { await app.close(); if (app.server.listening) await new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); }); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (method, path, body, token) => {
    const response = await fetch(`${origin}/api/live${path}`, { method, headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  return { app, store, origin, request, now: () => timestamp, setNow(value) { timestamp = value; } };
}
async function holdTick(f) {
  const entered = deferred(), release = deferred(), original = f.store.cleanup.bind(f.store);
  f.store.cleanup = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
  const tick = f.app.tick(); await entered.promise;
  return { release: release.resolve, tick };
}

test('Concurrent transport close callers wait for cleanup instead of returning before shutdown', async t => {
  const f = await fixture(t), held = await holdTick(f);
  const first = f.app.close(); let finished = false;
  const second = f.app.close().then(() => { finished = true; });
  await turn(); const premature = finished;
  held.release(); await Promise.all([first, second, held.tick]);
  assert.equal(premature, false); assert.equal(f.app.server.listening, false);
});

test('A closing worker rejects a new admission before any room is created', async t => {
  const f = await fixture(t), held = await holdTick(f);
  const closing = f.app.close();
  let response;
  try { response = await f.request('POST', '/rooms', { ...admission(), settings: {} }); }
  finally { held.release(); await Promise.all([closing, held.tick]); }
  assert.equal(response.status, 503); assert.equal(response.body.error.code, 'service_unavailable');
  assert.equal(await f.store.count(), 0);
});

test('A closed transport cannot reopen an HTTP listener without its timers and subscriptions', async t => {
  const f = await fixture(t); await f.app.close();
  await assert.rejects(f.app.listen(), /closed|closing|stopped/i);
});

test('A queued WebSocket upgrade cannot become active after shutdown starts', async t => {
  const f = await fixture(t), held = await holdTick(f), entered = deferred(), release = deferred();
  const consume = f.store.consumeBudget.bind(f.store);
  f.store.consumeBudget = async value => { entered.resolve(); await release.promise; return consume(value); };
  const socket = new WebSocket(f.origin.replace('http:', 'ws:') + '/api/live/socket', { origin: f.origin });
  let opened = false;
  const settled = new Promise(resolve => { socket.once('open', () => { opened = true; resolve(); }); socket.once('error', resolve); socket.once('close', resolve); });
  await entered.promise; const closing = f.app.close(); release.resolve();
  try { await Promise.race([settled, delay(1000)]); assert.equal(opened, false); }
  finally { socket.terminate(); held.release(); await Promise.all([closing, held.tick]); }
});

test('An authenticated read queued across expiry cannot revive the room before maintenance runs', async t => {
  const f = await fixture(t);
  const host = (await f.request('POST', '/rooms', { ...admission(), settings: {} })).body;
  await delay(30); // Settle the preceding commit notification before gating a read.
  f.setNow(host.state.expiresAt - 1);
  const entered = deferred(), release = deferred(), transact = f.store.transact.bind(f.store);
  f.store.transact = async (...args) => { f.store.transact = transact; entered.resolve(); await release.promise; return transact(...args); };
  const reading = f.request('GET', `/rooms/${host.code}`, undefined, host.token);
  await entered.promise; f.setNow(host.state.expiresAt + 1); release.resolve();
  const response = await reading;
  assert.equal(response.status, 404); assert.equal(response.body.state, undefined);
});

test('A queued answer uses the clock at the authoritative transaction, preserving the elapsed deadline', async t => {
  const f = await fixture(t);
  const host = (await f.request('POST', '/rooms', { ...admission(), settings: { answerSeconds: 30 } })).body;
  const players = [];
  for (const nickname of ['Ari', 'Bo']) players.push((await f.request('POST', `/rooms/${host.code}/join`, { ...admission(), nickname, acceptRoomSharing: true })).body);
  const action = (who, state, action, extra = {}) => f.request('POST', `/rooms/${host.code}/actions`, { requestId: randomUUID(), matchId: state.matchId, ...(state.round ? { roundId: state.round.id } : {}), action, ...extra }, who.token);
  const state = (await action(host, host.state, 'start')).body.state;
  const subject = players.find(player => player.memberId === state.round.subjectId);
  await delay(30); f.setNow(state.round.deadline - 1);
  const entered = deferred(), release = deferred(), transact = f.store.transactCommand.bind(f.store);
  f.store.transactCommand = async (...args) => { f.store.transactCommand = transact; entered.resolve(); await release.promise; return transact(...args); };
  const answering = action(subject, state, 'answer', { value: 5 });
  await entered.promise; f.setNow(state.round.deadline + 1); release.resolve();
  const response = await answering; assert.equal(response.status, 409);
  const current = (await f.request('GET', `/rooms/${host.code}`, undefined, host.token)).body.state;
  assert.equal(current.phase, 'reveal'); assert.equal(current.reveal.reason, 'subject_timeout'); assert.equal(current.reveal.answer, null);
});

test('A queued admission recovery cannot rotate a credential after its recovery window', async t => {
  const f = await fixture(t), fields = admission(), createdAt = f.now();
  const host = (await f.request('POST', '/rooms', { ...fields, settings: {} })).body;
  f.setNow(createdAt + 600_000 - 1);
  const entered = deferred(), release = deferred(), admit = f.store.admit.bind(f.store);
  f.store.admit = async (...args) => { f.store.admit = admit; entered.resolve(); await release.promise; return admit(...args); };
  const recovering = f.request('POST', '/admissions/recover', fields);
  await entered.promise; f.setNow(createdAt + 600_000 + 1); release.resolve();
  assert.equal((await recovering).status, 410);
  assert.equal((await f.request('GET', `/rooms/${host.code}`, undefined, host.token)).status, 200, 'Rejected recovery does not invalidate the still-current capability');
});

test('Room notifications with no local subscribers do not amplify into durable room reads', async t => {
  const f = await fixture(t);
  const host = (await f.request('POST', '/rooms', { ...admission(), settings: {} })).body;
  await delay(30);
  let reads = 0; const transact = f.store.transact.bind(f.store);
  f.store.transact = (...args) => { reads++; return transact(...args); };
  for (let revision = 2; revision < 20; revision++) f.store.emit(host.code, revision);
  await delay(50); assert.equal(reads, 0);
});
