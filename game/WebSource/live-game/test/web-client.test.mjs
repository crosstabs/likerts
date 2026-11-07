import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { createLiveServer } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';
import { LiveClient, normalizeCode, validateState } from '../web/client.mjs';

const catalogue = JSON.parse(await readFile(new URL('../shared/catalogue.json', import.meta.url), 'utf8'));
const protocol = JSON.parse(await readFile(new URL('../server/fixtures/protocol-v1.json', import.meta.url), 'utf8'));
const RESUME = 'likerts.live.resume.v1';
const ADMISSION = 'likerts.live.admission.v1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const copy = value => structuredClone(value);
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,String(value)), removeItem: key => values.delete(key), keys: () => [...values.keys()] };
}
async function until(predicate, message = 'The expected local state was not reached') {
  const end = Date.now() + 4000;
  while (!predicate() && Date.now() < end) await pause(10);
  assert.ok(predicate(), message);
}
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
async function fixture(t, limits = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'likerts-web-client-'));
  const store = await openStore({ sqlitePath: join(directory, 'fixture.sqlite'), databaseURL: '', production: false });
  const app = await createLiveServer({ store, catalogue, limits });
  let origin;
  try { ({origin} = await app.listen({host:'127.0.0.1',port:0})); }
  catch (error) { await app.close(); await store.close(); await rm(directory,{recursive:true,force:true}); throw error; }
  const clients = new Set();
  const fetcher = (url,options = {}) => fetch(url,{...options,headers:{...options.headers,Origin:origin}});
  class BrowserSocket extends WebSocket { constructor(url) { super(url,{origin}); } }
  const client = ({storage = memoryStorage(),fetch: transport = fetcher,sockets = false,...options} = {}) => {
    const result = new LiveClient({origin,storage,fetch:transport,WebSocket:sockets?BrowserSocket:null,pollMs:60000,reconnectBaseMs:30,...options});
    clients.add(result); return result;
  };
  t.after(async () => {
    for (const member of clients) member.dispose();
    await app.close(); await store.close(); await rm(directory,{recursive:true,force:true});
  });
  async function players(count = 2) {
    const host = client(); await host.create({answerSeconds:0,predictSeconds:0});
    const members = [];
    for (let i=0;i<count;i++) { const p=client(); await p.join(host.state.code,'Friend '+(i+1),true); members.push(p); }
    await host.refresh();
    return {host,members};
  }
  return {origin,app,store,client,fetcher,players};
}

async function startedPlayers(f, count = 3) {
  const room = await f.players(count);
  await until(() => !room.host.refreshing && room.members.every(member => !member.refreshing));
  await room.host.action('start');
  for (const member of room.members) await member.refresh();
  const subject = room.members.find(member => member.credential.memberId === room.host.state.round.subjectId);
  const predictors = room.members.filter(member => member !== subject);
  return { ...room, subject, predictors };
}

function loseActionReceipt(f, member, action, { hold = false, beforeSend = false } = {}) {
  const held = gate(), requests = [];
  let dropped = false, entered = false;
  member.fetcher = async (url, options) => {
    const body = options?.method === 'POST' && new URL(url).pathname.endsWith('/actions') ? JSON.parse(options.body) : null;
    const matching = body?.action === action;
    if (matching) requests.push(body);
    if (matching && !dropped && beforeSend) {
      dropped = true; entered = true;
      if (hold) await held.promise;
      throw new TypeError('simulated request lost before delivery');
    }
    const response = await f.fetcher(url, options);
    if (matching && !dropped) {
      await response.arrayBuffer();
      dropped = true; entered = true;
      if (hold) await held.promise;
      throw new TypeError('simulated lost acknowledgement after commit');
    }
    return response;
  };
  return { requests, release: held.release, get entered() { return entered; } };
}

test('Offline LK challenges and missing sharing consent are rejected before any network admission', async () => {
  let calls = 0;
  const client = new LiveClient({origin:'http://127.0.0.1:1',storage:memoryStorage(),WebSocket:null,fetch:async()=>{calls++;throw new Error('unexpected network');}});
  try {
    for (const value of ['LK1.example','LK2:example','lk3.example']) {
      await assert.rejects(client.join(value,'Ari',true),error=>error.code==='offline_code');
    }
    for (const value of ['ABC','ABCDEF/extra','https://example.invalid/play','<img>']) {
      await assert.rejects(client.join(value,'Ari',true),error=>['invalid_code','offline_code'].includes(error.code));
    }
    await assert.rejects(client.join('ABCDEF','Ari',false),error=>error.code==='sharing_consent');
    assert.equal(calls,0);
    assert.equal(normalizeCode(' ab-cd ef '),'ABCDEF');
  } finally { client.dispose(); }
});

