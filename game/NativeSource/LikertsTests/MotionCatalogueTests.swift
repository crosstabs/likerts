import XCTest
@testable import Likerts

/// Checks shipped descriptors rather than synthetic coverage fixtures.
final class MotionCatalogueTests: XCTestCase {
    func testShippedCatalogueIsCompleteAndUsesTheAuditedRendererForEveryID() throws {
        let catalogue = try MotionProductionLibrary.result.get()
        XCTAssertEqual(catalogue.all.count, 1_000)
        XCTAssertEqual(Set(catalogue.all.map(\.roundID)), Set(1001...2000))
        XCTAssertEqual(catalogue.all.filter { $0.renderer == .nativeStory }.count, 46)
        XCTAssertEqual(catalogue.all.filter { $0.renderer == .layeredGraph }.count, 954)
        for id in 1001...2000 {
            let value = try XCTUnwrap(catalogue.performance(id: id))
            XCTAssertEqual(value.renderer == .nativeStory, MotionNativeAdapterContract.allowedIDs.contains(id))
        }
    }

    func testAllShippedLayeredTracksSampleFinitePathsAndRetainTheirReducedEndpoints() throws {
        let catalogue = try MotionProductionLibrary.result.get()
        for value in catalogue.all where value.renderer == .layeredGraph {
            for cue in [value.ambient, value.choice, value.reveal.action, value.reveal.exact, value.reveal.near, value.reveal.apart].compactMap({ $0 }) {
                for track in cue.tracks {
                    for index in 0...40 {
                        let sampled = try XCTUnwrap(track.sample(at: Double(index) / 40), "Round \(value.roundID), \(track.nodeID)")
                        let t = sampled.transform
                        XCTAssertTrue([t.x, t.y, t.rotation, t.scale, t.opacity].allSatisfy(\.isFinite))
                    }
                }
            }
            for track in value.reveal.action.tracks {
                let reduced = try XCTUnwrap(value.reduced.states.first { $0.nodeID == track.nodeID })
                XCTAssertEqual(track.sample(at: 1)?.transform, reduced.transform, "Round \(value.roundID)")
            }
        }
    }

    func testChoiceFeedbackIsNeutralAndNativeDescriptorsDoNotPretendToDriveCode() throws {
        for value in try MotionProductionLibrary.result.get().all {
            if value.renderer == .nativeStory {
                XCTAssertNotNil(value.nativeBinding)
                XCTAssertTrue(value.variants.isEmpty)
                for cue in [value.ambient, value.choice, value.reveal.action, value.reveal.exact, value.reveal.near, value.reveal.apart].compactMap({ $0 }) {
                    XCTAssertTrue(cue.tracks.isEmpty, "Native adapter \(value.roundID) must not certify unused JSON paths")
                }
            } else {
                if value.review.coverage == .authoredTableau,
                   value.graph.nodes.allSatisfy({ $0.asset.rawValue.hasPrefix("scene/") }) {
                    // Native answer controls provide the acknowledgement. A
                    // complete still must not bob or pose as an articulated actor.
                    XCTAssertNil(value.choice)
                    XCTAssertNil(value.ambient)
                    XCTAssertTrue(value.reveal.action.tracks.isEmpty)
                } else {
                    let choice = try XCTUnwrap(value.choice, "Round \(value.roundID) needs neutral feedback")
                    XCTAssertEqual(choice.condition, .always)
                    XCTAssertEqual(choice.phase, .choice)
                    XCTAssertTrue([MotionRecipe.acknowledge, .consider, .settle].contains(choice.recipe))
                }
                XCTAssertEqual(value.reduced.states.count, value.graph.nodes.count)
            }
        }
    }

    func testSpokenSceneDescriptionsArePlayerFacing() throws {
        let implementationTerms = ["descriptor", "whole-sprite", "rigging", "art gap", "no claim", "metadata", "atlas", "anchor"]
        for value in try MotionProductionLibrary.result.get().all {
            let caption = value.semanticJustification.lowercased()
            XCTAssertFalse(caption.isEmpty, "Round \(value.roundID) needs an image description")
            for term in implementationTerms {
                XCTAssertFalse(caption.contains(term), "Round \(value.roundID) speaks a production note: \(term)")
            }
        }
    }
}
