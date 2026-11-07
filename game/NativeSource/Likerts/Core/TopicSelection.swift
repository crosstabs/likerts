import Foundation

struct TopicHistory: Codable, Equatable, Sendable {
    static let currentVersion = 2
    var version = currentVersion
    var seen: [String: [Int]] = [:]
    var recent: [String: [Int]] = [:]
    /// Global order matters for mixed-topic packs and the next app launch.
    /// IDs resolve through the current authored catalogue, not random effects.
    var recentPresentations: [Int] = []

    init() {}
    private enum CodingKeys: String, CodingKey { case version, seen, recent, recentPresentations }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let storedVersion = try values.decode(Int.self, forKey: .version)
        version = storedVersion == 1 ? Self.currentVersion : storedVersion
        seen = try values.decode([String: [Int]].self, forKey: .seen)
        recent = try values.decode([String: [Int]].self, forKey: .recent)
        recentPresentations = try values.decodeIfPresent([Int].self, forKey: .recentPresentations) ?? []
    }
}

protocol TopicHistoryStore: AnyObject {
    func load() -> TopicHistory
    func save(_ history: TopicHistory)
}

final class UserDefaultsTopicHistoryStore: TopicHistoryStore {
    private let defaults: UserDefaults
    private let key: String
    init(defaults: UserDefaults = .standard, key: String = "likerts.topic-history.v1") {
        self.defaults = defaults
        self.key = key
    }
    func load() -> TopicHistory {
        guard let data = defaults.data(forKey: key), data.count <= 64_000,
              let history = try? JSONDecoder().decode(TopicHistory.self, from: data),
              history.version == TopicHistory.currentVersion else { return TopicHistory() }
        return history
    }
    func save(_ history: TopicHistory) {
        guard let data = try? JSONEncoder().encode(history), data.count <= 64_000 else { return }
        defaults.set(data, forKey: key)
    }
}

final class MemoryTopicHistoryStore: TopicHistoryStore {
    private(set) var history: TopicHistory
    init(history: TopicHistory = TopicHistory()) { self.history = history }
    func load() -> TopicHistory { history }
    func save(_ history: TopicHistory) { self.history = history }
}

enum TopicSelectionError: Error, Equatable { case invalidCount, emptyTopic }

/// Serial, owner-managed selection state. The app owns this on its UI actor.
/// Selecting marks a pack seen, even if the player later cancels the game.
final class TopicDeckSelector {
    /// Version3 directs actual authored motion signatures. Seeds remain stable
    /// for a fixed catalogue, history and director version; this is not a wire format.
    static let directorVersion = 3
    private let catalog: TopicCatalog
    private let store: any TopicHistoryStore
    private var history: TopicHistory
    private let motionSignatures: [Int: MotionPresentationSignature]
    private let hasCompleteMotionCatalogue: Bool

    init(catalog: TopicCatalog, store: any TopicHistoryStore = UserDefaultsTopicHistoryStore(),
         motionSignatures: [Int: MotionPresentationSignature]? = nil) {
        self.catalog = catalog
        self.store = store
        self.history = Self.sanitized(store.load(), catalog: catalog)
        let ids = Set(catalog.allRounds.map(\.id))
        let authored = motionSignatures ?? (ids == Set(1001...2000)
            ? Dictionary(uniqueKeysWithValues: MotionProductionLibrary.all.map { ($0.roundID, $0.signature) }) : [:])
        self.motionSignatures = authored.filter { ids.contains($0.key) }
        self.hasCompleteMotionCatalogue = !ids.isEmpty && ids.isSubset(of: Set(authored.keys))
    }

    func select(topic: TopicID?, seed: UInt64) throws -> [TopicRound] {
        try draw(topic: topic, count: 5, seed: seed)
    }

    /// A received pack is a real presentation too. Registration never starts
    /// a new cycle; drawing alone owns exhaustion and boundary repeat rules.
    func recordPresented(ids: [Int]) {
        var registered = Set<Int>()
        for id in ids {
            guard registered.insert(id).inserted, let round = catalog.round(id: id) else { continue }
            let key = round.topic.rawValue
            if !(history.seen[key] ?? []).contains(id) { history.seen[key, default: []].append(id) }
            var recent = history.recent[key] ?? []
            recent.removeAll { $0 == id }; recent.append(id)
            history.recent[key] = Array(recent.suffix(min(10, max(0, catalog.rounds(for: round.topic).count - 1))))
            history.recentPresentations.removeAll { $0 == id }
            history.recentPresentations.append(id)
            history.recentPresentations = Array(history.recentPresentations.suffix(12))
        }
        store.save(history)
    }

