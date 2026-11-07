import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import pg from 'pg';
import { canSend, createLiveServer } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';
import { createRoom, joinRoom, project, reduceRoom } from '../server/engine.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const allowedOrigin = 'http://127.0.0.1';
const allowedTop = new Set('protocolVersion code matchId revision serverTime expiresAt catalogVersion catalogHash role self phase joinLocked settings hostConnected players round reveal leaderboard completion notice'.split(' '));
const allowedRound = new Set('id index total subjectId subjectName prompt deadline paused answerLocked submittedCount eligibleCount ownAnswer ownGuess'.split(' '));
const allowedPrompt = new Set('id text topic sceneSummary'.split(' '));
const admission = body => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), ...body });

function keysWithin(value, allowed, label) {
  assert.ok(value && typeof value === 'object', `${label} must be an object`);
  for (const key of Object.keys(value)) assert.ok(allowed.has(key), `${label} exposes unexpected field ${key}`);
}

function assertProjection(state, member, { answer = null, guess = null } = {}) {
  keysWithin(state, allowedTop, 'state');
  assert.equal(state.protocolVersion, 1);
  assert.equal(state.catalogHash, catalogue.sha256);
  assert.equal(state.self.id, member.memberId);
  assert.equal(state.role, member.memberId === 'host' ? 'host' : 'player');
  keysWithin(state.self, new Set(['id', 'nickname']), 'self');
  for (const player of state.players) keysWithin(player, new Set(['id', 'nickname', 'avatar', 'connected']), 'player');
  for (const row of state.leaderboard) keysWithin(row, new Set(['playerId', 'nickname', 'points', 'opportunities', 'accuracy', 'rank']), 'leaderboard');
  assert.equal(state.reveal, null, 'unrevealed secrets must not be broadcast');
  if (state.round) {
    keysWithin(state.round, allowedRound, 'round');
    keysWithin(state.round.prompt, allowedPrompt, 'prompt');
    const canonical = catalogue.rounds.find(item => item.id === state.round.prompt.id);
    assert.ok(canonical, 'server must choose a reviewed catalogue ID');
    assert.equal(state.round.prompt.text, canonical.text);
    assert.equal(state.round.prompt.topic, canonical.topic);
    assert.equal(state.round.prompt.sceneSummary, canonical.sceneSummary);
    assert.equal(state.round.ownAnswer, answer, 'answer visibility must be owner-scoped');
    assert.equal(state.round.ownGuess, guess, 'guess visibility must be owner-scoped');
  }
}

class Peer {
  constructor(url) {
    this.messages = [];
    this.droppedMessages = 0;
    this.waiters = new Set();
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('local WebSocket failed to open')), { once: true });
    });
    this.closed = new Promise(resolve => this.socket.addEventListener('close', resolve, { once: true }));
    this.socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { message = { invalidJSON: true }; }
      this.messages.push(message);
      if (this.messages.length > 100) { this.messages.shift(); this.droppedMessages++; }
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.resolve(message);
    });
  }
  async wait(predicate, timeout = 3000, stage = 'state') {
    const existing = this.messages.find(predicate);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      let waiter;
      const cleanup = () => { clearTimeout(timer); this.waiters.delete(waiter); this.socket.removeEventListener('close', closed); };
      const closed = event => { cleanup(); reject(new Error(`local WebSocket closed during ${stage}; code ${event.code}`)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`local WebSocket ${stage} deadline exceeded`)); }, timeout);
      waiter = { predicate, resolve: value => { cleanup(); resolve(value); } };
      this.waiters.add(waiter);
      this.socket.addEventListener('close', closed, { once: true });
      if (this.socket.readyState >= WebSocket.CLOSING) { cleanup(); reject(new Error(`local WebSocket already closed during ${stage}`)); }
    });
  }
  async authenticate(code, token) {
    await this.opened;
    this.socket.send(JSON.stringify({ type: 'authenticate', code, token }));
    return this.wait(message => message.type === 'state' || message.type === 'error', 3000, 'authentication');
  }
  close() { this.socket.close(); }
}

