import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { createLiveServer, PRODUCTION_LIMITS } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const admission = () => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url') });

async function authenticate(origin, credential, peers) {
  const url = new URL('/api/live/socket', origin); url.protocol = 'ws:';
  const socket = new WebSocket(url, { origin }); peers.add(socket);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => { socket.terminate(); finish(new Error('Owned reconnect fixture authentication timed out')); }, 4000);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'authenticate', code: credential.code, token: credential.token })));
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString('utf8'));
      if (message.type === 'state' || message.type === 'error') finish(null, { socket, message });
    });
    socket.once('error', () => finish(new Error('Owned reconnect fixture socket failed')));
    socket.once('close', () => finish(new Error('Owned reconnect fixture closed before authentication')));
  });
}

test('All twelve players and the dedicated host reconnect during retained-lease grace while an excess duplicate remains denied', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-reconnect-capacity-'));
  const sqlitePath = join(directory, 'rooms.sqlite'), apps = [], stores = [], peers = new Set();
  const timestamp = Date.now(), now = () => timestamp;
  t.after(async () => {
    for (const socket of peers) socket.terminate();
    for (const app of apps) await app.close();
    for (const store of stores) await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function start() {
    const store = await openStore({ sqlitePath, databaseURL: '', production: false, now, maxRooms: PRODUCTION_LIMITS.maxRooms }); stores.push(store);
    // SQLite is the owned development fixture; the real lease/transport code
    // runs with exactly the production resource policy, not relaxed quotas.
    const app = await createLiveServer({ store, catalogue, now, limits: PRODUCTION_LIMITS }); apps.push(app);
    const { origin } = await app.listen({ host: '127.0.0.1', port: 0 });
    return { store, app, origin };
  }
  const original = await start();
  async function admit(path, body) {
    const response = await fetch(original.origin + '/api/live' + path, { method: 'POST', headers: { Origin: original.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...admission(), ...body }) });
    assert.equal(response.status, 201); return response.json();
  }
  const host = await admit('/rooms', { settings: { capacity: 12, answerSeconds: 0, predictSeconds: 0 } });
  const members = [host];
  for (let i = 0; i < 12; i++) members.push(await admit(`/rooms/${host.code}/join`, { nickname: `Friend ${i + 1}`, acceptRoomSharing: true }));
  for (const member of members) assert.equal((await authenticate(original.origin, member, peers)).message.type, 'state');
  const leases = async store => (await store.transact(host.code, room => ({ room, changed: false, value: [room.host, ...room.players].map(member => ({ id: member.id, count: Object.keys(member.socketLeases ?? {}).length, unexpired: Object.values(member.socketLeases ?? {}).every(expiry => expiry > timestamp) })) }))).value;
  assert.ok((await leases(original.store)).every(member => member.count === 1 && member.unexpired));
  // Closing a worker intentionally retains its leases, as a crash can. Reopen
  // the durable file without advancing the clock or deleting any member lease.
  await original.app.close(); await original.store.close();
  const replacement = await start();
  const retained = await leases(replacement.store);
  assert.equal(retained.length, 13); assert.ok(retained.every(member => member.count === 1 && member.unexpired));
  assert.equal((await authenticate(replacement.origin, host, peers)).message.type, 'state');
  const duplicate = await authenticate(replacement.origin, host, peers);
  assert.equal(duplicate.message.type, 'error'); assert.equal(duplicate.message.error.code, 'connection_limit');
  const afterDuplicate = await leases(replacement.store);
  assert.equal(afterDuplicate.find(member => member.id === 'host').count, 2);
  assert.equal(afterDuplicate.reduce((sum, member) => sum + member.count, 0), 14, 'An excess duplicate must not consume or erase another lease');
  const results = await Promise.all(members.slice(1).map(member => authenticate(replacement.origin, member, peers)));
  const accepted = results.filter(result => result.message.type === 'state').length;
  const rejected = results.filter(result => result.message.type === 'error').length;
  t.diagnostic(`Replacement admissions: host 1 plus players ${accepted}/12; rejected players ${rejected}; room ceiling ${PRODUCTION_LIMITS.maxSocketsPerRoom}`);
  assert.equal(accepted, 12, 'Every valid player must reconnect while the previous worker leases are still alive');
  const complete = await leases(replacement.store);
  assert.ok(complete.every(member => member.count === 2 && member.unexpired));
  assert.equal(complete.reduce((sum, member) => sum + member.count, 0), 26);
  assert.equal(PRODUCTION_LIMITS.maxSocketsPerRoom, PRODUCTION_LIMITS.maxSocketsPerMember * (PRODUCTION_LIMITS.maxPlayers + 1));
});
