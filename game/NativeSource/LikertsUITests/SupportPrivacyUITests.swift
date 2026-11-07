import XCTest

@MainActor final class SupportPrivacyUITests: XCTestCase {
    private let app = XCUIApplication()
    override func setUpWithError() throws { continueAfterFailure = false }
    override func tearDownWithError() throws { app.terminate() }

    func testSettingsSupportDraftFallbackPrivacyAndReturn() {
        app.launchArguments = ["-ui-testing", "-support-email-unavailable"]
        app.launch()
        tap("home.settings"); tap("settings.support")
        XCTAssertEqual(require("support.address").label, "support@crosstabs.com")
        XCTAssertTrue(require("support.included").label.contains("Nothing from your game or conversation is attached automatically"))
        let editor = require("support.message"); editor.tap(); editor.typeText("A control was hard to reach & I need help.")
        let done = app.buttons["support.done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5)); done.tap()
        tap("support.email")
        XCTAssertTrue(require("support.notice").label.contains("Nothing was sent"))
        XCTAssertTrue(require("support.notice").label.contains("could not be opened"))
        tap("support.copyDraft")
        XCTAssertTrue(require("support.notice").label.contains("system clipboard"))
        capture("support-normal-copy-fallback")
        tap("support.privacy")
        tapUntilVisible("privacy.contact")
        XCTAssertTrue(require("privacy.contact").label.contains("CROSSTABS PTY LTD"))
        XCTAssertTrue(require("privacy.contact").label.contains("support@crosstabs.com"))
        XCTAssertFalse(app.buttons["privacy.publicPolicy"].exists, "No unconfigured public policy URL is presented")
        capture("privacy-normal-contact")
        tap("help.close")
        tap("settings.support")
        XCTAssertEqual(require("support.address").label, "support@crosstabs.com")
        XCTAssertEqual(require("support.message").value as? String, "", "Closing discards the unsent local draft")
        XCTAssertFalse(app.staticTexts["support.notice"].exists)
        XCTAssertTrue(require("support.publicWebsite").exists, "The verified published support page is available")
        tap("help.close")
    }

    func testPublishedSupportWebsiteOpensAndReturnsToUnsentDraft() {
        app.launchArguments = ["-ui-testing", "-support-email-unavailable"]
        app.launch()
        tap("home.settings"); tap("settings.support")
        let editor = require("support.message"); editor.tap(); editor.typeText("Checking the help link.")
        let done = app.buttons["support.done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5)); done.tap()
        tap("support.publicWebsite")
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 15))
        let heading = safari.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Back on the same wavelength.")).firstMatch
        XCTAssertTrue(heading.waitForExistence(timeout: 20), "The real published support page must load")
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "published-support-safari-handoff"; attachment.lifetime = .keepAlways; add(attachment)
        app.activate()
        XCTAssertEqual(require("support.message").value as? String, "Checking the help link.")
        XCTAssertEqual(require("support.address").label, "support@crosstabs.com")
        tap("help.close")
    }

    func testLargestTextReportCancelPreservesSelectedGameAndPrivacyIsReachable() {
        app.launchArguments = ["-ui-testing", "-support-email-unavailable", "-topic-qa", "snacks", "-largest-text", "-accessible-effects"]
        app.launch()
        tap("round.choice.4"); tap("content.options"); tap("content.report")
        XCTAssertGreaterThan(require("support.address").frame.height, 40, "The sheet must actually inherit accessibility text sizing")
        XCTAssertEqual(require("support.address").label, "support@crosstabs.com")
        XCTAssertTrue(app.buttons["support.kind"].label.contains("Content or safety concern"))
        tap("support.copyAddress")
        XCTAssertTrue(require("support.notice").label.contains("Nothing was sent"))
        tap("support.copyDraft")
        capture("support-report-largest-text")
        // Close the presented sheet, not the game's underlying close button.
        tap("help.close")
        XCTAssertFalse(app.staticTexts["support.address"].exists)
        XCTAssertEqual(app.buttons["round.choice.4"].value as? String, "selected")
        tap("round.settings"); tap("settings.privacyDetails")
        tapUntilVisible("privacy.contact")
        capture("privacy-largest-text-contact")
        XCTAssertTrue(require("privacy.contact").label.contains("support@crosstabs.com"))
    }

    private func require(_ id: String) -> XCUIElement {
        let element = app.descendants(matching: .any).matching(identifier: id).firstMatch
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 6), id)
        return element
    }
    private func tap(_ id: String) {
        tapUntilVisible(id)
        let element = require(id)
        XCTAssertTrue(element.isHittable, id)
        XCTAssertGreaterThanOrEqual(element.frame.height, 43.9, id)
        element.tap()
    }
    private func tapUntilVisible(_ id: String) {
        let value = require(id)
        for _ in 0..<65 {
            let scroll = app.scrollViews.allElementsBoundByIndex.last { $0.descendants(matching: .any).matching(identifier: id).count > 0 }
            let viewport = (scroll?.frame ?? app.frame).intersection(app.frame).insetBy(dx: 0, dy: 16)
            if value.isHittable && viewport.contains(value.frame) { break }
            guard scroll != nil else { break }
            let down = value.frame.midY < viewport.midY
            let x = viewport.maxX - 8
            let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: viewport.minY + viewport.height * (down ? 0.35 : 0.75)))
            let to = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: viewport.minY + viewport.height * (down ? 0.65 : 0.40)))
            from.press(forDuration: 0.01, thenDragTo: to)
        }
    }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
}
