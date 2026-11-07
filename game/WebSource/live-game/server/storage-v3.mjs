// Both durable adapters execute these same synchronous transaction programs.
// Programs yield SQL only; domain callbacks remain synchronous and execute
// after the authoritative room lock. No receipt history enters projections.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const actorID = value => value === 'host' || UUID.test(value ?? '');
const copy = value => value === null ? null : JSON.parse(JSON.stringify(value));
const query = (sql, params = []) => ({ sql, params });
const invalid = () => { throw Object.assign(new Error('Invalid normalized room storage.'), { code: 'configuration_error' }); };
const integer = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const parsed = value => typeof value === 'string' ? JSON.parse(value) : copy(value);
const actors = room => [room.host, ...(room.players ?? [])].filter(Boolean);
const leaseCeiling = value => { if (!Number.isSafeInteger(value) || value < 1 || value > 200) invalid(); return value; };

export async function runPostgres(program, client) {
  let step = program.next();
  while (!step.done) step = program.next(await client.query(step.value.sql, step.value.params));
  return step.value;
}
export function runSQLite(program, database) {
  let step = program.next();
  while (!step.done) {
    const params = [];
    const sql = step.value.sql.replace(/\$(\d+)/g, (_match, index) => { params.push(step.value.params[Number(index) - 1]); return '?'; }).replace(/::jsonb/g, '').replace(/ FOR UPDATE\b/g, '');
    step = program.next({ rows: database.prepare(sql).all(...params) });
  }
  return step.value;
}

export function legacyReceipts(room) {
  if (room.requests === undefined) return [];
  if (!room.requests || Array.isArray(room.requests) || typeof room.requests !== 'object') invalid();
  const entries = Object.entries(room.requests);
  if (entries.length > 1_000_000) invalid();
  return entries.map(([key, fingerprint]) => {
    const separator = key.indexOf(':');
    const actorId = key.slice(0, separator), requestId = key.slice(separator + 1);
    if (separator < 0 || !actorID(actorId) || !UUID.test(requestId) || !HASH.test(fingerprint)) invalid();
    return { actorId, requestId: requestId.toLowerCase(), fingerprint };
  });
}
function parts(room) {
  if (!room || !UUID.test(room.instanceId ?? '') || !Number.isSafeInteger(room.revision) || room.revision < 0 || !Number.isSafeInteger(room.expiresAt) || room.expiresAt < 0 || room.lastActivityAt !== undefined && (!Number.isSafeInteger(room.lastActivityAt) || room.lastActivityAt < 0)) invalid();
  const semantic = copy(room), members = [], leases = [];
  if (actors(semantic).length > 51) invalid();
  for (const actor of actors(semantic)) {
    const lastSeen = actor.lastSeen === undefined ? 0 : actor.lastSeen;
    if (!actorID(actor.id) || !Number.isSafeInteger(lastSeen) || lastSeen < 0 || !HASH.test(actor.tokenHash ?? '')) invalid();
    members.push({ actorId: actor.id, lastSeen, verifier: actor.tokenHash });
    for (const [leaseId, expiry] of Object.entries(actor.socketLeases ?? {})) {
      if (!UUID.test(leaseId) || !Number.isSafeInteger(expiry) || expiry < 0) invalid();
      leases.push({ actorId: actor.id, leaseId, verifier: actor.tokenHash, expiresAt: Number(expiry) });
    }
    delete actor.lastSeen; delete actor.socketLeases;
  }
  for (const key of ['instanceId', 'revision', 'expiresAt', 'lastActivityAt', 'requests', 'receiptCount', 'storageVersion']) delete semantic[key];
  return { semantic, members, leases, instanceId: room.instanceId.toLowerCase(), revision: Number(room.revision), expiresAt: Number(room.expiresAt), lastActivityAt: room.lastActivityAt === undefined ? null : Number(room.lastActivityAt) };
}

