import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import test, { after } from 'node:test';
import { admission, cleanupSource, delay, fixture, sourceEvidence, until, WebSocket } from './phase2-fixture.mjs';

after(cleanupSource);
const command = (state, action, values = {}) => ({ requestId: randomUUID(), matchId: state.matchId, action, ...values });

test('Phase 2: unauthenticated PING control frames cannot bypass the configured frame allowance', async t => {
  const f = await fixture(t, { limits: { framesPerMinute: 2, authTimeoutMs: 1000 } });
  const socket = await f.openSocket();
  let pongs = 0;
  socket.on('pong', () => { pongs++; });
  for (let index = 0; index < 12 && socket.readyState === WebSocket.OPEN; index++) {
    socket.ping(Buffer.alloc(32, 1));
    await delay(4);
  }
  await delay(30);
  t.diagnostic(JSON.stringify({ ...sourceEvidence, configuredFramesPerMinute: 2, sentControlPings: 12, observedPongs: pongs, socketState: socket.readyState }));
  assert.ok(pongs <= 2, 'Control traffic must not receive unmetered automatic replies beyond the admission allowance');
});

test('Phase 2: authenticated PING control frames consume the member frame allowance', async t => {
  const f = await fixture(t, { limits: { framesPerMinute: 2 } });
  const created = await f.request('POST', '/rooms', admission({}));
  assert.equal(created.status, 201);
  const socket = await f.openSocket();
  let pongs = 0;
  let authenticated = false;
  socket.on('pong', () => { pongs++; });
  socket.on('message', bytes => { if (JSON.parse(bytes.toString()).type === 'state') authenticated = true; });
  socket.send(JSON.stringify({ type: 'authenticate', code: created.body.code, token: created.body.token }));
  await until(() => authenticated);
  await delay(20);
  let sent = 0;
  for (let index = 0; index < 12 && socket.readyState === WebSocket.OPEN; index++) {
    socket.ping(Buffer.alloc(32, 1)); sent++;
    await delay(4);
  }
  await delay(30);
  t.diagnostic(JSON.stringify({ ...sourceEvidence, configuredFramesPerMinute: 2, sentControlPings: sent, observedPongs: pongs, socketState: socket.readyState }));
  assert.ok(pongs <= 2, 'Authenticated control frames must share the member’s bounded frame policy');
});

test('Phase 2: an authentication deadline releases a socket slot even when the peer ignores CLOSE', async t => {
  const f = await fixture(t, { limits: { authTimeoutMs: 40, maxSockets: 1 } });
  const raw = f.own(createConnection({ host: '127.0.0.1', port: f.port }));
  let received = Buffer.alloc(0);
  raw.on('data', bytes => { received = Buffer.concat([received, bytes]); assert.ok(received.length < 8192); });
  await new Promise((resolve, reject) => { raw.once('connect', resolve); raw.once('error', reject); });
  raw.write(`GET /api/live/socket HTTP/1.1\r\nHost: 127.0.0.1:${f.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://127.0.0.1\r\n\r\n`);
  await until(() => received.includes(Buffer.from('\r\n\r\n')));
  assert.match(received.toString('latin1'), /^HTTP\/1.1 101 /);
  await delay(120);
  let admitted = false;
  let rejectedStatus = null;
  const next = f.own(new WebSocket(`${f.origin.replace('http:', 'ws:')}/api/live/socket`));
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 1000);
    next.once('open', () => { admitted = true; clearTimeout(timer); resolve(); });
    next.once('unexpected-response', (_request, response) => { rejectedStatus = response.statusCode; response.resume(); clearTimeout(timer); resolve(); });
    next.on('error', () => { clearTimeout(timer); resolve(); });
  });
  t.diagnostic(JSON.stringify({ ...sourceEvidence, authenticationTimeoutMs: 40, observedAfterMs: 120, replacementAdmitted: admitted, rejectedStatus, rawPeerDestroyed: raw.destroyed }));
  assert.equal(admitted, true, 'Expired unauthenticated peers must not keep the only slot until an attacker completes the close handshake');
});

