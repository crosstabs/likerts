#if canImport(UIKit) && !SWIFT_PACKAGE
import XCTest
import SwiftUI
import UIKit
import CryptoKit
@testable import Likerts

@MainActor
final class StoryRenderingTests: XCTestCase {
    private let representativeIDs = [1005, 1018, 1108, 1019, 1208, 1009]
    func testPilotQuestionAndRevealContactSheets() throws {
        let catalog = try TopicCatalog.bundled.get()
        for topic in VignetteBank.pilotTopics {
            let rounds = try VignetteBank.all.filter { catalog.round(id: $0.id)?.topic == topic }.map { try XCTUnwrap(catalog.round(id: $0.id)) }
            for resolved in [false, true] {
                let content = VStack(spacing: 12) {
                    ForEach(0..<4, id: \.self) { row in
                        HStack(spacing: 12) {
                            ForEach(0..<3, id: \.self) { col in
                                let round = rounds[row * 3 + col]
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("\(round.id) · \(VignetteBank.spec(id: round.id)!.action.rawValue)").font(.system(size: 14, weight: .bold))
                                    StorySceneView(round: round, resolution: resolved ? StoryResolution(guess: 4, answer: 4) : nil).frame(width: 300).environment(\.likertsReducedEffectsTest, true)
                                    Text(round.text).font(.system(size: 12, weight: .medium)).frame(height: 46, alignment: .top)
                                }.frame(width: 300).padding(12).background(.white.opacity(0.65), in: RoundedRectangle(cornerRadius: 22))
                            }
                        }
                    }
                }.padding(20).foregroundStyle(TotemTone.ink).background(TotemTone.paper)
                let renderer = ImageRenderer(content: content); renderer.scale = 1
                let attachment = XCTAttachment(image: try XCTUnwrap(renderer.uiImage))
                attachment.name = "story-\(topic.rawValue)-\(resolved ? "exact" : "questions")-twelve"
                attachment.lifetime = .keepAlways; add(attachment)
            }
        }
    }
    func testFifteenIsolatedCharacterPosesContactSheet() throws {
        let content = VStack(spacing: 16) {
            ForEach(["hold", "peek", "celebrate"], id: \.self) { pose in
                HStack(alignment: .bottom, spacing: 16) {
                    ForEach(1...5, id: \.self) { value in
                        VStack {
                            StoryRaster(ref: "cast/\(pose)/\(value)").frame(width: 140, height: 180)
                            Text("\(pose) \(value)").font(.system(size: 13, weight: .semibold))
                        }
                    }
                }
            }
        }.padding(20).background(TotemTone.paper)
        let renderer = ImageRenderer(content: content); renderer.scale = 1
        let attachment = XCTAttachment(image: try XCTUnwrap(renderer.uiImage))
        attachment.name = "story-fifteen-isolated-character-poses"; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testAllAssetsReferencedByFortyEightStoriesResolve() throws {
        let catalog = try TopicCatalog.bundled.get()
        XCTAssertEqual(VignetteBank.all.count, 48)
        for spec in VignetteBank.all {
            XCTAssertNotNil(catalog.round(id: spec.id))
            for reference in [spec.primaryAsset, spec.secondaryAsset] + spec.detailAssets + ["set/\(spec.setPiece)"] {
                let image = try XCTUnwrap(StoryArt.image(ref: reference), "Story \(spec.id) cannot load \(reference)")
                XCTAssertGreaterThan(image.size.width, 15, reference)
                XCTAssertGreaterThan(image.size.height, 15, reference)
                XCTAssertNotNil(image.cgImage, reference)
            }
        }
        for pose in ["hold", "peek", "celebrate"] {
            for character in 1...5 {
                let reference = "cast/\(pose)/\(character)"
                let image = try XCTUnwrap(StoryArt.image(ref: reference), reference)
                XCTAssertGreaterThan(image.size.width, 15, reference)
                XCTAssertGreaterThan(image.size.height, 15, reference)
            }
        }
    }

    /// Runs after the six representative families receive visual approval.
    /// Hashes detect rendering collisions; they do not establish that a scene's
    /// joke, facial expression or object contact is convincing.
    func testFortyEightStoriesRenderDistinctQuestionExactAndMismatchStates() throws {
        let catalog = try TopicCatalog.bundled.get()
        var questionHashes = Set<String>()
        var exactHashes = Set<String>()
        var mismatchHashes = Set<String>()
        XCTAssertEqual(VignetteBank.all.count, 48)
        for spec in VignetteBank.all {
            try autoreleasepool {
                let round = try XCTUnwrap(catalog.round(id: spec.id))
                let question = try signature(round: round, resolution: nil)
                let exact = try signature(round: round, resolution: StoryResolution(guess: 4, answer: 4))
                let mismatch = try signature(round: round, resolution: StoryResolution(guess: 1, answer: 4))
                XCTAssertTrue(questionHashes.insert(question).inserted, "Duplicate question composition at \(spec.id)")
                XCTAssertTrue(exactHashes.insert(exact).inserted, "Duplicate exact-reveal composition at \(spec.id)")
                XCTAssertTrue(mismatchHashes.insert(mismatch).inserted, "Duplicate mismatch-reveal composition at \(spec.id)")
                XCTAssertNotEqual(question, exact, "Story \(spec.id) must visibly resolve after an exact guess.")
                XCTAssertNotEqual(exact, mismatch, "Story \(spec.id) must distinguish exact and mismatch resolution.")
            }
        }
        XCTAssertEqual(questionHashes.count, 48)
        XCTAssertEqual(exactHashes.count, 48)
        XCTAssertEqual(mismatchHashes.count, 48)
    }

    /// This is the first visual gate. Root should inspect both attachments
    /// before using the all48 render check as expansion evidence.
    func testSixRepresentativeFamiliesQuestionAndExactRevealContactSheets() throws {
        let catalog = try TopicCatalog.bundled.get()
        let rounds = try representativeIDs.map { try XCTUnwrap(catalog.round(id: $0)) }
        for resolution in [nil, StoryResolution(guess: 4, answer: 4)] as [StoryResolution?] {
            let content = StoryContactSheet(rounds: rounds, resolution: resolution)
            let renderer = ImageRenderer(content: content)
            renderer.scale = 1
            let image = try XCTUnwrap(renderer.uiImage)
            XCTAssertGreaterThan(image.size.width, 900)
            let attachment = XCTAttachment(image: image)
            attachment.name = resolution == nil ? "story-six-families-questions" : "story-six-families-exact-reveals"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    private func signature(round: TopicRound, resolution: StoryResolution?) throws -> String {
        let renderer = ImageRenderer(content:
            StorySceneView(round: round, resolution: resolution, canonicalCast: true)
                .frame(width: 330).background(TotemTone.paper)
                .environment(\.likertsReducedEffectsTest, true)
        )
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.uiImage)
        let bytes = try XCTUnwrap(image.pngData())
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}

private struct StoryContactSheet: View {
    let rounds: [TopicRound]
    let resolution: StoryResolution?
    var body: some View {
        VStack(spacing: 12) {
            ForEach(0..<2, id: \.self) { row in
                HStack(spacing: 12) {
                    ForEach(0..<3, id: \.self) { column in
                        let round = rounds[row * 3 + column]
                        VStack(alignment: .leading, spacing: 8) {
                            Text("\(round.id) · \(VignetteBank.spec(id: round.id)?.family.rawValue ?? "missing")")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            StorySceneView(round: round, resolution: resolution, canonicalCast: true)
                                .frame(width: 300).environment(\.likertsReducedEffectsTest, true)
                            Text(round.text).font(.system(size: 12, weight: .medium, design: .rounded))
                                .frame(height: 44, alignment: .top)
                        }.frame(width: 300).padding(12)
                            .background(.white.opacity(0.65), in: RoundedRectangle(cornerRadius: 22))
                    }
                }
            }
        }.padding(20).foregroundStyle(TotemTone.ink).background(TotemTone.paper)
    }
}
#endif
