import React from 'react';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import {AccessibilityInfo, Platform, Pressable, TextInput} from 'react-native';
import {Survey} from '../src/Survey';
import {SurveyHost} from '../src/SurveyHost';
import type {Collection} from '../src/index';
const conditionalFixture=require('../../../contracts/conditional-survey.example.json');
const branchingFixture=require('../../../contracts/branching-survey.example.json');
const collection:Collection={id:'c',surveyId:'s',version:1,placement:'checkout',schema:{schemaVersion:1,title:'Feedback',questions:[
{id:'single',type:'single_choice',label:'Single',options:[{id:'yes',label:'Yes'}]},
{id:'multi',type:'multiple_choice',label:'Multiple',options:[{id:'a',label:'A'}]},
{id:'scale',type:'scale',label:'Scale'}, {id:'text',type:'text',label:'Text'},
{id:'number',type:'number',label:'Number'}, {id:'date',type:'date',label:'Date'},
]}};
test('six types render and emit typed answers',async()=>{
 const onSubmit=jest.fn();let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<Survey collection={collection} onSubmit={onSubmit}/>);});
 const buttons=tree.root.findAll(node => typeof node.props.onPress === "function" && !!node.props.accessibilityRole);const fields=tree.root.findAllByType(TextInput);
 expect(fields).toHaveLength(4); expect(buttons).toHaveLength(3);
 await act(async()=>{buttons[0].props.onPress();buttons[1].props.onPress();fields[0].props.onChangeText('4');fields[1].props.onChangeText('Hello');fields[2].props.onChangeText('2.5');fields[3].props.onChangeText('2026-09-06');});
 await act(async()=>{tree.root.findAll(node => typeof node.props.onPress === "function" && !!node.props.accessibilityRole).at(-1)!.props.onPress();});
 expect(onSubmit).toHaveBeenCalledWith({single:'yes',multi:['a'],scale:4,text:'Hello',number:2.5,date:'2026-09-06'});
 await act(async()=>tree.unmount());
});
test('host submission state disables every control',async()=>{
 let tree!:ReactTestRenderer;await act(async()=>{tree=create(<Survey collection={collection} onSubmit={()=>{}} disabled/>);});
 const controls=tree.root.findAll(node => typeof node.props.onPress === "function" && !!node.props.accessibilityRole); expect(controls).toHaveLength(3); expect(controls.every(v=>v.props.accessibilityState?.disabled || v.props.disabled)).toBe(true);
 expect(tree.root.findAllByType(TextInput).every(v=>v.props.editable===false)).toBe(true);
 await act(async()=>tree.unmount());
});

test('enhanced controls preserve values and enforce selection bounds',async()=>{
 const enhanced:Collection={id:'c',surveyId:'s',version:1,placement:'test',schema:{schemaVersion:2,title:'Expanded',questions:[
 {id:'nps',type:'scale',preset:'nps',label:'Recommend?',required:true,min:0,max:10,labels:{'0':'Unlikely','10':'Very likely'}},
 {id:'yesno',type:'single_choice',preset:'yes_no',label:'Return?',required:true,options:[{id:'yes',label:'Yes'},{id:'no',label:'No'}]},
 {id:'multi',type:'multiple_choice',label:'Improve',required:true,minSelections:2,maxSelections:2,options:[{id:'a',label:'A'},{id:'b',label:'B'},{id:'c',label:'C'}]}
 ]}};
 const onSubmit=jest.fn();let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<Survey collection={enhanced} onSubmit={onSubmit}/>);});
 const button=(label:string)=>tree.root.findAll(n=>!!n.props.accessibilityRole&&typeof n.props.onPress==='function').find(n=>n.props.accessibilityLabel===label)!;
 const submit=()=>tree.root.findAll(n=>n.props.accessibilityRole==='button'&&typeof n.props.onPress==='function').at(-1)!;
 await act(async()=>{button('Recommend?: 10 — Very likely').props.onPress();button('Return?: Yes').props.onPress();button('Improve: A').props.onPress();});
 await act(async()=>submit().props.onPress());expect(onSubmit).not.toHaveBeenCalled();
 await act(async()=>button('Improve: B').props.onPress());expect(button('Improve: C').props.disabled).toBe(true);
 await act(async()=>submit().props.onPress());expect(onSubmit).toHaveBeenCalledWith({nps:10,yesno:'yes',multi:['a','b']});
 await act(async()=>tree.unmount());
});

