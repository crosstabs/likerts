import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { QuizRun } from '../web/quiz-run.mjs';

function quizWithQuestions(count, configure = () => ({})) {
  const quiz = sampleQuizDocument();
  const template = quiz.questions[0];
  quiz.title = 'Practice retry test';
  quiz.questions = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(template),
    id: '10000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
    prompt: 'Question ' + (index + 1),
    correctAnswer: 0,
    ...configure(index),
  }));
  return quiz;
}

function finish(run, answers, now) {
  for (const answer of answers) {
    if (answer === null) {
      assert.notEqual(run.deadline, null, 'A timeout needs a timed question');
      now = Math.max(now, run.deadline);
      assert.equal(run.advance(now), true);
    } else assert.equal(run.submit(answer, now), true);
    assert.equal(run.next(++now), true);
    now++;
  }
  assert.equal(run.phase, 'finished');
}

function snapshot(run) {
  return structuredClone({
    quiz: run.quiz, phase: run.phase, index: run.index, score: run.score,
    correctCount: run.correctCount, selectedAnswer: run.selectedAnswer,
    results: run.results, deadline: run.deadline,
  });
}

function state(run, baseMilliseconds) {
  return {
    phase: run.phase, index: run.index, score: run.score, correctCount: run.correctCount,
    selectedAnswer: run.selectedAnswer, resultsCount: run.results.length,
    deadlineOffsetMilliseconds: run.deadline === null ? null : run.deadline - baseMilliseconds,
  };
}

function assertFreshRetry(source, retry, questionIDs, now) {
  assert.ok(retry instanceof QuizRun);
  assert.notEqual(retry, source);
  assert.deepEqual(retry.quiz, {
    ...source.quiz,
    questions: source.quiz.questions.filter(question => questionIDs.includes(question.id)),
  });
  assert.equal(retry.phase, 'answer');
  assert.equal(retry.index, 0);
  assert.equal(retry.score, 0);
  assert.equal(retry.correctCount, 0);
  assert.equal(retry.selectedAnswer, null);
  assert.deepEqual(retry.results, []);
  const seconds = retry.currentQuestion.timeLimitSeconds;
  assert.equal(retry.deadline, seconds === 0 ? null : now + seconds * 1000);
}

test('practice retry matches the shared web/native contract fixtures', async t => {
  const shared = JSON.parse(await readFile(new URL('../../../SharedFixtures/quiz-practice-retry.json', import.meta.url), 'utf8'));
  assert.equal(shared.schemaVersion, 1);
  assert.ok(shared.cases.length > 0);
  for (const fixture of shared.cases) {
    await t.test(fixture.name, () => {
      const run = new QuizRun(fixture.quiz, { now: shared.baseMilliseconds });
      const inputBefore = structuredClone(fixture.quiz);
      for (const event of fixture.events) {
        const now = shared.baseMilliseconds + event.nowOffsetMilliseconds;
        let result;
        if (event.action === 'submit') result = run.submit(event.value, now);
        else if (event.action === 'advance') result = run.advance(now);
        else if (event.action === 'next') result = run.next(now);
        else assert.fail('Unsupported fixture action: ' + event.action);
        assert.equal(result, event.expectedReturn, fixture.name + ': ' + event.action);
      }
      const { retry: expectedRetry, missedQuestionIDs, ...expectedState } = fixture.expected;
      assert.deepEqual(state(run, shared.baseMilliseconds), expectedState);
      assert.deepEqual(run.missedQuestionIDs, missedQuestionIDs);
      const before = snapshot(run);
      const retryNow = shared.baseMilliseconds + shared.retryOffsetMilliseconds;
      const retry = run.retryMissed({ now: retryNow });
      if (expectedRetry === null) assert.equal(retry, null);
      else {
        assertFreshRetry(run, retry, expectedRetry.questionIDs, retryNow);
        assert.deepEqual({ questionIDs: retry.quiz.questions.map(question => question.id), ...state(retry, shared.baseMilliseconds) }, expectedRetry);
      }
      assert.deepEqual(snapshot(run), before);
      assert.deepEqual(fixture.quiz, inputBefore);
    });
  }
});

test('misses remain unavailable until completion and returned ID lists cannot be changed', () => {
  const quiz = quizWithQuestions(2, () => ({ correctAnswer: 1 }));
  const run = new QuizRun(quiz, { now: 0 });
  let now = 1;
  for (const phase of ['answer', 'reveal', 'answer', 'reveal']) {
    assert.equal(run.phase, phase);
    const ids = run.missedQuestionIDs;
    assert.deepEqual(ids, []);
    assert.equal(Object.isFrozen(ids), true);
    assert.throws(() => ids.push('injected'), TypeError);
    assert.equal(run.retryMissed({ now: NaN }), null);
    if (phase === 'answer') assert.equal(run.submit(0, now++), true);
    else assert.equal(run.next(now++), true);
  }
  const ids = run.missedQuestionIDs;
  assert.deepEqual(ids, quiz.questions.map(question => question.id));
  assert.equal(Object.isFrozen(ids), true);
  assert.throws(() => { ids[0] = 'injected'; }, TypeError);
  assert.deepEqual(run.missedQuestionIDs, quiz.questions.map(question => question.id));
});