async function fixture(t, { limits = {}, persistent = false, externalOrigin = null, initialTimestamp = Date.now() } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-live-acceptance-'));
  const sqlitePath = join(directory, persistent ? 'persistent-fixture.sqlite' : 'fixture.sqlite');
  assert.ok(Number.isSafeInteger(initialTimestamp) && initialTimestamp >= 0);
  let timestamp = initialTimestamp;
  let store;
  let app;
  let origin = externalOrigin;
  if (origin) {
    const url = new URL(origin);
    assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && !url.username && !url.password && !url.search && !url.hash, 'external fixture must remain loopback-only');
  }
  const peers = new Set();
  const memberships = [];
  async function start() {
    store = await openStore({ sqlitePath, databaseURL: null, production: false });
    app = await createLiveServer({ store, catalogue, origins: [allowedOrigin], allowNoOrigin: true, production: false, now: () => timestamp, limits });
    ({ origin } = await app.listen({ host: '127.0.0.1', port: 0 }));
    assert.equal(new URL(origin).hostname, '127.0.0.1');
  }
  t.after(async () => {
    try {
      for (const peer of peers) peer.close();
      if (externalOrigin) for (const member of memberships.filter(item => item.memberId === 'host')) {
        try { await f.action(member, await f.state(member), 'close'); } catch { /* Only owned rooms; another test action may already have closed it. */ }
      }
      if (app) await app.close();
    } finally {
      try { if (store) await store.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
  if (!externalOrigin) await start();
  const f = {
    directory,
    get origin() { return origin; },
    async seedRoom(room) { assert.ok(store, 'only an owned local fixture can seed state'); await store.create(room); },
    async request(method, path, body, token, extraHeaders = {}) {
      const response = await fetch(`${origin}/api/live${path}`, {
        method,
        redirect: 'error',
        headers: { Origin: allowedOrigin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      const payload = await response.json();
      return { status: response.status, payload };
    },
    async create(settings = {}) {
      const result = await f.request('POST', '/rooms', admission({ settings: { topic: 'mix', cycles: 1, capacity: 3, answerSeconds: 0, predictSeconds: 0, ...settings } }));
      assert.equal(result.status, 201, 'room creation');
      const host = result.payload;
      assert.match(host.code, /^[A-Z0-9]{6}$/);
      assert.ok(typeof host.token === 'string' && host.token.length >= 40);
      assert.equal(host.memberId, 'host');
      memberships.push(host);
      return host;
    },
    async join(host, nickname) {
      const result = await f.request('POST', `/rooms/${host.code}/join`, admission({ nickname, acceptRoomSharing: true }));
      assert.equal(result.status, 201, 'synthetic player admission');
      const player = result.payload;
      assert.notEqual(player.token, host.token);
      assert.notEqual(player.memberId, 'host');
      memberships.push(player);
      return player;
    },
    async state(member) {
      const result = await f.request('GET', `/rooms/${member.code}`, undefined, member.token);
      assert.equal(result.status, 200, 'authorized snapshot');
      return result.payload.state;
    },
    async action(member, state, action, data = {}, requestId = randomUUID()) {
      return f.request('POST', `/rooms/${member.code}/actions`, {
        requestId, matchId: state.matchId, ...(state.round ? { roundId: state.round.id } : {}), action, ...data,
      }, member.token);
    },
    async ok(member, state, action, data = {}, requestId) {
      const result = await f.action(member, state, action, data, requestId);
      assert.equal(result.status, 200, `authorized ${action}`);
      return result.payload.state;
    },
    async match(players = 3) {
      const host = await f.create({ capacity: players });
      const guests = [];
      for (let index = 0; index < players; index++) guests.push(await f.join(host, `Synthetic ${index + 1}`));
      const state = await f.ok(host, await f.state(host), 'start');
      return { host, guests, state };
    },
    async peer(member, token = member.token) {
      const peer = new Peer(`${origin.replace('http:', 'ws:')}/api/live/socket`);
      peers.add(peer);
      const message = await peer.authenticate(member.code, token);
      return { peer, message };
    },
    async rawPeer() {
      const peer = new Peer(`${origin.replace('http:', 'ws:')}/api/live/socket`);
      peers.add(peer);
      await peer.opened;
      return peer;
    },
    async advance(milliseconds) { timestamp += milliseconds; await app.tick(); },
    async restart() { for (const peer of peers) peer.close(); await app.close(); await store.close(); await start(); },
  };
  return f;
}

function rejected(result, statuses = [400, 401, 403, 404, 409, 410, 422]) {
  assert.ok(statuses.includes(result.status), `expected rejection, received HTTP ${result.status}`);
  assert.ok(typeof result.payload.error?.code === 'string');
  keysWithin(result.payload, new Set(['error']), 'error response');
  keysWithin(result.payload.error, new Set(['code', 'message']), 'error');
}

test('HTTP and WebSocket projections hide other answers and guesses until reveal', async t => {
  const f = await fixture(t);
  const { host, guests, state } = await f.match();
  const subject = guests.find(member => member.memberId === state.round.subjectId);
  const predictors = guests.filter(member => member !== subject);
  const observers = await Promise.all([host, ...guests].map(async member => ({ member, ...(await f.peer(member)) })));
  const inspectAllPrivateEvents = observer => {
    assert.equal(observer.peer.droppedMessages, 0, 'privacy evidence must not discard intervening events');
    let previousRevision = -1;
    for (const event of observer.peer.messages) {
      assert.equal(event.type, 'state', 'authorized subscriber must receive projected state frames');
      const snapshot = event.state;
      assert.ok(snapshot.revision >= previousRevision, 'subscriber revisions must not move backwards');
      previousRevision = snapshot.revision;
      if (!['answer', 'predict'].includes(snapshot.phase)) continue;
      assert.ok((observer.member === subject ? [null, 2] : [null]).includes(snapshot.round.ownAnswer), 'every pre-reveal event must scope its answer to the subject');
      assert.ok((observer.member === predictors[0] ? [null, 5] : [null]).includes(snapshot.round.ownGuess), 'every pre-reveal event must scope its guess to its owner');
      assertProjection(snapshot, observer.member, { answer: snapshot.round.ownAnswer, guess: snapshot.round.ownGuess });
      assert.equal(snapshot.notice, null, 'ordinary pre-reveal events must not introduce secret-bearing notices');
      assert.ok(snapshot.leaderboard.every(row => row.points === 0), 'no intervening private event may disclose a derived score');
    }
  };
  for (const observer of observers) assertProjection(observer.message.state, observer.member);
  let current = await f.ok(subject, state, 'answer', { value: 2 });
  assert.equal(current.phase, 'predict');
  current = await f.ok(predictors[0], current, 'guess', { value: 5 });
  assert.equal(current.phase, 'predict');
  rejected(await f.action(predictors[0], current, 'guess', { value: 4 }), [409]);
  rejected(await f.action(subject, current, 'answer', { value: 3 }), [409]);
  for (const observer of observers) {
    const snapshot = await f.state(observer.member);
    const expected = { answer: observer.member === subject ? 2 : null, guess: observer.member === predictors[0] ? 5 : null };
    assertProjection(snapshot, observer.member, expected);
    assert.ok(snapshot.leaderboard.every(row => row.points === 0), 'current secret must not affect public scores');
    const event = await observer.peer.wait(message => message.type === 'state' && message.state.revision >= snapshot.revision);
    assertProjection(event.state, observer.member, expected);
    inspectAllPrivateEvents(observer);
  }
  current = await f.ok(predictors[1], current, 'guess', { value: 2 });
  assert.equal(current.phase, 'reveal');
  assert.equal(current.reveal.answer, 2);
  assert.equal(current.reveal.guesses.find(item => item.playerId === predictors[0].memberId).points, 25);
  assert.equal(current.reveal.guesses.find(item => item.playerId === predictors[1].memberId).points, 100);
  for (const observer of observers) {
    await observer.peer.wait(message => message.type === 'state' && message.state.phase === 'reveal');
    inspectAllPrivateEvents(observer);
  }
});

test('room, role, Origin, schema and exact-round authorization are enforced', async t => {
  const f = await fixture(t);
  const { host, guests, state } = await f.match();
  const other = await f.create();
  rejected(await f.request('GET', `/rooms/${host.code}`), [401, 403]);
  rejected(await f.request('GET', `/rooms/${host.code}`, undefined, other.token), [401, 403, 404]);
  rejected(await f.request('GET', `/rooms/${host.code}`, undefined, host.token, { Origin: 'https://untrusted.invalid' }), [403]);
  const subject = guests.find(member => member.memberId === state.round.subjectId);
  const predictor = guests.find(member => member !== subject);
  rejected(await f.action(predictor, state, 'start'), [403, 409]);
  rejected(await f.action(host, state, 'answer', { value: 2 }), [403, 409]);
  rejected(await f.action(predictor, state, 'answer', { value: 2 }), [403, 409]);
  rejected(await f.action(predictor, state, 'guess', { value: 2 }), [409]);
  rejected(await f.action(subject, state, 'answer', { value: 2, roundId: randomUUID() }), [409]);
  rejected(await f.action(subject, state, 'answer', { value: 2, matchId: randomUUID() }), [409]);
  for (const value of [0, 6, 1.5, '3', true, null]) rejected(await f.action(subject, state, 'answer', { value }), [400, 422]);
  const predicting = await f.ok(subject, state, 'answer', { value: 3 });
  rejected(await f.action(subject, predicting, 'guess', { value: 3 }), [403, 409]);
  rejected(await f.action(host, predicting, 'next'), [409]);
  rejected(await f.request('POST', `/rooms/${host.code}/actions`, { requestId: randomUUID(), action: 'skip', roundId: state.round.id }, host.token), [400, 409, 422]);
  const invalidPeer = await f.peer(host, other.token);
  assert.equal(invalidPeer.message.type, 'error');
  await Promise.race([invalidPeer.peer.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('unauthorized socket stayed open')), 3000))]);
});

test('concurrent retries and final locks yield one reveal and one score', async t => {
  const f = await fixture(t);
  const { host, guests, state } = await f.match();
  const subject = guests.find(member => member.memberId === state.round.subjectId);
  const predictors = guests.filter(member => member !== subject);
  const answerId = randomUUID();
  const answered = await Promise.all(Array.from({ length: 3 }, () => f.action(subject, state, 'answer', { value: 4 }, answerId)));
  assert.ok(answered.every(result => result.status === 200), 'same request must be idempotent concurrently');
  rejected(await f.action(subject, state, 'answer', { value: 1 }, answerId), [409]);
  const predicting = await f.state(host);
  const guessId = randomUUID();
  const results = await Promise.all([
    f.action(predictors[0], predicting, 'guess', { value: 4 }, guessId),
    f.action(predictors[0], predicting, 'guess', { value: 4 }, guessId),
    f.action(predictors[1], predicting, 'guess', { value: 5 }),
  ]);
  assert.ok(results.every(result => result.status === 200));
  const revealed = await f.state(host);
  assert.equal(revealed.phase, 'reveal');
  assert.equal(revealed.reveal.guesses.length, 2);
  assert.equal(revealed.leaderboard.find(row => row.playerId === predictors[0].memberId).points, 100);
  assert.equal(revealed.leaderboard.find(row => row.playerId === predictors[1].memberId).points, 75);
  assert.equal(revealed.leaderboard.find(row => row.playerId === subject.memberId).points, 0);
  await f.action(predictors[0], predicting, 'guess', { value: 4 }, guessId);
  assert.deepEqual((await f.state(host)).leaderboard, revealed.leaderboard, 'replay must not score twice');
  const next = await f.ok(host, revealed, 'next');
  rejected(await f.action(predictors[0], predicting, 'guess', { value: 4 }), [409]);
  rejected(await f.action(host, revealed, 'skip'), [409]);
  assert.equal((await f.state(host)).round.id, next.round.id);
});

test('rematch rejects stale match/round commands and preserves idempotency conflict safety', async t => {
  const f = await fixture(t);
  const { host, guests, state } = await f.match();
  const subject = guests.find(member => member.memberId === state.round.subjectId);
  const requestId = randomUUID();
  const predicting = await f.ok(subject, state, 'answer', { value: 1 }, requestId);
  const finished = await f.ok(host, predicting, 'end');
  assert.equal(finished.completion, 'incomplete');
  assert.ok(!finished.reveal || finished.reveal.answer == null, 'unfinished secret must remain hidden');
  const lobby = await f.ok(host, finished, 'rematch');
  assert.notEqual(lobby.matchId, state.matchId);
  assert.equal(lobby.phase, 'lobby');
  assert.ok(lobby.leaderboard.every(row => row.points === 0));
  rejected(await f.action(subject, state, 'answer', { value: 1 }), [409]);
  rejected(await f.action(subject, lobby, 'heartbeat', {}, requestId), [409]);
  await f.action(subject, state, 'answer', { value: 1 }, requestId);
  assert.equal((await f.state(host)).matchId, lobby.matchId);
  assert.equal((await f.state(host)).phase, 'lobby');
  const restarted = await f.ok(host, lobby, 'start');
  assert.notEqual(restarted.round.prompt.id, state.round.prompt.id, 'presented prompt must not repeat on rematch');
  rejected(await f.action(host, { ...restarted, round: state.round }, 'skip'), [409]);
});

test('lobby lock and kick revoke HTTP access and an already authenticated socket', async t => {
  const f = await fixture(t);
  const host = await f.create();
  const player = await f.join(host, 'Synthetic Player');
  const { peer, message } = await f.peer(player);
  assert.equal(message.type, 'state');
  let current = await f.ok(host, await f.state(host), 'lock', { locked: true });
  rejected(await f.request('POST', `/rooms/${host.code}/join`, admission({ nickname: 'Late Player', acceptRoomSharing: true })), [403, 409]);
  current = await f.ok(host, current, 'kick', { playerId: player.memberId });
  await Promise.race([peer.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('kicked active socket not closed')), 3000))]);
  rejected(await f.request('GET', `/rooms/${host.code}`, undefined, player.token), [401, 403, 404]);
  rejected(await f.action(player, current, 'heartbeat'), [401, 403, 404]);
  assert.ok(!current.players.some(item => item.id === player.memberId));
});

