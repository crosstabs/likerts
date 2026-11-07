import SwiftUI

struct ContentSafetyButton: View {
    let hide: () -> Void
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var confirm = false
    @State private var help: HelpDestination?
    var body: some View {
        Button { confirm = true } label: {
            Image(systemName: "shield.lefthalf.filled").font(.system(size: 16, weight: .semibold))
                .frame(width: 44, height: 44).background(TotemTone.close, in: Circle())
        }.buttonStyle(SquishButtonStyle()).accessibilityLabel("Content options")
            .accessibilityIdentifier("content.options")
            .alert("Hide this challenge here?", isPresented: $confirm) {
                Button("Hide this challenge", role: .destructive, action: hide).accessibilityIdentifier("content.hide")
                Button("Report content") { help = .report }.accessibilityIdentifier("content.report")
                Button("Keep playing", role: .cancel) {}.accessibilityIdentifier("content.keep")
            } message: {
                Text("Its local progress will be cleared. No report is sent and the sender is not blocked. Existing Messages cards are not removed.")
            }
            .sheet(item: $help) { HelpDestinationView(destination: $0).environment(\.dynamicTypeSize, textSize) }
    }
}
