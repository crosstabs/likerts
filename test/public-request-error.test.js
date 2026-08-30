import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPublicRequestError,
  responseErrorCode,
  thrownErrorCode,
} from '../src/lib/publicRequestError.js';

test('prefers structured public response codes and accepts code-shaped legacy errors', () => {
  assert.equal(responseErrorCode({ issue: { code: 'INVALID_LOCALE' }, code: 'SECOND' }, 400), 'INVALID_LOCALE');
  assert.equal(responseErrorCode({ code: 'RATE_LIMITED' }, 429), 'RATE_LIMITED');
  assert.equal(responseErrorCode({ error: 'QA_INTERCEPT' }, 422), 'QA_INTERCEPT');
});

test('never exposes prose returned by a backend', () => {
  assert.equal(responseErrorCode({ error: 'The pipeline failed for an internal reason.' }, 503), 'HTTP_503');
  assert.equal(responseErrorCode({ error: '<script>alert(1)</script>' }, 400), 'HTTP_400');
  assert.equal(responseErrorCode({}, undefined), 'REQUEST_FAILED');
});

test('creates errors carrying only a safe public code', () => {
  const error = createPublicRequestError({ code: 'VALIDATION_ERROR', error: 'English backend prose' }, 400);
  assert.equal(error.name, 'PublicRequestError');
  assert.equal(error.message, 'VALIDATION_ERROR');
  assert.equal(error.publicCode, 'VALIDATION_ERROR');
});

test('maps thrown failures to safe technical references', () => {
  assert.equal(thrownErrorCode(Object.assign(new Error('private detail'), { publicCode: 'LOCALIZATION_ERROR' })), 'LOCALIZATION_ERROR');
  assert.equal(thrownErrorCode(new TypeError('Failed to fetch')), 'NETWORK_ERROR');
  assert.equal(thrownErrorCode(new Error('private detail'), 'LOCAL_PROJECT_ERROR'), 'LOCAL_PROJECT_ERROR');
  assert.equal(thrownErrorCode(new Error('private detail'), 'not safe'), 'REQUEST_FAILED');
});