test.each(['ios','android'])('%s host surface exposes accessible state, localization and styling',async platform=>{
 const originalPlatform=Platform.OS;Object.defineProperty(Platform,'OS',{value:platform,configurable:true});expect(Platform.OS).toBe(platform);
 const required:Collection={...collection,schema:{schemaVersion:1,title:'Required',questions:[{id:'q',type:'text',label:'Comment',required:true}]}};
 const onSubmit=jest.fn(),onValidationError=jest.fn(),onAnswersChange=jest.fn();let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<Survey collection={required} onSubmit={onSubmit} onValidationError={onValidationError} onAnswersChange={onAnswersChange} initialAnswers={{q:'seed'}} submitting messages={{requiredSuffix:'obligatoire',requiredError:'Réponse requise: {question}',submit:'Envoyer',submitting:'Envoi…'}} styles={{container:{padding:12},submit:{opacity:.5}}} testID={`survey-${platform}`}/>)});
 expect(tree.root.findAllByProps({testID:`survey-${platform}`}).find(node=>node.props.style)?.props.style).toEqual({padding:12});
 const input=tree.root.findByProps({testID:`survey-${platform}-q`});expect(input.props.accessibilityLabel).toBe('Comment, obligatoire');expect(input.props.accessibilityLabelledBy).toBe(`survey-${platform}-q-label`);expect(input.props.editable).toBe(false);expect(input.props.value).toBe('seed');
 const submit=tree.root.findByProps({testID:`survey-${platform}-submit`});expect(submit.props.accessibilityLabel).toBe('Envoi…');expect(submit.props.accessibilityState).toEqual({disabled:true,busy:true});
 await act(async()=>tree.unmount());
 Object.defineProperty(Platform,'OS',{value:originalPlatform,configurable:true});
});

test('collection identity resets host-observable answers and localized validation reports once',async()=>{
 const required:Collection={...collection,schema:{schemaVersion:1,title:'Required',questions:[{id:'q',type:'text',label:'Comment',required:true}]}};
 const onSubmit=jest.fn(),onValidationError=jest.fn(),onAnswersChange=jest.fn();let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<Survey collection={required} onSubmit={onSubmit} onValidationError={onValidationError} onAnswersChange={onAnswersChange} messages={{requiredError:'Missing {question}'}}/>)});
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-submit'}).props.onPress());expect(onValidationError).toHaveBeenCalledWith('Missing Comment');expect(tree.root.findByProps({testID:'likerts-survey-error'}).props.accessibilityLiveRegion).toBe('assertive');
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-q'}).props.onChangeText('saved'));expect(onAnswersChange).toHaveBeenLastCalledWith({q:'saved'});
 await act(async()=>tree.update(<Survey collection={{...required,id:'next'}} onSubmit={onSubmit} onValidationError={onValidationError} onAnswersChange={onAnswersChange}/>));expect(tree.root.findByProps({testID:'likerts-survey-q'}).props.value).toBe('');expect(onAnswersChange).toHaveBeenLastCalledWith({});
 await act(async()=>tree.unmount());
});

test('host adapter loads, preserves an ambiguous retry key and completes once',async()=>{
 const required:Collection={...collection,schema:{schemaVersion:1,title:'Hosted',questions:[{id:'q',type:'text',label:'Comment',required:true}]}};const submissions:any[]=[];let attempt=0;
 const client={collection:jest.fn(async()=>required),submit:jest.fn(async(_id,value)=>{submissions.push(value);if(attempt++===0)throw new Error('lost');return {responseId:'r',collectionId:'c',accepted:true}})} as any;
 let keyCounter=0;const onComplete=jest.fn(),onError=jest.fn(),createIdempotencyKey=jest.fn(()=>`key-${++keyCounter}`);let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<SurveyHost client={client} collectionId="c" createIdempotencyKey={createIdempotencyKey} onComplete={onComplete} onError={onError} messages={{submitError:'Retry safely'}}/>);});
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-q'}).props.onChangeText('answer'));
 await act(async()=>{tree.root.findByProps({testID:'likerts-survey-submit'}).props.onPress();});expect(tree.root.findByProps({testID:'likerts-host-error'}).props.children).toBe('Retry safely');
 await act(async()=>{tree.root.findByProps({testID:'likerts-survey-submit'}).props.onPress();});expect(createIdempotencyKey).toHaveBeenCalledTimes(1);expect(submissions[0].idempotencyKey).toBe(submissions[1].idempotencyKey);expect(onComplete).toHaveBeenCalledTimes(1);expect(tree.root.findByProps({testID:'likerts-survey-submit'}).props.disabled).toBe(true);
 await act(async()=>tree.unmount());
});

test('host adapter cancels collection load and active submission on unmount',async()=>{
 const controllerSignals:AbortSignal[]=[];let resolveCollection:(value:Collection)=>void=()=>{};const client={collection:jest.fn((_id,options)=>{controllerSignals.push(options.signal);return new Promise<Collection>(resolve=>resolveCollection=resolve)}),submit:jest.fn()} as any;let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<SurveyHost client={client} collectionId="c" createIdempotencyKey={()=> 'k'} onComplete={()=>{}}/>);});await act(async()=>tree.unmount());expect(controllerSignals[0].aborted).toBe(true);resolveCollection(collection);
});

test('host adapter aborts an in-flight submission when its screen unmounts',async()=>{
 let submitSignal:AbortSignal|undefined;const client={collection:jest.fn(async()=>collection),submit:jest.fn((_id,_value,options)=>{submitSignal=options.signal;return new Promise(()=>{})})} as any;let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<SurveyHost client={client} collectionId="c" createIdempotencyKey={()=> 'k'} onComplete={()=>{}}/>)});await act(async()=>tree.root.findByProps({testID:'likerts-survey-submit'}).props.onPress());expect(submitSignal?.aborted).toBe(false);await act(async()=>tree.unmount());expect(submitSignal?.aborted).toBe(true);
});

