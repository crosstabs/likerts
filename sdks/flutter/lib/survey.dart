import 'package:flutter/material.dart';
import 'likerts.dart';
import 'choice_features.dart';
import 'visibility.dart';
import 'branching.dart';
import 'advanced_questions.dart';

/// Host-provided respondent copy for localization.
class LikertsSurveyStrings {
  final String requiredLabel, submitLabel, datePlaceholder, selectAnswer, backLabel, nextLabel,moveUp,moveDown;
  final String Function(int, int, int) progressLabel;
  final String Function(String) answerRequired, otherError;
  final String Function(int) chooseAtLeast, chooseAtMost;
  final String Function(int) remaining;
  final String Function(String) advancedError;

  const LikertsSurveyStrings({
    this.requiredLabel = 'required',
    this.backLabel = 'Back',
    this.nextLabel = 'Next',
    this.progressLabel = _defaultProgress,
    this.selectAnswer = 'Select an answer',
    this.otherError = _defaultOther,
    this.submitLabel = 'Submit',
    this.datePlaceholder = 'YYYY-MM-DD',
    this.answerRequired = _defaultRequired,
    this.chooseAtLeast = _defaultAtLeast,
    this.chooseAtMost = _defaultAtMost,
    this.moveUp='Move up',this.moveDown='Move down',this.remaining=_defaultRemaining,this.advancedError=_defaultAdvanced,
  });

  static String _defaultProgress(int current, int total, int visited) => 'Page $current of $total · $visited visited';
  static String _defaultOther(String label) => '$label: enter valid text for the selected Other option.';
  static String _defaultRequired(String label) => '$label: an answer is required.';
  static String _defaultAtLeast(int count) => 'Choose at least $count options';
  static String _defaultAtMost(int count) => 'Choose at most $count options';
  static String _defaultRemaining(int count)=>'$count remaining';
  static String _defaultAdvanced(String label)=>'$label: complete the answer.';
}

/// Styling hooks that complement the host application's [ThemeData].
class LikertsSurveyStyle {
  final EdgeInsetsGeometry padding;
  final double questionSpacing, controlSpacing;
  final TextStyle? errorTextStyle;
  final ButtonStyle? submitButtonStyle;

  const LikertsSurveyStyle({
    this.padding = const EdgeInsets.all(16),
    this.questionSpacing = 20,
    this.controlSpacing = 8,
    this.errorTextStyle,
    this.submitButtonStyle,
  });
}

/// Native Flutter renderer. The host owns submission, placement and dismissal.
class LikertsSurvey extends StatefulWidget {
  final Collection collection;
  final bool disabled;
  final LikertsSurveyStrings strings;
  final LikertsSurveyStyle style;
  final ValueChanged<Map<String, dynamic>>? onAnswersChange;
  final ValueChanged<Map<String, dynamic>> onSubmit;

  const LikertsSurvey({
    super.key,
    required this.collection,
    required this.onSubmit,
    this.disabled = false,
    this.strings = const LikertsSurveyStrings(),
    this.style = const LikertsSurveyStyle(),
    this.onAnswersChange,
  });

  @override
  State<LikertsSurvey> createState() => _LikertsSurveyState();
}

class _LikertsSurveyState extends State<LikertsSurvey> {
  final Map<String, dynamic> _answers = {};
  String? _validationError;
  late SurveyFlow _flow;

  @override
  void initState() { super.initState(); _flow = SurveyFlow(widget.collection); }

