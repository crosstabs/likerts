import SwiftUI

/// The controls are independent: a quiet screen never depends on audio feedback.
struct SoundSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    @AppStorage("likerts.audio.music") private var music = false
    @AppStorage("likerts.audio.sound") private var sound = true
    @AppStorage("likerts.audio.haptics") private var haptics = true
    @State private var hiddenCount = LocalContentSafety().count
    @State private var confirmUnhide = false
    @State private var help: HelpDestination?

    private func preference(_ value: Binding<Bool>) -> Binding<Bool> {
        Binding(get: { value.wrappedValue }, set: { newValue in
            value.wrappedValue = newValue
            // Stop already-playing audio synchronously when a control is muted.
            GameAudio.shared.preferencesChanged()
        })
    }

    var body: some View {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Make it yours.").roundedFont(28, .black).tracking(-0.6)
                    Text("Sound, feel & privacy").roundedFont(15, .semibold).foregroundStyle(Palette.muted)
                }
                Spacer(minLength: 0)
                CloseButton { dismiss() }
            }
            VStack(spacing: 0) {
                setting("Music", subtitle: "A short musical moment during play", symbol: "music.note", value: preference($music), id: "settings.music")
                Divider().padding(.leading, 58)
                setting("Sound effects", subtitle: "Little cues for choices and reveals", symbol: "speaker.wave.2", value: preference($sound), id: "settings.sound")
                Divider().padding(.leading, 58)
                setting("Haptics", subtitle: "Gentle taps and feedback", symbol: "hand.tap", value: preference($haptics), id: "settings.haptics")
            }
            .padding(.horizontal, 16)
            .background(.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 24))
            Text("Sounds respect Silent mode and play alongside your music. You can play with every cue off.")
                .roundedFont(13, .medium).foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 8) {
                Button { help = .support } label: {
                    Text("Help & contact").frame(minHeight: 44).contentShape(Rectangle())
                }
                    .accessibilityIdentifier("settings.support")
                Button { help = .privacy } label: {
                    Text("Privacy in Likerts").frame(minHeight: 44).contentShape(Rectangle())
                }
                    .accessibilityIdentifier("settings.privacyDetails")
            }.roundedFont(17, .bold).buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 12) {
                Text("Your game & privacy").roundedFont(18, .heavy)
                Text("Your settings and standalone game, including nickname, answers and results, are saved locally. Likerts does not encrypt the saved game; leaving attempts to clear the save and reports a storage error if it cannot. Party boards are temporary and clear when the app restarts.")
                Text("Challenge codes and Messages cards contain the nickname, takes and answers. They are encoded, not encrypted; share them with people you trust.")
                Text("On-device AI is optional. It chooses from reviewed ideas using the selected theme, not your nickname or answers. Likerts has no account or game server.")
                Text("You can discard a preview or hide a challenge using Content options during play. Hiding is local to Likerts here: no report is sent and no sender is blocked. Messages has its own separate hidden list.")
            }
            .roundedFont(13, .medium).foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("settings.privacy")
            if hiddenCount > 0 {
                Button("Clear locally hidden challenges (\(hiddenCount))") { confirmUnhide = true }
                    .roundedFont(15, .semibold).frame(minHeight: 44)
                    .accessibilityIdentifier("settings.clearHidden")
            }
          }.padding(28).padding(.top, 10).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }
        .background(Palette.cream).foregroundStyle(Palette.ink).presentationDragIndicator(.visible)
        .presentationDetents([.large])
        .sheet(item: $help) { HelpDestinationView(destination: $0).environment(\.dynamicTypeSize, textSize) }
        .confirmationDialog("Show locally hidden challenges again?", isPresented: $confirmUnhide, titleVisibility: .visible) {
            Button("Clear hidden list", role: .destructive) { LocalContentSafety().clear(); hiddenCount = 0 }
            Button("Keep hidden", role: .cancel) {}
        } message: { Text("This only clears the hidden list in this app. It does not send a report or change any conversation.") }
    }

    private func setting(_ title: String, subtitle: String, symbol: String,
                         value: Binding<Bool>, id: String) -> some View {
        Toggle(isOn: value) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: symbol).font(.system(size: 19, weight: .semibold))
                    .frame(width: 28, height: 28).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).roundedFont(17, .bold)
                    Text(subtitle).roundedFont(13, .medium).foregroundStyle(Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }.padding(.vertical, 17)
        }
        .tint(Palette.ink)
        .accessibilityIdentifier(id)
    }
}
