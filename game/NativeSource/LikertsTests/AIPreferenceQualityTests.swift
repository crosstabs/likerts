import XCTest
@testable import Likerts

final class AIPreferenceQualityTests: XCTestCase {
    private func references(_ theme: PackTheme, variant: Int = 0) -> [AIPreferenceCatalog.Selection] {
        AIPreferenceCatalog.ideas(for: theme).prefix(5).map { .init(ideaID: $0.id, variantID: variant) }
    }
    private func statements(_ theme: PackTheme) throws -> [String] {
        try AIPreferenceCatalog.render(references(theme), theme: theme)
    }

    func testAllReviewedVariantsAreValidUniqueAndHaveUnambiguousProvenance() throws {
        var texts = Set<String>(), ids = Set<Int>()
        for theme in PackTheme.allCases {
            let ideas = AIPreferenceCatalog.ideas(for: theme)
            XCTAssertEqual(ideas.count, 8)
            for idea in ideas {
                XCTAssertTrue(ids.insert(idea.id).inserted)
                XCTAssertEqual(idea.variants.count, 2)
                for text in idea.variants {
                    XCTAssertTrue(texts.insert(text.lowercased()).inserted)
                    var pack = try statements(theme)
                    // Validate the sentence grammar without implying that two
                    // variants of one idea belong in the same five-take pack.
                    pack[0] = text
                    if Set(pack).count == 5 { XCTAssertNoThrow(try PackValidator.validate(pack)) }
                    XCTAssertTrue(text.hasPrefix("I would "))
                }
            }
        }
        XCTAssertEqual(texts.count, 64)
    }

    func testEveryFiveDistinctIdeasAndVariantCombinationFormsAValidDiversePack() throws {
        var packs = 0
        for theme in PackTheme.allCases {
            let ideas = AIPreferenceCatalog.ideas(for: theme)
            for mask in 0..<(1 << ideas.count) where mask.nonzeroBitCount == 5 {
                let selected = ideas.enumerated().filter { mask & (1 << $0.offset) != 0 }.map(\.element)
                XCTAssertGreaterThanOrEqual(Set(selected.map(\.family)).count, 3)
                XCTAssertGreaterThanOrEqual(Set(selected.map(\.frame)).count, 3)
                for variants in 0..<32 {
                    let refs = selected.enumerated().map { index, idea in
                        AIPreferenceCatalog.Selection(ideaID: idea.id, variantID: variants & (1 << index) == 0 ? 0 : 1)
                    }
                    let text = try AIPreferenceCatalog.render(refs, theme: theme)
                    XCTAssertEqual(text, selected.enumerated().map { $0.element.variants[variants & (1 << $0.offset) == 0 ? 0 : 1] })
                    XCTAssertNoThrow(try AIPreferenceCatalog.validate(text, theme: theme))
                    packs += 1
                }
            }
        }
        XCTAssertEqual(packs, 7_168)
    }

    func testInvalidCountsReferencesVersionsAndCrossThemeSelectionsAreRejected() throws {
        let valid = references(.everydayChaos)
        let invalid: [[AIPreferenceCatalog.Selection]] = [Array(valid.prefix(4)), valid + [valid[0]],
            [.init(ideaID: 999, variantID: 0)] + valid.dropFirst(),
            [.init(ideaID: valid[0].ideaID, variantID: -1)] + valid.dropFirst(),
            [.init(ideaID: valid[0].ideaID, variantID: 2)] + valid.dropFirst(),
            references(.foodTakes)]
        for selection in invalid { XCTAssertThrowsError(try AIPreferenceCatalog.render(selection, theme: .everydayChaos)) }
        XCTAssertThrowsError(try AIPreferenceCatalog.render(valid, theme: .everydayChaos, version: 2))
    }

    func testTwoVariantsOfOneIdeaCannotMasqueradeAsDistinctQuestions() throws {
        let menu = AIPreferenceCatalog.ideas(for: .foodTakes)
        let refs = [AIPreferenceCatalog.Selection(ideaID: menu[0].id, variantID: 0), .init(ideaID: menu[0].id, variantID: 1)] +
            menu.dropFirst().prefix(3).map { .init(ideaID: $0.id, variantID: 0) }
        XCTAssertThrowsError(try AIPreferenceCatalog.render(refs, theme: .foodTakes))
        let raw = [menu[0].variants[0], menu[0].variants[1]] + menu.dropFirst().prefix(3).map { $0.variants[0] }
        XCTAssertNoThrow(try PackValidator.validate(raw))
        XCTAssertThrowsError(try AIPreferenceCatalog.validate(raw, theme: .foodTakes))
    }

