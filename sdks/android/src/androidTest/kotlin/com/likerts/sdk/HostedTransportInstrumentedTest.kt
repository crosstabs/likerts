package com.likerts.sdk

import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Opt-in, same-team synthetic transport acceptance. No configuration means no network. */
class HostedTransportInstrumentedTest {
    @Test(timeout = 60000) fun nativeClientFetchSubmitAndIdenticalRetry() = runBlocking {
        val files = InstrumentationRegistry.getInstrumentation().context.filesDir
        val input = File(files, "likerts-hosted.json")
        assumeTrue("Hosted acceptance not configured", input.isFile)
        var stage = "configuration"
        try {
            val config = JSONObject(input.readText())
            check(config.getString("target") == "android" && config.getBoolean("disposable") && config.getInt("responseCap") == 1)
            check(config.getString("sdkVersion") == LIKERTS_SDK_CAPABILITY.sdkVersion)
            val id = config.getString("collectionId")
            val client = LikertsClient(config.getString("baseUrl"), config.getString("collectionToken"), 10000, 10000)
            withTimeout(50000) {
                stage = "collection"
                val collection = client.collection(id, refresh = true)
                check(collection.id == id && collection.schema.questions.any { it.id == "rating" && it.type == "scale" })
                val submission = Submission(config.getString("idempotencyKey"), mapOf("rating" to JsonPrimitive(5)),
                    JsonObject(mapOf("source" to JsonPrimitive("synthetic-native-hosted"), "target" to JsonPrimitive("android"))))
                stage = "submit"
                val receipt = client.submit(id, submission)
                check(receipt.collectionId == id && receipt.accepted && receipt.responseId.isNotEmpty())
                stage = "identical_retry"
                val retry = client.submit(id, submission)
                check(receipt == retry)
                File(files, "likerts-hosted-result.json").writeText(JSONObject(mapOf(
                    "target" to "android", "sdkVersion" to "0.0.3", "result" to "passed",
                    "collectionId" to id, "responseId" to receipt.responseId,
                    "identicalRetrySameReceipt" to true, "sdkRequests" to 3,
                    "boundary" to "same-team synthetic native transport; ledger verified separately"
                )).toString())
            }
        } catch (_: Throwable) { fail("Hosted transport acceptance failed at $stage (details redacted)") }
    }
}
