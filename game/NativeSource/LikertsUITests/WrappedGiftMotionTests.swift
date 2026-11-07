import XCTest

/// Candidate 1656: play through a real round without the UI-test flag that
/// suppresses motion. A local Simulator video must be reviewed independently.
@MainActor
final class WrappedGiftMotionTests: XCTestCase {
    private var app: XCUIApplication!
    private var events: [String] = []
    private var started: TimeInterval = 0

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        started = ProcessInfo.processInfo.systemUptime
        events = []
    }

    func testWrappedGiftNormalMotionPlayback() { play(reduced: false) }
    func testWrappedGiftReducedMotionEquivalent() { play(reduced: true) }

    private func play(reduced: Bool) {
        app.launchArguments = ["-motion-qa", "1656"] + (reduced ? ["-motion-reduced-qa"] : [])
        event("launch \(app.launchArguments.joined(separator: " "))")
        app.launch()
        let prompt = node("round.prompt")
        XCTAssertTrue(prompt.waitForExistence(timeout: 12))
        let question = prompt.label
        XCTAssertTrue(question.contains("wrapping"), question)
        XCTAssertTrue(node("story.scene.1656").waitForExistence(timeout: 8))
        attach("gift-\(reduced ? "reduced" : "normal")-question")
        event("question visible")
        let choice = app.buttons["round.choice.4"].firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 8)); choice.tap()
        event("choice 4; neutral acknowledgment")
        let next = app.buttons["round.next"].firstMatch
        XCTAssertTrue(next.waitForExistence(timeout: 8)); next.tap()
        event("lock")
        let reveal = node("round.reveal")
        XCTAssertTrue(reveal.waitForExistence(timeout: 8))
        let spoken = reveal.label.lowercased()
        XCTAssertTrue(spoken.contains("you guessed 4") && spoken.contains("alex picked 4") && spoken.contains("100 points"), spoken)
        XCTAssertTrue(node("story.scene.1656").waitForExistence(timeout: 8))
        let wait = expectation(description: "Allow reveal and scored reaction to settle")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { wait.fulfill() }
        waitForExpectations(timeout: 5)
        event("settled")
        attach("gift-\(reduced ? "reduced" : "normal")-reveal")
        next.tap()
        XCTAssertTrue(app.buttons["round.choice.1"].firstMatch.waitForExistence(timeout: 8))
        let log = XCTAttachment(string: events.joined(separator: "\n"))
        log.name = "gift-1656-\(reduced ? "reduced" : "normal")-events"
        log.lifetime = .keepAlways
        add(log)
    }
    private func node(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }
    private func event(_ message: String) {
        events.append(String(format: "%.3fs\t%@\t%@", ProcessInfo.processInfo.systemUptime-started,
                             ISO8601DateFormatter().string(from: Date()), message))
    }
    private func attach(_ name: String) {
        let item = XCTAttachment(screenshot: app.screenshot())
        item.name = name; item.lifetime = .keepAlways; add(item)
    }
}
