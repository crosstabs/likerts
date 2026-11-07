import XCTest
@testable import Likerts

final class TopicChallengeTests: XCTestCase {
    func testTopicChallengeRoundTripsWholeCatalogAndMessages() throws {
        let catalog = try TopicCatalog.bundled.get()
        for topic in TopicID.allCases {
            for start in stride(from: 0, to: 50, by: 5) {
                let ids = Array(catalog.rounds(for: topic).dropFirst(start).prefix(5)).map(\.id)
                let challenge = try Challenge(name: "Zoë", promptIDs: ids, answers: [1, 2, 3, 4, 5])
                let code = ChallengeCodec.encode(challenge)
                XCTAssertTrue(code.hasPrefix("LK3-"))
                XCTAssertLessThan(code.utf8.count, 700)
                XCTAssertEqual(try ChallengeCodec.decode(code), challenge)
                XCTAssertEqual(challenge.resolvedPrompts.count, 5)
                let envelope = MessageEnvelope(challenge: challenge)
                XCTAssertEqual(try MessageEnvelopeCodec.decode(MessageEnvelopeCodec.encode(envelope)), envelope)
            }
        }
    }
    func testDamagedTruncatedAndOversizedTopicCodesReject() throws {
        let challenge = try Challenge(name: "A", promptIDs: [1001, 1002, 1003, 1004, 1005], answers: [1, 2, 3, 4, 5])
        let code = ChallengeCodec.encode(challenge)
        XCTAssertThrowsError(try ChallengeCodec.decode(String(code.dropLast())))
        XCTAssertThrowsError(try ChallengeCodec.decode(code + "A"))
        XCTAssertThrowsError(try ChallengeCodec.decode("LK3-" + String(repeating: "A", count: 701)))
        XCTAssertThrowsError(try ChallengeCodec.decode("LK3-%%%%"))
        var damaged = code
        let index = damaged.index(damaged.startIndex, offsetBy: 12)
        damaged.replaceSubrange(index...index, with: damaged[index] == "A" ? "B" : "A")
        XCTAssertThrowsError(try ChallengeCodec.decode(damaged))
    }
    func testLegacyAndCustomFormatsRemainAvailable() throws {
        let original = try Challenge(name: "A", promptIDs: [1, 2, 3, 4, 5], answers: [5, 4, 3, 2, 1])
        XCTAssertTrue(ChallengeCodec.encode(original).hasPrefix("LK1-"))
        XCTAssertEqual(try ChallengeCodec.decode(ChallengeCodec.encode(original)), original)
        let pack = AuthoredPacks.pack(for: .foodTakes)
        let prompts = pack.statements.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: "✨") }
        let custom = try Challenge(name: "A", prompts: prompts, answers: [1, 2, 3, 4, 5])
        XCTAssertTrue(ChallengeCodec.encode(custom).hasPrefix("LK2-"))
        XCTAssertEqual(try ChallengeCodec.decode(ChallengeCodec.encode(custom)), custom)
    }
}