test('local SQLite store/server restart preserves scoped secrets, tokens and retry safety', async t => {
  const f = await fixture(t, { persistent: true });
  const { host, guests, state } = await f.match();
  const subject = guests.find(member => member.memberId === state.round.subjectId);
  const predictors = guests.filter(member => member !== subject);
  const requestId = randomUUID();
  await f.ok(subject, state, 'answer', { value: 5 }, requestId);
  await f.restart();
  const restored = await f.state(host);
  assert.equal(restored.matchId, state.matchId);
  assert.equal(restored.round.id, state.round.id);
  assertProjection(restored, host);
  assertProjection(await f.state(subject), subject, { answer: 5 });
  const replay = await f.action(subject, state, 'answer', { value: 5 }, requestId);
  assert.equal(replay.status, 200);
  const guessing = await f.state(host);
  await Promise.all(predictors.map(member => f.ok(member, guessing, 'guess', { value: 5 })));
  const revealed = await f.state(host);
  assert.equal(revealed.phase, 'reveal');
  assert.ok(revealed.leaderboard.filter(row => row.playerId !== subject.memberId).every(row => row.points === 100));
  for (const file of await readdir(f.directory)) {
    const bytes = await readFile(join(f.directory, file));
    for (const member of [host, ...guests]) assert.equal(bytes.includes(Buffer.from(member.token)), false, 'persistent file must not contain raw player credentials');
  }
});

