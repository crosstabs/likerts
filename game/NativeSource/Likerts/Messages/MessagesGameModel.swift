import Foundation
import Observation

/// Conversation-scoped state. Only the selected game card is decoded; no transcript is read.
@MainActor @Observable
final class MessagesGameModel {
    enum Stage { case home, incoming, playing, waiting, report, invalid, hidden }
    enum ConversationStatus { case missing, oneToOne, group }
    struct DraftContext: Equatable {
        let generation: UUID
        let conversationKey: String
    }
    var stage: Stage = .home
    var conversation: ConversationStatus = .missing
    var isExpanded = false
    var game: GameSession?
    var envelope: MessageEnvelope?
    var gameID = UUID()
    var error: String?
    var notice: String?
    var isStaging = false
    var lastDraft: MessageEnvelope?
    var isOwnCard = false
    var nickname = ""
    var requestExpansion: (() -> Void)?
    var requestNewSession: (() -> Void)?
    var requestCompaction: ((DraftContext) -> Void)?
    var insertDraft: ((MessageEnvelope, DraftContext) async throws -> Void)?
    private var conversationKey: String?
    private var selectedURL: URL?
    private var generation = UUID()
    private let safety: LocalContentSafety
    private var selectedPending = false

    init(safety: LocalContentSafety = LocalContentSafety()) { self.safety = safety }

    var canDraft: Bool { conversation == .oneToOne && !isStaging }
    var conversationDetail: String? {
        switch conversation {
        case .missing: return "Open a conversation with one friend to add a game card."
        case .group: return "This game is for two people. Open a conversation with one friend."
        case .oneToOne: return nil
        }
    }
    var resultEnvelope: MessageEnvelope? {
        if let game, game.phase == .result, let challenge = game.challenge {
            return try? MessageEnvelope(id: gameID, challenge: challenge, guesses: game.guesses.compactMap { $0 })
        }
        return envelope?.kind == .result ? envelope : nil
    }

