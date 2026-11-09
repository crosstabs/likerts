import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { readEntryIntent } from '../web/entry-intent.mjs';
import { sampleQuizDocument, starterQuizDocuments } from '../web/quiz-document.mjs';
import { QuizDraftStore, QUIZ_DRAFT_KEY } from '../web/quiz-draft.mjs';
import { QuizLibrary, QUIZ_LIBRARY_KEY } from '../web/quiz-library.mjs';
import { mountQuizApp } from '../web/quiz-ui.mjs';
import { mountLiveApp } from '../web/ui.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const protocol = JSON.parse(await readFile(new URL('../server/fixtures/protocol-v1.json', import.meta.url), 'utf8'));
const flush = () => new Promise(resolve => setImmediate(resolve));
const quizURL = intent => 'https://entry-test.invalid/play/quizzes?intent=' + intent;
const liveURL = intent => 'https://entry-test.invalid/play?intent=' + intent;

function controls(dom, root) {
  const get = id => root.querySelector('#' + id);
  return {
    get,
    async click(id) { const node = get(id); assert.ok(node, 'Expected control ' + id); node.click(); await flush(); },
    input(id, value) {
      const node = get(id); assert.ok(node, 'Expected field ' + id); node.value = value;
      node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    },
  };
}

async function quizFixture(t, { url = quizURL('create'), data = createStorage(), unavailable = false, noLocks = false, access = null, seed = null, draftStore = null } = {}) {
  const dom = new JSDOM('<div id="app"></div>', { url });
  dom.window.scrollTo = () => {};
  const root = dom.window.document.getElementById('app');
  const library = new QuizLibrary({ storage: unavailable ? null : data, locks: noLocks ? null : data.locks });
  if (seed) await library.save(seed);
  const before = { writes: data.writes, raw: data.values.get(QUIZ_LIBRARY_KEY), quizzes: library.quizzes };
  const calls = { hosted: [], recovered: 0 };
  const app = mountQuizApp({ root, library, draftStore, window: dom.window, entryIntent: readEntryIntent(url),
    hostQuiz: async quiz => { calls.hosted.push(structuredClone(quiz)); },
    liveAccess: () => access,
    recoverLive: async () => { calls.recovered++; },
  });
  t.after(() => { app.dispose(); dom.window.close(); });
  await flush();
  return { dom, root, library, data, app, before, calls, ...controls(dom, root) };
}

function assertQuizUntouched(f) {
  assert.equal(f.data.writes, f.before.writes);
  assert.equal(f.data.values.get(QUIZ_LIBRARY_KEY), f.before.raw);
  assert.deepEqual(f.library.quizzes, f.before.quizzes);
  assert.deepEqual(f.calls.hosted, []);
  assert.equal(f.calls.recovered, 0);
}

function fakeClient({ state = null, resumeHint = null, pendingAdmissionHint = null, catalogue } = {}) {
  const calls = { joins: [], creates: [], actions: [], resumed: 0, recovered: 0, forgotten: 0, catalogues: 0 };
  return {
    state: structuredClone(state), resumeHint: structuredClone(resumeHint), pendingAdmissionHint: structuredClone(pendingAdmissionHint),
    status: state ? 'connected' : 'idle', persisted: true, pendingAction: null, busy: false, calls,
    onState() {}, onStatus() {}, onError() {},
    catalogue() { calls.catalogues++; return catalogue ? catalogue() : Promise.resolve({ topics: [{ id: 'snacks', title: 'Snack logic' }] }); },
    join(code, name, consent) { calls.joins.push({ code, name, consent }); return Promise.resolve(); },
    create(settings) { calls.creates.push(structuredClone(settings)); return Promise.resolve(); },
    action(action, values) { calls.actions.push({ action, values }); return Promise.resolve(this.state); },
    resume() { calls.resumed++; return Promise.resolve(); },
    recoverAdmission() { calls.recovered++; return Promise.resolve(); },
    forgetSavedAccess() {
      calls.forgotten++; this.state = null; this.resumeHint = null; this.pendingAdmissionHint = null;
      this.status = 'idle'; this.onState(null);
    },
    dispose() {},
  };
}

async function liveFixture(t, { url = liveURL('join'), ...options } = {}) {
  const dom = new JSDOM('<div id="app"></div>', { url });
  dom.window.scrollTo = () => {};
  const root = dom.window.document.getElementById('app'), client = fakeClient(options);
  const app = mountLiveApp({ root, client, window: dom.window, entryIntent: readEntryIntent(url) });
  t.after(() => { app.dispose(); dom.window.close(); });
  await flush();
  return { dom, root, client, app, ...controls(dom, root) };
}

