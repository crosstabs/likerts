import Foundation

enum PackTheme: String, CaseIterable, Identifiable, Sendable {
    case everydayChaos, foodTakes, socialBattery, sideQuests

    var id: String { rawValue }
    var title: String {
        switch self {
        case .everydayChaos: return "Everyday chaos"
        case .foodTakes: return "Food takes"
        case .socialBattery: return "Social battery"
        case .sideQuests: return "Side quests"
        }
    }
    var summary: String {
        switch self {
        case .everydayChaos: return "Tiny habits. Suspiciously strong opinions."
        case .foodTakes: return "Snacks, rituals and very personal pizza choices."
        case .socialBattery: return "Party energy, group chats and the art of leaving."
        case .sideQuests: return "Absurd adventures with extremely low stakes."
        }
    }
    var emoji: String {
        switch self {
        case .everydayChaos: return "🌀"
        case .foodTakes: return "🥨"
        case .socialBattery: return "🪩"
        case .sideQuests: return "🐉"
        }
    }
}

enum PackSource: String, Equatable, Sendable {
    // Preserve the provenance of existing free-written AI saves.
    case onDeviceAI
    case onDeviceSelection
    case authored

    var title: String {
        switch self {
        case .onDeviceAI: return "Made on your device"
        case .onDeviceSelection: return "AI-picked on your device"
        case .authored: return "Handpicked by Likerts"
        }
    }
    var isAI: Bool { self != .authored }
}

struct PromptPack: Equatable, Sendable {
    let theme: PackTheme
    let statements: [String]
    let source: PackSource
    var catalogVersion: Int? = nil
}

enum PackAvailability: Equatable, Sendable {
    case available
    case requiresIOS26
    case deviceNotEligible
    case appleIntelligenceDisabled
    case modelNotReady
    case unsupportedLanguage
    case unavailable

    var canGenerate: Bool { self == .available }
    var title: String {
        switch self {
        case .available: return "On-device AI is ready"
        case .requiresIOS26: return "On-device AI needs iOS 26"
        case .deviceNotEligible: return "On-device AI isn't supported here"
        case .appleIntelligenceDisabled: return "Apple Intelligence is off"
        case .modelNotReady: return "Apple's model isn't ready yet"
        case .unsupportedLanguage: return "English generation isn't available"
        case .unavailable: return "On-device AI is unavailable"
        }
    }
    var detail: String {
        switch self {
        case .available: return "Let Apple's on-device model choose from Likerts' reviewed ideas. Only the theme and those ideas are used; your name and answers stay out of the request."
        case .requiresIOS26: return "You can still play every theme with five handpicked takes. On-device generation needs iOS 26 or later."
        case .deviceNotEligible: return "This device doesn't offer Apple's on-device model. Every theme still has a handpicked pack ready to play."
        case .appleIntelligenceDisabled: return "Apple Intelligence must be enabled for generation. Handpicked packs are ready now."
        case .modelNotReady: return "Apple's model may still be downloading or preparing. Try again later, or play a handpicked pack now."
        case .unsupportedLanguage: return "Likerts currently makes fresh takes in English. Play a handpicked pack instead."
        case .unavailable: return "Fresh takes aren't available right now. Play the handpicked version of any theme."
        }
    }
}

enum PackValidationError: Error, Equatable {
    case wrongCount
    case invalidStatement
    case duplicateStatements
    case sensitiveContent
    case invalidPreference
    case qualityNotEstablished
}

