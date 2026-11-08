import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { encodeQuiz, parseQuiz, sampleQuizDocument, starterQuizDocuments } from '../web/quiz-document.mjs';
import { QUIZ_LIBRARY_KEY, QuizLibrary } from '../web/quiz-library.mjs';
import { mountQuizApp, readQuizFile } from '../web/quiz-ui.mjs';
import { createStorage } from './web-quiz-test-support.mjs';
import { partyGuide } from '../web/quiz-scene.mjs';
const flush = () => new Promise(resolve => setImmediate(resolve));

const bytes = value => new TextEncoder().encode(value);
const file = value => { const data = bytes(value); return { size: data.length, arrayBuffer: async () => data.buffer }; };
function fixture(t, { data = createStorage(), unavailable = false, noLocks = false, hostQuiz } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="app"></div></body></html>', { url: 'https://quiz-test.invalid/play/quizzes' });
  const window = dom.window, root = window.document.querySelector('#app'), library = new QuizLibrary({ storage: unavailable ? null : data, locks: noLocks ? null : data.locks });
  window.scrollTo = () => {};
  let clock = 0; const downloads = [];
  const app = mountQuizApp({ root, library, window, now: () => clock, download: (source, name) => downloads.push({ source, name }), hostQuiz });
  t.after(() => { app.dispose(); window.close(); });
  const get = id => root.querySelector('#' + id);
  const clickNode = async node => { assert.ok(node, 'Expected a quiz control'); node.click(); await flush(); };
  const click = id => clickNode(get(id));
  const input = (id, value) => { const node = get(id); assert.ok(node, id + ' must exist'); node.value = value; node.dispatchEvent(new window.Event('input', { bubbles: true })); };
  return { data, dom, window, root, library, app, downloads, get, click, clickNode, input, setClock: value => { clock = value; } };
}

test('web creator saves, reloads, edits, exports, imports a new copy and confirms deletion', async t => {
  const first = fixture(t); await first.click('quiz-copy-sample'); assert.equal(first.app.screen, 'editor');
  first.input('quiz-title', 'Family quiz'); await first.click('quiz-save'); assert.equal(first.app.screen, 'library');
  assert.equal(first.library.quizzes.length, 1); assert.match(first.root.textContent, /Quiz saved on this browser/);
  const second = fixture(t, { data: first.data });
  const id = second.library.quizzes[0].id; await second.clickNode(second.root.querySelector('[data-quiz-edit="' + id + '"]'));
  await second.click('quiz-question-tab-2'); second.input('quiz-prompt', 'Which ocean is the biggest?'); await second.click('quiz-save');
  second.get('quiz-export-' + id).focus();
  await second.clickNode(second.root.querySelector('[data-quiz-export="' + id + '"]')); assert.equal(second.downloads.length, 1);
  assert.equal(second.window.document.activeElement.id, 'quiz-export-' + id);
  const exported = parseQuiz(second.downloads[0].source); assert.equal(exported.questions[2].prompt, 'Which ocean is the biggest?');
  assert.equal(second.downloads[0].name, 'Family-quiz.likerts-quiz.json');
  await second.app.importFile(file(second.downloads[0].source)); assert.equal(second.library.quizzes.length, 2);
  assert.notEqual(second.library.quizzes[0].id, id); assert.deepEqual(second.library.quizzes[0].questions.map(q => q.prompt), exported.questions.map(q => q.prompt));
  const imported = second.library.quizzes[0].id;
  await second.clickNode(second.root.querySelector('[data-quiz-duplicate="' + imported + '"]')); assert.equal(second.library.quizzes.length, 3);
  second.get('quiz-delete-' + imported).focus();
  await second.clickNode(second.root.querySelector('[data-quiz-delete="' + imported + '"]')); assert.ok(second.get('quiz-confirm-title'));
  await second.click('quiz-confirm-cancel'); assert.equal(second.library.quizzes.length, 3);
  assert.equal(second.window.document.activeElement.id, 'quiz-delete-' + imported);
  await second.clickNode(second.root.querySelector('[data-quiz-delete="' + imported + '"]')); await second.click('quiz-confirm-action'); assert.equal(second.library.quizzes.length, 2);
  assert.equal(new QuizLibrary({ storage: first.data, locks: first.data.locks }).quizzes.length, 2);
});

