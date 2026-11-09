import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { LiveError, fail, publicError } from './errors.mjs';
import { advance, createRoom, createQuizRoom, freshToken, identify, joinRoom, normalizeLiveQuiz, project, reduceRoom, replayLeft, revokedLeaveActor, roomMode, commandFingerprint, touch, validCode, validateCatalogue, validateCommand, validateSettings, validateQuizSettings, tokenVerifier } from './engine.mjs';

export const QUIZ_CREATE_MAX_BYTES = 69_632;

export const DEFAULT_LIMITS = Object.freeze({ maxRooms: 1000, maxPlayers: 50, maxSockets: 1000, maxSocketsPerRoom: 200, maxSocketsPerMember: 4, maxBodyBytes: 8192, maxFrameBytes: 4096, maxBufferedBytes: 256 * 1024, createPerMinute: 12, joinPerMinute: 120, actionsPerMinute: 3000, connectionsPerMinute: 120, framesPerMinute: 120, refreshPerMinute: 60, healthPerMinute: 120, authTimeoutMs: 5000, maxRequests: 50_000, readinessIntervalMs: 5000, readinessMaxAgeMs: 15_000 });
export const PRODUCTION_LIMITS = Object.freeze({ ...DEFAULT_LIMITS, maxRooms: 4, maxPlayers: 12, maxSockets: 64, maxSocketsPerRoom: 26, maxSocketsPerMember: 2 });
const LIMIT_ENV = Object.freeze({ maxRooms: 'MAX_ROOMS', maxPlayers: 'MAX_PLAYERS', maxSockets: 'MAX_SOCKETS', maxSocketsPerRoom: 'MAX_SOCKETS_PER_ROOM', maxSocketsPerMember: 'MAX_SOCKETS_PER_MEMBER', maxBodyBytes: 'MAX_BODY_BYTES', maxFrameBytes: 'MAX_FRAME_BYTES', maxBufferedBytes: 'MAX_BUFFERED_BYTES', createPerMinute: 'CREATE_PER_MINUTE', joinPerMinute: 'JOIN_PER_MINUTE', actionsPerMinute: 'ACTIONS_PER_MINUTE', connectionsPerMinute: 'CONNECTIONS_PER_MINUTE', framesPerMinute: 'FRAMES_PER_MINUTE', refreshPerMinute: 'REFRESH_PER_MINUTE', healthPerMinute: 'HEALTH_PER_MINUTE', authTimeoutMs: 'AUTH_TIMEOUT_MS', maxRequests: 'MAX_REQUESTS', readinessIntervalMs: 'READINESS_INTERVAL_MS', readinessMaxAgeMs: 'READINESS_MAX_AGE_MS' });

function validatedLimits(configured, production) {
  const ceiling = production ? PRODUCTION_LIMITS : DEFAULT_LIMITS;
  const limits = { ...ceiling, ...configured };
  for (const [key, value] of Object.entries(limits)) {
    // Development fixtures can deliberately lower bounds; production cannot
    // silently exceed the launch policy by bypassing the executable's parser.
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > (production ? ceiling[key] : 1_000_000)) throw new Error(`Invalid live resource limit: ${key}`);
  }
  if (limits.maxPlayers < 2 || limits.maxPlayers > (production ? 12 : 50)) throw new Error('Invalid live resource limit: maxPlayers');
  if (production && limits.maxPlayers !== 12) throw new Error('The production launch player ceiling is fixed at 12');
  if (limits.readinessIntervalMs < 1000) throw new Error('Readiness probes must be at least one second apart');
  if (limits.readinessMaxAgeMs < limits.readinessIntervalMs * 2) throw new Error('Readiness max age must allow two probe intervals');
  if (production && (limits.maxSocketsPerRoom < limits.maxPlayers + 1 || limits.maxSockets < limits.maxSocketsPerRoom)) throw new Error('Socket ceilings must accommodate the configured room and dedicated host');
  if (production && (limits.maxBodyBytes < 512 || limits.maxFrameBytes < 256 || limits.maxBufferedBytes < 16_384 || limits.authTimeoutMs < 1000)) throw new Error('Production protocol resource bounds are too small');
  return limits;
}

