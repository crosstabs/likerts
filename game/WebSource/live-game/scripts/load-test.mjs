#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { availableParallelism, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const options = { rooms: 4, players: 4, rounds: 4, duration: 30, base: null };
const names = { '--rooms': 'rooms', '--players': 'players', '--rounds': 'rounds', '--max-duration': 'duration', '--base-url': 'base' };
for (let index = 2; index < process.argv.length; index += 2) {
  const key = names[process.argv[index]];
  if (!key || !process.argv[index + 1]) throw new Error('Use --rooms N --players N --rounds N --max-duration SECONDS [--base-url http://127.0.0.1:PORT]');
  options[key] = key === 'base' ? process.argv[index + 1] : Number(process.argv[index + 1]);
}
for (const key of ['rooms', 'players', 'rounds', 'duration']) if (!Number.isSafeInteger(options[key])) throw new Error('Load bounds must be integers');
if (options.rooms < 1 || options.rooms > 20 || options.players < 2 || options.players > 50 || options.rounds < 1 || options.rounds > options.players || options.duration < 5 || options.duration > 60 || options.rooms * (options.players + 1) > 200) {
  throw new Error('Bounds: rooms1–20, players2–50, rounds1–players, duration5–60s, at most200 total sockets');
}
if (options.base) {
  const url = new URL(options.base);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Target must be plain HTTP on127.0.0.1 with an explicit port and no path, credentials or query');
  options.base = url.origin;
}

const metrics = { http: [], socketAuthentication: [], fanout: [] };
const errors = {};
const cleanupNotifications = {};
const counts = { roomsCreated: 0, playersJoined: 0, socketsAuthenticated: 0, roundsRevealed: 0, matchesCompleted: 0, commandsSucceeded: 0, httpRequests: 0, roomsClosed: 0, expectedCleanupSocketNotifications: 0 };
const rooms = [];
const peers = new Set();
const admission = body => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url'), ...body });
const run = new AbortController();
const startedAt = performance.now();
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
let maximumRSS = process.memoryUsage().rss;
const memorySampler = setInterval(() => { maximumRSS = Math.max(maximumRSS, process.memoryUsage().rss); }, 100);
const stopTimer = setTimeout(() => { errors.runtimeLimit = (errors.runtimeLimit ?? 0) + 1; run.abort(); for (const peer of peers) peer.socket.close(); }, options.duration * 1000);
const teardownAllowanceSeconds = 5;
const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ schemaVersion: 1, emergencyTermination: true, cleanupIncomplete: true, planned: { rooms: options.rooms, playersPerRoom: options.players, workloadSeconds: options.duration, teardownAllowanceSeconds }, counts, errors: { ...errors, wallTimeWatchdog: 1 } }, null, 2));
  process.exit(1);
}, (options.duration + teardownAllowanceSeconds) * 1000);
watchdog.unref();
let store;
let service;
let directory;
let origin = options.base;
let sourceHash = null;
async function backendHash() {
  const hash = createHash('sha256');
  for (const path of ['../server/app.mjs', '../server/engine.mjs', '../server/store.mjs', '../server/errors.mjs', '../shared/catalogue.json']) {
    hash.update(path); hash.update(await readFile(new URL(path, import.meta.url)));
  }
  return hash.digest('hex');
}

