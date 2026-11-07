import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createQuizRoom, joinRoom, reduceRoom, project } from '../server/engine.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { QuizLibrary } from '../web/quiz-library.mjs';
import { mountQuizApp } from '../web/quiz-ui.mjs';
import { mountLiveApp } from '../web/ui.mjs';
import { QUIZ_MOTION_KEY, QUIZ_MOTION_DURATION } from '../web/quiz-motion.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const clone = value => structuredClone(value);
const protocol = JSON.parse(await readFile(new URL('../server/fixtures/protocol-v1.json', import.meta.url), 'utf8'));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

function browserDOM(t, { journal = null, reduced = false } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="app"></div></body></html>', {
    url: 'https://quiz-scene-test.invalid/play', pretendToBeVisual: true,
  });
  const { window } = dom, animations = [], decodedImages = [];
  window.scrollTo = () => {};
  const media = new window.EventTarget(); media.matches = reduced; media.media = '(prefers-reduced-motion: reduce)';
  window.matchMedia = query => { assert.equal(query, media.media); return media; };
  Object.defineProperties(window.HTMLImageElement.prototype, {
    complete: { configurable: true, get: () => true },
    naturalWidth: { configurable: true, get: () => 1983 },
  });
  window.HTMLImageElement.prototype.decode = function () { decodedImages.push(this.getAttribute('src')); return Promise.resolve(); };
  window.HTMLElement.prototype.animate = function (keyframes, options) {
    const animation = {
      node: this, keyframes, options, currentTime: 0, playState: 'running', cancelled: false,
      finished: new Promise(() => {}),
      pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; }, cancel() { this.cancelled = true; this.playState = 'idle'; },
    };
    animations.push(animation); return animation;
  };
  if (journal !== null) window.sessionStorage.setItem(QUIZ_MOTION_KEY, journal);
  t.after(() => window.close());
  return { dom, window, root: window.document.getElementById('app'), animations, media, decodedImages };
}

function game(quiz = sampleQuizDocument()) {
  const now = Date.now(); let room = createQuizRoom(quiz, { capacity: 12 }, { now }).room; const players = [];
  for (const nickname of ['Sam', 'NativeQA']) {
    const joined = joinRoom(room, { nickname, acceptRoomSharing: true }, { now }); room = joined.room; players.push(joined.memberId);
  }
  return {
    players, get room() { return room; },
    state(actor = players[0]) { return project(room, actor, { now: Date.now() }); },
    act(actor, action, values = {}) {
      room = reduceRoom(room, actor, { requestId: randomUUID(), matchId: room.matchId, ...(room.round ? { roundId: room.round.id } : {}), action, ...values }, { now: Date.now() }).room;
    },
  };
}

async function liveFixture(t, state, { journal, action } = {}) {
  const f = browserDOM(t, { journal });
  const client = {
    state: clone(state), status: 'connected', persisted: true, pendingAction: null, busy: false, resumeHint: null, pendingAdmissionHint: null,
    onState() {}, onStatus() {}, onError() {}, calls: [], catalogue: async () => ({ topics: [] }), dispose() {},
    action(name, values) { this.calls.push({ name, values }); return action ? action.call(this, name, values) : Promise.resolve(this.state); },
    emit(next) { this.state = clone(next); this.onState(this.state); },
    connection(status) { this.status = status; this.onStatus(status); },
  };
  const app = mountLiveApp({ root: f.root, client, window: f.window }); t.after(() => app.dispose()); await flush();
  return { ...f, client, app, get: id => f.root.querySelector('#' + id) };
}

async function libraryFixture(t) {
  const f = browserDOM(t), storage = createStorage(), library = new QuizLibrary({ storage, locks: storage.locks });
  const app = mountQuizApp({ root: f.root, library, window: f.window, hostQuiz: async () => {} });
  t.after(() => app.dispose()); await flush(); return { ...f, library, app };
}

