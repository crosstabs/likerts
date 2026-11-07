import Foundation

enum PartyBoardError: Error, Equatable, LocalizedError {
    case invalidName
    case invalidGuesses
    case playerLimit
    case unknownRun

    var errorDescription: String? {
        switch self {
        case .invalidName: return "Try another playful nickname: up to 20 characters, with no contact details or sensitive words."
        case .invalidGuesses: return "Finish five guesses between 1 and 5 before adding a score."
        case .playerLimit: return "This board has room for 12 friends. Replay a turn or clear the scores."
        case .unknownRun: return "That player is no longer on this board. Start a new turn."
        }
    }
}

/// One enrolled player's latest completed attempt. Replaying retains identity;
/// an unfinished attempt never enters or changes the board.
struct PartyRun: Identifiable, Equatable, Sendable {
    let id: UUID
    let name: String
    let displayName: String
    let guesses: [Int]
    let score: Int
    let exactCount: Int
    let attemptCount: Int
    let insight: RoundInsight
}

struct PartyStanding: Identifiable, Equatable, Sendable {
    let rank: Int
    let run: PartyRun
    let isTied: Bool
    var id: UUID { run.id }
}

/// A local, in-memory board for one immutable five-take challenge. It records
/// completed attempts only and has no persistence, account or remote ranking.
struct PartyBoard: Equatable, Sendable {
    static let maximumPlayers = 12
    let challenge: Challenge
    private(set) var runs: [PartyRun] = []

    init(challenge: Challenge) { self.challenge = challenge }

    /// Validate before starting a turn. The next default name follows enrollment
    /// order; the completed run gets a collision-free display name on enrollment.
    func validatedName(_ rawName: String) throws -> String {
        try Self.normalize(rawName, fallback: "Friend \(runs.count + 1)")
    }

    var standings: [PartyStanding] {
        let sorted = runs.enumerated().sorted { lhs, rhs in
            if lhs.element.score != rhs.element.score { return lhs.element.score > rhs.element.score }
            return lhs.offset < rhs.offset
        }.map(\.element)
        let counts = Dictionary(grouping: sorted, by: \.score).mapValues(\.count)
        var rank = 0
        var previousScore: Int?
        return sorted.enumerated().map { position, run in
            if run.score != previousScore { rank = position + 1 }
            previousScore = run.score
            return PartyStanding(rank: rank, run: run, isTied: (counts[run.score] ?? 0) > 1)
        }
    }

    /// A replay replaces the same enrollment in place, using its latest score.
    /// Its original name/display name remain stable; renaming is not a replay action.
    @discardableResult
    mutating func complete(name: String, guesses: [Int], replacing id: UUID? = nil) throws -> PartyRun {
        let existingIndex: Int?
        if let id {
            guard let index = runs.firstIndex(where: { $0.id == id }) else { throw PartyBoardError.unknownRun }
            existingIndex = index
        } else {
            guard runs.count < Self.maximumPlayers else { throw PartyBoardError.playerLimit }
            existingIndex = nil
        }
        let existing = existingIndex.map { runs[$0] }
        let normalized = try Self.normalize(name, fallback: existing?.name ?? "Friend \(runs.count + 1)")
        let insight: RoundInsight
        do { insight = try RoundInsight(challenge: challenge, guesses: guesses) }
        catch { throw PartyBoardError.invalidGuesses }
        let run = PartyRun(
            id: existing?.id ?? UUID(),
            name: existing?.name ?? normalized,
            displayName: existing?.displayName ?? uniqueDisplayName(for: normalized),
            guesses: guesses,
            score: Scoring.total(guesses: guesses, answers: challenge.answers),
            exactCount: zip(guesses, challenge.answers).filter { $0.0 == $0.1 }.count,
            attemptCount: (existing?.attemptCount ?? 0) + 1,
            insight: insight
        )
        // All throwing validation finishes before the single board mutation.
        if let existingIndex { runs[existingIndex] = run }
        else { runs.append(run) }
        return run
    }

    mutating func clearScores() { runs.removeAll() }

    private func uniqueDisplayName(for name: String) -> String {
        let occupied = Set(runs.map { Self.nameKey($0.displayName) })
        var candidate = name
        var suffix = 1
        while occupied.contains(Self.nameKey(candidate)) {
            suffix += 1
            candidate = "\(name) · \(suffix)"
        }
        return candidate
    }

    private static func nameKey(_ name: String) -> String {
        name.folding(options: [.caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }

    private static func normalize(_ rawName: String, fallback: String) throws -> String {
        let collapsed = rawName.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let name = collapsed.isEmpty ? fallback : collapsed
        let emojiFormatting: Set<UInt32> = [0x200C, 0x200D, 0xFE0E, 0xFE0F]
        guard name.count <= 20, name.utf8.count <= 80, PackValidator.permitsSharedMetadata(name),
              !name.unicodeScalars.contains(where: {
                  CharacterSet.controlCharacters.contains($0) && !emojiFormatting.contains($0.value)
              }) else { throw PartyBoardError.invalidName }
        return name
    }
}
