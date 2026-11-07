import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createNavigationScrollSettler } from '../web/navigation-scroll.mjs';
import { mountLiveApp } from '../web/ui.mjs';

const protocol=JSON.parse(await readFile(new URL('../server/fixtures/protocol-v1.json',import.meta.url),'utf8'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));

// Exercise the public helper against an HTML-root DOM and a deterministic browser
// clock. This models scheduling/scroll contracts, not Safari paint or safe areas.
function browser(t,options={}){
  const dom=new JSDOM('<!doctype html><div id="app"></div><h1 id="heading">Lobby</h1><input id="field">',
    {url:'https://local.invalid/play',pretendToBeVisual:true});
  const win=dom.window,document=win.document,root=document.documentElement;
  let at=0,x=options.x??0,y=options.y??52,range=options.range??193,visibility='visible',sequence=0,rafRegistrations=0;
  const jobs=[],calls=[];
  const subscriptions=[],navigationEvents=new Set(['pointerdown','touchstart','touchmove','wheel','keydown','click','beforeinput','input','focusin','visibilitychange','pagehide']);
  for(const target of [win,document]){
    const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);
    const capture=value=>typeof value==='boolean'?value:!!value?.capture;
    target.addEventListener=(type,listener,options)=>{
      if(navigationEvents.has(type)&&!subscriptions.some(s=>s.target===target&&s.type===type&&s.listener===listener&&s.capture===capture(options)))
        subscriptions.push({target,type,listener,capture:capture(options)});
      return add(type,listener,options);
    };
    target.removeEventListener=(type,listener,options)=>{
      const index=subscriptions.findIndex(s=>s.target===target&&s.type===type&&s.listener===listener&&s.capture===capture(options));
      if(index!==-1)subscriptions.splice(index,1);return remove(type,listener,options);
    };
  }
  Object.defineProperties(win,{scrollY:{get:()=>y},scrollX:{get:()=>x}});
  Object.defineProperty(win.performance,'now',{value:()=>at});
  Object.defineProperties(root,{clientHeight:{get:()=>714},scrollHeight:{get:()=>714+range}});
  Object.defineProperties(document,{scrollingElement:{get:()=>options.nonRoot?document.getElementById('app'):root},
    hidden:{get:()=>visibility==='hidden'},visibilityState:{get:()=>visibility}});
  const schedule=(kind,fn,delay)=>{
    const job={id:++sequence,kind,at:at+delay,fn,cancelled:false,ran:false};jobs.push(job);return job.id;
  };
  const cancel=id=>{const job=jobs.find(job=>job.id===id);if(job)job.cancelled=true;};
  win.setTimeout=(fn,delay)=>{
    if(options.throwTimer===delay)throw new TypeError('Synthetic scheduler registration failure');
    return schedule('timer',fn,delay);
  };
  win.clearTimeout=cancel;
  win.requestAnimationFrame=fn=>{
    if(++rafRegistrations===options.throwRAF)throw new TypeError('Synthetic frame registration failure');
    return schedule('raf',()=>fn(at),16);
  };
  win.cancelAnimationFrame=cancel;
  if(options.noRAF)win.requestAnimationFrame=undefined;
  if(options.noCancelRAF)win.cancelAnimationFrame=undefined;
  win.scrollTo=(value,top)=>{
    const target=typeof value==='object'?value.top:top,left=typeof value==='object'?value.left:value;
    calls.push({at,top:target,left,form:typeof value==='object'?'options':'numeric'});
    if(target===1&&options.throwPositive)throw new TypeError('Synthetic unsupported positive request');
    y=target===0&&options.ignoreZero?y:target===1&&options.ignorePositive?0:target===1&&options.clampPositive!==undefined?options.clampPositive:target;
    x=left;options.onScroll?.(target);
  };
  if(options.noScroll)win.scrollTo=undefined;
  const helper=createNavigationScrollSettler({window:win,document,heading:()=>document.querySelector('main h1')??document.getElementById('heading')});
  t.after(()=>{helper.dispose();dom.window.close();});
  const f={win,document,root,dom,helper,jobs,calls,
    get y(){return y;},get at(){return at;},restore(value,left=0){y=value;x=left;},setRange(value){range=value;},
    jump(value){at=value;},
    advance(target){
      let count=0;
      while(true){
        const job=jobs.filter(j=>!j.cancelled&&!j.ran&&j.at<=target).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
        if(!job)break;assert.ok(++count<100,'Scheduling must remain bounded');job.ran=true;at=job.at;job.fn();
      }
      at=target;
    },
    event(type,target=document){const e=new win.Event(type,{bubbles:true,cancelable:true});target.dispatchEvent(e);return e;},
    hide(){visibility='hidden';document.dispatchEvent(new win.Event('visibilitychange'));},
    show(){visibility='visible';document.dispatchEvent(new win.Event('visibilitychange'));},
    positive:()=>calls.filter(c=>c.top===1),pending:()=>jobs.filter(j=>!j.ran&&!j.cancelled),listeners:()=>subscriptions.length,
  };
  return f;
}

