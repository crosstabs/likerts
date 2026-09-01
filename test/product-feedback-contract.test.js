import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_FEEDBACK_VERSION,
  productFeedbackSchema,
} from '../shared/product-feedback.mjs';

const validFeedback = Object.freeze({
  schemaVersion: PRODUCT_FEEDBACK_VERSION,
  category: 'IDEA',
  message: 'A compact comparison view would help.',
  interfaceLocale: 'en-US',
  pagePath: '/',
});

test('feedback contract accepts only bounded explicit product feedback', () => {
  assert.deepEqual(productFeedbackSchema.parse(validFeedback), validFeedback);
  assert.equal(productFeedbackSchema.safeParse({ ...validFeedback, message: '  useful idea  ' }).data.message, 'useful idea');
});

test('feedback contract rejects raw URLs, extra fields, control characters, and oversized text', () => {
  for (const feedback of [
    { ...validFeedback, pagePath: '/?research=private' },
    { ...validFeedback, prompt: 'private research brief' },
    { ...validFeedback, message: 'bad\u0000text' },
    { ...validFeedback, message: 'x'.repeat(801) },
    { ...validFeedback, category: 'SALES_LEAD' },
  ]) {
    assert.equal(productFeedbackSchema.safeParse(feedback).success, false);
  }
});
