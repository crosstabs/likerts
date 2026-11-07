import XCTest
@testable import Likerts

final class MotionPerformanceTests: XCTestCase {
    func testPropLabelsStayBoundedOnMeasuredProps() throws {
        let original = nodes()
        func labelled(_ source: MotionNode, text: String, scale: Double = 0.15) -> MotionNode {
            .init(id: source.id, asset: source.asset, role: source.role, layer: source.layer, frame: source.frame,
                  initial: source.initial, attachment: source.attachment, allowedStates: source.allowedStates,
                  labels: [.init(text: text, frame: .init(x: 0.5, y: 0.5, width: 0.8, height: 0.3), fontScale: scale)])
        }
        var valid = original; valid[2] = labelled(original[2], text: "START 3:00")
        try MotionPerformanceValidator.validate(fixture(nodes: valid), registry: registry())
        for text in [String(repeating: "x", count: 33), "line\nbreak"] {
            var invalid = original; invalid[2] = labelled(original[2], text: text)
            XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(nodes: invalid), registry: registry()))
        }
        valid[0] = labelled(original[0], text: "3:00")
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(nodes: valid), registry: registry()), "Labels belong on authored props, not actor faces.")
    }
    func testAuthoredTableauRequiresAStillActionWithoutClaimingPlaybackApproval() throws {
        let review = MotionReview(semantic: .mapped, coverage: .authoredTableau)
        let still = MotionCue(phase: .reveal, recipe: .staticTableau, subjects: ["cookie"], timing: .init(action: 0))
        let value = fixture(action: still, review: review)
        try MotionPerformanceValidator.validate(value, registry: registry())
        XCTAssertEqual(value.review.playback, .notReviewed)
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(review: review), registry: registry()),
                             "Moving actions cannot be called still tableaux.")
    }
    func testPetPoseIdentityRejectsCrossSpeciesAndUnrelatedSprites() throws {
        let baseCaps = capabilities()
        let petCaps: [MotionAssetCapabilities] = [
            .init(asset: .init("story/dogattentive"), capabilities: [.rigid, .poseSet], poseFamily: "pet-dog"),
            .init(asset: .init("story/dogresting"), capabilities: [.rigid, .poseSet], poseFamily: "pet-dog"),
            .init(asset: .init("story/catresting"), capabilities: [.rigid, .poseSet], poseFamily: "pet-cat")
        ]
        let registry = try MotionAssetRegistry(baseCaps + petCaps)
        func scene(_ state: String) -> ScenePerformance {
            let pet = MotionNode(id: "pet", asset: .init("story/dogattentive"), role: .detail, layer: .prop,
                                 frame: .init(x: 0.5, y: 0.7, width: 0.2, height: 0.2), allowedStates: [.init(state)])
            return fixture(nodes: nodes() + [pet])
        }
        try MotionPerformanceValidator.validate(scene("story/dogresting"), registry: registry)
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(scene("story/catresting"), registry: registry))
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(scene("snacks/cookie"), registry: registry))
    }
    func testValidExchangeSchemaRoundTripsWithoutReviewInflation() throws {
        let value = fixture()
        try MotionPerformanceValidator.validate(value, registry: registry())
        let decoded = try JSONDecoder().decode(ScenePerformance.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(decoded, value)
        XCTAssertEqual(decoded.review.semantic, .mapped)
        XCTAssertEqual(decoded.review.playback, .notReviewed)
        XCTAssertEqual(decoded.review.coverage, .actionMotion)
        XCTAssertNil(decoded.ambient, "No idle cue is a valid intentional choice.")
    }

    func testCatalogueRequiresExactlyOneOfEachStableIDAndSupportedVersion() throws {
        let values = (1001...2000).map { fixture(roundID: $0) }
        try MotionPerformanceCatalogue(performances: values).validate(registry: registry())
        XCTAssertThrowsError(try MotionPerformanceCatalogue(performances: Array(values.dropLast())).validate(registry: registry()))
        XCTAssertThrowsError(try MotionPerformanceCatalogue(performances: Array(values.dropLast()) + [values[0]]).validate(registry: registry()))
        XCTAssertThrowsError(try MotionPerformanceCatalogue(schemaVersion: 2, performances: values).validate(registry: registry()))
        try MotionPerformanceCatalogue(performances: [values[0]]).validate(registry: registry(), expectedRoundIDs: [1001])
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(roundID: 201), registry: registry()))
    }

    func testPortableInterpolationClampsSamplesAndKeepsDiscreteSpriteStatesDiscrete() throws {
        let state = MotionAssetID("cast/celebrate/1")
        let track = MotionTrack(nodeID: "giver", frames: [
            .init(progress: 0, transform: .init(x: 0, y: 0, rotation: 0, scale: 1, opacity: 1)),
            .init(progress: 0.5, transform: .init(x: 0.5, y: 0.4, rotation: 10, scale: 1.1, opacity: 0.5), assetState: state),
            .init(progress: 1, transform: .init(x: 1, y: 0.8, rotation: 20, scale: 1.2, opacity: 0), assetState: state)
        ], interpolation: .linear)
        XCTAssertEqual(track.sample(at: -2)?.transform.x, 0)
        XCTAssertEqual(track.sample(at: 2)?.transform.x, 1)
        XCTAssertEqual(try XCTUnwrap(track.sample(at: 0.25)).transform,
                       .init(x: 0.25, y: 0.2, rotation: 5, scale: 1.05, opacity: 0.75))
        XCTAssertNil(track.sample(at: 0.499)?.assetState)
        XCTAssertEqual(track.sample(at: 0.5)?.assetState, state)
        XCTAssertEqual(track.sample(at: .nan)?.transform.x, 0)
    }

    func testChoiceAndQuestionCannotDependOnOutcomeOrRepeatChoiceFeedback() throws {
        for phase in [ScenePhase.question, .choice] {
            let cue = MotionCue(phase: phase, recipe: .acknowledge, subjects: ["giver"], timing: .init(action: 0.18), condition: .exact)
            let value = fixture(ambient: phase == .question ? cue : nil, choice: phase == .choice ? cue : nil)
            XCTAssertThrowsError(try MotionPerformanceValidator.validate(value, registry: registry()))
        }
        let revealInChoice = MotionCue(phase: .choice, recipe: .exchange, subjects: ["cookie"], timing: .init(action: 0.18))
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(choice: revealInChoice), registry: registry()))
        let repeating = MotionCue(phase: .choice, recipe: .acknowledge, subjects: ["giver"], timing: .init(action: 0.18), repeats: true)
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(choice: repeating), registry: registry()))
        let wrongReaction = MotionCue(phase: .reveal, recipe: .reactionOnly, subjects: ["giver"], timing: .init(action: 0.2), condition: .apart)
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(exact: wrongReaction), registry: registry()))
    }

    func testCapabilityAndMeasuredContactRequirementsPreventBlindRecipeAssignment() throws {
        let spin = MotionCue(phase: .reveal, recipe: .spin, subjects: ["cookie"], timing: .init(action: 0.5), tracks: [movingTrack()])
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: spin), registry: registry()))
        let orbit = MotionCue(phase: .reveal, recipe: .orbit, subjects: ["cookie"], timing: .init(action: 0.5), tracks: [movingTrack()])
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: orbit), registry: registry()))
        let floating = MotionCue(phase: .reveal, recipe: .exchange, subjects: ["cookie"], timing: .init(action: 0.5), tracks: [movingTrack()])
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: floating), registry: registry()))
        let revealThroughSolid = MotionCue(phase: .reveal, recipe: .peek, subjects: ["cookie"], timing: .init(action: 0.5), tracks: [movingTrack()])
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: revealThroughSolid), registry: registry()))
    }

    func testMalformedKeyframesGeometryAndDurationsReject() throws {
        let badPaths: [[MotionKeyframe]] = [
            [.init(progress: 0, transform: .init(x: 0.3, y: 0.6))],
            [.init(progress: 0.2, transform: .init(x: 0.3, y: 0.6)), .init(progress: 1, transform: .init(x: 0.7, y: 0.6))],
            [.init(progress: 0, transform: .init(x: 0.3, y: 0.6)), .init(progress: 0, transform: .init(x: 0.7, y: 0.6)), .init(progress: 1, transform: .init(x: 0.7, y: 0.6))],
            [.init(progress: 0, transform: .init(x: .nan, y: 0.6)), .init(progress: 1, transform: .init(x: 0.7, y: 0.6))],
            [.init(progress: 0, transform: .init(x: 0.3, y: 0.6)), .init(progress: 1, transform: .init(x: 10, y: 0.6))]
        ]
        for frames in badPaths {
            let cue = MotionCue(phase: .reveal, recipe: .present, subjects: ["cookie"], timing: .init(action: 0.5), tracks: [.init(nodeID: "cookie", frames: frames)])
            XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: cue), registry: registry()))
        }
        for timing in [MotionTiming(action: -1), .init(action: .infinity), .init(anticipation: 1, action: 1, recovery: 1)] {
            let cue = MotionCue(phase: .reveal, recipe: .present, subjects: ["cookie"], timing: timing, tracks: [movingTrack()])
            XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: cue), registry: registry()))
        }
    }

    func testUnknownAssetsNodesAndUnsafePathsCannotReachNativeLoader() throws {
        let valid = nodes()
        for key in ["../cookie", "snacks/../cookie", "/private/cookie", "https://image", "snacks/unknown"] {
            let changed = MotionNode(id: "cookie", asset: .init(key), role: .primaryProp, layer: .prop, frame: valid[2].frame)
            XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(nodes: [valid[0], valid[1], changed, valid[3]]), registry: registry()))
        }
        let unknown = MotionCue(phase: .reveal, recipe: .present, subjects: ["missing"], timing: .init(action: 0.2))
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: unknown), registry: registry()))
        XCTAssertThrowsError(try MotionAssetRegistry([capabilities()[0], capabilities()[0]]))
    }

    func testAttachmentCyclesAndMissingAnchorReject() throws {
        let original = nodes()
        func attached(_ source: MotionNode, to parent: String, anchor: String = "grip") -> MotionNode {
            .init(id: source.id, asset: source.asset, role: source.role, layer: source.layer, frame: source.frame,
                  attachment: .init(parent: .init(nodeID: parent, anchor: anchor), childAnchor: "grip"))
        }
        var cycle = original
        cycle[2] = attached(original[2], to: "popcorn"); cycle[3] = attached(original[3], to: "cookie")
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(nodes: cycle), registry: registry()))
        var missing = original; missing[2] = attached(original[2], to: "giver", anchor: "imaginaryHand")
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(nodes: missing), registry: registry()))
        var valid = original; valid[2] = attached(original[2], to: "giver", anchor: "rightHand")
        let parentTrack = MotionTrack(nodeID: "giver", frames: [
            .init(progress: 0, transform: .init(x: 0.2, y: 0.5)),
            .init(progress: 1, transform: .init(x: 0.4, y: 0.5))])
        let parentAction = MotionCue(phase: .reveal, recipe: .travel, subjects: ["giver"], timing: .init(action: 0.5), tracks: [parentTrack])
        try MotionPerformanceValidator.validate(fixture(nodes: valid, action: parentAction), registry: registry())
        var caps = capabilities()
        caps[1] = .init(asset: .init("cast/celebrate/1"), capabilities: [.rigid, .translate])
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(nodes: valid, action: parentAction), registry: .init(caps)),
                             "Changing pose must not silently remove a measured contact anchor.")
    }

    func testAttachedChildCannotDeclareIgnoredXYMovementButCanTilt() throws {
        var graph = nodes()
        let cookie = graph[2]
        graph[2] = .init(id: cookie.id, asset: cookie.asset, role: cookie.role, layer: cookie.layer, frame: cookie.frame,
                         attachment: .init(parent: .init(nodeID: "giver", anchor: "rightHand"), childAnchor: "grip"))
        func action(_ final: MotionTransform) -> MotionCue {
            .init(phase: .reveal, recipe: .present, subjects: ["cookie"], timing: .init(action: 0.5), tracks: [
                .init(nodeID: "cookie", frames: [.init(progress: 0, transform: cookie.initial), .init(progress: 1, transform: final)])])
        }
        for invalid in [MotionTransform(x: 0.4, y: 0.6), .init(x: 0.31, y: 0.7)] {
            XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(nodes: graph, action: action(invalid)), registry: registry())) {
                XCTAssertEqual($0 as? MotionValidationError, .invalidPath("cookie"))
            }
        }
        let tilt = MotionTransform(x: 0.31, y: 0.6, rotation: 10)
        try MotionPerformanceValidator.validate(fixture(nodes: graph, action: action(tilt)), registry: registry())
    }

    func testReducedTableauAndReviewStatusesCannotBeInflated() throws {
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(reduced: .init(states: [])), registry: registry()))
        let unreviewed = MotionReview(semantic: .mapped, playback: .normalReviewed, coverage: .actionMotion)
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(review: unreviewed), registry: registry()))
        let honest = MotionReview(semantic: .reviewed, playback: .bothReviewed, coverage: .actionMotion)
        try MotionPerformanceValidator.validate(fixture(review: honest), registry: registry())
        let generic = MotionCue(phase: .reveal, recipe: .reactionOnly, subjects: ["giver"], timing: .init(action: 0.2))
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: generic), registry: registry()))
    }

    func testMotionCoverageRequiresRealNumericChangeAndReducedMatchesFinalAction() throws {
        let empty = MotionCue(phase: .reveal, recipe: .present, subjects: ["cookie"], timing: .init(action: 0.5))
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: empty), registry: registry()))
        let flat = MotionTrack(nodeID: "cookie", frames: [
            .init(progress: 0, transform: .init(x: 0.31, y: 0.6)),
            .init(progress: 1, transform: .init(x: 0.31, y: 0.6))])
        let still = MotionCue(phase: .reveal, recipe: .present, subjects: ["cookie"], timing: .init(action: 0.5), tracks: [flat])
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(action: still), registry: registry()))
        let wrong = MotionTableau(states: nodes().map { .init(nodeID: $0.id, transform: $0.initial) })
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(fixture(reduced: wrong), registry: registry())) {
            XCTAssertEqual($0 as? MotionValidationError, .reducedMismatch("cookie"))
        }
    }

    private func capabilities() -> [MotionAssetCapabilities] {
        let rigid: Set<MotionCapability> = [.rigid, .translate, .tilt, .scale, .opacity, .grippable]
        return [
            .init(asset: .init("cast/hold/1"), capabilities: rigid.union([.poseSet]), anchors: ["rightHand": .init(x: 0.8, y: 0.65), "leftHand": .init(x: 0.2, y: 0.65)]),
            .init(asset: .init("cast/celebrate/1"), capabilities: rigid, anchors: ["rightHand": .init(x: 0.8, y: 0.65), "leftHand": .init(x: 0.2, y: 0.65)]),
            .init(asset: .init("snacks/cookie"), capabilities: rigid, anchors: ["grip": .init(x: 0.5, y: 0.75)]),
            .init(asset: .init("snacks/popcorn"), capabilities: rigid, anchors: ["grip": .init(x: 0.5, y: 0.75)])
        ]
    }
    private func registry() throws -> MotionAssetRegistry { try .init(capabilities()) }
    private func nodes() -> [MotionNode] {
        [
            .init(id: "giver", asset: .init("cast/hold/1"), role: .primaryActor, layer: .actor,
                  frame: .init(x: 0.2, y: 0.5, width: 0.25, height: 0.5), allowedStates: [.init("cast/celebrate/1")]),
            .init(id: "receiver", asset: .init("cast/hold/1"), role: .secondaryActor, layer: .actor,
                  frame: .init(x: 0.8, y: 0.5, width: 0.25, height: 0.5), allowedStates: [.init("cast/celebrate/1")]),
            .init(id: "cookie", asset: .init("snacks/cookie"), role: .primaryProp, layer: .prop,
                  frame: .init(x: 0.31, y: 0.6, width: 0.16, height: 0.2)),
            .init(id: "popcorn", asset: .init("snacks/popcorn"), role: .secondaryProp, layer: .prop,
                  frame: .init(x: 0.69, y: 0.6, width: 0.2, height: 0.3))
        ]
    }
    private func movingTrack() -> MotionTrack {
        .init(nodeID: "cookie", frames: [
            .init(progress: 0, transform: .init(x: 0.31, y: 0.6)),
            .init(progress: 0.5, transform: .init(x: 0.5, y: 0.4)),
            .init(progress: 1, transform: .init(x: 0.69, y: 0.6))])
    }
    private func fixture(roundID: Int = 1001, nodes override: [MotionNode]? = nil,
                         ambient: MotionCue? = nil, choice: MotionCue? = nil, action: MotionCue? = nil,
                         exact: MotionCue? = nil, reduced: MotionTableau? = nil,
                         review: MotionReview = .init(semantic: .mapped, coverage: .actionMotion)) -> ScenePerformance {
        let graphNodes = override ?? nodes()
        let exchange = MotionCue(phase: .reveal, recipe: .exchange, subjects: ["cookie", "popcorn"],
                                 timing: .init(anticipation: 0.1, action: 0.5, recovery: 0.15), tracks: [movingTrack()],
                                 contacts: [.init(subject: .init(nodeID: "cookie", anchor: "grip"), target: .init(nodeID: "giver", anchor: "rightHand"))])
        let finalAction = action ?? exchange
        return .init(roundID: roundID, graph: .init(id: "story.tradeSnack", nodes: graphNodes), ambient: ambient, choice: choice,
                     reveal: .init(action: finalAction, exact: exact),
                     reduced: reduced ?? .init(states: graphNodes.map { node in
                         let end = finalAction.tracks.first(where: { $0.nodeID == node.id })?.frames.last
                         return .init(nodeID: node.id, transform: end?.transform ?? node.initial, assetState: end?.assetState)
                     }),
                     review: review, semanticJustification: "The cookie is offered toward another person while the popcorn remains visible.",
                     signature: .init(family: "exchange", recipe: .exchange, framing: .duet, objectPair: [.init("snacks/cookie"), .init("snacks/popcorn")]))
    }
}
