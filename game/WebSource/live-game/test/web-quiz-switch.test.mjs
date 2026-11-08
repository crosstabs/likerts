import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createQuizRoom, createRoom, joinRoom, reduceRoom, project } from '../server/engine.mjs';
import { LiveClient } from '../web/client.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { mountLiveApp } from '../web/ui.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const RESUME = 'likerts.live.resume.v1', ADMISSION = 'likerts.live.admission.v1';
const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const reply = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
const rejected = status => reply({ error: { code: 'request_failed', message: 'The close was not confirmed.' } }, status);
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(predicate) { for (let index = 0; index < 40; index++) { if (predicate()) return; await flush(); } assert.ok(predicate(), 'Expected async UI operation to settle'); }
function game(completion = 'complete') {
  const now = Date.now(); let room = createQuizRoom(sampleQuizDocument(), { capacity: 12 }, { now }).room;
  const players = [];
  for (const nickname of ['Sam', 'WebQA']) { const joined = joinRoom(room, { nickname, acceptRoomSharing: true }, { now }); room = joined.room; players.push(joined.memberId); }
  const state = (actor = 'host') => project(room, actor, { now });
  const act = (action, values = {}) => {
    const result = reduceRoom(room, 'host', { requestId: randomUUID(), matchId: room.matchId, ...(room.round ? { roundId: room.round.id } : {}), action, ...values }, { now });
    room = result.room; return state();
  };
  if (completion !== 'lobby') {
    act('start');
    if (completion === 'incomplete') act('end');
    else while (room.phase !== 'finished') { act('quiz-reveal'); act('next'); }
  }
  return { state, act, players, now, get room() { return room; }, command(body) {
    if (!room) return rejected(404);
    const result = reduceRoom(room, 'host', body, { now }); room = result.room;
    return reply(result.closed ? { state: null, closed: true } : { state: state() });
  } };
}
class TestClient extends LiveClient {
  connect() { this.connections = (this.connections ?? 0) + 1; this.setStatus('connected'); }
  catalogue() { return Promise.resolve({ topics: [] }); }
}
async function fixture(t, { completion = 'complete', actor = 'host', initial, fetch } = {}) {
  const g = game(completion), storage = createStorage(), requests = [], navigations = [];
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://quiz-switch-test.invalid/play' }); dom.window.scrollTo = () => {};
  const client = new TestClient({ origin: dom.window.location.origin, WebSocket: null, storage,
    fetch: async (url, options) => {
      const request = { url, method: options.method, body: options.body ? JSON.parse(options.body) : null };
      requests.push(request); return fetch ? fetch(request, g) : g.command(request.body);
    } });
  const root = dom.window.document.getElementById('app');
  function adopt(state) {
    client.credential = { version: 1, code: state.code, memberId: state.self.id, token: 'a'.repeat(43), expiresAt: state.expiresAt };
    client.acceptState(state);
  }
  adopt(initial ?? g.state(actor));
  const app = mountLiveApp({ root, client, window: dom.window, navigate: path => navigations.push(path) });
  await flush(); t.after(() => { app.dispose(); dom.window.close(); });
  const get = id => root.querySelector('#' + id);
  function click(id) { assert.ok(get(id), id); get(id).click(); }
  function choose() { click('choose-another-quiz'); click('confirm-accept'); }
  return { g, client, storage, dom, root, app, requests, navigations, adopt, get, click, choose };
}

