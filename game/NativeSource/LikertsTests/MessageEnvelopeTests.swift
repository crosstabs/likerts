import Foundation
import XCTest
@testable import Likerts

final class MessageEnvelopeTests: XCTestCase {
    private let gameID = UUID(uuidString: "D7F47B40-215B-4C96-9F9F-714B6C6CFB18")!
    private let prefix = "data:application/vnd.likerts.message+json;base64,"

    private func bankChallenge() throws -> Challenge {
        try Challenge(name: "Pip", promptIDs: [1, 2, 3, 4, 5], answers: [1, 2, 3, 4, 5])
    }

    private func customChallenge(_ theme: PackTheme = .sideQuests) throws -> Challenge {
        let pack = AuthoredPacks.pack(for: theme)
        let prompts = pack.statements.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: theme.emoji) }
        return try Challenge(name: "Zoë 🧑🏽‍🚀", prompts: prompts, answers: [5, 4, 3, 2, 1])
    }

    private func payload(kind: String = "challenge") throws -> [String: Any] {
        var value: [String: Any] = ["version": 1, "kind": kind, "gameID": gameID.uuidString, "challengeCode": ChallengeCodec.encode(try bankChallenge())]
        if kind == "result" { value["guesses"] = [1, 2, 3, 4, 5] }
        return value
    }

    private func url(_ value: Any) throws -> URL {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed])
        return try XCTUnwrap(URL(string: prefix + data.base64EncodedString()))
    }

    func testLegacyChallengeRoundTripPreservesIdentityAndHiddenResultState() throws {
        let original = MessageEnvelope.challenge(id: gameID, challenge: try bankChallenge())
        let encoded = try MessageEnvelopeCodec.encode(original)
        XCTAssertEqual(encoded.scheme, "data")
        XCTAssertTrue(encoded.absoluteString.hasPrefix(prefix))
        XCTAssertLessThanOrEqual(encoded.absoluteString.count, 5_000)
        XCTAssertLessThanOrEqual(encoded.absoluteString.utf8.count, 5_000)
        let decoded = try MessageEnvelopeCodec.decode(encoded)
        XCTAssertEqual(decoded, original)
        XCTAssertEqual(decoded.id, gameID)
        XCTAssertEqual(decoded.kind, .challenge)
        XCTAssertNil(decoded.guesses)
        XCTAssertNil(decoded.score)
    }

    func testLegacyResultRoundTripRecomputesScoreAndKeepsRoundID() throws {
        let challenge = try bankChallenge()
        let sent = MessageEnvelope(id: gameID, challenge: challenge)
        let reply = try MessageEnvelope.result(id: sent.id, challenge: sent.challenge, guesses: [1, 1, 1, 1, 1])
        XCTAssertEqual(reply.id, sent.id)
        XCTAssertEqual(reply.kind, .result)
        XCTAssertEqual(reply.score, 50)
        XCTAssertEqual(try MessageEnvelopeCodec.decode(MessageEnvelopeCodec.encode(reply)), reply)
        let perfect = try MessageEnvelope(id: gameID, challenge: challenge, guesses: challenge.answers)
        XCTAssertEqual(perfect.score, 100)
    }

    func testEveryCustomThemeRoundTripsChallengeAndResultWithinURLBudget() throws {
        for theme in PackTheme.allCases {
            let challenge = try customChallenge(theme)
            let sent = MessageEnvelope(id: gameID, challenge: challenge)
            let reply = try MessageEnvelope(id: sent.id, challenge: sent.challenge, guesses: [1, 2, 3, 4, 5])
            for envelope in [sent, reply] {
                let encoded = try MessageEnvelopeCodec.encode(envelope)
                XCTAssertLessThanOrEqual(encoded.absoluteString.utf8.count, MessageEnvelopeCodec.maximumURLLength)
                XCTAssertEqual(try MessageEnvelopeCodec.decode(encoded), envelope)
            }
        }
    }

    func testWireEncodingIsDeterministicSortedAndDoesNotTransmitScores() throws {
        let challenge = try bankChallenge()
        let envelope = MessageEnvelope(id: gameID, challenge: challenge)
        let encoded = try MessageEnvelopeCodec.encode(envelope)
        let body = String(encoded.absoluteString.dropFirst(prefix.count))
        let data = try XCTUnwrap(Data(base64Encoded: body))
        let expected = try JSONSerialization.data(withJSONObject: payload(), options: [.sortedKeys, .withoutEscapingSlashes])
        XCTAssertEqual(data, expected)
        XCTAssertEqual(try MessageEnvelopeCodec.encode(envelope), encoded)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertNil(object["guesses"])
        XCTAssertNil(object["score"])
    }

    func testResultConstructorRejectsInvalidGuessCountsAndRanges() throws {
        let challenge = try bankChallenge()
        for guesses in [[], [1, 2, 3, 4], [1, 2, 3, 4, 5, 1], [0, 2, 3, 4, 5], [1, 2, 3, 4, 6], [Int.min, 2, 3, 4, Int.max]] {
            XCTAssertThrowsError(try MessageEnvelope(id: gameID, challenge: challenge, guesses: guesses)) { error in
                XCTAssertEqual(error as? MessageEnvelopeError, .invalidGuesses)
            }
        }
    }

    func testArbitrarySchemesAndMIMETypesAreRejected() throws {
        let original = try MessageEnvelopeCodec.encode(MessageEnvelope(id: gameID, challenge: bankChallenge())).absoluteString
        for raw in [
            original.replacingOccurrences(of: "data:", with: "likerts:"),
            original.replacingOccurrences(of: "data:", with: "https://example.invalid/"),
            original.replacingOccurrences(of: "application/vnd.likerts.message+json", with: "application/json"),
            original.replacingOccurrences(of: ";base64,", with: ";charset=utf-8;base64,"),
            "data:text/plain;base64,aGVsbG8=",
            "file:///tmp/game.json"
        ] {
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(XCTUnwrap(URL(string: raw))))
        }
    }

    func testQueryAndFragmentAreRejectedRatherThanIgnored() throws {
        let original = try MessageEnvelopeCodec.encode(MessageEnvelope(id: gameID, challenge: bankChallenge())).absoluteString
        for suffix in ["?extra=1", "#result", "?", "#"] {
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(XCTUnwrap(URL(string: original + suffix))))
        }
    }

    func testNoncanonicalBase64AndTruncatedBodiesAreRejected() throws {
        for body in ["", "e30", "e30===", "e31=", "e30=\n", "e30%3D", "_w==", "----", "!!!!"] {
            let malformed = try XCTUnwrap(URL(string: prefix + body))
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(malformed), body)
        }
        let original = try MessageEnvelopeCodec.encode(MessageEnvelope(id: gameID, challenge: bankChallenge())).absoluteString
        XCTAssertThrowsError(try MessageEnvelopeCodec.decode(XCTUnwrap(URL(string: String(original.dropLast(4))))))
    }

    func testMalformedJSONAndRootShapesAreRejected() throws {
        for json in ["", "{", "{\"version\":1", "null", "[]", "\"challenge\"", "42", "true"] {
            let encoded = try XCTUnwrap(URL(string: prefix + Data(json.utf8).base64EncodedString()))
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(encoded), json)
        }
    }

    func testUnsupportedVersionsAreRejectedExplicitly() throws {
        for version in [0, 2, Int.max] {
            var value = try payload()
            value["version"] = version
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(value))) { error in
                XCTAssertEqual(error as? MessageEnvelopeError, .unsupportedVersion)
            }
        }
        for version: Any in ["1", true, NSNull()] {
            var value = try payload()
            value["version"] = version
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(value)))
        }
    }

    func testUnknownMissingOrMismatchedKeysAreRejected() throws {
        let valid = try payload()
        for key in valid.keys {
            var missing = valid
            missing.removeValue(forKey: key)
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(missing)), key)
        }
        for key in ["score", "source", "url", "unexpected"] {
            var unknown = valid
            unknown[key] = 100
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(unknown)), key)
        }
        var challengeWithGuesses = valid
        challengeWithGuesses["guesses"] = [1, 2, 3, 4, 5]
        XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(challengeWithGuesses)))
        challengeWithGuesses["guesses"] = NSNull()
        XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(challengeWithGuesses)))
        var resultWithoutGuesses = try payload(kind: "result")
        resultWithoutGuesses.removeValue(forKey: "guesses")
        XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(resultWithoutGuesses)))
    }

    func testUnsupportedKindsAndInvalidRoundIDsAreRejected() throws {
        for kind: Any in ["unknown", "Challenge", "result ", 1, NSNull()] {
            var value = try payload()
            value["kind"] = kind
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(value)))
        }
        for invalidID: Any in ["", "not-a-uuid", "../game", 123, NSNull()] {
            var value = try payload()
            value["gameID"] = invalidID
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(value)))
        }
    }

    func testDuplicateJSONKeysIncludingEscapedAliasesAreRejected() throws {
        let base = try JSONSerialization.data(withJSONObject: payload(), options: [.sortedKeys, .withoutEscapingSlashes])
        let json = try XCTUnwrap(String(data: base, encoding: .utf8))
        for duplicate in ["\"kind\":\"challenge\",", "\"\\u006bind\":\"challenge\",", "\"gameID\":\"\(gameID.uuidString)\","] {
            let repeated = "{" + duplicate + json.dropFirst()
            let malformed = try XCTUnwrap(URL(string: prefix + Data(repeated.utf8).base64EncodedString()))
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(malformed))
        }
    }

    func testStrictSchemaStillAllowsJSONFormattingAndEscapedStringContent() throws {
        var value = try payload()
        value["challengeCode"] = " \n" + ChallengeCodec.encode(try bankChallenge()) + " \n"
        let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted])
        let formatted = try XCTUnwrap(URL(string: prefix + data.base64EncodedString()))
        XCTAssertEqual(try MessageEnvelopeCodec.decode(formatted).challenge, try bankChallenge())
    }

    func testWireResultsMustContainFiveIntegerGuessesInRange() throws {
        for guesses: Any in [[], [1, 2, 3, 4], [1, 2, 3, 4, 6], [0, 2, 3, 4, 5], [1, 2, 3, 4, 5, 1], [1, 2, 3, 4, 4.5], [true, true, true, true, true], "1,2,3,4,5", NSNull()] {
            var value = try payload(kind: "result")
            value["guesses"] = guesses
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(value)))
        }
    }

    func testInvalidEmbeddedChallengeIsRejectedAndValidNormalizationIsReused() throws {
        for code: Any in ["", "LK1-broken", "LK2-malformed", 3, NSNull()] {
            var value = try payload()
            value["challengeCode"] = code
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(url(value)))
        }
        var valid = try payload()
        valid["challengeCode"] = " \n" + ChallengeCodec.encode(try bankChallenge()).lowercased() + "\n "
        XCTAssertEqual(try MessageEnvelopeCodec.decode(url(valid)).challenge, try bankChallenge())
    }

    func testURLBoundsAreCheckedBeforeParsingASCIIAndUnicodeInput() throws {
        for raw in [prefix + String(repeating: "A", count: 5_001), prefix + String(repeating: "🌀", count: 500)] {
            let oversized = try XCTUnwrap(URL(string: raw))
            XCTAssertGreaterThan(oversized.absoluteString.utf8.count, MessageEnvelopeCodec.maximumURLLength)
            XCTAssertThrowsError(try MessageEnvelopeCodec.decode(oversized)) { error in
                XCTAssertEqual(error as? MessageEnvelopeError, .oversized)
            }
        }
    }
}