test('Phase 2 negative control: a join admission is bound to its exact room path', async t => {
  const f = await fixture(t);
  const first = await f.request('POST', '/rooms', admission({ settings: { capacity: 2 } }));
  const second = await f.request('POST', '/rooms', admission({ settings: { capacity: 2 } }));
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  const body = admission({ nickname: 'Synthetic Player', acceptRoomSharing: true });
  const joined = await f.request('POST', `/rooms/${first.body.code}/join`, body);
  assert.equal(joined.status, 201);
  const conflict = await f.request('POST', `/rooms/${second.body.code}/join`, body);
  assert.equal(conflict.status, 409);
  const preserved = await f.request('GET', `/rooms/${first.body.code}`, undefined, joined.body.token);
  assert.equal(preserved.status, 200, 'A conflicting path must not rotate the original credential');
  const untouched = await f.request('GET', `/rooms/${second.body.code}`, undefined, second.body.token);
  assert.equal(untouched.body.state.players.length, 0);
});

test('Phase 2 negative control: rotating a member token cannot reset its shared refresh allowance', async t => {
  const f = await fixture(t, { limits: { refreshPerMinute: 1 } });
  const pending = admission({ settings: { capacity: 2 } });
  const created = await f.request('POST', '/rooms', pending);
  assert.equal(created.status, 201);
  async function authenticate(member) {
    const socket = await f.openSocket();
    const messages = [];
    socket.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
    socket.send(JSON.stringify({ type: 'authenticate', code: member.code, token: member.token }));
    await until(() => messages.some(message => message.type === 'state'));
    return { socket, messages };
  }
  const first = await authenticate(created.body);
  let before = first.messages.length;
  first.socket.send(JSON.stringify({ type: 'refresh' }));
  await until(() => first.messages.length > before);
  const recovered = await f.request('POST', '/admissions/recover', { admissionId: pending.admissionId, recoverySecret: pending.recoverySecret });
  assert.equal(recovered.status, 200);
  const second = await authenticate(recovered.body);
  await delay(20);
  before = second.messages.length;
  second.socket.send(JSON.stringify({ type: 'refresh' }));
  await until(() => second.messages.length > before);
  assert.ok(second.messages.slice(before).some(message => message.type === 'error' && message.error.code === 'rate_limited'));
});

test('Phase 2: the host can close a room after another participant exhausts its command receipts', async t => {
  const f = await fixture(t, { limits: { maxRequests: 2 } });
  const created = await f.request('POST', '/rooms', admission({ settings: { capacity: 2 } }));
  const host = created.body;
  const joined = await f.request('POST', `/rooms/${host.code}/join`, admission({ nickname: 'Synthetic Player', acceptRoomSharing: true }));
  assert.equal(joined.status, 201);
  for (let index = 0; index < 2; index++) {
    const consumed = await f.request('POST', `/rooms/${host.code}/actions`, command(host.state, 'heartbeat'), joined.body.token);
    assert.equal(consumed.status, 200);
  }
  const closed = await f.request('POST', `/rooms/${host.code}/actions`, command(host.state, 'close'), host.token);
  t.diagnostic(JSON.stringify({ ...sourceEvidence, configuredMaxRequests: 2, participantHeartbeats: 2, hostCloseStatus: closed.status, hostCloseError: closed.body.error?.code }));
  assert.equal(closed.status, 200, 'Receipt exhaustion must preserve the host’s ability to delete the room');
  assert.deepEqual(closed.body, { state: null, closed: true });
});

