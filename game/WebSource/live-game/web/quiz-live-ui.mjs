import { companionScene, castScene } from './quiz-scene.mjs';

/** Quiz-only views consume safe recipient state and the shared room shell. */
export function quizLiveView(state, ui) {
  const { el, text, button, act, confirm, invitation, playerList, standingsAvatar, clock, errorBlock, client, model, deadlinePassed } = ui;
  const host = state.role === 'host', r = state.round;
  const scoring = () => text('1,000 points for a correct answer. No speed bonus.', 'scoring-note');
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
        !state.hostConnected && text('Your host is reconnecting. Your locked answer is saved in the room.', 'message'),
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
        !host && text((own?.points ?? 0).toLocaleString('en') + ' points' + (own?.value === null ? ' · No answer locked' : ' · You chose ' + r.answers[own.value]), 'quiz-own-result'),
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
        el('div', { class: 'quiz-finished-actions' }, host ? button('Back to lobby for a rematch', () => act('rematch'), { id: 'rematch', className: 'button full' })
          : text('Waiting for the host to make the next move.', 'small')),
        errorBlock(), el('div', { class: 'quiz-finished-art' }, castScene(el,complete))), board());
  }
  return state.phase === 'lobby' ? lobby() : state.phase === 'answer' ? question() : state.phase === 'reveal' ? reveal() : finished();
}
