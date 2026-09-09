import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import '../lib/offline_queue.dart';

class Adapter implements OfflineSecureAdapter {
  String protectionProfile = 'ios_keychain_aes_gcm';
  var values = <Uint8List>[];
  var n = 0;
  String createRecordId() => 'r${++n}';
  Future<List<Uint8List>> load() async =>
      values.map(Uint8List.fromList).toList();
  Future<void> replace(List<Uint8List> records) async =>
      values = records.map(Uint8List.fromList).toList();
  Future<Uint8List> seal(Uint8List clear) async =>
      Uint8List.fromList([170, ...clear.map((v) => v ^ 91), 85]);
  Future<Uint8List> open(Uint8List sealed) async {
    if (sealed.first != 170 || sealed.last != 85) throw StateError('auth');
    return Uint8List.fromList(
      sealed.sublist(1, sealed.length - 1).map((v) => v ^ 91).toList(),
    );
  }
}

void main() {
  test(
    'strict secure adapter encrypts, orders, maps and quarantines',
    () async {
      expect(
        () => OfflineQueue(Adapter()..protectionProfile = 'plaintext'),
        throwsStateError,
      );
      final adapter = Adapter(), seen = <String>[];
      final queue = OfflineQueue(adapter);
      await queue.enqueue('c', {
        'idempotencyKey': 'a',
        'answers': {'secret': 'answer'},
        'metadata': {},
      });
      await queue.enqueue('d', {
        'metadata': {},
        'answers': {},
        'idempotencyKey': 'b',
      });
      expect(
        String.fromCharCodes(adapter.values.first),
        isNot(contains('answer')),
      );
      final report = await queue.flush(
        credential: (c) async => 'token',
        send: (c, t, s) async {
          seen.add(s['idempotencyKey']);
          return s['idempotencyKey'] == 'a'
              ? const OfflineAttempt(503, retryAfterSeconds: 30)
              : OfflineAttempt(
                  200,
                  responseId: 'r',
                  receiptCollectionId: c,
                  accepted: true,
                  chargedCents: 1,
                );
        },
      );
      expect(seen, ['a', 'b']);
      expect(report.accepted, 1);
      expect(report.status.pending, 1);
      adapter.values.first[3] ^= 1;
      expect((await queue.snapshot()).quarantined, 1);
      expect(await queue.purgeQuarantined(), 1);
      expect((await queue.snapshot()).quarantined, 0);
    },
  );
}
