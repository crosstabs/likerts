import Foundation
import CryptoKit

/// Local content fingerprints, never a report queue or an authenticated
/// sender block. Answers and message/session IDs are deliberately omitted.
final class LocalContentSafety {
    static let maximumHidden = 100
    private let defaults: UserDefaults
    private let key: String
    init(defaults: UserDefaults = .standard, key: String? = nil) {
        self.defaults = defaults
        #if DEBUG
        let testing = ProcessInfo.processInfo.arguments.contains("-ui-testing")
        self.key = key ?? (testing ? "likerts.test.hidden-content.v1" : "likerts.hidden-content.v1")
        #else
        self.key = key ?? "likerts.hidden-content.v1"
        #endif
    }
    private var fingerprints: [String] {
        guard let values = defaults.array(forKey: key) as? [String], values.count <= Self.maximumHidden else { return [] }
        return values.filter { $0.count == 64 && $0.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
    }
    var count: Int { Set(fingerprints).count }
    func contains(_ challenge: Challenge) -> Bool { fingerprints.contains(Self.fingerprint(challenge)) }
    func hide(_ challenge: Challenge) {
        let value = Self.fingerprint(challenge)
        var values = fingerprints.filter { $0 != value }; values.append(value)
        defaults.set(Array(values.suffix(Self.maximumHidden)), forKey: key)
    }
    func unhide(_ challenge: Challenge) { defaults.set(fingerprints.filter { $0 != Self.fingerprint(challenge) }, forKey: key) }
    func clear() { defaults.removeObject(forKey: key) }
    private static func fingerprint(_ challenge: Challenge) -> String {
        let content = [challenge.name] + challenge.resolvedPrompts.flatMap { [$0.text, $0.emoji] }
        let data = (try? JSONEncoder().encode(content)) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
