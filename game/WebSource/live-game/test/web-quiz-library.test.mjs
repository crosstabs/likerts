import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateQuiz, encodeQuiz, sampleQuizDocument } from '../web/quiz-document.mjs';
import { MAX_SAVED_QUIZZES, QUIZ_LIBRARY_KEY, QuizLibrary } from '../web/quiz-library.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const open = data => new QuizLibrary({ storage: data, locks: data.locks });

test('quiz library persists valid documents and returns detached values', async () => {
  const data = createStorage(), library = open(data), sample = sampleQuizDocument(); await library.save(sample);
  const values = library.quizzes; values[0].title = 'Not saved'; values[0].questions[0].answers[0] = 'Not saved';
  assert.equal(library.quizzes[0].title, sample.title);
  assert.equal(library.quizzes[0].questions[0].answers[0], sample.questions[0].answers[0]);
  const reloaded = open(data); assert.deepEqual(reloaded.quizzes, [sample]);
  const edited = reloaded.quizzes[0]; edited.title = 'Updated'; await reloaded.save(edited);
  assert.equal(reloaded.quizzes.length, 1); assert.equal(open(data).quizzes[0].title, 'Updated');
});

test('malformed or future saved library is blocked without overwriting its bytes', async () => {
  for (const raw of ['{broken', JSON.stringify({ format: 'likerts.quiz.library', version: 2, quizzes: [] }),
    JSON.stringify({ format: 'likerts.quiz.library', version: 1, quizzes: [], unexpected: true })]) {
    const data = createStorage(); data.values.set(QUIZ_LIBRARY_KEY, raw);
    const library = open(data); assert.equal(library.blocked, true);
    await assert.rejects(library.save(sampleQuizDocument()), { code: 'load_failed' });
    assert.equal(data.writes, 0); assert.equal(data.values.get(QUIZ_LIBRARY_KEY), raw);
  }
});

test('write failure preserves both last successful storage and in-memory library', async () => {
  const data = createStorage(), library = open(data); await library.save(sampleQuizDocument());
  const before = data.values.get(QUIZ_LIBRARY_KEY), original = library.quizzes;
  const edited = library.quizzes[0]; edited.title = 'Unsaved changes'; data.failWrite = true;
  await assert.rejects(library.save(edited), { code: 'save_failed' });
  assert.equal(data.values.get(QUIZ_LIBRARY_KEY), before); assert.deepEqual(library.quizzes, original);
  await assert.rejects(library.remove(original[0].id), { code: 'save_failed' }); assert.deepEqual(library.quizzes, original);
  data.failWrite = false; await library.save(edited); assert.equal(library.quizzes[0].title, 'Unsaved changes');
});

test('import and duplicate create fresh document and question identifiers', async () => {
  const data = createStorage(), library = open(data), sample = sampleQuizDocument();
  await library.save(sample); const imported = await library.importQuiz(encodeQuiz(sample)), duplicated = await library.duplicate(sample);
  const identifiers = library.quizzes.flatMap(quiz => [quiz.id, ...quiz.questions.map(question => question.id)]);
  assert.equal(new Set(identifiers).size, identifiers.length); assert.equal(library.quizzes.length, 3);
  assert.equal(imported.title, sample.title); assert.equal(duplicated.title, sample.title);
  assert.deepEqual(imported.questions.map(question => question.answers), sample.questions.map(question => question.answers));
});

test('saved-quiz limit permits edits but blocks another import without deleting data', async () => {
  const data = createStorage(), library = open(data);
  for (let index = 0; index < MAX_SAVED_QUIZZES; index++) await library.save(duplicateQuiz(sampleQuizDocument()));
  const before = data.values.get(QUIZ_LIBRARY_KEY); await assert.rejects(library.importQuiz(encodeQuiz(sampleQuizDocument())), { code: 'library_full' });
  assert.equal(data.values.get(QUIZ_LIBRARY_KEY), before);
  const edited = library.quizzes[0]; edited.title = 'One edited quiz'; await library.save(edited);
  assert.equal(library.quizzes.length, 25); assert.equal(library.quizzes[0].title, 'One edited quiz');
});

