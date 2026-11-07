/** Strict protocol-v2 recipient projection. Creator documents never reach this renderer. */
const keys = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const liveUUID = value => uuid(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value, max, { empty = false, multiline = false } = {}) => typeof value === 'string'
  && value.isWellFormed() && value === value.normalize('NFC') && value === value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
  && [...value].length >= (empty ? 0 : 1) && [...value].length <= max
  && !(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u : /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u).test(value);
const nickname = value => typeof value === 'string' && value.length <= 40 && [...value].length <= 20
  && value.length > 0 && /^[\p{L}\p{N}\p{M} _'’-]+$/u.test(value);
const accuracy = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);
const unique = values => new Set(values).size === values.length;

export function validateQuizState(s, credential, reject) {
  const invalid = () => { reject(); throw new Error('Invalid quiz state'); };
  if (!keys(s, ['protocolVersion','mode','modeVersion','code','matchId','revision','serverTime','expiresAt','role','self','phase','joinLocked','settings','hostConnected','players','round','reveal','leaderboard','completion','notice','quiz'])
    || s.protocolVersion !== 2 || s.mode !== 'quiz' || s.modeVersion !== 1 || !credential || s.code !== credential.code
    || !['lobby','answer','reveal','finished'].includes(s.phase) || !liveUUID(s.matchId) || !integer(s.revision,0)
    || !integer(s.serverTime,0) || !integer(s.expiresAt,s.serverTime+1) || !['host','player'].includes(s.role)
    || !keys(s.self,['id','nickname']) || s.self.id !== credential.memberId || !nickname(s.self.nickname)
    || (s.role === 'host' ? s.self.id !== 'host' : !liveUUID(s.self.id))
    || !keys(s.settings,['capacity']) || !integer(s.settings.capacity,2,50) || typeof s.joinLocked !== 'boolean' || typeof s.hostConnected !== 'boolean'
    || !(s.notice === null || text(s.notice,1000)) || !keys(s.quiz,['id','title','questionCount']) || !uuid(s.quiz.id)
    || !text(s.quiz.title,80) || !integer(s.quiz.questionCount,1,30)
    || !Array.isArray(s.players) || s.players.length > s.settings.capacity || !Array.isArray(s.leaderboard) || s.leaderboard.length > s.settings.capacity) invalid();
  if (!s.players.every(p => keys(p,['id','nickname','avatar','connected']) && liveUUID(p.id) && nickname(p.nickname) && integer(p.avatar,1,5) && typeof p.connected === 'boolean')
    || !unique(s.players.map(p => p.id)) || (s.role === 'player' && !s.players.some(p => p.id === s.self.id))
    || !s.leaderboard.every(r => keys(r,['playerId','nickname','points','opportunities','accuracy','rank']) && liveUUID(r.playerId) && nickname(r.nickname)
      && integer(r.points,0,s.quiz.questionCount*1000) && r.points % 1000 === 0 && integer(r.opportunities,0,s.quiz.questionCount)
      && r.points <= r.opportunities*1000 && accuracy(r.accuracy) && (r.opportunities === 0 ? r.accuracy === null : r.accuracy !== null)
      && (s.phase === 'finished' && s.completion === 'complete' ? integer(r.rank,1,s.settings.capacity) : r.rank === null))
    || !unique(s.leaderboard.map(r => r.playerId))) invalid();
  if (s.phase === 'lobby' && (s.round !== null || s.reveal !== null || s.completion !== null)) invalid();
  if (s.phase !== 'finished' && s.completion !== null) invalid();
  if (s.phase === 'finished' && !['complete','incomplete'].includes(s.completion)) invalid();
  if (s.phase === 'answer' && (s.round === null || s.reveal !== null)) invalid();
  if (s.phase === 'reveal' && (s.round === null || s.reveal === null)) invalid();
  if (s.phase === 'finished' && s.completion === 'complete' && (s.round === null || s.reveal === null)) invalid();
  if (s.round !== null) {
    const r = s.round;
    if (!keys(r,['id','index','total','questionId','prompt','answers','deadline','submittedCount','eligibleCount','ownAnswer'])
      || !liveUUID(r.id) || !uuid(r.questionId) || r.questionId === s.quiz.id || r.total !== s.quiz.questionCount || !integer(r.index,1,r.total)
      || !text(r.prompt,240,{multiline:true}) || !Array.isArray(r.answers) || !integer(r.answers.length,2,4)
      || !r.answers.every(answer => text(answer,100)) || !unique(r.answers) || !(r.deadline === null || integer(r.deadline,0))
      || !integer(r.eligibleCount,2,s.settings.capacity) || !integer(r.submittedCount,0,r.eligibleCount)
      || !(r.ownAnswer === null || integer(r.ownAnswer,0,r.answers.length-1)) || (s.role === 'host' && r.ownAnswer !== null)) invalid();
    if (s.phase === 'finished' && s.completion === 'complete' && r.index !== r.total) invalid();
  }
  if (s.reveal !== null) {
    const v = s.reveal, r = s.round;
    if (!r || !['reveal','finished'].includes(s.phase) || !keys(v,['correctAnswer','explanation','valid','reason','results','groupAccuracy'])
      || typeof v.valid !== 'boolean' || !text(v.explanation,240,{empty:true,multiline:true}) || !accuracy(v.groupAccuracy)
      || !Array.isArray(v.results) || v.results.length !== r.eligibleCount
      || !v.results.every(result => keys(result,['playerId','nickname','value','points']) && liveUUID(result.playerId) && nickname(result.nickname)
        && (result.value === null || integer(result.value,0,r.answers.length-1)) && [0,1000].includes(result.points))
      || !unique(v.results.map(result => result.playerId))) invalid();
    if (v.valid) {
      if (!integer(v.correctAnswer,0,r.answers.length-1) || !['answered','timeout','host_revealed'].includes(v.reason) || v.groupAccuracy === null
        || !v.results.every(result => result.points === (result.value === v.correctAnswer ? 1000 : 0))) invalid();
    } else if (s.phase !== 'finished' || s.completion !== 'incomplete' || v.correctAnswer !== null || v.explanation !== '' || !['host_ended','player_left','player_removed'].includes(v.reason) || v.groupAccuracy !== null
      || v.results.some(result => result.value !== null || result.points !== 0) || r.ownAnswer !== null) invalid();
  }
  return s;
}
