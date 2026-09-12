package com.likerts.sdk

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SurveyInstrumentedTest {
    @get:Rule val compose = createComposeRule()

    @Test fun accessibleSelectionLocalizedValidationAndVersionReset() {
        val submitted = mutableListOf<Map<String, JsonElement>>()
        val current = mutableStateOf(collection(version = 1))
        compose.setContent {
            MaterialTheme {
                LikertsSurvey(
                    collection = current.value,
                    strings = SurveyStrings(requiredLabel = "obligatorio", submitLabel = "Enviar", answerRequired = { "Falta: $it" }),
                    onSubmit = submitted::add,
                )
            }
        }

        compose.onNodeWithTag("likerts.submit").assertTextContains("Enviar").performClick()
        compose.onNodeWithTag("likerts.error").assertTextContains("Falta: Satisfaction")
        compose.onNodeWithTag("likerts.option.score.5").assertIsNotSelected().performClick().assertIsSelected()
        compose.onNodeWithTag("likerts.option.channels.app").assertIsOff().performClick().assertIsOn()
        compose.onNodeWithTag("likerts.option.channels.web").assertIsNotEnabled()
        compose.onNodeWithTag("likerts.submit").performClick()
        assertEquals(1, submitted.size)

        compose.runOnIdle { current.value = collection(version = 2) }
        compose.onNodeWithTag("likerts.option.score.5").assertIsNotSelected()
    }

    private fun collection(version: Int) = Collection(
        id = "c", surveyId = "s", version = version, placement = "test",
        schema = SurveySchema(2, "Feedback", listOf(
            Question("score", "scale", "Satisfaction", required = true, min = 1.0, max = 5.0, labels = mapOf("1" to "Low", "5" to "High")),
            Question("channels", "multiple_choice", "Channels", maxSelections = 1, options = listOf(Option("app", "App"), Option("web", "Web"))),
        )),
    )
}
