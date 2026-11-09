import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createQuizRoom, joinRoom, reduceRoom, project, advance } from '../server/engine.mjs';
import { LiveClient, validateState } from '../web/client.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { quizAnswerBreakdown } from '../web/quiz-answer-breakdown.mjs';
import { mountLiveApp } from '../web/ui.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const shared = JSON.parse(await readFile(new URL('../../../SharedFixtures/quiz-answer-breakdown.json', import.meta.url), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const credential = state => ({ version: 1, code: state.code, memberId: state.self.id, token: 'a'.repeat(43), expiresAt: state.expiresAt });
function game({ answerCount = 4, correctAnswer = 0, eligible = 3, questionCount = 2, answers, prompt } = {}) {
  const quiz = sampleQuizDocument(); quiz.questions = quiz.questions.slice(0, questionCount);
  for (const question of quiz.questions) {
    question.answers = answers ?? Array.from({ length: answerCount }, (_, index) => 'Option ' + String.fromCharCode(65 + index));
    question.correctAnswer = correctAnswer; question.explanation = 'A scored explanation, shown after reveal.'; question.timeLimitSeconds = 30;
  }
  if (prompt) quiz.questions[0].prompt = prompt;
  let now = Date.now(), room = createQuizRoom(quiz, { capacity: Math.max(12, eligible) }, { now }).room;
  const players = [];
  for (let index = 0; index < eligible; index++) {
    const joined = joinRoom(room, { nickname: 'Player ' + (index + 1), acceptRoomSharing: true }, { now });
    room = joined.room; players.push(joined.memberId);
  }
  const state = (actor = 'host') => project(room, actor, { now });
  const act = (actor, action, values = {}) => {
    room = reduceRoom(room, actor, { requestId: randomUUID(), matchId: room.matchId,
      ...(room.round ? { roundId: room.round.id } : {}), action, ...values }, { now }).room;
    return state(actor);
  };
  const reveal = choices => {
    for (const [index, value] of choices.entries()) if (value !== null) act(players[index], 'quiz-answer', { value });
    if (room.phase === 'answer') act('host', 'quiz-reveal');
  };
  return { players, quiz, state, act, reveal, get room() { return room; }, expire() { now = room.round.deadline; assert.equal(advance(room, now), true); } };
}
class TestClient extends LiveClient { catalogue() { return Promise.resolve({ topics: [] }); } }
async function fixture(t, state) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://breakdown-test.invalid/play' }); dom.window.scrollTo = () => {};
  let requests = 0; const storage = createStorage();
  const client = new TestClient({ origin: dom.window.location.origin, storage, WebSocket: null, fetch: () => { requests++; throw new Error('No request expected'); } });
  client.credential = credential(state); client.acceptState(state);
  const root = dom.window.document.getElementById('app'), app = mountLiveApp({ root, client, window: dom.window });
  await flush(); t.after(() => { app.dispose(); dom.window.close(); });
  return { root, client, app, storage, dom, get requests() { return requests; }, panel: () => root.querySelector('.quiz-answer-breakdown'),
    details: () => root.querySelector('.quiz-last-question-details'), adopt(next) { client.credential = credential(next); client.acceptState(next); } };
}

for (const example of shared.cases) {
  test('shared native/web counts match actual host and player projections: ' + example.name, () => {
    const g = game({ answerCount: example.answerCount, correctAnswer: example.correctAnswer, eligible: example.expectedEligibleCount });
    g.act('host', 'start'); g.reveal(example.choices);
    for (const actor of ['host', g.players[0]]) {
      const state = g.state(actor), before = structuredClone(state); validateState(state, credential(state));
      const breakdown = quizAnswerBreakdown(state); assert.deepEqual(breakdown, example.expected);
      assert.equal(breakdown.counts.reduce((sum, count) => sum + count, 0) + breakdown.unansweredCount, breakdown.total);
      assert.equal(Object.isFrozen(breakdown), true); assert.equal(Object.isFrozen(breakdown.counts), true);
      assert.throws(() => { breakdown.counts[0] = 99; }, TypeError);
      assert.deepEqual(state, before);
    }
  });
}

