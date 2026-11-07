import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { createLiveServer } from '../server/app.mjs';
import { createQuizRoom, joinRoom, project, reduceRoom } from '../server/engine.mjs';
import { openStore } from '../server/store.mjs';
import { encodeQuiz, normalizeQuiz } from '../web/quiz-document.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const timestamp = 1_794_009_600_000;
const topKeys = 'protocolVersion mode modeVersion code matchId revision serverTime expiresAt role self phase joinLocked settings hostConnected players round reveal leaderboard completion notice quiz';
const roundKeys = 'id index total questionId prompt answers deadline submittedCount eligibleCount ownAnswer';
const rowKeys = 'playerId nickname points opportunities accuracy rank';
const revealKeys = 'correctAnswer explanation valid reason results groupAccuracy';
const admission = () => ({ admissionId: randomUUID(), recoverySecret: randomBytes(32).toString('base64url') });
const keys = (value, expected, label) => assert.deepEqual(Object.keys(value).sort(), expected.split(' ').sort(), `${label} exact field set`);
const clone = value => structuredClone(value);

function quiz() {
  return normalizeQuiz({
    format: 'likerts.quiz', version: 1, id: '00000000-0000-0000-0000-000000000000', title: 'Quiet cosmos 🌙',
    questions: [
      { id: '11111111-1111-0000-0000-111111111111', prompt: 'First line\nCafé 🌙: choose a letter.', answers: ['A', 'B', 'C'], correctAnswer: 0, explanation: 'Private first explanation.\nA is correct.', timeLimitSeconds: 10 },
      { id: '22222222-2222-0000-0000-222222222222', prompt: 'FUTURE_PROMPT_NEVER_BEFORE_QUESTION_TWO', answers: ['FUTURE_CHOICE_ALPHA', 'FUTURE_CHOICE_BETA'], correctAnswer: 1, explanation: 'FUTURE_EXPLANATION_PRIVATE', timeLimitSeconds: 0 },
    ],
  });
}

function assertShape(state) {
  keys(state, topKeys, 'quiz state');
  assert.equal(state.protocolVersion, 2); assert.equal(state.mode, 'quiz'); assert.equal(state.modeVersion, 1);
  keys(state.quiz, 'id title questionCount', 'quiz metadata');
  keys(state.settings, 'capacity', 'quiz settings');
  keys(state.self, 'id nickname', 'self');
  for (const player of state.players) keys(player, 'id nickname avatar connected', 'player');
  for (const row of state.leaderboard) keys(row, rowKeys, 'standing');
  if (state.round) keys(state.round, roundKeys, 'question');
  if (state.reveal) {
    keys(state.reveal, revealKeys, 'reveal');
    for (const row of state.reveal.results) keys(row, 'playerId nickname value points', 'revealed result');
  }
}

function assertUnrevealed(state, ownAnswer = null) {
  assertShape(state); assert.equal(state.reveal, null);
  if (state.round) assert.equal(state.round.ownAnswer, ownAnswer);
  const wire = JSON.stringify(state);
  for (const secret of ['correctAnswer', 'explanation', 'quizSnapshot', 'submissions', 'tokenHash', 'requests', 'FUTURE_PROMPT', 'FUTURE_CHOICE', 'FUTURE_EXPLANATION', 'Private first explanation']) {
    assert.equal(wire.includes(secret), false, `unrevealed projection omits ${secret}`);
  }
}

function command(room, action, extra = {}) {
  return { requestId: randomUUID(), matchId: room.matchId, ...(room.round ? { roundId: room.round.id } : {}), action, ...extra };
}