    /// Same seed + same catalog + same history yields the same selection.
    /// A nil topic selects from different topics before revisiting any topic.
    func draw(topic: TopicID?, count: Int = 5, seed: UInt64) throws -> [TopicRound] {
        guard count > 0, count <= 50 else { throw TopicSelectionError.invalidCount }
        var random = TopicSeededGenerator(seed: seed)
        let selected: [TopicRound]
        if let topic {
            selected = try drawOneTopic(topic, count: count, discoverStory: count == 5 && !hasCompleteMotionCatalogue, random: &random)
        } else {
            let available = TopicID.allCases.filter { !catalog.rounds(for: $0).isEmpty }
            guard !available.isEmpty, count <= catalog.allRounds.count else { throw TopicSelectionError.emptyTopic }
            var result: [TopicRound] = []
            var usedTopics = Set<TopicID>()
            // One discovery slot makes the bounded story upgrade visible in
            // quick play without hiding the rest of the catalogue. Eligibility
            // still comes from the current unseen cycle, never an early reset.
            if count == 5 && !hasCompleteMotionCatalogue {
                let pilots = available.filter { hasEligibleStory(in: $0) }
                if let topic = shuffled(pilots, random: &random).first {
                    result += try drawOneTopic(topic, count: 1, discoverStory: true, random: &random)
                    usedTopics.insert(topic)
                }
            }
            while result.count < count {
                let remainingTopics = available.filter { !usedTopics.contains($0) }
                if remainingTopics.isEmpty { usedTopics = []; continue }
                for id in shuffled(remainingTopics, random: &random) {
                    let excluded = Set(result.map(\.id))
                    let next = try drawOneTopic(id, count: 1, excluding: excluded, packContext: result, random: &random)
                    result += next
                    usedTopics.insert(id)
                    if result.count == count { break }
                }
            }
            selected = result
        }
        store.save(history)
        return selected
    }

    private func drawOneTopic(_ topic: TopicID, count: Int, excluding: Set<Int> = [], packContext: [TopicRound] = [], discoverStory: Bool = false,
                              random: inout TopicSeededGenerator) throws -> [TopicRound] {
        let rounds = catalog.rounds(for: topic)
        guard !rounds.isEmpty else { throw TopicSelectionError.emptyTopic }
        guard count <= rounds.count - rounds.filter({ excluding.contains($0.id) }).count else {
            throw TopicSelectionError.invalidCount
        }
        let key = topic.rawValue
        var seen = history.seen[key] ?? []
        var recent = history.recent[key] ?? []
        var chosen: [TopicRound] = []
        var boundaryRecent = Set<Int>()
        while chosen.count < count {
            let unavailable = Set(seen).union(excluding).union(chosen.map(\.id))
            var candidates = rounds.filter { !unavailable.contains($0.id) }
            if candidates.isEmpty {
                // Complete cycles contain every question and therefore every
                // semantic scene exactly once. Keep recent items out of the
                // next cycle while enough alternatives exist.
                seen = []
                boundaryRecent = Set(recent)
                let forbidden = excluding.union(chosen.map(\.id))
                candidates = rounds.filter { !forbidden.contains($0.id) }
            }
            let fresh = candidates.filter { !boundaryRecent.contains($0.id) }
            if !fresh.isEmpty { candidates = fresh }
            // Preferences apply only after exhaustion/recent-boundary eligibility.
            // They can relax when the remaining deck cannot satisfy all goals;
            // never repeat a question early merely to obtain a prettier pack.
            let context = packContext + chosen
            if discoverStory && !context.contains(where: { VignetteBank.spec(id: $0.id) != nil }) {
                let storyCandidates = candidates.filter { VignetteBank.spec(id: $0.id) != nil }
                if !storyCandidates.isEmpty { candidates = storyCandidates }
            }
            let scores = candidates.map { presentationScore($0, context: context, recent: recent) }
            guard let minimum = scores.min() else { throw TopicSelectionError.emptyTopic }
            let preferred = zip(candidates, scores).filter { $0.1 == minimum }.map(\.0)
            guard let next = shuffled(preferred, random: &random).first else { throw TopicSelectionError.emptyTopic }
            chosen.append(next)
            seen.append(next.id)
            recent.removeAll { $0 == next.id }
            recent.append(next.id)
            recent = Array(recent.suffix(min(10, max(0, rounds.count - 1))))
            history.recentPresentations.removeAll { $0 == next.id }
            history.recentPresentations.append(next.id)
            history.recentPresentations = Array(history.recentPresentations.suffix(12))
        }
        history.seen[key] = seen
        history.recent[key] = recent
        return chosen
    }