test('hosting is the primary saved-quiz action but still requires an explicit upload confirmation', async t => {
  const data = createStorage(), library = new QuizLibrary({ storage: data, locks: data.locks });
  const quiz = await library.save(sampleQuizDocument()), hosted = [];
  const f = fixture(t, { data, hostQuiz: value => { hosted.push(value); } });
  const host = () => f.root.querySelector('[data-quiz-host="' + quiz.id + '"]');
  const practice = f.root.querySelector('[data-quiz-practice="' + quiz.id + '"]');
  assert.equal(host().classList.contains('lime'), true);
  assert.equal(practice.classList.contains('quiet'), true);
  assert.equal(f.get('quiz-join-room').getAttribute('href'), '/play');
  const guide = f.root.querySelector('.q-party-guide');
  assert.match(guide.textContent, /Ember · The Spark/); assert.equal(guide.querySelector('[data-quiz-entrance]'), null);
  await f.clickNode(host()); assert.match(f.root.querySelector('#quiz-confirm-message').textContent, /answer key/);
  assert.equal(hosted.length, 0); await f.click('quiz-confirm-cancel'); assert.equal(hosted.length, 0);
  await f.clickNode(host()); await f.click('quiz-confirm-action');
  assert.equal(hosted.length, 1); assert.equal(hosted[0].id, quiz.id);
  const offline = fixture(t, { data });
  assert.equal(offline.root.querySelector('[data-quiz-host]'), null);
  assert.equal(offline.root.querySelector('[data-quiz-practice]').classList.contains('lime'), true);
  await offline.clickNode(offline.root.querySelector('[data-quiz-practice]'));
  assert.equal(offline.app.screen, 'practice');
});

test('all starters stay ahead of a full local library and can be tried or copied without saving or uploading', async t => {
  const data = createStorage(), library = new QuizLibrary({ storage: data, locks: data.locks });
  await library.save(sampleQuizDocument());
  for (let index = 1; index < 25; index++) await library.duplicate(library.quizzes[0]);
  const hosted = [], f = fixture(t, { data, hostQuiz: quiz => { hosted.push(quiz); } });
  const starters = starterQuizDocuments(), section = f.root.querySelector('.q-starters'), saved = f.root.querySelector('.q-saved-quizzes');
  assert.equal(f.library.quizzes.length, 25); assert.equal(f.root.querySelectorAll('.q-library-row').length, 25);
  assert.equal(section.querySelectorAll('.q-starter-card').length, 3);
  assert.ok(section.compareDocumentPosition(saved) & f.window.Node.DOCUMENT_POSITION_FOLLOWING);
  for (const quiz of starters) {
    const host = section.querySelector('[data-starter-host="' + quiz.id + '"]'), practice = section.querySelector('[data-starter-practice="' + quiz.id + '"]');
    assert.equal(host.textContent, 'Host live'); assert.equal(host.getAttribute('aria-label'), 'Host ' + quiz.title + ' live');
    assert.equal(practice.textContent, 'Practice'); assert.equal(practice.getAttribute('aria-label'), 'Practice ' + quiz.title);
    assert.ok(section.querySelector('[data-starter-copy="' + quiz.id + '"]'));
  }
  const writes = data.writes;
  await f.clickNode(section.querySelector('[data-starter-practice="' + starters[1].id + '"]'));
  assert.equal(f.app.screen, 'practice'); assert.match(f.root.textContent, /Sky high/); assert.match(f.root.textContent, /Question 1 of 5/);
  await f.click('quiz-practice-back'); await f.click('quiz-confirm-action');
  await f.clickNode(f.root.querySelector('[data-starter-copy="' + starters[2].id + '"]'));
  assert.equal(f.app.screen, 'editor'); assert.match(f.get('quiz-title').value, /Wild world/);
  assert.equal(f.root.querySelectorAll('.q-question-tab').length, 5);
  assert.equal(data.writes, writes); assert.equal(f.library.quizzes.length, 25); assert.equal(hosted.length, 0);
});

