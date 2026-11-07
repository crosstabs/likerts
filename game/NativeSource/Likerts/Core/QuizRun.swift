import Foundation

public struct QuizAnswerResult: Codable, Equatable, Sendable {
    public let questionID: String
    public let answer: Int?
    public let correct: Bool
    public let points: Int
    public let timedOut: Bool
}

/// Local practice rules. This model is not multiplayer authority and exposes the creator answer key.
public struct QuizRun: Equatable, Sendable {
    public enum Phase: String, Codable, Sendable { case answer, reveal, finished }

    public let quiz: QuizDocument
    public private(set) var index: Int
    public private(set) var phase: Phase
    public private(set) var selectedAnswer: Int?
    public private(set) var results: [QuizAnswerResult]
    public private(set) var deadline: Date?

    public var currentQuestion: QuizQuestion? { phase == .finished ? nil : quiz.questions[index] }
    public var score: Int { results.reduce(0) { $0 + $1.points } }
    public var correctCount: Int { results.filter(\.correct).count }

    public init(quiz: QuizDocument, now: Date = Date()) throws {
        guard now.timeIntervalSince1970.isFinite else {
            throw QuizValidationError(code: "invalid_type", path: "now", message: "Use a valid start time.")
        }
        self.quiz = try quiz.normalized()
        self.index = 0
        self.phase = .answer
        self.selectedAnswer = nil
        self.results = []
        let seconds = self.quiz.questions[0].timeLimitSeconds
        self.deadline = seconds == 0 ? nil : now.addingTimeInterval(TimeInterval(seconds))
    }

    public func remainingSeconds(at now: Date = Date()) -> Int? {
        guard phase == .answer, let deadline, now.timeIntervalSince1970.isFinite else { return nil }
        let remaining = max(0, ceil(deadline.timeIntervalSince(now)))
        return remaining >= Double(Int.max) ? Int.max : Int(remaining)
    }

    @discardableResult
    public mutating func advance(now: Date = Date()) -> Bool {
        guard phase == .answer, let deadline, now.timeIntervalSince1970.isFinite, now >= deadline else { return false }
        reveal(answer: nil, timedOut: true)
        return true
    }

    /// Returns true only when an answer was accepted. A late submission reveals a timeout instead.
    @discardableResult
    public mutating func submit(answer: Int, now: Date = Date()) -> Bool {
        guard now.timeIntervalSince1970.isFinite else { return false }
        _ = advance(now: now)
        guard phase == .answer, quiz.questions[index].answers.indices.contains(answer) else { return false }
        reveal(answer: answer, timedOut: false)
        return true
    }

    @discardableResult
    public mutating func next(now: Date = Date()) -> Bool {
        guard phase == .reveal, now.timeIntervalSince1970.isFinite else { return false }
        selectedAnswer = nil
        if index + 1 == quiz.questions.count {
            phase = .finished
            deadline = nil
        } else {
            index += 1
            phase = .answer
            let seconds = quiz.questions[index].timeLimitSeconds
            deadline = seconds == 0 ? nil : now.addingTimeInterval(TimeInterval(seconds))
        }
        return true
    }

    private mutating func reveal(answer: Int?, timedOut: Bool) {
        let question = quiz.questions[index]
        let correct = answer == question.correctAnswer && !timedOut
        results.append(QuizAnswerResult(questionID: question.id, answer: answer, correct: correct,
                                        points: correct ? 1_000 : 0, timedOut: timedOut))
        selectedAnswer = answer
        phase = .reveal
        deadline = nil
    }
}
