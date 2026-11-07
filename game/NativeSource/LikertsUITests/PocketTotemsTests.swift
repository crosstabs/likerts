import XCTest

/// Visual/state checks use the DEBUG fixture's real GameSession and production
/// controls. The fixture changes initial state only; it does not stub rendering.
@MainActor
final class PocketTotemsTests: XCTestCase {
    private var app: XCUIApplication!
    private let answers = [4, 1, 2, 3, 5]

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-totem-qa"]
        app.launch()
        require(app.buttons["round.choice.4"].firstMatch)
    }

    func testPreselectedTotemExactRevealAndNextRoundState() {
        let question = require(node("round.prompt")).label
        XCTAssertTrue(question.lowercased().contains("robot vacuum"))
        XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "selected")
        XCTAssertTrue(app.buttons["round.next"].firstMatch.isEnabled)
        screenshot("totems-01-selected-round")

        tap("round.choice.2")
        tap("round.choice.4")
        tap("round.next")
        assertReveal(guess: 4, answer: 4, points: 100)
        XCTAssertFalse(app.buttons["round.choice.4"].exists)
        screenshot("totems-02-exact-reveal")
        tap("round.next")

        require(app.buttons["round.choice.4"].firstMatch)
        XCTAssertNotEqual(require(node("round.prompt")).label, question)
        XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "not selected")
        XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled, "A new question must require its own prediction.")
        tap("nav.close")
        tapAlert("exit.cancel")
        require(app.buttons["round.choice.1"].firstMatch)
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    func testDifferentTotemProducesActualMismatchReveal() {
        tap("round.choice.1")
        tap("round.next")
        assertReveal(guess: 1, answer: 4, points: 25)
        XCTAssertTrue(require(node("round.reveal")).label.lowercased().contains("3 steps apart"))
        screenshot("totems-03-mismatch-reveal")
        tap("round.next")
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    func testFiveExactReadsCompleteResultAndRematchRestoresPreviousAnswer() {
        for answer in answers {
            tap("round.choice.\(answer)")
            tap("round.next")
            assertReveal(guess: answer, answer: answer, points: 100)
            tap("round.next")
        }
        require(app.buttons["result.home"].firstMatch)
        XCTAssertTrue(app.staticTexts["100%"].exists)
        screenshot("totems-05-completed-result")
        tap("result.rematch")

        tap("round.choice.4")
        tap("round.next")
        tap("round.choice.2")
        tap("round.back")
        XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "selected")
        tap("round.next")
        XCTAssertEqual(app.buttons["round.choice.2"].firstMatch.value as? String, "selected", "Rematch answers must survive back and forward navigation.")
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    func testLargeTextReducedEffectsTotemSelectionAndRevealRemainUsable() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-totem-qa", "-large-text", "-accessible-effects"]
        app.launch()
        require(app.buttons["round.choice.4"].firstMatch)
        XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "selected")
        XCTAssertTrue(require(node("round.prompt")).label.lowercased().contains("robot vacuum"))
        screenshot("totems-04-accessible-selection")
        tap("round.next")
        assertReveal(guess: 4, answer: 4, points: 100)
        screenshot("totems-06-accessible-reveal")
        tap("round.next")
        tap("round.choice.1")
        XCTAssertEqual(app.buttons["round.choice.1"].firstMatch.value as? String, "selected")
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    private func assertReveal(guess: Int, answer: Int, points: Int, file: StaticString = #filePath, line: UInt = #line) {
        let spoken = require(node("round.reveal"), file: file, line: line).label.lowercased()
        XCTAssertTrue(spoken.contains("you guessed \(guess)"), spoken, file: file, line: line)
        XCTAssertTrue(spoken.contains("alex picked \(answer)"), spoken, file: file, line: line)
        XCTAssertTrue(spoken.contains("\(points) points"), spoken, file: file, line: line)
    }

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
        for _ in 0..<8 {
            let frame = element.frame
            var top = max(scroll.frame.minY, app.frame.minY + 20)
            var bottom = min(scroll.frame.maxY, app.frame.maxY - 12)
            if element.identifier.hasPrefix("round.choice.") {
                // Totems live in the fixed dock, outside the prompt scroll's
                // content bounds. Judge them against the screen/header/CTA.
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