test('mixed correct option zero, wrong option zero and timeout retry only the misses in quiz order', () => {
  const quiz = quizWithQuestions(3, index => ({ correctAnswer: index, timeLimitSeconds: index === 1 ? 10 : 20 }));
  const inputBefore = structuredClone(quiz);
  const run = new QuizRun(quiz, { now: 1_000 });
  finish(run, [0, 0, null], 1_001);
  assert.equal(run.score, 1000);
  assert.equal(run.results[1].answer, 0);
  assert.equal(run.results[1].correct, false);
  assert.equal(run.results[2].answer, null);
  assert.equal(run.results[2].timedOut, true);
  const missed = quiz.questions.slice(1).map(question => question.id);
  assert.deepEqual(run.missedQuestionIDs, missed);
  const before = snapshot(run);
  const retry = run.retryMissed({ now: 500_000 });
  assertFreshRetry(run, retry, missed, 500_000);
  assert.equal(retry.deadline, 510_000);
  assert.deepEqual(snapshot(run), before);
  assert.deepEqual(quiz, inputBefore);
  quiz.title = 'Later editor changes';
  quiz.questions[1].answers[0] = 'Later answer changes';
  assert.equal(retry.quiz.title, inputBefore.title);
  assert.deepEqual(retry.quiz.questions[0].answers, inputBefore.questions[1].answers);
});

test('each repeated retry shrinks to that round’s misses without accumulating points or changing earlier runs', () => {
  const quiz = quizWithQuestions(4);
  const original = new QuizRun(quiz, { now: 0 });
  finish(original, [1, 0, 1, 1], 1);
  const originalBefore = snapshot(original);
  const first = original.retryMissed({ now: 100_000 });
  assertFreshRetry(original, first, [quiz.questions[0].id, quiz.questions[2].id, quiz.questions[3].id], 100_000);
  finish(first, [0, 1, 0], 100_001);
  assert.equal(first.score, 2000);
  assert.deepEqual(first.missedQuestionIDs, [quiz.questions[2].id]);
  const firstBefore = snapshot(first);
  const second = first.retryMissed({ now: 200_000 });
  assertFreshRetry(first, second, [quiz.questions[2].id], 200_000);
  finish(second, [0], 200_001);
  assert.equal(second.score, 1000);
  assert.equal(second.correctCount, 1);
  assert.deepEqual(second.missedQuestionIDs, []);
  assert.equal(second.retryMissed({ now: 300_000 }), null);
  assert.deepEqual(snapshot(original), originalBefore);
  assert.deepEqual(snapshot(first), firstBefore);
  assert.equal(original.quiz.questions.length, 4);
});

test('a perfect completed run has no retry even when given an invalid clock', () => {
  const run = new QuizRun(quizWithQuestions(3), { now: 0 });
  finish(run, [0, 0, 0], 1);
  const before = snapshot(run);
  assert.deepEqual(run.missedQuestionIDs, []);
  for (const now of [NaN, Infinity, -Infinity, null, '1000']) assert.equal(run.retryMissed({ now }), null);
  assert.deepEqual(snapshot(run), before);
});

test('requesting retry twice creates independent attempts from the same completed source', () => {
  const run = new QuizRun(quizWithQuestions(2), { now: 0 });
  finish(run, [1, 1], 1);
  const before = snapshot(run);
  const first = run.retryMissed({ now: 100_000 });
  const second = run.retryMissed({ now: 200_000 });
  assertFreshRetry(run, first, run.missedQuestionIDs, 100_000);
  assertFreshRetry(run, second, run.missedQuestionIDs, 200_000);
  assert.notEqual(first, second);
  const secondBefore = snapshot(second);
  assert.equal(first.submit(0, 100_001), true);
  assert.equal(first.score, 1000);
  assert.deepEqual(snapshot(second), secondBefore);
  assert.deepEqual(snapshot(run), before);
});

test('a singular untimed miss stays untimed in its fresh retry', () => {
  const quiz = quizWithQuestions(1, () => ({ timeLimitSeconds: 0 }));
  const run = new QuizRun(quiz, { now: 0 });
  finish(run, [1], 1);
  const retry = run.retryMissed({ now: 500_000 });
  assertFreshRetry(run, retry, [quiz.questions[0].id], 500_000);
  assert.equal(retry.remainingSeconds(999_999_999), null);
  assert.equal(retry.advance(999_999_999), false);
  assert.equal(retry.submit(0, 999_999_999), true);
  assert.equal(retry.next(1_000_000_000), true);
  assert.equal(retry.score, 1000);
  assert.equal(retry.retryMissed(), null);
});

test('all 30 questions can be retried without new question IDs or an invalid subset document', () => {
  const quiz = quizWithQuestions(30);
  const run = new QuizRun(quiz, { now: 0 });
  finish(run, Array(30).fill(1), 1);
  const ids = quiz.questions.map(question => question.id);
  assert.deepEqual(run.missedQuestionIDs, ids);
  const before = snapshot(run);
  const retry = run.retryMissed({ now: 100_000 });
  assertFreshRetry(run, retry, ids, 100_000);
  assert.equal(retry.quiz.questions.length, 30);
  assert.deepEqual(snapshot(run), before);
});

test('an eligible retry rejects invalid clocks without modifying the completed run', () => {
  const run = new QuizRun(quizWithQuestions(1), { now: 0 });
  finish(run, [1], 1);
  const before = snapshot(run);
  for (const now of [NaN, Infinity, -Infinity, null, '1000']) {
    assert.throws(() => run.retryMissed({ now }), RangeError);
    assert.deepEqual(snapshot(run), before);
  }
  assertFreshRetry(run, run.retryMissed({ now: 0 }), run.missedQuestionIDs, 0);
});

test('an eligible retry with the default clock starts its deadline at the new attempt', () => {
  const run = new QuizRun(quizWithQuestions(1), { now: 0 });
  finish(run, [1], 1);
  const before = Date.now();
  const retry = run.retryMissed();
  const after = Date.now();
  assert.equal(retry.phase, 'answer');
  assert.equal(retry.score, 0);
  assert.ok(retry.deadline >= before + 20_000);
  assert.ok(retry.deadline <= after + 20_000);
});
