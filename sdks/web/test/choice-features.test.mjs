import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {choiceError, toggleChoice, setOtherText, selectedChoices, otherTexts} from '../dist/choice-features.js';
const fixture=JSON.parse(fs.readFileSync(new URL('../../../contracts/choice-features.json',import.meta.url)));
test('Other and exclusive answers match the shared backend acceptance values',()=>{
 for(const value of fixture.valid) assert.equal(choiceError(fixture.question,value),undefined,JSON.stringify(value));
 for(const value of fixture.invalid) assert.notEqual(choiceError(fixture.question,value),undefined,JSON.stringify(value));
});
test('switching to None and back removes stale Other text',()=>{
 const q=fixture.question;
 let answer=toggleChoice(q,fixture.valid[0],'none');
 assert.deepEqual(answer,{selected:['none'],otherText:{}});
 answer=toggleChoice(q,answer,'quality');
 assert.deepEqual(selectedChoices(answer),['quality']);
 answer=toggleChoice(q,answer,'other');assert.equal(choiceError(q,answer),'other');
 answer=setOtherText(q,answer,'other','Speed');assert.equal(choiceError(q,answer),undefined);
 answer=toggleChoice(q,answer,'other');assert.deepEqual(otherTexts(answer),{});
});

import {JSDOM} from 'jsdom';
import {mountSurvey} from '../dist/index.js';
test('renderer sends structured Other, renders numeric stars, and keeps dropdown IDs',async()=>{
 const schema=JSON.parse(fs.readFileSync(new URL('../../../contracts/choice-survey.example.json',import.meta.url)));const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.HTMLSelectElement=dom.window.HTMLSelectElement;
 const calls=[];const cleanup=mountSurvey(document.querySelector('main'),{id:'c',surveyId:'s',version:1,placement:'p',schema:{schemaVersion:3,...schema}},{submit:async(_id,value)=>{calls.push(value);return {responseId:'r',collectionId:'c',accepted:true}}},()=>{});
 const form=document.querySelector('form'),select=form.elements.reasons,other=form.elements['reasons.otherText'];
 const change=()=>form.dispatchEvent(new dom.window.Event('change'));const submit=async()=>{form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));};
 select.options[0].selected=true;select.options[2].selected=true;change();assert.equal(other.hidden,false);
 const four=form.querySelector('input[type=radio][value="4"]');four.checked=true;four.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(four.getAttribute('aria-label'),'4');assert.match(four.parentElement.textContent,/★★★★/);
 form.elements.channel.value='app';await submit();assert.equal(calls.length,0);
 other.value='Speed';other.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await submit();assert.deepEqual(calls[0].answers,{reasons:{selected:['quality','other'],otherText:{other:'Speed'}},rating:4,channel:'app'});
 assert.equal(other.disabled,true);assert.equal(four.disabled,true);cleanup();dom.window.close();
});
test('renderer None replaces ordinary choices and removes stale Other text',()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;globalThis.HTMLSelectElement=dom.window.HTMLSelectElement;
 const cleanup=mountSurvey(document.querySelector('main'),{id:'c',surveyId:'s',version:1,placement:'p',schema:{schemaVersion:3,title:'Choices',questions:[fixture.question]}},{submit:async()=>{}},()=>{});
 const form=document.querySelector('form'),select=form.elements.reasons,other=form.elements['reasons.otherText'];const change=()=>form.dispatchEvent(new dom.window.Event('change'));
 select.options[0].selected=true;select.options[2].selected=true;change();other.value='Speed';select.options[3].selected=true;change();assert.deepEqual(Array.from(select.selectedOptions,o=>o.value),['none']);assert.equal(other.value,'');assert.equal(other.hidden,true);assert.equal(select.checkValidity(),true);
 select.options[0].selected=true;change();assert.deepEqual(Array.from(select.selectedOptions,o=>o.value),['quality']);cleanup();dom.window.close();
});
