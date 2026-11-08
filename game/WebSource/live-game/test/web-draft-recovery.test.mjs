import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { QuizLibrary, QUIZ_LIBRARY_KEY } from '../web/quiz-library.mjs';
import { QuizDraftStore, QUIZ_DRAFT_KEY } from '../web/quiz-draft.mjs';
import { mountQuizApp } from '../web/quiz-ui.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, { data = createStorage(), noLocks = false, entryIntent = null, access = null } = {}) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://draft-test.invalid/play/quizzes' });
  dom.window.scrollTo = () => {};
  const root = dom.window.document.getElementById('app'), locks = noLocks ? null : data.locks;
  const library = new QuizLibrary({ storage: data, locks }), draftStore = new QuizDraftStore({ storage: data, locks });
  const hosted = [], app = mountQuizApp({ root, library, draftStore, window: dom.window, entryIntent, now: () => 0,
    hostQuiz: value => hosted.push(value), liveAccess: () => access });
  t.after(() => { app.dispose(); dom.window.close(); });
  const get = id => root.querySelector('#' + id);
  const flush = async () => { await app.flushDraft(); await turn(); };
  const clickNode = async node => { assert.ok(node, 'Expected control'); node.click(); await flush(); };
  const click = id => clickNode(get(id));
  const input = async (id, value) => { const node = get(id); assert.ok(node, id); node.value = value; node.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush(); };
  return { dom, root, library, draftStore, data, hosted, app, get, click, clickNode, input, flush };
}
async function seedDraft(data, quiz = sampleQuizDocument(), sourceQuiz = null) {
  const store = new QuizDraftStore({ storage: data, locks: data.locks });
  return store.save({ draftID: crypto.randomUUID(), quiz, sourceQuiz, questionIndex: 0 });
}

test('incomplete text survives remount only after explicit Continue; Create hint does not replace it', async t => {
  const a = await fixture(t, { entryIntent: 'create' });
  const field = a.get('quiz-prompt'); field.focus();
  await a.input('quiz-prompt', '  A question still in progress\n');
  assert.equal(a.get('quiz-prompt'), field); assert.equal(a.dom.window.document.activeElement, field);
  await a.input('quiz-answer-0', 'Half an answer');
  const raw = a.data.getItem(QUIZ_DRAFT_KEY), saved = JSON.parse(raw);
  assert.equal(saved.quiz.title, ''); assert.equal(saved.quiz.questions[0].answers[1], ''); assert.equal(saved.quiz.questions[0].correctAnswer, -1);
  assert.equal(a.data.getItem(QUIZ_LIBRARY_KEY), null);
  const b = await fixture(t, { data: a.data, entryIntent: 'create' });
  assert.equal(b.app.screen, 'library'); assert.ok(b.get('quiz-restore-draft')); assert.equal(b.data.getItem(QUIZ_DRAFT_KEY), raw);
  await b.click('quiz-restore-draft');
  assert.equal(b.app.screen, 'editor'); assert.equal(b.get('quiz-prompt').value, '  A question still in progress\n');
  assert.equal(b.get('quiz-answer-0').value, 'Half an answer'); assert.equal(b.get('quiz-answer-1').value, '');
  assert.equal(b.root.querySelector('input[name="correct-answer"]:checked'), null); assert.equal(b.data.getItem(QUIZ_LIBRARY_KEY), null);
  assert.deepEqual(b.hosted, []);
});

test('autosave preserves focused input, caret and coalesces rapid edits without stale resurrection', async t => {
  const f = await fixture(t, { entryIntent: 'create' }), field = f.get('quiz-prompt');
  field.focus();
  for (const value of ['O', 'On', 'One', 'One more']) {
    field.value = value; field.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  }
  field.setSelectionRange(2, 4); await f.flush();
  assert.equal(f.get('quiz-prompt'), field); assert.equal(f.dom.window.document.activeElement, field);
  assert.equal(field.selectionStart, 2); assert.equal(field.selectionEnd, 4);
  assert.equal(f.draftStore.current.quiz.questions[0].prompt, 'One more');
  await f.input('quiz-prompt', '');
  assert.equal(f.data.getItem(QUIZ_DRAFT_KEY), null);
  const next = await fixture(t, { data: f.data });
  assert.equal(next.get('quiz-restore-draft'), null); assert.equal(next.data.getItem(QUIZ_LIBRARY_KEY), null);
});

