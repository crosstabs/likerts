import Foundation

enum ChallengeError: Error, Equatable, LocalizedError {
    case invalidRounds
    case invalidPrompt
    case invalidAnswer
    case invalidName
    case invalidCode
    case unsupportedVersion
    case damagedCode

    var errorDescription: String? {
        switch self {
        case .invalidRounds: return "A challenge needs five different prompts."
        case .invalidPrompt: return "This challenge contains a prompt this version doesn't know."
        case .invalidAnswer: return "Each answer must be between 1 and 5."
        case .invalidName: return "Try another playful nickname: up to 20 characters, with no contact details or sensitive words."
        case .invalidCode: return "That code doesn't look right. Paste the whole Likerts code."
        case .unsupportedVersion: return "This code needs a newer version of Likerts."
        case .damagedCode: return "That code seems incomplete or mistyped. Ask your friend to send it again."
        }
    }
}

struct Challenge: Equatable, Sendable {
    let name: String
    let promptIDs: [Int]
    let answers: [Int]
    let customPrompts: [Prompt]?

    var isCustom: Bool { customPrompts != nil }
    var resolvedPrompts: [Prompt] {
        customPrompts ?? promptIDs.compactMap { PromptBank.prompt(id: $0) }
    }

    init(name: String, promptIDs: [Int], answers: [Int]) throws {
        guard promptIDs.count == 5, answers.count == 5, Set(promptIDs).count == 5 else {
            throw ChallengeError.invalidRounds
        }
        guard promptIDs.allSatisfy({ PromptBank.prompt(id: $0) != nil }) else {
            throw ChallengeError.invalidPrompt
        }
        guard answers.allSatisfy({ (1...5).contains($0) }) else { throw ChallengeError.invalidAnswer }
        self.name = try Self.normalizedName(name)
        self.promptIDs = promptIDs
        self.answers = answers
        self.customPrompts = nil
    }

    /// Shared custom content is validated as content, not as proof of its origin.
    /// Both authored theme packs and on-device generated packs use this format.
    init(name: String, prompts: [Prompt], answers: [Int]) throws {
        guard prompts.count == 5, answers.count == 5, Set(prompts.map(\.id)).count == 5 else {
            throw ChallengeError.invalidRounds
        }
        guard prompts.allSatisfy({ prompt in
            (201...205).contains(prompt.id) && (1...140).contains(prompt.text.count) &&
            prompt.text.utf8.count <= 560 && (1...16).contains(prompt.emoji.count) &&
            prompt.emoji.utf8.count <= 64 && !prompt.emoji.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !Self.containsDisallowedControls(prompt.emoji) && PackValidator.permitsSharedMetadata(prompt.emoji)
        }) else { throw ChallengeError.invalidPrompt }
        guard answers.allSatisfy({ (1...5).contains($0) }) else { throw ChallengeError.invalidAnswer }
        let statements: [String]
        do { statements = try PackValidator.validate(prompts.map(\.text)) }
        catch { throw ChallengeError.invalidPrompt }
        let normalizedPrompts = zip(prompts, statements).map { original, text in
            Prompt(id: original.id, text: text, emoji: original.emoji)
        }
        let nickname = try Self.normalizedName(name)
        let payload = CustomChallengePayload(version: 2, name: nickname, prompts: normalizedPrompts, answers: answers)
        guard let encoded = try? payload.encoded(), encoded.count <= ChallengeLimits.customPayloadBytes else {
            throw ChallengeError.invalidPrompt
        }
        self.name = nickname
        self.promptIDs = normalizedPrompts.map(\.id)
        self.answers = answers
        self.customPrompts = normalizedPrompts
    }

    private static func normalizedName(_ name: String) throws -> String {
        let normalized = name.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let nickname = normalized.isEmpty ? "Your friend" : normalized
        guard nickname.count <= 20, nickname.utf8.count <= 80, !containsDisallowedControls(nickname),
              PackValidator.permitsSharedMetadata(nickname) else {
            throw ChallengeError.invalidName
        }
        return nickname
    }

    private static func containsDisallowedControls(_ text: String) -> Bool {
        let emojiFormatting: Set<UInt32> = [0x200C, 0x200D, 0xFE0E, 0xFE0F]
        return text.unicodeScalars.contains {
            CharacterSet.controlCharacters.contains($0) && !emojiFormatting.contains($0.value)
        }
    }
}

private enum ChallengeLimits {
    static let rawCodeBytes = 4_096
    static let customPayloadBytes = 2_000
}

private struct CustomChallengePayload: Codable {
    let version: Int
    let name: String
    let prompts: [Prompt]
    let answers: [Int]

    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}

