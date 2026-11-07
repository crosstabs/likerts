import XCTest

/// End-to-end checks for the shipped offline game, using the same visible
/// answer/guess/reveal controls as a player rather than launch-time fixtures.
@MainActor
final class LikertsUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let readinessCases = ["testNativeHomeAccessibilityAudit", "testNativeFirstAnswerAccessibilityAudit",
                              "testLargestTextOfflineCodeFieldsAndSharePreview", "testLargestTextOfflineJoinKeyboardFocus",
                              "testOrdinaryNativeHomeAccessibilityAudit"]
        if readinessCases.contains(where: { name.contains($0) }) {
            guard ProcessInfo.processInfo.environment["SIMULATOR_UDID"] == "78680FA8-DE77-41F8-9948-7D20D57A6340" else {
                throw NSError(domain: "LikertsAccessibilityQA", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "This accessibility check requires the approved QA Simulator before app activation."])
            }
        }
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()
        require(app.buttons["home.makeChallenge"])
    }

    func testNativeHomeAccessibilityAudit() throws {
        XCTAssertFalse(app.buttons["home.live"].exists, "Ordinary Release has no configured Live server.")
        continueAfterFailure = true
        attachScreenshot("a11y-home-before-audit")
        try recordUnfilteredAccessibilityAudit("a11y-home-issue-metadata")
    }

    /// Separate control using the ordinary Release app without QA launch flags.
    func testOrdinaryNativeHomeAccessibilityAudit() throws {
        app.terminate()
        app.launchArguments = []
        app.launch()
        require(app.buttons["home.makeChallenge"])
        XCTAssertFalse(app.buttons["home.live"].exists, "Ordinary Release has no configured Live server.")
        continueAfterFailure = true
        attachScreenshot("a11y-ordinary-home-before-audit")
        try recordUnfilteredAccessibilityAudit("a11y-ordinary-home-issue-metadata")
    }

    func testNativeFirstAnswerAccessibilityAudit() throws {
        XCTAssertFalse(app.buttons["home.live"].exists, "Ordinary Release has no configured Live server.")
        startChallenge()
        continueAfterFailure = true
        let labels = ["Not me", "A little", "Depends", "Mostly me", "So me"]
        let choices = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "round.choice."))
        XCTAssertEqual(choices.count, 5)
        XCTAssertEqual(Set(choices.allElementsBoundByIndex.map(\.identifier)), Set((1...5).map { "round.choice.\($0)" }))
        for value in 1...5 {
            let choice = app.buttons["round.choice.\(value)"]
            XCTAssertTrue(choice.waitForExistence(timeout: 4))
            if choice.exists {
                XCTAssertEqual(choice.label, "\(value), \(labels[value - 1])")
                XCTAssertEqual(choice.value as? String, "not selected")
                XCTAssertTrue(choice.isEnabled)
                XCTAssertTrue(choice.isHittable)
                XCTAssertGreaterThanOrEqual(choice.frame.width, 44)
                XCTAssertGreaterThanOrEqual(choice.frame.height, 44)
            }
        }
        // XCTest descendants do not establish VoiceOver focus stops. Keep the
        // visual-text count and hierarchy as diagnostics, not a speech assertion.
        let ordinalCount = app.staticTexts.matching(NSPredicate(format: "label IN %@", ["1", "2", "3", "4", "5"])).count
        let hierarchy = XCTAttachment(string: "Visual ordinal StaticText descendants: \(ordinalCount)\n\n\(app.debugDescription)")
        hierarchy.name = "a11y-first-answer-automation-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let lock = require(app.buttons["round.next"])
        XCTAssertFalse(lock.isEnabled)
        attachScreenshot("a11y-first-answer-before-audit")
        try recordUnfilteredAccessibilityAudit("a11y-first-answer-issue-metadata")
        for selected in [1, 4] {
            tap("round.choice.\(selected)")
            for value in 1...5 {
                XCTAssertEqual(app.buttons["round.choice.\(value)"].value as? String,
                               value == selected ? "selected" : "not selected")
            }
            XCTAssertTrue(lock.isEnabled)
        }
        attachScreenshot("a11y-first-answer-selected-before-audit")
        try recordUnfilteredAccessibilityAudit("a11y-first-answer-selected-issue-metadata")
    }

    /// App-local AX5 keyboard focus only; no typing or OS preference changes.
    func testLargestTextOfflineJoinKeyboardFocus() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-largest-text", "-accessible-effects"]
        app.launch()
        tap("home.join")
        let field = require(app.descendants(matching: .any).matching(identifier: "join.code").firstMatch)
        revealWithSmallScrolls(field)
        XCTAssertTrue(field.isHittable)
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        attachScreenshot("a11y-ax5-join-before-keyboard-focus")
        XCTContext.runActivity(named: "AX5 Join keyboard focus") { _ in
            field.tap()
        }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 4))
        XCTAssertTrue(field.isHittable)
        let done = require(app.buttons["join.done"].firstMatch)
        XCTAssertTrue(done.isEnabled)
        XCTAssertTrue(done.isHittable)
        XCTAssertGreaterThanOrEqual(done.frame.width, 44)
        XCTAssertGreaterThanOrEqual(done.frame.height, 44)
        attachScreenshot("a11y-ax5-join-keyboard-visible")
        done.tap()
        let keyboardGone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardGone], timeout: 4), .completed)
        revealWithSmallScrolls(field)
        let frame = field.frame
        XCTAssertTrue([frame.minX, frame.minY, frame.width, frame.height].allSatisfy { $0.isFinite })
        XCTAssertGreaterThan(frame.width, 0)
        XCTAssertGreaterThan(frame.height, 0)
        XCTAssertTrue(app.frame.contains(frame), "The complete code field must be visible after keyboard dismissal.")
        XCTAssertTrue(field.isHittable)
        attachScreenshot("a11y-ax5-join-after-keyboard-dismissal")
        tap("nav.close")
        require(app.buttons["home.makeChallenge"])
    }

    /// App-local AX5 layout, not an actual OS preference or VoiceOver check.
    func testLargestTextOfflineCodeFieldsAndSharePreview() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-largest-text", "-accessible-effects"]
        app.launch()
        startChallenge()
        answerFive([1, 2, 3, 4, 5])
        tap("handoff.share")
        let preview = require(app.staticTexts["share.code"].firstMatch)
        revealWithSmallScrolls(preview)
        XCTAssertTrue(preview.label.hasPrefix("LK3-"))
        XCTAssertTrue(preview.isHittable)
        XCTAssertTrue(app.frame.contains(preview.frame), "The three-line code preview must be fully visible.")
        attachScreenshot("a11y-ax5-offline-share-code-preview")
        let copy = require(app.buttons["share.copy"].firstMatch)
        revealWithSmallScrolls(copy)
        XCTAssertTrue(copy.isHittable)
        XCTAssertGreaterThanOrEqual(copy.frame.height, 44)
        tap("share.copy")
        XCTAssertTrue(app.buttons.matching(identifier: "share.copy").matching(NSPredicate(format: "label CONTAINS %@", "Copied!")).firstMatch.waitForExistence(timeout: 4))
        tap("nav.close")
        XCTAssertFalse(app.staticTexts["share.code"].exists)
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        tap("home.join")
        let field = require(app.descendants(matching: .any).matching(identifier: "join.code").firstMatch)
        revealWithSmallScrolls(field)
        XCTAssertTrue(field.isHittable)
        field.tap(); field.typeText("INVALID-AT-LARGE-TEXT")
        tap("join.done")
        let keyboardGone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardGone], timeout: 4), .completed)
        revealWithSmallScrolls(field)
        XCTAssertEqual(field.value as? String, "INVALID-AT-LARGE-TEXT")
        XCTAssertTrue(field.isHittable)
        XCTAssertTrue(app.frame.contains(field.frame))
        attachScreenshot("a11y-ax5-offline-join-code-field")
        tap("join.play")
        require(app.staticTexts["join.error"].firstMatch)
        tap("nav.close")
        require(app.buttons["home.makeChallenge"])
    }

    /// Run on a compact simulator to check the actual accessibility layout,
    /// including the honest restart note and the vertically stacked steps.
    func testCompactHomeAtLargestAccessibilityText() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-largest-text", "-accessible-effects"]
        app.launch()
        let hero = require(app.staticTexts["home.hero"])
        XCTAssertEqual(hero.label.split(whereSeparator: { $0.isWhitespace }).joined(separator: " "), "Read my mind. I dare you.")
        XCTAssertLessThanOrEqual(hero.frame.width, app.frame.width)
        attachScreenshot("home-compact-largest-text-hero")
        let nickname = require(app.buttons["home.customize"].firstMatch)
        revealWithSmallScrolls(nickname)
        XCTAssertTrue(nickname.isHittable, "Nickname setup should be reachable at large text sizes")
        let safeViewport = app.frame.insetBy(dx: 0, dy: 30)
        XCTAssertTrue(safeViewport.contains(nickname.frame), "Nickname button must be fully visible within the viewport")
        attachScreenshot("home-compact-largest-text-nickname")
        nickname.tap()
        require(app.textFields["setup.name"].firstMatch)
        tap("nav.close")
        let note = require(app.staticTexts["home.sessionNote"].firstMatch)
        revealIfNeeded(note)
        XCTAssertTrue(note.isHittable, "The restart note should be reachable by scrolling")
        XCTAssertTrue(note.label.contains("Your unfinished game is saved on this device until you leave."))
        attachScreenshot("home-compact-largest-text-restart-note")

        let steps = app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@ AND label CONTAINS %@ AND label CONTAINS %@", "Answer", "Pass", "Mind-read"
        )).firstMatch
        require(steps)
        revealIfNeeded(steps)
        XCTAssertTrue(steps.isHittable, "The play steps should be reachable by scrolling")
        // At the largest text size, a single horizontal line cannot account
        // for this height: the three steps occupy distinct stacked lines.
        XCTAssertGreaterThan(steps.frame.height, 80, "Play steps should stack vertically")
        attachScreenshot("home-compact-largest-text-steps")
    }

    func testPassAndPlayPerfectMatchAndRematch() {
        attachScreenshot("01-home")
        startChallenge()

        let answers = [1, 2, 3, 4, 5]
        answerFive(answers)
        attachScreenshot("04-sealed-handoff")
        tap("handoff.guess")
        guessFive(answers, captureReveal: true)

        require(app.buttons["result.home"])
        XCTAssertTrue(app.staticTexts["100%"].exists, "Five exact predictions should score 100%.")
        attachScreenshot("06-perfect-wavelength-result")

        tap("result.rematch")
        require(app.buttons["round.choice.1"])
        tap("round.choice.1")
        tap("nav.close")
        tapAlert(identifier: "exit.cancel", label: "Keep playing")
        require(app.buttons["round.choice.1"])
        XCTAssertEqual(app.buttons["round.choice.1"].value as? String, "selected")

        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        require(app.buttons["home.makeChallenge"])
    }

    func testAnswerBackRestoresSelectionAndExitCanBeCancelled() {
        startChallenge()
        tap("round.choice.4")
        tap("round.next")
        tap("round.choice.2")
        tap("round.back")

        XCTAssertEqual(app.buttons["round.choice.4"].value as? String, "selected", "Going back must preserve the previous answer.")
        tap("round.next")
        XCTAssertEqual(app.buttons["round.choice.2"].value as? String, "selected", "Moving forward again must retain the pending answer.")

        tap("nav.close")
        tapAlert(identifier: "exit.cancel", label: "Keep playing")
        require(app.buttons["round.next"])
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        require(app.buttons["home.makeChallenge"])
    }

    func testMalformedChallengeShowsErrorAndJoinCanClose() {
        tap("home.join")
        let code = app.descendants(matching: .any).matching(identifier: "join.code").firstMatch
        require(code)
        code.tap()
        code.typeText("THIS-IS-NOT-A-LIKERTS-CODE")
        tap("join.play")
        require(app.staticTexts["join.error"])
        XCTAssertFalse(app.buttons["round.next"].exists, "A malformed challenge must never begin a round.")
        tap("nav.close")
        require(app.buttons["home.join"])
    }

    func testDailyPuzzlePlaysThroughAllFiveReveals() {
        tap("home.daily")
        attachScreenshot("07-daily-character")
        tap("daily.start")
        attachScreenshot("08-daily-clue")
        guessFive([3, 3, 3, 3, 3])
        require(app.buttons["result.home"])
        tap("result.home")
        require(app.buttons["home.daily"])
    }

    func testSetupCanBeCancelledWithoutStartingAGame() {
        tap("home.customize")
        require(app.textFields["setup.name"])
        attachScreenshot("02-challenge-setup")
        tap("nav.close")
        require(app.buttons["home.makeChallenge"])
        XCTAssertFalse(app.buttons["round.next"].exists)
    }

    func testOversizedUnicodeNicknameStaysInSetupAndCanBeCorrected() {
        tap("home.customize")
        let name = require(app.textFields["setup.name"])
        name.tap()
        // Six visible characters, but 90 UTF-8 bytes: exercise the actual
        // challenge-code byte limit rather than only the field's character cap.
        name.typeText(String(repeating: "🧑🏽‍🚀", count: 6))
        tap("setup.start")
        require(app.staticTexts["setup.error"])
        XCTAssertFalse(app.buttons["round.next"].exists)
        attachScreenshot("12-nickname-validation")

        name.tap()
        let delete = String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40)
        name.typeText(delete + "Nova")
        tap("setup.start")
        require(app.buttons["round.choice.1"])
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        require(app.buttons["home.makeChallenge"])
    }

    func testLargeTextAnswerAndExit() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-large-text"]
        app.launch()
        require(app.buttons["home.makeChallenge"])
        tap("home.makeChallenge")
        tap("round.choice.4")
        attachScreenshot("13-large-text-selection")
        tap("round.next")
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        require(app.buttons["home.makeChallenge"])
    }

    func testActualOnDeviceAIAvailabilityIsInspectable() {
        tap("home.fresh")
        let availability = require(app.staticTexts["fresh.availability"].firstMatch)
        XCTAssertFalse(availability.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        let attachment = XCTAttachment(string: availability.label)
        attachment.name = "on-device-ai-availability"
        attachment.lifetime = .keepAlways
        add(attachment)
        attachScreenshot("14-ai-availability")
        tap("nav.close")
        require(app.buttons["home.fresh"])
    }

    func testActualOnDeviceGenerationCanCancelAndKeepHandpickedPreview() throws {
        tap("home.fresh")
        let availability = require(app.staticTexts["fresh.availability"].firstMatch)
        guard availability.label.contains("is ready") else { throw XCTSkip("Actual model cancellation unavailable: \(availability.label)") }
        tap("fresh.generate")
        let cancel = app.buttons["fresh.cancel"].firstMatch
        guard cancel.waitForExistence(timeout: 2) else {
            attachScreenshot("live-ai-finished-before-cancel")
            throw XCTSkip("The model finished before the cancellation control could be exercised.")
        }
        guard cancel.isHittable else {
            if app.staticTexts["fresh.source"].exists {
                attachScreenshot("live-ai-finished-before-cancel-tap")
                throw XCTSkip("The model completed before the cancellation action could be tapped.")
            }
            XCTFail("Cancel must stay visible in the initiating action's position without scrolling")
            return
        }
        cancel.tap()
        require(app.buttons["fresh.generate"].firstMatch)
        XCTAssertFalse(app.staticTexts["fresh.source"].exists)
        tap("fresh.authored")
        let source = require(app.staticTexts["fresh.source"].firstMatch)
        XCTAssertTrue(source.label.contains("Handpicked by Likerts"))
        let overwritten = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@", "Handpicked by Likerts"), object: source)
        overwritten.isInverted = true
        wait(for: [overwritten], timeout: 3)
        XCTAssertTrue(source.label.contains("Handpicked by Likerts"))
        attachScreenshot("live-ai-cancel-keeps-handpicked-preview")
        tap("fresh.discard")
        require(app.buttons["fresh.generate"].firstMatch)
        tap("nav.close")
        require(app.buttons["home.fresh"])
    }

    func testActualOnDeviceSelectionPresentsReviewedPackOrLabelledFallback() throws {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-ai-validation-probe"]
        app.launch()
        tap("home.fresh")
        let availability = require(app.staticTexts["fresh.availability"].firstMatch)
        guard availability.label.contains("is ready") else {
            let reason = XCTAttachment(string: availability.label)
            reason.name = "live-generation-unavailable-reason"
            reason.lifetime = .keepAlways
            add(reason)
            attachScreenshot("20-live-ai-unavailable")
            throw XCTSkip("Actual on-device generation is unavailable: \(availability.label)")
        }

        tap("fresh.theme.sideQuests")
        let generate = require(app.buttons["fresh.generate"].firstMatch)
        revealIfNeeded(generate)
        XCTAssertTrue(generate.isHittable, "The actual Generate button must be reached before starting the model")
        XCTAssertFalse(app.staticTexts["fresh.source"].exists, "Scrolling the composer must not activate the handpicked button")
        generate.tap()
        let tapped = XCTAttachment(string: "Tapped fresh.generate after verifying the composer remained visible; awaiting actual model or explicitly labelled fallback.")
        tapped.name = "live-generation-action"; tapped.lifetime = .keepAlways; add(tapped)
        let source = app.staticTexts["fresh.source"].firstMatch
        guard source.waitForExistence(timeout: 55) else {
            attachScreenshot("20-live-ai-generation-failure")
            XCTFail("Actual on-device generation did not present a pack or an explicit fallback within 60 seconds.")
            return
        }
        assertFivePreviewStatements()
        attachScreenshot("20-live-ai-pack-preview")
        let acceptedAI = source.label.contains("AI-picked on your device")
        if !acceptedAI {
            let fallback = app.staticTexts["fresh.fallback"].firstMatch
            XCTAssertEqual(source.label, "Handpicked by Likerts")
            XCTAssertTrue(fallback.exists, "A non-AI result must explain the handpicked fallback")
            let message = fallback.exists ? fallback.label : "No fallback explanation was exposed."
            XCTAssertTrue(message.lowercased().contains("handpicked"))
            let diagnostic = app.staticTexts["fresh.validationDiagnostic"].firstMatch
            let category = diagnostic.exists ? diagnostic.label : "not a validation rejection"
            let reason = XCTAttachment(string: "Source: \(source.label)\nFallback: \(message)\nValidation category: \(category)")
            reason.name = "live-generation-fallback-reason"
            reason.lifetime = .keepAlways
            add(reason)
        } else {
            XCTAssertFalse(app.staticTexts["fresh.fallback"].exists)
        }
        let diagnostic = app.staticTexts["fresh.validationDiagnostic"].firstMatch
        if diagnostic.exists {
            let trace = XCTAttachment(string: diagnostic.label)
            trace.name = "live-generation-validation-trace"
            trace.lifetime = .keepAlways
            add(trace)
        }
        let verifiedSource = XCTAttachment(string: "Outcome: \(acceptedAI ? "accepted_reviewed_ai_selection" : "labelled_handpicked_fallback")\nSource: \(source.label)")
        verifiedSource.name = "live-generation-source"
        verifiedSource.lifetime = .keepAlways
        add(verifiedSource)

        tap("fresh.play")
        let answers = [1, 2, 3, 4, 5]
        var generatedStatements: [String] = []
        for (index, answer) in answers.enumerated() {
            let prompt = require(app.descendants(matching: .any).matching(identifier: "round.prompt").firstMatch)
            generatedStatements.append(prompt.label)
            if index == 0 { attachScreenshot("21-live-ai-round") }
            tap("round.choice.\(answer)")
            tap("round.next")
        }
        let statements = XCTAttachment(string: generatedStatements.enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n"))
        statements.name = "live-generated-statements"
        statements.lifetime = .keepAlways
        add(statements)
        require(app.buttons["handoff.guess"])
        tap("handoff.guess")
        guessFive(answers)
        require(app.buttons["result.home"])
        XCTAssertTrue(app.staticTexts["100%"].exists, "The presented reviewed selection or labelled fallback must play and score consistently.")
        attachScreenshot("22-live-ai-result")
    }

    func testAuthoredThemeUsesHonestSourceAndCustomCodeRoundTrips() {
        tap("home.fresh")
        require(app.staticTexts["fresh.availability"].firstMatch)
        tap("fresh.theme.foodTakes")
        tap("fresh.authored")
        let source = require(app.staticTexts["fresh.source"].firstMatch)
        XCTAssertTrue(source.label.contains("Handpicked by Likerts"))
        XCTAssertFalse(source.label.contains("Made on your device"), "An authored pack must not be presented as generated content.")
        XCTAssertFalse(source.label.contains("AI-picked"), "A handpicked pack must not claim AI selection.")
        assertFivePreviewStatements()
        attachScreenshot("15-handpicked-pack-preview")
        tap("fresh.play")
        require(app.descendants(matching: .any).matching(identifier: "round.packSource").firstMatch)
        attachScreenshot("16-custom-pack-round")

        let answers = [1, 2, 3, 4, 5]
        answerFive(answers)
        tap("handoff.share")
        let code = require(app.staticTexts["share.code"].firstMatch).label
        XCTAssertTrue(code.hasPrefix("LK2-"), "A shared themed pack must include its actual custom prompts.")
        attachScreenshot("17-custom-pack-code")
        tap("nav.close")
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")

        tap("home.join")
        let input = require(app.descendants(matching: .any).matching(identifier: "join.code").firstMatch)
        input.tap()
        input.typeText(code)
        tap("join.play")
        require(app.descendants(matching: .any).matching(identifier: "round.packSource").firstMatch)
        guessFive(answers)
        require(app.buttons["result.home"])
        XCTAssertTrue(app.staticTexts["100%"].exists, "LK2 must retain all five custom statements and their answer order.")
        attachScreenshot("18-custom-pack-perfect-result")
        tap("result.home")
        require(app.buttons["home.makeChallenge"])
    }

    func testActualAISelectionLargeTextPreviewCanDiscardAndReturnToHandpicked() throws {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-large-text", "-ai-validation-probe"]
        app.launch(); tap("home.fresh")
        let sheetSize = require(app.staticTexts["fresh.dynamicType"].firstMatch)
        let sizeEvidence = XCTAttachment(string: sheetSize.label)
        sizeEvidence.name = "fresh-sheet-effective-text-size"; sizeEvidence.lifetime = .keepAlways; add(sizeEvidence)
        XCTAssertTrue(sheetSize.label.contains("size=AX3"), "The presented sheet itself must use AX3, not only its presenter")
        XCTAssertFalse(sheetSize.label.contains("body=17"), "The sheet's body font must scale above the default size")
        let availability = require(app.staticTexts["fresh.availability"].firstMatch)
        guard availability.label.contains("is ready") else { throw XCTSkip("Actual AI picking unavailable: \(availability.label)") }
        tap("fresh.generate")
        let source = app.staticTexts["fresh.source"].firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 55))
        let accepted = source.label == "AI-picked on your device"
        if !accepted {
            XCTAssertEqual(source.label, "Handpicked by Likerts")
            XCTAssertTrue(require(app.staticTexts["fresh.fallback"].firstMatch).label.lowercased().contains("handpicked"))
        }
        assertFivePreviewStatements()
        revealIfNeeded(source)
        XCTAssertTrue(source.isHittable)
        XCTAssertTrue(app.frame.contains(source.frame))
        attachScreenshot("ai-pick-large-text-source")
        let sourceScreen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        sourceScreen.name = "ai-pick-large-text-source-full-screen"; sourceScreen.lifetime = .keepAlways; add(sourceScreen)
        let fifth = require(app.staticTexts["fresh.preview.5"].firstMatch)
        revealIfNeeded(fifth); XCTAssertTrue(fifth.isHittable)
        XCTAssertTrue(app.frame.contains(fifth.frame))
        attachScreenshot("ai-pick-large-text-fifth-take")
        let fifthScreen = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        fifthScreen.name = "ai-pick-large-text-fifth-full-screen"; fifthScreen.lifetime = .keepAlways; add(fifthScreen)
        let outcome = XCTAttachment(string: "Outcome: \(accepted ? "accepted_reviewed_ai_selection" : "labelled_handpicked_fallback")\nSource: \(source.label)")
        outcome.name = "large-text-live-ai-outcome"; outcome.lifetime = .keepAlways; add(outcome)
        tap("fresh.discard"); require(app.buttons["fresh.generate"].firstMatch)
        tap("fresh.authored")
        XCTAssertEqual(require(app.staticTexts["fresh.source"].firstMatch).label, "Handpicked by Likerts")
        tap("nav.close"); require(app.buttons["home.fresh"])
    }

    func testReducedEffectsRetainsReadablePromptAndSelectedAnswer() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-accessible-effects"]
        app.launch()
        startChallenge()
        let firstPrompt = require(app.descendants(matching: .any).matching(identifier: "round.prompt").firstMatch)
        XCTAssertFalse(firstPrompt.label.isEmpty)
        tap("round.choice.2")
        XCTAssertEqual(app.buttons["round.choice.2"].firstMatch.value as? String, "selected")
        tap("round.next")
        require(app.descendants(matching: .any).matching(identifier: "round.prompt").firstMatch)
        tap("round.choice.4")
        XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "selected")
        attachScreenshot("19-reduced-effects-selection")
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        require(app.buttons["home.makeChallenge"])
    }

    func testSharedChallengeCodeRoundTripAndNativeResultSharing() {
        startChallenge()
        let answers = [1, 2, 3, 4, 5]
        var originalPrompts: [String] = []
        for answer in answers {
            originalPrompts.append(require(app.descendants(matching: .any).matching(identifier: "round.prompt").firstMatch).label)
            tap("round.choice.\(answer)")
            tap("round.next")
        }
        require(app.buttons["handoff.guess"])
        tap("handoff.share")

        let codeElement = require(app.staticTexts["share.code"].firstMatch)
        let code = codeElement.label
        XCTAssertTrue(code.hasPrefix("LK3-"), "Quick Game shares its five curated questions using LK3.")
        attachScreenshot("09-offline-challenge-code")
        tap("share.copy")
        XCTAssertTrue(app.buttons["share.copy"].firstMatch.label.contains("Copied"))
        tap("share.send")
        verifyAndDismissNativeShare(screenshotName: "10-native-challenge-share")
        require(app.buttons["share.send"])
        tap("nav.close")

        require(app.buttons["handoff.guess"])
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        tap("home.join")
        let input = require(app.descendants(matching: .any).matching(identifier: "join.code").firstMatch)
        input.tap()
        input.typeText(code)
        tap("join.play")
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "round.reveal").firstMatch.exists)
        for (index, answer) in answers.enumerated() {
            XCTAssertEqual(require(app.descendants(matching: .any).matching(identifier: "round.prompt").firstMatch).label, originalPrompts[index],
                           "Import must preserve each actual question and its order")
            tap("round.choice.\(answer)")
            tap("round.next")
            let reveal = require(app.descendants(matching: .any).matching(identifier: "round.reveal").firstMatch).label.lowercased()
            XCTAssertTrue(reveal.contains("you guessed \(answer)"))
            XCTAssertTrue(reveal.contains("picked \(answer)"))
            tap("round.next")
        }

        require(app.buttons["result.share"])
        XCTAssertTrue(app.staticTexts["100%"].exists, "The shared code must preserve the exact prompt order and answers.")
        tap("result.share")
        verifyAndDismissNativeShare(screenshotName: "11-native-result-card-share")
        require(app.buttons["result.home"])
        tap("result.rematch")
        tap("round.choice.3")
        tap("nav.close")
        tapAlert(identifier: "exit.cancel", label: "Keep playing")
        XCTAssertEqual(require(app.buttons["round.choice.3"].firstMatch).value as? String, "selected")
        tap("nav.close")
        tapAlert(identifier: "exit.confirm", label: "Leave game")
        require(app.buttons["home.makeChallenge"])
    }

    private func assertFivePreviewStatements(file: StaticString = #filePath, line: UInt = #line) {
        var statements: [String] = []
        for index in 1...5 {
            let row = require(app.staticTexts["fresh.preview.\(index)"].firstMatch, file: file, line: line)
            let text = row.label.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertFalse(text.isEmpty, "Every preview take must be readable", file: file, line: line)
            statements.append(text)
        }
        XCTAssertEqual(Set(statements).count, 5, "Preview should contain the five distinct takes", file: file, line: line)
    }

    private func startChallenge() {
        tap("home.makeChallenge")
        require(app.buttons["round.choice.1"])
        attachScreenshot("03-answer-round")
    }

    private func answerFive(_ answers: [Int]) {
        for answer in answers {
            tap("round.choice.\(answer)")
            tap("round.next")
        }
        require(app.buttons["handoff.guess"])
    }

    private func guessFive(_ guesses: [Int], captureReveal: Bool = false) {
        for (index, guess) in guesses.enumerated() {
            tap("round.choice.\(guess)")
            tap("round.next") // Lock the prediction and reveal the answer.
            require(app.descendants(matching: .any).matching(identifier: "round.reveal").firstMatch)
            XCTAssertFalse(app.buttons["round.choice.1"].exists, "The dedicated reveal stage should replace the choices.")
            if captureReveal && index == 0 { attachScreenshot("05-exact-read-reveal") }
            tap("round.next") // Advance from the reveal (or finish round five).
        }
    }

    @discardableResult
    private func require(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 8), "Expected \(element) to exist.", file: file, line: line)
        return element
    }

    private func tap(_ identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        if identifier == "join.play", app.buttons["join.done"].firstMatch.exists {
            app.buttons["join.done"].firstMatch.tap()
            let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 4), .completed)
        }
        let query = app.buttons.matching(identifier: identifier)
        require(query.firstMatch, file: file, line: line)
        // Presented sheets can leave same-identifier controls in the hidden
        // presenting view's tree. Interact with the visible control.
        let matches = query.allElementsBoundByIndex
        let element = matches.last(where: { $0.isHittable }) ?? matches.last!
        revealIfNeeded(element)
        XCTAssertTrue(element.isEnabled, "\(identifier) should be enabled.", file: file, line: line)
        element.tap()
        if identifier.hasPrefix("round.choice.") {
            XCTAssertEqual(element.value as? String, "selected", "A visible choice must register the tap.", file: file, line: line)
        }
    }

    private func tapAlert(identifier: String, label: String) {
        let alert = app.alerts.firstMatch
        require(alert)
        let identified = alert.buttons[identifier].firstMatch
        if identified.exists {
            identified.tap()
        } else {
            require(alert.buttons[label].firstMatch).tap()
        }
    }

    private func verifyAndDismissNativeShare(screenshotName: String) {
        // The app also uses the visible label “Close”, so exclude its custom
        // nav.close button when locating UIKit's activity-sheet dismissal.
        let nativeClose = app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != %@", "Close", "nav.close")).firstMatch
        let activityList = app.otherElements["ActivityListView"].firstMatch
        let copy = app.buttons["Copy"].firstMatch
        XCTAssertTrue(
            activityList.waitForExistence(timeout: 5) || nativeClose.waitForExistence(timeout: 3) || copy.waitForExistence(timeout: 3),
            "The iOS activity sheet should be presented."
        )
        attachScreenshot(screenshotName)
        if nativeClose.exists && nativeClose.isHittable {
            nativeClose.tap()
        } else {
            app.swipeDown()
        }
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func recordUnfilteredAccessibilityAudit(_ name: String) throws {
        var records: [[String: Any]] = []
        defer {
            let payload: [String: Any] = ["auditTypes": "all", "handlerAlwaysReturnsFalse": true, "issues": records]
            if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = name
                attachment.lifetime = .keepAlways
                add(attachment)
            } else {
                XCTFail("Could not serialize accessibility issue metadata")
            }
        }
        try app.performAccessibilityAudit(for: .all) { issue in
            var record: [String: Any] = [
                "auditType": issue.auditType.rawValue,
                "compactDescription": issue.compactDescription,
                "detailedDescription": issue.detailedDescription,
                "elementPresent": issue.element != nil
            ]
            if let element = issue.element {
                let exists = element.exists
                record["elementExists"] = exists
                if exists {
                    record["identifier"] = element.identifier
                    record["label"] = element.label
                    record["value"] = element.value.map { String(describing: $0) } ?? ""
                    record["elementType"] = element.elementType.rawValue
                    let frame = element.frame
                    if [frame.minX, frame.minY, frame.width, frame.height].allSatisfy({ $0.isFinite }) {
                        record["frame"] = ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
                    } else {
                        record["nonFiniteFrame"] = String(describing: frame)
                    }
                }
            }
            records.append(record)
            return false // Preserve every platform audit issue as a test failure.
        }
    }

    /// Small drags avoid jumping past a compact target when an accessibility
    /// size makes the surrounding content much taller than the viewport.
    private func revealWithSmallScrolls(_ element: XCUIElement) {
        guard let scroll = app.scrollViews.allElementsBoundByIndex.first else { return }
        for _ in 0..<20 {
            let frame = element.frame
            let visible = scroll.frame.intersection(app.frame).insetBy(dx: 0, dy: 30)
            if element.isHittable && visible.contains(frame) { return }
            let down = frame.midY > visible.midY
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.70 : 0.40))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.50 : 0.60))
            start.press(forDuration: 0.2, thenDragTo: end)
        }
    }

    private func revealIfNeeded(_ element: XCUIElement) {
        let scrolls = app.scrollViews.allElementsBoundByIndex
        let containing = scrolls.last { scroll in
            !element.identifier.isEmpty && scroll.descendants(matching: .any).matching(identifier: element.identifier).count > 0
        }
        if containing == nil, element.isHittable, app.frame.contains(element.frame) { return }
        guard let scroll = containing ?? scrolls.last(where: { $0.isHittable }) ?? scrolls.last else { return }
        for _ in 0..<20 {
            let frame = element.frame
            var top = max(scroll.frame.minY, app.frame.minY + 20)
            var bottom = min(scroll.frame.maxY, app.frame.maxY - 12)
            if element.identifier.hasPrefix("round.choice.") {
                // UIKit may report an offscreen SwiftUI button as hittable
                // where it intersects an inset. Keep the whole choice clear
                // of the pinned round header and CTA before tapping.
                let close = app.buttons["nav.close"].firstMatch
                let next = app.buttons["round.next"].firstMatch
                // Choices are now in a fixed dock outside the prompt scroll.
                top = app.frame.minY + 20
                bottom = app.frame.maxY - 12
                if close.exists { top = max(top, close.frame.maxY + 20) }
                if next.exists { bottom = min(bottom, next.frame.minY - 12) }
            }
            let fullyVisible = frame.minY >= top && frame.maxY <= bottom
            if element.isHittable && fullyVisible { return }
            // Small directional drags avoid overshooting a target in a long
            // preview, particularly on compact phones and at larger text sizes.
            let upwards = frame.midY >= (top + bottom) / 2
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: upwards ? 0.70 : 0.35))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: upwards ? 0.45 : 0.60))
            start.press(forDuration: 0.01, thenDragTo: end)
        }
    }
}