test('A committed create response lost in transit recovers after reload without a duplicate room', async t => {
  const f=await fixture(t,{maxRooms:1}), storage=memoryStorage();
  let dropped=false;
  const first=f.client({storage,fetch:async(url,options)=>{
    const response=await f.fetcher(url,options);
    if (!dropped && options?.method==='POST' && new URL(url).pathname==='/api/live/rooms') { dropped=true; throw new TypeError('simulated lost response'); }
    return response;
  }});
  await assert.rejects(first.create({answerSeconds:0,predictSeconds:0}),error=>error.code==='connection_lost');
  assert.ok(storage.getItem(ADMISSION));
  assert.equal(storage.getItem(RESUME),null);
  const recovered=f.client({storage});
  await recovered.recoverAdmission();
  assert.equal(recovered.state.role,'host');
  assert.equal(storage.getItem(ADMISSION),null);
  assert.deepEqual(storage.keys(),[RESUME]);
  const another=f.client();
  await assert.rejects(another.create({}),error=>error.status===503);
  await recovered.refresh();
  assert.equal(recovered.state.phase,'lobby');
});

test('A committed join response lost in transit recovers the same member and rotates its scoped token', async t => {
  const f=await fixture(t),host=f.client();await host.create({});
  const storage=memoryStorage();let admitted=null,dropped=false;
  const first=f.client({storage,fetch:async(url,options)=>{
    const response=await f.fetcher(url,options);
    if (!dropped && options?.method==='POST' && new URL(url).pathname.endsWith('/join')) {
      admitted=await response.clone().json();dropped=true;throw new TypeError('simulated lost response');
    }
    return response;
  }});
  await assert.rejects(first.join(host.state.code,'Ari',true),error=>error.code==='connection_lost');
  first.dispose();
  const recovered=f.client({storage});await recovered.recoverAdmission();await host.refresh();
  assert.equal(host.state.players.length,1,'Recovery must not add a second participant');
  assert.ok(recovered.credential.memberId===admitted.memberId,'Recovery keeps the original membership');
  assert.ok(recovered.credential.token!==admitted.token,'Recovery rotates the scoped credential');
  const old=await f.fetcher(f.origin+'/api/live/rooms/'+host.state.code,{headers:{Authorization:'Bearer '+admitted.token}});
  assert.equal(old.status,401);
  assert.equal(storage.getItem(ADMISSION),null);
});

test('An ambiguous private lock retries the same UUID, round, action and value instead of changing the answer', async t => {
  const f=await fixture(t),{host,members}=await f.players();
  await host.action('start');for(const p of members)await p.refresh();
  const subject=members.find(p=>p.credential.memberId===host.state.round.subjectId);
  const requests=[];let dropped=false;
  subject.fetcher=async(url,options)=>{
    const response=await f.fetcher(url,options);
    if(options?.method==='POST'&&new URL(url).pathname.endsWith('/actions')){
      requests.push(JSON.parse(options.body));
      if(!dropped){dropped=true;throw new TypeError('simulated lost acknowledgement');}
    }
    return response;
  };
  await assert.rejects(subject.action('answer',{value:4}),error=>error.code==='connection_lost');
  assert.equal(subject.pendingAction.value,4);
  await assert.rejects(subject.action('answer',{value:5}),error=>error.code==='choice_pending');
  await subject.retryAction();
  assert.equal(requests.length,2);
  for(const key of ['requestId','matchId','roundId','action','value'])assert.ok(requests[0][key]===requests[1][key],'Retry preserves '+key);
  assert.equal(subject.state.round.ownAnswer,4);
  assert.equal(subject.state.phase,'predict');
  assert.equal(subject.pendingAction,null);
  await host.refresh();assert.equal(host.state.round.ownAnswer,null);
});