test('reset removes only the dedicated quiz key, and reports failed removal', async () => {
  const data = createStorage(); data.values.set(QUIZ_LIBRARY_KEY, 'invalid'); data.values.set('likerts.live.saved', 'keep');
  const library = open(data); data.failWrite = true;
  await assert.rejects(library.reset(), { code: 'reset_failed' }); assert.equal(data.values.get(QUIZ_LIBRARY_KEY), 'invalid');
  data.failWrite = false; assert.equal(await library.reset(), true); assert.equal(library.blocked, false);
  assert.equal(data.values.has(QUIZ_LIBRARY_KEY), false); assert.equal(data.values.get('likerts.live.saved'), 'keep');
  await library.save(sampleQuizDocument()); assert.equal(library.quizzes.length, 1);
});

test('invalid saved documents and repeated identifiers fail closed', () => {
  const sample = sampleQuizDocument();
  for (const quizzes of [[sample, sample], [{ ...sample, questions: [] }]]) {
    const data = createStorage(); data.values.set(QUIZ_LIBRARY_KEY, JSON.stringify({ format: 'likerts.quiz.library', version: 1, quizzes }));
    const library = open(data); assert.equal(library.blocked, true); assert.equal(data.writes, 0);
  }
});

test('unavailable local storage preserves sample-only capability without save claims', async () => {
  const library = new QuizLibrary(); assert.equal(library.blocked, true);
  assert.equal(library.lastError.code, 'storage_unavailable'); assert.deepEqual(library.quizzes, []);
  await assert.rejects(library.save(sampleQuizDocument()), { code: 'storage_unavailable' });
});

test('missing Web Locks makes storage read-only without losing practice or export content', async () => {
  const data = createStorage(); await open(data).save(sampleQuizDocument());
  const library = new QuizLibrary({ storage: data });
  assert.equal(library.blocked, false); assert.equal(library.canWrite, false);
  assert.equal(library.lastError.code, 'locking_unavailable'); assert.equal(library.quizzes.length, 1);
  const writes = data.writes;
  await assert.rejects(library.save(sampleQuizDocument()), { code: 'locking_unavailable' });
  await assert.rejects(library.remove(library.quizzes[0].id), { code: 'locking_unavailable' });
  await assert.rejects(library.reset(), { code: 'locking_unavailable' }); assert.equal(data.writes, writes);
});

test('parallel writes from two loaded tabs serialize and reject the stale snapshot', async () => {
  const data = createStorage(), first = open(data), second = open(data);
  const one = sampleQuizDocument(); one.title = 'First tab';
  const two = sampleQuizDocument(); two.title = 'Second tab';
  const results = await Promise.allSettled([first.save(one), second.importQuiz(encodeQuiz(two))]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'storage_changed'); assert.equal(data.locks.maximumActive, 1);
  assert.deepEqual(open(data).quizzes.map(quiz => quiz.title), ['First tab']);
  second.reload(); await second.importQuiz(encodeQuiz(two));
  assert.deepEqual(open(data).quizzes.map(quiz => quiz.title), ['Second tab', 'First tab']);
});

test('stale delete and stale reset preserve another tab’s newer saved work', async () => {
  const data = createStorage(); await open(data).save(sampleQuizDocument());
  const first = open(data), second = open(data), edited = first.quizzes[0]; edited.title = 'Newer title'; await first.save(edited);
  const before = data.values.get(QUIZ_LIBRARY_KEY);
  await assert.rejects(second.remove(edited.id), { code: 'storage_changed' });
  await assert.rejects(second.reset(), { code: 'storage_changed' });
  assert.equal(data.values.get(QUIZ_LIBRARY_KEY), before); assert.equal(open(data).quizzes[0].title, 'Newer title');
});