test('all structural edits and selected question are recoverable', async t => {
  const f = await fixture(t, { entryIntent: 'create' });
  await f.input('quiz-prompt', 'First'); await f.click('quiz-correct-2');
  await f.click('quiz-remove-answer'); await f.click('quiz-add-question'); await f.input('quiz-prompt', 'Second');
  const select = f.get('quiz-time-limit'); select.value = '0'; select.dispatchEvent(new f.dom.window.Event('change')); await f.flush();
  await f.click('quiz-move-up');
  const record = f.draftStore.current;
  assert.equal(record.quiz.questions.length, 2); assert.equal(record.questionIndex, 0);
  assert.equal(record.quiz.questions[0].prompt, 'Second'); assert.equal(record.quiz.questions[0].timeLimitSeconds, 0);
  assert.equal(record.quiz.questions[1].correctAnswer, 2); assert.equal(record.quiz.questions[1].answers.length, 3);
  const b = await fixture(t, { data: f.data }); await b.click('quiz-restore-draft');
  assert.equal(b.get('quiz-prompt').value, 'Second');
  await b.click('quiz-remove-question'); await b.click('quiz-confirm-action');
  assert.equal(b.draftStore.current.quiz.questions.length, 1); assert.equal(b.get('quiz-prompt').value, 'First');
});

test('explicit discard clears only recovery data; cancel preserves it', async t => {
  const data = createStorage(), saved = new QuizLibrary({ storage: data, locks: data.locks }); await saved.save(sampleQuizDocument());
  const libraryRaw = data.getItem(QUIZ_LIBRARY_KEY); await seedDraft(data);
  const f = await fixture(t, { data }), raw = data.getItem(QUIZ_DRAFT_KEY);
  await f.click('quiz-discard-draft'); await f.click('quiz-confirm-cancel');
  assert.equal(data.getItem(QUIZ_DRAFT_KEY), raw); assert.equal(data.getItem(QUIZ_LIBRARY_KEY), libraryRaw);
  await f.click('quiz-discard-draft'); await f.click('quiz-confirm-action');
  assert.equal(data.getItem(QUIZ_DRAFT_KEY), null); assert.equal(data.getItem(QUIZ_LIBRARY_KEY), libraryRaw);
  assert.equal(f.get('quiz-restore-draft'), null);
});

for (const corrupt of [false, true]) test('an open Discard confirmation cannot remove newer ' + (corrupt ? 'corrupt' : 'valid') + ' other-tab data', async t => {
  const data = createStorage();
  if (corrupt) data.values.set(QUIZ_DRAFT_KEY, '{old-bad'); else await seedDraft(data);
  const f = await fixture(t, { data }); await f.click('quiz-discard-draft');
  let newer;
  if (corrupt) { newer = '{new-bad'; data.values.set(QUIZ_DRAFT_KEY, newer); }
  else {
    const other = new QuizDraftStore({ storage: data, locks: data.locks }), record = other.current;
    record.quiz.title = 'Other tab, after confirmation';
    await other.save({ draftID: record.draftID, quiz: record.quiz, sourceQuiz: record.sourceQuiz, questionIndex: record.questionIndex });
    newer = data.getItem(QUIZ_DRAFT_KEY);
  }
  f.dom.window.dispatchEvent(new f.dom.window.StorageEvent('storage', { key: QUIZ_DRAFT_KEY }));
  assert.ok(f.get('quiz-confirm-title')); await f.click('quiz-confirm-action');
  assert.equal(data.getItem(QUIZ_DRAFT_KEY), newer); assert.equal(data.getItem(QUIZ_LIBRARY_KEY), null);
  assert.match(f.root.textContent, /another tab/);
});

