import { QUIZ_LIMITS, normalizeQuiz } from './quiz-document.mjs';

export const QUIZ_DRAFT_KEY = 'likerts.quiz.draft.v1';
export const MAX_DRAFT_BYTES = 133_120;
const FORMAT = 'likerts.quiz.draft';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TIMES = new Set([0, 10, 20, 30, 60, 120]);
const bytes = text => new TextEncoder().encode(text).length;
const clone = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function keys(value, expected) {
  if (!plain(value) || Object.keys(value).sort().join(',') !== expected.slice().sort().join(',')) throw new Error('Unsupported draft fields');
}
function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid draft identifier');
  return value.toLowerCase();
}
function array(value, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum
    || Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index))) throw new Error('Invalid draft array');
  return value;
}
function text(value, maximum) {
  // Keep unfinished text exactly as typed, including spaces and empty answers.
  if (typeof value !== 'string' || value.length > maximum * 2) throw new Error('Invalid draft text');
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) throw new Error('Invalid draft Unicode');
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) throw new Error('Invalid draft Unicode');
  }
  return value;
}

/** Bounded editor data, not a portable or hostable quiz document. */
export function normalizeQuizDraft(value) {
  keys(value, ['format', 'version', 'id', 'title', 'questions']);
  if (value.format !== 'likerts.quiz' || value.version !== 1) throw new Error('Unsupported draft');
  const quizID = id(value.id), used = new Set([quizID]);
  const questions = array(value.questions, 1, QUIZ_LIMITS.questions).map(question => {
    keys(question, ['id', 'prompt', 'answers', 'correctAnswer', 'explanation', 'timeLimitSeconds']);
    const questionID = id(question.id);
    if (used.has(questionID)) throw new Error('Duplicated draft identifier');
    used.add(questionID);
    array(question.answers, 2, 4);
    if (!Number.isSafeInteger(question.correctAnswer) || question.correctAnswer < -1 || question.correctAnswer >= question.answers.length
      || !TIMES.has(question.timeLimitSeconds)) throw new Error('Invalid draft question');
    return { id: questionID, prompt: text(question.prompt, QUIZ_LIMITS.prompt),
      answers: question.answers.map(answer => text(answer, QUIZ_LIMITS.answer)), correctAnswer: question.correctAnswer,
      explanation: text(question.explanation, QUIZ_LIMITS.explanation), timeLimitSeconds: question.timeLimitSeconds };
  });
  const result = { format: 'likerts.quiz', version: 1, id: quizID, title: text(value.title, QUIZ_LIMITS.title), questions };
  if (bytes(JSON.stringify(result)) > QUIZ_LIMITS.bytes) throw new Error('Draft is too large');
  return result;
}

function payload(value) {
  keys(value, ['draftID', 'quiz', 'sourceQuiz', 'questionIndex']);
  const quiz = normalizeQuizDraft(value.quiz), sourceQuiz = value.sourceQuiz === null ? null : normalizeQuiz(normalizeQuizDraft(value.sourceQuiz));
  if (sourceQuiz && sourceQuiz.id !== quiz.id) throw new Error('Draft source does not match');
  if (!Number.isSafeInteger(value.questionIndex) || value.questionIndex < 0 || value.questionIndex >= quiz.questions.length) throw new Error('Invalid draft position');
  return { draftID: id(value.draftID), quiz, sourceQuiz, questionIndex: value.questionIndex };
}
function record(value) {
  keys(value, ['format', 'version', 'revision', 'draftID', 'quiz', 'sourceQuiz', 'questionIndex']);
  if (value.format !== FORMAT || value.version !== 1) throw new Error('Unsupported draft version');
  return { format: FORMAT, version: 1, revision: id(value.revision),
    ...payload({ draftID: value.draftID, quiz: value.quiz, sourceQuiz: value.sourceQuiz, questionIndex: value.questionIndex }) };
}

export class QuizDraftError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause }); this.name = 'QuizDraftError'; this.code = code;
  }
}
const changed = () => new QuizDraftError('storage_changed', 'The unfinished quiz changed in another tab. This tab’s edits have not replaced it.');

