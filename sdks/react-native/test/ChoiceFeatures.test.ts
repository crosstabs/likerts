import {choiceError,toggleChoice,setOtherText} from '../src/choice-features';
import type {Question} from '../src/index';
const fixture=require('../../../contracts/choice-features.json');
test('shared Other/None acceptance values',()=>{const q:Question=fixture.question;for(const value of fixture.valid)expect(choiceError(q,value)).toBeUndefined();for(const value of fixture.invalid)expect(choiceError(q,value)).toBeDefined()});
test('exclusive selection clears Other text and can be replaced',()=>{const q:Question=fixture.question;let value=toggleChoice(q,fixture.valid[0],'none');expect(value).toEqual({selected:['none'],otherText:{}});value=toggleChoice(q,value,'quality');value=toggleChoice(q,value,'other');expect(choiceError(q,value)).toBe('other');value=setOtherText(q,value,'other','Speed');expect(choiceError(q,value)).toBeUndefined()});
