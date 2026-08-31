import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coarseStudyFailureCategory,
  resolveVercelAnalyticsPolicy,
  sanitizeLikertsAnalyticsEnvelope,
  sanitizeLikertsAnalyticsEvent,
  sanitizeVercelAnalyticsEvent,
  VERCEL_ANALYTICS_APPROVAL_TOKEN,
} from '../src/lib/webAnalyticsPolicy.js';

test('Vercel Analytics remains fail-closed without exact production approval', () => {
  assert.deepEqual(resolveVercelAnalyticsPolicy(), {
    enabled: false,
    status: 'NOT_APPROVED',
  });
  assert.deepEqual(resolveVercelAnalyticsPolicy({ approvalToken: 'true', isProduction: true }), {
    enabled: false,
    status: 'INVALID_APPROVAL_TOKEN',
  });
  assert.deepEqual(resolveVercelAnalyticsPolicy({
    approvalToken: VERCEL_ANALYTICS_APPROVAL_TOKEN,
    isProduction: false,
  }), {
    enabled: false,
    status: 'NON_PRODUCTION',
  });
  assert.deepEqual(resolveVercelAnalyticsPolicy({
    approvalToken: VERCEL_ANALYTICS_APPROVAL_TOKEN,
    isProduction: true,
  }), {
    enabled: true,
    status: 'APPROVED',
  });
});

test('Vercel Analytics event sanitization removes URL data outside the path', () => {
  const event = Object.freeze({
    type: 'pageview',
    url: 'https://likerts.example/study?prompt=sensitive#result',
    marker: 'preserved',
  });

  assert.deepEqual(sanitizeVercelAnalyticsEvent(event, { origin: 'https://likerts.example' }), {
    type: 'pageview',
    url: 'https://likerts.example/study',
    marker: 'preserved',
  });
  assert.equal(event.url, 'https://likerts.example/study?prompt=sensitive#result');
});

test('Vercel Analytics event sanitization rejects malformed and cross-origin events', () => {
  assert.equal(sanitizeVercelAnalyticsEvent(null, { origin: 'https://likerts.example' }), null);
  assert.equal(sanitizeVercelAnalyticsEvent({ type: 'pageview' }, { origin: 'https://likerts.example' }), null);
  assert.equal(sanitizeVercelAnalyticsEvent({
    type: 'pageview',
    url: 'https://elsewhere.example/study',
  }, { origin: 'https://likerts.example' }), null);
  assert.equal(sanitizeVercelAnalyticsEvent({
    type: 'pageview',
    url: 'javascript:alert(1)',
  }, { origin: 'https://likerts.example' }), null);
});

test('Vercel Analytics event sanitization accepts same-origin relative paths', () => {
  assert.deepEqual(sanitizeVercelAnalyticsEvent({
    type: 'event',
    url: '/?from=campaign#composer',
  }, { origin: 'https://likerts.example' }), {
    type: 'event',
    url: 'https://likerts.example/',
  });
});

test('pilot analytics only emits allowlisted coarse fields', () => {
  assert.deepEqual(sanitizeLikertsAnalyticsEvent('study_started', {
    mode: 'deep',
    method: 'CONCEPT_TEST',
    locale: 'ja-JP',
    trigger: 'composer',
    evidence: 'provided',
    prompt: 'secret research brief',
    audience: 'secret segment',
  }), {
    name: 'study_started',
    properties: {
      mode: 'deep',
      method: 'CONCEPT_TEST',
      locale: 'ja-JP',
      trigger: 'composer',
      evidence: 'provided',
    },
  });
});

test('same-origin analytics envelopes reject all extra fields', () => {
  const valid = {
    name: 'interface_locale_changed',
    properties: { locale: 'ja-JP' },
  };
  assert.deepEqual(sanitizeLikertsAnalyticsEnvelope(valid), valid);
  assert.equal(sanitizeLikertsAnalyticsEnvelope({ ...valid, prompt: 'private' }), null);
  assert.equal(sanitizeLikertsAnalyticsEnvelope({
    ...valid,
    properties: { ...valid.properties, prompt: 'private' },
  }), null);
});

test('pilot analytics rejects unknown events and malformed dimensions', () => {
  assert.equal(sanitizeLikertsAnalyticsEvent('research_prompt', { prompt: 'secret' }), null);
  assert.equal(sanitizeLikertsAnalyticsEvent('interface_locale_changed', { locale: '../../secret' }), null);
  assert.equal(sanitizeLikertsAnalyticsEvent('study_completed', {
    mode: 'quick',
    method: 'GENERAL_LIKERT',
    locale: 'en-US',
    trigger: 'composer',
    evidence: 'none',
    persistence: 'cloud-drive',
  }), null);
});

test('study failure categories are deliberately coarse', () => {
  assert.equal(coarseStudyFailureCategory('DURABLE_ADMISSION_REQUIRED'), 'admission');
  assert.equal(coarseStudyFailureCategory('LIKERTS_EXECUTION_DISABLED'), 'disabled');
  assert.equal(coarseStudyFailureCategory('OUTPUT_LOCALE_INVALID'), 'localization');
  assert.equal(coarseStudyFailureCategory('GATEWAY_UNAVAILABLE'), 'model');
  assert.equal(coarseStudyFailureCategory('anything-specific'), 'other');
});