/** One origin-local recovery slot. It never reads or writes the saved-quiz key. */
export class QuizDraftStore {
  constructor({ storage = null, locks = null, key = QUIZ_DRAFT_KEY, makeRevision = () => crypto.randomUUID() } = {}) {
    this.storage = storage; this.locks = locks; this.key = key; this.makeRevision = makeRevision;
    this._raw = undefined; this._record = null; this.blocked = true; this.lastError = null;
    this.reload();
  }
  get current() { return this._record && clone(this._record); }
  get snapshotToken() { return this._raw; }
  get hasStoredValue() { return this._raw !== null && this._raw !== undefined; }
  get writeSupported() { return !!this.storage && typeof this.storage.getItem === 'function'
    && typeof this.storage.setItem === 'function' && typeof this.storage.removeItem === 'function' && typeof this.locks?.request === 'function'; }
  get canWrite() { return this.writeSupported && !this.blocked; }

  reload() {
    this._record = null;
    try {
      if (!this.storage || typeof this.storage.getItem !== 'function') throw new Error('No storage');
      this._raw = this.storage.getItem(this.key);
      if (this._raw !== null) {
        if (typeof this._raw !== 'string' || bytes(this._raw) > MAX_DRAFT_BYTES) throw new Error('Invalid draft size');
        this._record = record(JSON.parse(this._raw));
      }
      this.blocked = false;
      this.lastError = this.writeSupported ? null : new QuizDraftError('locking_unavailable', 'This browser cannot keep unfinished quiz changes safely. Keep this tab open until you save or export.');
      return true;
    } catch (cause) {
      this.blocked = true;
      this.lastError = new QuizDraftError('load_failed', 'The unfinished quiz could not be read. It has not been replaced or removed.', cause);
      return false;
    }
  }
  checkForChange() {
    try {
      if (this.storage?.getItem(this.key) === this._raw) return false;
    } catch { /* A read failure must not turn into an overwrite. */ }
    this.blocked = true; this.lastError = changed(); return true;
  }
  async mutate(action, { discard = false } = {}) {
    if (!this.writeSupported || (!discard && this.blocked)) throw this.lastError || new QuizDraftError('storage_unavailable', 'This browser cannot keep the unfinished quiz. Keep this tab open.');
    try {
      return await this.locks.request('likerts.quiz.draft.write:' + this.key, { mode: 'exclusive' }, () => {
        let raw;
        try { raw = this.storage.getItem(this.key); }
        catch (cause) { throw new QuizDraftError('read_failed', 'The unfinished quiz could not be checked. Your previous draft is unchanged.', cause); }
        if (this._raw === undefined || raw !== this._raw) { this.blocked = true; this.lastError = changed(); throw this.lastError; }
        return action();
      });
    } catch (cause) {
      this.lastError = cause instanceof QuizDraftError ? cause : new QuizDraftError('save_failed', 'This browser could not keep the unfinished quiz. Keep this tab open until you save or export.', cause);
      throw this.lastError;
    }
  }
  async save(value) {
    let next;
    try { next = payload(value); }
    catch (cause) { throw new QuizDraftError('invalid_draft', 'This unfinished quiz is too large or contains an unsupported value. Keep this tab open and shorten or correct it before leaving.', cause); }
    return this.mutate(() => {
      if (this._record && this._record.draftID !== next.draftID) throw new QuizDraftError('draft_exists', 'Continue or discard the existing unfinished quiz before starting another.');
      const revision = id(this.makeRevision());
      if (revision === this._record?.revision) throw new QuizDraftError('revision_failed', 'This browser could not update the unfinished quiz. Keep this tab open and try again.');
      const saved = { format: FORMAT, version: 1, revision, ...next };
      const raw = JSON.stringify(saved);
      if (bytes(raw) > MAX_DRAFT_BYTES) throw new QuizDraftError('invalid_draft', 'This unfinished quiz is too large to keep on this browser.');
      try { this.storage.setItem(this.key, raw); }
      catch (cause) { throw new QuizDraftError('save_failed', 'This browser could not keep the unfinished quiz. Keep this tab open until you save or export.', cause); }
      this._raw = raw; this._record = saved; this.lastError = null; return clone(saved);
    });
  }
  /** Explicit discard, or cleanup after save: always compare the exact loaded revision. */
  async clear(revision = this._record?.revision ?? null, snapshotToken = this._raw) {
    return this.mutate(() => {
      if (snapshotToken !== this._raw) throw changed();
      if (this._record && this._record.revision !== revision) throw changed();
      if (this._raw === null) return false;
      try { this.storage.removeItem(this.key); }
      catch (cause) { throw new QuizDraftError('remove_failed', 'The unfinished quiz could not be removed. It is still kept on this browser.', cause); }
      this._raw = null; this._record = null; this.blocked = false; this.lastError = null; return true;
    }, { discard: true });
  }
}
