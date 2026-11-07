import { mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { runPostgres, runSQLite, loadRoom, persistRoom, legacyReceipts, migrateStorage, validateCommandDescriptor, commandContext } from './storage-v3.mjs';

// Only the game-specific connection string is consulted. In particular, never
// fall back to the survey service's DATABASE_URL.
const CHANNEL = 'likerts_live_changes';
const QUOTA_LOCK = 194718103;
const BUDGET_QUOTA_LOCK = 194718104;
const CODE = /^[A-Z2-9]{6}$/;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const RECOVERY_WINDOW = 10 * 60_000;
const ADMISSION_LIFE = 6 * 60 * 60_000;
const MAX_RECOVERIES = 20;
const MAX_ACTIVE_BUDGETS = 10_000;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function configuration(message) {
  return failure('configuration_error', message);
}

function storageFailure(diagnostic) {
  // Drivers can put SQL, database URLs and hostnames in their error messages.
  // Keep those out of HTTP responses and ordinary application logs.
  const error = failure('storage_unavailable', 'Live room storage is temporarily unavailable.');
  if (diagnostic) error.diagnostic = Object.freeze(diagnostic);
  return error;
}

function postgresDiagnostic(error, phase, pool, elapsedMs) {
  // Match installed pg's fixed timeout messages only to produce enums. Never
  // retain the message, cause, SQL, parameters, URL or an arbitrary error code.
  const states = {
    '55P03': 'lock_unavailable', '40P01': 'deadlock', '40001': 'serialization_failure',
    '57014': 'query_canceled', '53300': 'connection_capacity', '42501': 'permission_denied',
    '28P01': 'authentication_failed', '3D000': 'database_unavailable',
    '08000': 'connection_failure', '08003': 'connection_failure', '08006': 'connection_failure',
    '57P01': 'server_shutdown',
  };
  const sqlState = Object.hasOwn(states, error?.code) ? error.code : null;
  let kind = sqlState ? states[sqlState] : 'unknown';
  if (phase === 'acquire' && error?.message === 'timeout exceeded when trying to connect') kind = 'pool_acquire_timeout';
  else if (phase === 'acquire' && ['Connection terminated due to connection timeout', 'timeout expired'].includes(error?.message)) kind = 'connection_timeout';
  else if (error?.message === 'Query read timeout') kind = 'query_timeout';
  else if (['Connection terminated unexpectedly', 'Client has encountered a connection error and is not queryable'].includes(error?.message)) kind = 'connection_failure';
  else if (sqlState === '55P03' && error?.message === 'canceling statement due to lock timeout') kind = 'lock_timeout';
  else if (sqlState === '57014' && error?.message === 'canceling statement due to statement timeout') kind = 'statement_timeout';
  else if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)) kind = 'connection_failure';
  const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0;
  return {
    phase, kind, sqlState, elapsedMs: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(elapsedMs))),
    pool: Object.freeze({ total: count(pool?.totalCount), idle: count(pool?.idleCount), waiting: count(pool?.waitingCount) }),
  };
}

function serialized(room) {
  if (!room || !CODE.test(room.code) || !Number.isSafeInteger(room.revision)
    || room.revision < 0 || !Number.isSafeInteger(room.expiresAt) || room.expiresAt < 0) {
    throw configuration('Room persistence requires a valid code, revision and expiry.');
  }
  let json;
  try { json = JSON.stringify(room); } catch { throw configuration('Room state must be JSON serializable.'); }
  if (Buffer.byteLength(json) > MAX_STATE_BYTES) {
    throw failure('room_limit', 'This room has reached its storage limit.');
  }
  return json;
}

