import Foundation

public struct SurveyProgress: Sendable, Equatable {
  public let current: Int
  public let total: Int
  public let visited: Int
  public init(current: Int, total: Int, visited: Int) { self.current=current;self.total=total;self.visited=visited }
}
private func effectivePages(_ schema:SurveySchema)->[SurveyPage]{schema.pages ?? [SurveyPage(id:"survey",questionIds:schema.questions.map(\.id))]}
public func pageRoute(_ schema:SurveySchema,answers:[String:Answer])->[Int]{let all=effectivePages(schema),ids=Dictionary(uniqueKeysWithValues:all.enumerated().map{($0.element.id,$0.offset)}),visible=visibleAnswers(schema.questions,answers:answers);var available=Set<String>(),route:[Int]=[],current=0;while current<all.count{route.append(current);available.formUnion(all[current].questionIds);let branch=all[current].branches?.first{conditionMatches($0.when,available.contains($0.when.questionId) ? visible[$0.when.questionId]:nil)};current=branch.flatMap{ids[$0.goToPageId]} ?? current+1};return route}
public func routedAnswers(_ schema:SurveySchema,answers:[String:Answer])->[String:Answer]{var result=visibleAnswers(schema.questions,answers:answers),pass=0;let all=effectivePages(schema);while pass<=schema.questions.count{let reached=Set(pageRoute(schema,answers:result).flatMap{all[$0].questionIds});let filtered=visibleAnswers(schema.questions,answers:result.filter{reached.contains($0.key)});if filtered.count==result.count{return filtered};result=filtered;pass+=1};return [:]}
public final class SurveyFlow: @unchecked Sendable {
  public let schema:SurveySchema
  private var route:[Int]
  private var history:[Int]
  private var current:Int
  private var values:[String:Answer]
  public init(schema:SurveySchema,answers:[String:Answer]=[:]){self.schema=schema;values=routedAnswers(schema,answers:answers);route=pageRoute(schema,answers:values);current=route.first ?? 0;history=[current]}
  public var page:SurveyPage{effectivePages(schema)[current]}
  public var answers:[String:Answer]{values}
  public var progress:SurveyProgress{SurveyProgress(current:current+1,total:effectivePages(schema).count,visited:history.count)}
  public func setAnswer(_ id:String,_ value:Answer?){let old=history;if let value{values[id]=value}else{values.removeValue(forKey:id)};values=routedAnswers(schema,answers:values);route=pageRoute(schema,answers:values);if !route.contains(current){var shared=route.first ?? 0;for index in 0..<min(old.count,route.count){if old[index] != route[index]{break};shared=route[index]};current=shared};history=Array(route.prefix((route.firstIndex(of:current) ?? 0)+1))}
  @discardableResult public func next()->Bool{guard let index=route.firstIndex(of:current),index+1<route.count else{return false};current=route[index+1];history=Array(route.prefix(index+2));return true}
  @discardableResult public func back()->Bool{guard history.count>1 else{return false};history.removeLast();current=history.last!;return true}
}
