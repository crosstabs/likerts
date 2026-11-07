import XCTest

/// Release-only responsive-launch measurements on the existing warm Simulator.
/// This records a local baseline, not a launch budget or physical-device result.
@MainActor
final class LaunchPerformanceUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOrdinaryHomeResponsiveLaunchBaseline() throws {
        #if DEBUG
        throw XCTSkip("Run this launch baseline with the Release configuration.")
        #else
        let app = XCUIApplication()
        app.launchArguments = []
        app.terminate()
        defer { app.terminate() }

        let options = XCTMeasureOptions()
        options.iterationCount = 3
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: options) {
            app.launch()
            defer { app.terminate() }
            // The metric ends at responsive launch. This checks that the
            // ordinary Home then appears, without a test fixture or reset flag.
            XCTAssertTrue(app.buttons["home.makeChallenge"].waitForExistence(timeout: 10),
                          "The ordinary Home must be available after responsive launch.")
        }
        #endif
    }
}
