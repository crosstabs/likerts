import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createQuizRoom, joinRoom, reduceRoom, project, advance } from '../server/engine.mjs';
import { LiveClient, LiveError, validateState } from '../web/client.mjs';
import { sampleQuizDocument } from '../web/quiz-document.mjs';
import { QuizLibrary } from '../web/quiz-library.mjs';
import { mountQuizApp } from '../web/quiz-ui.mjs';
import { mountLiveApp } from '../web/ui.mjs';
import { createStorage } from './web-quiz-test-support.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const clone = value => structuredClone(value);
const RESUME = 'likerts.live.resume.v1', ADMISSION = 'likerts.live.admission.v1';
const credential = (state, token = 'a'.repeat(43)) => ({ version:1, code:state.code, token, memberId:state.self.id, expiresAt:state.expiresAt });
function game(quiz = sampleQuizDocument()) {
  const now = Date.now(), created = createQuizRoom(quiz,{capacity:12},{now});
  let room = created.room; const players = [];
  for (const nickname of ['Sam','NativeQA']) { const result = joinRoom(room,{nickname,acceptRoomSharing:true},{now}); room = result.room; players.push(result.memberId); }
  const get = (actor = 'host') => project(room,actor,{now});
  const act = (actor,action,values = {}) => {
    room = reduceRoom(room,actor,{requestId:randomUUID(),matchId:room.matchId,...(room.round ? {roundId:room.round.id} : {}),action,...values},{now}).room;
    return get(actor);
  };
  return {get,act,players,get room(){return room;},now};
}
function completeGame(g, answerFor = () => null) {
  g.act('host','start');
  while (g.room.phase !== 'finished') {
    if (g.room.phase === 'answer') {
      for (const player of g.players) {
        const value = answerFor(g,player);
        if (value !== null) g.act(player,'quiz-answer',{value});
      }
      if (g.room.phase === 'answer') g.act('host','quiz-reveal');
    } else g.act('host','next');
  }
  return g;
}
class TestClient extends LiveClient { connect(){ this.setStatus('connected'); } }
const response = value => ({ok:true,status:200,json:async()=>value});
const heldReply = (_url,{signal}) => new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new TypeError('held reply aborted')),{once:true}));
function deferred() { let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
function clientFor(t, state, options = {}) {
  const client = new TestClient({origin:'https://quiz-test.invalid',WebSocket:null,storage:createStorage(),...options});
  if (state) { client.credential = credential(state); client.acceptState(state); }
  t.after(()=>client.dispose()); return client;
}
function uiClient(state, overrides = {}) {
  return {state:clone(state),status:state?'connected':'idle',persisted:true,pendingAction:null,resumeHint:null,pendingAdmissionHint:null,busy:false,
    calls:[],onState(){},onStatus(){},onError(){}, catalogue:async()=>({topics:[]}),dispose(){},
    action(action,values){this.calls.push({action,values});return Promise.resolve(this.state);},
    refresh:async()=>{},retryAction:async()=>{},emit(next){this.state=clone(next);this.onState(this.state);},...overrides};
}
async function liveUI(t,state,overrides = {}) {
  const dom = new JSDOM('<div id="app"></div>',{url:'https://quiz-test.invalid/play'});dom.window.scrollTo=()=>{};
  const client=uiClient(state,overrides),root=dom.window.document.getElementById('app'),app=mountLiveApp({root,client,window:dom.window});
  await flush(); t.after(()=>{app.dispose();dom.window.close();});
  return {dom,client,root,app,get:id=>root.querySelector('#'+id),click(id){const node=root.querySelector('#'+id);assert.ok(node,id);node.click();}};
}
async function libraryUI(t, options = {}) {
  const storage = createStorage(), library = new QuizLibrary({storage,locks:storage.locks}); await library.save(sampleQuizDocument());
  const dom = new JSDOM('<div id="app"></div>',{url:'https://quiz-test.invalid/play/quizzes'}),root=dom.window.document.getElementById('app');
  const calls=[],app=mountQuizApp({root,library,window:dom.window,hostQuiz:async quiz=>{calls.push(quiz);},...options});
  t.after(()=>{app.dispose();dom.window.close();});
  return {root,library,calls,app,dom,click(selector){const node=root.querySelector(selector);assert.ok(node,selector);node.click();}};
}

test('v2 browser validator accepts actual engine lobby, question, reveal, incomplete and complete projections for both roles',()=>{
  const g=game();
  const check=()=>{for(const actor of ['host',...g.players]){const s=g.get(actor);assert.equal(validateState(s,credential(s)),s);}};
  check();g.act('host','start');check();g.act(g.players[0],'quiz-answer',{value:0});check();g.act(g.players[1],'quiz-answer',{value:1});check();
  for(let index=1;index<3;index++){g.act('host','next');g.act('host','quiz-reveal');check();}
  g.act('host','next');check();
  const incomplete=game();incomplete.act('host','start');incomplete.act(incomplete.players[0],'quiz-answer',{value:0});incomplete.act('host','end');
  for(const actor of ['host',...incomplete.players]){const s=incomplete.get(actor);validateState(s,credential(s));assert.equal(s.round.ownAnswer,null);}
});

test('authored UUIDs, Unicode scalars and multiline quiz text keep M1 semantics while generated live identities stay strict',()=>{
  const q=sampleQuizDocument();q.id='00000000-0000-0000-0000-000000000000';q.questions[0].id='00000000-0000-0000-0000-000000000001';
  q.title='🪐'.repeat(80);q.questions[0].prompt='🪐'.repeat(120)+'\n'+ 'x'.repeat(119);q.questions[0].answers[0]='🪐'.repeat(100);
  const g=game(q);g.act('host','start');const s=g.get();validateState(s,credential(s));
  const bad=clone(s);bad.matchId=q.id;assert.throws(()=>validateState(bad,credential(bad)),{code:'invalid_state'});
});

test('unknown v2 fields and private or future question data are rejected before rendering',()=>{
  const g=game();g.act('host','start');const state=g.get(g.players[0]);
  for(const mutate of [s=>s.quiz.correctAnswer=1,s=>s.quiz.questions=[],s=>s.round.correctAnswer=1,s=>s.round.explanation='secret',s=>s.round.submissions={},
    s=>s.players[0].token='secret',s=>s.self.answer=1,s=>s.settings.answerSeconds=20,s=>s.leaderboard[0].answer=1,s=>s.catalogHash='legacy',s=>s.modeVersion=2,
    s=>s.round.answers.push('extra'),s=>s.round.answers[0]=s.round.answers[1],s=>s.round.prompt='bad\rprompt',s=>s.round.ownAnswer=4]){
    const bad=clone(state);mutate(bad);assert.throws(()=>validateState(bad,credential(bad)),{code:'invalid_state'});
  }
  const host=g.get();host.round.ownAnswer=0;assert.throws(()=>validateState(host,credential(host)),{code:'invalid_state'});
});

test('v2 validator rejects incorrect scoring and invalid-reveal disclosure',()=>{
  const g=game();g.act('host','start');g.act('host','quiz-reveal');const valid=g.get();
  const wrong=clone(valid);wrong.reveal.results[0].points=1000;assert.throws(()=>validateState(wrong,credential(wrong)),{code:'invalid_state'});
  g.act('host','next');g.act(g.players[0],'quiz-answer',{value:0});g.act('host','end');const ended=g.get(g.players[0]);
  for(const mutate of [s=>s.round.ownAnswer=0,s=>s.reveal.results[0].value=0,s=>s.reveal.correctAnswer=0,s=>s.reveal.explanation='secret']){
    const bad=clone(ended);mutate(bad);assert.throws(()=>validateState(bad,credential(bad)),{code:'invalid_state'});
  }
});

test('quiz hosting refuses to send when durable pending session storage fails',async t=>{
  let calls=0;const storage=createStorage();storage.failWrite=true;
  const c=clientFor(t,null,{storage,fetch:async()=>{calls++;throw new Error('network must not run');}});
  await assert.rejects(c.createQuiz(sampleQuizDocument()),{code:'storage_unavailable'});assert.equal(calls,0);assert.equal(c.pendingAdmission,null);
});

test('quiz creation freezes a detached exact snapshot before the request and accepts matching metadata',async t=>{
  const quiz=sampleQuizDocument(),g=game(quiz),storage=createStorage();let sent;
  const c=clientFor(t,null,{storage,fetch:async(_url,options)=>{sent=JSON.parse(options.body);quiz.title='Edited after hosting';quiz.questions[0].answers[0]='Changed';
    assert.ok(Object.isFrozen(c.pendingAdmission.payload.quiz.questions[0].answers));
    const state=g.get();return response({code:state.code,memberId:'host',token:'a'.repeat(43),state});}});
  await c.createQuiz(quiz);assert.equal(sent.mode,'quiz');assert.equal(sent.modeVersion,1);assert.equal(sent.quiz.title,'Little wonders');assert.equal(sent.quiz.questions[0].answers[0],'Venus');
  assert.ok(storage.getItem(RESUME));assert.equal(storage.getItem(ADMISSION),null);assert.equal(c.state.mode,'quiz');
});

test('lost quiz admission recovers after reload from saved exact content, never the edited library',async t=>{
  const quiz=sampleQuizDocument(),g=game(quiz),storage=createStorage(),requests=[];
  const first=clientFor(t,null,{storage,fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});throw new TypeError('lost reply');}});
  await assert.rejects(first.createQuiz(quiz),{code:'connection_lost'});quiz.title='Later library edit';const saved=JSON.parse(storage.getItem(ADMISSION));
  const recovered=clientFor(t,null,{storage,fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});const state=g.get();return response({code:state.code,memberId:'host',token:'b'.repeat(43),state});}});
  await recovered.recoverAdmission();assert.equal(recovered.state.quiz.title,'Little wonders');assert.equal(requests[1].url.endsWith('/admissions/recover'),true);
  assert.equal(requests[1].body.admissionId,saved.admissionId);assert.equal(requests[1].body.recoverySecret,saved.recoverySecret);assert.equal(storage.getItem(ADMISSION),null);
});

