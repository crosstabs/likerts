import Foundation
import Observation

@MainActor @Observable
final class GameSession {
    enum Phase: String, Hashable { case answering, sealed, dailyIntro, guessing, result }
    /// Stable only for this local game instance; it never encodes an answer.
    let audioSessionID = UUID()
    @ObservationIgnored var onSnapshot: ((StandaloneGameSnapshot) -> Void)?
    var phase: Phase
    var name: String
    let prompts: [Prompt]
    let daily: DailyPuzzle?
    let pack: PromptPack?
    let topic: TopicID?
    private(set) var challenge: Challenge?
    var answerChoices: [Int?] = Array(repeating: nil, count: 5)
    var guesses: [Int?] = Array(repeating: nil, count: 5)
    var index = 0
    var revealed = false

    init(name: String, pack: PromptPack? = nil, topic: TopicID? = nil, preparedRounds: [TopicRound]? = nil) {
        self.name = name
        self.pack = pack
        self.topic = topic
        self.prompts = pack.map { pack in
            pack.statements.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: pack.theme.emoji) }
        } ?? {
            let curated = (preparedRounds ?? TopicPlayLibrary.draw(topic: topic)).map(\.prompt)
            return curated.count == 5 ? curated : PromptBank.randomSet()
        }()
        self.daily = nil
        self.phase = .answering
    }

    init(challenge: Challenge, daily: DailyPuzzle? = nil) {
        self.name = challenge.name
        self.prompts = challenge.resolvedPrompts
        self.pack = nil
        let resolvedTopics = challenge.promptIDs.compactMap { TopicPlayLibrary.round(id: $0)?.topic }
        let topics = Set(resolvedTopics)
        // Classic questions are valid in LK3, but cannot inherit a curated
        // topic from the remaining questions: persisted topics apply to all five.
        self.topic = resolvedTopics.count == challenge.promptIDs.count && topics.count == 1 ? topics.first : nil
        self.challenge = challenge
        self.daily = daily
        self.phase = daily == nil ? .guessing : .dailyIntro
    }

    /// Reconstruct only after every persisted invariant has been checked.
    init?(snapshot: StandaloneGameSnapshot) {
        guard let checked = try? snapshot.validate(), let phase = Phase(rawValue: snapshot.phase) else { return nil }
        self.phase = phase; self.name = snapshot.name; self.prompts = snapshot.prompts
        self.daily = checked.daily; self.pack = checked.pack; self.topic = checked.topic
        self.challenge = checked.challenge; self.answerChoices = snapshot.answers
        self.guesses = snapshot.guesses; self.index = snapshot.index; self.revealed = snapshot.revealed
    }

    var snapshot: StandaloneGameSnapshot {
        StandaloneGameSnapshot(phase: phase.rawValue, name: name, prompts: prompts,
            packTheme: pack?.theme.rawValue,
            packSource: pack?.source.rawValue, packCatalogVersion: pack?.catalogVersion,
            topic: topic?.rawValue, dailyKey: daily?.key,
            challengeCode: challenge.map(ChallengeCodec.encode), answers: answerChoices,
            guesses: guesses, index: index, revealed: revealed)
    }

    var packLabel: String? {
        if let pack { return "\(pack.source.title) · \(pack.theme.title)" }
        if prompts.contains(where: { $0.id >= 1001 }) { return "Curated · \(topic?.definition.title ?? "Mixed topics")" }
        return challenge?.isCustom == true ? "Friend's custom pack" : nil
    }
    var selection: Int? { phase == .answering ? answerChoices[index] : guesses[index] }
    var correctAnswer: Int? { challenge?.answers[index] }
    var roundPoints: Int { Scoring.points(guess: guesses[index] ?? 1, answer: correctAnswer ?? 1) }
    var score: Int { Scoring.total(guesses: guesses.compactMap { $0 }, answers: challenge?.answers ?? []) }
    var exactCount: Int {
        guard let challenge else { return 0 }
        return zip(guesses, challenge.answers).filter { $0.0 == $0.1 }.count
    }
    var title: String { Scoring.title(for: score) }

    func select(_ value: Int) {
        guard (1...5).contains(value), !revealed else { return }
        if phase == .answering { answerChoices[index] = value } else { guesses[index] = value }
        onSnapshot?(snapshot)
    }
    func back() {
        guard phase == .answering, index > 0 else { return }
        index -= 1
        onSnapshot?(snapshot)
    }
    func next() {
        guard selection != nil else { return }
        if phase == .answering {
            if index < 4 { index += 1 } else {
                let values = answerChoices.compactMap { $0 }
                let sealed: Challenge?
                if pack != nil { sealed = try? Challenge(name: name, prompts: prompts, answers: values) }
                else { sealed = try? Challenge(name: name, promptIDs: prompts.map(\.id), answers: values) }
                guard let sealed else { return }
                challenge = sealed
                phase = .sealed
                index = 0
            }
        } else if phase == .guessing {
            if !revealed {
                revealed = true
                Feel.reveal(exact: roundPoints == 100)
            } else if index < 4 {
                index += 1; revealed = false
            } else { phase = .result }
        }
        onSnapshot?(snapshot)
    }
    func beginGuessing() { index = 0; revealed = false; phase = .guessing; onSnapshot?(snapshot) }
}

@MainActor enum TopicPlayLibrary {
    static var catalog: TopicCatalog? { try? TopicCatalog.bundled.get() }
    static func round(id: Int) -> TopicRound? { catalog?.round(id: id) }
    static func recordPresented(ids: [Int]) {
        guard let catalog else { return }
        TopicDeckSelector(catalog: catalog, store: UserDefaultsTopicHistoryStore()).recordPresented(ids: ids)
    }
    static func prepare(topic: TopicID?) throws -> [TopicRound] {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-topic-draw-failure") {
            throw TopicSelectionError.emptyTopic
        }
        #endif
        let catalog = try TopicCatalog.bundled.get()
        let store = UserDefaultsTopicHistoryStore()
        return try TopicDeckSelector(catalog: catalog, store: store).draw(topic: topic, count: 5, seed: UInt64.random(in: 0...UInt64.max))
    }
    /// One-tap quick play remains available with original prompts if the bundled
    /// topic library cannot load. Explicit topic choices use prepare instead.
    static func draw(topic: TopicID?) -> [TopicRound] { (try? prepare(topic: topic)) ?? [] }
}