test('idle, hard-life and finished expiry reject access and close subscriptions', async t => {
  const f = await fixture(t);
  const idle = await f.create();
  const { peer } = await f.peer(idle);
  await f.advance(2 * 60 * 60 * 1000 + 1);
  rejected(await f.request('GET', `/rooms/${idle.code}`, undefined, idle.token), [404, 410]);
  await Promise.race([peer.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('expired subscription stayed open')), 3000))]);
  const hard = await f.create();
  let state = hard.state;
  for (let index = 0; index < 3; index++) {
    await f.advance(119 * 60 * 1000);
    state = await f.ok(hard, state, 'heartbeat');
  }
  await f.advance(4 * 60 * 1000);
  rejected(await f.request('GET', `/rooms/${hard.code}`, undefined, hard.token), [404, 410]);
  const match = await f.match(2);
  state = await f.ok(match.host, match.state, 'end');
  assert.equal(state.phase, 'finished');
  await f.advance(15 * 60 * 1000 + 1);
  rejected(await f.request('GET', `/rooms/${match.host.code}`, undefined, match.host.token), [404, 410]);
});

test('invite validation, nickname policy and admission consent reject unsafe input', async t => {
  const f = await fixture(t);
  const host = await f.create();
  for (const code of ['LK1-AAAA-BBBB', 'LK2-eyJ2ZXJzaW9uIjoyfQ', 'LK3-eyJhbnN3ZXJzIjpbMV19', 'AAAAAAA']) {
    rejected(await f.request('POST', `/rooms/${code}/join`, admission({ nickname: 'Synthetic', acceptRoomSharing: true })), [400, 404, 422]);
  }
  rejected(await f.request('POST', `/rooms/${host.code}/join`, admission({ nickname: 'Synthetic' })), [400, 422]);
  for (const nickname of ['<script>', 'A\u202EB', 'A\nB', 'x'.repeat(21), '']) rejected(await f.request('POST', `/rooms/${host.code}/join`, admission({ nickname, acceptRoomSharing: true })), [400, 422]);
  await f.join(host, 'Synthetic');
  rejected(await f.request('POST', `/rooms/${host.code}/join`, admission({ nickname: 'synthetic', acceptRoomSharing: true })), [400, 409, 422]);
  rejected(await f.request('POST', '/rooms', admission({ settings: { topic: 'unreviewed free text', capacity: 3 } })), [400, 422]);
  for (const settings of [{ capacity: 1 }, { capacity: 51 }, { cycles: 4 }, { answerSeconds: 10 }, { predictSeconds: 10 }]) rejected(await f.request('POST', '/rooms', admission({ settings })), [400, 422]);
});

test('room, socket, body, frame and create-rate ceilings reject excess work', async t => {
  const f = await fixture(t, { limits: { maxRooms: 2, maxSockets: 2, maxSocketsPerMember: 1, maxBodyBytes: 1024, maxFrameBytes: 256, createPerMinute: 20 } });
  rejected(await f.request('POST', '/rooms', { padding: 'x'.repeat(2048) }), [413]);
  const first = await f.create();
  const second = await f.create();
  rejected(await f.request('POST', '/rooms', admission({ settings: {} })), [429, 503]);
  const { peer } = await f.peer(first);
  const duplicate = await f.peer(first);
  assert.equal(duplicate.message.type, 'error', 'per-member socket ceiling');
  await Promise.race([duplicate.peer.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('excess socket not closed')), 3000))]);
  await f.peer(second);
  const player = await f.join(first, 'Socket Player');
  await assert.rejects(f.peer(player), /WebSocket failed to open/, 'global socket ceiling rejects upgrade');
  peer.socket.send(JSON.stringify({ type: 'refresh', padding: 'x'.repeat(512) }));
  await Promise.race([peer.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('oversized frame not disconnected')), 3000))]);
  const rate = await fixture(t, { limits: { createPerMinute: 2 } });
  await rate.create();
  await rate.create();
  rejected(await rate.request('POST', '/rooms', admission({ settings: {} })), [429]);
});

