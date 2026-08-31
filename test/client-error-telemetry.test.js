import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createClientErrorEvent,
  createClientErrorReporter,
  firstPartyErrorFrame,
} from '../src/lib/clientErrorTelemetry.js';

test('client error events keep only same-origin frame and safe public diagnostics', () => {
  const error = Object.assign(new Error('private prompt text'), {
    name: 'PublicRequestError',
    publicCode: 'MODEL_UNAVAILABLE',
    correlationId: 'study_12345678',
    statusCode: 503,
    stack: 'PublicRequestError: private prompt text\n    at external (https://evil.example/tracker.js:1:2)\n    at run (https://likerts.example/assets/index-abc.js:12:4)',
  });

  assert.deepEqual(firstPartyErrorFrame(error, { origin: 'https://likerts.example' }), {
    asset: '/assets/index-abc.js',
    line: 12,
    column: 4,
  });
  const event = createClientErrorEvent(error, {
    captureKind: 'caught-request',
    action: 'study-run',
  }, { origin: 'https://likerts.example' });
  assert.equal(event.errorType, 'PublicRequestError');
  assert.equal(event.publicCode, 'MODEL_UNAVAILABLE');
  assert.equal(event.correlationId, 'study_12345678');
  assert.equal(event.statusCode, 503);
  assert.match(event.fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(event).includes('private prompt text'), false);
  assert.equal(JSON.stringify(event).includes('evil.example'), false);
});

test('client error events fail closed for unknown capture contexts', () => {
  assert.equal(createClientErrorEvent(new Error('detail'), {
    captureKind: 'unknown-source',
    action: 'study-run',
  }, { origin: 'https://likerts.example' }), null);
});

test('client reporter deduplicates, bounds volume, and contains transport failures', async () => {
  const calls = [];
  const report = createClientErrorReporter({
    enabled: true,
    origin: 'https://likerts.example',
    maximumEvents: 2,
    fetchImpl: (...args) => { calls.push(args); return Promise.reject(new Error('offline')); },
  });
  const first = Object.assign(new Error('one'), { stack: 'Error: one\n at a (https://likerts.example/assets/app.js:1:2)' });
  const second = Object.assign(new TypeError('two'), { stack: 'TypeError: two\n at b (https://likerts.example/assets/app.js:3:4)' });
  const third = Object.assign(new Error('three'), { stack: 'Error: three\n at c (https://likerts.example/assets/app.js:5:6)' });

  assert.equal(report(first, { captureKind: 'window-error', action: 'global' }), true);
  assert.equal(report(first, { captureKind: 'window-error', action: 'global' }), false);
  assert.equal(report(second, { captureKind: 'unhandled-rejection', action: 'promise' }), true);
  assert.equal(report(third, { captureKind: 'react-boundary', action: 'render' }), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], '/api/client-events');
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].keepalive, true);
  await Promise.resolve();
});
