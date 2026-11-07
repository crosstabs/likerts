import Foundation

/// One topic-sized transaction; no partially decoded catalogue is exposed to play.
struct MotionProductionTopicFile: Codable, Sendable {
    let schemaVersion: Int
    let topic: TopicID
    let performances: [ScenePerformance]
    init(schemaVersion: Int = 1, topic: TopicID, performances: [ScenePerformance]) {
        self.schemaVersion = schemaVersion; self.topic = topic; self.performances = performances
    }
}

enum MotionProductionError: Error, Equatable, LocalizedError {
    case missingTopic(String), oversizedTopic(String), invalidJSON(String), unsupportedVersion(String)
    case topicMismatch(String), topicCoverage(String), catalogueCoverage, rendererMismatch(Int)
    case invalidPerformance(Int, MotionValidationError), unavailableRegistry, unavailableQuestions

    var errorDescription: String? {
        switch self {
        case .missingTopic(let value): return "The motion catalogue is missing performance-\(value).json."
        case .oversizedTopic(let value): return "The \(value) motion file exceeds its data budget."
        case .invalidJSON(let value): return "The \(value) motion file could not be decoded."
        case .unsupportedVersion(let value): return "The \(value) motion file uses an unsupported schema."
        case .topicMismatch(let value): return "The \(value) motion file declares a different topic."
        case .topicCoverage(let value): return "The \(value) motion file does not contain exactly its fifty stable IDs."
        case .catalogueCoverage: return "The motion catalogue does not match the thousand question IDs."
        case .rendererMismatch(let id): return "Round \(id) uses the wrong native or layered renderer."
        case .invalidPerformance(let id, let reason): return "Round \(id) failed motion validation: \(reason)."
        case .unavailableRegistry: return "The motion asset registry is unavailable."
        case .unavailableQuestions: return "The question catalogue is unavailable."
        }
    }
}

struct MotionProductionCatalogue: Sendable {
    let all: [ScenePerformance]
    private let byID: [Int: ScenePerformance]
    fileprivate init(_ values: [ScenePerformance]) {
        all = values.sorted { $0.roundID < $1.roundID }
        byID = Dictionary(uniqueKeysWithValues: values.map { ($0.roundID, $0) })
    }
    func performance(id: Int) -> ScenePerformance? { byID[id] }
}

/// Full production data is optional until its twenty validated files are bundled.
/// Failure remains observable; callers may retain the existing pilot/native path.
enum MotionProductionLibrary {
    static let topicByteLimit = 1_000_000
    static let catalogueByteLimit = 8_000_000
    static var registry: MotionAssetRegistry? { MotionPilotLibrary.registry }
    static let result: Result<MotionProductionCatalogue, MotionProductionError> = {
        guard let registry = MotionPilotLibrary.registry else { return .failure(.unavailableRegistry) }
        guard let questions = try? TopicCatalog.bundled.get() else { return .failure(.unavailableQuestions) }
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        do {
            return .success(try load(registry: registry, catalog: questions) { topic in
                let name = "performance-" + topic.rawValue
                let subdirectories: [String?] = ["MotionData/Performances", "MotionData", "Performances", nil]
                guard let url = subdirectories.lazy.compactMap({ bundle.url(forResource: name, withExtension: "json", subdirectory: $0) }).first else {
                    throw MotionProductionError.missingTopic(topic.rawValue)
                }
                // Reject size before allocating/decoding where a file resource size is available.
                if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > topicByteLimit {
                    throw MotionProductionError.oversizedTopic(topic.rawValue)
                }
                return try Data(contentsOf: url, options: .mappedIfSafe)
            })
        } catch let error as MotionProductionError { return .failure(error) }
        catch { return .failure(.invalidJSON("bundled")) }
    }()
    static var all: [ScenePerformance] { (try? result.get().all) ?? [] }
    static func performance(id: Int) -> ScenePerformance? { try? result.get().performance(id: id) }

    /// Injectable reader permits exact coverage/malformed-data tests without production fixtures.
    /// All twenty files pass before any catalogue is returned.
    static func load(registry: MotionAssetRegistry, catalog: TopicCatalog,
                     readTopic: (TopicID) throws -> Data) throws -> MotionProductionCatalogue {
        let expectedIDs = Set(catalog.allRounds.map(\.id))
        guard expectedIDs == Set(1001...2000), catalog.allRounds.count == 1_000 else { throw MotionProductionError.catalogueCoverage }
        var values: [ScenePerformance] = [], bytes = 0
        values.reserveCapacity(1_000)
        for topic in TopicID.allCases {
            let data: Data
            do { data = try readTopic(topic) }
            catch let error as MotionProductionError { throw error }
            catch { throw MotionProductionError.missingTopic(topic.rawValue) }
            bytes += data.count
            guard data.count <= topicByteLimit, bytes <= catalogueByteLimit else { throw MotionProductionError.oversizedTopic(topic.rawValue) }
            let file: MotionProductionTopicFile
            do { file = try JSONDecoder().decode(MotionProductionTopicFile.self, from: data) }
            catch { throw MotionProductionError.invalidJSON(topic.rawValue) }
            guard file.schemaVersion == 1 else { throw MotionProductionError.unsupportedVersion(topic.rawValue) }
            guard file.topic == topic else { throw MotionProductionError.topicMismatch(topic.rawValue) }
            let topicIDs = Set(catalog.rounds(for: topic).map(\.id))
            guard file.performances.count == 50, topicIDs.count == 50,
                  Set(file.performances.map(\.roundID)) == topicIDs else { throw MotionProductionError.topicCoverage(topic.rawValue) }
            for value in file.performances {
                let requiresNative = MotionNativeAdapterContract.allowedIDs.contains(value.roundID)
                guard (value.renderer == .nativeStory) == requiresNative else { throw MotionProductionError.rendererMismatch(value.roundID) }
                do { try MotionPerformanceValidator.validate(value, registry: registry) }
                catch let error as MotionValidationError { throw MotionProductionError.invalidPerformance(value.roundID, error) }
            }
            values += file.performances
        }
        guard values.count == expectedIDs.count, Set(values.map(\.roundID)) == expectedIDs else { throw MotionProductionError.catalogueCoverage }
        return MotionProductionCatalogue(values)
    }
}