function failure(kind) { errors[kind] = (errors[kind] ?? 0) + 1; }
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)].toFixed(2)) : null;
  return { samples: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: at(1) };
}
async function request(path, body, token, { method = 'POST', cleanup = false } = {}) {
  const start = performance.now();
  counts.httpRequests++;
  let response;
  try {
    response = await fetch(`${origin}/api/live${path}`, {
      method, redirect: 'error', headers: { Origin: 'http://127.0.0.1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: cleanup ? AbortSignal.timeout(1500) : AbortSignal.any([run.signal, AbortSignal.timeout(4000)]),
    });
    const payload = await response.json();
    if (!cleanup) metrics.http.push(performance.now() - start);
    if (!response.ok) { failure(`http${response.status}`); throw new Error('HTTP request rejected'); }
    return payload;
  } catch (error) {
    if (!response) failure(cleanup ? 'cleanupTransport' : 'transport');
    throw error;
  }
}
class Peer {
  constructor(url) {
    this.latestRevision = -1;
    this.waiters = new Set();
    this.socket = new WebSocket(url);
    peers.add(this);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('socket open failed')), { once: true });
    });
    this.firstState = new Promise((resolve, reject) => {
      this.resolveFirst = resolve;
      this.rejectFirst = reject;
    });
    // A rejected upgrade can close before authenticate reaches firstState.
    this.opened.catch(() => {});
    this.firstState.catch(() => {});
    this.socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { failure('socketJSON'); return; }
      if (message.type === 'error') {
        const code = /^[a-z_]{1,40}$/.test(message.error?.code ?? '') ? message.error.code : 'unknown';
        if (this.expectedClose && code === 'room_not_found') {
          counts.expectedCleanupSocketNotifications++;
          cleanupNotifications[code] = (cleanupNotifications[code] ?? 0) + 1;
          return;
        }
        failure(`socket_${code}`); this.rejectFirst(new Error('socket admission rejected')); return;
      }
      if (message.type !== 'state') return;
      if (message.state.revision < this.latestRevision) failure('socketRevisionRegression');
      this.latestRevision = Math.max(this.latestRevision, message.state.revision);
      this.resolveFirst(message.state);
      for (const waiter of [...this.waiters]) if (this.latestRevision >= waiter.revision) waiter.resolve();
    });
    this.socket.addEventListener('close', () => {
      this.rejectFirst(new Error('socket closed before state'));
      for (const waiter of [...this.waiters]) waiter.reject(new Error('socket closed during fanout'));
    });
  }
  async authenticate(member) {
    const start = performance.now();
    await Promise.race([this.opened, timeout(3000, 'socket open timeout')]);
    this.socket.send(JSON.stringify({ type: 'authenticate', code: member.code, token: member.token }));
    await Promise.race([this.firstState, timeout(3000, 'socket state timeout')]);
    metrics.socketAuthentication.push(performance.now() - start);
    counts.socketsAuthenticated++;
  }
  revision(revision) {
    if (this.latestRevision >= revision) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(new Error('fanout timeout')); }, 3000);
      const waiter = {
        revision,
        resolve: () => { clearTimeout(timer); this.waiters.delete(waiter); resolve(); },
        reject: error => { clearTimeout(timer); this.waiters.delete(waiter); reject(error); },
      };
      this.waiters.add(waiter);
    });
  }
}
function timeout(milliseconds, message) {
  return new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(message)), milliseconds); timer.unref(); });
}
async function command(room, member, action, data = {}, cleanup = false) {
  const start = performance.now();
  const payload = await request(`/rooms/${member.code}/actions`, { requestId: randomUUID(), matchId: room.state.matchId, ...(room.state.round ? { roundId: room.state.round.id } : {}), action, ...data }, member.token, { cleanup });
  if (cleanup) return payload;
  counts.commandsSucceeded++;
  if (!payload.state) throw new Error('command omitted state');
  room.state = payload.state;
  try { await Promise.all(room.peers.map(peer => peer.revision(payload.state.revision))); }
  catch { failure('fanout'); throw new Error('room fanout failed'); }
  metrics.fanout.push(performance.now() - start);
  return payload.state;
}
async function exerciseRoom() {
  const host = await request('/rooms', admission({ settings: { topic: 'mix', cycles: 1, capacity: options.players, answerSeconds: 0, predictSeconds: 0 } }));
  counts.roomsCreated++;
  const room = { host, state: host.state, players: [], peers: [] };
  rooms.push(room);
  for (let index = 0; index < options.players; index++) {
    const player = await request(`/rooms/${host.code}/join`, admission({ nickname: `Synthetic ${index + 1}`, acceptRoomSharing: true }));
    room.players.push(player);
    counts.playersJoined++;
  }
  for (const member of [host, ...room.players]) {
    const peer = new Peer(`${origin.replace('http:', 'ws:')}/api/live/socket`);
    room.peers.push(peer);
    await peer.authenticate(member);
  }
  await command(room, host, 'start');
  for (let index = 0; index < options.rounds; index++) {
    if (run.signal.aborted) throw new Error('runtime limit');
    if (room.state.phase !== 'answer') throw new Error('expected answer phase');
    const subject = room.players.find(player => player.memberId === room.state.round.subjectId);
    if (!subject) throw new Error('subject outside roster');
    await command(room, subject, 'answer', { value: 3 });
    const predictors = room.players.filter(player => player !== subject);
    await Promise.all(predictors.map(player => command(room, player, 'guess', { value: 3 })));
    const snapshot = await request(`/rooms/${host.code}`, undefined, host.token, { method: 'GET' });
    room.state = snapshot.state;
    if (room.state.phase !== 'reveal' || room.state.reveal?.valid !== true || room.state.reveal.guesses.length !== predictors.length || !room.state.reveal.guesses.every(guess => guess.points === 100)) throw new Error('invalid authoritative reveal');
    counts.roundsRevealed++;
    await command(room, host, 'next');
  }
  if (options.rounds === options.players) {
    if (room.state.phase !== 'finished' || room.state.completion !== 'complete') throw new Error('match did not complete');
    if (!room.state.leaderboard.every(row => row.points === (options.players - 1) * 100 && row.opportunities === options.players - 1 && row.rank === 1)) throw new Error('equal-opportunity score/tie mismatch');
    counts.matchesCompleted++;
  }
}

