import Foundation
import AVFoundation
import Combine
import UIKit

/// Session setup and sample decoding never run on the UI actor. A separate
/// playback queue keeps stopping an active cue independent of slow setup.
protocol GameAudioOutputting: AnyObject {
    var epoch: GameAudioEpoch { get }
    func prewarm(ready: @escaping @Sendable (GameAudioEpoch.Ticket) -> Void)
    func enqueue(_ cue: GameAudioCue, ticket: GameAudioEpoch.Ticket, ready: @escaping @Sendable (GameAudioEpoch.Ticket) -> Void)
    func stopAll()
    func invalidateSession()
    func resetMediaServices()
    func stopDisabled(sound: Bool, music: Bool)
}

#if DEBUG
/// UI admission tests disable hardware output. Model successful preparation
/// explicitly so recovery can finish without falsely claiming a player start.
private final class SilentAdmissionTestOutput: GameAudioOutputting {
    let epoch = GameAudioEpoch()
    func prewarm(ready: @escaping @Sendable (GameAudioEpoch.Ticket) -> Void) {
        if let ticket = epoch.ticket(music: false) ?? epoch.ticket(music: true) { ready(ticket) }
    }
    func enqueue(_ cue: GameAudioCue, ticket: GameAudioEpoch.Ticket, ready: @escaping @Sendable (GameAudioEpoch.Ticket) -> Void) {
        if epoch.valid(ticket) { ready(ticket) }
    }
    func stopAll() { epoch.cancelAll() }
    func invalidateSession() {}
    func resetMediaServices() { epoch.cancelAll() }
    func stopDisabled(sound: Bool, music: Bool) {}
}
#endif

private final class GameAudioOutput: GameAudioOutputting, @unchecked Sendable {
    let epoch = GameAudioEpoch()
    private let prepareQueue = DispatchQueue(label: "studio.likerts.audio.prepare", qos: .userInitiated)
    private let playbackQueue = DispatchQueue(label: "studio.likerts.audio.playback", qos: .userInitiated)
    private var configured = false // prepareQueue only
    private var sessionMayBeActive = false // prepareQueue only
    private var samples: [String: Data] = [:] // prepareQueue only; bounded by bundled cue names
    private var players: [String: AVAudioPlayer] = [:] // playbackQueue only
    private var lastAudibleChoice = -1 // playbackQueue only
    private var idleTask: DispatchWorkItem? // playbackQueue only
    private let activityLock = NSLock()
    private var activityRevision: UInt64 = 0
    private var prewarmPending = false
    private let report: @Sendable (String, TimeInterval) -> Void

    init(report: @escaping @Sendable (String, TimeInterval) -> Void) { self.report = report }

    /// Prepare only after an explicit play action. This never starts a player,
    /// and the short idle timeout releases the ambient session again.
    func prewarm(ready: @escaping @Sendable (GameAudioEpoch.Ticket) -> Void) {
        let soundTicket = epoch.ticket(music: false)
        let musicTicket = epoch.ticket(music: true)
        guard soundTicket != nil || musicTicket != nil else { return }
        guard beginPrewarm() else { return }
        prepareQueue.async { [self] in
            defer { finishPrewarm() }
            func allowed(_ ticket: GameAudioEpoch.Ticket?) -> Bool { ticket.map { epoch.valid($0) } ?? false }
            guard allowed(soundTicket) || allowed(musicTicket) else { return }
            do {
                let session = AVAudioSession.sharedInstance()
                let musicAllowed = allowed(musicTicket) && !session.secondaryAudioShouldBeSilencedHint
                guard allowed(soundTicket) || musicAllowed else { return }
                if !configured {
                    try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
                    try session.setActive(true)
                    configured = true; sessionMayBeActive = true
                }
                guard allowed(soundTicket) || allowed(musicTicket) else { scheduleIdleDeactivation(); return }
                if let ticket = [soundTicket, musicTicket].compactMap({ $0 }).first(where: { epoch.valid($0) }) { ready(ticket) }
                let soundNames = ["choice", "choice2", "choice3", "lock"]
                let names = (allowed(soundTicket) ? soundNames : []) + (musicAllowed ? ["motif"] : [])
                for name in names {
                    let isMusic = name == "motif"
                    guard isMusic ? allowed(musicTicket) : allowed(soundTicket) else { continue }
                    guard samples[name] == nil,
                          let url = Bundle.main.url(forResource: name, withExtension: "wav", subdirectory: "AudioAssets")
                            ?? Bundle.main.url(forResource: name, withExtension: "wav") else { continue }
                    samples[name] = try? Data(contentsOf: url, options: .mappedIfSafe)
                }
                guard allowed(soundTicket) || allowed(musicTicket) else { scheduleIdleDeactivation(); return }
                report("prewarm:ready", ProcessInfo.processInfo.systemUptime)
                scheduleIdleDeactivation(after: 6)
            } catch {
                report("prewarm:failed", ProcessInfo.processInfo.systemUptime)
                scheduleIdleDeactivation()
            }
        }
    }

