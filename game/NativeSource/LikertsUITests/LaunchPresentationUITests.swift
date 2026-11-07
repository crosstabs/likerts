import XCTest

/// Real offline journeys for launch presentation. No seeded scores, network
/// calls, Messages insertion or outgoing sharing. Attachments are native pixels.
@MainActor final class LaunchPresentationUITests: XCTestCase {
    private var app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { app.terminate() }

    func testNamedFirstGameInviteReturnAndResult() {
        launch()
        screenshot("launch-home")
        tap("home.customize")
        let field = require(app.textFields["setup.name"])
        field.tap(); field.typeText("Alex")
        tap("setup.start")
        let answers = [1, 2, 3, 4, 5]
        var prompts: [String] = []
        for (index, answer) in answers.enumerated() {
            prompts.append(require(node("round.prompt")).label)
            tap("round.choice.\(answer)")
            screenshot("launch-answer-\(index + 1)")
            tap("round.next")
        }
        tap("handoff.share")
        let code = require(app.staticTexts["share.code"]).label
        XCTAssertTrue(code.hasPrefix("LK3-"))
        screenshot("launch-invite")
        tap("share.copy")
        XCTAssertTrue(require(app.buttons["share.copy"]).label.contains("Copied"))
        tap("nav.close")
        screenshot("launch-handoff")
        tap("nav.close"); tapAlert("exit.confirm", fallback: "Leave game")
        tap("home.join")
        screenshot("launch-join")
        let input = require(node("join.code")); input.tap(); input.typeText(code)
        if app.buttons["join.done"].exists { tap("join.done") }
        tap("join.play")
        for (index, guess) in answers.enumerated() {
            XCTAssertEqual(require(node("round.prompt")).label, prompts[index])
            tap("round.choice.\(guess)"); tap("round.next")
            let reveal = require(node("round.reveal")).label.lowercased()
            XCTAssertTrue(reveal.contains("you guessed \(guess)"))
            XCTAssertTrue(reveal.contains("picked \(guess)"))
            screenshot("launch-reveal-\(index + 1)")
            tap("round.next")
        }
        XCTAssertTrue(require(app.staticTexts["100%"]).exists)
        screenshot("launch-result")
        tap("result.rematch")
        tap("round.choice.4")
        tap("nav.close"); tapAlert("exit.cancel", fallback: "Keep playing")
        XCTAssertEqual(app.buttons["round.choice.4"].value as? String, "selected")
        tap("nav.close"); tapAlert("exit.confirm", fallback: "Leave game")
        XCTAssertTrue(require(app.buttons["home.makeChallenge"]).exists)
    }

    func testTopicDailyAndHandpickedPresentation() {
        launch()
        tap("home.topics")
        require(app.buttons["topics.mix"])
        screenshot("launch-topics")
        tap("nav.close")
        tap("home.daily")
        let date = require(app.staticTexts["daily.date"]).label
        XCTAssertTrue(date.contains("midnight UTC"))
        screenshot("launch-daily-character")
        tap("daily.start"); tap("round.choice.4")
        screenshot("launch-daily-clue")
        tap("nav.close"); tapAlert("exit.confirm", fallback: "Leave game")
        tap("home.fresh"); tap("fresh.authored")
        XCTAssertTrue(require(app.staticTexts["fresh.source"]).label.contains("Handpicked by Likerts"))
        screenshot("launch-handpicked-preview")
    }

    func testLocalPartyWithThreeRealCompletedTurns() {
        launch(); tap("home.party")
        let host = require(app.textFields["party.hostName"]); host.tap(); host.typeText("Alex")
        tap("party.beginHost")
        for answer in [1, 2, 3, 4, 5] { tap("round.choice.\(answer)"); tap("round.next") }
        for (index, name) in ["Sam", "Riley", "Jo"].enumerated() {
            if index > 0 { tap("party.addFriend") }
            let friend = require(app.textFields["party.friendName"]); friend.tap(); friend.typeText(name)
            tap("party.beginFriend")
            let guesses = [[1, 2, 3, 4, 5], [1, 3, 3, 3, 5], [5, 4, 3, 2, 1]][index]
            for guess in guesses {
                XCTAssertFalse(node("round.reveal").exists)
                tap("round.choice.\(guess)"); tap("round.next")
            }
            XCTAssertFalse(node("party.board").exists)
            tap("party.handBack")
            require(node("party.board"))
        }
        XCTAssertTrue(require(node("party.count")).label.contains("3 completed friends"))
        screenshot("launch-party-board")
    }

