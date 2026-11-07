import Foundation
import CoreFoundation

/// A portable creator document. It contains the answer key and is not a live player invite.
public struct QuizDocument: Codable, Equatable, Identifiable, Sendable {
    public static let maximumBytes = 65_536
    public static let maximumSavedQuizzes = 25
    public static let allowedTimeLimits = [0, 10, 20, 30, 60, 120]

    public var format: String
    public var version: Int
    public var id: String
    public var title: String
    public var questions: [QuizQuestion]

    public init(format: String = "likerts.quiz", version: Int = 1,
                id: String = UUID().uuidString.lowercased(), title: String = "",
                questions: [QuizQuestion] = [.draft()]) {
        self.format = format
        self.version = version
        self.id = id
        self.title = title
        self.questions = questions
    }

    public static func draft() -> QuizDocument { QuizDocument() }

    public func normalized() throws -> QuizDocument {
        guard format == "likerts.quiz" else {
            throw QuizValidationError(code: "unsupported_format", path: "format", message: "Choose a Likerts quiz file.")
        }
        try QuizJSON.safeInteger(version, path: "version")
        guard version == 1 else {
            throw QuizValidationError(code: "unsupported_version", path: "version", message: "This quiz needs a different version of Likerts.")
        }
        let quizID = try QuizJSON.identifier(id, path: "id")
        let quizTitle = try QuizJSON.text(title, minimum: 1, maximum: 80, multiline: false,
                                         code: "empty_title", path: "title", message: "Give your quiz a title of 1–80 characters.")
        guard (1...30).contains(questions.count) else {
            throw QuizValidationError(code: "question_count", path: "questions", message: "A quiz needs 1–30 questions.")
        }
        var ids: Set<String> = [quizID]
        let normalizedQuestions = try questions.enumerated().map { index, question in
            let value = try question.normalized(at: index)
            guard ids.insert(value.id).inserted else {
                throw QuizValidationError(code: "duplicate_id", path: "questions[\(index)].id", message: "Each quiz and question needs its own identifier.")
            }
            return value
        }
        let result = QuizDocument(format: format, version: version, id: quizID, title: quizTitle,
                                  questions: normalizedQuestions)
        guard try QuizJSON.encode(result).count <= Self.maximumBytes else {
            throw QuizValidationError(code: "too_large", path: "", message: "Keep the quiz file under 64 KB.")
        }
        return result
    }

    public static func decode(_ data: Data) throws -> QuizDocument {
        guard data.count <= maximumBytes else {
            throw QuizValidationError(code: "too_large", path: "", message: "Keep the quiz file under 64 KB.")
        }
        guard String(data: data, encoding: .utf8) != nil else {
            throw QuizValidationError(code: "invalid_json", path: "", message: "Choose a valid UTF-8 quiz file.")
        }
        let value: Any
        do { value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) }
        catch { throw QuizValidationError(code: "invalid_json", path: "", message: "That quiz file could not be read.") }
        try QuizJSON.preflight(value)
        do { return try JSONDecoder().decode(QuizDocument.self, from: data) }
        catch let error as QuizValidationError { throw error }
        catch { throw QuizValidationError(code: "invalid_json", path: "", message: "That quiz file could not be read.") }
    }

    public func encoded() throws -> Data { try QuizJSON.encode(normalized()) }

    /// Importing or duplicating a document cannot silently replace an existing local quiz.
    public func duplicated() throws -> QuizDocument {
        var result = try normalized()
        result.id = UUID().uuidString.lowercased()
        for index in result.questions.indices { result.questions[index].id = UUID().uuidString.lowercased() }
        return result
    }

    private enum CodingKeys: String, CodingKey { case format, version, id, title, questions }

    public init(from decoder: Decoder) throws {
        try QuizJSON.checkKeys(decoder, allowed: QuizJSON.documentKeys)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        do {
            self.init(format: try container.decode(String.self, forKey: .format),
                      version: try container.decode(Int.self, forKey: .version),
                      id: try container.decode(String.self, forKey: .id),
                      title: try container.decode(String.self, forKey: .title),
                      questions: try container.decode([QuizQuestion].self, forKey: .questions))
        } catch let error as QuizValidationError { throw error }
        catch { throw QuizValidationError(code: "invalid_type", path: "", message: "The quiz contains a missing or invalid field.") }
        self = try normalized()
    }

    public static var sample: QuizDocument {
        QuizDocument(id: "84273658-3fa8-43f4-82bd-6f026933b8e7", title: "Little wonders", questions: [
            QuizQuestion(id: "42ab0856-2934-45cc-a720-7421756c873b", prompt: "Which planet is known as the Red Planet?",
                         answers: ["Venus", "Mars", "Jupiter", "Mercury"], correctAnswer: 1,
                         explanation: "Iron-rich dust gives Mars its reddish appearance.", timeLimitSeconds: 20),
            QuizQuestion(id: "71e627b1-95dd-493e-83fb-10ff3b5a32b5", prompt: "How many sides does a triangle have?",
                         answers: ["Two", "Three", "Four", "Five"], correctAnswer: 1,
                         explanation: "A triangle has three straight sides.", timeLimitSeconds: 20),
            QuizQuestion(id: "9da982b8-39a2-43ef-a57d-1c69c686e6ce", prompt: "Which ocean is the largest?",
                         answers: ["Atlantic", "Indian", "Pacific", "Arctic"], correctAnswer: 2,
                         explanation: "The Pacific is the largest ocean on Earth.", timeLimitSeconds: 30)
        ])
    }
}

