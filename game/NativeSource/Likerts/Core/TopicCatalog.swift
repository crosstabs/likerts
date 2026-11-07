import Foundation

enum TopicID: String, CaseIterable, Codable, Sendable, Identifiable {
    case snacks, kitchen, pets, outdoors, travel, home, hobbies, music, movies, books
    case social, games, style, celebrations, weather, mornings, making, tinyadventures, fantasy, future

    var id: String { rawValue }
    var definition: TopicDefinition { TopicDefinition.all[ordinal] }
    var ordinal: Int { Self.allCases.firstIndex(of: self) ?? 0 }
}

struct TopicDefinition: Equatable, Sendable, Identifiable {
    let id: TopicID
    let title: String
    let summary: String
    let symbol: String
    let props: [String]
    var ordinal: Int { id.ordinal }

    static let all: [TopicDefinition] = [
        .init(id: .snacks, title: "Snack logic", summary: "Tiny bites. Very big opinions.", symbol: "carrot", props: ["cookie", "popcorn", "pretzel", "bento", "icecream", "fruit"]),
        .init(id: .kitchen, title: "Kitchen chaos", summary: "The most personal room in the house.", symbol: "frying.pan", props: ["kettle", "toaster", "spatula", "pancakes", "mixingbowl", "teapot"]),
        .init(id: .pets, title: "Pet people", summary: "Small companions with main-character energy.", symbol: "pawprint", props: ["dog", "cat", "rabbit", "turtle", "fish", "bird"]),
        .init(id: .outdoors, title: "Outside voices", summary: "Fresh air and extremely prepared backpacks.", symbol: "tent", props: ["tent", "lantern", "boots", "compass", "tree", "campmug"]),
        .init(id: .travel, title: "Away we go", summary: "Packing habits and detour instincts.", symbol: "suitcase", props: ["suitcase", "map", "camera", "train", "sunhat", "postcard"]),
        .init(id: .home, title: "Home comforts", summary: "Your kingdom of cushions and tiny rituals.", symbol: "house", props: ["sofa", "lamp", "plant", "slippers", "pillow", "clock"]),
        .init(id: .hobbies, title: "Hobby spiral", summary: "Supplies first. Masterpiece eventually.", symbol: "paintpalette", props: ["paintbrush", "yarn", "puzzle", "clay", "camera", "sketchbook"]),
        .init(id: .music, title: "Sound opinions", summary: "Big feelings about little playlists.", symbol: "music.note", props: ["headphones", "microphone", "guitar", "piano", "record", "drum"]),
        .init(id: .movies, title: "Movie night", summary: "The feature presentation is choosing a film.", symbol: "film", props: ["clapperboard", "popcorn", "ticket", "projector", "sofa", "filmreel"]),
        .init(id: .books, title: "One more chapter", summary: "Bookmarks, borrowed worlds and bedtime deals.", symbol: "books.vertical", props: ["novel", "bookmark", "booklamp", "teacup", "glasses", "bookstack"]),
        .init(id: .social, title: "Social battery", summary: "Come in, hang out, rehearse your goodbye.", symbol: "bubble.left.and.bubble.right", props: ["invitation", "doormat", "teacup", "chair", "balloon", "conversation"]),
        .init(id: .games, title: "Friendly rivalry", summary: "House rules and suspiciously lucky dice.", symbol: "dice", props: ["dice", "controller", "chesspiece", "puzzle", "trophy", "cards"]),
        .init(id: .style, title: "Personal style", summary: "Outfits with a very specific agenda.", symbol: "tshirt", props: ["sneaker", "scarf", "sunglasses", "cap", "backpack", "socks"]),
        .init(id: .celebrations, title: "Make a moment", summary: "Cake, surprises and wrapping-paper diplomacy.", symbol: "gift", props: ["cake", "gift", "confetti", "partyhat", "candle", "ribbon"]),
        .init(id: .weather, title: "Forecast feelings", summary: "Small talk with strong seasonal opinions.", symbol: "cloud.sun", props: ["umbrella", "rainboot", "sun", "cloud", "scarf", "snowflake"]),
        .init(id: .mornings, title: "Morning person?", summary: "Negotiations with the start of the day.", symbol: "sunrise", props: ["alarm", "mug", "toast", "toothbrush", "slippers", "sunrise"]),
        .init(id: .making, title: "Made by me", summary: "Creative confidence, held together with tape.", symbol: "scissors", props: ["tape", "scissors", "glue", "cardboard", "buttons", "pencil"]),
        .init(id: .tinyadventures, title: "Tiny adventures", summary: "An ordinary afternoon with a side quest.", symbol: "bicycle", props: ["bike", "kite", "duck", "binoculars", "picnic", "pebble"]),
        .init(id: .fantasy, title: "Little legends", summary: "Magical problems with very practical answers.", symbol: "wand.and.stars", props: ["dragon", "castle", "wand", "treasure", "mushroom", "cloud"]),
        .init(id: .future, title: "Future you", summary: "Tomorrow's gadgets. Today's peculiar habits.", symbol: "sparkles", props: ["robot", "rocket", "planet", "hoverboard", "antenna", "star"])
    ]
}