test('Meet the cast is an optional native disclosure after all library play controls, with no play or storage side effects', async t => {
  const data = createStorage(), library = new QuizLibrary({ storage: data, locks: data.locks });
  await library.save(sampleQuizDocument());
  for (let index = 1; index < 25; index++) await library.duplicate(library.quizzes[0]);
  let hosted = 0;
  const f = fixture(t, { data, hostQuiz: () => { hosted++; } });
  const disclosure = f.get('quiz-meet-cast'), summary = f.get('quiz-meet-cast-summary');
  assert.equal(disclosure.tagName, 'DETAILS'); assert.equal(disclosure.open, false);
  assert.equal(disclosure.firstElementChild, summary); assert.equal(summary.tagName, 'SUMMARY');
  assert.equal(summary.textContent, 'Meet the cast'); assert.equal(summary.hasAttribute('tabindex'), false);
  assert.equal(disclosure.querySelector('button,a,input,select,textarea,[tabindex]'), null);
  assert.equal(f.root.querySelectorAll('.q-library-row').length, 25);
  for (const control of f.root.querySelectorAll('main button,main a,main input')) {
    assert.ok(control.compareDocumentPosition(disclosure) & f.window.Node.DOCUMENT_POSITION_FOLLOWING, control.id || control.textContent);
  }
  const starters = f.root.querySelector('.q-starters'), saved = f.root.querySelector('.q-saved-quizzes');
  assert.ok(starters.compareDocumentPosition(saved) & f.window.Node.DOCUMENT_POSITION_FOLLOWING);
  const rows = [...disclosure.querySelectorAll('.q-cast-row')];
  assert.equal(rows.length, 5);
  for (const [index, beat] of ['gather', 'question', 'locked', 'reveal', 'finished'].entries()) {
    const guide = partyGuide(beat), row = rows[index], portrait = row.querySelector('.quiz-guide-character');
    assert.equal(row.querySelector('h3').textContent, guide.characterName + ' · ' + guide.role);
    assert.equal(row.querySelector('.q-cast-voice').textContent, '“' + guide.voiceLine + '”');
    assert.equal(row.querySelector('.q-muted').textContent, guide.castDescription);
    assert.equal(portrait.getAttribute('aria-hidden'), 'true');
    assert.equal(portrait.dataset.guideCharacter, String(index + 1));
    assert.equal(row.querySelector('[data-quiz-entrance],.quiz-celebration'), null);
  }
  assert.match(disclosure.textContent, /Five guides\. One room\. Same rules for everyone\./);
  assert.match(disclosure.textContent, /Gather → Choose → Keep it sealed → Reveal → Go again\./);
  assert.equal(disclosure.querySelector('.q-cast-closing').textContent, 'Quizzes ask what you know. Mind-reading asks how well you know each other. Either way, bring your people.');
  const writes = data.writes, savedSource = data.getItem(QUIZ_LIBRARY_KEY);
  summary.focus(); assert.equal(f.window.document.activeElement, summary);
  await f.clickNode(summary); assert.equal(disclosure.open, true); assert.equal(f.window.document.activeElement, summary);
  await f.clickNode(summary); assert.equal(disclosure.open, false); assert.equal(f.window.document.activeElement, summary);
  assert.equal(f.app.screen, 'library'); assert.equal(f.library.quizzes.length, 25);
  assert.equal(data.writes, writes); assert.equal(data.getItem(QUIZ_LIBRARY_KEY), savedSource);
  assert.equal(hosted, 0); assert.equal(f.downloads.length, 0); assert.equal(f.root.querySelector('dialog'), null);
});