function startedRoom() {
  const source = quiz();
  let room = createQuizRoom(source, { capacity: 3 }, { code: 'ABCDEF', now: timestamp }).room;
  const players = [];
  for (const nickname of ['Ari', 'Bo']) { const joined = joinRoom(room, { nickname, acceptRoomSharing: true }, { now: timestamp }); room = joined.room; players.push(joined.memberId); }
  room = reduceRoom(room, 'host', command(room, 'start'), { catalogue, now: timestamp }).room;
  return { room, players, source };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-m2-privacy-'));
  let now = timestamp;
  const store = await openStore({ sqlitePath: join(directory, 'fixture.sqlite'), databaseURL: '', production: false, now: () => now });
  const app = await createLiveServer({ store, catalogue, now: () => now, allowNoOrigin: true });
  const { origin } = await app.listen({ host: '127.0.0.1', port: 0 });
  const peers = new Set();
  t.after(async () => {
    for (const peer of peers) peer.socket.terminate();
    try { await app.close(); } finally { try { await store.close(); } finally { await rm(directory, { recursive: true, force: true }); } }
  });
  const f = {
    store, origin, now: () => now,
    advance(ms) { now += ms; },
    async request(method, path, body, token, raw = false) {
      const response = await fetch(origin + '/api/live' + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      return { status: response.status, body: await response.json() };
    },
    async create(document = quiz(), privateAdmission = admission()) {
      const body = { ...privateAdmission, mode: 'quiz', modeVersion: 1, quiz: document, settings: { capacity: 3 } };
      const result = await f.request('POST', '/rooms', body); assert.equal(result.status, 201, JSON.stringify(result.body));
      return { ...result.body, privateAdmission, createBody: body };
    },
    async join(host, nickname) {
      const result = await f.request('POST', `/rooms/${host.code}/join`, { ...admission(), nickname, acceptRoomSharing: true }); assert.equal(result.status, 201); return result.body;
    },
    async state(member) { const result = await f.request('GET', `/rooms/${member.code}`, undefined, member.token); assert.equal(result.status, 200); return result.body.state; },
    action(member, state, action, extra = {}) { return f.request('POST', `/rooms/${member.code}/actions`, command(state, action, extra), member.token); },
    async peer(member) {
      const socket = new WebSocket(origin.replace(/^http/, 'ws') + '/api/live/socket');
      const messages = []; const waiters = new Set();
      const peer = { socket, messages, async state(predicate) {
        const current = messages.find(message => message.type === 'state' && predicate(message.state)); if (current) return current.state;
        return new Promise((resolve, reject) => {
          const waiter = message => { if (message.type === 'state' && predicate(message.state)) { clearTimeout(timer); waiters.delete(waiter); resolve(message.state); } };
          const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('owned quiz socket state timeout')); }, 3000); waiters.add(waiter);
        });
      } };
      peers.add(peer);
      socket.on('message', data => { const message = JSON.parse(String(data)); messages.push(message); for (const waiter of [...waiters]) waiter(message); });
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      socket.send(JSON.stringify({ type: 'authenticate', code: member.code, token: member.token }));
      await peer.state(() => true); return peer;
    },
  };
  return f;
}

test('Quiz projections are exact allowlists and insensitive to unrevealed keys and future content for every role', () => {
  const { room: original, players, source } = startedRoom();
  source.questions[0].prompt = 'Mutated caller library';
  assert.notEqual(original.quizSnapshot.questions[0].prompt, source.questions[0].prompt, 'creation detaches authored content');
  const room = reduceRoom(original, players[0], command(original, 'quiz-answer', { value: 0 }), { catalogue, now: timestamp + 1 }).room;
  const counterfactual = clone(room);
  counterfactual.quizSnapshot.questions[0].correctAnswer = 2;
  counterfactual.quizSnapshot.questions[0].explanation = 'COUNTERFACTUAL_PRIVATE_EXPLANATION';
  counterfactual.quizSnapshot.questions[1].prompt = 'COUNTERFACTUAL_FUTURE_PROMPT';
  counterfactual.quizSnapshot.questions[1].answers = ['Alternate future A', 'Alternate future B'];
  counterfactual.quizSnapshot.questions[1].correctAnswer = 0;
  for (const actorId of ['host', ...players]) {
    const actual = project(room, actorId, { catalogue, now: timestamp + 2 });
    assertUnrevealed(actual, actorId === players[0] ? 0 : null);
    assert.deepEqual(project(counterfactual, actorId, { catalogue, now: timestamp + 2 }), actual, 'private key and future question changes cannot affect a current recipient');
  }
});

