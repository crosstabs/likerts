import XCTest
@testable import Likerts

@MainActor final class QuizSceneMotionTests: XCTestCase {
    private func identifier(_ number: Int) -> String {
        let tail = String(number, radix: 16)
        return "00000000-0000-4000-8000-" + String(repeating: "0", count: 12 - tail.count) + tail
    }
    private func key(_ number: Int, phase: QuizScenePhase = .answer, journey: Int = 9_000) throws -> QuizSceneKey {
        try XCTUnwrap(QuizSceneKey.make(namespace: .practice, identifiers: [identifier(journey), identifier(number)], phase: phase))
    }

    func testSceneIdentityIsOpaqueCanonicalAndRejectsContentOrCapabilities() throws {
        let id = identifier(0xAB)
        let lower = try key(0xAB)
        let upper = try XCTUnwrap(QuizSceneKey.make(namespace: .practice, identifiers: [identifier(9_000), id.uppercased()], phase: .answer))
        XCTAssertEqual(lower, upper)
        XCTAssertEqual(lower.digest.utf8.count, 64)
        XCTAssertFalse(lower.digest.contains(id))
        XCTAssertEqual(lower.journeyDigest.utf8.count, 64)
        XCTAssertFalse(lower.journeyDigest.contains(identifier(9_000)))
        XCTAssertNotEqual(lower, try key(0xAB, phase: .reveal))
        XCTAssertEqual(lower.journeyDigest, try key(1, phase: .reveal).journeyDigest)
        XCTAssertEqual(lower.journeyDigest, try key(2).journeyDigest)
        XCTAssertNotEqual(lower.journeyDigest, try key(1, journey: 9_001).journeyDigest)
        XCTAssertNotEqual(lower, try XCTUnwrap(QuizSceneKey.make(namespace: .live, identifiers: [identifier(9_000), id], phase: .answer)))
        for value in ["What is the correct answer?", "NativeQA", "ABCDEF", String(repeating: "A", count: 43), "00000000", "../private"] {
            XCTAssertNil(QuizSceneKey.make(namespace: .practice, identifiers: [value], phase: .answer), value)
        }
        XCTAssertNil(QuizSceneKey.make(namespace: .practice, identifiers: [], phase: .answer))
        XCTAssertNil(QuizSceneKey.make(namespace: .practice, identifiers: Array(repeating: id, count: 5), phase: .answer))
        XCTAssertNil(QuizSceneKey.make(namespace: .library, identifiers: [id], phase: .reveal))
        XCTAssertNil(QuizSceneKey.make(namespace: .editor, identifiers: [id], phase: .answer))
        XCTAssertNil(QuizSceneKey.make(namespace: .practice, identifiers: [id], phase: .entered))
        XCTAssertNil(QuizSceneKey.make(namespace: .live, identifiers: [id], phase: .entered))
        XCTAssertNotNil(QuizSceneKey.make(namespace: .editor, identifiers: ["00000000-0000-0000-0000-000000000000"], phase: .entered))
    }

