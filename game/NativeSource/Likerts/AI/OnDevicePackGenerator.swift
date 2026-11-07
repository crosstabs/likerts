import Foundation

#if canImport(FoundationModels) && os(iOS)
import FoundationModels

@available(iOS 26.0, *)
@Generable(description: "One choice from a numbered menu of reviewed preference ideas.")
private struct SelectedPreference {
    @Guide(description: "The menu idea number. Never repeat an idea number in this pack.", .range(1...8))
    var idea: Int
    @Guide(description: "False selects version A; true selects version B of that same idea.")
    var alternate: Bool
}

@available(iOS 26.0, *)
@Generable(description: "Five distinct selections from the provided reviewed menu; no written statements.")
private struct GeneratedTakes {
    @Guide(description: "Five different menu idea numbers, each used once, with a mix of families and frames.", .count(5))
    var selections: [SelectedPreference]
}
#endif

/// Runtime availability is checked on every request, including after a settings change.
/// Simulator may use the host Mac's model; it is not automatically treated as available.
enum OnDeviceAI {
    static func availability() -> PackAvailability {
        #if canImport(FoundationModels) && os(iOS)
        if #available(iOS 26.0, *) {
            let model = SystemLanguageModel.default
            switch model.availability {
            case .available:
                return model.supportsLocale(Locale(identifier: "en_US")) ? .available : .unsupportedLanguage
            case .unavailable(let reason):
                switch reason {
                case .deviceNotEligible: return .deviceNotEligible
                case .appleIntelligenceNotEnabled: return .appleIntelligenceDisabled
                case .modelNotReady: return .modelNotReady
                @unknown default: return .unavailable
                }
            @unknown default: return .unavailable
            }
        }
        return .requiresIOS26
        #else
        return .unavailable
        #endif
    }
}

struct OnDevicePackGenerator: PromptPackGenerating {
    func generate(theme: PackTheme) async throws -> [String] {
        try await generate(theme: theme, formattingRetry: false)
    }

    func retryFormatting(theme: PackTheme) async throws -> [String] {
        try await generate(theme: theme, formattingRetry: true)
    }

    private func generate(theme: PackTheme, formattingRetry: Bool) async throws -> [String] {
        try Task.checkCancellation()
        let availability = OnDeviceAI.availability()
        guard availability.canGenerate else { throw PackGenerationError.unavailable(availability) }
        #if canImport(FoundationModels) && os(iOS)
        if #available(iOS 26.0, *) {
            return try await generateWithSystemModel(theme: theme, formattingRetry: formattingRetry)
        }
        #endif
        throw PackGenerationError.unavailable(availability)
    }

    #if canImport(FoundationModels) && os(iOS)
    @available(iOS 26.0, *)
    private func generateWithSystemModel(theme: PackTheme, formattingRetry: Bool) async throws -> [String] {
        // Fresh sessions avoid cross-player context. Only the theme and reviewed
        // menu are provided; model-written prose never reaches the game.
        // No name, answer, identifier, telemetry, tool or network service is supplied.
        let session = LanguageModelSession(model: .default, instructions: """
            Arrange a varied five-take pack for Likerts by choosing from the reviewed menu.
            Return five DIFFERENT idea numbers. Choose either version A or B for each.
            Use at least three families and three frames, with no more than two from any family or frame.
            Do not invent, rewrite or combine sentences. The app renders the reviewed versions exactly.
            Do not infer a player's personality. No player information is supplied.
            """)
        do {
            let menu = AIPreferenceCatalog.ideas(for: theme)
            let options = menu.enumerated().map { slot, idea in
                "\(slot + 1). Family \(idea.family); frame \(idea.frame.rawValue). A: \(idea.variants[0]) B: \(idea.variants[1])"
            }.joined(separator: "\n")
            let correction = formattingRetry ? " Choose five different menu numbers; do not repeat a number with another version." : ""
            let response = try await session.respond(
                to: "Theme: \(theme.title). Mood: \(theme.summary)\nReviewed menu:\n\(options)\nSelect five varied ideas." + correction,
                generating: GeneratedTakes.self,
                options: GenerationOptions(temperature: 0.6, maximumResponseTokens: 250)
            )
            try Task.checkCancellation()
            let references = try response.content.selections.map { selected in
                guard menu.indices.contains(selected.idea - 1) else { throw PackValidationError.qualityNotEstablished }
                return AIPreferenceCatalog.Selection(ideaID: menu[selected.idea - 1].id, variantID: selected.alternate ? 1 : 0)
            }
            return try AIPreferenceCatalog.render(references, theme: theme)
        } catch let error as LanguageModelSession.GenerationError {
            if Task.isCancelled { throw CancellationError() }
            switch error {
            case .guardrailViolation, .refusal: throw PackGenerationError.safetyBlocked
            case .assetsUnavailable: throw PackGenerationError.unavailable(.modelNotReady)
            case .unsupportedLanguageOrLocale: throw PackGenerationError.unavailable(.unsupportedLanguage)
            default: throw error
            }
        }
    }
    #endif
}