enum SceneRelation: String, CaseIterable, Codable, Sendable {
    case inspect, offer, balance, stack, hide, share, choose, carry, orbit, build
}

struct TopicScene: Hashable, Codable, Sendable {
    let primary: String
    let secondary: String
    let relation: SceneRelation
    /// Ignores character, colour and placement: these cannot inflate scene counts.
    var compositionKey: String { "\(relation.rawValue):\(primary)>\(secondary)" }
}

struct TopicRound: Identifiable, Hashable, Codable, Sendable {
    let id: Int
    let topic: TopicID
    let text: String
    let scene: TopicScene
    let sceneSummary: String
    var sceneKey: String { "\(topic.rawValue):\(scene.compositionKey)" }
    var prompt: Prompt { Prompt(id: id, text: text, emoji: "✨") }
}

enum TopicCatalogError: Error, Equatable, LocalizedError {
    case missingResource(String)
    case invalidJSON(String)
    case wrongCount(topic: String, expected: Int, actual: Int)
    case invalidID(Int)
    case duplicateID(Int)
    case duplicateStatement(Int, Int)
    case invalidStatement(Int)
    case invalidScene(Int)
    case duplicateScene(Int, Int)
    case invalidSummary(Int)

    var errorDescription: String? {
        switch self {
        case .missingResource(let name): return "The \(name) topic is missing from this copy of Likerts."
        case .invalidJSON(let name): return "The \(name) topic could not be read."
        case .wrongCount(let topic, let expected, let actual): return "The \(topic) topic has \(actual) rounds; expected \(expected)."
        case .invalidID(let id): return "Topic round \(id) has an invalid identifier."
        case .duplicateID(let id): return "Topic round \(id) is repeated."
        case .duplicateStatement(let first, let second): return "Topic rounds \(first) and \(second) repeat a statement."
        case .invalidStatement(let id): return "Topic round \(id) failed the content checks."
        case .invalidScene(let id): return "Topic round \(id) references an unknown illustration prop."
        case .duplicateScene(let first, let second): return "Topic rounds \(first) and \(second) repeat a composition."
        case .invalidSummary(let id): return "Topic round \(id) needs a readable scene description."
        }
    }
}

struct TopicNearDuplicate: Equatable, Sendable {
    let firstID: Int
    let secondID: Int
    let similarity: Double
}

struct TopicCatalog: Sendable {
    static let roundsPerTopic = 50
    let allRounds: [TopicRound]
    private let byID: [Int: TopicRound]
    private let byTopic: [TopicID: [TopicRound]]

    /// Loaded and validated once, including in the Messages extension process.
    /// A damaged/missing bundle produces a recoverable error, never a partial catalog.
    static let bundled: Result<TopicCatalog, TopicCatalogError> = loadBundled()