export function* loadRoom(code, { maxLeasesPerRoom = 200 } = {}) {
  leaseCeiling(maxLeasesPerRoom);
  const row = (yield query('SELECT state_json, instance_id, revision, expires_at, last_activity_at, receipt_count, storage_version FROM likerts_live_rooms WHERE code = $1 FOR UPDATE', [code])).rows[0];
  if (!row) return null;
  const room = parsed(row.state_json);
  if (!room || room.code !== code || ['requests', 'storageVersion', 'receiptCount', 'instanceId', 'revision', 'expiresAt', 'lastActivityAt'].some(key => Object.hasOwn(room, key))) invalid();
  if (Number(row.storage_version) !== 3 || !UUID.test(row.instance_id ?? '') || !integer(row.receipt_count) || !integer(row.revision) || !integer(row.expires_at) || row.last_activity_at !== null && !integer(row.last_activity_at)) invalid();
  Object.assign(room, { instanceId: row.instance_id, revision: Number(row.revision), expiresAt: Number(row.expires_at), receiptCount: Number(row.receipt_count), storageVersion: 3 });
  if (row.last_activity_at !== null) room.lastActivityAt = Number(row.last_activity_at);
  // Keep this a separate statement AFTER FOR UPDATE has completed. Folding it
  // into that initial lock statement could retain a pre-wait READ COMMITTED
  // child snapshot. One bounded post-lock read reduces a network round trip.
  const metadata = (yield query(`SELECT 'member' AS row_kind,actor_id,last_seen,verifier,NULL AS lease_id,NULL AS expires_at
    FROM (SELECT actor_id,last_seen,verifier FROM likerts_live_members WHERE instance_id=$1 LIMIT 52) AS current_members
    UNION ALL
    SELECT 'lease' AS row_kind,actor_id,NULL AS last_seen,verifier,lease_id,expires_at
    FROM (SELECT actor_id,lease_id,verifier,expires_at FROM likerts_live_socket_leases WHERE instance_id=$1 LIMIT ${maxLeasesPerRoom + 1}) AS current_leases`, [room.instanceId])).rows;
  const members = metadata.filter(value => value.row_kind === 'member'), leases = metadata.filter(value => value.row_kind === 'lease');
  if (members.length !== actors(room).length || members.length > 51 || leases.length > maxLeasesPerRoom) invalid();
  if (new Set(actors(room).map(value => value.id)).size !== actors(room).length) invalid();
  if (members.some(value => !actorID(value.actor_id) || !integer(value.last_seen) || !HASH.test(value.verifier ?? ''))) invalid();
  if (leases.some(value => !actorID(value.actor_id) || !UUID.test(value.lease_id ?? '') || !integer(value.expires_at) || !HASH.test(value.verifier ?? '') || !members.some(member => member.actor_id === value.actor_id && member.verifier === value.verifier))) invalid();
  for (const actor of actors(room)) {
    const member = members.find(value => value.actor_id === actor.id);
    if (!member || member.verifier !== actor.tokenHash) invalid();
    actor.lastSeen = Number(member.last_seen);
    actor.socketLeases = Object.fromEntries(leases.filter(value => value.actor_id === actor.id && value.verifier === actor.tokenHash).map(value => [value.lease_id, Number(value.expires_at)]));
  }
  if (Buffer.byteLength(JSON.stringify(room)) > MAX_STATE_BYTES) invalid();
  return room;
}

export function* persistRoom(original, room, { now, initialReceipts = [], record, maxLeasesPerRoom = 200 } = {}) {
  leaseCeiling(maxLeasesPerRoom);
  if (room === null) {
    if (original) yield query('DELETE FROM likerts_live_rooms WHERE code = $1', [original.code]);
    return;
  }
  const next = parts(room), previous = original ? parts(original) : null;
  if (next.leases.length > maxLeasesPerRoom) invalid();
  if (original && original.instanceId !== room.instanceId) invalid();
  const count = original ? Number(original.receiptCount ?? 0) + (record ? 1 : 0) : initialReceipts.length;
  if (!integer(count)) invalid();
  if (!original) {
    yield query('INSERT INTO likerts_live_rooms (code, state_json, revision, expires_at, updated_at, instance_id, last_activity_at, receipt_count, storage_version) VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,3)',
      [room.code, JSON.stringify(next.semantic), next.revision, next.expiresAt, now, next.instanceId, next.lastActivityAt, count]);
  } else {
    const semanticChanged = JSON.stringify(next.semantic) !== JSON.stringify(previous.semantic);
    const metadataChanged = next.revision !== previous.revision || next.expiresAt !== previous.expiresAt || next.lastActivityAt !== previous.lastActivityAt || count !== Number(original.receiptCount ?? 0);
    if (semanticChanged) yield query('UPDATE likerts_live_rooms SET state_json=$1::jsonb, revision=$2, expires_at=$3, updated_at=$4, last_activity_at=$5, receipt_count=$6 WHERE code=$7', [JSON.stringify(next.semantic), next.revision, next.expiresAt, now, next.lastActivityAt, count, room.code]);
    else if (metadataChanged) yield query('UPDATE likerts_live_rooms SET revision=$1, expires_at=$2, updated_at=$3, last_activity_at=$4, receipt_count=$5 WHERE code=$6', [next.revision, next.expiresAt, now, next.lastActivityAt, count, room.code]);
  }
  const oldMembers = new Map((previous?.members ?? []).map(value => [value.actorId, value]));
  const newMembers = new Map(next.members.map(value => [value.actorId, value]));
  const oldLeases = new Map((previous?.leases ?? []).map(value => [value.leaseId, value]));
  const newLeases = new Map(next.leases.map(value => [value.leaseId, value]));
  for (const [leaseId, old] of oldLeases) if (!newLeases.has(leaseId) || newLeases.get(leaseId).verifier !== old.verifier) yield query('DELETE FROM likerts_live_socket_leases WHERE instance_id=$1 AND lease_id=$2', [next.instanceId, leaseId]);
  for (const actorId of oldMembers.keys()) if (!newMembers.has(actorId)) yield query('DELETE FROM likerts_live_members WHERE instance_id=$1 AND actor_id=$2', [next.instanceId, actorId]);
  for (const member of next.members) {
    if (JSON.stringify(oldMembers.get(member.actorId)) === JSON.stringify(member)) continue;
    yield query('INSERT INTO likerts_live_members(instance_id,actor_id,last_seen,verifier) VALUES($1,$2,$3,$4) ON CONFLICT(instance_id,actor_id) DO UPDATE SET last_seen=excluded.last_seen,verifier=excluded.verifier', [next.instanceId, member.actorId, member.lastSeen, member.verifier]);
  }
  for (const lease of next.leases) {
    if (JSON.stringify(oldLeases.get(lease.leaseId)) === JSON.stringify(lease)) continue;
    yield query('INSERT INTO likerts_live_socket_leases(instance_id,actor_id,lease_id,verifier,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(instance_id,lease_id) DO UPDATE SET verifier=excluded.verifier,expires_at=excluded.expires_at', [next.instanceId, lease.actorId, lease.leaseId, lease.verifier, lease.expiresAt]);
  }
  for (const receipt of [...initialReceipts, ...(record ? [record] : [])]) yield query('INSERT INTO likerts_live_command_receipts(instance_id,actor_id,request_id,fingerprint) VALUES($1,$2,$3,$4)', [next.instanceId, receipt.actorId, receipt.requestId, receipt.fingerprint]);
  room.receiptCount = count; room.storageVersion = 3; delete room.requests;
}