test('admission recovery not found replays the original quiz upload exactly',async t=>{
  const storage=createStorage(),q=sampleQuizDocument(),g=game(q);let original,replayed;
  const first=clientFor(t,null,{storage,fetch:async(_url,options)=>{original=JSON.parse(options.body);throw new TypeError('lost before delivery');}});
  await assert.rejects(first.createQuiz(q),{code:'connection_lost'});q.questions.pop();
  const recovered=clientFor(t,null,{storage,fetch:async(url,options)=>{
    if(url.endsWith('/recover'))return{ok:false,status:404,json:async()=>({error:{code:'admission_unavailable',message:'Not found'}})};
    replayed=JSON.parse(options.body);const state=g.get();return response({code:state.code,memberId:'host',token:'a'.repeat(43),state});}});
  await recovered.recoverAdmission();assert.deepEqual(replayed,original);
});

test('a quiz admission with mismatched safe metadata is rejected and remains recoverable',async t=>{
  const g=game(),storage=createStorage();const bad=g.get();bad.quiz.title='Different quiz';
  const c=clientFor(t,null,{storage,fetch:async()=>response({code:bad.code,memberId:'host',token:'a'.repeat(43),state:bad})});
  await assert.rejects(c.createQuiz(sampleQuizDocument()),{code:'invalid_admission'});assert.equal(c.credential,null);assert.ok(storage.getItem(ADMISSION));
});