test('new scene PNGs and provenance agree byte-for-byte with the preserved original native artwork', async () => {
  const manifest = JSON.parse(await readFile(new URL('../web/assets/quiz-scene-provenance.json', import.meta.url), 'utf8'));
  const expected = {
    'totem-platform.png': 'NativeSource/Likerts/TotemAssets.xcassets/TotemPlatform.imageset/TotemPlatform.png',
    'totem-background.png': 'NativeSource/Likerts/TotemAssets.xcassets/TotemBackground.imageset/TotemBackground.png',
    'story-book-library.png': 'NativeSource/Likerts/StoryAssets.xcassets/StoryBookFlagV42.imageset/StoryBookFlagV42-r2.png',
  };
  for (const [filename, source] of Object.entries(expected)) {
    const record = manifest[filename]; assert.ok(record, filename + ' must have a provenance record'); assert.equal(record.source, source);
    const actual = await readFile(new URL('../web/assets/' + filename, import.meta.url));
    const original = await readFile(new URL('../../../' + source, import.meta.url));
    assert.deepEqual(actual, original, filename + ' must preserve original pixels');
    assert.equal(createHash('sha256').update(actual).digest('hex'), record.sha256);
    assert.deepEqual([...actual.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(actual.readUInt32BE(16), record.width); assert.equal(actual.readUInt32BE(20), record.height);
    if (record.bytes !== undefined) assert.equal(actual.byteLength, record.bytes);
  }
});

test('the integrated library scene follows creation and sample controls and stays lazy, static and decorative', async t => {
  const f = await libraryFixture(t), scene = f.root.querySelector('.quiz-library-scene'); assert.ok(scene);
  const image = scene.querySelector('img'); assert.equal(image.getAttribute('src'), '/play/assets/story-book-library.png');
  assert.equal(image.getAttribute('loading'), 'lazy'); assert.equal(image.getAttribute('decoding'), 'async');
  assert.equal(scene.getAttribute('aria-hidden'), 'true'); assert.equal(image.alt, '');
  assert.equal(scene.hasAttribute('data-quiz-entrance'), false); assert.equal(scene.querySelector('button,input,a'), null);
  for (const id of ['quiz-create', 'quiz-practice-sample', 'quiz-host-sample', 'quiz-copy-sample']) {
    const control = f.root.querySelector('#' + id); assert.ok(control, id);
    assert.ok(control.compareDocumentPosition(scene) & f.window.Node.DOCUMENT_POSITION_FOLLOWING, id + ' precedes the reading scene');
  }
  assert.ok(f.animations.every(animation => !scene.contains(animation.node)), 'The book composition remains static');
  assert.equal(f.decodedImages.includes('/play/assets/story-book-library.png'),false,'Motion must preserve the lazy book instead of decoding it eagerly');
});

test('the integrated book scene is absent from practice and editor questions', async t => {
  const practice = await libraryFixture(t); practice.root.querySelector('#quiz-practice-sample').click(); await flush();
  assert.equal(practice.app.screen, 'practice'); assert.equal(practice.root.querySelector('.quiz-library-scene,img[src="/play/assets/story-book-library.png"]'), null);
  const editor = await libraryFixture(t); editor.root.querySelector('#quiz-copy-sample').click(); await flush();
  assert.equal(editor.app.screen, 'editor'); assert.equal(editor.root.querySelector('.quiz-library-scene,img[src="/play/assets/story-book-library.png"]'), null);
});

test('authored live questions use only a neutral participant stage, never the library subject illustration', async t => {
  const quiz = sampleQuizDocument(); quiz.questions[0].prompt = 'Which book would you choose?';
  const g = game(quiz); g.act('host', 'start'); const f = await liveFixture(t, g.state());
  assert.equal(f.root.querySelector('h1').textContent, 'Which book would you choose?');
  assert.equal(f.root.querySelector('.quiz-library-scene,img[src="/play/assets/story-book-library.png"]'), null);
  const stage = f.root.querySelector('.quiz-scene.is-neutral'); assert.ok(stage); assert.equal(stage.getAttribute('aria-hidden'), 'true');
  assert.equal(stage.querySelector('button,input,select,textarea,h1,h2'), null);
  const sources = [...stage.querySelectorAll('img')].map(image => image.getAttribute('src'));
  assert.ok(sources.includes('/play/assets/totem-background.png')); assert.ok(sources.includes('/play/assets/totem-platform.png'));
  assert.ok(sources.some(source => /\/totem-[1-5]\.png$/.test(source)));
  for (const image of stage.querySelectorAll('img')) assert.equal(image.alt, '');
});

test('selection, connection and submission rerenders continue the same question entrance, while reveal starts its own stage', async t => {
  const clock = { now: 1_000_000 }; t.mock.method(Date, 'now', () => clock.now);
  const g = game(), receipt = deferred();
  const f = await liveFixture(t, g.state(), { action: async function (name, values) {
    this.pendingAction = { action: name, value: values.value }; this.busy = true;
    await receipt.promise; this.pendingAction = null; this.busy = false; return this.state;
  } });
  assert.equal(f.animations.length, 0, 'A cold initial lobby remains static while original art decodes');
  clock.now += 20; g.act('host', 'start'); f.client.emit(g.state());
  assert.equal(f.animations.length,0,'Q1 first observes the participant image cold; the nonanimated lobby roster did not predecode it');
  await flush();assert.equal(f.animations.length,0,'Its decode completion does not start Q1 late');
  clock.now += 20;g.act(g.players[0],'quiz-answer',{value:0});g.act(g.players[1],'quiz-answer',{value:1});f.client.emit(g.state());
  clock.now += 20;g.act('host','next');f.client.emit(g.state());
  assert.ok(f.animations.length > 0); assert.ok(f.animations.every(animation => animation.options.duration === QUIZ_MOTION_DURATION));
  clock.now += 80; f.get('quiz-choice-0').click(); assert.equal(f.animations.at(-1).currentTime, 80);
  assert.equal(f.client.calls.length, 0, 'Choosing an answer does not submit it');
  clock.now += 40; f.client.connection('reconnecting'); assert.equal(f.animations.at(-1).currentTime, 120);
  assert.equal(f.get('quiz-choice-0').getAttribute('aria-pressed'), 'true');
  clock.now += 30; f.get('lock-choice').click(); assert.equal(f.animations.at(-1).currentTime, 150);
  assert.deepEqual(f.client.calls, [{ name: 'quiz-answer', values: { value: 0 } }]);
  clock.now += 30; g.act(g.players[0], 'quiz-answer', { value: 0 }); f.client.emit(g.state());
  assert.equal(f.animations.at(-1).currentTime, 180); assert.match(f.root.textContent, /Answer locked: Two/);
  clock.now += 20; receipt.resolve(); await flush(); assert.equal(f.animations.at(-1).currentTime, 200);
  clock.now += 40; g.act(g.players[1], 'quiz-answer', { value: 1 }); f.client.emit(g.state());
  assert.equal(f.client.state.phase, 'reveal'); assert.equal(f.animations.at(-1).currentTime, 0, 'A newly confirmed phase receives a distinct entrance');
  assert.ok(f.root.querySelector('.quiz-neutral-reveal .quiz-scene.is-neutral'));
  for (const animation of f.animations) {
    assert.ok(animation.node.hasAttribute('data-quiz-entrance'));
    assert.equal(animation.node.closest('button'), null); assert.equal(animation.node.querySelector('button,input,select,textarea,h1,h2'), null);
  }
});

test('copied session journal settles the current live phase after a new-window reload', async t => {
  const clock = { now: 2_000_000 }; t.mock.method(Date, 'now', () => clock.now);
  const g = game(), first = await liveFixture(t, g.state());
  clock.now += 20; g.act('host', 'start'); first.client.emit(g.state());
  await flush();
  g.act(g.players[0], 'quiz-answer', { value: 0 }); g.act(g.players[1], 'quiz-answer', { value: 1 }); first.client.emit(g.state());
  assert.ok(first.animations.length > 0);
  const journal = first.window.sessionStorage.getItem(QUIZ_MOTION_KEY); assert.ok(journal);
  clock.now += 100; const reload = await liveFixture(t, g.state(), { journal });
  assert.equal(reload.animations.length, 0, 'A saved stage stays static even when its earlier entrance had not elapsed');
  reload.client.connection('reconnecting'); assert.equal(reload.animations.length, 0);
  clock.now += 40; g.act('host', 'next'); reload.client.emit(g.state());
  assert.ok(reload.animations.length > 0); assert.equal(reload.animations.at(-1).currentTime, 0, 'The next authored question can still enter once');
});

test('legacy protocol-v1 fixtures never gain quiz scenes or motion targets', async t => {
  for (const state of Object.values(protocol.states)) {
    const f = await liveFixture(t, state);
    assert.equal(f.root.querySelector('.quiz-scene,.quiz-library-scene,[data-quiz-entrance]'), null, state.phase);
    assert.equal(f.root.querySelector('img[src="/play/assets/totem-background.png"],img[src="/play/assets/totem-platform.png"],img[src="/play/assets/story-book-library.png"]'), null);
    assert.equal(f.animations.length, 0); assert.equal(f.window.sessionStorage.getItem(QUIZ_MOTION_KEY), null);
    f.app.dispose(); f.window.close();
  }
});