/// A conservative deterministic screen in addition to the model's default guardrails.
/// This is deliberately not represented as complete semantic moderation.
enum PackValidator {
    static func validate(_ statements: [String]) throws -> [String] {
        guard statements.count == 5 else { throw PackValidationError.wrongCount }
        var keys = Set<String>()
        var validated: [String] = []
        for statement in statements {
            guard !statement.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) || CharacterSet.newlines.contains($0) }) else {
                throw PackValidationError.invalidStatement
            }
            let clean = statement.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            guard (15...120).contains(clean.count), clean.utf8.count <= 300,
                  clean.hasPrefix("I "), clean.hasSuffix("."),
                  clean.filter({ ".!?".contains($0) }).count == 1,
                  !clean.contains("@"), !clean.contains("://"),
                  !clean.contains("www."), !clean.contains("#") else {
                throw PackValidationError.invalidStatement
            }
            let lower = clean.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            let words = lower.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
            guard !hasSensitiveContent(clean) else { throw PackValidationError.sensitiveContent }
            let key = words.joined(separator: " ")
            guard keys.insert(key).inserted else { throw PackValidationError.duplicateStatements }
            validated.append(clean)
        }
        return validated
    }

    /// Apply the same conservative screen to every returned item before a
    /// formatting retry. Never pass the rejected text back into the model.
    private static func hasSensitiveContent(_ text: String) -> Bool {
        let lower = text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let words = lower.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
        let forbidden: Set<String> = [
                "kill", "killing", "murder", "suicide", "suicidal", "selfharm", "die", "death", "dead",
                "sex", "sexual", "sexy", "porn", "nude", "naked", "fetish", "rape", "assault",
                "drug", "drugs", "cocaine", "heroin", "meth", "weed", "alcohol", "drunk", "beer", "wine",
                "gun", "guns", "weapon", "weapons", "bomb", "bombs", "shoot", "shooting", "knife",
                "flame", "flames", "flaming", "burned", "burning",
                "hate", "racist", "racism", "slur", "slurs", "bully", "bullying", "terrorist", "abuse",
                "politics", "political", "religion", "religious", "race", "gender", "sexuality",
                "diagnosis", "diagnose", "medical", "medicine", "disease", "disorder", "therapy",
                "password", "address", "phone", "email", "bank", "credit", "bitcoin", "investment",
                "fuck", "shit", "bitch", "bastard", "damn", "instructions", "assistant", "system"
            ]
        let forbiddenPhrases = ["self harm", "hurt myself", "hurt someone", "personal information", "as an ai", "ignore previous",
                                    "ended up falling down", "i fell down", "i fall down", "i would fall down", "i am falling down", "i'm falling down",
                                    "i fell off", "i fall off", "i would fall off", "i am falling off", "i'm falling off",
                                    "i fell from", "i fall from", "i would fall from", "i am falling from", "i'm falling from",
                                    "playing with fire", "on fire",
                                    "set fire", "juggling fire", "juggle fire", "jump through fire"]
        return words.contains(where: { forbidden.contains($0) }) ||
            forbiddenPhrases.contains(where: { lower.contains($0) }) ||
            words.contains(where: { $0.count >= 5 && $0.allSatisfy(\.isNumber) })
    }

    /// Shared metadata uses the same limited screen, without statement grammar.
    static func permitsSharedMetadata(_ text: String) -> Bool {
        !hasSensitiveContent(text) && !text.contains("@") && !text.contains("://") &&
            !text.lowercased().contains("www.") && !text.contains("#")
    }

    static func permitsFormattingRetry(_ statements: [String], error: PackValidationError) -> Bool {
        guard error == .invalidStatement, statements.count == 5 else { return false }
        return statements.allSatisfy { text in
            text.utf8.count <= 300 && !text.contains("@") && !text.contains("://") &&
            !text.contains("www.") && !text.contains("#") && !hasSensitiveContent(text)
        }
    }

    #if DEBUG
    /// Opt-in test diagnostics report only a rule category, never generated
    /// text or player data. The production validator remains authoritative.
    static func diagnostic(for statements: [String], error: PackValidationError) -> String {
        switch error {
        case .wrongCount: return "wrongCount"
        case .duplicateStatements: return "duplicateStatements"
        case .sensitiveContent: return "sensitiveContent"
        case .invalidPreference: return "preferenceContract"
        case .qualityNotEstablished: return "qualityNotEstablished"
        case .invalidStatement:
            for statement in statements {
                if statement.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) || CharacterSet.newlines.contains($0) }) { return "controlOrNewline" }
                let clean = statement.split(whereSeparator: \.isWhitespace).joined(separator: " ")
                if !(15...120).contains(clean.count) || clean.utf8.count > 300 { return "length" }
                if !clean.hasPrefix("I ") { return "firstPersonPrefix" }
                if !clean.hasSuffix(".") { return "endingPeriod" }
                if clean.filter({ ".!?".contains($0) }).count != 1 { return "sentencePunctuation" }
                if clean.contains("@") || clean.contains("://") || clean.contains("www.") || clean.contains("#") { return "contactOrMetadata" }
            }
            return "invalidStatementOther"
        }
    }
    #endif
}

