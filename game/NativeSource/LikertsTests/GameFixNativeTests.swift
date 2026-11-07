#if canImport(UIKit)
import XCTest
import UIKit
import AVFoundation
@testable import Likerts

@MainActor final class GameAudioRecoveryTests: XCTestCase {
    private func fixture() throws -> (GameAudio, RecordingAudioOutput, NotificationCenter, UserDefaults, String) {
        let suite = "likerts.audio.recovery.\(UUID().uuidString)", defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let output = RecordingAudioOutput(), center = NotificationCenter()
        let audio = GameAudio(defaults: defaults, center: center, output: output, inExtension: false, testing: false, probe: true)
        return (audio, output, center, defaults, suite)
    }
    private func drain() async { for _ in 0..<10 { await Task.yield() } }
    func testMissingEndedAndDelayedSuspendedBeginRecoverOnlyOnFreshAction() async throws {
        let (audio, output, center, defaults, suite) = try fixture()
        defer { defaults.removePersistentDomain(forName: suite) }
        audio.play(.choice, userInitiated: true)
        let stale = try XCTUnwrap(audio.soundTicket())
        center.post(name: AVAudioSession.interruptionNotification, object: nil,
                    userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
        await drain()
        audio.setActive(false); audio.setActive(true)
        center.post(name: AVAudioSession.interruptionNotification, object: nil,
                    userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
        await drain()
        audio.play(.exact, token: "stale", revealAllowed: true, pendingTicket: stale)
        XCTAssertEqual(output.cues, [.choice])
        audio.play(.lock, userInitiated: true)
        let fresh = try XCTUnwrap(audio.soundTicket(), "A fresh lock can schedule its own outcome during preparation")
        audio.play(.near, revealAllowed: true, pendingTicket: fresh)
        XCTAssertEqual(output.cues, [.choice, .lock], "Failed/unconfirmed recovery holds automatic sounds")
        output.complete(1); await drain()
        audio.play(.far, revealAllowed: true, pendingTicket: fresh)
        XCTAssertEqual(output.cues, [.choice, .lock, .far])
        XCTAssertGreaterThan(output.invalidations, 0)
    }
    func testMediaResetCancelsOldPreparationAndDoesNotInvalidateNewUserAttempt() async throws {
        let (audio, output, center, defaults, suite) = try fixture()
        defer { defaults.removePersistentDomain(forName: suite) }
        audio.play(.anticipation, token: "one", userInitiated: true)
        let old = try XCTUnwrap(audio.soundTicket())
        center.post(name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        await drain()
        XCTAssertEqual(output.resets, 1); XCTAssertFalse(output.epoch.valid(old))
        audio.play(.lock, token: "new", userInitiated: true)
        let fresh = try XCTUnwrap(audio.soundTicket())
        output.complete(0); await drain()
        audio.play(.near, revealAllowed: true, pendingTicket: fresh)
        XCTAssertEqual(output.cues, [.anticipation, .lock], "A stale ready callback cannot release recovery")
        output.complete(1); await drain()
        audio.play(.exact, token: "new-outcome", revealAllowed: true, pendingTicket: fresh)
        XCTAssertEqual(output.cues, [.anticipation, .lock, .exact])
        audio.play(.anticipation, token: "one", userInitiated: true)
        XCTAssertEqual(output.cues.count, 3, "Recovery must retain deduplication tokens")
    }
    func testMuteDuringRecoveryCancelsTicketAndExplicitRetryCanRecover() async throws {
        let (audio, output, _, defaults, suite) = try fixture()
        defer { defaults.removePersistentDomain(forName: suite) }
        audio.setActive(false); audio.setActive(true)
        audio.play(.lock, userInitiated: true)
        let old = try XCTUnwrap(audio.soundTicket())
        defaults.set(false, forKey: GameAudio.soundKey); audio.preferencesChanged()
        defaults.set(true, forKey: GameAudio.soundKey); audio.preferencesChanged()
        output.complete(0); await drain()
        audio.play(.exact, revealAllowed: true, pendingTicket: old)
        XCTAssertEqual(output.cues, [.lock])
        audio.play(.choice, userInitiated: true); output.complete(1); await drain()
        audio.play(.far, revealAllowed: true, pendingTicket: try XCTUnwrap(audio.soundTicket()))
        XCTAssertEqual(output.cues, [.lock,.choice,.far])
    }
    func testExtensionNeverPreparesOrEnqueuesAfterRecovery() async {
        let output = RecordingAudioOutput(), center = NotificationCenter()
        let audio = GameAudio(center: center, output: output, inExtension: true, testing: false)
        center.post(name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        await drain()
        audio.prewarm(); audio.play(.choice, userInitiated: true)
        XCTAssertTrue(output.cues.isEmpty); XCTAssertEqual(output.prewarms, 0)
    }
    func testOlderRecoveryReadyCannotReleaseHoldAfterNewAttemptFailed() async throws {
        let (audio, output, _, defaults, suite) = try fixture()
        defer { defaults.removePersistentDomain(forName: suite) }
        audio.setActive(false); audio.setActive(true)
        audio.play(.lock, userInitiated: true)
        audio.play(.choice, userInitiated: true)
        let ticket = try XCTUnwrap(audio.soundTicket())
        output.complete(0); await drain()
        audio.play(.near, revealAllowed: true, pendingTicket: ticket)
        XCTAssertEqual(output.cues, [.lock,.choice], "Older successful activation cannot certify the newer failed attempt")
        output.complete(1); await drain()
        audio.play(.exact, revealAllowed: true, pendingTicket: ticket)
        XCTAssertEqual(output.cues, [.lock,.choice,.exact])
    }
    func testSilentUIAdmissionAdapterCompletesRecoveryWithoutClaimingPlayerStart() async throws {
        let suite = "likerts.audio.ui-admission.\(UUID().uuidString)", defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let audio = GameAudio(defaults: defaults, center: NotificationCenter(), inExtension: false, testing: true, probe: true)
        audio.setActive(false); audio.setActive(true)
        audio.play(.lock, userInitiated: true)
        let ticket = try XCTUnwrap(audio.soundTicket())
        await drain()
        audio.play(.near, revealAllowed: true, pendingTicket: ticket)
        XCTAssertTrue(audio.debugTraceText.contains("accepted:near"))
        XCTAssertFalse(audio.debugTraceText.contains("started:"), "A silent simulation must never claim actual playback")
    }
}

private final class RecordingAudioOutput: GameAudioOutputting {
    let epoch = GameAudioEpoch()
    var cues: [GameAudioCue] = []
    var work: [(GameAudioEpoch.Ticket, @Sendable (GameAudioEpoch.Ticket) -> Void)] = []
    var invalidations = 0, resets = 0, prewarms = 0
    func prewarm(ready: @escaping @Sendable (GameAudioEpoch.Ticket) -> Void) { prewarms += 1 }
    func enqueue(_ cue: GameAudioCue, ticket: GameAudioEpoch.Ticket, ready: @escaping @Sendable (GameAudioEpoch.Ticket) -> Void) {
        cues.append(cue); work.append((ticket, ready))
    }
    func complete(_ index: Int) { let value = work[index]; value.1(value.0) }
    func stopAll() { epoch.cancelAll() }
    func invalidateSession() { invalidations += 1 }
    func resetMediaServices() { resets += 1; epoch.cancelAll() }
    func stopDisabled(sound: Bool, music: Bool) {}
}

@MainActor final class DailyReadClockTests: XCTestCase {
    func testSleepingClockRollsAtBoundaryAndPreservesExistingSessionDate() async throws {
        var date = Date(timeIntervalSince1970: 1_699_919_999)
        var sleepers: [CheckedContinuation<Void, Error>] = [], scheduled: [Date] = []
        let clock = DailyReadClock(now: { date }, sleepUntil: { deadline in
            scheduled.append(deadline)
            try await withCheckedThrowingContinuation { sleepers.append($0) }
        })
        let old = clock.puzzle, game = GameSession(challenge: clock.puzzle.challenge, daily: clock.puzzle)
        let task = Task { await clock.run() }
        for _ in 0..<100 where sleepers.isEmpty { await Task.yield() }
        let boundary = try XCTUnwrap(scheduled.first)
        date = boundary; sleepers.removeFirst().resume()
        for _ in 0..<100 where clock.puzzle.key == old.key { await Task.yield() }
        XCTAssertNotEqual(clock.puzzle.key, old.key)
        XCTAssertEqual(game.daily, old); XCTAssertEqual(try game.snapshot.validate().daily, old)
        task.cancel()
        for sleeper in sleepers { sleeper.resume() }; sleepers.removeAll()
        await task.value
        let current = clock.puzzle
        date = date.addingTimeInterval(86_400 * 3)
        XCTAssertEqual(clock.puzzle, current, "A cancelled task cannot write a newer date")
        clock.refresh(); XCTAssertNotEqual(clock.puzzle, current)
        date = date.addingTimeInterval(-86_400 * 5)
        clock.refresh(); XCTAssertEqual(clock.puzzle, DailyPuzzle.today(date: date))
        XCTAssertEqual(game.daily, old)
    }
}

@MainActor final class FreshPackRequestTests: XCTestCase {
    func testTimeoutPresentsLabelledFallbackAndIgnoresUncooperativeLateResult() async throws {
        var resume: CheckedContinuation<PackResult, Error>?
        let request = FreshPackRequest(timeoutNanoseconds: 10_000_000, make: { _, _ in
            try await withCheckedThrowingContinuation { resume = $0 }
        })
        request.generate(theme: .foodTakes, availability: .available)
        for _ in 0..<100 where resume == nil { await Task.yield() }
        try await Task.sleep(nanoseconds: 40_000_000)
        XCTAssertFalse(request.working); XCTAssertEqual(request.result?.fallbackReason, .timedOut)
        let fallback = request.result
        let late = PackResult(pack: PromptPack(theme: .foodTakes, statements: AuthoredPacks.pack(for: .foodTakes).statements, source: .onDeviceAI), fallbackReason: nil)
        try XCTUnwrap(resume).resume(returning: late)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(request.result, fallback)
    }
    func testCancelledAndRepeatedRequestsCannotReplaceHandpickedOrNewerResults() async throws {
        var pending: [CheckedContinuation<PackResult, Error>] = []
        let request = FreshPackRequest(make: { _, _ in try await withCheckedThrowingContinuation { pending.append($0) } })
        request.generate(theme: .sideQuests, availability: .available)
        for _ in 0..<100 where pending.count < 1 { await Task.yield() }
        request.cancel(); XCTAssertFalse(request.working); XCTAssertNil(request.result)
        request.generate(theme: .foodTakes, availability: .available)
        for _ in 0..<100 where pending.count < 2 { await Task.yield() }
        XCTAssertEqual(pending.count, 2)
        pending[0].resume(returning: PackResult(pack: AuthoredPacks.pack(for: .sideQuests), fallbackReason: nil))
        for _ in 0..<10 { await Task.yield() }
        XCTAssertTrue(request.working); XCTAssertNil(request.result)
        request.useHandpicked(theme: .socialBattery)
        pending[1].resume(returning: PackResult(pack: AuthoredPacks.pack(for: .foodTakes), fallbackReason: nil))
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(request.result?.pack, AuthoredPacks.pack(for: .socialBattery))
        request.discard(); XCTAssertNil(request.result)
        request.generate(theme: .everydayChaos, availability: .available)
        for _ in 0..<100 where pending.count < 3 { await Task.yield() }
        pending[2].resume(returning: PackResult(pack: AuthoredPacks.pack(for: .everydayChaos), fallbackReason: .modelDeclined))
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(request.result?.fallbackReason, .modelDeclined); XCTAssertFalse(request.working)
    }
}
#endif
