import Foundation
import Observation

enum LiveRoomPollPolicy {
    static func shouldFetch(elapsed: Duration?, socketLive: Bool) -> Bool {
        guard let elapsed else { return true }
        return elapsed >= .seconds(socketLive ? 30 : 3)
    }
}

@MainActor @Observable final class LiveRoomSession {
    enum Connection: String { case disconnected, connecting, live, polling, reconnecting, paused }
    let configuration: LiveRoomConfiguration
    private(set) var state: LiveRoomState?
    private(set) var receivedAt = Date()
    private(set) var connection: Connection = .disconnected
    private(set) var busy = false
    private(set) var error: String?
    private(set) var notice: String?
    private(set) var hasSavedRoom = false
    private(set) var hasPendingAdmission = false
    private(set) var hasPendingAction = false
    private(set) var unreadableSavedAccess = false
    private(set) var secureAccessNeedsRetry = false
    @ObservationIgnored private let transport: any LiveRoomTransporting
    @ObservationIgnored private let store: any LiveRoomCredentialStoring
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var credential: LiveRoomCredential?
    @ObservationIgnored private var pendingAdmission: LiveRoomPendingAdmission?
    @ObservationIgnored private var pendingCommand: LiveRoomCommand?
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var socket: Task<Void, Never>?
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var operationID = UUID()
    @ObservationIgnored private var commandOperationID: UUID?
    @ObservationIgnored private var connectionID = UUID()
    @ObservationIgnored private var retrySecurePersistenceOnNextState = false
    private static let ambiguousCommandNotice = "The action may have reached the room. Reconnect to check, or retry the same action. Your answer is never scored here."
    private static let stoppedWaitingNotice = "Waiting stopped on this device. Reconnect or recover the saved request to check what the server accepted."
    private static let secureResumeNotice = "Secure resume could not be updated. Keep this screen open or try again after unlocking the device."
    private static let secureAdmissionNotice = "Connected, but secure resume could not be updated. Keep this screen open; the saved admission request can be recovered while it remains valid."
    private static let secureRecoveryNotice = "The secure recovery record could not be cleared. Try again while this device is unlocked."

    init(configuration: LiveRoomConfiguration, transport: (any LiveRoomTransporting)? = nil,
         store: (any LiveRoomCredentialStoring)? = nil, now: @escaping @Sendable () -> Date = { Date() }) {
        self.configuration = configuration
        self.transport = transport ?? URLSessionLiveRoomTransport(configuration: configuration)
        self.store = store ?? KeychainLiveRoomCredentialStore()
        self.now = now
        reloadSavedStatus()
    }

