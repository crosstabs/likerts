import Foundation

extension Answer {
  var selectedValues:[String]? { switch self { case .text(let value): return [value];case .choices(let values),.ranking(let values): return values;case .other(let selected,_):return selected;case .number,.matrixSingle,.matrixMultiple,.allocation:return nil } }
  var isAnswered:Bool { switch self {case .text(let value):return !value.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty;case .number:return true;case .choices(let values),.ranking(let values):return !values.isEmpty;case .other(let selected,_):return !selected.isEmpty;case .matrixSingle(let values):return !values.isEmpty;case .matrixMultiple(let values):return !values.isEmpty;case .allocation(let values):return !values.isEmpty} }
}

func conditionMatches(_ condition:VisibilityCondition,_ answer:Answer?)->Bool {
  switch condition.operator {
  case .answered:return answer?.isAnswered==true
  case .notAnswered:return answer?.isAnswered != true
  case .equals,.notEquals:
    guard let answer else{return false};let equal:Bool
    switch (answer,condition.value) {case (.number(let actual),.number(let expected)):equal=actual==expected;case (_, .string(let expected)):equal=answer.selectedValues==[expected];default:equal=false}
    return condition.operator == .equals ? equal : !equal
  case .includes,.notIncludes:
    guard let answer,case .string(let expected)?=condition.value else{return false};let included=answer.selectedValues?.contains(expected)==true
    return condition.operator == .includes ? included : !included
  }
}

public func visibleQuestionIDs(_ questions:[Question],answers:[String:Answer])->Set<String> {
  let byId=Dictionary(uniqueKeysWithValues:questions.map{($0.id,$0)});var memo:[String:Bool]=[:];var active=Set<String>()
  func visible(_ question:Question)->Bool {if let value=memo[question.id]{return value};if !active.insert(question.id).inserted{return false};defer{active.remove(question.id)};guard let condition=question.visibleWhen else{memo[question.id]=true;return true};guard let source=byId[condition.questionId] else{memo[question.id]=false;return false};let result=conditionMatches(condition,visible(source) ? answers[source.id]:nil);memo[question.id]=result;return result}
  return Set(questions.filter(visible).map(\.id))
}

public func visibleAnswers(_ questions:[Question],answers:[String:Answer])->[String:Answer] {
  let visible=visibleQuestionIDs(questions,answers:answers);return answers.filter{visible.contains($0.key)}
}
