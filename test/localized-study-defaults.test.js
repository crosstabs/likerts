import assert from 'node:assert/strict';
import test from 'node:test';

import {
  localizedStudyDefaultLocales,
  localizedStudyDefaults,
} from '../src/lib/localizedStudyDefaults.js';

test('every enabled report locale receives a localized recurring-price unit without inferring currency', () => {
  assert.deepEqual(localizedStudyDefaultLocales, [
    'en-US', 'es-ES', 'pt-BR', 'fr-FR', 'de-DE', 'zh-CN', 'ja-JP', 'ko-KR', 'ar-SA', 'hi-IN',
  ]);
  assert.deepEqual(localizedStudyDefaults('en-US'), { priceUnit: 'per month' });
  assert.deepEqual(localizedStudyDefaults('es-ES'), { priceUnit: 'al mes' });
  assert.deepEqual(localizedStudyDefaults('pt-BR'), { priceUnit: 'por mês' });
  assert.deepEqual(localizedStudyDefaults('fr-FR'), { priceUnit: 'par mois' });
  assert.deepEqual(localizedStudyDefaults('de-DE'), { priceUnit: 'pro Monat' });
  assert.deepEqual(localizedStudyDefaults('zh-CN'), { priceUnit: '每月' });
  assert.deepEqual(localizedStudyDefaults('ja-JP'), { priceUnit: '月額' });
  assert.deepEqual(localizedStudyDefaults('ko-KR'), { priceUnit: '월' });
  assert.deepEqual(localizedStudyDefaults('ar-SA'), { priceUnit: 'شهرياً' });
  assert.deepEqual(localizedStudyDefaults('hi-IN'), { priceUnit: 'प्रति माह' });
});

test('unknown interface locales retain the explicit English fallback defaults', () => {
  assert.equal(Object.hasOwn(localizedStudyDefaults('en-US'), 'currency'), false);
  assert.equal(localizedStudyDefaults('not-a-locale'), localizedStudyDefaults('en-US'));
  assert.equal(Object.isFrozen(localizedStudyDefaults('en-US')), true);
});
