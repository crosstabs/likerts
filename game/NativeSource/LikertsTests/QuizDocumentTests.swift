import XCTest
@testable import Likerts

final class QuizDocumentTests: XCTestCase {
    private func fixtureURL(_ filename: String) throws -> URL {
        let file = URL(fileURLWithPath: filename)
        let bundled = Bundle(for: QuizDocumentTests.self).url(
            forResource: file.deletingPathExtension().lastPathComponent,
            withExtension: file.pathExtension,
            subdirectory: "SharedFixtures"
        )
        if let bundled { return bundled }
        #if SWIFT_PACKAGE
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("SharedFixtures", isDirectory: true)
            .appendingPathComponent(filename)
        #else
        return try XCTUnwrap(bundled, "Missing test resource SharedFixtures/\(filename).")
        #endif
    }

    func testBundledSampleMatchesPortableSharedDocument() throws {
        let data = try Data(contentsOf: fixtureURL("sample-quiz.json"))
        let imported = try QuizDocument.decode(data)
        XCTAssertEqual(imported, QuizDocument.sample)
        XCTAssertEqual(imported.questions.count, 3)
        XCTAssertEqual(try QuizDocument.decode(imported.encoded()), imported)
        XCTAssertLessThanOrEqual(try imported.encoded().count, QuizDocument.maximumBytes)
    }

    func testSharedAcceptanceAndRejectionFixtures() throws {
        let data = try Data(contentsOf: fixtureURL("quiz-validation-fixtures.json"))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        XCTAssertGreaterThanOrEqual(cases.count, 20)
        for fixture in cases {
            let name = try XCTUnwrap(fixture["name"] as? String)
            let valid = try XCTUnwrap(fixture["valid"] as? Bool)
            let document = try XCTUnwrap(fixture["document"] as? [String: Any])
            let encoded = try JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
            if valid {
                let imported = try QuizDocument.decode(encoded)
                XCTAssertEqual(try QuizDocument.decode(imported.encoded()), imported, name)
                XCTAssertEqual(imported.id, imported.id.lowercased(), name)
            } else {
                let expectedCode = try XCTUnwrap(fixture["code"] as? String)
                XCTAssertThrowsError(try QuizDocument.decode(encoded), name) { error in
                    XCTAssertEqual((error as? QuizValidationError)?.code, expectedCode, name)
                }
            }
        }
    }

    func testRawImportLimitIsInclusiveAndCheckedBeforeParsing() throws {
        let valid = try QuizDocument.sample.encoded()
        var exact = valid
        exact.append(Data(repeating: 0x20, count: QuizDocument.maximumBytes - exact.count))
        XCTAssertEqual(try QuizDocument.decode(exact), QuizDocument.sample)
        exact.append(0x20)
        XCTAssertThrowsError(try QuizDocument.decode(exact)) { error in
            XCTAssertEqual((error as? QuizValidationError)?.code, "too_large")
        }
        XCTAssertThrowsError(try QuizDocument.decode(Data(repeating: 0xFF, count: 10))) { error in
            XCTAssertEqual((error as? QuizValidationError)?.code, "invalid_json")
        }
        XCTAssertThrowsError(try QuizDocument.decode(Data("not JSON".utf8)))
    }

    func testMalformedUnicodeAndWrongRootTypesReject() throws {
        let valid = try String(decoding: QuizDocument.sample.encoded(), as: UTF8.self)
        let malformed = valid.replacingOccurrences(of: "Little wonders", with: "\\uD800")
        XCTAssertThrowsError(try QuizDocument.decode(Data(malformed.utf8)))
        for root in ["null", "true", "[]", "42", "\"text\""] {
            XCTAssertThrowsError(try QuizDocument.decode(Data(root.utf8))) { error in
                XCTAssertEqual((error as? QuizValidationError)?.code, "invalid_type")
            }
        }
    }

    func testDraftMustBeCompletedBeforeSavingExportingOrPlaying() throws {
        let draft = QuizDocument.draft()
        XCTAssertEqual(draft.questions[0].correctAnswer, -1)
        XCTAssertThrowsError(try draft.encoded())
        XCTAssertThrowsError(try QuizRun(quiz: draft))
        var completed = draft
        completed.title = "My quiz"
        completed.questions[0].prompt = "Pick the letter A"
        completed.questions[0].answers = ["A", "B"]
        XCTAssertThrowsError(try completed.normalized()) { error in
            XCTAssertEqual((error as? QuizValidationError)?.code, "answer_required")
        }
        completed.questions[0].correctAnswer = 0
        XCTAssertNoThrow(try completed.encoded())
    }

    func testDuplicateChangesEveryIdentifierAndPreservesContent() throws {
        let original = QuizDocument.sample
        let duplicate = try original.duplicated()
        XCTAssertNotEqual(duplicate.id, original.id)
        XCTAssertTrue(Set(original.questions.map(\.id)).isDisjoint(with: duplicate.questions.map(\.id)))
        XCTAssertEqual(duplicate.title, original.title)
        XCTAssertEqual(duplicate.questions.map(\.prompt), original.questions.map(\.prompt))
        XCTAssertEqual(duplicate.questions.map(\.answers), original.questions.map(\.answers))
        XCTAssertEqual(duplicate.questions.map(\.correctAnswer), original.questions.map(\.correctAnswer))
        XCTAssertNoThrow(try duplicate.normalized())
    }

    func testNormalizedSizeLimitAndUnicodeScalarLimit() throws {
        var unicode = QuizDocument.sample
        unicode.title = String(repeating: "🌟", count: 80)
        XCTAssertNoThrow(try unicode.normalized())
        unicode.title.append("🌟")
        XCTAssertThrowsError(try unicode.normalized())

        var large = QuizDocument.sample
        large.questions = (0..<30).map { index in
            QuizQuestion(id: String(format: "00000000-0000-4000-8000-%012d", index + 1),
                         prompt: String(repeating: "🌟", count: 240),
                         answers: ["A", "B", "C", "D"].map { $0 + String(repeating: "🌟", count: 99) },
                         correctAnswer: 0, explanation: String(repeating: "🌟", count: 240), timeLimitSeconds: 20)
        }
        XCTAssertThrowsError(try large.encoded()) { error in
            XCTAssertEqual((error as? QuizValidationError)?.code, "too_large")
        }
    }

    func testCodablePathDoesNotIgnoreUnknownFields() throws {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: QuizDocument.sample.encoded()) as? [String: Any])
        object["unexpected"] = "ignored by an ordinary synthesized decoder"
        let data = try JSONSerialization.data(withJSONObject: object)
        XCTAssertThrowsError(try JSONDecoder().decode(QuizDocument.self, from: data)) { error in
            XCTAssertEqual((error as? QuizValidationError)?.code, "unknown_field")
        }
    }
}
