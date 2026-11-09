import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createQuizRoom, joinRoom, reduceRoom, project } from '../server/engine.mjs';
import { LiveClient } from '../web/client.mjs';
import { mountLiveApp } from '../web/ui.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function game() {
  const now = Date.now(), quiz = sampleQuizDocument();
  let room = createQuizRoom(quiz, { capacity: 12 }, { now }).room;
  const players = [];
  for (const nickname of ['Sam', 'WebQA']) {
    const joined = joinRoom(room, { nickname, acceptRoomSharing: true }, { now });
    room = joined.room; players.push(joined.memberId);
  }
  const state = (actor = players[0]) => project(room, actor, { now });
  const act = (actor, action, values = {}) => {
    room = reduceRoom(room, actor, { requestId: randomUUID(), matchId: room.matchId,
      ...(room.round ? { roundId: room.round.id } : {}), action, ...values }, { now }).room;
    return state(actor);
  };
  return { state, act, players, quiz, get room() { return room; } };
}
class TestClient extends LiveClient { connect() { this.setStatus('connected'); } }
async function fixture(t, state, fetch) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://party-test.invalid/play' }); dom.window.scrollTo = () => {};
  const client = new TestClient({ origin: 'https://party-test.invalid', WebSocket: null, storage: createStorage(), fetch });
  client.credential = { version: 1, code: state.code, token: 'a'.repeat(43), memberId: state.self.id, expiresAt: state.expiresAt };
  client.acceptState(state);
  const root = dom.window.document.getElementById('app'), app = mountLiveApp({ root, client, window: dom.window });
  await flush(); t.after(() => { app.dispose(); client.dispose(); dom.window.close(); });
  return { root, client, get: id => root.querySelector('#' + id), guide: () => root.querySelector('.live-party-guide') };
}

test('party guides change from the real room state, never from a selected or pending answer', async t => {
  const g = game(); let resolveReply;
  const held = new Promise(resolve => { resolveReply = resolve; });
  const f = await fixture(t, g.state(), () => held);
  assert.equal(f.guide().dataset.partyBeat, 'gather'); assert.match(f.guide().textContent, /Ember · The Spark/);
  g.act('host', 'start'); f.client.acceptState(g.state());
  assert.equal(f.guide().dataset.partyBeat, 'question'); assert.match(f.guide().textContent, /Loop · The Questioner/);
  f.get('quiz-choice-0').click();
  assert.equal(f.guide().dataset.partyBeat, 'question'); assert.equal(f.client.pendingAction, null);
  f.get('lock-choice').click(); await flush();
  assert.equal(f.client.pendingAction.action, 'quiz-answer'); assert.equal(f.guide().dataset.partyBeat, 'question');
  assert.match(f.guide().textContent, /not confirmed yet/); assert.doesNotMatch(f.guide().textContent, /Twist|Your answer is saved/);
  const locked = g.act(g.players[0], 'quiz-answer', { value: 0 }); f.client.acceptState(locked); await flush();
  assert.equal(f.guide().dataset.partyBeat, 'locked'); assert.match(f.guide().textContent, /Twist · The Keeper/);
  assert.match(f.root.textContent, /Answer locked: Venus/);
  assert.equal(f.guide().querySelector('[data-quiz-entrance]'), null);
  resolveReply({ ok: true, status: 200, json: async () => ({ state: locked }) }); await flush();
  g.act(g.players[1], 'quiz-answer', { value: 1 }); f.client.acceptState(g.state());
  assert.equal(f.guide().dataset.partyBeat, 'reveal'); assert.match(f.guide().textContent, /Blu · The Guide/);
  assert.equal(f.root.querySelector('.quiz-celebration'), null); assert.match(f.root.textContent, /0 points You chose Venus/);
  g.act('host', 'end'); f.client.acceptState(g.state());
  assert.equal(f.guide().dataset.partyBeat, 'finished'); assert.match(f.guide().textContent, /Moss · The Cheerleader/);
  assert.equal(f.root.querySelector('.quiz-celebration'), null); assert.match(f.root.textContent, /Provisional standings/);
});

test('a completed zero-point game keeps its togetherness celebration without turning the guide into correctness feedback', async t => {
  const g = game(); g.act('host', 'start');
  for (let index = 0; index < g.quiz.questions.length; index++) {
    g.act('host', 'quiz-reveal'); g.act('host', 'next');
  }
  const f = await fixture(t, g.state(), () => { throw new Error('No request expected'); });
  assert.equal(g.state().completion, 'complete'); assert.equal(f.guide().dataset.partyBeat, 'finished');
  assert.match(f.guide().textContent, /One more together/); assert.equal(f.guide().querySelector('.quiz-celebration'), null);
  assert.ok(f.root.querySelector('.quiz-finished-art .quiz-celebration'));
  assert.match(f.root.textContent, /0 of 3 correct/); assert.match(f.root.textContent, /Final standings/);
});
