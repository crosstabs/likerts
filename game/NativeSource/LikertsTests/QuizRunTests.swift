import XCTest
@testable import Likerts

final class QuizRunTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_000)

    func testCorrectRunScoresOncePerQuestionAndFinishes() throws {
        let quiz = QuizDocument.sample
        var run = try QuizRun(quiz: quiz, now: start)
        XCTAssertEqual(run.phase, .answer)
        XCTAssertEqual(run.index, 0)
        XCTAssertNil(run.selectedAnswer)
        XCTAssertEqual(run.remainingSeconds(at: start), 20)
        XCTAssertFalse(run.next(now: start))

        for (index, question) in quiz.questions.enumerated() {
            let now = start.addingTimeInterval(TimeInterval(index * 30))
            XCTAssertEqual(run.currentQuestion?.id, question.id)
            XCTAssertTrue(run.submit(answer: question.correctAnswer, now: now))
            XCTAssertEqual(run.phase, .reveal)
            XCTAssertEqual(run.selectedAnswer, question.correctAnswer)
            XCTAssertNil(run.deadline)
            XCTAssertFalse(run.submit(answer: question.correctAnswer, now: now))
            XCTAssertEqual(run.results.count, index + 1)
            XCTAssertEqual(run.score, (index + 1) * 1_000)
            XCTAssertTrue(run.next(now: now.addingTimeInterval(30)))
        }
        XCTAssertEqual(run.phase, .finished)
        XCTAssertEqual(run.index, quiz.questions.count - 1)
        XCTAssertNil(run.currentQuestion)
        XCTAssertNil(run.selectedAnswer)
        XCTAssertNil(run.deadline)
        XCTAssertEqual(run.score, 3_000)
        XCTAssertEqual(run.correctCount, 3)
        XCTAssertFalse(run.next(now: start.addingTimeInterval(1_000)))
        XCTAssertFalse(run.advance(now: start.addingTimeInterval(1_000)))
    }

    func testWrongAnswerScoresZeroAndNextUsesItsOwnStartTime() throws {
        var run = try QuizRun(quiz: QuizDocument.sample, now: start)
        XCTAssertTrue(run.submit(answer: 0, now: start.addingTimeInterval(3)))
        XCTAssertEqual(run.results.first?.correct, false)
        XCTAssertEqual(run.results.first?.timedOut, false)
        XCTAssertEqual(run.results.first?.points, 0)
        XCTAssertEqual(run.score, 0)
        XCTAssertTrue(run.next(now: start.addingTimeInterval(100)))
        XCTAssertEqual(run.deadline, start.addingTimeInterval(120))
        XCTAssertEqual(run.remainingSeconds(at: start.addingTimeInterval(119.5)), 1)
        XCTAssertNil(run.selectedAnswer)
    }

    func testDeadlineBoundaryTimesOutInsteadOfAcceptingLateAnswer() throws {
        var early = try QuizRun(quiz: QuizDocument.sample, now: start)
        XCTAssertTrue(early.submit(answer: 1, now: start.addingTimeInterval(19.999)))
        XCTAssertEqual(early.score, 1_000)
        XCTAssertFalse(early.advance(now: start.addingTimeInterval(20)))

        var exact = try QuizRun(quiz: QuizDocument.sample, now: start)
        XCTAssertFalse(exact.submit(answer: 1, now: start.addingTimeInterval(20)))
        XCTAssertEqual(exact.phase, .reveal)
        XCTAssertEqual(exact.results.count, 1)
        XCTAssertEqual(exact.results.first?.timedOut, true)
        XCTAssertNil(exact.results.first?.answer)
        XCTAssertNil(exact.selectedAnswer)
        XCTAssertEqual(exact.score, 0)
    }

    func testElapsedTimeAfterBackgroundingRevealsOnlyOneTimeout() throws {
        var run = try QuizRun(quiz: QuizDocument.sample, now: start)
        XCTAssertTrue(run.advance(now: start.addingTimeInterval(1_000)))
        XCTAssertEqual(run.phase, .reveal)
        XCTAssertEqual(run.results.count, 1)
        XCTAssertEqual(run.results[0].timedOut, true)
        XCTAssertEqual(run.correctCount, 0)
        XCTAssertFalse(run.advance(now: start.addingTimeInterval(2_000)))
        XCTAssertFalse(run.submit(answer: 1, now: start.addingTimeInterval(2_000)))
        XCTAssertEqual(run.results.count, 1)
    }

    func testUntimedQuestionDoesNotExpire() throws {
        var quiz = QuizDocument.sample
        quiz.questions[0].timeLimitSeconds = 0
        var run = try QuizRun(quiz: quiz, now: start)
        XCTAssertNil(run.deadline)
        XCTAssertNil(run.remainingSeconds(at: start.addingTimeInterval(10_000)))
        XCTAssertFalse(run.advance(now: start.addingTimeInterval(10_000)))
        XCTAssertTrue(run.submit(answer: 1, now: start.addingTimeInterval(10_000)))
        XCTAssertEqual(run.score, 1_000)
    }

    func testInvalidAnswersAndInvalidClockCannotChangeRun() throws {
        var run = try QuizRun(quiz: QuizDocument.sample, now: start)
        XCTAssertFalse(run.submit(answer: -1, now: start))
        XCTAssertFalse(run.submit(answer: 4, now: start))
        XCTAssertEqual(run.phase, .answer)
        XCTAssertTrue(run.results.isEmpty)
        let invalid = Date(timeIntervalSince1970: .nan)
        XCTAssertThrowsError(try QuizRun(quiz: QuizDocument.sample, now: invalid))
        let original = run
        XCTAssertFalse(run.advance(now: invalid))
        XCTAssertFalse(run.submit(answer: 1, now: invalid))
        XCTAssertFalse(run.next(now: invalid))
        XCTAssertEqual(run, original)
        XCTAssertNil(run.remainingSeconds(at: invalid))
    }
}
