import {choiceAnswer, choiceError} from './choice-features.js';
import {pageRoute, routedAnswers} from './branching.js';
import {advancedAnswerError,allocationRemaining,moveRanking,setAllocation,setMatrixChoice} from './advanced-questions.js';
export {SurveyFlow, pageRoute, routedAnswers} from './branching.js';
export type {BranchingSchema, SurveyProgress} from './branching.js';
export * from './advanced-questions.js';
export interface StructuredChoiceAnswer { selected: string[]; otherText: Record<string,string> }
export type Answer = string | number | string[] | StructuredChoiceAnswer | Record<string,string|string[]> | Record<string,number>;
export type QuestionType = 'single_choice' | 'multiple_choice' | 'scale' | 'text' | 'number' | 'date' | 'ranking' | 'matrix' | 'constant_sum';
export type VisibilityOperator = 'equals' | 'not_equals' | 'includes' | 'not_includes' | 'answered' | 'not_answered';
export interface VisibilityCondition { questionId: string; operator: VisibilityOperator; value?: string | number }
export interface PageBranch { when: VisibilityCondition; goToPageId: string }
export interface SurveyPage { id: string; title?: string; questionIds: string[]; branches?: PageBranch[] }
export interface Choice { id:string; label:string; other?:{maxLength:number}; exclusive?:true }
export interface PromptItem {id:string;label:string}
export interface Question { id: string; type: QuestionType; label: string; required?: boolean; options?: Choice[]; min?: number; max?: number; maxLength?: number; preset?: 'nps' | 'yes_no'; labels?: Record<string, string>; minSelections?: number; maxSelections?: number; visibleWhen?: VisibilityCondition; presentation?:'stars'|'dropdown';rows?:PromptItem[];columns?:Choice[];matrixMode?:'single'|'multiple';items?:PromptItem[];total?:number }
export interface Collection { id: string; surveyId: string; version: number; placement: string; schema: { schemaVersion: 1 | 2 | 3 | 4 | 5; title: string; questions: Question[]; pages?: SurveyPage[] } }
export interface Submission { idempotencyKey: string; answers: Record<string, Answer>; metadata: Record<string, unknown> }
export interface Receipt { responseId: string; collectionId: string; accepted: true }
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface CollectionRequestOptions extends RequestOptions { refresh?: boolean }
export interface SurveyMessages { selectPlaceholder: string; back: string; next: string; progress: string; submit: string; submitting: string; submitted: string; submissionError: string; selectionRange: string; otherError: string; moveUp:string;moveDown:string;remaining:string;advancedError:string }
export interface SurveyClassNames { form: string; title: string; question: string; label: string; control: string; submit: string; status: string }
export interface MountSurveyOptions { messages?: Partial<SurveyMessages>; classNames?: Partial<SurveyClassNames> }
export const LIKERTS_SDK_CAPABILITY = Object.freeze({target:'web' as const,sdkVersion:'0.0.3',schemaVersions:[1,2,3,4,5] as const});
export class LikertsError extends Error { constructor(public status: number, public response: string) { super(`Likerts request failed (${status})`); } }
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MESSAGES: SurveyMessages = Object.freeze({selectPlaceholder:'Select an answer',back:'Back',next:'Next',progress:'Page {current} of {total}',submit:'Submit',submitting:'Submitting…',submitted:'Submitted',submissionError:'Could not confirm submission. Retry without changes to reuse the same submission key.',selectionRange:'Select between {min} and {max} options.',otherError:'Enter valid text for the selected Other option.',moveUp:'Move up',moveDown:'Move down',remaining:'{remaining} remaining',advancedError:'Complete this answer.'});
const DEFAULT_CLASSES: SurveyClassNames = Object.freeze({form:'likerts-form',title:'likerts-title',question:'likerts-question',label:'likerts-label',control:'likerts-control',submit:'likerts-submit',status:'likerts-status'});
function safeBaseURL(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) throw new TypeError('Likerts base URL must use HTTPS (HTTP is limited to loopback development)');
  return value.replace(/\/$/, '');
}
/** Only a public collection credential belongs here. No administrative credentials. */
export class LikertsClient {
  private baseURL: string;
  private transport: typeof fetch;
  private collectionCache = new Map<string,{value:Collection;storedAt:number}>();
  constructor(baseURL: string, private token: string, transport: typeof fetch | undefined = undefined, private defaultTimeoutMs = 15000, private cacheMaxAgeMs = 300000, private maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES) {
    this.baseURL = safeBaseURL(baseURL); this.transport=transport ?? ((input,init)=>globalThis.fetch(input,init)); if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) throw new TypeError('timeoutMs must be positive'); if (!Number.isFinite(cacheMaxAgeMs) || cacheMaxAgeMs < 0) throw new TypeError('cacheMaxAgeMs must not be negative'); if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) throw new TypeError('maxResponseBytes must be a positive integer');
  }
  private async responseText(response: Response): Promise<string> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) throw new Error('Likerts response exceeds configured size limit');
    if (!response.body) return '';
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
    try { for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>this.maxResponseBytes){await reader.cancel();throw new Error('Likerts response exceeds configured size limit');}chunks.push(value);} }
    finally { reader.releaseLock(); }
    const body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(body);
  }
  private async request<T>(path: string, body?: Submission, options: RequestOptions = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs; if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');
    const controller = new AbortController(); const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => controller.abort(new DOMException('Likerts request timed out', 'TimeoutError')), timeoutMs);
    try {
      const response = await this.transport(`${this.baseURL}${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${this.token}`, ...(body ? {'Content-Type': 'application/json'} : {}) }, ...(body ? {body: JSON.stringify(body)} : {}) });
      const text = await this.responseText(response);
      if (!response.ok) throw new LikertsError(response.status, text);
      return JSON.parse(text) as T;
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
  async collection(id: string, options: CollectionRequestOptions = {}): Promise<Collection> {
    const cached=this.collectionCache.get(id);if(!options.refresh&&cached&&Date.now()-cached.storedAt<this.cacheMaxAgeMs)return cached.value;
    try { const c = await this.request<Collection>(`/v1/collections/${encodeURIComponent(id)}`, undefined, options); if(![1,2,3,4,5].includes(c.schema.schemaVersion)) throw new Error('Unsupported survey schema version');
      if(cached&&(cached.value.id!==c.id||cached.value.surveyId!==c.surveyId||cached.value.version!==c.version||cached.value.schema.schemaVersion!==c.schema.schemaVersion)){this.collectionCache.delete(id);throw new Error('Collection binding changed');}
      this.collectionCache.set(id,{value:c,storedAt:Date.now()});return c;
    } catch(error) { this.collectionCache.delete(id);throw error; }
  }
  clearCollectionCache(id?: string): void { if(id)this.collectionCache.delete(id);else this.collectionCache.clear(); }
  /** Retrying requires the same submission object, including its idempotencyKey. */
  async submit(id: string, submission: Submission, options?: RequestOptions): Promise<Receipt> { const receipt = await this.request<Receipt>(`/v1/collections/${encodeURIComponent(id)}/responses`, submission, options); if (receipt.accepted !== true) throw new Error('Invalid Likerts receipt'); return receipt; }
}

