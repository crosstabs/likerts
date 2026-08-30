import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorageAdapter, storageRecordSchema } from './storage-contract.js';

const record = (id = 'r1', overrides = {}) => ({
  id, kind: 'conversation', version: 1, data: { safe: true },
  lineage: {
    contractVersion: 'lineage-envelope-v1', recordType: 'conversation', recordId: id,
    classification: 'USER_PROVIDED', studyId: 'study_1', runId: 'run_1', payloadHash: 'a'.repeat(64),
    synthetic: true, observedHumanResponse: false, createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z', parentRecordId: null, version: 1,
    retention: { mode: 'SESSION', expiresAt: null, deletionRequestedAt: null },
  }, ...overrides,
});

test('memory storage creates, reads, updates with optimistic concurrency, and deletes', async () => {
  const store = createMemoryStorageAdapter();
  assert.deepEqual(await store.create(record()), record());
  assert.deepEqual(await store.get('r1'), record());
  await assert.rejects(() => store.create(record()), /already exists/);
  const updated = await store.update('r1', 1, { data: { safe: false } });
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.data, { safe: false });
  await assert.rejects(() => store.update('r1', 1, { data: {} }), /version conflict/);
  assert.equal(await store.delete('r1'), true);
  assert.equal(await store.get('r1'), null);
  assert.equal(await store.delete('r1'), false);
});

test('storage records are strict and list returns isolated values', async () => {
  assert.throws(() => storageRecordSchema.parse({ ...record(), unknown: true }));
  const store = createMemoryStorageAdapter();
  await store.create(record());
  const rows = await store.list({ kind: 'conversation' });
  rows[0].data.safe = false;
  assert.equal((await store.get('r1')).data.safe, true);
});

test('storage requires matching full lineage identity and version', () => {
  assert.throws(() => storageRecordSchema.parse(record('r1', { lineage: { ...record().lineage, recordId: 'other' } })));
  assert.throws(() => storageRecordSchema.parse(record('r1', { lineage: { ...record().lineage, recordType: 'other' } })));
  assert.throws(() => storageRecordSchema.parse(record('r1', { lineage: { ...record().lineage, version: 0 } })));
});

test('memory storage removes expired TTL records on get and list using injected time', async () => {
  let now = new Date('2030-01-01T00:00:00.000Z');
  const store = createMemoryStorageAdapter({ now: () => now.toISOString() });
  const expiring = record('ttl1', { lineage: { ...record('ttl1').lineage, retention: { mode: 'TTL', expiresAt: '2030-01-02T00:00:00.000Z', deletionRequestedAt: null } } });
  await store.create(expiring);
  now = new Date('2030-01-03T00:00:00.000Z');
  assert.equal(await store.get('ttl1'), null);
  assert.deepEqual(await store.list(), []);
});