test('aggregation ignores points, names, group percentages and private engine content', () => {
  const g = game(); g.act('host', 'start'); g.reveal([0, 2, null]); const state = g.state();
  const forbidden = () => { throw new Error('Unneeded data was read'); };
  Object.defineProperty(state, 'quizSnapshot', { get: forbidden });
  Object.defineProperty(state.round, 'submissions', { get: forbidden });
  Object.defineProperty(state.reveal, 'groupAccuracy', { get: forbidden });
  for (const result of state.reveal.results) for (const key of ['nickname', 'playerId', 'points']) Object.defineProperty(result, key, { get: forbidden });
  assert.deepEqual(quizAnswerBreakdown(state), { counts: [1, 0, 1, 0], correctCount: 1, answeredCount: 2, unansweredCount: 1, total: 3 });
});

test('the helper fails closed on wrong phases, invalid reveals and malformed count inputs', () => {
  const g = game(); g.act('host', 'start'); g.reveal([0, 2, null]);
  const mutations = [s => { s.protocolVersion = 1; }, s => { s.mode = 'other'; }, s => { s.modeVersion = 2; },
    ...['lobby', 'answer', 'predict', 'unknown'].map(phase => s => { s.phase = phase; }),
    s => { s.reveal.valid = false; }, s => { s.reveal = null; }, s => { s.round = null; },
    ...[null, -1, 4, 0.5, '0'].map(value => s => { s.reveal.correctAnswer = value; }),
    s => { s.round.answers = ['Only one']; }, s => { s.round.answers.push('Fifth'); },
    ...[1, 51, 3.5, '3'].map(value => s => { s.round.eligibleCount = value; }),
    s => { s.reveal.results.pop(); }, s => { s.reveal.results = Array(3); },
    ...[-1, 4, 0.5, '0', undefined, NaN].map(value => s => { s.reveal.results[0].value = value; }),
    s => { s.reveal.results[0] = null; }];
  for (const mutate of mutations) { const state = structuredClone(g.state()); mutate(state); assert.equal(quizAnswerBreakdown(state), null); }
  assert.equal(quizAnswerBreakdown(null), null); assert.equal(quizAnswerBreakdown({}), null);
});

test('both roles see accurate mixed counts only after reveal, before individual results, with neutral wrong-answer feedback', async t => {
  const g = game(), host = await fixture(t, g.state()), player = await fixture(t, g.state(g.players[1]));
  g.act('host', 'start');
  for (const [f, actor] of [[host, 'host'], [player, g.players[1]]]) { f.client.acceptState(g.state(actor)); assert.equal(f.panel(), null); }
  player.root.querySelector('#quiz-choice-2').click(); assert.equal(player.app.model.selection, 2); assert.equal(player.panel(), null);
  g.act(g.players[0], 'quiz-answer', { value: 0 });
  host.client.acceptState(g.state()); player.client.acceptState(g.state(g.players[1]));
  assert.equal(host.panel(), null); assert.equal(player.panel(), null);
  g.act(g.players[1], 'quiz-answer', { value: 2 }); g.act('host', 'quiz-reveal');
  for (const [f, actor] of [[host, 'host'], [player, g.players[1]]]) {
    f.client.acceptState(g.state(actor)); const panel = f.panel(); assert.ok(panel);
    assert.equal(panel.querySelector('h2').textContent, 'How the room answered');
    assert.equal(panel.querySelector('.quiz-breakdown-summary').textContent, '1 of 3 correct');
    const rows = [...panel.querySelectorAll('.quiz-breakdown-row')]; assert.equal(rows.length, 5);
    assert.deepEqual(rows.map(row => row.querySelector('.quiz-breakdown-count').textContent), ['1 player', '0 players', '1 player', '0 players', '1 player']);
    assert.deepEqual(rows.map(row => row.querySelector('.quiz-breakdown-answer').textContent), ['A · Option A', 'B · Option B', 'C · Option C', 'D · Option D', 'No answer locked']);
    assert.equal(rows[0].querySelector('.quiz-breakdown-correct').textContent, '✓ Correct answer');
    assert.equal(panel.querySelectorAll('.quiz-breakdown-correct').length, 1);
    for (const [index, meter] of [...panel.querySelectorAll('meter')].entries()) {
      assert.equal(meter.getAttribute('aria-hidden'), 'true'); assert.equal(meter.min, 0); assert.equal(meter.max, 3);
      assert.equal(meter.value, [1, 0, 1, 0, 1][index]); assert.equal(meter.hasAttribute('style'), false);
    }
    assert.equal(panel.querySelector('button,a,input,select,textarea,[tabindex]'), null);
    const order = f.dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
    assert.ok(f.root.querySelector('.quiz-correct-answer').compareDocumentPosition(panel) & order);
    assert.ok(f.root.querySelector('.quiz-explanation').compareDocumentPosition(panel) & order);
    assert.ok(panel.compareDocumentPosition(f.root.querySelector('.quiz-result-list')) & order);
    assert.equal(f.requests, 0);
  }
  assert.equal(player.root.querySelector('.quiz-celebration'), null); assert.match(player.root.textContent, /0 points You chose Option C/);
});

