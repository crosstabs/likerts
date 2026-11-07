import Foundation

/// Recovery is an attempt made by a fresh user action, never permission to
/// replay work scheduled before an interruption, background or service reset.
struct GameAudioLifecycle {
    private(set) var active = true
    private(set) var interrupted = false
    private(set) var needsRecovery = false
    private(set) var revision: UInt64 = 0

    mutating func setActive(_ value: Bool) -> Bool {
        guard value != active else { return false }
        active = value; revision &+= 1
        if value { interrupted = false; needsRecovery = true }
        return true
    }
    mutating func interruptionBegan() {
        revision &+= 1; interrupted = true; needsRecovery = true
    }
    mutating func interruptionEnded() { revision &+= 1; interrupted = false; needsRecovery = true }
    mutating func mediaServicesReset() { revision &+= 1; interrupted = false; needsRecovery = true }
    mutating func userAction() {
        guard active else { return }
        interrupted = false
        if needsRecovery { revision &+= 1 }
    }
    mutating func sessionReady(revision expected: UInt64) {
        guard active, !interrupted, revision == expected else { return }
        needsRecovery = false
    }
    func allows(userInitiated: Bool) -> Bool { active && !interrupted && (userInitiated || !needsRecovery) }
}
