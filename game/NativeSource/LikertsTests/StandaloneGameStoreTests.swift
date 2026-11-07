#if canImport(UIKit)
import XCTest
@testable import Likerts

@MainActor final class StandaloneGameStoreTests: XCTestCase {
    private func snapshot() -> StandaloneGameSnapshot {
        StandaloneGameSnapshot(phase: "answering", name: "Alex", prompts: Array(PromptBank.all.prefix(5)),
            packTheme: nil, packSource: nil, topic: nil, dailyKey: nil, challengeCode: nil,
            answers: [4, nil, nil, nil, nil], guesses: Array(repeating: nil, count: 5), index: 0, revealed: false)
    }
    private func fixture() throws -> (URL, UserDefaults, String) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let suite = "studio.likerts.test.\(UUID().uuidString)"
        return (directory.appendingPathComponent("game.json"), try XCTUnwrap(UserDefaults(suiteName: suite)), suite)
    }
    func testSaveReloadAndLeaveEraseTheSnapshot() throws {
        let (url, defaults, suite) = try fixture(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()); defaults.removePersistentDomain(forName: suite) }
        let store = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
        XCTAssertTrue(store.save(snapshot())); XCTAssertEqual(store.load(), snapshot())
        XCTAssertTrue(store.clear()); XCTAssertNil(store.load()); XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        let restarted = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
        XCTAssertNil(restarted.load()); XCTAssertFalse(restarted.hasSavedData)
    }
    func testMixedClassicAndTopicImportPersistsEveryGuessRevealAndResult() throws {
        let (url, defaults, suite) = try fixture()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()); defaults.removePersistentDomain(forName: suite) }
        let original = try Challenge(name: "Alex", promptIDs: [1001, 1, 2, 3, 4], answers: [1, 2, 3, 4, 5])
        let code = ChallengeCodec.encode(original)
        XCTAssertTrue(code.hasPrefix("LK3-"))
        let imported = try ChallengeCodec.decode(code)
        var game = GameSession(challenge: imported)

        func reload(_ current: GameSession) throws -> GameSession {
            let store = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
            XCTAssertTrue(store.save(current.snapshot), "An accepted imported challenge must be resumable")
            XCTAssertFalse(store.saveFailed)
            let reopened = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
            let saved = try XCTUnwrap(reopened.load())
            XCTAssertEqual(saved, current.snapshot)
            let restored = try XCTUnwrap(GameSession(snapshot: saved))
            XCTAssertEqual(restored.challenge, original)
            XCTAssertEqual(restored.prompts, original.resolvedPrompts)
            XCTAssertEqual(restored.prompts.map(\.id), [1001, 1, 2, 3, 4])
            XCTAssertNil(restored.topic, "Classic questions cannot be assigned a curated topic")
            XCTAssertNil(restored.pack); XCTAssertNil(restored.daily)
            XCTAssertEqual(restored.answerChoices, Array(repeating: nil, count: 5), "Imported host answers stay in the sealed challenge")
            return restored
        }

        game = try reload(game)
        XCTAssertEqual(game.phase, .guessing); XCTAssertFalse(game.revealed)
        for (index, guess) in [2, 2, 3, 4, 5].enumerated() {
            XCTAssertEqual(game.index, index); XCTAssertFalse(game.revealed)
            let store = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
            game.onSnapshot = { _ = store.save($0) }
            game.select(guess)
            XCTAssertEqual(try XCTUnwrap(store.load()), game.snapshot, "Selection changes must invoke persistence")
            game = try reload(game)
            XCTAssertEqual(game.selection, guess); XCTAssertFalse(game.revealed, "A restored selection is not a reveal")
            game.next()
            game = try reload(game)
            XCTAssertTrue(game.revealed)
            XCTAssertEqual(game.correctAnswer, original.answers[index])
            XCTAssertEqual(game.roundPoints, index == 0 ? 75 : 100)
            game.next()
            game = try reload(game)
        }
        XCTAssertEqual(game.phase, .result)
        XCTAssertEqual(game.score, 95); XCTAssertEqual(game.exactCount, 4)
        let store = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
        XCTAssertTrue(store.clear())
        XCTAssertNil(StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared").load())
    }
    func testImportedTopicInferencePreservesClassicCustomDailyAndTopicPacks() throws {
        let cases: [([Int], TopicID?)] = [
            ([1001, 1002, 1003, 1004, 1005], .snacks),
            ([1001, 1, 2, 3, 4], nil),
            ([1, 1001, 1002, 1003, 1004], nil),
            ([1001, 1051, 1101, 1151, 1201], nil),
            ([1, 2, 3, 4, 5], nil)
        ]
        for (ids, expectedTopic) in cases {
            let challenge = try Challenge(name: "Alex", promptIDs: ids, answers: [1, 2, 3, 4, 5])
            let game = GameSession(challenge: try ChallengeCodec.decode(ChallengeCodec.encode(challenge)))
            XCTAssertEqual(game.topic, expectedTopic, "\(ids)")
            XCTAssertNoThrow(try game.snapshot.validate(), "\(ids)")
        }
        let mixed = try Challenge(name: "Alex", promptIDs: [1001, 1, 2, 3, 4], answers: [1, 2, 3, 4, 5])
        var incorrectlyTagged = GameSession(challenge: mixed).snapshot
        incorrectlyTagged.topic = TopicID.snacks.rawValue
        XCTAssertThrowsError(try incorrectlyTagged.validate(), "Strict topic membership validation must remain intact")

        let pack = AuthoredPacks.pack(for: .foodTakes)
        let customPrompts = pack.statements.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: pack.theme.emoji) }
        let custom = try Challenge(name: "Alex", prompts: customPrompts, answers: [1, 2, 3, 4, 5])
        let customGame = GameSession(challenge: try ChallengeCodec.decode(ChallengeCodec.encode(custom)))
        XCTAssertNil(customGame.topic); XCTAssertEqual(customGame.prompts, customPrompts)
        XCTAssertNoThrow(try customGame.snapshot.validate())

        let daily = DailyPuzzle.today(date: Date(timeIntervalSince1970: 1_700_000_000))
        let dailyGame = GameSession(challenge: daily.challenge, daily: daily)
        XCTAssertNil(dailyGame.topic); XCTAssertEqual(dailyGame.phase, .dailyIntro)
        XCTAssertEqual(try dailyGame.snapshot.validate().daily?.key, daily.key)
        dailyGame.beginGuessing()
        XCTAssertEqual(try dailyGame.snapshot.validate().daily?.key, daily.key)
    }
    func testFailedDeletionWarnsAndDoesNotRestoreAbandonedGame() throws {
        let (url, defaults, suite) = try fixture(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()); defaults.removePersistentDomain(forName: suite) }
        struct RemovalFailure: Error {}
        let store = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared", removeFile: { _ in throw RemovalFailure() })
        XCTAssertTrue(store.save(snapshot())); XCTAssertFalse(store.clear()); XCTAssertTrue(store.clearFailed)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path), "Failure must not pretend the file was deleted")
        let restarted = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
        XCTAssertNil(restarted.load()); XCTAssertFalse(restarted.hasSavedData)
        XCTAssertTrue(restarted.save(snapshot())); XCTAssertEqual(restarted.load(), snapshot())
    }
    func testFailedReplacementCannotResurrectPreviousGame() throws {
        let (url, defaults, suite) = try fixture(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()); defaults.removePersistentDomain(forName: suite) }
        let original = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
        XCTAssertTrue(original.save(snapshot())); XCTAssertNotNil(original.load())
        struct WriteFailure: Error {}
        let broken = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared", writeFile: { _, _ in throw WriteFailure() })
        var replacement = snapshot(); replacement.name = "Bea"
        XCTAssertFalse(broken.save(replacement)); XCTAssertTrue(broken.saveFailed)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path), "The old file may physically remain")
        let restarted = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
        XCTAssertNil(restarted.load(), "A failed replacement must never reopen the prior game")
        XCTAssertTrue(restarted.save(replacement)); XCTAssertEqual(restarted.load(), replacement)
    }
    /// Store cost only: this does not establish frame smoothness or real-device latency.
    func testRecordSynchronousSaveDurations() throws {
        let base = try XCTUnwrap(FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first)
        let directory = base.appendingPathComponent("Likerts-save-timing-\(UUID().uuidString)", isDirectory: true)
        let suite = "studio.likerts.test.timing.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { try? FileManager.default.removeItem(at: directory); defaults.removePersistentDomain(forName: suite) }
        let store = StandaloneGameStore(fileURL: directory.appendingPathComponent("game.json"), defaults: defaults, tombstoneKey: "cleared")
        let catalog = try TopicCatalog.bundled.get()
        let prompts = try (1001...1005).map { try XCTUnwrap(catalog.round(id: $0)?.prompt) }
        let challenge = try Challenge(name: "Alex", promptIDs: prompts.map(\.id), answers: [1,2,3,4,5])
        var state = StandaloneGameSnapshot(phase: "guessing", name: challenge.name, prompts: prompts,
            packTheme: nil, packSource: nil, topic: "snacks", dailyKey: nil, challengeCode: ChallengeCodec.encode(challenge),
            answers: challenge.answers.map(Optional.some), guesses: [1, nil, nil, nil, nil], index: 0, revealed: false)
        XCTAssertTrue(store.save(state)) // warm the catalog and directory, as in a continuing game
        var timings: [Double] = []
        for index in 0..<30 {
            state.guesses[0] = index.isMultiple(of: 2) ? 1 : 2
            let start = ProcessInfo.processInfo.systemUptime
            XCTAssertTrue(store.save(state))
            timings.append((ProcessInfo.processInfo.systemUptime - start) * 1000)
        }
        let sorted = timings.sorted()
        let overFrame = sorted.filter { $0 > 16.67 }.count
        let report = String(format: "30 synchronous app-support saves (ms): min %.3f, median %.3f, p95 %.3f, max %.3f; %d exceeded 16.67 ms, one 60 Hz frame budget. Simulator only; not end-to-end input, frame-hitch, or device latency.", sorted.first!, sorted[sorted.count / 2], sorted[28], sorted.last!, overFrame)
        let attachment = XCTAttachment(string: report); attachment.name = "standalone-save-timing"; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testOversizeAndMalformedFilesNeverRestore() throws {
        let (url, defaults, suite) = try fixture(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()); defaults.removePersistentDomain(forName: suite) }
        let store = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
        try Data(repeating: 65, count: 16_385).write(to: url)
        XCTAssertNil(store.load()); XCTAssertTrue(store.hasSavedData)
        try Data("{broken".utf8).write(to: url); XCTAssertNil(store.load())
    }
}
#endif
