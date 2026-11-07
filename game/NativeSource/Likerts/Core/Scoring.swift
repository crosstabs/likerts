import Foundation

enum Scoring {
    static func points(guess: Int, answer: Int) -> Int {
        guard (1...5).contains(guess), (1...5).contains(answer) else { return 0 }
        return max(0, 100 - abs(guess - answer) * 25)
    }

    static func total(guesses: [Int], answers: [Int]) -> Int {
        guard !guesses.isEmpty, guesses.count == answers.count,
              guesses.allSatisfy({ (1...5).contains($0) }),
              answers.allSatisfy({ (1...5).contains($0) }) else { return 0 }
        let sum = zip(guesses, answers).reduce(0) { $0 + points(guess: $1.0, answer: $1.1) }
        return Int((Double(sum) / Double(guesses.count)).rounded())
    }

    static func title(for score: Int) -> String {
        switch score {
        case 100...: return "One shared brain."
        case 80..<100: return "Same wavelength."
        case 60..<80: return "Pretty good reception."
        case 40..<60: return "A little interference."
        default: return "Beautifully unpredictable."
        }
    }
}