test('discard waits for an in-flight save and does not recreate the discarded draft', async t => {
  const data = createStorage(); let release;
  const original = data.locks.request.bind(data.locks);
  data.locks.request = (name, options, action) => name.includes('draft.write') && !release
    ? original(name, options, async lock => { await new Promise(resolve => { release = resolve; }); return action(lock); })
    : original(name, options, action);
  const f = await fixture(t, { data, entryIntent: 'create' });
  const field = f.get('quiz-prompt'); field.value = 'Pending text'; field.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  await turn(); assert.equal(typeof release, 'function');
  f.get('quiz-editor-cancel').click(); f.get('quiz-confirm-action').click();
  release(); await f.flush(); await turn();
  assert.equal(f.app.screen, 'library'); assert.equal(data.getItem(QUIZ_DRAFT_KEY), null);
  await turn(); assert.equal(data.getItem(QUIZ_DRAFT_KEY), null);
});

test('save succeeds only through the library and removes its matching recovery revision', async t => {
  const data = createStorage(); await seedDraft(data);
  const f = await fixture(t, { data }); await f.click('quiz-restore-draft'); await f.input('quiz-title', 'Recovered and saved');
  await f.click('quiz-save');
  assert.equal(f.app.screen, 'library'); assert.equal(f.library.quizzes[0].title, 'Recovered and saved');
  assert.equal(data.getItem(QUIZ_DRAFT_KEY), null); assert.deepEqual(f.hosted, []);
  const next = await fixture(t, { data }); assert.equal(next.get('quiz-restore-draft'), null);
});

test('failed library save leaves unfinished draft recoverable and saved library untouched', async t => {
  const data = createStorage(); await seedDraft(data);
  const f = await fixture(t, { data }); await f.click('quiz-restore-draft'); await f.input('quiz-title', 'Keep after save failure');
  const set = data.setItem.bind(data); data.setItem = (key, value) => { if (key === QUIZ_LIBRARY_KEY) throw new Error('Quota'); return set(key, value); };
  await f.click('quiz-save');
  assert.equal(f.app.screen, 'editor'); assert.equal(data.getItem(QUIZ_LIBRARY_KEY), null);
  assert.equal(f.draftStore.current.quiz.title, 'Keep after save failure');
  data.setItem = set; await f.click('quiz-save'); assert.equal(data.getItem(QUIZ_DRAFT_KEY), null);
});

for (const action of ['save', 'discard']) test('a failed auxiliary recovery write does not block explicit ' + action, async t => {
  const data = createStorage(); await seedDraft(data);
  const f = await fixture(t, { data }); await f.click('quiz-restore-draft');
  const set = data.setItem.bind(data);
  data.setItem = (key, value) => { if (key === QUIZ_DRAFT_KEY) throw new Error('Draft quota'); return set(key, value); };
  await f.input('quiz-title', 'Latest in-memory edit');
  assert.match(f.get('quiz-draft-status').textContent, /could not keep/);
  if (action === 'save') await f.click('quiz-save');
  else { await f.click('quiz-editor-cancel'); await f.click('quiz-confirm-action'); }
  assert.equal(f.app.screen, 'library'); assert.equal(data.getItem(QUIZ_DRAFT_KEY), null);
  assert.equal(f.library.quizzes.length, action === 'save' ? 1 : 0);
  if (action === 'save') assert.equal(f.library.quizzes[0].title, 'Latest in-memory edit');
});

test('successful explicit save waits for the pending recovery write and cannot resurrect it afterward', async t => {
  const data = createStorage(); await seedDraft(data);
  const f = await fixture(t, { data }); await f.click('quiz-restore-draft');
  let release;
  const request = data.locks.request.bind(data.locks);
  data.locks.request = (name, options, callback) => name.includes('draft.write') && !release
    ? request(name, options, async lock => { await new Promise(resolve => { release = resolve; }); return callback(lock); })
    : request(name, options, callback);
  const field = f.get('quiz-title'); field.value = 'Pending but saved'; field.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  await turn(); f.get('quiz-save').click(); release();
  for (let step = 0; step < 5; step++) { await f.flush(); await turn(); }
  assert.equal(f.app.screen, 'library'); assert.equal(f.library.quizzes[0].title, 'Pending but saved');
  assert.equal(data.getItem(QUIZ_DRAFT_KEY), null); await turn(); assert.equal(data.getItem(QUIZ_DRAFT_KEY), null);
});

