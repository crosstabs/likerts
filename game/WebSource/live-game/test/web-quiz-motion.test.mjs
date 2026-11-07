import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuizMotionController, QUIZ_MOTION_KEY, QUIZ_MOTION_DURATION } from '../web/quiz-motion.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));

function eventSurface() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, detail = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type, target: this, ...detail });
    },
    get listenerCount() { return [...listeners.values()].reduce((sum, current) => sum + current.size, 0); },
  };
}

function storageFixture(trace = []) {
  const values = new Map();
  return {
    values, trace, failRead: false, failWrite: false,
    getItem(key) { trace.push({ type: 'read', key }); if (this.failRead) throw new Error('Storage denied'); return values.get(key) ?? null; },
    setItem(key, value) { trace.push({ type: 'write', key, value: String(value) }); if (this.failWrite) throw new Error('Storage full'); values.set(key, String(value)); },
    removeItem(key) { trace.push({ type: 'remove', key }); values.delete(key); },
  };
}

function environment({ storage, reduced = false, initialTime = 10_000 } = {}) {
  const trace = [], clock = { value: initialTime }, timers = new Map(); let timerID = 0;
  const document = { ...eventSurface(), visibilityState: 'visible', hidden: false };
  const media = { ...eventSurface(), matches: reduced, media: '(prefers-reduced-motion: reduce)' };
  media.addListener = listener => media.addEventListener('change', listener);
  media.removeListener = listener => media.removeEventListener('change', listener);
  const window = {
    ...eventSurface(), document,
    matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; },
    setTimeout(callback, delay = 0) { const id = ++timerID; timers.set(id, { callback, at: clock.value + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  window.requestAnimationFrame = callback => window.setTimeout(() => callback(clock.value), 16);
  window.cancelAnimationFrame = id => window.clearTimeout(id);
  const saved = storage ?? storageFixture(trace), animations = [];
  function root({ count = 1, images = [], outsideImages = [], supported = true } = {}) {
    const nodes = Array.from({ length: count }, () => {
      const node = {
        ownerDocument: document, isConnected: true, dataset: { quizEntrance: '' },
        querySelectorAll(selector) { assert.equal(selector, 'img'); return images; },
        matches(selector) { return selector === '[data-quiz-entrance]'; },
        getAttribute(name) { return name === 'data-quiz-entrance' ? '' : null; },
        animate: undefined,
      };
      if (supported) node.animate = (keyframes, options) => {
        trace.push({ type: 'animate', node });
        let finishedPromise, resolveFinished, rejectFinished;
        const animation = {
          node, keyframes, options, currentTime: 0, playState: 'running', cancelCount: 0, playCount: 0, pauseCount: 0,
          pause() { this.pauseCount++; this.playState = 'paused'; },
          play() { this.playCount++; this.playState = 'running'; },
          cancel() { this.cancelCount++; this.playState = 'idle'; rejectFinished?.(new DOMException('Animation cancelled', 'AbortError')); },
          finish() { this.currentTime = QUIZ_MOTION_DURATION; this.playState = 'finished'; resolveFinished?.(); },
          get finished() {
            if (!finishedPromise) {
              finishedPromise = new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
              if (this.playState === 'finished') resolveFinished();
              if (this.playState === 'idle') rejectFinished(new DOMException('Animation cancelled', 'AbortError'));
            }
            return finishedPromise;
          },
        };
        animations.push(animation); return animation;
      };
      return node;
    });
    return {
      nodes, ownerDocument: document, isConnected: true,
      querySelectorAll(selector) { if (selector === 'img') return [...images,...outsideImages]; if (selector === '[data-quiz-entrance] img') return images; assert.equal(selector, '[data-quiz-entrance]'); return nodes; },
      contains(node) { return nodes.includes(node); },
    };
  }
  return {
    window, document, media, storage: saved, trace, clock, animations, root,
    options: { window, storage: saved, now: () => clock.value },
    reduce(value) { media.matches = value; media.emit('change', { matches: value }); },
    visibility(value) { document.visibilityState = value; document.hidden = value === 'hidden'; document.emit('visibilitychange'); },
    advance(milliseconds) {
      clock.value += milliseconds;
      for (let count = 0; count < 1_000; count++) {
        const due = [...timers].filter(([, timer]) => timer.at <= clock.value).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        timers.delete(due[0]); due[1].callback();
      }
      throw new Error('Unexpected motion timer loop');
    },
  };
}

function controller(t, env) {
  const result = createQuizMotionController(env.options); t.after(() => result.dispose()); return result;
}

test('motion journals a stage before its first animation and uses the fixed 360ms duration', t => {
  const e = environment(), c = controller(t, e), root = e.root({ count: 2 });
  assert.equal(QUIZ_MOTION_DURATION, 360); assert.equal(typeof QUIZ_MOTION_KEY, 'string'); assert.ok(QUIZ_MOTION_KEY.length > 0);
  c.bind(root, 'quiz:match-one:round-one:reveal');
  assert.equal(e.animations.length, 2);
  const writeAt = e.trace.findIndex(item => item.type === 'write' && item.key === QUIZ_MOTION_KEY);
  const animateAt = e.trace.findIndex(item => item.type === 'animate');
  assert.ok(writeAt >= 0 && writeAt < animateAt, 'Durably consume the stage before an element moves');
  assert.equal(JSON.parse(e.storage.getItem(QUIZ_MOTION_KEY)).version, 1);
  for (const animation of e.animations) { assert.equal(animation.options.duration, 360); assert.equal(animation.currentTime, 0); }
});

test('rebinding the same connected targets never rewinds their entrance', t => {
  const e = environment(), c = controller(t, e), root = e.root();
  c.bind(root, 'quiz:match-one:reveal'); const first = e.animations[0]; e.advance(80); c.bind(root, 'quiz:match-one:reveal');
  const latest = e.animations.at(-1);
  if (latest !== first) {
    assert.ok(first.cancelCount > 0); assert.equal(latest.currentTime, 80, 'A replacement handle resumes elapsed time instead of replaying from zero');
  }
});

test('replacement targets continue at the original elapsed time instead of beginning again', t => {
  const e = environment(), c = controller(t, e);
  c.bind(e.root(), 'quiz:match-one:round-one:reveal'); const first = e.animations[0];
  e.advance(120); c.bind(e.root(), 'quiz:match-one:round-one:reveal');
  assert.equal(e.animations.length, 2); assert.ok(first.cancelCount > 0, 'Detached targets must stop');
  assert.equal(e.animations[1].currentTime, 120, 'A replacement has only the original remaining duration');
  e.advance(90); c.bind(e.root(), 'quiz:match-one:round-one:reveal');
  assert.equal(e.animations[2].currentTime, 210, 'Repeated replacements never move the stage start');
});

test('at or beyond 360ms a replacement is static and an unseen stage may animate once', t => {
  const e = environment(), c = controller(t, e);
  c.bind(e.root(), 'quiz:match-one:round-one:reveal'); e.advance(360);
  c.bind(e.root(), 'quiz:match-one:round-one:reveal'); assert.equal(e.animations.length, 1);
  c.bind(e.root(), 'quiz:match-one:round-two:reveal'); assert.equal(e.animations.length, 2);
  e.advance(400); c.bind(e.root(), 'quiz:match-one:round-two:reveal'); assert.equal(e.animations.length, 2);
});

test('a new controller with the same session journal never restarts an earlier stage', t => {
  const e = environment(), first = controller(t, e);
  first.bind(e.root(), 'quiz:match-one:finished'); e.advance(100);
  const reload = controller(t, e); reload.bind(e.root(), 'quiz:match-one:finished');
  assert.equal(e.animations.length, 1, 'Reload must not replay even a partially elapsed entrance');
  first.dispose(); reload.dispose();
});

test('reduced-motion at first bind consumes the stage and disabling it does not replay that stage', t => {
  const e = environment({ reduced: true }), c = controller(t, e);
  c.bind(e.root(), 'quiz:match-one:round-one:reveal'); assert.equal(e.animations.length, 0);
  assert.ok(e.storage.getItem(QUIZ_MOTION_KEY));
  e.reduce(false); c.bind(e.root(), 'quiz:match-one:round-one:reveal'); assert.equal(e.animations.length, 0);
  c.bind(e.root(), 'quiz:match-one:round-two:reveal'); assert.equal(e.animations.length, 1);
});

test('enabling reduced-motion immediately cancels active targets and consumes their stage', t => {
  const e = environment(), c = controller(t, e);
  c.bind(e.root({ count: 2 }), 'quiz:match-one:finished'); e.reduce(true);
  assert.ok(e.animations.every(animation => animation.cancelCount > 0));
  e.reduce(false); c.bind(e.root(), 'quiz:match-one:finished'); assert.equal(e.animations.length, 2);
});

test('hidden visibility immediately cancels and permanently consumes the active stage', t => {
  const e = environment(), c = controller(t, e);
  c.bind(e.root(), 'quiz:match-one:reveal'); e.visibility('hidden');
  assert.ok(e.animations[0].cancelCount > 0);
  e.visibility('visible'); c.bind(e.root(), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 1);
  c.bind(e.root(), 'quiz:match-one:finished'); assert.equal(e.animations.length, 2);
});

test('a stage first observed in a hidden document remains static after visibility returns', t => {
  const e = environment(), c = controller(t, e); e.visibility('hidden');
  c.bind(e.root(), 'quiz:match-one:reveal'); e.visibility('visible');
  c.bind(e.root(), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 0);
});

test('not-ready image targets are consumed without waiting or a late decode entrance', t => {
  for (const image of [{ complete: false, naturalWidth: 0 }, { complete: true, naturalWidth: 0 }]) {
    const e = environment(), c = controller(t, e);
    c.bind(e.root({ images: [image] }), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 0);
    image.complete = true; image.naturalWidth = 1983;
    c.bind(e.root({ images: [image] }), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 0);
  }
});

test('cold scene artwork starts decoding immediately and warms later phases without touching a lazy outside image', async t => {
  let finishDecode,sceneDecodes=0,lazyDecodes=0;
  const decoding=new Promise(resolve=>{finishDecode=resolve;});
  const sceneImage={complete:false,naturalWidth:0,src:'https://art-test.invalid/cold-cast.png',decode(){sceneDecodes++;return decoding;}};
  const lazyBook={complete:false,naturalWidth:0,src:'https://art-test.invalid/lazy-book.png',loading:'lazy',decode(){lazyDecodes++;return Promise.resolve();}};
  const e=environment(),c=controller(t,e),root=e.root({images:[sceneImage],outsideImages:[lazyBook]});
  c.bind(root,'question:answer');
  assert.equal(sceneDecodes,1,'Begin waiting for the eager scene image on its first cold observation');
  assert.equal(lazyDecodes,0,'Do not decode an unrelated lazy illustration outside the entrance');
  assert.equal(e.animations.length,0,'The cold scene stays static without blocking content');
  sceneImage.complete=true;sceneImage.naturalWidth=1983;finishDecode();await flush();
  assert.equal(e.animations.length,0,'Loading and decoding never starts the consumed entrance asynchronously');
  c.bind(root,'question:answer');assert.equal(e.animations.length,0);
  c.bind(root,'question:reveal');assert.equal(e.animations.length,1);assert.equal(e.animations[0].currentTime,0);
  assert.equal(sceneDecodes,1);assert.equal(lazyDecodes,0);
});

test('decoded original artwork warms later stages without starting an entrance late on the current stage', async t => {
  const ready = { complete: true, naturalWidth: 1983, src: 'https://art-test.invalid/original.png', decode: () => Promise.resolve() }, e = environment(), c = controller(t, e);
  c.bind(e.root({ images: [ready] }), 'quiz:match-one:answer'); assert.equal(e.animations.length, 0); await flush();
  c.bind(e.root({ images: [ready] }), 'quiz:match-one:answer'); assert.equal(e.animations.length, 0, 'Decode completion does not replay an already consumed scene');
  c.bind(e.root({ images: [ready] }), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 1);
  c.bind(e.root({ count: 2, images: [ready, { complete: false, naturalWidth: 0 }] }), 'quiz:match-one:finished');
  assert.equal(e.animations.length, 1, 'Do not partially animate a stage whose art has not decoded');
});

test('delayed, rejected or unavailable decoding never blocks binding or produces a late current-stage entrance', async t => {
  for (const outcome of ['resolve', 'reject', 'unavailable']) {
    let resolve, reject; const decoding = new Promise((yes, no) => { resolve = yes; reject = no; });
    const image = { complete: true, naturalWidth: 1983, src: 'https://art-test.invalid/' + outcome + '.png', ...(outcome === 'unavailable' ? {} : { decode: () => decoding }) };
    const e = environment(), c = controller(t, e);
    assert.doesNotThrow(() => c.bind(e.root({ images: [image] }), 'quiz:match-one:answer')); assert.equal(e.animations.length, 0);
    if (outcome === 'reject') reject(new Error('Decode failed')); else resolve();
    await flush(); assert.equal(e.animations.length, 0, 'No asynchronous decode completion starts motion on its own');
    c.bind(e.root({ images: [image] }), 'quiz:match-one:answer'); assert.equal(e.animations.length, 0);
    c.bind(e.root({ images: [image] }), 'quiz:match-one:reveal'); assert.equal(e.animations.length, outcome === 'resolve' ? 1 : 0);
  }
});

test('a backward clock after an elapsed observation consumes the stage instead of rewinding it', t => {
  const e = environment(), c = controller(t, e);
  c.bind(e.root(), 'quiz:match-one:reveal'); e.advance(120); c.bind(e.root(), 'quiz:match-one:reveal');
  assert.equal(e.animations.length, 2); assert.equal(e.animations[1].currentTime, 120);
  e.clock.value -= 40; c.bind(e.root(), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 2);
  assert.ok(e.animations[1].cancelCount > 0);
  e.clock.value += 80; c.bind(e.root(), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 2);
  const reload = controller(t, e); reload.bind(e.root(), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 2);
});

test('storage unavailability or failed reads and writes leave every target static', t => {
  for (const kind of ['missing', 'read', 'write']) {
    const e = environment();
    if (kind === 'missing') e.options.storage = null;
    if (kind === 'read') e.storage.failRead = true;
    if (kind === 'write') e.storage.failWrite = true;
    const c = controller(t, e); assert.doesNotThrow(() => c.bind(e.root(), 'quiz:match-one:reveal'));
    assert.equal(e.animations.length, 0, kind);
  }
});

test('corrupt or unsupported journals stay static and are not silently replaced', t => {
  for (const raw of ['{broken', 'null', '[]', '{"version":2,"entries":[]}']) {
    const e = environment(); e.storage.values.set(QUIZ_MOTION_KEY, raw); const c = controller(t, e);
    c.bind(e.root(), 'quiz:match-one:reveal'); c.bind(e.root(), 'quiz:match-two:finished');
    assert.equal(e.animations.length, 0); assert.equal(e.storage.getItem(QUIZ_MOTION_KEY), raw);
  }
});

test('missing or rejected matchMedia and missing visibility APIs degrade to static targets', t => {
  for (const mutate of [e => e.window.matchMedia = undefined, e => e.window.matchMedia = () => { throw new Error('Media unavailable'); },
    e => e.window.matchMedia = () => null, e => delete e.document.visibilityState]) {
    const e = environment(); mutate(e); const c = controller(t, e);
    assert.doesNotThrow(() => c.bind(e.root(), 'quiz:match-one:reveal')); assert.equal(e.animations.length, 0);
  }
});

test('unsupported or rejected WAAPI consumes a stage without a later retry entrance', t => {
  for (const rejecting of [false, true]) {
    const e = environment(), c = controller(t, e), root = e.root({ supported: false });
    if (rejecting) root.nodes[0].animate = () => { throw new Error('Animation rejected'); };
    assert.doesNotThrow(() => c.bind(root, 'quiz:match-one:reveal')); assert.equal(e.animations.length, 0);
    c.bind(e.root(), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 0, 'Feature recovery does not replay the consumed stage');
  }
});

test('a scope stops after 128 unique stages while a fresh journey has its own replay-safe budget', t => {
  const e = environment(), c = controller(t, e);
  for (let index = 0; index < 128; index++) c.bind(e.root(), 'quiz:stage-' + index);
  assert.equal(e.animations.length, 128);
  c.bind(e.root(), 'quiz:stage-128'); c.bind(e.root(), 'quiz:stage-129'); assert.equal(e.animations.length, 128);
  c.bind(e.root(), 'quiz:stage-0', 'fresh-journey'); assert.equal(e.animations.length, 129, 'A full older journey does not disable future games');
  const reload = controller(t, e); reload.bind(e.root(), 'quiz:stage-0'); reload.bind(e.root(), 'quiz:unseen-after-reload');
  reload.bind(e.root(), 'quiz:stage-0', 'fresh-journey');
  assert.equal(e.animations.length, 129, 'Retained markers stay consumed across reload without evicting old stages within a scope');
  reload.bind(e.root(), 'quiz:stage-1', 'fresh-journey'); assert.equal(e.animations.length, 130);
});

test('the eight most recently used journeys retain replay protection while a ninth retires the oldest', t => {
  const e = environment(), c = controller(t, e), key = 'quiz:reveal';
  for (let index = 0; index < 8; index++) { c.bind(e.root(), key, 'journey-' + index); e.advance(1); }
  assert.equal(e.animations.length, 8);
  e.advance(400); c.bind(e.root(), key, 'journey-0'); assert.equal(e.animations.length, 8, 'Touch an elapsed scope without restarting its entrance');
  e.advance(1); c.bind(e.root(), key, 'journey-8'); assert.equal(e.animations.length, 9);
  const reload = controller(t, e);
  for (const scope of ['journey-0', 'journey-2', 'journey-8']) reload.bind(e.root(), key, scope);
  assert.equal(e.animations.length, 9, 'Recent journeys preserve their markers after reload');
  reload.bind(e.root(), key, 'journey-1');
  assert.equal(e.animations.length, 10, 'The least recently used journey, rather than the recently touched first journey, was retired');
  assert.ok(new TextEncoder().encode(e.storage.getItem(QUIZ_MOTION_KEY)).byteLength <= 256 * 1024, 'Journal remains within the session-storage bound');
});

test('dispose cancels active motion, removes lifecycle listeners and refuses later binds', async t => {
  const e = environment(), c = controller(t, e);
  c.bind(e.root({ count: 2 }), 'quiz:match-one:reveal'); c.dispose();
  assert.ok(e.animations.every(animation => animation.cancelCount > 0));
  c.bind(e.root(), 'quiz:match-one:finished'); e.reduce(true); e.visibility('hidden'); e.advance(500); await flush();
  assert.equal(e.animations.length, 2); assert.equal(e.media.listenerCount, 0); assert.equal(e.document.listenerCount, 0); assert.equal(e.window.listenerCount, 0);
});

test('naturally finished animation promises do not replay on a later poll or replacement', async t => {
  const e = environment(), c = controller(t, e);
  c.bind(e.root(), 'quiz:match-one:reveal'); e.animations[0].finish(); e.advance(360); await flush();
  c.bind(e.root(), 'quiz:match-one:reveal'); assert.equal(e.animations.length, 1);
});
