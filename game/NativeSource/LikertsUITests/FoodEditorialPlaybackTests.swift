import XCTest

/// Native functional playback of two authored food stills; recording and human
/// inspection remain separate acceptance steps. No live messages are sent.
@MainActor
final class FoodEditorialPlaybackTests: XCTestCase {
    private var app: XCUIApplication!
    private var events: [String] = []
    private var started: TimeInterval = 0
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        started = ProcessInfo.processInfo.systemUptime
        events = []
    }
    func testIceCreamStillNormal() { play(1004, reduced: false) }
    func testIceCreamStillReduced() { play(1004, reduced: true) }
    func testFruitStickerStillNormal() { play(1038, reduced: false) }
    func testFruitStickerStillReduced() { play(1038, reduced: true) }
    private func play(_ id: Int, reduced: Bool) {
        app.launchArguments = ["-motion-qa", String(id)] + (reduced ? ["-motion-reduced-qa"] : [])
        event("launch \(id) reduced=\(reduced)"); app.launch()
        let prompt = node("round.prompt")
        XCTAssertTrue(prompt.waitForExistence(timeout: 12))
        XCTAssertTrue(node("story.scene.\(id)").waitForExistence(timeout: 8))
        attach("food-\(id)-\(reduced ? "reduced" : "normal")-question")
        event("question visible")
        let choice = app.buttons["round.choice.4"].firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 8)); choice.tap(); event("neutral choice")
        XCTAssertFalse(node("round.reveal").exists, "Do not reveal prior to lock")
        let next = app.buttons["round.next"].firstMatch
        XCTAssertTrue(next.waitForExistence(timeout: 8)); next.tap(); event("lock")
        let reveal = node("round.reveal")
        XCTAssertTrue(reveal.waitForExistence(timeout: 8))
        let spoken = reveal.label.lowercased()
        XCTAssertTrue(spoken.contains("you guessed 4") && spoken.contains("alex picked 4") && spoken.contains("100 points"), spoken)
        XCTAssertTrue(node("story.scene.\(id)").waitForExistence(timeout: 8))
        let dwell = expectation(description: "Observe scored reveal")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { dwell.fulfill() }
        waitForExpectations(timeout: 4); event("settled")
        attach("food-\(id)-\(reduced ? "reduced" : "normal")-reveal")
        next.tap(); XCTAssertTrue(app.buttons["round.choice.1"].firstMatch.waitForExistence(timeout: 8))
        let item = XCTAttachment(string: events.joined(separator: "\n"))
        item.name = "food-\(id)-\(reduced ? "reduced" : "normal")-events"
        item.lifetime = .keepAlways; add(item)
    }
    private func node(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    private func event(_ s: String) { events.append(String(format: "%.3fs\t%@\t%@", ProcessInfo.processInfo.systemUptime-started, ISO8601DateFormatter().string(from: Date()), s)) }
    private func attach(_ s: String) { let item = XCTAttachment(screenshot: app.screenshot()); item.name=s; item.lifetime = .keepAlways; add(item) }
}