test('a newer other-tab draft survives stale autosave, successful library save and cleanup', async t => {
  const data = createStorage(); await seedDraft(data);
  const a = await fixture(t, { data }), b = await fixture(t, { data });
  await a.click('quiz-restore-draft'); await b.click('quiz-restore-draft');
  // A took the current snapshot first; B's immediate claim is stale and cannot replace it.
  await a.input('quiz-title', 'Newer A'); const newest = data.getItem(QUIZ_DRAFT_KEY);
  await b.input('quiz-title', 'Local B'); assert.equal(data.getItem(QUIZ_DRAFT_KEY), newest);
  assert.match(b.get('quiz-draft-status').textContent, /another tab/);
  await b.click('quiz-save');
  assert.equal(b.app.screen, 'library'); assert.equal(b.library.quizzes[0].title, 'Local B');
  assert.equal(data.getItem(QUIZ_DRAFT_KEY), newest); assert.match(b.root.textContent, /could not be removed/);
  const returned = await fixture(t, { data }); await returned.click('quiz-restore-draft');
  assert.equal(returned.get('quiz-title').value, 'Newer A'); assert.equal(returned.get('quiz-save').disabled, true);
  const libraryRaw = data.getItem(QUIZ_LIBRARY_KEY);
  await returned.click('quiz-reload-for-copy'); assert.equal(data.getItem(QUIZ_LIBRARY_KEY), libraryRaw);
  await returned.click('quiz-save');
  const quizzes = new QuizLibrary({ storage: data, locks: data.locks }).quizzes;
  assert.equal(quizzes.length, 2); assert.ok(quizzes.some(quiz => quiz.title === 'Local B')); assert.ok(quizzes.some(quiz => quiz.title === 'Newer A'));
});

test('a formerly-new recovery ID saved by another client is protected even after a library reload', async t => {
  const data = createStorage(); await seedDraft(data);
  const f = await fixture(t, { data }); await f.click('quiz-restore-draft'); await f.input('quiz-title', 'Still an unfinished edit');
  const record = f.draftStore.current, olderClient = new QuizLibrary({ storage: data, locks: data.locks });
  const saved = structuredClone(record.quiz); saved.title = 'Saved through the unchanged v1 library';
  const draftRaw = data.getItem(QUIZ_DRAFT_KEY); await olderClient.save(saved);
  assert.equal(data.getItem(QUIZ_DRAFT_KEY), draftRaw, 'A library-only client does not touch recovery data');
  const libraryRaw = data.getItem(QUIZ_LIBRARY_KEY); assert.equal(f.library.reload(), true);
  await f.click('quiz-save');
  assert.equal(f.app.screen, 'editor'); assert.equal(f.get('quiz-save').disabled, true);
  assert.equal(data.getItem(QUIZ_LIBRARY_KEY), libraryRaw); assert.ok(f.get('quiz-reload-for-copy'));
});

for (const change of ['changed', 'deleted']) test('restoring an edited saved quiz detects a ' + change + ' target and requires a new copy', async t => {
  const data = createStorage(), library = new QuizLibrary({ storage: data, locks: data.locks });
  const original = await library.save(sampleQuizDocument());
  const f = await fixture(t, { data }); await f.clickNode(f.root.querySelector('[data-quiz-edit="' + original.id + '"]'));
  await f.input('quiz-title', 'Unfinished original edits');
  const other = new QuizLibrary({ storage: data, locks: data.locks });
  if (change === 'changed') { const edited = structuredClone(original); edited.title = 'Newer saved version'; await other.save(edited); }
  else await other.remove(original.id);
  const before = data.getItem(QUIZ_LIBRARY_KEY), restored = await fixture(t, { data }); await restored.click('quiz-restore-draft');
  assert.equal(restored.get('quiz-save').disabled, true); assert.ok(restored.get('quiz-reload-for-copy')); assert.equal(restored.get('quiz-title').value, 'Unfinished original edits');
  await restored.click('quiz-reload-for-copy'); assert.equal(restored.get('quiz-save').disabled, false);
  assert.equal(data.getItem(QUIZ_LIBRARY_KEY), before); assert.notEqual(restored.draftStore.current.quiz.id, original.id);
  await restored.click('quiz-save');
  const result = new QuizLibrary({ storage: data, locks: data.locks }).quizzes;
  assert.equal(result.find(quiz => quiz.id !== original.id).title, 'Unfinished original edits');
  assert.equal(result.find(quiz => quiz.id === original.id)?.title, change === 'changed' ? 'Newer saved version' : undefined);
});

