import Foundation
import XCTest
@testable import Likerts

final class PartyBoardTests: XCTestCase {
    private func challenge() throws -> Challenge {
        try Challenge(name: "Host", promptIDs: [1, 2, 3, 4, 5], answers: [1, 2, 3, 4, 5])
    }

    private func customChallenge() throws -> Challenge {
        let pack = AuthoredPacks.pack(for: .foodTakes)
        let prompts = pack.statements.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: pack.theme.emoji) }
        return try Challenge(name: "Host", prompts: prompts, answers: [1, 2, 3, 4, 5])
    }

    func testEmptyAndSinglePlayerBoardUseOnlyCompletedGuesses() throws {
        let source = try challenge()
        var board = PartyBoard(challenge: source)
        XCTAssertTrue(board.runs.isEmpty)
        XCTAssertTrue(board.standings.isEmpty)
        let run = try board.complete(name: "  Sam  ", guesses: source.answers)
        XCTAssertEqual(run.name, "Sam")
        XCTAssertEqual(run.displayName, "Sam")
        XCTAssertEqual(run.score, 100)
        XCTAssertEqual(run.exactCount, 5)
        XCTAssertEqual(run.attemptCount, 1)
        XCTAssertTrue(run.insight.allMatched)
        XCTAssertEqual(board.standings.map(\.rank), [1])
        XCTAssertFalse(try XCTUnwrap(board.standings.first).isTied)
        XCTAssertEqual(board.challenge, source)
    }

    func testCompetitionTiesHaveRanksOneOneThreeAndStableEnrollmentOrder() throws {
        var board = PartyBoard(challenge: try challenge())
        let first = try board.complete(name: "First", guesses: [1, 2, 3, 4, 5])
        let second = try board.complete(name: "Second", guesses: [1, 2, 3, 4, 5])
        let third = try board.complete(name: "Third", guesses: [2, 3, 4, 5, 4])
        XCTAssertEqual(board.standings.map(\.rank), [1, 1, 3])
        XCTAssertEqual(board.standings.map(\.run.id), [first.id, second.id, third.id])
        XCTAssertEqual(board.standings.map(\.isTied), [true, true, false])
        XCTAssertEqual(board.standings.map(\.run.score), [100, 100, 75])
    }

    func testStandingsSortByActualScoreRatherThanEnrollment() throws {
        var board = PartyBoard(challenge: try challenge())
        let lower = try board.complete(name: "Lower", guesses: [1, 1, 1, 1, 1])
        let higher = try board.complete(name: "Higher", guesses: [1, 2, 3, 4, 5])
        XCTAssertEqual(lower.score, 50)
        XCTAssertEqual(higher.score, 100)
        XCTAssertEqual(board.runs.map(\.id), [lower.id, higher.id])
        XCTAssertEqual(board.standings.map(\.run.id), [higher.id, lower.id])
        XCTAssertEqual(board.standings.map(\.rank), [1, 2])
    }

    func testDuplicateNamesAreCaseInsensitiveAndRemainDistinctAcrossReplay() throws {
        var board = PartyBoard(challenge: try challenge())
        let first = try board.complete(name: "Sam", guesses: [1, 2, 3, 4, 5])
        let second = try board.complete(name: "  sam\n ", guesses: [1, 1, 1, 1, 1])
        let third = try board.complete(name: "SAM", guesses: [1, 1, 1, 1, 1])
        XCTAssertEqual(board.runs.map(\.displayName), ["Sam", "sam · 2", "SAM · 3"])
        let replayed = try board.complete(name: "A different name", guesses: [1, 2, 3, 4, 5], replacing: second.id)
        XCTAssertEqual(replayed.id, second.id)
        XCTAssertEqual(replayed.name, second.name)
        XCTAssertEqual(replayed.displayName, second.displayName)
        XCTAssertEqual(replayed.attemptCount, 2)
        XCTAssertEqual(board.runs.map(\.id), [first.id, second.id, third.id])
        XCTAssertEqual(board.standings.map(\.run.id), [first.id, second.id, third.id])
    }

    func testLiteralSuffixNamesCannotCollideWithGeneratedDisplayNames() throws {
        var board = PartyBoard(challenge: try challenge())
        try board.complete(name: "Sam · 2", guesses: [1, 1, 1, 1, 1])
        try board.complete(name: "Sam", guesses: [1, 1, 1, 1, 1])
        try board.complete(name: "SAM", guesses: [1, 1, 1, 1, 1])
        XCTAssertEqual(board.runs.map(\.displayName), ["Sam · 2", "Sam", "SAM · 3"])
        XCTAssertEqual(Set(board.runs.map { $0.displayName.lowercased() }).count, 3)
    }

    func testNameValidationCanRunBeforePlayWithoutCreatingAResult() throws {
        var board = PartyBoard(challenge: try challenge())
        XCTAssertEqual(try board.validatedName(" \n "), "Friend 1")
        XCTAssertEqual(try board.validatedName("  Jo\n the\t Brave  "), "Jo the Brave")
        XCTAssertEqual(try board.validatedName("🧑🏽‍🚀 Jo"), "🧑🏽‍🚀 Jo")
        XCTAssertTrue(board.runs.isEmpty)
        try board.complete(name: "Ivy", guesses: [1, 1, 1, 1, 1])
        XCTAssertEqual(try board.validatedName(""), "Friend 2")
        let blank = try board.complete(name: "", guesses: [1, 1, 1, 1, 1])
        XCTAssertEqual(blank.name, "Friend 2")
        XCTAssertEqual(blank.displayName, "Friend 2")
    }

    func testNamesEnforceCharacterByteAndControlLimitsWithoutPartialMutation() throws {
        var board = PartyBoard(challenge: try challenge())
        XCTAssertEqual(try board.validatedName(String(repeating: "a", count: 20)).count, 20)
        XCTAssertEqual(try board.validatedName(String(repeating: "🐉", count: 20)).utf8.count, 80)
        try board.complete(name: "Jo", guesses: [1, 1, 1, 1, 1])
        let original = board
        for name in [String(repeating: "a", count: 21), String(repeating: "🧑🏽‍🚀", count: 6), "Jo\0", "Jo\u{7F}", "Jo\u{200E}"] {
            XCTAssertThrowsError(try board.validatedName(name))
            XCTAssertThrowsError(try board.complete(name: name, guesses: [1, 1, 1, 1, 1]))
            XCTAssertEqual(board, original)
        }
    }

    func testReplayReplacesLatestScoreAndAttemptsInsteadOfAccumulatingPlayers() throws {
        var board = PartyBoard(challenge: try challenge())
        let first = try board.complete(name: "Sam", guesses: [1, 2, 3, 4, 5])
        let second = try board.complete(name: "Jo", guesses: [2, 3, 4, 5, 4])
        let updated = try board.complete(name: "Sam", guesses: [1, 1, 1, 1, 1], replacing: first.id)
        XCTAssertEqual(updated.id, first.id)
        XCTAssertEqual(updated.score, 50)
        XCTAssertEqual(updated.exactCount, 1)
        XCTAssertEqual(updated.attemptCount, 2)
        XCTAssertEqual(updated.guesses, [1, 1, 1, 1, 1])
        XCTAssertEqual(board.runs.count, 2)
        XCTAssertEqual(board.standings.map(\.run.id), [second.id, first.id])
    }

    func testFailedOrUnknownReplayDoesNotChangeCompletedRuns() throws {
        var board = PartyBoard(challenge: try challenge())
        let run = try board.complete(name: "Sam", guesses: [1, 2, 3, 4, 5])
        let original = board
        for guesses in [[], [1, 2, 3, 4], [1, 2, 3, 4, 5, 1], [0, 2, 3, 4, 5], [1, 2, 3, 4, 6], [Int.min, 2, 3, 4, Int.max]] {
            XCTAssertThrowsError(try board.complete(name: "Sam", guesses: guesses, replacing: run.id))
            XCTAssertEqual(board, original)
            XCTAssertThrowsError(try board.complete(name: "New", guesses: guesses))
            XCTAssertEqual(board, original)
        }
        XCTAssertThrowsError(try board.complete(name: "Sam", guesses: [1, 1, 1, 1, 1], replacing: UUID())) { error in
            XCTAssertEqual(error as? PartyBoardError, .unknownRun)
        }
        XCTAssertEqual(board, original)
    }

    func testTwelvePlayerLimitStillPermitsReplay() throws {
        var board = PartyBoard(challenge: try challenge())
        for _ in 0..<PartyBoard.maximumPlayers {
            try board.complete(name: "", guesses: [1, 2, 3, 4, 5])
        }
        XCTAssertEqual(board.runs.count, 12)
        XCTAssertEqual(board.runs.last?.name, "Friend 12")
        let first = try XCTUnwrap(board.runs.first)
        let original = board
        XCTAssertThrowsError(try board.complete(name: "Extra", guesses: [1, 2, 3, 4, 5])) { error in
            XCTAssertEqual(error as? PartyBoardError, .playerLimit)
        }
        XCTAssertEqual(board, original)
        let replayed = try board.complete(name: first.name, guesses: [1, 1, 1, 1, 1], replacing: first.id)
        XCTAssertEqual(replayed.attemptCount, 2)
        XCTAssertEqual(board.runs.count, 12)
    }

    func testClearingScoresKeepsSameCustomChallengeAndRestartsEnrollment() throws {
        let source = try customChallenge()
        var board = PartyBoard(challenge: source)
        let first = try board.complete(name: "", guesses: [5, 4, 3, 2, 1])
        XCTAssertEqual(first.insight.prompt, source.resolvedPrompts[first.insight.index])
        XCTAssertEqual(first.insight.answer, source.answers[first.insight.index])
        board.clearScores()
        XCTAssertTrue(board.runs.isEmpty)
        XCTAssertTrue(board.standings.isEmpty)
        XCTAssertEqual(board.challenge, source)
        XCTAssertTrue(board.challenge.isCustom)
        XCTAssertEqual(try board.validatedName(""), "Friend 1")
        let next = try board.complete(name: "", guesses: source.answers)
        XCTAssertNotEqual(next.id, first.id)
        XCTAssertEqual(next.attemptCount, 1)
        XCTAssertEqual(next.name, "Friend 1")
    }
}
