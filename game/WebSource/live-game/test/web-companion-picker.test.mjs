import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createRoom, createQuizRoom, joinRoom, reduceRoom, project } from '../server/engine.mjs';
import { LiveClient } from '../web/client.mjs';
import { mountLiveApp } from '../web/ui.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { partyGuide } from '../web/quiz-scene.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const companions = ['gather', 'question', 'locked', 'reveal', 'finished'].map(partyGuide);
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) { for (let attempt = 0; attempt < 40; attempt++) { if (predicate()) return; await flush(); } assert.ok(predicate(), 'Expected request to settle'); }
function game(mode) {
  const now = Date.now();
  let room = mode === 'quiz' ? createQuizRoom(sampleQuizDocument(), { capacity: 12 }, { now }).room
    : createRoom({ answerSeconds: 0, predictSeconds: 0 }, { catalogue, now }).room;
  const players = [];
  for (const nickname of ['Sam', 'NativeQA']) { const joined = joinRoom(room, { nickname, acceptRoomSharing: true }, { now }); room = joined.room; players.push(joined.memberId); }
  const state = (actor = players[0]) => project(room, actor, { catalogue, now });
  const command = (actor, body) => { room = reduceRoom(room, actor, body, { catalogue, now }).room; return state(actor); };
  const act = (actor, action, values = {}) => command(actor, { requestId: randomUUID(), matchId: room.matchId, action,
    ...(['next', 'pause', 'resume', 'skip', 'quiz-reveal'].includes(action) ? { roundId: room.round?.id } : {}), ...values });
  return { mode, players, state, act, get room() { return room; }, handle(actor, body) {
    try { return response({ state: command(actor, body) }); }
    catch (error) { return response({ error: { code: error.code, message: error.message } }, error.status || 400); }
  } };
}
class TestClient extends LiveClient { catalogue() { return Promise.resolve({ topics: [] }); } }
async function fixture(t, mode, { g = game(mode), actor = g.players[0], fetch, joined = true } = {}) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://character-test.invalid/play' }); dom.window.scrollTo = () => {};
  const requests = [], storage = createStorage();
  const client = new TestClient({ origin: dom.window.location.origin, WebSocket: null, storage, fetch: (url, options) => {
    const request = { url, body: options.body ? JSON.parse(options.body) : null }; requests.push(request);
    return fetch ? fetch(request, g, actor) : g.handle(actor, request.body);
  } });
  function adopt(state) {
    client.credential = { version: 1, code: state.code, memberId: state.self.id, token: 'a'.repeat(43), expiresAt: state.expiresAt };
    client.acceptState(state);
  }
  if (joined) adopt(g.state(actor));
  const root = dom.window.document.getElementById('app'), app = mountLiveApp({ root, client, window: dom.window });
  await flush(); t.after(() => { app.dispose(); dom.window.close(); });
  const get = id => root.querySelector('#' + id), click = id => { assert.ok(get(id), id); get(id).click(); };
  return { g, actor, dom, root, app, client, storage, requests, get, click, adopt,
    picker: () => root.querySelector('.companion-picker'), choices: () => [...root.querySelectorAll('.companion-choice')],
    selected: () => root.querySelector('.companion-choice[aria-pressed="true"]')?.id };
}