    private func reloadSavedStatus() {
        do {
            hasSavedRoom = try store.load(scope: configuration.credentialScope) != nil
            pendingAdmission = try store.loadPending(scope: configuration.credentialScope)
            hasPendingAdmission = pendingAdmission != nil
            unreadableSavedAccess = false
            secureAccessNeedsRetry = false
            _ = discardExpiredAdmissionIfNeeded()
        } catch {
            unreadableSavedAccess = true
            self.error = "Secure room access could not be read. Unlock this device and try again."
        }
    }
    func retrySecureAccess() {
        guard !busy else { return }
        if let credential, state != nil {
            persistAccess(credential)
        } else {
            error = nil; reloadSavedStatus()
        }
    }
    func create(settings: LiveRoomSettings) {
        guard settings.isValid, !busy, !unreadableSavedAccess, !hasSavedRoom, !hasPendingAdmission, credential == nil else { return }
        do {
            let pending = try LiveRoomPendingAdmission.make(scope: configuration.credentialScope, settings: settings)
            try store.savePending(pending)
            pendingAdmission = pending; hasPendingAdmission = true
            runAdmission { [transport] in try await transport.create(settings: settings, pending: pending) }
        } catch { self.error = "Secure recovery could not be saved. Unlock this device before creating a room." }
    }
    func create(quiz: QuizDocument, capacity: Int) {
        guard (2...50).contains(capacity), !busy, !unreadableSavedAccess, !hasSavedRoom,
              !hasPendingAdmission, credential == nil else { return }
        do {
            let pending = try LiveRoomPendingAdmission.make(scope: configuration.credentialScope,
                settings: LiveRoomSettings(capacity: capacity), quiz: quiz)
            try store.savePending(pending)
            pendingAdmission = pending; hasPendingAdmission = true
            runAdmission { [transport] in try await transport.createQuiz(pending: pending) }
        } catch {
            self.error = "The quiz or its secure recovery copy could not be saved. Check the quiz, unlock this device and try again."
        }
    }
    func join(code rawCode: String, nickname rawName: String, acceptsSharing: Bool) {
        let code = LiveRoomState.normalizedCode(rawCode)
        let name = rawName.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !unreadableSavedAccess, !hasSavedRoom, !hasPendingAdmission, credential == nil else { return }
        guard LiveRoomState.validCode(code) else { error = "Enter the six-character live room code. Offline LK challenge codes belong in Enter a challenge."; return }
        guard acceptsSharing, LiveRoomState.validNickname(name) else { error = "Use a nickname of 1–20 letters or numbers and confirm room sharing before joining."; return }
        do {
            let pending = try LiveRoomPendingAdmission.make(scope: configuration.credentialScope, code: code, nickname: name)
            try store.savePending(pending)
            pendingAdmission = pending; hasPendingAdmission = true
            runAdmission { [transport] in try await transport.join(code: code, nickname: name, pending: pending) }
        } catch { self.error = "Secure recovery could not be saved. Unlock this device before joining." }
    }
    func recoverAdmission() {
        guard !busy, !discardExpiredAdmissionIfNeeded(), let pendingAdmission else { return }
        runAdmission(recovering: true) { [transport, now] in
            do { return try await transport.recover(pending: pendingAdmission) }
            catch LiveRoomTransportError.service(let status, _) where [401, 404].contains(status) {
                // The original request might never have reached the service. Reuse its exact
                // admission identity, payload and secret; a fresh ID would risk a duplicate seat.
                guard pendingAdmission.expiresAt > Int64(now().timeIntervalSince1970 * 1_000) else {
                    throw LiveRoomTransportError.service(status: 410, code: "admission_unavailable")
                }
                if pendingAdmission.quizRequest != nil { return try await transport.createQuiz(pending: pendingAdmission) }
                if let settings = pendingAdmission.settings { return try await transport.create(settings: settings, pending: pendingAdmission) }
                guard let code = pendingAdmission.code, let name = pendingAdmission.nickname else { throw LiveRoomTransportError.invalidResponse }
                return try await transport.join(code: code, nickname: name, pending: pendingAdmission)
            }
        }
    }
    private func runAdmission(recovering: Bool = false, work: @escaping @Sendable () async throws -> LiveRoomAdmission) {
        let id = UUID(); operationID = id; commandOperationID = nil; busy = true; error = nil; notice = nil; connection = .connecting
        operation = Task { [weak self] in
            do {
                let admitted = try await work()
                guard let self, !Task.isCancelled, operationID == id else { return }
                try install(admitted)
                busy = false; operation = nil; startUpdates()
            } catch {
                guard let self, operationID == id else { return }
                busy = false; operation = nil; connection = .disconnected
                if !Self.cancelled(error) { self.error = Self.message(error) }
                // Explicit validation/admission rejection is not an ambiguous successful join.
                if let failure = error as? LiveRoomTransportError,
                   case .service(let status, let code) = failure,
                   failure.isDefiniteRejection, code != "admission_conflict",
                   !recovering || status != 429 { clearPendingAdmission() }
                else { notice = "A response may have been lost. Recover the saved request to check the same room or seat; do not create another one." }
            }
        }
    }
    private func install(_ admission: LiveRoomAdmission) throws {
        let value = LiveRoomCredential(scope: configuration.credentialScope, code: admission.code, token: admission.token,
                                       memberId: admission.memberId, expiresAt: admission.state.expiresAt)
        guard value.isValid else { throw LiveRoomTransportError.invalidResponse }
        _ = try admission.state.validated(code: value.code, memberId: value.memberId)
        try verifyCatalogue(admission.state)
        guard let pendingAdmission else { throw LiveRoomTransportError.invalidResponse }
        if let requested = pendingAdmission.settings {
            guard admission.state.role == .host, admission.memberId == "host", admission.state.settings == requested else {
                throw LiveRoomValidationError.unexpectedRoom
            }
            if let upload = pendingAdmission.quizUpload {
                guard admission.state.isQuiz, admission.state.quiz == LiveQuizSummary(id: upload.quiz.id,
                    title: upload.quiz.title, questionCount: upload.quiz.questions.count) else {
                    throw LiveRoomValidationError.unexpectedRoom
                }
            } else if admission.state.isQuiz { throw LiveRoomValidationError.unexpectedRoom }
        } else {
            guard admission.state.role == .player, admission.code == pendingAdmission.code,
                  admission.state.viewer.nickname == pendingAdmission.nickname else { throw LiveRoomValidationError.unexpectedRoom }
        }
        credential = value
        state = admission.state
        receivedAt = Date()
        persistAccess(value, initialAdmission: true)
    }
    func resumeSavedRoom() {
        guard !busy else { return }
        do {
            guard let saved = try store.load(scope: configuration.credentialScope) else { reloadSavedStatus(); return }
            let id = UUID(); operationID = id; commandOperationID = nil; busy = true; error = nil; connection = .connecting
            operation = Task { [weak self, transport] in
                do {
                    let fresh = try await transport.snapshot(credential: saved)
                    guard let self, !Task.isCancelled, operationID == id else { return }
                    credential = saved; try accept(fresh); clearPendingAdmission()
                    busy = false; operation = nil; startUpdates()
                } catch {
                    guard let self, operationID == id else { return }
                    busy = false; operation = nil; connection = .disconnected; self.error = Self.message(error)
                    if (error as? LiveRoomTransportError)?.endsSession == true { finishLocally(message: Self.message(error)) }
                }
            }
        } catch { self.error = "Secure room access could not be read. Unlock this device and try again." }
    }
    func reconnect() {
        guard !busy else { return }
        error = nil
        if credential != nil { startUpdates() }
        else if hasSavedRoom { resumeSavedRoom() }
        else if hasPendingAdmission { recoverAdmission() }
        else { reloadSavedStatus() }
    }
    func send(_ action: LiveRoomAction, value: Int? = nil, locked: Bool? = nil, playerId: String? = nil) {
        guard !busy, !hasPendingAction, let state, credential != nil, allowed(action, in: state) else { return }
        if let value {
            if state.isQuiz {
                guard action == .quizAnswer, state.quizRound?.answers.indices.contains(value) == true else { return }
            } else if !(1...5).contains(value) { return }
        }
        if [.answer, .guess, .quizAnswer].contains(action), value == nil { return }
        if action == .lock, locked == nil { return }
        if action == .kick, !state.players.contains(where: { $0.id == playerId }) { return }
        runCommand(LiveRoomCommand(state: state, action: action, value: value, locked: locked, playerId: playerId))
    }
    func retryPendingAction() {
        guard !busy, let pendingCommand, let state else { return }
        guard state.matchId == pendingCommand.matchId,
              pendingCommand.roundId == nil || state.activeRoundID == pendingCommand.roundId else {
            self.pendingCommand = nil; hasPendingAction = false
            notice = "The room has moved on. Your old action was not applied to a new round."; return
        }
        runCommand(pendingCommand)
    }
    private func runCommand(_ command: LiveRoomCommand) {
        guard let credential else { return }
        let id = UUID(); operationID = id; commandOperationID = id; busy = true; error = nil
        pendingCommand = command; hasPendingAction = true
        operation = Task { [weak self, transport] in
            do {
                let fresh = try await transport.perform(command, credential: credential)
                guard let self, !Task.isCancelled, operationID == id else { return }
                if command.action == .leave || command.action == .close {
                    guard fresh == nil else { throw LiveRoomTransportError.invalidResponse }
                    finishLocally(message: command.action == .close ? "The room is closed." : "You left the room.")
                } else {
                    guard let fresh else { throw LiveRoomTransportError.invalidResponse }
                    try accept(fresh, completingCommand: id)
                    guard operationID == id else { return }
                    settlePendingCommand(completing: id)
                }
            } catch {
                guard let self, operationID == id else { return }
                busy = false; operation = nil
                if commandOperationID == id { commandOperationID = nil }
                if !Self.cancelled(error) { self.error = Self.message(error) }
                if (error as? LiveRoomTransportError)?.endsSession == true { finishLocally(message: Self.message(error)) }
                else if (error as? LiveRoomTransportError)?.isDefiniteRejection == true {
                    pendingCommand = nil; hasPendingAction = false
                    notice = "The server rejected that action. Check the current room before choosing what to do next."
                }
                else { notice = Self.ambiguousCommandNotice }
            }
        }
    }
    func cancelWaiting() {
        operationID = UUID(); commandOperationID = nil; operation?.cancel(); operation = nil; busy = false
        notice = Self.stoppedWaitingNotice
        if credential == nil { connection = .disconnected }
    }
    func suspend() {
        connectionID = UUID(); socket?.cancel(); polling?.cancel(); socket = nil; polling = nil
        if busy { cancelWaiting() }
        connection = .paused
    }
    func forgetSavedAccess() {
        guard !busy, state == nil else { return }
        do {
            try store.remove(scope: configuration.credentialScope)
            try store.removePending(scope: configuration.credentialScope)
            credential = nil; pendingAdmission = nil; hasSavedRoom = false; hasPendingAdmission = false
            unreadableSavedAccess = false; secureAccessNeedsRetry = false
            notice = "Saved access was removed from this device. This does not close a room or remove a remote seat."
        } catch { self.error = "Secure saved access could not be removed. Try again while this device is unlocked." }
    }
    private func startUpdates() {
        guard let credential else { return }
        socket?.cancel(); polling?.cancel()
        // Retry one failed secure write on the first verified update after
        // foreground/reconnect, even when the server's expiry did not change.
        // Repeated same-expiry frames do not repeatedly write to the Keychain.
        retrySecurePersistenceOnNextState = secureAccessNeedsRetry
        let id = UUID(); connectionID = id; connection = .connecting
        polling = Task { [weak self, transport] in
            let clock = ContinuousClock()
            var lastCheck: ContinuousClock.Instant?
            while !Task.isCancelled {
                guard self?.connectionID == id else { return }
                let elapsed = lastCheck.map { $0.duration(to: clock.now) }
                if LiveRoomPollPolicy.shouldFetch(elapsed: elapsed, socketLive: self?.connection == .live) {
                    lastCheck = clock.now
                    do {
                        let fresh = try await transport.snapshot(credential: credential)
                        guard let self, connectionID == id, !Task.isCancelled else { return }
                        try accept(fresh)
                        if connection != .live { connection = .polling }
                    } catch {
                        guard let self, connectionID == id, !Task.isCancelled else { return }
                        if (error as? LiveRoomTransportError)?.endsSession == true { finishLocally(message: Self.message(error)); return }
                        if connection != .live { connection = .reconnecting }
                    }
                }
                // Short monotonic scheduling notices a socket drop promptly instead of
                // leaving the fallback asleep for a whole watchdog interval.
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
            }
        }
        socket = Task { [weak self, transport] in
            var delay = 1.0
            while !Task.isCancelled {
                do {
                    for try await fresh in transport.states(credential: credential) {
                        guard let self, connectionID == id, !Task.isCancelled else { return }
                        try accept(fresh); connection = .live; delay = 1
                    }
                } catch {
                    guard let self, connectionID == id, !Task.isCancelled else { return }
                    if connection == .live { connection = .polling }
                }
                do { try await Task.sleep(nanoseconds: UInt64(delay * Double.random(in: 0.8...1.2) * 1_000_000_000)) } catch { return }
                delay = min(20, delay * 2)
            }
        }
    }
    private func accept(_ fresh: LiveRoomState, completingCommand completionID: UUID? = nil) throws {
        guard var credential else { throw LiveRoomTransportError.invalidResponse }
        _ = try fresh.validated(code: credential.code, memberId: credential.memberId)
        try verifyCatalogue(fresh)
        if let old = state {
            guard fresh.isQuiz == old.isQuiz, fresh.quiz == old.quiz else { throw LiveRoomValidationError.unexpectedRoom }
            guard fresh.revision >= old.revision else { return }
            if fresh.revision == old.revision && fresh.serverTime < old.serverTime { return }
        }
        let settlesPendingCommand = pendingCommand.map { command in
            command.matchId != fresh.matchId ||
            command.roundId.map { $0 != fresh.activeRoundID } == true ||
            ([.answer, .guess, .quizAnswer].contains(command.action) && command.value != nil && fresh.ownLockedValue == command.value) ||
            (fresh.isQuiz && fresh.phase != .answer && [.quizAnswer, .quizReveal].contains(command.action))
        } ?? false
        state = fresh
        receivedAt = Date()
        if settlesPendingCommand { settlePendingCommand(completing: completionID) }
        let expiryChanged = credential.expiresAt != fresh.expiresAt
        if expiryChanged {
            credential.expiresAt = fresh.expiresAt; self.credential = credential
        }
        let retriesSecureWrite = retrySecurePersistenceOnNextState && secureAccessNeedsRetry
        retrySecurePersistenceOnNextState = false
        if expiryChanged || retriesSecureWrite { persistAccess(credential) }
    }
    private func settlePendingCommand(completing completionID: UUID? = nil) {
        pendingCommand = nil; hasPendingAction = false; error = nil
        if notice == Self.ambiguousCommandNotice || notice == Self.stoppedWaitingNotice { notice = nil }
        guard let owner = commandOperationID else { return }
        commandOperationID = nil
        guard operationID == owner else { return }
        let commandTask = operation
        operationID = UUID(); operation = nil; busy = false
        // A projection can settle a suspended HTTP request. Retire its ownership
        // before cancellation so a late completion cannot change the next action.
        // A successful HTTP response already owns this completion and need not
        // cancel its own task while applying the validated state.
        if completionID != owner { commandTask?.cancel() }
    }
    private func verifyCatalogue(_ state: LiveRoomState) throws {
        if state.isQuiz { return }
        guard let prompt = state.round?.prompt else { return }
        guard let round = TopicPlayLibrary.round(id: prompt.id), round.text == prompt.text,
              round.topic.rawValue == prompt.topic, round.sceneSummary == prompt.sceneSummary else {
            throw LiveRoomValidationError.catalogueMismatch
        }
    }
    private func persistAccess(_ credential: LiveRoomCredential, initialAdmission: Bool = false) {
        do { try store.save(credential); hasSavedRoom = true }
        catch {
            secureAccessNeedsRetry = true
            notice = initialAdmission ? Self.secureAdmissionNotice : Self.secureResumeNotice
            return
        }
        if clearPendingAdmission() {
            secureAccessNeedsRetry = false
            if let notice, [Self.secureResumeNotice, Self.secureAdmissionNotice, Self.secureRecoveryNotice].contains(notice) { self.notice = nil }
        }
    }
    @discardableResult private func clearPendingAdmission() -> Bool {
        do {
            try store.removePending(scope: configuration.credentialScope); pendingAdmission = nil; hasPendingAdmission = false
            if credential == nil && !hasSavedRoom { secureAccessNeedsRetry = false }
            return true
        } catch {
            secureAccessNeedsRetry = true; notice = Self.secureRecoveryNotice
            return false
        }
    }
    @discardableResult private func discardExpiredAdmissionIfNeeded() -> Bool {
        guard let pendingAdmission, pendingAdmission.expiresAt <= Int64(now().timeIntervalSince1970 * 1_000) else { return false }
        clearPendingAdmission()
        notice = "The saved admission request has expired. It will not be sent again. You can create or join a room after its saved access is cleared."
        return true
    }
    private func finishLocally(message: String) {
        suspend(); operationID = UUID(); commandOperationID = nil; operation?.cancel(); operation = nil; busy = false
        credential = nil; state = nil; pendingCommand = nil; hasPendingAction = false; connection = .disconnected
        secureAccessNeedsRetry = false; retrySecurePersistenceOnNextState = false
        do { try store.remove(scope: configuration.credentialScope); hasSavedRoom = false }
        catch { self.error = "The room is no longer active here, but its secure resume entry could not be removed. Try Forget saved access."; hasSavedRoom = true; secureAccessNeedsRetry = true }
        clearPendingAdmission(); notice = message
    }
    private func allowed(_ action: LiveRoomAction, in state: LiveRoomState) -> Bool {
        if action == .heartbeat { return true }
        if state.isQuiz {
            if state.role == .player { return action == .leave || (action == .quizAnswer && state.canSubmit) }
            switch action {
            case .start: return state.phase == .lobby && state.players.count >= 2
            case .quizReveal: return state.phase == .answer
            case .next: return state.phase == .reveal
            case .lock: return state.phase == .lobby
            case .kick, .close: return true
            case .end: return state.phase == .answer || state.phase == .reveal
            case .rematch: return state.phase == .finished
            default: return false
            }
        }
        if state.role == .player {
            return action == .leave || (state.canSubmit && ((state.isSubject && action == .answer) || (!state.isSubject && action == .guess)))
        }
        switch action {
        case .start: return state.phase == .lobby && state.players.count >= 2
        case .next: return state.phase == .reveal
        case .pause: return [.answer, .predict].contains(state.phase) && state.round?.paused == false
        case .resume: return [.answer, .predict].contains(state.phase) && state.round?.paused == true
        case .skip: return [.answer, .predict].contains(state.phase)
        case .lock: return state.phase == .lobby
        case .kick, .end, .close: return true
        case .rematch: return state.phase == .finished
        default: return false
        }
    }
    private static func cancelled(_ error: Error) -> Bool { error is CancellationError || (error as? URLError)?.code == .cancelled }
    private static func message(_ error: Error) -> String {
        if let value = error as? LiveRoomTransportError { return value.message }
        if error is LiveRoomValidationError || error is DecodingError { return LiveRoomTransportError.invalidResponse.message }
        return LiveRoomTransportError.unavailable.message
    }
}
