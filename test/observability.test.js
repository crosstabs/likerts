import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStructuredEvent,
  eventSchema,
  headerValue,
  observeApiHandler,
  resolveCorrelationId,
  runtimeTelemetryContext,
} from '../server/observability.js';

test('correlation IDs are accepted only in bounded public form', () => {
  assert.equal(resolveCorrelationId({ 'x-correlation-id': 'run_12345678' }, { randomId: () => 'fallback-id' }), 'run_12345678');
  assert.equal(resolveCorrelationId({ 'x-correlation-id': 'bad value with spaces' }, { randomId: () => 'fallback-id' }), 'fallback-id');
  assert.equal(headerValue({ 'X-Test': ['first', 'second'] }, 'x-test'), 'first');
});

test('structured events redact credentials and omit prompt/source/respondent telemetry', () => {
  const event = createStructuredEvent({
    level: 'error',
    component: 'api.synthetic-study',
    event: 'request_failed',
    correlationId: 'corr_12345678',
    error: { name: 'Error', code: 'BROKEN', message: 'raw prompt should not be copied' },
    attributes: {
      authorization: 'Bearer secret',
      apiKey: 'sk-secret',
      prompt: 'Would this specific person buy it?',
      sourceExcerpt: 'private source text',
      respondentQuote: 'participant-looking quote',
      responseStatus: 503,
      tokenUsage: { totalTokens: 12 },
    },
  }, {
    now: () => '2030-01-01T00:00:00.000Z',
    env: { NODE_ENV: 'test', VERCEL_REGION: 'sin1', VERCEL_GIT_COMMIT_SHA: 'abc123' },
  });

  assert.equal(eventSchema.safeParse(event).success, true);
  assert.equal(event.attributes.authorization, '[REDACTED]');
  assert.equal(event.attributes.apiKey, '[REDACTED]');
  assert.equal(event.attributes.prompt, '[OMITTED]');
  assert.equal(event.attributes.sourceExcerpt, '[OMITTED]');
  assert.equal(event.attributes.respondentQuote, '[OMITTED]');
  assert.equal(event.attributes.responseStatus, 503);
  assert.deepEqual(event.attributes.tokenUsage, { totalTokens: 12 });
  assert.deepEqual(event.runtime, {
    environment: 'test',
    region: 'sin1',
    release: 'abc123',
    deploymentId: null,
  });
  assert.equal(JSON.stringify(event).includes('sk-secret'), false);
  assert.equal(JSON.stringify(event).includes('private source text'), false);
  assert.equal(JSON.stringify(event).includes('raw prompt should not be copied'), false);
});

test('runtime telemetry accepts only bounded deployment metadata', () => {
  assert.deepEqual(runtimeTelemetryContext({
    VERCEL_ENV: 'production',
    VERCEL_REGION: 'sin1',
    VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    VERCEL_DEPLOYMENT_ID: 'bad deployment value',
  }), {
    environment: 'production',
    region: 'sin1',
    release: 'a'.repeat(40),
    deploymentId: null,
  });
});

test('API observation emits one complete outcome without changing handler behavior', async () => {
  const lines = [];
  const ticks = [100, 137];
  const handler = observeApiHandler(async (_request, response) => {
    response.statusCode = 429;
    response.headers.set('x-correlation-id', 'corr_12345678');
    return 'handled';
  }, {
    component: 'api.test',
    route: '/api/test',
    logger: { warn: (line) => lines.push(line) },
    env: { VERCEL_ENV: 'preview' },
    now: () => ticks.shift(),
  });

  const result = await handler({ method: 'POST', headers: {} }, { statusCode: 200, headers: new Map() });
  assert.equal(result, 'handled');
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.event, 'request_finished');
  assert.equal(event.level, 'warn');
  assert.equal(event.correlationId, 'corr_12345678');
  assert.deepEqual(event.attributes, {
    route: '/api/test',
    method: 'POST',
    statusCode: 429,
    durationMs: 37,
    outcome: 'rejected',
  });
});
