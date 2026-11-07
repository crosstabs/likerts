import Foundation
import CoreFoundation
import Observation

/// Creator quizzes stay in a separate, file-protected local library. A failed
/// load blocks writes so a corrupt or unavailable file is never replaced silently.
@MainActor @Observable final class QuizLibraryStore {
    private(set) var quizzes: [QuizDocument] = []
    private(set) var loadError: String?
    private(set) var operationError: String?
    var canModify: Bool { loadError == nil }
    static let maximumQuizzes = 25
    private static let maximumLibraryBytes = 2_097_152
    private let fileURL: URL
    private let writeData: (Data, URL) throws -> Void

    init(fileURL: URL? = nil,
         writeData: @escaping (Data, URL) throws -> Void = {
             try $0.write(to: $1, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
         }) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        #if DEBUG
        let filename = ProcessInfo.processInfo.arguments.contains("-quiz-library-testing") ? "library-ui-test-v1.json" : "library-v1.json"
        #else
        let filename = "library-v1.json"
        #endif
        self.fileURL = fileURL ?? support.appendingPathComponent("Likerts/Quizzes", isDirectory: true)
            .appendingPathComponent(filename)
        self.writeData = writeData
        reload()
    }

    func reload() {
        operationError = nil
        var checkingMetadata = true
        do {
            // Foundation can report a directory FileHandle read as a missing
            // file. Establish the existing item type before classifying errors.
            let resources = try fileURL.resourceValues(forKeys: [.isRegularFileKey])
            guard resources.isRegularFile == true else { throw LibraryFailure.invalidLibrary }
            checkingMetadata = false
            let handle = try FileHandle(forReadingFrom: fileURL)
            defer { try? handle.close() }
            let data = try handle.read(upToCount: Self.maximumLibraryBytes + 1) ?? Data()
            guard data.count <= Self.maximumLibraryBytes,
                  let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(envelope.keys) == ["format", "version", "quizzes"],
                  envelope["format"] as? String == "likerts.quiz.library",
                  let version = envelope["version"] as? NSNumber,
                  CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
                  let values = envelope["quizzes"] as? [[String: Any]],
                  values.count <= Self.maximumQuizzes else { throw LibraryFailure.invalidLibrary }
            let loaded = try values.map { value in
                try QuizDocument.decode(JSONSerialization.data(withJSONObject: value))
            }
            guard Set(loaded.map(\.id)).count == loaded.count else { throw LibraryFailure.invalidLibrary }
            quizzes = loaded
            loadError = nil
        } catch {
            // Only a missing metadata lookup establishes a new library. Once
            // an existing regular file is established, every read/parse error
            // blocks writes, even if FileHandle uses a missing-file error code.
            if checkingMetadata && Self.isMissingLibrary(error) {
                quizzes = []; loadError = nil
                return
            }
            quizzes = []
            loadError = "Your quiz library couldn’t be opened. Retry, or reset it only if you no longer need its saved quizzes. Nothing has been replaced."
        }
    }

    @discardableResult func save(_ quiz: QuizDocument) -> Bool {
        guard canModify else { return false }
        do {
            let valid = try quiz.normalized()
            var next = quizzes
            if let index = next.firstIndex(where: { $0.id == valid.id }) {
                next[index] = valid
            } else {
                guard next.count < Self.maximumQuizzes else {
                    operationError = "Your library holds up to 25 quizzes. Delete a quiz before saving another."
                    return false
                }
                next.append(valid)
            }
            try persist(next)
            return true
        } catch {
            operationError = "This quiz couldn’t be saved. Check its questions and available storage, then try again. Your previous library is unchanged."
            return false
        }
    }

    @discardableResult func importQuiz(_ data: Data) -> Bool {
        guard canModify else { return false }
        do { return save(try QuizDocument.decode(data).duplicated()) }
        catch {
            operationError = error.localizedDescription
            return false
        }
    }

    @discardableResult func duplicate(_ quiz: QuizDocument) -> Bool {
        guard canModify else { return false }
        do {
            var copy = try quiz.duplicated()
            copy.title = String(String.UnicodeScalarView(copy.title.unicodeScalars.prefix(73))) + " (copy)"
            return save(copy)
        } catch {
            operationError = "This quiz couldn’t be duplicated. Your library is unchanged."
            return false
        }
    }

    @discardableResult func delete(id: String) -> Bool {
        guard canModify else { return false }
        do {
            try persist(quizzes.filter { $0.id != id })
            return true
        } catch {
            operationError = "The quiz couldn’t be deleted. Its saved copy is still in your library."
            return false
        }
    }

    /// Call only after the person explicitly confirms the loss of the stored library.
    @discardableResult func resetLibrary() -> Bool {
        do {
            try persist([])
            loadError = nil
            return true
        } catch {
            operationError = "The library couldn’t be reset. Its stored file has not been replaced."
            return false
        }
    }

    func dismissOperationError() { operationError = nil }

    static func readImport(from url: URL) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: 65_537) ?? Data()
        guard data.count <= 65_536 else { throw LibraryFailure.importTooLarge }
        return data
    }

    private func persist(_ next: [QuizDocument]) throws {
        guard next.count <= Self.maximumQuizzes else { throw LibraryFailure.invalidLibrary }
        let checked = try next.map { try $0.normalized() }
        guard Set(checked.map(\.id)).count == checked.count else { throw LibraryFailure.invalidLibrary }
        let envelope = LibraryEnvelope(quizzes: checked)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(envelope)
        guard data.count <= Self.maximumLibraryBytes else { throw LibraryFailure.invalidLibrary }
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var excluded = directory
        var resources = URLResourceValues(); resources.isExcludedFromBackup = true
        try excluded.setResourceValues(resources)
        try writeData(data, fileURL)
        quizzes = checked
        operationError = nil
    }

    private struct LibraryEnvelope: Encodable {
        let format = "likerts.quiz.library"
        let version = 1
        var quizzes: [QuizDocument]
    }

    private static func isMissingLibrary(_ error: Error) -> Bool {
        let error = error as NSError
        if error.domain == NSPOSIXErrorDomain {
            return error.code == Int(POSIXErrorCode.ENOENT.rawValue)
        }
        guard error.domain == NSCocoaErrorDomain else { return false }
        return error.code == CocoaError.Code.fileNoSuchFile.rawValue
            || error.code == CocoaError.Code.fileReadNoSuchFile.rawValue
    }

    private enum LibraryFailure: LocalizedError {
        case invalidLibrary, importTooLarge
        var errorDescription: String? {
            switch self {
            case .invalidLibrary: return "This saved quiz library couldn’t be read."
            case .importTooLarge: return "Choose a quiz file no larger than 64 KB."
            }
        }
    }
}