export function conditionMatches(condition: VisibilityCondition, answer: Answer | undefined): boolean {
  const selected=answer&&typeof answer==='object'&&!Array.isArray(answer)&&'selected' in answer&&Array.isArray(answer.selected)?answer.selected as string[]:undefined;
  const objectAnswer=answer&&typeof answer==='object'&&!Array.isArray(answer);
  const hasAnswer=answer !== undefined && (typeof answer!=='string'||answer.trim()!=='') && (!Array.isArray(answer) || answer.length > 0) && (!objectAnswer || (selected ? selected.length > 0 : Object.keys(answer).length > 0));
  if (condition.operator === 'answered') return hasAnswer;
  if (condition.operator === 'not_answered') return !hasAnswer;
  if (answer === undefined || answer === '') return false;
  const scalar=selected?.length===1?selected[0]:answer;
  if (condition.operator === 'equals') return scalar === condition.value;
  if (condition.operator === 'not_equals') return scalar !== condition.value;
  const values=selected??(Array.isArray(answer)?answer:undefined);if(!values)return false;
  if (condition.operator === 'includes') return values.includes(String(condition.value));
  if (condition.operator === 'not_includes') return !values.includes(String(condition.value));
  throw new Error('Unsupported visibility operator');
}

/** Computes visibility recursively. Hidden source answers are treated as unanswered. */
export function visibleQuestionIds(questions: Question[], answers: Record<string, Answer>): Set<string> {
  const byId=new Map(questions.map(question=>[question.id,question]));const memo=new Map<string,boolean>();const active=new Set<string>();
  const visible=(question:Question):boolean=>{const prior=memo.get(question.id);if(prior!==undefined)return prior;if(active.has(question.id))throw new Error('Conditional visibility cycle');active.add(question.id);const condition=question.visibleWhen;let result=true;if(condition){const source=byId.get(condition.questionId);if(!source)throw new Error('Conditional visibility references an unknown question');const sourceAnswer=visible(source)?answers[source.id]:undefined;result=conditionMatches(condition,sourceAnswer);}active.delete(question.id);memo.set(question.id,result);return result;};
  return new Set(questions.filter(visible).map(question=>question.id));
}

