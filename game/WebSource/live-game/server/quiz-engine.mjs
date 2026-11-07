import { randomUUID } from 'node:crypto';
import { fail } from './errors.mjs';
import { normalizeQuiz, QuizValidationError } from '../web/quiz-document.mjs';

export function validateQuizSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'capacity')) fail('invalid_settings', 'Choose a quiz room capacity.');
  const capacity = Object.hasOwn(value, 'capacity') ? value.capacity : 12;
  if (!Number.isSafeInteger(capacity) || capacity < 2 || capacity > 50) fail('invalid_settings', 'Choose a quiz room capacity from 2 to 50.');
  return { capacity };
}

export function normalizeLiveQuiz(value) {
  try { return normalizeQuiz(value); }
  catch (error) {
    if (error instanceof QuizValidationError) fail('invalid_quiz', error.message);
    throw error;
  }
}

export function beginQuizRound(room, now) {
  room.roundIndex++;
  const question = room.quizSnapshot.questions[room.roundIndex - 1];
  room.round = { id: randomUUID(), index: room.roundIndex, submissions: {}, deadline: question.timeLimitSeconds ? now + question.timeLimitSeconds * 1000 : null, scored: false, valid: null, reason: null };
  room.phase = 'answer'; room.notice = null;
}

export function revealQuiz(room, valid, reason) {
  const round = room.round;
  if (round.scored) return;
  const question = room.quizSnapshot.questions[round.index - 1];
  round.valid = valid; round.reason = reason; round.deadline = null;
  if (valid) {
    for (const player of room.roster) {
      const score = room.scores[player.id];
      score.opportunities++;
      if (round.submissions[player.id] === question.correctAnswer) score.points += 1000;
    }
  } else {
    room.hadIncomplete = true;
    round.submissions = {};
  }
  round.scored = true; room.phase = 'reveal';
}

export function finishQuiz(room, now, reason, durations) {
  if (room.round && room.phase === 'answer') revealQuiz(room, false, reason);
  room.completion = reason === 'completed' && !room.hadIncomplete ? 'complete' : 'incomplete';
  room.phase = 'finished'; room.finishedAt = now; room.expiresAt = Math.min(room.hardExpiresAt, now + durations.finished);
  room.notice = room.completion === 'complete' ? 'Quiz complete.' : 'Incomplete quiz. Results are provisional.';
}

export function applyQuizAnswer(room, actorId, value) {
  const round = room.round;
  if (room.phase !== 'answer' || actorId === 'host' || !room.roster.some(player => player.id === actorId)) fail('wrong_phase', 'Only an eligible player can lock an answer now.', 409);
  const question = room.quizSnapshot.questions[round.index - 1];
  if (value >= question.answers.length) fail('invalid_value', 'Choose an answer from this question.');
  if (Object.hasOwn(round.submissions, actorId)) fail('already_locked', 'This answer is already locked.', 409);
  round.submissions[actorId] = value;
  if (Object.keys(round.submissions).length === room.roster.length) revealQuiz(room, true, 'answered');
}

export function projectQuiz(room, actorId, actor, now, durations) {
  const connected = value => now - value.lastSeen < durations.presence;
  const leaderboard = (room.roster.length ? room.roster : room.players).map(player => {
    const score = room.scores[player.id] ?? { points: 0, opportunities: 0 };
    return { playerId: player.id, nickname: player.nickname, points: score.points, opportunities: score.opportunities, accuracy: score.opportunities ? score.points / (score.opportunities * 10) : null, rank: null };
  }).sort((a, b) => b.points - a.points || a.nickname.localeCompare(b.nickname, 'en'));
  if (room.completion === 'complete') for (let i = 0; i < leaderboard.length; i++) leaderboard[i].rank = i && leaderboard[i].points === leaderboard[i - 1].points ? leaderboard[i - 1].rank : i + 1;
  let current = null, revealed = null;
  const round = room.round;
  if (round) {
    const question = room.quizSnapshot.questions[round.index - 1];
    const mayReveal = ['reveal', 'finished'].includes(room.phase) && round.scored;
    current = { id: round.id, index: round.index, total: room.totalRounds, questionId: question.id, prompt: question.prompt, answers: [...question.answers], deadline: round.deadline, submittedCount: Object.keys(round.submissions).length, eligibleCount: room.roster.length, ownAnswer: actorId === 'host' || mayReveal && !round.valid ? null : round.submissions[actorId] ?? null };
    if (mayReveal) {
      const results = room.roster.map(player => ({ playerId: player.id, nickname: player.nickname, value: round.valid ? round.submissions[player.id] ?? null : null, points: round.valid && round.submissions[player.id] === question.correctAnswer ? 1000 : 0 }));
      revealed = { correctAnswer: round.valid ? question.correctAnswer : null, explanation: round.valid ? question.explanation : '', valid: round.valid, reason: round.reason, results, groupAccuracy: round.valid ? results.filter(result => result.points === 1000).length / results.length * 100 : null };
    }
  }
  return {
    protocolVersion: 2, mode: 'quiz', modeVersion: 1, code: room.code, matchId: room.matchId, revision: room.revision, serverTime: now, expiresAt: room.expiresAt,
    role: actorId === 'host' ? 'host' : 'player', self: { id: actorId, nickname: actorId === 'host' ? 'Host' : actor.nickname }, phase: room.phase, joinLocked: room.joinLocked,
    settings: { capacity: room.settings.capacity }, hostConnected: connected(room.host), players: room.players.map(player => ({ id: player.id, nickname: player.nickname, avatar: player.avatar, connected: connected(player) })),
    round: current, reveal: revealed, leaderboard, completion: room.completion, notice: room.notice, quiz: { id: room.quizSnapshot.id, title: room.quizSnapshot.title, questionCount: room.quizSnapshot.questions.length },
  };
}