function assertNoAdmission(f) {
  assert.deepEqual(f.client.calls.joins, []);
  assert.deepEqual(f.client.calls.creates, []);
  assert.deepEqual(f.client.calls.actions, []);
  assert.equal(f.client.calls.resumed, 0);
  assert.equal(f.client.calls.recovered, 0);
  assert.equal(f.client.calls.forgotten, 0);
}

test('entry parser accepts only one exact known intent and handles malformed input without throwing', () => {
  for (const intent of ['create', 'host', 'join']) assert.equal(readEntryIntent(quizURL(intent) + '&source=home'), intent);
  for (const href of [
    'not a URL', '/play?intent=join', null, 'https://entry-test.invalid/play',
    liveURL(''), liveURL('unknown'), liveURL('JOIN'), liveURL('%20join'), liveURL('join%20'),
    liveURL('%3Cscript%3E'), liveURL('join') + '&intent=join', liveURL('create') + '&intent=host',
    liveURL('create') + '&in%74ent=host',
  ]) assert.equal(readEntryIntent(href), null, String(href));
});

test('any room query takes precedence over generic intent, including empty and encoded room keys', () => {
  for (const intent of ['create', 'host', 'join']) {
    for (const room of ['room=ABCDEF', 'room=', 'room', '%72oom=ABCDEF', 'room=bad&room=ABCDEF']) {
      assert.equal(readEntryIntent(liveURL(intent) + '&' + room), null);
    }
  }
});

test('create intent opens a fresh unsaved editor without changing an existing library or hosting', async t => {
  const saved = sampleQuizDocument();
  const f = await quizFixture(t, { seed: saved, url: quizURL('create') + '&title=Injected&consent=true' });
  assert.equal(f.app.screen, 'editor');
  assert.equal(f.get('quiz-title').value, '');
  assert.equal(f.get('quiz-prompt').value, '');
  assert.equal(f.dom.window.document.activeElement.id, 'quiz-prompt');
  assert.equal(f.get('quiz-confirm-title'), null);
  assertQuizUntouched(f);
});

test('cancelling a pristine create intent returns to the library without reopening on later renders', async t => {
  const f = await quizFixture(t);
  await f.click('quiz-editor-cancel');
  assert.equal(f.app.screen, 'library');
  assert.equal(f.get('quiz-confirm-title'), null);
  await f.click('quiz-nav-library');
  f.dom.window.dispatchEvent(new f.dom.window.Event('focus'));
  assert.equal(f.app.screen, 'library');
  assert.equal(f.get('quiz-title'), null);
  assert.equal(new URL(f.dom.window.location.href).searchParams.get('intent'), 'create');
  assertQuizUntouched(f);
});

test('a dirty intent-created draft retains normal keep-editing and explicit-discard behavior', async t => {
  const f = await quizFixture(t);
  f.input('quiz-title', 'Keep this draft'); f.input('quiz-prompt', 'My unfinished question');
  await f.click('quiz-editor-cancel');
  assert.match(f.get('quiz-confirm-title').textContent, /Discard/);
  assertQuizUntouched(f);
  await f.click('quiz-confirm-cancel');
  assert.equal(f.app.screen, 'editor');
  assert.equal(f.get('quiz-title').value, 'Keep this draft');
  assert.equal(f.get('quiz-prompt').value, 'My unfinished question');
  await f.click('quiz-editor-cancel'); await f.click('quiz-confirm-action');
  assert.equal(f.app.screen, 'library');
  assertQuizUntouched(f);
});

test('host intent focuses the quiz chooser and uploads only after an explicit quiz choice and confirmation', async t => {
  const f = await quizFixture(t, { url: quizURL('host') });
  assert.equal(f.app.screen, 'library');
  assert.equal(f.dom.window.document.activeElement.id, 'quiz-starters-heading');
  assert.equal(f.get('quiz-confirm-title'), null);
  assertQuizUntouched(f);
  await f.click('quiz-host-sample');
  assert.match(f.get('quiz-confirm-message').textContent, /answer key/);
  assertQuizUntouched(f);
  await f.click('quiz-confirm-cancel');
  assertQuizUntouched(f);
  await f.click('quiz-host-sample'); await f.click('quiz-confirm-action');
  assert.equal(f.calls.hosted.length, 1);
  assert.equal(f.calls.hosted[0].id, sampleQuizDocument().id);
  assert.equal(f.data.writes, f.before.writes);
});

