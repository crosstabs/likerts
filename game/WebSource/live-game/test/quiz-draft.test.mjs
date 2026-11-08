import assert from 'node:assert/strict';
import test from 'node:test';
import { QUIZ_LIMITS, sampleQuizDocument } from '../web/quiz-document.mjs';
import { QUIZ_LIBRARY_KEY } from '../web/quiz-library.mjs';
import { MAX_DRAFT_BYTES, QUIZ_DRAFT_KEY, QuizDraftStore, normalizeQuizDraft } from '../web/quiz-draft.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const uuid = number => '00000000-0000-4000-8000-' + number.toString(16).padStart(12, '0');
let revisionNumber = 10_000;
const revision = () => uuid(revisionNumber++);
const copy = value => structuredClone(value);
const byteLength = value => new TextEncoder().encode(value).length;
const question = number => ({ id: uuid(number), prompt: '', answers: ['', '', '', ''], correctAnswer: -1, explanation: '', timeLimitSeconds: 20 });
const partial = () => ({ format: 'likerts.quiz', version: 1, id: uuid(1), title: '', questions: [question(2)] });
const unfinished = (overrides = {}) => ({ draftID: uuid(100), quiz: partial(), sourceQuiz: null, questionIndex: 0, ...overrides });
const open = (storage, overrides = {}) => new QuizDraftStore({ storage, locks: storage?.locks, makeRevision: revision, ...overrides });
const raw = storage => storage.values.get(QUIZ_DRAFT_KEY) ?? null;
const envelope = (value = unfinished()) => ({ format: 'likerts.quiz.draft', version: 1, revision: uuid(500), ...value });
function unrelated(storage) {
  storage.values.set(QUIZ_LIBRARY_KEY, 'saved-library-byte-fixture');
  storage.values.set('likerts.live.saved', 'unrelated-live-fixture');
}
function assertUnrelated(storage) {
  assert.equal(storage.values.get(QUIZ_LIBRARY_KEY), 'saved-library-byte-fixture');
  assert.equal(storage.values.get('likerts.live.saved'), 'unrelated-live-fixture');
}

test('unfinished text round-trips exactly without becoming a portable quiz or saved library entry', async () => {
  const data = createStorage(); unrelated(data);
  const value = unfinished(); value.quiz.title = '  Cafe\u0301  ';
  value.quiz.questions[0].prompt = '  A question\nnot finished\t';
  value.quiz.questions[0].answers = ['', 'same', 'same', ''];
  value.quiz.questions[0].correctAnswer = -1;
  value.quiz.questions[0].explanation = '\n';
  value.quiz.questions.push(question(3)); value.questionIndex = 1;
  const store = open(data), result = await store.save(value);
  assert.equal(result.format, 'likerts.quiz.draft'); assert.equal(result.version, 1);
  assert.deepEqual(result.quiz, value.quiz); assert.equal(result.questionIndex, 1);
  assert.deepEqual(open(data).current, result); assert.equal(open(data).blocked, false);
  assertUnrelated(data);
});

test('draft normalization detaches nested values and normalizes identifiers only', () => {
  const value = partial(); value.id = uuid(0xabcdef).toUpperCase(); value.questions[0].id = uuid(0xdefabc).toUpperCase();
  value.title = '  e\u0301 '; value.questions[0].answers[0] = '<script>unfinished</script>';
  const result = normalizeQuizDraft(value);
  assert.equal(result.id, value.id.toLowerCase()); assert.equal(result.questions[0].id, value.questions[0].id.toLowerCase());
  assert.notEqual(result.id, value.id); assert.notEqual(result.questions[0].id, value.questions[0].id);
  assert.equal(result.title, '  e\u0301 '); assert.equal(result.questions[0].answers[0], '<script>unfinished</script>');
  result.questions[0].answers[0] = 'mutated'; assert.equal(value.questions[0].answers[0], '<script>unfinished</script>');
});

test('bounded raw text can remain invalid for final Save without losing the typed draft', () => {
  const value = partial(); value.title = '界'.repeat(QUIZ_LIMITS.title * 2);
  value.questions[0].prompt = 'x'.repeat(QUIZ_LIMITS.prompt * 2);
  value.questions[0].answers[0] = 'y'.repeat(QUIZ_LIMITS.answer * 2);
  value.questions[0].explanation = 'z'.repeat(QUIZ_LIMITS.explanation * 2);
  const result = normalizeQuizDraft(value); assert.deepEqual(result, value);
  const emoji = partial(); emoji.title = '🪁'.repeat(QUIZ_LIMITS.title);
  assert.equal(normalizeQuizDraft(emoji).title, emoji.title);
});

