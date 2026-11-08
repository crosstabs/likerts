import { normalizeQuiz } from './quiz-document.mjs';
import { validateQuizState } from './quiz-live-state.mjs';
export const CATALOG_HASH = '28f342b2cfe60f611573de432173b20e0f71d4699a0d2fd9de910b011dc15aea';
const RESUME_KEY = 'likerts.live.resume.v1';
const ADMISSION_KEY = 'likerts.live.admission.v1';
const DEFAULT_SETTINGS = Object.freeze({topic:'mix',cycles:1,capacity:12,answerSeconds:60,predictSeconds:60});
const phases = new Set(['lobby','answer','predict','reveal','finished']);
const roundActions = new Set(['answer','guess','next','pause','resume','skip','quiz-answer','quiz-reveal']);
const topics = new Set(['snacks','kitchen','pets','outdoors','travel','home','hobbies','music','movies','books','social','games','style','celebrations','weather','mornings','making','tinyadventures','fantasy','future']);
const uuid = value => typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value,keys) => value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const integer = (value,min,max=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value)&&value>=min&&value<=max;
const text = (value,max) => typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value);
const nickname = value => text(value,40)&&[...value].length<=20&&/^[\p{L}\p{N}\p{M} _'’-]+$/u.test(value);
const choice = value => value===null||integer(value,1,5);
const accuracy = value => value===null||(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100);
function validSettings(value) {
  return record(value,['topic','cycles','capacity','answerSeconds','predictSeconds'])
    &&(value.topic==='mix'||topics.has(value.topic))&&integer(value.cycles,1,3)&&integer(value.capacity,2,50)
    &&[0,30,60,120].includes(value.answerSeconds)&&[0,30,60,120].includes(value.predictSeconds);
}
export class LiveError extends Error {
  constructor(code, message, status = 0) { super(message); this.name = 'LiveError'; this.code = code; this.status = status; }
}
export function normalizeCode(value) {
  const text = String(value ?? '').trim();
  if (/^LK[123][.:]/i.test(text) || text.length > 16) {
    throw new LiveError('offline_code', 'That is an offline challenge. Use Enter a challenge in the iPhone app.');
  }
  const code = text.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new LiveError('invalid_code', 'Enter the six-character live room code.');
  return code;
}
function randomSecret(crypto) {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function validCredential(c, now) {
  return record(c,['version','code','token','memberId','expiresAt']) && c.version === 1 && typeof c.code==='string' && /^[A-HJ-NP-Z2-9]{6}$/.test(c.code)
    && typeof c.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(c.token)
    && (c.memberId==='host'||uuid(c.memberId)) && integer(c.expiresAt,1) && c.expiresAt > now;
}
function validQuizPayload(value) {
  if (!record(value,['mode','modeVersion','quiz','settings']) || Object.keys(value).length !== 4 || value.mode !== 'quiz' || value.modeVersion !== 1
    || !record(value.settings,['capacity']) || Object.keys(value.settings).length !== 1 || !integer(value.settings.capacity,2,50)) return false;
  try { return JSON.stringify(normalizeQuiz(value.quiz)) === JSON.stringify(value.quiz); } catch { return false; }
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function validPending(p,now) {
  if(!record(p,['version','admissionId','recoverySecret','kind','payload','code','expiresAt'])||p.version!==1
    ||!uuid(p.admissionId)||typeof p.recoverySecret!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.recoverySecret)
    ||!integer(p.expiresAt,1)||p.expiresAt<=now)return false;
  if(p.kind==='create')return p.code===null&&(p.payload?.mode==='quiz'?validQuizPayload(p.payload)
    :record(p.payload,['settings'])&&record(p.payload.settings,['topic','cycles','capacity','answerSeconds','predictSeconds'])
    &&validSettings({...DEFAULT_SETTINGS,...p.payload.settings}));
  return p.kind==='join'&&record(p.payload,['code','nickname','acceptRoomSharing'])&&p.code===p.payload.code
    &&typeof p.code==='string'&&/^[A-HJ-NP-Z2-9]{6}$/.test(p.code)&&typeof p.payload.nickname==='string'
    &&nickname(p.payload.nickname.normalize('NFKC').trim())&&p.payload.acceptRoomSharing===true;
}
function read(storage,key) {
  try { const raw = storage?.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(storage,key,value) {
  try { if (value === null) storage?.removeItem(key); else storage?.setItem(key,JSON.stringify(value)); return !!storage; } catch { return false; }
}
export function validateState(s, credential) {
  const reject=()=>{throw new LiveError('invalid_state','This room sent an invalid update. Your last confirmed choices have not been changed.');};
  if (s?.protocolVersion === 2) return validateQuizState(s,credential,reject);
  if (!record(s,['protocolVersion','code','matchId','revision','serverTime','expiresAt','catalogVersion','catalogHash','role','self','phase','joinLocked','settings','hostConnected','players','round','reveal','leaderboard','completion','notice'])
    ||!credential||s.protocolVersion!==1||!phases.has(s.phase)||s.code!==credential.code
    ||!record(s.self,['id','nickname'])||s.self.id!==credential.memberId||!nickname(s.self.nickname)||!['host','player'].includes(s.role)
    ||!integer(s.revision,0)||!integer(s.serverTime,0)||!integer(s.expiresAt,s.serverTime+1)||!uuid(s.matchId)
    ||s.catalogVersion!==1||s.catalogHash!==CATALOG_HASH||!validSettings(s.settings)
    ||typeof s.joinLocked!=='boolean'||typeof s.hostConnected!=='boolean'
    ||!(s.notice===null||text(s.notice,1000))||!Array.isArray(s.players)||s.players.length>s.settings.capacity
    ||!Array.isArray(s.leaderboard)||s.leaderboard.length>s.settings.capacity) {
    throw new LiveError('invalid_state','This room needs a fresh connection. Your choices have not been changed.');
  }
  if(!s.players.every(p=>record(p,['id','nickname','avatar','connected'])&&uuid(p.id)&&nickname(p.nickname)&&integer(p.avatar,1,5)&&typeof p.connected==='boolean')
    ||new Set(s.players.map(p=>p.id)).size!==s.players.length
    ||(s.role==='host'?s.self.id!=='host':!s.players.some(p=>p.id===s.self.id))
    ||!s.leaderboard.every(r=>record(r,['playerId','nickname','points','opportunities','accuracy','rank'])&&uuid(r.playerId)&&nickname(r.nickname)
      &&integer(r.points,0,15000)&&integer(r.opportunities,0,150)&&accuracy(r.accuracy)&&(r.rank===null||integer(r.rank,1,50)))
    ||new Set(s.leaderboard.map(r=>r.playerId)).size!==s.leaderboard.length)reject();
  if(s.phase==='lobby'&&(s.round!==null||s.reveal!==null||s.completion!==null))reject();
  if(['answer','predict','reveal'].includes(s.phase)&&(s.round===null||s.completion!==null))reject();
  if(s.phase==='finished'?!['complete','incomplete'].includes(s.completion):s.completion!==null)reject();
  if(s.phase==='reveal'&&s.reveal===null)reject();
  if(s.round!==null){
    const r=s.round;
    if(!record(r,['id','index','total','subjectId','subjectName','prompt','deadline','paused','answerLocked','submittedCount','eligibleCount','ownAnswer','ownGuess'])
      ||!uuid(r.id)||!integer(r.total,1,150)||!integer(r.index,1,r.total)||!uuid(r.subjectId)||!nickname(r.subjectName)
      ||!record(r.prompt,['id','text','topic','sceneSummary'])||!integer(r.prompt.id,1001,2000)||!topics.has(r.prompt.topic)
      ||!text(r.prompt.text,240)||!text(r.prompt.sceneSummary,500)||!(r.deadline===null||integer(r.deadline,0))
      ||typeof r.paused!=='boolean'||typeof r.answerLocked!=='boolean'||!integer(r.eligibleCount,0,49)
      ||!integer(r.submittedCount,0,r.eligibleCount)||!choice(r.ownAnswer)||!choice(r.ownGuess))reject();
    const subject=s.self.id===r.subjectId;
    if((s.role==='host'&&(r.ownAnswer!==null||r.ownGuess!==null))||(s.role==='player'&&(subject?r.ownGuess!==null:r.ownAnswer!==null))
      ||(s.phase==='answer'&&!subject&&r.ownGuess!==null))reject();
  }
  if(['answer','predict'].includes(s.phase)&&s.reveal!==null)reject();
  if(s.reveal!==null){
    const v=s.reveal;
    if(!['reveal','finished'].includes(s.phase)||!record(v,['answer','valid','reason','guesses','groupAccuracy'])||typeof v.valid!=='boolean'
      ||!choice(v.answer)||(v.valid?v.answer===null:v.answer!==null)||!text(v.reason,80)||!accuracy(v.groupAccuracy)
      ||!Array.isArray(v.guesses)||v.guesses.length>49||!v.guesses.every(g=>record(g,['playerId','nickname','value','points'])
        &&uuid(g.playerId)&&nickname(g.nickname)&&choice(g.value)&&integer(g.points,0,100))
      ||new Set(v.guesses.map(g=>g.playerId)).size!==v.guesses.length)reject();
    if(!v.valid&&(v.groupAccuracy!==null||v.guesses.some(g=>g.value!==null||g.points!==0)
      ||(s.round&&(s.round.ownAnswer!==null||s.round.ownGuess!==null))))reject();
  }
  return s;
}

export class LiveClient {
  constructor({origin,fetch: fetcher = globalThis.fetch,WebSocket: Socket = globalThis.WebSocket,
    storage = null,crypto = globalThis.crypto,onState = () => {},onStatus = () => {},onError = () => {},
    timeoutMs = 10000,reconnectBaseMs = 750,pollMs = 3000} = {}) {
    this.origin = new URL(origin ?? globalThis.location?.origin ?? 'http://127.0.0.1:4781').origin;
    this.fetcher = (...args) => fetcher(...args); this.Socket = Socket; this.storage = storage; this.crypto = crypto;
    this.onState = onState; this.onStatus = onStatus; this.onError = onError;
    this.timeoutMs = timeoutMs; this.reconnectBaseMs = reconnectBaseMs; this.pollMs = pollMs;
    this.state = null; this.credential = null; this.pendingAction = null;
    this.socket = null; this.reconnectTimer = null; this.pollTimer = null; this.watchdogTimer = null;
    this.controllers = new Set(); this.disposed = false; this.generation = 0; this.retryCount = 0;
    this.actionOperation = null;
    this.status = 'idle'; this.busy = false; this.persisted = true;
  }
  get resumeHint() {
    const c = read(this.storage,RESUME_KEY);
    if (!validCredential(c,Date.now())) { write(this.storage,RESUME_KEY,null); return null; }
    return {code:c.code,expiresAt:c.expiresAt};
  }
  get pendingAdmissionHint() {
    const p = this.pendingAdmission ?? read(this.storage,ADMISSION_KEY);
    if (!validPending(p,Date.now())) { this.clearPendingAdmission(); return null; }
    return {kind:p.kind,code:p.code ?? null,expiresAt:p.expiresAt};
  }
  setStatus(status) { if (this.status !== status) { this.status = status; this.onStatus(status); } }
  async request(path,{method='GET',body,credential=this.credential,authenticated=true,controller:providedController} = {}) {
    const controller = providedController ?? new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(),this.timeoutMs);
    try {
      const headers = {Accept:'application/json'};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (authenticated && credential) headers.Authorization = 'Bearer ' + credential.token;
      const response = await this.fetcher(this.origin+'/api/live'+path,{
        method,headers,body:body === undefined ? undefined : JSON.stringify(body),
        signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new LiveError(data?.error?.code ?? 'request_failed',
        typeof data?.error?.message === 'string' ? data.error.message : 'The room could not complete that request.',response.status);
      if (!data || typeof data !== 'object') throw new LiveError('invalid_response','The room could not confirm that request.');
      return data;
    } catch (error) {
      if (error instanceof LiveError) throw error;
      throw new LiveError('connection_lost','Connection interrupted. Reconnect to confirm your room or choice.');
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
  async catalogue() {
    const c=await this.request('/catalogue',{authenticated:false});
    if(!record(c,['version','sha256','locale','topics','limits'])||c.version!==1||c.sha256!==CATALOG_HASH||c.locale!=='en'
      ||!Array.isArray(c.topics)||c.topics.length!==topics.size||!c.topics.every(t=>record(t,['id','title'])&&topics.has(t.id)&&text(t.title,80))
      ||new Set(c.topics.map(t=>t.id)).size!==topics.size||!record(c.limits,['maxPlayers','defaultCapacity'])
      ||!integer(c.limits.maxPlayers,2,50)||!integer(c.limits.defaultCapacity,2,c.limits.maxPlayers))
      throw new LiveError('invalid_catalogue','The reviewed topics could not be loaded. Reconnect and retry.');
    return c;
  }
  newAdmission(kind,payload) {
    this.assertCurrent(this.generation);
    if (this.pendingAdmissionHint) throw new LiveError('admission_pending','Recover your previous room request before starting another.');
    if(this.credential||this.state||this.resumeHint)throw new LiveError('room_saved','Resume your saved room before starting another. You can leave or close it there, or explicitly forget access on this tab.');
    const quizCreate=kind==='create'&&payload.mode==='quiz';
    const requested=quizCreate?freeze({mode:'quiz',modeVersion:1,quiz:normalizeQuiz(payload.quiz),settings:{capacity:payload.settings?.capacity??12}})
      :kind==='create'?{settings:{...DEFAULT_SETTINGS,...payload.settings}}:{...payload};
    if(kind==='create'&&!(quizCreate?validQuizPayload(requested):validSettings(requested.settings)))throw new LiveError('invalid_settings','Choose valid room settings before creating a room.');
    const pending = {version:1,admissionId:this.crypto.randomUUID(),recoverySecret:randomSecret(this.crypto),
      kind,payload:requested,code:requested.code ?? null,expiresAt:Date.now()+10*60*1000};
    this.pendingAdmission = pending;
    this.persisted = write(this.storage,ADMISSION_KEY,pending);
    if(quizCreate&&!this.persisted){this.pendingAdmission=null;throw new LiveError('storage_unavailable','Your browser could not save this quiz hosting request. Enable session storage before hosting so a lost reply can be recovered.');}
    return pending;
  }
  async create(settings) { return this.sendAdmission(this.newAdmission('create',{settings})); }
  async createQuiz(quiz,settings={capacity:12}) {
    if(!record(settings,['capacity'])||Object.keys(settings).length!==1||!integer(settings.capacity,2,50))throw new LiveError('invalid_settings','Choose a valid quiz room capacity.');
    return this.sendAdmission(this.newAdmission('create',{mode:'quiz',quiz,settings}));
  }
  async join(code,nickname,acceptRoomSharing) {
    const clean = normalizeCode(code);
    if (acceptRoomSharing !== true) throw new LiveError('sharing_consent','Confirm that you want to share revealed rounds with this room.');
    return this.sendAdmission(this.newAdmission('join',{code:clean,nickname,acceptRoomSharing:true}));
  }
  assertCurrent(generation) {
    if (this.disposed || generation !== this.generation) throw new LiveError('cancelled','That room request was cancelled.');
  }
  beginAdmissionOperation() {
    this.assertCurrent(this.generation);
    if (this.admissionOperation) throw new LiveError('request_pending','Wait for the current room request to finish.');
    const context = {id:Symbol('admission'),generation:this.generation};
    this.admissionOperation=context;this.busy=true;this.setStatus('connecting');return context;
  }
  endAdmissionOperation(context) {
    if (this.admissionOperation===context) {this.admissionOperation=null;this.busy=false;}
  }
  async sendAdmission(pending,continuation=null) {
    const context=continuation??this.beginAdmissionOperation();
    this.assertCurrent(context.generation);
    if (pending.expiresAt<=Date.now()) {
      this.clearPendingAdmission();if(!continuation)this.endAdmissionOperation(context);
      throw new LiveError('admission_expired','That room request has expired. Start again.');
    }
    const {code,...payload}=pending.payload;
    const body={...payload,admissionId:pending.admissionId,recoverySecret:pending.recoverySecret};
    try {
      const admission=await this.request(pending.kind==='create'?'/rooms':'/rooms/'+code+'/join',
        {method:'POST',body,authenticated:false});
      this.assertCurrent(context.generation);
      return this.acceptAdmission(admission,context.generation,pending);
    } catch(error) {
      this.assertCurrent(context.generation);
      if(error.status>=400&&error.status<500&&![408,429].includes(error.status)&&error.code!=='admission_conflict')this.clearPendingAdmission();
      this.setStatus('offline');throw error;
    } finally {if(!continuation)this.endAdmissionOperation(context);}
  }
  async recoverAdmission() {
    const pending=this.pendingAdmission??read(this.storage,ADMISSION_KEY);
    if(!validPending(pending,Date.now())){this.clearPendingAdmission();throw new LiveError('admission_expired','That room request has expired or could not be read. Start again.');}
    const context=this.beginAdmissionOperation();
    try {
      const admission=await this.request('/admissions/recover',{method:'POST',authenticated:false,
        body:{admissionId:pending.admissionId,recoverySecret:pending.recoverySecret}});
      this.assertCurrent(context.generation);
      return this.acceptAdmission(admission,context.generation,pending);
    } catch(error) {
      this.assertCurrent(context.generation);
      if([401,404].includes(error.status)&&pending.payload)return await this.sendAdmission(pending,context);
      if(error.status===401||error.status===410)this.clearPendingAdmission();
      this.setStatus('offline');throw error;
    } finally {this.endAdmissionOperation(context);}
  }
  clearPendingAdmission(){this.pendingAdmission=null;return write(this.storage,ADMISSION_KEY,null);}
  acceptAdmission(a,generation,pending) {
    this.assertCurrent(generation);
    const credential={version:1,code:a.code,token:a.token,memberId:a.memberId,expiresAt:a.state?.expiresAt};
    if(!validCredential(credential,Date.now()))throw new LiveError('invalid_admission','The room could not confirm your place. Recover the request to try again.');
    if(pending.kind==='create'?a.state?.role!=='host'||a.memberId!=='host':a.state?.role!=='player'||a.memberId==='host')
      throw new LiveError('invalid_admission','The room could not confirm the place you requested.');
    validateState(a.state,credential);
    const quizCreate=pending.kind==='create'&&pending.payload.mode==='quiz';
    const expectedSettings=quizCreate?pending.payload.settings:{...DEFAULT_SETTINGS,...pending.payload.settings};
    const mismatch=pending.kind==='create'
      ?a.memberId!=='host'||a.state.role!=='host'||Object.entries(expectedSettings).some(([key,value])=>a.state.settings?.[key]!==value)
        ||(quizCreate?(a.state.protocolVersion!==2||a.state.quiz.id!==pending.payload.quiz.id||a.state.quiz.title!==pending.payload.quiz.title||a.state.quiz.questionCount!==pending.payload.quiz.questions.length):a.state.protocolVersion!==1)
      :a.memberId==='host'||a.state.role!=='player'||a.code!==pending.payload.code||a.state.self.nickname!==pending.payload.nickname.normalize('NFKC').trim();
    if(mismatch)throw new LiveError('invalid_admission','The room could not confirm the place you requested.');
    this.stopTransport();this.generation++;this.credential=credential;
    this.persisted=write(this.storage,RESUME_KEY,credential);
    this.clearPendingAdmission();this.acceptState(a.state);this.connect();return this.state;
  }
  acceptState(s) {
    validateState(s,this.credential);
    if(this.state&&this.state.code===s.code&&this.state.protocolVersion!==s.protocolVersion)throw new LiveError('invalid_state','This room changed its game mode unexpectedly. Reconnect to confirm your place.');
    if(this.state&&this.state.code===s.code&&s.protocolVersion===2
      &&['id','title','questionCount'].some(key=>this.state.quiz[key]!==s.quiz[key]))throw new LiveError('invalid_state','This room changed its quiz unexpectedly. Reconnect to confirm your place.');
    if (this.state && this.state.code === s.code && this.state.revision > s.revision) return;
    if(this.state&&this.state.code===s.code&&this.state.revision===s.revision&&this.state.serverTime>s.serverTime)return;
    const pending=this.pendingAction;
    // Appearance may already match before this command, and a new match cannot
    // acknowledge an earlier choice. Only its exact HTTP reply/replay settles it.
    const settled=pending&&pending.action!=='choose-avatar'&&(pending.matchId!==s.matchId||(pending.roundId&&pending.roundId!==s.round?.id)
      ||(pending.action==='answer'&&s.round?.ownAnswer===pending.value)
      ||(pending.action==='quiz-answer'&&s.round?.ownAnswer===pending.value)
      ||(s.protocolVersion===2&&((pending.action==='quiz-reveal'&&s.phase!=='answer')||(pending.action==='next'&&s.phase==='finished')))
      ||(pending.action==='guess'&&s.round?.ownGuess===pending.value));
    if(settled)this.pendingAction=null;
    this.state = s; this.credential.expiresAt = s.expiresAt;
    this.persisted = write(this.storage,RESUME_KEY,this.credential);
    const operation=this.actionOperation;
    if(settled&&operation?.body===pending&&operation.generation===this.generation){
      this.busy=false;operation.confirm({state:s});operation.controller.abort();
    }
    this.onState(s);
  }
  async resume() {
    this.assertCurrent(this.generation);
    if(this.admissionOperation)throw new LiveError('request_pending','Confirm your room request first.');
    const saved=read(this.storage,RESUME_KEY);
    if(!validCredential(saved,Date.now())){write(this.storage,RESUME_KEY,null);throw new LiveError('resume_expired','This room is no longer saved on this tab.');}
    const c={version:1,code:saved.code,token:saved.token,memberId:saved.memberId,expiresAt:saved.expiresAt};
    this.stopTransport();const generation=++this.generation;this.credential=c;this.setStatus('connecting');
    try {
      const data=await this.request('/rooms/'+c.code,{credential:c});
      this.assertCurrent(generation);this.acceptState(data.state);this.connect();return this.state;
    } catch(error) {
      this.assertCurrent(generation);
      if([401,403,404,410].includes(error.status))this.clearLocal();
      this.setStatus('offline');throw error;
    }
  }
  async refresh() {
    if (!this.credential || this.disposed || this.refreshing) return;
    this.refreshing = true;
    const generation = this.generation, credential = this.credential;
    try {
      const data = await this.request('/rooms/'+credential.code,{credential});
      if (generation !== this.generation || this.disposed || this.actionOperation?.terminalReceipt) return;
      this.acceptState(data.state);
      if (!this.socket || this.socket.readyState !== 1) this.setStatus('syncing');
    } catch (error) {
      if (generation !== this.generation || this.disposed || this.actionOperation?.terminalReceipt) return;
      if ([401,403,404,410].includes(error.status)) { this.clearLocal(); this.onError(error); }
      else {this.setStatus('offline');if(error.code==='invalid_state')this.onError(error);}
    } finally { this.refreshing = false; }
  }
  async action(action,values = {},options = {}) {
    if (!this.state || !this.credential) throw new LiveError('not_joined','Join a room first.');
    if (this.pendingAction) throw new LiveError('choice_pending','Confirm the previous request before making another choice.');
    const body = {requestId:this.crypto.randomUUID(),matchId:this.state.matchId,action,...values};
    if (roundActions.has(action)) body.roundId = this.state.round?.id;
    this.pendingAction = body; return this.retryAction(options);
  }
  async retryAction({terminalReceipt = false} = {}) {
    this.assertCurrent(this.generation);
    if(!this.pendingAction||!this.credential)throw new LiveError('no_pending_request','There is no request to retry.');
    if(this.busy)throw new LiveError('request_pending','Wait for the current request to be confirmed.');
    const body=this.pendingAction,credential=this.credential,generation=this.generation;
    let confirm;const confirmed=new Promise(resolve=>{confirm=resolve;});
    // This local option is never sent to the server. Ordinary actions keep their
    // existing return contract; only an exact close reply can issue a receipt.
    const wantsReceipt=terminalReceipt===true&&body.action==='close';
    const operation={body,generation,controller:new AbortController(),confirm,terminalReceipt:wantsReceipt};
    this.actionOperation=operation;this.busy=true;
    if(wantsReceipt)this.stopTransport();
    try {
      const result=await Promise.race([this.request('/rooms/'+credential.code+'/actions',{method:'POST',body,credential,controller:operation.controller}),confirmed]);
      this.assertCurrent(generation);
      if(wantsReceipt){
        if(!record(result,['state','closed'])||result.closed!==true||result.state!==null)
          throw new LiveError('invalid_response','The room did not confirm closing. Retry the request to check its outcome.');
        const accessCleared=this.clearLocal();
        return Object.freeze({action:'close',code:credential.code,matchId:body.matchId,requestId:body.requestId,closed:true,accessCleared});
      }
      if(result.closed||result.left){this.pendingAction=null;this.clearLocal();return null;}
      this.acceptState(result.state);if(this.pendingAction===body)this.pendingAction=null;return this.state;
    } catch(error) {
      this.assertCurrent(generation);
      // A newer recipient projection can settle this action before a lost HTTP reply.
      // Never replay work from an earlier round into the current one.
      if(!wantsReceipt&&this.pendingAction!==body&&this.state&&![401,403,404,410].includes(error.status))return this.state;
      if((body.action==='close'&&[404,410].includes(error.status))||(body.action==='leave'&&[401,403,404,410].includes(error.status))){
        this.clearLocal();return null;
      }
      if(error.status>=400&&error.status<500&&![408,429].includes(error.status)&&this.pendingAction===body)this.pendingAction=null;
      if([401,403,404,410].includes(error.status))this.clearLocal();
      throw error;
    } finally {if(generation===this.generation&&this.actionOperation===operation){this.busy=false;this.actionOperation=null;if(wantsReceipt&&this.credential&&!this.disposed)this.connect();}}
  }
  connect() {
    if (!this.credential || this.disposed) return;
    this.stopTransport(); const generation = this.generation; const credential = this.credential;
    this.setStatus('connecting');
    this.pollTimer = setInterval(() => { if (!this.socket || this.socket.readyState !== 1) void this.refresh(); },this.pollMs);
    this.watchdogTimer = setInterval(() => {
      if (this.socket?.readyState === 1) void this.refresh();
    },30000);
    if (!this.Socket) { void this.refresh(); return; }
    const url = new URL('/api/live/socket',this.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    try { socket = new this.Socket(url.href); } catch { this.scheduleReconnect(generation); return; }
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.generation || this.disposed) { socket.close(); return; }
      socket.send(JSON.stringify({type:'authenticate',code:credential.code,token:credential.token}));
    };
    socket.onmessage = event => {
      if (generation !== this.generation || this.disposed || this.actionOperation?.terminalReceipt) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'state') { this.acceptState(message.state); this.retryCount = 0; this.setStatus('connected'); }
        else if (message.type === 'error') {
          this.setStatus('reconnecting'); void this.refresh();
        }
      } catch (error) { this.setStatus('offline'); this.onError(error instanceof LiveError ? error : new LiveError('invalid_state','The room sent an unexpected update.')); socket.close(); }
    };
    socket.onerror = () => { if (generation === this.generation && !this.disposed) this.setStatus('reconnecting'); };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (generation === this.generation && !this.disposed && this.credential) {
        this.setStatus('reconnecting'); void this.refresh(); this.scheduleReconnect(generation);
      }
    };
  }
  scheduleReconnect(generation) {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(15000,this.reconnectBaseMs*2**Math.min(this.retryCount++,5))*(0.8+Math.random()*0.4);
    this.reconnectTimer = setTimeout(() => { if (generation === this.generation && !this.disposed && this.credential) this.connect(); },delay);
  }
  stopTransport() {
    clearTimeout(this.reconnectTimer); clearInterval(this.pollTimer); clearInterval(this.watchdogTimer);
    this.reconnectTimer = this.pollTimer = this.watchdogTimer = null;
    if (this.socket) { const s = this.socket; this.socket = null; s.onclose = null; s.onmessage = null; s.close(); }
  }
  forgetSavedAccess() {
    if(this.state||this.credential||this.busy||this.pendingAction)throw new LiveError('room_active','Leave or close the current room before forgetting saved access.');
    const removedResume=write(this.storage,RESUME_KEY,null),removedAdmission=write(this.storage,ADMISSION_KEY,null);
    if(!removedResume||!removedAdmission)throw new LiveError('storage_unavailable','Your browser could not remove saved access. Try again or use its site-data controls. No remote seat was changed.');
    this.clearLocal();
  }
  clearLocal() {
    this.generation++; this.admissionOperation=null;this.actionOperation?.controller.abort();this.actionOperation=null;this.busy=false; this.stopTransport(); this.credential = null; this.state = null; this.pendingAction = null;
    const removedAdmission=this.clearPendingAdmission(),removedResume=write(this.storage,RESUME_KEY,null); this.setStatus('idle'); this.onState(null);
    return removedAdmission&&removedResume;
  }
  dispose() { this.disposed = true; this.admissionOperation=null;this.actionOperation=null;this.busy=false;this.generation++; this.stopTransport(); for (const c of this.controllers) c.abort(); this.controllers.clear(); }
}
