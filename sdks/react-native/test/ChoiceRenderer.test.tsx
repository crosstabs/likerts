import React from 'react';
import {act,create,ReactTestRenderer} from 'react-test-renderer';
import {TextInput} from 'react-native';
import {Survey} from '../src/Survey';
import type {Collection} from '../src/index';
const fixture=require('../../../contracts/choice-survey.example.json');
const collection:Collection={id:'c',surveyId:'s',version:1,placement:'p',schema:{schemaVersion:3,...fixture}};

test('Other validates text, None clears it, stars remain numbers and dropdown stays collapsed',async()=>{
 const onSubmit=jest.fn();let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(<Survey collection={collection} onSubmit={onSubmit}/>)});
 const press=async(id:string)=>{await act(async()=>{tree.root.findAll(n=>!!n.props.accessibilityRole&&typeof n.props.onPress==='function').find(n=>n.props.testID===`likerts-survey-${id}`)!.props.onPress()})};
 await press('reasons-quality');await press('reasons-other');await press('rating-4');await press('submit');expect(onSubmit).not.toHaveBeenCalled();
 const other=()=>tree.root.findAllByType(TextInput).find(n=>n.props.testID==='likerts-survey-reasons-other-text')!;
 await act(async()=>other().props.onChangeText('Speed'));
 expect(tree.root.findAll(n=>!!n.props.accessibilityRole&&typeof n.props.onPress==='function').filter(n=>n.props.testID==='likerts-survey-channel-app')).toHaveLength(0);
 await press('channel-dropdown');await press('channel-app');await press('submit');expect(onSubmit).toHaveBeenLastCalledWith({reasons:{selected:['quality','other'],otherText:{other:'Speed'}},rating:4,channel:'app'});
 await press('reasons-none');expect(tree.root.findAllByType(TextInput).filter(n=>n.props.testID==='likerts-survey-reasons-other-text')).toHaveLength(0);await press('submit');expect(onSubmit).toHaveBeenLastCalledWith({reasons:{selected:['none'],otherText:{}},rating:4,channel:'app'});
 await press('reasons-quality');await press('reasons-other');expect(other().props.value).toBe('');
 await act(async()=>tree.unmount());
});