/** Removes answers for hidden questions before validation or submission. */
export function visibleAnswers(questions: Question[], answers: Record<string, Answer>): Record<string, Answer> {
  const visible=visibleQuestionIds(questions,answers);return Object.fromEntries(Object.entries(answers).filter(([id])=>visible.has(id)));
}
/** Customer owns the mount location, trigger, styles and dismissal. Returns cleanup. */
let mountSequence = 0;
/** Fixed likerts-* classes and data attributes are stable styling hooks; options add host classes without inline styles. */
export function mountSurvey(container: HTMLElement, collection: Collection, client: LikertsClient, onComplete: (receipt: Receipt) => void, metadata: Record<string, unknown> = {}, options: MountSurveyOptions = {}): () => void {
  if (![1, 2, 3, 4, 5].includes(collection.schema.schemaVersion)) throw new Error('Unsupported survey schema version');
  const messages = {...DEFAULT_MESSAGES}; for(const key of Object.keys(DEFAULT_MESSAGES) as (keyof SurveyMessages)[]){const value=options.messages?.[key];if(typeof value==='string')messages[key]=value;}
  const addClasses = (element: HTMLElement, base: keyof SurveyClassNames) => { element.classList.add(DEFAULT_CLASSES[base]); const extra=options.classNames?.[base]?.trim(); if(extra) element.classList.add(...extra.split(/\s+/)); };
  const prefix = `likerts-${++mountSequence}`;
  const form = document.createElement('form'); addClasses(form,'form'); form.dataset.likertsCollection=collection.id;
  const title = document.createElement('h2'); addClasses(title,'title'); title.id=`${prefix}-title`; title.textContent = collection.schema.title; form.setAttribute('aria-labelledby',title.id); form.append(title);
  const fields = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(); const wrappers = new Map<string,HTMLElement>(); const otherFields=new Map<string,HTMLInputElement>();const starFields=new Map<string,HTMLInputElement[]>();const previousSelections=new Map<string,string[]>();const advancedAnswers:Record<string,Answer>={};
  for (const q of collection.schema.questions) {
    const wrapper=document.createElement('div'); addClasses(wrapper,'question'); wrapper.dataset.likertsQuestion=q.id; wrapper.dataset.likertsType=q.type;
    const label = document.createElement('label'); addClasses(label,'label'); label.textContent = q.label;
    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if(q.type==='ranking'||q.type==='matrix'||q.type==='constant_sum'){
      const field=document.createElement('input');field.type='hidden';input=field;
      if(q.type==='ranking'){const list=document.createElement('ol');let order=(q.options??[]).map(option=>option.id);const render=()=>{list.replaceChildren();for(const [index,id] of order.entries()){const option=q.options?.find(value=>value.id===id)!;const row=document.createElement('li');row.textContent=option.label;const up=document.createElement('button');up.type='button';up.textContent=messages.moveUp;up.disabled=index===0;up.setAttribute('aria-label',`${messages.moveUp}: ${option.label}`);up.dataset.likertsMove='up';const down=document.createElement('button');down.type='button';down.textContent=messages.moveDown;down.disabled=index===order.length-1;down.setAttribute('aria-label',`${messages.moveDown}: ${option.label}`);down.dataset.likertsMove='down';up.addEventListener('click',()=>{order=moveRanking(q,order,id,-1);advancedAnswers[q.id]=order;render();edited()});down.addEventListener('click',()=>{order=moveRanking(q,order,id,1);advancedAnswers[q.id]=order;render();edited()});row.append(up,down);list.append(row)}};render();wrapper.append(list)}
      else if(q.type==='matrix'){for(const row of q.rows??[]){const group=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=row.label;group.append(legend);for(const column of q.columns??[]){const choice=document.createElement('label'),control=document.createElement('input');control.type=q.matrixMode==='single'?'radio':'checkbox';control.name=q.matrixMode==='single'?`${prefix}-${q.id}-${row.id}`:`${prefix}-${q.id}-${row.id}-${column.id}`;control.value=column.id;control.addEventListener('change',()=>{advancedAnswers[q.id]=setMatrixChoice(q,advancedAnswers[q.id],row.id,column.id);edited()});choice.append(control,document.createTextNode(column.label));group.append(choice)}wrapper.append(group)}}
      else {const remaining=document.createElement('p');remaining.setAttribute('role','status');remaining.setAttribute('aria-live','polite');const refresh=()=>remaining.textContent=messages.remaining.replace('{remaining}',String(allocationRemaining(q,advancedAnswers[q.id])));for(const item of q.items??[]){const itemLabel=document.createElement('label');itemLabel.textContent=item.label;const control=document.createElement('input');control.type='number';control.min='0';control.max=String(q.total??0);control.step='1';control.addEventListener('input',()=>{const current=advancedAnswers[q.id]&&typeof advancedAnswers[q.id]==='object'&&!Array.isArray(advancedAnswers[q.id])?advancedAnswers[q.id]:{};if(control.value===''){const next={...(current as Record<string,number>)};delete next[item.id];advancedAnswers[q.id]=next}else advancedAnswers[q.id]=setAllocation(current,item.id,Number(control.value));refresh();edited()});itemLabel.append(control);wrapper.append(itemLabel)}refresh();wrapper.append(remaining)}
    } else if (q.presentation === 'stars') {
      const field=document.createElement('input');field.type='hidden';input=field;
      const group=document.createElement('div');group.setAttribute('role','radiogroup');group.setAttribute('aria-label',q.label);const radios:HTMLInputElement[]=[];
      for(let value=q.min??1;value<=(q.max??5);value++){const option=document.createElement('label');const radio=document.createElement('input');radio.type='radio';radio.name=`${prefix}-stars-${q.id}`;radio.value=String(value);radio.setAttribute('aria-label',q.labels?.[String(value)]?`${value} — ${q.labels[String(value)]}`:String(value));radio.required=!!q.required;radio.addEventListener('change',()=>{if(radio.checked)field.value=radio.value});option.append(radio,document.createTextNode('★'.repeat(value)));group.append(option);radios.push(radio);}
      starFields.set(q.id,radios);wrapper.append(group);
    } else if (q.type === 'single_choice' || q.type === 'multiple_choice' || (q.type === 'scale' && (q.labels !== undefined || q.preset === 'nps'))) {
      const select = document.createElement('select'); select.multiple = q.type === 'multiple_choice';
      if (!select.multiple) { const blank = document.createElement('option'); blank.value = ''; blank.textContent = messages.selectPlaceholder; select.append(blank); }
      const choices = q.type === 'scale'
        ? Array.from({length: (q.max ?? 0) - (q.min ?? 0) + 1}, (_, i) => { const value = (q.min ?? 0) + i; return {id: String(value), label: q.labels?.[String(value)] ? `${value} — ${q.labels[String(value)]}` : String(value)}; })
        : q.options ?? [];
      for (const choice of choices) { const option = document.createElement('option'); option.value = choice.id; option.textContent = choice.label; select.append(option); }
      input = select;
    } else if (q.type === 'text') {
      const text = document.createElement('textarea'); if (q.maxLength !== undefined) text.maxLength = q.maxLength; input = text;
    } else {
      const field = document.createElement('input'); field.type = q.type === 'date' ? 'date' : 'number'; field.step = q.type === 'scale' ? '1' : 'any';
      if (q.min !== undefined) field.min = String(q.min); if (q.max !== undefined) field.max = String(q.max); input = field;
    }
    input.name = q.id; input.id=`${prefix}-${fields.size}`; input.required = !!q.required; addClasses(input,'control'); label.htmlFor=input.id; wrapper.append(label,input); form.append(wrapper); fields.set(q.id, input); wrappers.set(q.id,wrapper);
    const other=q.options?.find(o=>o.other!==undefined);if(other){const field=document.createElement('input');field.type='text';field.id=`${input.id}-other`;field.name=`${q.id}.otherText`;field.hidden=true;addClasses(field,'control');const otherLabel=document.createElement('label');otherLabel.htmlFor=field.id;otherLabel.textContent=`${q.label}: ${other.label}`;otherLabel.hidden=true;wrapper.append(otherLabel,field);otherFields.set(q.id,field);}

  }
  const pages=collection.schema.pages??[{id:'survey',questionIds:collection.schema.questions.map(q=>q.id)}];let currentPage=0;let history=[0];
  const progress=document.createElement('p');progress.dataset.likertsProgress='';progress.setAttribute('aria-live','polite');
  const back=document.createElement('button');back.type='button';back.textContent=messages.back;back.dataset.likertsBack='';
  const next=document.createElement('button');next.type='button';next.textContent=messages.next;next.dataset.likertsNext='';
  const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = messages.submit; addClasses(submit,'submit');
  const status = document.createElement('p'); status.id=`${prefix}-status`; status.setAttribute('role', 'status'); status.setAttribute('aria-live','polite'); status.tabIndex=-1; addClasses(status,'status'); form.setAttribute('aria-describedby',status.id); if(collection.schema.pages)form.append(progress,back,next);form.append(submit,status);
  let pending: Submission | undefined; let completed = false; let disposed = false; let active: AbortController | undefined;
  const readAnswers = () => {
    const answers:Record<string,Answer>={};for(const q of collection.schema.questions){const input=fields.get(q.id)!;
      if(q.type==='ranking'||q.type==='matrix'||q.type==='constant_sum'){if(advancedAnswers[q.id]!==undefined)answers[q.id]=advancedAnswers[q.id];continue}
      if(q.type==='single_choice'||q.type==='multiple_choice'){const selected=input instanceof HTMLSelectElement&&input.multiple?Array.from(input.selectedOptions,o=>o.value):input.value?[input.value]:[];const other=q.options?.find(o=>o.other!==undefined);if(selected.length)answers[q.id]=choiceAnswer(q,selected,other?{[other.id]:otherFields.get(q.id)?.value??''}:{});}
      else if(input.value!=='')answers[q.id]=q.type==='number'||q.type==='scale'?Number(input.value):input.value;
    }return answers;
  };
  const refreshVisibility = () => {
    for(let pass=0;pass<=collection.schema.questions.length;pass++){
      const answers=readAnswers(),visible=visibleQuestionIds(collection.schema.questions,answers),route=pageRoute(collection.schema,answers);let changed=false;
      if(!route.includes(currentPage)){let shared=route[0]??0;for(let i=0;i<Math.min(history.length,route.length)&&history[i]===route[i];i++)shared=route[i];currentPage=shared;history=route.slice(0,route.indexOf(currentPage)+1);}
      const reached=new Set(route.flatMap(index=>pages[index].questionIds));const currentQuestions=new Set(pages[currentPage]?.questionIds??[]);
      for(const q of collection.schema.questions){const input=fields.get(q.id)!;const eligible=visible.has(q.id)&&reached.has(q.id),shown=eligible&&currentQuestions.has(q.id);wrappers.get(q.id)!.hidden=!shown;input.disabled=!shown;input.required=shown&&!!q.required;
        if(!eligible&&advancedAnswers[q.id]!==undefined){delete advancedAnswers[q.id];changed=true;}
        if(!eligible&&(input.value!==''||(input instanceof HTMLSelectElement&&input.selectedOptions.length))){if(input instanceof HTMLSelectElement)Array.from(input.options).forEach(option=>option.selected=false);else input.value='';changed=true;}
        for(const radio of starFields.get(q.id)??[]){radio.disabled=!shown;radio.required=shown&&!!q.required;if(!eligible)radio.checked=false;}
        const other=q.options?.find(o=>o.other!==undefined),text=otherFields.get(q.id);if(other&&text){const selected=input instanceof HTMLSelectElement?Array.from(input.selectedOptions,o=>o.value):[];const selectedOther=eligible&&selected.includes(other.id),displayed=shown&&selectedOther;text.hidden=!displayed;text.disabled=!displayed;text.required=displayed;const otherLabel=text.previousElementSibling as HTMLElement|null;if(otherLabel)otherLabel.hidden=!displayed;if(!selectedOther){text.value='';text.setCustomValidity('');}}
      }if(!changed){const routeIndex=route.indexOf(currentPage);progress.textContent=messages.progress.replace('{current}',String(currentPage+1)).replace('{total}',String(pages.length));back.hidden=history.length<2;next.hidden=routeIndex<0||routeIndex+1>=route.length;submit.hidden=!next.hidden;break;}
    }
  };
  const validateSelections = () => {
    const answers=readAnswers(),visible=visibleQuestionIds(collection.schema.questions,answers),currentQuestions=new Set(pages[currentPage]?.questionIds??[]);
    for(const q of collection.schema.questions){if(!visible.has(q.id)||!currentQuestions.has(q.id)||!['ranking','matrix','constant_sum'].includes(q.type))continue;if(advancedAnswerError(q,answers[q.id])){status.setAttribute('role','alert');status.textContent=`${q.label}: ${messages.advancedError}`;status.focus();return false}}
    for(const q of collection.schema.questions){if(q.type!=='single_choice'&&q.type!=='multiple_choice')continue;
      const field=fields.get(q.id)!;const code=visible.has(q.id)&&currentQuestions.has(q.id)?choiceError(q,answers[q.id]):undefined;const min=Math.max(q.required?1:0,q.minSelections??0),max=q.maxSelections??q.options?.length??0;
      field.setCustomValidity(code&&code!=='required'?(code==='other'?messages.otherError:messages.selectionRange.replace('{min}',String(min)).replace('{max}',String(max))):'');
    }return true
  };
  back.addEventListener('click',()=>{if(history.length<2)return;history.pop();currentPage=history[history.length-1];refreshVisibility();});
  next.addEventListener('click',()=>{if(!validateSelections()||!form.reportValidity())return;const route=pageRoute(collection.schema,readAnswers()),at=route.indexOf(currentPage);if(at>=0&&at+1<route.length){currentPage=route[at+1];history=route.slice(0,at+2);refreshVisibility();}});
  const edited = () => {
    pending=undefined;
    for(const q of collection.schema.questions){if(q.type!=='multiple_choice')continue;const select=fields.get(q.id) as HTMLSelectElement;let selected=Array.from(select.selectedOptions,o=>o.value);const prior=previousSelections.get(q.id)??[],added=selected.filter(id=>!prior.includes(id));const exclusive=q.options?.find(o=>o.exclusive)?.id;
      if(exclusive&&selected.includes(exclusive)&&selected.length>1){selected=added.includes(exclusive)?[exclusive]:selected.filter(id=>id!==exclusive);for(const option of Array.from(select.options))option.selected=selected.includes(option.value);}previousSelections.set(q.id,selected);
    }
    refreshVisibility();validateSelections();
  };
  const setDisabled=(disabled:boolean)=>{for(const control of Array.from(form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|HTMLButtonElement>('input,select,textarea,button')))control.disabled=disabled;};
  form.addEventListener('input', edited); form.addEventListener('change', edited);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submit.disabled || completed) return;
    if(!validateSelections() || !form.reportValidity()) return;
    if (!pending) {
      const answers = routedAnswers(collection.schema,readAnswers());
      pending = {idempotencyKey: crypto.randomUUID(), answers, metadata};
    }
    submit.disabled = true; setDisabled(true); submit.textContent=messages.submitting; status.textContent = messages.submitting; status.setAttribute('role','status');
    active = new AbortController();
    try { const receipt = await client.submit(collection.id, pending, {signal: active.signal}); if (disposed) return; completed = true; submit.textContent=messages.submitted; status.textContent = messages.submitted; onComplete(receipt); }
    catch { if (!disposed) { status.setAttribute('role','alert'); status.textContent = messages.submissionError; status.focus(); } }
    finally { active = undefined; if (!disposed && !completed) { submit.disabled = false; submit.textContent=messages.submit; setDisabled(false); refreshVisibility(); } }
  });
  refreshVisibility(); container.append(form); return () => { disposed = true; active?.abort(); form.remove(); };
}
