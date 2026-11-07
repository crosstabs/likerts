#if canImport(UIKit)
import XCTest
@testable import Likerts

enum LiveQuizFixtures {
    static func root() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: LiveQuizRoomTests.self).url(forResource: "live-quiz-projections", withExtension: "json", subdirectory: "SharedFixtures"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }
    static func raw(_ name: String) throws -> [String: Any] {
        let states = try XCTUnwrap(try root()["states"] as? [String: Any])
        return try XCTUnwrap(states[name] as? [String: Any], name)
    }
    static func state(_ name: String, mutate: (inout [String: Any]) -> Void = { _ in }) throws -> LiveRoomState {
        var value = try raw(name); mutate(&value)
        return try LiveRoomWireDecoder.state(JSONSerialization.data(withJSONObject: ["state": value]))
    }
    static func receipt(_ name: String) throws -> LiveRoomAdmission {
        let value = try state(name)
        return LiveRoomAdmission(code: value.code, token: String(repeating: "A", count: 43), memberId: value.viewer.id, state: value)
    }
}

final class LiveQuizRoomTests: XCTestCase {
    func testEveryActualReducerProjectionDecodesAndRoundTripsWithoutChangingV1() throws {
        let states = try XCTUnwrap(try LiveQuizFixtures.root()["states"] as? [String: Any])
        XCTAssertGreaterThanOrEqual(states.count, 23)
        for name in states.keys.sorted() {
            let state = try LiveQuizFixtures.state(name)
            XCTAssertTrue(state.isQuiz, name)
            XCTAssertNil(state.round); XCTAssertNil(state.reveal)
            let raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(state))
            XCTAssertEqual(try LiveRoomWireDecoder.state(JSONSerialization.data(withJSONObject: ["state": raw])), state, name)
        }
        XCTAssertFalse(try LiveRoomTestFixtures.state("lobbyHost").isQuiz)
        XCTAssertEqual(try LiveRoomTestFixtures.state("predictGuest").protocolVersion, 1)
    }

    func testQuizPrivacyAndUnknownNestedFieldsFailClosed() throws {
        for key in ["correctAnswer", "explanation", "questions", "recoverySecret", "tokenHash"] {
            XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { $0[key] = "private" }, key)
            XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { state in
                var round = state["round"] as! [String: Any]; round[key] = "private"; state["round"] = round
            }, key)
        }
        XCTAssertThrowsError(try LiveQuizFixtures.state("answerHost") { state in
            var round = state["round"] as! [String: Any]; round["ownAnswer"] = 0; state["round"] = round
        })
        XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { $0["reveal"] = try! LiveQuizFixtures.raw("revealPlayer")["reveal"] })
        XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { state in
            var quiz = state["quiz"] as! [String: Any]; quiz["questions"] = []; state["quiz"] = quiz
        })
        XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { state in
            var round = state["round"] as! [String: Any]; round.removeValue(forKey: "ownAnswer"); state["round"] = round
        })
    }

    func testQuizModesRangesAndAuthoredMultilineUUIDContract() throws {
        for (key, value) in [("protocolVersion", 3 as Any), ("mode", "mind-reading" as Any), ("modeVersion", 2 as Any), ("phase", "predict" as Any)] {
            XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { $0[key] = value })
        }
        for choice in [-1, 4] {
            XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { state in
                var round = state["round"] as! [String: Any]; round["ownAnswer"] = choice; state["round"] = round
            })
        }
        let state = try LiveQuizFixtures.state("answerPlayer") { state in
            var quiz = state["quiz"] as! [String: Any]; quiz["id"] = "00000000-0000-0000-0000-000000000000"; state["quiz"] = quiz
            var round = state["round"] as! [String: Any]
            round["questionId"] = "00000000-0000-0000-0000-000000000001"; round["prompt"] = "First line\nSecond line"; round["ownAnswer"] = 0
            state["round"] = round
        }
        XCTAssertEqual(state.ownLockedValue, 0)
        XCTAssertFalse(state.canSubmit)
        XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { state in
            var round = state["round"] as! [String: Any]; round["prompt"] = "Bad\rline"; state["round"] = round
        })
        XCTAssertNoThrow(try LiveQuizFixtures.state("answerPlayer") { state in
            var quiz = state["quiz"] as! [String: Any]; quiz["title"] = "Curious 👩‍🔬 crew"; state["quiz"] = quiz
            var round = state["round"] as! [String: Any]; round["prompt"] = "A 👨‍👩‍👧‍👦\nSecond line"; state["round"] = round
        })
        for separator in ["\u{2028}", "\u{2029}"] {
            XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { state in
                var quiz = state["quiz"] as! [String: Any]; quiz["title"] = "Bad\(separator)title"; state["quiz"] = quiz
            })
            XCTAssertThrowsError(try LiveQuizFixtures.state("answerPlayer") { state in
                var round = state["round"] as! [String: Any]; round["answers"] = ["Bad\(separator)answer", "Fine"]; state["round"] = round
            })
        }
    }

    func testInvalidAbortsCannotExposeResidualChoicesOrAnswerKeys() throws {
        for name in ["incompletePlayer", "playerLeftPlayer", "playerRemovedPlayer"] {
            let state = try LiveQuizFixtures.state(name)
            XCTAssertFalse(try XCTUnwrap(state.quizReveal).valid)
            XCTAssertNil(state.ownLockedValue)
            XCTAssertThrowsError(try LiveQuizFixtures.state(name) { raw in
                var round = raw["round"] as! [String: Any]; round["ownAnswer"] = 0; raw["round"] = round
            })
            XCTAssertThrowsError(try LiveQuizFixtures.state(name) { raw in
                var reveal = raw["reveal"] as! [String: Any]
                var results = reveal["results"] as! [[String: Any]]; results[0]["value"] = 0
                reveal["results"] = results; raw["reveal"] = reveal
            })
        }
    }

    func testQuizCommandsBindTheCurrentRoundAndNeverCarryScoreOrClientTime() throws {
        let state = try LiveQuizFixtures.state("answerPlayer")
        for action: LiveRoomAction in [.quizAnswer, .quizReveal, .next] {
            let command = LiveRoomCommand(state: state, action: action, value: action == .quizAnswer ? 0 : nil)
            XCTAssertEqual(command.roundId, state.quizRound?.id)
            XCTAssertEqual(command.matchId, state.matchId)
            let raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(command)) as! [String: Any]
            XCTAssertNil(raw["score"]); XCTAssertNil(raw["time"]); XCTAssertNil(raw["expectedRevision"])
        }
    }

    func testLargestUsefulSlashRichUploadAndProtectedRecoveryEnvelopeFitBounds() throws {
        let question = QuizQuestion(prompt: String(repeating: "🧠", count: 240),
            answers: ["A", "B", "C", "D"].map { $0 + String(repeating: "/", count: 99) }, correctAnswer: 0,
            explanation: String(repeating: "🧠", count: 240), timeLimitSeconds: 10)
        var quiz = QuizDocument(title: String(repeating: "/", count: 80), questions: [])
        for _ in 0..<30 {
            var next = quiz; var item = question; item.id = UUID().uuidString.lowercased(); next.questions.append(item)
            do { _ = try next.normalized(); quiz = next }
            catch let error as QuizValidationError where error.code == "too_large" { break }
        }
        XCTAssertGreaterThan(try quiz.encoded().count, 60_000)
        let pending = try LiveRoomPendingAdmission.make(scope: "test", settings: LiveRoomSettings(), quiz: quiz)
        let upload = try XCTUnwrap(pending.quizRequest)
        XCTAssertLessThanOrEqual(upload.count, LiveQuizAdmissionPayload.maximumBytes)
        XCTAssertFalse(String(decoding: upload, as: UTF8.self).contains("\\/"))
        let stored = try JSONEncoder().encode(pending)
        XCTAssertLessThanOrEqual(stored.count, LiveRoomPendingAdmission.maximumPendingBytes)
        let loaded = try JSONDecoder().decode(LiveRoomPendingAdmission.self, from: stored)
        XCTAssertTrue(loaded.isValid); XCTAssertEqual(loaded.quizRequest, upload)
        XCTAssertEqual(loaded.quizUpload?.quiz, try quiz.normalized())
    }
}