export function validateCommandDescriptor(value) {
  if (!value || !UUID.test(value.requestId ?? '') || !HASH.test(value.fingerprint ?? '') || !Number.isSafeInteger(value.maxReceipts) || value.maxReceipts < 1 || value.maxReceipts > 1_000_000 || typeof value.authorize !== 'function') invalid();
  return { ...value, requestId: value.requestId.toLowerCase() };
}
export function* commandContext(room, descriptor, enter, leave) {
  enter(); const authorization = descriptor.authorize(copy(room)); leave();
  if (authorization && typeof authorization.then === 'function') Promise.resolve(authorization).catch(() => {});
  if (!authorization || typeof authorization !== 'object' || typeof authorization.then === 'function') invalid();
  if (authorization.terminal) return { terminal: authorization.terminal };
  if (!room || !actorID(authorization.actorId) || !['active', 'revoked_leave'].includes(authorization.scope)) invalid();
  const row = (yield query('SELECT fingerprint FROM likerts_live_command_receipts WHERE instance_id=$1 AND actor_id=$2 AND request_id=$3', [room.instanceId, authorization.actorId, descriptor.requestId])).rows[0];
  return { roomInstanceId: room.instanceId, actorId: authorization.actorId, scope: authorization.scope, requestId: descriptor.requestId, fingerprint: descriptor.fingerprint, existingFingerprint: row?.fingerprint ?? null, receiptCount: room.receiptCount };
}