test('HTTP and WebSocket preserve owner-only answers until one authoritative reveal, including authored UUID and multiline text', async t => {
  const f = await fixture(t), host = await f.create(), a = await f.join(host, 'Ari'), b = await f.join(host, 'Bo');
  for (const member of [host, a, b]) assertUnrevealed(await f.state(member));
  const peers = await Promise.all([host, a, b].map(member => f.peer(member)));
  const started = await f.action(host, await f.state(host), 'start'); assert.equal(started.status, 200);
  const state = started.body.state; assert.equal(state.round.questionId, '11111111-1111-0000-0000-111111111111'); assert.match(state.round.prompt, /\nCafé 🌙/);
  assert.equal((await f.action(a, state, 'quiz-answer', { value: 0 })).status, 200);
  for (const [index, member] of [host, a, b].entries()) {
    const actual = await f.state(member); assertUnrevealed(actual, member === a ? 0 : null);
    const socketState = await peers[index].state(update => update.revision >= actual.revision && update.round?.submittedCount === 1); assertUnrevealed(socketState, member === a ? 0 : null);
  }
  const revealed = await f.action(b, await f.state(b), 'quiz-answer', { value: 1 }); assert.equal(revealed.status, 200);
  for (const [index, member] of [host, a, b].entries()) {
    const actual = await f.state(member); assertShape(actual); assert.equal(actual.phase, 'reveal');
    assert.equal(actual.reveal.correctAnswer, 0); assert.equal(actual.reveal.reason, 'answered'); assert.match(actual.reveal.explanation, /\nA is correct/);
    assert.deepEqual(actual.reveal.results.map(row => [row.nickname, row.value, row.points]), [['Ari', 0, 1000], ['Bo', 1, 0]]);
    assert.equal(JSON.stringify(actual).includes('FUTURE_'), false);
    assertShape(await peers[index].state(update => update.phase === 'reveal' && update.revision >= actual.revision));
  }
});

test('Immutable quiz admission retries reuse one room, reject changed keys and revoke earlier capabilities', async t => {
  const f = await fixture(t), host = await f.create();
  const changed = clone(host.createBody); changed.quiz.questions[0].correctAnswer = 2;
  const rejected = await f.request('POST', '/rooms', changed); assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'admission_conflict');
  assert.equal((await f.request('GET', `/rooms/${host.code}`, undefined, host.token)).status, 200, 'conflicting replay must not rotate the existing host');
  const replayed = await f.request('POST', '/rooms', host.createBody); assert.equal(replayed.status, 201); assert.equal(replayed.body.code, host.code); assert.notEqual(replayed.body.token, host.token);
  assert.equal((await f.request('GET', `/rooms/${host.code}`, undefined, host.token)).status, 401);
  const recovered = await f.request('POST', '/admissions/recover', host.privateAdmission); assert.equal(recovered.status, 200); assert.equal(recovered.body.code, host.code); assertUnrevealed(recovered.body.state);
  assert.equal(f.store.database.prepare('SELECT count(*) AS count FROM likerts_live_rooms').get().count, 1);
});

for (const [action, reason] of [['end', 'host_ended'], ['leave', 'player_left'], ['kick', 'player_removed']]) {
  test(`Aborted quiz ${action} redacts submitted choices and keys and awards no current-round points`, async t => {
    const f = await fixture(t), host = await f.create(), a = await f.join(host, 'Ari'), b = await f.join(host, 'Bo');
    const state = (await f.action(host, await f.state(host), 'start')).body.state;
    assert.equal((await f.action(a, state, 'quiz-answer', { value: 0 })).status, 200);
    const actor = action === 'leave' ? b : host;
    const ended = await f.action(actor, await f.state(actor), action, action === 'kick' ? { playerId: b.memberId } : {}); assert.equal(ended.status, 200);
    for (const member of [host, a]) {
      const actual = await f.state(member); assertShape(actual); assert.equal(actual.phase, 'finished'); assert.equal(actual.completion, 'incomplete');
      assert.equal(actual.reveal.reason, reason); assert.equal(actual.reveal.valid, false); assert.equal(actual.reveal.correctAnswer, null); assert.equal(actual.reveal.explanation, '');
      assert.equal(actual.round.ownAnswer, null); assert.equal(actual.reveal.groupAccuracy, null);
      assert.ok(actual.reveal.results.every(row => row.value === null && row.points === 0));
      assert.ok(actual.leaderboard.every(row => row.points === 0 && row.opportunities === 0 && row.rank === null));
      assert.equal(JSON.stringify(actual).includes('FUTURE_'), false);
    }
    if (action !== 'end') assert.equal((await f.request('GET', `/rooms/${host.code}`, undefined, b.token)).status, 401);
  });
}

