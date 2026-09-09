import Foundation

public enum AdvancedQuestions {
  public static func move(_ order:[String], id:String, offset:Int)->[String] { guard let from=order.firstIndex(of:id) else{return order};let to=max(0,min(order.count-1,from+offset));var next=order;next.remove(at:from);next.insert(id,at:to);return next }
  public static func setMatrix(_ answer:[String:[String]],row:String,column:String,multiple:Bool)->[String:[String]] { var next=answer;if !multiple{next[row]=[column];return next};var selected=next[row] ?? [];if let index=selected.firstIndex(of:column){selected.remove(at:index)}else{selected.append(column)};if selected.isEmpty{next.removeValue(forKey:row)}else{next[row]=selected};return next }
  public static func remaining(total:Int,answer:[String:Int])->Int { total-answer.values.reduce(0,+) }
  public static func validRanking(_ answer:[String],options:[String])->Bool { answer.count==options.count && Set(answer).count==answer.count && answer.allSatisfy(options.contains) }
  public static func validMatrix(_ answer:[String:[String]],rows:[String],columns:[String],multiple:Bool,required:Bool)->Bool { !answer.isEmpty && (!required || answer.count==rows.count) && answer.allSatisfy { row,selected in rows.contains(row) && (multiple ? !selected.isEmpty : selected.count==1) && Set(selected).count==selected.count && selected.allSatisfy(columns.contains) } }
  public static func validAllocation(_ answer:[String:Int],items:[String],total:Int)->Bool { answer.count==items.count && answer.keys.allSatisfy(items.contains) && answer.values.allSatisfy{$0>=0&&$0<=total} && remaining(total:total,answer:answer)==0 }
}
