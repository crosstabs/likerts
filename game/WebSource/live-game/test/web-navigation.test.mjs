import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { mountLiveApp } from '../web/ui.mjs';

const protocol=JSON.parse(await readFile(new URL('../server/fixtures/protocol-v1.json',import.meta.url),'utf8'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t){
  const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://local.invalid/play',pretendToBeVisual:true});
  const win=dom.window,document=win.document,root=document.getElementById('app');
  let at=0,y=0,sequence=0,visibility='visible';
  const jobs=new Map(),calls=[];
  Object.defineProperty(win.performance,'now',{value:()=>at});
  Object.defineProperty(win,'scrollY',{get:()=>y});Object.defineProperty(win,'scrollX',{get:()=>0});
  Object.defineProperty(document,'visibilityState',{get:()=>visibility});
  Object.defineProperty(document,'hidden',{get:()=>visibility==='hidden'});
  win.scrollTo=(options,top)=>{y=typeof options==='object'?options.top:top;calls.push({at,y});};
  const schedule=(fn,delay=0)=>{const id=++sequence;jobs.set(id,{id,at:at+delay,fn,cancelled:false});return id;};
  win.setTimeout=schedule;win.clearTimeout=id=>{const job=jobs.get(id);if(job)job.cancelled=true;};
  win.requestAnimationFrame=fn=>schedule(()=>fn(at),16);win.cancelAnimationFrame=win.clearTimeout;
  const client={state:null,status:'idle',persisted:true,pendingAction:null,resumeHint:null,pendingAdmissionHint:null,
    onState(){},onStatus(){},onError(){},catalogue:async()=>({topics:[]}),dispose(){},
    emit(name){this.state=structuredClone(protocol.states[name]);this.onState(this.state);},
    connection(status){this.status=status;this.onStatus(status);}};
  const app=mountLiveApp({root,client,window:win});await flush();
  function advance(target){
    while(true){const job=[...jobs.values()].filter(j=>!j.cancelled&&j.at<=target).sort((a,b)=>a.at-b.at||a.id-b.id)[0];if(!job)break;jobs.delete(job.id);at=job.at;job.fn();}
    at=target;
  }
  const input=type=>document.dispatchEvent(new win.Event(type,{bubbles:true}));
  t.after(()=>{app.dispose();dom.window.close();});
  return{win,document,root,app,client,jobs,calls,advance,input,
    nativeRestore(value){y=value;win.dispatchEvent(new win.Event('scroll'));},get y(){return y;},
    jump(target){at=target;},
    hide(){visibility='hidden';document.dispatchEvent(new win.Event('visibilitychange'));},
    show(){visibility='visible';document.dispatchEvent(new win.Event('visibilitychange'));}};
}

test('New-screen navigation corrects the observed Safari restoration at250ms within a finite window',async t=>{
  const f=await fixture(t);f.advance(700);f.nativeRestore(52);f.client.emit('lobbyPlayer');
  assert.equal(f.y,0,'The app performs its initial new-screen reset');
  f.advance(950);f.nativeRestore(52); // Actual Safari: call and RAF reached0,250ms later offset returned.
  f.advance(1001);assert.equal(f.y,0,'Deferred native restoration must be corrected after250ms');
  f.advance(1400);const count=f.calls.length;f.nativeRestore(88);f.advance(3000);
  assert.equal(f.y,88,'Settling must stop; it must not fight later scrolling');assert.equal(f.calls.length,count);
  assert.equal([...f.jobs.values()].filter(job=>!job.cancelled).length,0);
});

test('Same-screen heading replacement does not invalidate or extend the current navigation window',async t=>{
  const f=await fixture(t);f.advance(700);f.client.emit('lobbyPlayer');
  f.advance(900);f.client.connection('connected');
  assert.equal(f.document.activeElement,f.root.querySelector('h1'));
  f.advance(950);f.nativeRestore(52);f.advance(1001);assert.equal(f.y,0);
  f.advance(1290);f.client.connection('reconnecting');
  f.advance(1400);const count=f.calls.length;f.nativeRestore(91);f.advance(3000);
  assert.equal(f.y,91,'Metadata updates must not start another settling window');assert.equal(f.calls.length,count);
});

for(const event of ['pointerdown','touchstart','touchmove','wheel','keydown','click','beforeinput','input']){
  test('User '+event+' immediately cancels automatic settling without preventing the event',async t=>{
    const f=await fixture(t);f.advance(700);f.client.emit('lobbyPlayer');f.advance(800);
    const e=new f.win.Event(event,{bubbles:true,cancelable:true});f.document.dispatchEvent(e);
    assert.equal(e.defaultPrevented,false);const count=f.calls.length;
    f.nativeRestore(160);f.client.connection('connected');f.advance(2000);
    assert.equal(f.y,160);assert.equal(f.calls.length,count,'Same-screen rerender must not restart cancelled settling');
  });
}

test('A callback already queued for an older navigation cannot move the new screen',async t=>{
  const f=await fixture(t);const old=[...f.jobs.values()].map(j=>j.fn);
  f.advance(50);f.root.querySelector('#choose-join').click();const count=f.calls.length;
  f.nativeRestore(77);for(const callback of old)callback();
  assert.equal(f.y,77);assert.equal(f.calls.length,count);
});

test('Disposal cancels pending navigation callbacks including an already queued callback',async t=>{
  const f=await fixture(t);f.client.emit('lobbyPlayer');const pending=[...f.jobs.values()].map(j=>j.fn);
  f.app.dispose();const count=f.calls.length;f.nativeRestore(130);
  for(const callback of pending)callback();f.advance(2000);
  assert.equal(f.y,130);assert.equal(f.calls.length,count);
});

for(const reason of ['hidden','pagehide']){
  test('Backgrounding via '+reason+' cancels settling and visibility return does not restart it',async t=>{
    const f=await fixture(t);f.client.emit('lobbyPlayer');
    if(reason==='hidden')f.hide();else f.win.dispatchEvent(new f.win.Event('pagehide'));
    const count=f.calls.length;f.nativeRestore(120);f.show();f.advance(2000);
    assert.equal(f.y,120);assert.equal(f.calls.length,count);
  });
}

test('Same-screen form updates retain typing focus, selection and the user scroll position',async t=>{
  const f=await fixture(t);f.root.querySelector('#choose-join').click();f.advance(700);
  const field=f.root.querySelector('#nickname');field.value='Ari June';field.dispatchEvent(new f.win.Event('input',{bubbles:true}));field.focus();field.setSelectionRange(2,5);
  f.nativeRestore(240);const count=f.calls.length;f.client.connection('reconnecting');f.advance(2000);
  assert.equal(f.y,240);assert.equal(f.calls.length,count);assert.equal(f.document.activeElement.id,'nickname');
  assert.equal(f.document.activeElement.value,'Ari June');assert.equal(f.document.activeElement.selectionStart,2);assert.equal(f.document.activeElement.selectionEnd,5);
});

test('Focus entering an editable field cancels an active plan without waiting for a key or pointer event',async t=>{
  const f=await fixture(t);f.root.querySelector('#choose-join').click();f.advance(100);
  f.root.querySelector('#nickname').focus();const count=f.calls.length;f.nativeRestore(170);
  f.client.connection('connected');f.advance(2000);
  assert.equal(f.y,170);assert.equal(f.calls.length,count);assert.equal(f.document.activeElement.id,'nickname');
});

test('A throttled timer delivered after its absolute deadline cannot reset the viewport',async t=>{
  const f=await fixture(t);f.advance(700);f.client.emit('lobbyPlayer');
  const pending=[...f.jobs.values()].filter(j=>!j.cancelled).map(j=>j.fn),count=f.calls.length;
  f.jump(2000);f.nativeRestore(190);for(const callback of pending)callback();
  assert.equal(f.y,190);assert.equal(f.calls.length,count);
});

test('An options-rejecting scroll API falls back to numeric coordinates without interrupting rendering',async t=>{
  const f=await fixture(t),native=f.win.scrollTo;let options=0;
  f.win.scrollTo=(value,top)=>{if(typeof value==='object'){options++;throw new TypeError('Synthetic unsupported options');}return native(value,top);};
  f.nativeRestore(52);f.client.emit('lobbyPlayer');
  assert.equal(f.y,0);assert.equal(options,1);assert.equal(f.document.activeElement,f.root.querySelector('h1'));
  assert.match(f.app.model.previousScreen,/^lobby:/);
});
