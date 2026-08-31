import assert from 'node:assert/strict';
import test from 'node:test';

import { createClientEventsApiHandler, MAX_CLIENT_EVENT_BODY_BYTES } from '../api/client-events.js';

function request(extra = {}) {
  return {
    method: 'POST',
    url: '/api/client-events',
    headers: {
      host: 'likerts.example',
      'content-type': 'application/json',
      'x-correlation-id': 'event_12345678',
    },
    body: {
      schemaVersion: 'client-error-v1',
      captureKind: 'caught-request',
      surface: 'app',
      action: 'study-run',
      errorType: 'PublicRequestError',
      fingerprint: '0123456789abcdef',
      publicCode: 'MODEL_UNAVAILABLE',
      correlationId: 'study_12345678',
      statusCode: 503,
      frame: { asset: '/assets/index-abc.js', line: 12, column: 4 },
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

test('accepts and logs only the strict privacy-safe client error contract', async () => {
  const events = [];
  const handler = createClientEventsApiHandler({
    env: { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'abc123' },
    logger: logger(events),
    requestLimiter: { check: () => ({ allowed: true }) },
  });
  const res = response();
  await handler(request(), res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.headers.get('x-correlation-id'), 'event_12345678');
  const event = events.find((item) => item.event === 'client_error');
  assert.equal(event.correlationId, 'study_12345678');
  assert.equal(event.runtime.release, 'abc123');
  assert.deepEqual(event.error, {
    name: 'PublicRequestError',
    code: 'MODEL_UNAVAILABLE',
    statusCode: 503,
  });
  assert.equal(JSON.stringify(event).includes('prompt'), false);
  assert.equal(events.filter((item) => item.event === 'request_finished').length, 1);
});

test('rejects raw messages, cross-origin requests, oversized bodies, and rate-limit excess', async () => {
  const events = [];
  const handler = createClientEventsApiHandler({
    logger: logger(events),
    requestLimiter: { check: () => ({ allowed: false, retryAfterSeconds: 30 }) },
  });

  const raw = response();
  await handler(request({ body: { ...request().body, message: 'private prompt text' } }), raw);
  assert.equal(raw.statusCode, 400);

  const crossOrigin = response();
  await handler(request({ headers: { host: 'likerts.example', origin: 'https://evil.example', 'content-type': 'application/json' } }), crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);

  const oversized = response();
  await handler(request({ body: 'x'.repeat(MAX_CLIENT_EVENT_BODY_BYTES + 1) }), oversized);
  assert.equal(oversized.statusCode, 413);

  const limited = response();
  await handler(request(), limited);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers.get('retry-after'), '30');
  assert.equal(events.some((item) => item.event === 'client_error'), false);
});