    func testConsumedHashSurvivesAnotherLedgerWithoutPersistingIdentityOrText() throws {
        let storage = MemoryQuizSceneStore()
        let scene = try key(1)
        let ledger = QuizSceneMotionLedger(storage: storage)
        XCTAssertTrue(ledger.consume(scene)); XCTAssertFalse(ledger.consume(scene))
        let reloaded = QuizSceneMotionLedger(storage: storage)
        XCTAssertFalse(reloaded.consume(scene))
        XCTAssertEqual(storage.writes, 1)
        let data = try XCTUnwrap(storage.data)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["version", "journeys"])
        XCTAssertEqual(object["version"] as? Int, 2)
        let journeys = try XCTUnwrap(object["journeys"] as? [[String: Any]])
        XCTAssertEqual(journeys.count, 1)
        XCTAssertEqual(journeys[0]["scope"] as? String, scene.journeyDigest)
        XCTAssertEqual(journeys[0]["hashes"] as? [String], [scene.digest])
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains(identifier(1)))
    }

    func testJourneyCapacityKeepsCurrentHistoryWhileFutureGamesStillAnimate() throws {
        let storage = MemoryQuizSceneStore()
        let bounded = QuizSceneMotionLedger(storage: storage)
        for index in 0..<QuizSceneMotionLedger.maximumKeys { XCTAssertTrue(bounded.consume(try key(index))) }
        let original = storage.data
        XCTAssertFalse(bounded.consume(try key(0)))
        XCTAssertFalse(bounded.consume(try key(129)))
        XCTAssertEqual(storage.data, original)
        XCTAssertEqual(storage.writes, 128)
        XCTAssertLessThanOrEqual(try XCTUnwrap(original).count, QuizSceneMotionLedger.maximumBytes)
        let reloaded = QuizSceneMotionLedger(storage: storage)
        XCTAssertFalse(reloaded.consume(try key(0))); XCTAssertFalse(reloaded.consume(try key(129)))
        XCTAssertTrue(reloaded.consume(try key(1, journey: 9_001)), "A new game is not disabled by the previous game's saturation")
        XCTAssertFalse(QuizSceneMotionLedger(storage: storage).consume(try key(0)))
    }

    func testEightJourneyLRUEvictsOnlyOldScopeAndProtectsRecentRecreation() throws {
        let storage = MemoryQuizSceneStore()
        let bounded = QuizSceneMotionLedger(storage: storage)
        for journey in 100..<108 { XCTAssertTrue(bounded.consume(try key(1, journey: journey))) }
        XCTAssertFalse(bounded.consume(try key(1, journey: 100)), "Seen scene stays static while refreshing its journey's recency")
        XCTAssertTrue(bounded.consume(try key(1, journey: 108)))
        let reloaded = QuizSceneMotionLedger(storage: storage)
        XCTAssertFalse(reloaded.consume(try key(1, journey: 100)), "The refreshed recent scope remains protected across recreation")
        XCTAssertFalse(reloaded.consume(try key(1, journey: 107)))
        XCTAssertTrue(reloaded.consume(try key(1, journey: 101)), "The evicted oldest historical scope may enter as a new journey")
        let data = try XCTUnwrap(storage.data)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let journeys = try XCTUnwrap(object["journeys"] as? [[String: Any]])
        XCTAssertEqual(journeys.count, QuizSceneMotionLedger.maximumJourneys)
        XCTAssertEqual(journeys.last?["scope"] as? String, try key(1, journey: 101).journeyDigest)
    }

    func testEightFullJourneyPayloadFitsBoundAndNextGameRemainsAvailable() throws {
        let journeys = try (100..<108).map { journey -> [String: Any] in
            let keys = try (0..<QuizSceneMotionLedger.maximumKeys).map { try key($0, journey: journey) }
            return ["scope": try XCTUnwrap(keys.first).journeyDigest, "hashes": keys.map(\.digest)]
        }
        let data = try JSONSerialization.data(withJSONObject: ["version": 2, "journeys": journeys], options: [.sortedKeys])
        XCTAssertLessThanOrEqual(data.count, QuizSceneMotionLedger.maximumBytes)
        let storage = MemoryQuizSceneStore(); storage.data = data
        let ledger = QuizSceneMotionLedger(storage: storage)
        XCTAssertFalse(ledger.consume(try key(129, journey: 107)))
        XCTAssertFalse(ledger.consume(try key(0, journey: 107)))
        XCTAssertTrue(ledger.consume(try key(1, journey: 108)))
        XCTAssertLessThanOrEqual(try XCTUnwrap(storage.data).count, QuizSceneMotionLedger.maximumBytes)
    }

    func testMalformedOrOversizedPersistenceDisablesMotionWithoutOverwritingIt() throws {
        let hash = try key(1).digest
        let scope = try key(1).journeyDigest
        let oversized = try (0...128).map { try key($0).digest }
        let tooManyJourneys = try (100...108).map { journey -> [String: Any] in
            let scene = try key(1, journey: journey)
            return ["scope": scene.journeyDigest, "hashes": [scene.digest]]
        }
        let records: [Data] = [
            Data(), Data("not JSON".utf8), Data("null".utf8),
            try JSONSerialization.data(withJSONObject: ["version": 1, "journeys": []]),
            try JSONSerialization.data(withJSONObject: ["version": true, "journeys": []]),
            try JSONSerialization.data(withJSONObject: ["version": 2, "journeys": [], "extra": "private"]),
            try JSONSerialization.data(withJSONObject: ["version": 2, "journeys": [["scope": "nickname", "hashes": [hash]]]]),
            try JSONSerialization.data(withJSONObject: ["version": 2, "journeys": [["scope": scope, "hashes": ["bad"]]]]),
            try JSONSerialization.data(withJSONObject: ["version": 2, "journeys": [["scope": scope, "hashes": [hash, hash]]]]),
            try JSONSerialization.data(withJSONObject: ["version": 2, "journeys": [["scope": scope, "hashes": oversized]]]),
            try JSONSerialization.data(withJSONObject: ["version": 2, "journeys": [["scope": scope, "hashes": [hash], "extra": "private"]]]),
            try JSONSerialization.data(withJSONObject: ["version": 2, "journeys": [["scope": scope, "hashes": [hash]], ["scope": scope, "hashes": []]]]),
            try JSONSerialization.data(withJSONObject: ["version": 2, "journeys": tooManyJourneys]),
            Data(repeating: 0x20, count: QuizSceneMotionLedger.maximumBytes + 1)
        ]
        for record in records {
            let storage = MemoryQuizSceneStore(); storage.data = record
            let ledger = QuizSceneMotionLedger(storage: storage)
            XCTAssertFalse(ledger.consume(try key(2))); XCTAssertEqual(storage.writes, 0)
            XCTAssertEqual(storage.data, record)
            storage.data = nil
            XCTAssertFalse(ledger.consume(try key(2)), "A failed ledger does not silently re-enable itself")
        }
    }

    func testReadWriteAndReadbackFailuresAlwaysFailClosed() throws {
        for failure in 0..<3 {
            let storage = MemoryQuizSceneStore()
            storage.failRead = failure == 0; storage.failWrite = failure == 1; storage.dropWrites = failure == 2
            let ledger = QuizSceneMotionLedger(storage: storage)
            XCTAssertFalse(ledger.consume(try key(1)))
            storage.failRead = false; storage.failWrite = false; storage.dropWrites = false
            XCTAssertFalse(ledger.consume(try key(2)))
        }
    }

    func testPrepareBeginFinishIsBoundedAndIdenticalKeysNeverRestart() throws {
        let scene = try key(1)
        var state = QuizSceneMotionState(), consumed = 0
        XCTAssertTrue(state.prepare(key: scene, allowed: true) { _ in consumed += 1; return true })
        XCTAssertEqual(state.phase, .prepared); XCTAssertEqual(state.offsetY, 6); XCTAssertEqual(state.opacity, 0.82)
        XCTAssertFalse(state.prepare(key: scene, allowed: true) { _ in consumed += 1; return true })
        XCTAssertTrue(state.begin(key: scene)); XCTAssertEqual(state.phase, .running)
        XCTAssertEqual(state.offsetY, 0); XCTAssertEqual(state.opacity, 1)
        XCTAssertFalse(state.begin(key: scene))
        XCTAssertTrue(state.finish(key: scene)); XCTAssertEqual(state.phase, .settled)
        XCTAssertFalse(state.finish(key: scene))
        XCTAssertFalse(state.prepare(key: scene, allowed: true) { _ in consumed += 1; return true })
        XCTAssertEqual(consumed, 1)
        XCTAssertGreaterThan(QuizSceneMotionState.duration, 0)
        XCTAssertLessThanOrEqual(QuizSceneMotionState.duration, 0.45)
        XCTAssertEqual(QuizSceneMotionState.durationMilliseconds, 360)
    }

    func testStaleCompletionsCannotSettleANewerScene() throws {
        let first = try key(1), second = try key(2)
        var state = QuizSceneMotionState()
        XCTAssertTrue(state.prepare(key: first, allowed: true) { _ in true }); XCTAssertTrue(state.begin(key: first))
        XCTAssertTrue(state.prepare(key: second, allowed: true) { _ in true }); XCTAssertTrue(state.begin(key: second))
        XCTAssertFalse(state.begin(key: first)); XCTAssertFalse(state.finish(key: first))
        XCTAssertEqual(state.phase, .running); XCTAssertEqual(state.keyDigest, second.digest)
        XCTAssertTrue(state.finish(key: second))
    }

    func testReducedFirstAppearanceIsConsumedAcrossReloadAndDoesNotAnimateLater() throws {
        let scene = try key(1), storage = MemoryQuizSceneStore()
        let ledger = QuizSceneMotionLedger(storage: storage)
        var state = QuizSceneMotionState()
        XCTAssertFalse(state.prepare(key: scene, allowed: false, consume: ledger.consume))
        XCTAssertEqual(state.phase, .settled); XCTAssertEqual(state.offsetY, 0); XCTAssertEqual(state.opacity, 1)
        state.reduceMotionChanged(false)
        XCTAssertFalse(state.prepare(key: scene, allowed: true, consume: ledger.consume))
        var reloaded = QuizSceneMotionState()
        let reloadedLedger = QuizSceneMotionLedger(storage: storage)
        XCTAssertFalse(reloaded.prepare(key: scene, allowed: true, consume: reloadedLedger.consume))
        XCTAssertEqual(reloaded.phase, .settled)
    }

    func testReducedMotionCancelsAnActiveEntranceWithoutRestartingIt() throws {
        let scene = try key(1)
        var state = QuizSceneMotionState()
        XCTAssertTrue(state.prepare(key: scene, allowed: true) { _ in true }); XCTAssertTrue(state.begin(key: scene))
        state.reduceMotionChanged(true)
        XCTAssertEqual(state.phase, .settled); XCTAssertEqual(state.offsetY, 0); XCTAssertEqual(state.opacity, 1)
        XCTAssertFalse(state.finish(key: scene))
        state.reduceMotionChanged(false)
        XCTAssertFalse(state.prepare(key: scene, allowed: true) { _ in XCTFail("Consumed scene must not be retried"); return true })
    }

    func testDisappearanceCancellationCannotReplayAndPersistenceFailureIsStatic() throws {
        let scene = try key(1)
        var state = QuizSceneMotionState()
        XCTAssertTrue(state.prepare(key: scene, allowed: true) { _ in true })
        state.cancel()
        XCTAssertFalse(state.begin(key: scene)); XCTAssertFalse(state.prepare(key: scene, allowed: true) { _ in true })
        var failed = QuizSceneMotionState()
        XCTAssertFalse(failed.prepare(key: scene, allowed: true) { _ in false })
        XCTAssertEqual(failed.phase, .settled); XCTAssertEqual(failed.offsetY, 0); XCTAssertEqual(failed.opacity, 1)
    }

    func testPolicyRequiresExplicitTestingOptInAndAlwaysHonorsReduction() {
        for system in [false, true] {
            for local in [false, true] {
                for testing in [false, true] {
                    for optIn in [false, true] {
                        XCTAssertEqual(QuizSceneMotionPolicy.allowsMotion(systemReduceMotion: system, qaReducedMotion: local, testing: testing, qaOptIn: optIn),
                                       !system && !local && (!testing || optIn))
                    }
                }
            }
        }
    }

    func testUserDefaultsAdapterRetainsOnlyHashesInAnOwnedTestSuite() throws {
        let suite = "studio.likerts.quiz-scene-motion.unit." + UUID().uuidString.lowercased()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsQuizSceneMotionStore(defaults: defaults, key: "owned-test-record")
        let scene = try key(7)
        XCTAssertTrue(QuizSceneMotionLedger(storage: store).consume(scene))
        let reloaded = UserDefaultsQuizSceneMotionStore(defaults: try XCTUnwrap(UserDefaults(suiteName: suite)), key: "owned-test-record")
        XCTAssertFalse(QuizSceneMotionLedger(storage: reloaded).consume(scene))
        XCTAssertFalse(String(decoding: try XCTUnwrap(reloaded.read()), as: UTF8.self).contains(identifier(7)))
    }
}

@MainActor private final class MemoryQuizSceneStore: QuizSceneMotionStoring {
    var data: Data?
    var failRead = false
    var failWrite = false
    var dropWrites = false
    var writes = 0
    private enum Failure: Error { case simulated }
    func read() throws -> Data? { if failRead { throw Failure.simulated }; return data }
    func write(_ value: Data) throws {
        if failWrite { throw Failure.simulated }
        writes += 1
        if !dropWrites { data = value }
    }
}
