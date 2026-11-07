import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const worktreeRoot = fileURLToPath(new URL('../', import.meta.url));
const candidateRoot = fileURLToPath(new URL('../../../../Source/live-game/', import.meta.url));
const target = process.env.LIKERTS_PHASE2_TARGET ?? 'worktree';
assert.ok(['candidate', 'worktree'].includes(target), 'Phase 2 only permits the known candidate or worktree');
const targetRoot = target === 'candidate' ? candidateRoot : worktreeRoot;
const knownCandidate = '0495d608601cf7beb512b490ace5551660f9dc0f1989f7a0624a8323d3f0f020';
async function fingerprint(root) {
  const hash = createHash('sha256');
  for (const name of ['../server/app.mjs', '../server/engine.mjs', '../server/store.mjs', '../server/errors.mjs', '../shared/catalogue.json']) {
    hash.update(name); hash.update(await readFile(join(root, 'scripts', name)));
  }
  return hash.digest('hex');
}
export const sourceEvidence = { target, sha256: await fingerprint(targetRoot) };
if (target === 'candidate') assert.equal(sourceEvidence.sha256, knownCandidate, 'The frozen candidate changed');
const targetLock = JSON.parse(await readFile(join(targetRoot, 'package-lock.json'), 'utf8'));
const installedLock = JSON.parse(await readFile(join(worktreeRoot, 'package-lock.json'), 'utf8'));
// The parent raised only the root Node runtime floor after freezing the candidate.
delete targetLock.packages[''].engines;
delete installedLock.packages[''].engines;
assert.deepEqual(targetLock, installedLock, 'Every installed dependency must match the reviewed lockfile');
const ownedSource = await mkdtemp(join(tmpdir(), 'likerts-phase2-code-'));
for (const directory of ['server', 'shared', 'web']) await cp(join(targetRoot, directory), join(ownedSource, directory), { recursive: true });
await cp(join(targetRoot, 'package.json'), join(ownedSource, 'package.json'));
await symlink(join(worktreeRoot, 'node_modules'), join(ownedSource, 'node_modules'), 'dir');
assert.equal(await fingerprint(targetRoot), sourceEvidence.sha256, 'Source changed while copying the local fixture');
const { createLiveServer } = await import(pathToFileURL(join(ownedSource, 'server/app.mjs')));
const { openStore } = await import(pathToFileURL(join(ownedSource, 'server/store.mjs')));
const catalogue = JSON.parse(await readFile(join(ownedSource, 'shared/catalogue.json'), 'utf8'));
const require = createRequire(import.meta.url);
export const { WebSocket } = require('ws');
export const admission = body => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), ...body });
export async function cleanupSource() { await rm(ownedSource, { recursive: true, force: true }); }
export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function until(predicate, milliseconds = 1500) {
  const stop = Date.now() + milliseconds;
  while (Date.now() < stop) { if (await predicate()) return; await delay(5); }
  assert.fail('Bounded local observation deadline exceeded');
}

export async function fixture(t, { limits = {}, maxRooms = 4 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-phase2-store-'));
  let timestamp = Date.now();
  let store, app;
  const ownedSockets = new Set();
  t.after(async () => {
    for (const socket of ownedSockets) socket.terminate ? socket.terminate() : socket.destroy();
    try { if (app) await app.close(); }
    finally { try { if (store) await store.close(); } finally { await rm(directory, { recursive: true, force: true }); } }
  });
  store = await openStore({ sqlitePath: join(directory, 'room.sqlite'), databaseURL: null, production: false, maxRooms, now: () => timestamp });
  app = await createLiveServer({ store, catalogue, production: false, allowNoOrigin: true, origins: ['http://127.0.0.1'], now: () => timestamp,
    limits: { maxRooms, maxPlayers: 12, maxSockets: 64, maxSocketsPerRoom: 26, maxSocketsPerMember: 2, ...limits } });
  const { origin, port } = await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    origin, port, app, store,
    own(socket) { ownedSockets.add(socket); return socket; },
    async advance(milliseconds) { timestamp += milliseconds; await app.tick(); },
    async request(method, path, body, token, extraHeaders = {}) {
      const response = await fetch(`${origin}/api/live${path}`, { method, redirect: 'error',
        headers: { Origin: 'http://127.0.0.1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000),
      });
      return { status: response.status, body: await response.json() };
    },
    async openSocket() {
      const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/live/socket`);
      ownedSockets.add(socket);
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      return socket;
    },
  };
}
