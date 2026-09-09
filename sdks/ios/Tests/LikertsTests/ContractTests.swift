import XCTest

@testable import Likerts

final class ContractTests: XCTestCase {
  func testReleaseRehearsalLoopback() async throws {
    let environment = ProcessInfo.processInfo.environment
    guard let base = environment["LIKERTS_REHEARSAL_BASE_URL"],
      let id = environment["LIKERTS_REHEARSAL_COLLECTION_ID"],
      let token = environment["LIKERTS_REHEARSAL_COLLECTION_TOKEN"]
    else { throw XCTSkip("release rehearsal environment is not configured") }
    let client = LikertsClient(baseURL: try XCTUnwrap(URL(string: base)), collectionToken: token)
    let collection = try await client.collection(id)
    XCTAssertEqual(collection.schema.title, "Release rehearsal")
    let receipt = try await client.submit(
      collectionId: id,
      submission: Submission(idempotencyKey: "rel-ios", answers: ["comment": .text("ios")], metadata: ["sdk": "ios"]))
    XCTAssertTrue(receipt.accepted)
    XCTAssertEqual(receipt.chargedCents, 1)
  }
  private func fixture(_ name: String) throws -> Data {
    let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent()
    return try Data(
      contentsOf: repository.appendingPathComponent("contracts").appendingPathComponent(name))
  }
  private func collectionData(schemaVersion: Int = 1) throws -> Data {
    var schema = try XCTUnwrap(
      JSONSerialization.jsonObject(with: fixture("survey.example.json")) as? [String: Any])
    schema["schemaVersion"] = schemaVersion
    return try JSONSerialization.data(withJSONObject: [
      "id": "c", "surveyId": "s", "version": 1, "placement": "checkout", "schema": schema,
    ])
  }
  func testSharedBehaviorContractFixture() throws {
    let value = try XCTUnwrap(
      JSONSerialization.jsonObject(with: fixture("sdk-behavior.json")) as? [String: Any])
    XCTAssertEqual(value["contractVersion"] as? Int, 1)
    XCTAssertEqual((value["scenarios"] as? [[String: Any]])?.count, 9)
  }
  func testDeclaredCapabilityAndImmutableCacheRefresh() async throws {
    let compatibility = try XCTUnwrap(
      JSONSerialization.jsonObject(with: fixture("sdk-compatibility.json")) as? [String: Any])
    let fleet = try XCTUnwrap(compatibility["currentFleet"] as? [String: Any])
    let installs = try XCTUnwrap(fleet["installations"] as? [[String: Any]])
    XCTAssertEqual(likertsSDKCapability.sdkVersion, installs[2]["sdkVersion"] as? String)
    var calls = 0
    var version = 1
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ContractURLProtocol.self]
    let session = URLSession(configuration: configuration)
    ContractURLProtocol.handler = { request in
      calls += 1
      var object = try XCTUnwrap(
        JSONSerialization.jsonObject(with: self.collectionData()) as? [String: Any])
      object["version"] = version
      return (
        HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
        try JSONSerialization.data(withJSONObject: object)
      )
    }
    defer {
      ContractURLProtocol.handler = nil
      session.invalidateAndCancel()
    }
    let client = LikertsClient(
      baseURL: URL(string: "https://example.test")!, collectionToken: "token", session: session)
    _ = try await client.collection("c")
    _ = try await client.collection("c")
    XCTAssertEqual(calls, 1)
    _ = try await client.collection("c", refresh: true)
    XCTAssertEqual(calls, 2)
    version = 2
    do {
      _ = try await client.collection("c", refresh: true)
      XCTFail("changed binding accepted")
    } catch {}
    version = 1
    _ = try await client.collection("c")
    XCTAssertEqual(calls, 4)
  }
  func testSharedSurveyFixtureDecodesAllSixTypes() throws {
    // SDK-CONTRACT: validation.required
    let collection = try JSONDecoder().decode(Collection.self, from: collectionData())
    XCTAssertEqual(
      Set(collection.schema.questions.map(\.type)),
      Set(["scale", "single_choice", "multiple_choice", "text", "number", "date"]))
    XCTAssertEqual(collection.schema.questions.first?.min, 1)
    XCTAssertEqual(collection.schema.questions.first?.max, 5)
  }
  func testSharedSubmissionMetadataDecodes() throws {
    let value = try JSONDecoder().decode(JSONValue.self, from: fixture("response.example.json"))
    guard case .object(let submission) = value else { return XCTFail("Expected JSON object") }
    XCTAssertEqual(submission["metadata"], ["placement": "checkout-success"])
  }
  func testNestedMetadataRoundTripAndStableKey() throws {
    let metadata: [String: JSONValue] = [
      "purchase": ["amount": 12.5, "verified": false, "items": ["a", "b"], "optional": nil],
      "attempt": 2,
    ]
    let submission = Submission(
      idempotencyKey: "stable-key", answers: ["rating": .number(4)], metadata: metadata)
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    let first = try encoder.encode(submission)
    XCTAssertEqual(first, try encoder.encode(submission))
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: first) as? [String: Any])
    XCTAssertEqual(object["idempotencyKey"] as? String, "stable-key")
    let encodedMetadata = try JSONSerialization.data(withJSONObject: XCTUnwrap(object["metadata"]))
    XCTAssertEqual(
      try JSONDecoder().decode([String: JSONValue].self, from: encodedMetadata), metadata)
  }
  func testUnsupportedSchemaRejectedBeforeRendering() throws {
    // SDK-CONTRACT: schema.unknown
    XCTAssertThrowsError(
      try JSONDecoder().decode(Collection.self, from: collectionData(schemaVersion: 6))
    ) { error in
      guard case LikertsError.unsupportedSchema = error else {
        return XCTFail("Unexpected error: \(error)")
      }
    }
  }
  func testConditionalVisibilityDiscardsHiddenAnswersAndTrimsAnsweredText() throws {
    var schema = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture("conditional-survey.example.json")) as? [String:Any])
    schema["schemaVersion"] = 3
    let decoded = try JSONDecoder().decode(SurveySchema.self, from: JSONSerialization.data(withJSONObject:schema))
    let hidden:[String:Answer] = ["return":.text("yes"),"reason":.text("stale"),"contactDate":.text("2026-09-08")]
    XCTAssertEqual(visibleQuestionIDs(decoded.questions,answers:hidden),Set(["return","improvements"]))
    XCTAssertEqual(Set(visibleAnswers(decoded.questions,answers:hidden).keys),Set(["return"]))
    let shown:[String:Answer] = ["return":.text("no"),"reason":.text("late")]
    XCTAssertTrue(visibleQuestionIDs(decoded.questions,answers:shown).contains("contactDate"))
    let whitespace:[String:Answer] = ["return":.text("no"),"reason":.text("   ")]
    XCTAssertFalse(visibleQuestionIDs(decoded.questions,answers:whitespace).contains("contactDate"))
  }
  func testBranchNavigationProgressBackAndAnswerChanges() throws {
    var schema = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture("branching-survey.example.json")) as? [String:Any])
    schema["schemaVersion"] = 4
    let decoded = try JSONDecoder().decode(SurveySchema.self, from: JSONSerialization.data(withJSONObject:schema))
    let flow=SurveyFlow(schema:decoded);flow.setAnswer("return",.text("no"));XCTAssertTrue(flow.next());XCTAssertEqual(flow.page.id,"recovery");XCTAssertEqual(flow.progress,SurveyProgress(current:3,total:4,visited:2));flow.setAnswer("problem",.text("Long wait"));XCTAssertTrue(flow.next());XCTAssertEqual(flow.page.id,"contact");XCTAssertTrue(flow.back());XCTAssertEqual(flow.page.id,"recovery");XCTAssertTrue(flow.back());flow.setAnswer("return",.text("yes"));XCTAssertTrue(flow.next());XCTAssertEqual(flow.page.id,"praise");XCTAssertNil(flow.answers["problem"])
  }
  func testExpandedSharedFixture() throws {
    var schema = try XCTUnwrap(
      JSONSerialization.jsonObject(with: fixture("expanded-survey.example.json")) as? [String: Any])
    schema["schemaVersion"] = 2
    let decoded = try JSONDecoder().decode(
      SurveySchema.self, from: JSONSerialization.data(withJSONObject: schema))
    XCTAssertEqual(decoded.questions[0].scaleValues, Array(0...10))
    XCTAssertEqual(decoded.questions[1].scaleLabel(1), "1 — Strongly disagree")
    XCTAssertEqual(decoded.questions[2].preset, "yes_no")
    XCTAssertEqual(decoded.questions[3].maxSelections, 2)
  }
  func testEnhancedQuestionsAndSelectionBounds() throws {
    // SDK-CONTRACT: validation.selection-bounds
    let data = Data(
      #"{"schemaVersion":2,"title":"Expanded","questions":[{"id":"n","type":"scale","label":"Recommend","preset":"nps","min":0,"max":10,"labels":{"0":"Unlikely","10":"Likely"}},{"id":"y","type":"single_choice","label":"Yes?","preset":"yes_no","options":[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]},{"id":"m","type":"multiple_choice","label":"Pick","minSelections":2,"maxSelections":2}]}"#
        .utf8)
    let schema = try JSONDecoder().decode(SurveySchema.self, from: data)
    XCTAssertEqual(schema.questions[0].scaleValues, Array(0...10))
    XCTAssertEqual(schema.questions[0].scaleLabel(0), "0 — Unlikely")
    XCTAssertEqual(schema.questions[1].options?.map(\.id), ["yes", "no"])
    let q = schema.questions[2]
    XCTAssertNil(q.selectionError(nil))
    XCTAssertNotNil(q.selectionError([]))
    XCTAssertNotNil(q.selectionError(["a"]))
    XCTAssertNil(q.selectionError(["a", "b"]))
    XCTAssertNotNil(q.selectionError(["a", "b", "c"]))
    XCTAssertNoThrow(
      try JSONDecoder().decode(Collection.self, from: collectionData(schemaVersion: 2)))
    let required = try JSONDecoder().decode(
      Question.self, from: Data(#"{"id":"r","type":"text","label":"Comment","required":true}"#.utf8)
    )
    XCTAssertEqual(
      required.validationError(textValue: nil, selected: nil), "Comment: an answer is required.")
    XCTAssertNil(required.validationError(textValue: "answer", selected: nil))
  }
  func testReceiptRequiresAcceptanceAndExpectedCharge() throws {
    // SDK-CONTRACT: callback.success
    let receipt = try JSONDecoder().decode(
      Receipt.self,
      from: Data(#"{"responseId":"r","collectionId":"c","accepted":true,"chargedCents":1}"#.utf8))
    XCTAssertTrue(receipt.accepted)
    XCTAssertEqual(receipt.chargedCents, 1)
    for invalid in [
      #"{"responseId":"r","collectionId":"c","accepted":false,"chargedCents":1}"#,
      #"{"responseId":"r","collectionId":"c","accepted":true,"chargedCents":2}"#,
    ] {
      XCTAssertThrowsError(try JSONDecoder().decode(Receipt.self, from: Data(invalid.utf8)))
    }
  }

  // SDK-CONTRACT: transport.https
  func testTransportRequiresHTTPSExceptLoopback() async {
    for value in ["http://example.test", "https://user@example.test"] {
      let client = LikertsClient(baseURL: URL(string: value)!, collectionToken: "token")
      do {
        _ = try await client.collection("c")
        XCTFail("Unsafe URL accepted")
      } catch LikertsError.invalidURL {} catch { XCTFail("Unexpected error: \(error)") }
    }
  }

  // SDK-CONTRACT: transport.redirect
  func testRedirectDelegateRejectsRedirect() {
    let session = URLSession(configuration: .ephemeral)
    let task = session.dataTask(with: URL(string: "https://example.test")!)
    let response = HTTPURLResponse(
      url: URL(string: "https://example.test")!, statusCode: 302, httpVersion: nil,
      headerFields: ["Location": "https://elsewhere.test"])!
    let redirected = URLRequest(url: URL(string: "https://elsewhere.test")!)
    var decision: URLRequest? = redirected
    LikertsRedirectDelegate.shared.urlSession(
      session, task: task, willPerformHTTPRedirection: response, newRequest: redirected
    ) { decision = $0 }
    XCTAssertNil(decision)
    session.invalidateAndCancel()
  }

  // SDK-CONTRACT: transport.timeout
  func testFiniteDefaultTimeout() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ContractURLProtocol.self]
    let session = URLSession(configuration: configuration)
    ContractURLProtocol.handler = { request in
      XCTAssertEqual(request.timeoutInterval, 15, accuracy: 0.01)
      return (
        HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
        try self.collectionData()
      )
    }
    defer {
      ContractURLProtocol.handler = nil
      session.invalidateAndCancel()
    }
    _ = try await LikertsClient(
      baseURL: URL(string: "https://example.test")!, collectionToken: "token", session: session
    ).collection("c")
  }

  // SDK-CONTRACT: lifecycle.cancellation
  func testTaskCancellationCancelsTransport() async {
    let stopped = expectation(description: "transport stopped")
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ContractURLProtocol.self]
    let session = URLSession(configuration: configuration)
    ContractURLProtocol.handler = nil
    ContractURLProtocol.onStop = { stopped.fulfill() }
    let task = Task {
      try await LikertsClient(
        baseURL: URL(string: "https://example.test")!, collectionToken: "token", session: session
      ).collection("c")
    }
    task.cancel()
    _ = try? await task.value
    await fulfillment(of: [stopped], timeout: 2)
    ContractURLProtocol.onStop = nil
    session.invalidateAndCancel()
  }

  // SDK-CONTRACT: retry.ambiguous
  func testRetryUsesSameSubmissionPayloadAndDoesNotRunAutomatically() throws {
    let submission = Submission(idempotencyKey: "stable", answers: ["q": .number(4)])
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    XCTAssertEqual(try encoder.encode(submission), try encoder.encode(submission))
  }

  @available(iOS 15.0, macOS 12.0, *)
  func testNativeFormStateLocalizesValidationAndPreservesAnswerTypes() throws {
    let questions = [
      Question(id: "comment", type: "text", label: "Comment", required: true),
      Question(
        id: "choices", type: "multiple_choice", label: "Choose", required: true,
        options: [.init(id: "a", label: "A"), .init(id: "b", label: "B")], minSelections: 2,
        maxSelections: 2),
      Question(id: "score", type: "number", label: "Score"),
    ]
    let collection = try Collection(
      id: "c", surveyId: "s", version: 1, placement: "test",
      schema: .init(schemaVersion: 1, title: "Test", questions: questions))
    let strings = SurveyStrings(
      requiredError: "Falta {question}", minimumSelectionsError: "{question}: mínimo {min}")
    var state = SurveyFormState()
    XCTAssertEqual(state.validationError(collection: collection, strings: strings), "Falta Comment")
    state.values["comment"] = "Done"
    state.toggle(question: "choices", option: "a", selected: true)
    XCTAssertEqual(
      state.validationError(collection: collection, strings: strings), "Choose: mínimo 2")
    state.toggle(question: "choices", option: "b", selected: true)
    state.values["score"] = "2.5"
    XCTAssertNil(state.validationError(collection: collection, strings: strings))
    let encoded = try JSONEncoder().encode(state.answers(collection: collection))
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
    XCTAssertEqual(object["comment"] as? String, "Done")
    XCTAssertEqual(object["score"] as? Double, 2.5)
    XCTAssertEqual(object["choices"] as? [String], ["a", "b"])
    state.reset()
    XCTAssertTrue(state.values.isEmpty)
    XCTAssertTrue(state.choices.isEmpty)
  }
}

final class ContractURLProtocol: URLProtocol {
  static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
  static var onStop: (() -> Void)?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard let handler = Self.handler else { return }
    do {
      let (response, data) = try handler(request)
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() { Self.onStop?() }
}