test('Eligible joined lobby holds one actual positive position through the first frame and returns on the second',t=>{
  const f=browser(t);f.helper.start({joinedLobby:true});
  assert.deepEqual(f.calls.map(c=>c.top),[0,1],'Keep the ordinary initial reset, then make one eligible positive attempt');
  assert.equal(f.y,1);f.advance(16);
  assert.equal(f.y,1,'The first frame must retain the actual positive position');
  assert.equal(f.positive().length,1,'Do not repeat the positive move to hold it');
  f.advance(32);assert.equal(f.y,0,'The next guarded frame returns to the original target');
  f.advance(1000);assert.equal(f.positive().length,1);assert.equal(f.pending().length,0);
});

test('Eligibility belongs to each navigation after both skipped and successful joined lobbies',t=>{
  const f=browser(t,{y:0});f.helper.start({joinedLobby:true});f.advance(700);
  assert.equal(f.positive().length,0);
  f.restore(52);f.helper.start({joinedLobby:true});assert.equal(f.positive().length,1);f.advance(1400);
  f.restore(52);f.helper.start({joinedLobby:true});assert.equal(f.positive().length,2);f.advance(2100);
  assert.equal(f.pending().length,0,'No helper-lifetime gate or indefinitely retained navigation');
});

test('Inclusive eligible root bounds support one pixel and the actual maximum prior offset',t=>{
  for(const [y,range] of [[1,1],[193,193]]){
    const f=browser(t,{y,range});f.helper.start({joinedLobby:true});assert.equal(f.y,1);
    f.advance(16);assert.equal(f.y,1);f.advance(32);assert.equal(f.y,0);assert.equal(f.positive().length,1);
  }
});

test('Invalid prior offsets, root ranges, horizontal positions and nonroot scrollers cannot make a positive move',t=>{
  const cases=[
    ['fractional prior',{y:.5}],['zero prior',{y:0}],['negative prior',{y:-1}],['past root bound',{y:194}],
    ['NaN prior',{y:NaN}],['infinite prior',{y:Infinity}],['zero root range',{range:0}],
    ['fractional root range',{range:.5,y:.5}],['negative root range',{range:-1}],['NaN root range',{range:NaN}],['infinite root range',{range:Infinity}],
    ['horizontal prior',{x:1}],['NaN horizontal prior',{x:NaN}],['nonroot scroller',{nonRoot:true}],
  ];
  for(const [name,options] of cases){
    const f=browser(t,options);f.helper.start({joinedLobby:true});f.advance(1000);
    assert.equal(f.positive().length,0,name);assert.equal(f.pending().length,0,name);
  }
});

test('Missing scroll or either animation API safely skips the positive move',t=>{
  for(const options of [{noScroll:true},{noRAF:true},{noCancelRAF:true}]){
    const f=browser(t,options);assert.doesNotThrow(()=>f.helper.start({joinedLobby:true}));f.advance(1000);
    assert.equal(f.positive().length,0);assert.equal(f.pending().length,0);
  }
});

test('Rejected, ignored and clamped positive requests are not retried or held as a real positive frame',t=>{
  for(const options of [{throwPositive:true},{ignorePositive:true},{clampPositive:.5}]){
    const f=browser(t,options);assert.doesNotThrow(()=>f.helper.start({joinedLobby:true}));
    assert.equal(f.positive().length,1);assert.equal(f.positive()[0].form,'options','No numeric positive fallback');
    f.restore(29);f.advance(16);assert.equal(f.y,0,'An unsuccessful positive move retains the ordinary first-frame reset');
    f.advance(1000);assert.equal(f.positive().length,1);assert.equal(f.pending().length,0);
  }
});