test('an established quiz rejects changed snapshot identity, title or question count without replacing confirmed state',t=>{
  const initial=game().get(),storage=createStorage(),c=clientFor(t,initial,{storage});
  const updated=clone(initial);updated.revision++;updated.serverTime++;
  c.acceptState(updated);assert.equal(c.state,updated,'Ordinary updates with unchanged metadata remain valid');
  const savedAccess=storage.getItem(RESUME),emitted=[];c.onState=state=>emitted.push(state);
  for(const [key,value] of [['id',randomUUID()],['title','A different quiz'],['questionCount',initial.quiz.questionCount+1]]){
    const changed=clone(updated);changed.revision++;changed.quiz[key]=value;
    assert.equal(validateState(changed,c.credential),changed,'The changed projection is individually valid');
    assert.throws(()=>c.acceptState(changed),{code:'invalid_state'},key+' must remain fixed within the room');
    assert.equal(c.state,updated,'Keep the last confirmed state after rejecting '+key);
    assert.equal(storage.getItem(RESUME),savedAccess,'Rejected metadata must not update saved access');
  }
  assert.deepEqual(emitted,[],'Rejected metadata never reaches the renderer');
});

test('zero-based quiz locks bind round and retry the same immutable UUID/value after a lost reply',async t=>{
  const g=game();g.act('host','start');const state=g.get(g.players[0]),requests=[];let fail=true;
  const c=clientFor(t,state,{fetch:async(_url,options)=>{const body=JSON.parse(options.body);requests.push(body);if(fail){fail=false;throw new TypeError('lost reply');}
    return response({state:g.act(g.players[0],'quiz-answer',{value:body.value})});}});
  await assert.rejects(c.action('quiz-answer',{value:0}),{code:'connection_lost'});await assert.rejects(c.action('quiz-answer',{value:1}),{code:'choice_pending'});
  await c.retryAction();assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].roundId,state.round.id);assert.equal(c.state.round.ownAnswer,0);assert.equal(c.pendingAction,null);
});