    init(validating rounds: [TopicRound], requiredTopics: [TopicID] = TopicID.allCases,
         expectedRoundsPerTopic: Int = TopicCatalog.roundsPerTopic) throws {
        let sorted = rounds.sorted { $0.id < $1.id }
        var ids = Set<Int>()
        var statements: [String: Int] = [:]
        var scenes: [String: Int] = [:]
        let required = Set(requiredTopics)
        for round in sorted {
            let lowerID = 1001 + round.topic.ordinal * Self.roundsPerTopic
            guard required.contains(round.topic), (lowerID..<(lowerID + Self.roundsPerTopic)).contains(round.id) else {
                throw TopicCatalogError.invalidID(round.id)
            }
            guard ids.insert(round.id).inserted else { throw TopicCatalogError.duplicateID(round.id) }
            let key = Self.normalizedStatement(round.text)
            if let first = statements[key] { throw TopicCatalogError.duplicateStatement(first, round.id) }
            statements[key] = round.id
            let validProps = Set(round.topic.definition.props)
            guard validProps.contains(round.scene.primary), validProps.contains(round.scene.secondary),
                  round.scene.primary != round.scene.secondary else { throw TopicCatalogError.invalidScene(round.id) }
            if let first = scenes[round.sceneKey] { throw TopicCatalogError.duplicateScene(first, round.id) }
            scenes[round.sceneKey] = round.id
            guard (12...240).contains(round.sceneSummary.count),
                  !round.sceneSummary.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
                throw TopicCatalogError.invalidSummary(round.id)
            }
        }
        let grouped = Dictionary(grouping: sorted, by: \.topic)
        for topic in requiredTopics {
            let topicRounds = grouped[topic] ?? []
            guard topicRounds.count == expectedRoundsPerTopic else {
                throw TopicCatalogError.wrongCount(topic: topic.rawValue, expected: expectedRoundsPerTopic, actual: topicRounds.count)
            }
        }
        // Reuse shared/AI safety checks on real batches. Fixtures with fewer
        // than five records are padded with distinct harmless statements.
        for start in stride(from: 0, to: sorted.count, by: 5) {
            let batch = Array(sorted[start..<min(start + 5, sorted.count)])
            var statements = batch.map(\.text)
            let companions = [
                "I would keep a tiny collection of smooth pebbles.",
                "I would give a cardboard castle a grand opening.",
                "I would practise a victory bow for a friendly puzzle.",
                "I would choose a picnic blanket with enormous pockets.",
                "I would reserve a sunny seat for my favourite cushion."
            ]
            for companion in companions where statements.count < 5 {
                if !statements.contains(where: { Self.normalizedStatement($0) == Self.normalizedStatement(companion) }) {
                    statements.append(companion)
                }
            }
            guard (try? PackValidator.validate(statements)) == statements else {
                // Find the failing record for a useful development diagnostic.
                let failed = batch.first { round in
                    let others = companions.filter { Self.normalizedStatement($0) != Self.normalizedStatement(round.text) }
                    return (try? PackValidator.validate([round.text] + Array(others.prefix(4)))) == nil
                } ?? batch[0]
                throw TopicCatalogError.invalidStatement(failed.id)
            }
            if let failed = batch.first(where: { !(25...115).contains($0.text.count) }) {
                throw TopicCatalogError.invalidStatement(failed.id)
            }
        }
        self.allRounds = sorted
        self.byID = Dictionary(uniqueKeysWithValues: sorted.map { ($0.id, $0) })
        self.byTopic = grouped
    }

    func round(id: Int) -> TopicRound? { byID[id] }
    func rounds(for topic: TopicID) -> [TopicRound] { byTopic[topic] ?? [] }

    static func normalizedStatement(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// An editorial audit signal, not a claim of semantic uniqueness or a full
    /// language review. Short shared phrases alone do not make a duplicate.
    func nearDuplicates(threshold: Double = 0.8) -> [TopicNearDuplicate] {
        let ignored: Set<String> = ["i", "a", "an", "the", "would", "my", "to", "and", "of", "for", "in", "with", "than", "it", "is", "be", "on"]
        let tokens = allRounds.map { Set(Self.normalizedStatement($0.text).split(separator: " ").map(String.init)).subtracting(ignored) }
        var pairs: [TopicNearDuplicate] = []
        guard allRounds.count > 1 else { return pairs }
        for first in 0..<(allRounds.count - 1) {
            for second in (first + 1)..<allRounds.count {
                let union = tokens[first].union(tokens[second])
                guard union.count >= 5 else { continue }
                let similarity = Double(tokens[first].intersection(tokens[second]).count) / Double(union.count)
                if similarity >= threshold {
                    pairs.append(.init(firstID: allRounds[first].id, secondID: allRounds[second].id, similarity: similarity))
                }
            }
        }
        return pairs
    }

    static func decodeTopic(_ data: Data, expectedTopic: TopicID) throws -> [TopicRound] {
        guard data.count <= 256_000 else { throw TopicCatalogError.invalidJSON(expectedTopic.rawValue) }
        let records: [TopicRound]
        do { records = try JSONDecoder().decode([TopicRound].self, from: data) }
        catch { throw TopicCatalogError.invalidJSON(expectedTopic.rawValue) }
        guard records.count <= roundsPerTopic, records.allSatisfy({ $0.topic == expectedTopic }) else {
            throw TopicCatalogError.invalidJSON(expectedTopic.rawValue)
        }
        return records
    }

    static func loadBundled() -> Result<TopicCatalog, TopicCatalogError> {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        do {
            var rounds: [TopicRound] = []
            for topic in TopicID.allCases {
                guard let url = bundle.url(forResource: topic.rawValue, withExtension: "json", subdirectory: "TopicData")
                    ?? bundle.url(forResource: topic.rawValue, withExtension: "json") else {
                    throw TopicCatalogError.missingResource(topic.rawValue)
                }
                let data: Data
                do { data = try Data(contentsOf: url, options: .mappedIfSafe) }
                catch { throw TopicCatalogError.invalidJSON(topic.rawValue) }
                rounds += try decodeTopic(data, expectedTopic: topic)
            }
            return .success(try TopicCatalog(validating: rounds))
        } catch let error as TopicCatalogError { return .failure(error) }
        catch { return .failure(.invalidJSON("all")) }
    }
}
