#if canImport(UIKit) && canImport(Messages)
import UIKit
import Messages
import XCTest
@testable import Likerts

@MainActor
final class MessagesModelTests: XCTestCase {
    private func challenge() throws -> Challenge {
        try Challenge(name: "Pip", promptIDs: [1, 2, 3, 4, 5], answers: [1, 2, 3, 4, 5])
    }

    private func incoming() throws -> MessageEnvelope {
        MessageEnvelope(id: UUID(), challenge: try challenge())
    }

    private func seal(_ model: MessagesGameModel) throws -> GameSession {
        let game = try XCTUnwrap(model.game)
        XCTAssertEqual(game.phase, .answering)
        for answer in [1, 2, 3, 4, 5] {
            game.select(answer)
            game.next()
        }
        XCTAssertEqual(game.phase, .sealed)
        return game
    }

    func testOwnAndPendingChallengesCannotBecomeGuessingGames() throws {
        let model = MessagesGameModel()
        let url = try MessageEnvelopeCodec.encode(incoming())
        model.receive(url, isOwn: true)
        XCTAssertEqual(model.stage, .waiting)
        model.playIncoming()
        XCTAssertEqual(model.stage, .waiting)
        XCTAssertNil(model.game)

        model.reset()
        model.receive(url, isOwn: false, pending: true)
        XCTAssertEqual(model.stage, .waiting)
        model.playIncoming()
        XCTAssertEqual(model.stage, .waiting, "A pending draft must remain waiting even if sender identity isn't assigned yet.")
        XCTAssertNil(model.game)
    }

    func testReceivedChallengeCompletesFiveGuessesAndStagesComputedResult() async throws {
        let model = MessagesGameModel()
        model.setConversation(.oneToOne, key: "friend")
        let received = try incoming()
        model.receive(try MessageEnvelopeCodec.encode(received), isOwn: false)
        XCTAssertEqual(model.stage, .incoming)
        model.playIncoming()
        let game = try XCTUnwrap(model.game)
        XCTAssertEqual(game.phase, .guessing)
        for answer in received.challenge.answers {
            game.select(answer)
            game.next()
            XCTAssertTrue(game.revealed)
            XCTAssertEqual(game.roundPoints, 100)
            game.next()
        }
        XCTAssertEqual(game.phase, .result)
        let result = try XCTUnwrap(model.resultEnvelope)
        XCTAssertEqual(result.kind, .result)
        XCTAssertEqual(result.id, received.id)
        XCTAssertEqual(result.challenge, received.challenge)
        XCTAssertEqual(result.guesses, received.challenge.answers)
        XCTAssertEqual(result.score, 100)
        var staged: MessageEnvelope?
        model.insertDraft = { value, _ in staged = value }
        await model.draftResult()
        XCTAssertEqual(staged, result)
        XCTAssertEqual(model.lastDraft, result)
        XCTAssertTrue(model.canDraft)
    }

    func testReselectingSameURLPreservesInFlightGuessAndReveal() throws {
        let model = MessagesGameModel()
        let url = try MessageEnvelopeCodec.encode(incoming())
        model.receive(url, isOwn: false)
        model.playIncoming()
        let game = try XCTUnwrap(model.game)
        game.select(4)
        game.next()
        model.receive(url, isOwn: false)
        XCTAssertTrue(model.game === game)
        XCTAssertEqual(game.index, 0)
        XCTAssertEqual(game.selection, 4)
        XCTAssertTrue(game.revealed)
        game.next()
        game.select(2)
        model.receive(url, isOwn: false)
        XCTAssertTrue(model.game === game)
        XCTAssertEqual(game.index, 1)
        XCTAssertEqual(game.selection, 2)
        XCTAssertFalse(game.revealed)
    }

    func testMalformedSelectedCardBecomesInvalidWithoutStartingAGame() throws {
        let model = MessagesGameModel()
        let malformed = try XCTUnwrap(URL(string: "data:application/vnd.likerts.message+json;base64,broken"))
        model.receive(malformed, isOwn: false)
        XCTAssertEqual(model.stage, .invalid)
        XCTAssertNil(model.envelope)
        XCTAssertNil(model.game)
        XCTAssertNotNil(model.error)
        model.playIncoming()
        XCTAssertEqual(model.stage, .invalid)
        XCTAssertNil(model.game)
    }

    func testSelectingCardWithoutURLClearsPreviousGameAndShowsInvalidState() throws {
        let model = MessagesGameModel()
        let url = try MessageEnvelopeCodec.encode(incoming())
        model.receive(url, isOwn: false)
        model.playIncoming()
        let game = try XCTUnwrap(model.game)
        game.select(4)
        XCTAssertEqual(model.stage, .playing)

        model.receive(nil, isOwn: false)
        XCTAssertEqual(model.stage, .invalid)
        XCTAssertNil(model.game)
        XCTAssertNil(model.envelope)
        XCTAssertNil(model.lastDraft)
        XCTAssertFalse(model.isStaging)
        XCTAssertNotNil(model.error)
        model.playIncoming()
        XCTAssertEqual(model.stage, .invalid)
        XCTAssertNil(model.game)

        // Selecting the original card again must decode afresh after invalid input.
        model.receive(url, isOwn: false)
        XCTAssertEqual(model.stage, .incoming)
        model.playIncoming()
        XCTAssertNotNil(model.game)
        XCTAssertNil(model.game?.selection)
    }

