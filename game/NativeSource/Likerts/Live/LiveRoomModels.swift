import Foundation

enum LiveRoomValidationError: Error, Equatable {
    case unsupportedProtocol, invalidState, unexpectedRoom, secretProjection, catalogueMismatch
}

struct LiveRoomSettings: Codable, Equatable, Sendable {
    var topic = "mix"
    var cycles = 1
    var capacity = 12
    var answerSeconds = 60
    var predictSeconds = 60

    var isValid: Bool {
        (1...3).contains(cycles) && (2...50).contains(capacity) &&
        [0, 30, 60, 120].contains(answerSeconds) && [0, 30, 60, 120].contains(predictSeconds) &&
        Self.topics.contains(topic)
    }
    static let topics = ["mix", "snacks", "home", "outdoors", "pets", "travel", "music", "movies", "books", "games", "kitchen", "weather", "style", "hobbies", "social", "celebrations", "mornings", "making", "tinyadventures", "fantasy", "future"]
}

enum LiveRoomRole: String, Codable, Sendable { case host, player }
enum LiveRoomPhase: String, Codable, Sendable { case lobby, answer, predict, reveal, finished }
enum LiveRoomCompletion: String, Codable, Sendable { case complete, incomplete }

struct LiveRoomIdentity: Codable, Equatable, Sendable {
    let id: String
    let nickname: String
}
struct LiveRoomPlayer: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let nickname: String
    let avatar: Int
    let connected: Bool
}
struct LiveRoomPrompt: Codable, Equatable, Sendable {
    let id: Int
    let text: String
    let topic: String
    let sceneSummary: String
}
struct LiveRoomRound: Codable, Equatable, Sendable {
    let id: String
    let index: Int
    let total: Int
    let subjectId: String
    let subjectName: String
    let prompt: LiveRoomPrompt
    let deadline: Int64?
    let paused: Bool
    let answerLocked: Bool
    let submittedCount: Int
    let eligibleCount: Int
    let ownAnswer: Int?
    let ownGuess: Int?
}
struct LiveRoomRevealedGuess: Codable, Equatable, Identifiable, Sendable {
    let playerId: String
    let nickname: String
    let value: Int?
    let points: Int
    var id: String { playerId }
    private enum CodingKeys: String, CodingKey { case playerId, nickname, value, points }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(playerId, forKey: .playerId); try c.encode(nickname, forKey: .nickname)
        try c.encode(value, forKey: .value); try c.encode(points, forKey: .points)
    }
}
struct LiveRoomReveal: Codable, Equatable, Sendable {
    let answer: Int?
    let valid: Bool
    let reason: String
    let guesses: [LiveRoomRevealedGuess]
    let groupAccuracy: Double?
}
struct LiveRoomStanding: Codable, Equatable, Identifiable, Sendable {
    let playerId: String
    let nickname: String
    let points: Int
    let opportunities: Int
    let accuracy: Double?
    let rank: Int?
    var id: String { playerId }
    private enum CodingKeys: String, CodingKey { case playerId, nickname, points, opportunities, accuracy, rank }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(playerId, forKey: .playerId); try c.encode(nickname, forKey: .nickname)
        try c.encode(points, forKey: .points); try c.encode(opportunities, forKey: .opportunities)
        try c.encode(accuracy, forKey: .accuracy); try c.encode(rank, forKey: .rank)
    }
}

/// A recipient projection, never the backend's internal room or an offline Challenge.
struct LiveRoomState: Codable, Equatable, Sendable {
    static let catalogueVersion = 1
    static let catalogueHash = "28f342b2cfe60f611573de432173b20e0f71d4699a0d2fd9de910b011dc15aea"
    let protocolVersion: Int
    let code: String
    let matchId: String
    let revision: Int
    let serverTime: Int64
    let expiresAt: Int64
    let catalogVersion: Int
    let catalogHash: String
    let role: LiveRoomRole
    let viewer: LiveRoomIdentity
    let phase: LiveRoomPhase
    let joinLocked: Bool
    let settings: LiveRoomSettings
    let hostConnected: Bool
    let players: [LiveRoomPlayer]
    let round: LiveRoomRound?
    let reveal: LiveRoomReveal?
    let leaderboard: [LiveRoomStanding]
    let completion: LiveRoomCompletion?
    let notice: String?
    let mode: String?
    let modeVersion: Int?
    let quiz: LiveQuizSummary?
    let quizRound: LiveQuizRound?
    let quizReveal: LiveQuizReveal?

