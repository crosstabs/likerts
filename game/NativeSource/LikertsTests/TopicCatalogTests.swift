import XCTest
@testable import Likerts

final class TopicCatalogTests: XCTestCase {
    func testBundledCatalogContainsOneThousandBalancedPlayableDistinctRecords() throws {
        let catalog = try TopicCatalog.bundled.get()
        XCTAssertEqual(catalog.allRounds.count, 1_000)
        XCTAssertEqual(Set(catalog.allRounds.map(\.id)), Set(1001...2000))
        XCTAssertEqual(Set(catalog.allRounds.map { TopicCatalog.normalizedStatement($0.text) }).count, 1_000)
        XCTAssertEqual(Set(catalog.allRounds.map(\.sceneKey)).count, 1_000)
        for topic in TopicID.allCases {
            let rounds = catalog.rounds(for: topic)
            XCTAssertEqual(rounds.count, 50, topic.rawValue)
            XCTAssertEqual(topic.definition.props.count, 6)
            XCTAssertEqual(Set(topic.definition.props).count, 6)
            XCTAssertFalse(topic.definition.title.isEmpty)
            XCTAssertFalse(topic.definition.summary.isEmpty)
            XCTAssertFalse(topic.definition.symbol.isEmpty)
            XCTAssertTrue(rounds.allSatisfy { catalog.round(id: $0.id) == $0 && $0.prompt.text == $0.text })
        }
        XCTAssertNil(catalog.round(id: -1))
        XCTAssertNil(catalog.round(id: 1))
    }

    func testBundledContentHasNoHighSimilarityTokenPairs() throws {
        let catalog = try TopicCatalog.bundled.get()
        let flagged = catalog.nearDuplicates(threshold: 0.65)
        XCTAssertTrue(flagged.isEmpty, "Editorial review needed for token-similar pairs: \(flagged)")
    }

    func testSchemaRejectsMalformedOversizedWrongTopicAndUnknownRelation() throws {
        let data = try JSONEncoder().encode(fixture())
        XCTAssertEqual(try TopicCatalog.decodeTopic(data, expectedTopic: .snacks).count, 50)
        XCTAssertThrowsError(try TopicCatalog.decodeTopic(Data(repeating: 65, count: 256_001), expectedTopic: .snacks))
        XCTAssertThrowsError(try TopicCatalog.decodeTopic(Data("{}".utf8), expectedTopic: .snacks))
        XCTAssertThrowsError(try TopicCatalog.decodeTopic(data, expectedTopic: .books))
        let changed = String(decoding: data, as: UTF8.self).replacingOccurrences(of: "\"inspect\"", with: "\"explode\"")
        XCTAssertThrowsError(try TopicCatalog.decodeTopic(Data(changed.utf8), expectedTopic: .snacks))
        XCTAssertThrowsError(try TopicCatalog.decodeTopic(try JSONEncoder().encode(fixture() + [fixture()[0]]), expectedTopic: .snacks))
    }

    func testValidationRejectsDuplicateIDsTextScenesAndUnknownProps() throws {
        let original = fixture()
        var values = original
        values[1] = values[0]
        assertInvalid(values, .duplicateID(1001))
        values = original
        values[1] = replace(values[1], text: original[0].text.uppercased())
        assertInvalid(values, .duplicateStatement(1001, 1002))
        values = original
        values[1] = replace(values[1], scene: original[0].scene)
        assertInvalid(values, .duplicateScene(1001, 1002))
        values = original
        values[1] = replace(values[1], scene: .init(primary: "not-a-prop", secondary: "cookie", relation: .inspect))
        assertInvalid(values, .invalidScene(1002))
        values = original
        values[1] = replace(values[1], scene: .init(primary: "cookie", secondary: "cookie", relation: .inspect))
        assertInvalid(values, .invalidScene(1002))
        values = original
        values[1] = replace(values[1], text: "I would share my password with a friendly dragon.")
        assertInvalid(values, .invalidStatement(1002))
        values = original
        values[1] = replace(values[1], summary: "")
        assertInvalid(values, .invalidSummary(1002))
        XCTAssertThrowsError(try TopicCatalog(validating: Array(original.dropLast()), requiredTopics: [.snacks])) { error in
            XCTAssertEqual(error as? TopicCatalogError, .wrongCount(topic: "snacks", expected: 50, actual: 49))
        }
    }

