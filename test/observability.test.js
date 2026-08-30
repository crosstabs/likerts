import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStructuredEvent,
  eventSchema,
  headerValue,
  resolveCorrelationId,
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
  }, { now: () => '2030-01-01T00:00:00.000Z' });

  assert.equal(eventSchema.safeParse(event).success, true);
  assert.equal(event.attributes.authorization, '[REDACTED]');
  assert.equal(event.attributes.apiKey, '[REDACTED]');
  assert.equal(event.attributes.prompt, '[OMITTED]');
  assert.equal(event.attributes.sourceExcerpt, '[OMITTED]');
  assert.equal(event.attributes.respondentQuote, '[OMITTED]');
  assert.equal(event.attributes.responseStatus, 503);
  assert.deepEqual(event.attributes.tokenUsage, { totalTokens: 12 });
  assert.equal(JSON.stringify(event).includes('sk-secret'), false);
  assert.equal(JSON.stringify(event).includes('private source text'), false);
  assert.equal(JSON.stringify(event).includes('raw prompt should not be copied'), false);
});
