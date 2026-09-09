export interface StructuredChoiceAnswer {selected:string[];otherText:Record<string,string>}
export type Answer = string | number | string[] | StructuredChoiceAnswer | Record<string,string|string[]> | Record<string,number>;
export type QuestionType = 'single_choice' | 'multiple_choice' | 'scale' | 'text' | 'number' | 'date' | 'ranking' | 'matrix' | 'constant_sum';
export type VisibilityOperator='equals'|'not_equals'|'includes'|'not_includes'|'answered'|'not_answered';
export interface VisibilityCondition {questionId:string;operator:VisibilityOperator;value?:string|number}
export interface PageBranch {when:VisibilityCondition;goToPageId:string}
export interface SurveyPage {id:string;title?:string;questionIds:string[];branches?:PageBranch[]}
export interface Choice {id:string;label:string;other?:{maxLength:number};exclusive?:true}
export interface PromptItem{id:string;label:string}
export interface Question { id: string; type: QuestionType; label: string; required?: boolean; options?: Choice[]; min?: number; max?: number; maxLength?: number; preset?: 'nps' | 'yes_no'; labels?: Record<string, string>; minSelections?: number; maxSelections?: number; visibleWhen?:VisibilityCondition; presentation?:'stars'|'dropdown';rows?:PromptItem[];columns?:Choice[];matrixMode?:'single'|'multiple';items?:PromptItem[];total?:number }
export interface Collection { id: string; surveyId: string; version: number; placement: string; schema: { schemaVersion: 1 | 2 | 3 | 4 | 5; title: string; questions: Question[]; pages?:SurveyPage[] } }
export interface Submission { idempotencyKey: string; answers: Record<string, Answer>; metadata: Record<string, unknown> }
export interface Receipt { responseId: string; collectionId: string; accepted: true; chargedCents: 1 }
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface CollectionRequestOptions extends RequestOptions { refresh?: boolean }
export const LIKERTS_SDK_CAPABILITY = Object.freeze({target:'react_native' as const,sdkVersion:'0.0.3',schemaVersions:[1,2,3,4,5] as const});
export class LikertsError extends Error { constructor(public status: number, public response: string) { super(`Likerts request failed (${status})`); } }
function safeBaseURL(value: string): string {
  const url = new URL(value); const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) throw new TypeError('Likerts base URL must use HTTPS (HTTP is limited to loopback development)');
  return value.replace(/\/$/, '');
}
/** Only a public collection credential belongs here. No administrative credentials. */
export class LikertsClient {
  private baseURL: string;
  private transport: typeof fetch;
  private collectionCache = new Map<string,{value:Collection;storedAt:number}>();
  constructor(baseURL: string, private token: string, transport: typeof fetch | undefined = undefined, private defaultTimeoutMs = 15000, private cacheMaxAgeMs = 300000) { this.baseURL = safeBaseURL(baseURL);this.transport=transport??((input,init)=>globalThis.fetch(input,init)); if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) throw new TypeError('timeoutMs must be positive'); if (!Number.isFinite(cacheMaxAgeMs) || cacheMaxAgeMs < 0) throw new TypeError('cacheMaxAgeMs must not be negative'); }
  private async request<T>(path: string, body?: Submission, options: RequestOptions = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs; if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');
    const controller = new AbortController(); const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => controller.abort(new Error('Likerts request timed out')), timeoutMs);
    try {
      const response = await this.transport(`${this.baseURL}${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${this.token}`, ...(body ? {'Content-Type': 'application/json'} : {}) }, ...(body ? {body: JSON.stringify(body)} : {}) });
      if (!response.ok) throw new LikertsError(response.status, await response.text());
      return await response.json() as T;
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }
  async collection(id: string, options: CollectionRequestOptions = {}): Promise<Collection> { const cached=this.collectionCache.get(id);if(!options.refresh&&cached&&Date.now()-cached.storedAt<this.cacheMaxAgeMs)return cached.value;
    try { const c=await this.request<Collection>(`/v1/collections/${encodeURIComponent(id)}`,undefined,options);if(![1,2,3,4,5].includes(c.schema.schemaVersion))throw new Error('Unsupported survey schema version');if(cached&&(cached.value.id!==c.id||cached.value.surveyId!==c.surveyId||cached.value.version!==c.version||cached.value.schema.schemaVersion!==c.schema.schemaVersion)){this.collectionCache.delete(id);throw new Error('Collection binding changed');}this.collectionCache.set(id,{value:c,storedAt:Date.now()});return c;}catch(error){this.collectionCache.delete(id);throw error;} }
  clearCollectionCache(id?:string):void{if(id)this.collectionCache.delete(id);else this.collectionCache.clear();}
  /** Retrying requires the same submission object, including its idempotencyKey. */
  async submit(id: string, submission: Submission, options?: RequestOptions): Promise<Receipt> { const receipt = await this.request<Receipt>(`/v1/collections/${encodeURIComponent(id)}/responses`, submission, options); if (receipt.accepted !== true || receipt.chargedCents !== 1) throw new Error('Invalid Likerts receipt'); return receipt; }
}
export function conditionMatches(condition:VisibilityCondition,answer:Answer|undefined):boolean{const selected=answer&&typeof answer==='object'&&!Array.isArray(answer)&&'selected'in answer&&Array.isArray(answer.selected)?answer.selected as string[]:undefined;const objectAnswer=answer&&typeof answer==='object'&&!Array.isArray(answer);const hasAnswer=answer!==undefined&&(typeof answer!=='string'||answer.trim()!=='')&&(!Array.isArray(answer)||answer.length>0)&&(!objectAnswer||(selected?selected.length>0:Object.keys(answer).length>0));if(condition.operator==='answered')return hasAnswer;if(condition.operator==='not_answered')return !hasAnswer;if(answer===undefined||answer==='')return false;const scalar=selected?.length===1?selected[0]:answer;if(condition.operator==='equals')return scalar===condition.value;if(condition.operator==='not_equals')return scalar!==condition.value;const values=selected??(Array.isArray(answer)?answer:undefined);if(!values)return false;if(condition.operator==='includes')return values.includes(String(condition.value));if(condition.operator==='not_includes')return !values.includes(String(condition.value));throw new Error('Unsupported visibility operator')}
export function visibleQuestionIds(questions:Question[],answers:Record<string,Answer>):Set<string>{const byId=new Map(questions.map(q=>[q.id,q]));const memo=new Map<string,boolean>();const active=new Set<string>();const visible=(q:Question):boolean=>{const prior=memo.get(q.id);if(prior!==undefined)return prior;if(active.has(q.id))throw new Error('Conditional visibility cycle');active.add(q.id);let result=true;if(q.visibleWhen){const source=byId.get(q.visibleWhen.questionId);if(!source)throw new Error('Conditional visibility references an unknown question');result=conditionMatches(q.visibleWhen,visible(source)?answers[source.id]:undefined)}active.delete(q.id);memo.set(q.id,result);return result};return new Set(questions.filter(visible).map(q=>q.id))}
export function visibleAnswers(questions:Question[],answers:Record<string,Answer>):Record<string,Answer>{const visible=visibleQuestionIds(questions,answers);return Object.fromEntries(Object.entries(answers).filter(([id])=>visible.has(id)))}
export {SurveyFlow,pageRoute,routedAnswers} from './branching';
export type {BranchingSchema,SurveyProgress} from './branching';
export {Survey} from './Survey';
export type {SurveyMessages, SurveyProps, SurveyStyles} from './Survey';
export {SurveyHost} from './SurveyHost';
export type {SurveyHostMessages, SurveyHostProps} from './SurveyHost';
