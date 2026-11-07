#if canImport(UIKit) && canImport(Messages)
import XCTest
import SwiftUI
import UIKit
import CryptoKit
@testable import Likerts

/// A live UIKit host is required: ImageRenderer omits scroll-container content.
/// These shared-view captures do not certify the Messages host or delivery.
@MainActor final class MessagesAdaptiveLayoutTests: XCTestCase {
    func testTabletPortraitLandscapeAndLargeTextPreserveIncomingSelectionAndReveal() async throws {
        let challenge = try Challenge(name: "Alex and a tiny pal", promptIDs: [1001,1002,1003,1004,1005], answers: [4,2,3,4,5])
        let model = MessagesGameModel()
        model.setConversation(.oneToOne, key: "layout-test")
        model.receive(try MessageEnvelopeCodec.encode(MessageEnvelope(id: UUID(), challenge: challenge)), isOwn: false)
        model.playIncoming()
        let game = try XCTUnwrap(model.game)
        game.select(4)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        defer { window.isHidden = true; window.rootViewController = nil; previous?.makeKey() }
        var signatures: [String: String] = [:]
        for revealed in [false,true] {
            if revealed { game.next() }
            for size in [CGSize(width: 768, height: 1_024), CGSize(width: 1_024, height: 768)] {
                for large in [false,true] {
                    let name = "messages-tablet-\(Int(size.width))x\(Int(size.height))-\(large ? "large" : "normal")-\(revealed ? "reveal" : "selected")"
                    let content = MessagesGameView(model: model)
                        .frame(width: size.width, height: size.height)
                        .environment(\.dynamicTypeSize, large ? .accessibility3 : .large)
                        .environment(\.likertsReducedEffectsTest, true)
                    let host = UIHostingController(rootView: content)
                    window.rootViewController = host
                    window.frame = CGRect(origin: .zero, size: size)
                    window.makeKeyAndVisible()
                    host.view.frame = CGRect(origin: .zero, size: size)
                    host.view.setNeedsLayout(); host.view.layoutIfNeeded()
                    // Allow SwiftUI's scroll content and accessibility focus to
                    // mount in a real window before capturing the display pass.
                    try await Task.sleep(nanoseconds: 150_000_000)
                    host.view.layoutIfNeeded()
                    let format = UIGraphicsImageRendererFormat(); format.scale = 1
                    var drawn = false
                    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                        drawn = host.view.drawHierarchy(in: CGRect(origin: .zero, size: size), afterScreenUpdates: true)
                    }
                    XCTAssertTrue(drawn, "A real display pass is required")
                    XCTAssertEqual(image.size, size)
                    let key = "\(Int(size.width))-\(large)"
                    let bytes = try XCTUnwrap(image.pngData())
                    let signature = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
                    if revealed { XCTAssertNotEqual(signatures[key], signature, "The revealed view must contain a different visible result") }
                    else { signatures[key] = signature }
                    let attachment = XCTAttachment(image: image); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
                    XCTAssertTrue(model.game === game); XCTAssertEqual(game.selection, 4)
                    XCTAssertEqual(game.index, 0); XCTAssertEqual(game.revealed, revealed)
                    XCTAssertEqual(game.challenge, challenge)
                }
            }
        }
        XCTAssertEqual(game.roundPoints, 100)
        game.next(); XCTAssertEqual(game.index, 1); XCTAssertNil(game.selection); XCTAssertFalse(game.revealed)
    }
}
#endif