test('a held quiz lock reply settles from the authoritative own answer including index zero',async t=>{
  const g=game();g.act('host','start');const c=clientFor(t,g.get(g.players[0]),{fetch:heldReply});
  const pending=c.action('quiz-answer',{value:0});await flush();const next=g.act(g.players[0],'quiz-answer',{value:0});c.acceptState(next);
  assert.equal(await pending,next);assert.equal(c.pendingAction,null);assert.equal(c.busy,false);
});

test('quiz reveal action binds the round, and same-round revealed projection settles a lost reply',async t=>{
  const g=game();g.act('host','start');let sent;const c=clientFor(t,g.get(),{fetch:async(url,options)=>{sent=JSON.parse(options.body);return heldReply(url,options);}});
  const promise=c.action('quiz-reveal');await flush();c.acceptState(g.act('host','quiz-reveal'));await promise;
  assert.equal(sent.roundId,g.room.round.id);assert.equal(c.pendingAction,null);assert.equal(c.state.phase,'reveal');
});

test('reload restores the confirmed zero answer from the server without another seat or score',async t=>{
  const g=game();g.act('host','start');g.act(g.players[0],'quiz-answer',{value:0});const state=g.get(g.players[0]),storage=createStorage();storage.setItem(RESUME,JSON.stringify(credential(state)));
  const calls=[],c=clientFor(t,null,{storage,fetch:async(url,options)=>{calls.push({url,method:options.method});return response({state});}});
  await c.resume();assert.equal(c.state.round.ownAnswer,0);assert.deepEqual(calls.map(c=>c.method),['GET']);
});

test('saved and sample Host live require explicit upload confirmation and preserve a detached snapshot',async t=>{
  const f=await libraryUI(t);f.click('[data-quiz-host]');assert.equal(f.calls.length,0);assert.match(f.root.querySelector('dialog').textContent,/answer key.*uploaded.*server/i);
  f.click('#quiz-confirm-cancel');assert.equal(f.calls.length,0);f.click('[data-quiz-host]');f.click('#quiz-confirm-action');await flush();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].title,'Little wonders');assert.notEqual(f.calls[0],f.library.quizzes[0]);
  f.click('#quiz-host-sample');f.click('#quiz-confirm-action');await flush();assert.equal(f.calls.length,2);
  assert.match(f.root.querySelector('.q-neutral-guide img').getAttribute('src'),/totem-3.png$/);
});

test('failed hosting offers recovery without losing the library or creating another room',async t=>{
  let pending=false,attempts=0,recoveries=0;
  const f=await libraryUI(t,{hostQuiz:async()=>{attempts++;pending=true;throw new LiveError('connection_lost','Recover this hosting request.');},liveAccess:()=>pending?{pending:true}:null,recoverLive:async()=>{recoveries++;}});
  f.click('[data-quiz-host]');f.click('#quiz-confirm-action');await flush();assert.match(f.root.textContent,/Recover this hosting request/);assert.ok(f.root.querySelector('#quiz-recover-live'));
  f.click('[data-quiz-host]');assert.equal(f.root.querySelector('dialog'),null);assert.equal(attempts,1);f.click('#quiz-recover-live');await flush();assert.equal(recoveries,1);assert.equal(f.library.quizzes.length,1);
});