    func setConversation(_ status: ConversationStatus, key: String) {
        if let old = conversationKey, old != key { reset() }
        else if conversation != status { invalidatePendingDraft() }
        conversationKey = key
        conversation = status
    }
    func expand() { isExpanded = true; requestExpansion?() }
    func start(rematch: Bool = false) {
        let name: String
        do {
            name = try Challenge(name: nickname, promptIDs: Array(PromptBank.all.prefix(5)).map(\.id), answers: [1, 1, 1, 1, 1]).name
        } catch {
            self.error = "Try another playful nickname: up to 20 characters, with no contact details or sensitive words."
            expand()
            return
        }
        generation = UUID(); error = nil; notice = nil; lastDraft = nil; isStaging = false
        selectedURL = nil; envelope = nil; isOwnCard = false; selectedPending = false; gameID = UUID()
        if !rematch { requestNewSession?() }
        game = GameSession(name: name)
        stage = .playing
        expand()
    }
    func reset() {
        generation = UUID(); selectedURL = nil; game = nil; envelope = nil
        lastDraft = nil; error = nil; notice = nil; stage = .home; isStaging = false; isOwnCard = false; selectedPending = false
    }
    func receive(_ url: URL?, isOwn: Bool, pending: Bool = false) {
        // Presentation transitions and reselecting the same valid card retain progress.
        if let url, url == selectedURL {
            // A pending native draft may not yet have a sender identifier.
            // Keep ownership already established by our own insertion.
            isOwnCard = isOwnCard || isOwn; selectedPending = pending
            return
        }
        // A selected card with no payload is invalid, not the previous card.
        // Invalidate in-flight insertion before replacing any visible state.
        selectedURL = url; selectedPending = pending; generation = UUID(); error = nil; notice = nil
        game = nil; envelope = nil; lastDraft = nil; isStaging = false; isOwnCard = false
        guard let url else {
            stage = .invalid
            error = "This game card is incomplete or needs a newer Likerts. Ask your friend for a fresh challenge."
            return
        }
        do {
            let value = try MessageEnvelopeCodec.decode(url)
            envelope = value; gameID = value.id; isOwnCard = isOwn
            if safety.contains(value.challenge) { envelope = nil; stage = .hidden; return }
            if value.kind == .result { stage = .report }
            else if isOwn || pending {
                stage = .waiting
                notice = pending ? "Draft ready. Tap Send in Messages when you're ready." : "Your challenge is in this conversation. Your friend can tap it to play."
            } else { stage = .incoming }
        } catch {
            envelope = nil; stage = .invalid
            self.error = "This game card is incomplete or needs a newer Likerts. Ask your friend for a fresh challenge."
        }
    }
    func playIncoming() {
        guard stage == .incoming, let envelope, envelope.kind == .challenge, !isOwnCard else { return }
        TopicPlayLibrary.recordPresented(ids: envelope.challenge.promptIDs)
        game = GameSession(challenge: envelope.challenge)
        stage = .playing; expand()
    }
    func draftChallenge() async {
        guard let challenge = game?.challenge, game?.phase == .sealed else { return }
        await draft(MessageEnvelope(id: gameID, challenge: challenge))
    }
    func draftResult() async {
        guard let value = resultEnvelope else { return }
        await draft(value)
    }
    private func draft(_ value: MessageEnvelope) async {
        guard canDraft else { error = conversationDetail; return }
        guard let insertDraft else { error = "Messages isn't ready. Close and reopen this game."; return }
        generation = UUID(); error = nil; isStaging = true
        let token = generation
        guard let conversationKey else { isStaging = false; return }
        let context = DraftContext(generation: token, conversationKey: conversationKey)
        defer { if generation == token { isStaging = false } }
        do {
            try await insertDraft(value, context)
            guard isCurrent(context) else { return }
            lastDraft = value; envelope = value
            isOwnCard = true; selectedPending = true
            selectedURL = try MessageEnvelopeCodec.encode(value)
            notice = "Draft ready. Tap Send in Messages when you're ready."
            if value.kind == .challenge { stage = .waiting }
            requestCompaction?(context)
        } catch {
            guard generation == token else { return }
            self.error = "The card couldn't be added. Your game is still here. Try again."
        }
    }
    func isCurrent(_ context: DraftContext) -> Bool {
        generation == context.generation && conversationKey == context.conversationKey && conversation == .oneToOne && isStaging
    }
    func invalidatePendingDraft() { generation = UUID(); isStaging = false }
    func hideSelectedChallenge() {
        guard let challenge = envelope?.challenge ?? game?.challenge else { return }
        safety.hide(challenge); invalidatePendingDraft()
        game = nil; envelope = nil; lastDraft = nil; notice = nil; error = nil; stage = .hidden
    }
    func unhideSelectedChallenge() {
        guard let url = selectedURL, let value = try? MessageEnvelopeCodec.decode(url) else { reset(); return }
        safety.unhide(value.challenge)
        let own = isOwnCard, pending = selectedPending
        selectedURL = nil
        receive(url, isOwn: own, pending: pending)
    }
    func acceptsDraftCallback(_ url: URL?, conversationKey key: String, context: DraftContext) -> Bool {
        guard context.generation == generation, context.conversationKey == key,
              conversationKey == key, conversation == .oneToOne, let url,
              let value = try? MessageEnvelopeCodec.decode(url) else { return false }
        return value == lastDraft || (isStaging && value.id == gameID && value.challenge == game?.challenge)
    }
    func cancelledDraft() {
        invalidatePendingDraft()
        notice = "Draft cancelled. You can add the card again."
        if lastDraft?.kind == .challenge, game?.phase == .sealed { stage = .playing }
        lastDraft = nil
    }
    func sendingStarted() {
        invalidatePendingDraft()
        selectedPending = false
        // This callback is not a delivery receipt.
        notice = "Messages is sending your card. Delivery is shown in the conversation."
    }
}
