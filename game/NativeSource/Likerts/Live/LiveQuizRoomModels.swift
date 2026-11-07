import Foundation

/// Public quiz projections never contain the creator document or future questions.
struct LiveQuizSummary: Codable, Equatable, Sendable {
    let id: String
    let title: String
    let questionCount: Int
}
struct LiveQuizSettings: Codable, Equatable, Sendable { let capacity: Int }
struct LiveQuizAdmissionPayload: Codable, Equatable, Sendable {
    static let maximumBytes = 69_632
    let admissionId: UUID
    let recoverySecret: String
    let mode: String
    let modeVersion: Int
    let quiz: QuizDocument
    let settings: LiveQuizSettings
}
struct LiveQuizRound: Codable, Equatable, Sendable {
    let id: String
    let index: Int
    let total: Int
    let questionId: String
    let prompt: String
    let answers: [String]
    let deadline: Int64?
    let submittedCount: Int
    let eligibleCount: Int
    let ownAnswer: Int?
    private enum CodingKeys: String, CodingKey { case id, index, total, questionId, prompt, answers, deadline, submittedCount, eligibleCount, ownAnswer }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(index, forKey: .index); try c.encode(total, forKey: .total)
        try c.encode(questionId, forKey: .questionId); try c.encode(prompt, forKey: .prompt); try c.encode(answers, forKey: .answers)
        try c.encode(deadline, forKey: .deadline); try c.encode(submittedCount, forKey: .submittedCount)
        try c.encode(eligibleCount, forKey: .eligibleCount); try c.encode(ownAnswer, forKey: .ownAnswer)
    }
}
struct LiveQuizReveal: Codable, Equatable, Sendable {
    let correctAnswer: Int?
    let explanation: String
    let valid: Bool
    let reason: String
    let results: [LiveRoomRevealedGuess]
    let groupAccuracy: Double?
    private enum CodingKeys: String, CodingKey { case correctAnswer, explanation, valid, reason, results, groupAccuracy }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(correctAnswer, forKey: .correctAnswer); try c.encode(explanation, forKey: .explanation)
        try c.encode(valid, forKey: .valid); try c.encode(reason, forKey: .reason); try c.encode(results, forKey: .results)
        try c.encode(groupAccuracy, forKey: .groupAccuracy)
    }
}

private enum LiveStateKeys: String, CodingKey {
    case protocolVersion, mode, modeVersion, code, matchId, revision, serverTime, expiresAt, catalogVersion, catalogHash
    case role, phase, joinLocked, settings, hostConnected, players, round, reveal, leaderboard, completion, notice, quiz
    case viewer = "self"
}

