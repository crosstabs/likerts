import XCTest

/// Exercises the actual game UI around new complete illustrations. Visual
/// review of the attachments remains separate from functional assertions.
@MainActor final class EditorialTableauPlaybackTests: XCTestCase {
    func testNormalIllustrationsRetainSceneThroughScoredReveal() {
        play([1284, 1291, 1783], reduced: false)
    }
    func testReducedIllustrationsRemainUsefulAndAdvance() {
        play([1074, 1768], reduced: true)
    }
    func testDefiningDetailsAndControlsRemainUsefulAtLargerText() {
        play([1152, 1490, 1566, 1953], reduced: true, largeText: true)
    }
    func testRepairedPaintbrushRetainsContextThroughReveal() {
        play([1313], reduced: false)
        play([1313], reduced: true)
    }
    func testCollisionRepairsKeepChoicesPrivateAndAdvance() {
        play([1096, 1680, 1871, 1997], reduced: false)
        play([1781, 1934], reduced: true)
    }
    func testFinalCollisionPolishKeepsControlsAndScoredReveal() {
        play([1549, 1680, 1990], reduced: false)
        play([1096, 1148, 1782], reduced: true)
    }
    private func play(_ ids: [Int], reduced: Bool, largeText: Bool = false) {
        continueAfterFailure = false
        let app = XCUIApplication()
        for id in ids {
            app.terminate()
            app.launchArguments = ["-motion-qa", String(id)] + (reduced ? ["-motion-reduced-qa"] : [])
            // TestingTextSize intentionally honors size overrides only in the
            // test namespace. Normal-motion cases above omit this flag.
            if largeText { app.launchArguments += ["-ui-testing", "-large-text"] }
            app.launch()
            let scene = node(app, "story.scene.\(id)")
            XCTAssertTrue(scene.waitForExistence(timeout: 12))
            if largeText {
                XCTAssertFalse(app.staticTexts["CURATED"].exists, "The normal-size topic strip must be replaced by the accessible flow")
                scrollToVisible(scene, app: app)
            }
            attach(app, "editorial-\(id)-\(largeText ? "large-text" : reduced ? "reduced" : "normal")-question")
            let choice = app.buttons["round.choice.4"].firstMatch
            XCTAssertTrue(choice.waitForExistence(timeout: 8)); scrollToVisible(choice, app: app); choice.tap()
            XCTAssertFalse(node(app, "round.reveal").exists)
            let next = app.buttons["round.next"].firstMatch
            scrollToVisible(next, app: app); XCTAssertTrue(next.isHittable); next.tap()
            let reveal = node(app, "round.reveal")
            XCTAssertTrue(reveal.waitForExistence(timeout: 8))
            XCTAssertTrue(reveal.label.lowercased().contains("100 points"))
            XCTAssertTrue(scene.exists)
            let pause = expectation(description: "Observe actual reveal without disabling animations")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { pause.fulfill() }
            waitForExpectations(timeout: 4)
            if largeText { scrollToVisible(scene, app: app) }
            attach(app, "editorial-\(id)-\(largeText ? "large-text" : reduced ? "reduced" : "normal")-reveal")
            scrollToVisible(next, app: app)
            next.tap()
            XCTAssertTrue(app.buttons["round.choice.1"].firstMatch.waitForExistence(timeout: 8))
        }
    }
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }
    private func scrollToVisible(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<9 {
            if element.isHittable { return }
            if element.frame.midY < app.frame.midY { app.swipeDown() }
            else { app.swipeUp() }
        }
        XCTAssertTrue(element.isHittable, "A player must be able to scroll to the control or illustration")
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
