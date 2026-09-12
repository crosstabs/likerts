import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:likerts/likerts.dart';

void main(){
 test('Flutter client uses the real rehearsal backend',() async {
  final base=Platform.environment['LIKERTS_REHEARSAL_BASE_URL'];if(base==null)return;
  final id=Platform.environment['LIKERTS_REHEARSAL_COLLECTION_ID']!;final token=Platform.environment['LIKERTS_REHEARSAL_COLLECTION_TOKEN']!;
  final client=LikertsClient(baseUrl:base,collectionToken:token);
  expect((await client.collection(id)).title,'Release rehearsal');
  final receipt=await client.submit(id,Submission(idempotencyKey:'rel-flutter',answers:{'comment':'flutter'},metadata:{'sdk':'flutter'}));
  expect(receipt.accepted,true);client.close();
 });
}
