import Foundation

/// A bounded, versioned representation of a standalone game. Its answers are
/// private local data; this format is neither a share code nor encryption.
struct StandaloneGameSnapshot: Codable, Equatable {
    static let currentVersion = 1
    var version = currentVersion
    var phase: String
    var name: String
    var prompts: [Prompt]
    var packTheme: String?
    var packSource: String?
    var packCatalogVersion: Int? = nil
    var topic: String?
    var dailyKey: String?
    var challengeCode: String?
    var answers: [Int?]
    var guesses: [Int?]
    var index: Int
    var revealed: Bool

    struct Validated {
        let challenge: Challenge?
        let pack: PromptPack?
        let topic: TopicID?
        let daily: DailyPuzzle?
    }
    enum Invalid: Error { case snapshot }

    func validate() throws -> Validated {
        guard version == Self.currentVersion, (0..<5).contains(index), prompts.count == 5,
              Set(prompts.map(\.id)).count == 5, answers.count == 5, guesses.count == 5,
              (answers + guesses).allSatisfy({ $0.map { (1...5).contains($0) } ?? true }) else { throw Invalid.snapshot }
        // Reuse challenge validation to enforce nickname bounds and normalization.
        let nameCheck = try Challenge(name: name, promptIDs: [1, 2, 3, 4, 5], answers: [1, 1, 1, 1, 1])
        guard nameCheck.name == name else { throw Invalid.snapshot }
        let resolvedTopic: TopicID?
        if let topic { guard let value = TopicID(rawValue: topic) else { throw Invalid.snapshot }; resolvedTopic = value }
        else { resolvedTopic = nil }
        let resolvedPack: PromptPack?
        if let packTheme, let packSource {
            guard let theme = PackTheme(rawValue: packTheme), let source = Self.packSource(packSource),
                  prompts.map(\.id) == [201, 202, 203, 204, 205],
                  prompts.allSatisfy({ $0.emoji == theme.emoji }),
                  (try? PackValidator.validate(prompts.map(\.text))) == prompts.map(\.text),
                  resolvedTopic == nil else { throw Invalid.snapshot }
            if source == .onDeviceSelection {
                guard let packCatalogVersion,
                      (try? AIPreferenceCatalog.validate(prompts.map(\.text), theme: theme, version: packCatalogVersion)) != nil else { throw Invalid.snapshot }
            } else if packCatalogVersion != nil { throw Invalid.snapshot }
            resolvedPack = PromptPack(theme: theme, statements: prompts.map(\.text), source: source, catalogVersion: packCatalogVersion)
        } else if packTheme == nil && packSource == nil && packCatalogVersion == nil {
            resolvedPack = nil
        } else { throw Invalid.snapshot }
        let challenge = try challengeCode.map(ChallengeCodec.decode)
        if let challenge {
            guard challenge.name == name, challenge.resolvedPrompts == prompts else { throw Invalid.snapshot }
        }
        if resolvedPack == nil && challenge?.isCustom != true {
            guard prompts.allSatisfy({ PromptBank.prompt(id: $0.id) == $0 }) else { throw Invalid.snapshot }
        }
        if let resolvedTopic {
            guard prompts.allSatisfy({ id in
                guard case .success(let catalog) = TopicCatalog.bundled else { return false }
                return catalog.round(id: id.id)?.topic == resolvedTopic
            }) else { throw Invalid.snapshot }
        }
        let daily: DailyPuzzle?
        if let dailyKey {
            guard let date = Self.parseDay(dailyKey) else { throw Invalid.snapshot }
            let value = DailyPuzzle.today(date: date)
            guard value.key == dailyKey, challenge == value.challenge, resolvedPack == nil, resolvedTopic == nil else { throw Invalid.snapshot }
            daily = value
        } else { daily = nil }
        func prefixFilled(_ values: [Int?], to end: Int) -> Bool { values.prefix(end).allSatisfy { $0 != nil } }
        let answerMatches = answers.allSatisfy { $0 == nil } || answers.compactMap { $0 } == challenge?.answers
        switch phase {
        case "answering":
            guard challenge == nil, daily == nil, !revealed, guesses.allSatisfy({ $0 == nil }), prefixFilled(answers, to: index) else { throw Invalid.snapshot }
        case "sealed":
            guard let challenge, daily == nil, index == 0, !revealed,
                  answers.compactMap({ $0 }) == challenge.answers, guesses.allSatisfy({ $0 == nil }) else { throw Invalid.snapshot }
        case "dailyIntro":
            guard daily != nil, index == 0, !revealed, answers.allSatisfy({ $0 == nil }), guesses.allSatisfy({ $0 == nil }) else { throw Invalid.snapshot }
        case "guessing":
            guard challenge != nil, answerMatches, prefixFilled(guesses, to: index),
                  guesses.dropFirst(index + 1).allSatisfy({ $0 == nil }), !revealed || guesses[index] != nil else { throw Invalid.snapshot }
        case "result":
            guard challenge != nil, answerMatches, index == 4, revealed, guesses.allSatisfy({ $0 != nil }) else { throw Invalid.snapshot }
        default: throw Invalid.snapshot
        }
        return Validated(challenge: challenge, pack: resolvedPack, topic: resolvedTopic, daily: daily)
    }
    private static func packSource(_ raw: String) -> PackSource? {
        PackSource(rawValue: raw)
    }
    private static func parseDay(_ value: String) -> Date? {
        guard value.utf8.count == 10 else { return nil }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
        return date
    }
}