test('Phase 2: participants can revoke their own access after the room command budget is full', async t => {
  const f = await fixture(t, { limits: { maxRequests: 1 } });
  const created = await f.request('POST', '/rooms', admission({ settings: { capacity: 2 } }));
  const host = created.body;
  const joined = await f.request('POST', `/rooms/${host.code}/join`, admission({ nickname: 'Synthetic Player', acceptRoomSharing: true }));
  assert.equal(joined.status, 201);
  const consumed = await f.request('POST', `/rooms/${host.code}/actions`, command(host.state, 'heartbeat'), host.token);
  assert.equal(consumed.status, 200);
  const leave = command(host.state, 'leave');
  const left = await f.request('POST', `/rooms/${host.code}/actions`, leave, joined.body.token);
  t.diagnostic(JSON.stringify({ ...sourceEvidence, configuredMaxRequests: 1, participantLeaveStatus: left.status, participantLeaveError: left.body.error?.code }));
  assert.equal(left.status, 200, 'A receipt cap must not prevent a participant revoking their own access');
  assert.deepEqual(left.body, { state: null, left: true });
  const lostResponseRetry = await f.request('POST', `/rooms/${host.code}/actions`, leave, joined.body.token);
  assert.equal(lostResponseRetry.status, 200);
  assert.deepEqual(lostResponseRetry.body, { state: null, left: true });
  const nonExactRetry = await f.request('POST', `/rooms/${host.code}/actions`, command(host.state, 'leave'), joined.body.token);
  assert.equal(nonExactRetry.status, 401);
  const revoked = await f.request('GET', `/rooms/${host.code}`, undefined, joined.body.token);
  assert.equal(revoked.status, 401);
});

test('Phase 2 negative control: caller-supplied forwarding headers cannot reset the TCP-peer admission budget', async t => {
  const f = await fixture(t, { limits: { createPerMinute: 1 } });
  const first = await f.request('POST', '/rooms', admission({}), undefined, { 'X-Forwarded-For': '192.0.2.1', Forwarded: 'for=192.0.2.1' });
  assert.equal(first.status, 201);
  const bypass = await f.request('POST', '/rooms', admission({}), undefined, { 'X-Forwarded-For': '192.0.2.2', Forwarded: 'for=192.0.2.2', 'X-Real-IP': '192.0.2.2' });
  assert.equal(bypass.status, 429);
  assert.equal(bypass.body.error.code, 'rate_limited');
});

test('Phase 2 negative control: private credentials in query strings do not authorize HTTP or WebSocket reads', async t => {
  const f = await fixture(t);
  const created = await f.request('POST', '/rooms', admission({}));
  const host = created.body;
  const query = await f.request('GET', `/rooms/${host.code}?token=${host.token}`);
  assert.equal(query.status, 401);
  assert.equal(JSON.stringify(query.body).includes(host.token), false);
  const socket = f.own(new WebSocket(`${f.origin.replace('http:', 'ws:')}/api/live/socket?token=${host.token}`));
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bounded query-credential rejection timed out')), 1500);
    socket.once('open', () => { clearTimeout(timer); reject(new Error('Query credential socket must not upgrade')); });
    socket.once('unexpected-response', (_request, response) => { response.resume(); clearTimeout(timer); resolve(response.statusCode); });
    socket.on('error', () => {});
  });
  assert.equal(status, 404);
});

test('Phase 2 negative control: failed recovery verifiers do not consume another member’s rotation allowance', async t => {
  const f = await fixture(t);
  const pending = admission({});
  const created = await f.request('POST', '/rooms', pending);
  assert.equal(created.status, 201);
  const incorrect = { admissionId: pending.admissionId, recoverySecret: randomBytes(32).toString('base64url') };
  for (let attempt = 0; attempt < 21; attempt++) {
    const rejected = await f.request('POST', '/admissions/recover', incorrect);
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error.code, 'admission_invalid');
  }
  const recovered = await f.request('POST', '/admissions/recover', { admissionId: pending.admissionId, recoverySecret: pending.recoverySecret });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.memberId, created.body.memberId);
  assert.notEqual(recovered.body.token, created.body.token);
});
