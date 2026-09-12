package com.likerts.sdk

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.*

/** Host-provided copy. Supplying this value keeps all respondent-facing text localizable. */
data class SurveyStrings(
    val requiredLabel: String = "required",
    val submitLabel: String = "Submit",
    val backLabel: String = "Back",
    val nextLabel: String = "Next",
    val progressLabel: (Int, Int, Int) -> String = { current, total, visited -> "Page $current of $total · $visited visited" },
    val selectAnswer: String = "Select an answer",
    val otherError: (String) -> String = { "$it: enter valid text for the selected Other option." },
    val datePlaceholder: String = "YYYY-MM-DD",
    val chooseAtLeast: (Int) -> String = { "Choose at least $it options" },
    val chooseAtMost: (Int) -> String = { "Choose at most $it options" },
    val answerRequired: (String) -> String = { "$it: an answer is required." },
    val moveUp:String="Move up",val moveDown:String="Move down",val remaining:(Int)->String={"$it remaining"},val advancedError:(String)->String={"$it: complete the answer."},
)

/** Layout and validation colors that can be aligned with the host application's theme. */
data class SurveyStyle(
    val contentPadding: Dp = 16.dp,
    val questionSpacing: Dp = 20.dp,
    val controlSpacing: Dp = 8.dp,
    val errorColor: Color? = null,
)

private fun answers(questions: List<Question>, values: Map<String, String>, choices: Map<String, Set<String>>, otherText: Map<String,Map<String,String>> = emptyMap(),advanced:Map<String,JsonElement> = emptyMap()): Map<String, JsonElement> = buildMap {
    questions.forEach { question ->
        advanced[question.id]?.let{put(question.id,it);return@forEach}
        if (question.type == "multiple_choice") {
            choices[question.id]?.takeIf(Set<String>::isNotEmpty)?.let { put(question.id, question.choiceAnswer(it.sorted(),otherText[question.id].orEmpty())) }
        } else values[question.id]?.takeIf(String::isNotEmpty)?.let { value ->
            val answer = if (question.type == "scale" || question.type == "number") value.toDoubleOrNull()?.takeIf(Double::isFinite)?.let(::JsonPrimitive) ?: JsonPrimitive(value) else if(question.type == "single_choice") question.choiceAnswer(listOf(value),otherText[question.id].orEmpty()) else JsonPrimitive(value)
            put(question.id, answer)
        }
    }
}

private fun visibleAnswers(questions:List<Question>,values:Map<String,String>,choices:Map<String,Set<String>>,otherText:Map<String,Map<String,String>>,advanced:Map<String,JsonElement>):Map<String,JsonElement> = com.likerts.sdk.visibleAnswers(questions,answers(questions,values,choices,otherText,advanced))

private fun validationError(question: Question, textValue: String?, selected: Set<String>?, strings: SurveyStrings, otherText:Map<String,String>,advanced:JsonElement?): String? {
    if(question.type in setOf("ranking","matrix","constant_sum")){
        if(advanced==null)return if(question.required)strings.answerRequired(question.label)else null
        val valid=when(question.type){"ranking"->AdvancedQuestions.validRanking(advanced.jsonArray.map{it.jsonPrimitive.content},question.options.map{it.id});"matrix"->{val value=advanced.jsonObject.mapValues{(_,v)->if(v is JsonArray)v.map{it.jsonPrimitive.content}else listOf(v.jsonPrimitive.content)};AdvancedQuestions.validMatrix(value,question.rows.orEmpty().map{it.id},question.columns.orEmpty().map{it.id},question.matrixMode=="multiple",question.required)};else->{val value=advanced.jsonObject.mapValues{it.value.jsonPrimitive.int};AdvancedQuestions.validAllocation(value,question.items.orEmpty().map{it.id},question.total?:0)}}
        return if(valid)null else strings.advancedError(question.label)
    }
    val missing = if (question.type == "multiple_choice") selected.isNullOrEmpty() else textValue.isNullOrEmpty()
    if (question.required && missing) return strings.answerRequired(question.label)
    if(question.type != "single_choice" && question.type != "multiple_choice") return null
    val ids=if(question.type=="single_choice") listOfNotNull(textValue?.takeIf(String::isNotEmpty)) else selected.orEmpty().toList()
    val error=question.choiceError(ids,otherText) ?: return null
    val minimum=maxOf(question.minSelections ?: 0,if(question.required) 1 else 0)
    return if(error=="range") { if(ids.size<minimum) strings.chooseAtLeast(minimum) else strings.chooseAtMost(question.maxSelections ?: question.options.size) } else strings.otherError(question.label)
}

