import { totem, celebration, waitingCast } from './art.mjs';

/** Original pixels, static scene geometry; only this decorative group may enter. */
function stage(el, art, className) {
  return el('div', {class:'quiz-scene '+className,'aria-hidden':'true','data-quiz-entrance':true},
    el('img',{class:'quiz-scene-background',src:'/play/assets/totem-background.png',alt:'',width:853,height:1844,decoding:'async'}),
    el('span',{class:'quiz-scene-platform'},el('img',{src:'/play/assets/totem-platform.png',alt:'',width:2172,height:724,decoding:'async'})),
    el('div',{class:'quiz-scene-actors'},art));
}
export const companionScene = (el,value=3,className='') => stage(el,totem(el,value),'is-neutral '+className);
export const castScene = (el,celebrating=false,className='') => stage(el,celebrating?celebration(el):waitingCast(el),'is-cast '+className);
export function libraryScene(el) {
  return el('div',{class:'quiz-library-scene','aria-hidden':'true'},
    el('img',{src:'/play/assets/story-book-library.png',alt:'',width:1536,height:1024,loading:'lazy',decoding:'async'}));
}
