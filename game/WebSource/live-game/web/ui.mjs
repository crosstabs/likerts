import { LiveError, normalizeCode } from './client.mjs';
import { createNavigationScrollSettler } from './navigation-scroll.mjs';
import { totem } from './art.mjs';
import { quizLiveView } from './quiz-live-ui.mjs';
import { createQuizMotionController } from './quiz-motion.mjs';
import { partyGuide, guideScene } from './quiz-scene.mjs';
const labels = ['Not me','A little','Depends','Mostly me','So me'];
const topicNames = {mix:'A bit of everything'};
const crop = [[184,138,913,985],[210,210,826,902],[270,122,756,1025],[344,73,598,1105],[128,161,1008,963]];
const roundLabel = r => r ? 'Round '+r.index+' of '+r.total : '';
const percent = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('en',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n)+'%';

export function mountLiveApp({root,client,window:win = globalThis.window,navigate = path => win.location.assign(path),entryIntent = null} = {}) {
  const document = root.ownerDocument;
  const motion = createQuizMotionController({window:win});
  const model = {entry:'landing',name:'',code:'',consent:false,selection:null,busy:false,error:'',
    toast:'',topics:[],maximumPlayers:12,catalogueReady:false,catalogueError:'',settings:{topic:'mix',cycles:1,capacity:12,answerSeconds:60,predictSeconds:60},
    confirm:null,clockOffset:client.state?client.state.serverTime-Date.now():0,previousScreen:'',focusAfter:null,deadlineExpired:false,
    lastRound:client.state?.round?.id,lastMatch:client.state?.matchId,lastPhase:client.state?.phase};
  let disposed = false,operation=null,catalogueGeneration=0,chooseQuizIntent=null,closedQuizCleanup=false;
  const navigationScroll=createNavigationScrollSettler({window:win,document,heading:()=>root.querySelector('main h1')});
  const publicAvatars=new Map();let avatarScope=null;
  function rememberPublicAvatars(state) {
    if(!state){publicAvatars.clear();avatarScope=null;return;}
    if(avatarScope?.code!==state.code||avatarScope?.matchId!==state.matchId){
      publicAvatars.clear();avatarScope={code:state.code,matchId:state.matchId};
    }
    // Keep only this projection's bounded scoreboard identities, never a
    // history of room visitors. No answers, names or credentials are retained.
    const ids=new Set(state.leaderboard.slice(0,50).map(row=>row.playerId));
    for(const id of publicAvatars.keys())if(!ids.has(id))publicAvatars.delete(id);
    for(const player of state.players)if(ids.has(player.id)){
      if(Number.isInteger(player.avatar)&&player.avatar>=1&&player.avatar<=5)publicAvatars.set(player.id,player.avatar);
      else publicAvatars.delete(player.id);
    }
  }
  rememberPublicAvatars(client.state);
  try { const code = new URL(win.location.href).searchParams.get('room'); if (code) { model.entry='join'; model.code=normalizeCode(code); }
    else if (entryIntent==='join'&&!client.state&&!client.resumeHint&&!client.pendingAdmissionHint) model.entry='join'; }
  catch (error) { model.entry='join'; model.error=error.message; }
  function el(tag,attrs = {},...children) {
    const node=document.createElement(tag);
    for (const [key,value] of Object.entries(attrs)) {
      if (value === null || value === undefined || (value === false && !key.startsWith('aria-'))) continue;
      if (key === 'class') node.className=value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2),value);
      else if (key === 'checked' || key === 'disabled' || key === 'value') node[key]=value;
      else node.setAttribute(key,key.startsWith('aria-') ? String(value) : value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child !== null && child !== undefined && child !== false) node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  const text=(value,className='')=>el('p',{class:className},value);
  const button=(title,action,{className='button',id,disabled=false,allowPending=false,...attrs}={})=>el('button',{type:'button',class:className,id,disabled:model.busy||disabled||(!allowPending&&!!client.pendingAction),onclick:action,...attrs},title);
  function arrow() {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('arrow');
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M4 12h15m-6-6 6 6-6 6');
    path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','2');
    path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg;
  }
  function clay(value,className='') {
    return totem(el,value,className);
  }
  function cast() { return el('div',{class:'cast','aria-hidden':'true'},[1,2,3,4,5].map(i=>clay(i))); }
  function standingsAvatar(state,id) {
    const current=state.players.find(player=>player.id===id);
    const value=current?current.avatar:publicAvatars.get(id);
    if(Number.isInteger(value)&&value>=1&&value<=5)return clay(value,'avatar');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 56 64');svg.setAttribute('width','100%');svg.setAttribute('height','100%');svg.setAttribute('focusable','false');
    const circle=document.createElementNS(svg.namespaceURI,'circle');
    for(const [key,value] of Object.entries({cx:28,cy:22,r:9,fill:'none',stroke:'currentColor','stroke-width':2}))circle.setAttribute(key,value);
    const shoulders=document.createElementNS(svg.namespaceURI,'path');
    shoulders.setAttribute('d','M10 56c0-10 8-17 18-17s18 7 18 17');shoulders.setAttribute('fill','none');shoulders.setAttribute('stroke','currentColor');shoulders.setAttribute('stroke-width','2');
    svg.append(circle,shoulders);
    return el('span',{class:'art-shell avatar avatar-neutral','aria-hidden':'true'},svg);
  }
  function fail(error) { model.error=error instanceof Error ? error.message : 'Something interrupted the room. Try again.';render(); }
  async function run(fn) {
    if (model.busy) return {ok:false};
    const owner={match:client.state?.matchId,round:client.state?.round?.id,phase:client.state?.phase};operation=owner;
    model.busy=true;model.error='';model.toast='';render();
    try { return {ok:true,value:await fn()}; } catch(error) { if(operation===owner&&!disposed)model.error=error instanceof Error?error.message:'The room could not confirm that request.'; return {ok:false,error}; }
    finally { if(operation===owner){operation=null;model.busy=false;}if(!disposed)render(); }
  }
  const act=(action,values={})=>{
    const room=client.state;
    if(action==='lock'&&values.locked===false&&room?.joinLocked){
      confirm('Unlock this room?','Anyone with the code can join an unlocked lobby, including someone you removed.','Unlock room',()=>{
        if(client.state?.code!==room.code||client.state?.matchId!==room.matchId||client.state?.phase!=='lobby'||client.state?.role!=='host'||!client.state.joinLocked){
          model.error='The room changed. Check its lock before unlocking.';render();return;
        }
        return run(()=>client.action(action,values));
      });
      return;
    }
    return run(()=>client.action(action,values));
  };
  function confirm(title,body,label,action) { model.confirm={title,body,label,action,openerId:document.activeElement?.id};render(); }
  function dismissConfirmation() { chooseQuizIntent=null;model.focusAfter=model.confirm?.openerId;model.confirm=null;render(); }
  function chooseAnotherQuiz() {
    const room=client.state;
    const eligible=state=>state?.protocolVersion===2&&state.role==='host'&&state.phase==='finished';
    if(!eligible(room))return;
    confirm('Choose another quiz?','This closes the current room. Everyone will rejoin your new quiz with a new code.','Close room and choose quiz',async()=>{
      const current=client.state;
      if(!eligible(current)||current.code!==room.code||current.matchId!==room.matchId||client.pendingAction||client.busy){
        fail(new Error('The room changed. Check the current room before choosing another quiz.'));return;
      }
      let intent;
      const outcome=await run(()=>{
        intent={code:room.code,matchId:room.matchId,requestId:null};chooseQuizIntent=intent;
        const closing=client.action('close',{}, {terminalReceipt:true});
        intent.requestId=client.pendingAction?.requestId;
        render();
        return closing;
      });
      if(disposed||!intent||chooseQuizIntent!==intent)return;
      chooseQuizIntent=null;
      if(!outcome.ok){if(outcome.error)fail(outcome.error);return;}
      const receipt=outcome.value;
      if(receipt?.closed!==true||receipt.action!=='close'||receipt.code!==intent.code||receipt.matchId!==intent.matchId||!intent.requestId||receipt.requestId!==intent.requestId){
        fail(new Error('The room could not confirm closing. Check your room access before choosing another quiz.'));return;
      }
      if(!receipt.accessCleared||client.state||client.credential||client.pendingAction||client.pendingAdmission||client.pendingAdmissionHint||client.resumeHint){
        closedQuizCleanup=!client.state&&!client.credential&&!client.pendingAction;
        fail(new Error('The room closed, but this tab could not remove saved access. Use this tab’s access controls or your browser’s site-data controls before choosing another quiz.'));return;
      }
      navigate('/play/quizzes');
    });
  }
  function confirmExit() {
    const state=client.state;
    if (!state) return;
    if(state.role==='host') confirm(state.protocolVersion===2?'Close this quiz room?':'End this room?','Everyone will be disconnected. Start a new room when you want to play again.',state.protocolVersion===2?'Close room':'End room',()=>act('close'));
    else confirm('Leave this room?',state.phase==='lobby'||state.phase==='finished'
      ?'Your place in this room will be removed.':'Leaving ends this match as incomplete for everyone. You can play again with a new roster.',
      'Leave room',()=>act('leave'));
  }
  function header(state) {
    const status={idle:'',connecting:'Connecting…',connected:'Connected',syncing:'Connected · syncing',reconnecting:'Reconnecting…',offline:'Connection interrupted'}[client.status]??'Connecting…';
    return el('header',{class:'topbar'},
      el('div',{class:'wordmark','aria-label':'Likerts'},'likerts',el('span',{class:'brand-dot','aria-hidden':'true'},'.')),
      !state&&!client.resumeHint&&!client.pendingAdmissionHint&&el('nav',{class:'entry-mode-nav','aria-label':'Game pages'},
        el('a',{href:'/play/quizzes'},'Quizzes'),
        el('a',{href:'https://likerts.com/game/support',class:'entry-support'},'Support')),
      el('div',{class:'header-actions'},state?.protocolVersion===2&&el('span',{class:'room-code-mini','aria-label':'Room code '+state.code},state.code),
        status&&el('span',{class:'connection '+(['connected','syncing'].includes(client.status)?'is-connected':''),title:status,
        role:'status','aria-live':'polite'},el('span',{class:'connection-dot','aria-hidden':'true'}),el('span',{class:'connection-label'},status)),
        state&&button(state.role==='host'?(state.protocolVersion===2?'Close room':'End room'):'Leave room',confirmExit,{className:'button quiet',id:'room-exit'})));
  }
  function errorBlock() {
    if(chooseQuizIntent)return el('div',{class:'message',role:'status','aria-live':'polite'},
      text('The room may still close. Stay here instead of opening Quizzes.'),
      el('button',{type:'button',class:'text-button',id:'stay-after-quiz-close',onclick:()=>{
        chooseQuizIntent=null;model.toast='This tab will stay here. The room may still close.';render();
      }},'Stay here'));
    if(!model.error&&!client.pendingAction)return null;
    const inFlight=!!client.pendingAction&&(model.busy||client.busy);
    if(!model.error&&inFlight)return el('div',{class:'message',role:'status','aria-live':'polite'},text('Confirming…'));
    return el('div',{class:'message error',role:'alert'},text(model.error||'Confirm your previous request to keep playing.'),
      closedQuizCleanup&&!client.state&&!client.credential&&!client.pendingAction&&button('Clear saved access',()=>run(()=>{
        client.forgetSavedAccess();closedQuizCleanup=false;
      }),{className:'text-button',id:'clear-closed-quiz-access'}),
      client.pendingAction&&!inFlight&&button('Retry last request',()=>client.pendingAction?.action==='choose-avatar'&&client.state?.phase==='lobby'
        ?characterRequest(client.state,'retry-action',()=>client.retryAction()):run(()=>client.retryAction()),{className:'text-button',id:'retry-action',allowPending:true}),
      !client.pendingAction&&client.state&&button('Reconnect',()=>run(()=>client.refresh()),{className:'text-button',id:'retry-connection'}));
  }
  function privacy() {
    return el('details',{class:'privacy'},el('summary',{},'A little about live-room privacy'),
      text('Live rooms send your nickname, answers and guesses to the game server. Your locked answer stays hidden from other players until reveal; then everyone in the room can see that round.'),
      text('Anyone with the code can join an unlocked lobby. The host can remove players and lock the room. Use a nickname and share only what you are comfortable revealing.'),
      text('Your private reconnect credential stays on this tab. Room data is temporary; closing a room removes its active state. Local and Messages games in the iPhone app are separate.'),
      el('a',{href:'https://likerts.com/game/support',rel:'noreferrer'},'Game support'));
  }
  function formField(label,id,input,note) {
    return el('div',{class:'field'},el('label',{for:id},label),input,note&&text(note,'field-note'));
  }
  function pendingAdmission() {
    const pending=client.pendingAdmissionHint;
    return pending&&el('section',{class:'message recovery'},
      el('h2',{},'Let’s confirm your place.'),
      text('The connection interrupted your room request. Recover it before trying another room.'),
      button('Recover room request',()=>run(()=>client.recoverAdmission()),{id:'recover-admission'}));
  }
  function savedRoom() {
    const saved=client.resumeHint;
    return el('main',{id:'main',tabindex:'-1',class:'entry single recovery-screen'},
      el('h1',{},'Your place is saved.'),
      text('Room '+saved.code+' is saved on this tab.','lede'),
      text('Resume before starting another room. You can leave or close the room from there.','small'),
      errorBlock(),pendingAdmission(),
      button('Resume room',()=>run(()=>client.resume()),{className:'button full',id:'resume-room'}),
      button('Forget this tab’s access',()=>confirm('Forget saved room access?',
        'This removes your reconnect access from this tab. It does not leave a remote seat or close a room. Resume first if you want to leave or close it.',
        'Forget access',()=>run(()=>{client.forgetSavedAccess();closedQuizCleanup=false;})),{className:'text-button',id:'forget-room'}),privacy());
  }
  function landing() {
    const resume=client.resumeHint;
    return el('main',{id:'main',tabindex:'-1',class:'entry landing'},
      el('div',{class:'entry-copy'},el('h1',{},'Your people. ',el('br'),'Your wavelength.'),
        text('Host a mind-reading game. Send a code. Find out who gets you.','lede'),
        el('div',{class:'entry-actions'},
          button(['Join a room',arrow()],()=>{model.entry='join';model.error='';render();},{className:'button lime',id:'choose-join'}),
          button('Host mind-reading',()=>{model.entry='host';model.error='';render();},{className:'button outlined',id:'choose-host'})),
        text('2–'+model.maximumPlayers+' friends. A browser is all they need.','small'),
        el('p',{class:'small'},el('a',{href:'/play/quizzes',id:'open-quiz-library',class:'text-button quiz-library-link'},'Make and practice your own quizzes')),
        resume&&el('div',{class:'resume'},text('Room '+resume.code+' is saved on this tab.'),
          button('Resume room',()=>run(()=>client.resume()),{className:'text-button',id:'resume-room'})),
        pendingAdmission(),errorBlock(),privacy()),
      el('div',{class:'entry-art'},cast()));
  }
  function joinForm() {
    return el('main',{id:'main',tabindex:'-1',class:'entry single room-join'},
      button('Back',()=>{model.entry='landing';model.error='';render();},{className:'text-button back',id:'entry-back'}),
      el('div',{class:'join-welcome'},el('div',{},el('h1',{},'Join your people.'),text('A code. A name. A quiz or a little mind-reading.','lede')),
        el('div',{class:'join-character','aria-hidden':'true'},clay(3))),
      pendingAdmission(),errorBlock(),
      el('form',{onsubmit:e=>{e.preventDefault();void run(()=>client.join(model.code,model.name,model.consent));}},
        formField('Room code','room-code',el('input',{id:'room-code',name:'room-code',value:model.code,required:true,maxlength:16,disabled:model.busy||!!client.pendingAdmissionHint,
          autocomplete:'off',autocapitalize:'characters',spellcheck:'false',class:'code-input',
          oninput:e=>{model.code=e.target.value;}}),'Six characters from your host.'),
        formField('Your name','nickname',el('input',{id:'nickname',name:'nickname',value:model.name,required:true,maxlength:20,disabled:model.busy||!!client.pendingAdmissionHint,
          autocomplete:'nickname',oninput:e=>{model.name=e.target.value;}}),'A nickname is perfect.'),
        el('label',{class:'check-row',for:'room-sharing'},
          el('input',{type:'checkbox',id:'room-sharing',checked:model.consent,required:true,disabled:model.busy||!!client.pendingAdmissionHint,onchange:e=>{model.consent=e.target.checked;}}),
          el('span',{},'I’m happy to share my nickname and revealed rounds with this room.')),
        el('button',{type:'submit',id:'join-room',class:'button full',disabled:model.busy||!!client.pendingAdmissionHint},
          model.busy?'Joining…':'Join room')),
      privacy());
  }
  function select(label,id,items,value,onchange) {
    return formField(label,id,el('select',{id,value,disabled:model.busy||!!client.pendingAdmissionHint,onchange:e=>onchange(e.target.value)},items.map(([key,title])=>el('option',{value:key,selected:String(key)===String(value)},title))));
  }
  function hostForm() {
    return el('main',{id:'main',tabindex:'-1',class:'entry single'},
      button('Back',()=>{model.entry='landing';model.error='';render();},{className:'text-button back',id:'entry-back'}),
      el('h1',{},'Bring your people.'),text('You host. Your friends play.','lede'),
      pendingAdmission(),errorBlock(),
      !model.catalogueReady&&el('div',{class:'message',role:'status'},text(model.catalogueError||'Connecting to the reviewed topics…'),
        model.catalogueError&&button('Retry topics',()=>{void loadCatalogue();},{id:'retry-topics',className:'text-button'})),
      el('form',{onsubmit:e=>{e.preventDefault();void run(()=>client.create(model.settings));}},
        select('Pick your world','topic',[['mix','A bit of everything'],...model.topics.map(t=>[t.id,t.title])],model.settings.topic,v=>{model.settings.topic=v;}),
        select('Turns in the spotlight','cycles',[[1,'One turn each'],[2,'Two turns each'],[3,'Three turns each']],model.settings.cycles,v=>{model.settings.cycles=Number(v);}),
        select('Time for each answer','answer-time',[[60,'60 seconds'],[120,'Two minutes'],[30,'30 seconds'],[0,'No timer']],model.settings.answerSeconds,v=>{model.settings.answerSeconds=Number(v);}),
        select('Time for predictions','guess-time',[[60,'60 seconds'],[120,'Two minutes'],[30,'30 seconds'],[0,'No timer']],model.settings.predictSeconds,v=>{model.settings.predictSeconds=Number(v);}),
        text('Up to '+model.maximumPlayers+' friends. Everyone gets a turn. No speed points.','small'),
        el('button',{type:'submit',id:'create-room',class:'button full',disabled:model.busy||!!client.pendingAdmissionHint||!model.catalogueReady},model.busy?'Making your room…':'Create room')),
      text('Want to play too? Join the code on your phone as a guest.','small'),privacy());
  }
  function playerList(state,{moderation=false}={}) {
    return el('ul',{class:'player-list'},state.players.map(p=>el('li',{class:'player-row'},clay(p.avatar,'avatar'),
      el('span',{class:'player-name'},p.nickname,el('small',{},p.connected?'In the room':'Reconnecting…')),
      moderation&&button('Remove',()=>confirm('Remove '+p.nickname+' and lock the room?','Their current room access will be revoked and the room will lock to new players. A running match ends as incomplete. Keep it locked to prevent rejoining; unlocking lets anyone with the code join again.','Remove and lock room',()=>act('kick',{playerId:p.id})),{className:'text-button remove','aria-label':'Remove '+p.nickname}))));
  }
  async function characterRequest(state,origin,request) {
    const focused=document.activeElement?.id===origin;
    let restoreFocus=focused,outcome;
    const movedFocus=event=>{if(event.target.id!=='retry-action'&&!event.target.closest?.('.companion-picker'))restoreFocus=false;};
    if(focused)document.addEventListener('focusin',movedFocus);
    try{
      outcome=await run(async()=>{
        try{return await request();}
        catch(error){
          if(error?.code==='invalid_action')throw new LiveError('companion_unavailable','This room does not support character choices yet. You can keep playing with your current character.');
          throw error;
        }
      });
    }finally{if(focused)document.removeEventListener('focusin',movedFocus);}
    const room=client.state;
    if(restoreFocus&&!disposed&&room?.code===state.code&&room.matchId===state.matchId&&room.phase==='lobby'&&room.role==='player'&&room.self.id===state.self.id
      &&document.activeElement===document.body){
      const current=room.players.find(player=>player.id===room.self.id)?.avatar;
      model.focusAfter=client.pendingAction?.action==='choose-avatar'?'retry-action':origin==='retry-action'?'companion-choice-'+current:origin;render();
    }
    return outcome;
  }
  function companionPicker(state) {
    if(state.role!=='player'||state.phase!=='lobby')return null;
    const own=state.players.find(player=>player.id===state.self.id);
    const companions=['gather','question','locked','reveal','finished'].map(partyGuide);
    const current=companions.find(guide=>guide.characterValue===own?.avatar);
    if(!current)return null;
    const pending=client.pendingAction?.action==='choose-avatar';
    const choose=value=>{
      const room=client.state;
      if(room?.code!==state.code||room.matchId!==state.matchId||room.role!=='player'||room.phase!=='lobby'||room.self.id!==state.self.id){
        fail(new Error('The room changed. Choose a character from the current lobby.'));return;
      }
      return characterRequest(state,'companion-choice-'+value,()=>{
        const request=client.action('choose-avatar',{value});render();return request;
      });
    };
    return el('section',{class:'companion-picker','aria-labelledby':'companion-heading'},
      el('h2',{id:'companion-heading'},'Choose your character'),
      text('Visible to this room. Every character uses the same rules.','small companion-note'),
      el('div',{class:'companion-options',role:'group','aria-labelledby':'companion-heading'},companions.map(guide=>button([
        guideScene(el,guide.beat,'companion-portrait'),el('span',{class:'companion-name'},guide.characterName),
        el('span',{class:'companion-choice-state'},own.avatar===guide.characterValue?'✓ Selected':'Choose')],()=>choose(guide.characterValue),
      {id:'companion-choice-'+guide.characterValue,className:'companion-choice','aria-label':'Choose '+guide.characterName,'aria-pressed':own.avatar===guide.characterValue,disabled:client.busy}))),
      text('Current character: '+current.characterName+'.','small companion-current'),
      pending&&el('p',{class:'small companion-pending',role:'status','aria-live':'polite'},'Confirming your character choice. Keep this tab open; retry the same request if the connection is interrupted.'));
  }
  async function copy(value) {
    try { await win.navigator.clipboard.writeText(value);model.toast='Copied.'; }
    catch { model.toast='Copy manually: '+value; }
    render();
  }
  function invitation(state) {
    const url=new URL('/play',win.location.origin);url.searchParams.set('room',state.code);
    return el('div',{class:'invite'},
      text('Room code','invite-label'),
      el('div',{class:'invite-line'},el('strong',{class:'room-code','aria-label':'Room code '+state.code.split('').join(' ')},state.code.slice(0,3),el('wbr'),state.code.slice(3)),
        button('Copy code',()=>copy(state.code),{className:'button outlined small-button',id:'copy-code'})),
      el('div',{class:'invite-line invite-link'},el('span',{},url.pathname+url.search),
        button('Copy join link',()=>copy(url.href),{className:'button small-button',id:'copy-link'})));
  }
  function lobby(state) {
    const host=state.role==='host';
    return el('main',{id:'main',tabindex:'-1',class:'lobby '+(host?'host-layout':'guest-layout')},
      el('section',{class:'lobby-copy'},el('h1',{},host?['Bring your ',el('br'),'people.']:['You’re in, ',el('br'),state.self.nickname+'.']),
        text(host?'You host. Your friends play.':'Waiting for the host to start.','lede'),
        host?invitation(state):el('div',{class:'guest-code'},text('Room '+state.code,'small'),clay(state.players.find(p=>p.id===state.self.id)?.avatar??3,'guest-pal')),
        host&&text('Invite 2–'+state.settings.capacity+' friends. Anyone with the link can join until you lock the room.','small'),
        host&&text('Want to play? Join on your phone.','small'),
        host&&cast(),!host&&companionPicker(state),!host&&privacy()),
      el('section',{class:'room-panel','aria-labelledby':'roster-title'},
        el('h2',{id:'roster-title'},'In the room'),text(state.players.length+' '+(state.players.length===1?'friend':'friends'),'roster-count'),
        state.players.length?playerList(state,{moderation:host}):text('Your friends appear here when they join.','empty'),
        host&&el('div',{class:'lobby-controls'},
          el('label',{class:'lock-row',for:'lock-room'},el('span',{},el('strong',{},'Lock room'),el('small',{},'Stop new friends joining')),
            el('input',{id:'lock-room',type:'checkbox',role:'switch',checked:state.joinLocked,disabled:model.busy||!!client.pendingAction,
              onchange:e=>void act('lock',{locked:e.target.checked})})),
          button(['Start game',arrow()],()=>act('start'),{className:'button full',id:'start-game',disabled:state.players.length<2}),
          text(state.players.length<2?'You need at least two friends to begin.':'Subjects rotate. Everyone gets a turn.','small centered')),
        !host&&!state.hostConnected&&text('Your host is reconnecting. Keep this tab open.','message'),
        text('100 for an exact read. 25 fewer per step. No speed points.','scoring-note')),errorBlock());
  }
  function subjectStrip(state,privateAnswer=false) {
    const r=state.round;const subject=state.players.find(p=>p.id===r.subjectId);
    return el('div',{class:'subject-strip'},clay(subject?.avatar??3,'subject-avatar'),el('strong',{},r.subjectName+' · '+(privateAnswer?'You are the subject':'The subject')));
  }
  function deadlinePassed(state) { const r=state?.round;return !!(r&&['answer','predict'].includes(state.phase)&&!r.paused&&r.deadline!==null&&Date.now()+model.clockOffset>=r.deadline); }
  function clock(state) { return el('p',{class:'clock','data-clock':'true','aria-live':deadlinePassed(state)?'polite':'off'},clockText(state)); }
  function clockText(state) {
    if(!state?.round)return'';
    if(state.round.paused)return'Paused · take a breath.';
    if(state.round.deadline===null)return'No timer. Take your time.';
    const left=Math.max(0,Math.ceil((state.round.deadline-(Date.now()+model.clockOffset))/1000));
    return left>0?left+' seconds remaining':'Confirming the round…';
  }
  function hostControls(state) {
    if(state.role!=='host'||!['answer','predict'].includes(state.phase))return null;
    return el('div',{class:'host-controls'},
      button(state.round.paused?'Resume round':'Pause round',()=>act(state.round.paused?'resume':'pause'),{className:'button outlined',id:'pause-round'}),
      button('Skip this take',()=>confirm('Skip this take?','No scores or answer will be shown for this round. Final standings will be provisional.','Skip take',()=>act('skip')),{className:'text-button',id:'skip-round'}),
      button('Finish early',()=>confirm('Finish this game early?','Completed rounds stay visible. This game will have provisional results and no winner.','Finish game',()=>act('end')),{className:'text-button',id:'finish-early'}));
  }
  function choose(state,answering) {
    const r=state.round;const locked=answering?r.ownAnswer:r.ownGuess;
    const selected=locked??model.selection,expired=deadlinePassed(state);
    return el('div',{class:'choice-area'},
      el('div',{class:'choices',role:'group','aria-label':answering?'Choose your private answer':'Choose your prediction'},
        [1,2,3,4,5].map(value=>button(String(value),()=>{model.selection=value;render();},
          {className:'choice '+(selected===value?'selected':''),id:'choice-'+value,disabled:r.paused||expired||locked!==null||!!client.pendingAction,
            'aria-pressed':selected===value,'aria-label':value+' · '+labels[value-1]}))),
      el('div',{class:'scale-ends'},el('span',{},'Not me'),el('span',{},'So me')),
      text(selected?selected+' · '+labels[selected-1]:'Choose a number.','selected-label'),
      locked===null?button(answering?'Lock my answer':'Lock my guess',()=>act(answering?'answer':'guess',{value:model.selection}),
        {className:'button full',id:'lock-choice',disabled:model.selection===null||r.paused||expired})
        :el('div',{class:'locked-message',role:'status'},answering?'Your answer is locked.':'Your guess is locked.'),
      text(locked===null?(expired?'Waiting for the room to confirm the round.':'You can change it until you lock.'):(answering?'Waiting for your friends’ predictions.':'Waiting for everyone to lock.'),'small centered'));
  }
  function roundView(state) {
    const r=state.round,subject=state.self.id===r.subjectId,answering=subject&&state.phase==='answer';
    const canGuess=!subject&&state.role==='player'&&state.phase==='predict';
    const title=answering?'Your private answer':canGuess?'Read '+r.subjectName+'’s mind.':subject?'Answer sealed.':state.phase==='answer'?'It’s '+r.subjectName+'’s turn.':'Predictions are in play.';
    const subjectPlayer=state.players.find(p=>p.id===r.subjectId);
    return el('main',{id:'main',tabindex:'-1',class:'round-screen '+(state.role==='host'?'controller':'player')},
      el('div',{class:'round-content'},
        text(roundLabel(r),'round-progress'),el('h1',{},title),subjectStrip(state,answering),
        text(answering||canGuess?'Hidden from other players until reveal.':subject?'Your friends are making their calls.':state.phase==='answer'?'Waiting for a private answer to lock.':r.submittedCount+' of '+r.eligibleCount+' predictions locked.','round-instruction'),
        el('h2',{class:'question'},r.prompt.text),
        el('figure',{class:'round-art'},clay(subjectPlayer?.avatar??3,'question-pal'),el('figcaption',{},topicNames[r.prompt.topic]??r.prompt.topic)),
        clock(state),answering||canGuess?choose(state,answering):el('div',{class:'wait-state'},
          subject&&r.ownAnswer!==null&&text('You picked '+r.ownAnswer+' · '+labels[r.ownAnswer-1],'locked-value'),
          text(r.paused?'The host paused this round.':state.phase==='answer'?'A little suspense. A big reveal.':r.submittedCount+' of '+r.eligibleCount+' predictions locked.','wait-title'),
          !state.hostConnected&&text('Your host is reconnecting. Keep this tab open.','small')),
        errorBlock(),hostControls(state)),
      state.role==='host'&&el('aside',{class:'round-sidebar'},el('h2',{},'Your people'),playerList(state,{moderation:true})));
  }
  function standings(state) {
    return el('section',{class:'standings room-panel','aria-labelledby':'standings-title'},
      el('h2',{id:'standings-title'},'Reading the room'),text('Average prediction accuracy','roster-count'),
      state.leaderboard.length?el('ol',{class:'leaderboard'},state.leaderboard.map(row=>el('li',{class:'leader-row'},
        el('span',{class:'rank','aria-label':row.rank===null?'Unranked':'Rank '+row.rank},row.rank??'—'),
        standingsAvatar(state,row.playerId),
        el('div',{class:'score-name'},el('strong',{},row.nickname),el('small',{},row.opportunities+' '+(row.opportunities===1?'prediction':'predictions'))),
        el('strong',{class:'accuracy'},percent(row.accuracy))))):text('Your first completed round starts the board.','empty'),
      text('Your own answers don’t affect your average.','small'));
  }
  function nextButton(state) {
    const last=state.round?.index>=state.round?.total;
    return state.role==='host'?button([last?'See final scores':'Next subject',arrow()],()=>act('next'),{className:'button full',id:'next-round'})
      :text('Waiting for the host to '+(last?'show final scores.':'start the next turn.'),'small centered');
  }
  function revealView(state) {
    const r=state.round,v=state.reveal,subject=state.players.find(p=>p.id===r?.subjectId);
    const own=v?.guesses.find(g=>g.playerId===state.self.id);
    const headline=!v?.valid?'A take for another time.':state.self.id===r.subjectId?'They read you.':own?.points===100?'You get '+r.subjectName+'.':r.subjectName+'’s wavelength.';
    return el('main',{id:'main',tabindex:'-1',class:'reveal-layout'},
      el('section',{class:'reveal-copy'},text(roundLabel(r),'round-progress'),el('h1',{},headline),
        text(v?.valid?'The little things give us away.':v?.reason==='subject_timeout'?'The answer timer ended before an answer locked. No scores were added.':v?.reason==='skipped'?'The host skipped this take. No scores were added.':'This take was not scored. No scores were added.','lede'),
        r&&subjectStrip(state),r&&el('h2',{class:'question'},r.prompt.text),
        el('div',{class:'reveal-pal'},clay(subject?.avatar??3)),
        v?.valid&&el('div',{class:'revealed-answer'},el('span',{class:'answer-number'},v.answer),el('strong',{},r.subjectName+' picked '+v.answer+' · '+labels[v.answer-1])),
        v?.valid&&el('ul',{class:'guess-list'},v.guesses.map(g=>el('li',{},el('strong',{},g.nickname),
          el('span',{},g.value===null?'No prediction':'Guessed '+g.value),el('strong',{class:'points'},g.points+' points')))),
        text('100 exact · 75 one away · 50 two away · 25 three away · 0 four away','scoring-note')),
      el('div',{class:'board-column'},standings(state),nextButton(state),errorBlock()));
  }
  function finished(state) {
    return el('main',{id:'main',tabindex:'-1',class:'finished-layout'},
      el('section',{},el('h1',{},state.completion==='complete'?'Your people. Read.':'A little unfinished.'),
        text(state.completion==='complete'?'Good instincts. Very good company.':'This match ended early. These standings are provisional.','lede'),
        cast(),state.completion==='complete'?text('Same people. New takes?','small'):text('Start again with the friends still in the room. No unfinished answer was revealed.','small'),
        state.role==='host'?button('Play again together',()=>act('rematch'),{id:'rematch',className:'button full'}):text('Waiting for the host to make the next move.','small'),
        errorBlock()),standings(state));
  }
  function modal() {
    if(!model.confirm)return null;
    const c=model.confirm;
    const d=el('dialog',{id:'confirm-dialog','aria-labelledby':'confirm-title','aria-describedby':'confirm-body',
      oncancel:e=>{e.preventDefault();dismissConfirmation();}},
      el('h2',{id:'confirm-title'},c.title),el('p',{id:'confirm-body'},c.body),
      el('div',{class:'dialog-actions'},button('Keep playing',dismissConfirmation,{className:'button outlined',id:'confirm-cancel'}),
        button(c.label,()=>{dismissConfirmation();void c.action();},{className:'button',id:'confirm-accept'})));
    return d;
  }
  function screenKey(state) { return state ? state.phase+':'+(state.round?.id??state.matchId) : client.resumeHint?'saved:'+client.resumeHint.code:model.entry; }
  function render() {
    if(disposed)return;
    const active=document.activeElement,id=active?.id,headingFocused=active?.tagName==='H1'&&root.contains(active),selection=typeof active?.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
    model.deadlineExpired=deadlinePassed(client.state);
    const state=client.state,screen=screenKey(state),changed=screen!==model.previousScreen;
    root.classList.toggle('is-quiz-room',state?.protocolVersion===2);
    document.title=state?.protocolVersion===2?'Likerts · '+(state.quiz?.title||'Live quiz'):'Likerts Live · Your people. Your wavelength.';
    if(changed)navigationScroll.cancel();
    const body=state?state.protocolVersion===2?quizLiveView(state,{el,text,button,act,confirm,chooseAnotherQuiz,companionPicker,invitation,playerList,cast,clay,standingsAvatar,clock,errorBlock,client,model,deadlinePassed,render})
      :state.phase==='lobby'?lobby(state):state.phase==='reveal'?revealView(state):state.phase==='finished'?finished(state):roundView(state)
      :client.resumeHint?savedRoom():model.entry==='join'?joinForm():model.entry==='host'?hostForm():landing();
    root.replaceChildren(...[header(state),body,state&&!client.persisted&&text('Keep this tab open. Your browser could not save room access for a reload.','message'),el('div',{class:'toast',role:'status','aria-live':'polite'},model.toast),modal()].filter(Boolean));
    const dialog=root.querySelector('dialog');
    if(dialog){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');const next=id&&document.getElementById(id);if(next&&dialog.contains(next)&&!next.disabled)next.focus({preventScroll:true});}
    else if(changed||headingFocused){model.focusAfter=null;const heading=root.querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}if(changed)navigationScroll.start({joinedLobby:state?.role==='player'&&state.phase==='lobby'});}
    else if(model.focusAfter){const next=document.getElementById(model.focusAfter);model.focusAfter=null;if(next&&root.contains(next)&&!next.disabled)next.focus({preventScroll:true});}
    else if(id){const next=document.getElementById(id);if(next&&root.contains(next)&&!next.disabled){next.focus({preventScroll:true});if(selection&&typeof next.setSelectionRange==='function')try{next.setSelectionRange(...selection);}catch{}}}
    model.previousScreen=screen;
    motion.bind(root,state?.protocolVersion===2?(state.round?.id??'lobby')+':'+state.phase:null,state?.protocolVersion===2?'live:'+state.matchId:'default');
  }
  client.onState=state=>{
    if(disposed)return;
    if(state)closedQuizCleanup=false;
    if(chooseQuizIntent&&state&&(state.code!==chooseQuizIntent.code||state.matchId!==chooseQuizIntent.matchId||state.protocolVersion!==2||state.role!=='host'||state.phase!=='finished'))chooseQuizIntent=null;
    rememberPublicAvatars(state);
    if(state)model.clockOffset=state.serverTime-Date.now();
    if(operation?.match&&(operation.match!==state?.matchId||operation.round!==state?.round?.id||operation.phase!==state?.phase)){
      operation=null;model.busy=false;
    }
    const signature=JSON.stringify(state?{...state,revision:0,serverTime:0,expiresAt:0}:null);
    if(signature===model.lastSignature)return;
    model.lastSignature=signature;
    if(!state&&model.lastMatch){model.entry='landing';model.consent=false;model.code='';model.confirm=null;}
    if(state?.round?.id!==model.lastRound||state?.matchId!==model.lastMatch){model.selection=null;model.error='';}
    model.lastRound=state?.round?.id;model.lastMatch=state?.matchId;model.lastPhase=state?.phase;
    if(state){model.clockOffset=state.serverTime-Date.now();if(state.round?.prompt?.topic)topicNames[state.round.prompt.topic]=model.topics.find(t=>t.id===state.round.prompt.topic)?.title??state.round.prompt.topic;}
    render();
  };
  client.onStatus=()=>render();
  client.onError=error=>fail(error);
  render();
  async function loadCatalogue() {
    const generation=++catalogueGeneration;model.catalogueError='';render();
    try{
      const c=await client.catalogue();if(disposed||generation!==catalogueGeneration)return;
      if(!Array.isArray(c.topics)||!c.topics.every(t=>t&&typeof t.id==='string'&&typeof t.title==='string'))throw new LiveError('invalid_catalogue','The reviewed topics could not be loaded. Reconnect and retry.');
      model.topics=c.topics;model.catalogueReady=true;
      if(Number.isSafeInteger(c.limits?.maxPlayers)&&c.limits.maxPlayers>=2&&c.limits.maxPlayers<=50){model.maximumPlayers=Math.min(12,c.limits.maxPlayers);model.settings.capacity=Math.min(model.settings.capacity,model.maximumPlayers);}
      for(const t of model.topics)topicNames[t.id]=t.title;
    }catch{if(disposed||generation!==catalogueGeneration)return;model.catalogueReady=false;model.catalogueError='The reviewed topics could not be loaded. Reconnect and retry.';}
    if(!disposed)render();
  }
  void loadCatalogue();
  const timer=setInterval(()=>{if(deadlinePassed(client.state)!==model.deadlineExpired){render();return;}const label=clockText(client.state);for(const node of root.querySelectorAll('[data-clock]'))if(node.textContent!==label)node.textContent=label;},1000);
  return {render,model,dispose(){disposed=true;operation=null;chooseQuizIntent=null;closedQuizCleanup=false;publicAvatars.clear();avatarScope=null;navigationScroll.dispose();motion.dispose();clearInterval(timer);client.dispose();}};
}