test('strict partial shape, counts, identifiers and unsupported values fail before any write', async t => {
  const invalid = [
    ['unknown root field', value => { value.extra = true; }],
    ['missing root field', value => { delete value.title; }],
    ['wrong format', value => { value.format = 'other'; }],
    ['future quiz version', value => { value.version = 2; }],
    ['invalid root identifier', value => { value.id = 'not-a-uuid'; }],
    ['no questions', value => { value.questions = []; }],
    ['extra question-array property', value => { value.questions.extra = true; }],
    ['too many questions', value => { value.questions = Array.from({ length: 31 }, (_, index) => question(index + 2)); }],
    ['duplicate question identifier', value => { value.questions.push(copy(value.questions[0])); }],
    ['question identifier equals quiz identifier', value => { value.questions[0].id = value.id; }],
    ['unknown question field', value => { value.questions[0].hint = 'extra'; }],
    ['missing question field', value => { delete value.questions[0].explanation; }],
    ['one answer', value => { value.questions[0].answers = ['']; }],
    ['five answers', value => { value.questions[0].answers = ['', '', '', '', '']; }],
    ['extra answer-array property', value => { value.questions[0].answers.extra = true; }],
    ['non-text answer', value => { value.questions[0].answers[0] = 12; }],
    ['negative answer outside unfinished sentinel', value => { value.questions[0].correctAnswer = -2; }],
    ['answer beyond array', value => { value.questions[0].correctAnswer = 4; }],
    ['fractional answer', value => { value.questions[0].correctAnswer = 1.5; }],
    ['string answer', value => { value.questions[0].correctAnswer = '1'; }],
    ['unsupported time', value => { value.questions[0].timeLimitSeconds = 15; }],
    ['string time', value => { value.questions[0].timeLimitSeconds = '20'; }],
    ['overlong title', value => { value.title = 'x'.repeat(QUIZ_LIMITS.title * 2 + 1); }],
    ['overlong prompt', value => { value.questions[0].prompt = 'x'.repeat(QUIZ_LIMITS.prompt * 2 + 1); }],
    ['overlong answer', value => { value.questions[0].answers[0] = 'x'.repeat(QUIZ_LIMITS.answer * 2 + 1); }],
    ['overlong explanation', value => { value.questions[0].explanation = 'x'.repeat(QUIZ_LIMITS.explanation * 2 + 1); }],
    ['unpaired high surrogate', value => { value.title = '\uD800'; }],
    ['unpaired low surrogate', value => { value.questions[0].answers[0] = '\uDC00'; }],
  ];
  for (const [name, mutate] of invalid) await t.test(name, async () => {
    const value = partial(); mutate(value); const data = createStorage(); unrelated(data);
    assert.throws(() => normalizeQuizDraft(value));
    await assert.rejects(open(data).save(unfinished({ quiz: value })), { code: 'invalid_draft' });
    assert.equal(data.writes, 0); assert.equal(raw(data), null); assertUnrelated(data);
  });
  for (const value of [null, [], new Date(), Object.assign(Object.create({ inherited: true }), partial())]) {
    assert.throws(() => normalizeQuizDraft(value));
  }
});

test('sparse questions and answers cannot be persisted as a draft that breaks on reload', async () => {
  for (const sparse of ['questions', 'answers']) {
    const value = partial();
    if (sparse === 'questions') value.questions = new Array(1);
    else value.questions[0].answers = new Array(2);
    const data = createStorage();
    assert.throws(() => normalizeQuizDraft(value), sparse + ' must be dense');
    await assert.rejects(open(data).save(unfinished({ quiz: value })), { code: 'invalid_draft' });
    assert.equal(raw(data), null);
  }
});

test('UTF-8 document byte limit applies even when every field fits its raw text bound', async () => {
  const value = partial(); value.questions = Array.from({ length: 30 }, (_, index) => ({
    ...question(index + 2), prompt: '界'.repeat(240), answers: Array.from({ length: 4 }, () => '界'.repeat(100)), explanation: '界'.repeat(240),
  }));
  assert.ok(byteLength(JSON.stringify(value)) > QUIZ_LIMITS.bytes);
  const data = createStorage();
  assert.throws(() => normalizeQuizDraft(value), /large/);
  await assert.rejects(open(data).save(unfinished({ quiz: value })), { code: 'invalid_draft' });
  assert.equal(raw(data), null);
});

