import { normalizeQuiz } from './quiz-document.mjs';

const validTime = now => typeof now === 'number' && Number.isFinite(now);
const freeze = value => {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
};

/** Local practice only. Live quiz authority and answer-key-safe projections are separate work. */
export class QuizRun {
  #quiz; #index = 0; #phase = 'answer'; #selectedAnswer = null; #results = Object.freeze([]); #deadline = null;
  constructor(quiz, { now = Date.now() } = {}) {
    if (!validTime(now)) throw new RangeError('Use a finite clock value.');
    this.#quiz = freeze(normalizeQuiz(quiz));
    this.#startDeadline(now);
  }
  get quiz() { return this.#quiz; }
  get index() { return this.#index; }
  get phase() { return this.#phase; }
  get currentQuestion() { return this.#phase === 'finished' ? null : this.#quiz.questions[this.#index]; }
  get selectedAnswer() { return this.#selectedAnswer; }
  get results() { return this.#results; }
  get score() { return this.#results.reduce((total, result) => total + result.points, 0); }
  get correctCount() { return this.#results.filter(result => result.correct).length; }
  get missedQuestionIDs() {
    if (this.#phase !== 'finished') return Object.freeze([]);
    const missed = new Set(this.#results.filter(result => !result.correct).map(result => result.questionID));
    return Object.freeze(this.#quiz.questions.filter(question => missed.has(question.id)).map(question => question.id));
  }
  retryMissed({ now = Date.now() } = {}) {
    const missed = new Set(this.missedQuestionIDs);
    if (!missed.size) return null;
    return new QuizRun({ ...this.#quiz, questions: this.#quiz.questions.filter(question => missed.has(question.id)) }, { now });
  }
  get deadline() { return this.#deadline; }
  remainingSeconds(now = Date.now()) {
    if (!validTime(now) || this.#deadline === null || this.#phase !== 'answer') return null;
    return Math.max(0, Math.ceil((this.#deadline - now) / 1000));
  }
  #startDeadline(now) {
    const seconds = this.currentQuestion.timeLimitSeconds;
    this.#deadline = seconds === 0 ? null : now + seconds * 1000;
  }
  #reveal(answer, timedOut) {
    const question = this.currentQuestion;
    const correct = !timedOut && answer === question.correctAnswer;
    this.#results = Object.freeze([...this.#results, Object.freeze({ questionID: question.id, answer, correct, points: correct ? 1000 : 0, timedOut })]);
    this.#selectedAnswer = answer;
    this.#deadline = null;
    this.#phase = 'reveal';
  }
  advance(now = Date.now()) {
    if (!validTime(now) || this.#phase !== 'answer' || this.#deadline === null || now < this.#deadline) return false;
    this.#reveal(null, true);
    return true;
  }
  submit(answer, now = Date.now()) {
    if (!validTime(now)) return false;
    if (this.advance(now) || this.#phase !== 'answer') return false;
    if (!Number.isSafeInteger(answer) || answer < 0 || answer >= this.currentQuestion.answers.length) return false;
    this.#reveal(answer, false);
    return true;
  }
  next(now = Date.now()) {
    if (!validTime(now) || this.#phase !== 'reveal') return false;
    this.#selectedAnswer = null;
    if (this.#index + 1 === this.#quiz.questions.length) {
      this.#phase = 'finished'; this.#deadline = null;
    } else {
      this.#index++; this.#phase = 'answer'; this.#startDeadline(now);
    }
    return true;
  }
}
