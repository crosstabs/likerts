import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUIZ_LIMITS, QuizValidationError, normalizeQuiz, parseQuiz, encodeQuiz, makeQuiz, makeQuestion, duplicateQuiz, sampleQuiz, sampleQuizDocument } from '../web/quiz-document.mjs';

const fixtures = JSON.parse(await readFile(new URL('../../../SharedFixtures/quiz-validation-fixtures.json', import.meta.url), 'utf8'));
const sharedSample = JSON.parse(await readFile(new URL('../../../SharedFixtures/sample-quiz.json', import.meta.url), 'utf8'));
const rejects = (operation, code) => assert.throws(operation, error => error instanceof QuizValidationError && error.code === code);

for (const fixture of fixtures.cases) {
  test(`shared quiz document: ${fixture.name}`, () => {
    const source = JSON.stringify(fixture.document);
    if (fixture.valid) {
      const normalized = parseQuiz(source);
      assert.deepEqual(parseQuiz(encodeQuiz(normalized)), normalized);
    } else rejects(() => parseQuiz(source), fixture.code);
  });
}

test('sample creator content matches the shared three-question fixture', () => {
  assert.deepEqual(sampleQuizDocument(), sharedSample);
  assert.equal(sampleQuiz.questions.length, 3);
  assert.deepEqual(sampleQuiz.questions.map(question => question.correctAnswer), [1, 1, 2]);
});

test('normalization detaches data, preserves intended text and canonicalizes identifiers', () => {
  const input = structuredClone(fixtures.cases.find(fixture => fixture.name.startsWith('normalizes')).document);
  const result = normalizeQuiz(input);
  assert.equal(result.title, 'Café');
  assert.equal(result.id, result.id.toLowerCase());
  assert.equal(result.questions[0].prompt, 'Mars?');
  assert.equal(result.questions[0].explanation, 'First line\nSecond line');
  input.questions[0].answers[0] = 'Changed after validation';
  assert.equal(result.questions[0].answers[0], 'A');
});

test('incomplete drafts cannot be saved, exported or played as valid quiz documents', () => {
  const draft = makeQuiz();
  assert.equal(draft.title, '');
  assert.equal(draft.questions[0].correctAnswer, -1);
  assert.equal(makeQuestion().answers.length, 4);
  rejects(() => encodeQuiz(draft), 'empty_title');
  draft.title = 'A title';
  draft.questions[0].prompt = 'A question';
  draft.questions[0].answers = ['One', 'Two'];
  rejects(() => normalizeQuiz(draft), 'answer_required');
});

test('import-as-copy changes all identifiers without changing creator content', () => {
  const original = sampleQuizDocument();
  const copy = duplicateQuiz(original);
  assert.notEqual(copy.id, original.id);
  assert.notDeepEqual(copy.questions.map(question => question.id), original.questions.map(question => question.id));
  assert.equal(new Set([copy.id, ...copy.questions.map(question => question.id)]).size, 4);
  assert.deepEqual(copy.questions.map(({ id, ...content }) => content), original.questions.map(({ id, ...content }) => content));
  assert.deepEqual(original, sharedSample);
});

test('file-size checks use UTF-8 bytes and reject oversize before parsing', () => {
  const encoded = encodeQuiz(sampleQuiz);
  const padding = QUIZ_LIMITS.bytes - Buffer.byteLength(encoded);
  assert.deepEqual(parseQuiz(encoded + ' '.repeat(padding)), sampleQuiz);
  rejects(() => parseQuiz(encoded + ' '.repeat(padding + 1)), 'too_large');
  rejects(() => parseQuiz('🚀'.repeat(16_385)), 'too_large');
});

test('encoded document boundary includes all normalized fields, not just individual text limits', () => {
  const document = sampleQuizDocument();
  document.questions = Array.from({ length: 30 }, () => ({ ...makeQuestion(), prompt: '🚀'.repeat(240), answers: ['A'.repeat(100), 'B'.repeat(100), 'C'.repeat(100), 'D'.repeat(100)], correctAnswer: 0, explanation: '🚀'.repeat(240) }));
  rejects(() => normalizeQuiz(document), 'too_large');
});

test('limits count Unicode scalars instead of UTF-16 code units', () => {
  const document = sampleQuizDocument();
  document.title = '🚀'.repeat(80);
  assert.equal([...normalizeQuiz(document).title].length, 80);
  document.title += '🚀';
  rejects(() => normalizeQuiz(document), 'empty_title');
});

test('malformed JSON, unsupported format and malformed Unicode are rejected', () => {
  rejects(() => parseQuiz('{"format":'), 'invalid_json');
  rejects(() => parseQuiz('\uD800'), 'invalid_json');
  const document = sampleQuizDocument(); document.format = 'something.else';
  rejects(() => normalizeQuiz(document), 'unsupported_format');
  document.format = 'likerts.quiz'; document.questions[0].answers[0] = '\uD800';
  rejects(() => normalizeQuiz(document), 'invalid_answer');
});

test('unsupported or missing schema fields cannot enter through ordinary JSON parsing', () => {
  const document = sampleQuizDocument(); delete document.questions[0].explanation;
  rejects(() => parseQuiz(JSON.stringify(document)), 'invalid_type');
  const polluted = JSON.parse(encodeQuiz(sampleQuiz).replace('"format":', '"__proto__":{"polluted":true},"format":'));
  rejects(() => normalizeQuiz(polluted), 'unknown_field');
  assert.equal({}.polluted, undefined);
});

test('question and answer cardinalities are enforced and exported documents round-trip', () => {
  const document = sampleQuizDocument();
  document.questions = Array.from({ length: 30 }, () => ({ ...makeQuestion(), prompt: 'Choose one.', answers: ['First', 'Second'], correctAnswer: 0 }));
  assert.equal(parseQuiz(encodeQuiz(document)).questions.length, 30);
  document.questions.push({ ...makeQuestion(), prompt: 'One too many', answers: ['First', 'Second'], correctAnswer: 0 });
  rejects(() => normalizeQuiz(document), 'question_count');
});
