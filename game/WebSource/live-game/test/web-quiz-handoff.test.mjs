import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createQuizRoom, project } from '../server/engine.mjs';
import { LiveClient } from '../web/client.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { QuizLibrary } from '../web/quiz-library.mjs';
import { mountQuizApp } from '../web/quiz-ui.mjs';
import { createQuizLiveHandoff } from '../web/quiz-handoff.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const RESUME = 'likerts.live.resume.v1';
class TestClient extends LiveClient {
  connect() { this.connections = (this.connections ?? 0) + 1; this.setStatus('connected'); }
  catalogue() { return Promise.resolve({ topics: [] }); }
  dispose() { this.disposals = (this.disposals ?? 0) + 1; super.dispose(); }
}
function admission() {
  const room = createQuizRoom(sampleQuizDocument(), { capacity: 12 }, { now: Date.now() }).room;
  return { code: room.code, token: 'a'.repeat(43), memberId: 'host', state: project(room, 'host', { now: Date.now() }) };
}
async function fixture(t, { recovery = false, failedPersistence = false } = {}) {
  const dom = new JSDOM('<link rel="stylesheet" href="/play/quiz-styles.css"><link rel="stylesheet" href="/play/quiz-scene.css"><div id="app"></div>', { url: 'https://handoff-test.invalid/play/quizzes' });
  dom.window.scrollTo = () => {};
  const storage = createStorage(), reply = admission(), requests = [];
  const write = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (failedPersistence && key === RESUME) throw new Error('Quota exceeded'); write(key, value); };
  let lostReply = recovery;
  const client = new TestClient({ origin: dom.window.location.origin, storage, WebSocket: null, fetch: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (lostReply) { lostReply = false; throw new TypeError('Lost creation reply'); }
    return { ok: true, status: 200, json: async () => reply };
  } });
  if (recovery) await assert.rejects(client.createQuiz(sampleQuizDocument()), { code: 'connection_lost' });
  const data = createStorage(), library = new QuizLibrary({ storage: data, locks: data.locks });
  const root = dom.window.document.getElementById('app'); let app, operation, creatorDisposals = 0;
  const handoff = createQuizLiveHandoff({ client, root, window: dom.window, disposeCreator: () => { creatorDisposals++; app.dispose(); } });
  app = mountQuizApp({ root, library, window: dom.window,
    hostQuiz: quiz => operation = (async () => { await client.createQuiz(quiz); return handoff.open(); })(),
    liveAccess: () => client.pendingAdmissionHint ? { pending: true } : client.state || client.resumeHint ? { pending: false } : null,
    recoverLive: () => operation = (async () => { if (client.pendingAdmissionHint) await client.recoverAdmission(); return handoff.open(); })(),
  });
  t.after(() => { handoff.dispose(); dom.window.close(); });
  return { client, storage, root, handoff, dom, requests, reply, get creatorDisposals() { return creatorDisposals; },
    click(id) { const node = root.querySelector('#' + id); assert.ok(node, id); node.click(); }, operation: () => operation };
}

test('explicit Host live enters the admitted lobby directly with the same connected, persisted client', async t => {
  const f = await fixture(t); f.click('quiz-host-sample');
  assert.equal(f.requests.length, 0); assert.ok(f.root.querySelector('dialog'));
  f.click('quiz-confirm-action'); await f.operation();
  assert.equal(f.requests.length, 1); assert.match(f.requests[0].url, /\/rooms$/);
  assert.equal(f.client.state.code, f.reply.code); assert.equal(f.client.connections, 1);
  assert.ok(f.storage.getItem(RESUME)); assert.equal(f.client.persisted, true);
  assert.match(f.root.textContent, /Little wonders/); assert.ok(f.root.querySelector('#start-game'));
  assert.equal(f.root.querySelector('#resume-room'), null);
  assert.equal(f.dom.window.location.pathname, '/play'); assert.equal(f.creatorDisposals, 1);
  assert.equal(f.dom.window.document.querySelector('link[href="/play/quiz-styles.css"]'), null);
  assert.equal(f.dom.window.document.querySelectorAll('link[href="/play/quiz-scene.css"]').length, 1);
  f.handoff.dispose(); f.handoff.dispose(); assert.equal(f.client.disposals, 1); assert.equal(f.creatorDisposals, 1);
});

test('recovering a lost quiz creation reply enters its admitted lobby without a second creation or Resume', async t => {
  const f = await fixture(t, { recovery: true }); assert.equal(f.client.state, null);
  f.click('quiz-recover-live'); await f.operation();
  assert.deepEqual(f.requests.map(request => new URL(request.url).pathname), ['/api/live/rooms', '/api/live/admissions/recover']);
  assert.equal(f.client.state.code, f.reply.code); assert.equal(f.client.connections, 1);
  assert.ok(f.root.querySelector('#start-game')); assert.equal(f.root.querySelector('#resume-room'), null);
  assert.equal(f.dom.window.location.pathname, '/play'); assert.equal(f.creatorDisposals, 1);
});

test('admitted in-memory access stays usable when resume credential persistence fails', async t => {
  const f = await fixture(t, { failedPersistence: true }); f.click('quiz-host-sample'); f.click('quiz-confirm-action'); await f.operation();
  assert.equal(f.client.persisted, false); assert.equal(f.storage.getItem(RESUME), null);
  assert.ok(f.root.querySelector('#start-game')); assert.match(f.root.textContent, /could not save room access for a reload/);
  assert.equal(f.dom.window.location.pathname, '/play'); assert.equal(f.client.connections, 1);
});

test('saved access without admitted state navigates to explicit Resume without importing or resuming', async () => {
  const calls = [], client = { state: null, persisted: true, resumeHint: { code: 'ABC234' }, dispose() { calls.push('dispose-client'); }, resume() { calls.push('resume'); } };
  const handoff = createQuizLiveHandoff({ client, root: { ownerDocument: {} }, window: { location: { assign: path => calls.push(path) } },
    disposeCreator: () => calls.push('dispose-creator'), loadLive: () => { calls.push('import'); } });
  await handoff.open(); assert.deepEqual(calls, ['/play']);
  handoff.dispose(); handoff.dispose(); assert.deepEqual(calls, ['/play', 'dispose-creator', 'dispose-client']);
});

test('page disposal during the live import cancels mounting and releases the client once', async () => {
  let resolveImport, mounted = 0, clientDisposals = 0, creatorDisposals = 0;
  const waiting = new Promise(resolve => { resolveImport = resolve; });
  const handoff = createQuizLiveHandoff({ client: { state: {}, dispose() { clientDisposals++; } }, root: { ownerDocument: {} }, window: {},
    disposeCreator: () => creatorDisposals++, loadLive: () => waiting });
  const opened = handoff.open(); handoff.dispose();
  resolveImport({ mountLiveApp() { mounted++; } }); await opened;
  assert.equal(mounted, 0); assert.equal(clientDisposals, 1); assert.equal(creatorDisposals, 1);
});