test('all supported timer values and every valid unfinished answer position survive normalization', () => {
  for (const seconds of [0, 10, 20, 30, 60, 120]) for (const correct of [-1, 0, 1, 2, 3]) {
    const value = partial(); value.questions[0].timeLimitSeconds = seconds; value.questions[0].correctAnswer = correct;
    assert.deepEqual(normalizeQuizDraft(value), value);
  }
});

test('source quiz is a detached valid baseline with the same normalized quiz identifier', async () => {
  const sourceQuiz = sampleQuizDocument(), quiz = copy(sourceQuiz); quiz.title = ''; quiz.questions[0].answers[0] = '';
  const data = createStorage(), store = open(data);
  const saved = await store.save(unfinished({ quiz, sourceQuiz }));
  assert.deepEqual(saved.sourceQuiz, sourceQuiz); assert.deepEqual(saved.quiz, quiz);
  sourceQuiz.title = 'caller change'; saved.sourceQuiz.questions[0].answers[0] = 'returned change';
  assert.equal(store.current.sourceQuiz.title, 'Little wonders');
  assert.equal(store.current.sourceQuiz.questions[0].answers[0], 'Venus');
  const uppercaseQuiz = copy(quiz); uppercaseQuiz.id = uppercaseQuiz.id.toUpperCase();
  assert.equal((await open(createStorage()).save(unfinished({ quiz: uppercaseQuiz, sourceQuiz: sampleQuizDocument() }))).sourceQuiz.id, quiz.id);
  const sparseSource = sampleQuizDocument(); sparseSource.questions = new Array(1);
  for (const invalid of [
    { ...sampleQuizDocument(), id: uuid(900) },
    { ...sampleQuizDocument(), title: '' },
    { ...sampleQuizDocument(), unexpected: true },
    { ...sampleQuizDocument(), questions: [{ ...sampleQuizDocument().questions[0], correctAnswer: -1 }] },
    sparseSource,
  ]) {
    const before = raw(data);
    await assert.rejects(store.save(unfinished({ quiz, sourceQuiz: invalid })), { code: 'invalid_draft' });
    assert.equal(raw(data), before);
  }
});

test('recovery payload identifiers, position and exact fields are validated independently of quiz content', async () => {
  for (const mutate of [
    value => { value.draftID = 'invalid'; }, value => { delete value.sourceQuiz; }, value => { value.extra = true; },
    value => { value.questionIndex = -1; }, value => { value.questionIndex = 1; }, value => { value.questionIndex = 0.5; },
    value => { value.questionIndex = '0'; },
  ]) {
    const value = unfinished(); mutate(value); const data = createStorage();
    await assert.rejects(open(data).save(value), { code: 'invalid_draft' }); assert.equal(data.writes, 0);
  }
});

test('store snapshots detach input, save results and subsequent current reads', async () => {
  const data = createStorage(), store = open(data), value = unfinished(); value.quiz.title = 'Captured before lock';
  const pending = store.save(value); value.quiz.title = 'Changed while queued';
  const saved = await pending; assert.equal(saved.quiz.title, 'Captured before lock');
  const before = raw(data); saved.quiz.questions[0].answers[0] = 'returned mutation';
  const current = store.current; current.quiz.title = 'getter mutation'; current.quiz.questions.push(question(12));
  assert.equal(raw(data), before); assert.equal(store.current.quiz.title, 'Captured before lock');
  assert.equal(store.current.quiz.questions.length, 1); assert.equal(store.current.quiz.questions[0].answers[0], '');
});

test('missing storage or locking support never performs draft writes or removes', async () => {
  const data = createStorage(); data.values.set(QUIZ_DRAFT_KEY, JSON.stringify(envelope()));
  const readOnly = open(data, { locks: null }); assert.equal(readOnly.blocked, false); assert.equal(readOnly.canWrite, false);
  assert.equal(readOnly.lastError.code, 'locking_unavailable'); assert.ok(readOnly.current);
  const before = raw(data); await assert.rejects(readOnly.save(unfinished()), { code: 'locking_unavailable' });
  await assert.rejects(readOnly.clear(), { code: 'locking_unavailable' }); assert.equal(raw(data), before); assert.equal(data.writes, 0);
  const unavailable = new QuizDraftStore(); assert.equal(unavailable.blocked, true); assert.equal(unavailable.canWrite, false);
  await assert.rejects(unavailable.save(unfinished())); await assert.rejects(unavailable.clear());
  const noRemoval = { getItem: data.getItem.bind(data), setItem: data.setItem.bind(data) };
  const incompleteStorage = new QuizDraftStore({ storage: noRemoval, locks: data.locks });
  assert.equal(incompleteStorage.writeSupported, false); await assert.rejects(incompleteStorage.save(unfinished()));
  assert.equal(raw(data), before);
});

