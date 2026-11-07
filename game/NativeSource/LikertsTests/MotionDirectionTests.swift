import XCTest
@testable import Likerts

final class MotionDirectionTests: XCTestCase {
    func testMotionPreferencesUseAuthoredFamilyRecipeFramingAndObjectPair() throws {
        let catalog = try TopicCatalog.bundled.get()
        let signatures = authoredSignatures(catalog)
        for seed in 0..<25 {
            let selector = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore(), motionSignatures: signatures)
            let pack = try selector.select(topic: .snacks, seed: UInt64(seed))
            let values = try pack.map { try XCTUnwrap(signatures[$0.id]) }
            XCTAssertEqual(Set(values.map(\.family)).count, 5, "seed \(seed)")
            XCTAssertEqual(Set(values.map(\.recipe)).count, 5, "seed \(seed)")
            XCTAssertEqual(Set(values.map { Set($0.objectPair) }).count, 5, "seed \(seed)")
            for pair in zip(values, values.dropFirst()) { XCTAssertNotEqual(pair.0.framing, pair.1.framing) }
        }
    }

    func testMotionDirectionIsReproducibleAcrossSaveAndRestart() throws {
        let catalog = try TopicCatalog.bundled.get(), signatures = authoredSignatures(catalog)
        let firstStore = MemoryTopicHistoryStore(), secondStore = MemoryTopicHistoryStore()
        let persistent = TopicDeckSelector(catalog: catalog, store: firstStore, motionSignatures: signatures)
        for seed: UInt64 in [0, 1, 777, UInt64.max, 777] {
            let restarted = TopicDeckSelector(catalog: catalog, store: secondStore, motionSignatures: signatures)
            let expected = try persistent.select(topic: nil, seed: seed)
            XCTAssertEqual(expected, try restarted.select(topic: nil, seed: seed))
            XCTAssertEqual(Set(expected.map(\.topic)).count, 5)
            XCTAssertEqual(firstStore.history, secondStore.history)
        }
        XCTAssertEqual(firstStore.history.recentPresentations.count, 12)
        XCTAssertEqual(Set(firstStore.history.recentPresentations).count, 12)
    }

    func testPreviousTopicMotionInfluencesNextTopicAfterRestart() throws {
        let catalog = try TopicCatalog.bundled.get(), signatures = authoredSignatures(catalog)
        let store = MemoryTopicHistoryStore()
        let first = TopicDeckSelector(catalog: catalog, store: store, motionSignatures: signatures)
        let previous = try XCTUnwrap(first.draw(topic: .snacks, count: 1, seed: 9).first)
        let restarted = TopicDeckSelector(catalog: catalog, store: store, motionSignatures: signatures)
        let next = try XCTUnwrap(restarted.draw(topic: .books, count: 1, seed: 9).first)
        XCTAssertNotEqual(signatures[previous.id]?.recipe, signatures[next.id]?.recipe)
        XCTAssertNotEqual(signatures[previous.id]?.family, signatures[next.id]?.family)
        XCTAssertEqual(store.history.recentPresentations, [previous.id, next.id])
    }

    func testMotionPreferencesNeverResetDeckEarlyOrDeadEndAtExhaustion() throws {
        let catalog = try TopicCatalog.bundled.get(), signatures = authoredSignatures(catalog)
        let store = MemoryTopicHistoryStore()
        let selector = TopicDeckSelector(catalog: catalog, store: store, motionSignatures: signatures)
        var allIDs = Set<Int>()
        for topic in TopicID.allCases {
            var ids: [Int] = []
            for seed in 0..<7 {
                let pack = try selector.draw(topic: topic, count: 7, seed: UInt64(seed))
                XCTAssertEqual(Set(pack.map(\.id)).count, 7)
                ids += pack.map(\.id)
            }
            XCTAssertEqual(Set(ids).count, 49)
            let crossing = try selector.draw(topic: topic, count: 7, seed: 77)
            XCTAssertFalse(ids.contains(crossing[0].id))
            XCTAssertEqual(Set(crossing.map(\.id)).count, 7)
            allIDs.formUnion(ids + crossing.map(\.id))
        }
        XCTAssertEqual(allIDs, Set(1001...2000))
    }

    func testVersionOneHistoryMigratesWithoutReplayingSeenQuestions() throws {
        let suite = "Likerts.MotionDirectionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let legacy = Data("{\"version\":1,\"seen\":{\"snacks\":[1001,1002,1003]},\"recent\":{\"snacks\":[1001,1002,1003]}}".utf8)
        defaults.set(legacy, forKey: "likerts.topic-history.v1")
        let store = UserDefaultsTopicHistoryStore(defaults: defaults)
        XCTAssertEqual(store.load().version, 2)
        XCTAssertEqual(store.load().seen["snacks"], [1001, 1002, 1003])
        XCTAssertEqual(store.load().recentPresentations, [])
        let catalog = try TopicCatalog.bundled.get()
        let selector = TopicDeckSelector(catalog: catalog, store: store, motionSignatures: authoredSignatures(catalog))
        let selected = try selector.select(topic: .snacks, seed: 0)
        XCTAssertTrue(Set(selected.map(\.id)).isDisjoint(with: [1001, 1002, 1003]))
        XCTAssertEqual(store.load().version, 2)
        XCTAssertEqual(store.load().seen["snacks"]?.count, 8)
        XCTAssertEqual(store.load().recentPresentations, selected.map(\.id))
    }

    func testGlobalPresentationHistoryIsBoundedAndSanitizedAndIncompleteMappingFallsBack() throws {
        let catalog = try TopicCatalog.bundled.get()
        var history = TopicHistory()
        history.recentPresentations = [1, 1001, 1002, 1001] + Array(1003...1020) + [9999]
        let store = MemoryTopicHistoryStore(history: history)
        let selector = TopicDeckSelector(catalog: catalog, store: store, motionSignatures: [1001: authoredSignatures(catalog)[1001]!])
        let selected = try selector.select(topic: .snacks, seed: 5)
        XCTAssertEqual(selected.count, 5)
        XCTAssertEqual(store.history.recentPresentations.count, 12)
        XCTAssertEqual(Set(store.history.recentPresentations).count, 12)
        XCTAssertTrue(store.history.recentPresentations.allSatisfy { catalog.round(id: $0) != nil })
        XCTAssertEqual(Array(store.history.recentPresentations.suffix(5)), selected.map(\.id))
    }

    /// Controlled test signatures exercise the director; they are not production
    /// animation data, asset endorsements, or claims of six bespoke animations.
    private func authoredSignatures(_ catalog: TopicCatalog) -> [Int: MotionPresentationSignature] {
        let recipes: [MotionRecipe] = [.place, .inspect, .align, .protect, .travel, .present]
        let frames: [MotionFraming] = [.tabletop, .foreground, .duet, .wide, .vertical, .window]
        return Dictionary(uniqueKeysWithValues: catalog.allRounds.map { round in
            let index = (round.id - 1001) % 6
            let props = round.topic.definition.props
            let signature = MotionPresentationSignature(family: "test.authored.\(index)", recipe: recipes[index], framing: frames[index],
                objectPair: [MotionAssetID("\(round.topic.rawValue)/\(props[index])"), MotionAssetID("\(round.topic.rawValue)/\(props[(index + 1) % 6])")])
            return (round.id, signature)
        })
    }
}
