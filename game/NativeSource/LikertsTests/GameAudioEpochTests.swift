import XCTest
@testable import Likerts

final class GameAudioEpochTests: XCTestCase {
    private final class Flag: @unchecked Sendable {
        private let lock = NSLock()
        private var stored = false
        func mark() { lock.lock(); stored = true; lock.unlock() }
        func read() -> Bool { lock.lock(); defer { lock.unlock() }; return stored }
    }
    func testMuteInvalidatesQueuedSoundWithoutCancelingMusicAndReenableCannotReviveIt() throws {
        let epoch = GameAudioEpoch()
        let all = GameAudioPreferences(sound: true, music: true, haptics: true)
        epoch.update(preferences: all, active: true, interrupted: false, secondarySilenced: false)
        let sound = try XCTUnwrap(epoch.ticket(music: false))
        let music = try XCTUnwrap(epoch.ticket(music: true))
        epoch.update(preferences: .init(sound: false, music: true, haptics: true), active: true, interrupted: false, secondarySilenced: false)
        XCTAssertFalse(epoch.valid(sound)); XCTAssertTrue(epoch.valid(music))
        var called = false
        XCTAssertNil(epoch.startIfValid(sound) { called = true; return true })
        XCTAssertFalse(called, "Canceled preparation must never start a stale cue")
        epoch.update(preferences: all, active: true, interrupted: false, secondarySilenced: false)
        XCTAssertFalse(epoch.valid(sound), "Re-enabling cannot replay the old event")
        XCTAssertNotNil(epoch.ticket(music: false))
    }

    func testBackgroundInterruptionRouteAndOtherAudioCannotReviveOldWork() throws {
        let epoch = GameAudioEpoch()
        let all = GameAudioPreferences(sound: true, music: true, haptics: true)
        epoch.update(preferences: all, active: true, interrupted: false, secondarySilenced: false)
        let sound = try XCTUnwrap(epoch.ticket(music: false))
        let music = try XCTUnwrap(epoch.ticket(music: true))
        epoch.update(preferences: all, active: false, interrupted: false, secondarySilenced: false)
        XCTAssertFalse(epoch.valid(sound)); XCTAssertFalse(epoch.valid(music))
        epoch.update(preferences: all, active: true, interrupted: false, secondarySilenced: false)
        XCTAssertFalse(epoch.valid(sound)); XCTAssertFalse(epoch.valid(music))
        let afterForeground = try XCTUnwrap(epoch.ticket(music: false))
        epoch.cancelAll() // route loss or explicit navigation stop
        XCTAssertFalse(epoch.valid(afterForeground))
        let afterRoute = try XCTUnwrap(epoch.ticket(music: true))
        epoch.update(preferences: all, active: true, interrupted: false, secondarySilenced: true)
        XCTAssertFalse(epoch.valid(afterRoute))
        XCTAssertNil(epoch.ticket(music: true))
        XCTAssertNotNil(epoch.ticket(music: false), "Other audio suppresses music without muting effects")
        epoch.update(preferences: all, active: true, interrupted: true, secondarySilenced: false)
        XCTAssertNil(epoch.ticket(music: false))
    }

    func testMuteDuringSlowPreparationPreventsAsynchronousStart() throws {
        let epoch = GameAudioEpoch()
        let all = GameAudioPreferences(sound: true, music: true, haptics: true)
        epoch.update(preferences: all, active: true, interrupted: false, secondarySilenced: false)
        let ticket = try XCTUnwrap(epoch.ticket(music: false))
        let preparationStarted = expectation(description: "background preparation entered")
        let preparationDone = expectation(description: "background preparation returned")
        let releasePreparation = DispatchSemaphore(value: 0)
        let started = Flag()
        DispatchQueue.global(qos: .userInitiated).async {
            preparationStarted.fulfill()
            releasePreparation.wait()
            _ = epoch.startIfValid(ticket) {
                started.mark()
                return true
            }
            preparationDone.fulfill()
        }
        wait(for: [preparationStarted], timeout: 2)
        // Mute must return while slow work is still paused, and its late
        // completion must never start audio after the user has muted.
        epoch.update(preferences: .init(sound: false, music: true, haptics: true), active: true, interrupted: false, secondarySilenced: false)
        releasePreparation.signal()
        wait(for: [preparationDone], timeout: 2)
        XCTAssertFalse(started.read())
    }
}