test('quiz lobby identifies content, uses the original neutral cast and only hosts see start/moderation',async t=>{
  const g=game(),host=await liveUI(t,g.get()),player=await liveUI(t,g.get(g.players[0]));
  for(const f of [host,player]){assert.equal(f.root.querySelector('h1').textContent,'Little wonders');assert.match(f.root.querySelector('.quiz-cast-hold img').getAttribute('src'),/story-cast-hold.png$/);assert.equal(f.root.querySelector('.quiz-celebration'),null);}
  assert.ok(host.get('start-game'));assert.ok(host.get('lock-room'));assert.equal(player.get('start-game'),null);assert.equal(player.get('lock-room'),null);
  host.click('start-game');await flush();assert.deepEqual(host.client.calls,[{action:'start',values:{}}]);
});

test('Quiz removal uses the same explicit remove-and-lock confirmation',async t=>{
  const g=game(),f=await liveUI(t,g.get()),target=f.client.state.players[0];
  const remove=()=>[...f.root.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')==='Remove '+target.nickname).click();
  remove();
  assert.match(f.root.querySelector('dialog').textContent,/room will lock to new players/);
  assert.equal(f.get('confirm-accept').textContent,'Remove and lock room');
  assert.deepEqual(f.client.calls,[]);f.click('confirm-cancel');assert.deepEqual(f.client.calls,[]);
  remove();f.click('confirm-accept');await flush();
  assert.deepEqual(f.client.calls,[{action:'kick',values:{playerId:target.id}}]);
});

test('Quiz lobby unlocking requires confirmation and cannot carry across a rematch',async t=>{
  const g=game();g.act('host','lock',{locked:true});
  const f=await liveUI(t,g.get());
  const requestUnlock=()=>{const control=f.get('lock-room');control.checked=false;control.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));};
  requestUnlock();assert.match(f.root.querySelector('dialog').textContent,/including someone you removed/);
  assert.equal(f.get('lock-room').checked,true);assert.deepEqual(f.client.calls,[]);
  f.click('confirm-cancel');assert.equal(f.get('lock-room').checked,true);assert.deepEqual(f.client.calls,[]);
  requestUnlock();f.click('confirm-accept');await flush();
  assert.deepEqual(f.client.calls,[{action:'lock',values:{locked:false}}]);
  assert.equal(f.get('lock-room').checked,true);
  f.client.calls.length=0;requestUnlock();
  g.act('host','start');g.act('host','end');g.act('host','rematch');f.client.emit(g.get());
  f.click('confirm-accept');await flush();
  assert.deepEqual(f.client.calls,[]);assert.equal(f.get('lock-room').checked,true);
  assert.match(f.root.querySelector('[role=alert]').textContent,/room changed/);
});

test('quiz answer selection never submits before Lock and index zero survives reconnect and confirmed lock',async t=>{
  const g=game();g.act('host','start');const f=await liveUI(t,g.get(g.players[0]));assert.equal(f.root.querySelectorAll('.quiz-live-choice').length,4);assert.equal(f.get('lock-choice').disabled,true);
  f.click('quiz-choice-0');assert.equal(f.client.calls.length,0);assert.equal(f.get('quiz-choice-0').getAttribute('aria-pressed'),'true');
  const reconnect=g.get(g.players[0]);reconnect.revision++;f.client.emit(reconnect);assert.equal(f.get('quiz-choice-0').getAttribute('aria-pressed'),'true');
  f.click('lock-choice');await flush();assert.deepEqual(f.client.calls,[{action:'quiz-answer',values:{value:0}}]);
  f.client.emit(g.act(g.players[0],'quiz-answer',{value:0}));assert.equal(f.get('lock-choice'),null);assert.match(f.root.textContent,/Answer locked: Venus/);assert.equal(f.get('quiz-choice-1').disabled,true);
  assert.equal(f.get('quiz-choice-0').getAttribute('aria-label'),'A · Venus');assert.equal(f.root.querySelector('.quiz-celebration'),null);
});

test('quiz host sees answers without a choice UI and explicit early-reveal confirmation',async t=>{
  const g=game();g.act('host','start');const f=await liveUI(t,g.get());assert.equal(f.get('lock-choice'),null);assert.equal(f.get('quiz-choice-0'),null);assert.equal(f.get('pause-round'),null);assert.equal(f.get('skip-round'),null);
  f.click('reveal-question');assert.equal(f.client.calls.length,0);assert.match(f.root.querySelector('dialog').textContent,/zero points/);f.click('confirm-accept');await flush();
  assert.deepEqual(f.client.calls,[{action:'quiz-reveal',values:{}}]);
});

