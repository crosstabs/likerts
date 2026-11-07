#if canImport(UIKit) && DEBUG
import XCTest
import SwiftUI
@testable import Likerts

/// Uses the production 144-point compact illustration viewport. The rendered
/// attachments support human crop review; this does not certify animation.
@MainActor final class WorldCompactSceneReviewTests: XCTestCase {
    func testRenderAllWorldCompactEndpoints() throws {
        let topics: Set<TopicID> = [.pets, .outdoors, .travel, .weather, .tinyadventures, .fantasy, .future]
        let catalog = try TopicCatalog.bundled.get()
        var captured = Set<Int>()
        var descriptors: [ScenePerformance] = []
        for topic in TopicID.allCases where topics.contains(topic) {
            let rounds = catalog.rounds(for: topic).filter { SceneReviewBaseline.ids.contains($0.id) }.sorted { $0.id < $1.id }
            for index in stride(from: 0, to: rounds.count, by: 4) {
                let batch = Array(rounds.dropFirst(index).prefix(4))
                for reveal in [false, true] {
                    let name = "world-compact-\(topic.rawValue)-\(reveal ? "reveal" : "question")-" + batch.map { String($0.id) }.joined(separator: "-")
                    let renderer = ImageRenderer(content: WorldCompactSheet(rounds: batch, reveal: reveal, title: name)
                        .frame(width: 780, height: 700).environment(\.colorScheme, .light)
                        .environment(\.dynamicTypeSize, .medium).environment(\.likertsReducedEffectsTest, true))
                    renderer.scale = 2
                    let attachment = XCTAttachment(image: try XCTUnwrap(renderer.uiImage, name))
                    attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
                }
                captured.formUnion(batch.map(\.id))
                descriptors += batch.compactMap { MotionProductionLibrary.performance(id: $0.id) }
            }
        }
        XCTAssertEqual(captured.count, 53)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let input = XCTAttachment(data: try encoder.encode(descriptors.sorted { $0.roundID < $1.roundID }), uniformTypeIdentifier: "public.json")
        input.name = "world-compact-captured-descriptors"; input.lifetime = .keepAlways; add(input)
    }
}

private struct WorldCompactSheet: View {
    let rounds: [TopicRound]
    let reveal: Bool
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 14, weight: .bold)).padding(.horizontal, 10)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(rounds, id: \.id) { round in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("#\(round.id)").font(.system(size: 16, weight: .bold))
                        StorySceneView(round: round, resolution: reveal ? .init(guess: 4, answer: 4) : nil, compact: true)
                        Text(round.text).font(.system(size: 16, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }.padding(8).frame(height: 315).background(.white, in: RoundedRectangle(cornerRadius: 12))
                }
            }.padding(.horizontal, 8)
            Spacer(minLength: 0)
        }.padding(.top, 10).background(Color(red: 0.96, green: 0.95, blue: 0.92)).foregroundStyle(.black)
    }
}
#endif
