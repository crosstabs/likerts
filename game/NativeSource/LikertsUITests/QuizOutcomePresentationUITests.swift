import XCTest
import Foundation
import Security

/// Real native controls with synthetic local content. Live hosting/peer commands
/// use the explicitly opted-in loopback API, not an actual browser participant.
@MainActor final class QuizOutcomePresentationUITests: XCTestCase {
    private var app: XCUIApplication!
    private let base = URL(string: "http://127.0.0.1:4783")!
    private let network = URLSession(configuration: .ephemeral)
    private enum Failure: Error { case missing, unreachable, invalidState, service(Int) }

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard env["SIMULATOR_UDID"] == "78680FA8-DE77-41F8-9948-7D20D57A6340" else {
            throw XCTSkip("Presentation proof runs only on the approved QA Simulator, before any activation.")
        }
        let isLive = name.contains("testLive")
        if isLive {
            guard env["LIKERTS_QUIZ_OUTCOME_API_PEERS"] == "1", env["LIKERTS_LIVE_TEST_BASE_URL"] == base.absoluteString else {
                throw XCTSkip("Live outcome proof requires explicit LIKERTS_QUIZ_OUTCOME_API_PEERS=1 and the owned numeric loopback service on4783.")
            }
        }
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-quiz-library-testing"]
        if isLive { app.launchArguments += ["-live-testing", "-live-base-url", base.absoluteString] }
        if env["LIKERTS_QUIZ_OUTCOME_LARGE_TEXT"] == "1" { app.launchArguments += ["-largest-text", "-accessible-effects"] }
        app.launch()
    }

    override func tearDown() { app?.terminate(); app = nil }

    func testPracticeZeroAndCorrectCompletionPresentation() throws {
        try tap("home.quizzes"); try tap("quiz.library.samplePractice")
        for (answers, score, count, name) in [([0, 0, 0], "0", "0 of 3 correct", "zero-neutral"), ([1, 1, 2], "3000", "3 of 3 correct", "correct-celebration")] {
            for answer in answers {
                try tap("quiz.practice.answer.\(answer)"); try tap("quiz.practice.lock")
                let feedback = try require(item("quiz.practice.feedback"))
                guard feedback.label == (score == "0" ? "Not quite" : "Correct!") else {
                    XCTFail("Practice must show the actual answer outcome"); throw Failure.invalidState
                }
                try tap("quiz.practice.next")
            }
            try reveal(item("quiz.practice.complete"))
            guard item("quiz.practice.correctCount").label == count,
                  item("quiz.practice.score").label.filter(\.isNumber) == score else {
                XCTFail("Practice completion must retain the actual count and points"); throw Failure.invalidState
            }
            try reveal(app.buttons["quiz.practice.replay"])
            XCTAssertTrue(app.buttons["quiz.practice.replay"].isEnabled)
            try reveal(app.buttons["quiz.practice.return"])
            XCTAssertTrue(app.buttons["quiz.practice.return"].isEnabled)
            capture("practice-completion-\(name)")
            if score == "0" { try tap("quiz.practice.replay") }
        }
        try tap("quiz.practice.return")
        try require(app.buttons["quiz.library.samplePractice"])
    }

    func testLivePlayerWrongMissingAndCorrectPersonalFeedbackWithAPIPeers() async throws {
        try tap("home.live")
        if app.buttons["live.resume"].waitForExistence(timeout: 1) || app.buttons["live.recover"].exists || app.buttons["live.retrySecureAccess"].exists {
            throw XCTSkip("Resolve existing known QA room access first. This test never forgets unknown access or resets a library.")
        }
        let host = try await createOutcomeRoom()
        do {
            let peer = try await joinPeer(code: host.code)
            try await joinNative(code: host.code)
            try await command("start", seat: host)
            for index in 0..<3 {
                let progress = item("live.quiz.progress")
                let question = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND label CONTAINS %@", "QUESTION \(index + 1) OF 3"), object: progress)
                guard await XCTWaiter.fulfillment(of: [question], timeout: 15) == .completed else { throw Failure.missing }
                XCTAssertFalse(item("live.quiz.personal.feedback").exists, "Private answer phases must not show a previous result")
                if index != 1 {
                    try tap("live.quiz.choice.\(index == 0 ? 0 : 1)"); try tap("live.submit")
                    try require(item("live.locked"))
                }
                try await command("quiz-answer", seat: peer, value: index == 2 ? 0 : 1)
                if index == 1 { try await command("quiz-reveal", seat: host) }
                let feedback = try require(item("live.quiz.personal.feedback"), timeout: 15)
                try reveal(feedback)
                let expected = ["Not quite", "No answer this time", "Correct!"][index]
                let points = index == 2 ? "1000" : "0"
                guard feedback.label == expected, item("live.quiz.personal.points").label.filter(\.isNumber) == points else {
                    capture("live-personal-outcome-failure-\(index + 1)")
                    XCTFail("Personal feedback must match the authoritative own result"); throw Failure.invalidState
                }
                try reveal(item("live.revealedAnswer"))
                XCTAssertTrue(item("live.revealedAnswer").label.contains("Triangle"))
                capture("live-personal-\(["wrong-neutral", "missing-neutral", "correct-celebration"][index])")
                let state = try await snapshot(host)
                let reveal = try XCTUnwrap(state["reveal"] as? [String: Any])
                let rows = try XCTUnwrap(reveal["results"] as? [[String: Any]])
                let own = try XCTUnwrap(rows.first(where: { $0["nickname"] as? String == "OutcomeQA" }))
                XCTAssertEqual(own["points"] as? Int, index == 2 ? 1_000 : 0)
                if index == 1 { XCTAssertTrue(own["value"] is NSNull) }
                try await command("next", seat: host)
            }
            try require(item("live.finished"))
            XCTAssertFalse(item("live.quiz.personal.feedback").exists, "Finished totals replace question feedback")
            XCTAssertEqual(item("live.quiz.total").label.filter(\.isNumber), "1000")
            try tap("live.leave"); try confirm("Leave room")
            try require(app.staticTexts["You left the room."])
            try await command("leave", seat: peer)
            try await command("close", seat: host)
        } catch {
            // This capability belongs solely to the room just created above.
            // Wait for its close response before the app can be terminated.
            try await command("close", seat: host)
            let cleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: item("live.roomCode"))
            _ = await XCTWaiter.fulfillment(of: [cleared], timeout: 10)
            throw error
        }
    }

    private func joinNative(code: String) async throws {
        let field = try reveal(app.textFields["live.code"]); field.tap(); field.typeText(code + "\n")
        let nickname = try require(app.textFields["live.nickname"])
        let focused = XCTNSPredicateExpectation(predicate: NSPredicate { object, _ in
            (object as? XCUIElement)?.debugDescription.contains("Keyboard Focused") == true
        }, object: nickname)
        guard await XCTWaiter.fulfillment(of: [focused], timeout: 5) == .completed else { throw Failure.unreachable }
        app.typeText("OutcomeQA\n")
        let keyboard = app.keyboards.firstMatch
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: keyboard)
        guard await XCTWaiter.fulfillment(of: [dismissed], timeout: 5) == .completed,
              nickname.value as? String == "OutcomeQA", field.value as? String == code else { throw Failure.invalidState }
        try tap("live.consent"); try tap("live.join")
        try require(item("live.quiz.title"))
        XCTAssertTrue(item("live.roomCode").label.contains(code))
    }

    private func item(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    @discardableResult private func require(_ element: XCUIElement, timeout: TimeInterval = 15) throws -> XCUIElement {
        guard element.waitForExistence(timeout: timeout) else { XCTFail("Missing outcome control: \(element.identifier)"); throw Failure.missing }
        return element
    }
    @discardableResult private func reveal(_ element: XCUIElement) throws -> XCUIElement {
        try require(element)
        for _ in 0..<12 {
            if element.isHittable { return element }
            if element.frame.maxY < 100 { app.swipeDown(velocity: .slow) } else { app.swipeUp(velocity: .slow) }
        }
        guard element.isHittable else { XCTFail("Unreachable outcome control: \(element.identifier)"); throw Failure.unreachable }
        return element
    }
    private func tap(_ id: String) throws {
        let element = try reveal(item(id)); guard element.isEnabled else { throw Failure.unreachable }; element.tap()
    }
    private func confirm(_ label: String) throws { try reveal(app.sheets.buttons[label]).tap() }
    private func capture(_ name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "quiz-design-\(name)"; screenshot.lifetime = .keepAlways; add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "quiz-design-\(name)-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }

    private struct Seat { let code: String; let token: String }
    private func identity() throws -> [String: Any] {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw Failure.invalidState }
        let secret = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return ["admissionId": UUID().uuidString.lowercased(), "recoverySecret": secret]
    }
    private func createOutcomeRoom() async throws -> Seat {
        var body = try identity()
        let questions: [[String: Any]] = (1...3).map { index in
            ["id": UUID().uuidString.lowercased(), "prompt": "Outcome \(index): which shape has three sides?", "answers": ["Circle", "Triangle"], "correctAnswer": 1,
             "explanation": "A triangle has three straight sides.", "timeLimitSeconds": 0]
        }
        body["mode"] = "quiz"; body["modeVersion"] = 1; body["settings"] = ["capacity": 12]
        body["quiz"] = ["format": "likerts.quiz", "version": 1, "id": UUID().uuidString.lowercased(), "title": "QuizQA personal outcomes", "questions": questions]
        let receipt = try await json("rooms", body: body)
        return Seat(code: try XCTUnwrap(receipt["code"] as? String), token: try XCTUnwrap(receipt["token"] as? String))
    }
    private func joinPeer(code: String) async throws -> Seat {
        var body = try identity(); body["nickname"] = "FixturePeer"; body["acceptRoomSharing"] = true
        let receipt = try await json("rooms/\(code)/join", body: body)
        return Seat(code: code, token: try XCTUnwrap(receipt["token"] as? String))
    }
    private func snapshot(_ seat: Seat) async throws -> [String: Any] {
        let receipt = try await json("rooms/\(seat.code)", token: seat.token)
        return try XCTUnwrap(receipt["state"] as? [String: Any])
    }
    private func command(_ action: String, seat: Seat, value: Int? = nil) async throws {
        let state = try await snapshot(seat)
        var body: [String: Any] = ["requestId": UUID().uuidString.lowercased(), "matchId": try XCTUnwrap(state["matchId"] as? String), "action": action]
        if ["quiz-answer", "quiz-reveal", "next"].contains(action) { body["roundId"] = try XCTUnwrap((state["round"] as? [String: Any])?["id"] as? String) }
        if let value { body["value"] = value }
        _ = try await json("rooms/\(seat.code)/actions", token: seat.token, body: body)
    }
    private func json(_ path: String, token: String? = nil, body: [String: Any]? = nil) async throws -> [String: Any] {
        var request = URLRequest(url: base.appendingPathComponent("api/live").appendingPathComponent(path))
        request.timeoutInterval = 15; request.httpMethod = body == nil ? "GET" : "POST"
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await network.data(for: request)
        let status = try XCTUnwrap(response as? HTTPURLResponse).statusCode
        guard (200...299).contains(status) else { throw Failure.service(status) }
        guard data.count <= 262_144, let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.invalidState }
        return result
    }
}
