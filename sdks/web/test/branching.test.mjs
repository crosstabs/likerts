import assert from 'node:assert/strict';
import test from 'node:test';
import {SurveyFlow,pageRoute,routedAnswers} from '../dist/branching.js';
import fixture from '../../../contracts/branching-survey.example.json' with {type:'json'};

test('forward branches, Back history, progress and answer changes stay coherent',()=>{
  const schema={questions:fixture.questions,pages:fixture.pages};const flow=new SurveyFlow(schema);
  flow.setAnswer('return','no');assert.equal(flow.next(),true);assert.equal(flow.page.id,'recovery');assert.deepEqual(flow.progress,{current:3,total:4,visited:2});
  flow.setAnswer('problem','Long wait');assert.equal(flow.next(),true);assert.equal(flow.page.id,'contact');assert.equal(flow.back(),true);assert.equal(flow.page.id,'recovery');
  flow.back();flow.setAnswer('return','yes');assert.equal(flow.next(),true);assert.equal(flow.page.id,'praise');assert.ok(!('problem' in flow.answers));
});
test('answers from impossible skipped routes are removed',()=>{const schema={questions:fixture.questions,pages:fixture.pages};const answers={return:'no',highlight:'stale',problem:'Long wait'};assert.deepEqual(pageRoute(schema,answers),[0,2,3]);assert.deepEqual(routedAnswers(schema,answers),{return:'no',problem:'Long wait'});});
