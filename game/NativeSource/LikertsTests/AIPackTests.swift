import XCTest
@testable import Likerts

final class AIPackTests: XCTestCase {
    private var valid: [String] { AuthoredPacks.pack(for: .everydayChaos).statements }
    private func reviewed(_ theme: PackTheme) throws -> [String] {
        try AIPreferenceCatalog.render(AIPreferenceCatalog.ideas(for: theme).prefix(5).map {
            .init(ideaID: $0.id, variantID: 0)
        }, theme: theme)
    }

    private var biographies: [String] { [
        "I am the gardener who built a castle out of flowers.",
        "I am the librarian who invented a machine that turns books into candy.",
        "I am the inventor who created a gadget that plays music with your emotions.",
        "I am the artist who painted a portrait of a unicorn that sings opera.",
        "I am the chef who baked a tower of tiny cakes."
    ] }

    func testGeneratedBiographiesFallBackWithoutSemanticFormattingRetry() async throws {
        let source = biographies, calls = CallCounter(), repaired = valid
        let service = PromptPackService(generator: RetryStub(initial: { source }, retry: { await calls.increment(); return repaired }))
        let result = try await service.make(theme: .sideQuests, availability: .available)
        XCTAssertEqual(result.pack, AuthoredPacks.pack(for: .sideQuests))
        XCTAssertEqual(result.fallbackReason, .invalidGeneration)
        let retries = await calls.value; XCTAssertEqual(retries, 0)
    }

    func testGeneratedHypotheticalCombatFallsBackWithoutRetry() async throws {
        var statements = valid
        statements[0] = "I would fight a dragon over the last cookie."
        let source = statements, calls = CallCounter(), repaired = valid
        let service = PromptPackService(generator: RetryStub(initial: { source }, retry: { await calls.increment(); return repaired }))
        let result = try await service.make(theme: .sideQuests, availability: .available)
        XCTAssertEqual(result.pack.source, .authored); XCTAssertEqual(result.fallbackReason, .invalidGeneration)
        let retries = await calls.value; XCTAssertEqual(retries, 0)
    }

