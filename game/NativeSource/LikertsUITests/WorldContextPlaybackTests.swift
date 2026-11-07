import XCTest

/// Provisional scenes: functional checks and recorded playback are separate
/// from per-scene visual approval. No global animation suppression is used.
@MainActor final class WorldContextPlaybackTests: XCTestCase {
    private var app: XCUIApplication!
    private var events: [String] = []
    private var started: TimeInterval = 0
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication(); started = ProcessInfo.processInfo.systemUptime
    }
    func testSevenNormalContexts() { play(ids: [1158,1215,1704,1709,1725,1908,1976], reduced: false) }
    func testRepresentativeReducedContexts() { play(ids: [1158,1908], reduced: true) }
    private func play(ids: [Int], reduced: Bool) {
        defer {
            let attachment = XCTAttachment(string: events.joined(separator: "\n"))
            attachment.name = "world-context-\(reduced ? "reduced" : "normal")-events"
            attachment.lifetime = .keepAlways; add(attachment)
        }
        for id in ids {
            app.terminate()
            app.launchArguments = ["-motion-qa", String(id)] + (reduced ? ["-motion-reduced-qa"] : [])
            event("\(id) launch"); app.launch()
            let question = node("round.prompt")
            XCTAssertTrue(question.waitForExistence(timeout: 12), "Question \(id)")
            XCTAssertTrue(node("story.scene.\(id)").waitForExistence(timeout: 8), "Scene \(id)")
            event("\(id) question")
            let choice = app.buttons["round.choice.4"].firstMatch
            XCTAssertTrue(choice.waitForExistence(timeout: 8)); choice.tap()
            event("\(id) choice"); let next = app.buttons["round.next"].firstMatch
            XCTAssertTrue(next.waitForExistence(timeout: 8)); next.tap(); event("\(id) lock")
            let reveal = node("round.reveal")
            XCTAssertTrue(reveal.waitForExistence(timeout: 8))
            let label = reveal.label.lowercased()
            XCTAssertTrue(label.contains("you guessed 4") && label.contains("alex picked 4") && label.contains("100 points"), label)
            XCTAssertTrue(node("story.scene.\(id)").waitForExistence(timeout: 8))
            let wait = expectation(description: "Allow scene and score reaction to settle")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { wait.fulfill() }
            waitForExpectations(timeout: 5); event("\(id) settled")
            let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "world-context-\(id)-\(reduced ? "reduced" : "normal")"; shot.lifetime = .keepAlways; add(shot)
            next.tap(); XCTAssertTrue(app.buttons["round.choice.1"].firstMatch.waitForExistence(timeout: 8))
        }
    }
    private func node(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    private func event(_ message: String) {
        events.append(String(format: "%.3fs\t%@\t%@", ProcessInfo.processInfo.systemUptime-started, ISO8601DateFormatter().string(from: Date()), message))
    }
}
