import assert from 'node:assert/strict';
import test from 'node:test';

import { createProductEventsApiHandler } from '../api/product-events.js';

function request(body, extra = {}) {
  return {
    method: 'POST',
    url: '/api/product-events',
    headers: {
      host: 'likerts.example',
      'content-type': 'application/json',
      'x-correlation-id': 'product_12345678',
    },
    body,
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

test('records aggregate allowlisted product events in structured logs', async () => {
  const events = [];
  const handler = createProductEventsApiHandler({
    logger: logger(events),
    env: { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abc123' },
    requestLimiter: { check: () => ({ allowed: true }) },
  });
  const res = response();
  await handler(request({
    name: 'study_started',
    properties: {
      mode: 'quick',
      method: 'GENERAL_LIKERT',
      locale: 'en-US',
      trigger: 'composer',
      evidence: 'provided',
    },
  }), res);

  assert.equal(res.statusCode, 202);
  const event = events.find((item) => item.event === 'product_event');
  assert.equal(event.attributes.productEvent, 'study_started');
  assert.deepEqual(event.attributes.properties, {
    mode: 'quick',
    method: 'GENERAL_LIKERT',
    locale: 'en-US',
    trigger: 'composer',
    evidence: '[OMITTED]',
  });
  assert.equal(event.runtime.release, 'abc123');
});

test('rejects unknown, malformed, raw, and rate-limited product events', async () => {
  const events = [];
  const handler = createProductEventsApiHandler({
    logger: logger(events),
    requestLimiter: { check: () => ({ allowed: false, retryAfterSeconds: 20 }) },
  });
  for (const body of [
    { name: 'unknown_event', properties: {} },
    { name: 'interface_locale_changed', properties: { locale: 'not/a/locale' } },
    { name: 'interface_locale_changed', properties: { locale: 'en-US', prompt: 'private' } },
  ]) {
    const res = response();
    await handler(request(body), res);
    assert.equal(res.statusCode, 400);
  }
  const limited = response();
  await handler(request({ name: 'interface_locale_changed', properties: { locale: 'en-US' } }), limited);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers.get('retry-after'), '20');
  assert.equal(events.some((item) => item.event === 'product_event'), false);
});