    private enum CodingKeys: String, CodingKey {
        case protocolVersion, code, matchId, revision, serverTime, expiresAt, catalogVersion, catalogHash, role
        case viewer = "self"
        case phase, joinLocked, settings, hostConnected, players, round, reveal, leaderboard, completion, notice
        case mode, modeVersion, quiz
    }

    var isQuiz: Bool { protocolVersion == 2 && mode == "quiz" && modeVersion == 1 }
    var activeRoundID: String? { isQuiz ? quizRound?.id : round?.id }
    var roundIndex: Int? { isQuiz ? quizRound?.index : round?.index }
    var roundTotal: Int? { isQuiz ? quizRound?.total : round?.total }
    var isSubject: Bool { role == .player && round?.subjectId == viewer.id }
    var ownLockedValue: Int? { isQuiz ? quizRound?.ownAnswer : (isSubject ? round?.ownAnswer : round?.ownGuess) }
    var canSubmit: Bool {
        if isQuiz { return role == .player && phase == .answer && quizRound?.ownAnswer == nil && quizRound != nil }
        guard role == .player, let round, !round.paused else { return false }
        return (phase == .answer && isSubject && round.ownAnswer == nil) ||
            (phase == .predict && !isSubject && round.ownGuess == nil)
    }

    func validated(code expectedCode: String? = nil, memberId: String? = nil) throws -> Self {
        if isQuiz { return try validatedQuiz(code: expectedCode, memberId: memberId) }
        guard protocolVersion == 1 else { throw LiveRoomValidationError.unsupportedProtocol }
        guard catalogVersion == Self.catalogueVersion, catalogHash == Self.catalogueHash else {
            throw LiveRoomValidationError.catalogueMismatch
        }
        guard Self.validCode(code), expectedCode == nil || code == expectedCode,
              memberId == nil || viewer.id == memberId else { throw LiveRoomValidationError.unexpectedRoom }
        guard !matchId.isEmpty, matchId.count <= 100, revision >= 0, serverTime >= 0, expiresAt > serverTime,
              settings.isValid, players.count <= settings.capacity,
              Set(players.map(\.id)).count == players.count,
              players.allSatisfy({ !$0.id.isEmpty && Self.safeNickname($0.nickname) && (1...5).contains($0.avatar) }),
              Self.safeNickname(viewer.nickname),
              (role == .host ? viewer.id == "host" : players.contains(where: { $0.id == viewer.id })),
              leaderboard.count <= settings.capacity,
              Set(leaderboard.map(\.playerId)).count == leaderboard.count,
              leaderboard.allSatisfy({ Self.safeNickname($0.nickname) && $0.points >= 0 && $0.opportunities >= 0 && Self.validAccuracy($0.accuracy) && ($0.rank == nil || $0.rank! > 0) }),
              notice.map({ $0.count <= 1_000 }) ?? true else { throw LiveRoomValidationError.invalidState }
        if phase == .lobby {
            guard round == nil, reveal == nil, completion == nil else { throw LiveRoomValidationError.invalidState }
        }
        if phase == .answer || phase == .predict || phase == .reveal {
            guard round != nil, completion == nil else { throw LiveRoomValidationError.invalidState }
        }
        if phase == .finished, completion == nil { throw LiveRoomValidationError.invalidState }
        if phase == .reveal, reveal == nil { throw LiveRoomValidationError.invalidState }
        if let round {
            guard !round.id.isEmpty, (1...150).contains(round.total), (1...round.total).contains(round.index),
                  !round.subjectId.isEmpty, Self.safeNickname(round.subjectName),
                  (1001...2000).contains(round.prompt.id), Self.topicsContain(round.prompt.topic),
                  (1...240).contains(round.prompt.text.count), (1...500).contains(round.prompt.sceneSummary.count),
                  round.eligibleCount >= 0, round.eligibleCount <= 49,
                  round.submittedCount >= 0, round.submittedCount <= round.eligibleCount,
                  Self.validChoice(round.ownAnswer), Self.validChoice(round.ownGuess) else { throw LiveRoomValidationError.invalidState }
            if role == .host {
                guard round.ownAnswer == nil, round.ownGuess == nil else { throw LiveRoomValidationError.secretProjection }
            } else if isSubject {
                guard round.ownGuess == nil else { throw LiveRoomValidationError.secretProjection }
            } else {
                guard round.ownAnswer == nil, phase != .answer || round.ownGuess == nil else {
                    throw LiveRoomValidationError.secretProjection
                }
            }
            if phase == .answer || phase == .predict, reveal != nil { throw LiveRoomValidationError.secretProjection }
        }
        if let reveal {
            guard phase == .reveal || phase == .finished, Self.validChoice(reveal.answer),
                  Self.validAccuracy(reveal.groupAccuracy), reveal.guesses.count <= 49,
                  reveal.guesses.allSatisfy({ Self.safeNickname($0.nickname) && Self.validChoice($0.value) && (0...100).contains($0.points) }) else {
                throw LiveRoomValidationError.invalidState
            }
            guard reveal.valid ? reveal.answer != nil : reveal.answer == nil else { throw LiveRoomValidationError.secretProjection }
            if !reveal.valid {
                guard reveal.groupAccuracy == nil, reveal.guesses.allSatisfy({ $0.value == nil && $0.points == 0 }),
                      round?.ownAnswer == nil, round?.ownGuess == nil else { throw LiveRoomValidationError.secretProjection }
            }
        }
        return self
    }

