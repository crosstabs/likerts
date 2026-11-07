#if canImport(UIKit) && canImport(Messages)
import XCTest
@testable import Likerts

@MainActor final class MessagesDraftRecoveryTests: XCTestCase {
    private func sealed(_ model: MessagesGameModel) throws {
        model.start()
        let game = try XCTUnwrap(model.game)
        for value in 1...5 { game.select(value); game.next() }
        XCTAssertEqual(game.phase, .sealed)
    }
    func testDelayedSuccessAndFailureCannotCompactReplacementCardResetOrChat() async throws {
        for replacement in 0..<4 {
            for fail in [false,true] {
                let model = MessagesGameModel()
                model.setConversation(.oneToOne, key: "friend")
                try sealed(model)
                var complete: CheckedContinuation<Void, Error>?, compactions = 0
                let began = expectation(description: "Native insertion adapter entered")
                model.requestCompaction = { context in
                    XCTAssertTrue(model.isCurrent(context)); compactions += 1
                }
                model.insertDraft = { _, _ in try await withCheckedThrowingContinuation { complete = $0; began.fulfill() } }
                let task = Task { await model.draftChallenge() }
                await fulfillment(of: [began], timeout: 2)
                XCTAssertTrue(model.isStaging)
                switch replacement {
                case 0: model.reset()
                case 1:
                    let challenge = try Challenge(name: "Other", promptIDs: [1,2,3,4,5], answers: [5,4,3,2,1])
                    model.receive(try MessageEnvelopeCodec.encode(MessageEnvelope(id: UUID(), challenge: challenge)), isOwn: false)
                case 2: model.setConversation(.oneToOne, key: "other-friend")
                default: model.cancelledDraft()
                }
                let stage = model.stage, notice = model.notice
                if fail { try XCTUnwrap(complete).resume(throwing: CancellationError()) }
                else { try XCTUnwrap(complete).resume() }
                await task.value
                XCTAssertEqual(model.stage, stage); XCTAssertEqual(model.notice, notice)
                XCTAssertNil(model.lastDraft); XCTAssertNil(model.error); XCTAssertFalse(model.isStaging)
                XCTAssertEqual(compactions, 0)
                try sealed(model)
                model.insertDraft = { _, _ in }
                await model.draftChallenge()
                XCTAssertEqual(compactions, 1); XCTAssertEqual(model.stage, .waiting)
            }
        }
    }
    func testIdenticalPayloadRetryRejectsOldOperationCallback() async throws {
        let model = MessagesGameModel()
        model.setConversation(.oneToOne, key: "friend")
        try sealed(model)
        var contexts: [MessagesGameModel.DraftContext] = [], urls: [URL] = []
        model.insertDraft = { value, context in contexts.append(context); urls.append(try MessageEnvelopeCodec.encode(value)) }
        await model.draftChallenge()
        model.cancelledDraft()
        await model.draftChallenge()
        XCTAssertEqual(urls[0], urls[1]); XCTAssertNotEqual(contexts[0], contexts[1])
        XCTAssertFalse(model.acceptsDraftCallback(urls[0], conversationKey: "friend", context: contexts[0]))
        XCTAssertTrue(model.acceptsDraftCallback(urls[1], conversationKey: "friend", context: contexts[1]))
        XCTAssertFalse(model.acceptsDraftCallback(urls[1], conversationKey: "other-friend", context: contexts[1]))
        model.sendingStarted()
        XCTAssertTrue(try XCTUnwrap(model.notice).contains("Delivery is shown"))
        XCTAssertFalse(model.acceptsDraftCallback(urls[1], conversationKey: "friend", context: contexts[1]))
    }
    func testOwnDraftCannotBecomeGuessableAfterHideUnhideAndIncomingCanBeHidden() async throws {
        let suite = "likerts.messages.safety.\(UUID().uuidString)", defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let safety = LocalContentSafety(defaults: defaults, key: "hidden"), model = MessagesGameModel(safety: LocalContentSafety(defaults: defaults, key: "hidden"))
        model.setConversation(.oneToOne, key: "friend")
        try sealed(model)
        model.insertDraft = { _, _ in }
        await model.draftChallenge()
        let own = try XCTUnwrap(model.lastDraft)
        model.receive(try MessageEnvelopeCodec.encode(own), isOwn: false, pending: false)
        XCTAssertTrue(model.isOwnCard, "Missing native sender metadata cannot erase known local ownership")
        model.hideSelectedChallenge()
        XCTAssertEqual(model.stage, .hidden); XCTAssertNil(model.game); XCTAssertNil(model.envelope)
        XCTAssertTrue(safety.contains(own.challenge))
        model.unhideSelectedChallenge()
        XCTAssertEqual(model.stage, .waiting); XCTAssertTrue(model.isOwnCard)
        model.playIncoming(); XCTAssertNil(model.game)
        XCTAssertFalse(safety.contains(own.challenge))

        model.reset()
        let url = try MessageEnvelopeCodec.encode(own)
        model.receive(url, isOwn: false)
        model.hideSelectedChallenge(); model.reset()
        model.receive(url, isOwn: false)
        XCTAssertEqual(model.stage, .hidden); XCTAssertNil(model.envelope)
        model.unhideSelectedChallenge(); XCTAssertEqual(model.stage, .incoming)
        model.playIncoming(); XCTAssertNotNil(model.game)
    }
    func testSelectingImportedCardDoesNotConsumeHistoryBeforePlaying() throws {
        // Model selection has no deck-selection side effect. This assertion
        // uses actual default history read on the isolated test Simulator.
        let store = UserDefaultsTopicHistoryStore(), before = store.load()
        let raw = UserDefaults.standard.object(forKey: "likerts.topic-history.v1")
        defer {
            if let raw { UserDefaults.standard.set(raw, forKey: "likerts.topic-history.v1") }
            else { UserDefaults.standard.removeObject(forKey: "likerts.topic-history.v1") }
        }
        let challenge = try Challenge(name: "Pip", promptIDs: [1001,1002,1003,1004,1005], answers: [1,2,3,4,5])
        let model = MessagesGameModel()
        model.receive(try MessageEnvelopeCodec.encode(MessageEnvelope(id: UUID(), challenge: challenge)), isOwn: false)
        XCTAssertEqual(store.load(), before)
        model.playIncoming()
        XCTAssertTrue(Set(challenge.promptIDs).isSubset(of: Set(store.load().seen["snacks"] ?? [])))
    }
}
#endif