for (const completion of ['complete', 'incomplete']) {
  test(completion + ': another quiz is secondary to Rematch, cancel does not close, and Rematch keeps its room', async t => {
    const f = await fixture(t, { completion }), code = f.client.state.code;
    const rematch = f.get('rematch'), choose = f.get('choose-another-quiz');
    assert.ok(rematch.compareDocumentPosition(choose) & f.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(choose.classList.contains('text-button')); assert.ok(rematch.classList.contains('button')); assert.equal(rematch.classList.contains('outlined'), false);
    choose.focus(); f.click('choose-another-quiz');
    assert.equal(f.get('confirm-title').textContent, 'Choose another quiz?');
    assert.equal(f.get('confirm-body').textContent, 'This closes the current room. Everyone will rejoin your new quiz with a new code.');
    assert.equal(f.get('confirm-accept').textContent, 'Close room and choose quiz');
    f.click('confirm-cancel'); await flush();
    assert.equal(f.requests.length, 0); assert.equal(f.dom.window.document.activeElement.id, 'choose-another-quiz');
    f.click('rematch'); await until(() => f.client.state.phase === 'lobby');
    assert.equal(f.client.state.code, code); assert.equal(f.requests[0].body.action, 'rematch'); assert.deepEqual(f.navigations, []);
  });

  test(completion + ': a held exact close acknowledgement is required before clearing access and opening Quizzes', async t => {
    const held = gate(); let serverReply;
    const f = await fixture(t, { completion, fetch: (request, g) => { serverReply = g.command(request.body); return held.promise; } });
    const code = f.client.state.code, matchId = f.client.state.matchId;
    f.choose(); await until(() => f.requests.length === 1);
    assert.equal(f.client.pendingAction.action, 'close'); assert.equal(f.client.busy, true);
    assert.ok(f.client.state); assert.ok(f.client.credential); assert.ok(f.storage.getItem(RESUME)); assert.deepEqual(f.navigations, []);
    assert.deepEqual(Object.keys(f.requests[0].body).sort(), ['action', 'matchId', 'requestId']);
    assert.equal(f.requests[0].body.matchId, matchId); assert.ok(f.requests[0].url.includes(code));
    held.resolve(serverReply); await until(() => f.navigations.length === 1);
    assert.deepEqual(f.navigations, ['/play/quizzes']);
    assert.equal(f.client.state, null); assert.equal(f.client.credential, null); assert.equal(f.client.pendingAction, null);
    assert.equal(f.client.pendingAdmission, null); assert.equal(f.client.resumeHint, null); assert.equal(f.client.pendingAdmissionHint, null);
    assert.equal(f.storage.getItem(RESUME), null); assert.equal(f.storage.getItem(ADMISSION), null);
    assert.equal(f.g.room, null);
  });
}

test('Stay here remains available while busy and invalidates navigation without cancelling the remote close', async t => {
  const held = gate(); let serverReply;
  const f = await fixture(t, { fetch: (request, g) => { serverReply = g.command(request.body); return held.promise; } });
  f.choose(); await until(() => f.client.busy);
  const requestId = f.client.pendingAction.requestId;
  assert.match(f.root.textContent, /The room may still close\. Stay here instead of opening Quizzes\./);
  assert.equal(f.get('stay-after-quiz-close').disabled, false);
  f.click('stay-after-quiz-close'); assert.equal(f.client.pendingAction.requestId, requestId); assert.equal(f.client.busy, true);
  held.resolve(serverReply); await until(() => f.client.state === null); await flush();
  assert.deepEqual(f.navigations, []); assert.equal(f.storage.getItem(RESUME), null); assert.equal(f.requests.length, 1);
});

for (const status of [400, 403, 404, 410]) {
  test('HTTP ' + status + ' never substitutes for an explicit close acknowledgement', async t => {
    const f = await fixture(t, { fetch: () => rejected(status) });
    f.choose(); await until(() => !f.app.model.busy && f.requests.length > 0); await flush();
    assert.deepEqual(f.navigations, []); assert.ok(f.root.querySelector('[role="alert"]'));
    if (status !== 400) { assert.equal(f.client.state, null); assert.equal(f.client.credential, null); }
    else assert.equal(f.client.state.phase, 'finished');
  });
}

test('a lost close reply keeps its exact retry identity but generic recovery never opens Quizzes', async t => {
  let dropped = false;
  const f = await fixture(t, { fetch: (request, g) => {
    const result = g.command(request.body);
    if (!dropped) { dropped = true; throw new TypeError('Lost close reply'); }
    return result;
  } });
  f.choose(); await until(() => !!f.get('retry-action'));
  assert.ok(f.client.pendingAction); assert.deepEqual(f.navigations, []);
  f.click('retry-action'); await until(() => f.client.state === null); await flush();
  assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[0].body, f.requests[1].body);
  assert.equal(f.client.pendingAction, null); assert.deepEqual(f.navigations, []);
});

for (const changed of ['match', 'room']) {
  test('a stale ' + changed + ' confirmation cannot close the current room', async t => {
    const f = await fixture(t); f.click('choose-another-quiz');
    if (changed === 'match') f.client.acceptState(f.g.act('rematch'));
    else f.adopt(game().state());
    f.click('confirm-accept'); await flush();
    assert.equal(f.requests.length, 0); assert.deepEqual(f.navigations, []); assert.match(f.root.textContent, /The room changed/);
  });
}

