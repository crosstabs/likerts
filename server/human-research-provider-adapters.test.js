import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHumanResearchProviderAdapter,
  PROVIDER_ADAPTER_STATES,
} from './human-research-provider-adapters.js';

test('provider adapter exposes local dry-run feasibility, quote, mapping, status, completes, and export shapes', () => {
  const adapter = createHumanResearchProviderAdapter({
    providerId: 'PROVIDER_X',
    name: 'Example panel',
    link: 'https://example.com/panel',
  });
  const request = {
    market: 'Spain',
    language: 'en-US',
    targetCompletes: 100,
    screener: [{ questionId: 'S_CONSENT', type: 'SINGLE_SELECT', options: ['1', '2'] }],
  };

  assert.deepEqual(PROVIDER_ADAPTER_STATES, ['LINK_ONLY_NOT_INTEGRATED', 'DRY_RUN']);
  assert.equal(adapter.relationship, 'LINK_ONLY_NOT_INTEGRATED');
  assert.equal(adapter.mode, 'DRY_RUN');
  assert.equal(adapter.feasibility(request).status, 'UNCONFIRMED');
  assert.equal(adapter.quote(request).status, 'UNQUOTED');
  assert.equal(adapter.screenerMapping(request).status, 'DRY_RUN');
  assert.equal(adapter.fieldStatus(request).fieldingStatus, 'NOT_CONNECTED');
  assert.equal(adapter.completes({ completed: 7, requested: 100 }).status, 'DRY_RUN');
  const exported = adapter.exportResults({ distributions: { q1: { base: 7, categories: [] } }, rawResponses: ['must not pass'] });
  assert.equal(exported.status, 'DRY_RUN');
  assert.equal(exported.rawResponses, undefined);
  assert.equal(exported.networkAccessed, false);
  assert.equal(exported.credentialsUsed, false);
  assert.equal(exported.paymentEnabled, false);
  assert.equal(exported.contacted, false);
  assert.match(JSON.stringify(exported), /observed-human|aggregate/i);
});

test('provider adapter rejects integration and credential/contact/payment requests', () => {
  assert.throws(() => createHumanResearchProviderAdapter({ providerId: 'X', name: 'X', status: 'INTEGRATED' }), /LINK_ONLY_NOT_INTEGRATED|DRY_RUN/i);
  const adapter = createHumanResearchProviderAdapter({ providerId: 'PROVIDER_X', name: 'Example panel' });
  assert.throws(() => adapter.feasibility({ apiKey: 'secret' }), /credential|network|unsupported/i);
  assert.throws(() => adapter.quote({ payment: { amount: 100 } }), /payment|unsupported/i);
  assert.throws(() => adapter.fieldStatus({ webhookUrl: 'https://example.com/hook' }), /webhook|network|unsupported/i);
});
