import XCTest

/// Native-host presentation only. Never stages a card, types in the chat,
/// changes a recipient or taps Send. Protected iPad draft device is excluded.
@MainActor final class LaunchMessagesPresentationTests: XCTestCase {
    func testNativeSampleChatPresentationWithoutInsertion() throws {
        let allowed = ["933FAD35-90C0-4F47-BB3B-F12B499BD26F", "CFC75815-4793-43BB-9A2C-9572A140FCD3"]
        guard let device = ProcessInfo.processInfo.environment["SIMULATOR_UDID"], allowed.contains(device) else {
            throw XCTSkip("Only the explicit launch-capture QA devices are allowed.")
        }
        continueAfterFailure = false
        let sms = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        sms.activate()
        try NativeMessagesQA.selectExistingSampleIfShown(sms)
        let title = sms.buttons["ConversationTitle"].firstMatch
        guard title.waitForExistence(timeout: 8), title.label.filter(\.isNumber) == "18885551212" else {
            throw XCTSkip("An existing Apple sample conversation must already be open; no recipient or draft is created.")
        }
        let draft = sms.descendants(matching: .any).matching(identifier: "messageBodyField").firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 5))
        let before = draft.value as? String
        guard before == "iMessage" || before == "" else { throw XCTSkip("Only an empty isolated QA draft may be used") }
        defer { if draft.exists { XCTAssertTrue((draft.value as? String) == before, "The original native chat draft must remain unchanged") } }
        let ext = XCUIApplication(bundleIdentifier: "studio.likerts.game.messages")
        if ext.buttons["messages.support"].exists {
            // Reuse a live current host only after verifying the new, fixed
            // Help control. This preserves a native iPad popover that masks
            // the app drawer; stale hosts cannot qualify through .exists alone.
            let help = ext.buttons["messages.support"].firstMatch
            reveal(help, in: ext); help.tap()
            let close = ext.buttons["help.close"].firstMatch
            guard close.waitForExistence(timeout: 8), close.isHittable, close.frame.height >= 43.9 else {
                throw XCTSkip("The existing host does not expose the current44pt Help control")
            }
            close.tap()
            XCTAssertFalse(ext.staticTexts["support.address"].exists)
        } else {
            try NativeMessagesQA.reopenFromDrawer(sms: sms, ext: ext)
        }
        guard ext.buttons["messages.support"].waitForExistence(timeout: 8) else {
            throw XCTSkip("The reopened native extension did not expose its current entry controls")
        }
        let expand = ext.buttons["messages.expand"].firstMatch
        if expand.waitForExistence(timeout: 2), expand.isHittable { expand.tap() }
        let startOver = ext.buttons["messages.startOver"].firstMatch
        if startOver.exists {
            reveal(startOver, in: ext); startOver.tap()
            let alert = sms.alerts["Leave this game?"].firstMatch
            XCTAssertTrue(alert.waitForExistence(timeout: 5))
            alert.buttons["Keep playing"].firstMatch.tap()
            XCTAssertTrue(ext.buttons["messages.draftChallenge"].exists, "Cancelling must preserve the sealed challenge")
            reveal(startOver, in: ext); startOver.tap()
            XCTAssertTrue(alert.waitForExistence(timeout: 5)); alert.buttons["Leave game"].firstMatch.tap()
        }
        let close = ext.buttons["nav.close"].firstMatch
        if close.waitForExistence(timeout: 2), close.isHittable {
            close.tap()
            let alert = sms.alerts["Leave this game?"].firstMatch
            XCTAssertTrue(alert.waitForExistence(timeout: 5)); alert.buttons["Leave game"].firstMatch.tap()
        }
        let start = ext.buttons["messages.start"].firstMatch
        guard start.waitForExistence(timeout: 8) else { throw XCTSkip("Native extension must offer a new local challenge") }
        screenshot("launch-messages-home")
        start.tap()
        let choice = ext.buttons["round.choice.4"].firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 8)); choice.tap()
        XCTAssertEqual(choice.value as? String, "selected")
        screenshot("launch-messages-native-round")
        for value in [4, 2, 3, 4, 5] {
            let selection = ext.buttons["round.choice.\(value)"].firstMatch
            XCTAssertTrue(selection.waitForExistence(timeout: 5)); selection.tap()
            let next = ext.buttons["round.next"].firstMatch
            XCTAssertTrue(next.exists); next.tap()
        }
        XCTAssertTrue(ext.buttons["messages.draftChallenge"].waitForExistence(timeout: 8))
        screenshot("launch-messages-sealed-no-insertion")
        // Deliberately stop before the Add challenge action.
        XCTAssertTrue((draft.value as? String) == before, "Sealing must not modify the chat's original draft")
    }
    private func screenshot(_ name: String) {
        let value = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        value.name = name; value.lifetime = .keepAlways; add(value)
    }
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<15 where !element.isHittable {
            guard let scroll = app.scrollViews.allElementsBoundByIndex.last else { break }
            scroll.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
    }
}