enum PackGenerationError: Error, Equatable {
    case safetyBlocked
    case unavailable(PackAvailability)
}

enum PackFallbackReason: Equatable, Sendable {
    case modelUnavailable(PackAvailability)
    case modelDeclined
    case invalidGeneration
    case generationFailed
    case timedOut
    case qualityNotEstablished

    var message: String {
        switch self {
        case .modelUnavailable(let availability): return availability.detail
        case .modelDeclined: return "The model couldn't make this pack. These five takes were handpicked by Likerts instead."
        case .invalidGeneration: return "The fresh takes didn't pass our checks. These five were handpicked by Likerts instead."
        case .generationFailed: return "Fresh takes couldn't finish this time. These five were handpicked by Likerts instead."
        case .timedOut: return "The model took too long this time. These five were handpicked by Likerts instead."
        case .qualityNotEstablished: return "AI couldn't choose a varied set of reviewed ideas. These five were handpicked by Likerts instead."
        }
    }
}

struct PackResult: Equatable, Sendable {
    let pack: PromptPack
    let fallbackReason: PackFallbackReason?
    #if DEBUG
    var validationDiagnostic: String? = nil
    #endif
}

protocol PromptPackGenerating: Sendable {
    func generate(theme: PackTheme) async throws -> [String]
    func retryFormatting(theme: PackTheme) async throws -> [String]
}

extension PromptPackGenerating {
    func retryFormatting(theme: PackTheme) async throws -> [String] { try await generate(theme: theme) }
}

private struct FormattingRetryTimeout: Error {}

struct PromptPackService: Sendable {
    let generator: any PromptPackGenerating
    /// Timeout is cooperative: the model task must honor cancellation.
    var retryTimeoutNanoseconds: UInt64 = 10_000_000_000

    func make(theme: PackTheme, availability: PackAvailability) async throws -> PackResult {
        try Task.checkCancellation()
        guard availability.canGenerate else {
            return fallback(theme, reason: .modelUnavailable(availability))
        }
        do {
            var statements = try await generator.generate(theme: theme)
            try Task.checkCancellation()
            do {
                return try validatedResult(statements, theme: theme)
            } catch let initialError as PackValidationError {
                let initial = diagnostic(for: statements, error: initialError)
                if PackValidator.permitsFormattingRetry(statements, error: initialError) {
                    do {
                        statements = try await retryFormatting(theme: theme)
                        try Task.checkCancellation()
                        return annotated(try validatedResult(statements, theme: theme), initial: initial, retry: "passed")
                    } catch let retryError as PackValidationError {
                        return annotated(fallback(theme, reason: retryError == .qualityNotEstablished ? .qualityNotEstablished : .invalidGeneration), initial: initial,
                                         retry: diagnostic(for: statements, error: retryError))
                    } catch is FormattingRetryTimeout {
                        return annotated(fallback(theme, reason: .invalidGeneration), initial: initial, retry: "timedOut")
                    } catch {
                        if error is CancellationError || Task.isCancelled { throw CancellationError() }
                        if let generationError = error as? PackGenerationError {
                            switch generationError {
                            case .safetyBlocked:
                                return annotated(fallback(theme, reason: .modelDeclined), initial: initial, retry: "modelDeclined")
                            case .unavailable(let reason):
                                return annotated(fallback(theme, reason: .modelUnavailable(reason)), initial: initial, retry: "modelUnavailable")
                            }
                        }
                        return annotated(fallback(theme, reason: .generationFailed), initial: initial, retry: "generationFailed")
                    }
                }
                return annotated(fallback(theme, reason: initialError == .qualityNotEstablished ? .qualityNotEstablished : .invalidGeneration), initial: initial, retry: "notAttempted")
            }
        } catch {
            // A cancelled screen must not be replaced with a fallback or a late result.
            if error is CancellationError || Task.isCancelled { throw CancellationError() }
            if let generationError = error as? PackGenerationError {
                switch generationError {
                case .safetyBlocked: return fallback(theme, reason: .modelDeclined)
                case .unavailable(let reason): return fallback(theme, reason: .modelUnavailable(reason))
                }
            }
            if let validation = error as? PackValidationError {
                return annotated(fallback(theme, reason: validation == .qualityNotEstablished ? .qualityNotEstablished : .invalidGeneration),
                                 initial: diagnostic(for: [], error: validation), retry: "notAttempted")
            }
            return fallback(theme, reason: .generationFailed)
        }
    }

