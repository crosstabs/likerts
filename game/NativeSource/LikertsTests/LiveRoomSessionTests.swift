#if canImport(UIKit)
import XCTest
@testable import Likerts

@MainActor final class LiveRoomSessionTests: XCTestCase {
    private func configuration() -> LiveRoomConfiguration {
        LiveRoomConfiguration(apiBaseURL: URL(string: "http://127.0.0.1:19191/api/live")!, inviteBaseURL: URL(string: "http://127.0.0.1:19191/play")!)
    }
    private func receipt(_ name: String = "lobbyHost") throws -> LiveRoomAdmission {
        let state = try LiveRoomTestFixtures.state(name)
        return LiveRoomAdmission(code: state.code, token: String(repeating: "A", count: 43), memberId: state.viewer.id, state: state)
    }
    private func settings() -> LiveRoomSettings {
        var value = LiveRoomSettings(); value.answerSeconds = 0; value.predictSeconds = 0; return value
    }
    private func settled(_ session: LiveRoomSession) async {
        for _ in 0..<100 {
            if !session.busy { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("Room operation did not settle")
    }
    private func received(_ expected: LiveRoomState, in session: LiveRoomSession, attempts: Int = 100) async {
        for _ in 0..<attempts {
            if session.state?.revision == expected.revision { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("The authoritative room update was not received")
    }
    private func recordedCommand(_ count: Int, from transport: LiveMockTransport) async throws -> LiveRoomCommand {
        for _ in 0..<100 {
            if await transport.commandCount() >= count {
                let command = await transport.lastCommand()
                return try XCTUnwrap(command)
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTFail("The command did not reach the held transport")
        let command: LiveRoomCommand? = nil
        return try XCTUnwrap(command)
    }
    private func revised(_ state: LiveRoomState, mutate: (inout [String: Any]) -> Void = { _ in }) throws -> LiveRoomState {
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        raw["revision"] = state.revision + 1; raw["serverTime"] = state.serverTime + 1
        mutate(&raw)
        return try LiveRoomWireDecoder.state(JSONSerialization.data(withJSONObject: ["state": raw]))
    }
    private func advancedRound(_ fixture: String, after previous: LiveRoomState) throws -> LiveRoomState {
        var raw = try LiveRoomTestFixtures.raw(fixture)
        var round = try XCTUnwrap(raw["round"] as? [String: Any])
        let priorRound = try XCTUnwrap(previous.round)
        let subject = try XCTUnwrap(previous.players.first(where: { $0.id != priorRound.subjectId }))
        let prompt = try XCTUnwrap(TopicPlayLibrary.round(id: 1007))
        round["id"] = UUID().uuidString.lowercased()
        round["index"] = priorRound.index + 1
        round["subjectId"] = subject.id; round["subjectName"] = subject.nickname
        round["prompt"] = ["id": prompt.id, "text": prompt.text, "topic": prompt.topic.rawValue, "sceneSummary": prompt.sceneSummary]
        raw["round"] = round; raw["revision"] = previous.revision + 1; raw["serverTime"] = previous.serverTime + 1
        return try LiveRoomWireDecoder.state(JSONSerialization.data(withJSONObject: ["state": raw]))
    }
    func testAdmissionIsPersistedBeforeAnyNetworkRequestAndOnlyScopedAccessAfterwards() async throws {
        let config = configuration(), store = LiveMemoryCredentialStore()
        let transport = LiveMockTransport(admission: try receipt(), observeAdmission: { pending in
            await MainActor.run { XCTAssertEqual(store.pending, pending) }
        })
        let session = LiveRoomSession(configuration: config, transport: transport, store: store)
        defer { session.suspend() }
        session.create(settings: settings())
        XCTAssertNotNil(store.pending)
        await settled(session)
        XCTAssertEqual(session.state?.role, .host)
        XCTAssertEqual(store.credential?.scope, config.credentialScope)
        XCTAssertEqual(store.credential?.memberId, "host")
        XCTAssertNil(store.pending); XCTAssertFalse(session.hasPendingAdmission)
        let creates = await transport.count(.create)
        XCTAssertEqual(creates, 1)
    }
    func testSecureStoreFailurePreventsAdmissionAndUnreadableStoreFailsClosed() async throws {
        let store = LiveMemoryCredentialStore(); store.failWrite = true
        let transport = LiveMockTransport(admission: try receipt())
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        session.create(settings: settings())
        XCTAssertFalse(session.busy); XCTAssertNotNil(session.error)
        let createsBefore = await transport.count(.create)
        XCTAssertEqual(createsBefore, 0)
        let unreadable = LiveMemoryCredentialStore(); unreadable.failRead = true
        let lockedSession = LiveRoomSession(configuration: configuration(), transport: transport, store: unreadable)
        lockedSession.create(settings: settings())
        XCTAssertTrue(lockedSession.unreadableSavedAccess)
        let createsAfter = await transport.count(.create)
        XCTAssertEqual(createsAfter, 0)
        unreadable.failRead = false; lockedSession.retrySecureAccess()
        XCTAssertFalse(lockedSession.unreadableSavedAccess)
    }
    func testSameExpiryReconnectRetriesSecureResumeAfterUnlockWithoutAnotherAdmission() async throws {
        let store = LiveMemoryCredentialStore(); store.failMemberWrite = true
        let transport = LiveMockTransport(admission: try receipt())
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        defer { session.suspend() }
        session.create(settings: settings()); await settled(session); session.suspend()
        XCTAssertNotNil(session.state); XCTAssertTrue(store.credential == nil); XCTAssertTrue(store.pending != nil)
        XCTAssertTrue(session.secureAccessNeedsRetry)
        let admissionID = store.pending?.admissionId
        store.failMemberWrite = false
        session.reconnect()
        for _ in 0..<100 {
            if store.credential != nil && store.pending == nil { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(store.credential?.memberId, "host", "Unlock/reconnect must retry a failed save even if expiry is unchanged")
        XCTAssertTrue(session.hasSavedRoom); XCTAssertTrue(store.pending == nil); XCTAssertFalse(session.hasPendingAdmission)
        XCTAssertFalse(session.secureAccessNeedsRetry)
        let creates = await transport.count(.create), recoveries = await transport.count(.recover)
        XCTAssertEqual(creates, 1); XCTAssertEqual(recoveries, 0)
        XCTAssertNotNil(admissionID, "The original recovery record existed until scoped access was safely saved")
    }
    func testVerifiedReconnectRetriesPendingDeletionAfterUnlock() async throws {
        let store = LiveMemoryCredentialStore(); store.failPendingRemoval = true
        let transport = LiveMockTransport(admission: try receipt())
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        defer { session.suspend() }
        session.create(settings: settings()); await settled(session); session.suspend()
        XCTAssertTrue(store.credential != nil); XCTAssertTrue(store.pending != nil); XCTAssertTrue(session.hasPendingAdmission)
        XCTAssertTrue(session.secureAccessNeedsRetry)
        store.failPendingRemoval = false
        session.reconnect()
        for _ in 0..<100 {
            if store.pending == nil { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertTrue(store.credential != nil); XCTAssertTrue(store.pending == nil)
        XCTAssertTrue(session.hasSavedRoom); XCTAssertFalse(session.hasPendingAdmission)
        XCTAssertFalse(session.secureAccessNeedsRetry)
        let creates = await transport.count(.create), recoveries = await transport.count(.recover)
        XCTAssertEqual(creates, 1); XCTAssertEqual(recoveries, 0)
    }
    func testActiveSecureRetrySavesTheExistingSeatWithoutASecondNetworkAdmission() async throws {
        let store = LiveMemoryCredentialStore(); store.failMemberWrite = true
        let transport = LiveMockTransport(admission: try receipt())
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        defer { session.suspend() }
        session.create(settings: settings()); await settled(session); session.suspend()
        XCTAssertNotNil(session.state); XCTAssertTrue(store.credential == nil); XCTAssertTrue(store.pending != nil)
        store.failMemberWrite = false
        session.retrySecureAccess()
        XCTAssertTrue(store.credential != nil); XCTAssertTrue(store.pending == nil)
        XCTAssertTrue(session.hasSavedRoom); XCTAssertFalse(session.hasPendingAdmission)
        XCTAssertFalse(session.secureAccessNeedsRetry)
        let creates = await transport.count(.create), joins = await transport.count(.join), recoveries = await transport.count(.recover)
        XCTAssertEqual(creates, 1); XCTAssertEqual(joins, 0); XCTAssertEqual(recoveries, 0)
    }
    func testRepeatedSameExpiryUpdatesDoNotLoopFailedSecureWrites() async throws {
        let store = LiveMemoryCredentialStore(); store.failMemberWrite = true
        let transport = LiveMockTransport(admission: try receipt())
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        defer { session.suspend() }
        session.create(settings: settings()); await settled(session)
        for _ in 0..<100 {
            if await transport.snapshotCount() >= 1 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        try await Task.sleep(nanoseconds: 20_000_000)
        let attempts = store.memberSaveAttempts
        for _ in 0..<450 {
            if await transport.snapshotCount() >= 2 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        let snapshots = await transport.snapshotCount()
        XCTAssertGreaterThanOrEqual(snapshots, 2)
        XCTAssertEqual(store.memberSaveAttempts, attempts, "Same-expiry polling must not repeatedly write to unavailable secure storage")
        XCTAssertTrue(session.secureAccessNeedsRetry)
        session.retrySecureAccess()
        XCTAssertEqual(store.memberSaveAttempts, attempts + 1, "An explicit user retry is allowed without a fresh admission")
        let creates = await transport.count(.create)
        XCTAssertEqual(creates, 1)
    }
    func testLostAdmissionKeepsOriginalRecoveryIdentityAcrossSessionRestart() async throws {
        let config = configuration(), store = LiveMemoryCredentialStore()
        let transport = LiveMockTransport(admission: try receipt())
        await transport.setCreateFailure(.unavailable)
        let first = LiveRoomSession(configuration: config, transport: transport, store: store)
        first.create(settings: settings()); await settled(first)
        let saved = try XCTUnwrap(store.pending)
        XCTAssertTrue(first.hasPendingAdmission); XCTAssertNil(first.state)
        first.suspend()
        await transport.setCreateFailure(nil)
        let restarted = LiveRoomSession(configuration: config, transport: transport, store: store)
        defer { restarted.suspend() }
        restarted.recoverAdmission(); await settled(restarted)
        let recovered = await transport.lastRecovery()
        XCTAssertEqual(recovered, saved)
        XCTAssertNotNil(restarted.state); XCTAssertNil(store.pending)
        let creates = await transport.count(.create)
        XCTAssertEqual(creates, 1, "Recovery should not blindly make a second room")
    }
    func testUnknownAdmissionResendsIdenticalPayloadInsteadOfNewIdentity() async throws {
        let config = configuration(), store = LiveMemoryCredentialStore()
        let original = try LiveRoomPendingAdmission.make(scope: config.credentialScope, code: "ABCDEF", nickname: "Ari")
        store.pending = original
        let transport = LiveMockTransport(admission: try receipt("lobbyPlayer"))
        await transport.setRecoveryFailure(.service(status: 401, code: "admission_invalid"))
        let session = LiveRoomSession(configuration: config, transport: transport, store: store)
        defer { session.suspend() }
        session.recoverAdmission(); await settled(session)
        let joined = await transport.lastJoin(), recovered = await transport.lastRecovery()
        XCTAssertEqual(joined, original)
        XCTAssertEqual(recovered, original)
        XCTAssertNotNil(session.state); XCTAssertNil(store.pending)
    }
    func testExpiredRecoveryIsClearedWithoutCreatingOrJoining() async throws {
        let config = configuration(), store = LiveMemoryCredentialStore()
        store.pending = try LiveRoomPendingAdmission.make(scope: config.credentialScope, settings: settings())
        let transport = LiveMockTransport(admission: try receipt())
        await transport.setRecoveryFailure(.service(status: 410, code: "admission_unavailable"))
        let session = LiveRoomSession(configuration: config, transport: transport, store: store)
        session.recoverAdmission(); await settled(session)
        XCTAssertNil(store.pending); XCTAssertFalse(session.hasPendingAdmission)
        let creates = await transport.count(.create), joins = await transport.count(.join)
        XCTAssertEqual(creates, 0); XCTAssertEqual(joins, 0)
    }
    func testLocallyExpiredNeverDeliveredAdmissionIsNotResent() async throws {
        let config = configuration(), store = LiveMemoryCredentialStore()
        let pending = try LiveRoomPendingAdmission.make(scope: config.credentialScope, settings: settings())
        store.pending = pending
        let transport = LiveMockTransport(admission: try receipt())
        await transport.setRecoveryFailure(.service(status: 404, code: "admission_invalid"))
        let clock = Date(timeIntervalSince1970: Double(pending.expiresAt + 1) / 1_000)
        let session = LiveRoomSession(configuration: config, transport: transport, store: store, now: { clock })
        session.recoverAdmission(); await settled(session)
        XCTAssertNil(store.pending); XCTAssertFalse(session.hasPendingAdmission)
        let recoveries = await transport.count(.recover), creates = await transport.count(.create)
        XCTAssertEqual(recoveries, 0); XCTAssertEqual(creates, 0)
    }
    func testCancelledLateAdmissionCannotEnterRoomAndRecoveryIsPreserved() async throws {
        let store = LiveMemoryCredentialStore(), transport = LiveMockTransport(admission: try receipt(), delayAdmission: true)
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        session.create(settings: settings())
        session.cancelWaiting()
        try await Task.sleep(nanoseconds: 80_000_000)
        XCTAssertNil(session.state); XCTAssertFalse(session.busy); XCTAssertNotNil(store.pending)
        XCTAssertNil(store.credential)
    }
    func testRoleCannotSubmitAnotherPersonsAnswerAndLocksAreNeverOptimistic() async throws {
        let store = LiveMemoryCredentialStore(), transport = LiveMockTransport(admission: try receipt("predictOtherGuest"))
        await transport.setActionFailure(.unavailable)
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        defer { session.suspend() }
        session.join(code: "ABCDEF", nickname: "Cam", acceptsSharing: true); await settled(session)
        session.send(.answer, value: 4)
        let countBefore = await transport.commandCount()
        XCTAssertEqual(countBefore, 0)
        session.send(.guess, value: 4); await settled(session)
        XCTAssertNil(session.state?.ownLockedValue)
        XCTAssertTrue(session.hasPendingAction)
        let last = await transport.lastCommand()
        let original = try XCTUnwrap(last)
        session.send(.guess, value: 1)
        let afterFreshAttempt = await transport.lastCommand(), countBeforeRetry = await transport.commandCount()
        XCTAssertEqual(afterFreshAttempt?.requestId, original.requestId)
        XCTAssertEqual(afterFreshAttempt?.value, 4)
        XCTAssertEqual(countBeforeRetry, 1, "Ambiguous locks must not be replaced by a fresh request")
        session.retryPendingAction(); await settled(session)
        let retried = await transport.lastCommand(), countAfter = await transport.commandCount()
        XCTAssertEqual(retried?.requestId, original.requestId)
        XCTAssertEqual(countAfter, 2)
    }
    func testLostNextAcknowledgementClearsPendingWhenAuthoritativeRoundAdvances() async throws {
        let admission = try receipt("revealHost")
        let transport = LiveMockTransport(admission: admission)
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: LiveMemoryCredentialStore())
        defer { session.suspend() }
        session.create(settings: settings()); await settled(session); session.suspend()
        await transport.setActionFailure(.unavailable)
        session.send(.next); await settled(session)
        XCTAssertTrue(session.hasPendingAction, "A lost acknowledgement starts as an ambiguous request")
        let sentCommand = await transport.lastCommand()
        let sent = try XCTUnwrap(sentCommand)
        XCTAssertEqual(sent.action, .next)
        let fresh = try advancedRound("answerHost", after: admission.state)
        XCTAssertEqual(fresh.matchId, admission.state.matchId)
        await transport.setSnapshot(fresh)
        session.reconnect(); await received(fresh, in: session)
        XCTAssertFalse(session.hasPendingAction, "A confirmed newer round releases controls without a manual retry")
        XCTAssertNil(session.error); XCTAssertNil(session.notice)
        XCTAssertTrue(session.state?.round?.id == fresh.round?.id)
        let commandCount = await transport.commandCount()
        XCTAssertEqual(commandCount, 1, "Reconciliation must not resend the old Next request")
    }
    func testLostAnswerAcknowledgementClearsPendingWhenRoomMovesToAnotherSubject() async throws {
        let admission = try receipt("answerSubject")
        let transport = LiveMockTransport(admission: admission)
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: LiveMemoryCredentialStore())
        defer { session.suspend() }
        session.join(code: admission.code, nickname: admission.state.viewer.nickname, acceptsSharing: true)
        await settled(session); session.suspend()
        await transport.setActionFailure(.unavailable)
        session.send(.answer, value: 4); await settled(session)
        XCTAssertTrue(session.hasPendingAction); XCTAssertNil(session.state?.ownLockedValue)
        let fresh = try advancedRound("answerSubject", after: admission.state)
        XCTAssertEqual(fresh.matchId, admission.state.matchId)
        XCTAssertFalse(fresh.isSubject); XCTAssertNil(fresh.ownLockedValue)
        await transport.setSnapshot(fresh)
        session.reconnect(); await received(fresh, in: session)
        XCTAssertFalse(session.hasPendingAction, "The old answer cannot block the next subject's round")
        XCTAssertNil(session.error); XCTAssertNil(session.notice)
        XCTAssertNil(session.state?.ownLockedValue, "Advancement never invents confirmation of an old private answer")
        let commandCount = await transport.commandCount()
        XCTAssertEqual(commandCount, 1)
    }
    func testNewerSameRoundSnapshotRetainsAmbiguousRequestAndOriginalRetryIdentity() async throws {
        let admission = try receipt("predictOtherGuest")
        let transport = LiveMockTransport(admission: admission)
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: LiveMemoryCredentialStore())
        defer { session.suspend() }
        session.join(code: admission.code, nickname: admission.state.viewer.nickname, acceptsSharing: true)
        await settled(session); session.suspend()
        await transport.setActionFailure(.unavailable)
        session.send(.guess, value: 4); await settled(session)
        let originalCommand = await transport.lastCommand()
        let original = try XCTUnwrap(originalCommand)
        var raw = try LiveRoomTestFixtures.raw("predictOtherGuest")
        raw["revision"] = admission.state.revision + 1; raw["serverTime"] = admission.state.serverTime + 1
        let fresh = try LiveRoomWireDecoder.state(JSONSerialization.data(withJSONObject: ["state": raw]))
        await transport.setSnapshot(fresh)
        session.reconnect(); await received(fresh, in: session)
        XCTAssertTrue(session.hasPendingAction, "A newer snapshot of the same round does not establish whether its lock arrived")
        session.retryPendingAction(); await settled(session)
        let retriedCommand = await transport.lastCommand()
        let retry = try XCTUnwrap(retriedCommand)
        XCTAssertTrue(retry.requestId == original.requestId)
        XCTAssertTrue(retry.roundId == original.roundId)
        XCTAssertEqual(retry.value, 4)
        let commandCount = await transport.commandCount()
        XCTAssertEqual(commandCount, 2)
        XCTAssertTrue(session.hasPendingAction)
    }
    func testNewRoundSettlesHeldNextRetryImmediatelyAndLateReceiptCannotReleaseANewerCommand() async throws {
        let admission = try receipt("revealHost"), transport = LiveMockTransport(admission: try receipt("revealHost"))
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: LiveMemoryCredentialStore())
        defer { session.suspend(); Task { await transport.releaseHeldPerforms() } }
        session.create(settings: settings()); await settled(session)
        await transport.setActionFailure(.unavailable)
        session.send(.next); await settled(session)
        XCTAssertTrue(session.hasPendingAction); XCTAssertNotNil(session.notice)
        let original = try await recordedCommand(1, from: transport)
        await transport.setActionFailure(nil); await transport.holdPerforms(true)
        session.retryPendingAction()
        let retry = try await recordedCommand(2, from: transport)
        XCTAssertTrue(retry.requestId == original.requestId); XCTAssertTrue(session.busy)
        let fresh = try advancedRound("answerHost", after: admission.state)
        await transport.setSnapshot(fresh)
        await received(fresh, in: session, attempts: 500)
        XCTAssertFalse(session.busy, "An authoritative new round must not wait for the old HTTP deadline")
        XCTAssertFalse(session.hasPendingAction); XCTAssertNil(session.error); XCTAssertNil(session.notice)
        session.send(.pause)
        let newer = try await recordedCommand(3, from: transport)
        XCTAssertEqual(newer.action, .pause); XCTAssertTrue(newer.requestId != original.requestId)
        await transport.completePerform(original.requestId, with: admission.state)
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertTrue(session.busy, "A late old receipt cannot release the newer operation")
        XCTAssertTrue(session.hasPendingAction); XCTAssertTrue(session.state?.round?.id == fresh.round?.id)
        let paused = try revised(fresh) { raw in
            var round = raw["round"] as! [String: Any]; round["paused"] = true; raw["round"] = round
        }
        await transport.completePerform(newer.requestId, with: paused)
        await settled(session)
        XCTAssertFalse(session.busy); XCTAssertFalse(session.hasPendingAction)
        XCTAssertEqual(session.state?.round?.paused, true)
    }
    func testConfirmedOwnLockSettlesHeldHTTPWithoutRetryAndIgnoresItsLateInvalidReceipt() async throws {
        let admission = try receipt("answerSubject"), transport = LiveMockTransport(admission: try receipt("answerSubject"))
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: LiveMemoryCredentialStore())
        defer { session.suspend(); Task { await transport.releaseHeldPerforms() } }
        session.join(code: admission.code, nickname: admission.state.viewer.nickname, acceptsSharing: true); await settled(session)
        await transport.holdPerforms(true)
        session.send(.answer, value: 4)
        let pending = try await recordedCommand(1, from: transport)
        XCTAssertTrue(session.busy); XCTAssertTrue(session.hasPendingAction)
        let confirmed = try LiveRoomTestFixtures.state("predictSubject")
        await transport.setSnapshot(confirmed)
        await received(confirmed, in: session, attempts: 500)
        XCTAssertFalse(session.busy); XCTAssertFalse(session.hasPendingAction)
        XCTAssertEqual(session.state?.ownLockedValue, 4)
        await transport.completePerform(pending.requestId, with: nil)
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertNil(session.error, "A retired request must not surface its late invalid receipt")
        XCTAssertEqual(session.state?.ownLockedValue, 4)
        let commandCount = await transport.commandCount()
        XCTAssertEqual(commandCount, 1)
    }
    func testOwnLockConfirmedInsideItsHTTPResponseCompletesWithoutCancellingANewerAction() async throws {
        let admission = try receipt("answerSubject"), transport = LiveMockTransport(admission: try receipt("answerSubject"))
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: LiveMemoryCredentialStore())
        defer { session.suspend(); Task { await transport.releaseHeldPerforms() } }
        session.join(code: admission.code, nickname: admission.state.viewer.nickname, acceptsSharing: true)
        await settled(session); session.suspend()
        await transport.holdPerforms(true)
        session.send(.answer, value: 4)
        let pending = try await recordedCommand(1, from: transport)
        await transport.completePerform(pending.requestId, with: try LiveRoomTestFixtures.state("predictSubject"))
        await settled(session)
        XCTAssertFalse(session.busy); XCTAssertFalse(session.hasPendingAction); XCTAssertNil(session.error)
        XCTAssertEqual(session.state?.ownLockedValue, 4)
        await transport.holdPerforms(false)
        session.send(.heartbeat); await settled(session)
        let next = try await recordedCommand(2, from: transport)
        XCTAssertEqual(next.action, .heartbeat)
        XCTAssertFalse(session.busy); XCTAssertFalse(session.hasPendingAction)
    }
    func testSameRoundWithoutConfirmedValueKeepsHeldRequestAndOriginalRetryIdentity() async throws {
        let admission = try receipt("predictOtherGuest"), transport = LiveMockTransport(admission: try receipt("predictOtherGuest"))
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: LiveMemoryCredentialStore())
        defer { session.suspend(); Task { await transport.releaseHeldPerforms() } }
        session.join(code: admission.code, nickname: admission.state.viewer.nickname, acceptsSharing: true); await settled(session)
        await transport.holdPerforms(true)
        session.send(.guess, value: 4)
        let original = try await recordedCommand(1, from: transport)
        let fresh = try revised(admission.state)
        await transport.setSnapshot(fresh)
        await received(fresh, in: session, attempts: 500)
        XCTAssertTrue(session.busy); XCTAssertTrue(session.hasPendingAction); XCTAssertNil(session.state?.ownLockedValue)
        await transport.failPerform(original.requestId, with: .unavailable)
        await settled(session)
        XCTAssertFalse(session.busy); XCTAssertTrue(session.hasPendingAction)
        await transport.holdPerforms(false); await transport.setActionFailure(.unavailable)
        session.retryPendingAction(); await settled(session)
        let retry = try await recordedCommand(2, from: transport)
        XCTAssertTrue(retry.requestId == original.requestId); XCTAssertTrue(retry.roundId == original.roundId)
        XCTAssertEqual(retry.value, 4); XCTAssertTrue(session.hasPendingAction)
    }
    func testDefinitePhaseRejectionReleasesPendingCommandAndAllowsNextAction() async throws {
        let store = LiveMemoryCredentialStore(), transport = LiveMockTransport(admission: try receipt("answerHost"))
        await transport.setActionFailure(.service(status: 409, code: "wrong_phase"))
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        defer { session.suspend() }
        session.create(settings: settings()); await settled(session)
        session.send(.pause); await settled(session)
        XCTAssertFalse(session.hasPendingAction)
        await transport.setActionFailure(nil)
        session.send(.close); await settled(session)
        XCTAssertNil(session.state); XCTAssertNil(store.credential)
        let last = await transport.lastCommand()
        XCTAssertEqual(last?.action, .close)
    }
    func testSuspendRetainsSeatAndTerminalReceiptAloneClearsSavedAccess() async throws {
        let store = LiveMemoryCredentialStore(), transport = LiveMockTransport(admission: try receipt("lobbyPlayer"))
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        session.join(code: "ABCDEF", nickname: "Ari", acceptsSharing: true); await settled(session)
        session.suspend()
        XCTAssertNotNil(store.credential); XCTAssertNotNil(session.state)
        let count = await transport.commandCount()
        XCTAssertEqual(count, 0, "Backgrounding must never implicitly leave")
        session.send(.leave); await settled(session)
        XCTAssertNil(store.credential); XCTAssertNil(session.state)
        let command = await transport.lastCommand()
        XCTAssertEqual(command?.action, .leave)
    }
    func testRemoteQuestionMustExactlyMatchBundledReviewedCatalogue() async throws {
        var raw = try LiveRoomTestFixtures.raw("answerHost")
        var round = raw["round"] as! [String: Any], prompt = round["prompt"] as! [String: Any]
        prompt["text"] = "An unreviewed replacement question."
        round["prompt"] = prompt; raw["round"] = round
        let invalid = try LiveRoomWireDecoder.state(JSONSerialization.data(withJSONObject: ["state": raw]))
        let admission = LiveRoomAdmission(code: invalid.code, token: String(repeating: "A", count: 43), memberId: "host", state: invalid)
        let store = LiveMemoryCredentialStore(), transport = LiveMockTransport(admission: admission)
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        session.create(settings: settings()); await settled(session)
        XCTAssertNil(session.state); XCTAssertNil(store.credential); XCTAssertNotNil(session.error)
        XCTAssertNotNil(store.pending, "An ambiguous response still needs same-admission recovery")
    }
    func testCreateReceiptMustMatchRequestedSettingsAndHostRole() async throws {
        for name in ["lobbyHost", "lobbyPlayer"] {
            let store = LiveMemoryCredentialStore(), transport = LiveMockTransport(admission: try receipt(name))
            let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
            // An untimed receipt cannot satisfy a timed create request, and
            // a player receipt cannot substitute for the requested host role.
            session.create(settings: name == "lobbyHost" ? LiveRoomSettings() : settings()); await settled(session)
            XCTAssertNil(session.state, name); XCTAssertNil(store.credential, name)
            XCTAssertNotNil(store.pending, name)
            session.suspend()
        }
    }
    func testJoinReceiptIsBoundToRequestedRoomNicknameAndPlayerRole() async throws {
        for (fixture, requestedCode, requestedName) in [("lobbyPlayer", "ZZZZZZ", "Ari"), ("lobbyPlayer", "ABCDEF", "Other"), ("lobbyHost", "ABCDEF", "Host")] {
            let store = LiveMemoryCredentialStore(), transport = LiveMockTransport(admission: try receipt(fixture))
            let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
            session.join(code: requestedCode, nickname: requestedName, acceptsSharing: true); await settled(session)
            XCTAssertNil(session.state, fixture); XCTAssertNil(store.credential, fixture)
            XCTAssertNotNil(store.pending, fixture)
            session.suspend()
        }
    }
    func testDefiniteInitialJoinRejectionAllowsEditingAndRetryingWithoutRecoveryTrap() async throws {
        for reason in ["nickname_taken", "room_locked", "room_full"] {
            let store = LiveMemoryCredentialStore(), transport = LiveMockTransport(admission: try receipt("lobbyPlayer"))
            await transport.setJoinFailure(.service(status: 409, code: reason))
            let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
            session.join(code: "ABCDEF", nickname: "Ari", acceptsSharing: true); await settled(session)
            let rejected = await transport.lastJoin()
            XCTAssertNil(store.pending, reason); XCTAssertFalse(session.hasPendingAdmission, reason)
            await transport.setJoinFailure(nil)
            session.join(code: "ABCDEF", nickname: "Ari", acceptsSharing: true); await settled(session)
            let admitted = await transport.lastJoin()
            XCTAssertNotEqual(rejected?.admissionId, admitted?.admissionId)
            XCTAssertNotNil(session.state, reason)
            session.suspend()
        }
    }
    func testAdmissionConflictRetainsOriginalRecoveryIdentity() async throws {
        let store = LiveMemoryCredentialStore(), transport = LiveMockTransport(admission: try receipt())
        await transport.setCreateFailure(.service(status: 409, code: "admission_conflict"))
        let session = LiveRoomSession(configuration: configuration(), transport: transport, store: store)
        session.create(settings: settings()); await settled(session)
        XCTAssertNotNil(store.pending); XCTAssertTrue(session.hasPendingAdmission)
        XCTAssertNil(session.state)
    }
    func testLiveWatchdogAndFallbackUseBoundedSnapshotCadence() {
        XCTAssertTrue(LiveRoomPollPolicy.shouldFetch(elapsed: nil, socketLive: true))
        XCTAssertFalse(LiveRoomPollPolicy.shouldFetch(elapsed: .seconds(29), socketLive: true))
        XCTAssertTrue(LiveRoomPollPolicy.shouldFetch(elapsed: .seconds(30), socketLive: true))
        XCTAssertFalse(LiveRoomPollPolicy.shouldFetch(elapsed: .seconds(2), socketLive: false))
        XCTAssertTrue(LiveRoomPollPolicy.shouldFetch(elapsed: .seconds(3), socketLive: false))
        XCTAssertTrue(LiveRoomPollPolicy.shouldFetch(elapsed: .seconds(5), socketLive: false), "Dropping a socket must shorten the pending watchdog interval")
    }
}

@MainActor private final class LiveMemoryCredentialStore: LiveRoomCredentialStoring {
    var credential: LiveRoomCredential?
    var pending: LiveRoomPendingAdmission?
    var failWrite = false
    var failRead = false
    var failMemberWrite = false
    var failPendingRemoval = false
    var memberSaveAttempts = 0
    func load(scope: String) throws -> LiveRoomCredential? { if failRead { throw LiveRoomCredentialError.unavailable }; return credential?.scope == scope ? credential : nil }
    func save(_ value: LiveRoomCredential) throws { memberSaveAttempts += 1; if failWrite || failMemberWrite { throw LiveRoomCredentialError.unavailable }; credential = value }
    func remove(scope: String) throws { credential = nil }
    func loadPending(scope: String) throws -> LiveRoomPendingAdmission? { if failRead { throw LiveRoomCredentialError.unavailable }; return pending?.scope == scope ? pending : nil }
    func savePending(_ value: LiveRoomPendingAdmission) throws { if failWrite { throw LiveRoomCredentialError.unavailable }; pending = value }
    func removePending(scope: String) throws { if failPendingRemoval { throw LiveRoomCredentialError.unavailable }; pending = nil }
}

private actor LiveMockTransport: LiveRoomTransporting {
    enum Method { case create, join, recover }
    let admission: LiveRoomAdmission
    let observeAdmission: (@Sendable (LiveRoomPendingAdmission) async -> Void)?
    let delayAdmission: Bool
    private var creates = 0, joins = 0, recoveries = 0
    private var joined: LiveRoomPendingAdmission?, recovered: LiveRoomPendingAdmission?
    private var createFailure: LiveRoomTransportError?, joinFailure: LiveRoomTransportError?, recoveryFailure: LiveRoomTransportError?, actionFailure: LiveRoomTransportError?
    private var commands: [LiveRoomCommand] = []
    private var snapshotValue: LiveRoomState?
    private var snapshots = 0
    private var holdsPerform = false
    private var heldPerforms: [UUID: CheckedContinuation<LiveRoomState?, Error>] = [:]
    init(admission: LiveRoomAdmission, delayAdmission: Bool = false, observeAdmission: (@Sendable (LiveRoomPendingAdmission) async -> Void)? = nil) {
        self.admission = admission; self.observeAdmission = observeAdmission; self.delayAdmission = delayAdmission
    }
    func setCreateFailure(_ error: LiveRoomTransportError?) { createFailure = error }
    func setJoinFailure(_ error: LiveRoomTransportError?) { joinFailure = error }
    func setRecoveryFailure(_ error: LiveRoomTransportError?) { recoveryFailure = error }
    func setActionFailure(_ error: LiveRoomTransportError?) { actionFailure = error }
    func setSnapshot(_ state: LiveRoomState) { snapshotValue = state }
    func snapshotCount() -> Int { snapshots }
    func holdPerforms(_ value: Bool) { holdsPerform = value }
    func completePerform(_ requestID: UUID, with state: LiveRoomState?) {
        heldPerforms.removeValue(forKey: requestID)?.resume(returning: state)
    }
    func failPerform(_ requestID: UUID, with error: LiveRoomTransportError) {
        heldPerforms.removeValue(forKey: requestID)?.resume(throwing: error)
    }
    func releaseHeldPerforms() {
        let held = Array(heldPerforms.values); heldPerforms.removeAll()
        for continuation in held { continuation.resume(throwing: LiveRoomTransportError.unavailable) }
    }
    func count(_ method: Method) -> Int { switch method { case .create: return creates; case .join: return joins; case .recover: return recoveries } }
    func lastRecovery() -> LiveRoomPendingAdmission? { recovered }
    func lastJoin() -> LiveRoomPendingAdmission? { joined }
    func commandCount() -> Int { commands.count }
    func lastCommand() -> LiveRoomCommand? { commands.last }
    func create(settings: LiveRoomSettings, pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission {
        creates += 1; await observeAdmission?(pending)
        if delayAdmission { try? await Task.sleep(nanoseconds: 40_000_000) }
        if let createFailure { throw createFailure }
        return admission
    }
    func join(code: String, nickname: String, pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission {
        joins += 1; joined = pending; await observeAdmission?(pending)
        if let joinFailure { throw joinFailure }
        return admission
    }
    func recover(pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission {
        recoveries += 1; recovered = pending
        if let recoveryFailure { throw recoveryFailure }; return admission
    }
    func snapshot(credential: LiveRoomCredential) async throws -> LiveRoomState { snapshots += 1; return snapshotValue ?? admission.state }
    func perform(_ command: LiveRoomCommand, credential: LiveRoomCredential) async throws -> LiveRoomState? {
        commands.append(command)
        if let actionFailure { throw actionFailure }
        if holdsPerform {
            // Deliberately ignore cancellation until the test releases the old
            // response, exercising ownership guards against late HTTP completion.
            return try await withCheckedThrowingContinuation { heldPerforms[command.requestId] = $0 }
        }
        return command.action == .leave || command.action == .close ? nil : admission.state
    }
    nonisolated func states(credential: LiveRoomCredential) -> AsyncThrowingStream<LiveRoomState, Error> {
        AsyncThrowingStream { _ in }
    }
}
#endif
