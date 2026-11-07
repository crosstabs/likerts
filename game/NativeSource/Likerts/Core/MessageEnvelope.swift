import Foundation

enum MessageKind: String, Codable, Sendable {
    case challenge
    case result
}

enum MessageEnvelopeError: Error, Equatable, LocalizedError {
    case invalidURL
    case oversized
    case invalidPayload
    case unsupportedVersion
    case invalidKind
    case invalidChallenge
    case invalidGuesses

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "This isn't a supported Likerts message."
        case .oversized: return "This Likerts message is too large to open."
        case .invalidPayload: return "This Likerts message is incomplete or malformed."
        case .unsupportedVersion: return "This message needs a newer version of Likerts."
        case .invalidKind: return "This message doesn't contain a supported game action."
        case .invalidChallenge: return "The challenge inside this message couldn't be read."
        case .invalidGuesses: return "A result needs five guesses between 1 and 5."
        }
    }
}

/// The same game ID follows a challenge and its replies. Results are recomputed
/// from the enclosed guesses; a transmitted score is never trusted.
struct MessageEnvelope: Equatable, Sendable {
    let id: UUID
    let kind: MessageKind
    let challenge: Challenge
    let guesses: [Int]?

    init(id: UUID = UUID(), challenge: Challenge) {
        self.id = id
        self.kind = .challenge
        self.challenge = challenge
        self.guesses = nil
    }

    init(id: UUID, challenge: Challenge, guesses: [Int]) throws {
        guard guesses.count == 5, guesses.allSatisfy({ (1...5).contains($0) }) else {
            throw MessageEnvelopeError.invalidGuesses
        }
        self.id = id
        self.kind = .result
        self.challenge = challenge
        self.guesses = guesses
    }

    static func challenge(id: UUID = UUID(), challenge: Challenge) -> MessageEnvelope {
        MessageEnvelope(id: id, challenge: challenge)
    }

    static func result(id: UUID, challenge: Challenge, guesses: [Int]) throws -> MessageEnvelope {
        try MessageEnvelope(id: id, challenge: challenge, guesses: guesses)
    }

    var score: Int? {
        guard let guesses else { return nil }
        return Scoring.total(guesses: guesses, answers: challenge.answers)
    }
}

/// MSMessage.url supports the data: scheme. This bounded payload has no host,
/// web destination or custom URL handler. It includes answers, not encryption.
enum MessageEnvelopeCodec {
    static let maximumURLLength = 5_000
    private static let prefix = "data:application/vnd.likerts.message+json;base64,"

    static func encode(_ envelope: MessageEnvelope) throws -> URL {
        let code = ChallengeCodec.encode(envelope.challenge)
        guard !code.isEmpty else { throw MessageEnvelopeError.invalidChallenge }
        let body = MessageBody(version: 1, kind: envelope.kind, gameID: envelope.id, challengeCode: code, guesses: envelope.guesses)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let raw: String
        do { raw = prefix + (try encoder.encode(body)).base64EncodedString() }
        catch { throw MessageEnvelopeError.invalidPayload }
        guard raw.count <= maximumURLLength, raw.utf8.count <= maximumURLLength else {
            throw MessageEnvelopeError.oversized
        }
        guard let url = URL(string: raw) else { throw MessageEnvelopeError.invalidURL }
        return url
    }

