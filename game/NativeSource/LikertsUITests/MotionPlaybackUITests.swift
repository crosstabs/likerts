import XCTest

/// Playback fixtures select a real GameSession's content, not a prerecorded
/// scene. These tests deliberately omit -ui-testing so normal animation and
/// action feedback are allowed to run. Root records the selected Simulator;
/// screenshots and passing assertions alone do not establish motion quality.
@MainActor
final class MotionPlaybackUITests: XCTestCase {
    private var app: XCUIApplication!
    private var events: [String] = []
    private var started: TimeInterval = 0

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        events = []
        started = ProcessInfo.processInfo.systemUptime
    }

    /// FIRST GATE: run and visually approve this complete 1001 round before
    /// starting the eight-example method or catalogue playback sampling.
    func testTradeSnackAnimatedRoundPlayback() {
        let arguments = ["-story-qa", "1001"]
        assertNoGlobalAnimationSuppression(arguments)
        launch(arguments)
        defer { attachEventLog("motion-1001-normal-event-log") }
        playOneRound(id: 1001, lane: "normal", questionDwell: 1.6,
                     selectionDwell: 0.8, revealDwell: 1.6, requireStoryScene: true)
    }

    /// Same controls, score and final meaning, with a DEBUG-only reduced-effects
    /// hook exercising the production reduction condition independently of
    /// Feel.testing. This does not change or verify the system setting.
    func testTradeSnackReducedMotionEquivalent() {
        let arguments = ["-story-qa", "1001", "-motion-reduced-qa"]
        assertNoGlobalAnimationSuppression(arguments)
        launch(arguments)
        defer { attachEventLog("motion-1001-reduced-event-log") }
        playOneRound(id: 1001, lane: "reduced", questionDwell: 1.2,
                     selectionDwell: 0.6, revealDwell: 1.2, requireStoryScene: true)
    }

    func testRobotEmblemContinuityPlayback() {
        let arguments = ["-motion-qa", "1954"]
        assertNoGlobalAnimationSuppression(arguments)
        launch(arguments)
        defer { attachEventLog("motion-1954-continuity-event-log") }
        playOneRound(id: 1954, lane: "robot-continuity", questionDwell: 1.0,
                     selectionDwell: 0.5, revealDwell: 1.8, requireStoryScene: true)
    }

    func testProtectBookSupportedMotionPlayback() {
        let arguments = ["-motion-qa", "1456"]
        assertNoGlobalAnimationSuppression(arguments)
        launch(arguments)
        defer { attachEventLog("motion-1456-supported-event-log") }
        playOneRound(id: 1456, lane: "supported-book-gap", questionDwell: 0.9,
                     selectionDwell: 0.5, revealDwell: 1.3, requireStoryScene: true)
    }

    func testCorrectedMovieScenePlayback() {
        launch(["-motion-qa", "1444"])
        defer { attachEventLog("motion-1444-corrected-event-log") }
        playOneRound(id: 1444, lane: "corrected-sofa", questionDwell: 0.9,
                     selectionDwell: 0.5, revealDwell: 1.5, requireStoryScene: true)
    }

    func testCorrectedProductionScenesPlayback() {
        defer { attachEventLog("motion-corrected-five-event-log") }
        for id in [1095, 1188, 1244, 1713, 1824] {
            launch(["-motion-qa", String(id)])
            playOneRound(id: id, lane: "corrected", questionDwell: 0.6,
                         selectionDwell: 0.4, revealDwell: 1.9, requireStoryScene: true)
        }
    }

    /// Semantic repairs and new asset-layer cases. A concurrent Simulator
    /// recording must be inspected for contact and visual truth separately.
    func testReviewedAndNewLayerScenesPlayback() {
        let ids = [1034, 1040, 1056, 1071, 1083, 1089, 1162, 1184, 1185,
                   1452, 1453, 1465, 1541, 1726, 1847, 1924]
        defer { attachEventLog("motion-reviewed-layers-event-log") }
        for id in ids {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            mark("reviewed-\(id)-question")
            tap("round.choice.4")
            dwell(0.3, purpose: "Allow neutral choice acknowledgement.")
            event("reviewed-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            require(node("story.scene.\(id)"))
            dwell(1.9, purpose: "Observe full motion and the settled reveal.")
            mark("reviewed-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
            XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled)
        }
    }

    func testSemanticRepairRetestPlayback() {
        let ids = [1040, 1056, 1149, 1162, 1184, 1453, 1726, 1847]
        defer { attachEventLog("motion-semantic-repair-event-log") }
        for id in ids {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle neutral selection.")
            event("repair-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.6, purpose: "Observe all authored action beats and scored reaction.")
            mark("repair-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    func testGiftBoxFinalPlacementPlayback() {
        launch(["-motion-qa", "1847"])
        defer { attachEventLog("motion-gift-box-final-event-log") }
        playOneRound(id: 1847, lane: "gift-final", questionDwell: 0.6,
                     selectionDwell: 0.4, revealDwell: 2.0, requireStoryScene: true)
    }

    /// Actual new candidates are individually recorded for contact/semantic
    /// review; a passing functional test does not approve their visuals.
    func testExistingLayerGapCandidatesPlayback() {
        let ids = [1006, 1037, 1059, 1061, 1086, 1097, 1099,
                   1257, 1278, 1307, 1350, 1475, 1482,
                   1669, 1685, 1687, 1724, 1739,
                   1906, 1922, 1950, 1992, 2000]
        defer { attachEventLog("motion-existing-gap-candidates-event-log") }
        for id in ids {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle the neutral selection.")
            event("gap-candidate-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.2, purpose: "Observe movement, support and scored reaction.")
            mark("gap-candidate-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    /// Candidate occlusions require a concurrent recording and frame review;
    /// a functional pass does not approve their contact or appearance.
    func testHomeOcclusionCandidatesPlayback() {
        defer { attachEventLog("motion-home-occlusion-event-log") }
        for id in [1275, 1279, 1300] {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            mark("occlusion-\(id)-question")
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle neutral choice feedback.")
            event("occlusion-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.3, purpose: "Review the full foreground occlusion and final state.")
            mark("occlusion-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    /// Provisional hinged clapper placement requires a real recording and
    /// per-frame visual review before either candidate is accepted.
    func testClapperCandidatesPlayback() {
        defer { attachEventLog("motion-clapper-candidates-event-log") }
        for id in [1405] {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            mark("clapper-\(id)-question")
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle neutral choice feedback.")
            event("clapper-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.3, purpose: "Inspect actual hinge alignment and semantic context.")
            mark("clapper-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    /// Candidate ticket occlusion is accepted only after native frame review.
    func testMovieHideTicketPlayback() {
        launch(["-motion-qa", "1448"])
        defer { attachEventLog("motion-movie-ticket-event-log") }
        let question = require(node("round.prompt")).label
        require(node("story.scene.1448"))
        mark("ticket-1448-question")
        tap("round.choice.4")
        dwell(0.3, purpose: "Settle neutral choice feedback.")
        event("ticket-1448-lock")
        tap("round.next")
        assertExactReveal(question: question)
        dwell(2.3, purpose: "Review ticket occlusion by the projector.")
        mark("ticket-1448-settled")
        tap("round.next")
        require(app.buttons["round.choice.1"].firstMatch)
    }

    /// Candidates need recorded native review; these assertions alone do not
    /// establish wheel support, projector activity or meaningful staging.
    func testMovieReelAndBeamCandidatesPlayback() {
        defer { attachEventLog("motion-movie-reel-beam-event-log") }
        for id in [1419, 1450] {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            mark("movie-\(id)-question")
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle neutral choice feedback.")
            event("movie-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.5, purpose: "Inspect object motion, support and meaning.")
            mark("movie-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    /// Functional execution is not visual acceptance; inspect actual playback
    /// for fragment contact, bowl occlusion and unchanged choice privacy.
    func testSnackFragmentsPlayback() {
        defer { attachEventLog("motion-snack-fragments-event-log") }
        for id in [1014, 1032] {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            mark("snack-\(id)-question")
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle neutral selection.")
            event("snack-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.5, purpose: "Inspect fragment placement and contact.")
            mark("snack-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    /// Book placements still require recorded native contact review.
    func testBookSupportCandidatesPlayback() {
        defer { attachEventLog("motion-book-support-event-log") }
        for id in [1478, 1488] {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            mark("book-support-\(id)-question")
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle neutral choice feedback.")
            event("book-support-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.3, purpose: "Review supported placement and final contact.")
            mark("book-support-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    /// Pillow placement remains provisional until recorded contact is reviewed.
    func testPillowSupportCandidatesPlayback() {
        defer { attachEventLog("motion-pillow-support-event-log") }
        for id in [1266, 1270] {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            mark("pillow-support-\(id)-question")
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle neutral choice feedback.")
            event("pillow-support-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.3, purpose: "Review pillow support and final contact.")
            mark("pillow-support-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    func testGapBatchContactRepairsPlayback() {
        let ids = [1059, 1099, 1278, 1307, 1669, 1687, 1739, 1992, 2000]
        defer { attachEventLog("motion-gap-contact-repairs-event-log") }
        for id in ids {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle neutral selection.")
            event("gap-repair-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.3, purpose: "Inspect full movement and supported final state.")
            mark("gap-repair-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    func testGapBatchCompactSupportPlayback() {
        let ids = [1278, 1307, 1992, 2000]
        defer { attachEventLog("motion-gap-compact-support-event-log") }
        for id in ids {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            tap("round.choice.4")
            dwell(0.3, purpose: "Settle neutral selection on compact phone.")
            event("compact-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            dwell(2.3, purpose: "Observe the scene and its supported final state.")
            mark("compact-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
        }
    }

    /// Run only after the breadth gate is coordinated. The app's DEBUG probe
    /// collects separate reveal/rest windows; root must retrieve and validate
    /// that JSON before reporting performance. This test does not infer FPS
    /// from a screen recording or from successful functional assertions.
    func testTradeSnackProfiledPlayback() {
        let arguments = ["-story-qa", "1001", "-motion-profile"]
        assertNoGlobalAnimationSuppression(arguments)
        launch(arguments)
        defer { attachEventLog("motion-1001-profile-event-log") }
        let question = require(node("round.prompt")).label
        require(node("story.scene.1001"))
        mark("motion-1001-profile-question")
        tap("round.choice.3")
        dwell(0.6, purpose: "Settle selection before the measured reveal.")
        tap("round.choice.4")
        dwell(0.6, purpose: "Settle selection before the measured reveal.")
        event("motion-1001-profile-lock")
        tap("round.next")
        // Do not issue app queries or screenshots during the two requested
        //1.2s windows and settle gap. The app's own clock owns those windows.
        dwell(4.5, purpose: "Quiet hold for reveal measurement, settle gap and rest baseline.")
        assertExactReveal(question: question)
        require(node("story.scene.1001"))
        mark("motion-1001-profile-after-quiet-hold")
        tap("round.next")
        require(app.buttons["round.choice.1"].firstMatch)
        XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled)
        tap("nav.close")
        tapAlert("exit.cancel")
        require(node("round.prompt"))
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
        mark("motion-1001-profile-exited")
    }

    /// Native XCTest rendering/CPU/memory measurements, separate from the
    /// callback probe and playback assertions. Root runs this after the breadth
    /// gate. Three measured iterations follow XCTest's discarded warm-up run.
    func testTradeSnackNativeHitchCPUAndMemoryMetrics() throws {
        guard #available(iOS 26.0, *) else {
            throw XCTSkip("XCTHitchMetric requires iOS26 or later. The separate callback probe does not substitute for native hitch measurements.")
        }
        let arguments = ["-story-qa", "1001"]
        assertNoGlobalAnimationSuppression(arguments)
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        options.invocationOptions = [.manuallyStart, .manuallyStop]
        var invocation = 0
        defer { attachEventLog("motion-1001-native-metric-event-log") }
        measure(metrics: [XCTHitchMetric(application: app),
                          XCTCPUMetric(application: app),
                          XCTMemoryMetric(application: app)], options: options) {
            invocation += 1
            // Launch, cold scene setup and choice changes stay outside the
            // measured lock-to-reveal interval. Do not enable -motion-profile;
            // its extra display-link sampling is a separate diagnostic run.
            launch(arguments)
            let question = require(node("round.prompt")).label
            require(node("story.scene.1001"))
            tap("round.choice.3")
            dwell(0.6, purpose: "Prepare the normal reveal before native measurement.")
            tap("round.choice.4")
            dwell(0.8, purpose: "Settle choice feedback outside native measurement.")
            let lock = require(app.buttons["round.next"].firstMatch)
            XCTAssertTrue(lock.isHittable && lock.isEnabled)
            event("native metrics invocation \(invocation): begin lock-to-reveal")

            startMeasuring()
            lock.tap()
            // No explicit app query, screenshot or logging occurs inside the
            // measured window. UIKit/XCTest's normal tap synchronization still
            // contributes to its actual duration; do not call this exactly1.4s.
            Thread.sleep(forTimeInterval: 1.4)
            stopMeasuring()

            event("native metrics invocation \(invocation): stopped")
            assertExactReveal(question: question)
            require(node("story.scene.1001"))
        }
    }

    /// LATER BREADTH GATE ONLY. Do not run this until both first-gate videos
    /// are inspected. It covers the eight authored examples, not 1,000 paths.
    func testEightRepresentativeMotionRounds() {
        let examples: [(id: Int, action: String)] = [
            (1001, "trade-snack"), (1051, "wonky-pancakes"),
            (1108, "cat-in-box"), (1208, "train-window"),
            (1456, "protect-book"), (1555, "pass-controller"),
            (1702, "inspect-sky"), (1954, "robot-emblem")
        ]
        defer { attachEventLog("motion-eight-examples-event-log") }
        for example in examples {
            let arguments = ["-motion-qa", String(example.id)]
            assertNoGlobalAnimationSuppression(arguments)
            launch(arguments)
            playOneRound(id: example.id, lane: example.action, questionDwell: 0.9,
                         selectionDwell: 0.5, revealDwell: 1.1,
                         requireStoryScene: vignetteIDs.contains(example.id))
        }
    }

    /// Production breadth sample: one newly mapped performance in each topic.
    /// Run with a concurrent Simulator recording; assertions are flow evidence,
    /// not an assertion that all thousand animations were visually reviewed.
    func testTwentyProductionTopicPerformances() {
        let ids = [1011, 1095, 1132, 1188, 1244,
                   1262, 1301, 1384, 1444, 1489,
                   1503, 1576, 1649, 1679, 1713,
                   1774, 1824, 1864, 1928, 1987]
        defer { attachEventLog("motion-production-twenty-topics-event-log") }
        for id in ids {
            launch(["-motion-qa", String(id)])
            let question = require(node("round.prompt")).label
            require(node("story.scene.\(id)"))
            mark("production-\(id)-question")
            tap("round.choice.3")
            dwell(0.3, purpose: "Observe neutral selection response.")
            tap("round.choice.4")
            dwell(0.3, purpose: "Observe the same response for a different value.")
            event("production-\(id)-lock")
            tap("round.next")
            assertExactReveal(question: question)
            require(node("story.scene.\(id)"))
            dwell(1.7, purpose: "Finish the authored reveal and scored reaction before advancing.")
            mark("production-\(id)-settled")
            tap("round.next")
            require(app.buttons["round.choice.1"].firstMatch)
            XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled)
            XCTAssertNotEqual(require(node("round.prompt")).label, question)
        }
    }

    private func playOneRound(id: Int, lane: String, questionDwell: TimeInterval,
                              selectionDwell: TimeInterval, revealDwell: TimeInterval,
                              requireStoryScene: Bool) {
        let prefix = "motion-\(id)-\(lane)"
        let question = require(node("round.prompt")).label
        XCTAssertFalse(question.isEmpty)
        if requireStoryScene { require(node("story.scene.\(id)")) }
        require(app.buttons["round.choice.3"].firstMatch)
        mark("\(prefix)-01-question")
        dwell(questionDwell, purpose: "Read the question and let any eligible notice cue settle.")

        tap("round.choice.3")
        XCTAssertEqual(app.buttons["round.choice.3"].firstMatch.value as? String, "selected")
        mark("\(prefix)-02-selection-3")
        dwell(selectionDwell, purpose: "Observe a value-independent selection acknowledgement.")

        tap("round.choice.4")
        XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "selected")
        XCTAssertTrue(require(app.buttons["round.next"].firstMatch).isEnabled)
        mark("\(prefix)-03-selection-4")
        dwell(selectionDwell, purpose: "Observe the second explicit selection and rest state.")

        event("\(prefix)-lock-prediction")
        tap("round.next")
        assertExactReveal(question: question)
        if requireStoryScene { require(node("story.scene.\(id)")) }
        XCTAssertFalse(app.buttons["round.choice.1"].exists)
        mark("\(prefix)-04-exact-reveal")
        dwell(revealDwell, purpose: "Observe the exchange/reaction, follow-through and settled result.")
        assertExactReveal(question: question)

        event("\(prefix)-advance")
        tap("round.next")
        require(app.buttons["round.choice.1"].firstMatch)
        XCTAssertNotEqual(require(node("round.prompt")).label, question)
        XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "not selected")
        XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled)
        mark("\(prefix)-05-next-round-reset")
        dwell(0.6, purpose: "Observe a clean new question without the previous prediction.")

        tap("nav.close")
        tapAlert("exit.cancel")
        require(node("round.prompt"))
        XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled)
        event("\(prefix)-leave-cancelled")
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
        mark("\(prefix)-06-exited-to-home")
    }

    private func assertNoGlobalAnimationSuppression(_ arguments: [String],
                                                  file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(arguments.contains("-ui-testing"), file: file, line: line)
        XCTAssertFalse(arguments.contains("-accessible-effects"), file: file, line: line)
    }

    private func launch(_ arguments: [String]) {
        if app.state != .notRunning { app.terminate() }
        app.launchArguments = arguments
        event("launch \(arguments.joined(separator: " "))")
        app.launch()
        require(node("round.prompt"))
    }

    private func assertExactReveal(question: String,
                                   file: StaticString = #filePath, line: UInt = #line) {
        let spoken = require(node("round.reveal"), file: file, line: line).label.lowercased()
        XCTAssertTrue(spoken.contains("you guessed 4"), spoken, file: file, line: line)
        XCTAssertTrue(spoken.contains("alex picked 4"), spoken, file: file, line: line)
        XCTAssertTrue(spoken.contains("100 points"), spoken, file: file, line: line)
        XCTAssertTrue(spoken.contains(question.lowercased()), "Reveal must retain the real statement: \(spoken)", file: file, line: line)
    }

    private func dwell(_ seconds: TimeInterval, purpose: String) {
        precondition(seconds > 0 && seconds <= 5)
        event(String(format: "dwell %.2fs — %@", seconds, purpose))
        // This sleeps only the XCTest driver process. It does not pause the
        // app's main run loop, reduce animation speed or disable quiescence.
        Thread.sleep(forTimeInterval: seconds)
    }

    private func mark(_ name: String) {
        event(name)
        XCTContext.runActivity(named: name) { activity in
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = name
            capture.lifetime = .keepAlways
            activity.add(capture)
        }
    }

    private func event(_ description: String) {
        let elapsed = ProcessInfo.processInfo.systemUptime - started
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let timestamp = formatter.string(from: Date())
        events.append(String(format: "%.3fs\t%@\t%@", elapsed, timestamp, description))
    }

    private func attachEventLog(_ name: String) {
        let note = "Playback actions and requested dwell times. Functional assertions/screenshots do not prove motion quality; review the concurrently recorded Simulator video.\n\n" + events.joined(separator: "\n")
        let attachment = XCTAttachment(string: note)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func node(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    @discardableResult
    private func require(_ element: XCUIElement,
                         file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 8), "Expected \(element) to exist.", file: file, line: line)
        return element
    }

    private func tap(_ identifier: String,
                     file: StaticString = #filePath, line: UInt = #line) {
        let query = app.buttons.matching(identifier: identifier)
        require(query.firstMatch, file: file, line: line)
        let button = query.allElementsBoundByIndex.first(where: { $0.isHittable }) ?? query.firstMatch
        XCTAssertTrue(button.isHittable, "\(identifier) should be reachable without scrolling during playback.", file: file, line: line)
        XCTAssertTrue(button.isEnabled, file: file, line: line)
        event("tap \(identifier)")
        button.tap()
    }

    private func tapAlert(_ identifier: String) {
        event("tap alert \(identifier)")
        require(require(app.alerts.firstMatch).buttons[identifier].firstMatch).tap()
    }

    // The later eight-example route includes both authored story overrides and
    // legacy-topic graph paths. Only these known examples use a story scene.
    private var vignetteIDs: Set<Int> { [1001, 1108, 1208] }
}