test('a deferred end acknowledgement enables the real client finished controls without another state or timer',async t=>{
  const g=game();g.act('host','start');g.act('host','quiz-reveal');const state=g.get(),acknowledgement=deferred(),sent=[];
  const dom=new JSDOM('<div id="app"></div>',{url:'https://quiz-test.invalid/play'});dom.window.scrollTo=()=>{};
  const client=new LiveClient({origin:'https://quiz-test.invalid',WebSocket:null,storage:createStorage(),fetch:async(_url,options)=>{
    sent.push(JSON.parse(options.body));return acknowledgement.promise;
  }});
  client.catalogue=async()=>({topics:[]});client.credential=credential(state);client.acceptState(state);client.setStatus('connected');
  const root=dom.window.document.getElementById('app'),app=mountLiveApp({root,client,window:dom.window});
  t.after(()=>{app.dispose();dom.window.close();});await flush();
  root.querySelector('#finish-early').click();root.querySelector('#confirm-accept').click();
  assert.equal(sent.length,1);assert.equal(sent[0].action,'end');assert.equal(client.pendingAction.action,'end');
  const finished=g.act('host','end');client.acceptState(finished);
  assert.equal(client.state.phase,'finished');assert.equal(root.querySelector('#rematch').disabled,true,'Wait for the end receipt before another command');
  assert.match(root.textContent,/Confirming…/);
  acknowledgement.resolve(response({state:finished}));await flush();
  assert.equal(client.pendingAction,null);assert.equal(client.busy,false);
  assert.equal(root.querySelector('#rematch').disabled,false,'Play again must enable immediately after the acknowledgement');
  assert.equal(root.querySelector('#room-exit').disabled,false,'Close must enable immediately after the acknowledgement');
  assert.equal(root.textContent.includes('Confirming…'),false,'Do not wait for another update or countdown tick to remove the pending status');
});

test('an older invalidated operation finishing cannot clear a newer operation or suppress its error',async t=>{
  const g=game();g.act('host','start');g.act('host','quiz-reveal');const oldEnd=deferred(),newRematch=deferred();
  const f=await liveUI(t,g.get(),{action(action,values){this.calls.push({action,values});return action==='end'?oldEnd.promise:newRematch.promise;}});
  f.click('finish-early');f.click('confirm-accept');const finished=g.act('host','end');f.client.emit(finished);
  f.click('rematch');assert.equal(f.app.model.busy,true);assert.equal(f.get('room-exit').disabled,true);
  oldEnd.resolve(finished);await flush();
  assert.equal(f.app.model.busy,true,'The old operation does not own the newer busy flag');
  assert.equal(f.get('room-exit').disabled,true,'The current pending operation keeps controls disabled');
  newRematch.reject(new LiveError('connection_lost','NEW_REMATCH_REQUEST_ERROR'));await flush();
  assert.equal(f.app.model.busy,false);assert.match(f.root.textContent,/NEW_REMATCH_REQUEST_ERROR/);
  assert.deepEqual(f.client.calls.map(call=>call.action),['end','rematch']);
});

test('deadline disables quiz selection and lock while waiting for the server reveal',async t=>{
  const g=game();g.act('host','start');const state=g.get(g.players[0]);state.round.deadline=Date.now()-1000;const f=await liveUI(t,state);
  assert.equal(f.get('quiz-choice-0').disabled,true);assert.equal(f.get('lock-choice').disabled,true);assert.match(f.root.textContent,/Confirming the question/);assert.equal(f.client.calls.length,0);
});

test('correct reveal displays explanation, authoritative points and original celebration; wrong reveal stays neutral',async t=>{
  const g=game();g.act('host','start');g.act(g.players[0],'quiz-answer',{value:1});g.act(g.players[1],'quiz-answer',{value:0});
  const correct=await liveUI(t,g.get(g.players[0])),wrong=await liveUI(t,g.get(g.players[1]));
  assert.match(correct.root.textContent,/Iron-rich dust/);assert.match(correct.root.textContent,/1,000 points/);assert.match(correct.root.querySelector('.quiz-celebration img').getAttribute('src'),/story-cast-celebrate.png$/);
  assert.equal(wrong.root.querySelector('.quiz-celebration'),null);assert.ok(wrong.root.querySelector('.quiz-neutral-reveal img'));assert.match(wrong.root.textContent,/0 points · You chose Venus/);
  assert.equal(correct.get('next-round'),null);
});