    func enqueue(_ cue: GameAudioCue, ticket: GameAudioEpoch.Ticket, ready: @escaping @Sendable (GameAudioEpoch.Ticket) -> Void) {
        guard ticket.music == cue.isMusic, epoch.valid(ticket) else { return }
        markActivity()
        let deadline = ProcessInfo.processInfo.systemUptime + 1.0
        prepareQueue.async { [self] in
            guard epoch.valid(ticket), ProcessInfo.processInfo.systemUptime <= deadline else { return }
            do {
                let session = AVAudioSession.sharedInstance()
                if cue.isMusic && session.secondaryAudioShouldBeSilencedHint { return }
                if !configured {
                    try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
                    try session.setActive(true)
                    configured = true; sessionMayBeActive = true
                }
                guard epoch.valid(ticket), ProcessInfo.processInfo.systemUptime <= deadline else { scheduleIdleDeactivation(); return }
                ready(ticket)
                // The three neutral choices are synthesized from the same note;
                // all are loaded off the main actor and selection never uses a value.
                let index = cue == .choice ? playbackQueue.sync { (lastAudibleChoice + 1) % 3 } : 0
                let name = cue == .choice ? ["choice", "choice2", "choice3"][index] : cue.resourceName
                let data: Data
                if let cached = samples[name] { data = cached }
                else {
                    guard let url = Bundle.main.url(forResource: name, withExtension: "wav", subdirectory: "AudioAssets")
                        ?? Bundle.main.url(forResource: name, withExtension: "wav") else {
                        report("failed:\(cue.rawValue)", ProcessInfo.processInfo.systemUptime); scheduleIdleDeactivation(); return
                    }
                    data = try Data(contentsOf: url, options: .mappedIfSafe)
                    samples[name] = data
                }
                let player = try AVAudioPlayer(data: data)
                player.numberOfLoops = 0
                player.volume = cue.isMusic ? 0.32 : 0.5
                player.prepareToPlay()
                playbackQueue.async { [self] in
                    guard epoch.valid(ticket), ProcessInfo.processInfo.systemUptime <= deadline else { scheduleIdleDeactivation(); return }
                    let playing = players.filter { $0.value.isPlaying && $0.key != name }
                    if playing.count >= 3, let first = playing.keys.sorted().first { players[first]?.stop() }
                    players[name]?.stop()
                    players[name] = player
                    // No stale setup can begin after a mute/background event.
                    guard let started = epoch.startIfValid(ticket, { player.play() }) else { players.removeValue(forKey: name); scheduleIdleDeactivation(); return }
                    if started && cue == .choice { lastAudibleChoice = index }
                    report("\(started ? "started" : "failed"):\(cue.rawValue)", ProcessInfo.processInfo.systemUptime)
                    scheduleIdleDeactivation()
                }
            } catch {
                report("failed:\(cue.rawValue)", ProcessInfo.processInfo.systemUptime)
                scheduleIdleDeactivation()
            }
        }
    }

