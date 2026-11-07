import XCTest

/// Actual process relaunches against an isolated test-only persistence store.
/// These tests exercise visible game state; they do not inspect saved answers.
@MainActor
final class StandaloneResumeUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-persistence-testing", "-persistence-reset"]
        app.launch()
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    override func tearDownWithError() throws {
        // Reset the test-only store, never the player's standalone save.
        app.terminate()
        app.launchArguments = ["-ui-testing", "-persistence-testing", "-persistence-reset"]
        app.launch()
        app.terminate()
    }

    func testInterruptedAnswerResumesExactQuestionSelectionAndLeaveClears() {
        tap("home.makeChallenge")
        tap("round.choice.4")
        tap("round.next")
        tap("round.choice.2")
        let prompt = require(node("round.prompt")).label
        restart()
        XCTAssertEqual(require(node("round.prompt")).label, prompt, "Do not draw a replacement question after restart")
        XCTAssertEqual(require(app.buttons["round.choice.2"].firstMatch).value as? String, "selected")
        tap("round.back")
        XCTAssertEqual(require(app.buttons["round.choice.4"].firstMatch).value as? String, "selected")
        tap("round.next")
        XCTAssertEqual(require(app.buttons["round.choice.2"].firstMatch).value as? String, "selected")
        tap("nav.close")
        tapAlert(identifier: "exit.cancel", label: "Keep playing")
        restart()
        XCTAssertEqual(require(node("round.prompt")).label, prompt, "Cancel exit must preserve the game")
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        require(app.buttons["home.makeChallenge"].firstMatch)
        restart()
        require(app.buttons["home.makeChallenge"].firstMatch)
        XCTAssertFalse(app.buttons["round.choice.1"].exists, "An explicitly abandoned game must not return")
    }

    func testHandoffGuessAndRevealResumeWithoutEarlyAnswerLeak() {
        tap("home.makeChallenge")
        for answer in [1, 2, 3, 4, 5] {
            tap("round.choice.\(answer)")
            tap("round.next")
        }
        require(app.buttons["handoff.guess"].firstMatch)
        restart()
        require(app.buttons["handoff.guess"].firstMatch)
        XCTAssertFalse(node("round.reveal").exists, "Restart must not expose a sealed answer")
        tap("handoff.share")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "encoded, not encrypted")).firstMatch.waitForExistence(timeout: 8),
                      "Sharing must explain that the code contains the answers")
        tap("nav.close")
        require(app.buttons["handoff.guess"].firstMatch)
        tap("handoff.guess")
        let prompt = require(node("round.prompt")).label
        tap("round.choice.1")
        restart()
        XCTAssertEqual(require(node("round.prompt")).label, prompt)
        XCTAssertEqual(require(app.buttons["round.choice.1"].firstMatch).value as? String, "selected")
        XCTAssertFalse(node("round.reveal").exists, "A selected guess is still hidden until locked")
        tap("round.next")
        let reveal = require(node("round.reveal"))
        XCTAssertTrue(reveal.label.lowercased().contains("you guessed 1"))
        XCTAssertTrue(reveal.label.lowercased().contains("picked 1"))
        restart()
        let restored = require(node("round.reveal"))
        XCTAssertTrue(restored.label.lowercased().contains("you guessed 1"))
        XCTAssertTrue(restored.label.lowercased().contains("picked 1"))
        tap("round.next")
        for answer in [2, 3, 4, 5] {
            tap("round.choice.\(answer)")
            tap("round.next")
            require(node("round.reveal"))
            tap("round.next")
        }
        require(app.buttons["result.home"].firstMatch)
        XCTAssertTrue(app.staticTexts["100%"].exists, "Resuming must preserve scoring and the original answers")
        tap("result.home")
        require(app.buttons["home.makeChallenge"].firstMatch)
        restart()
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    func testCorruptSaveRecoversAndCanPersistNewGame() {
        verifyInvalidSaveRecovery(fixture: "-persistence-corrupt-fixture")
    }

    func testMixedClassicTopicCodeResumesHiddenGuessRevealAndOriginalQuestions() {
        // Stable LK3 v3/catalogue v1 fixture: Alex, IDs [1001, 1, 2, 3, 4],
        // host answers [1, 2, 3, 4, 5]. It enters through the real paste/import UI.
        let code = "LK3-eyJhbnN3ZXJzIjpbMSwyLDMsNCw1XSwiY2F0YWxvZ1ZlcnNpb24iOjEsIm5hbWUiOiJBbGV4IiwicHJvbXB0SURzIjpbMTAwMSwxLDIsMyw0XSwidmVyc2lvbiI6M33tXQ"
        let prompts = [
            "I would trade the last cookie for a whole bowl of popcorn.",
            "I could go a whole week without my phone.",
            "My houseplants deserve names and a backstory.",
            "I rehearse a casual reply before sending it.",
            "I would follow a squirrel if it looked like it had a quest."
        ]
        tap("home.join")
        let input = require(node("join.code"))
        input.tap(); input.typeText(code)
        tap("join.play")
        XCTAssertFalse(app.alerts["Game couldn't be saved"].exists)
        XCTAssertEqual(require(node("round.prompt")).label, prompts[0])
        tap("round.choice.2")
        restart()
        XCTAssertEqual(require(node("round.prompt")).label, prompts[0])
        XCTAssertEqual(require(app.buttons["round.choice.2"].firstMatch).value as? String, "selected")
        XCTAssertFalse(node("round.reveal").exists, "Restoring an imported guess must not expose the host answer")
        tap("nav.close")
        tapAlert(identifier: "exit.cancel", label: "Keep playing")
        restart()
        XCTAssertEqual(require(app.buttons["round.choice.2"].firstMatch).value as? String, "selected")
        XCTAssertFalse(node("round.reveal").exists)
        tap("round.next")
        let reveal = require(node("round.reveal")).label.lowercased()
        XCTAssertTrue(reveal.contains("you guessed 2")); XCTAssertTrue(reveal.contains("picked 1"))
        XCTAssertTrue(reveal.contains("75 points"))
        restart()
        XCTAssertEqual(require(node("round.reveal")).label.lowercased(), reveal)
        tap("round.next")
        for index in 1..<5 {
            XCTAssertEqual(require(node("round.prompt")).label, prompts[index], "All original classic and topic questions must remain in order")
            tap("round.choice.\(index + 1)")
            tap("round.next")
            let result = require(node("round.reveal")).label.lowercased()
            XCTAssertTrue(result.contains("picked \(index + 1)"))
            tap("round.next")
        }
        require(app.buttons["result.home"].firstMatch)
        XCTAssertTrue(app.staticTexts["95%"].exists, "The non-exact first guess must retain its original score after restart")
        tap("result.home")
        restart()
        require(app.buttons["home.makeChallenge"].firstMatch)
        XCTAssertFalse(app.buttons["round.choice.1"].exists)
    }

    func testUnsupportedVersionSaveRecoversAndCanPersistNewGame() {
        verifyInvalidSaveRecovery(fixture: "-persistence-unsupported-fixture")
    }

    private func verifyInvalidSaveRecovery(fixture: String) {
        app.terminate()
        // The DEBUG fixture and reset are scoped to the separate UI-test file.
        app.launchArguments = ["-ui-testing", "-persistence-testing", "-persistence-reset", fixture]
        app.launch()
        let alert = require(app.alerts["Saved game couldn't be restored"].firstMatch)
        require(alert.buttons["OK"].firstMatch).tap()
        require(app.buttons["home.makeChallenge"].firstMatch)
        restart()
        require(app.buttons["home.makeChallenge"].firstMatch)
        XCTAssertFalse(app.alerts["Saved game couldn't be restored"].exists, "Discarded bad data must not reappear after restart")
        tap("home.makeChallenge")
        tap("round.choice.3")
        let prompt = require(node("round.prompt")).label
        restart()
        XCTAssertEqual(require(node("round.prompt")).label, prompt, "A valid replacement game should be recoverable")
        XCTAssertEqual(require(app.buttons["round.choice.3"].firstMatch).value as? String, "selected")
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    private func restart() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-persistence-testing"]
        app.launch()
    }

    private func node(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
    @discardableResult private func require(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 10), "Expected \(element)", file: file, line: line)
        return element
    }
    private func tap(_ identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        if identifier == "join.play", app.buttons["join.done"].firstMatch.exists {
            app.buttons["join.done"].firstMatch.tap()
            let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 4), .completed)
        }
        let query = app.buttons.matching(identifier: identifier)
        require(query.firstMatch, file: file, line: line)
        let button = query.allElementsBoundByIndex.first(where: { $0.isHittable }) ?? query.firstMatch
        XCTAssertTrue(button.isEnabled, "\(identifier) must be enabled", file: file, line: line)
        button.tap()
    }
    private func tapAlert(identifier: String, label: String) {
        let alert = require(app.alerts.firstMatch)
        let candidate = alert.buttons[identifier].firstMatch
        (candidate.exists ? candidate : require(alert.buttons[label].firstMatch)).tap()
    }
}
