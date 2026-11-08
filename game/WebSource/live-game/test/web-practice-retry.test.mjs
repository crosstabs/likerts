import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { QuizLibrary, QUIZ_LIBRARY_KEY } from '../web/quiz-library.mjs';
import { mountQuizApp } from '../web/quiz-ui.mjs';
import { QUIZ_MOTION_KEY } from '../web/quiz-motion.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function quiz({ count = 3, correct = [0, 1, 0], times = [0, 0, 10], markup = false } = {}) {
  const source = sampleQuizDocument(), template = source.questions[0]; source.title = 'Comeback practice';
  source.questions = Array.from({ length: count }, (_, index) => ({ ...template, id: randomUUID(),
    prompt: 'Question ' + (index + 1) + (markup ? ' <svg onload=bad()>' : ''),
    answers: ['First ' + (index + 1) + (markup ? ' <img src=x>' : ''), 'Second ' + (index + 1)],
    correctAnswer: correct[index % correct.length], timeLimitSeconds: times[index % times.length], explanation: 'Explanation ' + (index + 1) }));
  return source;
}
async function fixture(t, source = quiz()) {
  const storage = createStorage(), library = new QuizLibrary({ storage, locks: storage.locks }); await library.save(source);
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://practice-test.invalid/play/quizzes', pretendToBeVisual: true });
  const scrolls = [], animations = []; dom.window.scrollTo = (...values) => scrolls.push(values);
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  dom.window.Element.prototype.animate = (...args) => { animations.push(args); throw new Error('Reduced motion must not animate'); };
  let clock = 0, hosted = 0; const root = dom.window.document.getElementById('app');
  const app = mountQuizApp({ root, library, window: dom.window, now: () => clock, hostQuiz: () => { hosted++; } });
  t.after(() => { app.dispose(); dom.window.close(); });
  const get = id => root.querySelector('#' + id);
  const click = async id => { assert.ok(get(id), id); get(id).click(); await flush(); };
  const input = (id, value) => { get(id).value = value; get(id).dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  return { root, library, storage, dom, app, source, get, click, input, scrolls, animations, get hosted() { return hosted; },
    start: async () => { root.querySelector('[data-quiz-practice]').click(); await flush(); },
    answer: async value => { await click('quiz-play-answer-' + value); await click('quiz-lock-answer'); await click('quiz-next'); },
    timeout: async now => { clock = now; app.tick(); await flush(); await click('quiz-next'); },
    scopes: () => [...new Set((JSON.parse(dom.window.sessionStorage.getItem(QUIZ_MOTION_KEY) || '{"entries":[]}').entries).map(entry => entry.scope).filter(scope => scope.startsWith('practice:')))] };
}

test('mixed misses review, repeated comeback and full Replay use fresh attempts while preserving the whole quiz and library', async t => {
  const f = await fixture(t), saved = f.storage.getItem(QUIZ_LIBRARY_KEY), writes = f.storage.writes;
  await f.start(); await f.answer(0); await f.answer(0); await f.timeout(10_000);
  assert.equal(f.get('quiz-practice-heading').textContent, 'Quiz complete'); assert.match(f.root.textContent, /1 of 3 correct/);
  assert.equal(f.get('quiz-retry-missed').textContent, 'Retry 2 missed questions'); assert.equal(f.get('quiz-replay').textContent, 'Replay full quiz');
  const review = f.get('quiz-missed-review'), summary = f.get('quiz-missed-review-summary');
  assert.equal(review.open, false); assert.equal(summary.textContent, 'Review 2 missed questions');
  summary.focus(); summary.click(); await flush(); assert.equal(review.open, true); assert.equal(f.dom.window.document.activeElement, summary);
  assert.deepEqual([...review.querySelectorAll('h3')].map(node => node.textContent), ['Question 2', 'Question 3']);
  assert.deepEqual([...review.querySelectorAll('dd')].map(node => node.textContent), ['First 2', 'Second 2', 'No answer locked', 'First 3']);
  assert.match(review.textContent, /Explanation 2/); assert.equal(review.textContent.includes('Question 1'), false);
  assert.match(f.root.querySelector('.q-practice-retry-guide').textContent, /Moss · The Cheerleader.*A little more practice\?.*Try the questions you missed, with a fresh score\./s);
  assert.equal(f.root.querySelector('.q-practice-retry-guide [data-quiz-entrance]'), null);
  assert.equal(f.scopes().length, 1);
  await f.click('quiz-retry-missed');
  assert.equal(f.get('quiz-practice-heading').textContent, 'Question 2'); assert.match(f.root.textContent, /Question 1 of 2/);
  assert.equal(f.root.querySelector('.q-attempt-badge').textContent, 'Retry missed questions');
  assert.match(f.root.textContent, /This attempt has only the questions you missed/);
  assert.equal(f.get('quiz-lock-answer').disabled, true); assert.equal(f.dom.window.document.activeElement.id, 'quiz-practice-heading');
  assert.deepEqual(f.scrolls.at(-1), [0, 0]); assert.equal(f.scopes().length, 2); assert.equal(f.get('quiz-missed-review'), null);
  await f.answer(1); assert.equal(f.get('quiz-countdown').textContent, '10 seconds left'); await f.answer(1);
  assert.equal(f.get('quiz-practice-heading').textContent, 'Retry complete'); assert.equal(f.get('quiz-result-label').textContent, 'This attempt');
  assert.match(f.root.textContent, /1 of 2 correct/); assert.equal(f.get('quiz-retry-missed').textContent, 'Retry 1 missed question');
  assert.equal(f.get('quiz-missed-review').open, false); assert.equal(f.get('quiz-missed-review-summary').textContent, 'Review 1 missed question');
  await f.click('quiz-retry-missed'); assert.equal(f.get('quiz-practice-heading').textContent, 'Question 3'); assert.match(f.root.textContent, /Question 1 of 1/);
  assert.equal(f.get('quiz-countdown').textContent, '10 seconds left'); assert.equal(f.scopes().length, 3);
  await f.answer(0); assert.equal(f.get('quiz-practice-heading').textContent, 'Retry complete'); assert.match(f.root.textContent, /1 of 1 correct/);
  assert.equal(f.get('quiz-retry-missed'), null); assert.equal(f.get('quiz-missed-review'), null); assert.equal(f.root.querySelector('.q-practice-retry-guide'), null);
  await f.click('quiz-replay'); assert.equal(f.get('quiz-practice-heading').textContent, 'Question 1'); assert.match(f.root.textContent, /Question 1 of 3/);
  assert.equal(f.root.querySelector('.q-attempt-badge'), null); assert.equal(f.get('quiz-lock-answer').disabled, true); assert.equal(f.scopes().length, 4);
  assert.equal(f.storage.getItem(QUIZ_LIBRARY_KEY), saved); assert.equal(f.storage.writes, writes); assert.equal(f.hosted, 0); assert.equal(f.animations.length, 0);
  assert.deepEqual(f.library.quizzes[0].questions.map(question => question.id), f.source.questions.map(question => question.id));
});

test('a perfect full quiz offers full Replay without missed review or comeback guidance', async t => {
  const f = await fixture(t, quiz({ times: [0] })); await f.start(); await f.answer(0); await f.answer(1); await f.answer(0);
  assert.match(f.root.textContent, /3 of 3 correct/); assert.equal(f.get('quiz-practice-heading').textContent, 'Quiz complete');
  assert.equal(f.get('quiz-retry-missed'), null); assert.equal(f.get('quiz-missed-review'), null); assert.equal(f.root.querySelector('.q-practice-retry-guide'), null);
  await f.click('quiz-replay'); assert.match(f.root.textContent, /Question 1 of 3/); assert.equal(f.dom.window.document.activeElement.id, 'quiz-practice-heading');
});

test('all timeouts review as unanswered and a comeback starts with a new deadline and neutral outcome art', async t => {
  const f = await fixture(t, quiz({ times: [10] })); await f.start(); await f.timeout(10_000); await f.timeout(20_000); await f.timeout(30_000);
  assert.match(f.root.textContent, /0 of 3 correct/); assert.equal(f.get('quiz-retry-missed').textContent, 'Retry 3 missed questions');
  assert.equal([...f.get('quiz-missed-review').querySelectorAll('dd')].filter(node => node.textContent === 'No answer locked').length, 3);
  assert.equal(f.root.querySelector('.q-result-art .quiz-celebration'), null);
  await f.click('quiz-retry-missed'); assert.equal(f.get('quiz-countdown').textContent, '10 seconds left'); assert.equal(f.get('quiz-lock-answer').disabled, true);
});

test('dirty editor origin and open review survive cancellation; retry/full replay never save or replace the draft', async t => {
  const f = await fixture(t, quiz({ times: [0] })), saved = f.storage.getItem(QUIZ_LIBRARY_KEY), writes = f.storage.writes;
  f.root.querySelector('[data-quiz-edit]').click(); await flush(); f.input('quiz-prompt', 'Unsaved edited question'); f.input('quiz-title', 'Unsaved title');
  await f.click('quiz-practice-draft'); await f.answer(1); await f.answer(0); await f.answer(1);
  const summary = f.get('quiz-missed-review-summary'); summary.focus(); summary.click();
  await f.click('quiz-nav-library'); assert.ok(f.get('quiz-confirm-title')); await f.click('quiz-confirm-cancel');
  assert.equal(f.app.screen, 'practice'); assert.equal(f.get('quiz-missed-review').open, true);
  const old = f.get('quiz-missed-review'); await f.click('quiz-retry-missed'); assert.equal(f.get('quiz-missed-review'), null);
  await f.answer(1); await f.answer(0); await f.answer(1); assert.equal(f.get('quiz-missed-review').open, false);
  old.dispatchEvent(new f.dom.window.Event('toggle')); assert.equal(f.get('quiz-missed-review').open, false);
  await f.click('quiz-replay'); assert.match(f.root.textContent, /Question 1 of 3/); assert.equal(f.get('quiz-practice-heading').textContent, 'Unsaved edited question');
  await f.click('quiz-practice-back'); await f.click('quiz-confirm-action');
  assert.equal(f.app.screen, 'editor'); assert.equal(f.get('quiz-prompt').value, 'Unsaved edited question'); assert.equal(f.get('quiz-title').value, 'Unsaved title');
  assert.equal(f.storage.getItem(QUIZ_LIBRARY_KEY), saved); assert.equal(f.storage.writes, writes); assert.equal(f.hosted, 0);
});

test('singular untimed missed answers including index0 remain plain text and do not acquire a timer', async t => {
  const f = await fixture(t, quiz({ count: 1, correct: [1], times: [0], markup: true })); await f.start(); await f.answer(0);
  assert.equal(f.get('quiz-retry-missed').textContent, 'Retry 1 missed question');
  const review = f.get('quiz-missed-review'); assert.equal(f.get('quiz-missed-review-summary').textContent, 'Review 1 missed question');
  assert.equal(review.querySelector('dd').textContent, 'First 1 <img src=x>'); assert.equal(review.querySelector('img,svg,script'), null);
  await f.click('quiz-retry-missed'); assert.equal(f.get('quiz-countdown'), null); await f.answer(1);
  assert.match(f.root.textContent, /1 of 1 correct/); assert.equal(f.get('quiz-practice-heading').textContent, 'Retry complete'); assert.equal(f.get('quiz-retry-missed'), null);
});

test('the maximum30-question review and retry remain a transient full set of misses', async t => {
  const f = await fixture(t, quiz({ count: 30, correct: [0], times: [0] })), saved = f.storage.getItem(QUIZ_LIBRARY_KEY); await f.start();
  for (let index = 0; index < 30; index++) await f.answer(1);
  assert.equal(f.get('quiz-retry-missed').textContent, 'Retry 30 missed questions'); assert.equal(f.get('quiz-missed-review').querySelectorAll('li').length, 30);
  await f.click('quiz-retry-missed'); assert.match(f.root.textContent, /Question 1 of 30/); assert.equal(f.get('quiz-lock-answer').disabled, true);
  assert.equal(f.storage.getItem(QUIZ_LIBRARY_KEY), saved); assert.equal(f.library.quizzes.length, 1);
});