private struct TopicChallengePayload: Codable {
    let version: Int
    let catalogVersion: Int
    let name: String
    let promptIDs: [Int]
    let answers: [Int]
}

/// Offline transport, not encryption. The code includes the nickname and answers.
/// Only use a playful nickname; anyone with the code can decode its contents.
enum ChallengeCodec {
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

    static func encode(_ challenge: Challenge) -> String {
        if let prompts = challenge.customPrompts {
            let payload = CustomChallengePayload(version: 2, name: challenge.name, prompts: prompts, answers: challenge.answers)
            // Construction already proved these bounded value types encode.
            guard let data = try? payload.encoded() else { return "" }
            let bytes = Array(data)
            let checksum = crc16(bytes)
            return "LK2-" + base64URLEncode(bytes + [UInt8(checksum >> 8), UInt8(checksum & 255)])
        }
        if challenge.promptIDs.contains(where: { $0 > 255 }) {
            let payload = TopicChallengePayload(version: 3, catalogVersion: 1, name: challenge.name, promptIDs: challenge.promptIDs, answers: challenge.answers)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            guard let data = try? encoder.encode(payload) else { return "" }
            let bytes = Array(data), checksum = crc16(bytes)
            return "LK3-" + base64URLEncode(bytes + [UInt8(checksum >> 8), UInt8(checksum & 255)])
        }
        var bytes: [UInt8] = [1]
        bytes += challenge.promptIDs.map(UInt8.init)
        let packed = challenge.answers.reduce(0) { $0 * 5 + ($1 - 1) }
        bytes += [UInt8(packed >> 8), UInt8(packed & 255)]
        let name = Array(challenge.name.utf8)
        bytes += [UInt8(name.count)] + name
        let checksum = crc16(bytes)
        bytes += [UInt8(checksum >> 8), UInt8(checksum & 255)]
        let body = base32Encode(bytes)
        let groups = stride(from: 0, to: body.count, by: 4).map { start in
            String(body.dropFirst(start).prefix(4))
        }
        return "LK1-" + groups.joined(separator: "-")
    }

    static func decode(_ code: String) throws -> Challenge {
        // Bound work before allocating or parsing pasted content.
        guard code.utf8.count <= ChallengeLimits.rawCodeBytes else { throw ChallengeError.invalidCode }
        let compact = String(code.filter { !$0.isWhitespace })
        if compact.prefix(4).uppercased() == "LK3-" {
            return try decodeTopic(String(compact.dropFirst(4)))
        }
        if compact.prefix(4).uppercased() == "LK2-" {
            return try decodeCustom(String(compact.dropFirst(4)))
        }
        return try decodeLegacy(code)
    }

