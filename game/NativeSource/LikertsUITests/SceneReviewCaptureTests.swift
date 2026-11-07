import XCTest

/// Captures actual bundled scene rendering for human editorial review. A pass
/// means only that pages were captured, never that their contents were approved.
@MainActor final class SceneReviewCaptureTests: XCTestCase {
    private func capture(_ topic: String) {
        for phase in ["question", "reveal"] {
            let app = XCUIApplication()
            app.launchArguments = ["-ui-testing", "-scene-review", "-scene-review-baseline", "-scene-review-topic", topic, "-scene-review-phase", phase]
            app.launch()
            let page = app.staticTexts["review.page"].firstMatch
            XCTAssertTrue(page.waitForExistence(timeout: 15), "Review harness should load the bundled catalogue")
            guard page.exists else { app.terminate(); return }
            XCTAssertFalse(app.staticTexts["review.empty"].exists, "The selected topic must expose its expected fallback records")
            let next = app.buttons["review.next"].firstMatch
            XCTAssertTrue(next.exists, "Review pagination must be present")
            guard next.exists else { app.terminate(); return }
            for index in 0..<14 {
                let attachment = XCTAttachment(screenshot: app.screenshot())
                attachment.name = "scene-review-\(topic)-\(phase)-\(index + 1)-\(page.label)"
                attachment.lifetime = .keepAlways
                add(attachment)
                guard next.isEnabled else { break }
                next.tap()
                if index == 13 { XCTFail("Review pagination exceeded expected topic size") }
            }
            app.terminate()
        }
    }
    func testSnacks() { capture("snacks") }
    func testKitchen() { capture("kitchen") }
    func testMornings() { capture("mornings") }
    func testHome() { capture("home") }
    func testHobbies() { capture("hobbies") }
    func testMaking() { capture("making") }
    func testMusic() { capture("music") }
    func testMovies() { capture("movies") }
    func testBooks() { capture("books") }
    func testGames() { capture("games") }
    func testPets() { capture("pets") }
    func testOutdoors() { capture("outdoors") }
    func testTravel() { capture("travel") }
    func testWeather() { capture("weather") }
    func testStyle() { capture("style") }
    func testCelebrations() { capture("celebrations") }
    func testSocial() { capture("social") }
    func testTinyAdventures() { capture("tinyadventures") }
    func testFantasy() { capture("fantasy") }
    func testFuture() { capture("future") }
}