    func testLargeTextFirstSessionSettingsAndRound() {
        launch(large: true)
        screenshot("launch-large-home")
        tap("home.settings")
        require(node("settings.privacy"))
        screenshot("launch-large-settings")
        tap("nav.close"); tap("home.makeChallenge")
        let choice = require(app.buttons["round.choice.5"])
        reveal(choice); choice.tap()
        XCTAssertEqual(choice.value as? String, "selected")
        screenshot("launch-large-round")
        tap("nav.close"); tapAlert("exit.cancel", fallback: "Keep playing")
        XCTAssertEqual(choice.value as? String, "selected")
        tap("nav.close"); tapAlert("exit.confirm", fallback: "Leave game")
    }

    func testCleanNativeTopicAndPreviewCaptures() {
        launch()
        openHomeCardWithoutOverscrolling("home.topics")
        require(app.buttons["topics.mix"])
        screenshot("launch-clean-topics")
        tap("nav.close")
        // Return the actual Home scroll to its top before opening the visible
        // part of Fresh. A full-card scroll can put Home text behind the
        // native sheet's translucent status area.
        let scroll = app.scrollViews.firstMatch
        if scroll.exists {
            scroll.swipeDown(); scroll.swipeDown()
        }
        openHomeCardWithoutOverscrolling("home.fresh")
        tap("fresh.authored")
        XCTAssertTrue(require(app.staticTexts["fresh.source"]).label.contains("Handpicked by Likerts"))
        screenshot("launch-clean-handpicked-preview")
    }

    private func launch(large: Bool = false) {
        app.launchArguments = ["-ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if large { app.launchArguments += ["-large-text", "-accessible-effects"] }
        app.launch(); require(app.buttons["home.makeChallenge"])
    }
    private func openHomeCardWithoutOverscrolling(_ identifier: String) {
        let card = require(app.buttons[identifier])
        let visible = card.frame.intersection(app.frame.insetBy(dx: 12, dy: 75))
        if visible.height >= 24 {
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: visible.midX, dy: visible.minY + min(24, visible.height / 2))).tap()
        } else { tap(identifier) }
    }
    private func node(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    @discardableResult private func require(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 10), "Expected \(element)", file: file, line: line)
        return element
    }
    private func reveal(_ element: XCUIElement) {
        let scrolls = app.scrollViews.allElementsBoundByIndex
        let containing = scrolls.last { $0.descendants(matching: .any).matching(identifier: element.identifier).count > 0 }
        if containing == nil, element.isHittable, app.frame.contains(element.frame) { return }
        guard let scroll = containing ?? scrolls.last(where: \.isHittable) else { return }
        for _ in 0..<20 {
            let frame = element.frame
            let top = max(scroll.frame.minY, app.frame.minY + 20)
            var bottom = min(scroll.frame.maxY, app.frame.maxY - 12)
            if element.identifier.hasPrefix("round.choice.") {
                let next = app.buttons["round.next"].firstMatch
                if next.exists { bottom = min(bottom, next.frame.minY - 12) }
            }
            if element.isHittable, frame.minY >= top, frame.maxY <= bottom { return }
            let up = frame.midY >= (top + bottom) / 2
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: up ? 0.70 : 0.35))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: up ? 0.45 : 0.60))
            start.press(forDuration: 0.01, thenDragTo: end)
        }
    }
    private func tap(_ id: String, file: StaticString = #filePath, line: UInt = #line) {
        require(app.buttons.matching(identifier: id).firstMatch, file: file, line: line)
        let matches = app.buttons.matching(identifier: id).allElementsBoundByIndex
        let element = matches.last(where: \.isHittable) ?? matches.last!
        reveal(element); XCTAssertTrue(element.isEnabled, file: file, line: line); element.tap()
    }
    private func tapAlert(_ id: String, fallback: String) {
        let alert = require(app.alerts.firstMatch)
        (alert.buttons[id].firstMatch.exists ? alert.buttons[id].firstMatch : alert.buttons[fallback].firstMatch).tap()
    }
    private func screenshot(_ name: String) {
        // Native sheet transitions can expose final controls before UIKit's
        // presentation transform finishes. Capture the settled UI.
        Thread.sleep(forTimeInterval: 1)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
