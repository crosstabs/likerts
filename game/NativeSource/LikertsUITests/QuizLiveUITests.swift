import XCTest
import Foundation
import Security

/// Opt-in synthetic local journeys. The supplied browser room is owned by the
/// operator; its host and Sam use actual browser controls outside this test.
@MainActor final class QuizLiveUITests: XCTestCase {
    private var app: XCUIApplication!
    private let network = URLSession(configuration: .ephemeral)
    private let base = URL(string: "http://127.0.0.1:4783")!
    private var ownedCode: String?
    private var ownsHost = false
    private var ownsSeat = false
    private enum Failure: Error { case missing, unreachable, invalidReceipt, service(Int) }

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard env["SIMULATOR_UDID"] == "78680FA8-DE77-41F8-9948-7D20D57A6340",
              env["LIKERTS_LIVE_TEST_BASE_URL"] == base.absoluteString else {
            throw XCTSkip("Quiz UI proof requires the approved QA Simulator and exact owned http://127.0.0.1:4783 service before any app activation.")
        }
        if name.contains("BrowserHosted") {
            guard let code = env["LIKERTS_QUIZ_WEB_HOST_ROOM"], validCode(code) else {
                throw XCTSkip("Supply a fresh operator-owned LIKERTS_QUIZ_WEB_HOST_ROOM with the unmodified three-question Little wonders quiz and one Sam browser player.")
            }
            ownedCode = code
        } else if env["LIKERTS_QUIZ_NATIVE_HOST_API_PEERS"] != "1" {
            throw XCTSkip("Native-host proof uses explicitly synthetic API peers; opt in with LIKERTS_QUIZ_NATIVE_HOST_API_PEERS=1.")
        }
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-quiz-library-testing", "-live-testing", "-live-base-url", base.absoluteString]
        let sceneMotion = env["LIKERTS_QUIZ_SCENE_MOTION"] == "1" || env["TEST_RUNNER_LIKERTS_QUIZ_SCENE_MOTION"] == "1"
        if sceneMotion {
            app.launchArguments += ["-quiz-scene-motion-testing", "-quiz-scene-motion-scope", UUID().uuidString.lowercased()]
            if env["LIKERTS_QUIZ_SCENE_REDUCED"] == "1" || env["TEST_RUNNER_LIKERTS_QUIZ_SCENE_REDUCED"] == "1" {
                app.launchArguments.append("-quiz-scene-reduced-motion-testing")
            }
        }
        if env["LIKERTS_QUIZ_TEST_LARGE_TEXT"] == "1" { app.launchArguments += ["-largest-text", "-accessible-effects"] }
        app.launch()
    }

    override func tearDownWithError() throws {
        // Only this test's confirmed room/seat may be closed/left. Never forget
        // unknown saved access, reset a library, or activate another Simulator.
        if let app, (ownsHost || ownsSeat), let code = ownedCode,
           app.staticTexts["live.roomCode"].exists, app.staticTexts["live.roomCode"].label.contains(code) {
            let id = ownsHost ? "live.closeRoom" : "live.leave"
            if let button = try? reveal(app.buttons[id]), button.isEnabled {
                button.tap()
                let confirm = app.sheets.buttons[ownsHost ? "Close room" : "Leave room"]
                guard confirm.waitForExistence(timeout: 3), confirm.isHittable else {
                    capture("terminal-cleanup-confirmation-failure")
                    XCTFail("The known owned room cleanup confirmation was not reachable")
                    throw Failure.unreachable
                }
                confirm.tap()
                let receipt = app.staticTexts[ownsHost ? "The room is closed." : "You left the room."]
                guard receipt.waitForExistence(timeout: 15) else {
                    capture("terminal-cleanup-receipt-failure")
                    XCTFail("Cleanup is unconfirmed; keep the app open instead of cancelling a pending terminal request")
                    throw Failure.invalidReceipt
                }
                ownsHost = false; ownsSeat = false
                print("QUIZ_LIVE_QA phase=terminal-cleanup-confirmed")
            }
        }
        app?.terminate(); app = nil
    }

    func testBrowserHostedQuizWithActualNativePlayer() async throws {
        let code = try XCTUnwrap(ownedCode)
        try tap("home.live")
        try refuseUnknownSavedAccess()
        let room = try reveal(app.textFields["live.code"]); room.tap(); room.typeText(code + "\n")
        let nickname = try require(app.textFields["live.nickname"])
        let focus = XCTNSPredicateExpectation(predicate: NSPredicate { element, _ in
            guard let field = element as? XCUIElement else { return false }
            return field.exists && field.isHittable && field.debugDescription.contains("Keyboard Focused")
        }, object: nickname)
        guard await XCTWaiter.fulfillment(of: [focus], timeout: 5) == .completed else {
            capture("browser-host-native-entry-focus-failure")
            XCTFail("The visible keyboard Next action must focus and reveal the nickname field")
            throw Failure.unreachable
        }
        XCTAssertEqual(room.value as? String, code)
        app.typeText("NativeQA\n")
        let named = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "NativeQA"), object: nickname)
        guard await XCTWaiter.fulfillment(of: [named], timeout: 5) == .completed else {
            XCTFail("The nickname must be confirmed before consenting and joining"); throw Failure.invalidReceipt
        }
        try await dismissKeyboard()
        capture("browser-host-native-entry-ready")
        try tap("live.consent"); try tap("live.join")
        try require(app.staticTexts["live.quiz.title"], timeout: 20)
        ownsSeat = true
        XCTAssertTrue(app.staticTexts["live.roomCode"].label.contains(code))
        XCTAssertEqual(app.staticTexts["live.quiz.title"].label, "Little wonders")
        capture("browser-host-native-lobby")

        let prompts = ["Which planet is known as the Red Planet?", "How many sides does a triangle have?", "Which ocean is the largest?"]
        let correctChoices = [1, 1, 2]
        let revealedAnswers = ["Mars", "Three", "Pacific"]
        for index in 0..<3 {
            try await waitForPrompt(prompts[index], timeout: index == 0 ? 180 : 120)
            capture("browser-host-native-question-\(index + 1)")
            try tap("live.quiz.choice.\(correctChoices[index])"); try tap("live.submit")
            // Q2 deliberately submits last, after Sam's wrong choice. The
            // authoritative response reveals immediately, so no intermediate
            // locked screen exists. Q1/Q3 retain the private-lock UI proof.
            if index != 1 {
                try require(identified("live.locked"), timeout: 15)
                try await requireFullyVisible(identified("live.locked"))
                try await requireFullyVisible(app.staticTexts["live.quiz.title"])
                capture("browser-host-native-locked-\(index + 1)")
            }
            if index == 0 {
                // Real background/foreground recovery, retaining the same room
                // and submitted choice. No local score is manufactured.
                XCUIDevice.shared.press(.home); app.activate()
                XCTAssertTrue(app.staticTexts["live.roomCode"].label.contains(code))
                capture("browser-host-native-foreground-recovery")
            }
            try require(identified("live.revealedAnswer"), timeout: index == 2 ? 55 : 120)
            try reveal(identified("live.revealedAnswer"))
            XCTAssertTrue(identified("live.revealedAnswer").label.contains(revealedAnswers[index]))
            let companion = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Sam:")).firstMatch
            let expectedChoice = ["B · Mars", "A · Two", "No answer"][index]
            let expectedPoints = index == 0 ? "1000" : "0"
            guard companion.exists, companion.label.contains(expectedChoice),
                  companion.label.filter(\.isNumber) == expectedPoints else {
                capture("browser-host-companion-outcome-failure-\(index + 1)")
                XCTFail("Sam must show \(expectedChoice) and \(expectedPoints) points for question \(index + 1)")
                throw Failure.invalidReceipt
            }
            let native = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "NativeQA:")).firstMatch
            let expectedNativeChoice = ["B · Mars", "B · Three", "C · Pacific"][index]
            guard native.exists, native.label.contains(expectedNativeChoice), native.label.filter(\.isNumber) == "1000" else {
                capture("browser-host-native-outcome-failure-\(index + 1)")
                XCTFail("NativeQA must show \(expectedNativeChoice) and 1000 points for question \(index + 1)")
                throw Failure.invalidReceipt
            }
            capture(index == 1 ? "browser-host-native-direct-reveal-2" : "browser-host-native-reveal-\(index + 1)")
        }
        try require(app.staticTexts["live.finished"], timeout: 120)
        try await requireFullyVisible(app.staticTexts["live.finished"])
        try await requireFullyVisible(app.staticTexts["live.quiz.total"])
        XCTAssertEqual(app.staticTexts["live.finished"].label, "Quiz complete")
        XCTAssertEqual(app.staticTexts["live.quiz.total"].label.filter(\.isNumber), "3000")
        XCTAssertFalse(app.staticTexts["live.prompt"].exists, "Final results must lead with the completed quiz and total, not an active question")
        capture("browser-host-native-final-results")
        try tap("live.leave"); try confirm("Leave room")
        try require(app.staticTexts["You left the room."], timeout: 15)
        ownsSeat = false
        capture("browser-host-native-left")
    }

    /// Native UI hosts and advances; two explicitly synthetic HTTP peers answer.
    /// This is separate evidence from the actual browser/native journey above.
    func testNativeHostedSampleQuizWithSyntheticAPIPeers() async throws {
        try tap("home.quizzes")
        try tap("quiz.library.sampleHost")
        try refuseUnknownSavedAccess()
        try tap("live.quiz.create")
        try require(app.staticTexts["live.roomCode"], timeout: 20)
        let label = app.staticTexts["live.roomCode"].label
        let code = try XCTUnwrap(label.split(separator: " ").last.map(String.init))
        guard validCode(code) else { throw Failure.invalidReceipt }
        ownedCode = code; ownsHost = true
        let sam = try await joinPeer(code: code, nickname: "SamAPI")
        let web = try await joinPeer(code: code, nickname: "WebQAAPI")
        try await waitForText(app.staticTexts["live.rosterCount"], containing: "Players: 2", timeout: 15)
        capture("native-host-api-peer-lobby")
        try tap("live.start")
        let correct = [1, 1, 2]
        for index in 0..<3 {
            try await waitForText(app.staticTexts["live.quiz.progress"], containing: "QUESTION \(index + 1) OF 3", timeout: 15)
            try await requireFullyVisible(app.staticTexts["live.quiz.title"])
            try await requireFullyVisible(app.staticTexts["live.quiz.progress"])
            let state = try await snapshot(sam)
            let round = try XCTUnwrap(state["round"] as? [String: Any])
            XCTAssertNil(round["correctAnswer"]); XCTAssertNil(round["explanation"]); XCTAssertNil(state["questions"])
            XCTAssertTrue(state["reveal"] is NSNull)
            capture("native-host-api-peer-question-\(index + 1)")
            _ = try await action("quiz-answer", peer: sam, state: state, value: correct[index])
            if index < 2 { _ = try await action("quiz-answer", peer: web, state: try await snapshot(web), value: index == 1 ? 0 : 1) }
            try require(identified("live.revealedAnswer"), timeout: index == 2 ? 45 : 15)
            try reveal(identified("live.revealedAnswer"))
            XCTAssertTrue(identified("live.revealedAnswer").label.contains(["Mars", "Three", "Pacific"][index]))
            capture("native-host-api-peer-reveal-\(index + 1)")
            try tap("live.next")
        }
        try require(app.staticTexts["live.finished"], timeout: 15)
        try await requireFullyVisible(app.staticTexts["live.finished"])
        try await requireFullyVisible(app.staticTexts["live.quiz.total"])
        XCTAssertEqual(app.staticTexts["live.finished"].label, "Quiz complete")
        XCTAssertEqual(app.staticTexts["live.quiz.total"].label.filter(\.isNumber), "3000")
        XCTAssertFalse(app.staticTexts["live.prompt"].exists)
        let final = try await snapshot(sam)
        let board = try XCTUnwrap(final["leaderboard"] as? [[String: Any]])
        XCTAssertEqual(board.first(where: { $0["nickname"] as? String == "SamAPI" })?["points"] as? Int, 3_000)
        XCTAssertEqual(board.first(where: { $0["nickname"] as? String == "WebQAAPI" })?["points"] as? Int, 1_000)
        capture("native-host-api-peer-final-results")
        _ = try await action("leave", peer: sam, state: final)
        _ = try await action("leave", peer: web, state: try await snapshot(web))
        try tap("live.closeRoom"); try confirm("Close room")
        try require(app.staticTexts["The room is closed."], timeout: 15)
        ownsHost = false
        for peer in [sam, web] {
            do { _ = try await snapshot(peer); XCTFail("Closed room must reject former participant access") }
            catch Failure.service(let status) { XCTAssertTrue([401, 403, 404, 410].contains(status)) }
        }
        capture("native-host-api-peer-closed")
    }

    private func refuseUnknownSavedAccess() throws {
        if app.buttons["live.resume"].waitForExistence(timeout: 1) || app.buttons["live.recover"].exists || app.buttons["live.retrySecureAccess"].exists {
            throw XCTSkip("Saved access already exists for this local service. Resolve the known QA room through product controls before this fresh-room journey; the test will not forget unknown access.")
        }
    }
    private func validCode(_ code: String) -> Bool { code.range(of: "^[A-HJ-NP-Z2-9]{6}$", options: .regularExpression) != nil }
    private func identified(_ identifier: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: identifier).firstMatch }
    @discardableResult private func require(_ element: XCUIElement, timeout: TimeInterval = 15) throws -> XCUIElement {
        guard element.waitForExistence(timeout: timeout) else { XCTFail("Expected quiz control: \(element.identifier)"); throw Failure.missing }
        return element
    }
    @discardableResult private func reveal(_ element: XCUIElement) throws -> XCUIElement {
        try require(element)
        for _ in 0..<10 {
            if element.isHittable { return element }
            if element.frame.maxY < 100 { app.swipeDown(velocity: .slow) } else { app.swipeUp(velocity: .slow) }
        }
        guard element.isHittable else { XCTFail("Quiz control is unreachable: \(element.identifier)"); throw Failure.unreachable }
        return element
    }
    private func tap(_ identifier: String) throws {
        let item = try reveal(identified(identifier))
        guard item.isEnabled else { XCTFail("Quiz control must be enabled: \(identifier)"); throw Failure.unreachable }
        item.tap()
    }
    private func confirm(_ label: String) throws {
        let button = try require(app.sheets.buttons[label]); guard button.isHittable else { throw Failure.unreachable }; button.tap()
    }
    private func dismissKeyboard() async throws {
        let keyboard = app.keyboards.firstMatch
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: keyboard)
        if await XCTWaiter.fulfillment(of: [dismissed], timeout: 2) == .completed { return }
        guard let done = ["Done", "Return"].map({ app.keyboards.buttons[$0] })
            .first(where: { $0.exists && $0.isHittable && $0.isEnabled }) else {
            XCTFail("Nickname entry must offer a reachable keyboard Done action"); throw Failure.unreachable
        }
        done.tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: keyboard)
        guard await XCTWaiter.fulfillment(of: [gone], timeout: 3) == .completed else {
            XCTFail("The nickname keyboard did not dismiss"); throw Failure.unreachable
        }
    }
    private func waitForPrompt(_ text: String, timeout: TimeInterval) async throws {
        let prompt = app.staticTexts["live.prompt"]
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND label == %@", text), object: prompt)
        guard await XCTWaiter.fulfillment(of: [expected], timeout: timeout) == .completed else { XCTFail("Host did not advance to expected authored question"); throw Failure.missing }
        try await requireFullyVisible(app.staticTexts["live.quiz.title"])
        try await requireFullyVisible(prompt)
    }
    /// This assertion never repairs scrolling. A phase transition must itself
    /// present the complete current heading/score before the screenshot is taken.
    private func requireFullyVisible(_ element: XCUIElement) async throws {
        let viewport = app.frame
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { object, _ in
            guard let item = object as? XCUIElement else { return false }
            return item.exists && item.isHittable && !item.frame.isEmpty &&
                item.frame.minY >= viewport.minY + 60 && item.frame.maxY <= viewport.maxY - 20
        }, object: element)
        guard await XCTWaiter.fulfillment(of: [visible], timeout: 5) == .completed else {
            capture("phase-top-visibility-failure")
            XCTFail("The complete phase heading or total must be visible without test scrolling: \(element.identifier)")
            throw Failure.unreachable
        }
    }
    private func waitForText(_ element: XCUIElement, containing text: String, timeout: TimeInterval) async throws {
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND label CONTAINS %@", text), object: element)
        guard await XCTWaiter.fulfillment(of: [expected], timeout: timeout) == .completed else { throw Failure.missing }
    }
    private func capture(_ name: String) {
        print("QUIZ_LIVE_QA phase=\(name)")
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "quiz-live-\(name)"; shot.lifetime = .keepAlways; add(shot)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = "quiz-live-\(name)-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }

    private struct Peer { let code: String; let token: String }
    private func json(_ path: String, token: String? = nil, body: [String: Any]? = nil) async throws -> [String: Any] {
        var request = URLRequest(url: base.appendingPathComponent("api/live").appendingPathComponent(path))
        request.timeoutInterval = 15; request.httpMethod = body == nil ? "GET" : "POST"
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await network.data(for: request)
        let status = try XCTUnwrap(response as? HTTPURLResponse).statusCode
        guard (200...299).contains(status) else { throw Failure.service(status) }
        guard data.count <= 262_144, let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.invalidReceipt }
        return raw
    }
    private func joinPeer(code: String, nickname: String) async throws -> Peer {
        var random = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { throw Failure.invalidReceipt }
        let secret = Data(random).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let response = try await json("rooms/\(code)/join", body: ["admissionId": UUID().uuidString.lowercased(), "recoverySecret": secret, "nickname": nickname, "acceptRoomSharing": true])
        guard response["code"] as? String == code, let token = response["token"] as? String else { throw Failure.invalidReceipt }
        return Peer(code: code, token: token)
    }
    private func snapshot(_ peer: Peer) async throws -> [String: Any] {
        let response = try await json("rooms/\(peer.code)", token: peer.token)
        return try XCTUnwrap(response["state"] as? [String: Any])
    }
    private func action(_ action: String, peer: Peer, state: [String: Any], value: Int? = nil) async throws -> [String: Any] {
        var body: [String: Any] = ["requestId": UUID().uuidString.lowercased(), "matchId": try XCTUnwrap(state["matchId"] as? String), "action": action]
        if action == "quiz-answer" { body["roundId"] = try XCTUnwrap((state["round"] as? [String: Any])?["id"] as? String) }
        if let value { body["value"] = value }
        return try await json("rooms/\(peer.code)/actions", token: peer.token, body: body)
    }
}
