import XCTest

/// Local simulation of the production Messages view/model and MSMessage builder.
/// These tests stage cards but never insert, send, or deliver a conversation message.
@MainActor
final class MessagesHarnessTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-messages-harness"]
        app.launch()
        let simulation = require(app.staticTexts["messages.simulation"].firstMatch)
        XCTAssertTrue(simulation.label.contains("simulation"))
        XCTAssertTrue(simulation.label.contains("No delivery"))
        require(app.buttons["messages.start"].firstMatch)
    }

    func testChallengeAndResultDraftSimulationThenSessionPreservingRematch() {
        tap("messages.start")
        let answers = [1, 2, 3, 4, 5]
        answerFive(answers)
        screenshot("messages-01-sealed-challenge")
        tap("messages.draftChallenge")
        require(app.buttons["messages.simulateRecipient"].firstMatch)
        XCTAssertTrue(require(app.staticTexts["messages.notice"].firstMatch).label.contains("Draft ready"))
        XCTAssertEqual(require(app.staticTexts["messages.session"].firstMatch).label, "Same session")
        screenshot("messages-02-challenge-draft-simulation")

        tap("messages.simulateRecipient")
        tap("messages.playChallenge")
        guessFive(answers)
        require(app.descendants(matching: .any).matching(identifier: "messages.result").firstMatch)
        XCTAssertTrue(app.staticTexts["100%"].exists)
        screenshot("messages-03-perfect-result")
        tap("messages.draftResult")
        require(app.buttons["messages.simulateResult"].firstMatch)
        tap("messages.simulateResult")
        require(app.descendants(matching: .any).matching(identifier: "messages.result").firstMatch)
        XCTAssertTrue(app.staticTexts["100%"].exists, "Opening a staged result must preserve the recomputed score.")
        XCTAssertFalse(app.buttons["messages.draftResult"].exists, "A received result is a report, not an unsent local result.")
        screenshot("messages-04-received-result-simulation")

        tap("messages.rematch")
        tap("round.choice.3")
        XCTAssertEqual(app.buttons["round.choice.3"].firstMatch.value as? String, "selected")
        XCTAssertEqual(app.staticTexts["messages.session"].firstMatch.label, "Same session", "A rematch must reuse the existing Messages session.")
        XCTAssertFalse(app.buttons["messages.simulateResult"].exists)
        screenshot("messages-05-rematch-same-session")
    }

    func testMalformedSelectedCardShowsRecoveryWithoutOpeningRound() {
        tap("messages.badPayload")
        let error = require(app.staticTexts["messages.error"].firstMatch)
        XCTAssertTrue(error.label.contains("incomplete") || error.label.contains("newer"))
        XCTAssertFalse(app.buttons["round.choice.1"].exists)
        XCTAssertFalse(app.buttons["messages.draftChallenge"].exists)
        screenshot("messages-06-invalid-card-recovery")
        tap("messages.start")
        tap("round.choice.2")
        XCTAssertEqual(app.buttons["round.choice.2"].firstMatch.value as? String, "selected")
    }

    func testCompactAndExpandedPresentationPreserveAnswerSelection() {
        screenshot("messages-07-compact-home")
        tap("messages.start")
        tap("round.choice.4")
        screenshot("messages-08-expanded-answer")
        tap("messages.compact")
        screenshot("messages-09-after-compact-control")
        XCTAssertEqual(app.buttons["messages.compact"].firstMatch.value as? String, "compact; taps 1",
                       "The harness presentation action must execute once before testing the compact view")
        require(app.buttons["messages.expand"].firstMatch)
        XCTAssertFalse(app.buttons["round.choice.4"].exists)
        screenshot("messages-09-compact-active-game")
        tap("messages.expand")
        let selected = require(app.buttons["round.choice.4"].firstMatch)
        XCTAssertEqual(selected.value as? String, "selected", "A presentation change must retain the unfinished answer.")
        tap("round.next")
        tap("round.choice.1")
        screenshot("messages-10-expanded-second-answer")
    }

    func testMissingAndGroupConversationDisableDraftAndOneFriendRecovers() {
        tap("messages.start")
        answerFive([1, 2, 3, 4, 5])
        tap("messages.noConversation")
        let draft = require(app.buttons["messages.draftChallenge"].firstMatch)
        XCTAssertFalse(draft.isEnabled)
        XCTAssertTrue(require(app.staticTexts["messages.conversation"].firstMatch).label.contains("Open a conversation"))
        XCTAssertFalse(app.buttons["messages.simulateRecipient"].exists)
        screenshot("messages-11-missing-conversation")

        tap("messages.group")
        XCTAssertFalse(draft.isEnabled)
        XCTAssertTrue(require(app.staticTexts["messages.conversation"].firstMatch).label.contains("two people"))
        XCTAssertFalse(app.buttons["messages.simulateRecipient"].exists)
        screenshot("messages-12-group-conversation")

        tap("messages.oneFriend")
        let enabled = NSPredicate(format: "enabled == true")
        expectation(for: enabled, evaluatedWith: draft)
        waitForExpectations(timeout: 5)
        tap("messages.draftChallenge")
        require(app.buttons["messages.simulateRecipient"].firstMatch)
        XCTAssertTrue(app.staticTexts["messages.simulation"].firstMatch.label.contains("No delivery"))
    }

    private func answerFive(_ answers: [Int]) {
        for answer in answers {
            tap("round.choice.\(answer)")
            tap("round.next")
        }
        require(app.buttons["messages.draftChallenge"].firstMatch)
    }

    private func guessFive(_ guesses: [Int]) {
        for guess in guesses {
            tap("round.choice.\(guess)")
            tap("round.next")
            require(app.descendants(matching: .any).matching(identifier: "round.reveal").firstMatch)
            tap("round.next")
        }
    }

    @discardableResult
    private func require(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 8), "Expected \(element) to exist.", file: file, line: line)
        return element
    }

    private func tap(_ identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        let query = app.buttons.matching(identifier: identifier)
        require(query.firstMatch, file: file, line: line)
        let button = query.allElementsBoundByIndex.first(where: { $0.isHittable }) ?? query.firstMatch
        reveal(button)
        XCTAssertTrue(button.isEnabled, "\(identifier) should be enabled.", file: file, line: line)
        button.tap()
        if identifier.hasPrefix("round.choice.") {
            XCTAssertEqual(button.value as? String, "selected", file: file, line: line)
        }
    }

    private func reveal(_ element: XCUIElement) {
        let scrolls = app.scrollViews.allElementsBoundByIndex
        // The harness control strip is horizontal. Game pages are vertical.
        // Prefer a tall page scroll so a page swipe doesn't move that strip.
        let vertical = scrolls.filter { $0.frame.height > 100 }
        guard let scroll = vertical.first(where: { $0.isHittable }) ?? vertical.first else { return }
        for _ in 0..<8 {
            let frame = element.frame
            var top = max(scroll.frame.minY, app.frame.minY + 20)
            var bottom = min(scroll.frame.maxY, app.frame.maxY - 12)
            if element.identifier.hasPrefix("round.choice.") {
                let close = app.buttons["nav.close"].firstMatch
                let next = app.buttons["round.next"].firstMatch
                if close.exists { top = max(top, close.frame.maxY + 16) }
                if next.exists { bottom = min(bottom, next.frame.minY - 10) }
            }
            if element.isHittable && frame.minY >= top && frame.maxY <= bottom { return }
            // Harness controls are outside the game scroll and already visible.
            if element.isHittable && frame.maxY <= scroll.frame.minY { return }
            if frame.minY < top { scroll.swipeDown() } else { scroll.swipeUp() }
        }
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