test('A scroll API that never reaches the original zero target cannot start a positive move',t=>{
  const f=browser(t,{ignoreZero:true});f.helper.start({joinedLobby:true});f.advance(1000);
  assert.equal(f.y,52);assert.equal(f.positive().length,0);assert.equal(f.pending().length,0);
});

test('Unmarked navigation preserves its original first-frame reset',t=>{
  const f=browser(t);f.helper.start();assert.equal(f.y,0);f.restore(41);
  f.advance(16);assert.equal(f.y,0);assert.equal(f.positive().length,0);
  f.advance(1000);assert.equal(f.pending().length,0);
});

test('User intent after the first held frame cancels the second frame and stale callbacks without preventing input',t=>{
  const f=browser(t);f.helper.start({joinedLobby:true});f.advance(16);assert.equal(f.y,1);
  const queued=f.pending().map(job=>job.fn),event=f.event('wheel');assert.equal(event.defaultPrevented,false);
  f.restore(98);const count=f.calls.length;for(const callback of queued)callback();f.advance(1000);
  assert.equal(f.y,98);assert.equal(f.calls.length,count);assert.equal(f.pending().length,0);
});

test('Focus entering a field after the held frame cancels automatic return',t=>{
  const f=browser(t);f.helper.start({joinedLobby:true});f.advance(16);
  f.document.getElementById('field').focus();assert.equal(f.document.activeElement.id,'field');
  f.restore(124);const count=f.calls.length;f.advance(1000);
  assert.equal(f.y,124);assert.equal(f.calls.length,count);
});

test('Background and disposal after the held frame reject already queued second-frame callbacks',t=>{
  for(const reason of ['visibility','pagehide','dispose']){
    const f=browser(t);f.helper.start({joinedLobby:true});f.advance(16);
    const queued=f.pending().map(job=>job.fn);
    if(reason==='visibility'){f.hide();f.show();}else if(reason==='pagehide')f.event('pagehide',f.win);else f.helper.dispose();
    f.restore(83);const count=f.calls.length;for(const callback of queued)callback();f.advance(1000);
    assert.equal(f.y,83,reason);assert.equal(f.calls.length,count,reason);assert.equal(f.pending().length,0,reason);
  }
});

test('New navigation invalidates an old second frame without cancelling the new plan',t=>{
  const f=browser(t);f.helper.start({joinedLobby:true});f.advance(16);
  const old=f.pending().map(job=>job.fn);f.helper.start();f.restore(76);const count=f.calls.length;
  for(const callback of old)callback();assert.equal(f.y,76);assert.equal(f.calls.length,count);
  f.advance(32);assert.equal(f.y,0,'The current ordinary navigation still owns its frame');
});

test('A second frame delivered at the absolute600ms deadline cannot move the viewport',t=>{
  const f=browser(t);f.helper.start({joinedLobby:true});f.advance(16);
  const second=f.pending().find(job=>job.kind==='raf');assert.ok(second);
  f.jump(600);f.restore(86);const count=f.calls.length;second.ran=true;second.fn();
  assert.equal(f.y,86);assert.equal(f.calls.length,count);assert.equal(f.pending().length,0);
});

test('The100ms reset can preempt a background-throttled frame without another positive attempt',t=>{
  const f=browser(t);f.helper.start({joinedLobby:true});
  const delayed=f.pending().find(job=>job.kind==='raf');delayed.ran=true;
  f.advance(100);assert.equal(f.y,0,'Existing timers still correct the viewport when RAF is delayed');
  delayed.fn();f.advance(700);assert.equal(f.y,0);assert.equal(f.positive().length,1);assert.equal(f.pending().length,0);
});

test('Existing300/500ms corrections and the finite600ms end survive the new two-frame path',t=>{
  const f=browser(t);f.helper.start({joinedLobby:true});f.advance(250);f.restore(52);
  f.advance(300);assert.equal(f.y,0);f.advance(450);f.restore(52);f.advance(500);assert.equal(f.y,0);
  f.advance(600);f.restore(109);const count=f.calls.length;f.advance(2000);
  assert.equal(f.y,109);assert.equal(f.calls.length,count);assert.equal(f.pending().length,0);
});

test('Intent during the ordinary initial reset prevents any positive attempt',t=>{
  const options={};const f=browser(t,options);options.onScroll=top=>{if(top===0)f.event('pointerdown');};
  f.helper.start({joinedLobby:true});assert.deepEqual(f.calls.map(c=>c.top),[0]);assert.equal(f.pending().length,0);
});