test('saved and pending live access take precedence over automatic create and host entry', async t => {
  for (const intent of ['create', 'host']) {
    for (const pending of [false, true]) {
      await t.test(intent + (pending ? ' pending' : ' saved'), async t => {
        const access = { pending }, f = await quizFixture(t, { url: quizURL(intent), access });
        assert.equal(f.app.screen, 'library');
        assert.equal(f.dom.window.document.activeElement.id, 'quiz-recover-live');
        assert.equal(f.get('quiz-title'), null);
        assert.equal(f.get('quiz-confirm-title'), null);
        assertQuizUntouched(f);
        assert.deepEqual(access, { pending });
      });
    }
  }
});

test('blocked or unavailable storage retains its warning instead of opening the editor or resetting data', async t => {
  for (const unavailable of [false, true]) {
    await t.test(unavailable ? 'unavailable' : 'corrupt', async t => {
      const data = createStorage();
      if (!unavailable) data.values.set(QUIZ_LIBRARY_KEY, '{invalid saved bytes');
      const f = await quizFixture(t, { data, unavailable });
      assert.equal(f.app.screen, 'library');
      assert.equal(f.get('quiz-create').disabled, true);
      assert.equal(f.dom.window.document.activeElement.id, 'quiz-storage-heading');
      assert.equal(f.get('quiz-title'), null);
      assertQuizUntouched(f);
    });
  }
});

test('missing Web Locks still permits intent-created editing with saving explicitly unavailable', async t => {
  const f = await quizFixture(t, { noLocks: true });
  assert.equal(f.app.screen, 'editor');
  assert.equal(f.get('quiz-save').disabled, true);
  assert.match(f.root.textContent, /Saving is not available/);
  assert.ok(f.get('quiz-export-draft'));
  assert.ok(f.get('quiz-practice-draft'));
  f.input('quiz-title', 'A draft I can keep editing');
  assert.equal(f.get('quiz-title').value, 'A draft I can keep editing');
  assertQuizUntouched(f);
});

test('join intent opens blank labelled fields and requires manual nickname and consent before admission', async t => {
  const f = await liveFixture(t, { url: liveURL('join') + '&nickname=Injected&consent=true&code=ABCDEF' });
  assert.equal(f.get('room-code').value, '');
  assert.equal(f.get('nickname').value, '');
  assert.equal(f.get('room-sharing').checked, false);
  assert.equal(f.get('room-code').labels[0].textContent, 'Room code');
  assert.equal(f.get('nickname').labels[0].textContent, 'Your name');
  assertNoAdmission(f);
  const form = f.root.querySelector('form');
  assert.equal(form.checkValidity(), false);
  f.input('room-code', 'ABCDEF'); f.input('nickname', 'Mira');
  form.requestSubmit(); await flush();
  assertNoAdmission(f);
  f.get('room-sharing').checked = true;
  f.get('room-sharing').dispatchEvent(new f.dom.window.Event('change', { bubbles: true }));
  form.requestSubmit(); await flush();
  assert.deepEqual(f.client.calls.joins, [{ code: 'ABCDEF', name: 'Mira', consent: true }]);
  assert.deepEqual(f.client.calls.creates, []);
});

test('a valid invitation overrides every generic intent and fills only its normalized public code', async t => {
  for (const intent of ['create', 'host', 'join']) {
    await t.test(intent, async t => {
      const f = await liveFixture(t, { url: liveURL(intent) + '&room=ab-cd-ef' });
      assert.equal(f.get('room-code').value, 'ABCDEF');
      assert.equal(f.get('nickname').value, '');
      assert.equal(f.get('room-sharing').checked, false);
      assertNoAdmission(f);
    });
  }
});

test('invalid and offline invitations retain their existing help without an automatic join', async t => {
  for (const [code, message] of [['bad', /six-character live room code/], ['LK3:offline-example', /offline challenge/]]) {
    await t.test(code, async t => {
      const f = await liveFixture(t, { url: liveURL('join') + '&room=' + encodeURIComponent(code) });
      assert.ok(f.get('room-code'));
      assert.equal(f.get('nickname').value, '');
      assert.equal(f.get('room-sharing').checked, false);
      assert.match(f.root.textContent, message);
      assertNoAdmission(f);
    });
  }
});

