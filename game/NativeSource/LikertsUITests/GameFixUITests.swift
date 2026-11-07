import XCTest

@MainActor final class GameFixUITests: XCTestCase {
    private var app = XCUIApplication()
    private let code = "LK3-eyJhbnN3ZXJzIjpbMSwyLDMsNCw1XSwiY2F0YWxvZ1ZlcnNpb24iOjEsIm5hbWUiOiJBbGV4IiwicHJvbXB0SURzIjpbMTAwMSwxLDIsMyw0XSwidmVyc2lvbiI6M33tXQ"
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws {
        app.terminate(); app.launchArguments = ["-ui-testing", "-content-safety-reset"]; app.launch(); app.terminate()
        XCUIDevice.shared.orientation = .portrait
    }
    func testDailyCardAndActionAgreeAcrossRolloverWhileExistingGameKeepsItsDate() {
        app.launchArguments = ["-ui-testing", "-daily-clock-testing"]; app.launch()
        let card = require(app.buttons["home.daily"])
        let firstDate = card.value as? String
        tap("home.daily")
        let identity = require(app.staticTexts["daily.identity"]).label
        let oldDate = require(app.staticTexts["daily.date"]).label
        XCTAssertTrue(oldDate.contains(firstDate ?? "missing"))
        tap("daily.testAdvance")
        XCTAssertEqual(app.staticTexts["daily.identity"].label, identity)
        XCTAssertEqual(app.staticTexts["daily.date"].label, oldDate)
        screenshot("daily-existing-game-keeps-date")
        tap("nav.close")
        let refreshed = require(app.buttons["home.daily"])
        let secondDate = refreshed.value as? String
        XCTAssertNotEqual(firstDate, secondDate)
        let displayed = refreshed.label
        tap("home.daily")
        let nextIdentity = require(app.staticTexts["daily.identity"]).label
        let name = nextIdentity.replacingOccurrences(of: "Meet ", with: "").replacingOccurrences(of: ".", with: "")
        XCTAssertTrue(displayed.contains(name))
        XCTAssertTrue(require(app.staticTexts["daily.date"]).label.contains(secondDate ?? "missing"))
        screenshot("daily-refreshed-card-opens-matching-character")
    }
    func testLocalHideCancelConfirmRejectReimportAndClearRecovery() {
        app.launchArguments = ["-ui-testing", "-content-safety-reset"]; app.launch()
        importChallenge()
        for value in 1...5 {
            let choice = require(app.buttons["round.choice.\(value)"])
            XCTAssertGreaterThanOrEqual(choice.frame.width, 44); XCTAssertGreaterThanOrEqual(choice.frame.height, 44)
        }
        screenshot("topic-normal-larger-choice-ordinals")
        tap("round.choice.4")
        tap("content.options")
        let cancel = app.buttons["Keep playing"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 4)); cancel.tap()
        XCTAssertEqual(app.buttons["round.choice.4"].value as? String, "selected")
        tap("content.options")
        tap("content.hide")
        require(app.buttons["home.makeChallenge"])
        importChallenge(expectPlay: false)
        let message = app.staticTexts["join.error"].firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        XCTAssertTrue(message.label.contains("hidden here")); XCTAssertTrue(message.label.contains("No report was sent"))
        XCTAssertFalse(app.buttons["round.choice.1"].exists)
        screenshot("hidden-import-explains-local-only")
        tap("nav.close"); tap("home.settings")
        tap("settings.clearHidden")
        let clear = app.buttons["Clear hidden list"].firstMatch
        XCTAssertTrue(clear.waitForExistence(timeout: 5)); clear.tap()
        tap("nav.close")
        importChallenge()
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "round.reveal").firstMatch.exists)
    }
    func testLargestTextContentControlsChoiceAndRevealRemainReachable() {
        app.launchArguments = ["-ui-testing", "-content-safety-reset", "-topic-qa", "snacks", "-largest-text", "-accessible-effects"]; app.launch()
        tap("content.options")
        screenshot("content-options-largest-text")
        let cancel = app.buttons["Keep playing"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 5)); cancel.tap()
        tap("round.choice.4")
        XCTAssertEqual(app.buttons["round.choice.4"].value as? String, "selected")
        screenshot("topic-largest-text-choice-controls")
        tap("round.next")
        XCTAssertTrue(require(app.descendants(matching: .any).matching(identifier: "round.reveal").firstMatch).label.lowercased().contains("you guessed 4"))
        screenshot("topic-largest-text-reveal-controls")
    }
    private func importChallenge(expectPlay: Bool = true) {
        tap("home.join")
        let field = require(app.descendants(matching: .any).matching(identifier: "join.code").firstMatch)
        field.tap(); field.typeText(code)
        let done = app.buttons["join.done"].firstMatch
        if done.exists { done.tap() }
        tap("join.play")
        if expectPlay { require(app.buttons["round.choice.1"]); XCTAssertFalse(app.staticTexts["round.reveal"].exists) }
    }
    @discardableResult private func require(_ value: XCUIElement) -> XCUIElement {
        XCTAssertTrue(value.exists || value.waitForExistence(timeout: 8)); return value
    }
    private func tap(_ id: String) {
        let value = require(app.buttons[id].firstMatch)
        for _ in 0..<35 {
            let scrolls = app.scrollViews.allElementsBoundByIndex
            let containing = scrolls.last { $0.descendants(matching: .any).matching(identifier: id).count > 0 }
            if containing == nil && value.isHittable && app.frame.contains(value.frame) { break }
            let scroll = containing ?? scrolls.last
            guard let scroll else { break }
            var viewport = scroll.frame.intersection(app.frame).insetBy(dx: 0, dy: 14)
            // SwiftUI may call a choice behind the fixed CTA hittable. Only
            // tap a wholly visible choice above that dock, and start gestures
            // in the content margin rather than on the action itself.
            if id.hasPrefix("round.choice."), app.buttons["round.next"].firstMatch.exists {
                let bottom = min(viewport.maxY, app.buttons["round.next"].firstMatch.frame.minY - 12)
                viewport.size.height = max(0, bottom - viewport.minY)
            }
            if value.isHittable && viewport.contains(value.frame) { break }
            let down = value.frame.midY < viewport.midY
            let startY = viewport.minY + viewport.height * (down ? 0.35 : 0.75)
            let endY = viewport.minY + viewport.height * (down ? 0.60 : 0.45)
            let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: viewport.maxX - 8, dy: startY))
            let end = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: viewport.maxX - 8, dy: endY))
            start.press(forDuration: 0.01, thenDragTo: end)
        }
        XCTAssertTrue(value.isHittable, "\(id) must be reachable"); value.tap()
    }
    private func screenshot(_ name: String) {
        let value = XCTAttachment(screenshot: app.screenshot()); value.name = name; value.lifetime = .keepAlways; add(value)
    }
}
