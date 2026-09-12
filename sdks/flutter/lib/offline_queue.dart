import 'dart:convert';
import 'dart:typed_data';

class OfflineLimits {
  final int maxRecords, maxBytes, maxAgeSeconds;
  const OfflineLimits({
    this.maxRecords = 1000,
    this.maxBytes = 10 * 1024 * 1024,
    this.maxAgeSeconds = 7 * 86400,
  }) : assert(maxRecords > 0 && maxRecords <= 10000),
       assert(maxBytes > 0 && maxBytes <= 100 * 1024 * 1024),
       assert(maxAgeSeconds > 0 && maxAgeSeconds <= 30 * 86400);
}

enum OfflineReason {
  invalid,
  conflict,
  unauthorized,
  revoked,
  deleted,
  expired,
}

class OfflineStatus {
  final int pending, expiredLocal, quarantined, bytes;
  final Map<OfflineReason, int> blockedByReason;
  const OfflineStatus(
    this.pending,
    this.blockedByReason,
    this.expiredLocal,
    this.quarantined,
    this.bytes,
  );
}

class OfflineAttempt {
  final int status;
  final String? responseId, receiptCollectionId;
  final bool accepted;
  final int? retryAfterSeconds;
  const OfflineAttempt(
    this.status, {
    this.responseId,
    this.receiptCollectionId,
    this.accepted = false,
    this.retryAfterSeconds,
  });
}

class OfflineOutcome {
  final String recordId, outcome;
  final OfflineReason? reason;
  final int? retryAfterSeconds;
  const OfflineOutcome(
    this.recordId,
    this.outcome, {
    this.reason,
    this.retryAfterSeconds,
  });
}

class OfflineFlushReport {
  final int attempted, accepted;
  final bool cancelled;
  final List<OfflineOutcome> outcomes;
  final OfflineStatus status;
  const OfflineFlushReport(
    this.attempted,
    this.accepted,
    this.cancelled,
    this.outcomes,
    this.status,
  );
}

abstract interface class OfflineSecureAdapter {
  String get protectionProfile;
  String createRecordId();
  Future<List<Uint8List>> load();
  Future<void> replace(List<Uint8List> records);
  Future<Uint8List> seal(Uint8List clear);
  Future<Uint8List> open(Uint8List sealed);
}

class _Envelope {
  String id, collectionId, idempotencyKey, state;
  Uint8List submission;
  int createdAtMillis, byteSize, attemptCount;
  OfflineReason? reason;
  _Envelope(
    this.id,
    this.collectionId,
    this.submission,
    this.idempotencyKey,
    this.createdAtMillis,
    this.byteSize, {
    this.attemptCount = 0,
    this.state = 'pending',
    this.reason,
  });
  Map<String, dynamic> json() => {
    'id': id,
    'collectionId': collectionId,
    'submission': base64Encode(submission),
    'idempotencyKey': idempotencyKey,
    'createdAtMillis': createdAtMillis,
    'byteSize': byteSize,
    'attemptCount': attemptCount,
    'state': state,
    'reason': reason?.name,
  };
  factory _Envelope.parse(Uint8List bytes) {
    final v = jsonDecode(utf8.decode(bytes));
    return _Envelope(
      v['id'],
      v['collectionId'],
      base64Decode(v['submission']),
      v['idempotencyKey'],
      v['createdAtMillis'],
      v['byteSize'],
      attemptCount: v['attemptCount'],
      state: v['state'],
      reason: v['reason'] == null
          ? null
          : OfflineReason.values.byName(v['reason']),
    );
  }
}

class OfflineQueue {
  final OfflineSecureAdapter adapter;
  final OfflineLimits limits;
  final int Function() nowMillis;
  bool _flushing = false;
  OfflineQueue(
    this.adapter, {
    this.limits = const OfflineLimits(),
    int Function()? nowMillis,
  }) : nowMillis = nowMillis ?? (() => DateTime.now().millisecondsSinceEpoch) {
    if (![
      'ios_keychain_aes_gcm',
      'android_keystore_aes_gcm',
    ].contains(adapter.protectionProfile))
      throw StateError('native Keychain/Keystore AES-GCM adapter required');
  }
  Future<(List<_Envelope>, List<Uint8List>)> _read() async {
    final good = <_Envelope>[], bad = <Uint8List>[];
    for (final sealed in await adapter.load()) {
      try {
        good.add(_Envelope.parse(await adapter.open(sealed)));
      } catch (_) {
        bad.add(sealed);
      }
    }
    return (good, bad);
  }

  Future<void> _write(List<_Envelope> good, List<Uint8List> bad) async {
    await adapter.replace([
      ...bad,
      ...await Future.wait(
        good.map(
          (v) => adapter.seal(
            Uint8List.fromList(utf8.encode(jsonEncode(v.json()))),
          ),
        ),
      ),
    ]);
  }

  Future<String> enqueue(
    String collectionId,
    Map<String, dynamic> submission,
  ) async {
    final key = submission['idempotencyKey'];
    if (collectionId.isEmpty || key is! String || key.isEmpty)
      throw ArgumentError('collection and idempotency key required');
    final bytes = Uint8List.fromList(utf8.encode(_canonical(submission)));
    if (bytes.length > 65536) throw RangeError('record exceeds 64 KiB');
    final (good, bad) = await _read();
    for (final prior in good.where((r) => r.idempotencyKey == key)) {
      if (prior.collectionId != collectionId ||
          !_equal(prior.submission, bytes))
        throw StateError('idempotency conflict');
      return prior.id;
    }
    if (good.length >= limits.maxRecords ||
        good.fold(0, (n, r) => n + r.byteSize) + bytes.length > limits.maxBytes)
      throw StateError('capacity exceeded');
    final value = _Envelope(
      adapter.createRecordId(),
      collectionId,
      bytes,
      key,
      nowMillis(),
      bytes.length,
    );
    await _write([...good, value], bad);
    return value.id;
  }

