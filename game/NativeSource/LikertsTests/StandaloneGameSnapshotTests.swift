import XCTest
@testable import Likerts

final class StandaloneGameSnapshotTests: XCTestCase {
    private let prompts = Array(PromptBank.all.prefix(5))
    private func answering() -> StandaloneGameSnapshot {
        StandaloneGameSnapshot(phase: "answering", name: "Alex", prompts: prompts, packTheme: nil, packSource: nil,
                               topic: nil, dailyKey: nil, challengeCode: nil, answers: [4, 2, nil, nil, nil],
                               guesses: Array(repeating: nil, count: 5), index: 2, revealed: false)
    }
    private func sealed() throws -> StandaloneGameSnapshot {
        let challenge = try Challenge(name: "Alex", promptIDs: prompts.map(\.id), answers: [4, 2, 1, 3, 5])
        var snapshot = answering(); snapshot.phase = "sealed"; snapshot.index = 0
        snapshot.answers = challenge.answers.map(Optional.some); snapshot.challengeCode = ChallengeCodec.encode(challenge)
        return snapshot
    }
    func testAnswerBackAndSealedRoundTripPreserveExactGame() throws {
        var answer = answering(); answer.index = 1 // Later answered takes remain when navigating back.
        let decoded = try JSONDecoder().decode(StandaloneGameSnapshot.self, from: JSONEncoder().encode(answer))
        XCTAssertEqual(decoded, answer); XCTAssertNoThrow(try decoded.validate())
        let snapshot = try sealed(); let checked = try snapshot.validate()
        XCTAssertEqual(checked.challenge?.answers, [4, 2, 1, 3, 5])
        XCTAssertEqual(snapshot.guesses, Array(repeating: nil, count: 5))
    }
    func testGuessRevealAndResultValidation() throws {
        var s = try sealed(); s.phase = "guessing"; s.index = 2
        s.guesses = [4, 2, 1, nil, nil]; s.revealed = false
        XCTAssertNoThrow(try s.validate())
        s.revealed = true; XCTAssertNoThrow(try s.validate())
        s.guesses[2] = nil; XCTAssertThrowsError(try s.validate())
        s.guesses = [4, 2, 1, 3, 5]; s.index = 4; s.phase = "result"; s.revealed = true
        XCTAssertNoThrow(try s.validate())
        s.guesses[4] = nil; XCTAssertThrowsError(try s.validate())
    }
    func testRejectsCorruptOutOfRangeFutureAndWrongQuestionPayloads() throws {
        var s = answering(); s.version = 99; XCTAssertThrowsError(try s.validate())
        s = answering(); s.index = 5; XCTAssertThrowsError(try s.validate())
        s = answering(); s.answers[0] = 7; XCTAssertThrowsError(try s.validate())
        s = answering(); s.answers = [nil]; XCTAssertThrowsError(try s.validate())
        s = answering(); s.revealed = true; XCTAssertThrowsError(try s.validate())
        s = try sealed(); s.guesses[0] = 1; XCTAssertThrowsError(try s.validate())
        s = try sealed(); s.challengeCode = "LK1-broken"; XCTAssertThrowsError(try s.validate())
        s = answering(); s.prompts[0] = Prompt(id: 1, text: "Altered", emoji: "📵"); XCTAssertThrowsError(try s.validate())
        XCTAssertThrowsError(try JSONDecoder().decode(StandaloneGameSnapshot.self, from: Data("{broken".utf8)))
    }
    func testDailyDateAndCharacterMustMatchOriginalChallenge() throws {
        let puzzle = DailyPuzzle.today(date: Date(timeIntervalSince1970: 1_700_000_000))
        let challenge = puzzle.challenge
        var s = StandaloneGameSnapshot(phase: "dailyIntro", name: challenge.name, prompts: challenge.resolvedPrompts,
            packTheme: nil, packSource: nil, topic: nil, dailyKey: puzzle.key, challengeCode: ChallengeCodec.encode(challenge),
            answers: Array(repeating: nil, count: 5), guesses: Array(repeating: nil, count: 5), index: 0, revealed: false)
        XCTAssertEqual(try s.validate().daily?.key, puzzle.key)
        s.dailyKey = "2025-02-30"; XCTAssertThrowsError(try s.validate())
        s.dailyKey = "2025-01-01"; XCTAssertThrowsError(try s.validate())
    }
    func testOlderRestoredDailyDoesNotReplaceNewerBest() {
        let resumed = DailyBest.updating(savedDate: "2026-11-01", savedScore: 80, puzzleDate: "2026-10-31", score: 100)
        XCTAssertEqual(resumed.date, "2026-11-01"); XCTAssertEqual(resumed.score, 80)
        let same = DailyBest.updating(savedDate: "2026-10-31", savedScore: 60, puzzleDate: "2026-10-31", score: 80)
        XCTAssertEqual(same.score, 80)
        let fresh = DailyBest.updating(savedDate: "2026-10-31", savedScore: 100, puzzleDate: "2026-11-01", score: 40)
        XCTAssertEqual(fresh.date, "2026-11-01"); XCTAssertEqual(fresh.score, 40)
    }
    func testCustomPackAndImportedChallengeRetainSourceAndContent() throws {
        let pack = AuthoredPacks.pack(for: .foodTakes)
        let prompts = pack.statements.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: pack.theme.emoji) }
        var s = StandaloneGameSnapshot(phase: "answering", name: "Alex", prompts: prompts,
            packTheme: pack.theme.rawValue, packSource: "authored", topic: nil, dailyKey: nil, challengeCode: nil,
            answers: Array(repeating: nil, count: 5), guesses: Array(repeating: nil, count: 5), index: 0, revealed: false)
        XCTAssertEqual(try s.validate().pack, pack)
        let challenge = try Challenge(name: "Alex", prompts: prompts, answers: [1, 2, 3, 4, 5])
        s.phase = "guessing"; s.packTheme = nil; s.packSource = nil; s.challengeCode = ChallengeCodec.encode(challenge)
        XCTAssertTrue(try XCTUnwrap(s.validate().challenge).isCustom)
        s.prompts[0] = Prompt(id: 201, text: "I would give out my password.", emoji: pack.theme.emoji)
        XCTAssertThrowsError(try s.validate())
    }
}
