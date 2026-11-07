#if canImport(UIKit)
import XCTest
@testable import Likerts

@MainActor final class AISelectionPersistenceTests: XCTestCase {
    func testReviewedSelectionSavesEveryPhaseAndSharesExactNeutralCustomContent() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let suite = "studio.likerts.ai-selection.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { try? FileManager.default.removeItem(at: folder); defaults.removePersistentDomain(forName: suite) }
        let url = folder.appendingPathComponent("game.json")
        let store = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
        let menu = AIPreferenceCatalog.ideas(for: .foodTakes)
        let selections = [7,1,3,0,6].enumerated().map { index, slot in
            AIPreferenceCatalog.Selection(ideaID: menu[slot].id, variantID: index % 2)
        }
        let text = try AIPreferenceCatalog.render(selections, theme: .foodTakes)
        let pack = PromptPack(theme: .foodTakes, statements: text, source: .onDeviceSelection, catalogVersion: 1)
        var game = GameSession(name: "Pip", pack: pack)
        func reload() throws {
            XCTAssertTrue(store.save(game.snapshot))
            let reopened = StandaloneGameStore(fileURL: url, defaults: defaults, tombstoneKey: "cleared")
            let saved = try XCTUnwrap(reopened.load())
            XCTAssertEqual(saved.packSource, "onDeviceSelection"); XCTAssertEqual(saved.packCatalogVersion, 1)
            game = try XCTUnwrap(GameSession(snapshot: saved))
            XCTAssertEqual(game.pack, pack); XCTAssertEqual(game.prompts.map(\.text), text)
            XCTAssertTrue(game.packLabel?.contains("AI-picked on your device") == true)
        }
        try reload()
        let answers = [1,2,3,4,5]
        for answer in answers {
            game.onSnapshot = { XCTAssertTrue(store.save($0)) }
            game.select(answer)
            XCTAssertEqual(store.load()?.packCatalogVersion, 1)
            try reload(); XCTAssertEqual(game.selection, answer)
            game.next(); try reload()
        }
        XCTAssertEqual(game.phase, .sealed)
        let code = ChallengeCodec.encode(try XCTUnwrap(game.challenge))
        XCTAssertTrue(code.hasPrefix("LK2-"))
        let imported = GameSession(challenge: try ChallengeCodec.decode(code))
        XCTAssertEqual(imported.prompts, game.prompts)
        XCTAssertEqual(imported.challenge?.answers, answers)
        XCTAssertNil(imported.pack)
        XCTAssertEqual(imported.packLabel, "Friend's custom pack", "A shared code is not trusted AI provenance")
        game.beginGuessing(); try reload()
        for answer in answers {
            XCTAssertFalse(game.revealed)
            game.select(answer); try reload(); XCTAssertFalse(game.revealed)
            game.next(); try reload(); XCTAssertTrue(game.revealed)
            game.next(); try reload()
        }
        XCTAssertEqual(game.phase, .result); XCTAssertEqual(game.score, 100)
    }

    func testExistingFreeWrittenAISaveKeepsItsTextAndOriginalProvenance() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let suite = "studio.likerts.legacy-ai.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { try? FileManager.default.removeItem(at: folder); defaults.removePersistentDomain(forName: suite) }
        var text = AuthoredPacks.pack(for: .sideQuests).statements
        text[0] = "I would rather be a mermaid than a mermaid with a tail."
        let old = PromptPack(theme: .sideQuests, statements: text, source: .onDeviceAI)
        let game = GameSession(name: "Pip", pack: old); game.select(4)
        let store = StandaloneGameStore(fileURL: folder.appendingPathComponent("game.json"), defaults: defaults, tombstoneKey: "cleared")
        XCTAssertTrue(store.save(game.snapshot))
        let restored = try XCTUnwrap(GameSession(snapshot: try XCTUnwrap(store.load())))
        XCTAssertEqual(restored.pack, old); XCTAssertEqual(restored.selection, 4)
        XCTAssertNil(restored.pack?.catalogVersion)
        XCTAssertEqual(restored.pack?.source, .onDeviceAI)
        XCTAssertFalse(restored.packLabel?.contains("AI-picked") == true)
    }
}
#endif