export function* migrateStorage({ postgres = false, maxLeasesPerRoom = 200 } = {}) {
  leaseCeiling(maxLeasesPerRoom);
  if (postgres) {
    yield query('LOCK TABLE likerts_live_rooms IN ACCESS EXCLUSIVE MODE');
    for (const [column, type] of [['instance_id', 'uuid'], ['last_activity_at', 'bigint'], ['receipt_count', 'bigint'], ['storage_version', 'integer']]) yield query(`ALTER TABLE likerts_live_rooms ADD COLUMN IF NOT EXISTS ${column} ${type}`);
  } else {
    const columns = (yield query('PRAGMA table_info(likerts_live_rooms)')).rows;
    for (const [column, type] of [['instance_id', 'text'], ['last_activity_at', 'integer'], ['receipt_count', 'integer'], ['storage_version', 'integer']]) if (!columns.some(value => value.name === column)) yield query(`ALTER TABLE likerts_live_rooms ADD COLUMN ${column} ${type}`);
  }
  yield query('CREATE UNIQUE INDEX IF NOT EXISTS likerts_live_room_instance ON likerts_live_rooms(instance_id)');
  yield query('CREATE TABLE IF NOT EXISTS likerts_live_storage (singleton integer PRIMARY KEY CHECK(singleton=1),version integer NOT NULL CHECK(version=3))');
  const version = (yield query('SELECT version FROM likerts_live_storage WHERE singleton=1')).rows[0];
  if (version && Number(version.version) !== 3) invalid();
  const idType = postgres ? 'uuid' : 'text';
  yield query(`CREATE TABLE IF NOT EXISTS likerts_live_command_receipts(instance_id ${idType} NOT NULL REFERENCES likerts_live_rooms(instance_id) ON DELETE CASCADE,actor_id text NOT NULL,request_id ${idType} NOT NULL,fingerprint text NOT NULL CHECK(length(fingerprint)=64),PRIMARY KEY(instance_id,actor_id,request_id))`);
  yield query(`CREATE TABLE IF NOT EXISTS likerts_live_members(instance_id ${idType} NOT NULL REFERENCES likerts_live_rooms(instance_id) ON DELETE CASCADE,actor_id text NOT NULL,last_seen bigint NOT NULL CHECK(last_seen>=0),verifier text NOT NULL CHECK(length(verifier)=64),PRIMARY KEY(instance_id,actor_id))`);
  yield query(`CREATE TABLE IF NOT EXISTS likerts_live_socket_leases(instance_id ${idType} NOT NULL,actor_id text NOT NULL,lease_id ${idType} NOT NULL,verifier text NOT NULL CHECK(length(verifier)=64),expires_at bigint NOT NULL CHECK(expires_at>=0),PRIMARY KEY(instance_id,lease_id),FOREIGN KEY(instance_id,actor_id) REFERENCES likerts_live_members(instance_id,actor_id) ON DELETE CASCADE)`);
  // Fetch only bounded identifiers first; each potentially large legacy room
  // is validated and migrated individually inside the same locked transaction.
  const rows = (yield query('SELECT code,storage_version FROM likerts_live_rooms ORDER BY code LIMIT 100001')).rows;
  if (rows.length > 100000) invalid();
  for (const row of rows) {
    if (Number(row.storage_version) === 3) { if (!version) invalid(); continue; }
    if (version || row.storage_version !== null && row.storage_version !== undefined) invalid();
    const legacy = (yield query('SELECT state_json,revision,expires_at FROM likerts_live_rooms WHERE code=$1', [row.code])).rows[0];
    const room = parsed(legacy?.state_json);
    if (!room || room.code !== row.code || Number(legacy.revision) !== room.revision || Number(legacy.expires_at) !== room.expiresAt) invalid();
    const receipts = legacyReceipts(room), next = parts(room);
    if (next.leases.length > maxLeasesPerRoom || new Set(next.members.map(value => value.actorId)).size !== next.members.length) invalid();
    yield query('UPDATE likerts_live_rooms SET state_json=$1::jsonb,instance_id=$2,last_activity_at=$3,receipt_count=$4,storage_version=3 WHERE code=$5', [JSON.stringify(next.semantic), next.instanceId, next.lastActivityAt, receipts.length, row.code]);
    for (const member of next.members) yield query('INSERT INTO likerts_live_members(instance_id,actor_id,last_seen,verifier) VALUES($1,$2,$3,$4)', [next.instanceId, member.actorId, member.lastSeen, member.verifier]);
    for (const lease of next.leases) yield query('INSERT INTO likerts_live_socket_leases(instance_id,actor_id,lease_id,verifier,expires_at) VALUES($1,$2,$3,$4,$5)', [next.instanceId, lease.actorId, lease.leaseId, lease.verifier, lease.expiresAt]);
    for (const receipt of receipts) yield query('INSERT INTO likerts_live_command_receipts(instance_id,actor_id,request_id,fingerprint) VALUES($1,$2,$3,$4)', [next.instanceId, receipt.actorId, receipt.requestId, receipt.fingerprint]);
  }
  yield query('INSERT INTO likerts_live_storage(singleton,version) VALUES(1,3) ON CONFLICT(singleton) DO NOTHING');
  if (postgres) yield query(`CREATE OR REPLACE FUNCTION likerts_live_require_v3() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('likerts_live.storage_version',true) IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'Live storage writer version mismatch' USING ERRCODE='55000'; END IF; RETURN NULL; END $$`);
  for (const table of ['likerts_live_rooms', 'likerts_live_command_receipts', 'likerts_live_members', 'likerts_live_socket_leases', 'likerts_live_admissions', 'likerts_live_budgets']) {
    const trigger = `${table}_v3_guard`;
    if (postgres) {
      yield query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
      yield query(`CREATE TRIGGER ${trigger} BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION likerts_live_require_v3()`);
    } else {
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) yield query(`CREATE TRIGGER IF NOT EXISTS ${trigger}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT CASE WHEN likerts_live_storage_version()!=3 THEN RAISE(ABORT,'Live storage writer version mismatch') END; END`);
    }
  }
}
