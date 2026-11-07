import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { mountLiveApp } from '../web/ui.mjs';

const protocol=JSON.parse(await readFile(new URL('../server/fixtures/protocol-v1.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(protocol.states.finishedHost);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t,initial=fresh()){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://local.invalid/play'});
  dom.window.scrollTo=()=>{};let storageWrites=0;
  dom.window.Storage.prototype.setItem=()=>{storageWrites++;};
  const root=dom.window.document.getElementById('app');
  const client={state:structuredClone(initial),status:'connected',persisted:true,pendingAction:null,resumeHint:null,pendingAdmissionHint:null,
    onState(){},onStatus(){},onError(){},catalogue:async()=>({topics:[]}),dispose(){},
    emit(value){this.state=structuredClone(value);this.onState(this.state);}};
  const app=mountLiveApp({root,client,window:dom.window});await flush();
  t.after(()=>{app.dispose();dom.window.close();});
  const row=name=>[...root.querySelectorAll('.leader-row')].find(node=>node.querySelector('.score-name strong')?.textContent===name);
  return{root,client,app,row,get storageWrites(){return storageWrites;}};
}
function departed(state,name='Bo'){
  const next=structuredClone(state);next.players=next.players.filter(player=>player.nickname!==name);next.revision++;return next;
}
function assertNeutral(row){
  assert.ok(row,'Expected the retained score row');
  const placeholder=row.querySelector('.avatar-neutral');assert.ok(placeholder,'Unknown identity needs a neutral placeholder');
  assert.equal(placeholder.getAttribute('aria-hidden'),'true');assert.equal(placeholder.querySelector('img'),null);
  assert.equal(row.querySelector('.clay'),null,'Do not invent a default totem');
}

test('A departed player retains their known nondefault avatar and exact name, score, rank and predictions',async t=>{
  const f=await fixture(t),before=f.client.state,entry=structuredClone(before.leaderboard.find(row=>row.nickname==='Bo'));
  f.client.emit(before);const rowText=f.row('Bo').textContent;
  f.client.emit(departed(before));const row=f.row('Bo');
  assert.match(row.querySelector('img').getAttribute('src'),/totem-2\.png$/);
  assert.equal(row.textContent,rowText);assert.equal(row.querySelector('.rank').getAttribute('aria-label'),'Rank 1');
  assert.equal(row.querySelector('.accuracy').textContent,'100.0%');assert.equal(row.querySelector('.score-name strong').textContent,'Bo');
  assert.deepEqual(f.client.state.leaderboard.find(row=>row.nickname==='Bo'),entry);
  assert.equal(f.storageWrites,0,'Remember public artwork only in this mounted view');
});

test('An already populated state seeds avatar identity before the first later server update',async t=>{
  const f=await fixture(t); // No onState call has seeded this mounted view.
  f.client.emit(departed(f.client.state));
  assert.match(f.row('Bo').querySelector('img').getAttribute('src'),/totem-2\.png$/);
});

test('A fresh or reloaded view with an unknown departed avatar shows a neutral decorative placeholder',async t=>{
  const snapshot=departed(fresh()),first=await fixture(t,snapshot),reloaded=await fixture(t,snapshot);
  for(const f of [first,reloaded]){
    assertNeutral(f.row('Bo'));assert.equal(f.row('Bo').querySelector('.score-name strong').textContent,'Bo');
    assert.equal(f.row('Bo').querySelector('.accuracy').textContent,'100.0%');
    assert.ok(!/left|removed|disconnected/i.test(f.row('Bo').textContent),'Do not infer a departure reason');
    assert.equal(f.storageWrites,0);
  }
});

for(const change of ['code','match','null']){
  test('Avatar memory does not cross a '+change+' boundary',async t=>{
    const f=await fixture(t),next=departed(f.client.state);f.client.emit(f.client.state);
    if(change==='code')next.code='BCDEFG';
    if(change==='match')next.matchId=randomUUID();
    if(change==='null')f.client.emit(null);
    f.client.emit(next);assertNeutral(f.row('Bo'));
  });
}

test('The current roster wins over a previously remembered avatar and updates the remembered identity',async t=>{
  const f=await fixture(t);f.client.emit(f.client.state);
  const changed=structuredClone(f.client.state);changed.players.find(player=>player.nickname==='Bo').avatar=5;changed.revision++;
  f.client.emit(changed);assert.match(f.row('Bo').querySelector('img').getAttribute('src'),/totem-5\.png$/);
  f.client.emit(departed(changed));assert.match(f.row('Bo').querySelector('img').getAttribute('src'),/totem-5\.png$/);
});

test('Roster churn prunes identities no longer on the current bounded leaderboard',async t=>{
  const f=await fixture(t),old=structuredClone(f.client.state.leaderboard.find(row=>row.nickname==='Bo'));
  f.client.emit(f.client.state);
  for(let turn=0;turn<8;turn++){
    const next=structuredClone(f.client.state);next.revision++;
    next.players=Array.from({length:50},(_,index)=>({id:randomUUID(),nickname:'Guest'+turn+'-'+index,avatar:index%5+1,connected:true}));
    next.leaderboard=next.players.map((player,index)=>({playerId:player.id,nickname:player.nickname,points:100,opportunities:1,accuracy:100,rank:index+1}));
    f.client.emit(next);assert.equal(f.root.querySelectorAll('.leader-row').length,50);
  }
  const next=structuredClone(f.client.state);next.revision++;next.leaderboard=[old];f.client.emit(next);
  assertNeutral(f.row('Bo'));assert.equal(f.storageWrites,0);
});
