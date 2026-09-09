package com.likerts.sdk

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ChoiceInstrumentedTest {
    @get:Rule val compose = createComposeRule()
    @Test fun otherNoneStarsAndDropdownKeepAnswerSemantics() {
        val submitted = mutableListOf<Map<String,JsonElement>>()
        val collection=Collection("c","s",1,"p",SurveySchema(3,"Choices",listOf(
            Question("reasons","multiple_choice","Reasons",required=true,minSelections=2,maxSelections=3,options=listOf(Option("quality","Quality"),Option("service","Service"),Option("other","Other",other=OtherText(10)),Option("none","None",exclusive=true))),
            Question("rating","scale","Rating",required=true,min=1.0,max=5.0,presentation="stars"),
            Question("channel","single_choice","Channel",options=listOf(Option("app","App"),Option("store","Store")),presentation="dropdown")
        )))
        compose.setContent { MaterialTheme { LikertsSurvey(collection,modifier=Modifier.verticalScroll(rememberScrollState()),onSubmit=submitted::add) } }
        fun tap(tag:String) { compose.onNodeWithTag(tag).performScrollTo().performClick() }
        tap("likerts.option.reasons.quality");tap("likerts.option.reasons.other");tap("likerts.option.rating.4");tap("likerts.submit");assertTrue(submitted.isEmpty())
        compose.onNodeWithTag("likerts.other.reasons.other").performScrollTo().performTextInput("Speed")
        tap("likerts.dropdown.channel");compose.onNodeWithTag("likerts.option.channel.app").performClick();tap("likerts.submit")
        assertEquals(JsonPrimitive(4.0),submitted.last()["rating"]);assertEquals(JsonPrimitive("app"),submitted.last()["channel"])
        assertEquals(Json.parseToJsonElement("""{"selected":["other","quality"],"otherText":{"other":"Speed"}}"""),submitted.last()["reasons"])
        tap("likerts.option.reasons.none");compose.onNodeWithTag("likerts.other.reasons.other").assertDoesNotExist();tap("likerts.submit")
        assertEquals(Json.parseToJsonElement("""{"selected":["none"],"otherText":{}}"""),submitted.last()["reasons"])
        tap("likerts.option.reasons.quality");tap("likerts.option.reasons.other");compose.onNodeWithTag("likerts.other.reasons.other").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText,AnnotatedString("")))
    }
}