test('An accepted next with a held lost acknowledgement resolves the refreshed new round without another next', async t => {
  const f = await fixture(t), { host, subject, predictors } = await startedPlayers(f, 2);
  await subject.action('answer', { value: 4 });
  await predictors[0].refresh(); await predictors[0].action('guess', { value: 4 });
  await host.refresh(); assert.equal(host.state.phase, 'reveal');
  const previousRound = host.state.round.id;
  const loss = loseActionReceipt(f, host, 'next', { hold: true });
  const pending = host.action('next'); pending.catch(() => {});
  let settledBeforeRelease = false;
  pending.then(() => { settledBeforeRelease = true; }, () => {});
  const pauseHeld = gate(); let pauseEntered = false, pausing = null;
  try {
    await until(() => loss.entered);
    assert.equal(host.pendingAction.roundId, previousRound); assert.equal(host.busy, true);
    await host.refresh();
    assert.notEqual(host.state.round.id, previousRound); assert.equal(host.state.round.index, 2);
    assert.equal(host.pendingAction, null, 'Authoritative round B must retire round A controls');
    assert.equal(host.busy, false, 'The obsolete acknowledgement cannot keep round B busy');
    await until(() => settledBeforeRelease, 'Authoritative confirmation must resolve next before the old HTTP gate is released');
    const previousFetcher = host.fetcher;
    host.fetcher = async (url, options) => {
      if (options?.method === 'POST' && new URL(url).pathname.endsWith('/actions') && JSON.parse(options.body).action === 'pause') {
        pauseEntered = true; await pauseHeld.promise;
      }
      return previousFetcher(url, options);
    };
    pausing = host.action('pause'); pausing.catch(() => {});
    await until(() => pauseEntered);
    const activePause = copy(host.pendingAction);
    assert.equal(activePause.action, 'pause'); assert.equal(host.busy, true);
    loss.release();
    const settledNext = await pending;
    assert.equal(settledNext, host.state, 'The delayed transport error resolves to the confirmed new state');
    assert.deepEqual(host.pendingAction, activePause, 'An obsolete next cannot replace the newer round-B command');
    assert.equal(host.busy, true, 'An obsolete finally cannot clear the newer command busy state');
  } finally {
    loss.release(); pauseHeld.release();
    if (pausing) await pausing.catch(() => {});
  }
  const current = await pending;
  assert.equal(current.round.id, host.state.round.id, 'The settled next stays bound to round B after the later pause');
  assert.equal(host.pendingAction, null); assert.equal(host.busy, false); assert.equal(loss.requests.length, 1);
  assert.equal(host.state.round.index, 2); assert.equal(host.state.round.paused, true);
});

for (const [action, transition] of [['answer', 'next'], ['guess', 'next'], ['answer', 'rematch']]) {
  test(`A lost ${action} acknowledgement cannot stall controls after authoritative ${transition === 'next' ? 'round advance' : 'rematch'}`, async t => {
    const f = await fixture(t), { host, members, subject, predictors } = await startedPlayers(f);
    const target = action === 'answer' ? subject : predictors[0];
    if (action === 'guess') { await subject.action('answer', { value: 4 }); await target.refresh(); }
    const previousMatch = target.state.matchId, previousRound = target.state.round.id;
    const loss = loseActionReceipt(f, target, action);
    await assert.rejects(target.action(action, { value: 4 }), error => error.code === 'connection_lost');
    const original = copy(target.pendingAction);
    assert.equal(original.roundId, previousRound); assert.equal(original.matchId, previousMatch);
    if (transition === 'next') {
      for (const predictor of predictors.filter(member => member !== target)) {
        await predictor.refresh(); await predictor.action('guess', { value: 4 });
      }
      await host.refresh(); assert.equal(host.state.phase, 'reveal'); await host.action('next');
    } else {
      await host.refresh(); await host.action('end'); await host.action('rematch');
    }
    await target.refresh();
    assert.equal(target.pendingAction, null, 'An old-round or old-match request must not block the current state');
    assert.equal(target.busy, false); assert.equal(loss.requests.length, 1, 'Reconciliation must not replay the old mutation');
    if (transition === 'rematch') {
      assert.notEqual(target.state.matchId, previousMatch); assert.equal(target.state.phase, 'lobby');
      await target.action('heartbeat'); assert.equal(target.pendingAction, null);
    } else {
      assert.equal(target.state.matchId, previousMatch); assert.notEqual(target.state.round.id, previousRound);
      const newSubject = members.find(member => member.credential.memberId === target.state.round.subjectId);
      if (target === newSubject) {
        await target.action('answer', { value: 5 }); assert.equal(target.state.round.ownAnswer, 5);
      } else {
        await newSubject.refresh(); await newSubject.action('answer', { value: 5 });
        await target.refresh(); await target.action('guess', { value: 5 }); assert.equal(target.state.round.ownGuess, 5);
      }
      assert.equal(target.pendingAction, null);
    }
  });
}

