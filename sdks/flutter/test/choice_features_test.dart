import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:likerts/likerts.dart';
import 'package:likerts/choice_features.dart';
void main(){
 final fixture=jsonDecode(File('../../contracts/choice-features.json').readAsStringSync());
 final q=Question.fromJson(fixture['question']);
 test('shared Other and None acceptance values',(){for(final value in fixture['valid']){expect(choiceError(q,value),isNull,reason:jsonEncode(value));}for(final value in fixture['invalid']){expect(choiceError(q,value),isNotNull,reason:jsonEncode(value));}});
 test('None clears Other text and ordinary selection replaces None',(){var value=toggleChoice(q,fixture['valid'][0],'none');expect(value,{'selected':['none'],'otherText':{}});value=toggleChoice(q,value,'quality');value=toggleChoice(q,value,'other');expect(choiceError(q,value),'other');value=setOtherText(q,value,'other','Speed');expect(choiceError(q,value),isNull);});
}