    func testGeneratedPreferenceContractDoesNotNarrowExistingCustomWireGrammar() throws {
        XCTAssertEqual(try PackValidator.validate(biographies), biographies)
        let prompts = biographies.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: "🌷") }
        let challenge = try Challenge(name: "Pip", prompts: prompts, answers: [1,2,3,4,5])
        XCTAssertEqual(try ChallengeCodec.decode(ChallengeCodec.encode(challenge)), challenge)
    }

    func testEveryAuthoredThemeContainsFiveValidDistinctTakes() throws {
        for theme in PackTheme.allCases {
            let pack = AuthoredPacks.pack(for: theme)
            XCTAssertEqual(pack.theme, theme)
            XCTAssertEqual(pack.source, .authored)
            XCTAssertEqual(try PackValidator.validate(pack.statements), pack.statements)
            XCTAssertFalse(theme.title.isEmpty)
            XCTAssertFalse(theme.summary.isEmpty)
            XCTAssertFalse(theme.emoji.isEmpty)
        }
    }

    func testValidatorNormalizesSpacesWithoutChangingMeaning() throws {
        var statements = valid
        statements[0] = "  I   would set three alarms and negotiate with all of them.  "
        XCTAssertEqual(try PackValidator.validate(statements)[0], valid[0])
    }

    func testValidatorRejectsWrongCount() {
        XCTAssertThrowsError(try PackValidator.validate(Array(valid.prefix(4))))
        XCTAssertThrowsError(try PackValidator.validate(valid + [valid[0]]))
    }

    func testValidatorRejectsDuplicatePunctuationAndCaseVariants() {
        var statements = valid
        statements[1] = statements[0]
        XCTAssertThrowsError(try PackValidator.validate(statements)) { error in
            XCTAssertEqual(error as? PackValidationError, .duplicateStatements)
        }
        statements[1] = "I would set THREE alarms and negotiate with all of them."
        XCTAssertThrowsError(try PackValidator.validate(statements))
    }

    func testValidatorRejectsEmptyLongMultilineAndControlText() {
        for malformed in ["", "I am.", "I " + String(repeating: "a", count: 118) + ".", "I would make\na very fluffy pancake.", "I would make\ta very fluffy pancake.", "I would make a very fluffy pancake.\u{200E}"] {
            var statements = valid
            statements[0] = malformed
            XCTAssertThrowsError(try PackValidator.validate(statements), malformed)
        }
    }

    func testValidatorRejectsQuestionsMetadataAndMultipleSentences() {
        for malformed in ["Would you adopt a tiny dragon?", "I would adopt a tiny dragon?", "I would adopt a dragon. It likes snacks.", "1. I would adopt a tiny dragon.", "As an AI I can make funny game prompts."] {
            var statements = valid
            statements[0] = malformed
            XCTAssertThrowsError(try PackValidator.validate(statements), malformed)
        }
    }

    func testValidatorRejectsSensitiveTermsAndContactDetails() {
        for malformed in ["I would share my password with a friendly dragon.", "I would bring a weapon to a picnic.", "I would ask strangers for medical advice.", "I would use drugs during my next adventure.", "I would email hello@example for free snacks.", "I would choose locker number 123456 for my snacks.", "I would post my favourite snack with #snack."] {
            var statements = valid
            statements[0] = malformed
            XCTAssertThrowsError(try PackValidator.validate(statements), malformed)
        }
    }

    #if DEBUG
    func testOptInDiagnosticsClassifyInvalidOutputWithoutReturningItsText() {
        let samples: [(String, String)] = [
            ("I would bring a tiny cake", "endingPeriod"),
            ("Maybe I would bring a tiny cake.", "firstPersonPrefix"),
            ("I would bring cake. And fruit.", "sentencePunctuation"),
            ("I would bring\na tiny cake.", "controlOrNewline"),
            ("I would send cake to person@example.", "contactOrMetadata")
        ]
        for (statement, expected) in samples {
            var pack = valid; pack[0] = statement
            XCTAssertThrowsError(try PackValidator.validate(pack)) { error in
                XCTAssertEqual(error as? PackValidationError, .invalidStatement)
                let result = PackValidator.diagnostic(for: pack, error: .invalidStatement)
                XCTAssertEqual(result, expected)
                XCTAssertFalse(result.contains(statement))
            }
        }
        XCTAssertEqual(PackValidator.diagnostic(for: [], error: .wrongCount), "wrongCount")
        XCTAssertEqual(PackValidator.diagnostic(for: valid, error: .sensitiveContent), "sensitiveContent")
        XCTAssertEqual(PackValidator.diagnostic(for: valid, error: .duplicateStatements), "duplicateStatements")
    }
    #endif

    func testValidatorRejectsObservedHazardousGeneratedStatements() {
        let hazards = [
            "I once tried to climb a tree and ended up falling down with a bunch of grapes stuck to my shirt.",
            "I have a secret talent for playing the xylophone while juggling flaming torches.",
            "I would try juggling fire at a garden party.",
            "I would laugh if I fell off a tall ladder."
        ]
        for statement in hazards {
            var pack = valid; pack[0] = statement
            XCTAssertThrowsError(try PackValidator.validate(pack), statement) { error in
                XCTAssertEqual(error as? PackValidationError, .sensitiveContent)
            }
        }
        for statement in ["I would watch falling leaves while drinking cocoa.",
                          "I quietly fix a decoration that keeps falling down during the celebration.",
                          "I would pretend to juggle a pile of rubber ducks.",
                          "I would visit a fire station on a school trip."] {
            var harmless = valid
            harmless[0] = statement
            XCTAssertNoThrow(try PackValidator.validate(harmless))
        }
    }

    func testInjectedSuccessfulGenerationIsValidatedAndSourceTagged() async throws {
        let expected = try reviewed(.everydayChaos)
        let service = PromptPackService(generator: StubGenerator { expected })
        let result = try await service.make(theme: .everydayChaos, availability: .available)
        XCTAssertEqual(result.pack.statements, expected)
        XCTAssertEqual(result.pack.source, .onDeviceSelection)
        XCTAssertEqual(result.pack.catalogVersion, 1)
        XCTAssertNil(result.fallbackReason)
    }

    func testUnavailableModelSkipsGeneratorAndLabelsAuthoredFallback() async throws {
        let counter = CallCounter()
        let service = PromptPackService(generator: StubGenerator {
            await counter.increment()
            throw TestFailure()
        })
        let reasons: [PackAvailability] = [.requiresIOS26, .deviceNotEligible, .appleIntelligenceDisabled, .modelNotReady, .unsupportedLanguage, .unavailable]
        for reason in reasons {
            let result = try await service.make(theme: .foodTakes, availability: reason)
            XCTAssertEqual(result.pack, AuthoredPacks.pack(for: .foodTakes))
            XCTAssertEqual(result.fallbackReason, .modelUnavailable(reason))
            XCTAssertFalse(reason.canGenerate)
            XCTAssertFalse(reason.title.isEmpty)
            XCTAssertFalse(reason.detail.isEmpty)
        }
        let calls = await counter.value
        XCTAssertEqual(calls, 0)
        XCTAssertTrue(PackAvailability.available.canGenerate)
    }

    func testGuardrailFailureHasHonestAuthoredFallback() async throws {
        let service = PromptPackService(generator: StubGenerator { throw PackGenerationError.safetyBlocked })
        let result = try await service.make(theme: .socialBattery, availability: .available)
        XCTAssertEqual(result.pack.source, .authored)
        XCTAssertEqual(result.fallbackReason, .modelDeclined)
        XCTAssertEqual(result.pack.statements, AuthoredPacks.pack(for: .socialBattery).statements)
    }

    func testAvailabilityChangeDuringGenerationUsesAuthoredFallback() async throws {
        let service = PromptPackService(generator: StubGenerator { throw PackGenerationError.unavailable(.modelNotReady) })
        let result = try await service.make(theme: .sideQuests, availability: .available)
        XCTAssertEqual(result.pack.source, .authored)
        XCTAssertEqual(result.fallbackReason, .modelUnavailable(.modelNotReady))
    }

    func testMalformedGenerationUsesAuthoredFallback() async throws {
        let service = PromptPackService(generator: StubGenerator { ["Nope"] })
        let result = try await service.make(theme: .everydayChaos, availability: .available)
        XCTAssertEqual(result.pack.source, .authored)
        XCTAssertEqual(result.fallbackReason, .invalidGeneration)
    }

    func testFormatFailureRetriesOnceWithValidatedResult() async throws {
        var malformed = valid; malformed[0] = "Perhaps I would bring a tiny dragon."
        let original = malformed, expected = try reviewed(.sideQuests), calls = CallCounter()
        let generator = RetryStub(initial: { original }, retry: { await calls.increment(); return expected })
        let result = try await PromptPackService(generator: generator).make(theme: .sideQuests, availability: .available)
        XCTAssertEqual(result.pack.source, .onDeviceSelection)
        XCTAssertEqual(result.pack.statements, expected)
        let count = await calls.value
        XCTAssertEqual(count, 1)
    }

    func testFormatFailureDoesNotRetryIfAnotherItemIsUnsafe() async throws {
        var malformed = valid
        malformed[0] = "Perhaps I would bring a tiny dragon."
        malformed[1] = "I would juggle flaming torches while singing."
        let original = malformed, expected = valid, calls = CallCounter()
        let generator = RetryStub(initial: { original }, retry: { await calls.increment(); return expected })
        let result = try await PromptPackService(generator: generator).make(theme: .sideQuests, availability: .available)
        XCTAssertEqual(result.pack.source, .authored)
        XCTAssertEqual(result.fallbackReason, .invalidGeneration)
        let count = await calls.value
        XCTAssertEqual(count, 0)
    }

    func testFormatRetryNeverAcceptsUnsafeOrRepeatedInvalidOutput() async throws {
        var malformed = valid; malformed[0] = "Perhaps I would bring a tiny dragon."
        let original = malformed
        let unsafe = ["I would juggle flaming torches for a cheering crowd."] + Array(valid.dropFirst())
        for retry in [unsafe, original] {
            let calls = CallCounter()
            let generator = RetryStub(initial: { original }, retry: { await calls.increment(); return retry })
            let result = try await PromptPackService(generator: generator).make(theme: .sideQuests, availability: .available)
            XCTAssertEqual(result.pack.source, .authored)
            XCTAssertEqual(result.fallbackReason, .invalidGeneration)
            let count = await calls.value
        XCTAssertEqual(count, 1)
        }
    }

    func testGuardrailRejectionDuringRetryUsesDeclinedFallbackWithoutAnotherAttempt() async throws {
        var malformed = valid; malformed[0] = "Perhaps I would bring a tiny dragon."
        let original = malformed, calls = CallCounter()
        let generator = RetryStub(initial: { original }, retry: { await calls.increment(); throw PackGenerationError.safetyBlocked })
        let result = try await PromptPackService(generator: generator).make(theme: .sideQuests, availability: .available)
        let count = await calls.value
        XCTAssertEqual(count, 1)
        XCTAssertEqual(result.pack.source, .authored)
        XCTAssertEqual(result.fallbackReason, .modelDeclined)
    }

    func testFormatRetryTimeoutReturnsAuthoredFallback() async throws {
        var malformed = valid; malformed[0] = "Perhaps I would bring a tiny dragon."
        let original = malformed, expected = valid
        let generator = RetryStub(initial: { original }, retry: {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            return expected
        })
        let result = try await PromptPackService(generator: generator, retryTimeoutNanoseconds: 20_000_000).make(theme: .sideQuests, availability: .available)
        XCTAssertEqual(result.pack.source, .authored)
        XCTAssertEqual(result.fallbackReason, .invalidGeneration)
    }

    func testSafetyRejectionAndUnavailableNeverRetry() async throws {
        let calls = CallCounter(), expected = valid
        let generator = RetryStub(initial: { throw PackGenerationError.safetyBlocked }, retry: { await calls.increment(); return expected })
        let service = PromptPackService(generator: generator)
        let declined = try await service.make(theme: .foodTakes, availability: .available)
        let unavailable = try await service.make(theme: .foodTakes, availability: .deviceNotEligible)
        XCTAssertEqual(declined.fallbackReason, .modelDeclined)
        XCTAssertEqual(unavailable.fallbackReason, .modelUnavailable(.deviceNotEligible))
        let count = await calls.value
        XCTAssertEqual(count, 0)
    }

    func testCancellationDuringFormatRetryIsNotFallback() async {
        var malformed = valid; malformed[0] = "Perhaps I would bring a tiny dragon."
        let original = malformed
        let generator = RetryStub(initial: { original }, retry: { throw CancellationError() })
        do {
            _ = try await PromptPackService(generator: generator).make(theme: .foodTakes, availability: .available)
            XCTFail("Cancellation must propagate")
        } catch { XCTAssertTrue(error is CancellationError) }
    }

    func testOtherGenerationFailureUsesAuthoredFallback() async throws {
        let service = PromptPackService(generator: StubGenerator { throw TestFailure() })
        let result = try await service.make(theme: .everydayChaos, availability: .available)
        XCTAssertEqual(result.pack.source, .authored)
        XCTAssertEqual(result.fallbackReason, .generationFailed)
    }

    func testGeneratorCancellationIsNotDisguisedAsFallback() async {
        let service = PromptPackService(generator: StubGenerator { throw CancellationError() })
        do {
            _ = try await service.make(theme: .foodTakes, availability: .available)
            XCTFail("Cancellation must propagate")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
    }

    func testAlreadyCancelledTaskDoesNotReturnFallback() async {
        let service = PromptPackService(generator: StubGenerator { throw TestFailure() })
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await service.make(theme: .foodTakes, availability: .deviceNotEligible)
        }
        do {
            _ = try await task.value
            XCTFail("Cancellation must propagate even when the model is unavailable")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
    }

    func testLateGeneratedResultCannotEscapeCancellation() async {
        let expected = valid
        let service = PromptPackService(generator: StubGenerator {
            withUnsafeCurrentTask { $0?.cancel() }
            return expected
        })
        do {
            _ = try await service.make(theme: .foodTakes, availability: .available)
            XCTFail("A late generation must not start a game after cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
    }
}

private struct StubGenerator: PromptPackGenerating {
    let operation: @Sendable () async throws -> [String]
    init(_ operation: @escaping @Sendable () async throws -> [String]) { self.operation = operation }
    func generate(theme: PackTheme) async throws -> [String] { try await operation() }
}

private struct TestFailure: Error {}
private actor CallCounter {
    var value = 0
    func increment() { value += 1 }
}

private struct RetryStub: PromptPackGenerating {
    let initial: @Sendable () async throws -> [String]
    let retry: @Sendable () async throws -> [String]
    func generate(theme: PackTheme) async throws -> [String] { try await initial() }
    func retryFormatting(theme: PackTheme) async throws -> [String] { try await retry() }
}
