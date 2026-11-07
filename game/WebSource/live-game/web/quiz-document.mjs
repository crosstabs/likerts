/** Portable creator content. A quiz file contains its answer key, never a player invite. */
export const QUIZ_LIMITS = Object.freeze({ bytes: 65_536, title: 80, questions: 30, answers: 4, prompt: 240, answer: 100, explanation: 240, library: 25 });
const ROOT_KEYS = ['format', 'version', 'id', 'title', 'questions'];
const QUESTION_KEYS = ['id', 'prompt', 'answers', 'correctAnswer', 'explanation', 'timeLimitSeconds'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TIMES = new Set([0, 10, 20, 30, 60, 120]);
const bytes = value => new TextEncoder().encode(value).byteLength;
const scalarCount = value => [...value].length;
const trim = value => value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export class QuizValidationError extends Error {
  constructor(code, path, message) { super(message); this.name = 'QuizValidationError'; this.code = code; this.path = path; }
}
const fail = (code, path, message) => { throw new QuizValidationError(code, path, message); };
const type = (condition, path) => { if (!condition) fail('invalid_type', path, 'This quiz contains an unsupported value.'); };

function keys(value, expected, path) {
  type(object(value), path);
  if (Object.keys(value).some(key => !expected.includes(key))) fail('unknown_field', path, 'This quiz contains unsupported fields.');
  type(expected.every(key => Object.hasOwn(value, key)), path);
}
function identifier(value, path) {
  type(typeof value === 'string', path);
  if (value.length !== 36 || !UUID.test(value)) fail('invalid_uuid', path, 'This quiz contains an invalid identifier.');
  return value.toLowerCase();
}
function wellFormed(value) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) return false;
  }
  return true;
}
function text(value, { path, minimum, maximum, multiline = false, code, message }) {
  type(typeof value === 'string', path);
  if (!wellFormed(value)) fail(code, path, message);
  const normalized = trim(value.normalize('NFC'));
  const controls = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u : /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;
  if (scalarCount(normalized) < minimum || scalarCount(normalized) > maximum || controls.test(normalized)) fail(code, path, message);
  return normalized;
}
const sortedJSON = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

/** Validate and return a detached normalized document; incomplete editor drafts fail. */
export function normalizeQuiz(value) {
  keys(value, ROOT_KEYS, 'quiz');
  type(typeof value.format === 'string', 'format');
  if (value.format !== 'likerts.quiz') fail('unsupported_format', 'format', 'Choose a Likerts quiz file.');
  type(Number.isSafeInteger(value.version), 'version');
  if (value.version !== 1) fail('unsupported_version', 'version', 'This quiz needs a newer version of Likerts.');
  const id = identifier(value.id, 'id');
  const title = text(value.title, { path: 'title', minimum: 1, maximum: QUIZ_LIMITS.title, code: 'empty_title', message: 'Give your quiz a title of 1–80 characters.' });
  type(Array.isArray(value.questions), 'questions');
  if (value.questions.length < 1 || value.questions.length > QUIZ_LIMITS.questions) fail('question_count', 'questions', 'A quiz needs 1–30 questions.');
  const ids = new Set([id]);
  const questions = value.questions.map((question, index) => {
    const path = `questions[${index}]`, label = `Question ${index + 1}`;
    keys(question, QUESTION_KEYS, path);
    const questionID = identifier(question.id, `${path}.id`);
    if (ids.has(questionID)) fail('duplicate_id', `${path}.id`, 'Every quiz and question needs its own identifier.');
    ids.add(questionID);
    const prompt = text(question.prompt, { path: `${path}.prompt`, minimum: 1, maximum: QUIZ_LIMITS.prompt, multiline: true, code: 'invalid_prompt', message: `${label}: write a question of 1–240 characters.` });
    type(Array.isArray(question.answers), `${path}.answers`);
    if (question.answers.length < 2 || question.answers.length > QUIZ_LIMITS.answers) fail('answer_count', `${path}.answers`, `${label}: add 2–4 answers.`);
    const answers = question.answers.map((answer, answerIndex) => text(answer, { path: `${path}.answers[${answerIndex}]`, minimum: 1, maximum: QUIZ_LIMITS.answer, code: 'invalid_answer', message: `${label}: each answer needs 1–100 characters on one line.` }));
    if (new Set(answers).size !== answers.length) fail('duplicate_answer', `${path}.answers`, `${label}: make each answer different.`);
    type(Number.isSafeInteger(question.correctAnswer), `${path}.correctAnswer`);
    if (question.correctAnswer < 0 || question.correctAnswer >= answers.length) fail('answer_required', `${path}.correctAnswer`, `${label}: choose the correct answer.`);
    const explanation = text(question.explanation, { path: `${path}.explanation`, minimum: 0, maximum: QUIZ_LIMITS.explanation, multiline: true, code: 'invalid_explanation', message: `${label}: keep the explanation within 240 characters.` });
    type(Number.isSafeInteger(question.timeLimitSeconds), `${path}.timeLimitSeconds`);
    if (!TIMES.has(question.timeLimitSeconds)) fail('invalid_time_limit', `${path}.timeLimitSeconds`, `${label}: choose a supported time limit.`);
    return { id: questionID, prompt, answers, correctAnswer: question.correctAnswer, explanation, timeLimitSeconds: question.timeLimitSeconds };
  });
  const result = { format: 'likerts.quiz', version: 1, id, title, questions };
  if (bytes(sortedJSON(result)) > QUIZ_LIMITS.bytes) fail('too_large', 'quiz', 'Choose a quiz file no larger than 64 KB.');
  return result;
}