    func testExactObservedBadPackAndOtherSelfComparisonsFallBackWithoutRetry() async throws {
        let observed = ["I would rather collect shiny rocks than golden coins.",
                        "I would rather be a mermaid than a mermaid with a tail.",
                        "I would rather fly on a broomstick than a real airplane.",
                        "I would rather swim in a pond than in an ocean.",
                        "I would rather be a snail than a slug."]
        let base = try statements(.sideQuests)
        let degenerates = ["I would choose tea over tea.",
                           "I would choose a blue cup over an identical blue cup.",
                           "I would prefer the same picnic to that very same picnic.",
                           "I would rather eat toast than eat the same toast."]
        for raw in [observed] + degenerates.map({ [$0] + base.dropFirst() }) {
            XCTAssertNoThrow(try PackValidator.validate(raw), "This regression is semantic, not grammar")
            let counter = QualityRetryCounter()
            let result = try await PromptPackService(generator: QualityStub(initial: raw, retries: counter)).make(theme: .sideQuests, availability: .available)
            XCTAssertEqual(result.pack, AuthoredPacks.pack(for: .sideQuests))
            XCTAssertEqual(result.fallbackReason, .qualityNotEstablished)
            XCTAssertTrue(result.fallbackReason?.message.contains("handpicked") == true)
            let retries = await counter.count; XCTAssertEqual(retries, 0)
        }
    }

    func testUsefulReviewedPreferencesAreAcceptedForEveryThemeInExactOrder() async throws {
        for theme in PackTheme.allCases {
            let expected = try AIPreferenceCatalog.render(Array(references(theme, variant: 1).reversed()), theme: theme)
            let result = try await PromptPackService(generator: QualityStub(initial: expected)).make(theme: theme, availability: .available)
            XCTAssertEqual(result.pack.statements, expected)
            XCTAssertEqual(result.pack.source, .onDeviceSelection)
            XCTAssertEqual(result.pack.catalogVersion, 1)
            XCTAssertNil(result.fallbackReason)
        }
    }

    func testUnknownUsefulTextFallsBackConservativelyButCustomSharingKeepsItsGrammar() async throws {
        var text = try statements(.socialBattery)
        text[0] = "I would help choose the music for a picnic."
        XCTAssertNoThrow(try PackValidator.validate(text))
        let result = try await PromptPackService(generator: QualityStub(initial: text)).make(theme: .socialBattery, availability: .available)
        XCTAssertEqual(result.fallbackReason, .qualityNotEstablished)
        let prompts = text.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: "🪩") }
        let custom = try Challenge(name: "Pip", prompts: prompts, answers: [1,2,3,4,5])
        XCTAssertEqual(try ChallengeCodec.decode(ChallengeCodec.encode(custom)), custom)
    }

    func testQualityFailureDuringFormattingRetryRemainsLabelledHandpicked() async throws {
        var malformed = try statements(.everydayChaos); malformed[0] = "Perhaps I would choose a quiet picnic."
        var unknown = try statements(.everydayChaos); unknown[0] = "I would choose tea over tea."
        let result = try await PromptPackService(generator: QualityStub(initial: malformed, replacement: unknown)).make(theme: .everydayChaos, availability: .available)
        XCTAssertEqual(result.fallbackReason, .qualityNotEstablished)
        XCTAssertEqual(result.pack.source, .authored)
    }

    func testSnapshotPreservesLegacySourceAndValidatesNewVersionedSelection() throws {
        let theme = PackTheme.sideQuests
        let selected = try statements(theme)
        func snapshot(_ text: [String], source: String, version: Int?) -> StandaloneGameSnapshot {
            StandaloneGameSnapshot(phase: "answering", name: "Pip",
                prompts: text.enumerated().map { Prompt(id: 201 + $0.offset, text: $0.element, emoji: theme.emoji) },
                packTheme: theme.rawValue, packSource: source, packCatalogVersion: version,
                topic: nil, dailyKey: nil, challengeCode: nil,
                answers: [4,nil,nil,nil,nil], guesses: Array(repeating: nil, count: 5), index: 0, revealed: false)
        }
        let fresh = snapshot(selected, source: "onDeviceSelection", version: 1)
        let roundtrip = try JSONDecoder().decode(StandaloneGameSnapshot.self, from: JSONEncoder().encode(fresh))
        XCTAssertEqual(try roundtrip.validate().pack?.source, .onDeviceSelection)
        XCTAssertEqual(try roundtrip.validate().pack?.statements, selected)
        XCTAssertThrowsError(try snapshot(selected, source: "onDeviceSelection", version: nil).validate())
        XCTAssertThrowsError(try snapshot(selected, source: "onDeviceSelection", version: 2).validate())
        var oldText = selected; oldText[0] = "I would rather be a mermaid than a mermaid with a tail."
        let legacy = snapshot(oldText, source: "onDeviceAI", version: nil)
        XCTAssertEqual(try legacy.validate().pack?.source, .onDeviceAI)
        XCTAssertEqual(try legacy.validate().pack?.statements, oldText)
        XCTAssertEqual(try legacy.validate().pack?.source.title, "Made on your device")
        XCTAssertThrowsError(try snapshot(oldText, source: "onDeviceSelection", version: 1).validate())
        XCTAssertThrowsError(try snapshot(selected, source: "authored", version: 1).validate())
    }
}

private actor QualityRetryCounter { var count = 0; func record() { count += 1 } }
private struct QualityStub: PromptPackGenerating {
    let initial: [String]
    var replacement: [String] = []
    var retries: QualityRetryCounter? = nil
    func generate(theme: PackTheme) async throws -> [String] { initial }
    func retryFormatting(theme: PackTheme) async throws -> [String] {
        await retries?.record(); return replacement
    }
}
