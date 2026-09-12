package com.likerts.sdk

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

@Serializable data class SDKInstallationCapability(val target: String, val sdkVersion: String, val schemaVersions: List<Int>)
val LIKERTS_SDK_CAPABILITY = SDKInstallationCapability("android", "0.0.3", listOf(1, 2, 3, 4, 5))

@Serializable data class OtherText(val maxLength:Int)
@Serializable data class Option(val id: String, val label: String, val other:OtherText?=null,val exclusive:Boolean?=null)
@Serializable data class VisibilityCondition(val questionId:String,val operator:String,val value:JsonPrimitive?=null)
@Serializable data class PromptItem(val id:String,val label:String)
@Serializable data class PageBranch(val `when`:VisibilityCondition,val goToPageId:String)
@Serializable data class SurveyPage(val id:String,val title:String?=null,val questionIds:List<String>,val branches:List<PageBranch> = emptyList())
@Serializable data class Question(val id: String, val type: String, val label: String, val required: Boolean = false, val options: List<Option> = emptyList(), val min: Double? = null, val max: Double? = null, val maxLength: Int? = null, val preset: String? = null, val labels: Map<String, String>? = null, val minSelections: Int? = null, val maxSelections: Int? = null,val visibleWhen:VisibilityCondition?=null,val presentation:String?=null,val rows:List<PromptItem>?=null,val columns:List<Option>?=null,val matrixMode:String?=null,val items:List<PromptItem>?=null,val total:Int?=null) {
    fun scaleValues(): List<Int> = if (type == "scale" && (preset == "nps" || labels != null || presentation == "stars") && min != null && max != null && min >= -10000 && max <= 10000 && min <= max) (min.toInt()..max.toInt()).toList() else emptyList()
    fun scaleLabel(value: Int): String = labels?.get(value.toString())?.let { "$value — $it" } ?: value.toString()
    fun selectionError(selected: kotlin.collections.Collection<String>?): String? {
        if (type != "multiple_choice") return null
        if (selected == null) return if (required) "Choose at least one option" else null
        val minimum = maxOf(minSelections ?: 0, if (required) 1 else 0)
        return when { selected.size < minimum -> "Choose at least $minimum options"; maxSelections != null && selected.size > maxSelections -> "Choose at most $maxSelections options"; else -> null }
    }
    fun validationError(textValue: String?, selected: kotlin.collections.Collection<String>?): String? {
        val missing = if(type == "multiple_choice") selected.isNullOrEmpty() else textValue.isNullOrEmpty()
        if(required && missing) return "$label: an answer is required."
        return selectionError(selected)
    }
}
@Serializable data class SurveySchema(val schemaVersion: Int, val title: String, val questions: List<Question>,val pages:List<SurveyPage>?=null) { init { require(schemaVersion in 1..5) { "Unsupported schema" } } }
@Serializable data class Collection(val id: String, val surveyId: String, val version: Int, val placement: String, val schema: SurveySchema)
@Serializable data class Submission(val idempotencyKey: String = UUID.randomUUID().toString(), val answers: Map<String, JsonElement>, val metadata: JsonObject = JsonObject(emptyMap()))
@Serializable data class Receipt(val responseId: String, val collectionId: String, val accepted: Boolean) { init { require(accepted) { "Invalid Likerts receipt" } } }
class LikertsException(val status: Int, val response: String): Exception("Likerts request failed ($status)")
/** Collection-only credential. Reuse the same Submission on transport retries. */
class LikertsClient(private val baseUrl: String, private val collectionToken: String, private val connectTimeoutMillis: Int = 15000, private val readTimeoutMillis: Int = 15000, private val cacheMaxAgeMillis: Long = 300000) {
    private val json = Json { ignoreUnknownKeys = true }
    private data class Cached(val value: Collection, val storedAtNanos: Long)
    private val collectionCache = ConcurrentHashMap<String, Cached>()
    private fun baseUri(): URI {
        val uri=URI.create(baseUrl)
        val loopback=uri.host?.lowercase() in setOf("localhost","127.0.0.1","::1")
        require((uri.scheme == "https" || (uri.scheme == "http" && loopback)) && uri.userInfo == null && uri.query == null && uri.fragment == null) { "Likerts base URL must use HTTPS (HTTP is limited to loopback development)" }
        require(connectTimeoutMillis > 0 && readTimeoutMillis > 0) { "Likerts timeouts must be positive" }
        require(cacheMaxAgeMillis >= 0) { "Likerts cache max age must not be negative" }
        return uri
    }
    private suspend fun request(id: String, submission: Submission? = null): String = runInterruptible(Dispatchers.IO) {
        val segment = URLEncoder.encode(id, "UTF-8").replace("+", "%20")
        val url = URI.create("${baseUri().toString().trimEnd('/')}/v1/collections/$segment" + if (submission != null) "/responses" else "").toURL()
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = connectTimeoutMillis; connection.readTimeout = readTimeoutMillis
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer $collectionToken")
            if (submission != null) { connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json"); connection.outputStream.use { it.write(json.encodeToString(submission).toByteArray(Charsets.UTF_8)) } }
            val code = connection.responseCode
            val response = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw LikertsException(code, response)
            response
        } finally { connection.disconnect() }
    }
    suspend fun collection(id: String, refresh: Boolean = false): Collection {
        val cached=collectionCache[id]
        if(!refresh && cached != null && (System.nanoTime()-cached.storedAtNanos)/1_000_000 < cacheMaxAgeMillis) return cached.value
        try { val result=json.decodeFromString<Collection>(request(id));require(result.schema.schemaVersion in 1..5){"Unsupported schema"}
            if(cached != null && (cached.value.id != result.id || cached.value.surveyId != result.surveyId || cached.value.version != result.version || cached.value.schema.schemaVersion != result.schema.schemaVersion)){collectionCache.remove(id);throw IllegalStateException("Collection binding changed")}
            collectionCache[id]=Cached(result,System.nanoTime());return result
        } catch(error: Throwable) { collectionCache.remove(id);throw error }
    }
    fun clearCollectionCache(id: String? = null) { if(id == null) collectionCache.clear() else collectionCache.remove(id) }
    suspend fun submit(id: String, submission: Submission): Receipt = json.decodeFromString(request(id, submission))
}
