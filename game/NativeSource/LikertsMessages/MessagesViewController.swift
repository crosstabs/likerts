import Messages
import SwiftUI
import UIKit

final class MessagesViewController: MSMessagesAppViewController {
    private let model = MessagesGameModel()
    private var gameSession: MSSession?
    private var activeKey: String?
    private var host: UIHostingController<MessagesGameView>?
    private var pendingDraft: (message: MSMessage, context: MessagesGameModel.DraftContext)?

    override func viewDidLoad() {
        super.viewDidLoad()
        model.requestExpansion = { [weak self] in self?.requestPresentationStyle(.expanded) }
        model.requestNewSession = { [weak self] in self?.gameSession = MSSession() }
        model.requestCompaction = { [weak self] context in
            guard let self, let conversation = self.activeConversation,
                  self.model.isCurrent(context),
                  conversation.remoteParticipantIdentifiers.count == 1,
                  self.activeKey == context.conversationKey, self.key(for: conversation) == context.conversationKey else { return }
            self.requestPresentationStyle(.compact)
        }
        model.insertDraft = { [weak self] value, context in
            guard let self else { throw DraftError.unavailable }
            try await self.insert(value, context: context)
        }
        let host = UIHostingController(rootView: MessagesGameView(model: model))
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        host.didMove(toParent: self)
        self.host = host
    }
    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        activate(conversation, selected: conversation.selectedMessage)
        model.isExpanded = presentationStyle == .expanded
    }
    override func didSelect(_ message: MSMessage, conversation: MSConversation) {
        super.didSelect(message, conversation: conversation)
        activate(conversation, selected: message)
        model.expand()
    }
    override func didTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.didTransition(to: presentationStyle)
        model.isExpanded = presentationStyle == .expanded
    }
    override func didStartSending(_ message: MSMessage, conversation: MSConversation) {
        super.didStartSending(message, conversation: conversation)
        if let pendingDraft, message === pendingDraft.message,
           model.acceptsDraftCallback(message.url, conversationKey: key(for: conversation), context: pendingDraft.context) {
            model.sendingStarted(); self.pendingDraft = nil
        }
    }
    override func didCancelSending(_ message: MSMessage, conversation: MSConversation) {
        super.didCancelSending(message, conversation: conversation)
        if let pendingDraft, message === pendingDraft.message,
           model.acceptsDraftCallback(message.url, conversationKey: key(for: conversation), context: pendingDraft.context) {
            model.cancelledDraft(); self.pendingDraft = nil
        }
    }
    override func willResignActive(with conversation: MSConversation) {
        super.willResignActive(with: conversation)
        model.invalidatePendingDraft()
    }
    private func key(for conversation: MSConversation) -> String {
        ([conversation.localParticipantIdentifier] + conversation.remoteParticipantIdentifiers)
            .map(\.uuidString).sorted().joined(separator: ":")
    }
    private func activate(_ conversation: MSConversation, selected: MSMessage?) {
        let key = key(for: conversation)
        if activeKey != key { gameSession = nil; activeKey = key }
        let status: MessagesGameModel.ConversationStatus = conversation.remoteParticipantIdentifiers.count == 1 ? .oneToOne : conversation.remoteParticipantIdentifiers.isEmpty ? .missing : .group
        model.setConversation(status, key: key)
        guard let selected else { return }
        // The currently tapped card supplies the session; no history lookup is needed.
        if let url = selected.url, (try? MessageEnvelopeCodec.decode(url)) != nil {
            gameSession = selected.session ?? MSSession()
        }
        model.receive(selected.url, isOwn: selected.senderParticipantIdentifier == conversation.localParticipantIdentifier, pending: selected.isPending)
    }
    private func insert(_ value: MessageEnvelope, context: MessagesGameModel.DraftContext) async throws {
        guard model.isCurrent(context), let conversation = activeConversation,
              conversation.remoteParticipantIdentifiers.count == 1,
              key(for: conversation) == context.conversationKey else { throw DraftError.unavailable }
        let session = gameSession ?? MSSession()
        gameSession = session
        let message = try MessageBuilder.make(value, session: session)
        pendingDraft = (message, context)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            conversation.insert(message) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume() }
            }
        }
    }
    private enum DraftError: Error { case unavailable }
}