test('A same-round refresh with no confirmed lock preserves the ambiguous request UUID for its only retry', async t => {
  const f = await fixture(t), { subject } = await startedPlayers(f);
  const loss = loseActionReceipt(f, subject, 'answer', { beforeSend: true });
  await assert.rejects(subject.action('answer', { value: 4 }), error => error.code === 'connection_lost');
  const original = copy(subject.pendingAction);
  await subject.refresh();
  assert.equal(subject.state.phase, 'answer'); assert.equal(subject.state.round.id, original.roundId);
  assert.equal(subject.state.round.ownAnswer, null, 'The server has not confirmed this request');
  assert.deepEqual(subject.pendingAction, original, 'A same-round refresh cannot discard an unacknowledged choice');
  await assert.rejects(subject.action('answer', { value: 5 }), error => error.code === 'choice_pending');
  await subject.retryAction();
  assert.equal(loss.requests.length, 2); assert.deepEqual(loss.requests[1], loss.requests[0]);
  assert.equal(subject.state.round.ownAnswer, 4); assert.equal(subject.pendingAction, null);
});

test('A held answer receipt resolves through the same-round authoritative own lock without a false transport error', async t => {
  const f = await fixture(t), { subject } = await startedPlayers(f);
  const loss = loseActionReceipt(f, subject, 'answer', { hold: true });
  const pending = subject.action('answer', { value: 4 }); pending.catch(() => {});
  try {
    await until(() => loss.entered);
    const previousRound = subject.pendingAction.roundId;
    await subject.refresh();
    assert.equal(subject.state.round.id, previousRound); assert.equal(subject.state.round.ownAnswer, 4);
    assert.equal(subject.pendingAction, null); assert.equal(subject.busy, false);
  } finally { loss.release(); }
  const current = await pending;
  assert.equal(current, subject.state); assert.equal(current.round.ownAnswer, 4);
  assert.equal(subject.pendingAction, null); assert.equal(loss.requests.length, 1);
});

test('Reload resumes from only scoped credentials and restores a confirmed lock from the server', async t => {
  const f=await fixture(t),{host,members}=await f.players();
  await host.action('start');for(const p of members)await p.refresh();
  const subject=members.find(p=>p.credential.memberId===host.state.round.subjectId);
  await subject.action('answer',{value:4});
  const storage=subject.storage, saved=JSON.parse(storage.getItem(RESUME));
  assert.deepEqual(Object.keys(saved).sort(),['code','expiresAt','memberId','token','version']);
  assert.deepEqual(storage.keys(),[RESUME]);
  assert.equal(saved.ownAnswer,undefined);assert.equal(saved.nickname,undefined);
  subject.dispose();
  const reloaded=f.client({storage});await reloaded.resume();
  assert.equal(reloaded.state.round.ownAnswer,4);
  assert.equal(reloaded.state.phase,'predict');
  assert.equal(reloaded.pendingAction,null);
});

test('Reloaded guest access blocks create and join before any fetch and resumes the original seat', async t => {
  const f = await fixture(t), { host, members } = await f.players();
  const previous = members[0], storage = previous.storage, memberId = previous.credential.memberId;
  await until(() => !previous.refreshing); previous.dispose();
  const saved = storage.getItem(RESUME), calls = [];
  const reloaded = f.client({ storage, fetch: async (url, options) => { calls.push({ url, method: options?.method }); return f.fetcher(url, options); } });
  assert.equal(reloaded.state, null); assert.equal(reloaded.credential, null);
  assert.equal(reloaded.resumeHint.code, host.state.code, 'Reload preserves the scoped saved room, not a new invitation seat');
  await assert.rejects(reloaded.create({}), error => error.code === 'room_saved');
  await assert.rejects(reloaded.join(host.state.code, 'DuplicateQA', true), error => error.code === 'room_saved');
  assert.equal(calls.length, 0, 'A valid saved capability must block both admissions before network work');
  assert.equal(storage.getItem(RESUME), saved); assert.equal(storage.getItem(ADMISSION), null);
  assert.equal(reloaded.pendingAdmissionHint, null); assert.equal(reloaded.busy, false);
  await reloaded.resume(); await host.refresh();
  assert.equal(reloaded.credential.memberId, memberId);
  assert.equal(host.state.players.length, 2, 'Reload/resume must not duplicate a participant');
  assert.equal(host.state.players.filter(player => player.id === memberId).length, 1);
});

