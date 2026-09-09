package com.likerts.sdk

import kotlinx.serialization.json.*

private fun selected(answer:JsonElement):List<String>? = when(answer){is JsonArray->answer.mapNotNull{it.jsonPrimitive.contentOrNull};is JsonObject->answer["selected"]?.jsonArray?.mapNotNull{it.jsonPrimitive.contentOrNull};is JsonPrimitive->answer.contentOrNull?.let(::listOf)}
private fun answered(answer:JsonElement?):Boolean = when(answer){null,JsonNull->false;is JsonArray->answer.isNotEmpty();is JsonObject->selected(answer)?.isNotEmpty()==true;is JsonPrimitive->if(answer.isString)answer.content.trim().isNotEmpty()else true}
internal fun conditionMatches(condition:VisibilityCondition,answer:JsonElement?):Boolean = when(condition.operator){
    "answered"->answered(answer);"not_answered"->!answered(answer)
    "equals","not_equals"->{if(answer==null)false else {val actual=selected(answer)?.takeIf{it.size==1}?.first()?.let(::JsonPrimitive)?:answer;val equal=actual==condition.value;if(condition.operator=="equals")equal else !equal}}
    "includes","not_includes"->{if(answer==null)false else {val included=condition.value?.contentOrNull?.let{selected(answer)?.contains(it)}==true;if(condition.operator=="includes")included else !included}}
    else->throw IllegalArgumentException("Unsupported visibility operator")
}
fun visibleQuestionIds(questions:List<Question>,answers:Map<String,JsonElement>):Set<String>{val byId=questions.associateBy{it.id};val memo=mutableMapOf<String,Boolean>();val active=mutableSetOf<String>();fun visible(q:Question):Boolean{memo[q.id]?.let{return it};check(active.add(q.id)){"Conditional visibility cycle"};val condition=q.visibleWhen;val result=if(condition==null)true else {val source=requireNotNull(byId[condition.questionId]){"Conditional visibility references an unknown question"};conditionMatches(condition,if(visible(source))answers[source.id]else null)};active.remove(q.id);memo[q.id]=result;return result};return questions.filter(::visible).mapTo(mutableSetOf()){it.id}}
fun visibleAnswers(questions:List<Question>,answers:Map<String,JsonElement>):Map<String,JsonElement>{val visible=visibleQuestionIds(questions,answers);return answers.filterKeys(visible::contains)}
