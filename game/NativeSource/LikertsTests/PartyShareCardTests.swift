#if canImport(UIKit) && canImport(SwiftUI)
import UIKit
import SwiftUI
import XCTest
@testable import Likerts

@MainActor
final class PartyShareCardTests: XCTestCase {
    func testExportedCardsRenderCompletedBoardAndHonestPerfectRead() throws {
        let challenge = try Challenge(name: "Jo", promptIDs: [1, 2, 3, 4, 5], answers: [1, 2, 3, 4, 5])
        var board = PartyBoard(challenge: challenge)
        let perfect = try board.complete(name: "Sam", guesses: challenge.answers)
        let reverse = try board.complete(name: "Sam", guesses: Array(challenge.answers.reversed()))
        XCTAssertEqual(board.runs.count, 2)
        XCTAssertEqual(perfect.score, 100)
        XCTAssertTrue(perfect.insight.allMatched)
        XCTAssertEqual(reverse.score, 40)
        XCTAssertEqual(reverse.displayName, "Sam · 2")
        XCTAssertFalse(reverse.insight.allMatched)

        for (run, attachmentName) in [
            (reverse, "party-11-exported-share-card"),
            (perfect, "party-12-perfect-share-card")
        ] {
            let renderer = ImageRenderer(content:
                PartyShareCard(board: board, run: run)
                    .padding(22)
                    .frame(width: 390)
                    .background(Palette.cream)
                    .environment(\.dynamicTypeSize, .medium)
                    .environment(\.colorScheme, .light)
            )
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.uiImage)
            let pixels = try XCTUnwrap(image.cgImage)
            XCTAssertEqual(CGFloat(pixels.width), 780, accuracy: 1)
            XCTAssertGreaterThan(pixels.height, pixels.width)
            let attachment = XCTAttachment(image: image)
            attachment.name = attachmentName
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
}
#endif
