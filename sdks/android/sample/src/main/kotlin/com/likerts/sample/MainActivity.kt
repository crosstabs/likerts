package com.likerts.sample

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.likerts.sdk.Collection
import com.likerts.sdk.LikertsSurvey
import com.likerts.sdk.Option
import com.likerts.sdk.Question
import com.likerts.sdk.SurveySchema
import com.likerts.sdk.SurveyStrings

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                val submitted = remember { mutableStateOf(false) }
                Surface(Modifier.fillMaxSize()) {
                    LikertsSurvey(
                        collection = sampleCollection,
                        disabled = submitted.value,
                        modifier = Modifier.verticalScroll(rememberScrollState()),
                        strings = SurveyStrings(submitLabel = "Send feedback"),
                        onSubmit = { submitted.value = true },
                    )
                }
            }
        }
    }
}

private val sampleCollection = Collection(
    id = "sample-collection",
    surveyId = "sample-survey",
    version = 1,
    placement = "android-sample",
    schema = SurveySchema(
        schemaVersion = 2,
        title = "Product feedback",
        questions = listOf(
            Question("recommend", "scale", "How likely are you to recommend us?", required = true, min = 0.0, max = 10.0, preset = "nps"),
            Question("reason", "text", "What is the main reason for your score?"),
            Question("contact", "single_choice", "May we contact you?", options = listOf(Option("yes", "Yes"), Option("no", "No"))),
        ),
    ),
)
