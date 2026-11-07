import Foundation

/// Events are semantic and never carry a rating or private answer.
enum GameAudioCue: String, CaseIterable, Sendable {
    case choice, lock, anticipation, exact, near, far, results, rematch, motif, scenePlace, sceneDrift
    var isMusic: Bool { self == .motif }
    var requiresReveal: Bool { self == .exact || self == .near || self == .far || self == .scenePlace || self == .sceneDrift }
    var resourceName: String {
        switch self {
        case .anticipation: return "reveal"
        case .results: return "result"
        case .scenePlace: return "scene-place"
        case .sceneDrift: return "scene-drift"
        default: return rawValue
        }
    }
}

struct GameAudioPreferences: Equatable, Sendable {
    var sound = true
    var music = false
    var haptics = true
}

/// UserDefaults also broadcasts unrelated game-save changes. Only a real
/// preference change should stop voices or reconfigure audio.
struct AudioPreferenceChangeGate {
    private var previous: GameAudioPreferences?
    mutating func accepts(_ current: GameAudioPreferences) -> Bool {
        guard previous != current else { return false }
        previous = current
        return true
    }
}

/// Thread-safe cancellation epochs. Disabling either channel invalidates its
/// already queued work permanently, even if the user re-enables it immediately.
final class GameAudioEpoch: @unchecked Sendable {
    struct Ticket: Equatable, Sendable { let music: Bool; let generation: UInt64 }
    private let lock = NSLock()
    private var sound = true, music = false, active = true, interrupted = false, secondary = false
    private var soundGeneration: UInt64 = 0, musicGeneration: UInt64 = 0

    func update(preferences: GameAudioPreferences, active: Bool, interrupted: Bool, secondarySilenced: Bool) {
        lock.lock(); defer { lock.unlock() }
        let oldSound = sound && self.active && !self.interrupted
        let oldMusic = music && self.active && !self.interrupted && !secondary
        sound = preferences.sound; music = preferences.music
        self.active = active; self.interrupted = interrupted; secondary = secondarySilenced
        if oldSound && !(sound && active && !interrupted) { soundGeneration &+= 1 }
        if oldMusic && !(music && active && !interrupted && !secondarySilenced) { musicGeneration &+= 1 }
    }
    func ticket(music isMusic: Bool) -> Ticket? {
        lock.lock(); defer { lock.unlock() }
        guard active, !interrupted, isMusic ? (music && !secondary) : sound else { return nil }
        return Ticket(music: isMusic, generation: isMusic ? musicGeneration : soundGeneration)
    }
    func valid(_ ticket: Ticket) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return validLocked(ticket)
    }
    /// The final transition to playing is atomic with a mute/background
    /// invalidation. Slow session setup and decoding must stay outside this lock.
    func startIfValid(_ ticket: Ticket, _ start: () -> Bool) -> Bool? {
        lock.lock(); defer { lock.unlock() }
        guard validLocked(ticket) else { return nil }
        return start()
    }
    private func validLocked(_ ticket: Ticket) -> Bool {
        guard active, !interrupted else { return false }
        return ticket.music ? (music && !secondary && ticket.generation == musicGeneration)
                            : (sound && ticket.generation == soundGeneration)
    }
    func cancelAll() {
        lock.lock(); defer { lock.unlock() }
        soundGeneration &+= 1; musicGeneration &+= 1
    }
}

/// A pure admission gate lets us test privacy, deduplication and cooldown
/// without starting an audio session or needing a hardware output route.
struct GameAudioGate {
    private var lastPlayed: [GameAudioCue: TimeInterval] = [:]
    private var seenTokens: [String] = []
    private let maxTokens = 128

    mutating func admit(_ cue: GameAudioCue, token: String?, now: TimeInterval,
                        preferences: GameAudioPreferences, active: Bool,
                        inExtension: Bool, interrupted: Bool, secondarySilenced: Bool,
                        revealAllowed: Bool) -> Bool {
        guard now.isFinite, active, !inExtension, !interrupted else { return false }
        guard cue.isMusic ? (preferences.music && !secondarySilenced) : preferences.sound else { return false }
        guard !cue.requiresReveal || revealAllowed else { return false }
        let key = token.map { cue.rawValue + ":" + $0 }
        if let key, seenTokens.contains(key) { return false }
        let interval: TimeInterval = cue == .choice ? 0.065 : cue == .motif ? 0.5 : 0.12
        if let last = lastPlayed[cue], now >= last, now - last < interval { return false }
        lastPlayed[cue] = now
        if let key {
            seenTokens.append(key)
            if seenTokens.count > maxTokens { seenTokens.removeFirst(seenTokens.count - maxTokens) }
        }
        return true
    }
    mutating func reset() { lastPlayed.removeAll(); seenTokens.removeAll() }
}