export function readServiceConfiguration(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const configured = {};
  for (const [key, suffix] of Object.entries(LIMIT_ENV)) {
    const name = `LIKERTS_LIVE_${suffix}`, text = environment[name];
    if (text === undefined || text === '') continue;
    if (typeof text !== 'string' || !/^[0-9]+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error(`Use an integer for ${name}`);
    configured[key] = Number(text);
  }
  const limits = validatedLimits(configured, production);
  if (limits.maxRooms > 100_000) throw new Error('Invalid live resource limit: maxRooms');
  const portText = environment.PORT || environment.LIKERTS_LIVE_PORT || '4311';
  if (typeof portText !== 'string' || !/^[0-9]+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new Error('Use a valid live-game port');
  const host = environment.LIKERTS_LIVE_BIND_ADDRESS || '127.0.0.1';
  if (typeof host !== 'string' || !/^[A-Za-z0-9.:_-]+$/.test(host) || (!production && !['127.0.0.1', '::1', 'localhost'].includes(host))) throw new Error('Use an approved live-game bind address');
  const databaseURL = environment.LIKERTS_LIVE_DATABASE_URL || undefined;
  const sqlitePath = environment.LIKERTS_LIVE_SQLITE_PATH || undefined;
  if (production ? !databaseURL : !databaseURL && !sqlitePath) throw new Error('Configure dedicated persistent live-game storage');
  const origins = (environment.LIKERTS_LIVE_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const publicOrigin = environment.LIKERTS_LIVE_PUBLIC_ORIGIN || null;
  if (production && (!publicOrigin || !publicOrigin.startsWith('https://') || !origins.includes(publicOrigin))) throw new Error('Configure an explicit allowed HTTPS public game origin');
  return { production, limits, host, port: Number(portText), databaseURL, sqlitePath, origins, publicOrigin };
}
export const canSend = (bufferedAmount, payloadBytes, maximum) => Number.isSafeInteger(bufferedAmount) && bufferedAmount >= 0 && Number.isSafeInteger(payloadBytes) && payloadBytes >= 0 && bufferedAmount + payloadBytes <= maximum;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const ALLOWED_METHODS = 'GET, POST, OPTIONS';

class Budgets {
  entries = new Map();
  consume(key, maximum, now) {
    const window = Math.floor(now / 60_000);
    let entry = this.entries.get(key);
    if (!entry || entry.window !== window) {
      if (this.entries.size >= 10_000) for (const [id, value] of this.entries) if (value.window !== window) this.entries.delete(id);
      if (this.entries.size >= 10_000 && !this.entries.has(key)) fail('rate_limited', 'Please wait before trying again.', 429);
      entry = { window, count: 0 }; this.entries.set(key, entry);
    }
    if (entry.count >= maximum) fail('rate_limited', 'Please wait before trying again.', 429);
    entry.count++;
  }
}

function admissionFields(body) {
  if (!isObject(body) || !uuid(body.admissionId) || typeof body.recoverySecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.recoverySecret)) fail('invalid_admission', 'Use a valid private admission recovery credential.');
  return { admissionId: body.admissionId.toLowerCase(), secretHash: sha(body.recoverySecret) };
}

async function readJSON(request, maximum, { legacyMaximum } = {}) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) fail('unsupported_media_type', 'Send a JSON request.', 415);
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maximum)) { request.resume(); fail('body_too_large', 'This request is too large.', 413); }
  const buffers = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximum) { request.resume(); fail('body_too_large', 'This request is too large.', 413); }
    buffers.push(chunk);
  }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(buffers))); } catch { fail('invalid_json', 'Send a valid JSON request.'); }
  if (!isObject(body)) fail('invalid_json', 'Send a JSON object.');
  if (legacyMaximum !== undefined && body.mode !== 'quiz' && bytes > legacyMaximum) fail('body_too_large', 'This request is too large.', 413);
  return body;
}