public struct QuizQuestion: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var prompt: String
    public var answers: [String]
    public var correctAnswer: Int
    public var explanation: String
    public var timeLimitSeconds: Int

    public init(id: String = UUID().uuidString.lowercased(), prompt: String = "",
                answers: [String] = ["", "", "", ""], correctAnswer: Int = -1,
                explanation: String = "", timeLimitSeconds: Int = 20) {
        self.id = id
        self.prompt = prompt
        self.answers = answers
        self.correctAnswer = correctAnswer
        self.explanation = explanation
        self.timeLimitSeconds = timeLimitSeconds
    }

    public static func draft() -> QuizQuestion { QuizQuestion() }

    fileprivate func normalized(at index: Int) throws -> QuizQuestion {
        let prefix = "questions[\(index)]"
        let label = "Question \(index + 1): "
        let identifier = try QuizJSON.identifier(id, path: prefix + ".id")
        let normalizedPrompt = try QuizJSON.text(prompt, minimum: 1, maximum: 240, multiline: true,
                                                code: "invalid_prompt", path: prefix + ".prompt",
                                                message: label + "write a question of 1–240 characters.")
        guard (2...4).contains(answers.count) else {
            throw QuizValidationError(code: "answer_count", path: prefix + ".answers", message: label + "use 2–4 answers.")
        }
        let normalizedAnswers = try answers.enumerated().map { answerIndex, answer in
            try QuizJSON.text(answer, minimum: 1, maximum: 100, multiline: false,
                              code: "invalid_answer", path: prefix + ".answers[\(answerIndex)]",
                              message: label + "write each answer in 1–100 characters.")
        }
        guard Set(normalizedAnswers).count == normalizedAnswers.count else {
            throw QuizValidationError(code: "duplicate_answer", path: prefix + ".answers", message: label + "give each answer different text.")
        }
        try QuizJSON.safeInteger(correctAnswer, path: prefix + ".correctAnswer")
        guard normalizedAnswers.indices.contains(correctAnswer) else {
            throw QuizValidationError(code: "answer_required", path: prefix + ".correctAnswer", message: label + "choose the correct answer.")
        }
        let normalizedExplanation = try QuizJSON.text(explanation, minimum: 0, maximum: 240, multiline: true,
                                                     code: "invalid_explanation", path: prefix + ".explanation",
                                                     message: label + "keep the explanation to 240 characters.")
        try QuizJSON.safeInteger(timeLimitSeconds, path: prefix + ".timeLimitSeconds")
        guard QuizDocument.allowedTimeLimits.contains(timeLimitSeconds) else {
            throw QuizValidationError(code: "invalid_time_limit", path: prefix + ".timeLimitSeconds", message: label + "choose a supported time limit.")
        }
        return QuizQuestion(id: identifier, prompt: normalizedPrompt, answers: normalizedAnswers,
                            correctAnswer: correctAnswer, explanation: normalizedExplanation,
                            timeLimitSeconds: timeLimitSeconds)
    }

    private enum CodingKeys: String, CodingKey { case id, prompt, answers, correctAnswer, explanation, timeLimitSeconds }

    public init(from decoder: Decoder) throws {
        try QuizJSON.checkKeys(decoder, allowed: QuizJSON.questionKeys)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        do {
            self.init(id: try container.decode(String.self, forKey: .id),
                      prompt: try container.decode(String.self, forKey: .prompt),
                      answers: try container.decode([String].self, forKey: .answers),
                      correctAnswer: try container.decode(Int.self, forKey: .correctAnswer),
                      explanation: try container.decode(String.self, forKey: .explanation),
                      timeLimitSeconds: try container.decode(Int.self, forKey: .timeLimitSeconds))
        } catch let error as QuizValidationError { throw error }
        catch { throw QuizValidationError(code: "invalid_type", path: "questions", message: "A question contains a missing or invalid field.") }
    }
}

