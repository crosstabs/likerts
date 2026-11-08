/** Count choices from an already validated, scored protocol-v2 reveal only.
 * No points, private submissions, prior questions or client selections are read.
 */
export function quizAnswerBreakdown(state) {
  if (state?.protocolVersion !== 2 || state.mode !== 'quiz' || state.modeVersion !== 1
    || !['reveal', 'finished'].includes(state.phase) || state.reveal?.valid !== true) return null;
  const round = state.round, reveal = state.reveal;
  if (!round || !Array.isArray(round.answers) || round.answers.length < 2 || round.answers.length > 4
    || !Number.isSafeInteger(reveal.correctAnswer) || reveal.correctAnswer < 0 || reveal.correctAnswer >= round.answers.length
    || !Number.isSafeInteger(round.eligibleCount) || round.eligibleCount < 2 || round.eligibleCount > 50
    || !Array.isArray(reveal.results) || reveal.results.length !== round.eligibleCount) return null;
  const counts = Array(round.answers.length).fill(0);
  let unansweredCount = 0;
  for (const result of reveal.results) {
    const value = result?.value;
    if (value === null) unansweredCount++;
    else if (Number.isSafeInteger(value) && value >= 0 && value < counts.length) counts[value]++;
    else return null;
  }
  return Object.freeze({ counts: Object.freeze(counts), correctCount: counts[reveal.correctAnswer],
    answeredCount: round.eligibleCount - unansweredCount, unansweredCount, total: round.eligibleCount });
}