    static func normalizedCode(_ input: String) -> String {
        input.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }
    static func validCode(_ code: String) -> Bool {
        code.utf8.count == 6 && code.utf8.allSatisfy { (65...90).contains($0) || (48...57).contains($0) }
    }
    static func validNickname(_ name: String) -> Bool {
        guard (1...20).contains(name.unicodeScalars.count), name.utf8.count <= 80 else { return false }
        let permitted = CharacterSet.letters.union(.decimalDigits).union(.nonBaseCharacters).union(CharacterSet(charactersIn: " '\u{2019}_-"))
        return name.unicodeScalars.allSatisfy { permitted.contains($0) } && name.unicodeScalars.contains { CharacterSet.letters.contains($0) || CharacterSet.decimalDigits.contains($0) }
    }
    private static func validChoice(_ value: Int?) -> Bool { value == nil || (1...5).contains(value!) }
    private static func validAccuracy(_ value: Double?) -> Bool { value == nil || (value!.isFinite && (0...100).contains(value!)) }
    private static func topicsContain(_ topic: String) -> Bool { topic != "mix" && LiveRoomSettings.topics.contains(topic) }
    private static func safeNickname(_ name: String) -> Bool {
        !name.isEmpty && name.count <= 20 && name.utf8.count <= 80 &&
        !name.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
}

struct LiveRoomAdmission: Codable, Sendable {
    let code: String
    let token: String
    let memberId: String
    let state: LiveRoomState
}
struct LiveRoomStateResponse: Decodable, Sendable { let state: LiveRoomState }
struct LiveRoomAPIError: Codable, Equatable, Sendable { let code: String; let message: String }
struct LiveRoomErrorResponse: Decodable { let error: LiveRoomAPIError }
struct LiveRoomSocketMessage: Decodable { let type: String; let state: LiveRoomState?; let error: LiveRoomAPIError? }

enum LiveRoomAction: String, Codable, Sendable {
    case start, next, pause, resume, skip, lock, kick, end, rematch, close, answer, guess, leave, heartbeat
    case quizAnswer = "quiz-answer", quizReveal = "quiz-reveal"
}
struct LiveRoomCommand: Codable, Equatable, Sendable {
    let requestId: UUID
    let matchId: String
    let roundId: String?
    let action: LiveRoomAction
    let value: Int?
    let locked: Bool?
    let playerId: String?
    let expectedRevision: Int?

    init(state: LiveRoomState, action: LiveRoomAction, value: Int? = nil, locked: Bool? = nil, playerId: String? = nil) {
        requestId = UUID(); matchId = state.matchId
        // Membership/room intents remain valid if another player advances the
        // round while their confirmation is open. Choices still bind to a round.
        roundId = [.answer, .guess, .quizAnswer, .quizReveal, .next, .pause, .resume, .skip].contains(action) ? state.activeRoundID : nil
        self.action = action; self.value = value; self.locked = locked; self.playerId = playerId
        // Independent guest locks are concurrent; a whole-room revision would reject valid peers.
        expectedRevision = nil
    }
}