test('validation error is announced to assistive technology',async()=>{
 const announce=jest.spyOn(AccessibilityInfo,'announceForAccessibility').mockImplementation(()=>{});const required:Collection={...collection,schema:{schemaVersion:1,title:'Required',questions:[{id:'q',type:'text',label:'Comment',required:true}]}};let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<Survey collection={required} onSubmit={()=>{}}/>)});await act(async()=>tree.root.findByProps({testID:'likerts-survey-submit'}).props.onPress());expect(announce).toHaveBeenCalledWith('Comment: an answer is required.');announce.mockRestore();await act(async()=>tree.unmount());
});

test('optional selections omitted; selected values below minimum do not submit',async()=>{
 const c:Collection={...collection,schema:{schemaVersion:2,title:'Optional',questions:[{id:'q',type:'multiple_choice',label:'Choose',minSelections:2,maxSelections:2,options:[{id:'a',label:'A'},{id:'b',label:'B'}]}]}};
 const onSubmit=jest.fn();let tree!:ReactTestRenderer;await act(async()=>{tree=create(<Survey collection={c} onSubmit={onSubmit}/>);});
 const controls=()=>tree.root.findAll(n=>!!n.props.accessibilityRole&&typeof n.props.onPress==='function');
 await act(async()=>controls().at(-1)!.props.onPress());expect(onSubmit).toHaveBeenLastCalledWith({});onSubmit.mockClear();
 await act(async()=>controls()[0].props.onPress());await act(async()=>controls().at(-1)!.props.onPress());expect(onSubmit).not.toHaveBeenCalled();
 await act(async()=>tree.unmount());
});

test('missing required answer shows feedback and blocks callback',async()=>{
 const required:Collection={...collection,schema:{schemaVersion:1,title:'Required',questions:[{id:'q',type:'text',label:'Comment',required:true}]}};
 const onSubmit=jest.fn();let tree!:ReactTestRenderer;await act(async()=>{tree=create(<Survey collection={required} onSubmit={onSubmit}/>);});
 await act(async()=>tree.root.findByProps({accessibilityRole:'button'}).props.onPress());
 expect(onSubmit).not.toHaveBeenCalled();expect(tree.root.findByProps({accessibilityRole:'alert'}).props.children).toBe('Comment: an answer is required.');
 await act(async()=>tree.unmount());
});

test('conditional questions discard hidden answers and require only visible questions',async()=>{
 const conditional:Collection={...collection,schema:{schemaVersion:3,...conditionalFixture}};
 const onSubmit=jest.fn(),onAnswersChange=jest.fn();let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<Survey collection={conditional} onSubmit={onSubmit} onAnswersChange={onAnswersChange}/>)});
 expect(tree.root.findAllByType(TextInput).filter(node=>node.props.testID==='likerts-survey-reason')).toHaveLength(0);
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-return-no'}).props.onPress());
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-reason'}).props.onChangeText('late'));
 expect(tree.root.findAllByType(TextInput).filter(node=>node.props.testID==='likerts-survey-contactDate')).toHaveLength(1);
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-return-yes'}).props.onPress());
 expect(tree.root.findAllByType(TextInput).filter(node=>node.props.testID==='likerts-survey-reason')).toHaveLength(0);expect(onAnswersChange).toHaveBeenLastCalledWith({return:'yes'});
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-submit'}).props.onPress());expect(onSubmit).toHaveBeenCalledWith({return:'yes'});
 await act(async()=>tree.unmount());
});
test('paged renderer uses reached pages, actual Back history and prunes changed branches',async()=>{
 const branching:Collection={...collection,schema:{schemaVersion:4,...branchingFixture}};
 const onSubmit=jest.fn(),onAnswersChange=jest.fn();let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<Survey collection={branching} onSubmit={onSubmit} onAnswersChange={onAnswersChange}/>)});
 expect(tree.root.findByProps({testID:'likerts-survey-progress'}).props.children).toBe('Page 1 of 4');
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-return-yes'}).props.onPress());
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-next'}).props.onPress());
 expect(tree.root.findByProps({testID:'likerts-survey-progress'}).props.children).toBe('Page 2 of 4');
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-highlight'}).props.onChangeText('Friendly'));
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-back'}).props.onPress());
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-return-no'}).props.onPress());
 expect(onAnswersChange).toHaveBeenLastCalledWith({return:'no'});
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-next'}).props.onPress());
 expect(tree.root.findByProps({testID:'likerts-survey-progress'}).props.children).toBe('Page 3 of 4');
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-problem'}).props.onChangeText('Queue'));
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-next'}).props.onPress());
 await act(async()=>tree.root.findByProps({testID:'likerts-survey-submit'}).props.onPress());
 expect(onSubmit).toHaveBeenCalledWith({return:'no',problem:'Queue'});
 await act(async()=>tree.unmount());
});
