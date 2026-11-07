import Foundation
import CryptoKit

enum QuizSceneNamespace: String, CaseIterable, Sendable { case library, editor, practice, live }
enum QuizScenePhase: String, CaseIterable, Sendable { case entered, lobby, answer, reveal, finished }

/// Scene identity accepts only controlled labels and opaque UUIDs. Creator text,
/// nicknames, room codes and access capabilities cannot be used as scene keys.
struct QuizSceneKey: Hashable, Sendable {
    let digest: String
    let journeyDigest: String
    private init(digest: String, journeyDigest: String) { self.digest = digest; self.journeyDigest = journeyDigest }

    static func make(namespace: QuizSceneNamespace, identifiers: [String], phase: QuizScenePhase) -> Self? {
        guard (1...4).contains(identifiers.count), identifiers.allSatisfy(validIdentifier) else { return nil }
        switch namespace {
        case .library, .editor: guard phase == .entered else { return nil }
        case .practice: guard [.answer, .reveal, .finished].contains(phase) else { return nil }
        case .live: guard [.lobby, .answer, .reveal, .finished].contains(phase) else { return nil }
        }
        let canonical = ([namespace.rawValue, phase.rawValue] + identifiers.map { $0.lowercased() }).joined(separator: "|")
        let digest = SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined()
        let journey = namespace.rawValue + "|" + identifiers[0].lowercased()
        let journeyDigest = SHA256.hash(data: Data(journey.utf8)).map { String(format: "%02x", $0) }.joined()
        return Self(digest: digest, journeyDigest: journeyDigest)
    }

    private static func validIdentifier(_ value: String) -> Bool {
        value.utf8.count == 36 && value.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", options: .regularExpression) != nil
    }
}

enum QuizSceneMotionPolicy {
    static func allowsMotion(systemReduceMotion: Bool, qaReducedMotion: Bool, testing: Bool, qaOptIn: Bool) -> Bool {
        !systemReduceMotion && !qaReducedMotion && (!testing || qaOptIn)
    }
}

/// This reducer schedules no work. The view owns one bounded animation and calls
/// finish from its completion. Identity guards reject stale animation callbacks.
struct QuizSceneMotionState: Equatable {
    enum Phase: Equatable { case idle, prepared, running, settled }
    static let duration = 0.36
    static let durationMilliseconds = 360
    private(set) var phase: Phase = .idle
    private(set) var keyDigest: String?
    var offsetY: CGFloat { phase == .prepared ? 6 : 0 }
    var opacity: Double { phase == .prepared ? 0.82 : 1 }

    /// Even a reduced/static first appearance consumes its key. Turning effects
    /// back on or recreating that phase must not introduce a delayed entrance.
    @discardableResult mutating func prepare(key: QuizSceneKey, allowed: Bool, consume: (QuizSceneKey) -> Bool) -> Bool {
        guard keyDigest != key.digest else { return false }
        keyDigest = key.digest; phase = .settled
        guard consume(key), allowed else { return false }
        phase = .prepared
        return true
    }

    @discardableResult mutating func begin(key: QuizSceneKey) -> Bool {
        guard keyDigest == key.digest, phase == .prepared else { return false }
        phase = .running
        return true
    }

    @discardableResult mutating func finish(key: QuizSceneKey) -> Bool {
        guard keyDigest == key.digest, phase == .running else { return false }
        phase = .settled
        return true
    }

    mutating func cancel() { phase = .settled }
    mutating func reduceMotionChanged(_ reduced: Bool) { if reduced { cancel() } }
}

@MainActor protocol QuizSceneMotionStoring {
    func read() throws -> Data?
    func write(_ data: Data) throws
}

private enum QuizSceneStorageError: Error { case invalid, unavailable }

/// The only stored payload is bounded versioned history of SHA-256 hashes.
/// Readback is verified before an animation is permitted. UserDefaults manages
/// its persistence; this does not promise a synchronous physical disk flush.
@MainActor struct UserDefaultsQuizSceneMotionStore: QuizSceneMotionStoring {
    let defaults: UserDefaults
    let key: String
    func read() throws -> Data? {
        guard let value = defaults.object(forKey: key) else { return nil }
        guard let data = value as? Data else { throw QuizSceneStorageError.invalid }
        return data
    }
    func write(_ data: Data) throws {
        defaults.set(data, forKey: key)
        guard try read() == data else { throw QuizSceneStorageError.unavailable }
    }
}

