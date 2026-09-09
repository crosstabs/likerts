import 'dart:convert';
import 'dart:async';
import 'package:http/http.dart' as http;

const likertsSdkCapability={'target':'flutter','sdkVersion':'0.0.3','schemaVersions':[1,2,3,4,5]};

class VisibilityCondition {
  final String questionId, operator;
  final dynamic value;
  VisibilityCondition.fromJson(Map<String,dynamic> json):questionId=json['questionId'],operator=json['operator'],value=json['value'];
}
class PromptItem{final String id,label;PromptItem.fromJson(Map<String,dynamic> value):id=value['id'],label=value['label'];}
class PageBranch {final VisibilityCondition when;final String goToPageId;PageBranch.fromJson(Map<String,dynamic> value):when=VisibilityCondition.fromJson(Map<String,dynamic>.from(value['when'])),goToPageId=value['goToPageId'];}
class SurveyPage {final String id;final String? title;final List<String> questionIds;final List<PageBranch> branches;SurveyPage.fromJson(Map<String,dynamic> value):id=value['id'],title=value['title'],questionIds=List<String>.from(value['questionIds']),branches=(value['branches'] as List? ?? const []).map((item)=>PageBranch.fromJson(Map<String,dynamic>.from(item))).toList();}

class Question {
  final String id, type, label;
  final bool required;
  final List<Map<String, dynamic>> options;
  final num? min, max;
  final int? maxLength, minSelections, maxSelections;
  final String? preset;
  final Map<String, String>? labels;
  final VisibilityCondition? visibleWhen;
  final String? presentation;
  final List<PromptItem> rows,items;
  final List<Map<String,dynamic>> columns;
  final String? matrixMode;
  final int? total;
  List<int> get scaleValues => type == "scale" && (preset == "nps" || labels != null || presentation == "stars") && min != null && max != null && min! >= -10000 && max! <= 10000 && min! <= max! ? List.generate(max!.toInt() - min!.toInt() + 1, (i) => min!.toInt() + i) : [];
  String scaleLabel(int value) => labels?["$value"] == null ? "$value" : "$value — ${labels!["$value"]}";
  String? selectionError(List? selected) {
    if(type != "multiple_choice") return null;
    if(selected == null) return required ? "Choose at least one option" : null;
    final minimum = (minSelections ?? 0) < (required ? 1 : 0) ? 1 : (minSelections ?? 0);
    if(selected.length < minimum) return "Choose at least $minimum options";
    if(maxSelections != null && selected.length > maxSelections!) return "Choose at most $maxSelections options";
    return null;
  }
  Question.fromJson(Map<String, dynamic> value)
      : id = value['id'], type = value['type'], label = value['label'], required = value['required'] ?? false,
        options = (value['options'] as List? ?? []).map((o) => Map<String, dynamic>.from(o)).toList(),
        min = value['min'], max = value['max'], maxLength = value['maxLength'], preset = value['preset'], labels = value['labels'] == null ? null : Map<String, String>.from(value['labels']), minSelections = value['minSelections'], maxSelections = value['maxSelections'], visibleWhen=value['visibleWhen']==null?null:VisibilityCondition.fromJson(Map<String,dynamic>.from(value['visibleWhen'])),presentation=value['presentation'],rows=(value['rows'] as List? ?? []).map((v)=>PromptItem.fromJson(Map<String,dynamic>.from(v))).toList(),columns=(value['columns'] as List? ?? []).map((v)=>Map<String,dynamic>.from(v)).toList(),matrixMode=value['matrixMode'],items=(value['items'] as List? ?? []).map((v)=>PromptItem.fromJson(Map<String,dynamic>.from(v))).toList(),total=value['total'];
}
class Collection {
  final String id, surveyId, placement, title;
  final int version;
  final int schemaVersion;
  final List<Question> questions;
  final List<SurveyPage>? pages;
  Collection.fromJson(Map<String, dynamic> value)
      : id = value['id'], surveyId = value['surveyId'], placement = value['placement'], version = value['version'], schemaVersion=value['schema']['schemaVersion'],
        title = value['schema']['title'], questions = (value['schema']['questions'] as List).map((q) => Question.fromJson(q)).toList(), pages=value['schema']['pages']==null?null:(value['schema']['pages'] as List).map((page)=>SurveyPage.fromJson(Map<String,dynamic>.from(page))).toList() {
    if (![1, 2, 3, 4, 5].contains(value['schema']['schemaVersion'])) throw const FormatException('Unsupported schema');
  }
}
/// Generate and persist a unique key in the host app; reuse this immutable payload on retries.
class Submission {
  final String idempotencyKey;
  final Map<String, dynamic> answers, metadata;
  Submission({required this.idempotencyKey, required Map<String, dynamic> answers, Map<String, dynamic> metadata = const {}})
      : answers = Map.unmodifiable(answers), metadata = Map.unmodifiable(metadata);
  Map<String, dynamic> toJson() => {'idempotencyKey': idempotencyKey, 'answers': answers, 'metadata': metadata};
}
class LikertsException implements Exception {
  final int status;
  final String response;
  LikertsException(this.status, this.response);
  @override String toString() => 'Likerts request failed ($status)';
}
class Receipt {
  final String responseId, collectionId;
  final bool accepted;
  final int chargedCents;
  Receipt.fromJson(Map<String,dynamic> value)
      : responseId=value['responseId'], collectionId=value['collectionId'], accepted=value['accepted'], chargedCents=value['chargedCents'] {
    if(!accepted || chargedCents != 1) throw const FormatException('Invalid Likerts receipt');
  }
}
class LikertsCancellationToken {
  final Completer<void> _cancelled=Completer<void>();
  Future<void> get whenCancelled => _cancelled.future;
  bool get isCancelled => _cancelled.isCompleted;
  void cancel() { if(!_cancelled.isCompleted) _cancelled.complete(); }
}
class LikertsClient {
  final String baseUrl, collectionToken;
  final Duration timeout;
  final Duration cacheMaxAge;
  final http.Client _http;
  final Map<String,({Collection value,DateTime storedAt})> _collectionCache={};
  LikertsClient({required String baseUrl, required this.collectionToken, http.Client? client, this.timeout=const Duration(seconds:15),this.cacheMaxAge=const Duration(minutes:5)}) : baseUrl=_safeBaseUrl(baseUrl), _http = client ?? http.Client() {
    if(timeout <= Duration.zero) throw ArgumentError.value(timeout,'timeout','must be positive');
    if(cacheMaxAge.isNegative) throw ArgumentError.value(cacheMaxAge,'cacheMaxAge','must not be negative');
  }
  static String _safeBaseUrl(String value) {
    final uri=Uri.parse(value);final loopback=const {'localhost','127.0.0.1','::1'}.contains(uri.host.toLowerCase());
    if(!(uri.scheme == 'https' || (uri.scheme == 'http' && loopback)) || uri.userInfo.isNotEmpty || uri.hasQuery || uri.hasFragment) throw ArgumentError.value(value,'baseUrl','Likerts base URL must use HTTPS (HTTP is limited to loopback development)');
    return value.replaceFirst(RegExp(r"/$"), "");
  }
  Future<Map<String, dynamic>> _request(String id, [Submission? submission, LikertsCancellationToken? cancellation]) async {
    final uri = Uri.parse('${baseUrl.replaceFirst(RegExp(r"/$"), "")}/v1/collections/${Uri.encodeComponent(id)}${submission == null ? "" : "/responses"}');
    final timeoutAbort=Completer<void>();
    final abort=Future.any<void>([timeoutAbort.future,if(cancellation != null)cancellation.whenCancelled]);
    final request=http.AbortableRequest(submission == null ? 'GET' : 'POST',uri,abortTrigger:abort)
      ..followRedirects=false
      ..headers.addAll({'Authorization':'Bearer $collectionToken','Content-Type':'application/json'});
    if(submission != null) request.body=jsonEncode(submission.toJson());
    final send=_http.send(request);
    final cancelled=abort.then<http.StreamedResponse>((_)=>throw http.RequestAbortedException(uri));
    late http.StreamedResponse streamed;
    try { streamed=await Future.any([send,cancelled]).timeout(timeout); }
    on TimeoutException { if(!timeoutAbort.isCompleted)timeoutAbort.complete();rethrow; }
    final response=await http.Response.fromStream(streamed);
    if (response.statusCode < 200 || response.statusCode >= 300) throw LikertsException(response.statusCode, response.body);
    return jsonDecode(response.body) as Map<String, dynamic>;
  }
  Future<Collection> collection(String id,{LikertsCancellationToken? cancellation,bool refresh=false}) async {
    final cached=_collectionCache[id];if(!refresh && cached != null && DateTime.now().difference(cached.storedAt)<cacheMaxAge)return cached.value;
    try { final value=Collection.fromJson(await _request(id,null,cancellation));if(cached != null && (cached.value.id != value.id || cached.value.surveyId != value.surveyId || cached.value.version != value.version || cached.value.schemaVersion != value.schemaVersion)){_collectionCache.remove(id);throw const FormatException('Collection binding changed');}_collectionCache[id]=(value:value,storedAt:DateTime.now());return value; }
    catch(error){_collectionCache.remove(id);rethrow;}
  }
  void clearCollectionCache([String? id]) { if(id == null){_collectionCache.clear();}else{_collectionCache.remove(id);} }
  Future<Receipt> submit(String id, Submission submission,{LikertsCancellationToken? cancellation}) async => Receipt.fromJson(await _request(id,submission,cancellation));
  void close() => _http.close();
}
