import XCTest

/// These fixtures choose real initial content/state only. Production rendering,
/// scoring, navigation and the system share sheet remain in use.
@MainActor
final class VignetteUITests: XCTestCase {
    private var app: XCUIApplication!
    private let representatives: [(id: Int, family: String)] = [
        (1005, "tabletop"), (1018, "wearUse"), (1108, "peek"),
        (1019, "share"), (1208, "journey"), (1009, "build")
    ]

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func testSixFamiliesKeepTheirQuestionAndSceneThroughExactReveal() {
        for (index, example) in representatives.enumerated() {
            launch(["-ui-testing", "-story-qa", String(example.id)])
            let question = require(node("round.prompt")).label
            let scene = require(node("story.scene.\(example.id)"))
            XCTAssertFalse(scene.label.isEmpty, "The illustration needs a meaningful spoken description.")
            XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "selected")
            screenshot("story-\(String(format: "%02d", index + 1))-\(example.family)-question")

            tap("round.next")
            assertReveal(guess: 4, answer: 4, points: 100, question: question)
            require(node("story.scene.\(example.id)"))
            XCTAssertFalse(app.buttons["round.choice.4"].exists, "A locked prediction must show the reveal, not editable choices.")
            screenshot("story-\(String(format: "%02d", index + 1))-\(example.family)-exact-reveal")

            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
            XCTAssertNotEqual(require(node("round.prompt")).label, question)
            XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "not selected")
            XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled)
            leaveGame()
        }
    }

    func testMismatchKeepsSceneAndContextThenClearsTheNextPrediction() {
        launch(["-ui-testing", "-story-qa", "1108"])
        let question = require(node("round.prompt")).label
        require(node("story.scene.1108"))
        tap("round.choice.1")
        tap("round.next")
        assertReveal(guess: 1, answer: 4, points: 25, question: question)
        require(node("story.scene.1108"))
        screenshot("story-07-peek-mismatch-reveal")

        tap("nav.close")
        tapAlert("exit.cancel")
        assertReveal(guess: 1, answer: 4, points: 25, question: question)
        tap("round.next")
        require(app.buttons["round.choice.1"].firstMatch)
        XCTAssertEqual(app.buttons["round.choice.1"].firstMatch.value as? String, "not selected")
        XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled)
        leaveGame()
    }

    func testResultShareAndRematchAreReachableWithoutScrolling() {
        launch(["-ui-testing", "-story-results-qa"])
        let share = require(app.buttons["result.share"].firstMatch)
        let rematch = require(app.buttons["result.rematch"].firstMatch)
        // No scroll or reveal helper runs before these assertions. Existence
        // alone would not prove that the result's primary actions are visible.
        assertFullyVisible(share)
        assertFullyVisible(rematch)
        XCTAssertTrue(share.isEnabled)
        XCTAssertTrue(rematch.isEnabled)
        XCTAssertTrue(app.staticTexts["100%"].exists)
        screenshot("story-08-result-actions-in-first-viewport")

        share.tap()
        dismissNativeShareWithoutSending()
        assertFullyVisible(require(app.buttons["result.rematch"].firstMatch))
        app.buttons["result.rematch"].firstMatch.tap()

        require(node("round.prompt"))
        require(app.buttons["round.choice.1"].firstMatch)
        XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled)
        for value in 1...5 {
            XCTAssertEqual(app.buttons["round.choice.\(value)"].firstMatch.value as? String, "not selected")
        }
        screenshot("story-09-rematch-start")
        tap("round.choice.3")
        tap("round.next")
        tap("round.choice.2")
        tap("round.back")
        XCTAssertEqual(app.buttons["round.choice.3"].firstMatch.value as? String, "selected")
        tap("nav.close")
        tapAlert("exit.cancel")
        XCTAssertEqual(app.buttons["round.choice.3"].firstMatch.value as? String, "selected")
        leaveGame()
    }

    func testLargeTextReducedEffectsPreserveStorySelectionRevealAndExit() {
        launch(["-ui-testing", "-story-qa", "1108", "-large-text", "-accessible-effects"])
        let question = require(node("round.prompt")).label
        require(node("story.scene.1108"))
        tap("round.choice.2")
        tap("round.choice.4")
        assertFullyVisible(require(app.buttons["round.next"].firstMatch))
        screenshot("story-10-large-text-selection")
        tap("round.next")
        assertReveal(guess: 4, answer: 4, points: 100, question: question)
        require(node("story.scene.1108"))
        assertFullyVisible(require(app.buttons["round.next"].firstMatch))
        screenshot("story-11-large-text-reduced-effects-reveal")
        tap("nav.close")
        tapAlert("exit.cancel")
        require(node("round.reveal"))
        leaveGame()
    }

    private func launch(_ arguments: [String]) {
        if app.state != .notRunning { app.terminate() }
        app.launchArguments = arguments
        app.launch()
    }

    private func assertReveal(guess: Int, answer: Int, points: Int, question: String,
                              file: StaticString = #filePath, line: UInt = #line) {
        let spoken = require(node("round.reveal"), file: file, line: line).label.lowercased()
        XCTAssertTrue(spoken.contains("you guessed \(guess)"), spoken, file: file, line: line)
        XCTAssertTrue(spoken.contains("alex picked \(answer)"), spoken, file: file, line: line)
        XCTAssertTrue(spoken.contains("\(points) points"), spoken, file: file, line: line)
        XCTAssertTrue(spoken.contains(question.lowercased()), "The reveal's spoken comparison must retain the actual question: \(spoken)", file: file, line: line)
    }

    private func assertFullyVisible(_ element: XCUIElement,
                                   file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.isHittable, "\(element.identifier) should be reachable without scrolling.", file: file, line: line)
        let frame = element.frame
        XCTAssertGreaterThanOrEqual(frame.height, 44, file: file, line: line)
        XCTAssertGreaterThanOrEqual(frame.minY, app.frame.minY + 20, file: file, line: line)
        XCTAssertLessThanOrEqual(frame.maxY, app.frame.maxY - 4, file: file, line: line)
    }

    private func dismissNativeShareWithoutSending() {
        let nativeClose = app.descendants(matching: .any).matching(NSPredicate(format: "(label == %@ OR identifier == %@) AND identifier != %@", "Close", "Close", "nav.close")).firstMatch
        let activityList = app.otherElements["ActivityListView"].firstMatch
        let copy = app.buttons["Copy"].firstMatch
        XCTAssertTrue(activityList.waitForExistence(timeout: 5) || nativeClose.waitForExistence(timeout: 3) || copy.waitForExistence(timeout: 3))
        let hasNativeClose = nativeClose.waitForExistence(timeout: 3) && nativeClose.isHittable
        screenshot("story-native-result-share-preview")
        if hasNativeClose { nativeClose.tap() }
        else if app.frame.height < 740 {
            // The compact Simulator's system preview exposes no Close node,
            // although the captured header has a visible X at this position.
            // Tap only that observed dismiss control, never a share destination.
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: app.frame.width - 38, dy: 58)).tap()
        } else { app.swipeDown() }
        let rematch = require(app.buttons["result.rematch"].firstMatch)
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: rematch)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed, "The native share preview should dismiss before continuing.")
    }

    private func leaveGame() {
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    private func node(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    @discardableResult
    private func require(_ element: XCUIElement,
                         file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 8), "Expected \(element) to exist.", file: file, line: line)
        return element
    }

    private func tap(_ identifier: String,
                     file: StaticString = #filePath, line: UInt = #line) {
        let query = app.buttons.matching(identifier: identifier)
        require(query.firstMatch, file: file, line: line)
        let button = query.allElementsBoundByIndex.first(where: { $0.isHittable }) ?? query.firstMatch
        revealIfNeeded(button)
        XCTAssertTrue(button.isEnabled, "\(identifier) should be enabled.", file: file, line: line)
        button.tap()
        if identifier.hasPrefix("round.choice.") {
            XCTAssertEqual(button.value as? String, "selected", file: file, line: line)
        }
    }

    private func tapAlert(_ identifier: String) {
        require(require(app.alerts.firstMatch).buttons[identifier].firstMatch).tap()
    }

    private func revealIfNeeded(_ element: XCUIElement) {
        if ["round.next", "nav.close"].contains(element.identifier), element.isHittable { return }
        let scrolls = app.scrollViews.allElementsBoundByIndex
        guard let scroll = scrolls.first(where: { $0.isHittable }) ?? scrolls.first else { return }
        for _ in 0..<8 {
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