    private func validatedResult(_ statements: [String], theme: PackTheme) throws -> PackResult {
        let valid = try PackValidator.validate(statements)
        // Generation has a narrower writing contract than imported LK2 text.
        // Hypothetical choices fit the scale; invented past biographies do not.
        for text in valid {
            let words = text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
                .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
            let combat: Set<String> = ["fight", "fights", "fighting", "fought", "battle", "battles", "battling", "combat", "attack", "attacks", "attacking", "attacked", "punch", "punches", "punching", "duel", "duels"]
            guard !words.contains(where: combat.contains) else { throw PackValidationError.sensitiveContent }
            guard text.hasPrefix("I would ") else { throw PackValidationError.invalidPreference }
        }
        try AIPreferenceCatalog.validate(valid, theme: theme)
        return PackResult(pack: PromptPack(theme: theme, statements: valid, source: .onDeviceSelection,
                                          catalogVersion: AIPreferenceCatalog.currentVersion), fallbackReason: nil)
    }

    /// Debug probe carries only rule names, and only when explicitly enabled.
    private func diagnostic(for statements: [String], error: PackValidationError) -> String {
        #if DEBUG
        guard ProcessInfo.processInfo.arguments.contains("-ai-validation-probe") else { return "" }
        return PackValidator.diagnostic(for: statements, error: error)
        #else
        return ""
        #endif
    }

    private func annotated(_ value: PackResult, initial: String, retry: String) -> PackResult {
        #if DEBUG
        guard !initial.isEmpty else { return value }
        var result = value
        result.validationDiagnostic = "initial:\(initial);retry:\(retry)"
        return result
        #else
        return value
        #endif
    }

    private func retryFormatting(theme: PackTheme) async throws -> [String] {
        try await withThrowingTaskGroup(of: [String].self) { group in
            group.addTask { try await generator.retryFormatting(theme: theme) }
            group.addTask {
                try await Task.sleep(nanoseconds: retryTimeoutNanoseconds)
                throw FormattingRetryTimeout()
            }
            defer { group.cancelAll() }
            guard let first = try await group.next() else { throw FormattingRetryTimeout() }
            return first
        }
    }

    private func fallback(_ theme: PackTheme, reason: PackFallbackReason) -> PackResult {
        PackResult(pack: AuthoredPacks.pack(for: theme), fallbackReason: reason)
    }
}

enum AuthoredPacks {
    static func pack(for theme: PackTheme) -> PromptPack {
        let statements: [String]
        switch theme {
        case .everydayChaos:
            statements = [
                "I would set three alarms and negotiate with all of them.",
                "I would give my laundry chair its own postal code.",
                "I would buy a beautiful notebook and be afraid to write in it.",
                "I would tidy my desk by moving everything to a different desk.",
                "I would call finding matching socks a productive morning."
            ]
        case .foodTakes:
            statements = [
                "I would order the same meal after studying the entire menu.",
                "I would bring a backup snack to a picnic full of snacks.",
                "I would judge a hotel by its breakfast potatoes.",
                "I would eat the fancy cheese while waiting for guests.",
                "I would defend dipping fries into a milkshake."
            ]
        case .socialBattery:
            statements = [
                "I would practise my goodbye and still stay another hour.",
                "I would become best friends with the host's cat.",
                "I would need a quiet day after a very fun day.",
                "I would start a group chat just to choose a group chat name.",
                "I would arrive at a party with a detailed exit strategy."
            ]
        case .sideQuests:
            statements = [
                "I would accept a tiny dragon as a flatmate.",
                "I would follow a trail of rubber ducks to see where it ends.",
                "I would join a snail parade as the snail's motivational coach.",
                "I would wear a cape if the weather forecast said mysterious.",
                "I would name a newly discovered planet after my favourite snack."
            ]
        }
        return PromptPack(theme: theme, statements: statements, source: .authored)
    }
}