    /// Epoch invalidation is synchronous; stopping active voices has its own
    /// queue and is never held behind an audio-session activation or file read.
    func stopAll() {
        let revision = markActivity()
        epoch.cancelAll()
        playbackQueue.async { [self] in
            idleTask?.cancel(); idleTask = nil
            players.values.forEach { $0.stop(); $0.currentTime = 0 }
            report("stopped:all", ProcessInfo.processInfo.systemUptime)
            deactivateIfStillIdle(revision: revision)
        }
    }
    /// The OS may deactivate our session during interruptions or route loss.
    /// Mark it unconfigured on its owning queue so the next explicit event
    /// activates it again, without replaying the interrupted event.
    func invalidateSession() { prepareQueue.async { [self] in configured = false } }
    func resetMediaServices() {
        markActivity(); epoch.cancelAll()
        playbackQueue.async { [self] in
            idleTask?.cancel(); idleTask = nil
            players.values.forEach { $0.stop() }
            players.removeAll(); lastAudibleChoice = -1
            report("reset:players", ProcessInfo.processInfo.systemUptime)
        }
        prepareQueue.async { [self] in configured = false; sessionMayBeActive = false }
    }
    func stopDisabled(sound: Bool, music: Bool) {
        markActivity()
        playbackQueue.async { [self] in
            if sound { for (name, player) in players where name != "motif" { player.stop() }; report("stopped:sound", ProcessInfo.processInfo.systemUptime) }
            if music { players["motif"]?.stop(); report("stopped:music", ProcessInfo.processInfo.systemUptime) }
            scheduleIdleDeactivation()
        }
    }
    private func scheduleIdleDeactivation(after delay: TimeInterval = 3) {
        playbackQueue.async { [self] in
            idleTask?.cancel()
            let revision = currentActivity()
            let task = DispatchWorkItem { [weak self] in
                guard let self, !self.players.values.contains(where: { $0.isPlaying }) else { return }
                self.prepareQueue.async { [weak self] in
                    guard let self, self.configured, self.currentActivity() == revision else { return }
                    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
                    self.configured = false; self.sessionMayBeActive = false
                }
            }
            idleTask = task
            playbackQueue.asyncAfter(deadline: .now() + delay, execute: task)
        }
    }
    private func deactivateIfStillIdle(revision: UInt64) {
        prepareQueue.async { [weak self] in
            guard let self, self.sessionMayBeActive, self.currentActivity() == revision else { return }
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            self.configured = false; self.sessionMayBeActive = false
        }
    }
    @discardableResult private func markActivity() -> UInt64 {
        activityLock.lock(); defer { activityLock.unlock() }
        activityRevision &+= 1; return activityRevision
    }
    private func currentActivity() -> UInt64 { activityLock.lock(); defer { activityLock.unlock() }; return activityRevision }
    private func beginPrewarm() -> Bool {
        activityLock.lock(); defer { activityLock.unlock() }
        guard !prewarmPending else { return false }
        prewarmPending = true; activityRevision &+= 1
        return true
    }
    private func finishPrewarm() { activityLock.lock(); prewarmPending = false; activityLock.unlock() }
}

@MainActor final class GameAudio: ObservableObject {
    typealias Cue = GameAudioCue
    static let shared = GameAudio()
    static let soundKey = "likerts.audio.sound"
    static let musicKey = "likerts.audio.music"
    static let hapticsKey = "likerts.audio.haptics"
    @Published private(set) var debugTraceText = ""
    private var gate = GameAudioGate()
    private var preferenceChanges = AudioPreferenceChangeGate()
    private let injectedOutput: (any GameAudioOutputting)?
    private lazy var output: any GameAudioOutputting = {
        if let injectedOutput { return injectedOutput }
        #if DEBUG
        if testing { return SilentAdmissionTestOutput() }
        #endif
        return GameAudioOutput { [weak self] entry, time in
            Task { @MainActor [weak self] in self?.trace(entry, at: time) }
        }
    }()
    private var observers: [NSObjectProtocol] = []
    private var lifecycle = GameAudioLifecycle()
    private var secondarySilenced = false
    private let defaults: UserDefaults
    private let extensionProcess: Bool
    private let testing: Bool
    private let probe: Bool

