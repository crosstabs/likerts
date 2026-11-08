import { QUIZ_LIMITS, QuizValidationError, encodeQuiz, makeQuestion, makeQuiz, normalizeQuiz, starterQuizDocuments } from './quiz-document.mjs';
import { QuizRun } from './quiz-run.mjs';
import { QuizLibraryError } from './quiz-library.mjs';
import { totem } from './art.mjs';
import { companionScene, castScene, libraryScene, partyGuide, guideScene, partyCastPresentation } from './quiz-scene.mjs';
import { createQuizMotionController } from './quiz-motion.mjs';

const ANSWER_KEY_NOTE = 'Quiz files include correct answers. Share them with hosts.';
const scalarCount = value => [...value].length;
const copy = value => structuredClone(value);
const friendlyError = error => error instanceof QuizValidationError || error instanceof QuizLibraryError
  ? error.message : 'Something interrupted this quiz. Try again.';
const shortPrompt = question => question.prompt.trim() || 'Untitled question';

/** Decode file bytes strictly; File.text() would silently replace malformed UTF-8. */
export async function readQuizFile(file) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > QUIZ_LIMITS.bytes || typeof file.arrayBuffer !== 'function') {
    throw new QuizLibraryError('file_too_large', 'Choose a quiz file no larger than 64 KB.');
  }
  let data;
  try { data = await file.arrayBuffer(); }
  catch (cause) { throw new QuizLibraryError('read_failed', 'This quiz file could not be opened. Try choosing it again.', cause); }
  if (!data || !Number.isSafeInteger(data.byteLength) || data.byteLength > QUIZ_LIMITS.bytes) {
    throw new QuizLibraryError('file_too_large', 'Choose a quiz file no larger than 64 KB.');
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch (cause) { throw new QuizLibraryError('invalid_encoding', 'This quiz file is not valid UTF-8 text.', cause); }
}

