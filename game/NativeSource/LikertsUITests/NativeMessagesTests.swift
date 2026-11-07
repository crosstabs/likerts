import XCTest
import UIKit

/// Runs only on our newly created, unsigned-in Simulator with Apple's sample chats.
/// Drafting and no-draft rotation checks are separate. Neither taps Send.
@MainActor
final class NativeMessagesTests: XCTestCase {
    /// Requires Apple's isolated sample chat; opens the extension if needed.
    /// Exercises actual Messages hosting and rotation; never adds/sends a card.
    func testIPadNativeMessagesRetainsSelectionAcrossRotation() throws {
        guard ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]?.hasPrefix("iPad") == true else {
            throw XCTSkip("Native iPad rotation requires an iPad Simulator with the sample Messages conversation open.")
        }
        continueAfterFailure = false
        defer { XCUIDevice.shared.orientation = .portrait }
        let sms = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        sms.activate()
        let title = sms.buttons["ConversationTitle"].firstMatch
        guard title.waitForExistence(timeout: 8), title.label.filter(\.isNumber) == "18885551212" else {
            throw XCTSkip("Open Apple's +1 (888) 555-1212 sample conversation before this no-send test.")
        }
        let field = sms.descendants(matching: .any).matching(identifier: "messageBodyField").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 8))
        let draftBefore = field.value as? String
        defer { if field.exists { XCTAssertEqual(field.value as? String, draftBefore, "Native game must preserve the chat's draft") } }
        let pendingAlert = sms.alerts["Leave this game?"].firstMatch
        if pendingAlert.waitForExistence(timeout: 1) { pendingAlert.buttons["Keep playing"].firstMatch.tap() }
        let ext = XCUIApplication(bundleIdentifier: "studio.likerts.game.messages")
        let start = ext.buttons["messages.start"].firstMatch
        if !start.exists && !ext.buttons["messages.expand"].exists && !ext.buttons["nav.close"].exists {
            let add = sms.buttons["add"].firstMatch
            guard add.exists, add.isHittable else { throw XCTSkip("Sample chat app menu is unavailable.") }
            add.tap()
            let likerts = sms.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Likerts")).firstMatch
            for _ in 0..<3 where !likerts.isHittable {
                let anchor = sms.staticTexts["Digital Touch"].firstMatch
                guard anchor.exists, anchor.isHittable else { break }
                let origin = sms.coordinate(withNormalizedOffset: .zero)
                let point = CGPoint(x: anchor.frame.midX, y: anchor.frame.midY)
                origin.withOffset(CGVector(dx: point.x, dy: point.y))
                    .press(forDuration: 0.01, thenDragTo: origin.withOffset(CGVector(dx: point.x, dy: point.y - 250)))
            }
            guard likerts.exists, likerts.isHittable else {
                screenshot(sms, "native-ipad-app-menu-unavailable")
                throw XCTSkip("Likerts is not reachable in the sample chat app menu.")
            }
            likerts.tap()
        }
        // A prior no-send test may leave its temporary round open. Leave it
        // through the app's own confirmation; never touch the chat's draft.
        let expand = ext.buttons["messages.expand"].firstMatch
        if expand.waitForExistence(timeout: 2), expand.isHittable { expand.tap() }
        let close = ext.buttons["nav.close"].firstMatch
        if close.waitForExistence(timeout: 2), close.isHittable {
            let existingPrompt = ext.descendants(matching: .any).matching(identifier: "round.prompt").firstMatch.label
            close.tap()
            // Messages owns the native alert. Targeting it through the
            // extension lets XCTest's default interruption handler cancel it.
            let alert = sms.alerts["Leave this game?"].firstMatch
            XCTAssertTrue(alert.waitForExistence(timeout: 4))
            alert.buttons["Keep playing"].firstMatch.tap()
            XCTAssertEqual(ext.descendants(matching: .any).matching(identifier: "round.prompt").firstMatch.label, existingPrompt)
            screenshot(sms, "native-ipad-cancel-leave-keeps-take-and-draft")
            close.tap()
            XCTAssertTrue(alert.waitForExistence(timeout: 4))
            alert.buttons["Leave game"].firstMatch.tap()
        }
        guard start.waitForExistence(timeout: 10) else {
            screenshot(sms, "native-ipad-extension-not-at-home")
            throw XCTSkip("Likerts must already be open at its home view in the sample conversation.")
        }
        screenshot(sms, "native-ipad-home")
        start.tap()
        let choice = ext.buttons["round.choice.4"].firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 8)); choice.tap()
        XCTAssertEqual(choice.value as? String, "selected")
        let prompt = ext.descendants(matching: .any).matching(identifier: "round.prompt").firstMatch
        XCTAssertTrue(prompt.exists); let original = prompt.label
        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
            XCUIDevice.shared.orientation = orientation
            let expand = ext.buttons["messages.expand"].firstMatch
            if expand.waitForExistence(timeout: 2), expand.isHittable { expand.tap() }
            XCTAssertTrue(choice.waitForExistence(timeout: 8))
            XCTAssertEqual(choice.value as? String, "selected")
            XCTAssertEqual(prompt.label, original)
            screenshot(sms, orientation == .portrait ? "native-ipad-portrait-selection" : "native-ipad-landscape-selection")
        }
        // Retained values alone cannot prove landscape controls work. Advance
        // while still landscape, then prove portrait keeps that new take.
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscapeExpand = ext.buttons["messages.expand"].firstMatch
        if landscapeExpand.waitForExistence(timeout: 2), landscapeExpand.isHittable { landscapeExpand.tap() }
        let next = ext.buttons["round.next"].firstMatch
        XCTAssertTrue(next.waitForExistence(timeout: 8))
        XCTAssertTrue(next.isHittable); next.tap()
        XCTAssertNotEqual(prompt.label, original)
        XCTAssertEqual(choice.value as? String, "not selected")
        let advanced = prompt.label
        screenshot(sms, "native-ipad-landscape-next-take-no-draft")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertEqual(prompt.label, advanced)
        XCTAssertEqual(choice.value as? String, "not selected")
        screenshot(sms, "native-ipad-portrait-next-take-no-draft")
    }

    func testActualMessagesExtensionCreatesUnsentDraftInSampleConversation() throws {
        guard ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] == "Likerts Messages QA" else {
            throw XCTSkip("Native Messages test requires the isolated Likerts Messages QA Simulator.")
        }
        continueAfterFailure = false
        let sms = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        sms.activate()
        let ext = XCUIApplication(bundleIdentifier: "studio.likerts.game.messages")
        let start = ext.buttons["messages.start"]
        guard start.waitForExistence(timeout: 12) else {
            let attachment = XCTAttachment(string: sms.debugDescription + "\nEXTENSION\n" + ext.debugDescription)
            attachment.name = "native-messages-accessibility-tree"; attachment.lifetime = .keepAlways; add(attachment)
            XCTFail("Open Likerts from + in the sample Simulator chat before running the native extension test.")
            return
        }
        screenshot(sms, "native-messages-01-compact")
        start.tap()
        for choice in [1, 2, 3, 4, 5] {
            let button = ext.buttons["round.choice.\(choice)"]
            XCTAssertTrue(button.waitForExistence(timeout: 8))
            if choice == 1 { screenshot(sms, "native-messages-02-expanded-round") }
            button.tap()
            ext.buttons["round.next"].tap()
        }
        let draft = ext.buttons["messages.draftChallenge"]
        XCTAssertTrue(draft.waitForExistence(timeout: 8))
        if !draft.isHittable { ext.swipeUp() }
        screenshot(sms, "native-messages-03-challenge-ready")
        draft.tap()
        let notice = ext.staticTexts["messages.notice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 8))
        XCTAssertTrue(notice.label.contains("Draft ready"))
        screenshot(sms, "native-messages-04-unsent-interactive-card")
        // Deliberately leave the native draft unsent.
    }
    private func screenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
