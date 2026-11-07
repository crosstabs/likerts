import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRoom, joinRoom, reduceRoom, replayLeft } from '../server/engine.mjs';
const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const now = Date.now();
const command = (room, action, extra = {}) => ({ requestId: randomUUID(), matchId: room.matchId, action, ...extra });
function fixture() {
  const host = createRoom({}, { catalogue, now });
  const player = joinRoom(host.room, { nickname: 'Ari', acceptRoomSharing: true }, { now });
  const heartbeat = command(player.room, 'heartbeat');
  const full = reduceRoom(player.room, 'host', heartbeat, { catalogue, now, maxRequests: 1 }).room;
  return { full, player, heartbeat };
}

test('A full command receipt budget still permits exact self-revocation without growing normal receipts', () => {
  const { full, player } = fixture(), leave = command(full, 'leave');
  const result = reduceRoom(full, player.memberId, leave, { catalogue, now, maxRequests: 1 });
  assert.equal(result.room.players.length, 0); assert.equal(Object.keys(result.room.requests).length, 1);
  assert.equal(replayLeft(result.room, player.token, leave), true);
  assert.throws(() => replayLeft(result.room, player.token, { ...leave, matchId: randomUUID() }), { code: 'request_conflict' });
  assert.equal(replayLeft(result.room, player.token, { ...leave, requestId: randomUUID() }), false);
  assert.equal(replayLeft(result.room, player.token, { ...leave, action: 'heartbeat' }), false);
});

test('Only an authorized current-match host can bypass the receipt cap to close the room', () => {
  const { full, player } = fixture();
  assert.equal(reduceRoom(full, 'host', command(full, 'close'), { catalogue, now, maxRequests: 1 }).closed, true);
  assert.throws(() => reduceRoom(full, player.memberId, command(full, 'close'), { catalogue, now, maxRequests: 1 }), { code: 'forbidden' });
  assert.throws(() => reduceRoom(full, 'host', command(full, 'close', { matchId: randomUUID() }), { catalogue, now, maxRequests: 1 }), { code: 'stale_match' });
  assert.throws(() => reduceRoom(full, 'host', command(full, 'heartbeat'), { catalogue, now, maxRequests: 1 }), { code: 'request_limit' });
});

test('Terminal safety does not let an actor reuse a conflicting request UUID', () => {
  const { full, heartbeat } = fixture();
  assert.throws(() => reduceRoom(full, 'host', { ...heartbeat, action: 'close' }, { catalogue, now, maxRequests: 1 }), { code: 'request_conflict' });
});

test('Existing persisted leave receipts remain replayable after the revocation format upgrade', () => {
  const { player } = fixture(), leave = command(player.room, 'leave');
  const result = reduceRoom(player.room, player.memberId, leave, { catalogue, now }).room;
  const [hash, record] = Object.entries(result.revocations)[0];
  if (typeof record === 'object') { result.revocations[hash] = record.memberId; result.requests[`${record.memberId}:${record.requestId}`] = record.fingerprint; }
  assert.equal(replayLeft(result, player.token, leave), true);
});
