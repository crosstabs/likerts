import { companionScene, castScene, partyGuide, guideScene } from './quiz-scene.mjs';
import { quizAnswerBreakdown } from './quiz-answer-breakdown.mjs';

/** Quiz-only views consume safe recipient state and the shared room shell. */
export function quizLiveView(state, ui) {
  const { el, text, button, act, confirm, chooseAnotherQuiz, companionPicker, invitation, playerList, standingsAvatar, clock, errorBlock, client, model, deadlinePassed } = ui;
  const host = state.role === 'host', r = state.round;
  const breakdown = quizAnswerBreakdown(state);
  const detailsScope = state.phase === 'finished' && breakdown ? state.code + ':' + state.matchId + ':' + r.id : null;
  if (model.quizLastQuestionDetails?.scope !== detailsScope) model.quizLastQuestionDetails = detailsScope ? { scope: detailsScope, open: false } : null;
  const scoring = () => text('1,000 points for a correct answer. No speed bonus.', 'scoring-note');
  function answerBreakdown(id = 'quiz-answer-breakdown-title') {
    if (!breakdown) return null;
    const row = (label, count, { index, correct = false } = {}) => el('li', { class: 'quiz-breakdown-row' + (correct ? ' is-correct' : ''), 'data-answer-index': index },
      el('div', { class: 'quiz-breakdown-label' }, el('span', { class: 'quiz-breakdown-answer' }, label),
        correct && el('span', { class: 'quiz-breakdown-correct' }, el('span', { 'aria-hidden': 'true' }, '✓ '), 'Correct answer'),
        el('span', { class: 'quiz-breakdown-count' }, count + (count === 1 ? ' player' : ' players'))),
      el('meter', { class: 'quiz-breakdown-bar', min: 0, max: breakdown.total, value: count, 'aria-hidden': 'true' }));
    return el('section', { class: 'quiz-answer-breakdown', 'aria-labelledby': id },
      el('h2', { id }, 'How the room answered'),
      text(breakdown.correctCount + ' of ' + breakdown.total + ' correct', 'quiz-breakdown-summary'),
      el('ol', { class: 'quiz-breakdown-list' },
        r.answers.map((answer, index) => row(String.fromCharCode(65 + index) + ' · ' + answer, breakdown.counts[index], { index, correct: index === state.reveal.correctAnswer })),
        row('No answer locked', breakdown.unansweredCount)));
  }
  function lastQuestionDetails() {
    if (!detailsScope) return null;
    const details = el('details', { class: 'quiz-last-question-details', 'data-last-question-scope': detailsScope, open: model.quizLastQuestionDetails.open,
      ontoggle: event => {
        if (!event.currentTarget.isConnected || model.quizLastQuestionDetails?.scope !== detailsScope) return;
        model.quizLastQuestionDetails.open = event.currentTarget.open;
      } },
    el('summary', { id: 'quiz-last-question-summary' }, 'Last question details'),
    el('div', { class: 'quiz-last-question-copy' },
      text('Last question · Question ' + r.index + ' of ' + r.total, 'round-progress'),
      el('h2', { class: 'question' }, r.prompt),
      el('div', { class: 'quiz-correct-answer' }, text('Correct answer', 'small'), el('strong', {}, r.answers[state.reveal.correctAnswer])),
      state.reveal.explanation && text(state.reveal.explanation, 'quiz-explanation'),
      answerBreakdown('quiz-last-question-breakdown-title')));
    // Native toggle events are queued. Read the connected disclosure before its
    // replacement so a status render cannot lose a just-opened or closed state.
    const previous = details.ownerDocument.getElementById('quiz-last-question-summary')?.parentElement;
    if (previous?.isConnected && previous.dataset.lastQuestionScope === detailsScope) {
      model.quizLastQuestionDetails.open = previous.open;
      details.open = previous.open;
    }
    return details;
  }
  function guide(beat) {
    const value = partyGuide(beat);
    const art = guideScene(el, beat, 'live-party-guide-scene');
    // A changing guide must not consume or restart the question's entrance.
    art.removeAttribute('data-quiz-entrance');
    const confirming = beat === 'question' && !host && (model.busy || client.pendingAction?.action === 'quiz-answer');
    const expired = beat === 'question' && deadlinePassed(state);
    const title = confirming ? 'Confirming your choice.' : expired ? 'Waiting for the reveal.' : value.title;
    const cue = confirming ? 'Keep this tab open. Your answer is not confirmed yet.'
      : expired ? 'Time is up. The room is confirming this question.'
      : host && beat === 'question' ? 'Read it out. Your people choose and lock; you control the reveal.' : value.cue;
    return el('aside', { class: 'live-party-guide', 'aria-label': 'Party guide', 'data-party-beat': beat },
      art,
      el('div', {}, text(value.characterName + ' · ' + value.role, 'party-guide-name'),
        text(title, 'party-guide-title'), text(cue, 'party-guide-cue')));
  }
  const earlyEnd = () => button('Finish early', () => confirm('Finish this quiz early?',
    'Completed questions keep their points. This quiz will have provisional standings and no winner.', 'Finish quiz', () => act('end')), { className: 'text-button', id: 'finish-early' });
  function board() {
    const provisional = state.phase === 'finished' && state.completion !== 'complete';
    return el('section', { class: 'standings room-panel quiz-standings', 'aria-labelledby': 'standings-title' },
      el('h2', { id: 'standings-title' }, 'Your people'),
      text(provisional ? 'Provisional standings' : state.phase === 'finished' ? 'Final standings' : 'Standings so far', 'roster-count'),
      state.leaderboard.length ? el('ol', { class: 'leaderboard' }, state.leaderboard.map(row => el('li', { class: 'leader-row' },
        el('span', { class: 'rank', 'aria-label': row.rank === null ? 'Unranked' : 'Rank ' + row.rank }, row.rank ?? '—'),
        standingsAvatar(state, row.playerId),
        el('div', { class: 'score-name' }, el('strong', {}, row.nickname), el('small', {}, (row.points / 1000) + ' / ' + row.opportunities + ' correct')),
        el('strong', { class: 'quiz-points', 'aria-label': row.points + ' points' }, row.points.toLocaleString('en'), el('small', {}, 'points')))))
        : text('The first revealed question starts the board.', 'empty'), scoring());
  }
  function next() {
    return host ? button(r.index === r.total ? 'See final standings' : 'Next question', () => act('next'), { className: 'button full', id: 'next-round' })
      : text('Waiting for the host to ' + (r.index === r.total ? 'show final standings.' : 'start the next question.'), 'small centered');
  }
  function lobby() {
    return el('main', { id: 'main', tabindex: '-1', class: 'lobby quiz-lobby ' + (host ? 'host-layout' : 'guest-layout') },
      el('section', { class: 'lobby-copy' }, el('h1', {}, state.quiz.title),
        text(state.quiz.questionCount + (state.quiz.questionCount === 1 ? ' question. ' : ' questions. ') + 'One room. Everyone plays.', 'lede'),
        castScene(el), host ? invitation(state) : text('You’re in, ' + state.self.nickname + '. Room ' + state.code, 'quiz-joined'),
        text(host ? 'Invite 2–' + state.settings.capacity + ' players on web or iPhone. You control the questions.' : 'Waiting for the host to start.', 'small'),
        text('The quiz is hosted from a fixed copy. ' + (host ? 'Players’ answers stay private until reveal.' : 'Your answer is private until the question is revealed.'), 'small'),
        !host && companionPicker(state),
        guide('gather'),
        !state.hostConnected && text('Your host is reconnecting. Keep this tab open.', 'message')),
      el('section', { class: 'room-panel', 'aria-labelledby': 'roster-title' }, el('h2', { id: 'roster-title' }, 'In the room'),
        text(state.players.length + (state.players.length === 1 ? ' player' : ' players'), 'roster-count'),
        state.players.length ? playerList(state, { moderation: host }) : text('Players appear here when they join.', 'empty'),
        host && el('div', { class: 'lobby-controls' },
          el('label', { class: 'lock-row', for: 'lock-room' }, el('span', {}, el('strong', {}, 'Lock room'), el('small', {}, 'Stop new players joining')),
            el('input', { id: 'lock-room', type: 'checkbox', role: 'switch', checked: state.joinLocked, disabled: model.busy || !!client.pendingAction,
              onchange: event => void act('lock', { locked: event.target.checked }) })),
          button('Start quiz', () => act('start'), { className: 'button full', id: 'start-game', disabled: state.players.length < 2 }),
          text(state.players.length < 2 ? 'You need at least two players to begin.' : 'Everyone answers each question together.', 'small centered')),
        scoring()), errorBlock());
  }
  function answerChoices() {
    const selected = r.ownAnswer ?? model.selection, locked = r.ownAnswer !== null, expired = deadlinePassed(state);
    return el('div', { class: 'quiz-answer-area' },
      el('div', { class: 'quiz-live-answers', role: 'group', 'aria-label': 'Choose your answer' }, r.answers.map((answer, index) => button([
        el('span', { class: 'quiz-choice-letter', 'aria-hidden': 'true' }, String.fromCharCode(65 + index)),
        el('span', { class: 'quiz-choice-text' }, answer)], () => { model.selection = index; ui.render(); }, {
          className: 'quiz-live-choice' + (selected === index ? ' is-selected' : ''), id: 'quiz-choice-' + index,
          disabled: locked || expired || !!client.pendingAction, 'aria-pressed': selected === index, 'aria-label': String.fromCharCode(65 + index) + ' · ' + answer }))),
      locked ? el('div', { class: 'locked-message', role: 'status' }, 'Answer locked: ' + r.answers[r.ownAnswer])
        : button('Lock answer', () => act('quiz-answer', { value: model.selection }), { className: 'button full', id: 'lock-choice', disabled: model.selection === null || expired }),
      text(locked ? 'Waiting for the room to reveal the answer.' : expired ? 'Time has ended. Confirming the question…' : 'Choose, then lock. Your answer stays private until reveal.', 'small centered'));
  }
  function question() {
    const player = state.players.find(p => p.id === state.self.id);
    return el('main', { id: 'main', tabindex: '-1', class: 'quiz-question-screen' + (host ? ' is-host' : '') },
      el('section', { class: 'quiz-question-content' },
        el('div', { class: 'quiz-live-heading' }, el('div', {}, text(state.quiz.title, 'quiz-live-title'), text('Question ' + r.index + ' of ' + r.total, 'round-progress')),
          companionScene(el,player?.avatar??3,'is-compact quiz-player-avatar')),
        el('h1', {}, r.prompt), clock(state),
        host ? el('div', { class: 'quiz-host-question' }, el('ol', { class: 'quiz-observer-answers' }, r.answers.map((answer, index) => el('li', {},
          el('span', { class: 'quiz-choice-letter', 'aria-hidden': 'true' }, String.fromCharCode(65 + index)), el('span', {}, answer)))),
          text(r.submittedCount + ' of ' + r.eligibleCount + ' answers locked.', 'quiz-submitted'),
          el('div', { class: 'host-controls' }, button('Reveal answer now', () => confirm('Reveal this answer now?',
            'This ends the question for everyone. Players who have not locked an answer receive zero points.', 'Reveal answer', () => act('quiz-reveal')),
          { className: 'button outlined', id: 'reveal-question', disabled: deadlinePassed(state) }), earlyEnd()))
          : answerChoices(),
        !host && text(r.submittedCount + ' of ' + r.eligibleCount + ' answers locked.', 'quiz-submitted'),
        guide(!host && r.ownAnswer !== null ? 'locked' : 'question'),
        !state.hostConnected && text('Host disconnected. Timed questions continue on the server.', 'message'),
        errorBlock(), scoring()),
      host && el('aside', { class: 'round-sidebar' }, el('h2', {}, 'Your people'), playerList(state, { moderation: true })));
  }
  function reveal() {
    const v = state.reveal, own = v.results.find(result => result.playerId === state.self.id);
    const title = host ? 'The answer is in.' : own?.points === 1000 ? 'That’s right.' : own?.value === null ? 'Time to find out.' : 'A little wiser.';
    return el('main', { id: 'main', tabindex: '-1', class: 'reveal-layout quiz-reveal-layout' },
      el('section', { class: 'reveal-copy' }, text('Question ' + r.index + ' of ' + r.total, 'round-progress'), el('h1', {}, title),
        el('h2', { class: 'question' }, r.prompt),
        el('div', { class: 'quiz-correct-answer' }, text('Correct answer', 'small'), el('strong', {}, r.answers[v.correctAnswer])),
        v.explanation && text(v.explanation, 'quiz-explanation'),
        answerBreakdown(),
        !host && text((own?.points ?? 0).toLocaleString('en') + ' points' + (own?.value === null ? ' · No answer locked' : ' · You chose ' + r.answers[own.value]), 'quiz-own-result'),
        guide('reveal'),
        (host ? v.results.some(result => result.points === 1000) : own?.points === 1000) ? castScene(el,true)
          : el('div', { class: 'quiz-neutral-reveal' }, companionScene(el,state.players.find(p => p.id === state.self.id)?.avatar ?? 3)),
        el('ul', { class: 'guess-list quiz-result-list' }, v.results.map(result => el('li', {}, el('strong', {}, result.nickname),
          el('span', {}, result.value === null ? 'No answer' : r.answers[result.value]), el('strong', { class: 'points' }, result.points.toLocaleString('en') + ' points'))))),
      el('div', { class: 'board-column' }, board(), next(), host && earlyEnd(), errorBlock()));
  }
  function finished() {
    const complete = state.completion === 'complete';
    const row = host ? state.leaderboard.reduce((best, item) => !best || item.points > best.points ? item : best, null)
      : state.leaderboard.find(item => item.playerId === state.self.id);
    const points = row?.points ?? 0, opportunities = row?.opportunities ?? 0;
    const totalLabel = host ? complete ? 'Top score' : 'Highest provisional score' : 'Your total';
    return el('main', { id: 'main', tabindex: '-1', class: 'finished-layout quiz-finished' },
      el('section', { class: 'quiz-finished-copy' }, text(state.quiz.title, 'quiz-live-title'), el('h1', {}, complete ? 'Quiz complete' : 'Quiz ended · incomplete'),
        el('section', { class: 'quiz-result-summary' + (complete ? '' : ' is-provisional'), 'aria-labelledby': 'quiz-result-label' },
          el('h2', { id: 'quiz-result-label' }, totalLabel),
          el('p', { id: 'quiz-result-total', class: 'quiz-result-total' }, points.toLocaleString('en') + ' points'),
          el('p', { id: 'quiz-result-correct', class: 'quiz-result-correct' }, opportunities ? (points / 1000) + ' of ' + opportunities + ' correct' : 'No scored questions'),
          text(complete ? state.quiz.questionCount + (state.quiz.questionCount === 1 ? ' question, answered together.' : ' questions, answered together.')
            : 'Provisional total from ' + opportunities + (opportunities === 1 ? ' scored question.' : ' scored questions.') + ' There is no final winner.', 'quiz-result-note')),
        el('div', { class: 'quiz-finished-actions' }, host ? [button('Back to lobby for a rematch', () => act('rematch'), { id: 'rematch', className: 'button full' }),
          button('Choose another quiz', chooseAnotherQuiz, { id: 'choose-another-quiz', className: 'text-button', disabled: client.busy })]
          : text('Waiting for the host to make the next move.', 'small')),
        lastQuestionDetails(),
        guide('finished'),
        errorBlock(), el('div', { class: 'quiz-finished-art' }, castScene(el,complete))), board());
  }
  return state.phase === 'lobby' ? lobby() : state.phase === 'answer' ? question() : state.phase === 'reveal' ? reveal() : finished();
}
