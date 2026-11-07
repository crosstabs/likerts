import XCTest

/// Pass-the-phone party play. Every guess is locked before the host gets the
/// phone back; these tests never send a result or contact another player.
@MainActor
final class PartyUITests: XCTestCase {
    private var app: XCUIApplication!
    private let hostAnswers = [1, 2, 3, 4, 5]

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()
        require(app.buttons["home.party"].firstMatch)
    }

    func testBlindGuessingRequiresHandBackBeforeResults() {
        let firstQuestion = beginParty()
        beginFriend("Sam")
        XCTAssertEqual(currentQuestion(), firstQuestion)
        screenshot("party-01-blind-first-guess")
        blindGuessFive(hostAnswers)

        require(app.buttons["party.handBack"].firstMatch)
        XCTAssertFalse(node("party.board").exists)
        XCTAssertFalse(node("party.score.0").exists)
        XCTAssertFalse(node("round.reveal").exists)
        screenshot("party-02-hand-back-gate")
        tap("party.handBack")
        require(node("party.board"))
        XCTAssertTrue(label("party.score.0").contains("100%"))
        XCTAssertTrue(label("party.count").contains("1 completed friend"))
        screenshot("party-03-first-leaderboard")
    }

    func testMultipleFriendsSortByScoreAndMarkTies() {
        _ = beginParty()
        beginFriend("Ari")
        finishFriend(hostAnswers)
        let pack = label("party.pack")
        XCTAssertFalse(pack.isEmpty)

        tap("party.addFriend")
        beginFriend("Bo")
        finishFriend([5, 4, 3, 2, 1])
        XCTAssertTrue(label("party.score.1").contains("40%"))
        XCTAssertEqual(label("party.pack"), pack)

        tap("party.addFriend")
        beginFriend("Cy")
        finishFriend(hostAnswers)
        XCTAssertTrue(label("party.count").contains("3 completed friends"))
        XCTAssertTrue(label("party.score.0").contains("100%"))
        XCTAssertTrue(label("party.score.2").contains("100%"))
        XCTAssertTrue(label("party.tie.0").contains("Tied #1"))
        XCTAssertTrue(label("party.tie.2").contains("Tied #1"))
        XCTAssertLessThan(node("party.name.0").frame.minY, node("party.name.1").frame.minY)
        XCTAssertLessThan(node("party.name.2").frame.minY, node("party.name.1").frame.minY)
        XCTAssertEqual(label("party.pack"), pack)
        screenshot("party-04-leaderboard-ties")
    }

    func testDuplicateNamesReplayReplacesEntryAndInsightCanShare() {
        let firstQuestion = beginParty()
        beginFriend("Sam")
        finishFriend(hostAnswers)
        let pack = label("party.pack")
        tap("party.addFriend")
        beginFriend("Sam")
        finishFriend([5, 4, 3, 2, 1])
        XCTAssertEqual(label("party.name.0"), "Sam")
        XCTAssertEqual(label("party.name.1"), "Sam · 2")
        XCTAssertTrue(label("party.count").contains("2 completed friends"))

        tap("party.reveal.1")
        require(node("party.insight"))
        screenshot("party-05-personal-insight")
        tap("party.insight.share")
        verifyAndDismissNativeShare()
        require(node("party.insight"))
        tap("party.insight.back")
        require(node("party.board"))
        tap("party.reveal.1")
        tap("party.replay")
        XCTAssertEqual(currentQuestion(), firstQuestion, "Replay must use the same host's five takes.")
        finishFriend([3, 3, 3, 3, 3])
        XCTAssertTrue(label("party.score.1").contains("70%"))
        XCTAssertTrue(label("party.score.0").contains("100%"))
        XCTAssertEqual(label("party.name.1"), "Sam · 2")
        XCTAssertTrue(label("party.count").contains("2 completed friends"), "Replay replaces an existing friend's latest attempt.")
        XCTAssertFalse(node("party.name.2").exists)
        XCTAssertEqual(label("party.pack"), pack)
        screenshot("party-07-replay-replaces-entry")
    }

    func testLeaveCancelAbandonedTurnAndResetPreserveHostPack() {
        let firstQuestion = beginParty()
        beginFriend("Ari")
        tap("round.choice.4")
        tap("nav.close")
        tapAlert("party.leave.cancel")
        XCTAssertEqual(app.buttons["round.choice.4"].firstMatch.value as? String, "selected")
        finishFriend(hostAnswers)
        let pack = label("party.pack")

        tap("party.addFriend")
        beginFriend("Unfinished")
        tap("round.choice.5")
        tap("nav.close")
        tapAlert("party.turn.cancel")
        require(node("party.board"))
        XCTAssertTrue(label("party.count").contains("1 completed friend"))
        XCTAssertTrue(label("party.score.0").contains("100%"))

        tap("party.reset")
        tapAlert("party.reset.cancel")
        XCTAssertTrue(label("party.count").contains("1 completed friend"))
        tap("party.reset")
        tapAlert("party.reset.confirm")
        require(node("party.board"))
        XCTAssertTrue(label("party.count").contains("0 completed friends"))
        XCTAssertFalse(node("party.name.0").exists)
        XCTAssertEqual(label("party.pack"), pack, "Reset clears completed friends, not the host's five takes.")
        screenshot("party-08-reset-keeps-host-pack")

        tap("party.addFriend")
        beginFriend("New friend")
        XCTAssertEqual(currentQuestion(), firstQuestion)
        finishFriend(hostAnswers)
        XCTAssertTrue(label("party.count").contains("1 completed friend"))
        XCTAssertTrue(label("party.score.0").contains("100%"))
        tap("party.leave")
        tapAlert("party.leave.confirm")
        require(app.buttons["home.party"].firstMatch)
    }

    func testLargeTextPartyControlsReachHandBackAndBoard() {
        app.terminate()
        app.launchArguments = ["-ui-testing", "-large-text"]
        app.launch()
        _ = beginParty()
        beginFriend()
        tap("round.choice.3")
        screenshot("party-09-large-text-blind-selection")
        finishFriend([3, 3, 3, 3, 3])
        XCTAssertTrue(label("party.score.0").contains("70%"))
        screenshot("party-10-large-text-leaderboard")
        tap("party.leave")
        tapAlert("party.leave.confirm")
        require(app.buttons["home.party"].firstMatch)
    }

    @discardableResult
    private func beginParty() -> String {
        tap("home.party")
        require(app.textFields["party.hostName"].firstMatch)
        // Empty optional names exercise the product's defaults.
        tap("party.beginHost")
        let question = currentQuestion()
        for answer in hostAnswers {
            tap("round.choice.\(answer)")
            tap("round.next")
        }
        require(app.textFields["party.friendName"].firstMatch)
        return question
    }

    private func beginFriend(_ name: String = "") {
        let field = require(app.textFields["party.friendName"].firstMatch)
        if !name.isEmpty { field.tap(); field.typeText(name) }
        tap("party.beginFriend")
        require(app.buttons["round.choice.1"].firstMatch)
    }

    private func blindGuessFive(_ guesses: [Int]) {
        for guess in guesses {
            assertNoPrematureAnswer()
            tap("round.choice.\(guess)")
            tap("round.next")
            assertNoPrematureAnswer()
        }
        require(app.buttons["party.handBack"].firstMatch)
    }

    private func finishFriend(_ guesses: [Int]) {
        blindGuessFive(guesses)
        tap("party.handBack")
        require(node("party.board"))
    }

    private func assertNoPrematureAnswer(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(node("round.reveal").exists, "Party guesses must stay blind until hand-back.", file: file, line: line)
        XCTAssertFalse(app.staticTexts["100%"].exists, file: file, line: line)
        let comparison = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "You guessed", " picked ")).firstMatch
        XCTAssertFalse(comparison.exists, "An unfinished friend's turn must not expose answer comparisons.", file: file, line: line)
    }

    private func currentQuestion() -> String {
        let text = require(node("round.prompt")).label
        // Shared RoundView combines its small eyebrow with question text.
        if let comma = text.firstIndex(of: ",") {
            let prefix = text[..<comma].trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            if prefix == "YOUR TAKE" || prefix == "YOUR PREDICTION" {
                return String(text[text.index(after: comma)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return text
    }

    private func node(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func label(_ identifier: String) -> String { require(node(identifier)).label }

    @discardableResult
    private func require(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.exists || element.waitForExistence(timeout: 8), "Expected \(element) to exist.", file: file, line: line)
        return element
    }

    private func tap(_ identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        let query = app.buttons.matching(identifier: identifier)
        require(query.firstMatch, file: file, line: line)
        let button = query.allElementsBoundByIndex.first(where: { $0.isHittable }) ?? query.firstMatch
        reveal(button)
        XCTAssertTrue(button.isEnabled, "\(identifier) should be enabled.", file: file, line: line)
        button.tap()
        if identifier.hasPrefix("round.choice.") {
            XCTAssertEqual(button.value as? String, "selected", file: file, line: line)
        }
    }

    private func tapAlert(_ identifier: String) {
        let alert = require(app.alerts.firstMatch)
        require(alert.buttons[identifier].firstMatch).tap()
    }

    private func reveal(_ element: XCUIElement) {
        if ["round.next", "nav.close"].contains(element.identifier), element.isHittable { return }
        let scrolls = app.scrollViews.allElementsBoundByIndex
        let containing = scrolls.last { !element.identifier.isEmpty && $0.descendants(matching: .any).matching(identifier: element.identifier).count > 0 }
        if containing == nil, element.isHittable, app.frame.contains(element.frame) { return }
        guard let scroll = scrolls.first(where: { $0.isHittable }) ?? scrolls.first else { return }
        for _ in 0..<10 {
            let frame = element.frame
            var top = max(scroll.frame.minY, app.frame.minY + 20)
            var bottom = min(scroll.frame.maxY, app.frame.maxY - 12)
            if let keyboard = app.keyboards.allElementsBoundByIndex.first(where: { $0.exists }) {
                bottom = min(bottom, keyboard.frame.minY - 8)
            }
            if element.identifier.hasPrefix("round.choice.") {
                let close = app.buttons["nav.close"].firstMatch
                let next = app.buttons["round.next"].firstMatch
                if close.exists { top = max(top, close.frame.maxY + 16) }
                if next.exists { bottom = min(bottom, next.frame.minY - 10) }
            }
            if element.isHittable && frame.minY >= top && frame.maxY <= bottom { return }
            if frame.minY < top { scroll.swipeDown() } else { scroll.swipeUp() }
        }
    }

    private func verifyAndDismissNativeShare() {
        let close = app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != %@", "Close", "nav.close")).firstMatch
        let activity = app.otherElements["ActivityListView"].firstMatch
        let copy = app.buttons["Copy"].firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 5) || close.waitForExistence(timeout: 3) || copy.waitForExistence(timeout: 3))
        screenshot("party-06-native-insight-share")
        if close.exists && close.isHittable { close.tap() } else { app.swipeDown() }
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