test('timeout reveal explains missing answer and final complete/incomplete screens remain distinct',async t=>{
  const g=game();g.act('host','start');advance(g.room,g.room.round.deadline);const f=await liveUI(t,g.get(g.players[0]));assert.match(f.root.textContent,/No answer locked/);
  g.act('host','next');g.act('host','quiz-reveal');g.act('host','next');g.act('host','quiz-reveal');g.act('host','next');f.client.emit(g.get(g.players[0]));
  assert.match(f.root.textContent,/Final standings/);assert.ok(f.root.querySelector('.quiz-celebration'));assert.match(f.root.textContent,/Rank|points/);
  const ended=game();ended.act('host','start');ended.act('host','end');const incomplete=await liveUI(t,ended.get());
  assert.match(incomplete.root.textContent,/Provisional standings/);assert.equal(incomplete.root.querySelector('.quiz-celebration'),null);
});

test('completed live summary shows the authenticated player total before artwork and the host top score',async t=>{
  const g=completeGame(game(),(current,player)=>player===current.players[0]||current.room.round.index===2
    ?current.room.quizSnapshot.questions[current.room.round.index-1].correctAnswer:0);
  const player=await liveUI(t,g.get(g.players[1])),host=await liveUI(t,g.get());
  assert.equal(player.root.querySelector('h1').textContent,'Quiz complete');
  assert.equal(player.get('quiz-result-label').textContent,'Your total');
  assert.equal(player.get('quiz-result-total').textContent,'1,000 points');
  assert.equal(player.get('quiz-result-correct').textContent,'1 of 3 correct');
  assert.equal(host.get('quiz-result-label').textContent,'Top score');
  assert.equal(host.get('quiz-result-total').textContent,'3,000 points');
  assert.equal(host.get('quiz-result-correct').textContent,'3 of 3 correct');
  const order=player.dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(player.root.querySelector('.quiz-result-summary').compareDocumentPosition(player.root.querySelector('.quiz-finished-art'))&order);
  assert.ok(host.get('rematch').compareDocumentPosition(host.root.querySelector('.quiz-finished-art'))&order);
  assert.equal(host.get('rematch').textContent,'Back to lobby for a rematch');
  host.click('rematch');await flush();assert.deepEqual(host.client.calls,[{action:'rematch',values:{}}]);
});

test('host top-score summary preserves tied 30,000-point totals and shared ranks without inventing a winner',async t=>{
  const quiz=sampleQuizDocument();quiz.questions=Array.from({length:30},(_,index)=>({...clone(quiz.questions[index%3]),id:randomUUID(),timeLimitSeconds:0}));
  const g=completeGame(game(quiz),current=>current.room.quizSnapshot.questions[current.room.round.index-1].correctAnswer);
  const f=await liveUI(t,g.get());
  assert.equal(f.get('quiz-result-label').textContent,'Top score');assert.equal(f.get('quiz-result-total').textContent,'30,000 points');
  assert.equal(f.get('quiz-result-correct').textContent,'30 of 30 correct');
  assert.deepEqual([...f.root.querySelectorAll('.leaderboard .rank')].map(node=>node.textContent),['1','1']);
  assert.doesNotMatch(f.root.textContent,/winner/i);
});

