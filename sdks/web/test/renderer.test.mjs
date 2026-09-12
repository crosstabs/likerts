import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {mountSurvey, LikertsClient} from '../dist/index.js';
const fixture=JSON.parse(readFileSync(new URL('../../../contracts/expanded-survey.example.json',import.meta.url)));
const collection={id:'c',surveyId:'s',version:1,placement:'test',schema:{schemaVersion:2,...fixture}};
function setup(c=collection){
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.HTMLSelectElement=dom.window.HTMLSelectElement;
 const calls=[];const client={submit:async(id,value)=>{calls.push(value);return {responseId:'r',collectionId:id,accepted:true}}};
 const cleanup=mountSurvey(document.querySelector('main'),c,client,()=>{});
 return {dom,calls,cleanup,form:document.querySelector('form')};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('enhanced renderer shows labels, keeps numeric NPS and string yes/no, enforces limits',async()=>{
 const {dom,calls,cleanup,form}=setup();
 assert.match(form.textContent,/0 — Not at all likely/);assert.match(form.textContent,/5 — Strongly agree/);
 form.elements.recommend.value='9';form.elements.easy.value='4';form.elements.return.value='yes';
 const options=Array.from(form.elements.improvements.options);options.forEach(o=>o.selected=true);
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();assert.equal(calls.length,0);assert.equal(form.elements.improvements.checkValidity(),false);
 options[2].selected=false;
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();assert.equal(calls.length,1);
 assert.deepEqual(calls[0].answers,{recommend:9,easy:4,return:'yes',improvements:['speed','payment']});
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();assert.equal(calls.length,1);
 cleanup();dom.window.close();
});
test('optional selection can be omitted; partial selection below min is rejected',async()=>{
 const c={...collection,schema:{schemaVersion:2,title:'Optional',questions:[{...fixture.questions[3],required:false,minSelections:2,maxSelections:2}]}};
 const first=setup(c);first.form.elements.improvements.options[0].selected=true;
 first.form.dispatchEvent(new first.dom.window.Event('submit',{cancelable:true}));await flush();assert.equal(first.calls.length,0);
 first.form.elements.improvements.options[0].selected=false;
 first.form.dispatchEvent(new first.dom.window.Event('submit',{cancelable:true}));await flush();assert.deepEqual(first.calls[0].answers,{});
 first.cleanup();first.dom.window.close();
});
test('required validation blocks submit and cleanup suppresses late completion',async()=>{
 const c={...collection,schema:{schemaVersion:1,title:'Required',questions:[{id:'required',type:'text',label:'Required',required:true}]}};
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.HTMLSelectElement=dom.window.HTMLSelectElement;
 let finish;const completion=[];const calls=[];
 const client={submit:(_id,value)=>{calls.push(value);return new Promise(resolve=>{finish=resolve;});}};
 const cleanup=mountSurvey(document.querySelector('main'),c,client,value=>completion.push(value));const form=document.querySelector('form');
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();assert.equal(calls.length,0);
 form.elements.required.value='ok';form.dispatchEvent(new dom.window.Event('input'));form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();assert.equal(calls.length,1);
 cleanup();finish({responseId:'r',collectionId:'c',accepted:true});await flush();assert.equal(completion.length,0);
 dom.window.close();
});
test('new client accepts baseline, enhanced and conditional schemas, rejects future versions',async()=>{
 for(const version of [1,2,3,4,5,6]){
 const client=new LikertsClient('https://example.test','token',async()=>Response.json({...collection,schema:{...collection.schema,schemaVersion:version}}));
 if(version===6)await assert.rejects(()=>client.collection('c'),/Unsupported/);else assert.equal((await client.collection('c')).schema.schemaVersion,version);
 }
});
test('conditional questions hide, discard stale answers and enforce requiredness only when visible',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('../../../contracts/conditional-survey.example.json',import.meta.url)));
 const c={...collection,schema:{schemaVersion:3,...fixture}};const first=setup(c);
 assert.equal(first.form.querySelector('[data-likerts-question=reason]').hidden,true);
 first.form.elements.return.value='no';first.form.dispatchEvent(new first.dom.window.Event('change'));assert.equal(first.form.querySelector('[data-likerts-question=reason]').hidden,false);
 first.form.elements.reason.value='late';first.form.dispatchEvent(new first.dom.window.Event('input'));assert.equal(first.form.querySelector('[data-likerts-question=contactDate]').hidden,false);
 first.form.elements.return.value='yes';first.form.dispatchEvent(new first.dom.window.Event('change'));assert.equal(first.form.elements.reason.value,'');assert.equal(first.form.querySelector('[data-likerts-question=contactDate]').hidden,true);
 first.form.dispatchEvent(new first.dom.window.Event('submit',{cancelable:true}));await flush();assert.deepEqual(first.calls[0].answers,{return:'yes'});
 first.cleanup();first.dom.window.close();
});
test('paged renderer follows actual Back history and validates only the current page',async()=>{
 const c={...collection,schema:{schemaVersion:4,title:'Pages',questions:[
  {id:'first',type:'text',label:'First',required:true},
  {id:'future',type:'number',label:'Future',required:true,min:5}
 ],pages:[{id:'one',questionIds:['first']},{id:'two',questionIds:['future']}]}};
 const view=setup(c);const {form,dom}=view;
 assert.equal(form.elements.first.disabled,false);assert.equal(form.elements.future.disabled,true);
 form.elements.first.value='ok';form.dispatchEvent(new dom.window.Event('input'));
 form.querySelector('[data-likerts-next]').click();assert.equal(form.elements.future.disabled,false);
 form.elements.future.value='1';form.dispatchEvent(new dom.window.Event('input'));
 form.querySelector('[data-likerts-back]').click();assert.equal(form.elements.future.disabled,true);
 form.querySelector('[data-likerts-next]').click();assert.equal(form.elements.future.disabled,false);
 form.elements.future.value='5';form.dispatchEvent(new dom.window.Event('input'));
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();assert.deepEqual(view.calls[0].answers,{first:'ok',future:5});
 view.cleanup();dom.window.close();
});
test('exposes accessible structure, stable styling hooks and localized copy',async()=>{
 const c={...collection,schema:{schemaVersion:1,title:'Localized',questions:[{id:'choice',type:'single_choice',label:'Pick one',required:true,options:[{id:'a',label:'A'}]}]}};
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.HTMLSelectElement=dom.window.HTMLSelectElement;
 const cleanup=mountSurvey(document.querySelector('main'),c,{submit:async()=>({responseId:'r',collectionId:'c',accepted:true})},()=>{}, {}, {messages:{selectPlaceholder:'Choisissez',submit:'Envoyer'},classNames:{form:'customer-form',control:'customer-control'}});
 const form=document.querySelector('form'),input=form.elements.choice,label=document.querySelector('label');
 assert.equal(form.getAttribute('aria-labelledby'),document.querySelector('h2').id);
 assert.equal(form.getAttribute('aria-describedby'),document.querySelector('[role=status]').id);
 assert.equal(label.htmlFor,input.id);assert.equal(input.labels[0],label);
 assert.equal(input.options[0].textContent,'Choisissez');assert.equal(form.querySelector('button').textContent,'Envoyer');
 assert.equal(form.classList.contains('likerts-form'),true);assert.equal(form.classList.contains('customer-form'),true);
 assert.equal(input.classList.contains('likerts-control'),true);assert.equal(input.classList.contains('customer-control'),true);
 assert.equal(document.querySelector('[data-likerts-question=choice]').dataset.likertsType,'single_choice');
 cleanup();dom.window.close();
});
test('localized server failure becomes a focused alert and retry preserves key',async()=>{
 const c={...collection,schema:{schemaVersion:1,title:'Retry',questions:[{id:'answer',type:'text',label:'Answer'}]}};
 const dom=new JSDOM('<main></main>',{pretendToBeVisual:true});globalThis.document=dom.window.document;globalThis.HTMLSelectElement=dom.window.HTMLSelectElement;
 const calls=[];const client={submit:async(_id,value)=>{calls.push(value);if(calls.length===1)throw new Error('lost');return {responseId:'r',collectionId:'c',accepted:true}}};
 const cleanup=mountSurvey(document.querySelector('main'),c,client,()=>{}, {}, {messages:{submissionError:'Réessayez',submit:'Envoyer',submitting:'Envoi',submitted:'Envoyé'}});const form=document.querySelector('form');form.elements.answer.value='ok';
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();const status=document.querySelector('.likerts-status');assert.equal(status.textContent,'Réessayez');assert.equal(status.getAttribute('role'),'alert');assert.equal(document.activeElement,status);
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();assert.equal(calls.length,2);assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);assert.equal(form.querySelector('button').textContent,'Envoyé');
 cleanup();dom.window.close();
});
