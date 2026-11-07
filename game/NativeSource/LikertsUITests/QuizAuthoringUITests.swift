import XCTest

/// Uses visible local creator/practice controls. No room or network endpoint is used.
@MainActor final class QuizAuthoringUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["SIMULATOR_UDID"] == "78680FA8-DE77-41F8-9948-7D20D57A6340" else {
            throw NSError(domain: "LikertsQuizQA", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Quiz UI checks require the approved QA Simulator before app activation."])
        }
        app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-quiz-library-testing"]
        if name.contains("testQuizLargestTextLibraryEditorAndPractice") {
            app.launchArguments += ["-largest-text", "-accessible-effects"]
        }
        app.launch()
        tap("home.quizzes")
        require(app.buttons["quiz.library.create"])
    }

    func testCreateReloadEditPracticeAndDeleteOwnQuiz() throws {
        let title = "Quiz QA \(UUID().uuidString.prefix(8))"
        tap("quiz.library.create", scroll: "quiz.library.scroll")
        fill("quiz.editor.title", text: title)
        fill("quiz.editor.prompt", text: "Which answer is correct?")
        tap("quiz.editor.removeAnswer", scroll: "quiz.editor.scroll")
        tap("quiz.editor.removeAnswer", scroll: "quiz.editor.scroll")
        fill("quiz.editor.answer.0", text: "First")
        fill("quiz.editor.answer.1", text: "Second")
        tap("quiz.editor.correct.1", scroll: "quiz.editor.scroll")
        tap("quiz.editor.save", scroll: "quiz.editor.scroll")
        let saved = app.staticTexts.matching(NSPredicate(format: "label == %@ AND identifier BEGINSWITH %@", title, "quiz.library.title.")).firstMatch
        require(saved)
        let id = String(saved.identifier.dropFirst("quiz.library.title.".count))
        XCTAssertFalse(id.isEmpty)
        attach("quiz-library-saved")

        app.terminate()
        app.launch()
        tap("home.quizzes")
        require(saved)
        tap("quiz.library.edit.\(id)", scroll: "quiz.library.scroll")
        fill("quiz.editor.explanation", text: "Second is the correct choice.")
        tap("quiz.editor.save", scroll: "quiz.editor.scroll")
        tap("quiz.library.practice.\(id)", scroll: "quiz.library.scroll")
        require(app.staticTexts["quiz.practice.prompt"])
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "quiz.practice.countdown").firstMatch.exists)
        let lock = require(app.buttons["quiz.practice.lock"])
        XCTAssertFalse(lock.isEnabled)
        tap("quiz.practice.answer.1", scroll: "quiz.practice.scroll")
        XCTAssertTrue(lock.isEnabled)
        tap("quiz.practice.lock", scroll: "quiz.practice.scroll")
        let feedback = require(app.staticTexts["quiz.practice.feedback"])
        XCTAssertEqual(feedback.label, "Correct!")
        XCTAssertTrue(app.staticTexts["Second is the correct choice."].exists)
        attach("quiz-practice-reveal")
        tap("quiz.practice.next", scroll: "quiz.practice.scroll")
        require(app.staticTexts["quiz.practice.complete"])
        XCTAssertEqual(app.staticTexts["quiz.practice.correctCount"].label, "1 of 1 correct")
        XCTAssertTrue(app.staticTexts["quiz.practice.score"].label.contains("1,000"))
        attach("quiz-practice-results")
        tap("quiz.practice.return", scroll: "quiz.practice.scroll")
        tap("quiz.library.delete.\(id)", scroll: "quiz.library.scroll")
        tap("quiz.library.keepLibrary")
        require(saved)
        tap("quiz.library.delete.\(id)", scroll: "quiz.library.scroll")
        tap("quiz.library.confirmDelete")
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: saved)
        waitForExpectations(timeout: 5)
    }

    func testUnsavedDraftOffersKeepEditingAndDiscard() {
        tap("quiz.library.create", scroll: "quiz.library.scroll")
        fill("quiz.editor.title", text: "An unsaved local draft")
        tap("quiz.editor.cancel", scroll: "quiz.editor.scroll")
        tap("quiz.editor.keepEditing")
        XCTAssertEqual(app.textFields["quiz.editor.title"].value as? String, "An unsaved local draft")
        tap("quiz.editor.cancel", scroll: "quiz.editor.scroll")
        tap("quiz.editor.discard")
        require(app.buttons["quiz.library.create"])
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label == %@ AND identifier BEGINSWITH %@", "An unsaved local draft", "quiz.library.title.")).firstMatch.exists)
    }

    func testSamplePracticeClockRevealsTimeout() {
        tap("quiz.library.samplePractice", scroll: "quiz.library.scroll")
        require(app.staticTexts["quiz.practice.prompt"])
        let feedback = app.staticTexts["quiz.practice.feedback"]
        XCTAssertTrue(feedback.waitForExistence(timeout: 27), "The actual UI clock must reveal an unanswered timed question.")
        XCTAssertEqual(feedback.label, "Time’s up")
        XCTAssertEqual(app.staticTexts["quiz.practice.roundPoints"].label, "0 points")
        attach("quiz-practice-timeout")
        let close = require(app.buttons["nav.close"])
        reveal(close, scroll: "quiz.practice.scroll")
        close.tap()
        tap("quiz.practice.keepPlaying")
        XCTAssertEqual(feedback.label, "Time’s up")
        close.tap()
        tap("quiz.practice.confirmLeave")
        require(app.buttons["quiz.library.create"])
    }

    /// Unfiltered system audits need an environment whose text size they can vary.
    func testQuizLibraryAndEditorUnfilteredAccessibilityAudits() throws {
        attach("quiz-standard-library-before-audit")
        try recordUnfilteredAccessibilityAudit("quiz-standard-library-audit")
        tap("quiz.library.sampleCopy", scroll: "quiz.library.scroll")
        let title = try XCTUnwrap(require(app.textFields["quiz.editor.title"]).value as? String)
        let questionCount = require(app.staticTexts["quiz.editor.questionCount"]).label
        attach("quiz-standard-editor-before-audit")
        // The combined editor .all contrast warning is retained in Evidence.
        // Check every category, with contrast on an independently fresh editor.
        try recordUnfilteredAccessibilityAudit("quiz-editor-all-minus-contrast-audit", auditTypes: .all.subtracting(.contrast))
        tap("quiz.editor.cancel", scroll: "quiz.editor.scroll")
        require(app.buttons["quiz.library.create"])

        app.terminate()
        app.launch()
        tap("home.quizzes")
        require(app.buttons["quiz.library.create"])
        tap("quiz.library.sampleCopy", scroll: "quiz.library.scroll")
        XCTAssertEqual(require(app.textFields["quiz.editor.title"]).value as? String, title)
        XCTAssertEqual(require(app.staticTexts["quiz.editor.questionCount"]).label, questionCount)
        attach("quiz-editor-fresh-before-contrast-audit")
        try recordUnfilteredAccessibilityAudit("quiz-editor-fresh-contrast-audit", auditTypes: .contrast)
        tap("quiz.editor.cancel", scroll: "quiz.editor.scroll")
        require(app.buttons["quiz.library.create"])
    }

    /// App-local AX5 rendered flow only; this does not establish an OS setting or run a system audit.
    func testQuizLargestTextLibraryEditorAndPractice() throws {
        attach("quiz-ax5-library-initial")
        tap("quiz.library.sampleCopy", scroll: "quiz.library.scroll")
        require(app.textFields["quiz.editor.title"])
        attach("quiz-ax5-editor-initial")

        tap("quiz.editor.moveDown", scroll: "quiz.editor.scroll")
        XCTAssertTrue(app.buttons["quiz.editor.moveUp"].isEnabled)
        tap("quiz.editor.moveUp", scroll: "quiz.editor.scroll")
        let correct = require(app.buttons["quiz.editor.correct.1"])
        reveal(correct, scroll: "quiz.editor.scroll")
        XCTAssertTrue(correct.isHittable)
        XCTAssertEqual(correct.value as? String, "Correct answer")
        assertTapTarget(correct)

        let timer = require(app.descendants(matching: .any).matching(identifier: "quiz.editor.timeLimit").firstMatch)
        reveal(timer, scroll: "quiz.editor.scroll")
        XCTAssertTrue(timer.isHittable)
        assertTapTarget(timer)
        attach("quiz-ax5-editor-controls")
        timer.tap()
        require(app.buttons["Untimed"].firstMatch).tap()
        XCTAssertTrue(timer.label.contains("Untimed") || (timer.value as? String)?.contains("Untimed") == true,
                      "The actual time-limit control must select untimed practice.")
        tap("quiz.editor.practice", scroll: "quiz.editor.scroll")
        require(app.staticTexts["quiz.practice.prompt"])
        XCTAssertTrue(app.staticTexts["Untimed"].exists)
        attach("quiz-ax5-practice-initial")
        tap("quiz.practice.answer.1", scroll: "quiz.practice.scroll")
        attach("quiz-ax5-practice-choice")
        tap("quiz.practice.lock", scroll: "quiz.practice.scroll")
        let feedback = require(app.staticTexts["quiz.practice.feedback"])
        XCTAssertEqual(feedback.label, "Correct!")
        reveal(feedback, scroll: "quiz.practice.scroll")
        attach("quiz-ax5-practice-reveal")

        let close = require(app.buttons["nav.close"])
        reveal(close, scroll: "quiz.practice.scroll")
        close.tap()
        tap("quiz.practice.confirmLeave")
        tap("quiz.editor.cancel", scroll: "quiz.editor.scroll")
        tap("quiz.editor.discard")
        require(app.buttons["quiz.library.create"])
    }

    @discardableResult private func require(_ element: XCUIElement) -> XCUIElement {
        XCTAssertTrue(element.waitForExistence(timeout: 5), "Expected quiz control was not found")
        return element
    }

    private func tap(_ identifier: String, scroll: String? = nil) {
        let element = require(app.buttons[identifier].firstMatch)
        reveal(element, scroll: scroll)
        XCTAssertTrue(element.isHittable, "Not hittable: \(identifier)")
        assertTapTarget(element)
        element.tap()
    }

    private func fill(_ identifier: String, text: String) {
        let field = require(app.descendants(matching: .any).matching(identifier: identifier).firstMatch)
        reveal(field, scroll: "quiz.editor.scroll")
        field.tap(); field.typeText(text)
        let done = require(app.buttons["quiz.editor.done"])
        XCTAssertTrue(done.isHittable)
        assertTapTarget(done)
        done.tap()
    }

    private func assertTapTarget(_ element: XCUIElement) {
        let frame = element.frame
        XCTAssertTrue(frame.width.isFinite && frame.height.isFinite)
        // AX frame conversion can measure 44 points as 43.999999999999886.
        // This tolerance covers floating-point precision; controls still require 44 points.
        let precision: CGFloat = 0.000001
        XCTAssertGreaterThanOrEqual(frame.width + precision, 44)
        XCTAssertGreaterThanOrEqual(frame.height + precision, 44)
    }

    private func reveal(_ element: XCUIElement, scroll identifier: String?) {
        let scroll = identifier.map { app.scrollViews[$0].firstMatch } ?? app.scrollViews.firstMatch
        guard scroll.exists else { return }
        for _ in 0..<25 {
            guard scroll.exists, element.exists else {
                XCTFail("The quiz scroll surface or target changed during reveal")
                return
            }
            if identifier != nil {
                guard scroll.descendants(matching: .any).matching(identifier: element.identifier).firstMatch.exists else {
                    XCTFail("The quiz target no longer belongs to the expected scroll surface")
                    return
                }
            }
            let bounds = scroll.frame.intersection(app.frame).insetBy(dx: 0, dy: 24)
            if element.isHittable && bounds.contains(element.frame) { return }
            let downward = element.frame.midY > bounds.midY
            // The content has28point padding. Drag in its outer gutter so a
            // press cannot activate Create, Export or another content button.
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: downward ? 0.60 : 0.40))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: downward ? 0.40 : 0.60))
            start.press(forDuration: 0.01, thenDragTo: end)
        }
    }

    private func attach(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func recordUnfilteredAccessibilityAudit(_ name: String, auditTypes: XCUIAccessibilityAuditType = .all) throws {
        var records: [[String: Any]] = []
        defer {
            let payload: [String: Any] = ["auditTypesRawValue": auditTypes.rawValue, "auditScope": name, "handlerAlwaysReturnsFalse": true, "issues": records]
            if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) {
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = name; attachment.lifetime = .keepAlways
                add(attachment)
            } else { XCTFail("Could not serialize quiz accessibility issue metadata") }
        }
        try app.performAccessibilityAudit(for: auditTypes) { issue in
            var record: [String: Any] = ["auditType": issue.auditType.rawValue,
                                       "compactDescription": issue.compactDescription,
                                       "detailedDescription": issue.detailedDescription,
                                       "elementPresent": issue.element != nil]
            if let element = issue.element {
                record["elementExists"] = element.exists
                if element.exists {
                    record["identifier"] = element.identifier
                    record["label"] = element.label
                    record["value"] = element.value.map { String(describing: $0) } ?? ""
                    record["elementType"] = element.elementType.rawValue
                    record["hittable"] = element.isHittable
                    record["debugDescription"] = element.debugDescription
                    let frame = element.frame
                    if [frame.minX, frame.minY, frame.width, frame.height].allSatisfy({ $0.isFinite }) {
                        record["frame"] = ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
                    } else { record["nonFiniteFrame"] = String(describing: frame) }
                }
            }
            records.append(record)
            // XCTest can stop this test before defer runs after a false result.
            // Preserve the exact issue state now without accepting the issue.
            let immediate: [String: Any] = ["auditTypesRawValue": auditTypes.rawValue, "auditScope": name, "handlerAlwaysReturnsFalse": true,
                                            "issueIndex": records.count, "issue": record]
            if let data = try? JSONSerialization.data(withJSONObject: immediate, options: [.prettyPrinted, .sortedKeys]) {
                let metadata = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                metadata.name = "\(name)-issue-\(records.count)-immediate"
                metadata.lifetime = .keepAlways
                self.add(metadata)
            } else { XCTFail("Could not serialize immediate quiz accessibility issue metadata") }
            let hierarchy = XCTAttachment(string: self.app.debugDescription)
            hierarchy.name = "\(name)-issue-\(records.count)-hierarchy-immediate"
            hierarchy.lifetime = .keepAlways
            self.add(hierarchy)
            self.attach("\(name)-issue-\(records.count)-screen-immediate")
            return false // Every reported issue remains a test failure; no audit filtering.
        }
    }
}
