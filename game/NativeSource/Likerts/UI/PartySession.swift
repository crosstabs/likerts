import Foundation
import Observation

/// A deliberately ephemeral board. The host's sealed challenge never changes between friends.
@MainActor @Observable
final class PartySession {
    enum Phase { case setup, answering, friendSetup, guessing, handBack, board, insight }
    var phase: Phase = .setup
    var hostName = ""
    var friendName = ""
    var error: String?
    private(set) var board: PartyBoard?
    private(set) var game: GameSession?
    private(set) var activeFriend = ""
    private(set) var replaying: UUID?
    private(set) var selectedID: UUID?

    var standings: [PartyStanding] { board?.standings ?? [] }
    var selectedRun: PartyRun? { board?.runs.first { $0.id == selectedID } }
    var canAddFriend: Bool { (board?.runs.count ?? 0) < PartyBoard.maximumPlayers }

    func beginHost() {
        do {
            let name = try Challenge(name: hostName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "The host" : hostName,
                                     promptIDs: Array(PromptBank.all.prefix(5)).map(\.id), answers: [1, 1, 1, 1, 1]).name
            GameAudio.shared.prewarm()
            game = GameSession(name: name)
            error = nil; phase = .answering
        } catch { self.error = "Try another playful nickname: up to 20 characters, with no contact details or sensitive words." }
    }
    func advanceHost() {
        guard phase == .answering, let game else { return }
        game.next()
        if game.phase == .sealed, let challenge = game.challenge {
            board = PartyBoard(challenge: challenge)
            friendName = ""; phase = .friendSetup
        }
    }
    func addFriend() {
        guard board != nil, canAddFriend else { return }
        friendName = ""; error = nil; replaying = nil; phase = .friendSetup
    }
    func beginFriend() {
        guard let board, canAddFriend else { return }
        do {
            activeFriend = try board.validatedName(friendName)
            GameAudio.shared.prewarm()
            game = GameSession(challenge: board.challenge)
            error = nil; replaying = nil; phase = .guessing
        } catch { self.error = error.localizedDescription }
    }
    func advanceGuess() {
        guard phase == .guessing, let game, game.selection != nil else { return }
        if game.index < 4 { game.index += 1; return }
        do {
            guard var updated = board else { return }
            let run = try updated.complete(name: friendName, guesses: game.guesses.compactMap { $0 }, replacing: replaying)
            board = updated; selectedID = run.id; activeFriend = run.displayName
            error = nil; phase = .handBack
        } catch { self.error = error.localizedDescription }
    }
    func showBoard() {
        // Scores become visible only after the host explicitly takes the phone
        // back. No outcome cue is played during a friend's blind turn.
        let shouldCelebrate = phase == .handBack && selectedID != nil
        error = nil; game = nil; phase = .board
        if shouldCelebrate { GameAudio.shared.play(.results, userInitiated: true) }
    }
    func showInsight(_ id: UUID) {
        guard board?.runs.contains(where: { $0.id == id }) == true else { return }
        selectedID = id; phase = .insight
    }
    func replay() {
        guard let run = selectedRun, let board else { return }
        GameAudio.shared.prewarm()
        GameAudio.shared.play(.rematch, userInitiated: true)
        replaying = run.id; activeFriend = run.displayName; friendName = run.name
        game = GameSession(challenge: board.challenge); error = nil; phase = .guessing
    }
    func abandonTurn() { showBoard(); replaying = nil; friendName = "" }
    func clearScores() {
        board?.clearScores(); selectedID = nil; replaying = nil; friendName = ""; showBoard()
    }
}
