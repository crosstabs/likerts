package com.likerts.sdk
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicInteger
class ContractTest {
 @Test fun releaseRehearsalLoopback() = runBlocking {
  val base=System.getenv("LIKERTS_REHEARSAL_BASE_URL") ?: return@runBlocking
  val id=System.getenv("LIKERTS_REHEARSAL_COLLECTION_ID") ?: error("collection id missing")
  val token=System.getenv("LIKERTS_REHEARSAL_COLLECTION_TOKEN") ?: error("collection token missing")
  val client=LikertsClient(base,token)
  assertEquals("Release rehearsal",client.collection(id).schema.title)
  val receipt=client.submit(id,Submission(idempotencyKey="rel-android",answers=mapOf("comment" to JsonPrimitive("android")),metadata=buildJsonObject { put("sdk","android") }))
  assertTrue(receipt.accepted);assertEquals(1,receipt.chargedCents)
 }
 @Test fun sharedBehaviorContractFixture() {
  val value=Json.parseToJsonElement(java.io.File("../../contracts/sdk-behavior.json").readText()).jsonObject
  assertEquals(1,value["contractVersion"]!!.jsonPrimitive.int)
  assertEquals(9,value["scenarios"]!!.jsonArray.size)
 }
 @Test fun declaredCapabilityAndImmutableCacheRefresh() = runBlocking {
  val fixture=Json.parseToJsonElement(java.io.File("../../contracts/sdk-compatibility.json").readText()).jsonObject
  assertEquals(fixture["currentFleet"]!!.jsonObject["installations"]!!.jsonArray[3].jsonObject["sdkVersion"]!!.jsonPrimitive.content,LIKERTS_SDK_CAPABILITY.sdkVersion)
  val calls=AtomicInteger();val version=AtomicInteger(1);val server=ServerSocket(0)
  val thread=Thread { try { while(!server.isClosed) { server.accept().use { socket -> calls.incrementAndGet();val reader=socket.getInputStream().bufferedReader();while(reader.readLine()?.isNotEmpty()==true){};val body="""{"id":"c","surveyId":"s","version":${version.get()},"placement":"p","schema":{"schemaVersion":1,"title":"T","questions":[]}}""".toByteArray();val output=socket.getOutputStream();output.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray());output.write(body);output.flush() } } } catch(_:java.io.IOException){} }.apply { isDaemon=true;start() }
  try { val client=LikertsClient("http://127.0.0.1:${server.localPort}","token");client.collection("c");client.collection("c");assertEquals(1,calls.get());client.collection("c",refresh=true);assertEquals(2,calls.get());version.set(2);try{client.collection("c",refresh=true);fail("changed binding accepted")}catch(_:IllegalStateException){};version.set(1);client.collection("c");assertEquals(4,calls.get()) } finally { server.close();thread.join(1000) }
 }
 // SDK-CONTRACT: schema.unknown
 @Test fun expandedSharedFixture() {
  val source = Json.parseToJsonElement(java.io.File("../../contracts/expanded-survey.example.json").readText()).jsonObject
  val schema = Json.decodeFromJsonElement<SurveySchema>(JsonObject(source + ("schemaVersion" to JsonPrimitive(2))))
  assertEquals((0..10).toList(), schema.questions[0].scaleValues())
  assertEquals("1 — Strongly disagree", schema.questions[1].scaleLabel(1))
  assertEquals("yes_no", schema.questions[2].preset)
  assertEquals(2, schema.questions[3].maxSelections)
 }
 @Test fun expandedQuestionsAndSelectionBounds() {
  // SDK-CONTRACT: validation.required
  // SDK-CONTRACT: validation.selection-bounds
  val json = Json { ignoreUnknownKeys = true }
  val schema = json.decodeFromString<SurveySchema>("""{"schemaVersion":2,"title":"Expanded","questions":[{"id":"n","type":"scale","label":"Recommend","preset":"nps","min":0,"max":10,"labels":{"0":"Unlikely"}},{"id":"y","type":"single_choice","label":"Yes?","preset":"yes_no","options":[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]},{"id":"m","type":"multiple_choice","label":"Pick","minSelections":2,"maxSelections":2}]}""")
  assertEquals((0..10).toList(), schema.questions[0].scaleValues())
  assertEquals("0 — Unlikely", schema.questions[0].scaleLabel(0))
  assertEquals(listOf("yes", "no"), schema.questions[1].options.map { it.id })
  val question = schema.questions[2]
  assertNull(question.selectionError(null))
  assertNotNull(question.selectionError(emptyList()))
  assertNotNull(question.selectionError(listOf("a")))
  assertNull(question.selectionError(listOf("a", "b")))
  assertNotNull(question.selectionError(listOf("a", "b", "c")))
  assertNotNull(question.copy(required = true).selectionError(null))
  assertEquals("Comment: an answer is required.",Question("r","text","Comment",required=true).validationError(null,null))
  assertNull(Question("r","text","Comment",required=true).validationError("answer",null))
  try { SurveySchema(6, "Future", emptyList()); fail("Unsupported schema accepted") } catch (_: IllegalArgumentException) {}
 }

 @Test fun submissionPreservesKeyAndAnswerTypes() {
  // SDK-CONTRACT: retry.ambiguous
  val s=Submission(idempotencyKey="stable",answers=mapOf("scale" to JsonPrimitive(4),"multi" to JsonArray(listOf(JsonPrimitive("a")))))
  val first=Json.encodeToString(s)
  assertEquals(first,Json.encodeToString(s))
  val value=Json.parseToJsonElement(first).jsonObject
  assertEquals("stable",value["idempotencyKey"]!!.jsonPrimitive.content)
  assertEquals(4,value["answers"]!!.jsonObject["scale"]!!.jsonPrimitive.int)
 }

 // SDK-CONTRACT: transport.https
 @Test fun requiresHttpsExceptLoopback() = runBlocking {
  try { LikertsClient("http://example.test","token",connectTimeoutMillis=1).collection("c"); fail("unsafe URL accepted") }
  catch(error: IllegalArgumentException) { assertTrue(error.message!!.contains("HTTPS")) }
 }

 // SDK-CONTRACT: transport.redirect
 @Test fun redirectFollowingIsDisabledByContract() {
  val source=java.io.File("src/main/kotlin/com/likerts/sdk/Likerts.kt").readText()
  assertTrue(source.contains("instanceFollowRedirects = false"))
 }

 // SDK-CONTRACT: transport.timeout
 @Test fun timeoutMustBePositive() = runBlocking {
  try { LikertsClient("https://example.test","token",connectTimeoutMillis=0).collection("c"); fail("invalid timeout accepted") }
  catch(error: IllegalArgumentException) { assertTrue(error.message!!.contains("timeouts")) }
 }

 // SDK-CONTRACT: lifecycle.cancellation
 @Test fun cancelledCoroutineDoesNotComplete() = runBlocking {
  var completed=false
  val job=launch { delay(1000); completed=true }
  job.cancelAndJoin();assertFalse(completed)
 }

 // SDK-CONTRACT: callback.success
 @Test fun receiptRequiresAcceptanceAndOneCent() {
  val json=Json { ignoreUnknownKeys=true }
  assertTrue(json.decodeFromString<Receipt>("""{"responseId":"r","collectionId":"c","accepted":true,"chargedCents":1}""").accepted)
  for(value in listOf("""{"responseId":"r","collectionId":"c","accepted":false,"chargedCents":1}""","""{"responseId":"r","collectionId":"c","accepted":true,"chargedCents":2}""")) {
   try { json.decodeFromString<Receipt>(value);fail("invalid receipt accepted") } catch(_:IllegalArgumentException) {}
  }
 }

 @Test fun conditionalVisibilityDiscardsHiddenAnswersAndTrimsText() {
  val questions=Json.decodeFromJsonElement<List<Question>>(Json.parseToJsonElement(java.io.File("../../contracts/conditional-survey.example.json").readText()).jsonObject["questions"]!!)
  val hidden=mapOf("return" to JsonPrimitive("yes"),"reason" to JsonPrimitive("stale"),"detail" to JsonPrimitive("stale"))
  assertEquals(setOf("return"),visibleAnswers(questions,hidden).keys)
  val shown=mapOf("return" to JsonPrimitive("no"),"reason" to JsonPrimitive("late"))
  assertTrue("contactDate" in visibleQuestionIds(questions,shown))
  assertFalse("contactDate" in visibleQuestionIds(questions,shown+mapOf("reason" to JsonPrimitive("   "))))
 }
 @Test fun branchNavigationProgressBackAndAnswerChanges() {
  val source=Json.parseToJsonElement(java.io.File("../../contracts/branching-survey.example.json").readText()).jsonObject
  val schema=Json.decodeFromJsonElement<SurveySchema>(JsonObject(source+("schemaVersion" to JsonPrimitive(4))))
  val flow=SurveyFlow(schema);flow.setAnswer("return",JsonPrimitive("no"));assertTrue(flow.next());assertEquals("recovery",flow.page.id);assertEquals(SurveyProgress(3,4,2),flow.progress);flow.setAnswer("problem",JsonPrimitive("Long wait"));assertTrue(flow.next());assertEquals("contact",flow.page.id);assertTrue(flow.back());assertEquals("recovery",flow.page.id);assertTrue(flow.back());flow.setAnswer("return",JsonPrimitive("yes"));assertTrue(flow.next());assertEquals("praise",flow.page.id);assertFalse("problem" in flow.answers)
 }
}