test('an all-missing deadline reveal keeps every player in the denominator and the missing row visible', async t => {
  const g = game(); g.act('host', 'start'); g.expire(); assert.equal(g.state().reveal.reason, 'timeout');
  const f = await fixture(t, g.state(g.players[0])), panel = f.panel();
  assert.equal(panel.querySelector('.quiz-breakdown-summary').textContent, '0 of 3 correct');
  assert.deepEqual([...panel.querySelectorAll('meter')].map(meter => [meter.value, meter.max]), [[0, 3], [0, 3], [0, 3], [0, 3], [3, 3]]);
  assert.equal(f.root.querySelector('.quiz-celebration'), null);
});

test('the zero-missing row remains visible and answer markup/long text remain plain text without inline styles', async t => {
  const long = 'VeryLongAnswer'.repeat(6), markup = '<img src=x onerror=bad()>', g = game({ answerCount: 2, answers: [long, markup], prompt: 'A long prompt\nwith <svg onload=bad()> text.' });
  g.act('host', 'start'); g.reveal([0, 1, 0]); const f = await fixture(t, g.state());
  const panel = f.panel(), rows = [...panel.querySelectorAll('.quiz-breakdown-row')];
  assert.equal(rows[0].querySelector('.quiz-breakdown-answer').textContent, 'A · ' + long);
  assert.equal(rows[1].querySelector('.quiz-breakdown-answer').textContent, 'B · ' + markup);
  assert.equal(rows[2].querySelector('.quiz-breakdown-answer').textContent, 'No answer locked');
  assert.equal(rows[2].querySelector('.quiz-breakdown-count').textContent, '0 players');
  assert.equal(panel.querySelector('img,svg,script,[style]'), null);
});

test('unscored early ending hides all breakdown bars; a prior valid reveal remains available in incomplete last-question details', async t => {
  const unscored = game(); unscored.act('host', 'start'); unscored.act(unscored.players[0], 'quiz-answer', { value: 0 }); unscored.act('host', 'end');
  const hidden = await fixture(t, unscored.state());
  assert.equal(unscored.state().reveal.valid, false); assert.equal(quizAnswerBreakdown(unscored.state()), null);
  assert.equal(hidden.panel(), null); assert.equal(hidden.details(), null); assert.equal(hidden.root.querySelector('.quiz-celebration'), null);
  const scored = game(); scored.act('host', 'start'); scored.reveal([0, 2, null]); scored.act('host', 'end');
  const visible = await fixture(t, scored.state());
  assert.equal(scored.state().completion, 'incomplete'); assert.equal(scored.state().reveal.valid, true);
  assert.equal(visible.details().open, false); assert.equal(visible.panel().querySelector('.quiz-breakdown-summary').textContent, '1 of 3 correct');
  assert.match(visible.details().textContent, /Last question · Question 1 of 2/); assert.match(visible.root.textContent, /Provisional standings/);
  assert.equal(visible.root.querySelector('.quiz-celebration'), null);
});

