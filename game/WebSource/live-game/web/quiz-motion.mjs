/** Cosmetic, bounded art entrances. This module never reads game clocks or sends commands. */
export const QUIZ_MOTION_KEY = 'likerts.quiz.motion.v1';
export const QUIZ_MOTION_DURATION = 360;
const MAX_SCOPES = 8, MAX_PER_SCOPE = 128, MAX_ENTRIES = MAX_SCOPES * MAX_PER_SCOPE, MAX_BYTES = 262_144;
const validKey = key => typeof key === 'string' && key.length > 0 && key.length <= 180 && /^[a-zA-Z0-9:._-]+$/.test(key);
const record = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const timestamp = value => Number.isSafeInteger(value) && value >= 0;

export function createQuizMotionController({ window: win = globalThis.window, storage, now = () => Date.now() } = {}) {
  const entries = new Map(), animations = new Set(), decodedSources = new Set(), decodingSources = new Set();
  let disabled = false, disposed = false, media = null, activeKey = null, activeScope = 'default', document = win?.document;
  const entryID = (key,scope=activeScope) => scope+'|'+key;
  const source = img => typeof img.currentSrc==='string' && img.currentSrc || (typeof img.src==='string' ? img.src : '');
  const loaded = img => img.complete===true && img.naturalWidth>0;
  function primeImages(root) {
    for (const img of root.querySelectorAll('[data-quiz-entrance] img')) {
      const url=source(img);
      if (!url || typeof img.decode!=='function' || decodedSources.has(url) || decodingSources.has(url)) continue;
      decodingSources.add(url);
      try { Promise.resolve(img.decode()).then(()=>{
        decodingSources.delete(url);
        if (!disposed) { if(decodedSources.size>=32) decodedSources.delete(decodedSources.values().next().value); decodedSources.add(url); }
      },()=>decodingSources.delete(url)); } catch { decodingSources.delete(url); }
    }
  }
  const cancel = () => { for (const animation of animations) { try { animation.cancel(); } catch {} } animations.clear(); };
  try {
    if (storage === undefined) storage = win?.sessionStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') disabled = true;
    else {
      const raw = storage.getItem(QUIZ_MOTION_KEY);
      if (raw !== null) {
        if (typeof raw !== 'string' || raw.length > MAX_BYTES) throw new Error('Invalid motion record');
        const journal = JSON.parse(raw);
        if (!record(journal,['version','entries']) || journal.version !== 1 || !Array.isArray(journal.entries) || journal.entries.length > MAX_ENTRIES) throw new Error('Invalid motion record');
        for (const entry of journal.entries) {
          if (!record(entry,['scope','key','startedAt','observedAt']) || !validKey(entry.key) || !validKey(entry.scope) || entries.has(entryID(entry.key,entry.scope))
            || !(entry.startedAt === null || timestamp(entry.startedAt)) || !timestamp(entry.observedAt)
            || entry.startedAt !== null && entry.observedAt < entry.startedAt) throw new Error('Invalid motion record');
          // A remounted document treats already-observed scenes as settled.
          // Only replacement nodes owned by this controller resume an entrance.
          entries.set(entryID(entry.key,entry.scope),{...entry,startedAt:null});
        }
        const scopes = new Set([...entries.values()].map(entry=>entry.scope));
        if (scopes.size>MAX_SCOPES || [...scopes].some(scope=>[...entries.values()].filter(entry=>entry.scope===scope).length>MAX_PER_SCOPE)) throw new Error('Invalid motion record');
      }
    }
    media = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media || typeof media.matches !== 'boolean') disabled = true;
    if (!['visible','hidden'].includes(document?.visibilityState) || typeof document?.addEventListener !== 'function') disabled = true;
  } catch { disabled = true; }
  function persist(entry) {
    if (disabled || !validKey(entry.key) || !validKey(entry.scope)) return false;
    const sameScope = [...entries.values()].filter(item=>item.scope===entry.scope);
    if (!entries.has(entryID(entry.key,entry.scope)) && sameScope.length>=MAX_PER_SCOPE) return false;
    const scopes = [...new Set([...entries.values()].map(item=>item.scope))];
    if (!scopes.includes(entry.scope) && scopes.length>=MAX_SCOPES) {
      for (const [id,item] of entries) if (item.scope===scopes[0]) entries.delete(id);
    }
    // Recently used journeys stay grouped at the end of this bounded LRU.
    for (const item of sameScope) { entries.delete(entryID(item.key,item.scope)); entries.set(entryID(item.key,item.scope),item); }
    entries.set(entryID(entry.key,entry.scope),entry);
    try {
      const raw = JSON.stringify({version:1,entries:[...entries.values()]});
      if (raw.length > MAX_BYTES) throw new Error('Motion record full');
      storage.setItem(QUIZ_MOTION_KEY,raw);
      return true;
    } catch { disabled = true; cancel(); return false; }
  }
  function consume(key) {
    if (!validKey(key) || disabled) return;
    const entry = entries.get(entryID(key));
    if (entry?.startedAt === null) return;
    let observedAt; try { observedAt = now(); } catch { disabled = true; return; }
    if (!timestamp(observedAt)) { disabled = true; return; }
    persist({scope:activeScope,key,startedAt:null,observedAt});
  }
  function settle() { cancel(); if (activeKey) consume(activeKey); }
  const mediaChange = () => { if (media?.matches) settle(); };
  const visibilityChange = () => { if (document?.visibilityState === 'hidden') settle(); };
  try {
    if (media?.addEventListener) media.addEventListener('change',mediaChange);
    else if (media?.addListener) media.addListener(mediaChange);
    else disabled = true;
    document?.addEventListener?.('visibilitychange',visibilityChange);
  } catch { disabled = true; }
  return {
    bind(root,key,scope='default') {
      cancel(); activeKey = validKey(key) && validKey(scope) ? key : null; activeScope = scope;
      if (disposed || disabled || !activeKey || typeof root?.querySelectorAll !== 'function') return;
      if (media.matches || document?.visibilityState === 'hidden') { consume(key); return; }
      primeImages(root);
      let current; try { current = now(); } catch { disabled = true; return; }
      if (!timestamp(current)) { disabled = true; return; }
      const prior = entries.get(entryID(key));
      if (prior?.startedAt === null) {
        if ([...entries.values()].at(-1)?.scope!==scope) persist({...prior,observedAt:Math.max(prior.observedAt,current)});
        return;
      }
      if (prior && (current < prior.observedAt || current - prior.startedAt >= QUIZ_MOTION_DURATION)) { consume(key); return; }
      const targets = [...root.querySelectorAll('[data-quiz-entrance]')];
      // First-observed/undecoded images remain static. Decode completion only warms
      // later scenes; it never starts a late entrance or delays any controls.
      if (!targets.length || targets.some(node => typeof node.animate !== 'function'
        || [...node.querySelectorAll('img')].some(img => !loaded(img) || !decodedSources.has(source(img))))) { consume(key); return; }
      const entry = {scope,key,startedAt:prior?.startedAt ?? current,observedAt:current};
      if (!persist(entry)) return;
      const elapsed = current - entry.startedAt;
      try {
        for (const node of targets) {
          const animation = node.animate([{transform:'translateY(6px)',opacity:0.82},{transform:'translateY(0)',opacity:1}],
            {duration:QUIZ_MOTION_DURATION,easing:'cubic-bezier(.2,.7,.2,1)',fill:'none'});
          animations.add(animation); animation.pause(); animation.currentTime = elapsed; animation.play();
          animation.finished?.then(() => animations.delete(animation),() => animations.delete(animation));
        }
      } catch { settle(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancel(); decodedSources.clear(); decodingSources.clear();
      try {
        if (media?.removeEventListener) media.removeEventListener('change',mediaChange);
        else media?.removeListener?.(mediaChange);
        document?.removeEventListener?.('visibilitychange',visibilityChange);
      } catch {}
    },
  };
}