try {
  if (!origin) {
    sourceHash = await backendHash();
    const [{ createLiveServer }, { openStore }] = await Promise.all([import('../server/app.mjs'), import('../server/store.mjs')]);
    const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
    directory = await mkdtemp(join(tmpdir(), 'likerts-live-load-'));
    store = await openStore({ sqlitePath: join(directory, 'load.sqlite'), databaseURL: null, production: false });
    service = await createLiveServer({ store, catalogue, origins: ['http://127.0.0.1'], allowNoOrigin: true, production: false });
    ({ origin } = await service.listen({ host: '127.0.0.1', port: 0 }));
  }
  // Every room runs the same bounded synthetic workload, concurrently with other rooms.
  await Promise.all(Array.from({ length: options.rooms }, async () => {
    try { await exerciseRoom(); } catch { failure('roomWorkload'); }
  }));
} catch { failure('setup'); }
finally {
  await Promise.all(rooms.map(async room => {
    for (const peer of room.peers) peer.expectedClose = true;
    try { await command(room, room.host, 'close', {}, true); counts.roomsClosed++; } catch { failure('cleanup'); }
  }));
  for (const peer of peers) peer.socket.close();
  if (service) await service.close();
  if (store) await store.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  clearTimeout(stopTimer);
  clearTimeout(watchdog);
  clearInterval(memorySampler);
  loop.disable();
}
if (sourceHash && sourceHash !== await backendHash()) failure('backendSourceChangedDuringRun');
maximumRSS = Math.max(maximumRSS, process.memoryUsage().rss);
const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
const completeWorkload = counts.roomsCreated === options.rooms && counts.playersJoined === options.rooms * options.players && counts.socketsAuthenticated === options.rooms * (options.players + 1) && counts.roundsRevealed === options.rooms * options.rounds;
if (!completeWorkload) failure('incompletePlannedWork');
const report = {
  schemaVersion: 1,
  scope: options.base ? 'external-loopback-service; memory/event-loop describe harness only' : 'single-process local SQLite service plus clients',
  node: process.version, timestamp: new Date().toISOString(), backendSourceSHA256: sourceHash,
  planned: { rooms: options.rooms, playersPerRoom: options.players, sockets: options.rooms * (options.players + 1), roundsPerRoom: options.rounds, maxWorkloadSeconds: options.duration, teardownAllowanceSeconds },
  host: { platform: process.platform, architecture: process.arch, availableParallelism: availableParallelism(), totalMemoryBytes: totalmem() },
  elapsedMs, counts, errors, cleanupNotifications, completeWorkload,
  latency: { http: percentiles(metrics.http), socketAuthentication: percentiles(metrics.socketAuthentication), commandToAllRoomSnapshots: percentiles(metrics.fanout) },
  harnessOrCombinedProcess: { peakRSSBytes: maximumRSS, eventLoopP95Ms: Number((loop.percentile(95) / 1e6).toFixed(2)), eventLoopMaxMs: Number((loop.max / 1e6).toFixed(2)) },
  limitations: ['Loopback synthetic traffic; no internet/device measurement.', 'SQLite run is not a multi-instance PostgreSQL capacity result.', 'Reading clients do not establish slow-consumer backpressure behavior.', 'Configured ceilings are not a capacity claim.'],
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = Object.keys(errors).length ? 1 : 0;