test('Animation scheduling failures do not escape navigation or leave callbacks that outlive the deadline',t=>{
  for(const throwRAF of [1,2]){
    const f=browser(t,{throwRAF});assert.doesNotThrow(()=>f.helper.start({joinedLobby:true}));
    assert.doesNotThrow(()=>f.advance(700));const callbacks=f.jobs.map(job=>job.fn);f.restore(93);const count=f.calls.length;
    for(const callback of callbacks)callback();assert.equal(f.y,93);assert.equal(f.calls.length,count);assert.equal(f.pending().length,0);assert.equal(f.listeners(),0);
  }
});

test('Timer registration failure does not escape navigation and leaves no active automatic movement',t=>{
  for(const throwTimer of [100,300]){
    const f=browser(t,{throwTimer});assert.doesNotThrow(()=>f.helper.start({joinedLobby:true}));
    assert.equal(f.pending().length,0,'Cancel frames and any already registered timer after setup failure');assert.equal(f.listeners(),0);
    f.advance(700);f.restore(92);const count=f.calls.length;for(const job of f.jobs)job.fn();
    assert.equal(f.y,92);assert.equal(f.calls.length,count);assert.equal(f.pending().length,0);assert.equal(f.listeners(),0);
  }
});

async function ui(t){
  const f=browser(t),root=f.document.getElementById('app');
  const client={state:null,status:'idle',persisted:true,pendingAction:null,resumeHint:null,pendingAdmissionHint:null,
    onState(){},onStatus(){},onError(){},catalogue:async()=>({topics:[]}),dispose(){},
    emit(name,changes={}){this.state={...structuredClone(protocol.states[name]),...changes};this.onState(this.state);},
    connection(status){this.status=status;this.onStatus(status);}};
  const app=mountLiveApp({root,client,window:f.win});await flush();t.after(()=>app.dispose());
  return {...f,root,client,app};
}

test('Actual UI opts in only changed player lobbies while retaining heading focus across status rerenders',async t=>{
  const f=await ui(t);f.advance(700);f.restore(52);f.client.emit('lobbyPlayer');
  assert.equal(f.positive().length,1);assert.equal(f.win.scrollY,1);assert.equal(f.document.activeElement,f.root.querySelector('h1'));
  f.advance(716);f.client.connection('connected');assert.equal(f.document.activeElement,f.root.querySelector('h1'));
  assert.equal(f.win.scrollY,1,'Same-screen heading replacement must preserve the first held frame');
  f.advance(732);assert.equal(f.win.scrollY,0);f.advance(1400);const count=f.calls.length;
  f.restore(81);f.client.connection('reconnecting');f.app.render();f.advance(2000);
  assert.equal(f.win.scrollY,81);assert.equal(f.calls.length,count,'Same-screen renders cannot restart a plan');
  f.restore(52);f.client.emit('lobbyPlayer',{code:'BCD234',matchId:'3561c1a3-1e39-4b6d-bc38-3bc69e2c7bf3'});
  assert.equal(f.positive().length,2,'A distinct joined room gets its own eligible navigation');
  assert.equal(f.document.activeElement,f.root.querySelector('h1'));f.advance(2032);assert.equal(f.win.scrollY,0);
});

test('Actual host, player-round and join-form navigations retain ordinary first-frame behavior',async t=>{
  const f=await ui(t);f.advance(700);f.restore(52);f.root.querySelector('#choose-join').click();
  f.restore(47);f.advance(716);assert.equal(f.win.scrollY,0);assert.equal(f.positive().length,0);
  for(const [at,name] of [[1400,'lobbyHost'],[2100,'answerSubject'],[2800,'predictGuest'],[3500,'revealHost']]){
    f.advance(at);f.restore(52);f.client.emit(name);assert.equal(f.document.activeElement,f.root.querySelector('h1'));
    f.restore(47);f.advance(at+16);assert.equal(f.win.scrollY,0,name);assert.equal(f.positive().length,0,name);
  }
});

test('Actual UI can use a second joined room after its first room was ineligible',async t=>{
  const f=await ui(t);f.advance(700);f.restore(.5);f.client.emit('lobbyPlayer');f.advance(1400);assert.equal(f.positive().length,0);
  f.restore(52);f.client.emit('lobbyPlayer',{code:'BCD234',matchId:'3561c1a3-1e39-4b6d-bc38-3bc69e2c7bf3'});
  assert.equal(f.positive().length,1);assert.equal(f.document.activeElement,f.root.querySelector('h1'));
});