test('an authoritative match change while closing invalidates the navigation intent', async t => {
  const held = gate(); const f = await fixture(t, { fetch: () => held.promise });
  f.choose(); const next = f.g.act('rematch'); f.client.acceptState(next);
  await until(() => !f.client.busy);
  held.resolve(reply({ state: null, closed: true })); await flush();
  assert.equal(f.client.state.matchId, next.matchId); assert.equal(f.client.state.phase, 'lobby'); assert.deepEqual(f.navigations, []);
});

test('a late old-room close cannot consume a newer room’s pending choice or navigation intent', async t => {
  const first = gate(), second = gate(); let requests = 0;
  const f = await fixture(t, { fetch: () => (++requests === 1 ? first.promise : second.promise) });
  f.choose(); const oldId = f.client.pendingAction.requestId;
  f.client.clearLocal(); const newer = game(); f.adopt(newer.state());
  f.choose(); const newId = f.client.pendingAction.requestId;
  assert.notEqual(oldId, newId);
  first.resolve(reply({ state: null, closed: true })); await flush(); await flush();
  assert.equal(f.client.state.code, newer.state().code); assert.equal(f.client.pendingAction.requestId, newId); assert.deepEqual(f.navigations, []);
  second.resolve(reply({ state: null, closed: true })); await until(() => f.navigations.length === 1);
  assert.deepEqual(f.navigations, ['/play/quizzes']);
});

test('confirmed remote close with failed local credential removal stays here and exposes cleanup', async t => {
  const held = gate(); const f = await fixture(t, { fetch: () => held.promise });
  f.choose(); f.storage.failWrite = true;
  held.resolve(reply({ state: null, closed: true })); await until(() => !f.app.model.busy && f.client.state === null); await flush();
  assert.deepEqual(f.navigations, []); assert.ok(f.client.resumeHint); assert.ok(f.get('forget-room'));
  assert.match(f.root.textContent, /The room closed, but this tab could not remove saved access/);
  f.storage.failWrite = false; f.click('forget-room'); f.click('confirm-accept'); await until(() => f.client.resumeHint === null); await flush();
  assert.deepEqual(f.navigations, []); assert.equal(f.storage.getItem(RESUME), null);
  f.client.fetcher = async () => { throw new TypeError('Later admission failed'); };
  f.click('choose-host'); f.click('create-room'); await until(() => !!f.client.pendingAdmissionHint); await flush();
  assert.equal(f.get('clear-closed-quiz-access'), null, 'Old close cleanup must not become a shortcut for removing a new pending admission');
});

test('admission-only deletion failure exposes retryable cleanup even after the resume key was removed', async t => {
  const held = gate(), f = await fixture(t, { fetch: () => held.promise });
  const staging = new TestClient({ origin: 'https://quiz-switch-test.invalid', storage: createStorage(), WebSocket: null });
  const pending = staging.newAdmission('create', { mode: 'quiz', modeVersion: 1, quiz: sampleQuizDocument(), settings: { capacity: 12 } });
  f.storage.setItem(ADMISSION, JSON.stringify(pending)); staging.dispose();
  const remove = f.storage.removeItem.bind(f.storage); let blocked = true;
  f.storage.removeItem = key => { if (blocked && key === ADMISSION) throw new Error('Admission deletion denied'); remove(key); };
  f.choose(); held.resolve(reply({ state: null, closed: true })); await until(() => !!f.get('clear-closed-quiz-access'));
  assert.equal(f.client.resumeHint, null); assert.ok(f.client.pendingAdmissionHint); assert.equal(f.get('forget-room'), null);
  assert.deepEqual(f.navigations, []);
  f.click('clear-closed-quiz-access'); await flush(); assert.ok(f.get('clear-closed-quiz-access')); assert.ok(f.client.pendingAdmissionHint);
  blocked = false; f.click('clear-closed-quiz-access'); await until(() => f.client.pendingAdmissionHint === null); await flush();
  assert.equal(f.storage.getItem(RESUME), null); assert.equal(f.storage.getItem(ADMISSION), null); assert.deepEqual(f.navigations, []);
  assert.equal(f.get('clear-closed-quiz-access'), null);
});