public struct QuizValidationError: Error, Equatable, LocalizedError, Sendable {
    public let code: String
    public let path: String
    public let message: String
    public var errorDescription: String? { message }

    public init(code: String, path: String, message: String) {
        self.code = code
        self.path = path
        self.message = message
    }
}

private enum QuizJSON {
    static let documentKeys: Set<String> = ["format", "version", "id", "title", "questions"]
    static let questionKeys: Set<String> = ["id", "prompt", "answers", "correctAnswer", "explanation", "timeLimitSeconds"]

    static func encode(_ quiz: QuizDocument) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(quiz)
    }

    static func identifier(_ text: String, path: String) throws -> String {
        guard text.utf8.count == 36,
              text.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", options: .regularExpression) != nil else {
            throw QuizValidationError(code: "invalid_uuid", path: path, message: "The quiz contains an invalid identifier.")
        }
        return text.lowercased()
    }

    static func text(_ value: String, minimum: Int, maximum: Int, multiline: Bool,
                     code: String, path: String, message: String) throws -> String {
        let result = value.trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n")).precomposedStringWithCanonicalMapping
        let scalars = result.unicodeScalars
        let invalidControl = scalars.contains { scalar in
            let code = scalar.value
            if multiline && code == 10 { return false }
            return code < 32 || (127...159).contains(code) || (!multiline && (code == 0x2028 || code == 0x2029))
        }
        guard (minimum...maximum).contains(scalars.count), !invalidControl else {
            throw QuizValidationError(code: code, path: path, message: message)
        }
        return result
    }

    static func preflight(_ value: Any) throws {
        guard let document = value as? [String: Any] else { throw invalidType("") }
        try checkKeys(Set(document.keys), allowed: documentKeys, path: "")
        try string(document["format"], path: "format")
        try integer(document["version"], path: "version")
        try string(document["id"], path: "id")
        try string(document["title"], path: "title")
        guard let questions = document["questions"] as? [Any] else { throw invalidType("questions") }
        for (index, value) in questions.enumerated() {
            let path = "questions[\(index)]"
            guard let question = value as? [String: Any] else { throw invalidType(path) }
            try checkKeys(Set(question.keys), allowed: questionKeys, path: path)
            for key in ["id", "prompt", "explanation"] { try string(question[key], path: path + "." + key) }
            guard let answers = question["answers"] as? [Any] else { throw invalidType(path + ".answers") }
            for (answerIndex, answer) in answers.enumerated() { try string(answer, path: path + ".answers[\(answerIndex)]") }
            try integer(question["correctAnswer"], path: path + ".correctAnswer")
            try integer(question["timeLimitSeconds"], path: path + ".timeLimitSeconds")
        }
    }

    static func checkKeys(_ keys: Set<String>, allowed: Set<String>, path: String) throws {
        guard keys.isSubset(of: allowed) else {
            throw QuizValidationError(code: "unknown_field", path: path, message: "The quiz contains an unsupported field.")
        }
        guard keys == allowed else { throw invalidType(path) }
    }

    static func checkKeys(_ decoder: Decoder, allowed: Set<String>) throws {
        let container = try decoder.container(keyedBy: DynamicKey.self)
        try checkKeys(Set(container.allKeys.map(\.stringValue)), allowed: allowed,
                      path: decoder.codingPath.map(\.stringValue).joined(separator: "."))
    }

    static func string(_ value: Any?, path: String) throws {
        guard value is String else { throw invalidType(path) }
    }

    static func integer(_ value: Any?, path: String) throws {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded(.towardZero) == number.doubleValue,
              (-9_007_199_254_740_991...9_007_199_254_740_991).contains(number.doubleValue) else {
            throw invalidType(path)
        }
    }

    static func safeInteger(_ value: Int, path: String) throws {
        guard (-9_007_199_254_740_991...9_007_199_254_740_991).contains(value) else { throw invalidType(path) }
    }

    static func invalidType(_ path: String) -> QuizValidationError {
        QuizValidationError(code: "invalid_type", path: path, message: "The quiz contains a missing or invalid field.")
    }

    private struct DynamicKey: CodingKey {
        let stringValue: String
        let intValue: Int?
        init?(stringValue: String) { self.stringValue = stringValue; self.intValue = nil }
        init?(intValue: Int) { self.stringValue = String(intValue); self.intValue = intValue }
    }
}
