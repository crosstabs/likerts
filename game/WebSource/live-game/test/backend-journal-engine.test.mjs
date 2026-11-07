import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRoom, reduceRoom, replayLeft } from '../server/engine.mjs';
const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');
const room = () => { const value = createRoom({}, { catalogue, now: 1000 }).room; delete value.requests; return { ...value, storageVersion: 3, receiptCount: 7 }; };
const command = value => ({ requestId: randomUUID(), matchId: value.matchId, action: 'heartbeat' });
const context = (value, cmd, extra = {}) => ({ roomInstanceId: value.instanceId, actorId: 'host', scope: 'active', requestId: cmd.requestId, fingerprint: fingerprint(cmd), existingFingerprint: null, receiptCount: value.receiptCount, ...extra });

test('Version3 rooms require an explicit matching receipt context, never an empty implicit history', () => {
  const value = room(), cmd = command(value);
  for (const receiptContext of [undefined, {}, context(value, cmd, { roomInstanceId: randomUUID() }), context(value, cmd, { actorId: randomUUID() }), context(value, cmd, { requestId: randomUUID() })]) assert.throws(() => reduceRoom(value, 'host', cmd, { catalogue, receiptContext, now: 1000 }), { code: 'configuration_error' });
});
test('Version3 exact replay precedes stale-match checks and never allocates another receipt', () => {
  const value = room(), cmd = { ...command(value), matchId: randomUUID() };
  const result = reduceRoom(value, 'host', cmd, { catalogue, receiptContext: context(value, cmd, { existingFingerprint: fingerprint(cmd) }), now: 1000 });
  assert.equal(result.replayed, true); assert.equal(result.recordReceipt, false); assert.equal(result.room.requests, undefined);
});
test('Version3 fingerprints still conflict and the scalar receipt cap is authoritative', () => {
  const value = room(), cmd = command(value);
  assert.throws(() => reduceRoom(value, 'host', cmd, { catalogue, receiptContext: context(value, cmd, { existingFingerprint: '0'.repeat(64) }), now: 1000 }), { code: 'request_conflict' });
  assert.throws(() => reduceRoom(value, 'host', cmd, { catalogue, receiptContext: context(value, cmd), maxRequests: 7, now: 1000 }), { code: 'request_limit' });
});
test('Version3 accepted commands return a journal intent without embedding history', () => {
  const value = room(), cmd = command(value);
  const result = reduceRoom(value, 'host', cmd, { catalogue, receiptContext: context(value, cmd), now: 1000 });
  assert.equal(result.recordReceipt, true); assert.equal(result.room.requests, undefined); assert.equal(result.room.receiptCount, 7);
});
test('Version3 legacy leave replay uses only its restricted exact receipt context', () => {
  const value = room(), token = 'A'.repeat(43), actorId = randomUUID();
  value.revocations = { [createHash('sha256').update(token).digest('hex')]: actorId };
  const cmd = { ...command(value), action: 'leave' };
  const receiptContext = context(value, cmd, { actorId, scope: 'revoked_leave', existingFingerprint: fingerprint(cmd) });
  assert.equal(replayLeft(value, token, cmd, receiptContext), true);
  assert.equal(replayLeft(value, token, cmd, { ...receiptContext, scope: 'active' }), false);
});
