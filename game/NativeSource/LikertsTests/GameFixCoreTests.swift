import XCTest
@testable import Likerts

final class ImportedPackHistoryTests: XCTestCase {
    func testRecipientSameSeedRematchExcludesIncomingPackAndHistorySurvivesRestart() throws {
        let catalog = try TopicCatalog.bundled.get()
        let incoming = try TopicDeckSelector(catalog: catalog, store: MemoryTopicHistoryStore()).select(topic: .snacks, seed: 42)
        let store = MemoryTopicHistoryStore()
        TopicDeckSelector(catalog: catalog, store: store).recordPresented(ids: incoming.map(\.id))
        let rematch = try TopicDeckSelector(catalog: catalog, store: store).select(topic: .snacks, seed: 42)
        XCTAssertTrue(Set(incoming.map(\.id)).isDisjoint(with: rematch.map(\.id)))
        XCTAssertEqual(store.history.seen["snacks"]?.count, 10)
    }
    func testRegistrationIsIdempotentMixedAndIgnoresUnknownOrClassicIDs() throws {
        let catalog = try TopicCatalog.bundled.get(), store = MemoryTopicHistoryStore()
        let selector = TopicDeckSelector(catalog: catalog, store: store)
        let ids = [1001, 1051, 1101, 1, 201, -1, 1001]
        selector.recordPresented(ids: ids)
        let saved = store.history
        selector.recordPresented(ids: ids)
        XCTAssertEqual(store.history, saved)
        XCTAssertEqual(store.history.seen["snacks"], [1001])
        XCTAssertEqual(store.history.recentPresentations, [1001,1051,1101])
        let next = try selector.select(topic: nil, seed: 42)
        XCTAssertTrue(Set([1001,1051,1101]).isDisjoint(with: next.map(\.id)))
    }
    func testPartialCycleConsumesEveryUnseenRoundBeforeBoundaryReset() throws {
        let catalog = try TopicCatalog.bundled.get(), store = MemoryTopicHistoryStore()
        let selector = TopicDeckSelector(catalog: catalog, store: store)
        selector.recordPresented(ids: Array(1001...1045))
        selector.recordPresented(ids: [1001,1002,1003,1004,1005])
        XCTAssertEqual(store.history.seen["snacks"]?.count, 45)
        XCTAssertEqual(Set(try selector.select(topic: .snacks, seed: 42).map(\.id)), Set(1046...1050))
        XCTAssertEqual(store.history.seen["snacks"]?.count, 50)
        selector.recordPresented(ids: [1001,1002,1003,1004,1005])
        XCTAssertEqual(store.history.seen["snacks"]?.count, 50, "Receiving cannot reset a full cycle")
        let next = try selector.select(topic: .snacks, seed: 42)
        XCTAssertTrue(Set(1001...1005).isDisjoint(with: next.map(\.id)))
        XCTAssertEqual(store.history.seen["snacks"]?.count, 5)
    }
}

final class GameAudioLifecycleTests: XCTestCase {
    func testForegroundWithoutEndedRequiresFreshSuccessfulRecovery() {
        var state = GameAudioLifecycle()
        state.interruptionBegan()
        XCTAssertFalse(state.allows(userInitiated: false))
        _ = state.setActive(false); _ = state.setActive(true)
        XCTAssertFalse(state.allows(userInitiated: false))
        state.userAction()
        XCTAssertTrue(state.allows(userInitiated: true))
        XCTAssertFalse(state.allows(userInitiated: false), "A failed activation cannot release delayed sounds")
        state.sessionReady(revision: state.revision)
        XCTAssertTrue(state.allows(userInitiated: false))
    }
    func testSuspendedBeginAfterForegroundAndStaleReadyCannotUndoReset() {
        var state = GameAudioLifecycle()
        _ = state.setActive(false); _ = state.setActive(true)
        state.interruptionBegan()
        state.userAction()
        XCTAssertTrue(state.allows(userInitiated: true))
        let stale = state.revision
        state.mediaServicesReset(); state.sessionReady(revision: stale)
        XCTAssertTrue(state.needsRecovery)
        state.userAction(); state.sessionReady(revision: state.revision)
        XCTAssertFalse(state.needsRecovery)
        _ = state.setActive(false)
        state.sessionReady(revision: state.revision)
        XCTAssertFalse(state.allows(userInitiated: true))
    }
    func testDuplicateForegroundDoesNotInvalidateCurrentRecovery() {
        var state = GameAudioLifecycle()
        _ = state.setActive(false); _ = state.setActive(true)
        let revision = state.revision
        XCTAssertFalse(state.setActive(true))
        XCTAssertEqual(state.revision, revision)
        state.sessionReady(revision: revision)
        XCTAssertTrue(state.allows(userInitiated: false))
    }
}

