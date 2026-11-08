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

/** New editorial roles reuse original art. No guide changes scores, timing or reveal. */
export const partyCastPresentation = Object.freeze({
  "intro": "Five guides. One room. Same rules for everyone.",
  "arc": "Gather → Choose → Keep it sealed → Reveal → Go again.",
  "closing": "Quizzes ask what you know. Mind-reading asks how well you know each other. Either way, bring your people."
});
const PARTY_GUIDES = Object.freeze([
  {
    "beat": "gather",
    "characterValue": 1,
    "characterName": "Ember",
    "role": "The Spark",
    "title": "Bring your people.",
    "cue": "One code brings the room together. Everyone plays by the same rules.",
    "voiceLine": "Who’s coming?",
    "castDescription": "Gets the room together."
  },
  {
    "beat": "question",
    "characterValue": 2,
    "characterName": "Loop",
    "role": "The Questioner",
    "title": "Make your call.",
    "cue": "Choose, then lock. Keep your take private until the room reveals.",
    "voiceLine": "What’s your take?",
    "castDescription": "Makes room for a little curiosity."
  },
  {
    "beat": "locked",
    "characterValue": 3,
    "characterName": "Twist",
    "role": "The Keeper",
    "title": "Your take is sealed.",
    "cue": "Your answer is saved. Now let the room catch up.",
    "voiceLine": "No peeking yet.",
    "castDescription": "Holds the pause between lock and reveal."
  },
  {
    "beat": "reveal",
    "characterValue": 4,
    "characterName": "Blu",
    "role": "The Guide",
    "title": "See what landed.",
    "cue": "The answer and points are in. Take a look at the room.",
    "voiceLine": "Let’s see what landed.",
    "castDescription": "Helps the room make sense of the reveal."
  },
  {
    "beat": "finished",
    "characterValue": 5,
    "characterName": "Moss",
    "role": "The Cheerleader",
    "title": "One more together?",
    "cue": "Look back at the standings, then rematch or bring a new quiz.",
    "voiceLine": "One more together?",
    "castDescription": "Cheers everyone who played."
  }
].map(value => Object.freeze(value)));
export const partyGuide = beat => PARTY_GUIDES.find(value => value.beat === beat) ?? null;
// Exact StoryCastBounds.hold rectangles on the original 1983×793 atlas.
const GUIDE_HOLD_BOUNDS = Object.freeze({
  1: Object.freeze([52, 286, 382, 393]), 2: Object.freeze([448, 273, 385, 407]),
  3: Object.freeze([817, 168, 387, 517]), 4: Object.freeze([1209, 138, 309, 545]),
  5: Object.freeze([1540, 296, 400, 388]),
});
/** Friendly hold poses stay static and decorative; celebration stays outcome-gated. */
export function guideScene(el, beat, className = '') {
  const guide = partyGuide(beat);
  return guide ? el('div', { class: 'quiz-guide-character is-neutral is-guide ' + className,
    'aria-hidden': 'true', 'data-guide-character': guide.characterValue },
  el('span', { class: 'quiz-guide-sprite', 'data-sprite-rect': GUIDE_HOLD_BOUNDS[guide.characterValue].join(',') })) : null;
}