function clone(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function newRoomInstance(room) {
  const next = clone(room);
  if (!next || typeof next !== 'object') throw configuration('A new room object is required.');
  if (next.instanceId === undefined) next.instanceId = randomUUID();
  if (!UUID.test(next.instanceId ?? '')) throw configuration('A room instance must be a UUID.');
  next.instanceId = next.instanceId.toLowerCase();
  return next;
}

function mutation(callback, original) {
  const result = callback(clone(original));
  if (result && typeof result.then === 'function') {
    // Reject asynchronous reducers, including their rejected Promise, without
    // introducing an unhandled rejection after the transaction has rolled back.
    Promise.resolve(result).catch(() => {});
  }
  if (!result || typeof result !== 'object' || typeof result.then === 'function'
    || typeof result.changed !== 'boolean' || !Object.hasOwn(result, 'room')) {
    throw configuration('Room transaction callbacks must synchronously return {room, value, changed}.');
  }
  if (result.recordReceipt !== undefined && typeof result.recordReceipt !== 'boolean') throw configuration('A command journal intent must be boolean.');
  if (!result.changed) return { room: clone(original), value: result.value, changed: false, recordReceipt: result.recordReceipt ?? false };
  if (original === null && result.room !== null) {
    throw configuration('Use create to insert a new room.');
  }
  if (result.room !== null) {
    if (result.room.code !== original.code) throw configuration('A room code cannot change in a transaction.');
    if (result.room.instanceId !== original.instanceId) throw configuration('A room instance cannot change in a transaction.');
    serialized(result.room);
  }
  return { room: clone(result.room), value: result.value, changed: true, recordReceipt: result.recordReceipt ?? false };
}

function* roomTransaction(code, callback, enter, leave, now, descriptor, maxLeasesPerRoom) {
  const original = yield* loadRoom(code, { maxLeasesPerRoom });
  const context = descriptor ? yield* commandContext(original, descriptor, enter, leave) : null;
  enter();
  const result = mutation(room => context?.terminal ?? callback(room, context), original);
  leave();
  if (result.recordReceipt && (!descriptor || context?.scope !== 'active' || context.existingFingerprint !== null || !result.room || !result.changed || context.receiptCount >= descriptor.maxReceipts)) throw configuration('Invalid durable command journal intent.');
  if (original?.storageVersion === 3 && result.room && (result.room.requests !== undefined || result.room.receiptCount !== original.receiptCount)) throw configuration('Command receipts are owned by the durable journal.');
  if (result.changed) yield* persistRoom(original, result.room, { now, maxLeasesPerRoom, ...(result.recordReceipt ? { record: { actorId: context.actorId, requestId: context.requestId, fingerprint: context.fingerprint } } : {}) });
  return { ...result, oldRevision: original?.revision ?? 0 };
}

function admissionInput(options, clock) {
  if (!options || !UUID.test(options.admissionId ?? '') || !HASH.test(options.secretHash ?? '')
    || (options.payloadHash !== undefined && !HASH.test(options.payloadHash))
    || (!options.requireExisting && options.payloadHash === undefined)
    || (options.code !== undefined && !CODE.test(options.code))
    || (options.maxRooms !== undefined && (!Number.isSafeInteger(options.maxRooms) || options.maxRooms < 1 || options.maxRooms > 100_000))) {
    throw configuration('Admission requires a UUID, SHA-256 verifiers and an optional valid room code.');
  }
  const now = options.now ?? clock();
  if (!Number.isSafeInteger(now) || now < 0) throw configuration('Admission requires a valid timestamp.');
  return { ...options, admissionId: options.admissionId.toLowerCase(), now, requireExisting: Boolean(options.requireExisting) };
}

function budgetInput(options, clock) {
  const now = options?.now ?? clock();
  const windowMs = options?.windowMs ?? 60_000;
  if (!options || !HASH.test(options.key ?? '') || !Number.isSafeInteger(options.maximum)
    || options.maximum < 1 || options.maximum > 100_000 || !Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 60 * 60_000) {
    throw configuration('A shared budget requires a hashed key, bounded maximum, clock and window.');
  }
  const window = Math.floor(now / windowMs) * windowMs;
  if (!Number.isSafeInteger(window + windowMs)) throw configuration('The shared budget expiry exceeds the supported clock.');
  return { key: options.key, maximum: options.maximum, now, window, expiresAt: window + windowMs };
}

function rateLimited() {
  return failure('rate_limited', 'Too many live game requests. Please wait and try again.');
}

function admissionFromRow(row) {
  return row ? {
    admissionId: row.admission_id, secretHash: row.secret_hash, payloadHash: row.payload_hash,
    code: row.code, memberId: row.member_id, roomInstance: row.room_instance ?? null, createdAt: Number(row.created_at),
    recoverUntil: Number(row.recover_until), expiresAt: Number(row.expires_at), recoveries: Number(row.recoveries),
  } : null;
}

function admissionMember(room, id) {
  return id === 'host' ? room?.host : room?.players?.find(player => player.id === id);
}

function authorizeAdmission(input, admission, room) {
  if (!admission) {
    if (input.requireExisting) throw failure('admission_invalid', 'This admission cannot be recovered.');
    if (input.code && !room) throw failure('admission_unavailable', 'This room is no longer available.');
  } else {
    if (!timingSafeEqual(Buffer.from(input.secretHash, 'hex'), Buffer.from(admission.secretHash, 'hex'))) {
      throw failure('admission_invalid', 'This admission cannot be recovered.');
    }
    if ((input.payloadHash !== undefined && input.payloadHash !== admission.payloadHash)
      || (input.code !== undefined && input.code !== admission.code)) {
      throw failure('admission_conflict', 'This admission identifier was used for a different request.');
    }
    if (input.now >= admission.recoverUntil || input.now >= admission.expiresAt || !room
      || !UUID.test(admission.roomInstance ?? '') || !UUID.test(room.instanceId ?? '')
      || admission.roomInstance.toLowerCase() !== room.instanceId.toLowerCase()
      || !admissionMember(room, admission.memberId)) {
      throw failure('admission_unavailable', 'This admission is no longer available.');
    }
    if (admission.recoveries >= MAX_RECOVERIES) throw failure('admission_limit', 'This admission has reached its recovery limit.');
  }
  if (room && room.expiresAt <= input.now) throw failure('admission_unavailable', 'This room is no longer available.');
}

function admittedMutation(callback, input, originalRoom, originalAdmission) {
  authorizeAdmission(input, originalAdmission, originalRoom);
  let result = callback({ room: clone(originalRoom), admission: clone(originalAdmission) });
  if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
  if (!result || typeof result !== 'object' || typeof result.then === 'function' || !result.room || !result.admission) {
    throw configuration('Admission callbacks must synchronously return {room, admission: {memberId}, value}.');
  }
  result = { ...result, room: originalRoom ? clone(result.room) : newRoomInstance(result.room) };
  serialized(result.room);
  if ((originalRoom && result.room.code !== originalRoom.code) || (input.code && result.room.code !== input.code)) {
    throw configuration('An admission cannot change its room code.');
  }
  if (!UUID.test(result.room.instanceId ?? '')
    || (originalRoom && result.room.instanceId !== originalRoom.instanceId)) {
    throw configuration('An admission requires the current immutable room instance.');
  }
  const memberId = result.admission.memberId;
  const nextMember = admissionMember(result.room, memberId);
  if ((memberId !== 'host' && !UUID.test(memberId ?? '')) || !nextMember || !HASH.test(nextMember.tokenHash ?? '')) {
    throw configuration('An admission must refer to a current member with a one-way token verifier.');
  }
  if (originalAdmission && (memberId !== originalAdmission.memberId
    || nextMember.tokenHash === admissionMember(originalRoom, memberId)?.tokenHash)) {
    throw configuration('Recovery must rotate the existing member credential.');
  }
  const admission = originalAdmission
    ? { ...originalAdmission, recoveries: originalAdmission.recoveries + 1 }
    : {
      admissionId: input.admissionId, secretHash: input.secretHash, payloadHash: input.payloadHash,
      code: result.room.code, memberId, roomInstance: result.room.instanceId.toLowerCase(), createdAt: input.now,
      recoverUntil: input.now + RECOVERY_WINDOW,
      // Keep a tombstone after close/removal so a lost original request cannot
      // silently create another room/member. No raw token is retained.
      expiresAt: Math.max(input.now + RECOVERY_WINDOW, Math.min(result.room.hardExpiresAt ?? input.now + ADMISSION_LIFE, input.now + ADMISSION_LIFE)),
      recoveries: 0,
    };
  return { room: clone(result.room), admission, value: result.value, changed: true };
}

function admissionValues(record) {
  return [record.admissionId, record.secretHash, record.payloadHash, record.code, record.memberId,
    record.createdAt, record.recoverUntil, record.expiresAt, record.recoveries, record.roomInstance];
}

class Subscribers {
  listeners = new Set();
  closed = false;

  subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('A subscription callback is required.');
    if (this.closed) throw storageFailure();
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(code, revision) {
    if (!CODE.test(code) || !Number.isSafeInteger(revision) || revision < 0 || this.closed) return;
    for (const listener of this.listeners) {
      try { Promise.resolve(listener(code, revision)).catch(() => {}); } catch { /* subscribers cannot undo a commit */ }
    }
  }
}

class SQLiteStore extends Subscribers {
  tail = Promise.resolve();

  constructor(database, { maxRooms, now, maxLeasesPerRoom = 200 }) {
    super();
    this.database = database;
    this.maxRooms = maxRooms;
    this.maxLeasesPerRoom = maxLeasesPerRoom;
    this.now = now;
    this.kind = 'sqlite';
  }

  run(operation) {
    const queued = this.tail.then(() => {
      if (this.closed) throw storageFailure();
      return operation();
    });
    this.tail = queued.catch(() => {});
    return queued;
  }

  transaction(operation) {
    return this.run(() => {
      let insideCallback = false;
      try {
        this.database.exec('BEGIN IMMEDIATE');
        const value = operation(() => { insideCallback = true; }, () => { insideCallback = false; });
        this.database.exec('COMMIT');
        return value;
      } catch (error) {
        try { this.database.exec('ROLLBACK'); } catch { /* BEGIN can itself fail */ }
        // Domain validation errors must survive unchanged. Database errors must
        // not expose a database pathname or SQLite internals to the transport.
        if (insideCallback || ['room_exists', 'room_limit', 'rate_limited', 'configuration_error'].includes(error?.code)) throw error;
        throw storageFailure();
      }
    });
  }

  async create(room) {
    room = newRoomInstance(room);
    const json = serialized(room);
    const inserted = await this.transaction(() => {
      const current = this.database.prepare('SELECT expires_at FROM likerts_live_rooms WHERE code = ?').get(room.code);
      if (current && current.expires_at > this.now()) throw failure('room_exists', 'This room code is already in use.');
      if (current) this.database.prepare('DELETE FROM likerts_live_rooms WHERE code = ?').run(room.code);
      const { count } = this.database.prepare('SELECT count(*) AS count FROM likerts_live_rooms WHERE expires_at > ?').get(this.now());
      if (count >= this.maxRooms) throw failure('room_limit', 'Live rooms are at capacity. Please try again later.');
      runSQLite(persistRoom(null, room, { now: this.now(), initialReceipts: legacyReceipts(room), maxLeasesPerRoom: this.maxLeasesPerRoom }), this.database);
      return clone(room);
    });
    this.emit(room.code, room.revision);
    return inserted;
  }

  transact(code, callback) { return this.roomTransaction(code, callback); }

  transactCommand(code, descriptor, callback) { return this.roomTransaction(code, callback, validateCommandDescriptor(descriptor)); }

  async roomTransaction(code, callback, descriptor) {
    const { oldRevision, ...result } = await this.transaction((enter, leave) => runSQLite(roomTransaction(code, callback, enter, leave, this.now(), descriptor, this.maxLeasesPerRoom), this.database));
    if (result.changed) this.emit(code, result.room?.revision ?? oldRevision + 1);
    return result;
  }

  async admit(options, callback) {
    const input = admissionInput(options, this.now);
    const result = await this.transaction((enter, leave) => {
      const admission = admissionFromRow(this.database.prepare('SELECT * FROM likerts_live_admissions WHERE admission_id = ?').get(input.admissionId));
      const code = admission?.code ?? input.code;
      const original = code ? runSQLite(loadRoom(code, { maxLeasesPerRoom: this.maxLeasesPerRoom }), this.database) : null;
      enter();
      const result = admittedMutation(callback, input, original, admission);
      leave();
      if (!original) {
        const existing = this.database.prepare('SELECT code FROM likerts_live_rooms WHERE code = ?').get(result.room.code);
        if (existing) throw failure('room_exists', 'This room code is already in use.');
        const { count } = this.database.prepare('SELECT count(*) AS count FROM likerts_live_rooms WHERE expires_at > ?').get(input.now);
        if (count >= Math.min(this.maxRooms, input.maxRooms ?? this.maxRooms)) throw failure('room_limit', 'Live rooms are at capacity. Please try again later.');
      }
      if (!admission) {
        const { count } = this.database.prepare('SELECT count(*) AS count FROM likerts_live_admissions').get();
        if (count >= this.maxRooms * 64) throw failure('room_limit', 'Live admissions are at capacity. Please try again later.');
        this.database.prepare(`INSERT INTO likerts_live_admissions
          (admission_id, secret_hash, payload_hash, code, member_id, created_at, recover_until, expires_at, recoveries, room_instance)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...admissionValues(result.admission));
      } else {
        this.database.prepare('UPDATE likerts_live_admissions SET recoveries = ? WHERE admission_id = ?')
          .run(result.admission.recoveries, input.admissionId);
      }
      runSQLite(persistRoom(original, result.room, { now: this.now(), initialReceipts: original ? [] : legacyReceipts(result.room), maxLeasesPerRoom: this.maxLeasesPerRoom }), this.database);
      return result;
    });
    this.emit(result.room.code, result.room.revision);
    return result;
  }

  recover(options, callback) {
    return this.admit({ ...options, requireExisting: true }, callback);
  }

  consumeBudget(options) {
    const input = budgetInput(options, this.now);
    return this.transaction(() => {
      const row = this.database.prepare('SELECT count, maximum, expires_at FROM likerts_live_budgets WHERE budget_key = ? AND window_start = ?')
        .get(input.key, input.window);
      let count;
      let maximum = input.maximum;
      if (row) {
        maximum = Math.min(maximum, row.maximum);
        if (row.expires_at !== input.expiresAt || row.count >= maximum) throw rateLimited();
        count = row.count + 1;
        this.database.prepare('UPDATE likerts_live_budgets SET count = ?, maximum = ? WHERE budget_key = ? AND window_start = ?')
          .run(count, maximum, input.key, input.window);
      } else {
        this.database.prepare(`DELETE FROM likerts_live_budgets WHERE rowid IN
          (SELECT rowid FROM likerts_live_budgets WHERE budget_key = ? AND expires_at <= ? ORDER BY expires_at LIMIT 100)`)
          .run(input.key, input.now);
        // Include expired-but-not-yet-cleaned rows in the cardinality ceiling.
        // Otherwise a fresh set of hashed keys every minute could grow disk
        // indefinitely faster than the bounded cleanup scheduler can remove it.
        const current = this.database.prepare('SELECT count(*) AS count FROM likerts_live_budgets').get();
        if (current.count >= MAX_ACTIVE_BUDGETS) throw failure('room_limit', 'Live request admission is at capacity.');
        count = 1;
        this.database.prepare('INSERT INTO likerts_live_budgets (budget_key, window_start, count, maximum, expires_at) VALUES (?, ?, ?, ?, ?)')
          .run(input.key, input.window, count, maximum, input.expiresAt);
      }
      return { remaining: maximum - count, resetAt: input.expiresAt };
    });
  }

  async cleanup(now = this.now(), limit = 100) {
    checkCleanup(now, limit);
    const removed = await this.transaction(() => {
      this.database.prepare(`DELETE FROM likerts_live_budgets WHERE rowid IN
        (SELECT rowid FROM likerts_live_budgets WHERE expires_at <= ? ORDER BY expires_at, rowid LIMIT ?)`)
        .run(now, limit);
      this.database.prepare(`DELETE FROM likerts_live_admissions WHERE admission_id IN
        (SELECT admission_id FROM likerts_live_admissions WHERE expires_at <= ? ORDER BY expires_at, admission_id LIMIT ?)`)
        .run(now, limit);
      const rows = this.database.prepare('SELECT code, revision FROM likerts_live_rooms WHERE expires_at <= ? ORDER BY expires_at, code LIMIT ?').all(now, limit);
      const erase = this.database.prepare('DELETE FROM likerts_live_rooms WHERE code = ?');
      for (const row of rows) erase.run(row.code);
      return rows;
    });
    for (const row of removed) this.emit(row.code, row.revision + 1);
    return removed.length;
  }

  count() {
    return this.run(() => {
      try { return this.database.prepare('SELECT count(*) AS count FROM likerts_live_rooms WHERE expires_at > ?').get(this.now()).count; }
      catch { throw storageFailure(); }
    });
  }

  async close() {
    await this.tail;
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.database.close();
  }
}

export class PostgreSQLStore extends Subscribers {
  listener = null;
  listenerConnecting = null;
  listenerDispose = null;
  closing = null;
  reconnect = null;
  reconnectDelay = 250;
  guardedClients = new WeakSet();
  brokenClients = new WeakSet();

  constructor(pool, { maxRooms, now, maxLeasesPerRoom = 200 }) {
    super();
    this.pool = pool;
    this.maxRooms = maxRooms;
    this.maxLeasesPerRoom = maxLeasesPerRoom;
    this.now = now;
    this.kind = 'postgres';
    // Pool error events from idle connections otherwise crash Node. Application
    // queries still fail closed; no driver message or connection URL is logged.
    this.pool.on('error', () => {});
    // pg-pool removes its idle-client error listener while a connection is
    // checked out. Keep a separate lifetime listener before initialization so
    // an in-use socket loss rejects its query without an uncaught EventEmitter
    // error. A broken connection is always discarded when released.
    this.pool.on('connect', client => this.guardClient(client));
    this.pool.on('acquire', client => this.guardClient(client));
  }

  guardClient(client) {
    if (this.guardedClients.has(client) || typeof client.on !== 'function') return;
    this.guardedClients.add(client);
    const broken = this.brokenClients;
    client.on('error', () => { broken.add(client); });
    client.on('end', () => { broken.add(client); });
  }

  async initialize() {
    await this.transaction(async client => {
      // Cold workers must not race PostgreSQL's system-catalog entries while
      // initializing the same dedicated table for the first time.
      await client.query('SELECT pg_advisory_xact_lock($1)', [QUOTA_LOCK]);
      await client.query(`CREATE TABLE IF NOT EXISTS likerts_live_rooms (
        code text PRIMARY KEY CHECK (code ~ '^[A-Z2-9]{6}$'),
        state_json jsonb NOT NULL,
        revision bigint NOT NULL CHECK (revision >= 0),
        expires_at bigint NOT NULL,
        updated_at bigint NOT NULL
      )`);
      await client.query('CREATE INDEX IF NOT EXISTS likerts_live_rooms_expiry ON likerts_live_rooms (expires_at, code)');
      await client.query(`CREATE TABLE IF NOT EXISTS likerts_live_admissions (
        admission_id uuid PRIMARY KEY,
        secret_hash text NOT NULL CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
        payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
        code text NOT NULL,
        member_id text NOT NULL,
        room_instance uuid,
        created_at bigint NOT NULL,
        recover_until bigint NOT NULL,
        expires_at bigint NOT NULL,
        recoveries integer NOT NULL CHECK (recoveries BETWEEN 0 AND 20)
      )`);
      // Legacy rows remain NULL and fail closed. A timestamp or a reused code
      // cannot establish ownership of a later room instance.
      await client.query('ALTER TABLE likerts_live_admissions ADD COLUMN IF NOT EXISTS room_instance uuid');
      await client.query('CREATE INDEX IF NOT EXISTS likerts_live_admissions_expiry ON likerts_live_admissions (expires_at, admission_id)');
      await client.query(`CREATE TABLE IF NOT EXISTS likerts_live_budgets (
        budget_key text NOT NULL CHECK (budget_key ~ '^[a-f0-9]{64}$'),
        window_start bigint NOT NULL,
        count integer NOT NULL CHECK (count >= 1),
        maximum integer NOT NULL CHECK (maximum >= 1),
        expires_at bigint NOT NULL,
        PRIMARY KEY (budget_key, window_start)
      )`);
      await client.query('CREATE INDEX IF NOT EXISTS likerts_live_budgets_expiry ON likerts_live_budgets (expires_at, budget_key)');
      await runPostgres(migrateStorage({ postgres: true, maxLeasesPerRoom: this.maxLeasesPerRoom }), client);
    });
    await this.connectListener();
  }

  async connectListener() {
    if (this.closed || this.listener) return;
    if (this.listenerConnecting) return this.listenerConnecting;
    const started = performance.now();
    const connecting = (async () => {
      let dispose;
      try {
        const client = await this.pool.connect();
        let lost = false;
        dispose = () => {
          if (lost) return;
          lost = true;
          if (this.listener === client) this.listener = null;
          if (this.listenerDispose === dispose) this.listenerDispose = null;
          try { client.release(true); } catch { /* pool shutdown must still run */ }
        };
        if (this.closed) { dispose(); return; }
        this.listenerDispose = dispose;
        const disconnected = () => { dispose(); this.scheduleReconnect(); };
        client.on('error', disconnected);
        client.on('end', disconnected);
        client.on('notification', message => {
          if (lost || this.closed || this.listener !== client || message.channel !== CHANNEL || typeof message.payload !== 'string' || message.payload.length > 128) return;
          try {
            const value = JSON.parse(message.payload);
            if (value && Object.keys(value).length === 2) this.emit(value.code, value.revision);
          } catch { /* unrelated or malformed notification contains no trusted state */ }
        });
        await client.query(`LISTEN ${CHANNEL}`);
        if (this.closed || lost) { dispose(); return; }
        // A leased connection is not subscribed until PostgreSQL acknowledges
        // LISTEN. Only this connection can subsequently deliver notifications.
        this.listener = client;
        this.reconnectDelay = 250;
      } catch (error) {
        dispose?.(); this.scheduleReconnect();
        throw storageFailure(postgresDiagnostic(error, 'listen', this.pool, performance.now() - started));
      }
    })();
    this.listenerConnecting = connecting;
    try {
      await connecting;
    } finally {
      if (this.listenerConnecting === connecting) this.listenerConnecting = null;
      // A reconnect timer may already have fired while the original LISTEN
      // was awaiting its acknowledgement. A lost connection must leave a
      // future attempt scheduled after that single-flight operation settles.
      if (!this.closed && !this.listener) this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.closed || this.reconnect) return;
    this.reconnect = setTimeout(async () => {
      this.reconnect = null;
      try { await this.connectListener(); } catch { this.scheduleReconnect(); }
    }, this.reconnectDelay);
    this.reconnect.unref();
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5000);
  }

  async transaction(operation) {
    if (this.closed) throw storageFailure();
    let client;
    let insideCallback = false;
    let phase = 'acquire', discard = false, failed = false;
    const started = performance.now();
    try {
      client = await this.pool.connect();
      this.guardClient(client);
      phase = 'begin';
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      phase = 'configure';
      await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL likerts_live.storage_version = '3'");
      phase = 'operation';
      const value = await operation(client, () => { insideCallback = true; }, () => { insideCallback = false; });
      phase = 'commit';
      await client.query('COMMIT');
      return value;
    } catch (error) {
      failed = true;
      const diagnostic = postgresDiagnostic(error, phase, this.pool, performance.now() - started);
      let rollback = 'not_started';
      if (client) {
        try { await client.query('ROLLBACK'); rollback = 'succeeded'; }
        catch { rollback = 'failed'; discard = true; }
      }
      if (insideCallback || ['room_exists', 'room_limit', 'rate_limited', 'configuration_error'].includes(error?.code)) throw error;
      // A COMMIT response timeout cannot prove whether the commit happened.
      // The caller must resolve it with the original idempotent request ID.
      throw storageFailure({ ...diagnostic, rollback, outcome: !client ? 'not_started' : phase === 'commit' || rollback === 'failed' ? 'unknown' : 'rolled_back' });
    } finally {
      if (client) try { client.release(discard || this.brokenClients.has(client)); }
      catch (error) {
        if (!failed) throw storageFailure({ ...postgresDiagnostic(error, 'release', this.pool, performance.now() - started), rollback: 'not_started', outcome: 'committed' });
      }
    }
  }

  notify(client, code, revision) {
    return client.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ code, revision })]);
  }

  async create(room) {
    room = newRoomInstance(room);
    const json = serialized(room);
    const inserted = await this.transaction(async client => {
      // Admission and room insertion share a database transaction across workers.
      await client.query('SELECT pg_advisory_xact_lock($1)', [QUOTA_LOCK]);
      const current = await client.query('SELECT expires_at FROM likerts_live_rooms WHERE code = $1 FOR UPDATE', [room.code]);
      if (current.rows[0] && Number(current.rows[0].expires_at) > this.now()) throw failure('room_exists', 'This room code is already in use.');
      if (current.rows.length) await client.query('DELETE FROM likerts_live_rooms WHERE code = $1', [room.code]);
      const counts = await client.query('SELECT count(*) AS count FROM likerts_live_rooms WHERE expires_at > $1', [this.now()]);
      if (Number(counts.rows[0].count) >= this.maxRooms) throw failure('room_limit', 'Live rooms are at capacity. Please try again later.');
      await runPostgres(persistRoom(null, room, { now: this.now(), initialReceipts: legacyReceipts(room), maxLeasesPerRoom: this.maxLeasesPerRoom }), client);
      await this.notify(client, room.code, room.revision);
      return clone(room);
    });
    this.emit(room.code, room.revision);
    return inserted;
  }

  transact(code, callback) { return this.roomTransaction(code, callback); }

  transactCommand(code, descriptor, callback) { return this.roomTransaction(code, callback, validateCommandDescriptor(descriptor)); }

  async roomTransaction(code, callback, descriptor) {
    const { oldRevision, ...result } = await this.transaction(async (client, enter, leave) => {
      const result = await runPostgres(roomTransaction(code, callback, enter, leave, this.now(), descriptor, this.maxLeasesPerRoom), client);
      if (result.changed) await this.notify(client, code, result.room?.revision ?? result.oldRevision + 1);
      return result;
    });
    if (result.changed) this.emit(code, result.room?.revision ?? oldRevision + 1);
    return result;
  }

  async admit(options, callback) {
    const input = admissionInput(options, this.now);
    const result = await this.transaction(async (client, enter, leave) => {
      // Always take locks in this order: admission ID, global create quota,
      // admission row, room row. No transaction locks two room rows.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.admissionId]);
      await client.query('SELECT pg_advisory_xact_lock($1)', [QUOTA_LOCK]);
      const record = await client.query('SELECT * FROM likerts_live_admissions WHERE admission_id = $1 FOR UPDATE', [input.admissionId]);
      const admission = admissionFromRow(record.rows[0]);
      const code = admission?.code ?? input.code;
      const original = code ? await runPostgres(loadRoom(code, { maxLeasesPerRoom: this.maxLeasesPerRoom }), client) : null;
      enter();
      const result = admittedMutation(callback, input, original, admission);
      leave();
      if (!original) {
        const existing = await client.query('SELECT code FROM likerts_live_rooms WHERE code = $1', [result.room.code]);
        if (existing.rows.length) throw failure('room_exists', 'This room code is already in use.');
        const counts = await client.query('SELECT count(*) AS count FROM likerts_live_rooms WHERE expires_at > $1', [input.now]);
        if (Number(counts.rows[0].count) >= Math.min(this.maxRooms, input.maxRooms ?? this.maxRooms)) throw failure('room_limit', 'Live rooms are at capacity. Please try again later.');
      }
      if (!admission) {
        const counts = await client.query('SELECT count(*) AS count FROM likerts_live_admissions');
        if (Number(counts.rows[0].count) >= this.maxRooms * 64) throw failure('room_limit', 'Live admissions are at capacity. Please try again later.');
        await client.query(`INSERT INTO likerts_live_admissions
          (admission_id, secret_hash, payload_hash, code, member_id, created_at, recover_until, expires_at, recoveries, room_instance)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, admissionValues(result.admission));
      } else {
        await client.query('UPDATE likerts_live_admissions SET recoveries = $1 WHERE admission_id = $2', [result.admission.recoveries, input.admissionId]);
      }
      await runPostgres(persistRoom(original, result.room, { now: this.now(), initialReceipts: original ? [] : legacyReceipts(result.room), maxLeasesPerRoom: this.maxLeasesPerRoom }), client);
      await this.notify(client, result.room.code, result.room.revision);
      return result;
    });
    this.emit(result.room.code, result.room.revision);
    return result;
  }

  recover(options, callback) {
    return this.admit({ ...options, requireExisting: true }, callback);
  }

  consumeBudget(options) {
    const input = budgetInput(options, this.now);
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':budget', 0))", [input.key]);
      // Keep the per-key lock, including across window rollover and quota
      // cleanup. Consume only a matching existing row in one statement; a
      // missing or rejected row follows the original locked validation path.
      // SQL/COMMIT errors propagate; they are never treated as a cache miss.
      const consumed = await client.query(`UPDATE likerts_live_budgets
        SET count = count + 1, maximum = LEAST(maximum, $3)
        WHERE budget_key = $1 AND window_start = $2 AND expires_at = $4
          AND count < LEAST(maximum, $3)
        RETURNING count, maximum`, [input.key, input.window, input.maximum, input.expiresAt]);
      if (consumed.rows.length) {
        const row = consumed.rows[0];
        return { remaining: Number(row.maximum) - Number(row.count), resetAt: input.expiresAt };
      }
      const query = await client.query('SELECT count, maximum, expires_at FROM likerts_live_budgets WHERE budget_key = $1 AND window_start = $2 FOR UPDATE',
        [input.key, input.window]);
      const row = query.rows[0];
      let count;
      let maximum = input.maximum;
      if (row) {
        maximum = Math.min(maximum, row.maximum);
        if (Number(row.expires_at) !== input.expiresAt || row.count >= maximum) throw rateLimited();
        count = row.count + 1;
        await client.query('UPDATE likerts_live_budgets SET count = $1, maximum = $2 WHERE budget_key = $3 AND window_start = $4',
          [count, maximum, input.key, input.window]);
      } else {
        await client.query('SELECT pg_advisory_xact_lock($1)', [BUDGET_QUOTA_LOCK]);
        await client.query(`WITH expired AS (
          SELECT budget_key, window_start FROM likerts_live_budgets WHERE budget_key = $1 AND expires_at <= $2
          ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
        ) DELETE FROM likerts_live_budgets AS budgets USING expired
          WHERE budgets.budget_key = expired.budget_key AND budgets.window_start = expired.window_start`, [input.key, input.now]);
        const current = await client.query('SELECT count(*) AS count FROM likerts_live_budgets');
        if (Number(current.rows[0].count) >= MAX_ACTIVE_BUDGETS) throw failure('room_limit', 'Live request admission is at capacity.');
        count = 1;
        await client.query('INSERT INTO likerts_live_budgets (budget_key, window_start, count, maximum, expires_at) VALUES ($1, $2, $3, $4, $5)',
          [input.key, input.window, count, maximum, input.expiresAt]);
      }
      return { remaining: maximum - count, resetAt: input.expiresAt };
    });
  }

  async cleanup(now = this.now(), limit = 100) {
    checkCleanup(now, limit);
    const removed = await this.transaction(async client => {
      await client.query(`WITH expired AS (
        SELECT budget_key, window_start FROM likerts_live_budgets WHERE expires_at <= $1
        ORDER BY expires_at, budget_key LIMIT $2 FOR UPDATE SKIP LOCKED
      ) DELETE FROM likerts_live_budgets AS budgets USING expired
        WHERE budgets.budget_key = expired.budget_key AND budgets.window_start = expired.window_start`, [now, limit]);
      // Admissions are locked before rooms, matching admit's row-lock order.
      await client.query(`WITH expired AS (
        SELECT admission_id FROM likerts_live_admissions WHERE expires_at <= $1
        ORDER BY expires_at, admission_id LIMIT $2 FOR UPDATE SKIP LOCKED
      ) DELETE FROM likerts_live_admissions AS admissions USING expired
        WHERE admissions.admission_id = expired.admission_id`, [now, limit]);
      const result = await client.query(`WITH expired AS (
        SELECT code FROM likerts_live_rooms WHERE expires_at <= $1
        ORDER BY expires_at, code LIMIT $2 FOR UPDATE SKIP LOCKED
      ) DELETE FROM likerts_live_rooms AS rooms USING expired
        WHERE rooms.code = expired.code RETURNING rooms.code, rooms.revision`, [now, limit]);
      for (const row of result.rows) await this.notify(client, row.code, Number(row.revision) + 1);
      return result.rows;
    });
    for (const row of removed) this.emit(row.code, Number(row.revision) + 1);
    return removed.length;
  }

  async count() {
    if (this.closed) throw storageFailure();
    try {
      const result = await this.pool.query('SELECT count(*) AS count FROM likerts_live_rooms WHERE expires_at > $1', [this.now()]);
      return Number(result.rows[0].count);
    } catch { throw storageFailure(); }
  }

  async close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.listeners.clear();
    clearTimeout(this.reconnect);
    this.reconnect = null;
    this.closing = (async () => {
      this.listenerDispose?.();
      await this.listenerConnecting?.catch(() => {});
      try { await this.pool.end(); } catch { throw storageFailure(); }
    })();
    return this.closing;
  }
}

