import XCTest

/// Normal user dismissal/reopen after installing a new build. No process,
/// Simulator, data, cache or trust operation is used to refresh the native host.
@MainActor enum NativeMessagesQA {
    static func selectExistingSampleIfShown(_ sms: XCUIApplication) throws {
        let title = sms.buttons["ConversationTitle"].firstMatch
        if title.exists || title.waitForExistence(timeout: 2) { return }
        // A normal host launch can show its existing conversation list.
        // Select only the already-observed Apple QA sample, never a new chat.
        _ = sms.cells.firstMatch.waitForExistence(timeout: 8)
        let samples = sms.staticTexts.allElementsBoundByIndex.filter {
            $0.label.filter(\.isNumber) == "18885551212"
        }
        guard samples.count == 1, let sample = samples.first, sample.isHittable else {
            throw XCTSkip("The existing Apple sample chat is not visibly selectable")
        }
        sample.tap()
    }
    static func reopenFromDrawer(sms: XCUIApplication, ext: XCUIApplication) throws {
        // Older installed Help versions had a scrolled Close. Dismiss only
        // those known Help screens; never hit an underlying game Close.
        for _ in 0..<2 where ext.staticTexts["privacy.contact"].exists || ext.staticTexts["support.address"].exists {
            let fixed = ext.buttons["help.close"].firstMatch
            if fixed.exists && fixed.isHittable { fixed.tap(); continue }
            let legacy = ext.buttons["nav.close"].firstMatch
            for _ in 0..<18 where !legacy.isHittable {
                guard let scroll = ext.scrollViews.allElementsBoundByIndex.last else { break }
                scroll.swipeDown()
            }
            guard legacy.exists && legacy.isHittable else { throw XCTSkip("Existing Help cannot be dismissed through its visible user control") }
            legacy.tap()
        }
        let camera = sms.staticTexts["Camera"].firstMatch
        let add = sms.buttons["add"].firstMatch
        if !camera.exists || !camera.isHittable {
            // A normal drag on the native grabber compacts expanded Messages.
            if !add.isHittable {
                if ProcessInfo.processInfo.environment["SIMULATOR_UDID"] == "CFC75815-4793-43BB-9A2C-9572A140FCD3" {
                    // iPad has a floating popover, dismissed by selecting the
                    // same already-open sample row in its visible sidebar.
                    let rows = sms.cells.staticTexts.allElementsBoundByIndex.filter { $0.label.filter(\.isNumber) == "18885551212" }
                    guard rows.count == 1, let row = rows.first, row.isHittable else { throw XCTSkip("Existing iPad sample row is not visibly reachable") }
                    row.tap()
                } else {
                    let grabber = ext.buttons["Sheet Grabber"].firstMatch
                    guard grabber.exists && grabber.isHittable else { throw XCTSkip("Native extension cannot be compacted using its visible grabber") }
                    let start = grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                    start.press(forDuration: 0.01, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 420)))
                }
            }
            guard add.exists && add.isHittable else { throw XCTSkip("Native app drawer is not reachable after normal dismissal") }
            add.tap()
        }
        let icon = sms.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Likerts")).firstMatch
        for _ in 0..<4 where !icon.isHittable {
            guard let anchor = ["Digital Touch", "#images", "Check In"].map({ sms.staticTexts[$0].firstMatch }).first(where: { $0.exists && $0.isHittable }) else { break }
            let origin = sms.coordinate(withNormalizedOffset: .zero)
            let x = anchor.frame.midX - sms.frame.minX, y = anchor.frame.midY - sms.frame.minY
            origin.withOffset(CGVector(dx: x, dy: y)).press(forDuration: 0.01, thenDragTo: origin.withOffset(CGVector(dx: x, dy: y - 250)))
        }
        guard icon.exists && icon.isHittable else { throw XCTSkip("Likerts cannot be reached in the observed native drawer") }
        icon.tap()
    }
}

