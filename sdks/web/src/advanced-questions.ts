export type RankingAnswer = string[];
export type MatrixAnswer = Record<string,string|string[]>;
export type ConstantSumAnswer = Record<string,number>;
export type AdvancedAnswer = RankingAnswer|MatrixAnswer|ConstantSumAnswer;
export interface AdvancedItem {id:string;label:string}
export interface AdvancedQuestion {
  type:string;required?:boolean;options?:AdvancedItem[];rows?:AdvancedItem[];columns?:AdvancedItem[];
  matrixMode?:'single'|'multiple';items?:AdvancedItem[];total?:number;
}
export type AdvancedAnswerError='required'|'ranking'|'matrix'|'constant_sum';

export const rankingOrder=(question:AdvancedQuestion,answer:unknown):string[]=>Array.isArray(answer)?answer.filter((id):id is string=>typeof id==='string'):(question.options??[]).map(option=>option.id);
export function moveRanking(question:AdvancedQuestion,answer:unknown,id:string,offset:-1|1):string[]{const order=rankingOrder(question,answer);const from=order.indexOf(id);if(from<0)return order;const to=Math.max(0,Math.min(order.length-1,from+offset));const next=[...order];next.splice(from,1);next.splice(to,0,id);return next}
export function setMatrixChoice(question:AdvancedQuestion,answer:unknown,rowId:string,columnId:string):MatrixAnswer {const current=answer&&typeof answer==='object'&&!Array.isArray(answer)?answer as MatrixAnswer:{};if(question.matrixMode==='single')return {...current,[rowId]:columnId};const selected=Array.isArray(current[rowId])?current[rowId] as string[]:[];const next=selected.includes(columnId)?selected.filter(id=>id!==columnId):[...selected,columnId];const result={...current};if(next.length)result[rowId]=next;else delete result[rowId];return result}
export function setAllocation(answer:unknown,itemId:string,value:number):ConstantSumAnswer {const current=answer&&typeof answer==='object'&&!Array.isArray(answer)?answer as ConstantSumAnswer:{};return {...current,[itemId]:value}}
export function allocationRemaining(question:AdvancedQuestion,answer:unknown):number {const values=answer&&typeof answer==='object'&&!Array.isArray(answer)?Object.values(answer as ConstantSumAnswer):[];return (question.total??0)-values.reduce((sum,value)=>sum+(Number.isSafeInteger(value)?value:0),0)}
export function advancedAnswerError(question:AdvancedQuestion,answer:unknown):AdvancedAnswerError|undefined {
  if(answer===undefined)return question.required?'required':undefined;
  if(question.type==='ranking'){const values=Array.isArray(answer)?answer:[];const ids=(question.options??[]).map(item=>item.id);return values.length===ids.length&&new Set(values).size===values.length&&values.every(id=>ids.includes(id))?undefined:'ranking'}
  if(!answer||typeof answer!=='object'||Array.isArray(answer))return question.type==='matrix'?'matrix':'constant_sum';
  const values=answer as Record<string,unknown>;
  if(question.type==='matrix'){const rows=(question.rows??[]).map(item=>item.id),columns=(question.columns??[]).map(item=>item.id),entries=Object.entries(values);if(!entries.length||question.required&&entries.length!==rows.length||entries.some(([row])=>!rows.includes(row)))return'matrix';const valid=entries.every(([,value])=>question.matrixMode==='single'?typeof value==='string'&&columns.includes(value):Array.isArray(value)&&value.length>0&&new Set(value).size===value.length&&value.every(id=>typeof id==='string'&&columns.includes(id)));return valid?undefined:'matrix'}
  const items=(question.items??[]).map(item=>item.id),entries=Object.entries(values);return entries.length===items.length&&entries.every(([id,value])=>items.includes(id)&&Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=(question.total??0))&&allocationRemaining(question,values)===0?undefined:'constant_sum';
}