test('lost admission responses recover one identity, rotate tokens and cannot resurrect removal', async t => {
  const f = await fixture(t);
  const createBody = admission({ settings: { topic: 'mix', capacity: 3, cycles: 1, answerSeconds: 0, predictSeconds: 0 } });
  const firstCreate = await f.request('POST', '/rooms', createBody);
  assert.equal(firstCreate.status, 201);
  const repeatedCreate = await f.request('POST', '/rooms', createBody);
  assert.ok([200, 201].includes(repeatedCreate.status));
  assert.equal(repeatedCreate.payload.code, firstCreate.payload.code, 'response-loss retry must not create another room');
  assert.equal(repeatedCreate.payload.memberId, firstCreate.payload.memberId);
  assert.notEqual(repeatedCreate.payload.token, firstCreate.payload.token, 'retry returns a fresh scoped token');
  const host = repeatedCreate.payload;
  rejected(await f.request('GET', `/rooms/${host.code}`, undefined, firstCreate.payload.token), [401, 403, 404]);
  rejected(await f.request('POST', '/rooms', { ...createBody, settings: { ...createBody.settings, capacity: 4 } }), [409]);
  const joinBody = admission({ nickname: 'Recovery Player', acceptRoomSharing: true });
  const joined = await Promise.all(Array.from({ length: 2 }, () => f.request('POST', `/rooms/${host.code}/join`, joinBody)));
  assert.ok(joined.every(result => [200, 201].includes(result.status)));
  assert.equal(joined[0].payload.memberId, joined[1].payload.memberId);
  assert.equal((await f.state(host)).players.length, 1, 'concurrent retry must enroll exactly once');
  rejected(await f.request('POST', `/rooms/${host.code}/join`, { ...joinBody, nickname: 'Different Player' }), [409]);
  const recoveryBody = { admissionId: joinBody.admissionId, recoverySecret: joinBody.recoverySecret };
  rejected(await f.request('POST', '/admissions/recover', { ...recoveryBody, recoverySecret: randomBytes(32).toString('base64url') }), [401, 403, 404]);
  let result = await f.request('POST', '/admissions/recover', recoveryBody);
  assert.equal(result.status, 200);
  const player = result.payload;
  const { peer } = await f.peer(player);
  const recovered = await Promise.all(Array.from({ length: 2 }, () => f.request('POST', '/admissions/recover', recoveryBody)));
  assert.ok(recovered.every(item => item.status === 200));
  assert.ok(recovered.every(item => item.payload.memberId === player.memberId));
  assert.notEqual(recovered[0].payload.token, recovered[1].payload.token);
  const authorization = await Promise.all(recovered.map(item => f.request('GET', `/rooms/${host.code}`, undefined, item.payload.token)));
  assert.equal(authorization.filter(item => item.status === 200).length, 1, 'only the latest recovery token may authorize');
  await Promise.race([peer.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('rotated token socket stayed open')), 3000))]);
  await f.ok(host, await f.state(host), 'kick', { playerId: player.memberId });
  rejected(await f.request('POST', '/admissions/recover', recoveryBody), [401, 403, 404, 410]);
  await f.advance(9 * 60 * 1000);
  const hostRecovery = { admissionId: createBody.admissionId, recoverySecret: createBody.recoverySecret };
  assert.equal((await f.request('POST', '/admissions/recover', hostRecovery)).status, 200);
  await f.advance(60 * 1000 + 1);
  rejected(await f.request('POST', '/admissions/recover', { admissionId: createBody.admissionId, recoverySecret: createBody.recoverySecret }), [401, 403, 404, 410]);
  rejected(await f.request('POST', '/rooms', createBody), [401, 403, 404, 409, 410]);
});

test('admission response-loss recovery survives local store restart and expires with its room', async t => {
  const f = await fixture(t, { persistent: true });
  const body = admission({ settings: { capacity: 2 } });
  const created = await f.request('POST', '/rooms', body);
  assert.equal(created.status, 201);
  await f.restart();
  const recovery = { admissionId: body.admissionId, recoverySecret: body.recoverySecret };
  const result = await f.request('POST', '/admissions/recover', recovery);
  assert.equal(result.status, 200);
  assert.equal(result.payload.code, created.payload.code);
  assert.notEqual(result.payload.token, created.payload.token);
  for (const file of await readdir(f.directory)) {
    const bytes = await readFile(join(f.directory, file));
    assert.equal(bytes.includes(Buffer.from(body.recoverySecret)), false, 'recovery capability must not persist in plaintext');
  }
  await f.advance(2 * 60 * 60 * 1000 + 1);
  rejected(await f.request('POST', '/admissions/recover', recovery), [401, 403, 404, 410]);
});

test('a closed room admission cannot recover a new host when its short code is reused', async t => {
  const f = await fixture(t);
  const body = admission({ settings: { capacity: 2 } });
  const created = await f.request('POST', '/rooms', body);
  assert.equal(created.status, 201);
  const oldHost = created.payload;
  assert.equal((await f.action(oldHost, oldHost.state, 'close')).status, 200);
  const replacement = createRoom({ capacity: 2 }, { code: oldHost.code, catalogue });
  await f.seedRoom(replacement.room);
  rejected(await f.request('POST', '/admissions/recover', { admissionId: body.admissionId, recoverySecret: body.recoverySecret }), [401, 403, 404, 410]);
  const current = await f.request('GET', `/rooms/${oldHost.code}`, undefined, replacement.token);
  assert.equal(current.status, 200, 'old admission must not rotate or seize replacement host credential');
  rejected(await f.request('GET', `/rooms/${oldHost.code}`, undefined, oldHost.token), [401, 403, 404]);
});

