package com.likerts.sdk

object AdvancedQuestions {
    fun move(order:List<String>,id:String,offset:Int):List<String>{val from=order.indexOf(id);if(from<0)return order;val to=(from+offset).coerceIn(0,order.lastIndex);return order.toMutableList().apply{removeAt(from);add(to,id)}}
    fun setMatrix(answer:Map<String,List<String>>,row:String,column:String,multiple:Boolean):Map<String,List<String>>{val next=answer.toMutableMap();if(!multiple){next[row]=listOf(column);return next};val selected=(next[row]?:emptyList()).toMutableList();if(column in selected)selected.remove(column)else selected+=column;if(selected.isEmpty())next.remove(row)else next[row]=selected;return next}
    fun remaining(total:Int,answer:Map<String,Int>)=total-answer.values.sum()
    fun validRanking(answer:List<String>,options:List<String>)=answer.size==options.size&&answer.toSet().size==answer.size&&answer.all{it in options}
    fun validMatrix(answer:Map<String,List<String>>,rows:List<String>,columns:List<String>,multiple:Boolean,required:Boolean)=answer.isNotEmpty()&&(!required||answer.size==rows.size)&&answer.all{(row,selected)->row in rows&&(if(multiple)selected.isNotEmpty()else selected.size==1)&&selected.toSet().size==selected.size&&selected.all{it in columns}}
    fun validAllocation(answer:Map<String,Int>,items:List<String>,total:Int)=answer.size==items.size&&answer.keys.all{it in items}&&answer.values.all{it in 0..total}&&remaining(total,answer)==0
}
