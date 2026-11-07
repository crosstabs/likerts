import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail } from './errors.mjs';
import { applyQuizAnswer, beginQuizRound, finishQuiz, normalizeLiveQuiz, projectQuiz, revealQuiz, validateQuizSettings } from './quiz-engine.mjs';
export { normalizeLiveQuiz, validateQuizSettings } from './quiz-engine.mjs';

export const DURATIONS = Object.freeze({ hard: 6 * 60 * 60_000, idle: 2 * 60 * 60_000, finished: 15 * 60_000, presence: 45_000 });
export const DEFAULT_SETTINGS = Object.freeze({ topic: 'mix', cycles: 1, capacity: 12, answerSeconds: 60, predictSeconds: 60 });
export const tokenVerifier = token => createHash('sha256').update(token).digest('hex');
export const freshToken = () => randomBytes(32).toString('base64url');
export const freshCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');
export const validCode = value => typeof value === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const shuffle = values => { const result = [...values]; for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; } return result; };
const canonical = value => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const commandFingerprint = digest;
const member = (room, id) => id === 'host' ? room.host : room.players.find(player => player.id === id);

export function validateCatalogue(catalogue) {
  if (!object(catalogue) || catalogue.version !== 1 || catalogue.locale !== 'en' || !Array.isArray(catalogue.topics) || !Array.isArray(catalogue.rounds) || !/^[a-f0-9]{64}$/.test(catalogue.sha256 ?? '')) throw new Error('Invalid reviewed catalogue');
  const { sha256, ...data } = catalogue;
  if (createHash('sha256').update(JSON.stringify(data)).digest('hex') !== sha256) throw new Error('Reviewed catalogue checksum mismatch');
  const topics = new Set(catalogue.topics.map(topic => topic.id));
  const ids = new Set();
  for (const prompt of catalogue.rounds) {
    if (!Number.isSafeInteger(prompt.id) || ids.has(prompt.id) || !topics.has(prompt.topic) || typeof prompt.text !== 'string' || typeof prompt.sceneSummary !== 'string') throw new Error('Invalid reviewed catalogue round');
    ids.add(prompt.id);
  }
  if (!ids.size || topics.size !== catalogue.topics.length) throw new Error('Empty or duplicated reviewed catalogue');
  return catalogue;
}

export function validateSettings(value = {}, catalogue) {
  if (!object(value)) fail('invalid_settings', 'Choose valid room settings.');
  const settings = { ...DEFAULT_SETTINGS, ...value };
  if (Object.keys(settings).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key)) || !['mix', ...catalogue.topics.map(topic => topic.id)].includes(settings.topic)
      || ![1, 2, 3].includes(settings.cycles) || !Number.isSafeInteger(settings.capacity) || settings.capacity < 2 || settings.capacity > 50
      || ![0, 30, 60, 120].includes(settings.answerSeconds) || ![0, 30, 60, 120].includes(settings.predictSeconds)) fail('invalid_settings', 'Choose valid room settings.');
  return settings;
}

