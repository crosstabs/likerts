#if DEBUG
import SwiftUI
import Messages

/// Explicit local simulation. Shares the production view/model, never calls MSConversation.insert/send.
struct MessagesHarnessView: View {
    @State private var model = MessagesGameModel()
    @State private var simulatedSession = MSSession()
    @State private var initialSession: MSSession?
    @State private var builtMessage: MSMessage?
    @State private var configured = false
    @State private var presentationTaps = 0
    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                Text("Messages simulation · No delivery").font(.caption.bold()).accessibilityIdentifier("messages.simulation")
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        Button(model.isExpanded ? "Compact" : "Expand") {
                            presentationTaps += 1; model.isExpanded.toggle()
                        }.frame(minHeight: 44).contentShape(Rectangle())
                            .accessibilityIdentifier("messages.compact")
                            .accessibilityValue("\(model.isExpanded ? "expanded" : "compact"); taps \(presentationTaps)")
                        Button("No chat") { model.conversation = .missing }.accessibilityIdentifier("messages.noConversation")
                        Button("Group") { model.conversation = .group }.accessibilityIdentifier("messages.group")
                        Button("1 friend") { model.conversation = .oneToOne }.accessibilityIdentifier("messages.oneFriend")
                        Button("Bad card") { model.receive(URL(string: "data:application/vnd.likerts.message+json;base64,broken"), isOwn: false); model.expand() }.accessibilityIdentifier("messages.badPayload")
                    }.font(.caption).buttonStyle(.bordered)
                }
                if let draft = model.lastDraft {
                    Button(draft.kind == .challenge ? "Simulate recipient opening card" : "Simulate result opening") {
                        guard let url = builtMessage?.url else { return }
                        model.reset()
                        model.receive(url, isOwn: false)
                        model.expand()
                    }.font(.caption.bold()).frame(minHeight: 32)
                        .accessibilityIdentifier(draft.kind == .challenge ? "messages.simulateRecipient" : "messages.simulateResult")
                }
                Text(initialSession == nil || initialSession === simulatedSession ? "Same session" : "New session").font(.caption2).accessibilityIdentifier("messages.session")
            }.padding(8).background(Color.yellow.opacity(0.2)).zIndex(1)
            MessagesGameView(model: model)
                .frame(maxHeight: model.isExpanded ? .infinity : 310)
            if !model.isExpanded { Spacer(minLength: 0) }
        }.onAppear {
            guard !configured else { return }; configured = true
            model.setConversation(.oneToOne, key: "simulated-one-to-one")
            model.requestExpansion = { model.isExpanded = true }
            model.requestNewSession = { simulatedSession = MSSession(); initialSession = simulatedSession }
            model.insertDraft = { value, _ in
                // Real MSMessage construction validates layout/URL/session, only insertion is simulated.
                builtMessage = try MessageBuilder.make(value, session: simulatedSession)
            }
        }.background(Palette.cream).preferredColorScheme(.light)
    }
}
#endif