    func testMissingAndGroupConversationsNeverInvokeInsertion() async throws {
        let model = MessagesGameModel()
        model.start()
        _ = try seal(model)
        var insertions = 0
        model.insertDraft = { _, _ in insertions += 1 }
        for status in [MessagesGameModel.ConversationStatus.missing, .group] {
            model.setConversation(status, key: "same-conversation")
            XCTAssertFalse(model.canDraft)
            await model.draftChallenge()
            XCTAssertEqual(insertions, 0)
            XCTAssertNil(model.lastDraft)
            XCTAssertNotNil(model.error)
            XCTAssertEqual(model.game?.phase, .sealed)
        }
        model.setConversation(.oneToOne, key: "same-conversation")
        await model.draftChallenge()
        XCTAssertEqual(insertions, 1)
        XCTAssertEqual(model.stage, .waiting)
        XCTAssertEqual(model.lastDraft?.kind, .challenge)
    }

    func testInsertionFailureAndDraftCancellationPreserveGameAndAllowRetry() async throws {
        let model = MessagesGameModel()
        model.setConversation(.oneToOne, key: "friend")
        model.start()
        let game = try seal(model)
        var attempts = 0
        model.insertDraft = { _, _ in
            attempts += 1
            if attempts == 1 { throw InsertionFailure() }
            if attempts == 2 { throw CancellationError() }
        }
        for _ in 0..<2 {
            await model.draftChallenge()
            XCTAssertFalse(model.isStaging)
            XCTAssertTrue(model.canDraft)
            XCTAssertTrue(model.game === game)
            XCTAssertEqual(game.phase, .sealed)
            XCTAssertNil(model.lastDraft)
            XCTAssertNotNil(model.error)
        }
        await model.draftChallenge()
        XCTAssertEqual(attempts, 3)
        XCTAssertEqual(model.stage, .waiting)
        XCTAssertNotNil(model.lastDraft)
        model.cancelledDraft()
        XCTAssertEqual(model.stage, .playing)
        XCTAssertNil(model.lastDraft)
        XCTAssertTrue(model.canDraft)
        XCTAssertTrue(model.game === game)
        XCTAssertEqual(game.phase, .sealed)
        await model.draftChallenge()
        XCTAssertEqual(attempts, 4)
        XCTAssertEqual(model.stage, .waiting)
    }

    func testInsertionCompletingAfterResetCannotRestoreStaleState() async throws {
        let model = MessagesGameModel()
        model.setConversation(.oneToOne, key: "friend")
        model.start()
        _ = try seal(model)
        let began = expectation(description: "Insertion is suspended")
        var resume: CheckedContinuation<Void, Error>?
        model.insertDraft = { _, _ in
            try await withCheckedThrowingContinuation { continuation in
                resume = continuation
                began.fulfill()
            }
        }
        let insertion = Task { await model.draftChallenge() }
        await fulfillment(of: [began], timeout: 2)
        XCTAssertTrue(model.isStaging)
        model.reset()
        guard let continuation = resume else {
            insertion.cancel()
            XCTFail("The injected insertion did not begin")
            return
        }
        continuation.resume(returning: ())
        await insertion.value
        XCTAssertEqual(model.stage, .home)
        XCTAssertNil(model.game)
        XCTAssertNil(model.envelope)
        XCTAssertNil(model.lastDraft)
        XCTAssertNil(model.error)
        XCTAssertNil(model.notice)
        XCTAssertFalse(model.isStaging)
        XCTAssertTrue(model.canDraft)
    }

    func testNativeBuilderPreservesMessageSessionAcrossResultAndRematch() throws {
        let model = MessagesGameModel()
        var messageSession = MSSession()
        var newSessionRequests = 0
        model.requestNewSession = {
            newSessionRequests += 1
            messageSession = MSSession()
        }
        model.start()
        let retainedSession = messageSession
        let firstID = model.gameID
        let firstGame = try seal(model)
        let firstChallenge = try XCTUnwrap(firstGame.challenge)
        let firstEnvelope = MessageEnvelope(id: firstID, challenge: firstChallenge)
        let resultEnvelope = try MessageEnvelope(id: firstID, challenge: firstChallenge, guesses: firstChallenge.answers)
        model.start(rematch: true)
        XCTAssertNotEqual(model.gameID, firstID)
        XCTAssertEqual(newSessionRequests, 1, "A rematch gets a new game UUID while retaining the Messages session.")
        XCTAssertTrue(messageSession === retainedSession)
        let rematchGame = try seal(model)
        let rematchEnvelope = MessageEnvelope(id: model.gameID, challenge: try XCTUnwrap(rematchGame.challenge))

        for envelope in [firstEnvelope, resultEnvelope, rematchEnvelope] {
            let message = try MessageBuilder.make(envelope, session: messageSession)
            XCTAssertTrue(message.session === retainedSession)
            XCTAssertEqual(try MessageEnvelopeCodec.decode(XCTUnwrap(message.url)), envelope)
            let layout = try XCTUnwrap(message.layout as? MSMessageTemplateLayout)
            let image = try XCTUnwrap(layout.image)
            XCTAssertGreaterThan(image.size.width, 0)
            XCTAssertGreaterThan(image.size.height, 0)
            XCTAssertEqual(message.summaryText, layout.caption)
            XCTAssertFalse(try XCTUnwrap(layout.caption).isEmpty)
            XCTAssertFalse(try XCTUnwrap(layout.subcaption).isEmpty)
            if envelope.kind == .result {
                XCTAssertTrue(try XCTUnwrap(layout.caption).contains("100%"))
                XCTAssertTrue(try XCTUnwrap(layout.subcaption).contains("5/5"))
            }
        }
    }
}

private struct InsertionFailure: Error {}
#endif
