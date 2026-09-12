import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:likerts/likerts.dart';
import 'package:likerts/survey.dart';

void main() {
  testWidgets('pages validate locally, Back follows the route, branch changes prune answers', (tester) async {
    final fixture = jsonDecode(File('../../contracts/branching-survey.example.json').readAsStringSync());
    final collection = Collection.fromJson({'id':'c','surveyId':'s','version':1,'placement':'p','schema':{'schemaVersion':4,...fixture}});
    final submitted = <Map<String,dynamic>>[];
    final changes = <Map<String,dynamic>>[];
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:LikertsSurvey(collection:collection,onSubmit:submitted.add,onAnswersChange:changes.add)))));
    Future<void> tap(String key) async { final finder=find.byKey(ValueKey(key)); await tester.ensureVisible(finder); await tester.tap(finder); await tester.pumpAndSettle(); }
    Future<void> type(String id,String value) async {final finder=find.byKey(ValueKey('c:1:$id'));await tester.ensureVisible(finder);await tester.enterText(finder,value);tester.testTextInput.hide();await tester.pumpAndSettle();}
    expect(find.text('Page 1 of 4 · 1 visited'),findsOneWidget);
    expect(find.byKey(const ValueKey('likerts.question.highlight')),findsNothing);
    await tap('likerts.next');expect(find.byKey(const ValueKey('likerts.error')),findsOneWidget);
    await tap('likerts.option.return.yes');await tap('likerts.next');
    expect(find.text('Page 2 of 4 · 2 visited'),findsOneWidget);
    await tap('likerts.next');expect(find.byKey(const ValueKey('likerts.error')),findsOneWidget);
    await type('highlight','Friendly staff');await tap('likerts.next');
    expect(find.text('Page 4 of 4 · 3 visited'),findsOneWidget);
    expect(find.byKey(const ValueKey('likerts.question.problem')),findsNothing);
    await tap('likerts.back');expect(find.text('Page 2 of 4 · 2 visited'),findsOneWidget);
    expect(tester.widget<TextFormField>(find.byKey(const ValueKey('c:1:highlight'))).initialValue,'Friendly staff');
    await tap('likerts.back');await tap('likerts.option.return.no');
    expect(changes.last.containsKey('highlight'),isFalse);
    await tap('likerts.next');expect(find.text('Page 3 of 4 · 2 visited'),findsOneWidget);
    await tap('likerts.next');expect(find.byKey(const ValueKey('likerts.error')),findsOneWidget);
    await type('problem','Long wait');await tap('likerts.next');await tap('likerts.submit');
    expect(submitted.single,{'return':'no','problem':'Long wait'});
    await tap('likerts.back');expect(find.text('Page 3 of 4 · 2 visited'),findsOneWidget);
  });
}
