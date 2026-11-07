import XCTest
import Foundation
import Security

/// Explicitly opt-in tests against an isolated loopback backend. No production host is accepted.
@MainActor final class LiveRoomUITests: XCTestCase {
    private var app: XCUIApplication!
    private var base: URL!
    private let network = URLSession(configuration: .ephemeral)
    private var isSafariCleanupCase: Bool { name.contains("testSafariOwnedTabCleanupCapability") }
    private var isSafariPositioningCase: Bool { name.contains("testSafariInitialPositioningDiagnostic") }
    private var requiresAutomaticSafariHeader: Bool { name.contains("testSafariBrowserHostedRoomCrossplayAutomaticHeader") }
    private var isSafariCase: Bool { name.contains("testSafariBrowserHostedRoomCrossplay") || isSafariCleanupCase || isSafariPositioningCase }
    private var positioningExpectedVariant: String?
    private var safariOwnedTabActive = false
    private var safariOwnedPageConfirmed = false
    private var safariPriorOwnedRooms: [String] = []

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard let text = ProcessInfo.processInfo.environment["LIKERTS_LIVE_TEST_BASE_URL"], let url = URL(string: text),
              ["http", "https"].contains(url.scheme), ["127.0.0.1", "localhost", "::1", "[::1]"].contains(url.host),
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else {
            throw XCTSkip("Set LIKERTS_LIVE_TEST_BASE_URL to an isolated loopback live service to run native multiplayer UI checks.")
        }
        base = url
        if isSafariCase {
            guard url.scheme == "http", url.host == "127.0.0.1", url.port == 4783 else {
                throw XCTSkip("Safari requires the owned numeric-loopback service on4783 before any app activation.")
            }
            let environment = ProcessInfo.processInfo.environment
            if requiresAutomaticSafariHeader {
                guard environment["SIMULATOR_UDID"] == "78680FA8-DE77-41F8-9948-7D20D57A6340",
                      environment["LIKERTS_LIVE_SAFARI_VIEWPORT_DIAGNOSTIC"] != "1",
                      environment["LIKERTS_LIVE_SAFARI_TOP_REACHABILITY_DIAGNOSTIC"] != "1",
                      environment["LIKERTS_SAFARI_POSITIONING_DIAGNOSTIC"] != "1",
                      environment["LIKERTS_LIVE_SAFARI_CLEANUP_CAPABILITY"] != "1" else {
                    throw XCTSkip("Automatic product-header acceptance must run without diagnostic or cleanup modes before activation.")
                }
            }
            if isSafariPositioningCase {
                guard environment["LIKERTS_SAFARI_POSITIONING_DIAGNOSTIC"] == "1",
                      environment["SIMULATOR_UDID"] == "78680FA8-DE77-41F8-9948-7D20D57A6340",
                      let variant = environment["LIKERTS_SAFARI_POSITIONING_VARIANT"],
                      variant.range(of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression) != nil,
                      environment["LIKERTS_LIVE_SAFARI_VIEWPORT_DIAGNOSTIC"] != "1",
                      environment["LIKERTS_LIVE_SAFARI_TOP_REACHABILITY_DIAGNOSTIC"] != "1",
                      environment["LIKERTS_LIVE_SAFARI_CLEANUP_CAPABILITY"] != "1" else {
                    throw XCTSkip("Positioning diagnosis requires explicit DIAG and variant, the approved Simulator, and no other Safari mode before activation.")
                }
                positioningExpectedVariant = variant
            }
            let code: String?
            if isSafariCleanupCase {
                guard environment["LIKERTS_LIVE_SAFARI_CLEANUP_CAPABILITY"] == "1" else {
                    throw XCTSkip("Owned-tab cleanup requires explicit LIKERTS_LIVE_SAFARI_CLEANUP_CAPABILITY=1 before any activation.")
                }
                code = nil
            } else {
                guard let supplied = environment["LIKERTS_LIVE_SAFARI_ROOM"],
                      supplied.range(of: "^[A-HJ-NP-Z2-9]{6}$", options: .regularExpression) != nil else {
                    throw XCTSkip("Safari's game journey requires an explicit fresh LIKERTS_LIVE_SAFARI_ROOM before activation.")
                }
                code = supplied
            }
            guard environment["LIKERTS_LIVE_SAFARI_TOP_REACHABILITY_DIAGNOSTIC"] != "1" ||
                    environment["LIKERTS_LIVE_SAFARI_VIEWPORT_DIAGNOSTIC"] == "1" else {
                throw XCTSkip("The ordinary-scroll diagnosis requires the explicit read-only viewport diagnostic gate before activation.")
            }
            let list = environment["LIKERTS_LIVE_SAFARI_PREVIOUS_ROOMS"]
            let single = environment["LIKERTS_LIVE_SAFARI_PREVIOUS_ROOM"]
            guard list == nil || single == nil else {
                throw XCTSkip("Supply either the bounded owned-room list or the one-room fallback, not both.")
            }
            let prior = list.map { $0.split(separator: ",", omittingEmptySubsequences: false).map(String.init) }
                ?? single.map { [$0] } ?? []
            guard prior.count <= 16, (list == nil || !prior.isEmpty), Set(prior).count == prior.count,
                  prior.allSatisfy({ $0.count == 6 && $0.range(of: "^[A-HJ-NP-Z2-9]{6}$", options: .regularExpression) != nil && (code == nil || $0 != code) }) else {
                throw XCTSkip("Prior-owned-room cleanup requires at most sixteen unique six-character QA codes, excluding the fresh room, before activation.")
            }
            guard !isSafariCleanupCase || !prior.isEmpty else {
                throw XCTSkip("Owned-tab cleanup requires a nonempty explicit ordered list of known QA room codes before activation.")
            }
            safariPriorOwnedRooms = prior
            app = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
            return
        }
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-live-testing", "-live-base-url", url.absoluteString]
        // App-local AX3/reduced-effects launch flags; no global accessibility setting changes.
        if ProcessInfo.processInfo.environment["LIKERTS_LIVE_TEST_LARGE_TEXT"] == "1" {
            app.launchArguments += ["-large-text", "-accessible-effects"]
        }
        app.launch()
        try tap("home.live")
        // Each isolated loopback case starts through the same user-facing recovery controls.
        // Keychain access survives app termination, including a previous failed UI case.
        if app.buttons["live.forget"].waitForExistence(timeout: 2) {
            try tap("live.forget")
            try confirmationButton("Forget this device's access").tap()
            try require(app.buttons["live.create"])
        }
    }
    override func tearDown() {
        // Safari's process and unrelated tabs are preserved. Game/diagnostic
        // cases leave their known QA tabs open. Only the separate explicitly
        // gated cleanup capability may close confirmed owned tabs.
        if !isSafariCase { app?.terminate() }
        app = nil
    }

    /// Real Safari controls and real external Chrome host/Sam actions only.
    /// No JavaScript, DOM driver, direct peer API action or browser preference.
    func testSafariBrowserHostedRoomCrossplayAutomaticHeader() async throws {
        // Share every game/privacy/score assertion, but prohibit header repair.
        try await testSafariBrowserHostedRoomCrossplay()
    }

    func testSafariBrowserHostedRoomCrossplay() async throws {
        let code = try XCTUnwrap(ProcessInfo.processInfo.environment["LIKERTS_LIVE_SAFARI_ROOM"])
        var parts = try XCTUnwrap(URLComponents(url: base.appendingPathComponent("play"), resolvingAgainstBaseURL: false))
        parts.queryItems = [URLQueryItem(name: "room", value: code)]
        let invite = try XCTUnwrap(parts.url)
        defer {
            if safariOwnedTabActive && safariOwnedPageConfirmed {
                let tree = XCTAttachment(string: app.debugDescription)
                tree.name = "safari-final-native-hierarchy"; tree.lifetime = .keepAlways; add(tree)
                attachScreenshot("safari-final-state")
            }
        }
        app.activate()
        try safariTabCommand(["New Tab", "New tab"])
        safariOwnedTabActive = true
        var fields = app.textFields.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        if fields.count != 1 {
            let address = try safariVisible(app.buttons.matching(NSPredicate(format: "label IN %@ OR identifier IN %@",
                ["Address", "Search or enter website name", "URL"], ["URL", "Address"])), stage: "Safari's fresh-tab address control")
            address.tap()
            fields = app.textFields.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        }
        guard fields.count == 1 else { throw safariFailure("A fresh normal Safari tab must expose one address field") }
        fields[0].tap(); fields[0].typeText(invite.absoluteString + "\n")
        try require(safariText("Join your people."))
        safariOwnedPageConfirmed = true
        if requiresAutomaticSafariHeader { try safariRequireUninstrumentedProductPage() }
        let room = try safariVisible(app.webViews.textFields.matching(NSPredicate(format: "label == %@ OR identifier == %@", "Room code", "room-code")), stage: "the web room-code field")
        guard room.value as? String == code else { throw safariFailure("The visible room code must match the explicit owned room before joining") }
        let nickname = try safariVisible(app.webViews.textFields.matching(NSPredicate(format: "label == %@ OR identifier == %@", "Your name", "nickname")), stage: "the web nickname field")
        nickname.tap(); nickname.typeText("SafariQA")
        guard nickname.value as? String == "SafariQA" else { throw safariFailure("The synthetic nickname must be confirmed before consenting") }
        if app.keyboards.firstMatch.exists {
            let done = try safariVisible(app.buttons.matching(NSPredicate(format: "label == %@", "Done")), stage: "Safari's keyboard Done control")
            done.tap()
        }
        let consentCopy = "I’m happy to share my nickname and revealed rounds with this room."
        let consentQuery = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label == %@", "room-sharing", consentCopy))
        let inputs = consentQuery.allElementsBoundByIndex.filter { $0.elementType == .checkBox || $0.elementType == .switch }
        guard inputs.count == 1 else { throw safariFailure("Safari must expose the actual labelled sharing checkbox") }
        let consent = inputs[0]
        try safariReveal(consent)
        guard !consent.isSelected && (consent.value as? String) != "1" else { throw safariFailure("Sharing must start unchecked in the fresh tab") }
        consent.tap()
        let checked = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '1' OR value == 'true' OR selected == true"), object: consent)
        guard await XCTWaiter.fulfillment(of: [checked], timeout: 5) == .completed else { throw safariFailure("The explicit sharing choice must become checked") }
        try safariTapWeb("Join room")
        if requiresAutomaticSafariHeader { try await safariCaptureAutomaticHeaderBurst() }
        if requiresAutomaticSafariHeader { try safariRequireUninstrumentedProductPage() }
        // Safari exposes the line-broken h1 as an Other with separate child
        // StaticTexts. Match its observed combined heading without dropping
        // the nickname, exact room or two-player lobby checks.
        let joined = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "You’re in", "SafariQA")).firstMatch
        try require(joined)
        try require(safariText("Room \(code)"))
        try require(safariText("2 friends"))
        let viewportDiagnosis = ProcessInfo.processInfo.environment["LIKERTS_LIVE_SAFARI_VIEWPORT_DIAGNOSTIC"] == "1"
        if viewportDiagnosis {
            try safariHeaderGeometry(enforceSafeArea: false)
            attachScreenshot("safari-viewport-diagnostic-header")
            let region = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "identifier == %@ OR label BEGINSWITH %@", "qa-viewport-output", "Read-only viewport diagnostics")).firstMatch
            try require(region)
            // The fixed read-only region has pointer-events:none. Reading it
            // requires existence and actual pixels, not a tappable hit region.
            let values = XCTAttachment(string: region.debugDescription)
            values.name = "safari-read-only-viewport-values"; values.lifetime = .keepAlways; add(values)
            attachScreenshot("safari-viewport-diagnostic-values")
            if ProcessInfo.processInfo.environment["LIKERTS_LIVE_SAFARI_TOP_REACHABILITY_DIAGNOSTIC"] == "1" {
                try await safariTopReachabilityDiagnosis(region: region, code: code, joined: joined)
            }
            print("CROSSPLAY_SAFARI_DIAGNOSTIC_CAPTURED")
            throw XCTSkip("Explicit read-only viewport diagnosis; no gameplay")
        }
        try await safariPrepareHeaderAtTrueTop(preserving: joined, roomCode: code, phase: "joined")
        attachScreenshot("safari-joined")
        print("CROSSPLAY_SAFARI_JOINED")

        var subjectTurns = 0, predictionTurns = 0
        for index in 1...2 {
            // Safari exposes an aria-pressed web choice as an XCUI Switch.
            // Use the observed semantic type while retaining the exact label
            // and a real unchecked-to-checked transition before locking.
            let choices = app.webViews.switches.matching(NSPredicate(format: "label == %@", "4 · Mostly me"))
            let choice = choices.firstMatch
            try await waitForCrossplay(choice, predicate: "exists == true AND enabled == true", stage: "Safari's choice controls")
            try require(safariText("Round \(index) of 2"))
            let subject = safariText("Your private answer").exists
            if subject { subjectTurns += 1 } else { predictionTurns += 1 }
            try safariReveal(choice)
            for label in ["1 · Not me", "2 · A little", "3 · Depends", "4 · Mostly me", "5 · So me"] {
                let visibleChoices = app.webViews.switches.matching(NSPredicate(format: "label == %@", label))
                    .allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
                guard visibleChoices.count == 1, let visible = visibleChoices.first, visible.isEnabled,
                      visible.frame.width >= 44, visible.frame.height >= 44,
                      !visible.isSelected, (visible.value as? String) == "0" else {
                    throw safariFailure("Each of the five exact Safari choices must be unique, enabled, hittable, at least44 by44 points and initially unchecked")
                }
            }
            choice.tap()
            let pressed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '1' OR value == 'true' OR selected == true"), object: choice)
            guard await XCTWaiter.fulfillment(of: [pressed], timeout: 5) == .completed else {
                throw safariFailure("The actual Safari choice must change from unchecked to pressed before locking")
            }
            try safariTapWeb(subject ? "Lock my answer" : "Lock my guess")
            if subject {
                try require(safariText("Answer sealed."))
                let ownLock = safariText("You picked 4 · Mostly me")
                try require(ownLock); try safariReveal(ownLock)
                XCTAssertFalse(safariText("SafariQA picked 4 · Mostly me").exists)
                XCTAssertFalse(safariText("Guessed 4").exists)
                attachScreenshot("safari-subject-private-lock")
                let reloadQuery = app.buttons.matching(NSPredicate(format: "label IN %@ OR identifier IN %@", ["Reload", "Reload page", "Reload Page"], ["ReloadButton"]))
                if !reloadQuery.allElementsBoundByIndex.contains(where: { $0.exists && $0.isHittable }) {
                    app.webViews.firstMatch.swipeDown()
                }
                let reload = try safariVisible(reloadQuery, stage: "Safari's same-tab Reload control")
                reload.tap()
                try require(safariText("Your place is saved."))
                try safariTapWeb("Resume room")
                try require(safariText("Answer sealed."))
                try require(ownLock); try safariReveal(ownLock)
                XCTAssertFalse(safariText("SafariQA picked 4 · Mostly me").exists)
                XCTAssertFalse(safariText("Guessed 4").exists)
                attachScreenshot("safari-subject-locked-resumed")
                print("CROSSPLAY_SAFARI_SUBJECT_LOCKED_RESUMED")
            }
            let reveal = safariText("\(subject ? "SafariQA" : "Sam") picked 4 · Mostly me")
            try await waitForCrossplay(reveal, stage: "Safari's completed round reveal")
            try safariReveal(reveal)
            try require(safariText("Guessed 4")); try require(safariText("100 points"))
            attachScreenshot("safari-round-\(index)-reveal")
            print("CROSSPLAY_SAFARI_REVEAL_\(index)")
            if index == 1 {
                try await waitForCrossplay(safariText("Round 2 of 2"), stage: "the browser host's next round")
            } else {
                try await waitForCrossplay(safariText("Your people. Read."), stage: "Safari's final standings")
            }
        }
        XCTAssertEqual(subjectTurns, 1); XCTAssertEqual(predictionTurns, 1)
        XCTAssertEqual(app.webViews.staticTexts.matching(NSPredicate(format: "label == %@", "1 prediction")).count, 2)
        XCTAssertEqual(app.webViews.staticTexts.matching(NSPredicate(format: "label == %@", "100.0%")).count, 2)
        if !requiresAutomaticSafariHeader { try safariReveal(safariText("Your people. Read.")) }
        attachScreenshot("safari-complete-match")
        try await safariPrepareHeaderAtTrueTop(preserving: safariText("Your people. Read."), completed: true, phase: "completed")
        try safariTapWeb("Leave room")
        try require(safariText("Leave this room?"))
        let dialog = app.webViews.descendants(matching: .any).matching(identifier: "confirm-dialog").firstMatch
        if dialog.exists {
            let leave = try safariVisible(dialog.buttons.matching(NSPredicate(format: "label == %@", "Leave room")), stage: "the web dialog's Leave room action")
            leave.tap()
        } else {
            let leave = try safariVisible(app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Leave room")), stage: "the modal Leave room action")
            leave.tap()
        }
        try require(safariWebButton("Join a room"))
        attachScreenshot("safari-left-room")
        // The product journey is complete through real Leave and landing.
        // Browser housekeeping has its own explicit capability contract.
        print("CROSSPLAY_SAFARI_FINISHED")
    }

    func testSafariOwnedTabCleanupCapability() throws {
        // setUp validates exact numeric loopback, explicit capability opt-in
        // and a nonempty bounded known-code list before this activation.
        // Never mark a page owned or capture its content in this case.
        app.activate()
        for code in safariPriorOwnedRooms {
            guard safariClosePriorOwnedTabIfConfirmed(code: code) else {
                throw safariFailure("Owned Safari tab cleanup is unavailable or ownership is uncertain; remaining QA tabs retained without grid search")
            }
            print("CROSSPLAY_SAFARI_PRIOR_TAB_CLOSED \(code)")
        }
        print("CROSSPLAY_SAFARI_CLEANUP_FINISHED")
    }

    /// Passive Phase4 diagnosis only: no gameplay, corrective gesture or cleanup.
    func testSafariInitialPositioningDiagnostic() async throws {
        guard let code = ProcessInfo.processInfo.environment["LIKERTS_LIVE_SAFARI_ROOM"],
              let expectedVariant = positioningExpectedVariant,
              var parts = URLComponents(url: base.appendingPathComponent("play"), resolvingAgainstBaseURL: false) else {
            throw XCTSkip("The prevalidated positioning room and variant must exist.")
        }
        parts.queryItems = [URLQueryItem(name: "room", value: code)]
        guard let invite = parts.url else { throw XCTSkip("The owned positioning invite must be valid.") }
        let observationOrigin = ProcessInfo.processInfo.systemUptime
        var records: [[String: Any]] = []
        defer {
            if let data = try? JSONSerialization.data(withJSONObject: records, options: [.prettyPrinted, .sortedKeys]),
               let text = String(data: data, encoding: .utf8) {
                let attachment = XCTAttachment(string: text)
                attachment.name = "phase4-positioning-native-timings"; attachment.lifetime = .keepAlways; add(attachment)
            }
        }
        app.activate()
        try safariTabCommand(["New Tab", "New tab"])
        safariOwnedTabActive = true
        var fields = app.textFields.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        if fields.count != 1 {
            let address = try await positioningVisible(app.buttons.matching(NSPredicate(
                format: "label IN %@ OR identifier IN %@", ["Address", "Search or enter website name", "URL"], ["URL", "Address"])),
                stage: "the fresh-tab address control")
            address.tap()
            fields = app.textFields.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        }
        guard fields.count == 1 else { throw XCTSkip("Fresh positioning tab has no unique address field.") }
        fields[0].tap(); fields[0].typeText(invite.absoluteString + "\n")
        try positioningRequire(safariText("Join your people."), stage: "the owned join page")
        safariOwnedPageConfirmed = true
        let region = app.webViews.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ OR label BEGINSWITH %@", "qa-safari-positioning-output", "Read-only Safari positioning diagnostics")).firstMatch
        try positioningRequire(region, stage: "the private passive probe")
        let initialTrace = region.debugDescription
        let identity = try positioningIdentity(initialTrace, expectedVariant: expectedVariant)
        let initial = XCTAttachment(string: initialTrace)
        initial.name = "phase4-positioning-initial-readout"; initial.lifetime = .keepAlways; add(initial)
        records.append(positioningPixels("page-ready", relativeTo: observationOrigin))
        records.append(positioningGeometry("page-ready", relativeTo: observationOrigin))

        let room = try await positioningVisible(app.webViews.textFields.matching(NSPredicate(
            format: "label == %@ OR identifier == %@", "Room code", "room-code")), stage: "the room field")
        guard room.value as? String == code else { throw XCTSkip("Positioning invite does not show the exact owned room.") }
        let nickname = try await positioningVisible(app.webViews.textFields.matching(NSPredicate(
            format: "label == %@ OR identifier == %@", "Your name", "nickname")), stage: "the nickname field")
        nickname.tap(); nickname.typeText("SafariQA")
        guard nickname.value as? String == "SafariQA" else { throw XCTSkip("The synthetic positioning nickname was not confirmed.") }
        records.append(positioningPixels("nickname-keyboard", relativeTo: observationOrigin))
        records.append(positioningGeometry("nickname-keyboard", relativeTo: observationOrigin))
        guard app.keyboards.firstMatch.exists else {
            throw XCTSkip("No software keyboard was observed; the Done-to-Join diagnosis is inconclusive.")
        }
        let done = try await positioningVisible(app.buttons.matching(NSPredicate(format: "label == %@", "Done")),
                                                stage: "the native keyboard Done control")
        done.tap()
        records.append(["event": "done-tap-returned", "relativeSeconds": ProcessInfo.processInfo.systemUptime - observationOrigin])
        records.append(positioningPixels("after-done", relativeTo: observationOrigin))
        records.append(positioningGeometry("after-done", relativeTo: observationOrigin))

        let consentQuery = app.webViews.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ OR label == %@", "room-sharing", "I’m happy to share my nickname and revealed rounds with this room."))
        let inputs = consentQuery.allElementsBoundByIndex.filter { $0.elementType == .checkBox || $0.elementType == .switch }
        guard inputs.count == 1 else { throw XCTSkip("No unique actual sharing checkbox is exposed.") }
        let consent = inputs[0]
        try positioningReveal(consent, stage: "the sharing checkbox")
        guard !consent.isSelected && (consent.value as? String) != "1" else {
            throw XCTSkip("Fresh positioning consent must begin unchecked.")
        }
        consent.tap()
        let checked = XCTNSPredicateExpectation(predicate: NSPredicate(
            format: "value == '1' OR value == 'true' OR selected == true"), object: consent)
        guard await XCTWaiter.fulfillment(of: [checked], timeout: 5) == .completed else {
            throw XCTSkip("The explicit positioning sharing choice was not confirmed.")
        }
        let joinQuery = app.webViews.buttons.matching(NSPredicate(format: "label == %@", "Join room"))
        try positioningRequire(joinQuery.firstMatch, stage: "the Join room control")
        try positioningReveal(joinQuery.firstMatch, stage: "the Join room control")
        let join = try await positioningVisible(joinQuery, stage: "the Join room control")
        guard join.isEnabled else { throw XCTSkip("Join room is not enabled after actual consent.") }
        records.append(positioningPixels("consented-before-join", relativeTo: observationOrigin))
        records.append(positioningGeometry("consented-before-join", relativeTo: observationOrigin))
        join.tap()
        let joinReturnedAt = ProcessInfo.processInfo.systemUptime
        records.append(["event": "join-tap-returned", "relativeSeconds": joinReturnedAt - observationOrigin,
                        "nativeWallMilliseconds": Date().timeIntervalSince1970 * 1000])
        // Screenshot-only burst: no new H1/keyboard/header AX queries between
        // Join returning and the five-second observation boundary.
        for target in [0.0, 0.250, 1.0, 3.0, 5.0] {
            let remaining = target - (ProcessInfo.processInfo.systemUptime - joinReturnedAt)
            if remaining > 0 { try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000)) }
            var record = positioningPixels("post-join-\(Int(target * 1000))ms", relativeTo: joinReturnedAt)
            record["requestedSecondsAfterJoinReturn"] = target
            records.append(record)
        }
        records.append(positioningGeometry("post-join-after-five-seconds", relativeTo: joinReturnedAt))
        records.append(positioningPixels("before-H1-AX-read", relativeTo: joinReturnedAt))
        records.append(["event": "first-explicit-post-join-H1-AX-read-start",
                        "relativeSeconds": ProcessInfo.processInfo.systemUptime - joinReturnedAt])
        let joined = app.webViews.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@ AND label CONTAINS %@", "You’re in", "SafariQA")).firstMatch
        try positioningRequire(joined, stage: "the admitted positioning lobby")
        try positioningRequire(safariText("Room \(code)"), stage: "the exact admitted room")
        try positioningRequire(safariText("2 friends"), stage: "the two-friend lobby")
        records.append(["event": "post-join-H1-validation-completed", "relativeSeconds": ProcessInfo.processInfo.systemUptime - joinReturnedAt,
                        "headingFrame": String(describing: joined.frame)])
        try positioningRequire(region, stage: "the retained passive probe")
        let finalTrace = region.debugDescription
        let finalIdentity = try positioningIdentity(finalTrace, expectedVariant: expectedVariant)
        let values = XCTAttachment(string: finalTrace)
        values.name = "phase4-positioning-final-readout"; values.lifetime = .keepAlways; add(values)
        records.append(positioningPixels("after-H1-AX-read", relativeTo: joinReturnedAt))
        records.append(positioningGeometry("after-H1-AX-read", relativeTo: joinReturnedAt))
        guard finalIdentity.origin == identity.origin, finalIdentity.generation == identity.generation else {
            throw XCTSkip("Positioning document identity changed; diagnosis invalidated without gameplay.")
        }
        print("SAFARI_POSITIONING_DIAGNOSTIC_CAPTURED")
        throw XCTSkip("Explicit passive Safari positioning diagnosis; no Start, corrective gesture or tab cleanup.")
    }

    private func positioningRequire(_ element: XCUIElement, stage: String) throws {
        guard element.waitForExistence(timeout: 8) else {
            throw XCTSkip("Positioning diagnosis cannot observe \(stage); no gameplay.")
        }
    }
    private func positioningVisible(_ query: XCUIElementQuery, stage: String) async throws -> XCUIElement {
        let deadline = ProcessInfo.processInfo.systemUptime + 8
        repeat {
            let visible = query.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
            if visible.count == 1 { return visible[0] }
            if visible.count > 1 { throw XCTSkip("Positioning diagnosis found ambiguous \(stage).") }
            try await Task.sleep(nanoseconds: 100_000_000)
        } while ProcessInfo.processInfo.systemUptime < deadline
        throw XCTSkip("Positioning diagnosis cannot reach \(stage).")
    }
    private func positioningReveal(_ element: XCUIElement, stage: String) throws {
        try positioningRequire(element, stage: stage)
        for _ in 0..<6 {
            if element.isHittable { return }
            if element.frame.maxY < app.frame.midY { app.webViews.firstMatch.swipeDown() }
            else { app.webViews.firstMatch.swipeUp() }
        }
        throw XCTSkip("Positioning diagnosis cannot reveal \(stage) through bounded ordinary scrolling.")
    }
    private func positioningIdentity(_ text: String, expectedVariant: String) throws -> (origin: String, generation: String) {
        let expression = try? NSRegularExpression(pattern: #"document timeOrigin=[0-9]+(?:\.[0-9]+)? generation=[0-9]+ variant=([a-z0-9-]+)"#)
        guard text.contains("LIKERTS-SAFARI-POSITIONING-QA-1"),
              let origin = safariDiagnosticTimeOrigin(text), let generation = safariDiagnosticGeneration(text),
              let match = expression?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text), String(text[range]) == expectedVariant else {
            throw XCTSkip("Positioning probe identity or expected private variant is unavailable.")
        }
        return (origin, generation)
    }
    private func positioningPixels(_ stage: String, relativeTo origin: TimeInterval) -> [String: Any] {
        let start = ProcessInfo.processInfo.systemUptime
        let wall = Date().timeIntervalSince1970 * 1000
        let screenshot = XCUIScreen.main.screenshot()
        let end = ProcessInfo.processInfo.systemUptime
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "phase4-positioning-\(stage)"; attachment.lifetime = .keepAlways; add(attachment)
        return ["kind": "pixels", "stage": stage, "startUptime": start, "endUptime": end,
                "relativeStartSeconds": start - origin, "relativeEndSeconds": end - origin,
                "nativeWallMilliseconds": wall]
    }
    private func positioningGeometry(_ stage: String, relativeTo origin: TimeInterval) -> [String: Any] {
        let start = ProcessInfo.processInfo.systemUptime
        let keyboard = app.keyboards.firstMatch
        let wordmark = safariText("likerts"), leave = safariWebButton("Leave room")
        let safariBar = app.statusBars.firstMatch
        let systemBar = XCUIApplication(bundleIdentifier: "com.apple.springboard").statusBars.firstMatch
        let status = safariBar.exists ? safariBar : systemBar
        var record: [String: Any] = ["kind": "geometry", "stage": stage, "relativeStartSeconds": start - origin,
            "keyboardExists": keyboard.exists, "keyboardFrame": keyboard.exists ? String(describing: keyboard.frame) : "not exposed",
            "wordmarkFrame": wordmark.exists ? String(describing: wordmark.frame) : "not exposed",
            "leaveExists": leave.exists, "leaveFrame": leave.exists ? String(describing: leave.frame) : "not exposed",
            "leaveHittable": leave.exists && leave.isHittable,
            "observedStatusBar": status.exists ? String(describing: status.frame) : "not exposed",
            "windowFrame": String(describing: app.windows.firstMatch.frame),
            "webViewFrame": String(describing: app.webViews.firstMatch.frame)]
        for identifier in ["MoreMenuButton", "ReloadButton", "PageFormatMenuButton"] {
            let control = app.buttons.matching(identifier: identifier).firstMatch
            record[identifier + "Frame"] = control.exists ? String(describing: control.frame) : "not exposed"
        }
        let address = app.textFields.matching(identifier: "TabBarItemTitle").firstMatch
        record["addressFrame"] = address.exists ? String(describing: address.frame) : "not exposed"
        record["relativeEndSeconds"] = ProcessInfo.processInfo.systemUptime - origin
        return record
    }

    private func safariRequireUninstrumentedProductPage() throws {
        let diagnostics = app.webViews.descendants(matching: .any).matching(NSPredicate(
            format: "identifier IN %@ OR label BEGINSWITH %@ OR label BEGINSWITH %@",
            ["qa-safari-positioning-output", "qa-viewport-output"],
            "Read-only Safari positioning diagnostics", "Read-only viewport diagnostics"))
        guard !diagnostics.firstMatch.exists else {
            throw safariFailure("Product acceptance must not contain the private diagnostic overlay")
        }
    }

    private func safariCaptureAutomaticHeaderBurst() async throws {
        // Capture before querying the new heading. These timings start when
        // the real Join tap returns; they are not claimed render timestamps.
        let joinReturnedAt = ProcessInfo.processInfo.systemUptime
        var records: [[String: Any]] = []
        for target in [0.0, 0.250, 1.0, 3.0, 5.0] {
            let remaining = target - (ProcessInfo.processInfo.systemUptime - joinReturnedAt)
            if remaining > 0 { try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000)) }
            let started = ProcessInfo.processInfo.systemUptime
            let wallMilliseconds = Date().timeIntervalSince1970 * 1000
            let pixels = XCUIScreen.main.screenshot()
            let finished = ProcessInfo.processInfo.systemUptime
            let attachment = XCTAttachment(screenshot: pixels)
            attachment.name = "safari-product-post-join-\(Int(target * 1000))ms"
            attachment.lifetime = .keepAlways; add(attachment)
            records.append(["requestedSecondsAfterJoinReturn": target,
                            "actualStartSecondsAfterJoinReturn": started - joinReturnedAt,
                            "actualEndSecondsAfterJoinReturn": finished - joinReturnedAt,
                            "nativeWallMilliseconds": wallMilliseconds])
        }
        let data = try JSONSerialization.data(withJSONObject: records, options: [.prettyPrinted, .sortedKeys])
        let timing = XCTAttachment(string: String(decoding: data, as: UTF8.self))
        timing.name = "safari-product-automatic-header-capture-timings"; timing.lifetime = .keepAlways; add(timing)
    }

    private func safariPrepareHeaderAtTrueTop(preserving content: XCUIElement, roomCode: String? = nil,
                                             completed: Bool = false, phase: String) async throws {
        try require(content)
        let expectedLabel = content.label
        let logo = try require(safariText("likerts"))
        let leave = try require(safariWebButton("Leave room"))
        let safariBar = app.statusBars.firstMatch
        let systemBar = XCUIApplication(bundleIdentifier: "com.apple.springboard").statusBars.firstMatch
        let bar = safariBar.exists ? safariBar : systemBar
        guard bar.exists && bar.frame.height > 0 else {
            throw safariFailure("The true-top header check requires an observed status-bar frame")
        }
        try safariHeaderGeometry(enforceSafeArea: false, captureName: "safari-\(phase)-initial-header-geometry")
        attachScreenshot("safari-\(phase)-initial-header")
        func headerReady() -> Bool {
            logo.exists && leave.exists && logo.frame.minY >= bar.frame.maxY &&
                leave.frame.minY >= bar.frame.maxY && leave.isHittable &&
                app.windows.firstMatch.frame.contains(leave.frame)
        }
        let neededGesture = !headerReady()
        if requiresAutomaticSafariHeader && neededGesture {
            throw safariFailure("The product header must be clear automatically, before any corrective gesture")
        }
        if neededGesture {
            // The header is ordinary flow content. Restore true top through
            // the same single semantic gesture proven by the diagnostic.
            // Preserve initial pixels; this does not certify automatic layout.
            app.webViews.firstMatch.swipeDown()
            let deadline = ProcessInfo.processInfo.systemUptime + 5
            while !headerReady() && ProcessInfo.processInfo.systemUptime < deadline {
                try await Task.sleep(nanoseconds: 100_000_000)
            }
        }
        guard content.exists && content.label == expectedLabel else {
            throw safariFailure("Restoring true top must preserve the same owned page heading; a refresh or navigation invalidates the check")
        }
        if let roomCode {
            guard safariText("Room \(roomCode)").exists && safariText("2 friends").exists else {
                throw safariFailure("Restoring true top must preserve the exact room and two-friend lobby")
            }
        }
        if completed {
            guard app.webViews.staticTexts.matching(NSPredicate(format: "label == %@", "1 prediction")).count == 2,
                  app.webViews.staticTexts.matching(NSPredicate(format: "label == %@", "100.0%")).count == 2 else {
                throw safariFailure("Restoring true top must preserve both completed one-prediction, 100.0-percent rows")
            }
        }
        if requiresAutomaticSafariHeader {
            let heading = content.frame
            guard app.windows.firstMatch.frame.contains(heading),
                  heading.minY >= max(logo.frame.maxY, leave.frame.maxY) else {
                throw safariFailure("The complete product heading must be visible below the automatic header without a repair gesture")
            }
        }
        let operation = XCTAttachment(string: "automaticHeaderRequired=\(requiresAutomaticSafariHeader)\nordinarySwipeDownUsed=\(neededGesture)\nheadingPreserved=true\nheadingFrame=\(content.frame)\n")
        operation.name = "safari-\(phase)-true-top-operation"; operation.lifetime = .keepAlways; add(operation)
        try safariHeaderGeometry(enforceSafeArea: true, captureName: "safari-\(phase)-true-top-header-geometry")
        guard headerReady(), leave.frame.width >= 44, leave.frame.height >= 44 else {
            throw safariFailure("At restored true top, Leave must remain fully hittable, at least44 by44 points and below observed system chrome")
        }
        attachScreenshot("safari-\(phase)-true-top")
    }
    private func safariTopReachabilityDiagnosis(region: XCUIElement, code: String, joined: XCUIElement) async throws {
        let baselineText = region.debugDescription
        guard let origin = safariDiagnosticTimeOrigin(baselineText),
              let generation = safariDiagnosticGeneration(baselineText) else {
            throw XCTSkip("Ordinary-scroll diagnosis requires the private probe's finite document timeOrigin and generation before any gesture.")
        }
        let heading = joined.label
        let web = app.webViews.firstMatch
        guard web.exists && web.isHittable, safariText("Room \(code)").exists,
              safariText("2 friends").exists, joined.exists else {
            throw XCTSkip("Ordinary-scroll diagnosis requires the same owned two-friend lobby before any gesture.")
        }
        let baseline = XCTAttachment(string: "document timeOrigin=\(origin) generation=\(generation)\njoinedHeading=\(heading)\n" + baselineText)
        baseline.name = "safari-top-baseline-values"; baseline.lifetime = .keepAlways; add(baseline)
        attachScreenshot("safari-top-baseline")
        // One ordinary semantic gesture only. No coordinate, JavaScript,
        // toolbar or preference action changes the page to force a result.
        web.swipeDown()
        let returnedAt = ProcessInfo.processInfo.systemUptime
        var sameDocumentAndLobby = true
        for targetSeconds in [0.250, 1.000] {
            let remaining = targetSeconds - (ProcessInfo.processInfo.systemUptime - returnedAt)
            if remaining > 0 { try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000)) }
            let startedAt = ProcessInfo.processInfo.systemUptime
            let text = region.exists ? region.debugDescription : "Read-only viewport region absent"
            let currentOrigin = safariDiagnosticTimeOrigin(text)
            let currentGeneration = safariDiagnosticGeneration(text)
            let roomPresent = safariText("Room \(code)").exists
            let twoFriends = safariText("2 friends").exists
            let headingPresent = joined.exists && joined.label == heading
            let continuity = currentOrigin == origin && currentGeneration == generation && roomPresent && twoFriends && headingPresent
            sameDocumentAndLobby = sameDocumentAndLobby && continuity
            let leave = safariWebButton("Leave room")
            let logo = safariText("likerts")
            let safariBar = app.statusBars.firstMatch
            let systemBar = XCUIApplication(bundleIdentifier: "com.apple.springboard").statusBars.firstMatch
            let statusBar = safariBar.exists ? safariBar : systemBar
            var lines = [
                "requestedSecondsAfterGestureReturn=\(targetSeconds)",
                "snapshotStartedSecondsAfterGestureReturn=\(startedAt - returnedAt)",
                "sameDocumentAndLobby=\(continuity)",
                "baselineTimeOrigin=\(origin)",
                "observedTimeOrigin=\(currentOrigin ?? "missing")",
                "baselineGeneration=\(generation)",
                "observedGeneration=\(currentGeneration ?? "missing")",
                "roomPresent=\(roomPresent) twoFriends=\(twoFriends) joinedHeadingUnchanged=\(headingPresent)",
                "logo=\(logo.exists ? String(describing: logo.frame) : "missing")",
                "leave=\(leave.exists ? String(describing: leave.frame) : "missing")",
                "leaveHittable=\(leave.exists && leave.isHittable)",
                "observedStatusBar=\(statusBar.exists ? String(describing: statusBar.frame) : "not exposed")",
                "webView=\(web.frame)"
            ]
            let label = targetSeconds < 1 ? "250ms" : "1000ms"
            lines.append("hierarchyFinishedSecondsAfterGestureReturn=\(ProcessInfo.processInfo.systemUptime - returnedAt)")
            lines.append("screenshotStartedSecondsAfterGestureReturn=\(ProcessInfo.processInfo.systemUptime - returnedAt)")
            let screenshot = XCUIScreen.main.screenshot()
            lines.append("screenshotFinishedSecondsAfterGestureReturn=\(ProcessInfo.processInfo.systemUptime - returnedAt)")
            let image = XCTAttachment(screenshot: screenshot)
            image.name = "safari-top-after-\(label)"; image.lifetime = .keepAlways; add(image)
            lines.append(text)
            let values = XCTAttachment(string: lines.joined(separator: "\n"))
            values.name = "safari-top-after-\(label)-values"; values.lifetime = .keepAlways; add(values)
        }
        print("CROSSPLAY_SAFARI_TOP_REACHABILITY_CAPTURED")
        throw XCTSkip("Explicit ordinary-scroll diagnosis; no gameplay. Same document and lobby after gesture: \(sameDocumentAndLobby).")
    }
    private func safariDiagnosticTimeOrigin(_ text: String) -> String? {
        let expression = try? NSRegularExpression(pattern: #"document timeOrigin=([0-9]+(?:\.[0-9]+)?)"#)
        guard let match = expression?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text),
              let number = Double(text[range]), number.isFinite && number > 0 else { return nil }
        return String(text[range])
    }
    private func safariDiagnosticGeneration(_ text: String) -> String? {
        let expression = try? NSRegularExpression(pattern: #"document timeOrigin=[0-9]+(?:\.[0-9]+)? generation=([0-9]+)"#)
        guard let match = expression?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text),
              let number = UInt64(text[range]), number > 0 else { return nil }
        return String(text[range])
    }
    private func safariText(_ label: String) -> XCUIElement {
        app.webViews.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }
    private func safariWebButton(_ label: String) -> XCUIElement {
        app.webViews.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }
    private func safariHeaderGeometry(enforceSafeArea: Bool = true, captureName: String = "safari-owned-header-geometry") throws {
        let logo = try require(safariText("likerts"))
        let leave = try require(safariWebButton("Leave room"))
        let safariBar = app.statusBars.firstMatch
        // Observing SpringBoard's status-bar node does not activate it or alter
        // settings. Some Simulator versions expose neither status-bar node.
        let systemBar = XCUIApplication(bundleIdentifier: "com.apple.springboard").statusBars.firstMatch
        let bar: XCUIElement? = safariBar.exists ? safariBar : (systemBar.exists ? systemBar : nil)
        var lines = ["logo: \(logo.frame)", "leave: \(leave.frame)", "webView: \(app.webViews.firstMatch.frame)", "window: \(app.windows.firstMatch.frame)"]
        var overlapsObservedStatusBar = false
        if let bar, bar.frame.height > 0 {
            lines.append("observedStatusBar: \(bar.frame)")
            overlapsObservedStatusBar = logo.frame.minY < bar.frame.maxY || leave.frame.minY < bar.frame.maxY
        } else {
            lines.append("statusBarFrame: not exposed by Safari or SpringBoard; actual before/after pixels require review")
        }
        let geometry = XCTAttachment(string: lines.joined(separator: "\n"))
        geometry.name = captureName; geometry.lifetime = .keepAlways; add(geometry)
        guard !enforceSafeArea || !overlapsObservedStatusBar else {
            throw safariFailure("The owned Safari logo and Leave control must lie below the observed system status bar")
        }
    }
    private func safariFailure(_ message: String) -> Error {
        if safariOwnedTabActive && safariOwnedPageConfirmed {
            XCTFail(message)
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "safari-unavailable-control-hierarchy"; tree.lifetime = .keepAlways; add(tree)
            attachScreenshot("safari-unavailable-control")
        } else {
            // No existing page, address, favorites or tab titles are dumped.
            let known = ["New Tab", "More", "Page Menu", "Tabs", "Tab Overview", "Address", "Reload", "Close This Tab"]
            let counts = known.map { "\($0): \(app.buttons.matching(NSPredicate(format: "label == %@", $0)).count)" }
            let summary = XCTAttachment(string: "Safari semantic-control counts only\n" + counts.joined(separator: "\n"))
            summary.name = "safari-safe-control-counts"; summary.lifetime = .keepAlways; add(summary)
            // A pre-ownership/after-close capability stop is explicitly a skip,
            // never a pass. Avoid an automatic failure screenshot of an older
            // unrelated tab; the bounded action and counts remain recorded.
            return XCTSkip(message)
        }
        return TestError.missingControl
    }
    private func safariVisible(_ query: XCUIElementQuery, stage: String) throws -> XCUIElement {
        let deadline = Date().addingTimeInterval(5)
        repeat {
            let visible = query.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
            if visible.count == 1 { return visible[0] }
            if visible.count > 1 { throw safariFailure("Ambiguous visible controls for \(stage)") }
            Thread.sleep(forTimeInterval: 0.1)
        } while Date() < deadline
        throw safariFailure("No reachable semantic control for \(stage)")
    }
    private func safariReveal(_ element: XCUIElement) throws {
        try require(element)
        for _ in 0..<6 {
            if element.isHittable { return }
            if element.frame.maxY < app.frame.midY { app.webViews.firstMatch.swipeDown() }
            else { app.webViews.firstMatch.swipeUp() }
        }
        guard element.isHittable else { throw safariFailure("A Safari web control is not reachable after bounded scrolling") }
    }
    private func safariTapWeb(_ label: String) throws {
        let button = safariWebButton(label); try require(button); try safariReveal(button)
        let visible = try safariVisible(app.webViews.buttons.matching(NSPredicate(format: "label == %@", label)), stage: label)
        XCTAssertTrue(visible.isEnabled); visible.tap()
    }
    private func safariTabCommand(_ titles: [String]) throws {
        let closing = titles.contains { $0.hasPrefix("Close") }
        if closing {
            let address = app.textFields.matching(NSPredicate(format: "label == %@", "Address")).allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
            guard address.count == 1 else { throw safariFailure("Current-tab closing requires the visible normal-page address control") }
        }
        let command = app.buttons.matching(NSPredicate(format: "label IN %@", titles))
        let direct = command.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        if direct.count == 1 { direct[0].tap(); return }
        guard direct.isEmpty else { throw safariFailure("Current-tab commands must be unambiguous") }
        let more = app.buttons.matching(NSPredicate(format: "label IN %@ OR identifier IN %@", ["More", "More Options"], ["MoreMenuButton", "MoreButton", "TabGroupMoreButton"]))
        if let button = more.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) {
            button.tap()
            if command.firstMatch.waitForExistence(timeout: 2) {
                let visible = command.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
                if visible.count == 1 { visible[0].tap(); return }
                guard visible.isEmpty else { throw safariFailure("The current-tab menu command must be unique") }
            }
        }
        // Never enter or search the tab grid for an unscoped close button.
        guard !closing else { throw safariFailure("No unique ordinary current-tab Close command is exposed") }
        let tabs = app.buttons.matching(NSPredicate(format: "label IN %@ OR identifier IN %@", ["Tab Overview", "Show Tabs", "Tabs", "All Tabs", "Show All Tabs"], ["TabOverviewButton"]))
        if let button = tabs.allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) {
            button.press(forDuration: 1)
            let action = try safariVisible(command, stage: titles.joined(separator: "/")); action.tap(); return
        }
        throw safariFailure("Safari must expose its normal current-tab command: \(titles.joined(separator: "/"))")
    }
    private func safariClosePriorOwnedTabIfConfirmed(code: String) -> Bool {
        let fields = app.textFields.matching(NSPredicate(format: "label == %@", "Address")).allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        guard fields.count == 1 else { return false }
        fields[0].tap()
        let edited = app.textFields.allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        guard edited.count == 1 else { return false }
        let value = (edited[0].value as? String ?? "").replacingOccurrences(of: "\u{200e}", with: "")
        let candidate = URLComponents(string: value.hasPrefix("http://") ? value : "http://" + value)
        let owned = candidate?.scheme == "http" && candidate?.host == "127.0.0.1" && candidate?.port == 4783 &&
            candidate?.user == nil && candidate?.password == nil && candidate?.fragment == nil &&
            candidate?.path == "/play" && candidate?.queryItems?.count == 1 &&
            candidate?.queryItems?.first?.name == "room" && candidate?.queryItems?.first?.value == code
        let cancel = app.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        guard cancel.count == 1 else { return false }
        cancel[0].tap()
        guard owned else { return false }
        do { try safariTabCommand(["Close This Tab", "Close Tab", "Close this tab"]); return true }
        catch { return false } // Explicit residue; never risk another tab.
    }

    func testNativePlayerPrivatelyAnswersPredictsRevealsAndLeaves() async throws {
        let host = try await admit(path: "rooms", values: ["settings": ["topic": "mix", "cycles": 1, "capacity": 12, "answerSeconds": 0, "predictSeconds": 0]])
        do {
            let other = try await admit(path: "rooms/\(host.code)/join", values: ["nickname": "RemoteQA", "acceptRoomSharing": true])
            let code = app.textFields["live.code"], name = app.textFields["live.nickname"]
            try require(code); try reveal(code); code.tap(); code.typeText(host.code + "\n")
            try require(name)
            let nicknameReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: name)
            guard await XCTWaiter.fulfillment(of: [nicknameReady], timeout: 5) == .completed else {
                XCTFail("Keyboard Next must reveal the nickname field")
                throw TestError.unreachableControl
            }
            // Next must move the real keyboard focus to the nickname. Typing through
            // the keyboard and observing the field value catches a failed transfer.
            app.typeText("NativeQA\n")
            let named = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "NativeQA"), object: name)
            let nameResult = await XCTWaiter.fulfillment(of: [named], timeout: 5)
            guard nameResult == .completed else {
                XCTFail("Keyboard Next must move input to the nickname field before joining")
                throw TestError.inputNotConfirmed
            }
            try await dismissKeyboard()
            try tap("live.consent")
            try tap("live.join")
            try require(app.staticTexts["live.roomCode"])
            attachScreenshot("player-lobby")
            var hostState = try await snapshot(host)
            let players = try XCTUnwrap(hostState["players"] as? [[String: Any]])
            let nativeID = try XCTUnwrap(players.first(where: { $0["nickname"] as? String == "NativeQA" })?["id"] as? String)
            hostState = try await action("start", credential: host, state: hostState)
            for roundIndex in 1...2 {
                let round = try XCTUnwrap(hostState["round"] as? [String: Any])
                let nativeSubject = round["subjectId"] as? String == nativeID
                if !nativeSubject {
                    let otherState = try await snapshot(other)
                    _ = try await action("answer", credential: other, state: otherState, extra: ["value": 4])
                }
                try assertChoiceTargets()
                try tap("live.choice.4")
                XCTAssertEqual(app.buttons["live.choice.4"].value as? String, "Selected")
                attachScreenshot("round-\(roundIndex)-selected")
                try tap("live.submit")
                if nativeSubject {
                    let locked = app.descendants(matching: .any).matching(identifier: "live.locked").firstMatch
                    try require(locked)
                    XCTAssertFalse(app.staticTexts["live.revealedAnswer"].exists, "A private answer must remain unrevealed until the other player predicts")
                    attachScreenshot("round-\(roundIndex)-private-answer-locked")
                    let otherState = try await snapshot(other)
                    _ = try await action("guess", credential: other, state: otherState, extra: ["value": 4])
                }
                try require(app.staticTexts["live.revealedAnswer"])
                attachScreenshot("round-\(roundIndex)-reveal")
                hostState = try await snapshot(host)
                XCTAssertEqual(hostState["phase"] as? String, "reveal")
                let reveal = try XCTUnwrap(hostState["reveal"] as? [String: Any])
                XCTAssertEqual(reveal["answer"] as? Int, 4)
                hostState = try await action("next", credential: host, state: hostState)
            }
            try require(app.staticTexts["live.finished"])
            attachScreenshot("player-complete-match")
            XCTAssertEqual(hostState["completion"] as? String, "complete")
            try tap("live.leave")
            let confirm = try confirmationButton("Leave room")
            attachScreenshot("player-leave-confirmation")
            try require(confirm); confirm.tap()
            try require(app.buttons["live.create"])
            _ = try await action("close", credential: host, state: hostState)
        } catch {
            if let state = try? await snapshot(host) { _ = try? await action("close", credential: host, state: state) }
            throw error
        }
    }

    func testEndedRoomClearsOldCodeAndRequiresFreshSharingConsent() async throws {
        let host = try await admit(path: "rooms", values: ["settings": ["topic": "mix", "cycles": 1, "capacity": 12, "answerSeconds": 0, "predictSeconds": 0]])
        do {
            let code = app.textFields["live.code"], name = app.textFields["live.nickname"]
            try require(code); try reveal(code); code.tap(); code.typeText(host.code + "\n")
            try require(name)
            let nicknameReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: name)
            guard await XCTWaiter.fulfillment(of: [nicknameReady], timeout: 5) == .completed else { throw TestError.unreachableControl }
            app.typeText("ConsentQA\n")
            let named = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "ConsentQA"), object: name)
            guard await XCTWaiter.fulfillment(of: [named], timeout: 5) == .completed else { throw TestError.inputNotConfirmed }
            try await dismissKeyboard()
            try tap("live.consent")
            XCTAssertEqual(try require(app.switches["live.consent"]).value as? String, "1")
            try tap("live.join")
            try require(app.staticTexts["live.roomCode"])
            let state = try await snapshot(host)
            _ = try await action("close", credential: host, state: state)
            try require(app.buttons["live.create"])
            let consent = try require(app.switches["live.consent"])
            try reveal(consent)
            let freshConsent = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "0"), object: consent)
            let reset = await XCTWaiter.fulfillment(of: [freshConsent], timeout: 5)
            XCTAssertEqual(reset, .completed, "A new room needs a fresh sharing choice after the previous room ends")
            XCTAssertNotEqual(try require(app.textFields["live.code"]).value as? String, host.code)
            XCTAssertFalse(app.buttons["live.join"].isEnabled)
            attachScreenshot("ended-room-fresh-consent")
        } catch {
            if let state = try? await snapshot(host) { _ = try? await action("close", credential: host, state: state) }
            throw error
        }
    }

    func testBrowserHostedRoomCrossplay() async throws {
        guard let supplied = ProcessInfo.processInfo.environment["LIKERTS_LIVE_BROWSER_ROOM"],
              supplied.range(of: "^[A-HJ-NP-Z2-9]{6}$", options: .regularExpression) != nil else {
            throw XCTSkip("Set LIKERTS_LIVE_BROWSER_ROOM to an isolated browser-hosted six-character live room.")
        }
        // Browser host and peer actions are performed by the external browser
        // operator. This journey uses only real native controls and visible state.
        let code = app.textFields["live.code"], name = app.textFields["live.nickname"]
        try require(code); try reveal(code); code.tap(); code.typeText(supplied + "\n")
        try require(name)
        let nicknameReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: name)
        guard await XCTWaiter.fulfillment(of: [nicknameReady], timeout: 5) == .completed else {
            XCTFail("Keyboard Next must reveal the nickname field")
            throw TestError.unreachableControl
        }
        app.typeText("NativeQA\n")
        let named = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "NativeQA"), object: name)
        guard await XCTWaiter.fulfillment(of: [named], timeout: 5) == .completed else {
            XCTFail("The native nickname must be entered through the keyboard before joining")
            throw TestError.inputNotConfirmed
        }
        try await dismissKeyboard()
        try tap("live.consent"); try tap("live.join")
        let roomCode = try require(app.staticTexts["live.roomCode"])
        XCTAssertTrue(roomCode.label == supplied, "The native player must join the requested browser room")
        attachScreenshot("browser-crossplay-joined")
        print("CROSSPLAY_NATIVE_JOINED")
        var subjectTurns = 0, predictionTurns = 0
        for roundIndex in 1...2 {
            let choice = app.buttons["live.choice.4"]
            try await waitForCrossplay(choice, predicate: "exists == true AND enabled == true", stage: "the native choice controls")
            let progress = app.staticTexts["ROUND \(roundIndex) OF 2"]
            try require(progress)
            let ownTurn = app.staticTexts["Your turn to be you."]
            let nativeSubject = ownTurn.exists
            let roleHeading = nativeSubject ? ownTurn : app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "In the spotlight:")).firstMatch
            try reveal(roleHeading)
            XCTAssertTrue(roleHeading.isHittable, "The subject role must be visible before locking")
            if nativeSubject { subjectTurns += 1 } else { predictionTurns += 1 }
            try assertChoiceTargets(); try tap("live.choice.4")
            XCTAssertEqual(app.buttons["live.choice.4"].value as? String, "Selected")
            try tap("live.submit")
            if nativeSubject {
                let locked = app.descendants(matching: .any).matching(identifier: "live.locked").firstMatch
                try await waitForCrossplay(locked, predicate: "exists == true AND label CONTAINS 'Locked: 4'", stage: "the confirmed private lock")
                XCTAssertFalse(app.staticTexts["live.revealedAnswer"].exists)
                try tap("live.close")
                try confirmationButton("Keep place and return home").tap()
                try tap("home.live"); try tap("live.resume")
                try await waitForCrossplay(locked, predicate: "exists == true AND label CONTAINS 'Locked: 4'", stage: "the resumed private lock")
                try reveal(locked)
                XCTAssertFalse(app.staticTexts["live.revealedAnswer"].exists, "Resuming must preserve the lock without revealing the answer")
                attachScreenshot("browser-crossplay-subject-locked-resumed")
                print("CROSSPLAY_NATIVE_SUBJECT_LOCKED_RESUMED")
            }
            // A predictor's lock may reveal immediately; no transient locked
            // screen is required when the only other player's answer is ready.
            let revealed = app.staticTexts["live.revealedAnswer"]
            try await waitForCrossplay(revealed, stage: "the completed round reveal")
            try reveal(revealed)
            XCTAssertTrue(revealed.label.contains("4"), "Both real players selected the same visible answer")
            attachScreenshot("browser-crossplay-round-\(roundIndex)-reveal")
            print("CROSSPLAY_NATIVE_REVEAL_\(roundIndex)")
            if roundIndex < 2 {
                try await waitForCrossplay(app.staticTexts["ROUND 2 OF 2"], stage: "the host's next round")
            } else {
                try await waitForCrossplay(app.staticTexts["live.finished"], stage: "the host's final scores")
            }
        }
        XCTAssertEqual(subjectTurns, 1, "Each of the two real players must get one subject turn")
        XCTAssertEqual(predictionTurns, 1)
        let finished = try require(app.staticTexts["live.finished"])
        try reveal(finished)
        XCTAssertEqual(finished.label, "A little better acquainted.", "The crossplay match must finish completely")
        attachScreenshot("browser-crossplay-complete-match")
        try tap("live.leave"); try confirmationButton("Leave room").tap()
        try require(app.buttons["live.create"])
        print("CROSSPLAY_NATIVE_FINISHED")
    }

    func testNativeHostCreatesLocksAndExplicitlyClosesRoom() async throws {
        try tap("live.create")
        try require(app.staticTexts["live.roomCode"])
        let code = app.staticTexts["live.roomCode"].label
        XCTAssertEqual(code.utf8.count, 6)
        let start = app.buttons["live.start"]
        try reveal(start); try require(start); XCTAssertFalse(start.isEnabled, "Host is a controller and two players are required")
        try tap("live.lockRoom")
        let count = app.descendants(matching: .any).matching(identifier: "live.rosterCount").firstMatch
        let locked = NSPredicate(format: "label CONTAINS %@", "Room locked")
        let roomLocked = expectation(for: locked, evaluatedWith: count)
        let lockResult = await XCTWaiter.fulfillment(of: [roomLocked], timeout: 15)
        XCTAssertEqual(lockResult, .completed, "The host's lock must reach the authoritative room state")
        attachScreenshot("host-locked-lobby")
        try tap("live.closeRoom")
        let close = try confirmationButton("Close room")
        attachScreenshot("host-close-confirmation")
        try require(close); close.tap()
        try require(app.buttons["live.create"])
    }
    func testNativeHostRemovalRequiresConfirmationAndEndsMatchIncomplete() async throws {
        try tap("live.create")
        try require(app.staticTexts["live.roomCode"])
        let code = app.staticTexts["live.roomCode"].label
        let removed = try await admit(path: "rooms/\(code)/join", values: ["nickname": "FirstQA", "acceptRoomSharing": true])
        let remaining = try await admit(path: "rooms/\(code)/join", values: ["nickname": "SecondQA", "acceptRoomSharing": true])
        let start = app.buttons["live.start"]
        let enabled = NSPredicate(format: "enabled == true")
        let readyToStart = expectation(for: enabled, evaluatedWith: start)
        let startResult = await XCTWaiter.fulfillment(of: [readyToStart], timeout: 15)
        XCTAssertEqual(startResult, .completed, "Two remote players must enable Start")
        try tap("live.start")
        try require(app.staticTexts["live.prompt"])
        try tap("live.pauseResume")
        let timer = app.staticTexts["live.timer"]
        let roundPaused = expectation(for: NSPredicate(format: "label == %@", "Round paused"), evaluatedWith: timer)
        let pauseResult = await XCTWaiter.fulfillment(of: [roundPaused], timeout: 15)
        XCTAssertEqual(pauseResult, .completed, "Pause must be visible before removing a player")
        let manage = try require(app.buttons["live.managePlayers"])
        try reveal(manage)
        XCTAssertGreaterThanOrEqual(manage.frame.height, 44)
        manage.tap()
        attachScreenshot("host-manage-players-expanded")
        try tap("live.remove.\(removed.memberId)")
        let remove = try confirmationButton("Remove player")
        try require(remove)
        XCTAssertFalse(app.staticTexts["live.finished"].exists, "Opening removal confirmation must not remove anyone")
        attachScreenshot("host-remove-confirmation")
        remove.tap()
        try require(app.staticTexts["live.finished"])
        attachScreenshot("host-incomplete-match")
        let state = try await snapshot(remaining)
        XCTAssertEqual(state["completion"] as? String, "incomplete")
        let reveal = try XCTUnwrap(state["reveal"] as? [String: Any])
        XCTAssertEqual(reveal["valid"] as? Bool, false)
        XCTAssertTrue(reveal["answer"] is NSNull)
        XCTAssertFalse(app.staticTexts["live.revealedAnswer"].exists)
        try tap("live.closeRoom")
        let close = try confirmationButton("Close room")
        attachScreenshot("host-incomplete-close-confirmation")
        try require(close); close.tap()
        try require(app.buttons["live.create"])
    }

    private struct Access { let code: String; let token: String; let memberId: String }
    private func admit(path: String, values: [String: Any]) async throws -> Access {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw TestError.randomUnavailable }
        let secret = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        var body = values; body["admissionId"] = UUID().uuidString; body["recoverySecret"] = secret
        let result = try await request(path: path, body: body)
        return Access(code: try XCTUnwrap(result["code"] as? String), token: try XCTUnwrap(result["token"] as? String), memberId: try XCTUnwrap(result["memberId"] as? String))
    }
    private func snapshot(_ credential: Access) async throws -> [String: Any] {
        let result = try await request(path: "rooms/\(credential.code)", token: credential.token)
        return try XCTUnwrap(result["state"] as? [String: Any])
    }
    private func action(_ action: String, credential: Access, state: [String: Any], extra: [String: Any] = [:]) async throws -> [String: Any] {
        var body = extra
        body["requestId"] = UUID().uuidString; body["matchId"] = state["matchId"]; body["action"] = action
        if let round = state["round"] as? [String: Any] { body["roundId"] = round["id"] }
        let response = try await request(path: "rooms/\(credential.code)/actions", token: credential.token, body: body)
        if action == "close" { XCTAssertEqual(response["closed"] as? Bool, true); return [:] }
        return try XCTUnwrap(response["state"] as? [String: Any])
    }
    private func request(path: String, token: String? = nil, body: [String: Any]? = nil) async throws -> [String: Any] {
        var request = URLRequest(url: base.appendingPathComponent("api/live").appendingPathComponent(path))
        request.timeoutInterval = 15; request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await network.data(for: request)
        let status = try XCTUnwrap((response as? HTTPURLResponse)?.statusCode)
        guard (200...299).contains(status) else { throw TestError.http(status) }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    private enum TestError: Error {
        case randomUnavailable, http(Int), missingControl, unreachableControl, disabledControl
        case ambiguousConfirmation, undersizedChoice, inputNotConfirmed
    }
    private func waitForCrossplay(_ element: XCUIElement, predicate: String = "exists == true", stage: String) async throws {
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate(format: predicate), object: element)
        guard await XCTWaiter.fulfillment(of: [expected], timeout: 120) == .completed else {
            XCTFail("Browser crossplay timed out waiting for \(stage)")
            throw TestError.missingControl
        }
    }
    private func confirmationButton(_ label: String, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        let buttons = app.sheets.buttons.matching(NSPredicate(format: "label == %@", label))
        let button = try require(buttons.firstMatch, file: file, line: line)
        guard buttons.count == 1 else {
            XCTFail("Expected one action in the confirmation dialog", file: file, line: line)
            throw TestError.ambiguousConfirmation
        }
        guard button.isHittable else {
            XCTFail("The confirmation action must be reachable", file: file, line: line)
            throw TestError.unreachableControl
        }
        return button
    }
    private func assertChoiceTargets(file: StaticString = #filePath, line: UInt = #line) throws {
        for value in 1...5 {
            let choice = try require(app.buttons["live.choice.\(value)"], file: file, line: line)
            try reveal(choice, file: file, line: line)
            guard choice.frame.width >= 44, choice.frame.height >= 44 else {
                XCTFail("Choice \(value) must have a target of at least 44 by 44 points", file: file, line: line)
                throw TestError.undersizedChoice
            }
        }
    }
    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        let mode = ProcessInfo.processInfo.environment["LIKERTS_LIVE_TEST_LARGE_TEXT"] == "1" ? "AX3-app-reduced-effects" : "standard"
        attachment.name = "live-\(name)-\(mode)"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @discardableResult private func require(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) throws -> XCUIElement {
        guard element.waitForExistence(timeout: 15) else {
            XCTFail("Expected live control", file: file, line: line)
            throw TestError.missingControl
        }
        return element
    }
    private func reveal(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) throws {
        try require(element, file: file, line: line)
        for _ in 0..<6 {
            if element.isHittable { return }
            if element.frame.maxY < app.frame.minY + 90 { app.swipeDown(velocity: .slow) }
            else { app.swipeUp(velocity: .slow) }
        }
        guard element.exists && element.isHittable else {
            XCTFail("The live control could not be reached after bounded scrolling", file: file, line: line)
            throw TestError.unreachableControl
        }
    }
    private func tap(_ identifier: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let element = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        try reveal(element, file: file, line: line)
        guard element.isEnabled else {
            XCTFail("The live control must be enabled before tapping", file: file, line: line)
            throw TestError.disabledControl
        }
        element.tap()
    }
    private func dismissKeyboard() async throws {
        let keyboard = app.keyboards.firstMatch
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: keyboard)
        if await XCTWaiter.fulfillment(of: [dismissed], timeout: 2) == .completed { return }
        let keys = ["Done", "Return"].map { app.keyboards.buttons[$0] }
        guard let done = keys.first(where: { $0.exists && $0.isHittable && $0.isEnabled }) else {
            XCTFail("The nickname keyboard must offer a reachable dismissal action")
            throw TestError.unreachableControl
        }
        done.tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: keyboard)
        guard await XCTWaiter.fulfillment(of: [gone], timeout: 3) == .completed else {
            XCTFail("The nickname keyboard did not dismiss")
            throw TestError.unreachableControl
        }
    }
}