/// Opens only the existing Apple sample chat; never stages or sends a card.
@MainActor final class NativeSupportPrivacyTests: XCTestCase {
    func testNativeContactCopyAndPrivacyPreserveDraft() throws {
        let allowed = ["933FAD35-90C0-4F47-BB3B-F12B499BD26F", "CFC75815-4793-43BB-9A2C-9572A140FCD3"]
        guard let id = ProcessInfo.processInfo.environment["SIMULATOR_UDID"], allowed.contains(id) else {
            throw XCTSkip("Only the isolated QA sample-chat devices are allowed")
        }
        continueAfterFailure = false
        let sms = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        sms.activate()
        try NativeMessagesQA.selectExistingSampleIfShown(sms)
        let title = sms.buttons["ConversationTitle"].firstMatch
        guard title.waitForExistence(timeout: 8), title.label.filter(\.isNumber) == "18885551212" else {
            throw XCTSkip("The existing Apple sample chat must already be selected")
        }
        let draft = sms.descendants(matching: .any).matching(identifier: "messageBodyField").firstMatch
        XCTAssertTrue(draft.exists)
        let before = draft.value as? String
        guard before == "iMessage" || before == "" else { throw XCTSkip("Only an empty isolated QA draft may be used") }
        defer { XCTAssertEqual(draft.value as? String, before, "Contact UI must preserve the original chat draft") }
        let ext = XCUIApplication(bundleIdentifier: "studio.likerts.game.messages")
        if !ext.buttons["messages.startOver"].exists && !ext.buttons["messages.support"].exists {
            let camera = sms.staticTexts["Camera"].firstMatch
            if !camera.exists || !camera.isHittable {
                let add = sms.buttons["add"].firstMatch
                guard add.exists && add.isHittable else { throw XCTSkip("Native app drawer unavailable") }
                add.tap()
            }
            let icon = sms.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Likerts")).firstMatch
            for _ in 0..<4 where !icon.isHittable {
                guard let anchor = ["Digital Touch", "#images", "Check In"].map({ sms.staticTexts[$0].firstMatch }).first(where: { $0.exists && $0.isHittable }) else { break }
                let origin = sms.coordinate(withNormalizedOffset: .zero)
                origin.withOffset(CGVector(dx: anchor.frame.midX, dy: anchor.frame.midY)).press(forDuration: 0.01, thenDragTo: origin.withOffset(CGVector(dx: anchor.frame.midX, dy: anchor.frame.midY - 250)))
            }
            guard icon.exists && icon.isHittable else { throw XCTSkip("Likerts unavailable in the native app menu") }
            icon.tap()
        }
        let expand = ext.buttons["messages.expand"].firstMatch
        if expand.waitForExistence(timeout: 2), expand.isHittable { expand.tap() }
        // A newly opened Home uses Apple's scaled half-screen card. Expand
        // with its native grabber before measuring controls in full-size
        // points; do not start a game merely to change presentation style.
        if id == "933FAD35-90C0-4F47-BB3B-F12B499BD26F" {
            let grabber = ext.buttons["Sheet Grabber"].firstMatch
            if grabber.exists, grabber.isHittable, grabber.value as? String == "Half screen" {
                let origin = grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                origin.press(forDuration: 0.01, thenDragTo: origin.withOffset(CGVector(dx: 0, dy: -450)))
                let fullSize = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    ext.buttons["messages.support"].firstMatch.frame.height >= 43.9
                }, object: nil)
                XCTAssertEqual(XCTWaiter.wait(for: [fullSize], timeout: 8), .completed,
                               "Native expansion must finish before full-size touch-target checks")
            }
        }
        guard ext.buttons["messages.support"].waitForExistence(timeout: 8) else {
            throw XCTSkip("The current native page does not expose the updated contact entry; no game is changed")
        }
        tap("messages.support", in: ext)
        XCTAssertTrue(ext.staticTexts["support.address"].waitForExistence(timeout: 8))
        XCTAssertEqual(ext.staticTexts["support.address"].label, "support@crosstabs.com", "The native host must be running the current contact configuration")
        XCTAssertTrue(ext.descendants(matching: .any).matching(identifier: "support.publicWebsite").firstMatch.exists,
                      "The installed extension must include the newly published support destination")
        tap("support.copyAddress", in: ext)
        XCTAssertTrue(ext.staticTexts["support.notice"].label.contains("Nothing was sent"))
        tap("support.copyDraft", in: ext)
        XCTAssertTrue(ext.staticTexts["support.notice"].label.contains("system clipboard"))
        capture("native-support-copy-no-delivery")
        reveal("support.publicWebsite", in: ext)
        let website = ext.descendants(matching: .any).matching(identifier: "support.publicWebsite").firstMatch
        XCTAssertTrue(website.isHittable)
        XCTAssertGreaterThanOrEqual(website.frame.height, 43.9)
        capture("native-published-support-website-entry")
        tap("support.privacy", in: ext)
        reveal("privacy.contact", in: ext)
        XCTAssertTrue(ext.staticTexts["privacy.contact"].label.contains("support@crosstabs.com"))
        capture("native-privacy-contact")
        // Return to the same local game, preserving its in-memory state and chat draft.
        let close = ext.buttons["help.close"].firstMatch
        XCTAssertTrue(close.exists && close.isHittable); close.tap()
        XCTAssertFalse(ext.staticTexts["support.address"].exists)
        XCTAssertFalse(ext.staticTexts["privacy.contact"].exists)
        reveal("messages.support", in: ext)
        XCTAssertTrue(ext.buttons["messages.support"].isHittable)
        if ext.buttons["messages.startOver"].exists {
            tap("messages.startOver", in: ext)
            let alert = sms.alerts["Leave this game?"].firstMatch
            XCTAssertTrue(alert.waitForExistence(timeout: 5))
            alert.buttons["Keep playing"].firstMatch.tap()
            XCTAssertTrue(ext.buttons["messages.draftChallenge"].exists, "Cancelling keeps the sealed challenge")
            tap("messages.startOver", in: ext)
            XCTAssertTrue(alert.waitForExistence(timeout: 5)); alert.buttons["Leave game"].firstMatch.tap()
            XCTAssertTrue(ext.buttons["messages.start"].waitForExistence(timeout: 5))
            XCTAssertFalse(ext.buttons["messages.draftChallenge"].exists)
        }
    }
    private func tap(_ id: String, in app: XCUIApplication) {
        reveal(id, in: app)
        let value = app.buttons[id].firstMatch
        XCTAssertTrue(value.isHittable, id)
        XCTAssertGreaterThanOrEqual(value.frame.height, 43.9, id)
        value.tap()
    }
    private func reveal(_ id: String, in app: XCUIApplication) {
        let value = app.descendants(matching: .any).matching(identifier: id).firstMatch
        XCTAssertTrue(value.exists || value.waitForExistence(timeout: 8), id)
        for _ in 0..<24 {
            let scroll = app.scrollViews.allElementsBoundByIndex.last { $0.descendants(matching: .any).matching(identifier: id).count > 0 }
            if value.isHittable { break }
            guard let scroll else { break }
            // Remote iPad popovers can expose local app and global modal
            // frames together. Let XCTest gesture in the actual scroll view.
            if value.frame.midY < scroll.frame.midY { scroll.swipeDown() }
            else { scroll.swipeUp() }
        }
    }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
