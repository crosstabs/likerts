import SwiftUI

struct TopicPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    let start: (TopicID?, [TopicRound]) -> Void
    @State private var drawError = false
    private var orderedTopics: [TopicID] { VignetteBank.pilotTopics + TopicID.allCases.filter { !VignetteBank.pilotTopics.contains($0) } }
    var body: some View {
        SheetPage {
            HStack {
                Text("Pick your world.").roundedFont(30, .black).tracking(-0.7)
                Spacer(minLength: 8)
                CloseButton { dismiss() }
            }
            Text("Five takes from your favourite corner of life.").roundedFont(16, .medium).foregroundStyle(TotemTone.muted)
            Button {
                prepare(nil)
            } label: {
                HStack { Image(systemName: "shuffle"); Text("Surprise me"); Spacer(); Image(systemName: "arrow.right") }
                    .roundedFont(18, .bold).padding(20).foregroundStyle(.white)
                    .background(TotemTone.button, in: RoundedRectangle(cornerRadius: 23))
            }.buttonStyle(SquishButtonStyle()).disabled(TopicPlayLibrary.catalog == nil).accessibilityIdentifier("topics.mix")
            if TopicPlayLibrary.catalog == nil {
                Text("The topic library couldn't load. Quick games and daily play are still available.").roundedFont(16, .semibold)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: textSize.isAccessibilitySize ? 280 : 145), spacing: 12)], spacing: 12) {
                    ForEach(orderedTopics, id: \.rawValue) { topic in
                        Button {
                            prepare(topic)
                        } label: {
                            VStack(alignment: .leading, spacing: 9) {
                                if let round = VignetteBank.all.first(where: { TopicPlayLibrary.round(id: $0.id)?.topic == topic }).flatMap({ TopicPlayLibrary.round(id: $0.id) }) ?? TopicPlayLibrary.catalog?.rounds(for: topic).first {
                                    StorySceneView(round: round, compact: true).accessibilityHidden(true)
                                }
                                Text(topic.definition.title).roundedFont(18, .heavy)
                                Text(VignetteBank.pilotTopics.contains(topic) ? "50 takes · Story scenes" : "50 curated takes").roundedFont(12, .medium).foregroundStyle(TotemTone.muted)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
                                .background(.white.opacity(0.65), in: RoundedRectangle(cornerRadius: 23))
                        }.buttonStyle(SquishButtonStyle()).accessibilityIdentifier("topics.\(topic.rawValue)")
                    }
                }
            }
            Text("Original composed scenes · Ready offline\nRecently played takes are remembered on this device.")
                .roundedFont(12, .medium).foregroundStyle(TotemTone.muted)
        }
        .alert("Couldn't prepare those takes", isPresented: $drawError) {
            Button("OK", role: .cancel) {}.accessibilityIdentifier("topics.error.ok")
        } message: { Text("Try again, or close this and start a quick game.") }
    }
    private func prepare(_ topic: TopicID?) {
        do {
            let rounds = try TopicPlayLibrary.prepare(topic: topic)
            drawError = false
            dismiss()
            start(topic, rounds)
        } catch {
            drawError = true
        }
    }
}
