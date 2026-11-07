import Messages
import SwiftUI

@MainActor
enum MessageBuilder {
    static func make(_ value: MessageEnvelope, session: MSSession) throws -> MSMessage {
        let message = MSMessage(session: session)
        message.url = try MessageEnvelopeCodec.encode(value)
        let exact = value.guesses.map { guesses in zip(guesses, value.challenge.answers).filter { $0.0 == $0.1 }.count }
        let layout = MSMessageTemplateLayout()
        let renderer = ImageRenderer(content: MessageCardArtwork(name: value.challenge.name, score: value.score, exact: exact)
            .frame(width: 350).padding(12).background(Palette.cream)
            .environment(\.dynamicTypeSize, .medium).environment(\.colorScheme, .light))
        renderer.scale = 2
        layout.image = renderer.uiImage
        layout.caption = value.kind == .challenge ? "I bet you can't get 5/5." : "\(value.score ?? 0)% on the same wavelength."
        layout.subcaption = value.kind == .challenge ? "Tap to read my mind · Likerts required" : "\(exact ?? 0)/5 exact reads · Tap for a rematch"
        message.layout = layout
        message.summaryText = layout.caption
        message.accessibilityLabel = value.kind == .challenge ? "Likerts challenge. Predict \(value.challenge.name)'s five answers. Both players need Likerts installed." : "Likerts result: \(value.score ?? 0) percent, \(exact ?? 0) of five exact reads. Tap to see answers or make a rematch."
        return message
    }
}
