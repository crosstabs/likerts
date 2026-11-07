import XCTest

/// DEBUG-only cue traces validate event timing and privacy, not speaker output.
/// Tests restore all three user-facing preferences after each run.
@MainActor
final class AudioExperienceUITests: XCTestCase {
    private var app: XCUIApplication!
    private let preferenceIDs = ["settings.music", "settings.sound", "settings.haptics"]
    private var original: [String: Bool] = [:]

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-audio-probe"]
        app.launch()
        require(app.buttons["home.settings"].firstMatch)
        openSettings()
        for id in preferenceIDs { original[id] = switchValue(id) }
        tap("nav.close")
    }

    override func tearDownWithError() throws {
        // Leave the simulator's existing sound choices as we found them.
        if app.state != .runningForeground { app.launch() }
        if !app.buttons["home.settings"].firstMatch.exists {
            app.terminate()
            app.launchArguments = ["-ui-testing", "-audio-probe"]
            app.launch()
        }
        if app.buttons["home.settings"].firstMatch.waitForExistence(timeout: 5) {
            openSettings()
            for id in preferenceIDs {
                guard let desired = original[id], app.switches[id].firstMatch.exists else { continue }
                setSwitch(id, to: desired)
            }
            if app.buttons["nav.close"].firstMatch.exists { tap("nav.close") }
        }
    }

    func testIndependentControlsPersistAndSilentGameRemainsPlayable() {
        openSettings()
        setSwitch("settings.music", to: false)
        setSwitch("settings.sound", to: false)
        setSwitch("settings.haptics", to: false)
        tap("nav.close")
        app.terminate(); app.launch()
        openSettings()
        for id in preferenceIDs { XCTAssertFalse(switchValue(id), "\(id) should persist after relaunch") }
        // Music and effects remain independent when changing one switch.
        setSwitch("settings.music", to: true)
        XCTAssertTrue(switchValue("settings.music"))
        XCTAssertFalse(switchValue("settings.sound"))
        XCTAssertFalse(switchValue("settings.haptics"))
        setSwitch("settings.music", to: false)
        tap("nav.close")

        tap("home.makeChallenge")
        tap("round.choice.4")
        XCTAssertTrue(trace().contains("suppressed:choice"))
        tap("round.next")
        XCTAssertTrue(trace().contains("suppressed:lock"))
        tap("nav.close")
        tapAlert("exit.cancel")
        require(app.buttons["round.choice.1"].firstMatch)
        XCTAssertFalse(trace().contains("accepted:exact"))
        XCTAssertFalse(trace().contains("accepted:near"))
        XCTAssertFalse(trace().contains("accepted:far"))
        tap("nav.close")
        tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    func testBlindPartyEmitsNoOutcomeBeforeHostHandBack() {
        openSettings(); setSwitch("settings.sound", to: true); setSwitch("settings.music", to: false); tap("nav.close")
        tap("home.party")
        require(app.textFields["party.hostName"].firstMatch)
        tap("party.beginHost")
        for value in [1, 2, 3, 4, 5] { tap("round.choice.\(value)"); tap("round.next") }
        require(app.textFields["party.friendName"].firstMatch)
        tap("party.beginFriend")
        for value in [1, 2, 3, 4, 5] {
            tap("round.choice.\(value)"); tap("round.next")
            assertNoOutcome(trace())
        }
        require(app.buttons["party.handBack"].firstMatch)
        assertNoOutcome(trace())
        tap("party.handBack")
        require(node("party.board"))
        XCTAssertTrue(trace().contains("accepted:results"))
    }

    func testMuteDuringRoundImmediatelyChangesSubsequentCueAdmission() {
        openSettings(); setSwitch("settings.sound", to: true); setSwitch("settings.music", to: false); tap("nav.close")
        tap("home.makeChallenge")
        tap("round.choice.3")
        XCTAssertTrue(trace().contains("accepted:choice"))
        tap("round.settings")
        require(app.switches["settings.sound"].firstMatch)
        setSwitch("settings.sound", to: false)
        tap("nav.close")
        tap("round.choice.4")
        XCTAssertTrue(trace().contains("suppressed:choice"))
        tap("round.next")
        XCTAssertTrue(trace().contains("suppressed:lock"))
        XCTAssertFalse(app.buttons["round.next"].firstMatch.isEnabled)
    }

    /// Run on a compact Simulator: the game and settings remain usable at an
    /// accessibility text size even with every feedback channel silent.
    func testCompactLargeTextSettingsChoicesAndScoreRemainAccessible() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-audio-probe", "-topic-qa", "future", "-large-text", "-accessible-effects"]
        app.launch()
        require(app.buttons["round.settings"].firstMatch)
        XCTAssertTrue(app.buttons["round.settings"].firstMatch.isHittable)
        tap("round.settings")
        for id in preferenceIDs {
            let control = require(app.switches[id].firstMatch)
            revealByScrolling(control)
            XCTAssertTrue(control.isHittable, "\(id) must be reachable at larger text sizes")
        }
        // The controls are real interactive switches. Restore each value in
        // the sheet so this test never changes the simulator's preferences.
        let sound = require(app.switches["settings.sound"].firstMatch)
        revealByScrolling(sound)
        let previous = switchValue("settings.sound")
        setSwitch("settings.sound", to: !previous)
        setSwitch("settings.sound", to: previous)
        attachScreenshot("audio-compact-large-text-settings")
        // The sheet header can scroll offscreen at accessibility sizes.
        // There may also be a non-hittable round close button behind it.
        let closeQuery = app.buttons.matching(identifier: "nav.close")
        let sheetClose = require(closeQuery.allElementsBoundByIndex.last ?? closeQuery.firstMatch)
        revealByScrolling(sheetClose)
        XCTAssertTrue(sheetClose.isHittable, "Settings close must remain reachable at large text sizes")
        sheetClose.tap()
        for value in 1...5 {
            let choice = require(app.buttons["round.choice.\(value)"].firstMatch)
            revealByScrolling(choice)
            XCTAssertTrue(choice.isHittable, "Choice \(value) must be reachable on a compact phone")
        }
        tap("round.choice.2")
        tap("round.choice.4")
        XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "selected")
        attachScreenshot("audio-compact-large-text-choice")
        tap("round.next")
        let reveal = require(node("round.reveal"))
        let spoken = reveal.label.lowercased()
        XCTAssertTrue(spoken.contains("you guessed 4"), spoken)
        XCTAssertTrue(spoken.contains("alex picked 4"), spoken)
        XCTAssertTrue(spoken.contains("100 points"), spoken)
        attachScreenshot("audio-compact-large-text-score")
        // At accessibility sizes the reveal and action share one scrollable
        // flow, so the button may legitimately start below the viewport.
        let next = require(app.buttons["round.next"].firstMatch)
        revealByScrolling(next)
        XCTAssertTrue(next.isHittable, "Next must remain reachable by scrolling at larger text sizes")
        attachScreenshot("audio-compact-large-text-next-visible")
        tap("round.next")
        require(app.buttons["round.choice.1"].firstMatch)
    }

    /// Run with a concurrent local screen recording. Unlike the deterministic
    /// probe tests this omits -ui-testing, allowing AVAudioPlayer to start.
    /// A started player is not evidence that a human heard the output.
    func testNormalRoundStartsAudioPlayers() {
        openSettings(); setSwitch("settings.sound", to: true); setSwitch("settings.music", to: true); tap("nav.close")
        app.terminate()
        app.launchArguments = ["-audio-probe", "-motion-qa", "1001"]
        app.launch()
        require(app.buttons["round.choice.4"].firstMatch)
        XCTAssertFalse(trace().contains("started:"), "Launch itself must remain quiet")
        tap("round.choice.3")
        let startedChoice = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "started:choice"), object: node("audio.probe"))
        XCTAssertEqual(XCTWaiter.wait(for: [startedChoice], timeout: 4), .completed)
        tap("round.choice.4")
        assertNoOutcome(trace())
        tap("round.next")
        require(node("round.reveal"))
        let startedReveal = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "started:exact"), object: node("audio.probe"))
        XCTAssertEqual(XCTWaiter.wait(for: [startedReveal], timeout: 4), .completed)
        let attachment = XCTAttachment(string: trace())
        attachment.name = "audio-round-event-trace"
        attachment.lifetime = .keepAlways
        add(attachment)
        tap("round.next")
        require(app.buttons["round.choice.1"].firstMatch)
        tap("nav.close"); tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    /// Exercises the real quick-game path rather than a QA fixture. Prewarming
    /// may configure the local session but must never play before a choice.
    /// The recorded interval is a Simulator diagnostic, not measured latency
    /// at the user's speaker or proof of perceptual responsiveness.
    func testNormalQuickGamePrewarmIsQuietAndFirstChoiceStarts() throws {
        openSettings(); setSwitch("settings.sound", to: true); setSwitch("settings.music", to: false); tap("nav.close")
        app.terminate()
        app.launchArguments = ["-audio-probe"]
        app.launch()
        require(app.buttons["home.makeChallenge"].firstMatch)
        XCTAssertFalse(trace().contains("started:"), "Launching the app must be silent")
        XCTAssertFalse(trace().contains("prewarm:requested"), "Prewarming must wait for explicit play")
        tap("home.makeChallenge")
        require(app.buttons["round.choice.3"].firstMatch)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "prewarm:ready"), object: node("audio.probe"))
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 8), .completed, "Audio preparation should finish after an explicit game start")
        XCTAssertTrue(trace().contains("prewarm:requested"))
        XCTAssertFalse(trace().contains("started:"), "Prewarming must not play audio")
        tap("round.choice.3")
        let started = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "started:choice"), object: node("audio.probe"))
        XCTAssertEqual(XCTWaiter.wait(for: [started], timeout: 4), .completed)
        let log = trace()
        let pattern = try NSRegularExpression(pattern: #"(?:accepted|started):choice @([0-9.]+)"#)
        let matches = pattern.matches(in: log, range: NSRange(log.startIndex..<log.endIndex, in: log))
        XCTAssertEqual(matches.count, 2, "Expected one accepted choice and one player start")
        var intervalDescription = "unavailable"
        if matches.count == 2, let a = Range(matches[0].range(at: 1), in: log), let b = Range(matches[1].range(at: 1), in: log),
           let accepted = Double(log[a]), let played = Double(log[b]) {
            XCTAssertGreaterThanOrEqual(played, accepted)
            intervalDescription = String(format: "%.3f ms", (played - accepted) * 1000)
        }
        let attachment = XCTAttachment(string: "Accepted-to-player-start: \(intervalDescription)\n\n" + log)
        attachment.name = "audio-prewarmed-first-choice-trace"
        attachment.lifetime = .keepAlways
        add(attachment)
        tap("nav.close"); tapAlert("exit.confirm")
        require(app.buttons["home.makeChallenge"].firstMatch)
    }

    func testOutcomeCueOccursOnlyAfterLockAndRedrawDoesNotReplay() {
        openSettings(); setSwitch("settings.sound", to: true); setSwitch("settings.music", to: false); tap("nav.close")
        app.terminate()
        app.launchArguments = ["-ui-testing", "-audio-probe", "-motion-qa", "1001"]
        app.launch()
        require(app.buttons["round.choice.4"].firstMatch)
        assertNoOutcome(trace())
        // The QA fixture starts with 4 selected; change it to exercise a real tap.
        tap("round.choice.3"); tap("round.choice.4")
        XCTAssertTrue(trace().contains("accepted:choice"))
        assertNoOutcome(trace())
        tap("round.next")
        require(node("round.reveal"))
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "accepted:exact"), object: node("audio.probe"))
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 3), .completed)
        let before = trace().components(separatedBy: "accepted:exact").count - 1
        XCTAssertEqual(before, 1)
        // Querying and reopening the exit confirmation must not replay outcome.
        _ = node("round.reveal").label
        tap("nav.close"); tapAlert("exit.cancel")
        XCTAssertEqual(trace().components(separatedBy: "accepted:exact").count - 1, before)
    }

    /// The completed-game fixture opens a real standalone result view without
    /// replaying a result cue. Only the explicit rematch action emits its cue.
    func testStandaloneRematchCueOccursOnce() {
        openSettings(); setSwitch("settings.sound", to: true); setSwitch("settings.music", to: false); tap("nav.close")
        app.terminate()
        app.launchArguments = ["-ui-testing", "-audio-probe", "-story-results-qa"]
        app.launch()
        require(app.buttons["result.rematch"].firstMatch)
        require(node("audio.probe"))
        XCTAssertFalse(trace().contains("accepted:results"), "Opening a result fixture must not replay its cue")
        XCTAssertFalse(trace().contains("accepted:rematch"), "Rematch requires an explicit tap")

        tap("result.rematch")
        require(app.buttons["round.choice.1"].firstMatch)
        let rematch = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "accepted:rematch"), object: node("audio.probe"))
        XCTAssertEqual(XCTWaiter.wait(for: [rematch], timeout: 3), .completed)
        tap("round.choice.1")
        XCTAssertEqual(trace().components(separatedBy: "accepted:rematch").count - 1, 1,
                       "Navigating and selecting in the new round must not replay rematch")
    }

    func testNearAndFarRemainNeutralUntilLock() {
        openSettings(); setSwitch("settings.sound", to: true); setSwitch("settings.music", to: false); tap("nav.close")
        for (value, cue) in [(3, "near"), (1, "far")] {
            app.terminate(); app.launchArguments = ["-ui-testing", "-audio-probe", "-motion-qa", "1001"]; app.launch()
            require(app.buttons["round.choice.\(value)"].firstMatch)
            tap("round.choice.\(value)")
            assertNoOutcome(trace())
            tap("round.next")
            require(node("round.reveal"))
            let expected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "accepted:" + cue), object: node("audio.probe"))
            XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: 3), .completed)
        }
    }

    func testSceneSoundStartsOnlyAfterVisibleReveal() {
        openSettings(); setSwitch("settings.sound", to: true); setSwitch("settings.music", to: false); tap("nav.close")
        app.terminate(); app.launchArguments = ["-ui-testing", "-audio-probe", "-motion-qa", "1083"]; app.launch()
        require(app.buttons["round.choice.4"].firstMatch)
        tap("round.choice.3")
        XCTAssertFalse(trace().contains("accepted:scenePlace"))
        tap("round.next"); require(node("round.reveal"))
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "accepted:scenePlace"), object: node("audio.probe"))
        XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: 3), .completed)
        let count = trace().components(separatedBy: "accepted:scenePlace").count - 1
        XCTAssertEqual(count, 1)
        _ = node("round.reveal").label
        XCTAssertEqual(trace().components(separatedBy: "accepted:scenePlace").count - 1, count)
    }

    private func assertNoOutcome(_ value: String, file: StaticString = #filePath, line: UInt = #line) {
        for cue in ["exact", "near", "far", "results"] {
            XCTAssertFalse(value.contains("accepted:" + cue), "Premature outcome cue \(cue)", file: file, line: line)
        }
    }
    private func node(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    private func trace() -> String { let element = node("audio.probe"); return element.exists ? element.label : "" }
    private func openSettings() { tap("home.settings"); require(app.switches["settings.sound"].firstMatch) }
    private func switchValue(_ id: String) -> Bool {
        let value = require(app.switches[id].firstMatch).value as? String
        XCTAssertTrue(value == "0" || value == "1", "Unexpected switch value for \(id): \(String(describing: value))")
        return value == "1"
    }
    private func setSwitch(_ id: String, to value: Bool) {
        if switchValue(id) != value { app.switches[id].firstMatch.tap() }
        XCTAssertEqual(switchValue(id), value)
    }
    private func revealByScrolling(_ element: XCUIElement) {
        guard !element.isHittable else { return }
        for _ in 0..<8 {
            let scrolls = app.scrollViews.allElementsBoundByIndex
            guard let scroll = scrolls.first(where: { $0.isHittable }) ?? scrolls.first else { break }
            if element.frame.minY < scroll.frame.minY { scroll.swipeDown() } else { scroll.swipeUp() }
            if element.isHittable { return }
        }
    }
    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    @discardableResult private func require(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 8), "Expected \(element)", file: file, line: line)
        return element
    }
    private func tap(_ id: String) {
        let query = app.buttons.matching(identifier: id)
        require(query.firstMatch)
        let element = query.allElementsBoundByIndex.first(where: { $0.isHittable }) ?? query.firstMatch
        XCTAssertTrue(element.isHittable); element.tap()
    }
    private func tapAlert(_ id: String) { require(require(app.alerts.firstMatch).buttons[id].firstMatch).tap() }
}