    private static func decodeTopic(_ body: String) throws -> Challenge {
        guard !body.isEmpty, body.count <= 700, body.count % 4 != 1,
              body.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }) else { throw ChallengeError.invalidCode }
        let base64 = body.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let padding = String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64 + padding), (3...500).contains(data.count),
              base64URLEncode(Array(data)) == body else { throw ChallengeError.invalidCode }
        let bytes = Array(data), payloadBytes = Array(data.dropLast(2))
        let checksum = UInt16(bytes[bytes.count - 2]) << 8 | UInt16(bytes[bytes.count - 1])
        guard crc16(payloadBytes) == checksum else { throw ChallengeError.damagedCode }
        guard let payload = try? JSONDecoder().decode(TopicChallengePayload.self, from: Data(payloadBytes)) else { throw ChallengeError.invalidCode }
        guard payload.version == 3, payload.catalogVersion == 1 else { throw ChallengeError.unsupportedVersion }
        guard payload.promptIDs.allSatisfy({ (1...30).contains($0) || (1001...2000).contains($0) }) else { throw ChallengeError.invalidPrompt }
        return try Challenge(name: payload.name, promptIDs: payload.promptIDs, answers: payload.answers)
    }

    private static func decodeLegacy(_ code: String) throws -> Challenge {
        // Preserve the LK1 transport and its historical input bound exactly.
        guard code.utf8.count <= 400 else { throw ChallengeError.invalidCode }
        let clean = String(code.filter { !$0.isWhitespace && $0 != "-" }.uppercased())
        guard clean.hasPrefix("LK"), clean.count >= 4 else { throw ChallengeError.invalidCode }
        guard clean.hasPrefix("LK1") else { throw ChallengeError.unsupportedVersion }
        let bytes = try base32Decode(String(clean.dropFirst(3)))
        guard bytes.count >= 12 else { throw ChallengeError.damagedCode }
        let payload = Array(bytes.dropLast(2))
        let stored = UInt16(bytes[bytes.count - 2]) << 8 | UInt16(bytes[bytes.count - 1])
        guard crc16(payload) == stored else { throw ChallengeError.damagedCode }
        guard bytes[0] == 1 else { throw ChallengeError.unsupportedVersion }
        let nameLength = Int(bytes[8])
        guard (1...80).contains(nameLength), bytes.count == 11 + nameLength else {
            throw ChallengeError.invalidCode
        }
        guard let name = String(bytes: bytes[9..<(9 + nameLength)], encoding: .utf8) else {
            throw ChallengeError.invalidName
        }
        var packed = Int(bytes[6]) << 8 | Int(bytes[7])
        guard packed < 3_125 else { throw ChallengeError.invalidAnswer }
        var answers = Array(repeating: 1, count: 5)
        for index in (0..<5).reversed() {
            answers[index] = (packed % 5) + 1
            packed /= 5
        }
        return try Challenge(name: name, promptIDs: bytes[1...5].map(Int.init), answers: answers)
    }

    private static func decodeCustom(_ body: String) throws -> Challenge {
        guard !body.isEmpty else { throw ChallengeError.invalidCode }
        // A legacy code with only its version label changed still communicates
        // an unsupported schema, as it did before custom packs were introduced.
        if body.allSatisfy({ $0 == "-" || alphabet.contains($0) }) {
            throw ChallengeError.unsupportedVersion
        }
        let maximumEncodedLength = ((ChallengeLimits.customPayloadBytes + 4) / 3) * 4
        guard body.utf8.count <= maximumEncodedLength, body.count % 4 != 1,
              body.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }) else {
            throw ChallengeError.invalidCode
        }
        let base64 = body.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let padding = String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let decoded = Data(base64Encoded: base64 + padding),
              (3...(ChallengeLimits.customPayloadBytes + 2)).contains(decoded.count),
              base64URLEncode(Array(decoded)) == body else { throw ChallengeError.invalidCode }
        let bytes = Array(decoded)
        let payloadBytes = Array(bytes.dropLast(2))
        let checksum = UInt16(bytes[bytes.count - 2]) << 8 | UInt16(bytes[bytes.count - 1])
        guard crc16(payloadBytes) == checksum else { throw ChallengeError.damagedCode }
        let payload: CustomChallengePayload
        do { payload = try JSONDecoder().decode(CustomChallengePayload.self, from: Data(payloadBytes)) }
        catch { throw ChallengeError.invalidCode }
        guard payload.version == 2 else { throw ChallengeError.unsupportedVersion }
        return try Challenge(name: payload.name, prompts: payload.prompts, answers: payload.answers)
    }

    private static func base64URLEncode(_ bytes: [UInt8]) -> String {
        Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func base32Encode(_ bytes: [UInt8]) -> String {
        var accumulator: UInt32 = 0
        var bits = 0
        var output = ""
        for byte in bytes {
            accumulator = (accumulator << 8) | UInt32(byte)
            bits += 8
            while bits >= 5 {
                bits -= 5
                output.append(alphabet[Int((accumulator >> bits) & 31)])
            }
            accumulator &= bits == 0 ? 0 : (1 << bits) - 1
        }
        if bits > 0 { output.append(alphabet[Int((accumulator << (5 - bits)) & 31)]) }
        return output
    }

    private static func base32Decode(_ text: String) throws -> [UInt8] {
        let lookup = Dictionary(uniqueKeysWithValues: alphabet.enumerated().map { ($1, UInt32($0)) })
        guard !text.isEmpty else { throw ChallengeError.invalidCode }
        var accumulator: UInt32 = 0
        var bits = 0
        var output: [UInt8] = []
        for character in text {
            guard let value = lookup[character] else { throw ChallengeError.invalidCode }
            accumulator = (accumulator << 5) | value
            bits += 5
            if bits >= 8 {
                bits -= 8
                output.append(UInt8((accumulator >> bits) & 255))
            }
            accumulator &= bits == 0 ? 0 : (1 << bits) - 1
        }
        // Reject noncanonical trailing symbols as well as nonzero padding bits.
        guard bits < 5, accumulator == 0, base32Encode(output) == text else {
            throw ChallengeError.invalidCode
        }
        return output
    }

    private static func crc16(_ bytes: [UInt8]) -> UInt16 {
        var crc: UInt16 = 0xFFFF
        for byte in bytes {
            crc ^= UInt16(byte) << 8
            for _ in 0..<8 { crc = crc & 0x8000 != 0 ? (crc << 1) ^ 0x1021 : crc << 1 }
        }
        return crc
    }
}