test('completed details describe only the last question and preserve native toggle/focus across same-question status renders', async t => {
  const g = game(); g.act('host', 'start'); g.reveal([0, 0, 0]); g.act('host', 'next'); g.reveal([1, 1, null]); g.act('host', 'next');
  const f = await fixture(t, g.state()), detail = f.details(), summary = detail.querySelector('summary');
  assert.equal(detail.open, false); assert.equal(summary.textContent, 'Last question details');
  assert.match(detail.textContent, /Last question · Question 2 of 2/); assert.match(detail.textContent, /0 of 3 correct/);
  assert.ok(detail.textContent.includes(g.quiz.questions[1].prompt)); assert.equal(detail.textContent.includes(g.quiz.questions[0].prompt), false);
  assert.equal(f.root.querySelector('#quiz-answer-breakdown-title'), null); assert.ok(detail.querySelector('#quiz-last-question-breakdown-title'));
  const writes = f.storage.writes, source = JSON.stringify(f.client.state), selection = f.app.model.selection;
  summary.focus(); summary.click(); f.client.setStatus('syncing'); // Render before the queued native toggle event.
  assert.equal(f.details().open, true); assert.equal(f.dom.window.document.activeElement.id, 'quiz-last-question-summary');
  await flush(); f.client.setStatus('connected'); assert.equal(f.details().open, true);
  f.details().querySelector('summary').click(); f.app.render(); assert.equal(f.details().open, false);
  await flush(); f.app.render(); assert.equal(f.details().open, false);
  assert.equal(f.storage.writes, writes); assert.equal(JSON.stringify(f.client.state), source); assert.equal(f.app.model.selection, selection); assert.equal(f.requests, 0);
});

test('new rounds, rematches and rooms clear disclosure state; detached old toggle events cannot reopen it', async t => {
  const g = game({ questionCount: 1 }); g.act('host', 'start'); g.reveal([0, 1, null]); g.act('host', 'next');
  const f = await fixture(t, g.state()); f.details().querySelector('summary').click(); await flush();
  const old = f.details(); assert.equal(old.open, true);
  g.act('host', 'rematch'); f.client.acceptState(g.state()); assert.equal(f.details(), null); assert.equal(f.app.model.quizLastQuestionDetails, null);
  old.dispatchEvent(new f.dom.window.Event('toggle')); assert.equal(f.app.model.quizLastQuestionDetails, null);
  g.act('host', 'start'); f.client.acceptState(g.state()); assert.equal(f.panel(), null); assert.equal(f.app.model.quizLastQuestionDetails, null);
  g.reveal([1, 1, null]); g.act('host', 'next'); f.client.acceptState(g.state()); assert.equal(f.details().open, false);
  old.open = false; old.dispatchEvent(new f.dom.window.Event('toggle')); assert.equal(f.details().open, false);
  f.details().querySelector('summary').click(); await flush(); const recent = f.details(); assert.equal(recent.open, true);
  const other = game({ questionCount: 1 }); other.act('host', 'start'); other.reveal([0, 2, null]); other.act('host', 'next');
  f.adopt(other.state()); assert.equal(f.details().open, false); const scope = f.app.model.quizLastQuestionDetails.scope;
  recent.dispatchEvent(new f.dom.window.Event('toggle')); assert.equal(f.app.model.quizLastQuestionDetails.scope, scope); assert.equal(f.app.model.quizLastQuestionDetails.open, false);
});

test('a reveal panel is removed on the next answer phase and never lingers into rematch', async t => {
  const g = game(); g.act('host', 'start'); g.reveal([0, 2, null]); const f = await fixture(t, g.state()); assert.ok(f.panel());
  g.act('host', 'next'); f.client.acceptState(g.state()); assert.equal(f.panel(), null); assert.equal(f.details(), null);
  g.act('host', 'end'); f.client.acceptState(g.state()); assert.equal(f.panel(), null); assert.equal(f.details(), null);
  g.act('host', 'rematch'); f.client.acceptState(g.state()); assert.equal(f.panel(), null); assert.equal(f.details(), null);
});