for (const mode of ['mindreading', 'quiz']) {
  test(mode + ': only joined players receive five named, decorative, native-button character choices', async t => {
    const f = await fixture(t, mode), host = await fixture(t, mode, { g: f.g, actor: 'host' });
    assert.equal(f.get('companion-heading').textContent, 'Choose your character');
    assert.match(f.picker().textContent, /Visible to this room\. Every character uses the same rules\./);
    assert.equal(f.choices().length, 5); assert.equal(f.selected(), 'companion-choice-1');
    for (const [index, button] of f.choices().entries()) {
      assert.equal(button.tagName, 'BUTTON'); assert.equal(button.type, 'button');
      assert.equal(button.getAttribute('aria-label'), 'Choose ' + companions[index].characterName);
      assert.equal(button.getAttribute('aria-pressed'), String(index === 0));
      const portrait = button.querySelector('.quiz-guide-character'); assert.equal(portrait.getAttribute('aria-hidden'), 'true');
      assert.equal(portrait.dataset.guideCharacter, String(index + 1));
      assert.equal(button.querySelector('[data-quiz-entrance]'), null);
    }
    assert.equal(host.picker(), null); assert.ok(host.root.querySelector('.player-list')); assert.equal(f.requests.length, 0);
    const empty = await fixture(t, mode, { joined: false }); empty.click('choose-join');
    assert.equal(empty.picker(), null); assert.ok(empty.get('room-code')); assert.ok(empty.get('nickname')); assert.equal(empty.requests.length, 0);
    const pending = empty.client.newAdmission('join', { code: f.g.room.code, nickname: 'Ari', acceptRoomSharing: true });
    assert.deepEqual(Object.keys(pending.payload).sort(), ['acceptRoomSharing', 'code', 'nickname']);
  });

  test(mode + ': selection remains authoritative during a held reply, blocks additional choices and restores keyboard focus after ACK', async t => {
    const held = gate(); let reply;
    const f = await fixture(t, mode, { fetch: (request, g, actor) => { reply = g.handle(actor, request.body); return held.promise; } });
    const choice = f.get('companion-choice-3'); choice.focus(); assert.equal(f.dom.window.document.activeElement, choice); choice.click();
    await until(() => f.requests.length === 1);
    assert.equal(f.selected(), 'companion-choice-1'); assert.match(f.picker().textContent, /Current character: Ember/);
    assert.ok(f.choices().every(button => button.disabled)); assert.equal(f.client.pendingAction.action, 'choose-avatar');
    assert.equal(f.picker().querySelector('.companion-pending').getAttribute('aria-live'), 'polite');
    assert.deepEqual(Object.keys(f.requests[0].body).sort(), ['action', 'matchId', 'requestId', 'value']);
    f.click('companion-choice-4'); assert.equal(f.requests.length, 1);
    held.resolve(reply); await until(() => !f.client.pendingAction && !f.app.model.busy); await flush();
    assert.equal(f.selected(), 'companion-choice-3'); assert.match(f.picker().textContent, /Current character: Twist/);
    assert.equal(f.dom.window.document.activeElement.id, 'companion-choice-3');
    assert.ok(f.choices().every(button => !button.disabled)); assert.equal(f.client.pendingAdmissionHint, null);
  });

  test(mode + ': an already-matching avatar plus Start/rematch projections cannot acknowledge an in-flight request', async t => {
    const held = gate(); let reply;
    const f = await fixture(t, mode, { fetch: (request, g, actor) => { reply = g.handle(actor, request.body); return held.promise; } });
    let settled = false; const choosing = f.client.action('choose-avatar', { value: 1 }); choosing.then(() => { settled = true; });
    const original = structuredClone(f.client.pendingAction);
    f.client.acceptState(f.g.state()); await flush(); assert.equal(settled, false); assert.equal(f.client.busy, true);
    f.g.act('host', 'start'); f.client.acceptState(f.g.state()); assert.equal(f.picker(), null);
    assert.deepEqual(f.client.pendingAction, original); assert.equal(f.client.busy, true);
    f.g.act('host', 'end'); f.client.acceptState(f.g.state()); f.g.act('host', 'rematch'); f.client.acceptState(f.g.state()); await flush();
    assert.notEqual(f.client.state.matchId, original.matchId); assert.equal(settled, false);
    assert.deepEqual(f.client.pendingAction, original); assert.ok(f.choices().every(button => button.disabled));
    held.resolve(reply); await choosing; assert.equal(settled, true); assert.equal(f.client.pendingAction, null);
    assert.equal(f.client.state.matchId, f.g.room.matchId); assert.equal(f.selected(), 'companion-choice-1');
  });

  test(mode + ': a lost accepted reply keeps its UUID across projection changes, Start and rematch until exact retry', async t => {
    let lost = false;
    const f = await fixture(t, mode, { fetch: (request, g, actor) => {
      const reply = g.handle(actor, request.body); if (!lost) { lost = true; throw new TypeError('Lost reply'); } return reply;
    } });
    f.get('companion-choice-4').focus(); f.click('companion-choice-4'); await until(() => !!f.get('retry-action')); await flush();
    const pending = structuredClone(f.client.pendingAction); assert.equal(f.selected(), 'companion-choice-1');
    assert.equal(f.dom.window.document.activeElement.id, 'retry-action');
    f.client.acceptState(f.g.state()); assert.equal(f.selected(), 'companion-choice-4'); assert.deepEqual(f.client.pendingAction, pending);
    f.g.act('host', 'start'); f.client.acceptState(f.g.state()); f.g.act('host', 'end'); f.client.acceptState(f.g.state());
    f.g.act('host', 'rematch'); f.client.acceptState(f.g.state()); assert.deepEqual(f.client.pendingAction, pending);
    assert.ok(f.choices().every(button => button.disabled)); f.get('retry-action').focus(); f.click('retry-action'); await until(() => !f.client.pendingAction && !f.app.model.busy); await flush();
    assert.deepEqual(f.requests[0].body, f.requests[1].body); assert.equal(f.requests.length, 2);
    assert.equal(f.selected(), 'companion-choice-4'); assert.equal(f.client.state.matchId, f.g.room.matchId);
    assert.equal(f.dom.window.document.activeElement.id, 'companion-choice-4');
  });

  test(mode + ': a lost unaccepted request retries exactly and reports stale match without applying into the new lobby', async t => {
    let lost = false;
    const f = await fixture(t, mode, { fetch: (request, g, actor) => { if (!lost) { lost = true; throw new TypeError('Request never arrived'); } return g.handle(actor, request.body); } });
    f.click('companion-choice-5'); await until(() => !!f.get('retry-action'));
    f.g.act('host', 'start'); f.client.acceptState(f.g.state()); f.g.act('host', 'end'); f.g.act('host', 'rematch'); f.client.acceptState(f.g.state());
    assert.ok(f.client.pendingAction); f.get('retry-action').focus(); f.click('retry-action'); await until(() => !f.client.pendingAction && !f.app.model.busy); await flush();
    assert.deepEqual(f.requests[0].body, f.requests[1].body); assert.equal(f.selected(), 'companion-choice-1');
    assert.match(f.root.querySelector('[role="alert"]').textContent, /Refresh this room/); assert.equal(f.client.pendingAdmissionHint, null);
    assert.equal(f.dom.window.document.activeElement.id, 'companion-choice-1');
  });

  test(mode + ': locked lobbies allow duplicate choices, host roster updates, and the character survives Start/rematch', async t => {
    const g = game(mode); g.act('host', 'lock', { locked: true });
    const f = await fixture(t, mode, { g }), host = await fixture(t, mode, { g, actor: 'host' });
    f.click('companion-choice-2'); await until(() => !f.client.pendingAction && !f.app.model.busy);
    assert.equal(f.client.state.joinLocked, true); assert.equal(f.selected(), 'companion-choice-2');
    assert.equal(f.client.state.players[0].avatar, f.client.state.players[1].avatar);
    host.client.acceptState(g.state('host')); assert.equal(host.picker(), null);
    const sam = [...host.root.querySelectorAll('.player-row')].find(row => row.textContent.includes('Sam'));
    assert.match(sam.querySelector('img').getAttribute('src'), /totem-2\.png$/);
    g.act('host', 'start'); f.client.acceptState(g.state()); assert.equal(f.picker(), null);
    assert.equal(g.room.roster.find(player => player.id === f.actor).avatar, 2);
    g.act('host', 'end'); f.client.acceptState(g.state()); assert.equal(f.picker(), null);
    g.act('host', 'rematch'); f.client.acceptState(g.state()); assert.equal(f.selected(), 'companion-choice-2'); assert.equal(f.client.state.joinLocked, true);
  });
}