export function parseQuiz(source) {
  type(typeof source === 'string', 'quiz');
  if (bytes(source) > QUIZ_LIMITS.bytes) fail('too_large', 'quiz', 'Choose a quiz file no larger than 64 KB.');
  if (!wellFormed(source)) fail('invalid_json', 'quiz', 'This quiz file could not be read.');
  let value;
  try { value = JSON.parse(source); } catch { fail('invalid_json', 'quiz', 'This quiz file could not be read.'); }
  return normalizeQuiz(value);
}

/** Compact sorted JSON keeps the same 64 KB boundary on disk and in exports. */
export const encodeQuiz = value => sortedJSON(normalizeQuiz(value));
export const makeQuestion = () => ({ id: crypto.randomUUID(), prompt: '', answers: ['', '', '', ''], correctAnswer: -1, explanation: '', timeLimitSeconds: 20 });
export const makeQuiz = () => ({ format: 'likerts.quiz', version: 1, id: crypto.randomUUID(), title: '', questions: [makeQuestion()] });
export function duplicateQuiz(value) {
  const quiz = normalizeQuiz(value);
  quiz.id = crypto.randomUUID();
  for (const question of quiz.questions) question.id = crypto.randomUUID();
  return normalizeQuiz(quiz);
}

function freeze(value) {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
}

// This literal is checked against SharedFixtures/sample-quiz.json by the core tests.
const SAMPLE = {
  format: 'likerts.quiz', version: 1, id: '84273658-3fa8-43f4-82bd-6f026933b8e7', title: 'Little wonders',
  questions: [
    { id: '42ab0856-2934-45cc-a720-7421756c873b', prompt: 'Which planet is known as the Red Planet?', answers: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correctAnswer: 1, explanation: 'Iron-rich dust gives Mars its reddish appearance.', timeLimitSeconds: 20 },
    { id: '71e627b1-95dd-493e-83fb-10ff3b5a32b5', prompt: 'How many sides does a triangle have?', answers: ['Two', 'Three', 'Four', 'Five'], correctAnswer: 1, explanation: 'A triangle has three straight sides.', timeLimitSeconds: 20 },
    { id: '9da982b8-39a2-43ef-a57d-1c69c686e6ce', prompt: 'Which ocean is the largest?', answers: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], correctAnswer: 2, explanation: 'The Pacific is the largest ocean on Earth.', timeLimitSeconds: 30 },
  ],
};
export const sampleQuiz = freeze(normalizeQuiz(SAMPLE));
export const sampleQuizDocument = () => structuredClone(sampleQuiz);