export async function createLiveServer({ store, catalogue, origins = [], allowNoOrigin = true, now = () => Date.now(), limits: configured = {}, production = false, publicOrigin = null, webRoot = fileURLToPath(new URL('../web/', import.meta.url)), resolveClientAddress = request => request.socket.remoteAddress ?? 'unknown' } = {}) {
  if (!store || typeof store.transact !== 'function' || typeof store.admit !== 'function' || typeof store.consumeBudget !== 'function') throw new Error('A durable live-game store with atomic admissions and shared budgets is required');
  validateCatalogue(catalogue);
  if (typeof resolveClientAddress !== 'function') throw new Error('A pure client-address resolver is required');
  if (production && store.kind !== 'postgres') throw new Error('Production requires the dedicated PostgreSQL adapter');
  const limits = validatedLimits(configured, production);
  if (store.maxLeasesPerRoom !== undefined && limits.maxSocketsPerRoom > store.maxLeasesPerRoom) throw new Error('The configured room socket ceiling exceeds the durable store lease ceiling');
  const allowed = new Set(origins);
  for (const origin of allowed) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('Use exact allowed HTTP(S) origins'); }
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol) || (production && parsed.protocol !== 'https:')) throw new Error('Use exact allowed HTTP(S) origins');
  }
  if (production && !allowed.size) throw new Error('Production requires an explicit browser Origin allowlist');
  if (publicOrigin !== null && (!allowed.has(publicOrigin) || (production && !publicOrigin.startsWith('https://')))) throw new Error('The public game origin must be an exact allowed origin');
  if (production && publicOrigin === null) throw new Error('Production requires an explicit HTTPS public origin');
  const budgets = new Budgets(), sockets = new Set(), known = new Set();
  let closing = false, closePromise = null, listening = null, runningTick = null, listenOrigin = null;
  const activeRequests = new Set(), activeUpgrades = new Set(), upgradeSockets = new Set(), activeBroadcasts = new Set();
  const requireRunning = () => { if (closing) fail('service_unavailable', 'The game service is temporarily unavailable.', 503); };
  const clientAddress = request => {
    const address = resolveClientAddress(request);
    if (typeof address !== 'string' || address.length > 64 || (!isIP(address) && address !== 'unknown')) fail('invalid_request', 'Use a valid game request.', 400);
    return address;
  };
  let readiness = { ready: false, checkedAt: null, rooms: null }, readinessProbe = null;
  function probeReadiness() {
    if (readinessProbe) return readinessProbe;
    readinessProbe = (async () => {
      try {
        const rooms = await store.count();
        if (!Number.isSafeInteger(rooms) || rooms < 0) throw new Error('Invalid aggregate readiness');
        readiness = { ready: true, checkedAt: now(), rooms };
      } catch { readiness = { ready: false, checkedAt: now(), rooms: null }; }
    })().finally(() => { readinessProbe = null; });
    return readinessProbe;
  }
  // One startup probe and a bounded single-flight background cadence. Anonymous
  // health requests read this snapshot only; they never issue store queries.
  await probeReadiness();
  async function rate(scope, identity, maximum) {
    requireRunning();
    const key = sha(`${scope}:${identity}`), timestamp = now();
    budgets.consume(key, maximum, timestamp);
    await store.consumeBudget({ key, maximum, now: timestamp });
    requireRunning();
  }
  const peersByRoom = code => [...sockets].filter(peer => peer.authenticated && peer.code === code && peer.socket.readyState === WebSocket.OPEN);
  const headers = origin => ({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
  const originOf = request => {
    const origin = request.headers.origin;
    if (origin === undefined) { if (!allowNoOrigin) fail('origin_denied', 'Use an allowed game client.', 403); return null; }
    if (typeof origin !== 'string' || !allowed.has(origin)) fail('origin_denied', 'Use an allowed game client.', 403);
    return origin;
  };
  const respond = (response, status, payload, origin = null) => {
    if (response.destroyed || response.headersSent) return;
    response.writeHead(status, { ...headers(origin), ...(status === 429 ? { 'Retry-After': '60' } : {}) }); response.end(JSON.stringify(payload));
  };
  const bearer = request => {
    const value = request.headers.authorization;
    if (typeof value !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(value)) fail('unauthorized', 'A valid room credential is required.', 401);
    return value.slice(7);
  };
  const requireRoom = (room, timestamp) => {
    if (!room || timestamp >= room.expiresAt) return false;
    if (roomMode(room) !== 'quiz' && room.catalogHash !== catalogue.sha256) fail('catalogue_unavailable', 'This room’s reviewed catalogue is unavailable.', 503);
    return true;
  };
  const pruneLeases = (room, timestamp) => {
    for (const actor of [room.host, ...room.players]) {
      actor.socketLeases ??= {};
      for (const [id, expiry] of Object.entries(actor.socketLeases)) if (expiry <= timestamp) delete actor.socketLeases[id];
    }
  };
  async function snapshot(code, token, { presence = false, leaseId = null, reserve = false } = {}) {
    const result = await store.transact(code, room => {
      requireRunning();
      const timestamp = now();
      if (!requireRoom(room, timestamp)) return { room: null, changed: room !== null, value: { missing: true } };
      const id = identify(room, token);
      let changed = advance(room, timestamp);
      const actor = id === 'host' ? room.host : room.players.find(player => player.id === id);
      if (presence && timestamp - actor.lastSeen >= 5000) { touch(room, id, timestamp); room.revision++; changed = true; }
      if (leaseId) {
        pruneLeases(room, timestamp);
        // An expired/delayed renewal is a fresh reservation. It cannot bypass
        // another worker's replacement connections or the current credential.
        if (!Object.hasOwn(actor.socketLeases, leaseId)) {
          const total = [room.host, ...room.players].reduce((sum, item) => sum + Object.keys(item.socketLeases).length, 0);
          if (Object.keys(actor.socketLeases).length >= limits.maxSocketsPerMember || total >= limits.maxSocketsPerRoom) fail('connection_limit', 'This room has reached its connection limit.', 429);
        }
        actor.socketLeases[leaseId] = timestamp + 45_000; changed = true;
      }
      return { room, changed, value: { id, state: project(room, id, { catalogue, now: timestamp }) } };
    });
    if (result.value?.missing) { known.delete(code); fail('room_not_found', 'This room is unavailable or has expired.', 404); }
    known.add(code);
    return result.value;
  }
  function send(peer, payload) {
    if (peer.socket.readyState !== WebSocket.OPEN) return;
    const json = JSON.stringify(payload);
    if (!canSend(peer.socket.bufferedAmount, Buffer.byteLength(json), limits.maxBufferedBytes)) { peer.socket.close(1013, 'Client cannot keep up'); return; }
    peer.socket.send(json, error => { if (error) peer.socket.terminate(); });
  }
  async function refresh(peer, presence = false) {
    if (!peer.code || peer.socket.readyState !== WebSocket.OPEN) return;
    if (peer.refreshing) { peer.refreshAgain = true; return; }
    peer.refreshing = true;
    try {
      do {
        peer.refreshAgain = false;
        const result = await snapshot(peer.code, peer.token, { presence });
        send(peer, { type: 'state', state: result.state });
      } while (peer.refreshAgain && peer.socket.readyState === WebSocket.OPEN);
    } catch (error) { send(peer, { type: 'error', error: publicError(error).error }); peer.socket.close(1008, 'Room unavailable'); }
    finally { peer.refreshing = false; }
  }
  const pendingBroadcast = new Set();
  const dirtyBroadcast = new Set();
  const broadcastTimers = new Map();
  async function broadcast(code) {
    if (closing || !peersByRoom(code).length) return;
    dirtyBroadcast.add(code);
    if (pendingBroadcast.has(code)) return;
    pendingBroadcast.add(code);
    // A final-guess burst can commit dozens of independent locks together.
    // Read the durable room once per frame, then authorize/project each viewer.
    // Never broadcast this internal snapshot or a subject's projected payload.
    const timer = setTimeout(() => {
      broadcastTimers.delete(code); dirtyBroadcast.delete(code);
      const work = (async () => {
       try {
        if (closing || !peersByRoom(code).length) return;
        let timestamp;
        const result = await store.transact(code, room => {
          requireRunning(); timestamp = now();
          if (!requireRoom(room, timestamp)) return { room: null, changed: room !== null };
          return { room, changed: advance(room, timestamp) };
        });
        for (const peer of peersByRoom(code)) {
          try {
            if (!result.room) fail('room_not_found', 'This room is unavailable or has expired.', 404);
            const id = identify(result.room, peer.token);
            send(peer, { type: 'state', state: project(result.room, id, { catalogue, now: timestamp }) });
          } catch (error) { send(peer, { type: 'error', error: publicError(error).error }); peer.socket.close(1008, 'Room unavailable'); }
        }
      } catch {
        for (const peer of peersByRoom(code)) { send(peer, { type: 'error', error: { code: 'service_unavailable', message: 'The game service is temporarily unavailable.' } }); peer.socket.close(1013, 'Service unavailable'); }
       } finally {
        pendingBroadcast.delete(code);
        if (dirtyBroadcast.has(code) && !closing) void broadcast(code);
       }
      })();
      activeBroadcasts.add(work);
      void work.finally(() => { activeBroadcasts.delete(work); });
    }, 16);
    timer.unref(); broadcastTimers.set(code, timer);
  }
  const unsubscribe = store.subscribe(code => { void broadcast(code); });

  async function admit(kind, body, code) {
    const requestedAt = now(), fields = admissionFields(body);
    const recover = kind === 'recover';
    let payload;
    if (recover) {
      if (Object.keys(body).some(key => !['admissionId', 'recoverySecret'].includes(key))) fail('invalid_admission', 'Use a valid admission recovery request.');
    } else if (kind === 'create') {
      const quiz = body.mode !== undefined;
      if (Object.keys(body).some(key => !(quiz ? ['admissionId', 'recoverySecret', 'mode', 'modeVersion', 'quiz', 'settings'] : ['admissionId', 'recoverySecret', 'settings']).includes(key))) fail('invalid_settings', 'Choose valid room settings.');
      if (quiz && (body.mode !== 'quiz' || body.modeVersion !== 1)) fail('invalid_mode', 'Choose a supported quiz game version.');
      if (body.settings !== undefined && !isObject(body.settings)) fail('invalid_settings', 'Choose valid room settings.');
      const requestedSettings = { ...(body.settings ?? {}), ...(body.settings?.capacity === undefined ? { capacity: Math.min(12, limits.maxPlayers) } : {}) };
      const settings = quiz ? validateQuizSettings(requestedSettings) : validateSettings(requestedSettings, catalogue);
      if (settings.capacity > limits.maxPlayers) fail('capacity_unavailable', `This service supports up to ${limits.maxPlayers} players per room.`, 400);
      payload = quiz ? { kind, mode: 'quiz', modeVersion: 1, settings, quiz: normalizeLiveQuiz(body.quiz) } : { kind, settings };
    } else {
      if (Object.keys(body).some(key => !['admissionId', 'recoverySecret', 'nickname', 'acceptRoomSharing'].includes(key))) fail('invalid_admission', 'Use a valid room admission request.');
      payload = { kind, code, nickname: body.nickname, acceptRoomSharing: body.acceptRoomSharing };
    }
    const result = await store.admit({ ...fields, ...(payload ? { payloadHash: sha(JSON.stringify(payload)) } : {}), ...(code ? { code } : {}), now: requestedAt, maxRooms: limits.maxRooms, requireExisting: recover }, ({ room, admission }) => {
      requireRunning();
      const timestamp = now();
      const token = freshToken(); let id;
      if (admission) {
        if (timestamp >= admission.recoverUntil || timestamp >= admission.expiresAt || !requireRoom(room, timestamp)) fail('admission_unavailable', 'This admission can no longer be recovered.', 410);
        id = admission.memberId;
        const actor = id === 'host' ? room.host : room.players.find(player => player.id === id);
        if (!actor) fail('admission_unavailable', 'This admission can no longer be recovered.', 410);
        actor.tokenHash = tokenVerifier(token); actor.socketLeases = {}; touch(room, id, timestamp); room.revision++;
      } else if (kind === 'create') {
        const options = { catalogue, now: timestamp, token };
        const created = payload.mode === 'quiz' ? createQuizRoom(payload.quiz, payload.settings, options) : createRoom(payload.settings, options); room = created.room; id = 'host';
      } else {
        if (!requireRoom(room, timestamp)) fail('room_not_found', 'This room is unavailable or has expired.', 404);
        const joined = joinRoom(room, { nickname: body.nickname, acceptRoomSharing: body.acceptRoomSharing }, { token, now: timestamp }); room = joined.room; id = joined.memberId;
      }
      return { room, admission: { memberId: id }, value: { code: room.code, token, memberId: id, state: project(room, id, { catalogue, now: timestamp }) } };
    });
    known.add(result.room.code);
    return result.value;
  }

  async function staticFile(request, response, pathname) {
    if (request.method !== 'GET' && request.method !== 'HEAD') fail('method_not_allowed', 'Use GET for this page.', 405);
    let relative;
    try { relative = pathname === '/play' || pathname === '/play/' ? 'index.html'
      : pathname === '/play/quizzes' || pathname === '/play/quizzes/' ? 'quizzes.html'
      : decodeURIComponent(pathname.slice('/play/'.length)); } catch { fail('not_found', 'This page is unavailable.', 404); }
    if (!relative || relative.includes('\0') || relative.split(/[\\/]/).some(part => part.startsWith('.')) || relative.includes('\\')) fail('not_found', 'This page is unavailable.', 404);
    const type = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' }[extname(relative)];
    if (!type) fail('not_found', 'This page is unavailable.', 404);
    let file;
    try {
      const base = await realpath(webRoot); file = await realpath(resolve(base, relative));
      if (!file.startsWith(base + sep) || !(await stat(file)).isFile() || (await stat(file)).size > 8 * 1024 * 1024) fail('not_found', 'This page is unavailable.', 404);
    } catch { fail('not_found', 'This page is unavailable.', 404); }
    const websocketOrigin = (publicOrigin ?? listenOrigin)?.replace(/^http/, 'ws');
    response.writeHead(200, { ...headers(), 'Content-Type': `${type}; charset=utf-8`, 'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'${websocketOrigin ? ` ${websocketOrigin}` : ''}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` });
    response.end(request.method === 'HEAD' ? undefined : await readFile(file));
  }

  const server = createServer((request, response) => {
   const handling = (async () => {
    let origin;
    try {
      if (!request.url || request.url.length > 2048) fail('invalid_request', 'Use a valid game URL.');
      const url = new URL(request.url, 'http://live.invalid');
      if (url.pathname === '/play' || url.pathname.startsWith('/play/')) return await staticFile(request, response, url.pathname);
      if (!url.pathname.startsWith('/api/live/')) fail('not_found', 'This endpoint is unavailable.', 404);
      origin = originOf(request);
      if (request.method === 'OPTIONS') { response.writeHead(204, { ...headers(origin), 'Access-Control-Allow-Methods': ALLOWED_METHODS, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' }); return response.end(); }
      const address = clientAddress(request);
      if (request.method === 'GET' && ['/api/live/health', '/api/live/liveness'].includes(url.pathname)) {
        // Health only consumes local CPU/memory, so its local guard does not
        // call the durable admission store and amplify a probe flood into SQL.
        budgets.consume(sha(`health:${address}`), limits.healthPerMinute, now());
        if (url.pathname.endsWith('/liveness')) return respond(response, 200, { service: 'likerts-live', status: closing ? 'stopping' : 'ok' }, origin);
        const fresh = readiness.checkedAt !== null && now() - readiness.checkedAt <= limits.readinessMaxAgeMs;
        const ready = readiness.ready && fresh && !closing;
        return respond(response, ready ? 200 : 503, { service: 'likerts-live', status: ready ? 'ok' : 'unavailable', storage: store.kind, rooms: ready ? readiness.rooms : null, checkedAt: readiness.checkedAt }, origin);
      }
      requireRunning();
      if (request.method === 'GET' && url.pathname === '/api/live/catalogue') return respond(response, 200, { version: 1, sha256: catalogue.sha256, locale: 'en', topics: catalogue.topics.map(({ id, title }) => ({ id, title })), limits: { maxPlayers: limits.maxPlayers, defaultCapacity: Math.min(12, limits.maxPlayers) } }, origin);
      if (request.method === 'POST' && url.pathname === '/api/live/rooms') {
        await rate('create', address, limits.createPerMinute);
        return respond(response, 201, await admit('create', await readJSON(request, QUIZ_CREATE_MAX_BYTES, { legacyMaximum: limits.maxBodyBytes })), origin);
      }
      if (request.method === 'POST' && url.pathname === '/api/live/admissions/recover') {
        await rate('recover', address, limits.joinPerMinute);
        return respond(response, 200, await admit('recover', await readJSON(request, limits.maxBodyBytes)), origin);
      }
      const match = /^\/api\/live\/rooms\/([A-HJ-NP-Z2-9]{6})(?:\/(join|actions))?$/.exec(url.pathname);
      if (!match) fail('not_found', 'This endpoint is unavailable.', 404);
      const [, code, operation] = match;
      if (request.method === 'POST' && operation === 'join') {
        await rate('join', address, limits.joinPerMinute);
        return respond(response, 201, await admit('join', await readJSON(request, limits.maxBodyBytes), code), origin);
      }
      if (request.method === 'GET' && !operation) {
        await rate('read', address, limits.actionsPerMinute);
        return respond(response, 200, { state: (await snapshot(code, bearer(request), { presence: true })).state }, origin);
      }
      if (request.method === 'POST' && operation === 'actions') {
        await rate('actions', address, limits.actionsPerMinute);
        const token = bearer(request), command = validateCommand(await readJSON(request, limits.maxBodyBytes));
        const result = await store.transactCommand(code, { requestId: command.requestId, fingerprint: commandFingerprint(command), maxReceipts: limits.maxRequests, authorize(room) {
          requireRunning();
          if (!requireRoom(room, now())) return { terminal: { room: null, changed: room !== null, value: { missing: true } } };
          const revoked = revokedLeaveActor(room, token, command);
          return revoked ? { actorId: revoked, scope: 'revoked_leave' } : { actorId: identify(room, token), scope: 'active' };
        } }, (room, receiptContext) => {
          requireRunning(); const timestamp = now();
          if (!requireRoom(room, timestamp)) return { room: null, changed: room !== null, value: { missing: true } };
          if (receiptContext.scope === 'revoked_leave') {
            if (replayLeft(room, token, command, receiptContext)) return { room, changed: false, value: { state: null, left: true } };
            fail('unauthorized', 'A valid room credential is required.', 401);
          }
          const id = receiptContext.actorId, timed = advance(room, timestamp);
          try {
            const reduced = reduceRoom(room, id, command, { catalogue, now: timestamp, maxRequests: limits.maxRequests, receiptContext });
            const removed = reduced.room && id !== 'host' && !reduced.room.players.some(player => player.id === id);
            return { room: reduced.room, changed: timed || !reduced.replayed, recordReceipt: reduced.recordReceipt, value: reduced.closed ? { state: null, closed: true } : removed ? { state: null, left: true } : { state: project(reduced.room, id, { catalogue, now: timestamp }) } };
          } catch (error) { return { room, changed: timed, value: { rejected: error } }; }
        });
        if (result.value?.missing) fail('room_not_found', 'This room is unavailable or has expired.', 404);
        if (result.value?.rejected) throw result.value.rejected;
        if (result.room) known.add(code); else known.delete(code);
        return respond(response, 200, result.value, origin);
      }
      fail('method_not_allowed', 'Use the supported method for this endpoint.', 405);
    } catch (error) { const safe = publicError(error); respond(response, safe.status, { error: safe.error }, origin); }
   })();
   activeRequests.add(handling);
   void handling.finally(() => { activeRequests.delete(handling); }).catch(() => { response.destroy(); });
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 50;
  const websocket = new WebSocketServer({ noServer: true, autoPong: false, maxPayload: limits.maxFrameBytes, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
   upgradeSockets.add(socket);
   const upgrading = (async () => {
    try {
      requireRunning();
      if (new URL(request.url, 'http://live.invalid').pathname !== '/api/live/socket' || request.url.includes('?')) fail('not_found', 'Use the supported socket endpoint.', 404);
      originOf(request); const address = clientAddress(request); await rate('connections', address, limits.connectionsPerMinute);
      if (sockets.size >= limits.maxSockets) fail('connection_limit', 'The game service is at connection capacity.', 429);
      requireRunning();
      websocket.handleUpgrade(request, socket, head, connected => websocket.emit('connection', connected, address));
    } catch (error) { const safe = publicError(error); socket.end(`HTTP/1.1 ${safe.status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }
   })();
   activeUpgrades.add(upgrading);
   void upgrading.finally(() => { activeUpgrades.delete(upgrading); upgradeSockets.delete(socket); }).catch(() => { socket.destroy(); });
  });
  websocket.on('connection', (socket, address) => {
    const peer = { socket, address, id: randomUUID(), code: null, token: null, memberId: null, authenticated: false, alive: true, awaitingPong: false, refreshing: false, handling: false };
    sockets.add(peer);
    const timer = setTimeout(() => { if (!peer.code) socket.terminate(); }, limits.authTimeoutMs); timer.unref();
    socket.on('error', () => {});
    socket.on('ping', async bytes => {
      // Control frames bypass ws's message/maxPayload path. Do not echo any
      // unauthenticated ping, and bound authenticated replies with the same
      // durable member budget and queued-byte guard as data frames.
      if (!peer.code || peer.handling || closing) { socket.terminate(); return; }
      peer.handling = true;
      try {
        await rate('frames', `${peer.code}:${peer.memberId}`, limits.framesPerMinute);
        if (socket.readyState !== WebSocket.OPEN) return;
        if (!canSend(socket.bufferedAmount, bytes.length + 2, limits.maxBufferedBytes)) { socket.terminate(); return; }
        socket.pong(bytes, undefined, error => { if (error) socket.terminate(); });
      } catch { socket.terminate(); }
      finally { peer.handling = false; }
    });
    socket.on('pong', () => {
      if (!peer.awaitingPong) return; peer.awaitingPong = false; peer.alive = true;
      if (peer.code) void snapshot(peer.code, peer.token, { presence: true, leaseId: peer.id }).catch(() => socket.close(1008, 'Room unavailable'));
    });
    socket.on('message', async (bytes, binary) => {
      if (peer.handling) { socket.close(1008, 'Wait for the current frame'); return; }
      peer.handling = true;
      try {
        await rate('frames', peer.code ? `${peer.code}:${peer.memberId}` : peer.address, limits.framesPerMinute);
        if (binary || bytes.length > limits.maxFrameBytes) fail('invalid_frame', 'Send a bounded JSON frame.');
        let message;
        try { message = JSON.parse(bytes.toString('utf8')); } catch { fail('invalid_frame', 'Send a valid JSON frame.'); }
        if (!isObject(message)) fail('invalid_frame', 'Send a valid JSON frame.');
        if (!peer.code) {
          if (message.type !== 'authenticate' || Object.keys(message).some(key => !['type', 'code', 'token'].includes(key)) || !validCode(message.code)) fail('unauthorized', 'Authenticate with a valid room credential.', 401);
          const result = await snapshot(message.code, message.token, { presence: true, leaseId: peer.id, reserve: true });
          peer.code = message.code; peer.token = message.token; peer.memberId = result.id; clearTimeout(timer);
          if (socket.readyState !== WebSocket.OPEN) {
            await store.transact(peer.code, room => {
              const actor = room && (peer.memberId === 'host' ? room.host : room.players.find(player => player.id === peer.memberId));
              if (!actor?.socketLeases?.[peer.id]) return { room, changed: false };
              delete actor.socketLeases[peer.id]; return { room, changed: true };
            });
            return;
          }
          // A published state means this connection can accept its next frame.
          // Keep broadcasts out until the follow-up revalidates the credential;
          // otherwise an early state can race this still-running auth handler.
          await refresh(peer);
          if (socket.readyState === WebSocket.OPEN) {
            peer.authenticated = true;
            // Repair notifications that arrived while this subscriber was pending.
            void broadcast(peer.code);
          }
        } else {
          if (message.type !== 'refresh' || Object.keys(message).length !== 1) fail('invalid_frame', 'Commands use the authenticated HTTP endpoint.');
          await rate('refresh', `${peer.code}:${peer.memberId}`, limits.refreshPerMinute);
          await refresh(peer, true);
        }
      } catch (error) { send(peer, { type: 'error', error: publicError(error).error }); if (!peer.code || ['unauthorized', 'connection_limit', 'rate_limited'].includes(error?.code)) socket.close(1008, 'Room unavailable'); }
      finally { peer.handling = false; }
    });
    socket.on('close', () => {
      clearTimeout(timer); sockets.delete(peer);
      if (peer.code && !closing) void store.transact(peer.code, room => {
        const actor = room && (peer.memberId === 'host' ? room.host : room.players.find(player => player.id === peer.memberId));
        if (!actor?.socketLeases?.[peer.id]) return { room, changed: false };
        delete actor.socketLeases[peer.id]; return { room, changed: true };
      }).catch(() => {});
      peer.token = null;
    });
  });
  async function tick() {
    if (closing) return;
    if (runningTick) return runningTick;
    runningTick = (async () => {
      await store.cleanup(now(), 100);
      for (const code of [...known].slice(0, limits.maxRooms)) {
        const result = await store.transact(code, room => {
          if (!requireRoom(room, now())) return { room: null, changed: room !== null, value: false };
          const changed = advance(room, now()); return { room, changed, value: true };
        });
        if (!result.value) { known.delete(code); await broadcast(code); }
      }
    })().finally(() => { runningTick = null; });
    return runningTick;
  }
  const clock = setInterval(() => { void tick().catch(() => { /* read/action paths fail closed and health remains truthful */ }); }, 1000); clock.unref();
  const readinessClock = setInterval(() => { if (!closing) void probeReadiness(); }, limits.readinessIntervalMs); readinessClock.unref();
  const heartbeat = setInterval(() => {
    for (const peer of sockets) {
      if (!peer.alive) { peer.socket.terminate(); continue; }
      peer.alive = false; peer.awaitingPong = true; peer.socket.ping();
    }
    for (const code of new Set([...sockets].map(peer => peer.code).filter(Boolean))) void broadcast(code);
  }, 15_000); heartbeat.unref();
  return {
    server, limits, tick, probeReadiness,
    async listen({ host = '127.0.0.1', port = 0 } = {}) {
      if (closing) throw new Error('This live transport is closed');
      if (listening || server.listening) throw new Error('This live transport is already listening');
      listening = new Promise((resolveListen, reject) => {
        const failed = error => { server.off('listening', started); reject(error); };
        const started = () => { server.off('error', failed); resolveListen(); };
        server.once('error', failed); server.once('listening', started); server.listen(port, host);
      });
      try { await listening; } finally { listening = null; }
      if (closing) throw new Error('This live transport is closed');
      const address = server.address(); const hostname = host.includes(':') ? `[${host}]` : host;
      listenOrigin = `http://${hostname}:${address.port}`;
      if (!production && !allowed.size && ['127.0.0.1', 'localhost', '::1'].includes(host)) allowed.add(listenOrigin);
      return { origin: listenOrigin, port: address.port };
    },
    async close() {
      if (closePromise) return closePromise;
      closing = true; unsubscribe(); clearInterval(clock); clearInterval(heartbeat);
      clearInterval(readinessClock);
      for (const timer of broadcastTimers.values()) clearTimeout(timer); broadcastTimers.clear();
      for (const socket of upgradeSockets) socket.destroy();
      for (const peer of sockets) peer.socket.terminate();
      closePromise = (async () => {
        await listening?.catch(() => {});
        await runningTick?.catch(() => {});
        await readinessProbe;
        await Promise.allSettled([...activeRequests, ...activeUpgrades, ...activeBroadcasts]);
        await new Promise(resolveClose => websocket.close(resolveClose));
        if (server.listening) await new Promise(resolveClose => { server.close(resolveClose); server.closeAllConnections(); });
      })();
      return closePromise;
    },
  };
}
