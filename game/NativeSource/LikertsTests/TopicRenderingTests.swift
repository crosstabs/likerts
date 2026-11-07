#if canImport(UIKit) && !SWIFT_PACKAGE
import XCTest
import SwiftUI
import UIKit
import CryptoKit
@testable import Likerts

@MainActor
final class TopicRenderingTests: XCTestCase {
    func testAllOneThousandProductionStartingScenesRenderDistinctly() throws {
        let catalog = try TopicCatalog.bundled.get()
        var signatures = Set<String>()
        var roundsBySignature: [String: [Int]] = [:]
        for round in catalog.allRounds {
            try autoreleasepool {
                // Exercise the production starting image. canonicalCast is a
                // legacy vignette option, not a cast override for layered art.
                let renderer = ImageRenderer(content: StorySceneView(round: round).frame(width: 330).background(TotemTone.paper))
                renderer.scale = 1
                let image = try XCTUnwrap(renderer.uiImage)
                let data = try XCTUnwrap(image.pngData())
                let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                roundsBySignature[hash, default: []].append(round.id)
                XCTAssertTrue(signatures.insert(hash).inserted, "Recipe \(round.id) duplicates an earlier production starting image.")
            }
        }
        let collisions = roundsBySignature.values.filter { $0.count > 1 }.sorted { $0[0] < $1[0] }
        let diagnostic = XCTAttachment(data: try JSONEncoder().encode(collisions), uniformTypeIdentifier: "public.json")
        diagnostic.name = "native-starting-scene-exact-collisions"; diagnostic.lifetime = .keepAlways; add(diagnostic)
        XCTAssertEqual(signatures.count, 1_000)
    }
    func testEveryReferencedSpriteAndBackdropLoadsAndFitsSourceAtlas() throws {
        let catalog = try TopicCatalog.bundled.get()
        XCTAssertEqual(TopicSpriteBounds.props.count, 120)
        XCTAssertEqual(TopicSpriteBounds.backdrops.count, 20)
        for topic in TopicID.allCases {
            for key in topic.definition.props {
                let image = try XCTUnwrap(TopicArt.prop(key, topic: topic), "\(topic.rawValue)/\(key)")
                XCTAssertGreaterThan(image.size.width, 15)
                XCTAssertGreaterThan(image.size.height, 15)
            }
            XCTAssertNotNil(TopicArt.backdrop(topic))
            for round in catalog.rounds(for: topic) {
                XCTAssertNotNil(TopicSpriteBounds.props["\(topic.rawValue)/\(round.scene.primary)"])
                XCTAssertNotNil(TopicSpriteBounds.props["\(topic.rawValue)/\(round.scene.secondary)"])
            }
        }
    }
    func testRenderTwentyRepresentativeNativeCompositionsContactSheet() throws {
        let catalog = try TopicCatalog.bundled.get()
        let rounds = try TopicID.allCases.map { try XCTUnwrap(catalog.rounds(for: $0).first) }
        let view = VStack(spacing: 12) {
            ForEach(0..<5, id: \.self) { row in
                HStack(spacing: 12) {
                    ForEach(0..<4, id: \.self) { col in
                        let round = rounds[row * 4 + col]
                        VStack(alignment: .leading, spacing: 7) {
                            Text(round.topic.definition.title).font(.system(size: 16, weight: .bold, design: .rounded))
                            StorySceneView(round: round).frame(width: 300)
                            Text(round.text).font(.system(size: 13, weight: .medium, design: .rounded)).frame(height: 40, alignment: .top)
                        }.frame(width: 300).padding(12).background(Color.white.opacity(0.6), in: RoundedRectangle(cornerRadius: 20))
                    }
                }
            }
        }.padding(20).foregroundStyle(TotemTone.ink).background(TotemTone.paper)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.uiImage)
        XCTAssertGreaterThan(image.size.width, 1_200)
        let attachment = XCTAttachment(image: image)
        attachment.name = "topics-20-native-scene-contact-sheet"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
#endif
