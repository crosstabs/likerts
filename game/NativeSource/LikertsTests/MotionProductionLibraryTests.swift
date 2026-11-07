import XCTest
@testable import Likerts

final class MotionProductionLibraryTests: XCTestCase {
    func testNativeAdapterContractSeparatesActualExecutionPaths() {
        XCTAssertEqual(MotionNativeAdapterContract.allowedIDs.count, 46)
        XCTAssertEqual(MotionNativeAdapterContract.actionMotionIDs.count, 36)
        XCTAssertEqual(MotionNativeAdapterContract.reactionOnlyIDs.count, 10)
        XCTAssertTrue(MotionNativeAdapterContract.actionMotionIDs.isDisjoint(with: MotionNativeAdapterContract.reactionOnlyIDs))
        XCTAssertEqual(MotionNativeAdapterContract.action(id: 1001), .tradeSnack)
        XCTAssertNil(MotionNativeAdapterContract.action(id: 1108))
        XCTAssertNil(MotionNativeAdapterContract.action(id: 1208))
        XCTAssertNil(MotionNativeAdapterContract.action(id: 1051))
        XCTAssertEqual(MotionNativeAdapterContract.coverage(id: 1018), .reactionOnly)
    }

    func testOldLayeredDescriptorsDecodeWithoutNewOptionalFields() throws {
        let value = fixture(id: 1051)
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
        json.removeValue(forKey: "renderer"); json.removeValue(forKey: "nativeBinding")
        let decoded = try JSONDecoder().decode(ScenePerformance.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(decoded.renderer, .layeredGraph)
        XCTAssertNil(decoded.nativeBinding)
        try MotionPerformanceValidator.validate(decoded, registry: registry())
    }

    func testNativeDescriptorsCannotClaimUnusedJSONAnimationPaths() throws {
        let valid = fixture(id: 1001)
        try MotionPerformanceValidator.validate(valid, registry: registry())
        let moving = MotionCue(phase: .reveal, recipe: .present, subjects: ["object"], timing: .init(action: 0.6), tracks: [track()])
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(copy(valid, action: moving), registry: registry())) {
            XCTAssertEqual($0 as? MotionValidationError, .invalidNativeBinding(1001))
        }
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(copy(valid, binding: .init(action: .saveCookie)), registry: registry()))
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(copy(valid, binding: .init(action: .tradeSnack, contractVersion: 2)), registry: registry()))
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(copy(valid, coverage: .reactionOnly), registry: registry()))
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(copy(fixture(id: 1018), coverage: .actionMotion), registry: registry()))
        let layered = fixture(id: 1051)
        XCTAssertThrowsError(try MotionPerformanceValidator.validate(copy(layered, binding: .init(action: .tradeSnack)), registry: registry()))
    }

    func testFullCatalogueLoadsOnlyAfterTwentyCompleteTopicTransactions() throws {
        let files = try fixtureFiles()
        var requests: [TopicID] = []
        let loaded = try MotionProductionLibrary.load(registry: registry(), catalog: questions()) { topic in
            requests.append(topic); return try XCTUnwrap(files[topic])
        }
        XCTAssertEqual(requests, TopicID.allCases)
        XCTAssertEqual(loaded.all.count, 1_000)
        XCTAssertEqual(Set(loaded.all.map(\.roundID)), Set(1001...2000))
        XCTAssertEqual(loaded.all.filter { $0.renderer == .nativeStory }.count, 46)
        XCTAssertEqual(loaded.all.filter { $0.renderer == .layeredGraph }.count, 954)
        XCTAssertEqual(loaded.performance(id: 1001)?.nativeBinding?.action, .tradeSnack)
        XCTAssertNil(loaded.performance(id: 42))
    }

    func testMissingMalformedOversizedAndUnsupportedTopicCannotExposePartialCatalogue() throws {
        let files = try fixtureFiles()
        let cases: [(Data?, MotionProductionError)] = [
            (nil, .missingTopic("kitchen")),
            (Data("{broken".utf8), .invalidJSON("kitchen")),
            (Data(repeating: 32, count: MotionProductionLibrary.topicByteLimit + 1), .oversizedTopic("kitchen")),
            (try JSONEncoder().encode(MotionProductionTopicFile(schemaVersion: 2, topic: .kitchen,
                performances: (1051...1100).map { fixture(id: $0) })), .unsupportedVersion("kitchen"))
        ]
        for (replacement, expected) in cases {
            XCTAssertThrowsError(try MotionProductionLibrary.load(registry: registry(), catalog: questions()) { topic in
                if topic == .kitchen {
                    guard let replacement else { throw MotionProductionError.missingTopic("kitchen") }; return replacement
                }
                return try XCTUnwrap(files[topic])
            }) { XCTAssertEqual($0 as? MotionProductionError, expected) }
        }
    }

    func testTopicMustMatchStableIDsAndDeclareCorrectTopic() throws {
        let files = try fixtureFiles()
        let snackValues = (1001...1050).map { fixture(id: $0) }
        let bad: [(MotionProductionTopicFile, MotionProductionError)] = [
            (.init(topic: .kitchen, performances: snackValues), .topicMismatch("snacks")),
            (.init(topic: .snacks, performances: Array(snackValues.dropLast())), .topicCoverage("snacks")),
            (.init(topic: .snacks, performances: Array(snackValues.dropLast()) + [snackValues[0]]), .topicCoverage("snacks")),
            (.init(topic: .snacks, performances: Array(snackValues.dropLast()) + [fixture(id: 1051)]), .topicCoverage("snacks"))
        ]
        for (file, expected) in bad {
            let data = try JSONEncoder().encode(file)
            XCTAssertThrowsError(try MotionProductionLibrary.load(registry: registry(), catalog: questions()) { topic in
                topic == .snacks ? data : try XCTUnwrap(files[topic])
            }) { XCTAssertEqual($0 as? MotionProductionError, expected) }
        }
    }

    func testProductionRoutingCannotSilentlyReplaceNativeCompositions() throws {
        var values = (1001...1050).map { fixture(id: $0) }
        values[0] = fixture(id: 1001, forceLayered: true)
        let bad = try JSONEncoder().encode(MotionProductionTopicFile(topic: .snacks, performances: values))
        let files = try fixtureFiles()
        XCTAssertThrowsError(try MotionProductionLibrary.load(registry: registry(), catalog: questions()) { topic in
            topic == .snacks ? bad : try XCTUnwrap(files[topic])
        }) { XCTAssertEqual($0 as? MotionProductionError, .rendererMismatch(1001)) }
    }

    func testValidatorFailureIsReportedWithExactID() throws {
        var values = (1001...1050).map { fixture(id: $0) }
        let base = fixture(id: 1003)
        values[2] = copy(base, coverage: .actionMotion,
                         action: .init(phase: .reveal, recipe: .staticTableau, subjects: ["object"], timing: .init(action: 0)))
        let bad = try JSONEncoder().encode(MotionProductionTopicFile(topic: .snacks, performances: values))
        let files = try fixtureFiles()
        XCTAssertThrowsError(try MotionProductionLibrary.load(registry: registry(), catalog: questions()) { topic in
            topic == .snacks ? bad : try XCTUnwrap(files[topic])
        }) { XCTAssertEqual($0 as? MotionProductionError, .invalidPerformance(1003, .invalidReview)) }
    }

    private func questions() throws -> TopicCatalog { try TopicCatalog.bundled.get() }
    private func registry() throws -> MotionAssetRegistry { try MotionPilotLibrary.registryResult.get() }
    private func fixtureFiles() throws -> [TopicID: Data] {
        var result: [TopicID: Data] = [:]
        for topic in TopicID.allCases {
            let ids = try questions().rounds(for: topic).map(\.id)
            result[topic] = try JSONEncoder().encode(MotionProductionTopicFile(topic: topic, performances: ids.map { fixture(id: $0) }))
        }
        return result
    }
    private func track() -> MotionTrack {
        .init(nodeID: "object", frames: [.init(progress: 0, transform: .init(x: 0.35, y: 0.7)),
                                        .init(progress: 1, transform: .init(x: 0.65, y: 0.7))])
    }
    /// Synthetic geometry verifies schema/routing only, never semantic production motion.
    private func fixture(id: Int, forceLayered: Bool = false) -> ScenePerformance {
        let native = !forceLayered && MotionNativeAdapterContract.allowedIDs.contains(id)
        let node = MotionNode(id: "object", asset: .init("snacks/cookie"), role: .primaryProp, layer: .prop,
                              frame: .init(x: 0.35, y: 0.7, width: 0.2, height: 0.3))
        let action = MotionCue(phase: .reveal, recipe: native ? .staticTableau : .present,
                               subjects: [node.id], timing: .init(action: native ? 0 : 0.6), tracks: native ? [] : [track()])
        return .init(roundID: id, graph: .init(id: "test.fixture", nodes: [node]), reveal: .init(action: action),
                     reduced: .init(states: [.init(nodeID: node.id, transform: native ? node.initial : .init(x: 0.65, y: 0.7))]),
                     review: .init(semantic: .mapped, coverage: native ? MotionNativeAdapterContract.coverage(id: id)! : .actionMotion),
                     semanticJustification: "A synthetic fixture checks schema validation without approving production imagery.",
                     signature: .init(family: "fixture", recipe: action.recipe, framing: .stage, objectPair: [node.asset]),
                     renderer: native ? .nativeStory : .layeredGraph,
                     nativeBinding: native ? .init(action: MotionNativeAdapterContract.action(id: id)!) : nil)
    }
    private func copy(_ value: ScenePerformance, binding: MotionNativeBinding? = nil, coverage: MotionCoverage? = nil,
                      action: MotionCue? = nil) -> ScenePerformance {
        .init(roundID: value.roundID, revision: value.revision, graph: value.graph, ambient: value.ambient,
              choice: value.choice, reveal: .init(action: action ?? value.reveal.action), reduced: value.reduced,
              review: .init(semantic: value.review.semantic, playback: value.review.playback, coverage: coverage ?? value.review.coverage),
              semanticJustification: value.semanticJustification, signature: value.signature, renderer: value.renderer,
              nativeBinding: binding ?? value.nativeBinding)
    }
}
