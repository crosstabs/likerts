import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PostgreSQLStore } from '../server/store.mjs';
import { LiveError, publicError } from '../server/errors.mjs';

const marker = 'PRIVATE_FIXTURE_SQL_URL_TOKEN_ANSWER';
function fixture({ acquireError, operationError, commitError, rollbackError, releaseError, clientEventError } = {}) {
  const releases = [], queries = [];
  let operations = 0;
  const client = Object.assign(new EventEmitter(), {
    async query(sql) {
      queries.push(sql);
      if (sql === 'ROLLBACK' && rollbackError) throw rollbackError;
      if (sql === 'COMMIT' && commitError) throw commitError;
      if (sql.startsWith('SELECT state_json')) {
        operations++;
        if (clientEventError) client.emit('error', clientEventError);
        if (operationError) throw operationError;
        return { rows: [{ state_json: { code: 'ABCDEF' }, instance_id: '00000000-0000-4000-8000-000000000001', revision: 1, expires_at: 1000, last_activity_at: null, receipt_count: 0, storage_version: 3 }] };
      }
      return { rows: [] };
    },
    release(discard) { releases.push(Boolean(discard)); if (releaseError) throw releaseError; },
  });
  const pool = Object.assign(new EventEmitter(), { totalCount: 10, idleCount: 0, waitingCount: 41, async connect() { if (acquireError) throw acquireError; return client; }, async end() {} });
  const store = new PostgreSQLStore(pool, { maxRooms: 1000, now: () => 0 });
  return { store, releases, queries, get operations() { return operations; } };
}
const driverError = (message, code) => Object.assign(new Error(message), code ? { code } : {}, { query: marker, parameters: [marker], connectionString: marker });
async function rejection(f, expected) {
  let observed;
  await assert.rejects(f.store.transact('ABCDEF', room => ({ room, changed: false })), error => {
    observed = error;
    assert.equal(error.code, 'storage_unavailable');
    assert.equal(error.message, 'Live room storage is temporarily unavailable.');
    assert.ok(error.diagnostic, 'The catch path must preserve a sanitized diagnostic');
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(error.diagnostic[key], value);
    assert.deepEqual(error.diagnostic.pool, { total: 10, idle: 0, waiting: 41 });
    assert.ok(Number.isSafeInteger(error.diagnostic.elapsedMs) && error.diagnostic.elapsedMs >= 0);
    assert.equal(Object.hasOwn(error, 'cause'), false, 'Never attach a raw driver cause');
    assert.equal(JSON.stringify(error).includes(marker), false);
    assert.deepEqual(publicError(error), { status: 503, error: { code: 'storage_unavailable', message: 'The game service is temporarily unavailable.' } });
    return true;
  });
  return observed;
}

test('The actual transaction catch distinguishes queued pool checkout from connection establishment', async () => {
  const queued = fixture({ acquireError: driverError('timeout exceeded when trying to connect') });
  await rejection(queued, { phase: 'acquire', kind: 'pool_acquire_timeout', sqlState: null, rollback: 'not_started', outcome: 'not_started' });
  assert.deepEqual(queued.releases, []); assert.equal(queued.operations, 0);
  const connection = fixture({ acquireError: driverError('Connection terminated due to connection timeout') });
  await rejection(connection, { phase: 'acquire', kind: 'connection_timeout', sqlState: null });
});

test('A local query timeout retains its phase while a confirmed rollback returns the client safely', async () => {
  const f = fixture({ operationError: driverError('Query read timeout') });
  await rejection(f, { phase: 'operation', kind: 'query_timeout', sqlState: null, rollback: 'succeeded', outcome: 'rolled_back' });
  assert.equal(f.operations, 1); assert.deepEqual(f.releases, [false]);
});

test('Server lock and statement timeouts retain SQLSTATE without retaining driver text', async () => {
  await rejection(fixture({ operationError: driverError(`lock error with ${marker}`, '55P03') }), { phase: 'operation', kind: 'lock_unavailable', sqlState: '55P03' });
  await rejection(fixture({ operationError: driverError('canceling statement due to lock timeout', '55P03') }), { phase: 'operation', kind: 'lock_timeout', sqlState: '55P03' });
  await rejection(fixture({ operationError: driverError('canceling statement due to statement timeout', '57014') }), { kind: 'statement_timeout', sqlState: '57014' });
  await rejection(fixture({ operationError: driverError(`private cancellation ${marker}`, '57014') }), { kind: 'query_canceled', sqlState: '57014' });
  await rejection(fixture({ operationError: driverError(`private deadlock ${marker}`, '40P01') }), { kind: 'deadlock', sqlState: '40P01' });
});

test('Failed rollback discards the connection and preserves the original failure classification', async () => {
  const f = fixture({ operationError: driverError(`lock ${marker}`, '55P03'), rollbackError: driverError(`connection ${marker}`, 'ECONNRESET') });
  await rejection(f, { phase: 'operation', kind: 'lock_unavailable', sqlState: '55P03', rollback: 'failed', outcome: 'unknown' });
  assert.deepEqual(f.releases, [true], 'An uncertain transaction must not return to the idle pool');
});

test('Commit timeout remains an unknown outcome and never automatically replays a mutation', async () => {
  const f = fixture({ commitError: driverError('Query read timeout') });
  await rejection(f, { phase: 'commit', kind: 'query_timeout', rollback: 'succeeded', outcome: 'unknown' });
  assert.equal(f.operations, 1); assert.equal(f.queries.filter(query => query === 'COMMIT').length, 1);
});

test('Unknown private driver messages and codes cannot cross the diagnostic allowlist', async () => {
  await rejection(fixture({ operationError: driverError(marker, marker) }), { kind: 'unknown', sqlState: null });
});

test('Domain rejections remain unchanged and their failed rollback still discards the connection', async () => {
  const expected = new LiveError('wrong_phase', 'This action is unavailable.', 409);
  const f = fixture({ rollbackError: driverError(marker) });
  await assert.rejects(f.store.transact('ABCDEF', () => { throw expected; }), error => error === expected);
  assert.deepEqual(f.releases, [true]);
});

test('Successful transactions retain their normal return and release behavior', async () => {
  const f = fixture();
  const result = await f.store.transact('ABCDEF', room => ({ room, changed: false, value: 'ok' }));
  assert.equal(result.value, 'ok'); assert.deepEqual(f.releases, [false]);
});

test('A release error after commit is sanitized and records the committed outcome', async () => {
  const f = fixture({ releaseError: driverError(marker) });
  await rejection(f, { phase: 'release', kind: 'unknown', rollback: 'not_started', outcome: 'committed' });
  assert.equal(f.operations, 1); assert.equal(f.queries.filter(query => query === 'COMMIT').length, 1);
});

test('An in-use connection error cannot escape its rejected query and forces discard even after rollback succeeds', async () => {
  const error = driverError('Connection terminated unexpectedly');
  const f = fixture({ clientEventError: error, operationError: error });
  await rejection(f, { phase: 'operation', kind: 'connection_failure', rollback: 'succeeded', outcome: 'rolled_back' });
  assert.deepEqual(f.releases, [true]);
});
