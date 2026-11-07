import XCTest

/// The two variants use the same real practice controls. Root may record the
/// approved Simulator around this test to inspect the short art-only entrances.
/// The reduced variant is an app-local QA override, not an OS-setting claim.
@MainActor final class QuizSceneUITests: XCTestCase {
    private var app: XCUIApplication!
    private enum Failure: Error { case missing, unreachable, wrongOutcome }

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard env["SIMULATOR_UDID"] == "78680FA8-DE77-41F8-9948-7D20D57A6340",
              env["LIKERTS_QUIZ_SCENE_UI_TESTS"] == "1" else {
            throw XCTSkip("Scene UI proof requires explicit opt-in on the approved QA Simulator before any activation.")
        }
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-quiz-library-testing", "-quiz-scene-motion-testing",
                               "-quiz-scene-motion-scope", UUID().uuidString.lowercased()]
        if name.contains("AppLocalReduced") { app.launchArguments.append("-quiz-scene-reduced-motion-testing") }
        if env["LIKERTS_QUIZ_SCENE_LARGE_TEXT"] == "1" { app.launchArguments += ["-largest-text", "-accessible-effects"] }
        app.launch()
    }

    override func tearDown() { app?.terminate(); app = nil }

    func testOptedInSceneMotionKeepsPracticeAndReplayFunctional() throws { try practiceJourney() }
    func testAppLocalReducedSceneMotionKeepsPracticeAndReplayFunctional() throws { try practiceJourney() }

    private func practiceJourney() throws {
        print("QUIZ_SCENE_QA action=open-library")
        try tap("home.quizzes")
        capture("library-neutral-stage")
        try reveal(item("quiz.library.sampleCopy"))
        let library = try require(app.scrollViews["quiz.library.scroll"])
        library.swipeUp(velocity: .slow)
        capture("library-original-book-flag-scene")
        print("QUIZ_SCENE_QA action=start-practice")
        try tap("quiz.library.samplePractice")
        let expected = ["Red Planet", "triangle", "ocean"]
        for (index, answer) in [1, 1, 2].enumerated() {
            let prompt = try require(item("quiz.practice.prompt"))
            guard prompt.label.localizedCaseInsensitiveContains(expected[index]) else { throw Failure.wrongOutcome }
            try reveal(prompt)
            print("QUIZ_SCENE_QA phase=practice-question-\(index + 1)")
            capture("practice-question-\(index + 1)-stage")
            print("QUIZ_SCENE_QA action=select-answer-\(index + 1)")
            try tap("quiz.practice.answer.\(answer)")
            if index == 0 {
                XCUIDevice.shared.press(.home); app.activate()
                guard item("quiz.practice.prompt").label.localizedCaseInsensitiveContains("Red Planet") else { throw Failure.wrongOutcome }
                print("QUIZ_SCENE_QA phase=same-question-after-foreground")
                capture("same-question-after-foreground")
            }
            try tap("quiz.practice.lock")
            let feedback = try require(item("quiz.practice.feedback"))
            guard feedback.label == "Correct!", item("quiz.practice.roundPoints").label.filter(\.isNumber) == "1000" else {
                XCTFail("Decorative motion must not change the actual practice result"); throw Failure.wrongOutcome
            }
            try reveal(feedback)
            print("QUIZ_SCENE_QA phase=practice-feedback-\(index + 1)")
            capture("practice-feedback-\(index + 1)-stage")
            try tap("quiz.practice.next")
        }
        try reveal(item("quiz.practice.complete"))
        guard item("quiz.practice.correctCount").label == "3 of 3 correct",
              item("quiz.practice.score").label.filter(\.isNumber) == "3000" else { throw Failure.wrongOutcome }
        try reveal(item("quiz.practice.return"))
        print("QUIZ_SCENE_QA phase=practice-completion")
        capture("practice-results-original-cast-stage")
        print("QUIZ_SCENE_QA action=replay-new-journey")
        try tap("quiz.practice.replay")
        let replay = try require(item("quiz.practice.prompt"))
        guard replay.label.localizedCaseInsensitiveContains("Red Planet") else { throw Failure.wrongOutcome }
        try reveal(replay)
        print("QUIZ_SCENE_QA phase=replay-first-question")
        capture("replay-new-journey-first-stage")
        // End only this synthetic, unsaved practice through the normal prompt.
        let close = app.buttons["Close"].firstMatch
        try reveal(close); close.tap()
        try tap("quiz.practice.confirmLeave")
        try require(app.buttons["quiz.library.samplePractice"])
    }

    private func item(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
    @discardableResult private func require(_ element: XCUIElement) throws -> XCUIElement {
        guard element.waitForExistence(timeout: 15) else { XCTFail("Missing scene control: \(element.identifier)"); throw Failure.missing }
        return element
    }
    @discardableResult private func reveal(_ element: XCUIElement) throws -> XCUIElement {
        try require(element)
        for _ in 0..<12 {
            if element.isHittable { return element }
            if element.frame.maxY < 100 { app.swipeDown(velocity: .slow) } else { app.swipeUp(velocity: .slow) }
        }
        guard element.isHittable else { XCTFail("Unreachable scene control: \(element.identifier)"); throw Failure.unreachable }
        return element
    }
    private func tap(_ id: String) throws {
        let element = try reveal(item(id)); guard element.isEnabled else { throw Failure.unreachable }; element.tap()
    }
    private func capture(_ label: String) {
        let mode = name.contains("AppLocalReduced") ? "app-local-reduced" : "motion-opt-in"
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "quiz-scene-\(mode)-\(label)"; shot.lifetime = .keepAlways; add(shot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "quiz-scene-\(mode)-\(label)-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