test('saved access wins over join intent and an invitation until explicit forgetting restores the invitation', async t => {
  const saved = { code: 'ABCDEF', expiresAt: Date.now() + 60_000 };
  const f = await liveFixture(t, { url: liveURL('join') + '&room=BCDEFG', resumeHint: saved });
  assert.ok(f.get('resume-room'));
  assert.ok(f.get('forget-room'));
  assert.equal(f.root.querySelector('form'), null);
  assert.equal(f.get('room-code'), null);
  assert.deepEqual(f.client.resumeHint, saved);
  assertNoAdmission(f);
  await f.click('forget-room');
  assertNoAdmission(f);
  await f.click('confirm-accept');
  assert.equal(f.client.calls.forgotten, 1);
  assert.equal(f.get('room-code').value, 'BCDEFG');
  assert.equal(f.get('nickname').value, '');
  assert.equal(f.get('room-sharing').checked, false);
  assert.deepEqual(f.client.calls.joins, []);
  assert.deepEqual(f.client.calls.creates, []);
  assert.deepEqual(f.client.calls.actions, []);
  assert.equal(f.client.calls.resumed, 0);
  assert.equal(f.client.calls.recovered, 0);
});

test('pending admission keeps recovery first and prevents an intent from starting another admission', async t => {
  const pending = { kind: 'join', code: 'ABCDEF', expiresAt: Date.now() + 60_000 };
  const f = await liveFixture(t, { pendingAdmissionHint: pending });
  assert.ok(f.get('recover-admission'));
  assert.equal(f.get('room-code'), null);
  assert.deepEqual(f.client.pendingAdmissionHint, pending);
  assertNoAdmission(f);
  await f.click('choose-join');
  assert.equal(f.get('join-room').disabled, true);
  assert.equal(f.get('room-code').disabled, true);
  assert.equal(f.get('nickname').disabled, true);
  assert.equal(f.get('room-sharing').disabled, true);
  assertNoAdmission(f);
  await f.click('recover-admission');
  assert.equal(f.client.calls.recovered, 1);
  assert.deepEqual(f.client.calls.joins, []);
  assert.deepEqual(f.client.calls.creates, []);
});

test('an admitted room stays visible and unchanged when entry intent and another invitation are present', async t => {
  const admitted = structuredClone(protocol.states.lobbyPlayer);
  const f = await liveFixture(t, { state: admitted, url: liveURL('join') + '&room=BCDEFG' });
  assert.deepEqual(f.client.state, admitted);
  assert.ok(f.get('room-exit'));
  assert.equal(f.get('room-code'), null);
  assert.equal(f.get('choose-join'), null);
  assert.equal(f.get('resume-room'), null);
  assertNoAdmission(f);
});

test('unknown and duplicate entry values preserve default quiz and live entry screens', async t => {
  for (const intent of ['unknown', 'create&intent=create']) {
    const quiz = await quizFixture(t, { url: quizURL(intent) });
    assert.equal(quiz.app.screen, 'library');
    assert.equal(quiz.get('quiz-title'), null);
    assertQuizUntouched(quiz);
    const live = await liveFixture(t, { url: liveURL(intent) });
    assert.ok(live.get('choose-join'));
    assert.ok(live.get('choose-host'));
    assert.equal(live.get('room-code'), null);
    assertNoAdmission(live);
  }
});

test('leaving an intent-selected join form stays on the landing screen after late catalogue loading', async t => {
  let resolveCatalogue;
  const catalogue = new Promise(resolve => { resolveCatalogue = resolve; });
  const f = await liveFixture(t, { catalogue: () => catalogue });
  assert.ok(f.get('room-code'));
  await f.click('entry-back');
  assert.equal(f.get('room-code'), null);
  resolveCatalogue({ topics: [{ id: 'snacks', title: 'Snack logic' }] }); await flush();
  assert.ok(f.get('choose-join'));
  assert.equal(f.get('room-code'), null);
  assert.equal(new URL(f.dom.window.location.href).searchParams.get('intent'), 'join');
  assertNoAdmission(f);
});