export function normalizeNickname(value) {
  if (typeof value !== 'string' || value.length > 200) fail('invalid_nickname', 'Use a nickname of 1–20 letters or numbers.');
  const nickname = value.normalize('NFKC').trim();
  if ([...nickname].length < 1 || [...nickname].length > 20 || !/^[\p{L}\p{N}\p{M} '\u2019_-]+$/u.test(nickname) || !/[\p{L}\p{N}]/u.test(nickname)) fail('invalid_nickname', 'Use a nickname of 1–20 letters or numbers.');
  return nickname;
}

export function createRoom(settings, { code = freshCode(), token = freshToken(), catalogue, now = Date.now() } = {}) {
  const room = {
    protocolVersion: 1, code, instanceId: randomUUID(), matchId: randomUUID(), revision: 1,
    createdAt: now, lastActivityAt: now, hardExpiresAt: now + DURATIONS.hard, expiresAt: now + DURATIONS.idle,
    catalogVersion: catalogue.version, catalogHash: catalogue.sha256, settings: validateSettings(settings, catalogue),
    host: { id: 'host', tokenHash: tokenVerifier(token), lastSeen: now }, players: [], roster: [],
    phase: 'lobby', joinLocked: false, round: null, subjectOrder: [], roundIndex: 0, totalRounds: 0,
    usedPromptIds: [], scores: {}, requests: {}, revocations: {}, completion: null, hadIncomplete: false, finishedAt: null, notice: null,
  };
  return { room, token, memberId: 'host' };
}

// The document is normalized into a fresh server-owned value, never retained
// from a caller's mutable library. It is not changed by any game command.
export function createQuizRoom(quiz, settings = {}, { code = freshCode(), token = freshToken(), now = Date.now() } = {}) {
  const room = {
    protocolVersion: 2, mode: 'quiz', modeVersion: 1, code, instanceId: randomUUID(), matchId: randomUUID(), revision: 1,
    createdAt: now, lastActivityAt: now, hardExpiresAt: now + DURATIONS.hard, expiresAt: now + DURATIONS.idle,
    settings: validateQuizSettings(settings), quizSnapshot: normalizeLiveQuiz(quiz),
    host: { id: 'host', tokenHash: tokenVerifier(token), lastSeen: now }, players: [], roster: [],
    phase: 'lobby', joinLocked: false, round: null, roundIndex: 0, totalRounds: 0,
    scores: {}, requests: {}, revocations: {}, completion: null, hadIncomplete: false, finishedAt: null, notice: null,
  };
  return { room, token, memberId: 'host' };
}

export function roomMode(room) {
  if (room.mode === undefined && room.protocolVersion === 1) return 'mind-reading';
  if (room.mode === 'quiz' && room.modeVersion === 1 && room.protocolVersion === 2) return 'quiz';
  fail('mode_unavailable', 'This room uses an unsupported game version.', 503);
}

export function identify(room, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('unauthorized', 'A valid room credential is required.', 401);
  const verifier = tokenVerifier(token);
  if (same(room.host.tokenHash, verifier)) return 'host';
  const player = room.players.find(item => same(item.tokenHash, verifier));
  if (!player) fail('unauthorized', 'A valid room credential is required.', 401);
  return player.id;
}

export function touch(room, id, now) {
  const actor = member(room, id);
  if (!actor) fail('unauthorized', 'A valid room credential is required.', 401);
  actor.lastSeen = now;
  room.lastActivityAt = now;
  room.expiresAt = Math.min(room.hardExpiresAt, room.finishedAt === null ? now + DURATIONS.idle : room.finishedAt + DURATIONS.finished);
}

export function joinRoom(room, value, { token = freshToken(), now = Date.now() } = {}) {
  const next = structuredClone(room);
  if (!object(value) || Object.keys(value).some(key => !['nickname', 'acceptRoomSharing'].includes(key)) || value.acceptRoomSharing !== true) fail('sharing_consent_required', 'Accept room sharing before joining.');
  if (next.phase !== 'lobby' || next.joinLocked) fail('room_locked', 'This room is not accepting players.', 409);
  if (next.players.length >= next.settings.capacity) fail('room_full', 'This room is full.', 409);
  const nickname = normalizeNickname(value.nickname);
  if (next.players.some(player => player.nickname.toLocaleLowerCase('en') === nickname.toLocaleLowerCase('en'))) fail('nickname_taken', 'Choose a different nickname.', 409);
  const id = randomUUID();
  next.players.push({ id, nickname, avatar: next.players.length % 5 + 1, tokenHash: tokenVerifier(token), lastSeen: now });
  touch(next, id, now); next.revision++;
  return { room: next, token, memberId: id };
}

function beginRound(room, catalogue, now) {
  const prompts = catalogue.rounds.filter(prompt => room.settings.topic === 'mix' || prompt.topic === room.settings.topic);
  let available = prompts.filter(prompt => !room.usedPromptIds.includes(prompt.id));
  if (!available.length) { room.usedPromptIds = []; available = prompts; }
  const prompt = available[randomInt(available.length)];
  room.usedPromptIds.push(prompt.id);
  room.roundIndex++;
  const subjectId = room.subjectOrder[(room.roundIndex - 1) % room.subjectOrder.length];
  room.round = { id: randomUUID(), index: room.roundIndex, subjectId, promptId: prompt.id, answer: null, guesses: {}, deadline: room.settings.answerSeconds ? now + room.settings.answerSeconds * 1000 : null, paused: false, remainingMs: null, scored: false, valid: null, reason: null };
  room.phase = 'answer'; room.notice = null;
}

function reveal(room, valid, reason) {
  const round = room.round;
  if (round.scored) return;
  round.valid = valid; round.reason = reason; round.deadline = null; round.paused = false; round.remainingMs = null;
  if (valid) {
    for (const player of room.roster.filter(player => player.id !== round.subjectId)) {
      const score = room.scores[player.id];
      score.opportunities++;
      score.points += Object.hasOwn(round.guesses, player.id) ? 100 - 25 * Math.abs(round.guesses[player.id] - round.answer) : 0;
    }
  } else {
    room.hadIncomplete = true;
    // Invalid rounds never carry a secret into any subsequent snapshot.
    round.answer = null; round.guesses = {};
  }
  round.scored = true; room.phase = 'reveal';
}

function finish(room, now, reason) {
  if (roomMode(room) === 'quiz') return finishQuiz(room, now, reason, DURATIONS);
  if (room.round && ['answer', 'predict'].includes(room.phase)) reveal(room, false, reason);
  room.completion = reason === 'completed' && !room.hadIncomplete ? 'complete' : 'incomplete';
  room.phase = 'finished'; room.finishedAt = now; room.expiresAt = Math.min(room.hardExpiresAt, now + DURATIONS.finished);
  room.notice = room.completion === 'complete' ? 'Match complete.' : 'Incomplete match. Results are provisional.';
}

export function advance(room, now) {
  const mode = roomMode(room);
  const round = room.round;
  if (mode === 'quiz') {
    if (!round || room.phase !== 'answer' || round.deadline === null || now < round.deadline) return false;
    revealQuiz(room, true, 'timeout'); room.revision++; return true;
  }
  if (!round || !['answer', 'predict'].includes(room.phase) || round.paused || round.deadline === null || now < round.deadline) return false;
  if (room.phase === 'answer') reveal(room, false, 'subject_timeout');
  else reveal(room, true, 'prediction_timeout');
  room.revision++;
  return true;
}

export function validateCommand(command) {
  if (!object(command) || !uuid(command.requestId) || !uuid(command.matchId) || typeof command.action !== 'string') fail('invalid_command', 'Use a valid command and request identifier.');
  const fields = { start: [], next: [], pause: [], resume: [], skip: [], lock: ['locked'], kick: ['playerId'], end: [], rematch: [], close: [], answer: ['value'], guess: ['value'], 'quiz-answer': ['value'], 'quiz-reveal': [], leave: [], heartbeat: [] };
  if (!Object.hasOwn(fields, command.action)) fail('invalid_action', 'This action is not supported.');
  if (Object.keys(command).some(key => !['requestId', 'matchId', 'roundId', 'expectedRevision', 'action', ...fields[command.action]].includes(key))) fail('invalid_command', 'This command contains unsupported fields.');
  if (['answer', 'guess', 'quiz-answer', 'quiz-reveal', 'next', 'pause', 'resume', 'skip'].includes(command.action) && !uuid(command.roundId)) fail('invalid_round', 'Use the current round identifier.', 409);
  if (command.expectedRevision !== undefined && (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0)) fail('invalid_revision', 'Use a valid revision.');
  if (['answer', 'guess'].includes(command.action) && (!Number.isSafeInteger(command.value) || command.value < 1 || command.value > 5)) fail('invalid_value', 'Choose one of the five takes.');
  if (command.action === 'quiz-answer' && (!Number.isSafeInteger(command.value) || command.value < 0 || command.value > 3)) fail('invalid_value', 'Choose an answer from this question.');
  if (command.action === 'lock' && typeof command.locked !== 'boolean') fail('invalid_command', 'Choose whether to lock this room.');
  if (command.action === 'kick' && !uuid(command.playerId)) fail('invalid_player', 'Choose a current player.');
  return command;
}

export function reduceRoom(room, actorId, command, { catalogue, now = Date.now(), maxRequests = 50_000, receiptContext } = {}) {
  validateCommand(command);
  const next = structuredClone(room);
  const quiz = roomMode(next) === 'quiz';
  advance(next, now);
  if (!member(next, actorId)) fail('unauthorized', 'A valid room credential is required.', 401);
  const requestKey = `${actorId}:${command.requestId.toLowerCase()}`;
  const fingerprint = digest(command);
  const external = next.storageVersion === 3;
  if (external && (!receiptContext || receiptContext.roomInstanceId !== room.instanceId || receiptContext.scope !== 'active' || receiptContext.actorId !== actorId
    || receiptContext.requestId !== command.requestId.toLowerCase() || receiptContext.fingerprint !== fingerprint
    || !Number.isSafeInteger(receiptContext.receiptCount) || receiptContext.receiptCount < 0
    || (receiptContext.existingFingerprint !== null && !/^[a-f0-9]{64}$/.test(receiptContext.existingFingerprint ?? '')))) fail('configuration_error', 'A matching durable command receipt context is required.', 503);
  const existing = external ? receiptContext.existingFingerprint : next.requests[requestKey];
  if (existing !== null && existing !== undefined) {
    if (existing !== fingerprint) fail('request_conflict', 'This request identifier has already been used.', 409);
    return { room: next, replayed: true, closed: false, recordReceipt: false };
  }
  if (command.matchId !== next.matchId) fail('stale_match', 'Refresh this room before trying again.', 409);
  if (command.roundId !== undefined && command.roundId !== next.round?.id) fail('stale_round', 'Refresh the current round before trying again.', 409);
  const hostActions = ['start', 'next', 'pause', 'resume', 'skip', 'quiz-reveal', 'lock', 'kick', 'end', 'rematch', 'close'];
  if (hostActions.includes(command.action) && actorId !== 'host') fail('forbidden', 'Only the host can use this control.', 403);
  if (actorId === 'host' && command.expectedRevision !== undefined && command.expectedRevision !== next.revision) fail('stale_revision', 'Refresh this room before trying again.', 409);
  // A participant must retain self-revocation, and a host deletion, even if
  // ordinary command receipts are exhausted. Neither creates another general
  // receipt: close deletes the room; leave keeps its exact retry in the existing
  // capability revocation record below.
  if (!['close', 'leave'].includes(command.action) && (external ? receiptContext.receiptCount : Object.keys(next.requests).length) >= maxRequests) fail('request_limit', 'This room has reached its command limit. Close it and create a new room.', 409);
  if (quiz ? ['answer', 'guess', 'pause', 'resume', 'skip'].includes(command.action) : ['quiz-answer', 'quiz-reveal'].includes(command.action)) fail('invalid_action', 'This action is not supported in this game mode.');
  const active = ['answer', 'predict'].includes(next.phase);
  const round = next.round;
  switch (command.action) {
    case 'start':
      if (next.phase !== 'lobby' || next.players.length < 2) fail('not_ready', 'Start from a lobby with at least two players.', 409);
      if (quiz) {
        next.roster = next.players.map(({ id, nickname, avatar }) => ({ id, nickname, avatar }));
        next.totalRounds = next.quizSnapshot.questions.length;
        next.scores = Object.fromEntries(next.players.map(player => [player.id, { points: 0, opportunities: 0 }]));
        beginQuizRound(next, now); break;
      }
      if (next.catalogHash !== catalogue.sha256) fail('catalogue_changed', 'Create a new room with the current catalogue.', 409);
      next.roster = next.players.map(({ id, nickname, avatar }) => ({ id, nickname, avatar }));
      next.subjectOrder = shuffle(next.roster.map(player => player.id));
      next.totalRounds = next.players.length * next.settings.cycles;
      next.scores = Object.fromEntries(next.players.map(player => [player.id, { points: 0, opportunities: 0 }]));
      beginRound(next, catalogue, now); break;
    case 'answer':
      if (next.phase !== 'answer' || actorId !== round?.subjectId || round.paused) fail('wrong_phase', 'Only the subject can lock an answer now.', 409);
      if (round.answer !== null) fail('already_locked', 'This answer is already locked.', 409);
      round.answer = command.value; next.phase = 'predict'; round.deadline = next.settings.predictSeconds ? now + next.settings.predictSeconds * 1000 : null; break;
    case 'guess':
      if (next.phase !== 'predict' || actorId === 'host' || actorId === round?.subjectId || round.paused || !next.roster.some(player => player.id === actorId)) fail('wrong_phase', 'Only an eligible player can lock a prediction now.', 409);
      if (Object.hasOwn(round.guesses, actorId)) fail('already_locked', 'This prediction is already locked.', 409);
      round.guesses[actorId] = command.value;
      if (Object.keys(round.guesses).length === next.roster.length - 1) reveal(next, true, 'all_locked');
      break;
    case 'quiz-answer': applyQuizAnswer(next, actorId, command.value); break;
    case 'quiz-reveal':
      if (next.phase !== 'answer') fail('wrong_phase', 'Only an active question can be revealed.', 409);
      revealQuiz(next, true, 'host_revealed'); break;
    case 'next':
      if (next.phase !== 'reveal') fail('wrong_phase', 'Wait for this round to reveal.', 409);
      if (next.roundIndex === next.totalRounds) finish(next, now, 'completed'); else if (quiz) beginQuizRound(next, now); else beginRound(next, catalogue, now);
      break;
    case 'pause':
      if (!active || round.paused) fail('wrong_phase', 'Only an active round can be paused.', 409);
      round.remainingMs = round.deadline === null ? null : Math.max(0, round.deadline - now); round.deadline = null; round.paused = true; break;
    case 'resume':
      if (!active || !round.paused) fail('wrong_phase', 'This round is not paused.', 409);
      round.deadline = round.remainingMs === null ? null : now + round.remainingMs; round.remainingMs = null; round.paused = false; break;
    case 'skip':
      if (!active) fail('wrong_phase', 'Only an active round can be skipped.', 409);
      reveal(next, false, 'skipped'); break;
    case 'lock':
      if (next.phase !== 'lobby') fail('wrong_phase', 'Room admission is fixed during a match.', 409);
      next.joinLocked = command.locked; break;
    case 'kick': {
      const removed = next.players.find(player => player.id === command.playerId);
      if (!removed) fail('invalid_player', 'Choose a current player.', 404);
      if (['answer', 'predict', 'reveal'].includes(next.phase)) finish(next, now, 'player_removed');
      next.players = next.players.filter(player => player.id !== command.playerId); break;
    }
    case 'leave':
      if (actorId === 'host') fail('forbidden', 'The host can close the room.', 403);
      if (['answer', 'predict', 'reveal'].includes(next.phase)) finish(next, now, 'player_left');
      next.revocations ??= {};
      next.revocations[next.players.find(player => player.id === actorId).tokenHash] = { memberId: actorId, requestId: command.requestId.toLowerCase(), fingerprint };
      next.players = next.players.filter(player => player.id !== actorId); break;
    case 'end':
      if (!['answer', 'predict', 'reveal'].includes(next.phase)) fail('wrong_phase', 'There is no active match to end.', 409);
      finish(next, now, 'host_ended'); break;
    case 'rematch':
      if (next.phase !== 'finished') fail('wrong_phase', 'Finish this match before a rematch.', 409);
      next.matchId = randomUUID(); next.phase = 'lobby'; next.joinLocked = false; next.round = null; next.roster = []; next.subjectOrder = []; next.roundIndex = 0; next.totalRounds = 0; next.scores = {}; next.completion = null; next.hadIncomplete = false; next.finishedAt = null; next.notice = null; break;
    case 'close': return { room: null, replayed: false, closed: true, recordReceipt: false };
    case 'heartbeat': break;
  }
  if (!external && command.action !== 'leave') next.requests[requestKey] = fingerprint;
  if (member(next, actorId)) touch(next, actorId, now);
  next.revision++;
  return { room: next, replayed: false, closed: false, recordReceipt: external && command.action !== 'leave' };
}

// A lost successful leave response can be retried without granting the revoked
// capability access to room state or any other action. The receipt stores hashes.
export function revokedLeaveActor(room, token, command) {
  if (command.action !== 'leave') return null;
  const record = room.revocations?.[tokenVerifier(token)];
  return typeof record === 'string' ? record : record?.memberId ?? null;
}
export function replayLeft(room, token, command, receiptContext) {
  const record = room.revocations?.[tokenVerifier(token)];
  if (!record || command.action !== 'leave') return false;
  // Accept the earlier persisted string format without rewriting user rooms.
  const fingerprint = typeof record === 'string' ? room.storageVersion === 3
    ? receiptContext?.roomInstanceId === room.instanceId && receiptContext.scope === 'revoked_leave' && receiptContext.actorId === record && receiptContext.requestId === command.requestId.toLowerCase() ? receiptContext.existingFingerprint ?? undefined : undefined
    : room.requests[`${record}:${command.requestId.toLowerCase()}`]
    : record.requestId === command.requestId.toLowerCase() ? record.fingerprint : undefined;
  if (fingerprint === undefined) return false;
  if (fingerprint !== digest(command)) fail('request_conflict', 'This request identifier has already been used.', 409);
  return true;
}

export function project(room, actorId, { catalogue, now = Date.now() } = {}) {
  const actor = member(room, actorId);
  if (!actor) fail('unauthorized', 'A valid room credential is required.', 401);
  if (roomMode(room) === 'quiz') return projectQuiz(room, actorId, actor, now, DURATIONS);
  const connected = value => now - value.lastSeen < DURATIONS.presence;
  const scores = (room.roster.length ? room.roster : room.players).map(player => {
    const score = room.scores[player.id] ?? { points: 0, opportunities: 0 };
    return { playerId: player.id, nickname: player.nickname, points: score.points, opportunities: score.opportunities, accuracy: score.opportunities ? score.points / score.opportunities : null, rank: null };
  }).sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1) || b.points - a.points || a.nickname.localeCompare(b.nickname, 'en'));
  if (room.completion === 'complete') for (let i = 0; i < scores.length; i++) scores[i].rank = i && scores[i].points === scores[i - 1].points ? scores[i - 1].rank : i + 1;
  let current = null, revealed = null;
  const round = room.round;
  if (round) {
    const prompt = catalogue.rounds.find(prompt => prompt.id === round.promptId);
    if (!prompt || room.catalogHash !== catalogue.sha256) fail('catalogue_unavailable', 'This room’s reviewed catalogue is unavailable.', 503);
    const subject = room.roster.find(player => player.id === round.subjectId);
    const mayReveal = ['reveal', 'finished'].includes(room.phase) && round.scored;
    current = {
      id: round.id, index: round.index, total: room.totalRounds, subjectId: round.subjectId, subjectName: subject.nickname,
      prompt: { id: prompt.id, text: prompt.text, topic: prompt.topic, sceneSummary: prompt.sceneSummary },
      deadline: round.deadline, paused: round.paused, answerLocked: round.answer !== null,
      submittedCount: room.phase === 'answer' ? 0 : Object.keys(round.guesses).length, eligibleCount: room.roster.length - 1,
      ownAnswer: actorId === round.subjectId && (!mayReveal || round.valid) ? round.answer : null,
      ownGuess: actorId !== 'host' && actorId !== round.subjectId && (!mayReveal || round.valid) ? round.guesses[actorId] ?? null : null,
    };
    if (mayReveal) {
      const guesses = room.roster.filter(player => player.id !== round.subjectId).map(player => ({ playerId: player.id, nickname: player.nickname, value: round.valid ? round.guesses[player.id] ?? null : null, points: round.valid && Object.hasOwn(round.guesses, player.id) ? 100 - 25 * Math.abs(round.guesses[player.id] - round.answer) : 0 }));
      revealed = { answer: round.valid ? round.answer : null, valid: round.valid, reason: round.reason, guesses, groupAccuracy: round.valid ? guesses.reduce((sum, guess) => sum + guess.points, 0) / guesses.length : null };
    }
  }
  return {
    protocolVersion: 1, code: room.code, matchId: room.matchId, revision: room.revision, serverTime: now, expiresAt: room.expiresAt,
    catalogVersion: room.catalogVersion, catalogHash: room.catalogHash, role: actorId === 'host' ? 'host' : 'player', self: { id: actorId, nickname: actorId === 'host' ? 'Host' : actor.nickname },
    phase: room.phase, joinLocked: room.joinLocked, settings: { ...room.settings }, hostConnected: connected(room.host),
    players: room.players.map(player => ({ id: player.id, nickname: player.nickname, avatar: player.avatar, connected: connected(player) })),
    round: current, reveal: revealed, leaderboard: scores, completion: room.completion, notice: room.notice,
  };
}