test('completed all-zero live result reports scored opportunities while incomplete zero reports no scored questions',async t=>{
  const completed=completeGame(game()),f=await liveUI(t,completed.get(completed.players[0]));
  assert.equal(f.get('quiz-result-total').textContent,'0 points');assert.equal(f.get('quiz-result-correct').textContent,'0 of 3 correct');
  assert.equal(f.root.querySelector('h1').textContent,'Quiz complete');assert.ok(f.root.querySelector('.quiz-celebration'));
  const early=game();early.act('host','start');early.act('host','end');f.client.emit(early.get(early.players[0]));
  assert.equal(f.root.querySelector('h1').textContent,'Quiz ended · incomplete');assert.equal(f.get('quiz-result-total').textContent,'0 points');
  assert.equal(f.get('quiz-result-correct').textContent,'No scored questions');assert.match(f.root.querySelector('.quiz-result-note').textContent,/Provisional total from 0 scored questions/);
  assert.doesNotMatch(f.root.querySelector('.quiz-result-summary').textContent,/0 of 3|answered together/);
  assert.equal(f.root.querySelector('.quiz-celebration'),null);assert.ok(f.root.querySelector('.quiz-cast-hold'));
});

test('incomplete live summary keeps only scored questions and identifies the highest provisional score',async t=>{
  const g=game();g.act('host','start');g.act(g.players[0],'quiz-answer',{value:1});g.act(g.players[1],'quiz-answer',{value:0});
  g.act('host','next');g.act(g.players[1],'quiz-answer',{value:1});g.act('host','end');
  const host=await liveUI(t,g.get()),first=await liveUI(t,g.get(g.players[0])),second=await liveUI(t,g.get(g.players[1]));
  assert.equal(host.get('quiz-result-label').textContent,'Highest provisional score');assert.equal(host.get('quiz-result-total').textContent,'1,000 points');
  assert.equal(host.get('quiz-result-correct').textContent,'1 of 1 correct');
  assert.equal(first.get('quiz-result-label').textContent,'Your total');assert.equal(first.get('quiz-result-total').textContent,'1,000 points');
  assert.equal(second.get('quiz-result-total').textContent,'0 points');assert.equal(second.get('quiz-result-correct').textContent,'0 of 1 correct');
  for (const f of [host,first,second]) {
    assert.match(f.root.querySelector('.quiz-result-note').textContent,/Provisional total from 1 scored question\. There is no final winner\./);
    assert.equal(f.root.querySelector('.quiz-celebration'),null);assert.deepEqual([...f.root.querySelectorAll('.leaderboard .rank')].map(node=>node.textContent),['—','—']);
  }
});

test('quiz Leave and Close send terminal actions only after explicit confirmation',async t=>{
  const g=game(),host=await liveUI(t,g.get()),player=await liveUI(t,g.get(g.players[0]));
  assert.equal(host.get('room-exit').textContent,'Close room');host.click('room-exit');host.click('confirm-cancel');assert.equal(host.client.calls.length,0);
  host.click('room-exit');host.click('confirm-accept');player.click('room-exit');player.click('confirm-accept');await flush();
  assert.deepEqual(host.client.calls,[{action:'close',values:{}}]);assert.deepEqual(player.client.calls,[{action:'leave',values:{}}]);
});

test('authored markup remains plain text in live questions, choices and revealed explanations',async t=>{
  const q=sampleQuizDocument();q.questions[0].prompt='<img src=x onerror=alert(1)>\nChoose.';q.questions[0].answers[0]='<script>alert(1)</script>';q.questions[0].explanation='<svg onload=alert(1)>';
  const g=game(q);g.act('host','start');const f=await liveUI(t,g.get(g.players[0]));assert.match(f.root.querySelector('h1').textContent,/<img/);assert.equal(f.root.querySelector('script'),null);
  g.act('host','quiz-reveal');f.client.emit(g.get(g.players[0]));assert.equal(f.root.querySelector('svg[onload]'),null);assert.match(f.root.textContent,/<svg onload/);
});

test('web cast assets are byte-identical to their originals and provenance receipts',async()=>{
  const receipt=JSON.parse(await readFile(new URL('../web/assets/quiz-art-provenance.json',import.meta.url),'utf8'));
  for(const [filename,name] of [['story-cast-celebrate.png','StoryCastCelebrate'],['story-cast-hold.png','StoryCastHold']]){
    const asset=await readFile(new URL('../web/assets/'+filename,import.meta.url)),original=await readFile(new URL('../../../NativeSource/Likerts/StoryAssets.xcassets/'+name+'.imageset/'+name+'.png',import.meta.url)),provenance=receipt[filename];
    assert.deepEqual(asset,original);assert.equal(asset.length,provenance.bytes);assert.equal(createHash('sha256').update(asset).digest('hex'),provenance.sha256);
  }
});
