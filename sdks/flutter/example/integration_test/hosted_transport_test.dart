import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:likerts/likerts.dart';

// Opt-in through a private --dart-define-from-file supplied by the native runner.
const encodedConfig = String.fromEnvironment('LIKERTS_HOSTED_CONFIG');
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native client fetch submit and identical retry', (tester) async {
    var stage = 'configuration';
    LikertsClient? client;
    try {
      final config = jsonDecode(encodedConfig) as Map<String, dynamic>;
      if (config['target'] != 'flutter' || config['sdkVersion'] != likertsSdkCapability['sdkVersion'] || config['disposable'] != true || config['responseCap'] != 1) throw StateError('invalid');
      final id = config['collectionId'] as String;
      client = LikertsClient(baseUrl: config['baseUrl'], collectionToken: config['collectionToken'], timeout: const Duration(seconds: 10));
      stage = 'collection';
      final collection = await client.collection(id, refresh: true).timeout(const Duration(seconds: 15));
      if (collection.id != id || !collection.questions.any((q) => q.id == 'rating' && q.type == 'scale')) throw StateError('invalid');
      final submission = Submission(idempotencyKey: config['idempotencyKey'], answers: {'rating': 5}, metadata: {'source': 'synthetic-native-hosted', 'target': 'flutter'});
      stage = 'submit';
      final receipt = await client.submit(id, submission).timeout(const Duration(seconds: 15));
      if (receipt.collectionId != id || !receipt.accepted || receipt.responseId.isEmpty) throw StateError('invalid');
      stage = 'identical_retry';
      final retry = await client.submit(id, submission).timeout(const Duration(seconds: 15));
      if (retry.responseId != receipt.responseId || retry.collectionId != receipt.collectionId || retry.accepted != receipt.accepted) throw StateError('invalid');
      // Only public receipt fields are emitted; never config, token or response bodies.
      // ignore: avoid_print
      print('LIKERTS_HOSTED_RESULT ${jsonEncode({'target': 'flutter', 'sdkVersion': '0.0.3', 'result': 'passed', 'collectionId': id, 'responseId': receipt.responseId, 'identicalRetrySameReceipt': true, 'sdkRequests': 3, 'boundary': 'same-team synthetic native transport; ledger verified separately'})}');
    } catch (_) { fail('Hosted transport acceptance failed at $stage (details redacted)'); }
    finally { client?.close(); }
  }, skip: encodedConfig.isEmpty, timeout: const Timeout(Duration(seconds: 60)));
}
