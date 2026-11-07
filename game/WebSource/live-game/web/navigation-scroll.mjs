// A mobile browser can restore the old form scroll after the new screen's
// initial reset. Settle only this navigation, briefly, until any user intent.
export function createNavigationScrollSettler({window:win,document,heading}) {
  let active=null,disposed=false;
  const now=()=>win.performance?.now?.()??Date.now();
  const inputEvents=['pointerdown','touchstart','touchmove','wheel','keydown','click','beforeinput','input'];
  function cancel() {
    const plan=active;active=null;
    if(!plan)return;
    for(const timer of plan.timers)win.clearTimeout(timer);
    if(plan.frame!==null)win.cancelAnimationFrame?.(plan.frame);
    for(const event of inputEvents)win.removeEventListener(event,plan.cancel,true);
    document.removeEventListener('focusin',plan.focus,true);
    document.removeEventListener('visibilitychange',plan.visibility);
    win.removeEventListener('pagehide',plan.cancel);
  }
  function start({joinedLobby=false}={}) {
    cancel();
    if(disposed||document.hidden||document.visibilityState==='hidden'||typeof win.scrollTo!=='function')return;
    const plan={deadline:now()+600,timers:[],frame:null,cancel,focus:null,visibility:null};
    active=plan;
    const current=()=>{
      if(active!==plan||disposed)return false;
      if(document.hidden||document.visibilityState==='hidden'||now()>=plan.deadline){cancel();return false;}
      return true;
    };
    const reset=(force=false)=>{
      if(!current()||(!force&&!win.scrollY&&!win.scrollX))return;
      try{win.scrollTo({left:0,top:0,behavior:'instant'});}
      catch{try{win.scrollTo(0,0);}catch{cancel();}}
    };
    // Keep the plan across replacement of the same screen's focused heading.
    // Moving focus to a field/control gives navigation back to the user.
    plan.focus=event=>{if(event.target!==heading())cancel();};
    plan.visibility=()=>{if(document.hidden||document.visibilityState==='hidden')cancel();};
    for(const event of inputEvents)win.addEventListener(event,plan.cancel,{capture:true,passive:true});
    document.addEventListener('focusin',plan.focus,true);
    document.addEventListener('visibilitychange',plan.visibility);
    win.addEventListener('pagehide',plan.cancel);
    const priorY=win.scrollY,priorX=win.scrollX,scroller=document.scrollingElement;
    const maxScroll=scroller===document.documentElement?Math.max(0,scroller.scrollHeight-scroller.clientHeight):0;
    const canMove=joinedLobby&&typeof win.requestAnimationFrame==='function'&&typeof win.cancelAnimationFrame==='function'
      &&Number.isFinite(maxScroll)&&maxScroll>=1&&Number.isFinite(priorY)&&priorY>=1&&priorY<=maxScroll&&priorX===0;
    reset(true);
    if(active!==plan)return;
    let positiveReturn=false;
    if(canMove&&current()&&win.scrollY===0&&scroller===document.scrollingElement&&scroller.scrollHeight-scroller.clientHeight>=1){
      // Safari can retain the form's viewport offset after reaching zero. For a
      // joined lobby, try one pixel and allow a frame before returning to zero.
      try{win.scrollTo({left:0,top:1,behavior:'instant'});positiveReturn=win.scrollY===1;}catch{}
    }
    if(active!==plan)return;
    if(typeof win.requestAnimationFrame==='function'){
      try{plan.frame=win.requestAnimationFrame(()=>{
        plan.frame=null;
        if(positiveReturn&&current()&&win.scrollY===1){
          try{plan.frame=win.requestAnimationFrame(()=>{plan.frame=null;reset();});}
          catch{reset();}
        }else reset();
      });}catch{reset();}
    }
    if(active!==plan)return;
    try{
      for(const delay of [100,300,500])plan.timers.push(win.setTimeout(()=>reset(),delay));
      plan.timers.push(win.setTimeout(()=>{if(active===plan)cancel();},600));
    }catch{reset();if(active===plan)cancel();}
  }
  return{start,cancel,dispose(){disposed=true;cancel();}};
}
