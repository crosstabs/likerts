import XCTest

final class LikertsSampleUITests: XCTestCase {
  func testLocalizedAccessibleSurveyCompletesOnSimulator() {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["likerts.title"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["likerts.title"].label, "Experiencia de compra")
    app.buttons["likerts.submit"].tap()
    XCTAssertTrue(app.staticTexts["likerts.error"].waitForExistence(timeout: 2))
    XCTAssertEqual(app.staticTexts["likerts.error"].label, "Falta Comentario")
    let comment = app.textFields["likerts.comment"]
    XCTAssertTrue(comment.exists)
    comment.tap()
    comment.typeText("Más rápido")
    app.buttons["likerts.submit"].tap()
    XCTAssertTrue(app.staticTexts["sample.completed"].waitForExistence(timeout: 2))
  }
}
