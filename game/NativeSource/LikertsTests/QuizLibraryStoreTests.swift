#if canImport(UIKit)
import XCTest
@testable import Likerts

@MainActor final class QuizLibraryStoreTests: XCTestCase {
    private func fixtureURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("quiz-library-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("library.json")
    }

    func testMissingFileStartsWritableEmptyLibrary() throws {
        let url = try fixtureURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        do {
            let unexpected = try FileHandle(forReadingFrom: url)
            try unexpected.close()
            XCTFail("The missing-file fixture unexpectedly exists")
        } catch {
            let error = error as NSError
            let data = try JSONSerialization.data(withJSONObject: ["domain": error.domain, "code": error.code], options: [.sortedKeys])
            let diagnostic = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            diagnostic.name = "quiz-library-missing-file-error-domain-code"
            diagnostic.lifetime = .keepAlways
            add(diagnostic)
        }
        let store = QuizLibraryStore(fileURL: url)
        XCTAssertNil(store.loadError)
        XCTAssertTrue(store.canModify)
        XCTAssertTrue(store.quizzes.isEmpty)
        XCTAssertTrue(store.save(.sample))
        XCTAssertEqual(QuizLibraryStore(fileURL: url).quizzes, [try QuizDocument.sample.normalized()])
    }

    func testNonmissingReadFailureStillBlocksLibraryWrites() throws {
        let url = try fixtureURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let resources = try url.resourceValues(forKeys: [.isRegularFileKey, .isDirectoryKey])
        XCTAssertEqual(resources.isRegularFile, false)
        XCTAssertEqual(resources.isDirectory, true)
        var observation: [String: Any] = ["fixture": "existing-directory", "isRegularFile": resources.isRegularFile ?? false,
                                          "isDirectory": resources.isDirectory ?? false]
        var stage = "open"
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            stage = "read"
            observation["bytesRead"] = try handle.read(upToCount: 1)?.count ?? 0
        } catch {
            let error = error as NSError
            observation["stage"] = stage
            observation["domain"] = error.domain
            observation["code"] = error.code
        }
        let data = try JSONSerialization.data(withJSONObject: observation, options: [.sortedKeys])
        let diagnostic = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        diagnostic.name = "quiz-library-directory-filehandle-observation"
        diagnostic.lifetime = .keepAlways
        add(diagnostic)
        let store = QuizLibraryStore(fileURL: url)
        XCTAssertNotNil(store.loadError)
        XCTAssertFalse(store.canModify)
        XCTAssertFalse(store.save(.sample))
        var isDirectory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory))
        XCTAssertTrue(isDirectory.boolValue)
    }

    func testSavedQuizSurvivesNewStoreAndCanBeEdited() throws {
        let url = try fixtureURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = QuizLibraryStore(fileURL: url)
        XCTAssertNil(store.loadError)
        var quiz = QuizDocument.sample
        quiz.title = "Our first quiz"
        XCTAssertTrue(store.save(quiz))
        let reopened = QuizLibraryStore(fileURL: url)
        XCTAssertEqual(reopened.quizzes, [try quiz.normalized()])
        quiz.title = "Our edited quiz"
        XCTAssertTrue(reopened.save(quiz))
        XCTAssertEqual(QuizLibraryStore(fileURL: url).quizzes.map(\.title), ["Our edited quiz"])
    }

    func testFailedWritePreservesPreviousLibraryAndReportsFailure() throws {
        let url = try fixtureURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let original = QuizDocument.sample
        XCTAssertTrue(QuizLibraryStore(fileURL: url).save(original))
        let bytesBefore = try Data(contentsOf: url)
        let store = QuizLibraryStore(fileURL: url, writeData: { _, _ in
            throw CocoaError(.fileWriteOutOfSpace)
        })
        var edited = original
        edited.title = "This must not appear saved"
        XCTAssertFalse(store.save(edited))
        XCTAssertNotNil(store.operationError)
        XCTAssertEqual(store.quizzes, [try original.normalized()])
        XCTAssertEqual(try Data(contentsOf: url), bytesBefore)
        XCTAssertEqual(QuizLibraryStore(fileURL: url).quizzes, [try original.normalized()])
    }

    func testCorruptLibraryBlocksWritesUntilExplicitReset() throws {
        let url = try fixtureURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let corrupt = Data("{not a saved library".utf8)
        try corrupt.write(to: url)
        let store = QuizLibraryStore(fileURL: url)
        XCTAssertFalse(store.canModify)
        XCTAssertNotNil(store.loadError)
        XCTAssertFalse(store.save(.sample))
        XCTAssertEqual(try Data(contentsOf: url), corrupt)
        XCTAssertTrue(store.resetLibrary())
        XCTAssertTrue(store.canModify)
        XCTAssertTrue(store.quizzes.isEmpty)
        XCTAssertTrue(store.save(.sample))
    }

    func testImportCopiesIdentifiersWithoutOverwritingExistingQuiz() throws {
        let url = try fixtureURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = QuizLibraryStore(fileURL: url)
        let original = QuizDocument.sample
        XCTAssertTrue(store.save(original))
        XCTAssertTrue(store.importQuiz(try original.encoded()))
        XCTAssertEqual(store.quizzes.count, 2)
        let saved = try XCTUnwrap(store.quizzes.first)
        let imported = try XCTUnwrap(store.quizzes.dropFirst().first)
        XCTAssertEqual(saved, try original.normalized())
        XCTAssertNotEqual(imported.id, original.id)
        XCTAssertTrue(Set(imported.questions.map(\.id)).isDisjoint(with: Set(original.questions.map(\.id))))
        XCTAssertEqual(imported.questions.map(\.prompt), original.questions.map(\.prompt))
    }

    func testFullLibraryRejectsAnotherImportWithoutChangingSavedData() throws {
        let url = try fixtureURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = QuizLibraryStore(fileURL: url)
        for _ in 0..<QuizLibraryStore.maximumQuizzes {
            XCTAssertTrue(store.save(try QuizDocument.sample.duplicated()))
        }
        let bytesBefore = try Data(contentsOf: url)
        XCTAssertFalse(store.importQuiz(try QuizDocument.sample.encoded()))
        XCTAssertNotNil(store.operationError)
        XCTAssertEqual(store.quizzes.count, 25)
        XCTAssertEqual(try Data(contentsOf: url), bytesBefore)
    }

    func testImportReadIsBoundedBeforeDecode() throws {
        let url = try fixtureURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        try Data(repeating: 32, count: 65_537).write(to: url)
        XCTAssertThrowsError(try QuizLibraryStore.readImport(from: url))
    }
}
#endif
