import 'dart:convert';
import 'dart:io';
import 'dart:async';
import 'dart:ui' show SemanticsFlag;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:likerts/likerts.dart';
import 'package:likerts/survey.dart';
import 'package:likerts/visibility.dart';

void main() {
  test('shared behavior contract fixture',(){
    final value=jsonDecode(File('../../contracts/sdk-behavior.json').readAsStringSync());
    expect(value['contractVersion'],1);expect(value['scenarios'],hasLength(9));
  });
  test('declares capability and refreshes immutable cached binding',() async {
    final compatibility=jsonDecode(File('../../contracts/sdk-compatibility.json').readAsStringSync());expect(likertsSdkCapability,compatibility['currentFleet']['installations'][4]);
    var calls=0;var version=1;final client=LikertsClient(baseUrl:'https://example.test',collectionToken:'t',client:MockClient((_) async {calls++;return http.Response(jsonEncode({'id':'c','surveyId':'s','version':version,'placement':'p','schema':{'schemaVersion':1,'title':'T','questions':[]}}),200);}));
    await client.collection('c');await client.collection('c');expect(calls,1);await client.collection('c',refresh:true);expect(calls,2);version=2;await expectLater(client.collection('c',refresh:true),throwsFormatException);version=1;await client.collection('c');expect(calls,4);client.close();
  });
  // SDK-CONTRACT: schema.unknown
  test('expanded shared fixture and future schema rejection', () {
    final schema = jsonDecode(File('../../contracts/expanded-survey.example.json').readAsStringSync()) as Map<String,dynamic>;
    schema['schemaVersion'] = 2;
    final payload = {'id':'c','surveyId':'s','version':1,'placement':'checkout','schema':schema};
    final collection = Collection.fromJson(payload);
    expect(collection.questions[0].scaleValues,List.generate(11,(i)=>i));
    expect(collection.questions[1].scaleLabel(1),'1 — Strongly disagree');
    expect(collection.questions[2].preset,'yes_no');
    expect(collection.questions[3].maxSelections,2);
    schema['schemaVersion'] = 6;
    expect(() => Collection.fromJson(payload),throwsFormatException);
  });
  testWidgets('conditional questions discard hidden answers and require only while visible',(tester) async {
    final fixture=jsonDecode(File('../../contracts/conditional-survey.example.json').readAsStringSync()) as Map<String,dynamic>;
    final collection=Collection.fromJson({'id':'conditional','surveyId':'s','version':1,'placement':'p','schema':{'schemaVersion':3,...fixture}});Map<String,dynamic>? result;
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:LikertsSurvey(collection:collection,onSubmit:(value)=>result=value)))));
    expect(find.byKey(const ValueKey('conditional:1:reason')),findsNothing);
    await tester.tap(find.byKey(const ValueKey('likerts.option.return.no')));await tester.pump();await tester.enterText(find.byKey(const ValueKey('conditional:1:reason')),'late');await tester.pump();expect(find.byKey(const ValueKey('conditional:1:contactDate')),findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('likerts.option.return.yes')));await tester.pump();expect(find.byKey(const ValueKey('conditional:1:reason')),findsNothing);
    await tester.ensureVisible(find.byKey(const ValueKey('likerts.submit')));await tester.tap(find.byKey(const ValueKey('likerts.submit')));expect(result,{'return':'yes'});
    expect(visibleQuestionIds(collection.questions,{'return':'no','reason':'   '}).contains('contactDate'),false);
  });
  testWidgets('enhanced scales, yes/no and selection bounds', (tester) async {
    // SDK-CONTRACT: validation.selection-bounds
    final collection = Collection.fromJson({'id':'expanded','surveyId':'s','version':1,'placement':'checkout','schema':{'schemaVersion':2,'title':'Expanded','questions':[
      {'id':'n','type':'scale','label':'Recommend','preset':'nps','min':0,'max':10,'labels':{'0':'Unlikely','10':'Likely'}},
      {'id':'y','type':'single_choice','label':'Yes?','preset':'yes_no','options':[{'id':'yes','label':'Yes'},{'id':'no','label':'No'}]},
      {'id':'m','type':'multiple_choice','label':'Pick','minSelections':2,'maxSelections':2,'options':[{'id':'a','label':'A'},{'id':'b','label':'B'},{'id':'c','label':'C'}]},
    ]}});
    final q = collection.questions[2];
    expect(q.selectionError(null),isNull); expect(q.selectionError([]),isNotNull); expect(q.selectionError(['a']),isNotNull); expect(q.selectionError(['a','b']),isNull); expect(q.selectionError(['a','b','c']),isNotNull);
    Map<String,dynamic>? result;
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:LikertsSurvey(collection:collection,onSubmit:(answers){result=answers;})))));
    expect(find.byType(ChoiceChip),findsNWidgets(11));
    await tester.tap(find.text('10 — Likely')); await tester.tap(find.text('Yes')); await tester.tap(find.text('A')); await tester.pump();
    await tester.ensureVisible(find.text('Submit')); await tester.tap(find.text('Submit')); await tester.pump(); expect(result,isNull); expect(find.text('Choose at least 2 options'),findsOneWidget);
    await tester.ensureVisible(find.text('B')); await tester.tap(find.text('B')); await tester.pump();
    final c = tester.widget<CheckboxListTile>(find.ancestor(of:find.text('C'),matching:find.byType(CheckboxListTile))); expect(c.onChanged,isNull);
    await tester.ensureVisible(find.text('Submit')); await tester.tap(find.text('Submit')); expect(result,{'n':10,'y':'yes','m':['a','b']});
  });

  test('retry preserves serialized submission key and payload', () async {
    // SDK-CONTRACT: retry.ambiguous
    final bodies = <String>[];
    final client = LikertsClient(baseUrl: 'https://example.test', collectionToken: 'public', client: MockClient((request) async {
      expect(request.headers['Authorization'], 'Bearer public'); bodies.add(request.body);
      if(bodies.length == 1) throw Exception('connection lost');
      return http.Response(jsonEncode({'responseId':'r','collectionId':'c','accepted':true}),200);
    }));
    final submission = Submission(idempotencyKey: 'stable-key', answers: {'q':4});
    await expectLater(client.submit('c',submission), throwsException);
    expect((await client.submit('c',submission)).accepted,true);
    expect(bodies[0],bodies[1]); client.close();
  });
  testWidgets('all six question types render and preserve answer types', (tester) async {
    // SDK-CONTRACT: callback.success
    final collection=Collection.fromJson({'id':'c','surveyId':'s','version':1,'placement':'checkout','schema':{'schemaVersion':1,'title':'Feedback','questions':[
      {'id':'single','type':'single_choice','label':'Single','options':[{'id':'yes','label':'Yes'}]},
      {'id':'multi','type':'multiple_choice','label':'Multiple','options':[{'id':'a','label':'A'}]},
      {'id':'scale','type':'scale','label':'Scale'}, {'id':'text','type':'text','label':'Text'},
      {'id':'number','type':'number','label':'Number'}, {'id':'date','type':'date','label':'Date'},
    ]}});
    Map<String,dynamic>? result;
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:LikertsSurvey(collection:collection,onSubmit:(answers){result=answers;})))));
    await tester.tap(find.text('Yes')); await tester.tap(find.text('A'));
    final fields=find.byType(TextFormField);
    await tester.enterText(fields.at(0),'4'); await tester.enterText(fields.at(1),'Hello'); await tester.enterText(fields.at(2),'2.5'); await tester.enterText(fields.at(3),'2026-09-06');
    await tester.ensureVisible(find.text('Submit')); await tester.tap(find.text('Submit'));
    expect(result,{'single':'yes','multi':['a'],'scale':4,'text':'Hello','number':2.5,'date':'2026-09-06'});
  });

  // SDK-CONTRACT: validation.required
  testWidgets('required answer blocks callback with feedback',(tester) async {
    final collection=Collection.fromJson({'id':'c','surveyId':'s','version':1,'placement':'test','schema':{'schemaVersion':1,'title':'Required','questions':[{'id':'q','type':'text','label':'Comment','required':true}]}});
    var calls=0;await tester.pumpWidget(MaterialApp(home:Scaffold(body:LikertsSurvey(collection:collection,onSubmit:(_){calls++;}))));
    await tester.tap(find.text('Submit'));await tester.pump();expect(calls,0);expect(find.text('Comment: an answer is required.'),findsOneWidget);
  });

  testWidgets('localized semantics, styling and immutable-version lifecycle', (tester) async {
    Collection collection(int version) => Collection.fromJson({'id':'c','surveyId':'s','version':version,'placement':'test','schema':{'schemaVersion':2,'title':'Feedback','questions':[
      {'id':'choice','type':'single_choice','label':'Choice','options':[{'id':'yes','label':'Yes'},{'id':'no','label':'No'}]},
      {'id':'comment','type':'text','label':'Comment','required':true},
    ]}});
    var current = collection(1);
    final changes = <Map<String,dynamic>>[];
    late StateSetter updateHost;
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:StatefulBuilder(builder:(context,setState){
      updateHost=setState;
      return LikertsSurvey(
        collection:current,
        strings:LikertsSurveyStrings(requiredLabel:'obligatorio',submitLabel:'Enviar',answerRequired:(label)=>'Falta: $label'),
        style:const LikertsSurveyStyle(padding:EdgeInsets.all(24),errorTextStyle:TextStyle(color:Colors.purple)),
        onAnswersChange:changes.add,
        onSubmit:(_){},
      );
    }))));

    expect(find.byType(RadioListTile<String>),findsNWidgets(2));
    // ignore: deprecated_member_use
    expect(tester.getSemantics(find.byKey(const ValueKey('likerts.title'))).hasFlag(SemanticsFlag.isHeader),isTrue);
    await tester.tap(find.text('Yes')); await tester.pump();
    expect(changes.last,{'choice':'yes'});
    await tester.tap(find.text('Enviar')); await tester.pump();
    expect(find.byWidgetPredicate((widget)=>widget is Semantics && widget.properties.liveRegion == true && widget.properties.label == 'Falta: Comment'),findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const ValueKey('likerts.error'))).style?.color,Colors.purple);
    await tester.enterText(find.byType(TextFormField),'saved'); await tester.pump();

    updateHost(() => current=collection(2)); await tester.pump();
    expect(changes.last,isEmpty);
    // ignore: deprecated_member_use
    expect(tester.widget<RadioListTile<String>>(find.byKey(const ValueKey('likerts.option.choice.yes'))).groupValue,isNull);
    expect(tester.widget<TextFormField>(find.byType(TextFormField)).controller?.text ?? '',isEmpty);
  });

  // SDK-CONTRACT: transport.https
  test('HTTPS is required except loopback',(){
    expect(()=>LikertsClient(baseUrl:'http://example.test',collectionToken:'t'),throwsArgumentError);
    expect(()=>LikertsClient(baseUrl:'http://localhost:8080',collectionToken:'t'),returnsNormally);
  });

  // SDK-CONTRACT: transport.redirect
  test('redirect following is disabled',() async {
    bool? follows;
    final client=LikertsClient(baseUrl:'https://example.test',collectionToken:'t',client:MockClient((request) async { follows=request.followRedirects;return http.Response(jsonEncode({'id':'c','surveyId':'s','version':1,'placement':'p','schema':{'schemaVersion':1,'title':'T','questions':[]}}),200); }));
    await client.collection('c');expect(follows,false);client.close();
  });

  // SDK-CONTRACT: transport.timeout
  test('timeout fails once without an automatic retry',() async {
    var calls=0;final client=LikertsClient(baseUrl:'https://example.test',collectionToken:'t',timeout:const Duration(milliseconds:5),client:MockClient((_) async {calls++;return Completer<http.Response>().future;}));
    await expectLater(client.collection('c'),throwsA(isA<TimeoutException>()));expect(calls,1);client.close();
  });

  // SDK-CONTRACT: lifecycle.cancellation
  test('cancellation prevents request completion',() async {
    final token=LikertsCancellationToken();final client=LikertsClient(baseUrl:'https://example.test',collectionToken:'t',client:MockClient((_) async=>Completer<http.Response>().future));
    final pending=client.collection('c',cancellation:token);token.cancel();await expectLater(pending,throwsA(isA<http.RequestAbortedException>()));client.close();
  });

  test('invalid receipt never reports completion',() async {
    final client=LikertsClient(baseUrl:'https://example.test',collectionToken:'t',client:MockClient((_) async=>http.Response(jsonEncode({'responseId':'r','collectionId':'c','accepted':false}),200)));
    await expectLater(client.submit('c',Submission(idempotencyKey:'k',answers:{})),throwsFormatException);client.close();
  });
}
