import XCTest
@testable import Likerts

/// Tests admission decisions only; these do not prove audible or tactile output.
final class GameAudioPolicyTests: XCTestCase {
    private let enabled = GameAudioPreferences(sound: true, music: true, haptics: true)

    private func decide(_ gate: inout GameAudioGate, _ cue: GameAudioCue, _ time: TimeInterval,
                        token: String? = nil, preferences: GameAudioPreferences? = nil,
                        active: Bool = true, inExtension: Bool = false,
                        interrupted: Bool = false, secondarySilenced: Bool = false,
                        revealAllowed: Bool = false) -> Bool {
        gate.admit(cue, token: token, now: time, preferences: preferences ?? enabled,
                   active: active, inExtension: inExtension, interrupted: interrupted,
                   secondarySilenced: secondarySilenced, revealAllowed: revealAllowed)
    }

    func testOutcomeRequiresAuthorizedRevealAndDeniedAttemptDoesNotConsumeToken() {
        for cue in [GameAudioCue.exact, .near, .far, .scenePlace, .sceneDrift] {
            var gate = GameAudioGate()
            XCTAssertFalse(decide(&gate, cue, 1, token: "round-1"))
            XCTAssertTrue(decide(&gate, cue, 2, token: "round-1", revealAllowed: true))
            XCTAssertFalse(decide(&gate, cue, 3, token: "round-1", revealAllowed: true))
            XCTAssertTrue(decide(&gate, cue, 4, token: "round-2", revealAllowed: true))
        }
    }

    func testIndependentMusicAndSoundAndSecondaryAudioHint() {
        var gate = GameAudioGate()
        let onlySound = GameAudioPreferences(sound: true, music: false, haptics: false)
        XCTAssertTrue(decide(&gate, .choice, 1, preferences: onlySound))
        XCTAssertFalse(decide(&gate, .motif, 2, preferences: onlySound))
        let onlyMusic = GameAudioPreferences(sound: false, music: true, haptics: false)
        XCTAssertFalse(decide(&gate, .choice, 3, preferences: onlyMusic))
        XCTAssertTrue(decide(&gate, .motif, 4, preferences: onlyMusic))
        XCTAssertFalse(decide(&gate, .motif, 5, preferences: onlyMusic, secondarySilenced: true))
        XCTAssertTrue(decide(&gate, .lock, 6, preferences: enabled, secondarySilenced: true))
    }

    func testBackgroundInterruptionAndMessagesCannotEmitOrReplay() {
        for cue in GameAudioCue.allCases {
            var gate = GameAudioGate()
            XCTAssertFalse(decide(&gate, cue, 1, token: "one", active: false, revealAllowed: true))
            XCTAssertFalse(decide(&gate, cue, 2, token: "one", interrupted: true, revealAllowed: true))
            XCTAssertFalse(decide(&gate, cue, 3, token: "one", inExtension: true, revealAllowed: true))
            // A future explicit action is allowed; the gate itself does not queue missed events.
            XCTAssertTrue(decide(&gate, cue, 4, token: "new-action", revealAllowed: true))
        }
    }

    func testChoiceCooldownPreventsRapidStackingWithoutSuppressingNextRound() {
        var gate = GameAudioGate()
        XCTAssertTrue(decide(&gate, .choice, 1))
        XCTAssertFalse(decide(&gate, .choice, 1.03))
        XCTAssertTrue(decide(&gate, .choice, 1.08))
        XCTAssertTrue(decide(&gate, .lock, 1.09))
        XCTAssertFalse(decide(&gate, .lock, 1.15))
        XCTAssertTrue(decide(&gate, .lock, 1.22))
    }

    func testUnrelatedPreferencesNotificationsDoNotRepeatAudioReconfiguration() {
        var changes = AudioPreferenceChangeGate()
        let initial = GameAudioPreferences(sound: true, music: false, haptics: true)
        XCTAssertTrue(changes.accepts(initial), "Initial values must still be enforced")
        XCTAssertFalse(changes.accepts(initial), "Unrelated game-save notifications do not reconfigure audio")
        let muted = GameAudioPreferences(sound: false, music: false, haptics: true)
        XCTAssertTrue(changes.accepts(muted), "A real mute must still be enforced immediately")
        XCTAssertFalse(changes.accepts(muted))
        XCTAssertTrue(changes.accepts(initial), "Re-enabling sound is a real preference change")
        let noHaptics = GameAudioPreferences(sound: true, music: false, haptics: false)
        XCTAssertTrue(changes.accepts(noHaptics))
    }

    func testResetAllowsRematchToUseRoundTokenAgain() {
        var gate = GameAudioGate()
        XCTAssertTrue(decide(&gate, .exact, 1, token: "round-0", revealAllowed: true))
        XCTAssertFalse(decide(&gate, .exact, 2, token: "round-0", revealAllowed: true))
        gate.reset()
        XCTAssertTrue(decide(&gate, .exact, 3, token: "round-0", revealAllowed: true))
    }
}