@MainActor final class LiveQuizSessionTests: XCTestCase {
    private let config = LiveRoomConfiguration(apiBaseURL: URL(string: "http://127.0.0.1:19191/api/live")!, inviteBaseURL: URL(string: "http://127.0.0.1:19191/play")!)
    private func settled(_ session: LiveRoomSession) async {
        for _ in 0..<100 { if !session.busy { return }; try? await Task.sleep(nanoseconds: 10_000_000) }
        XCTFail("Quiz operation did not settle")
    }

    func testFrozenQuizIsSavedBeforeUploadAndLostAdmissionRetriesIdenticalBytesAfterLibraryEdit() async throws {
        let store = QuizMemoryCredentialStore()
        let transport = QuizMockTransport(admission: try LiveQuizFixtures.receipt("lobbyHost"))
        await transport.setCreateFailure(.unavailable)
        var quiz = QuizDocument.sample
        let first = LiveRoomSession(configuration: config, transport: transport, store: store)
        first.create(quiz: quiz, capacity: 12)
        let frozen = try XCTUnwrap(store.pending?.quizRequest)
        await settled(first); first.suspend()
        XCTAssertEqual(awaitValue: await transport.uploads(), [frozen])
        quiz.title = "Changed afterwards"; quiz.questions[0].correctAnswer = 3
        XCTAssertEqual(store.pending?.quizUpload?.quiz.title, "Little wonders")
        await transport.setCreateFailure(nil); await transport.setRecoveryFailure(.service(status: 404, code: "admission_unavailable"))
        let recovered = LiveRoomSession(configuration: config, transport: transport, store: store)
        defer { recovered.suspend() }
        recovered.recoverAdmission(); await settled(recovered)
        let uploads = await transport.uploads()
        XCTAssertEqual(uploads, [frozen, frozen])
        XCTAssertTrue(recovered.state?.isQuiz == true); XCTAssertNil(store.pending)
        XCTAssertEqual(store.credential?.scope, config.credentialScope)
    }