test('explicit close revokes snapshots and active subscriptions', async t => {
  const f = await fixture(t);
  const host = await f.create();
  const { peer } = await f.peer(host);
  const result = await f.action(host, await f.state(host), 'close');
  assert.equal(result.status, 200);
  assert.equal(result.payload.closed, true);
  assert.equal(result.payload.state, null);
  await Promise.race([peer.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('closed room socket stayed open')), 3000))]);
  rejected(await f.request('GET', `/rooms/${host.code}`, undefined, host.token), [404, 410]);
});

test('complete fixed-roster cycle gives equal opportunities and shared ties', async t => {
  const f = await fixture(t);
  const { host, guests, state } = await f.match(2);
  let current = state;
  const subjects = new Set();
  const prompts = new Set();
  for (let turn = 0; turn < 2; turn++) {
    subjects.add(current.round.subjectId);
    prompts.add(current.round.prompt.id);
    const subject = guests.find(member => member.memberId === current.round.subjectId);
    const predictor = guests.find(member => member !== subject);
    current = await f.ok(subject, current, 'answer', { value: 3 });
    current = await f.ok(predictor, current, 'guess', { value: 3 });
    current = await f.ok(host, current, 'next');
  }
  assert.equal(subjects.size, 2);
  assert.equal(prompts.size, 2);
  assert.equal(current.phase, 'finished');
  assert.equal(current.completion, 'complete');
  assert.ok(current.leaderboard.every(row => row.points === 100 && row.opportunities === 1 && row.accuracy === 100 && row.rank === 1));
});

test('late join and active leave cannot change a ranked roster or disclose unfinished answers', async t => {
  const f = await fixture(t);
  const host = await f.create({ capacity: 3 });
  const first = await f.join(host, 'First Player');
  const second = await f.join(host, 'Second Player');
  const started = await f.ok(host, await f.state(host), 'start');
  rejected(await f.request('POST', `/rooms/${host.code}/join`, admission({ nickname: 'Late Player', acceptRoomSharing: true })), [403, 409]);
  const subject = [first, second].find(member => member.memberId === started.round.subjectId);
  const other = [first, second].find(member => member !== subject);
  const answered = await f.ok(subject, started, 'answer', { value: 4 });
  const leave = await f.action(other, answered, 'leave');
  assert.equal(leave.status, 200);
  assert.equal(leave.payload.left, true);
  const finished = await f.state(host);
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.completion, 'incomplete');
  assert.ok(!finished.reveal || finished.reveal.answer == null);
  assert.ok(finished.leaderboard.every(row => row.rank == null), 'incomplete game must not declare a winner');
  rejected(await f.request('GET', `/rooms/${host.code}`, undefined, other.token), [401, 403, 404]);
});

test('pause preserves remaining deadline and a missing predictor receives zero once', async t => {
  const f = await fixture(t);
  const host = await f.create({ capacity: 2, answerSeconds: 30, predictSeconds: 30 });
  const guests = [await f.join(host, 'First Player'), await f.join(host, 'Second Player')];
  let current = await f.ok(host, await f.state(host), 'start');
  const subject = guests.find(member => member.memberId === current.round.subjectId);
  const predictor = guests.find(member => member !== subject);
  const original = current;
  current = await f.ok(subject, current, 'answer', { value: 4 });
  rejected(await f.action(host, current, 'pause', { expectedRevision: original.revision }), [409]);
  await f.advance(10_000);
  current = await f.ok(host, current, 'pause');
  assert.equal(current.round.paused, true);
  await f.advance(60_000);
  assert.equal((await f.state(host)).phase, 'predict');
  current = await f.ok(host, current, 'resume');
  await f.advance(19_999);
  assert.equal((await f.state(host)).phase, 'predict');
  await f.advance(2);
  const revealed = await f.state(host);
  assert.equal(revealed.phase, 'reveal');
  assert.equal(revealed.reveal.answer, 4);
  assert.equal(revealed.reveal.guesses.find(item => item.playerId === predictor.memberId).value, null);
  assert.equal(revealed.reveal.guesses.find(item => item.playerId === predictor.memberId).points, 0);
  assert.equal(revealed.leaderboard.find(item => item.playerId === predictor.memberId).opportunities, 1);
  await f.advance(60_000);
  assert.deepEqual((await f.state(host)).leaderboard, revealed.leaderboard);
});

test('subject timeout does not reveal or score an unanswered statement', async t => {
  const f = await fixture(t);
  const host = await f.create({ capacity: 2, answerSeconds: 30 });
  await f.join(host, 'First Player');
  await f.join(host, 'Second Player');
  await f.ok(host, await f.state(host), 'start');
  await f.advance(30_001);
  const revealed = await f.state(host);
  assert.equal(revealed.phase, 'reveal');
  assert.equal(revealed.reveal.valid, false);
  assert.equal(revealed.reveal.answer, null);
  assert.ok(revealed.leaderboard.every(row => row.points === 0 && row.opportunities === 0));
});