    static func decode(_ url: URL) throws -> MessageEnvelope {
        // Check bounds before parsing any attacker-controlled payload.
        let raw = url.absoluteString
        guard raw.count <= maximumURLLength, raw.utf8.count <= maximumURLLength else {
            throw MessageEnvelopeError.oversized
        }
        guard url.scheme == "data", url.host == nil, url.query == nil, url.fragment == nil,
              raw.hasPrefix(prefix) else { throw MessageEnvelopeError.invalidURL }
        let encoded = String(raw.dropFirst(prefix.count))
        guard !encoded.isEmpty, encoded.count.isMultiple(of: 4),
              encoded.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 43 || $0 == 47 || $0 == 61 }),
              let data = Data(base64Encoded: encoded), data.base64EncodedString() == encoded else {
            throw MessageEnvelopeError.invalidPayload
        }
        let body: MessageBody
        do { body = try JSONDecoder().decode(MessageBody.self, from: data) }
        catch let error as MessageEnvelopeError { throw error }
        catch { throw MessageEnvelopeError.invalidPayload }
        guard hasUniqueTopLevelKeys(data) else { throw MessageEnvelopeError.invalidPayload }
        let challenge: Challenge
        do { challenge = try ChallengeCodec.decode(body.challengeCode) }
        catch { throw MessageEnvelopeError.invalidChallenge }
        switch body.kind {
        case .challenge:
            return MessageEnvelope(id: body.gameID, challenge: challenge)
        case .result:
            guard let guesses = body.guesses else { throw MessageEnvelopeError.invalidGuesses }
            return try MessageEnvelope(id: body.gameID, challenge: challenge, guesses: guesses)
        }
    }

    /// JSONDecoder exposes unique keys only. Reject repeated keys explicitly so
    /// conflicting values cannot be interpreted differently by other decoders.
    /// This runs after JSONDecoder accepted the bounded JSON object's shape.
    private static func hasUniqueTopLevelKeys(_ data: Data) -> Bool {
        let bytes = Array(data)
        var index = 0
        var depth = 0
        var expectsKey = true
        var seen = Set<String>()
        while index < bytes.count {
            let byte = bytes[index]
            if byte == 34 {
                let start = index
                index += 1
                var escaped = false
                while index < bytes.count {
                    let character = bytes[index]
                    if character == 34 && !escaped { break }
                    if character == 92 && !escaped { escaped = true }
                    else { escaped = false }
                    index += 1
                }
                guard index < bytes.count else { return false }
                if depth == 1 && expectsKey {
                    guard let key = try? JSONDecoder().decode(String.self, from: Data(bytes[start...index])),
                          seen.insert(key).inserted else { return false }
                    expectsKey = false
                }
            } else if byte == 123 || byte == 91 {
                depth += 1
            } else if byte == 125 || byte == 93 {
                depth -= 1
            } else if byte == 44 && depth == 1 {
                expectsKey = true
            }
            index += 1
        }
        return true
    }
}

private struct MessageBody: Codable {
    let version: Int
    let kind: MessageKind
    let gameID: UUID
    let challengeCode: String
    let guesses: [Int]?

    init(version: Int, kind: MessageKind, gameID: UUID, challengeCode: String, guesses: [Int]?) {
        self.version = version
        self.kind = kind
        self.gameID = gameID
        self.challengeCode = challengeCode
        self.guesses = guesses
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: MessageField.self)
        version = try container.decode(Int.self, forKey: MessageField("version"))
        guard version == 1 else { throw MessageEnvelopeError.unsupportedVersion }
        let action = try container.decode(String.self, forKey: MessageField("kind"))
        guard let kind = MessageKind(rawValue: action) else { throw MessageEnvelopeError.invalidKind }
        self.kind = kind
        let expected: Set<String> = kind == .challenge
            ? ["version", "kind", "gameID", "challengeCode"]
            : ["version", "kind", "gameID", "challengeCode", "guesses"]
        guard Set(container.allKeys.map(\.stringValue)) == expected else {
            throw MessageEnvelopeError.invalidPayload
        }
        gameID = try container.decode(UUID.self, forKey: MessageField("gameID"))
        challengeCode = try container.decode(String.self, forKey: MessageField("challengeCode"))
        guesses = kind == .result ? try container.decode([Int].self, forKey: MessageField("guesses")) : nil
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: MessageField.self)
        try container.encode(version, forKey: MessageField("version"))
        try container.encode(kind, forKey: MessageField("kind"))
        try container.encode(gameID, forKey: MessageField("gameID"))
        try container.encode(challengeCode, forKey: MessageField("challengeCode"))
        try container.encodeIfPresent(guesses, forKey: MessageField("guesses"))
    }
}

/// Dynamic coding keys let decoding see and reject unknown fields as well as
/// missing fields; a fixed CodingKeys enum would hide unknown keys from allKeys.
private struct MessageField: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(_ string: String) { stringValue = string }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}