test('two empty tabs serialize writes and refuse the stale tab without replacing the winner', async () => {
  const data = createStorage(); unrelated(data); const first = open(data), stale = open(data);
  const one = unfinished(); one.quiz.title = 'First tab'; const two = unfinished({ draftID: uuid(101) }); two.quiz.title = 'Second tab';
  const results = await Promise.allSettled([first.save(one), stale.save(two)]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'storage_changed'); assert.equal(data.locks.maximumActive, 1);
  assert.equal(stale.blocked, true); assert.equal(open(data).current.quiz.title, 'First tab'); assertUnrelated(data);
});

test('same-instance writes serialize using the latest raw value instead of losing quick changes', async () => {
  const data = createStorage(), store = open(data), one = unfinished(), two = unfinished();
  one.quiz.title = 'First change'; two.quiz.title = 'Latest change';
  const [first, second] = await Promise.all([store.save(one), store.save(two)]);
  assert.notEqual(first.revision, second.revision); assert.equal(store.current.quiz.title, 'Latest change');
  assert.equal(open(data).current.revision, second.revision); assert.equal(data.locks.maximumActive, 1);
});

test('a loaded recovery slot cannot be silently replaced by a different draft ID', async () => {
  const data = createStorage(), store = open(data); const saved = await store.save(unfinished()); const before = raw(data);
  const other = unfinished({ draftID: uuid(101) }); other.quiz.title = 'Another unfinished quiz';
  await assert.rejects(store.save(other), { code: 'draft_exists' }); assert.equal(raw(data), before);
  assert.equal(store.current.draftID, saved.draftID);
  assert.equal(await store.clear(saved.revision), true); await store.save(other); assert.equal(store.current.draftID, other.draftID);
});

test('older revision cleanup cannot remove a newer same-tab or other-tab snapshot', async () => {
  const data = createStorage(), first = open(data); const old = await first.save(unfinished());
  const update = unfinished(); update.quiz.title = 'Newer revision'; const newer = await first.save(update); const before = raw(data);
  await assert.rejects(first.clear(old.revision), { code: 'storage_changed' }); assert.equal(raw(data), before);
  const other = open(data); const newestValue = unfinished(); newestValue.quiz.title = 'Other tab latest';
  const newest = await other.save(newestValue), latestRaw = raw(data);
  await assert.rejects(first.clear(newer.revision), { code: 'storage_changed' }); assert.equal(raw(data), latestRaw);
  assert.equal(open(data).current.revision, newest.revision);
});

test('a repeated revision factory cannot make stale cleanup delete updated content', async () => {
  const data = createStorage(), store = open(data, { makeRevision: () => uuid(600) });
  const initial = await store.save(unfinished()); const before = raw(data);
  const update = unfinished(); update.quiz.title = 'A newer body cannot reuse the old token';
  await assert.rejects(store.save(update)); assert.equal(raw(data), before);
  assert.equal(store.current.revision, initial.revision);
});

test('revision generation failure preserves the previously stored recovery record', async () => {
  for (const makeRevision of [() => { throw new Error('No random source'); }, () => 'invalid', () => null]) {
    const data = createStorage(); const previous = await open(data).save(unfinished()); const before = raw(data), writes = data.writes;
    const store = open(data, { makeRevision }); const value = unfinished(); value.quiz.title = 'Not persisted';
    await assert.rejects(store.save(value)); assert.equal(raw(data), before); assert.equal(data.writes, writes);
    assert.equal(store.current.revision, previous.revision); assert.equal(store.current.quiz.title, '');
  }
});

test('checkForChange freezes a stale writer without silently adopting the other tab revision', async () => {
  const data = createStorage(), first = open(data); await first.save(unfinished()); const observer = open(data);
  assert.equal(observer.checkForChange(), false);
  const updated = unfinished(); updated.quiz.title = 'Writer latest'; await first.save(updated); const before = raw(data);
  assert.equal(observer.checkForChange(), true); assert.equal(observer.blocked, true);
  assert.equal(observer.current.quiz.title, '');
  await assert.rejects(observer.save(unfinished()), { code: 'storage_changed' }); assert.equal(raw(data), before);
  observer.reload(); assert.equal(observer.current.quiz.title, 'Writer latest'); assert.equal(observer.blocked, false);
});

