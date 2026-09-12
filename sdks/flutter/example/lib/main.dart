import 'package:flutter/material.dart';
import 'package:likerts/likerts.dart';
import 'package:likerts/survey.dart';

void main() => runApp(const LikertsExampleApp());

class LikertsExampleApp extends StatelessWidget {
  const LikertsExampleApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Likerts sample',
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff3157a4))),
    home: const SurveyScreen(),
  );
}

class SurveyScreen extends StatefulWidget {
  const SurveyScreen({super.key});
  @override State<SurveyScreen> createState() => _SurveyScreenState();
}

class _SurveyScreenState extends State<SurveyScreen> {
  bool submitted = false;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Product feedback')),
    body: submitted
        ? Center(child: Semantics(liveRegion: true, child: const Text('Thank you for your feedback.')))
        : SafeArea(child: SingleChildScrollView(child: LikertsSurvey(
            collection: sampleCollection,
            strings: const LikertsSurveyStrings(submitLabel: 'Send feedback'),
            style: const LikertsSurveyStyle(padding: EdgeInsets.all(24)),
            onSubmit: (_) => setState(() => submitted = true),
          ))),
  );
}

final sampleCollection = Collection.fromJson({
  'id': 'sample-collection', 'surveyId': 'sample-survey', 'version': 1, 'placement': 'flutter-sample',
  'schema': {'schemaVersion': 2, 'title': 'Tell us what you think', 'questions': [
    {'id': 'score', 'type': 'scale', 'label': 'How satisfied are you?', 'required': true, 'min': 1, 'max': 5, 'labels': {'1': 'Very dissatisfied', '5': 'Very satisfied'}},
    {'id': 'comment', 'type': 'text', 'label': 'What should we improve?', 'required': true, 'maxLength': 500},
    {'id': 'contact', 'type': 'single_choice', 'label': 'May we contact you?', 'options': [{'id': 'yes', 'label': 'Yes'}, {'id': 'no', 'label': 'No'}]},
  ]},
});