test('known starter cover hints open the matching explicit preview without admission or saved-library writes', async t => {
  for (const quiz of starterQuizDocuments()) await t.test(quiz.title, async t => {
    const f = await quizFixture(t, { url: quizURL('host') + '&starter=' + quiz.id });
    assert.equal(f.app.screen, 'library');
    assert.ok(f.get('quiz-confirm-title')); assert.match(f.get('quiz-confirm-title').textContent, new RegExp(quiz.title));
    assert.match(f.get('quiz-confirm-message').textContent, /answer key.*uploaded.*server/i);
    assert.equal(f.dom.window.document.activeElement.id, 'quiz-confirm-cancel');
    assertQuizUntouched(f);
    await f.click('quiz-confirm-action');
    assert.equal(f.calls.hosted.length, 1); assert.deepEqual(f.calls.hosted[0], quiz);
    assert.equal(f.data.writes, f.before.writes); assert.equal(f.calls.recovered, 0);
  });
});

test('cancelling a starter cover preview stays in the library without reopening or hosting', async t => {
  const quiz = starterQuizDocuments()[1];
  const f = await quizFixture(t, { url: quizURL('host') + '&starter=' + quiz.id });
  assert.ok(f.get('quiz-confirm-title')); await f.click('quiz-confirm-cancel');
  assert.equal(f.get('quiz-confirm-title'), null); assert.equal(f.app.screen, 'library');
  assert.equal(f.dom.window.document.activeElement.id, 'quiz-starters-heading');
  f.library.reload(); await flush();
  assert.equal(f.get('quiz-confirm-title'), null); assertQuizUntouched(f);
});

test('unknown duplicate and invitation-bearing starter cover hints never trigger an upload preview', async t => {
  const id = starterQuizDocuments()[0].id;
  for (const suffix of [
    '&starter=unknown', '&starter=', '&starter=' + id + '&starter=' + id,
    '&starter=' + id + '&%73tarter=' + id, '&starter=' + id + '&intent=host',
    '&starter=' + id + '&room=ABCDEF', '&starter=' + id + '&room=', '&starter=%3Cscript%3E',
  ]) await t.test(suffix, async t => {
    const f = await quizFixture(t, { url: quizURL('host') + suffix });
    assert.equal(f.get('quiz-confirm-title'), null); assert.equal(f.app.screen, 'library'); assertQuizUntouched(f);
  });
});

test('saved pending and unfinished recovery override a known starter cover preview', async t => {
  const url = quizURL('host') + '&starter=' + starterQuizDocuments()[0].id;
  for (const pending of [true, false]) await t.test('live pending=' + pending, async t => {
    const f = await quizFixture(t, { url, access: { pending } });
    assert.equal(f.get('quiz-confirm-title'), null); assert.equal(f.dom.window.document.activeElement.id, 'quiz-recover-live'); assertQuizUntouched(f);
  });
  await t.test('unfinished editor', async t => {
    const data = createStorage(), draftStore = new QuizDraftStore({ storage: data, locks: data.locks });
    await draftStore.save({ draftID: crypto.randomUUID(), quiz: sampleQuizDocument(), sourceQuiz: null, questionIndex: 1 });
    const raw = data.getItem(QUIZ_DRAFT_KEY);
    const f = await quizFixture(t, { url, data, draftStore });
    assert.equal(f.get('quiz-confirm-title'), null); assert.equal(f.dom.window.document.activeElement.id, 'quiz-draft-heading');
    assert.equal(data.getItem(QUIZ_DRAFT_KEY), raw); assertQuizUntouched(f);
  });
  await t.test('blocked saved library', async t => {
    const data = createStorage(); data.values.set(QUIZ_LIBRARY_KEY, '{broken');
    const f = await quizFixture(t, { url, data });
    assert.equal(f.get('quiz-confirm-title'), null); assert.ok(f.get('quiz-storage-heading')); assertQuizUntouched(f);
  });
});

test('the library code entry preserves typed code focus and caret through an unrelated draft storage update', async t => {
  const data = createStorage(), draftStore = new QuizDraftStore({ storage: data, locks: data.locks });
  const f = await quizFixture(t, { url: quizURL('host'), data, draftStore });
  f.input('quiz-room-code', 'ab-cd-ef');
  const field = f.get('quiz-room-code'); field.focus(); field.setSelectionRange(3, 5);
  f.dom.window.dispatchEvent(new f.dom.window.StorageEvent('storage', { key: QUIZ_DRAFT_KEY })); await flush();
  assert.equal(f.get('quiz-room-code').value, 'ab-cd-ef');
  assert.equal(f.dom.window.document.activeElement.id, 'quiz-room-code');
  assert.equal(f.get('quiz-room-code').selectionStart, 3); assert.equal(f.get('quiz-room-code').selectionEnd, 5);
  assertQuizUntouched(f);
});