extension LiveRoomState {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: LiveStateKeys.self)
        protocolVersion = try values.decode(Int.self, forKey: .protocolVersion)
        mode = try values.decodeIfPresent(String.self, forKey: .mode)
        modeVersion = try values.decodeIfPresent(Int.self, forKey: .modeVersion)
        code = try values.decode(String.self, forKey: .code)
        matchId = try values.decode(String.self, forKey: .matchId)
        revision = try values.decode(Int.self, forKey: .revision)
        serverTime = try values.decode(Int64.self, forKey: .serverTime)
        expiresAt = try values.decode(Int64.self, forKey: .expiresAt)
        role = try values.decode(LiveRoomRole.self, forKey: .role)
        viewer = try values.decode(LiveRoomIdentity.self, forKey: .viewer)
        phase = try values.decode(LiveRoomPhase.self, forKey: .phase)
        joinLocked = try values.decode(Bool.self, forKey: .joinLocked)
        hostConnected = try values.decode(Bool.self, forKey: .hostConnected)
        players = try values.decode([LiveRoomPlayer].self, forKey: .players)
        leaderboard = try values.decode([LiveRoomStanding].self, forKey: .leaderboard)
        completion = try values.decodeIfPresent(LiveRoomCompletion.self, forKey: .completion)
        notice = try values.decodeIfPresent(String.self, forKey: .notice)
        if protocolVersion == 2 {
            guard mode == "quiz", modeVersion == 1 else { throw LiveRoomValidationError.unsupportedProtocol }
            let capacity = try values.decode(LiveQuizSettings.self, forKey: .settings).capacity
            settings = LiveRoomSettings(capacity: capacity)
            catalogVersion = 0; catalogHash = ""
            quiz = try values.decode(LiveQuizSummary.self, forKey: .quiz)
            quizRound = try values.decodeIfPresent(LiveQuizRound.self, forKey: .round)
            quizReveal = try values.decodeIfPresent(LiveQuizReveal.self, forKey: .reveal)
            round = nil; reveal = nil
        } else {
            guard protocolVersion == 1, mode == nil, modeVersion == nil else { throw LiveRoomValidationError.unsupportedProtocol }
            catalogVersion = try values.decode(Int.self, forKey: .catalogVersion)
            catalogHash = try values.decode(String.self, forKey: .catalogHash)
            settings = try values.decode(LiveRoomSettings.self, forKey: .settings)
            round = try values.decodeIfPresent(LiveRoomRound.self, forKey: .round)
            reveal = try values.decodeIfPresent(LiveRoomReveal.self, forKey: .reveal)
            quiz = nil; quizRound = nil; quizReveal = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: LiveStateKeys.self)
        try values.encode(protocolVersion, forKey: .protocolVersion)
        try values.encode(code, forKey: .code); try values.encode(matchId, forKey: .matchId)
        try values.encode(revision, forKey: .revision); try values.encode(serverTime, forKey: .serverTime)
        try values.encode(expiresAt, forKey: .expiresAt); try values.encode(role, forKey: .role)
        try values.encode(viewer, forKey: .viewer); try values.encode(phase, forKey: .phase)
        try values.encode(joinLocked, forKey: .joinLocked); try values.encode(hostConnected, forKey: .hostConnected)
        try values.encode(players, forKey: .players); try values.encode(leaderboard, forKey: .leaderboard)
        try values.encode(completion, forKey: .completion); try values.encode(notice, forKey: .notice)
        if isQuiz {
            try values.encode(mode, forKey: .mode); try values.encode(modeVersion, forKey: .modeVersion)
            try values.encode(LiveQuizSettings(capacity: settings.capacity), forKey: .settings)
            try values.encode(quiz, forKey: .quiz); try values.encode(quizRound, forKey: .round)
            try values.encode(quizReveal, forKey: .reveal)
        } else {
            try values.encode(catalogVersion, forKey: .catalogVersion); try values.encode(catalogHash, forKey: .catalogHash)
            try values.encode(settings, forKey: .settings); try values.encode(round, forKey: .round)
            try values.encode(reveal, forKey: .reveal)
        }
    }

    func validatedQuiz(code expectedCode: String?, memberId: String?) throws -> Self {
        guard isQuiz, let quiz, phase != .predict else { throw LiveRoomValidationError.unsupportedProtocol }
        guard Self.validCode(code), expectedCode == nil || code == expectedCode,
              memberId == nil || viewer.id == memberId else { throw LiveRoomValidationError.unexpectedRoom }
        guard Self.quizLiveID(matchId), revision >= 0, serverTime >= 0, expiresAt > serverTime,
              (2...50).contains(settings.capacity), Self.quizID(quiz.id),
              Self.quizText(quiz.title, maximum: 80), (1...30).contains(quiz.questionCount),
              players.count <= settings.capacity, Set(players.map(\.id)).count == players.count,
              players.allSatisfy({ Self.quizLiveID($0.id) && Self.validNickname($0.nickname) && (1...5).contains($0.avatar) }),
              Self.validNickname(viewer.nickname),
              (role == .host ? viewer.id == "host" : players.contains(where: { $0.id == viewer.id })),
              leaderboard.count <= settings.capacity, Set(leaderboard.map(\.playerId)).count == leaderboard.count,
              leaderboard.allSatisfy({ Self.validNickname($0.nickname) && Self.quizLiveID($0.playerId) &&
                  (0...30_000).contains($0.points) && $0.points.isMultiple(of: 1_000) &&
                  (0...quiz.questionCount).contains($0.opportunities) && $0.points <= $0.opportunities * 1_000 &&
                  Self.quizAccuracy($0.accuracy) && ($0.rank == nil || $0.rank! > 0) }),
              notice.map({ $0.count <= 1_000 }) ?? true else { throw LiveRoomValidationError.invalidState }
        if phase == .lobby {
            guard quizRound == nil, quizReveal == nil, completion == nil else { throw LiveRoomValidationError.invalidState }
        } else {
            guard quizRound != nil else { throw LiveRoomValidationError.invalidState }
        }
        if phase == .finished {
            guard completion != nil else { throw LiveRoomValidationError.invalidState }
        } else if completion != nil { throw LiveRoomValidationError.invalidState }
        if phase == .answer, quizReveal != nil { throw LiveRoomValidationError.secretProjection }
        if phase == .reveal, quizReveal == nil { throw LiveRoomValidationError.invalidState }
        if let current = quizRound {
            guard Self.quizLiveID(current.id),
                  current.total == quiz.questionCount, (1...current.total).contains(current.index),
                  Self.quizID(current.questionId), Self.quizText(current.prompt, maximum: 240, multiline: true),
                  (2...4).contains(current.answers.count), current.answers.allSatisfy({ Self.quizText($0, maximum: 100) }),
                  Set(current.answers).count == current.answers.count,
                  current.deadline == nil || current.deadline! >= 0,
                  (2...settings.capacity).contains(current.eligibleCount),
                  (0...current.eligibleCount).contains(current.submittedCount),
                  current.ownAnswer == nil || current.answers.indices.contains(current.ownAnswer!) else {
                throw LiveRoomValidationError.invalidState
            }
            if role == .host, current.ownAnswer != nil { throw LiveRoomValidationError.secretProjection }
            if let result = quizReveal {
                guard phase == .reveal || phase == .finished,
                      result.results.count == current.eligibleCount,
                      Set(result.results.map(\.playerId)).count == result.results.count,
                      result.results.allSatisfy({ Self.quizLiveID($0.playerId) && Self.validNickname($0.nickname) &&
                          ($0.value == nil || current.answers.indices.contains($0.value!)) && [0, 1_000].contains($0.points) }),
                      Self.quizAccuracy(result.groupAccuracy) else { throw LiveRoomValidationError.invalidState }
                if result.valid {
                    guard let answer = result.correctAnswer, current.answers.indices.contains(answer),
                          Self.quizText(result.explanation, maximum: 240, multiline: true, empty: true),
                          ["answered", "timeout", "host_revealed"].contains(result.reason),
                          result.groupAccuracy != nil,
                          result.results.allSatisfy({ $0.points == ($0.value == answer ? 1_000 : 0) }) else {
                        throw LiveRoomValidationError.invalidState
                    }
                } else {
                    guard result.correctAnswer == nil, result.explanation.isEmpty, ["host_ended", "player_left", "player_removed"].contains(result.reason),
                          result.groupAccuracy == nil, result.results.allSatisfy({ $0.value == nil && $0.points == 0 }),
                          current.ownAnswer == nil else { throw LiveRoomValidationError.secretProjection }
                }
            }
        }
        return self
    }

    private static func quizID(_ text: String) -> Bool { UUID(uuidString: text)?.uuidString.lowercased() == text }
    private static func quizLiveID(_ text: String) -> Bool {
        text.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil
    }
    private static func quizAccuracy(_ value: Double?) -> Bool { value == nil || (value!.isFinite && (0...100).contains(value!)) }
    private static func quizText(_ text: String, maximum: Int, multiline: Bool = false, empty: Bool = false) -> Bool {
        guard (empty || !text.isEmpty), text.unicodeScalars.count <= maximum,
              text.precomposedStringWithCanonicalMapping == text,
              text.trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n")) == text else { return false }
        return !text.unicodeScalars.contains { scalar in
            let value = scalar.value
            if value <= 31 || (127...159).contains(value) { return !(multiline && value == 10) }
            return !multiline && (value == 0x2028 || value == 0x2029)
        }
    }
}
