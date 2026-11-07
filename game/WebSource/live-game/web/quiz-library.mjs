import { duplicateQuiz, normalizeQuiz, parseQuiz } from './quiz-document.mjs';

export const QUIZ_LIBRARY_KEY = 'likerts.quiz.library.v1';
export const MAX_SAVED_QUIZZES = 25;
const MAX_LIBRARY_BYTES = MAX_SAVED_QUIZZES * 65_536 + 1024;
const FORMAT = 'likerts.quiz.library';
const copy = value => structuredClone(value);
const bytes = text => new TextEncoder().encode(text).length;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class QuizLibraryError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'QuizLibraryError';
    this.code = code;
  }
}

/** Local creator content only. This store never accesses a room or network. */
export class QuizLibrary {
  constructor({ storage = null, locks = null, key = QUIZ_LIBRARY_KEY, makeCopy = duplicateQuiz } = {}) {
    this.storage = storage;
    this.locks = locks;
    this.key = key;
    this.makeCopy = makeCopy;
    this._quizzes = [];
    this._loadedRaw = undefined;
    this.blocked = true;
    this.lastError = null;
    this.reload();
  }

  get quizzes() { return copy(this._quizzes); }
  get writeSupported() { return !!this.storage && typeof this.storage.setItem === 'function' && typeof this.storage.removeItem === 'function' && typeof this.locks?.request === 'function'; }
  get canWrite() { return !this.blocked && this.writeSupported; }

  reload() {
    try {
      if (!this.storage || typeof this.storage.getItem !== 'function' || typeof this.storage.setItem !== 'function') {
        throw new QuizLibraryError('storage_unavailable', 'This browser cannot save quizzes. You can still practice the sample.');
      }
      const raw = this.storage.getItem(this.key);
      this._loadedRaw = raw;
      let quizzes = [];
      if (raw !== null) {
        if (typeof raw !== 'string' || bytes(raw) > MAX_LIBRARY_BYTES) throw new Error('Invalid library size');
        const envelope = JSON.parse(raw);
        if (!object(envelope) || Object.keys(envelope).sort().join(',') !== 'format,quizzes,version'
          || envelope.format !== FORMAT || envelope.version !== 1 || !Array.isArray(envelope.quizzes)
          || envelope.quizzes.length > MAX_SAVED_QUIZZES) throw new Error('Unsupported saved library');
        quizzes = envelope.quizzes.map(normalizeQuiz);
        if (new Set(quizzes.map(quiz => quiz.id)).size !== quizzes.length) throw new Error('Duplicated saved quiz');
      }
      this._quizzes = quizzes;
      this.blocked = false;
      this.lastError = this.writeSupported ? null : new QuizLibraryError('locking_unavailable',
        'Saving is not available in this browser. You can still edit, export and practice quiz files.');
      return true;
    } catch (cause) {
      this.blocked = true;
      this.lastError = cause instanceof QuizLibraryError ? cause : new QuizLibraryError('load_failed',
        'Saved quizzes could not be read. Try again, or reset this browser’s quiz library after reviewing that choice.', cause);
      return false;
    }
  }

  async save(value) {
    const quiz = normalizeQuiz(value);
    return this.mutate(() => {
      const next = this.quizzes;
      const index = next.findIndex(item => item.id === quiz.id);
      if (index === -1) {
        if (next.length >= MAX_SAVED_QUIZZES) {
          throw new QuizLibraryError('library_full', 'This browser has 25 saved quizzes. Delete one before saving another.');
        }
        next.unshift(quiz);
      } else next[index] = quiz;
      this.commit(next);
      return copy(quiz);
    });
  }

  async importQuiz(text) {
    return this.save(this.freshCopy(parseQuiz(text)));
  }

  async duplicate(value) {
    const quiz = normalizeQuiz(value);
    return this.save(this.freshCopy(quiz));
  }

  async remove(id) {
    return this.mutate(() => {
      const next = this._quizzes.filter(quiz => quiz.id !== id);
      if (next.length === this._quizzes.length) return false;
      this.commit(next);
      return true;
    });
  }

  /** Caller must obtain explicit confirmation before removing this key. */
  async reset() {
    return this.mutate(() => {
      try { this.storage.removeItem(this.key); }
      catch (cause) {
        this.lastError = new QuizLibraryError('reset_failed', 'The quiz library could not be reset. Its saved data has not been replaced.', cause);
        throw this.lastError;
      }
      this._quizzes = []; this._loadedRaw = null; this.lastError = null; this.blocked = false;
      return true;
    }, { reset: true });
  }

  requireWritable() {
    if (this.blocked) throw this.lastError || new QuizLibraryError('load_failed', 'Read the saved quiz library before changing it.');
    if (!this.writeSupported) throw this.lastError || new QuizLibraryError('locking_unavailable', 'Saving is not available in this browser. You can still edit, export and practice quiz files.');
  }

  /** All cooperating Likerts tabs serialize their read/compare/write through this origin-wide lock. */
  async mutate(action, { reset = false } = {}) {
    if (reset) {
      if (!this.writeSupported) throw this.lastError || new QuizLibraryError('locking_unavailable', 'Saving is not available in this browser.');
    } else this.requireWritable();
    try {
      return await this.locks.request('likerts.quiz.write:' + this.key, { mode: 'exclusive' }, () => {
        if (!reset) this.requireWritable();
        let raw;
        try { raw = this.storage.getItem(this.key); }
        catch (cause) {
          this.blocked = true;
          this.lastError = new QuizLibraryError('load_failed', 'Saved quizzes could not be checked before saving. Reload the library and keep your edits as a new copy.', cause);
          throw this.lastError;
        }
        if (this._loadedRaw === undefined || raw !== this._loadedRaw) {
          this.blocked = true;
          this.lastError = new QuizLibraryError('storage_changed', 'Saved quizzes changed in another tab. Reload the library and keep your edits as a new copy.');
          throw this.lastError;
        }
        return action();
      });
    } catch (cause) {
      if (cause instanceof QuizLibraryError) throw cause;
      this.lastError = new QuizLibraryError('save_failed', 'The quiz library could not be updated on this browser. Try again.', cause);
      throw this.lastError;
    }
  }

  freshCopy(value) {
    const quiz = normalizeQuiz(value);
    const used = new Set([quiz.id, ...quiz.questions.map(question => question.id),
      ...this._quizzes.flatMap(item => [item.id, ...item.questions.map(question => question.id)])]);
    for (let attempt = 0; attempt < 64; attempt++) {
      let candidate;
      try { candidate = normalizeQuiz(this.makeCopy(quiz)); }
      catch (cause) { throw new QuizLibraryError('copy_failed', 'A new quiz copy could not be prepared. Try again.', cause); }
      if ([candidate.id, ...candidate.questions.map(question => question.id)].every(id => !used.has(id))) return candidate;
    }
    throw new QuizLibraryError('copy_failed', 'A new quiz copy could not be prepared. Try again.');
  }

  commit(quizzes) {
    const text = JSON.stringify({ format: FORMAT, version: 1, quizzes });
    if (bytes(text) > MAX_LIBRARY_BYTES) throw new QuizLibraryError('library_full', 'This browser’s quiz library is full. Delete a quiz before saving another.');
    try { this.storage.setItem(this.key, text); }
    catch (cause) {
      this.lastError = new QuizLibraryError('save_failed', 'The quiz library could not be updated on this browser. Your previous saved quizzes are unchanged. Try again.', cause);
      throw this.lastError;
    }
    this._quizzes = copy(quizzes);
    this._loadedRaw = text;
    this.lastError = null;
  }
}
