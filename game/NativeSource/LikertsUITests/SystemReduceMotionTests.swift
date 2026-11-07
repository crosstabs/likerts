import XCTest

@MainActor
final class SystemReduceMotionTests: XCTestCase {
    func testActualSystemReduceMotionCompletesSnackReveal() throws {
        continueAfterFailure = true
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launch()
        let accessibility = settings.buttons["Accessibility"].firstMatch
        for _ in 0..<6 { settings.swipeDown() }
        for _ in 0..<6 where !accessibility.exists { settings.swipeUp() }
        XCTAssertTrue(accessibility.waitForExistence(timeout: 5), "Settings must expose Accessibility")
        guard accessibility.exists else { return }
        accessibility.tap()
        let motion = settings.buttons["Motion"].firstMatch
        for _ in 0..<4 where !motion.exists { settings.swipeUp() }
        XCTAssertTrue(motion.waitForExistence(timeout: 5), "Accessibility must expose Motion")
        guard motion.exists else { return }
        motion.tap()
        let reduce = settings.switches["Reduce Motion"].firstMatch
        XCTAssertTrue(reduce.waitForExistence(timeout: 5), "Motion must expose Reduce Motion")
        guard reduce.exists, let original = reduce.value as? String, ["0", "1"].contains(original) else {
            XCTFail("Could not read the original system switch value."); return
        }
        defer {
            settings.activate()
            if reduce.waitForExistence(timeout: 5), let current = reduce.value as? String, current != original {
                reduce.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
                XCTAssertEqual(reduce.value as? String, original, "Restore original Simulator setting")
            }
        }
        if original == "0" { reduce.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap() }
        XCTAssertEqual(reduce.value as? String, "1")

        let app = XCUIApplication()
        // No -ui-testing, -accessible-effects or -motion-reduced-qa override.
        app.launchArguments = ["-story-qa", "1001", "-motion-system-probe"]
        app.launch()
        let scene = app.descendants(matching: .any)["story.scene.1001"].firstMatch
        XCTAssertTrue(scene.waitForExistence(timeout: 10))
        XCTAssertEqual(scene.value as? String, "system-reduce-motion-on", "App must receive the actual system setting")
        app.buttons["round.choice.4"].tap()
        app.buttons["round.next"].tap()
        let reveal = app.descendants(matching: .any)["round.reveal"].firstMatch
        XCTAssertTrue(reveal.waitForExistence(timeout: 5))
        XCTAssertTrue(reveal.label.contains("100 points"))
        let finalScene = app.descendants(matching: .any)["story.scene.1001"].firstMatch
        XCTAssertTrue(finalScene.waitForExistence(timeout: 5))
        XCTAssertEqual(finalScene.value as? String, "system-reduce-motion-on")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "actual-system-reduce-motion-reveal"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