export function mountQuizApp({ root, library, window: win = globalThis.window, now = () => Date.now(), download, hostQuiz, liveAccess = () => null, recoverLive } = {}) {
  if (!root || !library || !win) throw new Error('A quiz root, local library and window are required.');
  const document = root.ownerDocument;
  const motion = createQuizMotionController({window:win});
  const model = { screen: 'library', draft: null, baseline: '', questionIndex: 0, editError: '', editorNotice: '', editorConflict: false, feedback: '', error: '',
    confirm: null, busy: false, busyMessage: '', run: null, practiceOriginalQuiz: null, practiceIsRetry: false, practiceReviewOpen: false, practiceOrigin: 'library', selection: null, focusAfter: null };
  let disposed = false, importOperation = null;
  const urls = new Set(), questionLabels = new Map();
  const dirty = () => !!model.draft && JSON.stringify(model.draft) !== model.baseline;
  const activePractice = () => model.screen === 'practice' && model.run?.phase !== 'finished';

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || (value === false && !key.startsWith('aria-'))) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (['checked', 'disabled', 'value', 'hidden'].includes(key)) node[key] = value;
      else node.setAttribute(key, key.startsWith('aria-') ? String(value) : value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child !== undefined && child !== null && child !== false) node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  const text = (value, className = '') => el('p', { class: className }, value);
  const button = (label, action, { id, className = 'q-button', disabled = false, ...attrs } = {}) => el('button', {
    type: 'button', id, class: className, disabled: disabled || model.busy, onclick: action, ...attrs,
  }, label);
  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', { up: 'M12 19V5m-6 6 6-6 6 6', down: 'M12 5v14m-6-6 6 6 6-6',
      trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5',
      plus: 'M12 5v14M5 12h14', check: 'm5 12 4 4L19 6', back: 'M20 12H4m6-6-6 6 6 6' }[kind]);
    for (const [key, value] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(key, value);
    svg.append(path); return svg;
  }
  const iconButton = (kind, label, action, options = {}) => button(icon(kind), action, { className: 'q-icon-button', 'aria-label': label, title: label, ...options });

  function report(error) { model.error = friendlyError(error); model.feedback = ''; render(); }
  function editFailure(error) {
    model.editError = friendlyError(error);
    if (library.blocked) model.editorConflict = true;
    render({ focus: 'quiz-edit-error' });
  }
  function ask(title, message, label, action, { destructive = false, cancelLabel = 'Cancel' } = {}) {
    model.confirm = { title, message, label, action, destructive, cancelLabel, returnFocus: document.activeElement?.id };
    render({ focus: 'quiz-confirm-cancel' });
  }
  function dismiss() {
    const focus = model.confirm?.returnFocus; model.confirm = null; render({ focus });
  }
  function leaveFor(action) {
    if (dirty()) ask('Discard these quiz changes?', 'Your saved quiz will stay as it was. Keep editing to save this version.', 'Discard changes', action, { destructive: true, cancelLabel: 'Keep editing' });
    else if (activePractice()) ask('Leave this practice?', 'Your practice progress will be lost. Your saved quiz will stay in the library.', 'Leave practice', action);
    else action();
  }
  function goLibrary() {
    leaveFor(() => { model.screen = 'library'; model.draft = null; model.run = null; model.practiceOriginalQuiz = null; model.practiceIsRetry = false; model.practiceReviewOpen = false; model.editError = ''; model.error = ''; render({ focus: 'quiz-page-title' }); });
  }
  function header() {
    return el('header', { class: 'q-topbar' }, el('div', { class: 'q-wordmark', 'aria-label': 'Likerts' }, 'likerts', el('span', { 'aria-hidden': 'true' }, '.')),
      el('nav', { 'aria-label': 'Game modes' }, button('Quizzes', goLibrary, { className: 'q-mode is-current', id: 'quiz-nav-library', 'aria-current': 'page' }),
        el('a', { class: 'q-mode', href: '/play', id: 'quiz-nav-mindreading', onclick: event => {
          if (dirty() || activePractice()) { event.preventDefault(); leaveFor(() => win.location.assign('/play')); }
        } }, 'Join or host live')), model.screen!=='practice'&&totem(el,3,'q-neutral-guide'));
  }
  function messageBlocks() {
    return [model.feedback && el('div', { class: 'q-message', role: 'status', 'aria-live': 'polite' }, text(model.feedback)),
      model.error && el('div', { class: 'q-message is-error', role: 'alert' }, text(model.error))];
  }
  function storageWarning() {
    if (!library.blocked && !library.writeSupported) return el('section', { class: 'q-message', role: 'status' },
      el('h2', {}, 'Saving is not available here'), text('You can still edit, export and practice quiz files in this browser.'));
    if (!library.blocked) return null;
    return el('section', { class: 'q-message is-error', 'aria-labelledby': 'quiz-storage-heading' },
      el('h2', { id: 'quiz-storage-heading' }, 'Your saved quizzes need attention'), text(library.lastError?.message || 'This browser cannot save quizzes.'),
      el('div', { class: 'q-action-row' }, button('Try reading again', () => {
        library.reload(); model.error = ''; render({ focus: library.blocked ? 'quiz-storage-heading' : 'quiz-page-title' });
      }, { className: 'q-button quiet', id: 'quiz-retry-storage' }),
      library.writeSupported && library.lastError?.code !== 'storage_changed' && button('Reset this browser’s quiz library', () => ask('Reset this quiz library?',
        'This removes all saved quiz files from this browser. Export any quizzes you can still open before resetting. Other Likerts game data is separate.',
        'Reset quiz library', () => updateLibrary(() => library.reset(), 'The quiz library was reset on this browser.'),
        { destructive: true }), { className: 'q-text-button', id: 'quiz-reset-library' })));
  }
  function startEditor(value, { copyAsNew = false } = {}) {
    try {
      model.draft = value ? (copyAsNew ? library.freshCopy(value) : copy(value)) : makeQuiz();
      model.baseline = JSON.stringify(model.draft); model.questionIndex = 0; model.screen = 'editor';
      model.editError = ''; model.editorNotice = ''; model.editorConflict = false; model.error = ''; model.feedback = ''; render({ focus: 'quiz-prompt' });
    } catch (error) { report(error); }
  }
  function markDirty() {
    model.editError = ''; const error = root.querySelector('#quiz-edit-error'); if (error) { error.hidden = true; error.textContent = ''; }
    for (const [index, question] of (model.draft?.questions ?? []).entries()) {
      const node = questionLabels.get(question.id); if (node) {
        node.textContent = shortPrompt(question); node.title = question.prompt;
        node.parentElement?.setAttribute('aria-label', 'Question ' + (index + 1) + ': ' + shortPrompt(question));
      }
    }
  }
  async function saveDraft() {
    if (model.busy || model.editorConflict) return;
    const draft = copy(model.draft); model.busy = true; model.busyMessage = 'Saving your quiz…'; model.editError = ''; render();
    try {
      const saved = await library.save(draft); model.draft = saved; model.baseline = JSON.stringify(saved);
      model.screen = 'library'; model.draft = null; model.editError = ''; model.feedback = 'Quiz saved on this browser.'; model.error = '';
    } catch (error) { model.editError = friendlyError(error); if (library.blocked) model.editorConflict = true; }
    finally { model.busy = false; model.busyMessage = ''; if (!disposed) render({ focus: model.screen === 'editor' ? 'quiz-edit-error' : 'quiz-page-title' }); }
  }
  async function updateLibrary(action, success) {
    if (model.busy) return;
    model.busy = true; model.busyMessage = 'Updating saved quizzes…'; model.error = ''; model.feedback = ''; render();
    try { await action(); model.feedback = success; }
    catch (error) { model.error = friendlyError(error); }
    finally { model.busy = false; model.busyMessage = ''; if (!disposed) render({ focus: 'quiz-page-title' }); }
  }
  function reloadForCopy() {
    if (!library.reload()) { model.editError = library.lastError?.message || 'Saved quizzes could not be read.'; render({ focus: 'quiz-edit-error' }); return; }
    try {
      model.draft = library.freshCopy(model.draft); model.baseline = '';
      model.editorConflict = false; model.editError = '';
      model.editorNotice = 'Saved quizzes reloaded. Your edits are kept as a new copy. Save quiz to keep this version.';
      render({ focus: 'quiz-title' });
    } catch (error) { editFailure(error); }
  }
  function startPractice(value, origin = 'library') {
    try {
      const run = new QuizRun(normalizeQuiz(value), { now: now() });
      model.practiceOriginalQuiz = run.quiz; model.practiceOrigin = origin; beginPracticeAttempt(run, false);
    } catch (error) { origin === 'editor' ? editFailure(error) : report(error); }
  }
  function beginPracticeAttempt(run, retry) {
    model.run = run; model.practiceIsRetry = retry; model.practiceReviewOpen = false; model.selection = null;
    model.practiceMotionId = globalThis.crypto.randomUUID();
    model.screen = 'practice'; model.error = ''; model.editError = ''; model.feedback = '';
    render({ focus: 'quiz-practice-heading' });
    if (typeof win.scrollTo === 'function') win.scrollTo(0, 0);
  }
  function retryPracticeMisses() {
    try { const retry = model.run?.retryMissed({ now: now() }); if (retry) beginPracticeAttempt(retry, true); }
    catch (error) { report(error); }
  }
  function returnToEditor() {
    const action = () => { model.screen = 'editor'; model.run = null; model.practiceOriginalQuiz = null; model.practiceIsRetry = false; model.practiceReviewOpen = false; model.selection = null; render({ focus: 'quiz-question-heading' }); };
    if (activePractice()) ask('Return to your quiz?', 'This practice run will end. Your editor changes are kept.', 'Return to editor', action);
    else action();
  }
  async function importFile(file) {
    if (!file || model.busy) return;
    const operation = {}; importOperation = operation; model.busy = true; model.busyMessage = 'Reading your quiz file…'; model.error = ''; model.feedback = ''; render();
    try {
      const source = await readQuizFile(file);
      if (disposed || importOperation !== operation) return;
      await library.importQuiz(source); model.feedback = 'Quiz imported as a new copy on this browser.';
    } catch (error) { if (!disposed && importOperation === operation) model.error = friendlyError(error); }
    finally {
      if (importOperation === operation) { importOperation = null; model.busy = false; model.busyMessage = ''; if (!disposed) render({ focus: 'quiz-page-title' }); }
    }
  }
  function exportQuiz(quiz) {
    const returnFocus = document.activeElement?.id;
    try {
      const source = encodeQuiz(quiz);
      const filename = quiz.title.normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'likerts';
      if (download) download(source, filename + '.likerts-quiz.json');
      else {
        if (typeof win.URL.createObjectURL !== 'function') throw new QuizLibraryError('download_unavailable', 'This browser could not prepare a quiz download. Try a different browser.');
        const url = win.URL.createObjectURL(new win.Blob([source], { type: 'application/json;charset=utf-8' })); urls.add(url);
        const link = el('a', { href: url, download: filename + '.likerts-quiz.json', hidden: true }); document.body.append(link); link.click(); link.remove();
        win.setTimeout(() => { win.URL.revokeObjectURL(url); urls.delete(url); }, 1000);
      }
      if (model.screen === 'editor') model.editorNotice = 'Quiz file prepared for download. It includes the correct answers.';
      else model.feedback = 'Quiz file prepared for download. It includes the correct answers.';
      model.error = ''; render({ focus: returnFocus });
    } catch (error) { model.screen === 'editor' ? editFailure(error) : report(error); }
  }
  function quizRow(quiz) {
    return el('article', { class: 'q-library-row', 'aria-labelledby': 'quiz-name-' + quiz.id },
      el('div', { class: 'q-quiz-info' }, el('h2', { id: 'quiz-name-' + quiz.id }, quiz.title), text(quiz.questions.length + (quiz.questions.length === 1 ? ' question' : ' questions'), 'q-muted')),
      el('div', { class: 'q-library-actions' },
        hostQuiz && button('Host live', () => confirmHost(quiz), { className: 'q-button lime', 'aria-label': 'Host ' + quiz.title + ' live', 'data-quiz-host': quiz.id }),
        button('Practice', () => startPractice(quiz), { className: hostQuiz ? 'q-button quiet' : 'q-button lime', 'aria-label': 'Practice ' + quiz.title, 'data-quiz-practice': quiz.id }),
        button('Edit', () => startEditor(quiz), { className: 'q-button quiet', 'aria-label': 'Edit ' + quiz.title, 'data-quiz-edit': quiz.id }),
        button('Duplicate', () => updateLibrary(() => library.duplicate(quiz), 'A new quiz copy was saved.'),
          { className: 'q-text-button', 'aria-label': 'Duplicate ' + quiz.title, 'data-quiz-duplicate': quiz.id, disabled: !library.canWrite }),
        button('Export', () => exportQuiz(quiz), { className: 'q-text-button', id: 'quiz-export-' + quiz.id, 'aria-label': 'Export ' + quiz.title, 'data-quiz-export': quiz.id }),
        button('Delete', () => ask('Delete “' + quiz.title + '”?', 'This removes the saved quiz from this browser. Any exported files stay where you saved them.', 'Delete quiz',
          () => updateLibrary(() => library.remove(quiz.id), 'Quiz deleted from this browser.'),
          { destructive: true }), { className: 'q-text-button is-danger', id: 'quiz-delete-' + quiz.id, 'aria-label': 'Delete ' + quiz.title, 'data-quiz-delete': quiz.id, disabled: !library.canWrite })));
  }
  function gatheringGuide() {
    if (!hostQuiz) return null;
    const guide = partyGuide('gather');
    const art = guideScene(el, guide.beat, 'q-party-guide-scene');
    art.removeAttribute('data-quiz-entrance');
    return el('aside', { class: 'q-party-guide', 'aria-label': 'Party guide', 'data-party-beat': guide.beat },
      art,
      el('div', {}, text(guide.characterName + ' · ' + guide.role, 'q-guide-name'),
        text(guide.title, 'q-guide-title'), text(guide.cue, 'q-muted')));
  }
  function starterCollection() {
    return el('section', { class: 'q-starters', 'aria-labelledby': 'quiz-starters-heading' },
      el('h2', { id: 'quiz-starters-heading', class: 'q-section-heading' }, hostQuiz ? 'Pick tonight’s quiz.' : 'Try a starter.'),
      text('Short quizzes, ready to play. Make a copy to add your own twist.', 'q-muted'),
      el('div', { class: 'q-starter-grid' }, starterQuizDocuments().map((quiz, index) => {
        const actionId = action => index === 0 ? 'quiz-' + action + '-sample' : 'quiz-' + action + '-starter-' + quiz.id;
        const headingId = index === 0 ? 'quiz-sample-heading' : 'quiz-starter-heading-' + quiz.id;
        return el('article', { class: 'q-starter-card', 'aria-labelledby': headingId, 'data-starter-id': quiz.id },
          el('h3', { id: headingId }, 'Try ' + quiz.title),
          text(quiz.questions.length + ' questions', 'q-muted'),
          el('div', { class: 'q-action-row' },
            hostQuiz && button('Host live', () => confirmHost(quiz),
              { className: 'q-button lime', id: actionId('host'), 'aria-label': 'Host ' + quiz.title + ' live', 'data-starter-host': quiz.id }),
            button('Practice', () => startPractice(quiz),
              { className: hostQuiz ? 'q-button quiet' : 'q-button lime', id: actionId('practice'), 'aria-label': 'Practice ' + quiz.title, 'data-starter-practice': quiz.id }),
            button('Make a copy', () => startEditor(quiz, { copyAsNew: true }),
              { className: 'q-text-button', id: actionId('copy'), 'aria-label': 'Make a copy of ' + quiz.title, 'data-starter-copy': quiz.id, disabled: library.blocked })));
      })));
  }
  function meetTheCast() {
    const beats = ['gather', 'question', 'locked', 'reveal', 'finished'];
    return el('details', { id: 'quiz-meet-cast', class: 'q-cast-disclosure' },
      el('summary', { id: 'quiz-meet-cast-summary' }, 'Meet the cast'),
      el('div', { class: 'q-cast-body' },
        el('h2', {}, 'Meet your party guides.'),
        text(partyCastPresentation.intro, 'q-muted'),
        text(partyCastPresentation.arc, 'q-cast-arc'),
        el('ol', { class: 'q-cast-list' }, beats.map(beat => {
          const guide = partyGuide(beat);
          return el('li', { class: 'q-cast-row' }, guideScene(el, beat),
            el('div', {}, el('h3', {}, guide.characterName + ' · ' + guide.role),
              text('“' + guide.voiceLine + '”', 'q-cast-voice'), text(guide.castDescription, 'q-muted')));
        })),
        text(partyCastPresentation.closing, 'q-cast-closing')));
  }
  function libraryScreen() {
    const quizzes = library.quizzes;
    const file = el('input', { type: 'file', accept: '.json,application/json', id: 'quiz-import-file', class: 'q-file-input', 'aria-label': 'Choose a Likerts quiz file', disabled: model.busy || !library.canWrite,
      onchange: event => { const selected = event.target.files?.[0]; event.target.value = ''; void importFile(selected); } });
    return el('main', { id: 'main', class: 'q-library', tabindex: '-1' },
      el('div', { class: 'q-page-heading' }, el('h1', { id: 'quiz-page-title', tabindex: '-1' }, 'Quizzes'),
        el('div', { class: 'q-action-row' }, el('a', { class: 'q-button quiet', id: 'quiz-join-room', href: '/play' }, 'Join a room'),
          button('Import quiz', () => file.click(), { className: 'q-button quiet', id: 'quiz-import', disabled: !library.canWrite }),
          button('Create quiz', () => startEditor(), { id: 'quiz-create', disabled: library.blocked }))),
      text(hostQuiz ? 'Host a quiz. Make one. Bring your people.' : 'Make a quiz. Find out what you know.', 'q-lede'),
      text('Saved on this browser. Export a quiz file to move it between web and iPhone.', 'q-muted'),
      messageBlocks(), liveRecovery(), storageWarning(), file, model.busy && el('p', { role: 'status', class: 'q-message' }, model.busyMessage),
      gatheringGuide(), starterCollection(),
      el('section', { class: 'q-saved-quizzes', 'aria-labelledby': 'quiz-saved-heading' },
        el('h2', { id: 'quiz-saved-heading', class: 'q-section-heading' }, 'Your quizzes'),
        quizzes.length ? quizzes.map(quizRow) : text(library.blocked ? 'Saved quizzes are unavailable until the library can be read.' : 'Your first quiz starts with a good question.', 'q-empty')),
      meetTheCast(), libraryScene(el),
      text(ANSWER_KEY_NOTE, 'q-sharing-note'), text(hostQuiz ? 'Host a live quiz for web and iPhone players. Practice stays on this device.' : 'Quiz practice stays on this device.', 'q-muted q-scope-note'));
  }
  function liveRecovery() {
    const access = liveAccess();
    if (!access) return null;
    return el('section', { class: 'q-message', role: 'status' }, el('h2', {}, access.pending ? 'Let’s confirm your room.' : 'Your room is saved.'),
      text(access.pending ? 'Recover your hosting request before creating another room.' : 'Resume your room to leave or close it before hosting another.'),
      button(access.pending ? 'Recover room request' : 'Open saved room', () => beginHosting(recoverLive), { id: 'quiz-recover-live', className: 'q-button quiet' }));
  }
  function confirmHost(value) {
    if (!hostQuiz || model.busy) return;
    if (liveAccess()) { render({ focus: 'quiz-recover-live' }); return; }
    let snapshot;
    try { snapshot = normalizeQuiz(value); } catch (error) { report(error); return; }
    ask('Host “' + snapshot.title + '” live?', 'A fixed copy of this quiz, including its answer key, will be uploaded to the game server. Players join by code. Their answers become visible when each question is revealed.',
      'Host live', () => beginHosting(() => hostQuiz(snapshot)), { cancelLabel: 'Keep library' });
  }
  async function beginHosting(action) {
    if (model.busy || typeof action !== 'function') return;
    model.busy = true; model.busyMessage = 'Confirming your live room…'; model.error = ''; render();
    try { await action(); }
    catch (error) { model.error = typeof error?.message === 'string' ? error.message : 'The room could not be confirmed. Recover the request to try again.'; }
    finally { model.busy = false; model.busyMessage = ''; if (!disposed) render(); }
  }
  function field(label, id, node, { note, count, maximum } = {}) {
    const countNode = count === undefined ? null : el('span', { class: 'q-count', id: id + '-count' }, count + '/' + maximum);
    if (countNode) node.setAttribute('aria-describedby', id + '-count');
    return el('div', { class: 'q-field' }, el('div', { class: 'q-field-label' }, el('label', { for: id }, label), countNode), node, note && text(note, 'q-field-note'));
  }
  function updateText(value, setter, id, maximum) {
    setter(value); markDirty(); const count = root.querySelector('#' + id + '-count');
    if (count) { count.textContent = scalarCount(value) + '/' + maximum; count.classList.toggle('is-over', scalarCount(value) > maximum); }
  }
  function selectQuestion(index) { model.questionIndex = index; model.editError = ''; render({ focus: 'quiz-question-heading' }); }
  function moveQuestion(direction) {
    const target = model.questionIndex + direction;
    if (target < 0 || target >= model.draft.questions.length) return;
    const [question] = model.draft.questions.splice(model.questionIndex, 1); model.draft.questions.splice(target, 0, question);
    model.questionIndex = target; model.editError = ''; render({ focus: 'quiz-question-heading' });
  }
  function removeQuestion() {
    if (model.draft.questions.length <= 1) return;
    ask('Remove this question?', 'This removes the question from your edited quiz. Save the quiz to keep that change.', 'Remove question', () => {
      model.draft.questions.splice(model.questionIndex, 1); model.questionIndex = Math.min(model.questionIndex, model.draft.questions.length - 1);
      model.editError = ''; render({ focus: 'quiz-question-heading' });
    }, { destructive: true });
  }
  function answerField(question, answer, index) {
    const selected = question.correctAnswer === index, id = 'quiz-answer-' + index;
    return el('div', { class: 'q-answer-editor' + (selected ? ' is-correct' : '') },
      el('label', { class: 'q-correct-toggle', title: 'Mark answer ' + (index + 1) + ' as correct' },
        el('input', { type: 'radio', name: 'correct-answer', id: 'quiz-correct-' + index, checked: selected, 'aria-label': 'Mark answer ' + (index + 1) + ' correct',
          onchange: () => { question.correctAnswer = index; model.editError = ''; render({ focus: 'quiz-correct-' + index }); } }),
        el('span', { class: 'q-radio-visual', 'aria-hidden': 'true' }, selected && icon('check'))),
      el('div', { class: 'q-answer-content' }, el('label', { for: id }, 'Answer ' + (index + 1)),
        el('input', { type: 'text', id, value: answer, maxlength: QUIZ_LIMITS.answer * 2, autocomplete: 'off',
          oninput: event => { question.answers[index] = event.target.value; markDirty(); } })),
      selected && el('span', { class: 'q-correct-label' }, 'Correct answer'));
  }
  function editorScreen() {
    questionLabels.clear(); const quiz = model.draft, question = quiz.questions[model.questionIndex];
    const titleId = 'quiz-title', promptId = 'quiz-prompt', explanationId = 'quiz-explanation';
    const rail = el('aside', { class: 'q-question-rail', 'aria-label': 'Quiz questions' },
      el('h2', {}, quiz.questions.length + (quiz.questions.length === 1 ? ' question' : ' questions')),
      el('ol', { class: 'q-question-list' }, quiz.questions.map((item, index) => {
        const label = el('span', { class: 'q-question-label', title: item.prompt }, shortPrompt(item)); questionLabels.set(item.id, label);
        return el('li', {}, button([el('span', { class: 'q-question-number', 'aria-hidden': 'true' }, index + 1), label], () => selectQuestion(index),
          { className: 'q-question-tab' + (index === model.questionIndex ? ' is-selected' : ''), id: 'quiz-question-tab-' + index,
            'aria-label': 'Question ' + (index + 1) + ': ' + shortPrompt(item), 'aria-current': index === model.questionIndex ? 'step' : null }));
      })), button([icon('plus'), 'Add question'], () => { quiz.questions.push(makeQuestion()); model.questionIndex = quiz.questions.length - 1; model.editError = ''; render({ focus: 'quiz-prompt' }); },
        { className: 'q-button lime q-add-question', id: 'quiz-add-question', disabled: quiz.questions.length >= QUIZ_LIMITS.questions }));
    return el('main', { id: 'main', class: 'q-editor', tabindex: '-1' },
      el('div', { class: 'q-page-heading' }, el('h1', { id: 'quiz-page-title', tabindex: '-1' }, 'Make a quiz'),
        el('div', { class: 'q-action-row' }, button('Cancel', goLibrary, { className: 'q-button quiet', id: 'quiz-editor-cancel' }),
          button('Save quiz', saveDraft, { id: 'quiz-save', disabled: !library.canWrite || model.editorConflict }))),
      !library.writeSupported && el('div', { class: 'q-message', role: 'status' }, text('Saving is not available in this browser. You can keep this quiz by exporting its file.')),
      model.editorNotice && el('div', { class: 'q-message', role: 'status' }, text(model.editorNotice)),
      model.busy && el('p', { class: 'q-message', role: 'status' }, model.busyMessage),
      el('div', { class: 'q-edit-error q-message is-error', id: 'quiz-edit-error', role: 'alert', tabindex: '-1', hidden: !model.editError }, model.editError),
      model.editorConflict && button('Reload library and keep a copy', reloadForCopy, { className: 'q-button quiet', id: 'quiz-reload-for-copy' }),
      el('div', { class: 'q-editor-layout' }, el('section', { class: 'q-question-form', 'aria-labelledby': 'quiz-question-heading' },
        el('div', { class: 'q-question-heading-row' }, el('h2', { id: 'quiz-question-heading', tabindex: '-1' }, 'Question ' + (model.questionIndex + 1))),
        field('Question', promptId, el('textarea', { id: promptId, rows: 2, value: question.prompt, maxlength: QUIZ_LIMITS.prompt * 2,
          oninput: event => updateText(event.target.value, value => { question.prompt = value; }, promptId, QUIZ_LIMITS.prompt) }), { count: scalarCount(question.prompt), maximum: QUIZ_LIMITS.prompt }),
        el('fieldset', { class: 'q-answer-fieldset' }, el('legend', { class: 'q-visually-hidden' }, 'Answers and correct answer'),
          el('div', { class: 'q-answer-grid' }, question.answers.map((answer, index) => answerField(question, answer, index)))),
        el('div', { class: 'q-answer-tools' },
          button('Add answer', () => { question.answers.push(''); model.editError = ''; render({ focus: 'quiz-answer-' + (question.answers.length - 1) }); },
            { className: 'q-text-button', id: 'quiz-add-answer', disabled: question.answers.length >= 4 }),
          button('Remove last answer', () => { const removed = question.answers.length - 1; question.answers.pop(); if (question.correctAnswer === removed) question.correctAnswer = -1; model.editError = ''; render({ focus: 'quiz-add-answer' }); },
            { className: 'q-text-button', id: 'quiz-remove-answer', disabled: question.answers.length <= 2 })),
        el('div', { class: 'q-action-row q-question-tools q-question-management', role: 'group', 'aria-label': 'Manage this question' },
          iconButton('up', 'Move question up', () => moveQuestion(-1), { id: 'quiz-move-up', disabled: model.questionIndex === 0 }),
          iconButton('down', 'Move question down', () => moveQuestion(1), { id: 'quiz-move-down', disabled: model.questionIndex === quiz.questions.length - 1 }),
          iconButton('trash', 'Remove question', removeQuestion, { id: 'quiz-remove-question', disabled: quiz.questions.length <= 1 })),
        field('Time limit', 'quiz-time-limit', el('select', { id: 'quiz-time-limit', value: String(question.timeLimitSeconds), onchange: event => { question.timeLimitSeconds = Number(event.target.value); markDirty(); } },
          [0, 10, 20, 30, 60, 120].map(seconds => el('option', { value: seconds, selected: seconds === question.timeLimitSeconds }, seconds === 0 ? 'No timer' : seconds + ' seconds')))),
        field('Explanation', explanationId, el('textarea', { id: explanationId, rows: 2, value: question.explanation, maxlength: QUIZ_LIMITS.explanation * 2,
          oninput: event => updateText(event.target.value, value => { question.explanation = value; }, explanationId, QUIZ_LIMITS.explanation) }), { count: scalarCount(question.explanation), maximum: QUIZ_LIMITS.explanation }),
        field('Quiz title', titleId, el('input', { id: titleId, type: 'text', value: quiz.title, maxlength: QUIZ_LIMITS.title * 2, autocomplete: 'off',
          oninput: event => updateText(event.target.value, value => { quiz.title = value; }, titleId, QUIZ_LIMITS.title) }), { count: scalarCount(quiz.title), maximum: QUIZ_LIMITS.title }),
        button('Practice quiz', () => startPractice(quiz, 'editor'), { className: 'q-button lime', id: 'quiz-practice-draft' }),
        button('Export quiz file', () => exportQuiz(quiz), { className: 'q-text-button q-export-draft', id: 'quiz-export-draft' }),
        text(ANSWER_KEY_NOTE, 'q-sharing-note')), rail));
  }
  function missedPracticeReview(run) {
    const ids = new Set(run.missedQuestionIDs);
    if (!ids.size) return null;
    const results = new Map(run.results.map(result => [result.questionID, result]));
    const attempt = model.practiceMotionId;
    const details = el('details', { id: 'quiz-missed-review', class: 'q-missed-review', open: model.practiceReviewOpen, 'data-practice-attempt': attempt,
      ontoggle: event => { if (event.currentTarget.isConnected && model.run === run && model.practiceMotionId === attempt) model.practiceReviewOpen = event.currentTarget.open; } },
      el('summary', { id: 'quiz-missed-review-summary' }, 'Review ' + ids.size + ' missed ' + (ids.size === 1 ? 'question' : 'questions')),
      el('ol', { class: 'q-missed-list' }, run.quiz.questions.filter(question => ids.has(question.id)).map(question => {
        const result = results.get(question.id);
        return el('li', {}, el('h3', {}, question.prompt),
          el('dl', {}, el('dt', {}, 'Your answer'), el('dd', {}, result.answer === null ? 'No answer locked' : question.answers[result.answer]),
            el('dt', {}, 'Correct answer'), el('dd', {}, question.answers[question.correctAnswer])),
          question.explanation && text(question.explanation, 'q-explanation'));
      })));
    const previous = document.getElementById('quiz-missed-review');
    if (previous?.isConnected && previous.dataset.practiceAttempt === attempt) {
      model.practiceReviewOpen = previous.open; details.open = previous.open;
    }
    return details;
  }
  function practiceRetryGuide() {
    const guide = partyGuide('finished');
    return el('aside', { class: 'q-party-guide q-practice-retry-guide', 'aria-label': 'Practice guide' },
      guideScene(el, 'finished', 'q-party-guide-scene'), el('div', {}, text(guide.characterName + ' · ' + guide.role, 'q-guide-name'),
        text('A little more practice?', 'q-guide-title'), text('Try the questions you missed, with a fresh score.', 'q-muted')));
  }
  function practiceScreen() {
    const run = model.run;
    const missed = run.missedQuestionIDs.length;
    if (run.phase === 'finished') return el('main', { id: 'main', class: 'q-results', tabindex: '-1' },
      text(run.quiz.title, 'q-practice-title'), el('h1', { id: 'quiz-practice-heading', tabindex: '-1' }, model.practiceIsRetry ? 'Retry complete' : 'Quiz complete'), messageBlocks(),
      el('section', { class: 'q-result-summary', 'aria-labelledby': 'quiz-result-label' },
        el('h2', { id: 'quiz-result-label' }, model.practiceIsRetry ? 'This attempt' : 'Your total'),
        el('p', { class: 'q-total-points' }, run.score.toLocaleString('en') + ' points'),
        el('p', { class: 'q-result-score' }, run.correctCount + ' of ' + run.quiz.questions.length + ' correct')),
      el('div', { class: 'q-action-row' },
        missed > 0 && button('Retry ' + missed + ' missed ' + (missed === 1 ? 'question' : 'questions'), retryPracticeMisses, { className: 'q-button lime', id: 'quiz-retry-missed' }),
        button('Replay full quiz', () => startPractice(model.practiceOriginalQuiz ?? run.quiz, model.practiceOrigin), { className: missed ? 'q-button quiet' : 'q-button lime', id: 'quiz-replay' }),
        button(model.practiceOrigin === 'editor' ? 'Back to editor' : 'Library', model.practiceOrigin === 'editor' ? returnToEditor : goLibrary,
          { className: 'q-button quiet', id: 'quiz-result-back' })),
      missed > 0 && missedPracticeReview(run), missed > 0 && practiceRetryGuide(),
      text(model.practiceIsRetry ? 'This retry has a fresh score. Practice scores aren’t saved.' : 'Your quiz stays on this browser. This practice score isn’t saved.', 'q-muted'),
      el('div', { class: 'q-result-art' }, castScene(el,run.correctCount > 0)));
    const question = run.currentQuestion, revealed = run.phase === 'reveal', result = run.results.at(-1);
    const revealTitle = result?.timedOut ? 'Time’s up' : result?.correct ? 'That’s right' : 'Not this time';
    return el('main', { id: 'main', class: 'q-practice', tabindex: '-1' },
      el('div', { class: 'q-practice-top' }, text(run.quiz.title, 'q-practice-title'), companionScene(el,3,'is-compact q-question-companion'),
        button(model.practiceOrigin === 'editor' ? 'Back to editor' : 'Library', model.practiceOrigin === 'editor' ? returnToEditor : goLibrary,
          { className: 'q-button quiet', id: 'quiz-practice-back' })),
      model.practiceIsRetry && el('div', { class: 'q-practice-attempt' }, text('Retry missed questions', 'q-attempt-badge'), text('This attempt has only the questions you missed.', 'q-muted')),
      messageBlocks(),
      el('div', { class: 'q-practice-progress' }, text('Question ' + (run.index + 1) + ' of ' + run.quiz.questions.length),
        question.timeLimitSeconds > 0 && el('p', { id: 'quiz-countdown', class: 'q-countdown', 'aria-label': 'Time remaining' }, revealed ? 'Answer locked' : run.remainingSeconds(now()) + ' seconds left')),
      el('h1', { id: 'quiz-practice-heading', tabindex: '-1' }, question.prompt),
      el('div', { class: 'q-practice-answers', role: 'group', 'aria-label': 'Choose your answer' }, question.answers.map((answer, index) => {
        const chosen = revealed ? run.selectedAnswer === index : model.selection === index;
        const correct = revealed && index === question.correctAnswer;
        return button([el('span', { class: 'q-choice-letter', 'aria-hidden': 'true' }, String.fromCharCode(65 + index)), el('span', { class: 'q-choice-text' }, answer),
          revealed && (correct || chosen) && el('span', { class: 'q-choice-result' }, correct ? 'Correct answer' : 'Your answer')],
          () => { model.selection = index; render({ focus: 'quiz-play-answer-' + index }); }, {
            className: 'q-practice-choice' + (chosen ? ' is-selected' : '') + (correct ? ' is-correct' : '') + (revealed && chosen && !correct ? ' is-incorrect' : ''),
            id: 'quiz-play-answer-' + index, 'aria-pressed': chosen, disabled: revealed,
          });
      })),
      revealed ? el('section', { class: 'q-reveal' + (result?.correct ? ' is-correct' : ''), 'aria-labelledby': 'quiz-reveal-heading', 'aria-live': 'polite' },
        el('h2', { id: 'quiz-reveal-heading', tabindex: '-1' }, revealTitle), text((result?.points || 0).toLocaleString('en') + ' points', 'q-reveal-points'),
        text('Correct answer: ' + question.answers[question.correctAnswer]), question.explanation && text(question.explanation, 'q-explanation'),
        button(run.index === run.quiz.questions.length - 1 ? 'See results' : 'Next question', () => { run.next(now()); model.selection = null; render({ focus: 'quiz-practice-heading' }); },
          { className: 'q-button', id: 'quiz-next' })) :
        button('Lock answer', () => { run.submit(model.selection, now()); render({ focus: run.phase === 'reveal' ? 'quiz-reveal-heading' : 'quiz-practice-heading' }); },
          { className: 'q-button', id: 'quiz-lock-answer', disabled: model.selection === null }),
      text('1,000 points for each correct answer. No speed bonus.', 'q-muted q-scoring'));
  }
  function confirmation() {
    const value = model.confirm;
    if (!value) return null;
    return el('dialog', { class: 'q-dialog', 'aria-labelledby': 'quiz-confirm-title', 'aria-describedby': 'quiz-confirm-message',
      oncancel: event => { event.preventDefault(); dismiss(); } },
    el('h2', { id: 'quiz-confirm-title' }, value.title), el('p', { id: 'quiz-confirm-message' }, value.message),
    el('div', { class: 'q-action-row' }, button(value.cancelLabel, dismiss, { className: 'q-button quiet', id: 'quiz-confirm-cancel' }),
      button(value.label, () => { model.confirm = null; value.action(); }, { className: 'q-button' + (value.destructive ? ' danger' : ''), id: 'quiz-confirm-action' })));
  }
  function render({ focus } = {}) {
    if (disposed) return;
    const h = header(), main = model.screen === 'editor' ? editorScreen() : model.screen === 'practice' ? practiceScreen() : libraryScreen(), dialog = confirmation();
    root.replaceChildren(h, main, ...(dialog ? [dialog] : []));
    if (model.busy) for (const node of main.querySelectorAll('input,textarea,select')) node.disabled = true;
    if (dialog) {
      if (typeof dialog.showModal === 'function') { try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); } }
      else { dialog.setAttribute('open', ''); h.setAttribute('inert', ''); main.setAttribute('inert', ''); }
    }
    const target = focus && root.querySelector('#' + focus);
    if (target) target.focus({ preventScroll: false });
    motion.bind(root,model.screen==='practice'?((model.run.currentQuestion?.id??'results')+':'+model.run.phase):model.screen==='library'?'library':null,
      model.screen==='practice'?'practice:'+model.practiceMotionId:'creator');
  }
  function tick() {
    if (disposed || model.screen !== 'practice' || model.run?.phase !== 'answer' || model.confirm) return;
    if (model.run.advance(now())) { render({ focus: 'quiz-reveal-heading' }); return; }
    const countdown = root.querySelector('#quiz-countdown');
    if (countdown) { const value = model.run.remainingSeconds(now()) + ' seconds left'; if (countdown.textContent !== value) countdown.textContent = value; }
  }
  const timer = win.setInterval(tick, 250);
  const beforeUnload = event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
  const onVisibility = () => { if (document.visibilityState !== 'hidden') tick(); };
  win.addEventListener('beforeunload', beforeUnload); win.addEventListener('focus', tick); document.addEventListener('visibilitychange', onVisibility);
  render();
  return {
    dispose() { disposed = true; importOperation = null; motion.dispose(); win.clearInterval(timer); win.removeEventListener('beforeunload', beforeUnload); win.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', onVisibility); for (const url of urls) win.URL.revokeObjectURL(url); urls.clear(); },
    tick, importFile,
    get screen() { return model.screen; },
  };
}
