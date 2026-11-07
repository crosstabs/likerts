import Foundation
import Observation

/// One day value drives both the Home card and its action. Existing games
/// retain their own immutable DailyPuzzle when this clock advances.
@MainActor @Observable final class DailyReadClock {
    private(set) var puzzle: DailyPuzzle
    private let now: () -> Date
    private let sleepUntil: (Date) async throws -> Void
    #if DEBUG
    private var testingDate: Date?
    static func forCurrentProcess() -> DailyReadClock {
        let clock = DailyReadClock()
        if ProcessInfo.processInfo.arguments.contains("-daily-clock-testing") {
            clock.testingDate = Date(timeIntervalSince1970: 1_700_000_000)
            clock.refresh()
        }
        return clock
    }
    func advanceTestingDay() {
        guard let testingDate else { return }
        self.testingDate = testingDate.addingTimeInterval(86_400)
        refresh()
    }
    #endif

    init(now: @escaping () -> Date = Date.init,
         sleepUntil: @escaping (Date) async throws -> Void = { date in
             let seconds = max(0.05, date.timeIntervalSinceNow)
             try await Task.sleep(nanoseconds: UInt64(min(seconds, 86_400) * 1_000_000_000))
         }) {
        self.now = now; self.sleepUntil = sleepUntil
        self.puzzle = DailyPuzzle.today(date: now())
    }
    private func currentDate() -> Date {
        #if DEBUG
        if let testingDate { return testingDate }
        #endif
        return now()
    }
    func refresh() { puzzle = DailyPuzzle.today(date: currentDate()) }
    func run() async {
        while !Task.isCancelled {
            let date = currentDate()
            puzzle = DailyPuzzle.today(date: date)
            #if DEBUG
            if testingDate != nil { return } // The explicit QA clock advances by its test control.
            #endif
            do { try await sleepUntil(DailyPuzzle.nextRefresh(after: date)) }
            catch { return }
            guard !Task.isCancelled else { return }
        }
    }
}