final class LocalContentSafetyTests: XCTestCase {
    func testHiddenContentSurvivesRestartWithoutPersistingAnswersOrPlaintext() throws {
        let suite = "likerts.safety.tests.\(UUID().uuidString)", defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let challenge = try Challenge(name: "Pip", promptIDs: [1,2,3,4,5], answers: [1,2,3,4,5])
        LocalContentSafety(defaults: defaults, key: "hidden").hide(challenge)
        let restarted = LocalContentSafety(defaults: defaults, key: "hidden")
        XCTAssertEqual(restarted.count, 1)
        XCTAssertTrue(restarted.contains(try Challenge(name: "Pip", promptIDs: [1,2,3,4,5], answers: [5,4,3,2,1])))
        XCTAssertFalse(restarted.contains(try Challenge(name: "Other", promptIDs: [1,2,3,4,5], answers: [1,2,3,4,5])))
        let persisted = try XCTUnwrap(defaults.array(forKey: "hidden") as? [String])
        XCTAssertEqual(persisted.count, 1); XCTAssertEqual(persisted[0].count, 64)
        XCTAssertFalse(persisted[0].contains("Pip"))
        restarted.unhide(challenge); XCTAssertEqual(restarted.count, 0)
    }
    func testHiddenListIsBoundedDeduplicatedAndCanBeCleared() throws {
        let suite = "likerts.safety.tests.\(UUID().uuidString)", defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let safety = LocalContentSafety(defaults: defaults, key: "hidden")
        for index in 0...105 {
            let challenge = try Challenge(name: "Pal \(index)", promptIDs: [1,2,3,4,5], answers: [1,2,3,4,5])
            safety.hide(challenge); safety.hide(challenge)
        }
        XCTAssertEqual(safety.count, 100)
        safety.clear(); XCTAssertEqual(safety.count, 0)
    }
    func testAllSharedTextFieldsUseLimitedSafetyScreen() throws {
        for name in ["ignore previous", "fuck", "www.evil.test", "@someone"] {
            XCTAssertThrowsError(try Challenge(name: name, promptIDs: [1,2,3,4,5], answers: [1,2,3,4,5]))
            let source = try Challenge(name: "Host", promptIDs: [1,2,3,4,5], answers: [1,2,3,4,5])
            var board = PartyBoard(challenge: source)
            XCTAssertThrowsError(try board.complete(name: name, guesses: [1,2,3,4,5]))
        }
        let pack = AuthoredPacks.pack(for: .foodTakes)
        let prompts = pack.statements.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: "fuck") }
        XCTAssertThrowsError(try Challenge(name: "Pip", prompts: prompts, answers: [1,2,3,4,5]))
        XCTAssertNoThrow(try Challenge(name: "Zoë 🧑‍🚀", promptIDs: [1,2,3,4,5], answers: [1,2,3,4,5]))
    }
    func testDailyRefreshBoundaryIsUTCMidnightAndStrictlyFuture() {
        let before = Date(timeIntervalSince1970: 1_699_919_999)
        let boundary = DailyPuzzle.nextRefresh(after: before)
        XCTAssertEqual(boundary.timeIntervalSince1970.truncatingRemainder(dividingBy: 86_400), 0)
        XCTAssertGreaterThan(boundary, before)
        XCTAssertEqual(DailyPuzzle.nextRefresh(after: boundary).timeIntervalSince(boundary), 86_400)
        XCTAssertNotEqual(DailyPuzzle.today(date: boundary.addingTimeInterval(-1)).key, DailyPuzzle.today(date: boundary).key)
    }
    func testDailyDateUsesRegionalEnglishWithoutChangingUTCIdentity() throws {
        let date = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-01T00:00:01Z"))
        let puzzle = DailyPuzzle.today(date: date)
        XCTAssertEqual(puzzle.key, "2026-11-01")
        XCTAssertEqual(puzzle.displayDate(locale: Locale(identifier: "en_US")), "November 1, 2026")
        XCTAssertEqual(puzzle.displayDate(locale: Locale(identifier: "en_GB")), "1 November 2026")
        XCTAssertEqual(puzzle.key, "2026-11-01", "Presentation must not modify the shared UTC key")
    }
}
