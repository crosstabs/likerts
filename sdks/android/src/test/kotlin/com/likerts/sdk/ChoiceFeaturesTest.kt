package com.likerts.sdk

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ChoiceFeaturesTest {
    @Test fun sharedChoiceValuesAndWireRepresentation() {
        val fixture = Json.parseToJsonElement(java.io.File("../../contracts/choice-features.json").readText()).jsonObject
        val q = Json.decodeFromJsonElement<Question>(fixture.getValue("question"))
        fixture.getValue("valid").jsonArray.forEach { value ->
            val selected = value.jsonObject.getValue("selected").jsonArray.map { it.jsonPrimitive.content }
            val text = value.jsonObject.getValue("otherText").jsonObject.mapValues { it.value.jsonPrimitive.content }
            assertNull(q.choiceError(selected, text))
            assertEquals(value, q.choiceAnswer(selected, text))
        }
        fixture.getValue("invalid").jsonArray.filterIsInstance<JsonObject>().forEach { value ->
            val selected = value.getValue("selected").jsonArray.map { it.jsonPrimitive.content }
            val text = value.getValue("otherText").jsonObject.mapValues { it.value.jsonPrimitive.content }
            assertNotNull(q.choiceError(selected, text))
        }
        assertEquals(listOf("none"), q.toggledChoices(listOf("quality","other"), "none"))
        assertEquals(listOf("quality"), q.toggledChoices(listOf("none"), "quality"))
    }
}
