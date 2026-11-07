import Foundation
import XCTest
@testable import Likerts

final class CustomChallengeTests: XCTestCase {
    private var prompts: [Prompt] {
        [
            Prompt(id: 201, text: "I would name my café's toaster Captain Crumbs.", emoji: "🍞"),
            Prompt(id: 202, text: "I would invite a tiny dragon to brunch.", emoji: "🐉"),
            Prompt(id: 203, text: "I could make a spreadsheet for my snacks.", emoji: "🥨"),
            Prompt(id: 204, text: "I would adopt a robot vacuum as a pet.", emoji: "🤖"),
            Prompt(id: 205, text: "I would choose a cape for a rainy Tuesday.", emoji: "🧑🏽‍🚀")
        ]
    }

    private func challenge() throws -> Challenge {
        try Challenge(name: "Zoë 🧑🏽‍🚀", prompts: prompts, answers: [1, 2, 3, 4, 5])
    }

    func testBankChallengeRemainsByteForByteLK1() throws {
        let bank = try Challenge(name: "Pip", promptIDs: [1, 2, 3, 4, 5], answers: [1, 2, 3, 4, 5])
        XCTAssertFalse(bank.isCustom)
        XCTAssertNil(bank.customPrompts)
        XCTAssertEqual(bank.resolvedPrompts, Array(PromptBank.all.prefix(5)))
        XCTAssertEqual(ChallengeCodec.encode(bank), "LK1-AEAQ-EAYE-AUAM-EA2Q-NFYK-PTI")
        XCTAssertEqual(try ChallengeCodec.decode("LK1-AEAQ-EAYE-AUAM-EA2Q-NFYK-PTI"), bank)
    }

    func testCustomRoundTripPreservesUnicodeAndIgnoresWrappingWhitespace() throws {
        let original = try challenge()
        XCTAssertTrue(original.isCustom)
        XCTAssertEqual(original.resolvedPrompts, prompts)
        XCTAssertEqual(original.promptIDs, [201, 202, 203, 204, 205])
        let code = ChallengeCodec.encode(original)
        XCTAssertTrue(code.hasPrefix("LK2-"))
        XCTAssertLessThanOrEqual(code.utf8.count, 4_096)
        XCTAssertEqual(try ChallengeCodec.decode(code), original)
        let characters = Array(code)
        let wrapped = stride(from: 0, to: characters.count, by: 29).map {
            String(characters[$0..<min($0 + 29, characters.count)])
        }.joined(separator: " \n\t")
        XCTAssertEqual(try ChallengeCodec.decode("  " + wrapped + " \n"), original)
        XCTAssertEqual(try ChallengeCodec.decode("lk2-" + code.dropFirst(4)), original)
    }

    func testCustomPayloadIsCaseSensitiveAndHyphensArePayloadData() throws {
        let original = try challenge()
        let code = ChallengeCodec.encode(original)
        XCTAssertThrowsError(try ChallengeCodec.decode(code.uppercased()))
        XCTAssertThrowsError(try ChallengeCodec.decode(code.lowercased()))
        XCTAssertTrue(code.dropFirst(4).contains("-"), "The Unicode fixture must exercise a Base64URL hyphen.")
        let stripped = "LK2-" + code.dropFirst(4).replacingOccurrences(of: "-", with: "")
        XCTAssertThrowsError(try ChallengeCodec.decode(stripped))
    }

    func testCustomNamesAndStatementWhitespaceNormalize() throws {
        var custom = prompts
        custom[0] = Prompt(id: 201, text: "  I   would name my café's toaster Captain Crumbs.  ", emoji: "🍞")
        let challenge = try Challenge(name: "  Zoë\n the\t Brave  ", prompts: custom, answers: [1, 1, 1, 1, 1])
        XCTAssertEqual(challenge.name, "Zoë the Brave")
        XCTAssertEqual(challenge.resolvedPrompts[0].text, prompts[0].text)
        XCTAssertEqual(try ChallengeCodec.decode(ChallengeCodec.encode(challenge)), challenge)
    }

    func testCustomChecksumDamageIsRejectedBeforeContentParsing() throws {
        let original = ChallengeCodec.encode(try challenge())
        var bytes = try transportBytes(original)
        bytes[bytes.count - 1] ^= 1
        XCTAssertThrowsError(try ChallengeCodec.decode(transport(bytes))) { error in
            XCTAssertEqual(error as? ChallengeError, .damagedCode)
        }
        XCTAssertThrowsError(try ChallengeCodec.decode(String(original.dropLast(3))))
        XCTAssertThrowsError(try ChallengeCodec.decode(original + "="))
        XCTAssertThrowsError(try ChallengeCodec.decode("LK2-!invalid!"))
    }

