import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createQuizRoom, joinRoom, reduceRoom, project, DURATIONS } from '../server/engine.mjs';
import { LiveClient } from '../web/client.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { mountLiveApp } from '../web/ui.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const notice = 'Host disconnected. Timed questions continue on the server.';
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let index = 0; index < 40; index++) { if (predicate()) return; await flush(); } assert.ok(predicate(), 'Expected request to settle'); }
function game(seconds) {
  const now = Date.now(), quiz = sampleQuizDocument(); quiz.questions[0].timeLimitSeconds = seconds;
  let room = createQuizRoom(quiz, { capacity: 12 }, { now }).room;
  const players = [];
  for (const nickname of ['Sam', 'NativeQA']) { const joined = joinRoom(room, { nickname, acceptRoomSharing: true }, { now }); room = joined.room; players.push(joined.memberId); }
  const act = (actor, action, values = {}) => {
    room = reduceRoom(room, actor, { requestId: randomUUID(), matchId: room.matchId, ...(room.round ? { roundId: room.round.id } : {}), action, ...values }, { now }).room;
  };
  act('host', 'start');
  return { players, act, state(actor = players[0], disconnected = true) { return project(room, actor, { now: now + (disconnected ? DURATIONS.presence + 1 : 0) }); } };
}
class TestClient extends LiveClient { catalogue() { return Promise.resolve({ topics: [] }); } }
async function fixture(t, state, fetch = () => { throw new Error('No request expected'); }) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://disconnect-test.invalid/play' }); dom.window.scrollTo = () => {};
  const client = new TestClient({ origin: dom.window.location.origin, WebSocket: null, storage: createStorage(), fetch });
  client.credential = { version: 1, code: state.code, memberId: state.self.id, token: 'a'.repeat(43), expiresAt: state.expiresAt };
  client.acceptState(state); const root = dom.window.document.getElementById('app'), app = mountLiveApp({ root, client, window: dom.window });
  await flush(); t.after(() => { app.dispose(); dom.window.close(); });
  return { root, client, get: id => root.querySelector('#' + id), notice: () => [...root.querySelectorAll('.message')].find(node => node.textContent === notice) };
}

for (const seconds of [0, 60]) {
  test((seconds ? 'timed' : 'untimed') + ': disconnected host, unlocked player and local draft never claim an answer is saved', async t => {
    const g = game(seconds), host = await fixture(t, g.state('host')), player = await fixture(t, g.state());
    for (const f of [host, player]) {
      assert.equal(f.client.state.hostConnected, false); assert.equal(f.client.state.round.ownAnswer, null);
      assert.ok(f.notice()); assert.doesNotMatch(f.notice().textContent, /saved|locked answer/i);
      assert.equal(f.client.state.round.deadline === null, seconds === 0);
    }
    player.get('quiz-choice-0').click(); assert.equal(player.client.pendingAction, null); assert.equal(player.client.state.round.ownAnswer, null);
    assert.ok(player.notice()); assert.doesNotMatch(player.root.querySelector('.live-party-guide').textContent, /saved|sealed/);
  });

  test((seconds ? 'timed' : 'untimed') + ': held and lost replies remain unconfirmed until the actual own-answer projection arrives', async t => {
    const g = game(seconds); let release;
    const held = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    const f = await fixture(t, g.state(), async () => { g.act(g.players[0], 'quiz-answer', { value: 0 }); await held; throw new TypeError('Lost accepted answer reply'); });
    f.get('quiz-choice-0').click(); f.get('lock-choice').click(); await until(() => !!f.client.pendingAction);
    assert.equal(f.client.state.round.ownAnswer, null); assert.ok(f.notice());
    assert.match(f.root.querySelector('.live-party-guide').textContent, /not confirmed yet/); assert.doesNotMatch(f.notice().textContent, /saved/);
    release(); await until(() => !!f.get('retry-action'));
    assert.equal(f.client.state.round.ownAnswer, null); assert.ok(f.client.pendingAction); assert.ok(f.notice());
    assert.match(f.root.querySelector('.live-party-guide').textContent, /not confirmed yet/);
    f.client.acceptState(g.state()); await flush();
    assert.equal(f.client.state.round.ownAnswer, 0); assert.equal(f.client.pendingAction, null);
    assert.match(f.root.querySelector('.live-party-guide').textContent, /Your answer is saved/);
    assert.ok(f.notice()); assert.doesNotMatch(f.notice().textContent, /saved/);
    assert.equal(f.client.state.round.deadline === null, seconds === 0);
  });
}

test('a connected host does not show the disconnect notice', async t => {
  const g = game(60), f = await fixture(t, g.state(g.players[0], false));
  assert.equal(f.client.state.hostConnected, true); assert.equal(f.notice(), undefined);
});