    func testQuizPlayerCanLockZeroAndReconnectSettlesLostReplyWithoutOptimisticScoring() async throws {
        let store = QuizMemoryCredentialStore()
        let transport = QuizMockTransport(admission: try LiveQuizFixtures.receipt("answerPlayer"))
        await transport.setActionFailure(.unavailable)
        let session = LiveRoomSession(configuration: config, transport: transport, store: store)
        defer { session.suspend() }
        session.join(code: "ABCDEF", nickname: "Ari", acceptsSharing: true); await settled(session); session.suspend()
        session.send(.answer, value: 1); session.send(.quizAnswer, value: 4)
        XCTAssertEqual(awaitValue: await transport.commands().count, 0)
        session.send(.quizAnswer, value: 0); await settled(session)
        let sentCommands = await transport.commands()
        let original = try XCTUnwrap(sentCommands.first)
        XCTAssertEqual(original.value, 0); XCTAssertEqual(original.action, .quizAnswer)
        XCTAssertTrue(session.hasPendingAction); XCTAssertNil(session.state?.ownLockedValue)
        XCTAssertTrue(session.state?.leaderboard.allSatisfy({ $0.points == 0 }) == true)
        let confirmed = try LiveQuizFixtures.state("answerPlayer") { raw in
            raw["revision"] = (raw["revision"] as! Int) + 1
            var round = raw["round"] as! [String: Any]; round["ownAnswer"] = 0; round["submittedCount"] = 1; raw["round"] = round
        }
        await transport.setSnapshot(confirmed); session.reconnect()
        for _ in 0..<100 { if session.state?.ownLockedValue == 0 { break }; try? await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(session.state?.ownLockedValue, 0); XCTAssertFalse(session.hasPendingAction)
        XCTAssertEqual(awaitValue: await transport.commands().count, 1)
    }

    func testQuizHostCannotAnswerAndRevealIsRoundBound() async throws {
        let store = QuizMemoryCredentialStore()
        let transport = QuizMockTransport(admission: try LiveQuizFixtures.receipt("answerHost"))
        let session = LiveRoomSession(configuration: config, transport: transport, store: store)
        defer { session.suspend() }
        session.create(quiz: .sample, capacity: 12); await settled(session); session.suspend()
        session.send(.quizAnswer, value: 0); session.send(.pause); session.send(.skip)
        XCTAssertEqual(awaitValue: await transport.commands().count, 0)
        session.send(.quizReveal); await settled(session)
        let sentCommands = await transport.commands()
        let command = try XCTUnwrap(sentCommands.last)
        XCTAssertEqual(command.action, .quizReveal); XCTAssertEqual(command.roundId, session.state?.quizRound?.id)
    }

    func testReconnectCannotChangeRoomModeOrFrozenQuizSummary() async throws {
        let original = try LiveQuizFixtures.receipt("answerPlayer")
        let store = QuizMemoryCredentialStore(), transport = QuizMockTransport(admission: original)
        let session = LiveRoomSession(configuration: config, transport: transport, store: store)
        defer { session.suspend() }
        session.join(code: "ABCDEF", nickname: "Ari", acceptsSharing: true); await settled(session); session.suspend()
        let renamed = try LiveQuizFixtures.state("answerPlayer") { raw in
            raw["revision"] = original.state.revision + 10
            var quiz = raw["quiz"] as! [String: Any]; quiz["title"] = "Different quiz"; raw["quiz"] = quiz
        }
        let switched = try LiveRoomWireDecoder.state(LiveRoomTestFixtures.data("lobbyPlayer") { raw in
            raw["revision"] = original.state.revision + 10
            var viewer = raw["self"] as! [String: Any]; viewer["id"] = original.memberId; raw["self"] = viewer
            var players = raw["players"] as! [[String: Any]]; players[0]["id"] = original.memberId; raw["players"] = players
        })
        for fresh in [renamed, switched] {
            let before = await transport.snapshotCount()
            await transport.setSnapshot(fresh); session.reconnect()
            for _ in 0..<100 { if await transport.snapshotCount() > before { break }; try? await Task.sleep(nanoseconds: 10_000_000) }
            session.suspend()
            XCTAssertTrue(session.state?.isQuiz == true)
            XCTAssertEqual(session.state?.quiz, original.state.quiz)
            XCTAssertEqual(session.state?.revision, original.state.revision)
        }
    }
}

/// Async values are evaluated before XCTest's synchronous assertion autoclosures.
private func XCTAssertEqual<T: Equatable>(awaitValue actual: T, _ expected: T, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(actual, expected, file: file, line: line)
}

@MainActor private final class QuizMemoryCredentialStore: LiveRoomCredentialStoring {
    var credential: LiveRoomCredential?
    var pending: LiveRoomPendingAdmission?
    func load(scope: String) throws -> LiveRoomCredential? { credential }
    func save(_ value: LiveRoomCredential) throws { credential = value }
    func remove(scope: String) throws { credential = nil }
    func loadPending(scope: String) throws -> LiveRoomPendingAdmission? { pending }
    func savePending(_ value: LiveRoomPendingAdmission) throws { pending = value }
    func removePending(scope: String) throws { pending = nil }
}

private actor QuizMockTransport: LiveRoomTransporting {
    let admission: LiveRoomAdmission
    private var uploaded: [Data] = []
    private var sent: [LiveRoomCommand] = []
    private var createFailure: LiveRoomTransportError?
    private var recoveryFailure: LiveRoomTransportError?
    private var actionFailure: LiveRoomTransportError?
    private var snapshotValue: LiveRoomState?
    private var checks = 0
    init(admission: LiveRoomAdmission) { self.admission = admission }
    func setCreateFailure(_ value: LiveRoomTransportError?) { createFailure = value }
    func setRecoveryFailure(_ value: LiveRoomTransportError?) { recoveryFailure = value }
    func setActionFailure(_ value: LiveRoomTransportError?) { actionFailure = value }
    func setSnapshot(_ value: LiveRoomState) { snapshotValue = value }
    func uploads() -> [Data] { uploaded }
    func commands() -> [LiveRoomCommand] { sent }
    func snapshotCount() -> Int { checks }
    func create(settings: LiveRoomSettings, pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission { throw LiveRoomTransportError.invalidResponse }
    func createQuiz(pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission {
        uploaded.append(try XCTUnwrap(pending.quizRequest)); if let createFailure { throw createFailure }; return admission
    }
    func join(code: String, nickname: String, pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission { admission }
    func recover(pending: LiveRoomPendingAdmission) async throws -> LiveRoomAdmission { if let recoveryFailure { throw recoveryFailure }; return admission }
    func snapshot(credential: LiveRoomCredential) async throws -> LiveRoomState { checks += 1; return snapshotValue ?? admission.state }
    func perform(_ command: LiveRoomCommand, credential: LiveRoomCredential) async throws -> LiveRoomState? {
        sent.append(command); if let actionFailure { throw actionFailure }
        return command.action == .leave || command.action == .close ? nil : (snapshotValue ?? admission.state)
    }
    nonisolated func states(credential: LiveRoomCredential) -> AsyncThrowingStream<LiveRoomState, Error> { AsyncThrowingStream { _ in } }
}
#endif