test('join, action, refresh and unauthenticated-connection bounds are enforced', async t => {
  const joins = await fixture(t, { limits: { joinPerMinute: 2 } });
  const host = await joins.create();
  await joins.join(host, 'First Player');
  await joins.join(host, 'Second Player');
  rejected(await joins.request('POST', `/rooms/${host.code}/join`, admission({ nickname: 'Third Player', acceptRoomSharing: true })), [429]);
  const actions = await fixture(t, { limits: { actionsPerMinute: 2 } });
  const controller = await actions.create();
  let current = await actions.ok(controller, controller.state, 'heartbeat');
  current = await actions.ok(controller, current, 'heartbeat');
  rejected(await actions.action(controller, current, 'heartbeat'), [429]);
  const admissionTimeout = await fixture(t, { limits: { authTimeoutMs: 50 } });
  const unauthenticated = await admissionTimeout.rawPeer();
  await Promise.race([unauthenticated.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('unauthenticated socket outlived configured admission timeout')), 1000))]);
  // The deliberately short silent-admission deadline is a separate concern.
  // Valid refresh authentication uses the normal policy without racing 50ms.
  const connections = await fixture(t, { limits: { refreshPerMinute: 2 },
    initialTimestamp: Math.floor(Date.now() / 60_000) * 60_000 + 1000 });
  const refreshHost = await connections.create();
  const { peer, message: initial } = await connections.peer(refreshHost);
  assert.equal(initial.type, 'state');
  let previousRevision = initial.state.revision;
  for (let index = 0; index < 2; index++) {
    // This host-only lobby stays within one rate window. Only this refresh's
    // presence touch can produce the exact next revision; unsolicited auth or
    // broadcast snapshots are not request acknowledgements.
    await connections.advance(5001);
    peer.socket.send(JSON.stringify({ type: 'refresh' }));
    const updated = await peer.wait(message => message.type === 'state' && message.state.revision === previousRevision + 1,
      3000, `refresh ${index + 1}`);
    previousRevision = updated.state.revision;
  }
  peer.socket.send(JSON.stringify({ type: 'refresh' }));
  const rejection = await peer.wait(message => message.type === 'error', 3000, 'refresh rejection');
  assert.equal(rejection.error?.code, 'rate_limited');
});

test('send budget includes already queued bytes and the next payload', () => {
  assert.equal(canSend(0, 100, 100), true);
  assert.equal(canSend(40, 60, 100), true);
  assert.equal(canSend(40, 61, 100), false);
  assert.equal(canSend(101, 0, 100), false);
  assert.equal(canSend(0, 101, 100), false);
});

