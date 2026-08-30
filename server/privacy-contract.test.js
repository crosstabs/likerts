import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_CLASSIFICATIONS,
  retentionPolicySchema,
  createLineageEnvelope,
  redactSensitive,
} from './privacy-contract.js';

test('privacy contracts validate bounded classifications and retention', () => {
  assert.deepEqual(DATA_CLASSIFICATIONS, ['PUBLIC', 'USER_PROVIDED', 'SENSITIVE', 'OBSERVED_HUMAN_DATA']);
  assert.deepEqual(retentionPolicySchema.parse({ mode: 'TTL', expiresAt: '2030-01-01T00:00:00.000Z' }), {
    mode: 'TTL', expiresAt: '2030-01-01T00:00:00.000Z', deletionRequestedAt: null,
  });
  assert.throws(() => retentionPolicySchema.parse({ mode: 'TTL', expiresAt: 'not-a-date' }));
});

test('lineage envelope is versioned and preserves synthetic human boundary', () => {
  const envelope = createLineageEnvelope({
    recordType: 'QUALITATIVE_TURN', recordId: 'turn_1', classification: 'SENSITIVE',
    studyId: 'study_1', runId: 'run_1', payloadHash: 'a'.repeat(64),
    synthetic: true, observedHumanResponse: false,
  }, { now: () => '2026-08-29T00:00:00.000Z' });
  assert.equal(envelope.contractVersion, 'lineage-envelope-v1');
  assert.equal(envelope.synthetic, true);
  assert.equal(envelope.observedHumanResponse, false);
  assert.equal(envelope.createdAt, '2026-08-29T00:00:00.000Z');
  assert.equal(envelope.parentRecordId, null);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.updatedAt, envelope.createdAt);
  assert.throws(() => createLineageEnvelope({ recordType: 'HUMAN_RESPONSE', recordId: 'r', classification: 'PUBLIC', payloadHash: 'b'.repeat(64), synthetic: true, observedHumanResponse: true }));
});

test('redaction removes secret-like keys and preserves usage metadata', () => {
  const redacted = redactSensitive({ authorization: 'Bearer secret', apiKey: 'key', password: 'pw', token: 'secret', inputTokens: 4, nested: { secret: 'x', value: 'ok' } });
  assert.deepEqual(redacted, { authorization: '[REDACTED]', apiKey: '[REDACTED]', password: '[REDACTED]', token: '[REDACTED]', inputTokens: 4, nested: { secret: '[REDACTED]', value: 'ok' } });
});

test('redaction removes bearer/basic credential values under ordinary keys but keeps normal text', () => {
  assert.deepEqual(redactSensitive({ note: 'Bearer abc.def.ghi', text: 'Basic dXNlcjpwYXNz', title: 'Basic cooking', inputTokens: 4 }), {
    note: '[REDACTED]', text: '[REDACTED]', title: 'Basic cooking', inputTokens: 4,
  });
});