test('exact receipt replay may confirm a request while projecting a newer different character', async t => {
  let lost = false;
  const f = await fixture(t, 'quiz', { fetch: (request, g, actor) => { const reply = g.handle(actor, request.body); if (!lost) { lost = true; throw new TypeError('Lost reply'); } return reply; } });
  f.click('companion-choice-3'); await until(() => !!f.get('retry-action'));
  f.g.act(f.actor, 'choose-avatar', { value: 5 }); f.client.acceptState(f.g.state());
  assert.equal(f.selected(), 'companion-choice-5'); assert.equal(f.client.pendingAction.value, 3);
  f.click('retry-action'); await until(() => !f.client.pendingAction && !f.app.model.busy);
  assert.equal(f.selected(), 'companion-choice-5'); assert.match(f.picker().textContent, /Current character: Moss/);
  assert.deepEqual(f.requests[0].body, f.requests[1].body);
});

test('an unsupported old server reports the optional feature error without changing character or creating admission', async t => {
  const f = await fixture(t, 'quiz', { fetch: () => response({ error: { code: 'invalid_action', message: 'This action is not supported.' } }, 400) });
  const saved = f.storage.getItem('likerts.live.resume.v1'); f.get('companion-choice-3').focus(); f.click('companion-choice-3');
  await until(() => f.requests.length === 1 && !f.app.model.busy); await flush();
  assert.equal(f.selected(), 'companion-choice-1'); assert.equal(f.client.pendingAction, null); assert.equal(f.client.pendingAdmissionHint, null);
  assert.equal(f.storage.getItem('likerts.live.resume.v1'), saved); assert.equal(f.storage.getItem('likerts.live.admission.v1'), null);
  assert.match(f.root.querySelector('[role="alert"]').textContent, /does not support character choices yet/);
  assert.equal(f.dom.window.document.activeElement.id, 'companion-choice-3');
  assert.ok(f.requests[0].url.endsWith('/actions')); assert.equal(f.requests.length, 1);
});

test('a detached picker from another room cannot send a choice into the current lobby', async t => {
  const f = await fixture(t, 'quiz'), old = f.get('companion-choice-4'), other = game('quiz');
  f.adopt(other.state()); old.click(); await flush(); assert.equal(f.requests.length, 0);
  assert.equal(f.client.state.code, other.room.code); assert.equal(f.selected(), 'companion-choice-1');
  assert.match(f.root.textContent, /The room changed/);
});

test('moving focus outside the picker while waiting prevents focus restoration from stealing it back', async t => {
  const held = gate(); let reply;
  const f = await fixture(t, 'mindreading', { fetch: (request, g, actor) => { reply = g.handle(actor, request.body); return held.promise; } });
  f.get('companion-choice-3').focus(); f.click('companion-choice-3');
  const privacy = f.root.querySelector('.privacy summary'); privacy.focus();
  held.resolve(reply); await until(() => !f.client.pendingAction && !f.app.model.busy); await flush();
  assert.notEqual(f.dom.window.document.activeElement.id, 'companion-choice-3');
});
