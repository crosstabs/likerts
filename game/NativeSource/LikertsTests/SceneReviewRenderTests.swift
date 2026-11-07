#if canImport(UIKit) && DEBUG
import XCTest
import SwiftUI
import CryptoKit
@testable import Likerts

@MainActor final class SceneReviewRenderTests: XCTestCase {
    func testRenderAllBaselineReviewSheets() throws { try capture(originals: [:], prefix: "native-review") }
    func testRenderCompactBaselineReviewSheets() throws { try capture(originals: [:], prefix: "compact-review", compact: true) }
    func testRenderFinalPaintbrushRepairSheets() throws {
        let ids: Set<Int> = [1313, 1333]
        try capture(originals: [:], prefix: "native-review", ids: ids)
        try capture(originals: [:], prefix: "compact-review", compact: true, ids: ids)
    }
    func testRenderNativeCollisionRepairSheets() throws {
        let ids: Set<Int> = [1088, 1096, 1118, 1148, 1382, 1441, 1549, 1538, 1539,
            1694, 1680, 1695, 1723, 1781, 1782, 1791, 1773, 1800, 1788, 1833,
            1821, 1843, 1848, 1871, 1887, 1892, 1879, 1899, 1931, 1934, 1941,
            1944, 1948, 1929, 1985, 1998, 1978, 1990, 1997]
        try capture(originals: [:], prefix: "native-review", ids: ids)
        try capture(originals: [:], prefix: "compact-review", compact: true, ids: ids)
    }
    func testRenderFinalCollisionPolishSheets() throws {
        let ids: Set<Int> = [1096, 1148, 1549, 1680, 1782, 1990]
        try capture(originals: [:], prefix: "native-review", ids: ids)
        try capture(originals: [:], prefix: "compact-review", compact: true, ids: ids)
    }
    func testRenderOriginalBaselineSheets() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "SceneReviewOriginal218", withExtension: "json"))
        let values = try JSONDecoder().decode([ScenePerformance].self, from: Data(contentsOf: url))
        XCTAssertEqual(Set(values.map(\.roundID)), SceneReviewBaseline.ids)
        try capture(originals: Dictionary(uniqueKeysWithValues: values.map { ($0.roundID, $0) }), prefix: "original-review")
    }
    private func capture(originals: [Int: ScenePerformance], prefix: String, compact: Bool = false,
                         ids: Set<Int> = SceneReviewBaseline.ids) throws {
        let catalog = try TopicCatalog.bundled.get()
        XCTAssertEqual(SceneReviewBaseline.ids.count, 218)
        var captured = Set<Int>()
        var manifest: [String] = []
        var descriptors: [ScenePerformance] = []
        for topic in TopicID.allCases {
            let rounds = catalog.rounds(for: topic).filter { ids.contains($0.id) }.sorted { $0.id < $1.id }
            for start in stride(from: 0, to: rounds.count, by: 4) {
                let batch = Array(rounds.dropFirst(start).prefix(4))
                for revealed in [false, true] {
                    let phase = revealed ? "reveal" : "question"
                    let ids = batch.map { String($0.id) }.joined(separator: "-")
                    let name = "\(prefix)-\(topic.rawValue)-\(phase)-\(ids)"
                    let renderer = ImageRenderer(content: ReviewSheet(rounds: batch, revealed: revealed, title: name, originals: originals, compact: compact)
                        .frame(width: 780, height: 780).environment(\.colorScheme, .light)
                        .environment(\.dynamicTypeSize, .medium).environment(\.likertsReducedEffectsTest, true))
                    renderer.scale = 2
                    let image = try XCTUnwrap(renderer.uiImage, name)
                    XCTAssertEqual(image.size.width, 780)
                    let attachment = XCTAttachment(image: image)
                    attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
                    manifest.append(name)
                }
                captured.formUnion(batch.map(\.id))
                descriptors += batch.compactMap { originals[$0.id] ?? MotionProductionLibrary.performance(id: $0.id) }
            }
        }
        XCTAssertEqual(captured, ids)
        let evidence = XCTAttachment(string: "Actual production StorySceneView renders. Capture is not visual acceptance.\n" + manifest.joined(separator: "\n"))
        evidence.name = "native-review-manifest"; evidence.lifetime = .keepAlways; add(evidence)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(descriptors.sorted { $0.roundID < $1.roundID })
        let inputs = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        inputs.name = prefix + "-captured-descriptors"; inputs.lifetime = .keepAlways; add(inputs)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let hash = XCTAttachment(string: digest)
        hash.name = prefix + "-descriptor-sha256"; hash.lifetime = .keepAlways; add(hash)
    }
}

private struct ReviewSheet: View {
    let rounds: [TopicRound]
    let revealed: Bool
    let title: String
    let originals: [Int: ScenePerformance]
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 15, weight: .bold)).padding(.horizontal, 10)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(rounds, id: \.id) { round in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("#\(round.id)").font(.system(size: 16, weight: .bold))
                        if let original = originals[round.id], let registry = MotionProductionLibrary.registry {
                            MotionPerformanceSceneView(performance: original, registry: registry, resolution: revealed ? .init(guess: 4, answer: 4) : nil, choice: revealed ? 4 : nil, compact: compact)
                        } else {
                            StorySceneView(round: round, resolution: revealed ? .init(guess: 4, answer: 4) : nil, choice: revealed ? 4 : nil, compact: compact)
                        }
                        Text(round.text).font(.system(size: 16, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }.padding(8).frame(height: 355).background(.white, in: RoundedRectangle(cornerRadius: 12))
                }
            }.padding(.horizontal, 8)
            Spacer(minLength: 0)
        }.padding(.top, 10).background(Color(red: 0.96, green: 0.95, blue: 0.92)).foregroundStyle(.black)
    }
}
#endif