test('An active host or guest cannot overwrite its current room through a new admission', async t => {
  const f = await fixture(t), { host, members } = await f.players();
  await until(() => !host.refreshing && members.every(member => !member.refreshing));
  for (const active of [host, members[0]]) {
    const credential = active.credential, state = active.state, saved = active.storage.getItem(RESUME);
    let calls = 0;
    active.fetcher = async () => { calls++; throw new TypeError('unexpected replacement admission'); };
    await assert.rejects(active.create({}), error => error.code === 'room_saved');
    await assert.rejects(active.join(host.state.code, 'ReplacementQA', true), error => error.code === 'room_saved');
    assert.equal(calls, 0); assert.equal(active.credential, credential); assert.equal(active.state, state);
    assert.equal(active.storage.getItem(RESUME), saved); assert.equal(active.storage.getItem(ADMISSION), null);
    assert.equal(active.pendingAdmissionHint, null); assert.equal(active.busy, false);
  }
});

test('Explicitly forgetting tab access sends no leave or close and does not revoke the old remote seat', async t => {
  const f = await fixture(t), { host, members } = await f.players();
  const guest = members[0]; await until(() => !guest.refreshing);
  const previous = { ...guest.credential }, requests = [];
  guest.fetcher = async (url, options) => { requests.push({ url, method: options?.method }); return f.fetcher(url, options); };
  guest.clearLocal();
  assert.equal(guest.state, null); assert.equal(guest.credential, null); assert.equal(guest.resumeHint, null);
  assert.equal(guest.storage.getItem(RESUME), null); assert.equal(guest.storage.getItem(ADMISSION), null);
  assert.equal(guest.socket, null); assert.equal(guest.pollTimer, null); assert.equal(guest.watchdogTimer, null);
  assert.equal(requests.length, 0, 'Local forgetting must not silently send a remote departure or room close');
  await host.refresh();
  assert.equal(host.state.players.length, 2);
  assert.ok(host.state.players.some(player => player.id === previous.memberId));
  const remote = await f.fetcher(f.origin + '/api/live/rooms/' + previous.code, { headers: { Authorization: 'Bearer ' + previous.token } });
  assert.equal(remote.status, 200, 'Forgetting this tab does not claim the remote capability was revoked');
  const snapshot = await remote.json(); assert.equal(snapshot.state.self.id, previous.memberId);
  await guest.join(host.state.code, 'NewExplicitQA', true);
  assert.notEqual(guest.credential.memberId, previous.memberId, 'A deliberately new admission after forgetting is a new seat');
  await host.refresh(); assert.equal(host.state.players.length, 3);
});

test('Revoked authorization clears local state, pending action and saved access', async t => {
  const f=await fixture(t),{host,members}=await f.players();
  const removed=members[0];await host.action('kick',{playerId:removed.credential.memberId});
  await removed.refresh();
  assert.equal(removed.state,null);assert.equal(removed.credential,null);assert.equal(removed.pendingAction,null);
  assert.equal(removed.storage.getItem(RESUME),null);assert.equal(removed.storage.getItem(ADMISSION),null);
});

for(const terminal of ['close','leave']){
  test('A lost '+terminal+' response is safely retried and removes local access',async t=>{
    const f=await fixture(t),{host,members}=await f.players();
    const member=terminal==='close'?host:members[0];const sent=[];let dropped=false;
    member.fetcher=async(url,options)=>{
      const response=await f.fetcher(url,options);
      if(options?.method==='POST'&&new URL(url).pathname.endsWith('/actions')){
        sent.push(JSON.parse(options.body));
        if(!dropped){dropped=true;throw new TypeError('simulated lost terminal response');}
      }return response;
    };
    await assert.rejects(member.action(terminal),error=>error.code==='connection_lost');
    assert.ok(member.pendingAction);
    assert.equal(await member.retryAction(),null);
    assert.equal(sent.length,2);assert.ok(sent[0].requestId===sent[1].requestId,'Terminal retry keeps its identity');
    assert.equal(member.state,null);assert.equal(member.credential,null);assert.equal(member.pendingAction,null);
    assert.equal(member.storage.getItem(RESUME),null);assert.equal(member.storage.getItem(ADMISSION),null);
    assert.equal(member.socket,null);assert.equal(member.pollTimer,null);
  });
}