  @override
  void didUpdateWidget(covariant LikertsSurvey oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.collection.id != widget.collection.id || oldWidget.collection.version != widget.collection.version) {
      _answers.clear();
      _flow = SurveyFlow(widget.collection);
      _validationError = null;
      widget.onAnswersChange?.call(const {});
    }
  }

  void _changed(VoidCallback change) {
    setState(() {
      change();
      final previous = _flow.answers;
      final changed = {...previous.keys, ..._answers.keys}.where((id) => previous[id] != _answers[id]).toList();
      for (final id in changed) { _flow.setAnswer(id, _answers[id]); }
      _answers..clear()..addAll(_flow.answers);
      _validationError = null;
    });
    widget.onAnswersChange?.call(Map.unmodifiable(_answers));
  }

  String? _errorFor(Question question) {
    final value=_answers[question.id];
    if(question.type=='ranking'){if(value==null)return question.required?widget.strings.answerRequired(question.label):null;return validRanking(List<String>.from(value),question.options.map((o)=>o['id'] as String).toList())?null:widget.strings.advancedError(question.label);}
    if(question.type=='matrix'){if(value==null)return question.required?widget.strings.answerRequired(question.label):null;final matrix=(value as Map).map((key,value)=>MapEntry(key as String,value is List?List<String>.from(value):[value as String]));return validMatrix(matrix,question.rows.map((i)=>i.id).toList(),question.columns.map((i)=>i['id'] as String).toList(),multiple:question.matrixMode=='multiple',required:question.required)?null:widget.strings.advancedError(question.label);}
    if(question.type=='constant_sum'){if(value==null)return question.required?widget.strings.answerRequired(question.label):null;return validAllocation(Map<String,int>.from(value),question.items.map((i)=>i.id).toList(),question.total??0)?null:widget.strings.advancedError(question.label);}
    final isChoice=question.type=='single_choice'||question.type=='multiple_choice';
    if(question.required && (value==null||value==''||(isChoice&&selectedChoices(value).isEmpty))) return widget.strings.answerRequired(question.label);
    if(!isChoice) return null;
    final error=choiceError(question,value);if(error==null)return null;
    final minimum=(question.minSelections??0)>(question.required?1:0)?question.minSelections!:(question.required?1:0);
    if(error=='range') return selectedChoices(value).length<minimum?widget.strings.chooseAtLeast(minimum):widget.strings.chooseAtMost(question.maxSelections??question.options.length);
    return widget.strings.otherError(question.label);
  }

  bool get _lastPage => pageRoute(widget.collection, _answers).last == _flow.progress.current - 1;

  Iterable<Question> get _currentQuestions {
    final visible = visibleQuestionIds(widget.collection.questions, _answers);
    return widget.collection.questions.where((q) => _flow.page.questionIds.contains(q.id) && visible.contains(q.id));
  }

  void _advance() {
    final reached = routedAnswers(widget.collection, _answers);
    final visible = visibleQuestionIds(widget.collection.questions, reached);
    final reachedIds = pageRoute(widget.collection, reached).expand((i) => widget.collection.pages?[i].questionIds ?? widget.collection.questions.map((q) => q.id)).toSet();
    final questions = _lastPage ? widget.collection.questions.where((q) => reachedIds.contains(q.id) && visible.contains(q.id)) : _currentQuestions;
    String? error;
    for (final question in questions) { error ??= _errorFor(question); }
    setState(() => _validationError = error);
    if (error != null) return;
    if (_lastPage) { widget.onSubmit(Map.unmodifiable(reached)); }
    else { setState(() { _flow.next(); }); }
  }

  void _back() { setState(() { _flow.back(); _validationError = null; }); }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      container: true,
      child: Padding(
        padding: widget.style.padding,
        child: SingleChildScrollView(child:Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Semantics(header: true, child: Text(widget.collection.title, key: const ValueKey('likerts.title'), style: theme.textTheme.headlineSmall)),
          SizedBox(height: widget.style.questionSpacing),
          if (widget.collection.pages != null) ...[
            Semantics(liveRegion: true, child: Text(widget.strings.progressLabel(_flow.progress.current, _flow.progress.total, _flow.progress.visited), key: const ValueKey('likerts.progress'))),
            if (_flow.page.title != null) Semantics(header: true, child: Text(_flow.page.title!, key: const ValueKey('likerts.pageTitle'))),
          ],
          for (final question in _currentQuestions) ...[
            _Question(
              key: ValueKey('likerts.question.${question.id}'),
              collectionKey: '${widget.collection.id}:${widget.collection.version}',
              question: question,
              answer: _answers[question.id],
              disabled: widget.disabled,
              strings: widget.strings,
              controlSpacing: widget.style.controlSpacing,
              onChanged: (value) => _changed(() {
                if (value == null || value == '' || ((question.type=='single_choice'||question.type=='multiple_choice') && selectedChoices(value).isEmpty) || (value is List && value.isEmpty)) {
                  _answers.remove(question.id);
                } else {
                  _answers[question.id] = value;
                }
              }),
            ),
            SizedBox(height: widget.style.questionSpacing),
          ],
          if (_validationError != null)
            Semantics(
              container: true,
              liveRegion: true,
              label: _validationError,
              child: Text(
                _validationError!,
                key: const ValueKey('likerts.error'),
                style: widget.style.errorTextStyle ?? theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
              ),
            ),
          SizedBox(height: widget.style.controlSpacing),
          if (_flow.progress.visited > 1) TextButton(key: const ValueKey('likerts.back'), onPressed: widget.disabled ? null : _back, child: Text(widget.strings.backLabel)),
          ElevatedButton(
            key: ValueKey(_lastPage ? 'likerts.submit' : 'likerts.next'),
            onPressed: widget.disabled ? null : _advance,
            style: widget.style.submitButtonStyle,
            child: Text(_lastPage ? widget.strings.submitLabel : widget.strings.nextLabel),
          ),
        ])),
      ),
    );
  }
}

