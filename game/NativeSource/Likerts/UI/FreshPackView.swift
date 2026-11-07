import SwiftUI

struct FreshPackView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var theme: PackTheme = .everydayChaos
    @State private var name = ""
    @State private var availability = OnDeviceAI.availability()
    @State private var request = FreshPackRequest()
    @State private var nameError: String?
    #if DEBUG
    @ScaledMetric(relativeTo: .body) private var probeBodySize: CGFloat = 17
    #endif
    let start: (String, PromptPack) -> Void
    private var result: PackResult? { request.result }
    private var working: Bool { request.working }

    var body: some View {
        SheetPage(scrollIdentifier: "fresh.scroll") {
            HStack {
                Eyebrow(text: "Fresh takes")
                Spacer()
                CloseButton { cancel(); dismiss() }
            }
            Text(result == nil ? "Pick your flavour\nof chaos." : "Five takes,\nready to read.")
                .roundedFont(34, .black).tracking(-1)
            if let result { preview(result) }
            else { composer }
        }
        #if DEBUG
        .overlay(alignment: .topLeading) {
            if Feel.testing && ProcessInfo.processInfo.arguments.contains("-ai-validation-probe") {
                Text("size=\(textSize == .accessibility3 ? "AX3" : textSize.isAccessibilitySize ? "AX-other" : "standard");body=\(Int(probeBodySize.rounded()))")
                    .font(.system(size: 1)).foregroundStyle(.clear)
                    .accessibilityIdentifier("fresh.dynamicType")
                    .allowsHitTesting(false)
            }
        }
        #endif
        .onDisappear(perform: cancel)
        .onChange(of: scenePhase) { _, phase in if phase == .active { availability = OnDeviceAI.availability() } }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Start with five handpicked takes, or let on-device AI choose from Likerts' reviewed ideas.")
                .roundedFont(15, .medium).foregroundStyle(Palette.muted)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: textSize.isAccessibilitySize ? 1 : 2), spacing: 10) {
                ForEach(PackTheme.allCases) { item in
                    Button {
                        Feel.tap(); theme = item
                    } label: {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text(item.emoji).font(.system(size: 27))
                                Spacer()
                                if theme == item { Image(systemName: "checkmark.circle.fill").font(.system(size: 20)) }
                            }
                            Text(item.title).roundedFont(16, .heavy)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(17)
                            .background(theme == item ? Palette.violet.opacity(0.4) : .white.opacity(0.8), in: RoundedRectangle(cornerRadius: 22))
                            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(theme == item ? Palette.ink : .clear, lineWidth: 2))
                    }.buttonStyle(SquishButtonStyle()).disabled(working)
                        .accessibilityValue(theme == item ? "selected" : "not selected")
                        .accessibilityAddTraits(theme == item ? [.isSelected] : [])
                        .accessibilityIdentifier("fresh.theme.\(item.rawValue)")
                }
            }
            PrimaryButton(title: working ? "Use handpicked takes instead" : "Use handpicked takes", symbol: "hand.thumbsup", identifier: "fresh.authored") {
                request.useHandpicked(theme: theme)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Or try on-device AI").roundedFont(17, .heavy)
                Label(availability.title, systemImage: availability.canGenerate ? "checkmark.shield" : "info.circle")
                    .roundedFont(14, .bold).accessibilityIdentifier("fresh.availability")
                Text(availability.detail).roundedFont(13, .medium).foregroundStyle(Palette.muted)
                Text("AI picks from reviewed writing instead of inventing sentences. Review all five before playing.")
                    .roundedFont(13, .medium).foregroundStyle(Palette.muted)
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(.white.opacity(0.75), in: RoundedRectangle(cornerRadius: 21))
            if working {
                // Keep cancellation where the initiating action was, instead
                // of pushing it below the viewport when progress appears.
                PrimaryButton(title: "Cancel AI pick", symbol: "xmark", color: Palette.violet.opacity(0.35), foreground: Palette.ink, identifier: "fresh.cancel") {
                    request.discard()
                }
                HStack(spacing: 12) { ProgressView(); Text("Picking five takes…").roundedFont(16) }
                    .frame(maxWidth: .infinity).padding(.vertical, 12).accessibilityIdentifier("fresh.working")
            } else if availability.canGenerate {
                PrimaryButton(title: "Let AI pick five", symbol: "sparkles", color: Palette.violet.opacity(0.35), foreground: Palette.ink, identifier: "fresh.generate", action: generate)
            }
        }
    }

    private func preview(_ result: PackResult) -> some View {
        VStack(alignment: .leading, spacing: 21) {
            Label(result.pack.source.title, systemImage: result.pack.source.isAI ? "sparkles" : "hand.thumbsup.fill")
                .roundedFont(14, .bold).padding(12).background(Palette.lime, in: Capsule()).accessibilityIdentifier("fresh.source")
            Text(result.pack.theme.summary).roundedFont(17, .semibold)
            if result.pack.source == .onDeviceSelection {
                Text("AI selected these takes from Likerts' reviewed ideas. Review all five before playing or sharing.")
                    .roundedFont(14, .medium).foregroundStyle(Palette.muted)
            } else if result.pack.source == .onDeviceAI {
                Text("Review these earlier AI-made takes before playing or sharing.")
                    .roundedFont(14, .medium).foregroundStyle(Palette.muted)
            }
            if let reason = result.fallbackReason {
                Text(reason.message).roundedFont(14, .medium).foregroundStyle(Palette.muted).accessibilityIdentifier("fresh.fallback")
            }
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-ai-validation-probe"), let diagnostic = result.validationDiagnostic {
                Text(diagnostic).font(.system(size: 1)).foregroundStyle(.clear)
                    .accessibilityIdentifier("fresh.validationDiagnostic")
            }
            #endif
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(result.pack.statements.enumerated()), id: \.offset) { index, text in
                    HStack(alignment: .top, spacing: 12) {
                        Text("0\(index + 1)").roundedFont(12, .heavy).foregroundStyle(Palette.muted).padding(.top, 3)
                        Text(text).roundedFont(17, .bold).accessibilityIdentifier("fresh.preview.\(index + 1)")
                    }
                }
            }.padding(21).background(.white, in: RoundedRectangle(cornerRadius: 24))
            VStack(alignment: .leading, spacing: 9) {
                Text("Nickname · optional").roundedFont(13, .semibold)
                TextField("Your friend", text: $name).roundedFont(19).padding(17).background(.white, in: RoundedRectangle(cornerRadius: 17))
                    .autocorrectionDisabled().submitLabel(.done).accessibilityIdentifier("fresh.name")
                    .onChange(of: name) { _, value in if value.count > 20 { name = String(value.prefix(20)) }; nameError = nil }
                if let nameError { Text(nameError).roundedFont(13).accessibilityIdentifier("fresh.nameError") }
            }
            PrimaryButton(title: "Play these five takes", identifier: "fresh.play") {
                do {
                    let prompts = result.pack.statements.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: result.pack.theme.emoji) }
                    let validated = try Challenge(name: name, prompts: prompts, answers: [1, 1, 1, 1, 1])
                    dismiss(); start(validated.name, result.pack)
                } catch {
                    nameError = error as? ChallengeError == .invalidName ? "Try another playful nickname: up to 20 characters, with no contact details or sensitive words." : "This pack couldn't be prepared. Choose another theme or use handpicked takes."
                }
            }
            Button { request.discard(); availability = OnDeviceAI.availability() } label: {
                Label("Discard these takes", systemImage: "trash").roundedFont(14, .semibold)
                    .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
            }.accessibilityIdentifier("fresh.discard")
        }
    }

    private func generate() {
        availability = OnDeviceAI.availability()
        request.generate(theme: theme, availability: availability)
    }
    private func cancel() {
        request.cancel()
    }
}
