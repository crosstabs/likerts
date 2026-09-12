package com.likerts.installprobe

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.likerts.sdk.Collection
import com.likerts.sdk.LikertsSurvey
import kotlinx.serialization.json.JsonElement

// Host policy supplies eligibility; host code retains the immutable Submission
// across ambiguous failures and cancels its coroutine when this UI is removed.
@Composable fun CheckoutFeedback(collection: Collection, eligible: Boolean, submitting: Boolean,
    onSubmit: (Map<String, JsonElement>) -> Unit, onDismiss: () -> Unit) {
    var visible by remember { mutableStateOf(false) }
    if (!eligible) return
    Button(onClick = { visible = true }) { Text("Give feedback") }
    if (visible) {
        LikertsSurvey(collection = collection, disabled = submitting, onSubmit = onSubmit)
        Button(onClick = { visible = false; onDismiss() }) { Text("Dismiss") }
    }
}
