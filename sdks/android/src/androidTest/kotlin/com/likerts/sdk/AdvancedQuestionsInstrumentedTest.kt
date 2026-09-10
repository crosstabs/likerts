package com.likerts.sdk

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AdvancedQuestionsInstrumentedTest {
    @get:Rule val compose = createComposeRule()

    @Test fun stackedControlsEmitExactV5Answers() {
        val submitted = mutableListOf<Map<String, JsonElement>>()
        val changes = mutableListOf<Map<String, JsonElement>>()
        val collection = Collection("c", "s", 1, "p", SurveySchema(5, "Advanced", listOf(
            Question("rank", "ranking", "Rank", required = true,
                options = listOf(Option("a", "A"), Option("b", "B"))),
            Question("matrix", "matrix", "Matrix", required = true,
                rows = listOf(PromptItem("r", "Row")),
                columns = listOf(Option("c1", "One"), Option("c2", "Two")), matrixMode = "single"),
            Question("sum", "constant_sum", "Allocate", required = true,
                items = listOf(PromptItem("x", "X"), PromptItem("y", "Y")), total = 100),
        )))
        compose.setContent {
            MaterialTheme {
                // Like a real app and the sample, the host provides scrolling for
                // content taller than its window, including the open keyboard.
                LikertsSurvey(
                    collection,
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    onAnswersChange = changes::add,
                    onSubmit = submitted::add,
                )
            }
        }
        fun tap(tag: String) = compose.onNodeWithTag(tag)
            .performScrollTo().assertIsDisplayed().performClick()

        tap("likerts.submit")
        compose.onNodeWithTag("likerts.error").assertTextEquals("Rank: an answer is required.")
        compose.runOnIdle { assertTrue(submitted.isEmpty()) }

        compose.onNodeWithContentDescription("Move down: A")
            .performScrollTo().assertIsDisplayed().performClick()
        tap("likerts.matrix.matrix.r.c2")
        compose.onNodeWithTag("likerts.matrix.matrix.r.c2").assertIsOn()
        compose.onNodeWithTag("likerts.allocation.sum.x").performScrollTo().performTextInput("60")
        compose.onNodeWithTag("likerts.allocation.sum.y").performScrollTo().performTextInput("40")
        compose.onNodeWithTag("likerts.remaining.sum").assertTextEquals("0 remaining")

        val expected = mapOf(
            "rank" to JsonArray(listOf(JsonPrimitive("b"), JsonPrimitive("a"))),
            "matrix" to JsonObject(mapOf("r" to JsonPrimitive("c2"))),
            "sum" to JsonObject(mapOf("x" to JsonPrimitive(60), "y" to JsonPrimitive(40))),
        )
        compose.runOnIdle { assertEquals(expected, changes.last()) }
        tap("likerts.submit")
        compose.onNodeWithTag("likerts.error").assertDoesNotExist()
        compose.runOnIdle {
            assertEquals("A visible Submit action must emit once", 1, submitted.size)
            assertEquals(expected, submitted.single())
        }
    }
}
