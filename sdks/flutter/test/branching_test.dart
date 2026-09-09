import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:likerts/branching.dart';
import 'package:likerts/likerts.dart';
void main(){test('branch navigation progress Back and answer changes are deterministic',(){final fixture=jsonDecode(File('../../contracts/branching-survey.example.json').readAsStringSync());final collection=Collection.fromJson({'id':'c','surveyId':'s','version':1,'placement':'p','schema':{'schemaVersion':4,...fixture}});final flow=SurveyFlow(collection);flow.setAnswer('return','no');expect(flow.next(),true);expect(flow.page.id,'recovery');expect(flow.progress,const SurveyProgress(3,4,2));flow.setAnswer('problem','Long wait');expect(flow.next(),true);expect(flow.page.id,'contact');expect(flow.back(),true);expect(flow.page.id,'recovery');expect(flow.back(),true);flow.setAnswer('return','yes');expect(flow.next(),true);expect(flow.page.id,'praise');expect(flow.answers.containsKey('problem'),false);expect(pageRoute(collection,{'return':'no'}),[0,2,3]);expect(routedAnswers(collection,{'return':'no','highlight':'stale'}),{'return':'no'});});}
