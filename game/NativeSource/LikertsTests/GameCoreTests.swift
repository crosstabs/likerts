import XCTest
@testable import Likerts

final class GameCoreTests: XCTestCase {
    private func challenge(name: String = "Pip") throws -> Challenge {
        try Challenge(name: name, promptIDs: [1, 2, 3, 4, 5], answers: [1, 2, 3, 4, 5])
    }

    func testScoringRewardsDistanceSymmetrically() {
        XCTAssertEqual(Scoring.points(guess: 3, answer: 3), 100)
        XCTAssertEqual(Scoring.points(guess: 2, answer: 3), 75)
        XCTAssertEqual(Scoring.points(guess: 5, answer: 3), 50)
        XCTAssertEqual(Scoring.points(guess: 4, answer: 1), 25)
        XCTAssertEqual(Scoring.points(guess: 1, answer: 5), 0)
        for guess in 1...5 {
            for answer in 1...5 {
                XCTAssertEqual(Scoring.points(guess: guess, answer: answer), Scoring.points(guess: answer, answer: guess))
            }
        }
    }

    func testScoreTotalAndInvalidInputs() {
        XCTAssertEqual(Scoring.total(guesses: [1, 2, 3, 4, 5], answers: [1, 2, 3, 4, 5]), 100)
        XCTAssertEqual(Scoring.total(guesses: [1, 1, 1, 1, 1], answers: [1, 2, 3, 4, 5]), 50)
        XCTAssertEqual(Scoring.total(guesses: [], answers: []), 0)
        XCTAssertEqual(Scoring.total(guesses: [1], answers: [1, 2]), 0)
        XCTAssertEqual(Scoring.total(guesses: [6], answers: [5]), 0)
        XCTAssertEqual(Scoring.points(guess: Int.min, answer: Int.max), 0)
    }

    func testScoreTitlesAtBoundaries() {
        XCTAssertEqual(Scoring.title(for: 100), "One shared brain.")
        XCTAssertEqual(Scoring.title(for: 99), "Same wavelength.")
        XCTAssertEqual(Scoring.title(for: 80), "Same wavelength.")
        XCTAssertEqual(Scoring.title(for: 60), "Pretty good reception.")
        XCTAssertEqual(Scoring.title(for: 40), "A little interference.")
        XCTAssertEqual(Scoring.title(for: 0), "Beautifully unpredictable.")
    }

    func testNamesNormalizeWhitespaceAndHaveSafeBounds() throws {
        XCTAssertEqual(try challenge(name: "  Pip\n the\t Brave  ").name, "Pip the Brave")
        XCTAssertEqual(try challenge(name: " \n ").name, "Your friend")
        XCTAssertEqual(try challenge(name: String(repeating: "🐉", count: 20)).name.count, 20)
        XCTAssertEqual(try challenge(name: "🧑🏽‍🚀 Jo").name, "🧑🏽‍🚀 Jo")
        XCTAssertThrowsError(try challenge(name: String(repeating: "a", count: 21)))
        XCTAssertThrowsError(try challenge(name: "Pip\0"))
    }

    func testChallengeRejectsMalformedRounds() {
        XCTAssertThrowsError(try Challenge(name: "Pip", promptIDs: [1, 2], answers: [1, 2]))
        XCTAssertThrowsError(try Challenge(name: "Pip", promptIDs: [1, 2, 3, 4, 4], answers: [1, 2, 3, 4, 5]))
        XCTAssertThrowsError(try Challenge(name: "Pip", promptIDs: [1, 2, 3, 4, 999], answers: [1, 2, 3, 4, 5]))
        XCTAssertThrowsError(try Challenge(name: "Pip", promptIDs: [1, 2, 3, 4, 5], answers: [0, 2, 3, 4, 5]))
        XCTAssertThrowsError(try Challenge(name: "Pip", promptIDs: [1, 2, 3, 4, 5], answers: [1, 2, 3, 4, 6]))
    }

    func testChallengeRoundTripAndCaseInsensitiveWhitespace() throws {
        let original = try challenge(name: "Zoë 🧑🏽‍🚀")
        let code = ChallengeCodec.encode(original)
        XCTAssertTrue(code.hasPrefix("LK1-"))
        XCTAssertEqual(try ChallengeCodec.decode(code), original)
        let wrapped = " \n " + code.lowercased().replacingOccurrences(of: "-", with: " - \n ") + " \t"
        XCTAssertEqual(try ChallengeCodec.decode(wrapped), original)
    }

    func testEveryPossibleFiveAnswerCombinationRoundTrips() throws {
        for packed in 0..<3_125 {
            var remaining = packed
            var answers = Array(repeating: 1, count: 5)
            for index in (0..<5).reversed() {
                answers[index] = remaining % 5 + 1
                remaining /= 5
            }
            let original = try Challenge(name: "Test", promptIDs: [30, 29, 28, 27, 26], answers: answers)
            XCTAssertEqual(try ChallengeCodec.decode(ChallengeCodec.encode(original)), original)
        }
    }

