import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { LiveError } from '../web/client.mjs';
import { mountLiveApp } from '../web/ui.mjs';

const protocol=JSON.parse(await readFile(new URL('../server/fixtures/protocol-v1.json',import.meta.url),'utf8'));
const copy=value=>structuredClone(value);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fakeClient({state=null,action,catalogue,storage=true,resumeHint=null,pendingAdmissionHint=null}={}){
  const calls={actions:[],joins:[],creates:[],retry:0,recover:0,resume:0,refresh:0,clearLocal:0,dispose:0};
  return {
    state:copy(state),status:state?'connected':'idle',persisted:storage,pendingAction:null,resumeHint,pendingAdmissionHint,calls,
    onState(){},onStatus(){},onError(){},
    catalogue:catalogue??(()=>Promise.resolve({topics:[{id:'snacks',title:'Snack logic'}]})),
    action(name,values){calls.actions.push({name,values});return action? action(name,values):Promise.resolve(this.state);},
    join(code,name,consent){calls.joins.push({code,name,consent});return Promise.resolve();},
    create(settings){calls.creates.push(copy(settings));return Promise.resolve();},
    retryAction(){calls.retry++;return Promise.resolve();},
    recoverAdmission(){calls.recover++;return Promise.resolve();},
    resume(){calls.resume++;return Promise.resolve();},
    refresh(){calls.refresh++;return Promise.resolve();},
    clearLocal(){calls.clearLocal++;this.state=null;this.resumeHint=null;this.pendingAdmissionHint=null;this.pendingAction=null;this.status='idle';this.onState(null);},
    forgetSavedAccess(){this.clearLocal();},
    dispose(){calls.dispose++;},
    emit(state){this.state=copy(state);this.onState(this.state);},
    connection(status){this.status=status;this.onStatus(status);}
  };
}
async function fixture(t,options={}){
  const dom=new JSDOM('<!doctype html><html lang="en"><body><div id="app"></div></body></html>',{url:options.url??'https://local-game.invalid/play'});
  dom.window.scrollTo=()=>{};
  const root=dom.window.document.getElementById('app'),client=fakeClient(options);
  const app=mountLiveApp({root,client,window:dom.window});
  await flush();
  if(client.state)client.emit(client.state);
  t.after(()=>{app.dispose();dom.window.close();});
  const get=id=>root.querySelector('#'+id);
  const input=(id,value)=>{const node=get(id);node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  const click=id=>{const node=get(id);assert.ok(node,'Expected control '+id);node.click();};
  return{dom,document:dom.window.document,window:dom.window,root,client,app,get,input,click};
}
const state=name=>copy(protocol.states[name]);

test('Join uses labelled fields and native sharing consent before submitting membership',async t=>{
  const f=await fixture(t);
  f.click('choose-join');f.input('room-code','ABCDEF');f.input('nickname','Ari');
  assert.equal(f.get('room-code').labels[0].textContent,'Room code');
  assert.equal(f.get('nickname').labels[0].textContent,'Your name');
  const form=f.root.querySelector('form');
  assert.equal(f.get('room-sharing').required,true);assert.equal(form.checkValidity(),false);
  form.requestSubmit();await flush();assert.equal(f.client.calls.joins.length,0);
  f.get('room-sharing').checked=true;f.get('room-sharing').dispatchEvent(new f.window.Event('change',{bubbles:true}));
  assert.equal(form.checkValidity(),true);
  form.requestSubmit();await flush();
  assert.equal(f.client.calls.joins.length,1);
  assert.equal(f.client.calls.joins[0].consent,true);
});

test('Offline LK invitation is explained rather than admitted as a live room',async t=>{
  const f=await fixture(t,{url:'https://local-game.invalid/play?room=LK3%3Aoffline-example'});
  assert.ok(f.get('room-code'));
  assert.match(f.root.textContent,/offline challenge/i);
  assert.equal(f.client.calls.joins.length,0);
});

test('A live invitation fills only the public room code and still requires a name and consent',async t=>{
  const f=await fixture(t,{url:'https://local-game.invalid/play?room=ab-cd-ef'});
  assert.equal(f.get('room-code').value,'ABCDEF');
  assert.equal(f.get('nickname').value,'');assert.equal(f.get('room-sharing').checked,false);
  assert.equal(f.client.calls.joins.length,0);
});

test('Saved access takes precedence over a guest invitation without presenting another admission form',async t=>{
  const saved={code:'ABCDEF',expiresAt:Date.now()+60000};
  const f=await fixture(t,{url:'https://local-game.invalid/play?room=BCDEFG',resumeHint:saved});
  assert.match(f.root.querySelector('main h1').textContent,/saved/i);
  assert.match(f.root.textContent,/Room ABCDEF is saved on this tab/);
  assert.ok(f.get('resume-room'));assert.ok(f.get('forget-room'));
  for(const id of ['choose-join','choose-host','join-room','create-room','room-code','nickname','room-exit']){
    assert.equal(f.get(id),null,'Saved access must not present '+id+' before explicit forgetting');
  }
  assert.equal(f.root.querySelector('form'),null);
  assert.deepEqual(f.client.resumeHint,saved);
  assert.equal(f.client.calls.clearLocal,0);
  assert.deepEqual(f.client.calls.actions,[]);assert.deepEqual(f.client.calls.joins,[]);assert.deepEqual(f.client.calls.creates,[]);
  assert.equal(new URL(f.window.location.href).searchParams.get('room'),'BCDEFG');
});

test('Resume on the saved-access screen uses recovery rather than a second create or join',async t=>{
  const saved={code:'ABCDEF',expiresAt:Date.now()+60000};
  const f=await fixture(t,{url:'https://local-game.invalid/play?room=ABCDEF',resumeHint:saved});
  f.click('resume-room');await flush();
  assert.equal(f.client.calls.resume,1);
  assert.equal(f.client.calls.clearLocal,0);
  assert.deepEqual(f.client.resumeHint,saved);
  assert.deepEqual(f.client.calls.actions,[]);assert.deepEqual(f.client.calls.joins,[]);assert.deepEqual(f.client.calls.creates,[]);
});

test('Cancelling Forget tab access preserves saved access and does not admit or leave anyone',async t=>{
  const saved={code:'ABCDEF',expiresAt:Date.now()+60000};
  const f=await fixture(t,{url:'https://local-game.invalid/play?room=BCDEFG',resumeHint:saved});
  f.click('forget-room');
  const dialog=f.root.querySelector('dialog');assert.ok(dialog);
  assert.ok(f.document.getElementById(dialog.getAttribute('aria-labelledby')));
  const description=f.document.getElementById(dialog.getAttribute('aria-describedby'));
  assert.ok(description);assert.match(description.textContent,/does not leave a remote seat or close a room/i);
  assert.equal(f.client.calls.clearLocal,0,'Opening confirmation must preserve access');
  f.click('confirm-cancel');await flush();
  assert.equal(f.root.querySelector('dialog'),null);
  assert.deepEqual(f.client.resumeHint,saved);
  assert.ok(f.get('resume-room'));assert.ok(f.get('forget-room'));
  assert.equal(f.get('join-room'),null);assert.equal(f.get('create-room'),null);
  assert.equal(f.client.calls.clearLocal,0);
  assert.deepEqual(f.client.calls.actions,[]);assert.deepEqual(f.client.calls.joins,[]);assert.deepEqual(f.client.calls.creates,[]);
});

test('Confirmed Forget clears only tab access and restores the intended invitation for explicit joining',async t=>{
  const f=await fixture(t,{url:'https://local-game.invalid/play?room=BCDEFG',resumeHint:{code:'ABCDEF',expiresAt:Date.now()+60000}});
  f.click('forget-room');
  assert.equal(f.client.calls.clearLocal,0);
  f.click('confirm-accept');await flush();
  assert.equal(f.client.calls.clearLocal,1);
  assert.equal(f.client.resumeHint,null);assert.equal(f.client.pendingAdmissionHint,null);
  assert.equal(f.root.querySelector('dialog'),null);
  assert.equal(f.get('resume-room'),null);assert.equal(f.get('forget-room'),null);
  assert.equal(f.get('room-code').value,'BCDEFG');
  assert.equal(f.get('nickname').value,'');assert.equal(f.get('room-sharing').checked,false);
  assert.equal(f.client.calls.resume,0);
  assert.deepEqual(f.client.calls.actions,[],'Forgetting must not send leave or close');
  assert.deepEqual(f.client.calls.joins,[],'Forgetting must not automatically join');
  assert.deepEqual(f.client.calls.creates,[],'Forgetting must not automatically create');
  f.input('nickname','Mira');
  f.get('room-sharing').checked=true;f.get('room-sharing').dispatchEvent(new f.window.Event('change',{bubbles:true}));
  f.root.querySelector('form').requestSubmit();await flush();
  assert.deepEqual(f.client.calls.joins,[{code:'BCDEFG',name:'Mira',consent:true}]);
  assert.deepEqual(f.client.calls.actions,[]);assert.deepEqual(f.client.calls.creates,[]);
});

test('Changing a private choice does not submit; only the explicit Lock action sends it once',async t=>{
  const pending=deferred(),f=await fixture(t,{state:state('answerSubject'),action:()=>pending.promise});
  assert.equal(f.get('lock-choice').disabled,true);
  f.click('choice-4');assert.equal(f.client.calls.actions.length,0);
  assert.equal(f.get('choice-4').getAttribute('aria-pressed'),'true');
  assert.equal(f.get('choice-3').getAttribute('aria-pressed'),'false');
  assert.equal(f.get('lock-choice').disabled,false);
  f.click('lock-choice');f.click('lock-choice');
  assert.equal(f.client.calls.actions.length,1);assert.equal(f.client.calls.actions[0].name,'answer');
  assert.equal(f.client.calls.actions[0].values.value,4);
  assert.equal(f.get('choice-2').disabled,true);
  pending.resolve();await flush();
});

test('A confirmed lock is restored from state and cannot be resubmitted or edited',async t=>{
  const current=state('predictSubject');current.round.ownAnswer=4;
  const f=await fixture(t,{state:current});
  assert.match(f.root.textContent,/You picked 4/);
  assert.equal(f.get('lock-choice'),null);assert.equal(f.get('choice-1'),null);
  assert.equal(f.client.calls.actions.length,0);
});

test('Prediction makes the subject explicit and does not render another player’s private value',async t=>{
  const current=state('predictOtherGuest');current.round.ownGuess=null;current.round.ownAnswer=null;
  const f=await fixture(t,{state:current});
  assert.match(f.root.querySelector('h1').textContent,new RegExp(current.round.subjectName));
  assert.match(f.root.textContent,/Hidden from other players until reveal/);
  assert.equal(f.root.querySelector('.revealed-answer'),null);
  f.click('choice-2');assert.equal(f.client.calls.actions.length,0);
  f.click('lock-choice');await flush();
  assert.equal(f.client.calls.actions[0].name,'guess');
  assert.equal(f.client.calls.actions[0].values.value,2);
});

test('An ambiguous lock offers exact retry and blocks composing a replacement lock',async t=>{
  const f=await fixture(t,{state:state('answerSubject')});
  f.click('choice-4');
  f.client.pendingAction={requestId:'synthetic-request',action:'answer',value:4};
  f.client.onError(new LiveError('connection_lost','We could not confirm your lock.'));
  assert.ok(f.get('retry-action'));
  assert.equal(f.get('lock-choice').disabled,true,'A pending immutable request must block a second Lock');
  assert.equal(f.get('choice-5').disabled,true,'Do not visually compose a replacement while its predecessor is ambiguous');
  f.click('retry-action');await flush();
  assert.equal(f.client.calls.retry,1);assert.equal(f.client.calls.actions.length,0);
});

test('An ordinary deferred lock is a polite confirmation status until success, without an error or Retry',async t=>{
  const pending=deferred();let f;
  f=await fixture(t,{state:state('answerSubject'),action:async()=>{
    f.client.pendingAction={requestId:'unchanged-confirmation-request',action:'answer',value:4};f.client.busy=true;f.client.connection('syncing');
    try{await pending.promise;f.client.pendingAction=null;}finally{f.client.busy=false;}
  }});
  f.click('choice-4');f.click('lock-choice');
  const status=[...f.root.querySelectorAll('[role=status]')].find(node=>node.textContent==='Confirming…');
  assert.ok(status);assert.equal(status.getAttribute('aria-live'),'polite');
  assert.equal(f.root.querySelector('[role=alert]'),null);assert.equal(f.get('retry-action'),null);
  assert.equal(f.get('choice-2').disabled,true);assert.equal(f.client.calls.actions.length,1);
  pending.resolve();await flush();
  assert.equal(f.client.pendingAction,null);assert.equal(f.app.model.busy,false);
  assert.equal(f.root.querySelector('[role=alert]'),null);assert.equal(f.get('retry-action'),null);
  assert.ok(!f.root.textContent.includes('Confirming…'));
});

test('A deferred lock rejected with an uncertain outcome offers Retry only after settlement and keeps its request identity',async t=>{
  const pending=deferred();let f;
  f=await fixture(t,{state:state('answerSubject'),action:async()=>{
    f.client.pendingAction={requestId:'same-uncertain-request',action:'answer',value:4};f.client.busy=true;f.client.connection('syncing');
    try{await pending.promise;}finally{f.client.busy=false;}
  }});
  f.click('choice-4');f.click('lock-choice');assert.equal(f.get('retry-action'),null);
  pending.reject(new LiveError('connection_lost','We could not confirm your lock.'));await flush();
  assert.match(f.root.querySelector('[role=alert]').textContent,/We could not confirm your lock/);
  assert.ok(f.get('retry-action'));assert.equal(f.get('retry-action').disabled,false);
  assert.equal(f.get('choice-2').disabled,true);f.click('retry-action');await flush();
  assert.equal(f.client.calls.retry,1);assert.equal(f.client.pendingAction.requestId,'same-uncertain-request');
  assert.equal(f.client.calls.actions.length,1,'Retry must not compose another lock');
});

test('Client transport activity also withholds recovery controls when the view itself is not busy',async t=>{
  const f=await fixture(t,{state:state('answerSubject')});
  f.client.pendingAction={requestId:'transport-owned-request',action:'answer',value:4};f.client.busy=true;f.client.connection('syncing');
  assert.equal(f.app.model.busy,false);assert.equal(f.root.querySelector('[role=alert]'),null);assert.equal(f.get('retry-action'),null);
  assert.match(f.root.textContent,/Confirming…/);
  f.client.busy=false;f.client.connection('reconnecting');
  assert.ok(f.root.querySelector('[role=alert]'));assert.ok(f.get('retry-action'));
});

test('A real error remains visible during transport activity without offering a concurrent Retry',async t=>{
  const f=await fixture(t,{state:state('answerSubject')});
  f.client.pendingAction={requestId:'inflight-with-real-error',action:'answer',value:4};f.client.busy=true;
  f.client.onError(new LiveError('invalid_state','The room sent an unexpected update.'));
  assert.match(f.root.querySelector('[role=alert]').textContent,/The room sent an unexpected update/);
  assert.equal(f.get('retry-action'),null);
  f.client.busy=false;f.client.connection('offline');
  assert.match(f.root.querySelector('[role=alert]').textContent,/The room sent an unexpected update/);assert.ok(f.get('retry-action'));
});

test('Join input focus, selection and consent survive connection-status rerendering',async t=>{
  const f=await fixture(t);f.click('choose-join');f.input('nickname','Ari June');
  f.get('room-sharing').checked=true;f.get('room-sharing').dispatchEvent(new f.window.Event('change',{bubbles:true}));
  f.get('nickname').focus();f.get('nickname').setSelectionRange(2,5);
  f.client.connection('reconnecting');
  assert.equal(f.document.activeElement.id,'nickname');
  assert.equal(f.get('nickname').value,'Ari June');
  assert.equal(f.get('nickname').selectionStart,2);assert.equal(f.get('nickname').selectionEnd,5);
  assert.equal(f.get('room-sharing').checked,true);
  assert.match(f.root.textContent,/Reconnecting/);
});

test('A chosen value and keyboard focus survive a reconnect update to the same round',async t=>{
  const f=await fixture(t,{state:state('answerSubject')});
  f.get('choice-3').focus();f.click('choice-3');
  f.client.connection('reconnecting');
  assert.equal(f.document.activeElement.id,'choice-3');
  assert.equal(f.app.model.selection,3);
  assert.equal(f.get('choice-3').classList.contains('selected'),true);
  f.client.emit({...f.client.state,revision:f.client.state.revision+1});
  assert.equal(f.app.model.selection,3);
});

test('A new round clears an unsubmitted selection and focuses the new heading',async t=>{
  const f=await fixture(t,{state:state('answerSubject')});f.get('choice-5').focus();f.click('choice-5');
  const next=copy(f.client.state);next.round.id='next-synthetic-round';next.round.index++;next.revision++;
  f.client.emit(next);
  assert.equal(f.app.model.selection,null);assert.equal(f.get('lock-choice').disabled,true);
  assert.equal(f.document.activeElement.tagName,'H1');
});

test('Awaited action completion and later connection updates preserve focus on the new phase heading',async t=>{
  const completion=deferred();let f;
  f=await fixture(t,{state:state('answerSubject'),action:async()=>{
    await completion.promise;
    f.client.emit(state('predictSubject'));
    return f.client.state;
  }});
  f.click('choice-4');
  f.get('lock-choice').focus();f.click('lock-choice');
  assert.equal(f.client.calls.actions.length,1);
  completion.resolve();await flush();
  assert.equal(f.client.state.phase,'predict');
  assert.equal(f.app.model.busy,false,'The action must have finished before checking retained focus');
  assert.equal(f.document.activeElement,f.root.querySelector('main h1'),'Settling the action must retain the new phase heading focus');
  f.client.connection('reconnecting');
  assert.equal(f.document.activeElement,f.root.querySelector('main h1'),'A later connection update must retain heading focus');
  f.client.connection('connected');
  assert.equal(f.document.activeElement,f.root.querySelector('main h1'));
});

test('Names and player IDs are treated as data, never executable markup',async t=>{
  const current=state('lobbyHost'),untrusted='<img src=x onerror=alert(1)>';
  current.players[0].nickname=untrusted;current.players[0].id='"><script>alert(1)</script>';
  const f=await fixture(t,{state:current});
  assert.ok(f.root.textContent.includes(untrusted));
  assert.equal(f.root.querySelector('script,[onerror],img[src="x"]'),null);
  const remove=[...f.root.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Remove '+untrusted);
  assert.ok(remove);remove.click();
  assert.ok(f.root.querySelector('dialog').textContent.includes(untrusted));
  assert.equal(f.root.querySelector('script,[onerror],img[src="x"]'),null);
  f.click('confirm-accept');await flush();
  assert.equal(f.client.calls.actions[0].name,'kick');
  assert.ok(f.client.calls.actions[0].values.playerId===current.players[0].id,'The ID remains an opaque action value');
});

test('Stored form text remains a field value rather than HTML after status updates',async t=>{
  const f=await fixture(t);f.click('choose-join');
  const untrusted='"><img src=x onerror=alert(1)>';
  f.input('nickname',untrusted);f.client.connection('offline');
  assert.equal(f.get('nickname').value,untrusted);
  assert.equal(f.root.querySelector('script,[onerror],img[src="x"]'),null);
});

test('Controller never receives a choice UI and guest lobby never presents host controls',async t=>{
  const host=await fixture(t,{state:state('answerHost')});
  assert.equal(host.get('lock-choice'),null);assert.equal(host.get('choice-1'),null);
  assert.ok(host.get('pause-round'));assert.ok(host.get('skip-round'));
  const guest=await fixture(t,{state:state('lobbyPlayer')});
  assert.equal(guest.get('start-game'),null);assert.equal(guest.get('lock-room'),null);
  assert.match(guest.root.textContent,/Waiting for the host to start/);
});

test('Terminal state removes stale destructive confirmation and clears admission consent',async t=>{
  const f=await fixture(t,{state:state('lobbyHost')});
  f.app.model.consent=true;f.app.model.code='ABCDEF';
  f.click('room-exit');assert.ok(f.root.querySelector('dialog'));
  f.client.emit(null);
  assert.equal(f.root.querySelector('dialog'),null,'A revoked room must not retain a destructive action dialog');
  assert.equal(f.app.model.consent,false);assert.equal(f.app.model.code,'');
  assert.equal(f.client.calls.actions.length,0);
  assert.ok(f.get('choose-join'));
});

test('Destructive confirmation references a real accessible title and description, and Cancel does not mutate',async t=>{
  const f=await fixture(t,{state:state('lobbyHost')});f.click('room-exit');
  const dialog=f.root.querySelector('dialog');
  assert.ok(f.document.getElementById(dialog.getAttribute('aria-labelledby')));
  assert.ok(f.document.getElementById(dialog.getAttribute('aria-describedby')),'Dialog description must reference existing content');
  f.click('confirm-cancel');await flush();
  assert.equal(f.client.calls.actions.length,0);
});

test('Blocked session storage produces an honest keep-tab-open warning',async t=>{
  const f=await fixture(t,{state:state('lobbyPlayer'),storage:false});
  assert.match(f.root.textContent,/could not save room access for a reload/);
  assert.match(f.root.textContent,/Keep this tab open/);
});

test('Pending admission offers recovery and prevents another form admission',async t=>{
  const f=await fixture(t,{pendingAdmissionHint:{kind:'join',code:'ABCDEF',expiresAt:Date.now()+60000}});
  assert.ok(f.get('recover-admission'));f.click('choose-join');
  assert.equal(f.get('join-room').disabled,true);
  f.click('recover-admission');await flush();
  assert.equal(f.client.calls.recover,1);assert.equal(f.client.calls.joins.length,0);
});

test('Copied invite uses only the guest room route and never a management capability',async t=>{
  const f=await fixture(t,{state:state('lobbyHost')});let copied='';
  Object.defineProperty(f.window.navigator,'clipboard',{value:{writeText:async value=>{copied=value;}},configurable:true});
  f.click('copy-link');await flush();
  const url=new URL(copied);
  assert.equal(url.origin,f.window.location.origin);assert.equal(url.pathname,'/play');
  assert.deepEqual([...url.searchParams.keys()],['room']);assert.ok(url.searchParams.get('room')===f.client.state.code);
  assert.match(f.root.querySelector('.toast').textContent,/Copied/);
});

test('Clipboard rejection shows a selectable textual fallback without sending an invitation',async t=>{
  const f=await fixture(t,{state:state('lobbyHost')});
  Object.defineProperty(f.window.navigator,'clipboard',{value:{writeText:async()=>{throw new Error('clipboard blocked');}},configurable:true});
  f.click('copy-link');await flush();
  assert.match(f.root.querySelector('.toast').textContent,/Copy manually:/);
  assert.equal(f.client.calls.actions.length,0);
});

test('A late catalogue completion after disposal cannot redraw the removed app',async t=>{
  const catalogue=deferred(),f=await fixture(t,{catalogue:()=>catalogue.promise});
  const before=f.root.innerHTML;
  f.app.dispose();catalogue.resolve({topics:[{id:'snacks',title:'Updated late'}]});await flush();
  assert.equal(f.root.innerHTML,before);assert.equal(f.client.calls.dispose,1);
});

test('Phase2 cancelling a destructive dialog returns keyboard focus to its opener',async t=>{
  const f=await fixture(t,{state:state('lobbyHost')});f.get('room-exit').focus();f.click('room-exit');
  f.get('confirm-cancel').focus();f.click('confirm-cancel');
  assert.equal(f.document.activeElement,f.get('room-exit'));
  assert.equal(f.client.calls.actions.length,0);
});

test('Phase2 a late error from the previous round cannot replace the current round with stale recovery copy',async t=>{
  const pending=deferred(),f=await fixture(t,{state:state('answerSubject'),action:()=>pending.promise});
  f.click('choice-4');f.click('lock-choice');
  const next=copy(f.client.state);next.round.id='replacement-synthetic-round';next.revision++;
  f.client.emit(next);
  pending.reject(new LiveError('wrong_phase','OLD_ROUND_FAILURE'));await flush();
  assert.ok(!f.root.textContent.includes('OLD_ROUND_FAILURE'));
  assert.equal(f.root.querySelector('.error'),null);
});

for(const [code,message] of [['room_locked','The host locked this room.'],['room_full','This room is full.'],['nickname_taken','That nickname is already in the room.']]){
  test('Phase2 '+code+' keeps editable join fields and confirmed consent',async t=>{
    const f=await fixture(t);f.client.join=async()=>{throw new LiveError(code,message,409);};
    f.click('choose-join');f.input('room-code','ABCDEF');f.input('nickname','Ari');
    f.get('room-sharing').checked=true;f.get('room-sharing').dispatchEvent(new f.window.Event('change',{bubbles:true}));
    f.root.querySelector('form').requestSubmit();await flush();
    assert.equal(f.get('nickname').value,'Ari');assert.equal(f.get('room-code').value,'ABCDEF');assert.equal(f.get('room-sharing').checked,true);
    assert.equal(f.get('join-room').disabled,false);assert.ok(f.root.querySelector('[role=alert]').textContent.includes(message));
  });
}

test('Phase2 elapsed deadlines disable new choices and locks while awaiting authoritative results',async t=>{
  const current=state('answerSubject');current.round.deadline=current.serverTime-1;
  const f=await fixture(t,{state:current});
  assert.match(f.root.querySelector('[data-clock]').textContent,/Confirming the round/);
  assert.equal(f.get('choice-4').disabled,true);assert.equal(f.get('lock-choice').disabled,true);
  f.click('choice-4');assert.equal(f.client.calls.actions.length,0);
});

test('Phase2 in-flight admission settings cannot be edited into a different recovery request',async t=>{
  const pending=deferred(),f=await fixture(t);f.client.create=()=>pending.promise;
  f.click('choose-host');f.root.querySelector('form').requestSubmit();
  assert.ok([...f.root.querySelectorAll('select')].every(select=>select.disabled));
  pending.resolve();await flush();
  assert.ok([...f.root.querySelectorAll('select')].every(select=>!select.disabled));
});

test('Phase2 failed topic loading has a usable retry instead of an uncreatable room or crashing picker',async t=>{
  let attempts=0;
  const f=await fixture(t,{catalogue:async()=>{if(++attempts===1)throw new Error('offline');return{topics:[{id:'snacks',title:'Snack logic'}],limits:{maxPlayers:4}};}});
  f.click('choose-host');assert.equal(f.get('create-room').disabled,true);assert.ok(f.get('retry-topics'));
  f.click('retry-topics');await flush();
  assert.equal(f.get('create-room').disabled,false);assert.equal(f.get('retry-topics'),null);
  assert.equal(f.app.model.settings.capacity,4);assert.equal(attempts,2);
});

test('Phase2 an actual subject timeout is explained as a timer ending rather than a host skip',async t=>{
  const current=state('revealHost');current.reveal={...current.reveal,valid:false,reason:'subject_timeout',answer:null,groupAccuracy:null,guesses:[]};
  const f=await fixture(t,{state:current});
  assert.match(f.root.querySelector('.lede').textContent,/answer timer ended/);
  assert.ok(!f.root.querySelector('.lede').textContent.includes('skipped'));
  assert.equal(f.root.querySelector('.revealed-answer'),null);
});

test('Phase2 denied Forget keeps the recovery screen and explains that access was not removed',async t=>{
  const f=await fixture(t,{resumeHint:{code:'ABCDEF',expiresAt:Date.now()+60000}});
  f.client.forgetSavedAccess=()=>{throw new LiveError('storage_unavailable','Your browser could not remove saved access.');};
  f.click('forget-room');f.click('confirm-accept');await flush();
  assert.ok(f.get('resume-room'));assert.ok(f.root.querySelector('[role=alert]').textContent.includes('could not remove'));
  assert.equal(f.client.calls.clearLocal,0);assert.equal(f.client.calls.actions.length,0);
});