test('corrupt recovery is preserved until explicit discard, without resetting the saved library', async t => {
  const data = createStorage(); data.values.set(QUIZ_DRAFT_KEY, '{bad');
  const f = await fixture(t, { data, entryIntent: 'create' });
  assert.equal(f.app.screen, 'library'); assert.ok(f.get('quiz-draft-heading'));
  await f.click('quiz-create'); assert.equal(f.app.screen, 'library'); assert.equal(data.getItem(QUIZ_DRAFT_KEY), '{bad');
  await f.click('quiz-discard-draft'); await f.click('quiz-confirm-action');
  assert.equal(data.getItem(QUIZ_DRAFT_KEY), null); assert.equal(data.getItem(QUIZ_LIBRARY_KEY), null);
  await f.click('quiz-create'); assert.equal(f.app.screen, 'editor');
});

test('quota failure keeps field memory and truthful status; a safe explicit retry can recover', async t => {
  const f = await fixture(t, { entryIntent: 'create' }); f.data.failWrite = true;
  await f.input('quiz-prompt', 'Still here');
  assert.equal(f.get('quiz-prompt').value, 'Still here'); assert.equal(f.data.getItem(QUIZ_DRAFT_KEY), null);
  assert.match(f.get('quiz-draft-status').textContent, /could not keep/); assert.equal(f.get('quiz-retry-draft-save').disabled, false);
  f.data.failWrite = false; await f.click('quiz-retry-draft-save');
  assert.equal(f.draftStore.current.quiz.questions[0].prompt, 'Still here');
});

test('read-only lockless recovery permits editing but cannot silently write or discard', async t => {
  const data = createStorage(); await seedDraft(data); const raw = data.getItem(QUIZ_DRAFT_KEY), writes = data.writes;
  const f = await fixture(t, { data, noLocks: true }); assert.equal(f.get('quiz-discard-draft').disabled, true);
  await f.click('quiz-restore-draft'); await f.input('quiz-title', 'Read-only edits');
  assert.equal(f.get('quiz-title').value, 'Read-only edits'); assert.equal(f.get('quiz-save').disabled, true);
  assert.equal(data.getItem(QUIZ_DRAFT_KEY), raw); assert.equal(data.writes, writes);
  assert.match(f.get('quiz-draft-status').textContent, /cannot keep/);
});

test('practice and narrowed retry never replace the full editor recovery quiz', async t => {
  const f = await fixture(t); await f.click('quiz-copy-sample'); await f.input('quiz-title', 'Practice this draft');
  const before = f.data.getItem(QUIZ_DRAFT_KEY); await f.click('quiz-practice-draft');
  for (const [index, answer] of [1, 0, 0].entries()) { await f.click('quiz-play-answer-' + answer); await f.click('quiz-lock-answer'); await f.click('quiz-next'); }
  await f.click('quiz-retry-missed'); assert.match(f.root.textContent, /Question 1 of 2/);
  assert.equal(f.data.getItem(QUIZ_DRAFT_KEY), before); assert.equal(f.draftStore.current.quiz.questions.length, 3);
  await f.click('quiz-practice-back'); await f.click('quiz-confirm-action'); assert.equal(f.app.screen, 'editor');
  assert.equal(f.root.querySelectorAll('.q-question-tab').length, 3); assert.equal(f.get('quiz-title').value, 'Practice this draft');
});

test('room recovery and stored draft both remain explicit; no host or recovery action is automatic', async t => {
  const data = createStorage(); await seedDraft(data);
  const f = await fixture(t, { data, entryIntent: 'create', access: { pending: true } });
  assert.equal(f.app.screen, 'library'); assert.ok(f.get('quiz-recover-live')); assert.ok(f.get('quiz-restore-draft'));
  assert.equal(f.dom.window.document.activeElement.id, 'quiz-recover-live'); assert.deepEqual(f.hosted, []);
});