function largeQuiz(emojiCount) {
  let remaining = emojiCount;
  const fill = length => { const used = Math.min(length, remaining); remaining -= used; return '🌙'.repeat(used) + 'a'.repeat(length - used); };
  return { format: 'likerts.quiz', version: 1, id: '00000000-0000-0000-0000-000000000000', title: 'Large valid document', questions: Array.from({ length: 30 }, (_, index) => ({
    id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`, prompt: fill(240), answers: ['A', 'B', 'C', 'D'].map(letter => letter + fill(99)), correctAnswer: 0, explanation: fill(240), timeLimitSeconds: 0,
  })) };
}

test('Maximum normalized quiz fits the bounded upload envelope while oversized quiz, upload and ordinary command bodies fail safely', async t => {
  const f = await fixture(t);
  let low = 0, high = 30 * 876;
  while (low < high) { const middle = Math.ceil((low + high) / 2); try { normalizeQuiz(largeQuiz(middle)); low = middle; } catch { high = middle - 1; } }
  const document = normalizeQuiz(largeQuiz(low)), documentBytes = Buffer.byteLength(encodeQuiz(document));
  assert.ok(documentBytes <= 65_536 && documentBytes >= 65_534, `near-limit document is ${documentBytes} bytes`);
  const body = { ...admission(), mode: 'quiz', modeVersion: 1, quiz: document, settings: { capacity: 3 } };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 69_632);
  const created = await f.request('POST', '/rooms', body); assert.equal(created.status, 201); assertUnrevealed(created.body.state);
  const oversizedQuiz = { ...body, ...admission(), quiz: largeQuiz(low + 1) };
  const invalid = await f.request('POST', '/rooms', oversizedQuiz); assert.equal(invalid.status, 400); assert.equal(invalid.body.error.code, 'invalid_quiz');
  const tooLarge = await f.request('POST', '/rooms', JSON.stringify({ ...body, padding: 'x'.repeat(69_632) }), undefined, true); assert.equal(tooLarge.status, 413);
  const ordinary = await f.request('POST', `/rooms/${created.body.code}/actions`, { ...command(created.body.state, 'heartbeat'), padding: 'x'.repeat(8192) }, created.body.token); assert.equal(ordinary.status, 413);
  const legacy = await f.request('POST', '/rooms', { ...admission(), settings: {}, padding: 'x'.repeat(8192) }); assert.equal(legacy.status, 413, 'legacy admission keeps its original smaller ceiling');
});

test('Quiz reveal is bound to the displayed question and close removes normalized room children while admission tombstones cannot recover it', async t => {
  const f = await fixture(t), host = await f.create(), a = await f.join(host, 'Ari'); await f.join(host, 'Bo');
  const started = (await f.action(host, await f.state(host), 'start')).body.state;
  const noRound = command(started, 'quiz-reveal'); delete noRound.roundId;
  const rejected = await f.request('POST', `/rooms/${host.code}/actions`, noRound, host.token); assert.equal(rejected.status, 409); assert.equal(rejected.body.error.code, 'invalid_round');
  assert.equal((await f.action(host, started, 'quiz-reveal')).status, 200);
  const next = (await f.action(host, await f.state(host), 'next')).body.state; assert.equal(next.round.index, 2);
  const stale = await f.request('POST', `/rooms/${host.code}/actions`, command(started, 'quiz-reveal'), host.token); assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'stale_round');
  assert.equal((await f.state(a)).phase, 'answer');
  const closed = await f.action(host, await f.state(host), 'close'); assert.deepEqual(closed, { status: 200, body: { state: null, closed: true } });
  for (const table of ['likerts_live_rooms', 'likerts_live_members', 'likerts_live_command_receipts', 'likerts_live_socket_leases']) assert.equal(f.store.database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0, `${table} owned rows removed`);
  assert.equal((await f.request('POST', '/admissions/recover', host.privateAdmission)).status, 410);
  assert.equal((await f.request('POST', '/rooms', host.createBody)).status, 410, 'lost original admission cannot silently create a replacement after close');
});
