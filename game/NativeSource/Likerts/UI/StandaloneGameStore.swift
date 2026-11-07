import Foundation
import Observation

/// Only the standalone ContentView uses this store. Messages and party games
/// never attach to it. Snapshots stay in the app sandbox and are excluded from
/// backup; they contain answers and are protected by iOS file protection.
@MainActor @Observable final class StandaloneGameStore {
    private(set) var saveFailed = false
    private(set) var clearFailed = false
    var hasSavedData: Bool { !defaults.bool(forKey: tombstoneKey) && FileManager.default.fileExists(atPath: fileURL.path) }
    private let fileURL: URL
    private let defaults: UserDefaults
    private let tombstoneKey: String
    private let removeFile: (URL) throws -> Void
    private let writeFile: (Data, URL) throws -> Void
    private let maximumBytes = 16_384

    init(fileURL: URL? = nil, defaults: UserDefaults = .standard, tombstoneKey: String? = nil,
         removeFile: @escaping (URL) throws -> Void = { try FileManager.default.removeItem(at: $0) },
         writeFile: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        #if DEBUG
        let testing = ProcessInfo.processInfo.arguments.contains("-persistence-testing")
        let name = testing ? "active-game-ui-test-v1.json" : "active-game-v1.json"
        let defaultTombstone = testing ? "likerts.test.game-cleared.v1" : "likerts.game-cleared.v1"
        #else
        let name = "active-game-v1.json"
        let defaultTombstone = "likerts.game-cleared.v1"
        #endif
        self.fileURL = fileURL ?? support.appendingPathComponent("Likerts", isDirectory: true).appendingPathComponent(name)
        self.defaults = defaults
        self.tombstoneKey = tombstoneKey ?? defaultTombstone
        self.removeFile = removeFile
        self.writeFile = writeFile
    }
    #if DEBUG
    /// Explicit UI-test fixtures are isolated from the player's file and
    /// applied at most once per app process, even if SwiftUI recreates a view.
    private static var didApplyTestingFixture = false
    func applyTestingLaunchFixture() {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-persistence-testing"), !Self.didApplyTestingFixture else { return }
        Self.didApplyTestingFixture = true
        if args.contains("-persistence-reset") { _ = clear() }
        let data: Data
        if args.contains("-persistence-corrupt-fixture") {
            data = Data("{broken".utf8)
        } else if args.contains("-persistence-unsupported-fixture") {
            var snapshot = StandaloneGameSnapshot(phase: "answering", name: "Alex", prompts: Array(PromptBank.all.prefix(5)),
                packTheme: nil, packSource: nil, topic: nil, dailyKey: nil, challengeCode: nil,
                answers: Array(repeating: nil, count: 5), guesses: Array(repeating: nil, count: 5), index: 0, revealed: false)
            snapshot.version = 999
            guard let encoded = try? JSONEncoder().encode(snapshot) else { return }
            data = encoded
        } else { return }
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            defaults.set(false, forKey: tombstoneKey)
        } catch { saveFailed = true }
    }
    #endif

    func load() -> StandaloneGameSnapshot? {
        guard !defaults.bool(forKey: tombstoneKey),
              let handle = try? FileHandle(forReadingFrom: fileURL) else { return nil }
        defer { try? handle.close() }
        // Bound the read itself, even if a corrupt or unexpectedly large file is present.
        guard let data = try? handle.read(upToCount: maximumBytes + 1), data.count <= maximumBytes,
              let snapshot = try? JSONDecoder().decode(StandaloneGameSnapshot.self, from: data),
              (try? snapshot.validate()) != nil else { return nil }
        return snapshot
    }
    @discardableResult func save(_ snapshot: StandaloneGameSnapshot) -> Bool {
        // Invalidate the previous snapshot first: a failed update or rematch
        // must never resurrect an older game or reveal stale answers.
        defaults.set(true, forKey: tombstoneKey)
        guard (try? snapshot.validate()) != nil, let data = try? JSONEncoder().encode(snapshot), data.count <= maximumBytes else { saveFailed = true; return false }
        do {
            let directory = fileURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var resource = URLResourceValues(); resource.isExcludedFromBackup = true
            var excluded = directory; try excluded.setResourceValues(resource)
            try writeFile(data, fileURL)
            defaults.set(false, forKey: tombstoneKey)
            saveFailed = false; return true
        } catch { saveFailed = true; return false }
    }
    func dismissSaveWarning() { saveFailed = false }
    func dismissClearWarning() { clearFailed = false }
    /// Mark the snapshot as abandoned before attempting deletion, so a failed
    /// removal cannot silently bring the old game back on the next launch.
    @discardableResult func clear() -> Bool {
        defaults.set(true, forKey: tombstoneKey)
        guard FileManager.default.fileExists(atPath: fileURL.path) else { clearFailed = false; return true }
        do { try removeFile(fileURL); clearFailed = false; return true }
        catch { clearFailed = true; return false }
    }
}
