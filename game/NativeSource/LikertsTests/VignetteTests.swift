import XCTest
@testable import Likerts

final class VignetteTests: XCTestCase {
    func testFortyEightExistingRecordsHaveExplicitBalancedStoryboardsAndValidAssets() throws {
        let catalog = try TopicCatalog.bundled.get()
        try VignetteBank.validate(catalog: catalog)
        XCTAssertEqual(catalog.allRounds.count, 1_000)
        XCTAssertEqual(VignetteBank.all.count, 48)
        XCTAssertEqual(Set(VignetteBank.all.map(\.id)).count, 48)
        XCTAssertEqual(Set(VignetteBank.all.map(\.action)), Set(VignetteAction.allCases))
        XCTAssertEqual(VignetteBank.newPropKeys.count, 18)
        XCTAssertEqual(VignetteBank.setPieces.count, 8)
        for topic in VignetteBank.pilotTopics {
            let values = VignetteBank.all.filter { catalog.round(id: $0.id)?.topic == topic }
            XCTAssertEqual(values.count, 12)
            for family in VignetteFamily.allCases {
                XCTAssertEqual(values.filter { $0.family == family }.count, 2)
            }
        }
        XCTAssertNil(VignetteBank.spec(id: 1))
        XCTAssertNil(VignetteBank.spec(id: 2000))
    }

    func testSpecificAuditedMissingObjectsAreNowAuthoredLiterally() throws {
        let box = try XCTUnwrap(VignetteBank.spec(id: 1108))
        XCTAssertEqual(box.action, .catBox)
        XCTAssertEqual(box.setPiece, "box")
        XCTAssertEqual(box.primaryAsset, "pets/cat")
        let headphones = try XCTUnwrap(VignetteBank.spec(id: 1351))
        XCTAssertEqual(headphones.action, .wearHeadphones)
        XCTAssertEqual(headphones.primaryAsset, "story/headphones")
        let bridge = try XCTUnwrap(VignetteBank.spec(id: 1009))
        XCTAssertEqual(bridge.action, .bridgeBowl)
        XCTAssertEqual(bridge.secondaryAsset, "story/icecreambowl")
        let train = try XCTUnwrap(VignetteBank.spec(id: 1208))
        XCTAssertEqual(train.action, .trainWindow)
        XCTAssertEqual(train.setPiece, "window")
        XCTAssertTrue(train.detailAssets.contains("story/trainseat"))
        // Existing canonical props are reused across topic boundaries.
        XCTAssertTrue(try XCTUnwrap(VignetteBank.spec(id: 1142)).detailAssets.contains("making/pencil"))
        XCTAssertEqual(try XCTUnwrap(VignetteBank.spec(id: 1111)).secondaryAsset, "hobbies/camera")
    }

    func testInvalidStoryboardReferencesCountsAndRepeatedActionsReject() throws {
        let catalog = try TopicCatalog.bundled.get()
        XCTAssertThrowsError(try VignetteBank.validate(Array(VignetteBank.all.dropLast()), catalog: catalog)) {
            XCTAssertEqual($0 as? VignetteValidationError, .wrongCount)
        }
        var values = VignetteBank.all
        values[1] = values[0]
        XCTAssertThrowsError(try VignetteBank.validate(values, catalog: catalog)) {
            XCTAssertEqual($0 as? VignetteValidationError, .duplicateID(values[0].id))
        }
        values = VignetteBank.all
        values[0] = changed(values[0], primaryAsset: "story/not-a-real-prop")
        XCTAssertThrowsError(try VignetteBank.validate(values, catalog: catalog)) {
            XCTAssertEqual($0 as? VignetteValidationError, .invalidAsset(values[0].id, "story/not-a-real-prop"))
        }
        values = VignetteBank.all
        values[1] = changed(values[1], action: values[0].action)
        XCTAssertThrowsError(try VignetteBank.validate(values, catalog: catalog)) {
            XCTAssertEqual($0 as? VignetteValidationError, .duplicateAction(values[0].action.rawValue))
        }
    }

    func testPresentationPairsIgnoreStateAndNamespaceToPreventArtificialDiversity() throws {
        let catalog = try TopicCatalog.bundled.get()
        let bridge = try XCTUnwrap(catalog.round(id: 1009))
        let cookieChoice = try XCTUnwrap(catalog.round(id: 1007))
        XCTAssertEqual(VignetteBank.profile(for: bridge).objectPair,
                       VignetteBank.profile(for: cookieChoice).objectPair)
        XCTAssertNotEqual(VignetteBank.profile(for: bridge).family,
                          VignetteBank.profile(for: cookieChoice).family)
    }

    func testFreshStorySliceChoosesFiveDifferentFamiliesFramesAndObjectPairs() throws {
        let full = try TopicCatalog.bundled.get()
        let rounds = VignetteBank.all.compactMap { full.round(id: $0.id) }.filter { $0.topic == .snacks }
        let slice = try TopicCatalog(validating: rounds, requiredTopics: [.snacks], expectedRoundsPerTopic: 12)
        for seed in 0..<100 {
            let selector = TopicDeckSelector(catalog: slice, store: MemoryTopicHistoryStore(), motionSignatures: [:])
            let values = try selector.select(topic: .snacks, seed: UInt64(seed))
            let profiles = values.map { VignetteBank.profile(for: $0) }
            XCTAssertEqual(Set(profiles.map(\.family)).count, 5, "seed \(seed)")
            XCTAssertEqual(Set(profiles.map(\.objectPair)).count, 5, "seed \(seed)")
            for pair in zip(profiles, profiles.dropFirst()) {
                XCTAssertNotEqual(pair.0.framing, pair.1.framing)
            }
        }
    }

