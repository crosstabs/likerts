import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('./', import.meta.url);
const survey = JSON.parse(readFileSync(new URL('advanced-survey.example.json', root)));
const response = JSON.parse(readFileSync(new URL('advanced-response.example.json', root)));
const cases = JSON.parse(readFileSync(new URL('advanced-question-cases.json', root)));
assert.deepEqual(survey.questions.map(question => question.type), ['ranking', 'matrix', 'constant_sum']);

const [ranking, matrix, sum] = survey.questions;
assert.deepEqual(new Set(response.answers[ranking.id]), new Set(ranking.options.map(option => option.id)));
assert.equal(Object.keys(response.answers[matrix.id]).length, matrix.rows.length);
assert.ok(Object.values(response.answers[matrix.id]).every(value => matrix.columns.some(column => column.id === value)));
assert.deepEqual(new Set(Object.keys(response.answers[sum.id])), new Set(sum.items.map(item => item.id)));
assert.equal(Object.values(response.answers[sum.id]).reduce((total, value) => total + value, 0), sum.total);
assert.equal(Object.keys(cases).length, 4);
console.log('advanced question fixtures: ok');
