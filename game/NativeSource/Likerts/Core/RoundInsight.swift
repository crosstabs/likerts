import Foundation

enum RoundInsightError: Error, Equatable, LocalizedError {
    case invalidGuesses

    var errorDescription: String? {
        "A round insight needs five guesses between 1 and 5."
    }
}

/// The actual largest answer gap in one completed round. Equal gaps use the
/// earliest prompt, and an exact round remains an honest zero-gap insight.
struct RoundInsight: Equatable, Sendable {
    let index: Int
    let distance: Int
    let prompt: Prompt
    let guess: Int
    let answer: Int

    var allMatched: Bool { distance == 0 }

    init(challenge: Challenge, guesses: [Int]) throws {
        let prompts = challenge.resolvedPrompts
        guard guesses.count == 5, challenge.answers.count == 5, prompts.count == 5,
              guesses.allSatisfy({ (1...5).contains($0) }),
              challenge.answers.allSatisfy({ (1...5).contains($0) }) else {
            throw RoundInsightError.invalidGuesses
        }
        var widestIndex = 0
        var widestDistance = 0
        for index in 0..<5 {
            let distance = abs(guesses[index] - challenge.answers[index])
            // Strictly greater preserves the first prompt when distances tie.
            if distance > widestDistance {
                widestIndex = index
                widestDistance = distance
            }
        }
        self.index = widestIndex
        self.distance = widestDistance
        self.prompt = prompts[widestIndex]
        self.guess = guesses[widestIndex]
        self.answer = challenge.answers[widestIndex]
    }
}
