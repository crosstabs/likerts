import test from 'node:test';
import assert from 'node:assert/strict';

import { createPilotAnalyticsTracker } from '../src/lib/pilotAnalytics.js';

test('pilot tracker stays inert when analytics is not approved', () => {
  const emitted = [];
  const track = createPilotAnalyticsTracker({
    enabled: false,
    emit: (...args) => emitted.push(args),
  });

  assert.equal(track('interface_locale_changed', { locale: 'ja-JP' }), false);
  assert.deepEqual(emitted, []);
});

test('pilot tracker emits only the sanitized allowlisted payload', () => {
  const emitted = [];
  const track = createPilotAnalyticsTracker({
    enabled: true,
    emit: (...args) => emitted.push(args),
  });

  assert.equal(track('human_validation_opened', {
    method: 'CONCEPT_TEST',
    locale: 'ko-KR',
    handoffAvailable: true,
    prompt: 'must never leave the browser',
  }), true);
  assert.deepEqual(emitted, [[
    'human_validation_opened',
    {
      method: 'CONCEPT_TEST',
      locale: 'ko-KR',
      handoffAvailable: true,
    },
  ]]);
});

test('pilot tracker rejects malformed payloads and contains emitter failures', () => {
  const trackInvalid = createPilotAnalyticsTracker({ enabled: true, emit: () => assert.fail('must not emit') });
  assert.equal(trackInvalid('interface_locale_changed', { locale: 'not/a/locale' }), false);

  const trackThrowing = createPilotAnalyticsTracker({ enabled: true, emit: () => { throw new Error('offline'); } });
  assert.equal(trackThrowing('interface_locale_changed', { locale: 'zh-CN' }), false);
});