@MainActor private struct InertQuizSceneMotionStore: QuizSceneMotionStoring {
    func read() throws -> Data? { throw QuizSceneStorageError.unavailable }
    func write(_ data: Data) throws { throw QuizSceneStorageError.unavailable }
}

@MainActor final class QuizSceneMotionLedger {
    static let maximumKeys = 128
    static let maximumJourneys = 8
    static let maximumBytes = 81_920
    static let shared = makeShared(arguments: ProcessInfo.processInfo.arguments)
    private let storage: any QuizSceneMotionStoring
    private var disabled = false
    private struct Journey: Codable { let scope: String; let hashes: [String] }
    private struct Record: Codable { let version: Int; let journeys: [Journey] }

    init(storage: any QuizSceneMotionStoring) { self.storage = storage }

    /// Keep eight recent journeys, each with at most 128 consumed scenes. A
    /// saturated current journey remains static without disabling future games.
    /// Only a ninth journey evicts an old historical scope; no scene is evicted
    /// from a retained scope, so reconnect/recreation does not replay it.
    func consume(_ key: QuizSceneKey) -> Bool {
        guard !disabled else { return false }
        do {
            var journeys = try load()
            if let index = journeys.firstIndex(where: { $0.scope == key.journeyDigest }) {
                let previous = journeys.remove(at: index)
                if previous.hashes.contains(key.digest) || previous.hashes.count >= Self.maximumKeys {
                    // Refresh an older retained journey's recency without
                    // replaying a scene or repeatedly writing the newest scope.
                    journeys.append(previous)
                    if index != journeys.count - 1 { try persist(journeys) }
                    return false
                }
                journeys.append(Journey(scope: previous.scope, hashes: previous.hashes + [key.digest]))
            } else {
                if journeys.count == Self.maximumJourneys { journeys.removeFirst() }
                journeys.append(Journey(scope: key.journeyDigest, hashes: [key.digest]))
            }
            try persist(journeys)
            return true
        } catch {
            disabled = true
            return false
        }
    }

    private func persist(_ journeys: [Journey]) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(Record(version: 2, journeys: journeys))
        guard data.count <= Self.maximumBytes else { throw QuizSceneStorageError.invalid }
        try storage.write(data)
        guard try storage.read() == data else { throw QuizSceneStorageError.unavailable }
    }

    private func load() throws -> [Journey] {
        guard let data = try storage.read() else { return [] }
        guard !data.isEmpty, data.count <= Self.maximumBytes,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == ["version", "journeys"],
              let rawJourneys = object["journeys"] as? [[String: Any]],
              rawJourneys.allSatisfy({ Set($0.keys) == ["scope", "hashes"] }) else { throw QuizSceneStorageError.invalid }
        let record = try JSONDecoder().decode(Record.self, from: data)
        let hashes = record.journeys.flatMap(\.hashes)
        guard record.version == 2, record.journeys.count <= Self.maximumJourneys,
              Set(record.journeys.map(\.scope)).count == record.journeys.count,
              Set(hashes).count == hashes.count,
              record.journeys.allSatisfy({ Self.validHash($0.scope) && $0.hashes.count <= Self.maximumKeys && $0.hashes.allSatisfy(Self.validHash) }) else {
            throw QuizSceneStorageError.invalid
        }
        return record.journeys
    }

    private static func validHash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
    }

    private static func makeShared(arguments: [String]) -> QuizSceneMotionLedger {
        let testing = arguments.contains("-ui-testing")
        let optIn = arguments.contains("-quiz-scene-motion-testing")
        if testing && !optIn { return QuizSceneMotionLedger(storage: InertQuizSceneMotionStore()) }
        if testing && optIn {
            var key = "consumed-v2"
            if let index = arguments.firstIndex(of: "-quiz-scene-motion-scope") {
                guard arguments.indices.contains(index + 1), let scope = UUID(uuidString: arguments[index + 1]) else {
                    return QuizSceneMotionLedger(storage: InertQuizSceneMotionStore())
                }
                key += "-" + scope.uuidString.lowercased()
            }
            guard let defaults = UserDefaults(suiteName: "studio.likerts.quiz-scene-motion.qa") else {
                return QuizSceneMotionLedger(storage: InertQuizSceneMotionStore())
            }
            return QuizSceneMotionLedger(storage: UserDefaultsQuizSceneMotionStore(defaults: defaults, key: key))
        }
        return QuizSceneMotionLedger(storage: UserDefaultsQuizSceneMotionStore(defaults: .standard, key: "likerts.quizSceneMotion.consumed.v2"))
    }
}