    func testMalformedAndOversizedCodesRejected() throws {
        for code in ["", "hello", "LK1-", "LK1-00000", "LK1-ABC!", String(repeating: "A", count: 401)] {
            XCTAssertThrowsError(try ChallengeCodec.decode(code), code)
        }
        let code = ChallengeCodec.encode(try challenge())
        XCTAssertThrowsError(try ChallengeCodec.decode(String(code.dropLast(4))))
        XCTAssertThrowsError(try ChallengeCodec.decode(code + "A"))
    }

    func testFutureVersionRejectedClearly() throws {
        let code = ChallengeCodec.encode(try challenge()).replacingOccurrences(of: "LK1", with: "LK2")
        XCTAssertThrowsError(try ChallengeCodec.decode(code)) { error in
            XCTAssertEqual(error as? ChallengeError, .unsupportedVersion)
        }
    }

    func testSingleCharacterDamageDetected() throws {
        let code = ChallengeCodec.encode(try challenge())
        let indexes = code.indices.filter { code[$0] != "-" }.dropFirst(3)
        for index in indexes {
            var damaged = code
            damaged.replaceSubrange(index...index, with: code[index] == "A" ? "B" : "A")
            XCTAssertThrowsError(try ChallengeCodec.decode(damaged))
        }
    }

    func testValidChecksumCannotBypassSemanticValidation() {
        // Version, five IDs, base-5 answer word, UTF-8 name count, name.
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode([1, 1, 2, 3, 4, 4, 0, 0, 1, 65])))
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode([1, 1, 2, 3, 4, 99, 0, 0, 1, 65])))
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode([1, 1, 2, 3, 4, 5, 255, 255, 1, 65])))
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode([1, 1, 2, 3, 4, 5, 0, 0, 2, 65])))
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode([1, 1, 2, 3, 4, 5, 0, 0, 1, 255])))
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode([2, 1, 2, 3, 4, 5, 0, 0, 1, 65])))
    }

    func testPromptBankHasStableUniqueIDsAndFreshSets() {
        XCTAssertEqual(PromptBank.all.count, 30)
        XCTAssertEqual(Set(PromptBank.all.map(\.id)).count, 30)
        XCTAssertNil(PromptBank.prompt(id: -1))
        for _ in 0..<20 {
            let prompts = PromptBank.randomSet()
            XCTAssertEqual(prompts.count, 5)
            XCTAssertEqual(Set(prompts.map(\.id)).count, 5)
            XCTAssertTrue(prompts.allSatisfy { PromptBank.prompt(id: $0.id) != nil })
        }
    }

    func testDailyIsDeterministicWithinUTCDateAndRotatesAcrossSevenDays() throws {
        let start = Date(timeIntervalSince1970: 1_793_318_400) // 2026-10-30 00:00 UTC
        var names = Set<String>()
        for day in 0..<7 {
            let date = start.addingTimeInterval(Double(day * 86_400))
            let morning = DailyPuzzle.today(date: date)
            let evening = DailyPuzzle.today(date: date.addingTimeInterval(86_399))
            XCTAssertEqual(morning.key, evening.key)
            XCTAssertEqual(morning.name, evening.name)
            XCTAssertEqual(morning.answers, evening.answers)
            XCTAssertEqual(morning.clues.count, 5)
            XCTAssertTrue(morning.clues.allSatisfy { !$0.isEmpty })
            XCTAssertEqual(try ChallengeCodec.decode(ChallengeCodec.encode(morning.challenge)), morning.challenge)
            names.insert(morning.name)
        }
        XCTAssertEqual(names.count, 7)
        XCTAssertEqual(DailyPuzzle.today(date: start).key, "2026-10-30")
        XCTAssertNotEqual(DailyPuzzle.today(date: start.addingTimeInterval(-1)).key, DailyPuzzle.today(date: start).key)
    }

    func testDailySupportsPreEpochDates() {
        XCTAssertEqual(DailyPuzzle.today(date: Date(timeIntervalSince1970: -1)).key, "1969-12-31")
        XCTAssertEqual(DailyPuzzle.today(date: Date(timeIntervalSince1970: -1)).clues.count, 5)
    }

    private func rawCode(_ payload: [UInt8]) -> String {
        var checksum: UInt16 = 0xFFFF
        for byte in payload {
            checksum ^= UInt16(byte) << 8
            for _ in 0..<8 { checksum = checksum & 0x8000 != 0 ? (checksum << 1) ^ 0x1021 : checksum << 1 }
        }
        let bytes = payload + [UInt8(checksum >> 8), UInt8(checksum & 255)]
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var bitString = bytes.map { String($0, radix: 2).leftPad(to: 8) }.joined()
        while bitString.count % 5 != 0 { bitString.append("0") }
        var encoded = ""
        while !bitString.isEmpty {
            encoded.append(alphabet[Int(bitString.prefix(5), radix: 2)!])
            bitString.removeFirst(5)
        }
        return "LK1-" + encoded
    }
}

private extension String {
    func leftPad(to count: Int) -> String { String(repeating: "0", count: max(0, count - self.count)) + self }
}