    func testDirectorStillExhaustsAllOneThousandIncludingOriginalRecords() throws {
        let catalog = try TopicCatalog.bundled.get()
        let selector = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore(), motionSignatures: [:])
        var all: [Int] = []
        for topic in TopicID.allCases {
            var topicIDs: [Int] = []
            for index in 0..<10 {
                let values = try selector.select(topic: topic, seed: UInt64(topic.ordinal * 10 + index))
                XCTAssertEqual(Set(values.map(\.id)).count, 5)
                topicIDs += values.map(\.id)
            }
            XCTAssertEqual(Set(topicIDs).count, 50, topic.rawValue)
            all += topicIDs
        }
        XCTAssertEqual(Set(all), Set(1001...2000))
        XCTAssertEqual(all.filter { VignetteBank.spec(id: $0) != nil }.count, 48)
        XCTAssertEqual(all.filter { VignetteBank.spec(id: $0) == nil }.count, 952)
    }

    func testFreshFullCatalogPilotPacksAvoidRepeatedFamiliesAndObjectPairs() throws {
        let catalog = try TopicCatalog.bundled.get()
        for topic in VignetteBank.pilotTopics {
            for seed in 0..<25 {
                let selector = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore(), motionSignatures: [:])
                let values = try selector.select(topic: topic, seed: UInt64(seed))
                let profiles = values.map { VignetteBank.profile(for: $0) }
                XCTAssertEqual(Set(profiles.map(\.family)).count, 5, "\(topic.rawValue), seed \(seed)")
                XCTAssertEqual(Set(profiles.map(\.objectPair)).count, 5, "\(topic.rawValue), seed \(seed)")
            }
        }
    }

    func testPresentationPreferencesRelaxAtExhaustionWithoutDeadEndsOrEarlyRepeats() throws {
        let catalog = try TopicCatalog.bundled.get()
        let first = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore(), motionSignatures: [:])
        let second = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore(), motionSignatures: [:])
        var seen = Set<Int>()
        for index in 0..<7 {
            let values = try first.draw(topic: .pets, count: 7, seed: UInt64(index))
            XCTAssertEqual(values, try second.draw(topic: .pets, count: 7, seed: UInt64(index)))
            XCTAssertTrue(seen.isDisjoint(with: values.map(\.id)))
            seen.formUnion(values.map(\.id))
        }
        XCTAssertEqual(seen.count, 49)
        let crossing = try first.draw(topic: .pets, count: 7, seed: 88)
        XCTAssertFalse(seen.contains(crossing[0].id))
        XCTAssertEqual(Set(crossing.map(\.id)).count, 7)
    }

    func testOneStoryDiscoverySlotAppearsInFreshPilotAndMixedFivePacks() throws {
        let catalog = try TopicCatalog.bundled.get()
        for topic in VignetteBank.pilotTopics.map(Optional.some) + [nil] {
            for seed in 0..<25 {
                let selector = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore(), motionSignatures: [:])
                let values = try selector.select(topic: topic, seed: UInt64(seed))
                XCTAssertNotNil(VignetteBank.spec(id: values[0].id), "Discover an eligible rich scene first.")
                XCTAssertEqual(values.filter { VignetteBank.spec(id: $0.id) != nil }.count, 1,
                               "A discovery slot must leave room for original content: \(String(describing: topic)), seed \(seed)")
                if topic == nil { XCTAssertEqual(Set(values.map(\.topic)).count, 5) }
            }
        }
    }

    func testDiscoveryNeverReplaysSeenStoriesWhileOriginalRecordsRemain() throws {
        let catalog = try TopicCatalog.bundled.get()
        var history = TopicHistory()
        for topic in VignetteBank.pilotTopics {
            let ids = VignetteBank.all.filter { catalog.round(id: $0.id)?.topic == topic }.map(\.id)
            history.seen[topic.rawValue] = ids
            history.recent[topic.rawValue] = Array(ids.suffix(5))
        }
        for topic in VignetteBank.pilotTopics.map(Optional.some) + [nil] {
            let selector = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore(history: history), motionSignatures: [:])
            let values = try selector.select(topic: topic, seed: 51)
            XCTAssertTrue(values.allSatisfy { VignetteBank.spec(id: $0.id) == nil })
            for value in values {
                XCTAssertFalse((history.seen[value.topic.rawValue] ?? []).contains(value.id))
            }
        }
    }

    private func changed(_ original: VignetteSpec, action: VignetteAction? = nil, primaryAsset: String? = nil) -> VignetteSpec {
        .init(id: original.id, family: original.family, action: action ?? original.action,
              primaryAsset: primaryAsset ?? original.primaryAsset, secondaryAsset: original.secondaryAsset,
              setPiece: original.setPiece, detailAssets: original.detailAssets, castCount: original.castCount,
              summary: original.summary, revealSummary: original.revealSummary)
    }
}