class _Question extends StatelessWidget {
  final String collectionKey;
  final Question question;
  final dynamic answer;
  final bool disabled;
  final LikertsSurveyStrings strings;
  final double controlSpacing;
  final ValueChanged<dynamic> onChanged;

  const _Question({
    super.key,
    required this.collectionKey,
    required this.question,
    required this.answer,
    required this.disabled,
    required this.strings,
    required this.controlSpacing,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Semantics(
      header: true,
      child: Text('${question.label}${question.required ? ' (${strings.requiredLabel})' : ''}', style: Theme.of(context).textTheme.titleMedium),
    ),
    SizedBox(height: controlSpacing),
    if (question.presentation == 'dropdown')
      DropdownButton<String>(
        key: ValueKey('likerts.dropdown.${question.id}'),
        value: selectedChoices(answer).isEmpty ? null : selectedChoices(answer).first,
        hint: Text(strings.selectAnswer),
        items: question.options.map((option)=>DropdownMenuItem<String>(value:option['id'],child:Text(option['label']))).toList(),
        onChanged: disabled ? null : (value) { if(value!=null)onChanged(toggleChoice(question,answer,value)); },
      )
    else if(question.type=='ranking')
      ...List<String>.from(answer??question.options.map((o)=>o['id'])).asMap().entries.map((entry){final id=entry.value,index=entry.key,option=question.options.firstWhere((o)=>o['id']==id);final order=List<String>.from(answer??question.options.map((o)=>o['id']));return Row(key:ValueKey('likerts.ranking.${question.id}.$id'),children:[Expanded(child:Text('${index+1}. ${option['label']}')),TextButton(onPressed:disabled||index==0?null:()=>onChanged(moveRanking(order,id,-1)),child:Text(strings.moveUp),),TextButton(onPressed:disabled||index==order.length-1?null:()=>onChanged(moveRanking(order,id,1)),child:Text(strings.moveDown))]);})
    else if(question.type=='matrix')
      ...question.rows.map((row)=>Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text(row.label),
        ...question.columns.map((column){
          final raw=(answer as Map?)?[row.id];
          final selected=raw is List?raw.contains(column['id']):raw==column['id'];
          return CheckboxListTile(
            key:ValueKey('likerts.matrix.${question.id}.${row.id}.${column['id']}'),title:Text(column['label']),value:selected,
            onChanged:disabled?null:(_){
              final current=(answer as Map?)?.map((key,value)=>MapEntry(key as String,value is List?List<String>.from(value):[value as String]))??<String,List<String>>{};
              final next=setMatrixChoice(current,row.id,column['id'],multiple:question.matrixMode=='multiple');
              onChanged(next.map((key,value)=>MapEntry(key,question.matrixMode=='single'?value.first:value)));
            });
        })
      ]))
    else if(question.type=='constant_sum') ...[
      ...question.items.map((item)=>TextFormField(key:ValueKey('$collectionKey:${question.id}:${item.id}'),initialValue:(answer as Map?)?[item.id]?.toString()??'',enabled:!disabled,decoration:InputDecoration(labelText:item.label),keyboardType:TextInputType.number,onChanged:(text){final next=Map<String,int>.from(answer as Map? ?? {});final value=int.tryParse(text);if(value==null){next.remove(item.id);}else{next[item.id]=value;}onChanged(next);})),
      Semantics(liveRegion:true,child:Text(strings.remaining(allocationRemaining(question.total??0,Map<String,int>.from(answer as Map? ?? {}))),key:ValueKey('likerts.remaining.${question.id}')))
    ]
    else if (question.type == 'single_choice')
      ...question.options.map((option) => RadioListTile<String>(
        key: ValueKey('likerts.option.${question.id}.${option['id']}'),
        title: Text(option['label']),
        value: option['id'],
        // ignore: deprecated_member_use
        groupValue: selectedChoices(answer).isEmpty ? null : selectedChoices(answer).first,
        // Keep the pre-3.32 API until the minimum supported Flutter release has RadioGroup.
        // ignore: deprecated_member_use
        onChanged: disabled ? null : (value) { if(value!=null)onChanged(toggleChoice(question,answer,value)); },
      ))
    else if (question.type == 'multiple_choice')
      ...question.options.map((option) {
        final selected = selectedChoices(answer);
        final checked = selected.contains(option['id']);
        final enabled = !disabled && (checked || option['exclusive']==true || question.options.any((o)=>o['exclusive']==true && selected.contains(o['id'])) || selected.length < (question.maxSelections ?? 2147483647));
        return CheckboxListTile(
          key: ValueKey('likerts.option.${question.id}.${option['id']}'),
          title: Text(option['label']),
          value: checked,
          onChanged: !enabled ? null : (_) {
            onChanged(toggleChoice(question,answer,option['id']));
          },
        );
      })
    else if (question.scaleValues.isNotEmpty)
      Wrap(spacing: controlSpacing, runSpacing: controlSpacing, children: question.scaleValues.map((value) => ChoiceChip(
        key: ValueKey('likerts.option.${question.id}.$value'),
        label: Text(question.presentation=='stars'?List.filled(value,'★').join():question.scaleLabel(value),semanticsLabel:question.scaleLabel(value)),
        selected: answer == value,
        onSelected: disabled ? null : (_) => onChanged(value),
      )).toList())
    else
      TextFormField(
        key: ValueKey('$collectionKey:${question.id}'),
        initialValue: answer?.toString() ?? '',
        enabled: !disabled,
        maxLength: question.maxLength,
        decoration: InputDecoration(labelText: question.label, hintText: question.type == 'date' ? strings.datePlaceholder : null),
        keyboardType: question.type == 'number' || question.type == 'scale' ? const TextInputType.numberWithOptions(decimal: true, signed: true) : TextInputType.text,
        onChanged: (value) => onChanged(value.isEmpty ? null : question.type == 'number' || question.type == 'scale' ? num.tryParse(value) ?? value : value),
      ),
    for(final option in question.options.where((o)=>o['other']!=null && selectedChoices(answer).contains(o['id'])))
      TextFormField(
        key: ValueKey('$collectionKey:${question.id}:${option['id']}:other'),
        enabled: !disabled,
        initialValue: otherTexts(answer)[option['id']]??'',
        decoration: InputDecoration(labelText:'${question.label}: ${option['label']}'),
        onChanged: (value)=>onChanged(setOtherText(question,answer,option['id'],value)),
      ),
  ]);
}