test('load harness reports rejected WebSocket admission as aggregate failure without crashing', async t => {
  const f = await fixture(t, { limits: { maxSockets: 1 } });
  const child = spawn(process.execPath, [new URL('../scripts/load-test.mjs', import.meta.url).pathname, '--base-url', f.origin, '--rooms', '1', '--players', '2', '--rounds', '1', '--max-duration', '5'], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
  let output = '';
  let stderr = '';
  child.stdout.on('data', bytes => { output += bytes; assert.ok(output.length < 100_000, 'bounded aggregate output'); });
  child.stderr.on('data', bytes => { stderr += bytes; if (stderr.length > 10_000) stderr = stderr.slice(-10_000); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
  const exitCode = await new Promise(resolve => child.once('exit', resolve));
  clearTimeout(timer);
  assert.equal(exitCode, 1);
  assert.ok(!stderr.includes('UnhandledPromiseRejection'), 'failed upgrade must have handled promise rejection');
  const report = JSON.parse(output);
  assert.equal(report.completeWorkload, false);
  assert.equal(report.counts.socketsAuthenticated, 1);
  assert.ok(report.errors.roomWorkload >= 1);
});

test('counterfactual private answer and guess values produce identical unrelated projections', () => {
  const now = Date.now();
  let { room } = createRoom({ capacity: 3, answerSeconds: 0, predictSeconds: 0 }, { catalogue, now });
  for (let index = 0; index < 3; index++) room = joinRoom(room, { nickname: `Synthetic ${index + 1}`, acceptRoomSharing: true }, { now }).room;
  room = reduceRoom(room, 'host', { requestId: randomUUID(), matchId: room.matchId, action: 'start' }, { catalogue, now }).room;
  const subject = room.round.subjectId;
  const predictors = room.roster.filter(player => player.id !== subject).map(player => player.id);
  const answer = { requestId: randomUUID(), matchId: room.matchId, roundId: room.round.id, action: 'answer' };
  const low = reduceRoom(room, subject, { ...answer, value: 1 }, { catalogue, now }).room;
  const high = reduceRoom(room, subject, { ...answer, value: 5 }, { catalogue, now }).room;
  for (const viewer of ['host', ...predictors]) assert.deepEqual(project(low, viewer, { catalogue, now }), project(high, viewer, { catalogue, now }), 'unrelated projection must not depend on private answer');
  assert.equal(project(low, subject, { catalogue, now }).round.ownAnswer, 1);
  assert.equal(project(high, subject, { catalogue, now }).round.ownAnswer, 5);
  const guess = { requestId: randomUUID(), matchId: low.matchId, roundId: low.round.id, action: 'guess' };
  const lowGuess = reduceRoom(low, predictors[0], { ...guess, value: 1 }, { catalogue, now }).room;
  const highGuess = reduceRoom(low, predictors[0], { ...guess, value: 5 }, { catalogue, now }).room;
  for (const viewer of ['host', subject, predictors[1]]) assert.deepEqual(project(lowGuess, viewer, { catalogue, now }), project(highGuess, viewer, { catalogue, now }), 'unrelated projection must not depend on private guess');
});

const databaseURL = process.env.LIKERTS_LIVE_TEST_DATABASE_URL;
if (databaseURL) {
  const url = new URL(databaseURL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '54329' || url.pathname !== '/likerts_live_test' || url.search || url.hash) throw new Error('Independent Pg acceptance only permits the explicitly owned loopback fixture without connection overrides');
}

async function pgWorker(databaseURL, limits = {}) {
  const script = `
    import {readFile} from 'node:fs/promises';
    import {createInterface} from 'node:readline';
    import {createLiveServer} from ${JSON.stringify(new URL('../server/app.mjs', import.meta.url).href)};
    import {openStore} from ${JSON.stringify(new URL('../server/store.mjs', import.meta.url).href)};
    const catalogue=JSON.parse(await readFile(new URL(${JSON.stringify(new URL('../shared/catalogue.json', import.meta.url).href)}),'utf8'));
    const store=await openStore({databaseURL:process.env.LIKERTS_LIVE_TEST_DATABASE_URL,production:false});
    const app=await createLiveServer({store,catalogue,origins:['http://127.0.0.1'],allowNoOrigin:true,production:false,limits:${JSON.stringify(limits)}});
    const {origin}=await app.listen({host:'127.0.0.1',port:0});
    console.log(JSON.stringify({origin}));
    const stop=async()=>{await app.close();await store.close();process.exit(0)};
    createInterface({input:process.stdin}).on('line',line=>{if(line==='stop')stop()});
    process.on('SIGTERM',stop);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH, LIKERTS_LIVE_TEST_DATABASE_URL: databaseURL }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Drain stderr, but never print connection options or provider error internals.
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {});
  const exited = new Promise(resolve => child.once('exit', resolve));
  let closing;
  const close = () => closing ??= (async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    try { child.stdin.write('stop\n'); } catch {}
    let timer;
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000); })]);
    clearTimeout(timer);
  })();
  let origin;
  try {
    origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('isolated PostgreSQL worker startup timed out')), 10_000);
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => { try { const value = JSON.parse(line); if (value.origin) { clearTimeout(timer); resolve(value.origin); } } catch {} });
      child.once('error', () => { clearTimeout(timer); reject(new Error('isolated worker could not start')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('isolated PostgreSQL worker exited before readiness')); });
    });
  } catch (error) { await close(); throw error; }
  return { origin, close };
}

async function isolatedPgSchema(t) {
  const schema = `acceptance_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^[a-z][a-z0-9_]{1,62}$/);
  const pool = new pg.Pool({ connectionString: databaseURL, options: '', max: 1, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000, lock_timeout: 1000 });
  try { await pool.query(`CREATE SCHEMA "${schema}"`); } catch (error) { await pool.end(); throw error; }
  const url = new URL(databaseURL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const workers = [];
  t.after(async () => {
    await Promise.all(workers.map(worker => worker.close()));
    try { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await pool.end(); }
  });
  return { async worker(limits) { const worker = await pgWorker(url.toString(), limits); workers.push(worker); return worker; } };
}

test('isolated PostgreSQL: independent processes fan out, resume, serialize scores and revoke sockets', { skip: !databaseURL, timeout: 40_000 }, async t => {
  const scope = await isolatedPgSchema(t);
  const socketLimits = { maxSocketsPerMember: 1 };
  const firstWorker = await scope.worker(socketLimits);
  let secondWorker;
  try { secondWorker = await scope.worker(socketLimits); } catch (error) { await firstWorker.close(); throw error; }
  const first = await fixture(t, { externalOrigin: firstWorker.origin });
  const second = await fixture(t, { externalOrigin: secondWorker.origin });
  t.after(async () => { await firstWorker.close(); await secondWorker.close(); });
  const { host, guests, state } = await first.match();
  const subject = guests.find(member => member.memberId === state.round.subjectId);
  const predictors = guests.filter(member => member !== subject);
  const { peer } = await second.peer(host);
  const duplicateHostSocket = await first.peer(host);
  assert.equal(duplicateHostSocket.message.type, 'error', 'a second worker must not multiply the member socket allowance');
  assert.equal(duplicateHostSocket.message.error.code, 'connection_limit');
  const requestId = randomUUID();
  await first.ok(subject, state, 'answer', { value: 4 }, requestId);
  const remote = await peer.wait(message => message.type === 'state' && message.state.phase === 'predict');
  assertProjection(remote.state, host);
  assertProjection(await second.state(subject), subject, { answer: 4 });
  await firstWorker.close();
  const replacementWorker = await scope.worker(socketLimits);
  const replacement = await fixture(t, { externalOrigin: replacementWorker.origin });
  t.after(() => replacementWorker.close());
  assertProjection(await replacement.state(subject), subject, { answer: 4 });
  const predicting = await second.state(host);
  const results = await Promise.all([
    replacement.action(predictors[0], predicting, 'guess', { value: 4 }),
    second.action(predictors[1], predicting, 'guess', { value: 4 }),
    second.action(subject, state, 'answer', { value: 4 }, requestId),
  ]);
  assert.ok(results.every(result => result.status === 200));
  const revealed = await second.state(host);
  assert.equal(revealed.phase, 'reveal');
  assert.equal(revealed.reveal.guesses.length, 2);
  assert.ok(revealed.leaderboard.filter(row => row.playerId !== subject.memberId).every(row => row.points === 100 && row.opportunities === 1));
  const playerPeer = await second.peer(predictors[0]);
  await replacement.ok(host, revealed, 'kick', { playerId: predictors[0].memberId });
  await Promise.race([playerPeer.peer.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('cross-process revoked socket remained active')), 5000))]);
  rejected(await second.request('GET', `/rooms/${host.code}`, undefined, predictors[0].token), [401, 403, 404]);
  await replacement.ok(host, await replacement.state(host), 'close');
});

test('isolated PostgreSQL: HTTP admission and action budgets are shared across processes', { skip: !databaseURL, timeout: 30_000 }, async t => {
  const scope = await isolatedPgSchema(t);
  const limits = { createPerMinute: 2, actionsPerMinute: 2 };
  const firstWorker = await scope.worker(limits);
  let secondWorker;
  try { secondWorker = await scope.worker(limits); } catch (error) { await firstWorker.close(); throw error; }
  const first = await fixture(t, { externalOrigin: firstWorker.origin });
  const second = await fixture(t, { externalOrigin: secondWorker.origin });
  t.after(async () => { await firstWorker.close(); await secondWorker.close(); });
  const creations = await Promise.all([first, second, first].map(server => server.request('POST', '/rooms', admission({ settings: { capacity: 2 } }))));
  assert.deepEqual(creations.map(result => result.status).sort(), [201, 201, 429], 'multiple workers must share the allowance and return explicit throttling');
  const host = creations.find(result => result.status === 201).payload;
  const one = await first.action(host, host.state, 'heartbeat');
  const two = await second.action(host, host.state, 'heartbeat');
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  rejected(await first.action(host, host.state, 'heartbeat'), [429]);
});
