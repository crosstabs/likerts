import assert from 'node:assert/strict';
import test from 'node:test';

import { createFeedbackApiHandler, MAX_FEEDBACK_BODY_BYTES } from '../api/feedback.js';
import { PRODUCT_FEEDBACK_VERSION } from '../shared/product-feedback.mjs';

function request(extra = {}) {
  return {
    method: 'POST',
    url: '/api/feedback',
    headers: {
      host: 'likerts.example',
      'content-type': 'application/json',
      'x-correlation-id': 'feedback_12345678',
    },
    body: {
      schemaVersion: PRODUCT_FEEDBACK_VERSION,
      category: 'CONFUSING',
      message: 'The evidence controls were hard to find.',
      interfaceLocale: 'en-US',
      pagePath: '/',
    },
    async *[Symbol.asyncIterator]() {},
    ...extra,
  };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    headers,
    body: '',
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { this.body += String(value); return this; },
  };
}

function logger(events) {
  const record = (line) => events.push(JSON.parse(line));
  return { info: record, warn: record, error: record };
}

test('accepts explicit feedback and records its bounded context', async () => {
  const events = [];
  const handler = createFeedbackApiHandler({
    env: { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abc123' },
    logger: logger(events),
    requestLimiter: { check: () => ({ allowed: true }) },
  });
  const res = response();
  await handler(request(), res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.headers.get('x-correlation-id'), 'feedback_12345678');
  const event = events.find((item) => item.event === 'feedback_received');
  assert.equal(event.runtime.release, 'abc123');
  assert.deepEqual(event.attributes, {
    category: 'CONFUSING',
    interfaceLocale: 'en-US',
    pagePath: '/',
    feedbackText: 'The evidence controls were hard to find.',
  });
  assert.equal(events.filter((item) => item.event === 'request_finished').length, 1);
});

test('rejects malformed, cross-origin, oversized, and rate-limited feedback', async () => {
  const events = [];
  const handler = createFeedbackApiHandler({
    logger: logger(events),
    requestLimiter: { check: () => ({ allowed: false, retryAfterSeconds: 60 }) },
  });

  const malformed = response();
  await handler(request({ body: { ...request().body, pagePath: '/?prompt=private' } }), malformed);
  assert.equal(malformed.statusCode, 400);

  const crossOrigin = response();
  await handler(request({ headers: { host: 'likerts.example', origin: 'https://evil.example', 'content-type': 'application/json' } }), crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);

  const oversized = response();
  await handler(request({ body: 'x'.repeat(MAX_FEEDBACK_BODY_BYTES + 1) }), oversized);
  assert.equal(oversized.statusCode, 413);

  const limited = response();
  await handler(request(), limited);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal(events.some((item) => item.event === 'feedback_received'), false);
});