test('the editor starts with the question and keeps question management after its answers', async t => {
  const f = fixture(t); await f.click('quiz-copy-sample');
  assert.equal(f.window.document.activeElement.id, 'quiz-prompt');
  for (const id of ['quiz-title', 'quiz-add-question', 'quiz-move-up', 'quiz-move-down', 'quiz-remove-question']) {
    assert.ok(f.get('quiz-prompt').compareDocumentPosition(f.get(id)) & f.window.Node.DOCUMENT_POSITION_FOLLOWING, id);
    assert.ok(f.get('quiz-answer-0').compareDocumentPosition(f.get(id)) & f.window.Node.DOCUMENT_POSITION_FOLLOWING, id);
  }
  f.input('quiz-prompt', 'A question worth asking?');
  await f.click('quiz-add-question'); assert.equal(f.window.document.activeElement.id, 'quiz-prompt');
  assert.equal(f.get('quiz-question-heading').textContent, 'Question 4');
  await f.click('quiz-question-tab-0'); assert.equal(f.get('quiz-prompt').value, 'A question worth asking?');
  assert.equal(f.get('quiz-question-tab-0').getAttribute('aria-current'), 'step');
});

test('practice locks answers, reveals correctness, scores and starts a fresh replay', async t => {
  const f = fixture(t); await f.click('quiz-practice-sample'); assert.equal(f.get('quiz-lock-answer').disabled, true);
  assert.equal(f.root.querySelector('.q-choice-result'), null);
  await f.click('quiz-play-answer-1'); await f.click('quiz-lock-answer'); assert.match(f.get('quiz-reveal-heading').textContent, /right/);
  assert.match(f.root.textContent, /1,000 points/); assert.equal(f.get('quiz-play-answer-0').disabled, true);
  await f.click('quiz-next'); await f.click('quiz-play-answer-0'); await f.click('quiz-lock-answer'); assert.match(f.get('quiz-reveal-heading').textContent, /Not this time/);
  await f.click('quiz-next'); await f.click('quiz-play-answer-2'); await f.click('quiz-lock-answer'); await f.click('quiz-next');
  assert.equal(f.get('quiz-practice-heading').textContent, 'Quiz complete');
  assert.equal(f.root.querySelector('.q-result-score').textContent, '2 of 3 correct'); assert.equal(f.root.querySelector('.q-total-points').textContent, '2,000 points');
  assert.equal(f.get('quiz-result-label').textContent, 'Your total');
  const art = f.root.querySelector('.q-result-art');
  assert.match(art.querySelector('.quiz-scene-actors img').getAttribute('src'), /story-cast-celebrate.png$/);
  assert.equal(art.querySelector('.quiz-celebration').getAttribute('aria-hidden'), 'true'); assert.equal(art.querySelector('img').alt, '');
  assert.ok(f.root.querySelector('.q-result-summary').compareDocumentPosition(art) & f.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(f.get('quiz-replay').compareDocumentPosition(art) & f.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(f.get('quiz-result-back').compareDocumentPosition(art) & f.window.Node.DOCUMENT_POSITION_FOLLOWING);
  await f.click('quiz-replay'); assert.match(f.root.textContent, /Question 1 of 3/); assert.equal(f.get('quiz-lock-answer').disabled, true);
  assert.equal(f.root.querySelector('.q-result-art'), null); assert.equal(f.root.querySelector('.q-result-summary'), null);
});

test('all-timeout practice ends with an accurate zero total and neutral original cast after the actions', async t => {
  const f = fixture(t); await f.click('quiz-practice-sample');
  for (const deadline of [20_000, 40_000, 70_000]) { f.setClock(deadline); f.app.tick(); await f.click('quiz-next'); }
  assert.equal(f.get('quiz-practice-heading').textContent, 'Quiz complete');
  assert.equal(f.root.querySelector('.q-total-points').textContent, '0 points'); assert.equal(f.root.querySelector('.q-result-score').textContent, '0 of 3 correct');
  const art = f.root.querySelector('.q-result-art'); assert.equal(art.querySelector('.quiz-celebration'), null);
  assert.match(art.querySelector('.quiz-scene-actors img').getAttribute('src'), /story-cast-hold.png$/); assert.equal(art.querySelector('img').alt, '');
  assert.equal(art.querySelector('.quiz-cast-hold').getAttribute('aria-hidden'), 'true');
  assert.ok(f.get('quiz-result-back').compareDocumentPosition(art) & f.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(f.root.textContent, /This practice score isn’t saved/);
});

test('absolute deadline advances to a zero-point timeout without accepting a stale answer', async t => {
  const f = fixture(t); await f.click('quiz-practice-sample'); await f.click('quiz-play-answer-1');
  f.setClock(20_000); f.app.tick(); assert.equal(f.get('quiz-reveal-heading').textContent, 'Time’s up');
  assert.equal(f.root.querySelector('.q-reveal-points').textContent, '0 points');
  assert.equal(f.get('quiz-lock-answer'), null); assert.equal(f.root.querySelectorAll('.q-practice-choice.is-selected').length, 0);
});

test('editor reorders questions and requires a new correct answer when that option is removed', async t => {
  const f = fixture(t); await f.click('quiz-copy-sample'); await f.click('quiz-move-down');
  assert.equal(f.get('quiz-question-heading').textContent, 'Question 2'); assert.match(f.get('quiz-prompt').value, /Red Planet/);
  f.input('quiz-prompt', 'Which planet looks red?');
  assert.equal(f.get('quiz-question-tab-1').getAttribute('aria-label'), 'Question 2: Which planet looks red?');
  f.get('quiz-correct-3').checked = true; f.get('quiz-correct-3').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await f.click('quiz-remove-answer'); await f.click('quiz-save'); assert.equal(f.app.screen, 'editor'); assert.match(f.get('quiz-edit-error').textContent, /choose the correct answer/);
  assert.equal(f.library.quizzes.length, 0);
  f.get('quiz-correct-1').checked = true; f.get('quiz-correct-1').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await f.click('quiz-save'); assert.equal(f.library.quizzes[0].questions[1].answers.length, 3);
  assert.equal(f.library.quizzes[0].questions[1].correctAnswer, 1);
});

test('unsaved editor cancellation offers keep editing or explicit discard', async t => {
  const f = fixture(t); await f.click('quiz-copy-sample'); f.input('quiz-title', 'Unsaved title'); await f.click('quiz-editor-cancel');
  assert.match(f.get('quiz-confirm-title').textContent, /Discard/); await f.click('quiz-confirm-cancel');
  assert.equal(f.get('quiz-title').value, 'Unsaved title'); assert.equal(f.app.screen, 'editor');
  await f.click('quiz-nav-library'); await f.click('quiz-confirm-action'); assert.equal(f.app.screen, 'library'); assert.equal(f.library.quizzes.length, 0);
});

test('storage failure keeps edited values and never announces a save', async t => {
  const f = fixture(t); await f.click('quiz-copy-sample'); f.input('quiz-title', 'Keep these changes'); f.data.failWrite = true; await f.click('quiz-save');
  assert.equal(f.app.screen, 'editor'); assert.equal(f.get('quiz-title').value, 'Keep these changes');
  assert.match(f.get('quiz-edit-error').textContent, /could not be updated/); assert.equal(f.library.quizzes.length, 0);
  assert.doesNotMatch(f.root.textContent, /Quiz saved on this browser/);
});

test('corrupt-library reset requires confirmation and leaves unrelated game storage alone', async t => {
  const data = createStorage(); data.values.set(QUIZ_LIBRARY_KEY, '{broken'); data.values.set('other-game-key', 'keep');
  const f = fixture(t, { data }); assert.equal(f.get('quiz-create').disabled, true);
  await f.click('quiz-reset-library'); assert.equal(data.values.get(QUIZ_LIBRARY_KEY), '{broken');
  await f.click('quiz-confirm-cancel'); assert.equal(data.values.get(QUIZ_LIBRARY_KEY), '{broken');
  await f.click('quiz-reset-library'); await f.click('quiz-confirm-action'); assert.equal(data.values.has(QUIZ_LIBRARY_KEY), false);
  assert.equal(data.values.get('other-game-key'), 'keep'); assert.equal(f.get('quiz-create').disabled, false);
});

test('sample practice remains available when browser storage is unavailable', async t => {
  const f = fixture(t, { unavailable: true }); assert.equal(f.get('quiz-create').disabled, true);
  assert.equal(f.get('quiz-reset-library'), null); await f.click('quiz-practice-sample'); assert.equal(f.app.screen, 'practice');
});

test('untrusted imported question text is rendered as text rather than HTML', async t => {
  const f = fixture(t), quiz = sampleQuizDocument(); quiz.title = '<img src=x onerror=alert(1)>';
  quiz.questions[0].prompt = '<script>alert(1)</script>';
  await f.app.importFile(file(encodeQuiz(quiz))); assert.equal(f.root.querySelector('img[onerror],img[src="x"]'), null); assert.equal(f.root.querySelector('script'), null);
  assert.match(f.root.textContent, /<img src=x onerror=alert\(1\)>/);
  await f.clickNode(f.root.querySelector('[data-quiz-edit]')); assert.equal(f.get('quiz-prompt').value, '<script>alert(1)</script>');
});

test('a cross-tab conflict keeps the editor and exports work before explicit reload and save-as-copy', async t => {
  const data = createStorage(), original = sampleQuizDocument();
  await new QuizLibrary({ storage: data, locks: data.locks }).save(original);
  const f = fixture(t, { data }); await f.clickNode(f.root.querySelector('[data-quiz-edit]'));
  f.input('quiz-title', 'My unsaved version');
  const other = new QuizLibrary({ storage: data, locks: data.locks });
  const newer = other.quizzes[0]; newer.title = 'Other tab’s newer work'; await other.save(newer);
  await f.click('quiz-save'); assert.equal(f.app.screen, 'editor');
  assert.equal(f.get('quiz-title').value, 'My unsaved version'); assert.equal(f.get('quiz-save').disabled, true);
  assert.match(f.get('quiz-edit-error').textContent, /changed in another tab/);
  f.get('quiz-export-draft').focus(); await f.click('quiz-export-draft'); assert.equal(parseQuiz(f.downloads[0].source).title, 'My unsaved version');
  assert.equal(f.window.document.activeElement.id, 'quiz-export-draft');
  assert.equal(new QuizLibrary({ storage: data, locks: data.locks }).quizzes[0].title, 'Other tab’s newer work');
  await f.click('quiz-reload-for-copy'); assert.equal(f.get('quiz-title').value, 'My unsaved version');
  assert.equal(f.get('quiz-save').disabled, false); await f.click('quiz-save');
  const saved = new QuizLibrary({ storage: data, locks: data.locks }).quizzes;
  assert.equal(saved.length, 2); assert.deepEqual(saved.map(quiz => quiz.title), ['My unsaved version', 'Other tab’s newer work']);
  assert.notEqual(saved[0].id, original.id);
  assert.ok(saved[0].questions.every(question => !original.questions.some(old => old.id === question.id)));
});

test('without Web Locks the editor remains useful for export and practice with saving explicitly unavailable', async t => {
  const f = fixture(t, { noLocks: true });
  assert.match(f.root.textContent, /Saving is not available here/); assert.equal(f.get('quiz-import').disabled, true);
  await f.click('quiz-copy-sample'); assert.equal(f.get('quiz-save').disabled, true);
  f.input('quiz-title', 'A portable quiz'); await f.click('quiz-export-draft');
  assert.equal(parseQuiz(f.downloads[0].source).title, 'A portable quiz'); assert.equal(f.library.quizzes.length, 0);
  assert.equal(f.data.values.has(QUIZ_LIBRARY_KEY), false);
  await f.click('quiz-practice-draft'); assert.equal(f.app.screen, 'practice');
});

test('file import bounds raw bytes and rejects malformed UTF-8 before document parsing', async () => {
  let reads = 0;
  await assert.rejects(readQuizFile({ size: 65_537, arrayBuffer: async () => { reads++; return new ArrayBuffer(0); } }), { code: 'file_too_large' });
  assert.equal(reads, 0);
  await assert.rejects(readQuizFile({ size: 2, arrayBuffer: async () => Uint8Array.from([0xc0, 0xaf]).buffer }), { code: 'invalid_encoding' });
  await assert.rejects(readQuizFile({ size: 1, arrayBuffer: async () => new ArrayBuffer(65_537) }), { code: 'file_too_large' });
  await assert.rejects(readQuizFile({ size: 1, arrayBuffer: async () => { throw new Error('Unavailable file'); } }), { code: 'read_failed' });
  const source = encodeQuiz(sampleQuizDocument()); assert.equal(await readQuizFile(file(source)), source);
});