    init(defaults: UserDefaults = .standard, center: NotificationCenter = .default,
         output: (any GameAudioOutputting)? = nil, inExtension: Bool? = nil, testing: Bool? = nil, probe: Bool? = nil) {
        self.defaults = defaults; self.injectedOutput = output
        let args = ProcessInfo.processInfo.arguments
        extensionProcess = inExtension ?? (Bundle.main.bundleURL.pathExtension == "appex" || args.contains("-messages-harness"))
        self.testing = testing ?? args.contains("-ui-testing")
        #if DEBUG
        self.probe = probe ?? args.contains("-audio-probe")
        #else
        self.probe = false
        #endif
        observers.append(center.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.preferencesChanged() }
        })
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            Task { @MainActor [weak self] in
                guard let self else { return }
                if type == AVAudioSession.InterruptionType.began.rawValue {
                    self.lifecycle.interruptionBegan(); self.syncEpoch(); self.stopAll(); self.output.invalidateSession()
                } else if type == AVAudioSession.InterruptionType.ended.rawValue {
                    self.lifecycle.interruptionEnded(); self.syncEpoch(); self.output.invalidateSession()
                }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.lifecycle.mediaServicesReset(); self.syncEpoch(); self.output.resetMediaServices()
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            Task { @MainActor [weak self] in
                if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                    self?.stopAll(); self?.output.invalidateSession()
                }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.silenceSecondaryAudioHintNotification, object: nil, queue: .main) { [weak self] note in
            let type = (note.userInfo?[AVAudioSessionSilenceSecondaryAudioHintTypeKey] as? NSNumber)?.uintValue
            Task { @MainActor [weak self] in
                guard let self else { return }
                if type == AVAudioSession.SilenceSecondaryAudioHintType.begin.rawValue {
                    self.secondarySilenced = true; self.syncEpoch(); self.output.stopDisabled(sound: false, music: true)
                } else if type == AVAudioSession.SilenceSecondaryAudioHintType.end.rawValue {
                    self.secondarySilenced = false; self.syncEpoch() // no automatic replay
                }
            }
        })
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.setActive(false) }
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.setActive(true) }
        })
    }
    private var preferences: GameAudioPreferences {
        func value(_ key: String, fallback: Bool) -> Bool { defaults.object(forKey: key) as? Bool ?? fallback }
        return .init(sound: value(Self.soundKey, fallback: true), music: value(Self.musicKey, fallback: false), haptics: value(Self.hapticsKey, fallback: true))
    }
    private func syncEpoch() { output.epoch.update(preferences: preferences, active: lifecycle.active, interrupted: lifecycle.interrupted, secondarySilenced: secondarySilenced) }
    private func readyCallback() -> @Sendable (GameAudioEpoch.Ticket) -> Void {
        let revision = lifecycle.revision
        return { [weak self] ticket in
            Task { @MainActor [weak self] in
                guard let self, self.output.epoch.valid(ticket) else { return }
                self.lifecycle.sessionReady(revision: revision)
            }
        }
    }
    func soundTicket() -> GameAudioEpoch.Ticket? {
        guard lifecycle.allows(userInitiated: true), !extensionProcess else { return nil }
        syncEpoch(); return output.epoch.ticket(music: false)
    }
    func beginUserAction() {
        guard !extensionProcess, lifecycle.active else { return }
        lifecycle.userAction(); syncEpoch()
        if lifecycle.needsRecovery { output.invalidateSession() }
    }

    /// Invoke only from a user action that explicitly starts a game. No sound
    /// is emitted and Messages, inactive/background, muted and test processes
    /// never activate an audio session here.
    func prewarm() {
        beginUserAction()
        guard !extensionProcess, lifecycle.allows(userInitiated: true) else { return }
        #if !DEBUG
        guard !testing else { return }
        #endif
        let pref = preferences
        guard pref.sound || (pref.music && !secondarySilenced) else { return }
        syncEpoch()
        trace("prewarm:requested")
        output.prewarm(ready: readyCallback())
    }

    func play(_ cue: Cue, token: String? = nil, revealAllowed: Bool = false,
              userInitiated: Bool = false, pendingTicket: GameAudioEpoch.Ticket? = nil) {
        if userInitiated { beginUserAction() }
        if let pendingTicket, (pendingTicket.music != cue.isMusic || !output.epoch.valid(pendingTicket)) {
            trace("suppressed:\(cue.rawValue)"); return
        }
        let admitted = gate.admit(cue, token: token, now: ProcessInfo.processInfo.systemUptime,
                                  preferences: preferences, active: lifecycle.active, inExtension: extensionProcess,
                                  interrupted: !lifecycle.allows(userInitiated: userInitiated), secondarySilenced: secondarySilenced,
                                  revealAllowed: revealAllowed)
        trace("\(admitted ? "accepted" : "suppressed"):\(cue.rawValue)")
        guard admitted else { return }
        #if !DEBUG
        guard !testing else { return }
        #endif
        syncEpoch()
        guard let ticket = pendingTicket ?? output.epoch.ticket(music: cue.isMusic) else { return }
        output.enqueue(cue, ticket: ticket, ready: readyCallback())
    }
    func preferencesChanged() {
        let pref = preferences
        guard preferenceChanges.accepts(pref) else { return }
        syncEpoch()
        if !pref.sound || !pref.music { output.stopDisabled(sound: !pref.sound, music: !pref.music) }
    }
    func setActive(_ isActive: Bool) {
        let changed = lifecycle.setActive(isActive)
        syncEpoch()
        if !isActive { stopAll() }
        else if changed { output.invalidateSession() }
    }
    func cancelPending() { stopAll() }
    func stopAll() { output.stopAll() }
    private func trace(_ entry: String, at time: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        #if DEBUG
        guard probe else { return }
        var lines = debugTraceText.split(separator: "\n").map(String.init)
        lines.append(entry + " @" + String(format: "%.3f", time))
        debugTraceText = lines.suffix(80).joined(separator: "\n")
        #endif
    }
}