    private func hasEligibleStory(in topic: TopicID) -> Bool {
        let rounds = catalog.rounds(for: topic)
        let seen = Set(history.seen[topic.rawValue] ?? [])
        let unseen = rounds.filter { !seen.contains($0.id) }
        // A fully consumed cycle is allowed to restart normally; a partially
        // consumed cycle must not repeat its already-seen rich records.
        var eligible = unseen.isEmpty ? rounds : unseen
        if unseen.isEmpty {
            let recent = Set(history.recent[topic.rawValue] ?? [])
            let fresh = eligible.filter { !recent.contains($0.id) }
            if !fresh.isEmpty { eligible = fresh }
        }
        return eligible.contains { VignetteBank.spec(id: $0.id) != nil }
    }

    private func presentationScore(_ round: TopicRound, context: [TopicRound], recent: [Int]) -> Int {
        if let candidate = motionSignatures[round.id] {
            let inPack = context.compactMap { motionSignatures[$0.id] }
            let recentMotion = history.recentPresentations.compactMap { motionSignatures[$0] }
            let previous = inPack.last ?? recentMotion.last
            // These preferences are below question eligibility. They may relax
            // near deck exhaustion, but can never force an early question repeat.
            var score = 0
            if inPack.contains(where: { $0.family == candidate.family }) { score += 120 }
            if inPack.contains(where: { sameObjects($0, candidate) }) { score += 150 }
            if previous?.recipe == candidate.recipe { score += 70 }
            if previous?.framing == candidate.framing { score += 35 }
            if previous?.family == candidate.family { score += 55 }
            if recentMotion.suffix(3).contains(where: { $0.family == candidate.family }) { score += 18 }
            if recentMotion.suffix(3).contains(where: { $0.recipe == candidate.recipe }) { score += 12 }
            if recentMotion.suffix(8).contains(where: { sameObjects($0, candidate) }) { score += 25 }
            return score
        }
        let candidate = VignetteBank.profile(for: round)
        let inPack = context.map { VignetteBank.profile(for: $0) }
        let recentProfiles = recent.suffix(5).compactMap { catalog.round(id: $0) }.map { VignetteBank.profile(for: $0) }
        let previous = inPack.last ?? recentProfiles.last
        var score = 0
        if inPack.contains(where: { $0.family == candidate.family }) { score += 100 }
        if inPack.contains(where: { $0.objectPair == candidate.objectPair }) { score += 120 }
        if previous?.framing == candidate.framing { score += 35 }
        if previous?.family == candidate.family { score += 55 }
        if recentProfiles.contains(where: { $0.objectPair == candidate.objectPair }) { score += 25 }
        if recentProfiles.suffix(2).contains(where: { $0.family == candidate.family }) { score += 6 }
        if candidate.isVignette && inPack.contains(where: \.isVignette) { score += 40 }
        return score
    }

    private func sameObjects(_ first: MotionPresentationSignature, _ second: MotionPresentationSignature) -> Bool {
        // Order must not disguise the same pair exchanged in the other direction.
        Set(first.objectPair) == Set(second.objectPair)
    }

    private static func sanitized(_ value: TopicHistory, catalog: TopicCatalog) -> TopicHistory {
        guard value.version == TopicHistory.currentVersion else { return TopicHistory() }
        var clean = TopicHistory()
        for topic in TopicID.allCases {
            let valid = Set(catalog.rounds(for: topic).map(\.id))
            func deduplicated(_ values: [Int]) -> [Int] {
                var included = Set<Int>()
                return values.filter { valid.contains($0) && included.insert($0).inserted }
            }
            clean.seen[topic.rawValue] = Array(deduplicated(value.seen[topic.rawValue] ?? []).suffix(50))
            clean.recent[topic.rawValue] = Array(deduplicated(value.recent[topic.rawValue] ?? []).suffix(min(10, max(0, valid.count - 1))))
        }
        let validIDs = Set(catalog.allRounds.map(\.id))
        var included = Set<Int>()
        clean.recentPresentations = Array(value.recentPresentations.reversed().filter {
            validIDs.contains($0) && included.insert($0).inserted
        }.prefix(12).reversed())
        return clean
    }

    private func shuffled<T>(_ values: [T], random: inout TopicSeededGenerator) -> [T] {
        guard values.count > 1 else { return values }
        var result = values
        for index in stride(from: result.count - 1, through: 1, by: -1) {
            // Rejection sampling avoids modulo bias and never relies on Swift's
            // implementation-defined random/shuffle sequence.
            let bound = UInt64(index + 1)
            let limit = UInt64.max - UInt64.max % bound
            var value = random.next()
            while value >= limit { value = random.next() }
            result.swapAt(index, Int(value % bound))
        }
        return result
    }
}

private struct TopicSeededGenerator {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var value = state
        value = (value ^ (value >> 30)) &* 0xBF58476D1CE4E5B9
        value = (value ^ (value >> 27)) &* 0x94D049BB133111EB
        return value ^ (value >> 31)
    }
}
