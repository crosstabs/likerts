import XCTest

/// Exercises production topic selection, answer transport and topic-aware
/// rematching. Screenshot fixtures select content only; controls remain real.
@MainActor
final class TopicUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func testTopicPassAndPlayKeepsPromptsAndRematchAvoidsPreviousFive() {
        launch(["-ui-testing"])
        require(app.buttons["home.makeChallenge"].firstMatch)
        tap("home.topics")
        require(app.buttons["topics.snacks"].firstMatch)
        screenshot("topics-01-picker")
        tap("topics.snacks")
        require(app.buttons["round.choice.1"].firstMatch)

        let answers = [1, 2, 3, 4, 5]
        var originals = [promptText()]
        tap("round.choice.1")
        tap("round.next")
        let second = promptText()
        tap("round.choice.2")
        tap("round.back")
        XCTAssertEqual(promptText(), originals[0])
        XCTAssertEqual(app.buttons["round.choice.1"].firstMatch.value as? String, "selected")
        tap("round.next")
        XCTAssertEqual(promptText(), second)
        XCTAssertEqual(app.buttons["round.choice.2"].firstMatch.value as? String, "selected")
        tap("nav.close")
        tapAlert("exit.cancel")
        XCTAssertEqual(promptText(), second, "Cancelling exit must keep the active topic and question.")

        for index in 1..<5 {
            originals.append(promptText())
            tap("round.choice.\(answers[index])")
            if index == 1 { screenshot("topics-02-snacks-answer") }
            tap("round.next")
        }
        XCTAssertEqual(Set(originals).count, 5)
        tap("handoff.guess")
        for (index, answer) in answers.enumerated() {
            XCTAssertEqual(promptText(), originals[index], "The guesser must see the host's actual statements in order.")
            tap("round.choice.\(answer)")
            tap("round.next")
            let reveal = require(node("round.reveal")).label.lowercased()
            XCTAssertTrue(reveal.contains("you guessed \(answer)"), reveal)
            XCTAssertTrue(reveal.contains("picked \(answer)"), reveal)
            XCTAssertTrue(reveal.contains("100 points"), reveal)
            if index == 0 { screenshot("topics-03-snacks-reveal") }
            tap("round.next")
        }
        require(app.buttons["result.home"].firstMatch)
        XCTAssertTrue(app.staticTexts["100%"].exists)
        screenshot("topics-04-perfect-result")
        tap("result.rematch")

        var rematch: [String] = []
        for _ in 0..<5 {
            rematch.append(promptText())
            tap("round.choice.3")
            tap("round.next")
        }
        XCTAssertEqual(Set(rematch).count, 5)
        XCTAssertTrue(Set(rematch).isDisjoint(with: Set(originals)), "The next topic round must avoid all five just played questions.")
        require(app.buttons["handoff.guess"].firstMatch)
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
        tap("home.topics")
        require(app.buttons["topics.snacks"].firstMatch)
        tap("nav.close")
        require(app.buttons["home.makeChallenge"].firstMatch)
        XCTAssertFalse(app.buttons["round.next"].exists)

        let attachment = XCTAttachment(string: "First game:\n\(originals.joined(separator: "\n"))\n\nTopic rematch:\n\(rematch.joined(separator: "\n"))")
        attachment.name = "topics-real-prompt-order-and-no-repeat"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testLargeTextReducedEffectsTopicSceneCanSelectRevealAndExit() {
        launch(["-ui-testing", "-topic-qa", "future", "-large-text", "-accessible-effects"])
        let question = promptText()
        XCTAssertFalse(question.isEmpty)
        tap("round.choice.2")
        tap("round.choice.4")
        screenshot("topics-08-future-accessible-selection")
        tap("round.next")
        let reveal = require(node("round.reveal")).label.lowercased()
        XCTAssertTrue(reveal.contains("you guessed 4"), reveal)
        XCTAssertTrue(reveal.contains("alex picked 4"), reveal)
        XCTAssertTrue(reveal.contains("100 points"), reveal)
        screenshot("topics-09-future-accessible-reveal")
        tap("nav.close")
        tapAlert("exit.cancel")
        require(node("round.reveal"))
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    func testFailedTopicDrawExplainsRecoveryAndQuickPlayStillWorks() {
        launch(["-ui-testing", "-topic-draw-failure"])
        tap("home.topics")
        tap("topics.snacks")
        let alert = require(app.alerts.firstMatch)
        XCTAssertTrue(alert.label.contains("Couldn't prepare those takes"))
        require(alert.buttons["topics.error.ok"].firstMatch).tap()
        XCTAssertTrue(app.buttons["topics.snacks"].exists, "Stay in the picker so the player can retry")
        tap("nav.close")
        tap("home.makeChallenge")
        require(app.buttons["round.choice.1"].firstMatch)
        XCTAssertFalse(promptText().isEmpty, "Quick play falls back to original prompts")
    }

    func testRepresentativeComposedTopicScreenshots() {
        for (index, topic) in ["snacks", "music", "future"].enumerated() {
            launch(["-ui-testing", "-topic-qa", topic])
            XCTAssertFalse(promptText().isEmpty)
            require(app.buttons["round.choice.4"].firstMatch)
            XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "selected")
            screenshot("topics-\(String(format: "%02d", index + 5))-\(topic)-scene")
        }
    }

    private func launch(_ arguments: [String]) {
        if app.state != .notRunning { app.terminate() }
        app.launchArguments = arguments
        app.launch()
    }

    private func promptText() -> String { require(node("round.prompt")).label }

    private func node(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
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

    private func tapAlert(_ identifier: String) {
        let alert = require(app.alerts.firstMatch)
        require(alert.buttons[identifier].firstMatch).tap()
    }

    private func reveal(_ element: XCUIElement) {
        if ["round.next", "nav.close"].contains(element.identifier), element.isHittable { return }
        let scrolls = app.scrollViews.allElementsBoundByIndex
        guard let scroll = scrolls.first(where: { $0.isHittable }) ?? scrolls.first else { return }
        for _ in 0..<10 {
            let frame = element.frame
            var top = max(scroll.frame.minY, app.frame.minY + 20)
            var bottom = min(scroll.frame.maxY, app.frame.maxY - 12)
            if element.identifier.hasPrefix("round.choice.") {
                top = app.frame.minY + 20
                bottom = app.frame.maxY - 12
                let close = app.buttons["nav.close"].firstMatch
                let next = app.buttons["round.next"].firstMatch
                if close.exists { top = max(top, close.frame.maxY + 14) }
                if next.exists { bottom = min(bottom, next.frame.minY - 10) }
            }
            if element.isHittable && frame.minY >= top && frame.maxY <= bottom { return }
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
