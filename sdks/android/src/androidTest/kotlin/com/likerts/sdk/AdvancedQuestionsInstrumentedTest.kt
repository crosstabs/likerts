package com.likerts.sdk
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AdvancedQuestionsInstrumentedTest{
 @get:Rule val compose=createComposeRule()
 @Test fun stackedControlsEmitExactV5Answers(){val submitted=mutableListOf<Map<String,JsonElement>>();val collection=Collection("c","s",1,"p",SurveySchema(5,"Advanced",listOf(
  Question("rank","ranking","Rank",required=true,options=listOf(Option("a","A"),Option("b","B"))),
  Question("matrix","matrix","Matrix",required=true,rows=listOf(PromptItem("r","Row")),columns=listOf(Option("c1","One"),Option("c2","Two")),matrixMode="single"),
  Question("sum","constant_sum","Allocate",required=true,items=listOf(PromptItem("x","X"),PromptItem("y","Y")),total=100)
 )));compose.setContent{MaterialTheme{LikertsSurvey(collection,onSubmit=submitted::add)}};compose.onNodeWithContentDescription("Move down: A").performClick();compose.onNodeWithTag("likerts.matrix.matrix.r.c2").performClick();compose.onNodeWithTag("likerts.allocation.sum.x").performTextInput("60");compose.onNodeWithTag("likerts.allocation.sum.y").performTextInput("40");compose.onNodeWithTag("likerts.remaining.sum").assertTextEquals("0 remaining");compose.onNodeWithTag("likerts.submit").performClick();compose.runOnIdle{assertEquals(JsonArray(listOf(JsonPrimitive("b"),JsonPrimitive("a"))),submitted.single()["rank"]);assertEquals(JsonPrimitive("c2"),submitted.single()["matrix"]!!.jsonObject["r"]);assertEquals(60,submitted.single()["sum"]!!.jsonObject["x"]!!.jsonPrimitive.int)}}
}