  Future<OfflineStatus> snapshot() async {
    final (good, bad) = await _read();
    final reasons = <OfflineReason, int>{};
    for (final r in good) {
      if (r.state == 'blocked' && r.reason != null)
        reasons[r.reason!] = (reasons[r.reason!] ?? 0) + 1;
    }
    return OfflineStatus(
      good.where((r) => r.state == 'pending').length,
      reasons,
      good.where((r) => r.state == 'expired_local').length,
      bad.length,
      good.fold(0, (n, r) => n + r.byteSize),
    );
  }

  Future<void> delete(String id) async {
    final (good, bad) = await _read();
    await _write(good.where((r) => r.id != id).toList(), bad);
  }

  Future<int> deleteCollection(String id) async {
    final (good, bad) = await _read();
    final kept = good.where((r) => r.collectionId != id).toList();
    await _write(kept, bad);
    return good.length - kept.length;
  }

  Future<int> purgeQuarantined() async {
    final (good, bad) = await _read();
    await _write(good, []);
    return bad.length;
  }

  Future<OfflineFlushReport> flush({
    required Future<String?> Function(String) credential,
    required Future<OfflineAttempt> Function(
      String,
      String,
      Map<String, dynamic>,
    )
    send,
    bool Function()? cancelled,
  }) async {
    if (_flushing) throw StateError('flush active');
    _flushing = true;
    var attempted = 0, accepted = 0, stopped = false;
    final outcomes = <OfflineOutcome>[];
    try {
      final (initial, initialBad) = await _read();
      var expiredChanged = false;
      for (final record in initial) {
        if (record.state != 'expired_local' &&
            nowMillis() - record.createdAtMillis >
                limits.maxAgeSeconds * 1000) {
          record.state = 'expired_local';
          record.reason = null;
          expiredChanged = true;
        }
      }
      if (expiredChanged) await _write(initial, initialBad);
      final ids = initial.where((r) => r.state == 'pending').toList()
        ..sort(
          (a, b) => a.createdAtMillis != b.createdAtMillis
              ? a.createdAtMillis.compareTo(b.createdAtMillis)
              : a.id.compareTo(b.id),
        );
      for (final item in ids) {
        if (cancelled?.call() == true) {
          stopped = true;
          break;
        }
        var (good, bad) = await _read();
        final index = good.indexWhere(
          (r) => r.id == item.id && r.state == 'pending',
        );
        if (index < 0) continue;
        final record = good[index];
        final token = await credential(record.collectionId);
        if (token == null) {
          outcomes.add(OfflineOutcome(record.id, 'credential_unavailable'));
          continue;
        }
        attempted++;
        OfflineAttempt attempt;
        try {
          attempt = await send(
            record.collectionId,
            token,
            jsonDecode(utf8.decode(record.submission)),
          );
        } catch (_) {
          attempt = const OfflineAttempt(0);
        }
        (good, bad) = await _read();
        final fresh = good.indexWhere((r) => r.id == record.id);
        if (fresh < 0) continue;
        if (attempt.status >= 200 &&
            attempt.status < 300 &&
            attempt.accepted &&
            attempt.receiptCollectionId == good[fresh].collectionId &&
            (attempt.responseId?.isNotEmpty ?? false)) {
          good.removeAt(fresh);
          accepted++;
          outcomes.add(OfflineOutcome(record.id, 'accepted'));
        } else {
          good[fresh].attemptCount++;
          final retry =
              [408, 425, 429].contains(attempt.status) ||
              attempt.status >= 500 ||
              attempt.status == 0;
          final reason = {
            400: OfflineReason.invalid,
            409: OfflineReason.conflict,
            401: OfflineReason.unauthorized,
            403: OfflineReason.revoked,
            404: OfflineReason.deleted,
            410: OfflineReason.expired,
          }[attempt.status] ??
              (attempt.status >= 400 && attempt.status < 500 && !retry
                  ? OfflineReason.invalid
                  : null);
          if (reason != null) {
            good[fresh].state = 'blocked';
            good[fresh].reason = reason;
            outcomes.add(OfflineOutcome(record.id, 'blocked', reason: reason));
          } else {
            outcomes.add(
              OfflineOutcome(
                record.id,
                'retry',
                retryAfterSeconds: retry && attempt.retryAfterSeconds != null
                    ? attempt.retryAfterSeconds!.clamp(0, 86400)
                    : null,
              ),
            );
          }
        }
        await _write(good, bad);
      }
    } finally {
      _flushing = false;
    }
    return OfflineFlushReport(
      attempted,
      accepted,
      stopped,
      outcomes,
      await snapshot(),
    );
  }
}

String _canonical(dynamic value) {
  if (value is Map) {
    final keys = value.keys.map((e) => e.toString()).toList()..sort();
    return '{${keys.map((k) => '${jsonEncode(k)}:${_canonical(value[k])}').join(',')}}';
  }
  if (value is List) return '[${value.map(_canonical).join(',')}]';
  return jsonEncode(value);
}

bool _equal(Uint8List a, Uint8List b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] != b[i]) return false;
  return true;
}