    func testCustomSemanticValidationCannotBeBypassedWithValidChecksum() throws {
        var records = promptRecords()
        records[1]["id"] = 201
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode(payload(records: records))))

        records = promptRecords()
        records[4]["id"] = 206
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode(payload(records: records))))

        records = promptRecords()
        records[0]["text"] = "I " + String(repeating: "a", count: 139) + "."
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode(payload(records: records))))

        records = promptRecords()
        records[0]["text"] = "I would share a password with a stranger."
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode(payload(records: records))))

        records = promptRecords()
        records[1]["text"] = prompts[0].text
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode(payload(records: records))))

        var invalidAnswers = payload(records: promptRecords())
        invalidAnswers["answers"] = [1, 2, 3, 4, 6]
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode(invalidAnswers)))

        var invalidName = payload(records: promptRecords())
        invalidName["name"] = String(repeating: "🧑🏽‍🚀", count: 6)
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode(invalidName)))
    }

    func testCustomEmojiBoundsAndRoundCountsAreValidated() throws {
        for emoji in ["", "  ", "🐉\n", String(repeating: "a", count: 17), String(repeating: "🧑🏽‍🚀", count: 5)] {
            var custom = prompts
            custom[0] = Prompt(id: 201, text: custom[0].text, emoji: emoji)
            XCTAssertThrowsError(try Challenge(name: "Pip", prompts: custom, answers: [1, 2, 3, 4, 5]), emoji)
        }
        XCTAssertThrowsError(try Challenge(name: "Pip", prompts: Array(prompts.prefix(4)), answers: [1, 2, 3, 4, 5]))
        XCTAssertThrowsError(try Challenge(name: "Pip", prompts: prompts, answers: [1, 2, 3, 4]))
        XCTAssertThrowsError(try Challenge(name: "Pip", prompts: PromptBank.randomSet(), answers: [1, 2, 3, 4, 5]))
    }

    func testCustomDecodedSizeRawSizeAndSchemaAreBounded() throws {
        XCTAssertThrowsError(try ChallengeCodec.decode("LK2-" + String(repeating: "A", count: 4_093)))
        XCTAssertThrowsError(try ChallengeCodec.decode(codeForPayload(Array(repeating: 65, count: 2_001))))
        XCTAssertThrowsError(try ChallengeCodec.decode(codeForPayload(Array("not JSON".utf8))))
        var unsupported = payload(records: promptRecords())
        unsupported["version"] = 3
        XCTAssertThrowsError(try ChallengeCodec.decode(rawCode(unsupported))) { error in
            XCTAssertEqual(error as? ChallengeError, .unsupportedVersion)
        }
    }

    func testUntrustedSourceMetadataDoesNotBecomeAnOriginClaim() throws {
        var untrusted = payload(records: promptRecords())
        untrusted["source"] = "onDeviceAI"
        XCTAssertEqual(try ChallengeCodec.decode(rawCode(untrusted)), try challenge())
    }

    private func promptRecords() -> [[String: Any]] {
        prompts.map { ["id": $0.id, "text": $0.text, "emoji": $0.emoji] }
    }

    private func payload(records: [[String: Any]]) -> [String: Any] {
        ["version": 2, "name": "Zoë 🧑🏽‍🚀", "prompts": records, "answers": [1, 2, 3, 4, 5]]
    }

    private func rawCode(_ payload: [String: Any]) throws -> String {
        codeForPayload(Array(try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])))
    }

    private func codeForPayload(_ bytes: [UInt8]) -> String {
        var checksum: UInt16 = 0xFFFF
        for byte in bytes {
            checksum ^= UInt16(byte) << 8
            for _ in 0..<8 { checksum = checksum & 0x8000 != 0 ? (checksum << 1) ^ 0x1021 : checksum << 1 }
        }
        return transport(bytes + [UInt8(checksum >> 8), UInt8(checksum & 255)])
    }

    private func transport(_ bytes: [UInt8]) -> String {
        "LK2-" + Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    private func transportBytes(_ code: String) throws -> [UInt8] {
        let base64 = code.dropFirst(4).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let padded = base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Array(try XCTUnwrap(Data(base64Encoded: padded)))
    }
}
