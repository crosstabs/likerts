import XCTest

final class NativeAcceptanceUITests: XCTestCase {
    func testRealNativeControlsEmitExactV5Answers() {
        let app = XCUIApplication()
        app.launch()
        let status = app.staticTexts["host-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 20))
        XCTAssertEqual(status.label, "Awaiting native interaction")

        func reveal(_ element: XCUIElement) {
            for _ in 0..<6 where !element.isHittable { app.swipeUp() }
            XCTAssertTrue(element.isHittable, "Expected native control to be reachable: \(element)")
        }
        let submit = app.buttons["acceptance-submit"]
        reveal(submit)
        submit.tap()
        let error = app.descendants(matching: .any)["acceptance-error"].firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 3))
        XCTAssertTrue(error.label.contains("required") || error.label.contains("complete"))
        XCTAssertEqual(status.label, "Awaiting native interaction")

        let down = app.buttons["acceptance-rank-a-down"]
        for _ in 0..<6 where !down.isHittable { app.swipeDown() }
        XCTAssertTrue(down.isHittable)
        down.tap()
        XCTAssertTrue(app.staticTexts["1. B"].exists)
        let matrix = app.descendants(matching: .any)["acceptance-matrix-r-two"].firstMatch
        reveal(matrix)
        matrix.tap()
        XCTAssertEqual(matrix.value as? String, "radio button, checked", "The matrix radio must expose its checked state to iOS accessibility")
        let x = app.textFields["acceptance-sum-x"]
        reveal(x)
        x.tap()
        x.typeText("60")
        let y = app.textFields["acceptance-sum-y"]
        reveal(y)
        y.tap()
        y.typeText("40")
        // Number pads have no Done key. Drag the host to dismiss/reveal the submit control.
        app.swipeUp()
        reveal(submit)
        XCTAssertEqual(app.staticTexts["acceptance-sum-remaining"].label, "0 remaining")
        submit.tap()
        let pass = NSPredicate(format: "label == %@", "NATIVE PASS — exact answers, one submission")
        expectation(for: pass, evaluatedWith: status)
        waitForExpectations(timeout: 5)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