test('disposal while awaiting close prevents late navigation', async t => {
  const held = gate(); const f = await fixture(t, { fetch: () => held.promise });
  f.choose(); f.app.dispose(); held.resolve(reply({ state: null, closed: true })); await flush(); await flush();
  assert.deepEqual(f.navigations, []);
});

for (const value of [{ state: null, left: true }, { state: null, closed: true, left: true }, { state: null, closed: 'true' }, { closed: true }]) {
  test('a malformed or non-close terminal reply cannot issue a close receipt: ' + JSON.stringify(value), async t => {
    const f = await fixture(t, { fetch: () => reply(value) }); f.choose(); await until(() => !!f.get('retry-action'));
    assert.deepEqual(f.navigations, []); assert.ok(f.client.state); assert.ok(f.client.credential); assert.ok(f.client.pendingAction);
  });
}

test('a refresh404 racing the held close cannot erase its explicit acknowledgement', async t => {
  const refreshReply = gate(), closeReply = gate();
  const f = await fixture(t, { fetch: request => request.method === 'GET' ? refreshReply.promise : closeReply.promise });
  const refreshing = f.client.refresh(); f.choose();
  refreshReply.resolve(rejected(404)); await refreshing;
  assert.ok(f.client.state); assert.ok(f.client.pendingAction); assert.deepEqual(f.navigations, []);
  closeReply.resolve(reply({ state: null, closed: true })); await until(() => f.navigations.length === 1);
});

test('receipt-close pauses the socket and ignores an already-queued old socket update', async t => {
  class Socket {
    constructor() { this.readyState = 1; }
    send() {}
    close() { this.closed = true; this.readyState = 3; }
  }
  const held = gate(), f = await fixture(t, { fetch: () => held.promise });
  f.client.Socket = Socket; LiveClient.prototype.connect.call(f.client);
  const socket = f.client.socket, queuedMessage = socket.onmessage, matchId = f.client.state.matchId;
  f.choose(); assert.equal(socket.closed, true); assert.equal(f.client.pollTimer, null); assert.equal(f.client.socket, null);
  const update = f.g.act('rematch'); queuedMessage({ data: JSON.stringify({ type: 'state', state: update }) });
  assert.equal(f.client.state.matchId, matchId); assert.ok(f.client.pendingAction); assert.deepEqual(f.navigations, []);
  held.resolve(reply({ state: null, closed: true })); await until(() => f.navigations.length === 1);
});

test('a rejected receipt-close restores the real transport setup for the retained room', async t => {
  class Socket {
    constructor() { this.readyState = 1; }
    send() {}
    close() { this.closed = true; this.readyState = 3; }
  }
  const held = gate(), f = await fixture(t, { fetch: () => held.promise });
  f.client.Socket = Socket; f.client.connect = () => LiveClient.prototype.connect.call(f.client); f.client.connect();
  const original = f.client.socket; f.choose(); assert.equal(original.closed, true);
  held.resolve(rejected(400)); await until(() => f.client.socket !== null && f.client.socket !== original);
  assert.ok(f.client.pollTimer); assert.ok(f.client.watchdogTimer); assert.ok(f.client.credential);
  assert.equal(f.client.pendingAction, null); assert.deepEqual(f.navigations, []);
});

test('players, unfinished quizzes and legacy live rooms never gain the host quiz-selection action', async t => {
  const playerGame = game(); const player = await fixture(t, { initial: playerGame.state(playerGame.players[0]) });
  const lobby = await fixture(t, { completion: 'lobby' });
  const legacyRoom = createRoom({}, { catalogue, now: Date.now() }).room;
  const legacy = await fixture(t, { initial: project(legacyRoom, 'host', { catalogue, now: Date.now() }) });
  for (const f of [player, lobby, legacy]) assert.equal(f.get('choose-another-quiz'), null);
});

test('close receipts are immutable, tied to the actual request, and opt-in; ordinary close still returns null', async t => {
  const first = await fixture(t), code = first.client.state.code, matchId = first.client.state.matchId;
  const receipt = await first.client.action('close', {}, { terminalReceipt: true });
  assert.deepEqual(receipt, { action: 'close', code, matchId, requestId: first.requests[0].body.requestId, closed: true, accessCleared: true });
  assert.equal(Object.isFrozen(receipt), true);
  const second = await fixture(t); assert.equal(await second.client.action('close'), null);
});