test('corrupt, unsupported and invalid loaded records preserve bytes until explicit conditional clear', async () => {
  const records = ['{broken', JSON.stringify({ ...envelope(), format: 'unrelated' }), JSON.stringify({ ...envelope(), version: 2 }), JSON.stringify({ ...envelope(), unexpected: true }),
    JSON.stringify({ ...envelope(), revision: 'invalid' }), JSON.stringify({ ...envelope(), questionIndex: 8 }),
    JSON.stringify({ ...envelope(), quiz: { ...partial(), title: '\uD800' } })];
  for (const invalid of records) {
    const data = createStorage(); unrelated(data); data.values.set(QUIZ_DRAFT_KEY, invalid); const store = open(data);
    assert.equal(store.blocked, true); assert.equal(store.current, null); assert.equal(store.hasStoredValue, true);
    await assert.rejects(store.save(unfinished()), { code: 'load_failed' }); assert.equal(raw(data), invalid);
    assert.equal(await store.clear(), true); assert.equal(raw(data), null); assert.equal(store.blocked, false); assertUnrelated(data);
  }
});

test('raw recovery envelope accepts its exact byte boundary and rejects the next byte without erasing it', async () => {
  const source = JSON.stringify(envelope()); const atLimit = source + ' '.repeat(MAX_DRAFT_BYTES - byteLength(source));
  assert.equal(byteLength(atLimit), MAX_DRAFT_BYTES);
  const data = createStorage(); data.values.set(QUIZ_DRAFT_KEY, atLimit); const readable = open(data);
  assert.equal(readable.blocked, false); assert.ok(readable.current); assert.equal(data.writes, 0);
  data.values.set(QUIZ_DRAFT_KEY, atLimit + ' '); const oversized = open(data);
  assert.equal(oversized.blocked, true); assert.equal(raw(data), atLimit + ' ');
  await assert.rejects(oversized.save(unfinished()), { code: 'load_failed' }); assert.equal(raw(data), atLimit + ' ');
});

test('storage quota failure preserves the previous successful draft and detached store state', async () => {
  const data = createStorage(); unrelated(data); const store = open(data); await store.save(unfinished());
  const previous = raw(data), state = store.current, update = unfinished(); update.quiz.title = 'Unsaved in memory'; data.failWrite = true;
  await assert.rejects(store.save(update), { code: 'save_failed' }); assert.equal(raw(data), previous); assert.deepEqual(store.current, state);
  assertUnrelated(data); data.failWrite = false; await store.save(update); assert.equal(store.current.quiz.title, 'Unsaved in memory');
});

test('read failure cannot authorize overwrite or removal of bytes that have not been observed', async () => {
  const data = createStorage(), store = open(data); await store.save(unfinished()); const previous = raw(data);
  data.failRead = true; await assert.rejects(store.save(unfinished()), { code: 'read_failed' }); assert.equal(raw(data), previous);
  await assert.rejects(store.clear(), { code: 'read_failed' }); assert.equal(raw(data), previous);
  const unreadable = open(data); assert.equal(unreadable.blocked, true); assert.equal(unreadable.hasStoredValue, false);
  data.failRead = false; await assert.rejects(unreadable.clear(), { code: 'storage_changed' }); assert.equal(raw(data), previous);
  assert.equal(unreadable.reload(), true); assert.equal(await unreadable.clear(), true);
});

test('remove failure preserves the recovery record and all unrelated keys', async () => {
  const data = createStorage(); unrelated(data); const store = open(data); const saved = await store.save(unfinished()); const before = raw(data);
  data.failWrite = true; await assert.rejects(store.clear(saved.revision), { code: 'remove_failed' });
  assert.equal(raw(data), before); assert.equal(store.current.revision, saved.revision); assertUnrelated(data);
  data.failWrite = false; assert.equal(await store.clear(saved.revision), true); assert.equal(raw(data), null); assertUnrelated(data);
  assert.equal(await store.clear(), false);
});

test('failed storage-event read blocks later writes while keeping the last recovery snapshot', async () => {
  const data = createStorage(), store = open(data); await store.save(unfinished()); const before = raw(data);
  data.failRead = true; assert.equal(store.checkForChange(), true); assert.equal(store.blocked, true);
  data.failRead = false; await assert.rejects(store.save(unfinished()), { code: 'storage_changed' }); assert.equal(raw(data), before);
});

test('lock-manager failures preserve storage and surface a draft failure', async () => {
  const data = createStorage(); unrelated(data);
  const store = open(data, { locks: { request: async () => { throw new Error('Lock manager unavailable'); } } });
  await assert.rejects(store.save(unfinished()), { code: 'save_failed' }); assert.equal(raw(data), null); assertUnrelated(data);
});
