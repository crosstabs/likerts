package com.likerts.sdk

import kotlinx.serialization.json.*

fun Question.choiceAnswer(selected: List<String>, otherText: Map<String, String> = emptyMap()): JsonElement {
    if (options.any { it.other != null }) return buildJsonObject {
        put("selected", JsonArray(selected.map(::JsonPrimitive)))
        put("otherText", buildJsonObject { options.filter { it.other != null && it.id in selected }.forEach { put(it.id, otherText[it.id] ?: "") } })
    }
    return if (type == "single_choice") JsonPrimitive(selected.firstOrNull() ?: "") else JsonArray(selected.map(::JsonPrimitive))
}

fun Question.toggledChoices(current: List<String>, id: String): List<String> {
    val option = options.find { it.id == id } ?: return current
    if (type == "single_choice") return listOf(id)
    if (id in current) return current - id
    if (option.exclusive == true) return listOf(id)
    return current.filter { selected -> options.find { it.id == selected }?.exclusive != true } + id
}

/** Stable local-feedback code; respondent text belongs to the host's localization. */
fun Question.choiceError(selected: List<String>, otherText: Map<String, String> = emptyMap()): String? {
    if (selected.isEmpty()) return if (required) "required" else null
    if (selected.distinct().size != selected.size || selected.any { id -> options.none { it.id == id } }) return "invalid"
    val exclusive = selected.any { id -> options.any { it.id == id && it.exclusive == true } }
    if (exclusive && selected.size != 1) return "invalid"
    if (type == "single_choice") { if (selected.size != 1) return "range" }
    else if (selected.size > (maxSelections ?: options.size) || (!exclusive && selected.size < maxOf(minSelections ?: 0, if (required) 1 else 0))) return "range"
    val expected = options.filter { it.other != null && it.id in selected }
    if (otherText.size != expected.size) return "other"
    expected.forEach { option -> val text = otherText[option.id] ?: return "other"; if (text.isBlank() || text.codePointCount(0,text.length) > option.other!!.maxLength) return "other" }
    return null
}