    func testSeedAndHistoryGiveStableReproducibleSelections() throws {
        let catalog = try catalog()
        let first = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore())
        let second = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore())
        var sequence: [Int] = []
        for seed: UInt64 in [0, 1, UInt64.max, 777, 777] {
            let expected = try first.select(topic: .snacks, seed: seed)
            XCTAssertEqual(try second.select(topic: .snacks, seed: seed), expected)
            XCTAssertEqual(Set(expected.map(\.id)).count, 5)
            sequence += expected.map(\.id)
        }
        XCTAssertEqual(Set(sequence).count, 25)
        XCTAssertEqual(TopicDeckSelector.directorVersion, 3)
        XCTAssertEqual(Array(sequence.prefix(5)), [1009, 1004, 1050, 1036, 1002], "Stable legacy-fallback seed-zero vector under director-v3")
        let other = TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore())
        XCTAssertNotEqual(try other.select(topic: .snacks, seed: 123).map(\.id), Array(sequence.prefix(5)))
    }

    func testFullTopicExhaustsEveryQuestionAndSceneBeforeRepeatingThenAvoidsPreviousPack() throws {
        let store = MemoryTopicHistoryStore()
        let selector = TopicDeckSelector(catalog: try catalog(), store: store)
        var chosen: [TopicRound] = []
        for seed in 0..<10 { chosen += try selector.select(topic: .snacks, seed: UInt64(seed)) }
        XCTAssertEqual(Set(chosen.map(\.id)).count, 50)
        XCTAssertEqual(Set(chosen.map(\.sceneKey)).count, 50)
        let recent = Set(chosen.suffix(10).map(\.id))
        let next = try selector.select(topic: .snacks, seed: 10)
        XCTAssertTrue(recent.isDisjoint(with: next.map(\.id)))
        XCTAssertEqual(store.history.seen["snacks"]?.count, 5)
        XCTAssertEqual(store.history.recent["snacks"]?.count, 10)
    }

    func testNonDivisibleBatchSizeAcrossCycleHasNoWithinPackDuplicatesOrEarlyRepeats() throws {
        let selector = TopicDeckSelector(catalog: try catalog(), store: MemoryTopicHistoryStore())
        var firstCycle: [Int] = []
        for seed in 0..<7 {
            let pack = try selector.draw(topic: .snacks, count: 7, seed: UInt64(seed))
            XCTAssertEqual(Set(pack.map(\.id)).count, 7)
            firstCycle += pack.map(\.id)
        }
        XCTAssertEqual(Set(firstCycle).count, 49)
        let crossing = try selector.draw(topic: .snacks, count: 7, seed: 9)
        XCTAssertFalse(firstCycle.contains(crossing[0].id))
        XCTAssertEqual(Set(crossing.map(\.id)).count, 7)
    }

    func testRestartRestoresHistoryAndMalformedOrFutureDataFallsBack() throws {
        let suite = "Likerts.TopicTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsTopicHistoryStore(defaults: defaults)
        let catalog = try catalog()
        let first = TopicDeckSelector(catalog: catalog, store: store)
        let chosen = try first.select(topic: .snacks, seed: 17)
        let restarted = TopicDeckSelector(catalog: catalog, store: UserDefaultsTopicHistoryStore(defaults: defaults))
        let next = try restarted.select(topic: .snacks, seed: 17)
        XCTAssertTrue(Set(chosen.map(\.id)).isDisjoint(with: next.map(\.id)))
        defaults.set(Data("bad".utf8), forKey: "likerts.topic-history.v1")
        XCTAssertEqual(store.load(), TopicHistory())
        defaults.set(Data(repeating: 65, count: 64_001), forKey: "likerts.topic-history.v1")
        XCTAssertEqual(store.load(), TopicHistory())
        var future = TopicHistory()
        future.version = 99
        store.save(future)
        XCTAssertEqual(store.load(), TopicHistory())
    }

    func testInvalidHistoryIDsDuplicatesAndTopicsCannotPolluteSelection() throws {
        var history = TopicHistory()
        history.seen = ["snacks": [1, 1001, 1001, 1002, 1051], "books": [1003], "mystery": [1004]]
        history.recent = ["snacks": [1001, 1001, 9999]]
        let store = MemoryTopicHistoryStore(history: history)
        let selector = TopicDeckSelector(catalog: try catalog(), store: store)
        let chosen = try selector.select(topic: .snacks, seed: 17)
        XCTAssertFalse(chosen.contains(where: { $0.id == 1001 || $0.id == 1002 }))
        XCTAssertNil(store.history.seen["mystery"])
        XCTAssertEqual(store.history.seen["books"], [])
        XCTAssertEqual(store.history.seen["snacks"]?.count, 7)
    }

    func testMixedDeckUsesDifferentTopicsAndKeepsPerTopicHistories() throws {
        let values = fixture() + fixture(topic: .books) + fixture(topic: .future) + fixture(topic: .weather) + fixture(topic: .music) + fixture(topic: .pets)
        let catalog = try TopicCatalog(validating: values, requiredTopics: [.snacks, .books, .future, .weather, .music, .pets])
        let store = MemoryTopicHistoryStore()
        let selector = TopicDeckSelector(catalog: catalog, store: store)
        let chosen = try selector.select(topic: nil, seed: 99)
        XCTAssertEqual(Set(chosen.map(\.topic)).count, 5)
        for round in chosen { XCTAssertEqual(store.history.seen[round.topic.rawValue], [round.id]) }
        XCTAssertThrowsError(try selector.draw(topic: .snacks, count: 0, seed: 1))
        XCTAssertThrowsError(try selector.draw(topic: .snacks, count: 51, seed: 1))
        XCTAssertThrowsError(try selector.draw(topic: .home, count: 5, seed: 1))
    }

    private func catalog() throws -> TopicCatalog {
        try TopicCatalog(validating: fixture(), requiredTopics: [.snacks])
    }

    private func fixture(topic: TopicID = .snacks) -> [TopicRound] {
        let props = topic.definition.props
        return (0..<50).map { index in
            let primary = index % 6
            let secondary = (primary + 1 + (index / 6) % 5) % 6
            return TopicRound(id: 1001 + topic.ordinal * 50 + index, topic: topic,
                              text: "I would keep trinket number \(topic.ordinal * 50 + index) beside my favourite cushion.",
                              scene: .init(primary: props[primary], secondary: props[secondary], relation: SceneRelation.allCases[index / 30]),
                              sceneSummary: "A totem arranges \(props[primary]) beside \(props[secondary]) on a little stage.")
        }
    }

    private func replace(_ value: TopicRound, text: String? = nil, scene: TopicScene? = nil, summary: String? = nil) -> TopicRound {
        TopicRound(id: value.id, topic: value.topic, text: text ?? value.text, scene: scene ?? value.scene, sceneSummary: summary ?? value.sceneSummary)
    }

    private func assertInvalid(_ values: [TopicRound], _ expected: TopicCatalogError, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try TopicCatalog(validating: values, requiredTopics: [.snacks]), file: file, line: line) { error in
            XCTAssertEqual(error as? TopicCatalogError, expected, file: file, line: line)
        }
    }
}