test('A delayed previous-generation refresh cannot replace a newly created room',async t=>{
  const f=await fixture(t),member=f.client();await member.create({});await until(()=>!member.refreshing);
  const held=gate();let entered=false;const original=member.fetcher;
  member.fetcher=async(url,options)=>{
    const response=await original(url,options);
    if(options?.method==='GET'&&!entered){entered=true;await held.promise;}
    return response;
  };
  const previous=member.refresh();await until(()=>entered);
  member.clearLocal();await member.create({});const activeCode=member.state.code;
  held.release();await previous;
  assert.ok(member.state.code===activeCode,'Old refresh must not replace current membership');
});

test('Disposing during an in-flight admission must not restore a room or persist fresh access',async t=>{
  const f=await fixture(t),held=gate();let entered=false;
  const member=f.client({fetch:async(url,options)=>{
    const response=await f.fetcher(url,options);
    if(options?.method==='POST'&&new URL(url).pathname==='/api/live/rooms'){entered=true;await held.promise;}
    return response;
  }});
  const pending=member.create({}).catch(()=>null);await until(()=>entered);
  member.dispose();held.release();await pending;
  assert.equal(member.state,null,'A disposed admission cannot repopulate the UI');
  assert.equal(member.credential,null,'A disposed admission cannot install credentials');
  assert.equal(member.disposed,true);
  assert.equal(member.storage.getItem(RESUME),null);
});

test('A stale admission completion must not resurrect access after explicit local cleanup',async t=>{
  const f=await fixture(t),held=gate();let entered=false;
  const member=f.client({fetch:async(url,options)=>{
    const response=await f.fetcher(url,options);
    if(options?.method==='POST'&&new URL(url).pathname==='/api/live/rooms'){entered=true;await held.promise;}
    return response;
  }});
  const pending=member.create({}).catch(()=>null);await until(()=>entered);
  member.clearLocal();held.release();await pending;
  assert.equal(member.state,null,'A cancelled generation cannot restore its room');
  assert.equal(member.credential,null);
  assert.equal(member.storage.getItem(RESUME),null);
  assert.equal(member.storage.getItem(ADMISSION),null);
});

test('Real WebSocket reconnect authenticates in a frame and preserves membership without credentials in the URL',async t=>{
  const f=await fixture(t),member=f.client({sockets:true});
  await member.create({});await until(()=>member.status==='connected');
  const id=member.credential.memberId,code=member.state.code, socket=member.socket;
  const url=new URL(socket.url);
  assert.equal(url.pathname,'/api/live/socket');assert.equal(url.search,'');
  socket.terminate();
  await until(()=>member.socket&&member.socket!==socket&&member.status==='connected');
  assert.ok(member.credential.memberId===id&&member.state.code===code,'Reconnect retains scoped membership');
});

test('Unavailable session storage permits in-memory recovery without pretending reload is saved',async t=>{
  const f=await fixture(t),storage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
  let dropped=false;
  const member=f.client({storage,fetch:async(url,options)=>{
    const response=await f.fetcher(url,options);
    if(!dropped&&options?.method==='POST'&&new URL(url).pathname==='/api/live/rooms'){dropped=true;throw new TypeError('lost');}
    return response;
  }});
  await assert.rejects(member.create({}),error=>error.code==='connection_lost');
  assert.ok(member.pendingAdmissionHint);assert.equal(member.persisted,false);
  await member.recoverAdmission();assert.equal(member.state.role,'host');assert.equal(member.persisted,false);assert.equal(member.resumeHint,null);
});

test('Client rejects mismatched identity, foreign room and pre-reveal private leakage before emitting state',()=>{
  const state=protocol.states.answerHost;
  const credential={code:state.code,memberId:state.self.id};
  for(const mutate of [
    s=>{s.self.id='somebody-else';},
    s=>{s.code='ZZZZZZ';},
    s=>{s.round.ownAnswer=5;},
    s=>{s.round.ownGuess=5;},
    s=>{s.reveal={answer:5};}
  ]){
    const altered=copy(state);mutate(altered);
    assert.throws(()=>validateState(altered,credential),error=>error.code==='invalid_state');
  }
});

test('HTTP transport omits ambient credentials, forbids redirects and sends scoped authorization only in headers',async t=>{
  const f=await fixture(t);const observed=[];
  const member=f.client({fetch:async(url,options)=>{observed.push({url,options});return f.fetcher(url,options);}});
  await member.create({});await member.refresh();
  const authenticated=observed.find(x=>x.options.headers.Authorization);
  assert.ok(authenticated,'A scoped read uses explicit authorization');
  assert.equal(authenticated.options.credentials,'omit');assert.equal(authenticated.options.redirect,'error');assert.equal(authenticated.options.cache,'no-store');
  assert.equal(new URL(authenticated.url).search,'');
  assert.ok(!authenticated.url.includes(member.credential.token),'Authorization never appears in the URL');
});