/** Native Compose renderer. Form state is bound to collection ID and immutable version. */
@Composable fun LikertsSurvey(
    collection: Collection,
    disabled: Boolean = false,
    modifier: Modifier = Modifier,
    strings: SurveyStrings = SurveyStrings(),
    style: SurveyStyle = SurveyStyle(),
    onAnswersChange: ((Map<String, JsonElement>) -> Unit)? = null,
    onSubmit: (Map<String, JsonElement>) -> Unit,
) {
    var formError by remember(collection.id, collection.version) { mutableStateOf<String?>(null) }
    val values = remember(collection.id, collection.version) { mutableStateMapOf<String, String>() }
    val choices = remember(collection.id, collection.version) { mutableStateMapOf<String, Set<String>>() }
    val otherText = remember(collection.id,collection.version) { mutableStateMapOf<String,Map<String,String>>() }
    val dropdowns = remember(collection.id,collection.version) { mutableStateMapOf<String,Boolean>() }
    val advanced=remember(collection.id,collection.version){mutableStateMapOf<String,JsonElement>()}
    val flow = remember(collection.id, collection.version) { SurveyFlow(collection.schema) }
    var flowRevision by remember(collection.id, collection.version) { mutableIntStateOf(0) }
    fun changed() {
        formError = null
        collection.schema.questions.forEach { q ->
            val selected = if (q.type == "single_choice") listOfNotNull(values[q.id]) else choices[q.id].orEmpty().toList()
            otherText[q.id]?.let { text -> otherText[q.id] = text.filterKeys { it in selected } }
        }
        val raw = answers(collection.schema.questions, values, choices, otherText,advanced)
        val previous = flow.answers
        (previous.keys + raw.keys).filter { previous[it] != raw[it] }.forEach { flow.setAnswer(it, raw[it]) }
        val retained = flow.answers.keys
        values.keys.removeAll { it !in retained }; choices.keys.removeAll { it !in retained }; otherText.keys.removeAll { it !in retained };advanced.keys.removeAll{it !in retained}
        flowRevision++
        onAnswersChange?.invoke(flow.answers)
    }
    val page = remember(flow, flowRevision) { flow.page }
    val progress = remember(flow, flowRevision) { flow.progress }
    val lastPage = pageRoute(collection.schema, flow.answers).last() == progress.current - 1


    Column(modifier.padding(style.contentPadding).testTag("likerts.survey"), verticalArrangement = Arrangement.spacedBy(style.questionSpacing)) {
        Text(collection.schema.title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.semantics { heading() }.testTag("likerts.title"))
        val visible=visibleQuestionIds(collection.schema.questions,answers(collection.schema.questions,values,choices,otherText,advanced))
        if (collection.schema.pages != null) {
            Text(strings.progressLabel(progress.current, progress.total, progress.visited), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("likerts.progress"))
            page.title?.let { Text(it, modifier = Modifier.semantics { heading() }.testTag("likerts.pageTitle")) }
        }
        val currentQuestions = collection.schema.questions.filter { it.id in visible && it.id in page.questionIds }
        currentQuestions.forEach { question ->
            Column(Modifier.fillMaxWidth().testTag("likerts.question.${question.id}"), verticalArrangement = Arrangement.spacedBy(style.controlSpacing)) {
                Text(question.label + if (question.required) " (${strings.requiredLabel})" else "", style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
                when (question.type) {
                    "ranking" -> {val order=advanced[question.id]?.jsonArray?.map{it.jsonPrimitive.content}?:question.options.map{it.id};order.forEachIndexed{index,id->val option=question.options.first{it.id==id};Row(verticalAlignment=Alignment.CenterVertically){Text("${index+1}. ${option.label}",Modifier.weight(1f));TextButton(enabled=!disabled&&index>0,onClick={advanced[question.id]=JsonArray(AdvancedQuestions.move(order,id,-1).map(::JsonPrimitive));changed()},modifier=Modifier.semantics{contentDescription="${strings.moveUp}: ${option.label}"}){Text(strings.moveUp)};TextButton(enabled=!disabled&&index<order.lastIndex,onClick={advanced[question.id]=JsonArray(AdvancedQuestions.move(order,id,1).map(::JsonPrimitive));changed()},modifier=Modifier.semantics{contentDescription="${strings.moveDown}: ${option.label}"}){Text(strings.moveDown)}}}}
                    "matrix" -> question.rows.orEmpty().forEach{row->Column{Text(row.label);question.columns.orEmpty().forEach{column->val objectValue=advanced[question.id]?.jsonObject;val selected=if(question.matrixMode=="single")objectValue?.get(row.id)?.jsonPrimitive?.content==column.id else objectValue?.get(row.id)?.jsonArray?.any{it.jsonPrimitive.content==column.id}==true;Row(Modifier.fillMaxWidth().toggleable(selected,!disabled,if(question.matrixMode=="single")Role.RadioButton else Role.Checkbox){val existing=objectValue?.mapValues{(_,v)->if(v is JsonArray)v.map{it.jsonPrimitive.content}else listOf(v.jsonPrimitive.content)}.orEmpty();val changedValue=AdvancedQuestions.setMatrix(existing,row.id,column.id,question.matrixMode=="multiple");advanced[question.id]=JsonObject(changedValue.mapValues{(_,v)->if(question.matrixMode=="single")JsonPrimitive(v.first())else JsonArray(v.map(::JsonPrimitive))});changed()}.testTag("likerts.matrix.${question.id}.${row.id}.${column.id}"),verticalAlignment=Alignment.CenterVertically){if(question.matrixMode=="single")RadioButton(selected,null,enabled=!disabled)else Checkbox(selected,null,enabled=!disabled);Text(column.label)}}}}
                    "constant_sum" -> {question.items.orEmpty().forEach{item->val current=advanced[question.id]?.jsonObject?.get(item.id)?.jsonPrimitive?.content.orEmpty();OutlinedTextField(current,{text->val values=advanced[question.id]?.jsonObject?.toMutableMap()?:mutableMapOf();text.toIntOrNull()?.let{values[item.id]=JsonPrimitive(it)}?:values.remove(item.id);advanced[question.id]=JsonObject(values);changed()},enabled=!disabled,label={Text(item.label)},modifier=Modifier.fillMaxWidth().testTag("likerts.allocation.${question.id}.${item.id}"))};val allocated=advanced[question.id]?.jsonObject?.values?.sumOf{it.jsonPrimitive.intOrNull?:0}?:0;Text(strings.remaining((question.total?:0)-allocated),Modifier.semantics{liveRegion=LiveRegionMode.Polite}.testTag("likerts.remaining.${question.id}"))}
                    "single_choice" -> if(question.presentation=="dropdown") Box {
                        OutlinedButton(enabled=!disabled,onClick={dropdowns[question.id]=true},modifier=Modifier.testTag("likerts.dropdown.${question.id}")) { Text(question.options.find { it.id==values[question.id] }?.label ?: strings.selectAnswer) }
                        DropdownMenu(expanded=dropdowns[question.id]==true,onDismissRequest={dropdowns[question.id]=false}) {
                            question.options.forEach { option -> DropdownMenuItem(text={Text(option.label)},enabled=!disabled,onClick={values[question.id]=option.id;dropdowns[question.id]=false;changed()},modifier=Modifier.testTag("likerts.option.${question.id}.${option.id}")) }
                        }
                    } else Column(Modifier.selectableGroup()) { question.options.forEach { option ->
                        val selected = values[question.id] == option.id
                        Row(Modifier.fillMaxWidth().selectable(selected, !disabled, Role.RadioButton) { values[question.id] = option.id; changed() }.testTag("likerts.option.${question.id}.${option.id}"), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected, onClick = null, enabled = !disabled); Text(option.label)
                        }
                    } }
                    "multiple_choice" -> question.options.forEach { option ->
                        val selected = choices[question.id].orEmpty(); val checked = option.id in selected
                        val enabled = !disabled && (checked || option.exclusive==true || question.options.any { it.exclusive==true && it.id in selected } || selected.size < (question.maxSelections ?: Int.MAX_VALUE))
                        Row(Modifier.fillMaxWidth().toggleable(checked, enabled, Role.Checkbox) { choices[question.id] = question.toggledChoices(selected.toList(),option.id).toSet(); changed() }.testTag("likerts.option.${question.id}.${option.id}"), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked, onCheckedChange = null, enabled = enabled); Text(option.label)
                        }
                    }
                    "scale" -> if (question.scaleValues().isNotEmpty()) Column(Modifier.selectableGroup()) { question.scaleValues().forEach { value ->
                        val selected = values[question.id] == value.toString()
                        Row(Modifier.fillMaxWidth().selectable(selected, !disabled, Role.RadioButton) { values[question.id] = value.toString(); changed() }.testTag("likerts.option.${question.id}.$value"), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected, onClick = null, enabled = !disabled); Text(if(question.presentation=="stars") "★".repeat(value) else question.scaleLabel(value),modifier=Modifier.semantics { contentDescription=question.scaleLabel(value) })
                        }
                    } } else OutlinedTextField(values[question.id].orEmpty(), { values[question.id] = it; changed() }, enabled = !disabled, label = { Text(question.label) }, modifier = Modifier.fillMaxWidth().testTag("likerts.input.${question.id}"))
                    else -> OutlinedTextField(values[question.id].orEmpty(), { values[question.id] = it; changed() }, enabled = !disabled, label = { Text(question.label) }, placeholder = if (question.type == "date") ({ Text(strings.datePlaceholder) }) else null, modifier = Modifier.fillMaxWidth().testTag("likerts.input.${question.id}"))
                }
                question.options.filter { it.other != null && (if(question.type=="single_choice") values[question.id]==it.id else it.id in choices[question.id].orEmpty()) }.forEach { option ->
                    OutlinedTextField(otherText[question.id]?.get(option.id).orEmpty(),{otherText[question.id]=otherText[question.id].orEmpty()+(option.id to it);changed()},enabled=!disabled,label={Text("${question.label}: ${option.label}")},modifier=Modifier.fillMaxWidth().testTag("likerts.other.${question.id}.${option.id}"))
                }
            }
        }
        formError?.let { message -> Text(message, color = style.errorColor ?: MaterialTheme.colorScheme.error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive; error(message) }.testTag("likerts.error")) }
        Spacer(Modifier.height(style.controlSpacing))
        if (progress.visited > 1) TextButton(enabled = !disabled, onClick = { flow.back(); flowRevision++; formError = null }, modifier = Modifier.testTag("likerts.back")) { Text(strings.backLabel) }
        Button(enabled = !disabled, onClick = {
            val reachedIds = pageRoute(collection.schema, flow.answers).flatMap { collection.schema.pages?.get(it)?.questionIds ?: collection.schema.questions.map { q -> q.id } }.toSet()
            val toValidate = if (lastPage) collection.schema.questions.filter { it.id in visible && it.id in reachedIds } else currentQuestions
            formError = toValidate.firstNotNullOfOrNull { validationError(it, values[it.id], choices[it.id], strings, otherText[it.id].orEmpty(),advanced[it.id]) }
            if (formError == null) { if (lastPage) onSubmit(routedAnswers(collection.schema, flow.answers)) else { flow.next(); flowRevision++ } }
        }, modifier = Modifier.testTag(if (lastPage) "likerts.submit" else "likerts.next")) { Text(if (lastPage) strings.submitLabel else strings.nextLabel) }
    }
}
