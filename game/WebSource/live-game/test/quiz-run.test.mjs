import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { QuizRun } from '../web/quiz-run.mjs';

test('correct, incorrect and timed-out responses produce the final scored result once', () => {
  const run = new QuizRun(sampleQuizDocument(), { now: 0 });
  assert.equal(run.phase, 'answer');
  assert.equal(run.submit(1, 1_000), true);
  assert.equal(run.score, 1000);
  assert.equal(run.submit(1, 2_000), false);
  assert.equal(run.results.length, 1);
  assert.equal(run.next(3_000), true);
  assert.equal(run.submit(0, 4_000), true);
  assert.equal(run.score, 1000);
  assert.equal(run.next(5_000), true);
  assert.equal(run.advance(35_000), true);
  assert.equal(run.results[2].timedOut, true);
  assert.equal(run.next(36_000), true);
  assert.equal(run.phase, 'finished');
  assert.equal(run.currentQuestion, null);
  assert.equal(run.selectedAnswer, null);
  assert.equal(run.index, 2);
  assert.equal(run.score, 1000);
  assert.equal(run.correctCount, 1);
  assert.equal(run.results.length, 3);
  assert.equal(run.next(40_000), false);
  assert.equal(run.submit(2, 40_000), false);
  assert.equal(run.score, 1000);
});

test('a correct answer immediately before the deadline scores, at the deadline it times out', () => {
  const early = new QuizRun(sampleQuizDocument(), { now: 10_000 });
  assert.equal(early.submit(1, 29_999), true);
  assert.equal(early.score, 1000);
  const late = new QuizRun(sampleQuizDocument(), { now: 10_000 });
  assert.equal(late.submit(1, 30_000), false);
  assert.equal(late.phase, 'reveal');
  assert.equal(late.score, 0);
  assert.deepEqual(late.results[0], { questionID: late.currentQuestion.id, answer: null, correct: false, points: 0, timedOut: true });
});

test('elapsed time while backgrounded is caught up once rather than pausing or double-scoring', () => {
  const run = new QuizRun(sampleQuizDocument(), { now: 0 });
  assert.equal(run.advance(120_000), true);
  assert.equal(run.advance(121_000), false);
  assert.equal(run.submit(1, 122_000), false);
  assert.equal(run.results.length, 1);
  assert.equal(run.selectedAnswer, null);
  assert.equal(run.score, 0);
});

test('each next question receives a fresh absolute deadline and selected answer is reset', () => {
  const run = new QuizRun(sampleQuizDocument(), { now: 1_000 });
  assert.equal(run.deadline, 21_000);
  assert.equal(run.remainingSeconds(1_001), 20);
  assert.equal(run.remainingSeconds(20_001), 1);
  assert.equal(run.submit(1, 2_000), true);
  assert.equal(run.selectedAnswer, 1);
  assert.equal(run.deadline, null);
  assert.equal(run.remainingSeconds(4_000), null);
  assert.equal(run.next(50_000), true);
  assert.equal(run.deadline, 70_000);
  assert.equal(run.selectedAnswer, null);
  assert.equal(run.index, 1);
});

test('untimed questions stay open and invalid choices never become answers', () => {
  const document = sampleQuizDocument(); document.questions[0].timeLimitSeconds = 0;
  const run = new QuizRun(document, { now: 0 });
  assert.equal(run.deadline, null);
  assert.equal(run.remainingSeconds(999_999), null);
  assert.equal(run.advance(999_999), false);
  for (const value of [-1, 4, 1.5, NaN, '1', null]) assert.equal(run.submit(value, 999_999), false);
  assert.equal(run.phase, 'answer');
  assert.equal(run.next(999_999), false);
  assert.equal(run.submit(1, 1_000_000), true);
  assert.equal(run.score, 1000);
});

test('practice detaches its immutable questions and result ledger from editor changes', () => {
  const document = sampleQuizDocument();
  const run = new QuizRun(document, { now: 0 });
  document.questions[0].correctAnswer = 0;
  document.questions[0].answers[1] = 'Modified';
  assert.equal(run.currentQuestion.answers[1], 'Mars');
  assert.equal(run.submit(1, 1_000), true);
  assert.equal(run.score, 1000);
  assert.throws(() => { run.results[0].points = 9999; }, TypeError);
  assert.throws(() => { run.quiz.questions[0].correctAnswer = 0; }, TypeError);
});

test('a fresh run resets all practice history and invalid clocks fail closed', () => {
  const document = sampleQuizDocument();
  const run = new QuizRun(document, { now: 0 }); run.submit(1, 1_000);
  const replay = new QuizRun(document, { now: 5_000 });
  assert.equal(replay.phase, 'answer'); assert.equal(replay.score, 0); assert.deepEqual(replay.results, []);
  assert.equal(replay.deadline, 25_000);
  assert.equal(replay.submit(1, NaN), false); assert.equal(replay.advance(Infinity), false);
  assert.equal(replay.phase, 'answer'); assert.equal(replay.results.length, 0);
  assert.throws(() => new QuizRun(document, { now: NaN }), RangeError);
});
