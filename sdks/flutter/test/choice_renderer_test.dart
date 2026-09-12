import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:likerts/likerts.dart';
import 'package:likerts/survey.dart';

void main(){
 testWidgets('Other, None, stars and dropdown preserve semantic answers', (tester) async {
  final fixture=jsonDecode(File('../../contracts/choice-survey.example.json').readAsStringSync());
  final collection=Collection.fromJson({'id':'c','surveyId':'s','version':1,'placement':'p','schema':{'schemaVersion':3,...fixture}});
  final submitted=<Map<String,dynamic>>[];
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:LikertsSurvey(collection:collection,onSubmit:submitted.add)))));
  Future<void> tap(String key) async {final finder=find.byKey(ValueKey(key));await tester.ensureVisible(finder);await tester.tap(finder);await tester.pumpAndSettle();}
  await tap('likerts.option.reasons.quality');await tap('likerts.option.reasons.other');await tap('likerts.option.rating.4');await tap('likerts.submit');expect(submitted,isEmpty);
  final other=find.byKey(const ValueKey('c:1:reasons:other:other'));
  await tester.ensureVisible(other);await tester.enterText(other,'Speed');tester.testTextInput.hide();await tester.pumpAndSettle();
  await tap('likerts.dropdown.channel');await tester.tap(find.text('App').last);await tester.pumpAndSettle();
  await tap('likerts.submit');expect(submitted.last,{'reasons':{'selected':['quality','other'],'otherText':{'other':'Speed'}},'rating':4,'channel':'app'});
  await tap('likerts.option.reasons.none');expect(other,findsNothing);await tap('likerts.submit');expect(submitted.last['reasons'],{'selected':['none'],'otherText':{}});
  await tap('likerts.option.reasons.quality');await tap('likerts.option.reasons.other');expect(tester.widget<TextFormField>(other).initialValue,'');
 });
}
