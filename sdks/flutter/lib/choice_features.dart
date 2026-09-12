import 'likerts.dart';

List<String> selectedChoices(dynamic value) {
  if (value is String) return value.isEmpty ? [] : [value];
  if (value is List) return value.whereType<String>().toList();
  if (value is Map && value['selected'] is List) return (value['selected'] as List).whereType<String>().toList();
  return [];
}
Map<String,String> otherTexts(dynamic value) => value is Map && value['otherText'] is Map ? Map<String,String>.from(value['otherText']) : {};

dynamic choiceAnswer(Question q, List<String> selected, [Map<String,String> text = const {}]) {
  if (q.options.any((o)=>o['other'] != null)) return {'selected':List<String>.from(selected),'otherText':{for(final o in q.options.where((o)=>o['other'] != null && selected.contains(o['id']))) o['id'] as String:text[o['id']] ?? ''}};
  return q.type == 'single_choice' ? (selected.isEmpty ? '' : selected.first) : List<String>.from(selected);
}
dynamic toggleChoice(Question q, dynamic value, String id) {
  final option=q.options.firstWhere((o)=>o['id']==id),current=selectedChoices(value);
  final selected=q.type=='single_choice' ? [id] : current.contains(id) ? current.where((v)=>v!=id).toList() : option['exclusive']==true ? [id] : [...current.where((v)=>!q.options.any((o)=>o['id']==v && o['exclusive']==true)),id];
  return choiceAnswer(q,selected,otherTexts(value));
}
dynamic setOtherText(Question q, dynamic value, String id, String text) => choiceAnswer(q,selectedChoices(value),{...otherTexts(value),id:text});

String? choiceError(Question q, dynamic value) {
  if(value == null || value == '') return q.required ? 'required' : null;
  final hasOther=q.options.any((o)=>o['other']!=null);
  if(hasOther) {
    if(value is! Map || value.length!=2 || value['selected'] is! List || !(value['selected'] as List).every((v)=>v is String) || value['otherText'] is! Map || !(value['otherText'] as Map).values.every((v)=>v is String)) return 'invalid';
  } else if(q.type=='single_choice' ? value is! String : value is! List || !value.every((v)=>v is String)) { return 'invalid'; }
  final selected=selectedChoices(value);
  if(selected.toSet().length!=selected.length || selected.any((id)=>!q.options.any((o)=>o['id']==id))) return 'invalid';
  final exclusive=selected.any((id)=>q.options.any((o)=>o['id']==id && o['exclusive']==true));
  if(exclusive && selected.length!=1) return 'invalid';
  if(q.type=='single_choice' ? selected.length!=1 : selected.length>(q.maxSelections??q.options.length) || (!exclusive && selected.length<((q.minSelections??0)>(q.required?1:0)?q.minSelections!:(q.required?1:0)))) return 'range';
  if(hasOther) {
    final text=otherTexts(value),expected=q.options.where((o)=>o['other']!=null && selected.contains(o['id'])).toList();
    if(text.length!=expected.length || expected.any((o)=>text[o['id']]==null || text[o['id']]!.trim().isEmpty || text[o['id']]!.runes.length>o['other']['maxLength'])) return 'other';
  }
  return null;
}
