import XCTest
@testable import Likerts

final class RoundInsightTests: XCTestCase {
    private func challenge(answers: [Int] = [1, 2, 3, 4, 5], ids: [Int] = [1, 2, 3, 4, 5]) throws -> Challenge {
        try Challenge(name: "Pip", promptIDs: ids, answers: answers)
    }

    func testLargestGapUsesActualPromptGuessAndAnswer() throws {
        let challenge = try challenge()
        let insight = try RoundInsight(challenge: challenge, guesses: [1, 5, 2, 4, 5])
        XCTAssertEqual(insight.index, 1)
        XCTAssertEqual(insight.distance, 3)
        XCTAssertEqual(insight.prompt, challenge.resolvedPrompts[1])
        XCTAssertEqual(insight.guess, 5)
        XCTAssertEqual(insight.answer, 2)
        XCTAssertFalse(insight.allMatched)
    }

    func testUnderestimateProducesPositiveAbsoluteGapWithoutChangingSignedValues() throws {
        let challenge = try challenge(answers: [5, 4, 3, 2, 1])
        let insight = try RoundInsight(challenge: challenge, guesses: [1, 4, 3, 2, 1])
        XCTAssertEqual(insight.index, 0)
        XCTAssertEqual(insight.distance, 4)
        XCTAssertEqual(insight.guess - insight.answer, -4)
        XCTAssertEqual(Scoring.points(guess: insight.guess, answer: insight.answer), 0)
    }

    func testEqualLargestGapsAlwaysChooseEarliestPrompt() throws {
        let challenge = try challenge(answers: [3, 3, 3, 3, 3])
        let insight = try RoundInsight(challenge: challenge, guesses: [1, 5, 3, 5, 1])
        XCTAssertEqual(insight.index, 0)
        XCTAssertEqual(insight.distance, 2)
        XCTAssertEqual(insight.guess, 1)
        XCTAssertEqual(insight.answer, 3)
        let laterTie = try RoundInsight(challenge: challenge, guesses: [3, 3, 1, 5, 3])
        XCTAssertEqual(laterTie.index, 2)
    }

    func testAllExactReadsRemainZeroGapAndUseFirstPresentedPrompt() throws {
        let challenge = try challenge(answers: [2, 4, 1, 5, 3], ids: [5, 4, 3, 2, 1])
        let insight = try RoundInsight(challenge: challenge, guesses: challenge.answers)
        XCTAssertTrue(insight.allMatched)
        XCTAssertEqual(insight.distance, 0)
        XCTAssertEqual(insight.index, 0)
        XCTAssertEqual(insight.prompt.id, 5)
        XCTAssertEqual(insight.guess, insight.answer)
        XCTAssertEqual(Scoring.total(guesses: challenge.answers, answers: challenge.answers), 100)
    }

    func testAllScaleValuesAgreeWithExistingDistanceScoring() throws {
        for answer in 1...5 {
            let challenge = try challenge(answers: Array(repeating: answer, count: 5))
            for guess in 1...5 {
                let insight = try RoundInsight(challenge: challenge, guesses: [guess, answer, answer, answer, answer])
                XCTAssertEqual(insight.index, 0)
                XCTAssertEqual(insight.distance, abs(guess - answer))
                XCTAssertEqual(insight.allMatched, guess == answer)
                XCTAssertEqual(Scoring.points(guess: guess, answer: answer), 100 - insight.distance * 25)
            }
        }
    }

    func testCustomChallengeInsightPreservesExactCustomContent() throws {
        let pack = AuthoredPacks.pack(for: .foodTakes)
        let prompts = pack.statements.enumerated().map {
            Prompt(id: 201 + $0.offset, text: $0.element, emoji: pack.theme.emoji)
        }
        let challenge = try Challenge(name: "Pip", prompts: prompts, answers: [1, 1, 1, 1, 1])
        let insight = try RoundInsight(challenge: challenge, guesses: [1, 1, 1, 5, 1])
        XCTAssertEqual(insight.index, 3)
        XCTAssertEqual(insight.prompt, prompts[3])
        XCTAssertEqual(insight.distance, 4)
        XCTAssertEqual(insight.guess, 5)
        XCTAssertEqual(insight.answer, 1)
    }

    func testInvalidCountsAndRangesAreRejectedBeforeDistanceArithmetic() throws {
        let challenge = try challenge()
        for guesses in [[], [1, 2, 3, 4], [1, 2, 3, 4, 5, 1], [0, 2, 3, 4, 5], [1, 2, 3, 4, 6], [Int.min, 2, 3, 4, Int.max]] {
            XCTAssertThrowsError(try RoundInsight(challenge: challenge, guesses: guesses)) { error in
                XCTAssertEqual(error as? RoundInsightError, .invalidGuesses)
            }
        }
    }
}
