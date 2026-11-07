#if canImport(UIKit)
import XCTest
@testable import Likerts

final class LiveRoomModelTests: XCTestCase {
    func testEveryActualReducerFixtureDecodesWithItsRecipientProjection() throws {
        for name in ["lobbyHost", "lobbyPlayer", "answerHost", "answerSubject", "predictHost", "predictSubject", "predictGuest", "predictOtherGuest", "revealHost", "finishedHost"] {
            let state = try LiveRoomTestFixtures.state(name)
            XCTAssertEqual(state.code, "ABCDEF", name)
            XCTAssertEqual(state.catalogHash, LiveRoomState.catalogueHash, name)
        }
    }
    func testHostAndOtherPlayersCannotReceiveUnrevealedAnswer() throws {
        for name in ["answerHost", "predictHost", "predictGuest", "predictOtherGuest"] {
            let data = try LiveRoomTestFixtures.data(name) { state in
                var round = state["round"] as! [String: Any]; round["ownAnswer"] = 4; state["round"] = round
            }
            XCTAssertThrowsError(try LiveRoomWireDecoder.state(data), name)
        }
    }
    func testSubjectCannotReceiveAnotherPlayersPrediction() throws {
        let bytes = try LiveRoomTestFixtures.data("predictSubject") { state in
            var round = state["round"] as! [String: Any]; round["ownGuess"] = 5; state["round"] = round
        }
        XCTAssertThrowsError(try LiveRoomWireDecoder.state(bytes))
    }
    func testSecretAndInternalFieldsAreRejectedRatherThanIgnored() throws {
        for key in ["answer", "guesses", "tokenHash", "recoverySecret", "requests"] {
            let bytes = try LiveRoomTestFixtures.data("predictHost") { state in state[key] = "private" }
            XCTAssertThrowsError(try LiveRoomWireDecoder.state(bytes), key)
        }
        let nested = try LiveRoomTestFixtures.data("predictHost") { state in
            var round = state["round"] as! [String: Any]; round["answer"] = 2; state["round"] = round
        }
        XCTAssertThrowsError(try LiveRoomWireDecoder.state(nested))
    }
    func testRevealCannotArriveBeforeRevealPhase() throws {
        let reveal = try LiveRoomTestFixtures.raw("revealHost")["reveal"]!
        let bytes = try LiveRoomTestFixtures.data("predictHost") { $0["reveal"] = reveal }
        XCTAssertThrowsError(try LiveRoomWireDecoder.state(bytes))
    }
    func testSkippedRoundCannotExposeAnAnswer() throws {
        let bytes = try LiveRoomTestFixtures.data("revealHost") { state in
            var reveal = state["reveal"] as! [String: Any]; reveal["valid"] = false; state["reveal"] = reveal
        }
        XCTAssertThrowsError(try LiveRoomWireDecoder.state(bytes))
        let guessesOnly = try LiveRoomTestFixtures.data("revealHost") { state in
            var reveal = state["reveal"] as! [String: Any]
            reveal["valid"] = false; reveal["answer"] = NSNull(); state["reveal"] = reveal
        }
        XCTAssertThrowsError(try LiveRoomWireDecoder.state(guessesOnly), "Unscored rounds must not leak residual guesses or points")
    }
    func testProtocolCatalogueIdentityAndAvatarFailClosed() throws {
        for (key, value) in [("protocolVersion", 2 as Any), ("catalogVersion", 2 as Any), ("catalogHash", String(repeating: "0", count: 64) as Any)] {
            XCTAssertThrowsError(try LiveRoomWireDecoder.state(LiveRoomTestFixtures.data("lobbyHost") { $0[key] = value }))
        }
        let bytes = try LiveRoomTestFixtures.data("lobbyHost") { state in
            var players = state["players"] as! [[String: Any]]; players[0]["avatar"] = "1"; state["players"] = players
        }
        XCTAssertThrowsError(try LiveRoomWireDecoder.state(bytes))
        XCTAssertThrowsError(try LiveRoomTestFixtures.state("lobbyHost").validated(code: "ZZZZZZ", memberId: "host"))
        XCTAssertThrowsError(try LiveRoomTestFixtures.state("lobbyHost").validated(code: "ABCDEF", memberId: "someone-else"))
    }
    func testCommandsCarryStableMatchRoundAndNoWholeRoomRevision() throws {
        let state = try LiveRoomTestFixtures.state("predictGuest")
        let command = LiveRoomCommand(state: state, action: .guess, value: 3)
        XCTAssertEqual(command.matchId, state.matchId); XCTAssertEqual(command.roundId, state.round?.id)
        XCTAssertNil(command.expectedRevision)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(command)) as! [String: Any]
        XCTAssertNil(json["token"]); XCTAssertNil(json["expectedRevision"])
        let retry = try JSONDecoder().decode(LiveRoomCommand.self, from: JSONEncoder().encode(command))
        XCTAssertEqual(retry.requestId, command.requestId)
        XCTAssertNotEqual(LiveRoomCommand(state: state, action: .guess, value: 3).requestId, command.requestId)
    }
    func testRoomAndMembershipActionsRemainMatchBoundWithoutAnUnrelatedRoundPrecondition() throws {
        let state = try LiveRoomTestFixtures.state("revealHost")
        for action: LiveRoomAction in [.start, .lock, .kick, .end, .rematch, .close, .leave, .heartbeat] {
            let command = LiveRoomCommand(state: state, action: action)
            XCTAssertEqual(command.matchId, state.matchId)
            XCTAssertNil(command.roundId, "A round transition must not reject a room-level \(action) intent")
        }
    }
    func testEveryRoundSpecificActionRetainsItsOriginalRoundPrecondition() throws {
        let state = try LiveRoomTestFixtures.state("revealHost")
        for action: LiveRoomAction in [.answer, .guess, .next, .pause, .resume, .skip] {
            XCTAssertEqual(LiveRoomCommand(state: state, action: action).roundId, state.round?.id, "\(action)")
        }
    }
    func testOnlyExplicitTerminalReceiptsMayOmitState() throws {
        XCTAssertNil(try LiveRoomWireDecoder.action(Data(#"{"state":null,"closed":true}"#.utf8)))
        XCTAssertNil(try LiveRoomWireDecoder.action(Data(#"{"state":null,"left":true}"#.utf8)))
        XCTAssertThrowsError(try LiveRoomWireDecoder.action(Data(#"{"state":null}"#.utf8)))
        XCTAssertThrowsError(try LiveRoomWireDecoder.action(Data(#"{"closed":false}"#.utf8)))
    }
    func testCredentialAndRecoveryRecordDoNotPersistGameplay() throws {
        let credential = LiveRoomCredential(scope: "test", code: "ABCDEF", token: String(repeating: "A", count: 43), memberId: "host", expiresAt: 999_999)
        let raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(credential)) as! [String: Any]
        XCTAssertEqual(Set(raw.keys), ["scope", "code", "token", "memberId", "expiresAt"])
        let pending = try LiveRoomPendingAdmission.make(scope: "test", code: "ABCDEF", nickname: "Ari")
        let saved = try JSONSerialization.jsonObject(with: JSONEncoder().encode(pending)) as! [String: Any]
        XCTAssertEqual(Set(saved.keys), ["scope", "code", "nickname", "admissionId", "recoverySecret", "expiresAt"])
        XCTAssertTrue(pending.isValid); XCTAssertEqual(pending.recoverySecret.utf8.count, 43)
        XCTAssertFalse(pending.recoverySecret.contains("="))
        XCTAssertEqual(try JSONDecoder().decode(LiveRoomPendingAdmission.self, from: JSONEncoder().encode(pending)), pending)
        XCTAssertNotEqual(try LiveRoomPendingAdmission.make(scope: "test", settings: LiveRoomSettings()).admissionId, pending.admissionId)
    }
    func testRoomCodesAndNicknamesDoNotAcceptOfflineCodesOrControlText() {
        XCTAssertTrue(LiveRoomState.validCode(LiveRoomState.normalizedCode(" abc123\n")))
        for code in ["LK3-123", "ABC DEF", "ABC/12", "ＡＢＣＤＥＦ", "ABCDE", "ABCDEFG"] { XCTAssertFalse(LiveRoomState.validCode(code)) }
        for name in ["Ari", "Zoë", "李", "O’Neil", "A_B-2"] { XCTAssertTrue(LiveRoomState.validNickname(name), name) }
        for name in ["", "---", "<script>", "A\nB", "a\u{202e}b", "name@example.com", String(repeating: "x", count: 21)] { XCTAssertFalse(LiveRoomState.validNickname(name), name) }
    }
    #if DEBUG
    func testDebugServiceCanOnlyBeExplicitLoopbackAndInvitesCarryCodeOnly() throws {
        for url in ["https://example.com", "http://user:pass@localhost:8080", "http://127.0.0.1:8080?token=secret", "http://localhost:8080/path", "file:///tmp/test", "http://localhost:8080#secret"] {
            XCTAssertNil(LiveRoomConfiguration.debugLoopback(baseURL: try XCTUnwrap(URL(string: url))), url)
        }
        let config = try XCTUnwrap(LiveRoomConfiguration.debugLoopback(baseURL: URL(string: "http://127.0.0.1:8080")!))
        XCTAssertEqual(config.apiBaseURL.path, "/api/live")
        XCTAssertEqual(config.socketURL.scheme, "ws")
        XCTAssertEqual(config.inviteURL(code: "ABCDEF")?.absoluteString, "http://127.0.0.1:8080/play?room=ABCDEF")
        XCTAssertNil(config.inviteURL(code: "LK3-private"))
    }
    #endif
}
#endif
