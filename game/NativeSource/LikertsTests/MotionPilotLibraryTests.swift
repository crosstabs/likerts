import XCTest
@testable import Likerts

final class MotionPilotLibraryTests: XCTestCase {
    func testEightExplicitPilotDescriptorsValidateAndKeepReviewUnapproved() throws {
        try MotionPilotLibrary.validatePilots()
        XCTAssertEqual(MotionPilotLibrary.all.count, 8)
        XCTAssertEqual(Set(MotionPilotLibrary.all.map(\.roundID)), MotionPilotLibrary.ids)
        let registry = try MotionPilotLibrary.registryResult.get()
        XCTAssertGreaterThanOrEqual(registry.assets.count, 199)
        for name in ["emptybento", "bentorim", "pancakesingle", "plateplain", "postcardback", "warmglow", "openbook", "loosepage", "redpuzzlepiece", "bluepuzzlepiece", "curtainedwindow", "singlecurtain"] {
            XCTAssertNotNil(registry.assets[.init("story/\(name)")])
        }
        for name in ["dogattentive", "dogresting", "catattentive", "catresting", "rabbitattentive", "rabbitresting"] {
            XCTAssertTrue(try XCTUnwrap(registry.assets[.init("story/\(name)")]).capabilities.contains(.poseSet))
        }
        for value in MotionPilotLibrary.all {
            XCTAssertEqual(value.review.semantic, .mapped)
            XCTAssertEqual(value.review.playback, .notReviewed)
            XCTAssertEqual(value.review.coverage, .actionMotion)
        }
        XCTAssertNil(MotionPilotLibrary.performance(id: 1002))
    }
    func testExistingCatAndWindowOverridesRetainRealSourceLayersAndMasks() throws {
        let cat = try XCTUnwrap(MotionPilotLibrary.performance(id: 1108))
        XCTAssertEqual(cat.graph.id, "story.catBox")
        XCTAssertTrue(cat.graph.nodes.contains { $0.asset.rawValue == "pets/cat" })
        XCTAssertFalse(cat.graph.nodes.contains { $0.asset.rawValue == "pets/rabbit" })
        XCTAssertEqual(cat.graph.masks.first?.region, .init(x: 0.5, y: 0.825, width: 1, height: 0.35))
        let train = try XCTUnwrap(MotionPilotLibrary.performance(id: 1208))
        XCTAssertEqual(train.graph.id, "story.trainWindow")
        XCTAssertTrue(train.graph.nodes.contains { $0.asset.rawValue == "story/trainseat" })
        XCTAssertTrue(train.graph.nodes.contains { $0.asset.rawValue == "set/window" })
        XCTAssertEqual(train.ambient?.recipe, .windowDrift)
    }
    func testMeasuredCastContactMetadataIsAvailableAcrossAllFifteenPoses() throws {
        let registry = try MotionPilotLibrary.registryResult.get()
        for pose in ["hold", "peek", "celebrate"] {
            for value in 1...5 {
                let data = try XCTUnwrap(registry.assets[.init("cast/\(pose)/\(value)")])
                XCTAssertNotNil(data.anchors["leftHand"])
                XCTAssertNotNil(data.anchors["rightHand"])
                XCTAssertNotNil(data.anchors["mouthCenter"])
                XCTAssertNotNil(data.faceExclusion)
                XCTAssertFalse(data.capabilities.contains(.spin))
            }
        }
        XCTAssertFalse(try XCTUnwrap(registry.assets[.init("pets/cat")]).capabilities.contains(.spin))
    }
}
