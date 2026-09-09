package com.likerts.sdk

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class BranchingInstrumentedTest {
    @get:Rule val compose = createComposeRule()
    @Test fun pagesValidateAndBackFollowsRouteWhileSkippedAnswersArePruned() {
        val submitted = mutableListOf<Map<String,JsonElement>>()
        val changes = mutableListOf<Map<String,JsonElement>>()
        val collection = Collection("c","s",1,"p",SurveySchema(4,"Visit",listOf(
            Question("return","single_choice","Would you return?",required=true,options=listOf(Option("yes","Yes"),Option("no","No"))),
            Question("highlight","text","What went well?",required=true),
            Question("problem","text","What should we fix?",required=true,visibleWhen=VisibilityCondition("return","equals",JsonPrimitive("no"))),
            Question("followUp","single_choice","Follow up?",options=listOf(Option("yes","Yes"),Option("no","No")))
        ), pages=listOf(
            SurveyPage("experience",questionIds=listOf("return"),branches=listOf(PageBranch(VisibilityCondition("return","equals",JsonPrimitive("no")),"recovery"))),
            SurveyPage("praise",questionIds=listOf("highlight"),branches=listOf(PageBranch(VisibilityCondition("return","equals",JsonPrimitive("yes")),"contact"))),
            SurveyPage("recovery",questionIds=listOf("problem")),SurveyPage("contact",questionIds=listOf("followUp"))
        )))
        compose.setContent { MaterialTheme { LikertsSurvey(collection,modifier=Modifier.verticalScroll(rememberScrollState()),onAnswersChange=changes::add,onSubmit=submitted::add) } }
        fun tap(tag:String) { compose.onNodeWithTag(tag).performScrollTo().performClick() }
        fun progress(text:String) { compose.onNodeWithTag("likerts.progress").assertTextEquals(text) }
        progress("Page 1 of 4 · 1 visited");compose.onNodeWithTag("likerts.question.highlight").assertDoesNotExist()
        tap("likerts.next");compose.onNodeWithTag("likerts.error").assertExists()
        tap("likerts.option.return.yes");tap("likerts.next");progress("Page 2 of 4 · 2 visited")
        tap("likerts.next");compose.onNodeWithTag("likerts.error").assertExists()
        compose.onNodeWithTag("likerts.input.highlight").performScrollTo().performTextInput("Friendly staff")
        tap("likerts.next");progress("Page 4 of 4 · 3 visited");compose.onNodeWithTag("likerts.question.problem").assertDoesNotExist()
        tap("likerts.back");progress("Page 2 of 4 · 2 visited");compose.onNodeWithTag("likerts.input.highlight").assertTextContains("Friendly staff")
        tap("likerts.back");tap("likerts.option.return.no");compose.runOnIdle { assertFalse(changes.last().containsKey("highlight")) }
        tap("likerts.next");progress("Page 3 of 4 · 2 visited")
        tap("likerts.next");compose.onNodeWithTag("likerts.error").assertExists()
        compose.onNodeWithTag("likerts.input.problem").performScrollTo().performTextInput("Long wait")
        tap("likerts.next");tap("likerts.submit")
        compose.runOnIdle { assertEquals(mapOf("return" to JsonPrimitive("no"),"problem" to JsonPrimitive("Long wait")),submitted.single()) }
        tap("likerts.back");progress("Page 3 of 4 · 2 visited")
    }
}