test('A delayed resume cannot overwrite or clear a replacement room',async t=>{
  const f=await fixture(t),storage=memoryStorage(),original=f.client({storage});await original.create({});original.dispose();
  const held=gate();let entered=false;
  const member=f.client({storage,fetch:async(url,options)=>{
    const response=await f.fetcher(url,options);
    if(options?.method==='GET'&&!entered){entered=true;await held.promise;}
    return response;
  }});
  const previous=member.resume();previous.catch(()=>{});await until(()=>entered);
  member.clearLocal();await member.create({});const current=member.credential;
  held.release();await assert.rejects(previous,error=>error.code==='cancelled');
  assert.ok(member.credential===current,'Stale resume must preserve the new credential object');
  assert.ok(member.state.code===current.code,'Stale resume must preserve the new room');
  assert.ok(JSON.parse(storage.getItem(RESUME)).token===current.token,'Stale resume must not replace saved access');
});

test('A delayed action receipt cannot overwrite a replacement room or its busy state',async t=>{
  const f=await fixture(t),member=f.client();await member.create({});await until(()=>!member.refreshing);
  const held=gate();let entered=false;
  member.fetcher=async(url,options)=>{
    const response=await f.fetcher(url,options);
    if(options?.method==='POST'&&new URL(url).pathname.endsWith('/actions')&&!entered){entered=true;await held.promise;}
    return response;
  };
  const previous=member.action('lock',{locked:true});previous.catch(()=>{});await until(()=>entered);
  member.clearLocal();await member.create({});const current=member.credential;
  held.release();await assert.rejects(previous,error=>error.code==='cancelled');
  assert.ok(member.credential===current,'Stale action must preserve replacement membership');
  assert.ok(member.state.code===current.code);assert.equal(member.state.joinLocked,false);
  assert.equal(member.pendingAction,null);assert.equal(member.busy,false);
});

test('An admission receipt with the wrong role is rejected without installing access and remains recoverable',async t=>{
  const f=await fixture(t);let changed=false;
  const member=f.client({fetch:async(url,options)=>{
    const response=await f.fetcher(url,options);
    if(!changed&&options?.method==='POST'&&new URL(url).pathname==='/api/live/rooms'){
      changed=true;const receipt=await response.json();receipt.state.role='player';
      return new Response(JSON.stringify(receipt),{status:201,headers:{'Content-Type':'application/json'}});
    }return response;
  }});
  await assert.rejects(member.create({}),error=>error.code==='invalid_admission');
  assert.equal(member.credential,null);assert.equal(member.state,null);assert.equal(member.storage.getItem(RESUME),null);
  assert.ok(member.pendingAdmissionHint);await member.recoverAdmission();assert.equal(member.state.role,'host');
});

test('Phase2 malformed recipient projections fail closed before renderer or private fields can be reached',()=>{
  for(const [name,mutate] of [
    ['answerHost',s=>{s.round=null;}],
    ['lobbyHost',s=>{s.players[0]=null;}],
    ['lobbyHost',s=>{s.players[0].connected='yes';}],
    ['lobbyHost',s=>{s.players.push(s.players[0]);}],
    ['answerHost',s=>{s.round.prompt.text=null;}],
    ['answerHost',s=>{s.round.prompt.text='x'.repeat(241);}],
    ['answerHost',s=>{s.round.answer=4;}],
    ['answerHost',s=>{s.round.guesses={hidden:4};}],
    ['answerHost',s=>{s.privateHistory=[{answer:4}];}],
    ['revealHost',s=>{s.reveal.guesses=null;}],
    ['revealHost',s=>{s.reveal.answer=9;}],
    ['revealHost',s=>{s.round.ownAnswer=4;}],
    ['finishedHost',s=>{s.leaderboard[0].accuracy=101;}],
    ['finishedHost',s=>{s.completion=null;}]
  ]){
    const invalid=copy(protocol.states[name]),credential={code:invalid.code,memberId:invalid.self.id};mutate(invalid);
    assert.throws(()=>validateState(invalid,credential),error=>error.code==='invalid_state','Malformed '+name+' must be rejected');
  }
});

