import XCTest

/// The authored route stays prominent and every take can be reviewed before
/// a pack starts. These checks use the visible app, not a generation stub.
@MainActor
final class FreshExperienceUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()
    }

    func testHandpickedPackPreviewsAllFiveBeforePlay() {
        tap("home.fresh")
        let authored = require(app.buttons["fresh.authored"].firstMatch)
        let generated = app.buttons["fresh.generate"].firstMatch
        if generated.exists {
            XCTAssertLessThan(authored.frame.minY, generated.frame.minY,
                              "The handpicked choice should precede optional AI.")
        }
        tap("fresh.theme.foodTakes")
        reveal(authored)
        authored.tap()
        XCTAssertTrue(require(app.staticTexts["fresh.source"].firstMatch).label.contains("Handpicked by Likerts"))
        for index in 1...5 {
            let statement = require(app.staticTexts["fresh.preview.\(index)"].firstMatch)
            reveal(statement)
            XCTAssertTrue(statement.isHittable, "Take \(index) should be readable by scrolling.")
            XCTAssertFalse(statement.label.isEmpty)
        }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "handpicked-five-take-preview"
        attachment.lifetime = .keepAlways
        add(attachment)
        tap("fresh.play")
        XCTAssertTrue(require(app.buttons["round.choice.1"].firstMatch).exists)
    }

    func testSettingsExplainLocalProgressAndChallengePrivacy() {
        tap("home.settings")
        let local = require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "answers and results, are saved locally")).firstMatch)
        reveal(local)
        XCTAssertTrue(local.isHittable)
        let sharing = require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "encoded, not encrypted")).firstMatch)
        reveal(sharing)
        XCTAssertTrue(sharing.isHittable)
        let ai = require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "On-device AI is optional")).firstMatch)
        reveal(ai)
        XCTAssertTrue(ai.isHittable)
    }

    /// Run on a compact Simulator with accessibility-size text. The optional
    /// model is not invoked; the test checks that its description and the
    /// complete authored preview remain reachable through the real UI.
    func testCompactLargeTextFreshPreviewAndPrivacy() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-large-text", "-accessible-effects"]
        app.launch()
        tap("home.fresh")

        let aiHeading = require(app.staticTexts["Or try on-device AI"].firstMatch)
        reveal(aiHeading)
        XCTAssertTrue(aiHeading.isHittable, "The optional AI section should be reachable")
        let availability = require(app.staticTexts["fresh.availability"].firstMatch)
        reveal(availability)
        XCTAssertTrue(availability.isHittable)
        screenshot("fresh-compact-large-text-ai")

        let authored = require(app.buttons["fresh.authored"].firstMatch)
        reveal(authored)
        XCTAssertTrue(authored.isHittable)
        authored.tap()
        XCTAssertTrue(require(app.staticTexts["fresh.source"].firstMatch).label.contains("Handpicked by Likerts"))
        for index in 1...5 {
            let statement = require(app.staticTexts["fresh.preview.\(index)"].firstMatch)
            reveal(statement)
            XCTAssertTrue(statement.isHittable, "Take \(index) should be reachable at larger text sizes")
            XCTAssertFalse(statement.label.isEmpty)
        }
        screenshot("fresh-compact-large-text-fifth-take")
        tap("nav.close")

        tap("home.settings")
        let privacy = require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "nickname, answers and results")).firstMatch)
        reveal(privacy)
        XCTAssertTrue(privacy.isHittable, "The local-save privacy text should be reachable")
        screenshot("settings-compact-large-text-privacy")
        let sharing = require(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "encoded, not encrypted")).firstMatch)
        reveal(sharing)
        XCTAssertTrue(sharing.isHittable, "The challenge privacy text should be reachable")
        screenshot("settings-compact-large-text-sharing")
    }

    @discardableResult private func require(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 8), "Expected \(element)", file: file, line: line)
        return element
    }
    private func tap(_ id: String) {
        let element = require(app.buttons[id].firstMatch)
        reveal(element)
        XCTAssertTrue(element.isHittable, "\(id) should be reachable")
        element.tap()
    }
    private func reveal(_ element: XCUIElement) {
        for _ in 0..<32 {
            let scrolls = app.scrollViews.allElementsBoundByIndex
            let containing = scrolls.last { scroll in !element.identifier.isEmpty && scroll.descendants(matching: .any).matching(identifier: element.identifier).count > 0 }
            guard let scroll = containing ?? scrolls.last(where: { $0.isHittable }) ?? scrolls.last else { return }
            let top = max(scroll.frame.minY, app.frame.minY + 20)
            let bottom = min(scroll.frame.maxY, app.frame.maxY - 12)
            let frame = element.frame
            if element.isHittable && frame.minY >= top && frame.maxY <= bottom { return }
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: frame.minY < top ? 0.40 : 0.60))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: frame.minY < top ? 0.60 : 0.40))
            start.press(forDuration: 0.01, thenDragTo: end)
        }
    }
    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