function checkCleanup(now, limit) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw configuration('Cleanup requires a valid timestamp and a limit between 1 and 1000.');
  }
}

/**
 * Open isolated durable live-game storage. No process-memory authority exists.
 * SQLite is development-only and does not provide cross-worker notifications;
 * transports must periodically refresh as a recovery path for missed notices.
 * PostgreSQL delivers at-least-once, code/revision-only notifications. Callers
 * must re-read under transact and re-authorize every projected subscription.
 */
export async function openStore({
  sqlitePath,
  databaseURL = process.env.LIKERTS_LIVE_DATABASE_URL,
  production = process.env.NODE_ENV === 'production',
  maxRooms = 1000,
  maxLeasesPerRoom = production ? 26 : 200,
  now = () => Date.now(),
} = {}) {
  if (!Number.isSafeInteger(maxRooms) || maxRooms < 1 || maxRooms > 100_000 || typeof now !== 'function') {
    throw configuration('Live storage requires a bounded room capacity and a clock.');
  }
  if (!Number.isSafeInteger(maxLeasesPerRoom) || maxLeasesPerRoom < 1 || maxLeasesPerRoom > (production ? 26 : 200)) throw configuration('Use a reviewed bounded durable lease ceiling.');
  if (production && !databaseURL) throw configuration('Production live play requires LIKERTS_LIVE_DATABASE_URL.');
  if (databaseURL) {
    let parsed;
    try { parsed = new URL(databaseURL); } catch { throw configuration('The dedicated live database URL is invalid.'); }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
      throw configuration('The dedicated live database must use PostgreSQL.');
    }
    if (production && ([...parsed.searchParams.keys()].some(key =>
      key.toLowerCase() === 'ssl' || key.toLowerCase() === 'sslrejectunauthorized')
      || parsed.searchParams.getAll('sslmode').some(mode => mode !== 'verify-full'))) {
      throw configuration('Production live database connections require certificate-verified TLS.');
    }
    let store;
    try {
      const { Pool } = await import('pg');
      store = new PostgreSQLStore(new Pool({
        connectionString: databaseURL, max: 10, connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30_000, statement_timeout: 5000, query_timeout: 6000,
        application_name: 'likerts-live',
        ...(production ? { ssl: { rejectUnauthorized: true } } : {}),
      }), { maxRooms, now, maxLeasesPerRoom });
      await store.initialize();
      return store;
    } catch (error) {
      if (store) await store.close().catch(() => {});
      if (error?.code === 'storage_unavailable' && error.diagnostic) throw error;
      throw storageFailure({ ...postgresDiagnostic(error, 'initialize', store?.pool, 0), rollback: 'not_started', outcome: 'not_started' });
    }
  }
  if (typeof sqlitePath !== 'string' || !sqlitePath || sqlitePath.includes(':') || sqlitePath.includes('\0')) {
    throw configuration('Development live play requires an on-disk SQLite path.');
  }
  let database;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const path = resolve(sqlitePath);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Set restrictive permissions when creating the new room file; do not
    // change permissions of an existing user file or any keychain material.
    closeSync(openSync(path, 'a', 0o600));
    database = new DatabaseSync(path);
    database.function('likerts_live_storage_version', () => 3);
    database.exec(`PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS likerts_live_rooms (
        code TEXT PRIMARY KEY CHECK (length(code) = 6),
        state_json TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 0),
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS likerts_live_rooms_expiry ON likerts_live_rooms (expires_at, code);`);
    database.exec('BEGIN IMMEDIATE');
    database.exec(`CREATE TABLE IF NOT EXISTS likerts_live_admissions (
      admission_id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL CHECK (length(secret_hash) = 64),
      payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
      code TEXT NOT NULL,
      member_id TEXT NOT NULL,
      room_instance TEXT,
      created_at INTEGER NOT NULL,
      recover_until INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      recoveries INTEGER NOT NULL CHECK (recoveries BETWEEN 0 AND 20)
    );
    CREATE INDEX IF NOT EXISTS likerts_live_admissions_expiry ON likerts_live_admissions (expires_at, admission_id);`);
    if (!database.prepare('PRAGMA table_info(likerts_live_admissions)').all().some(column => column.name === 'room_instance')) {
      database.exec('ALTER TABLE likerts_live_admissions ADD COLUMN room_instance TEXT');
    }
    database.exec(`CREATE TABLE IF NOT EXISTS likerts_live_budgets (
      budget_key TEXT NOT NULL CHECK (length(budget_key) = 64),
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL CHECK (count >= 1),
      maximum INTEGER NOT NULL CHECK (maximum >= 1),
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (budget_key, window_start)
    );
    CREATE INDEX IF NOT EXISTS likerts_live_budgets_expiry ON likerts_live_budgets (expires_at, budget_key);`);
    runSQLite(migrateStorage({ maxLeasesPerRoom }), database);
    database.exec('COMMIT');
    return new SQLiteStore(database, { maxRooms, now, maxLeasesPerRoom });
  } catch {
    try { database?.exec('ROLLBACK'); } catch { /* no migration transaction */ }
    try { database?.close(); } catch { /* initialization failed */ }
    throw storageFailure();
  }
}