test('Phase2 expired or malformed admission recovery records cannot trap a tab or send malformed credentials',async()=>{
  for(const invalid of [
    {version:1,admissionId:crypto.randomUUID(),recoverySecret:'A'.repeat(43),kind:'create',code:null,expiresAt:Date.now()-1,payload:{settings:{}}},
    {version:1,expiresAt:Date.now()+60000},
    {version:1,kind:'join',expiresAt:'later'},
    {version:1,kind:'create',expiresAt:Date.now()+60000,payload:{}},
    {version:1,kind:'join',expiresAt:Date.now()+60000,payload:{code:'ABCDEF',nickname:'Ari',acceptRoomSharing:true}}
  ]){
    const storage=memoryStorage();storage.setItem(ADMISSION,JSON.stringify(invalid));let calls=0;
    const client=new LiveClient({origin:'http://127.0.0.1:1',storage,WebSocket:null,fetch:async()=>{calls++;throw new Error('No network allowed');}});
    client.pendingAdmission=copy(invalid);
    try{
      assert.equal(client.pendingAdmissionHint,null,'Malformed saved recovery is not an active room request');
      assert.equal(storage.getItem(ADMISSION),null);
      assert.equal(client.pendingAdmission,null);
      await assert.rejects(client.recoverAdmission(),error=>error.code==='admission_expired');
      assert.equal(calls,0);
    }finally{client.dispose();}
  }
});

test('Phase2 invalid refresh does not replace the last valid state and surfaces a recoverable validation error',async t=>{
  const f=await fixture(t),errors=[],member=f.client({onError:error=>errors.push(error)});await member.create({});await until(()=>!member.refreshing);
  const before=member.state;
  member.fetcher=async()=>new Response(JSON.stringify({state:{...before,players:[null],revision:before.revision+1}}),{status:200,headers:{'Content-Type':'application/json'}});
  await member.refresh();
  assert.equal(member.state,before);assert.equal(errors.length,1);assert.equal(errors[0].code,'invalid_state');
});

test('Phase2 same-revision older server-time snapshots cannot undo the current deadline projection',async t=>{
  const f=await fixture(t),member=f.client();await member.create({});await until(()=>!member.refreshing);
  const before=member.state,stale={...before,serverTime:before.serverTime-1};
  member.acceptState(stale);
  assert.equal(member.state,before);
});

test('Phase2 admission recovery keeps the original settings snapshot while a response is in flight',async t=>{
  const f=await fixture(t),held=gate();let entered=false;
  const member=f.client({fetch:async(url,options)=>{
    const response=await f.fetcher(url,options);
    if(options?.method==='POST'&&new URL(url).pathname==='/api/live/rooms'){entered=true;await held.promise;}
    return response;
  }});
  const settings={topic:'mix',answerSeconds:0,predictSeconds:0};
  const pending=member.create(settings);pending.catch(()=>{});
  try{await until(()=>entered);settings.topic='pets';settings.answerSeconds=30;}finally{held.release();}
  await pending;
  assert.equal(member.state.settings.topic,'mix');assert.equal(member.state.settings.answerSeconds,0);
  assert.equal(member.pendingAdmissionHint,null);
});

test('Phase2 malformed reviewed-topic metadata is rejected before it reaches the host picker',async()=>{
  for(const data of [{topics:[null]},{version:1,sha256:'0'.repeat(64),locale:'en',topics:[],limits:{maxPlayers:12,defaultCapacity:12}}]){
    const client=new LiveClient({origin:'http://127.0.0.1:1',WebSocket:null,fetch:async()=>new Response(JSON.stringify(data),{status:200})});
    try{await assert.rejects(client.catalogue(),error=>error.code==='invalid_catalogue');}finally{client.dispose();}
  }
});

test('Phase2 manual forgetting reports denied storage deletion without claiming access was removed',()=>{
  const storage=memoryStorage();storage.setItem(RESUME,JSON.stringify({version:1,code:'ABCDEF',token:'A'.repeat(43),memberId:'host',expiresAt:Date.now()+60000}));
  storage.removeItem=()=>{throw new Error('deletion denied');};
  const client=new LiveClient({origin:'http://127.0.0.1:1',WebSocket:null,storage});
  try{
    assert.ok(client.resumeHint);
    assert.throws(()=>client.forgetSavedAccess(),error=>error.code==='storage_unavailable');
    assert.ok(client.resumeHint);assert.ok(storage.getItem(RESUME));assert.equal(client.state,null);
  }finally{client.dispose();}
});
