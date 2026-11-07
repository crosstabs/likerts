import SwiftUI
import UIKit

@MainActor struct LiveQuizRoomContent: View {
    let session: LiveRoomSession
    let state: LiveRoomState
    @Binding var selection: Int?
    let confirmReveal: () -> Void
    let confirmEnd: () -> Void
    let removePlayer: (String, String) -> Void
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var managesPlayers = false
    @State private var showsLastQuestion = false

    private var actionLayout: AnyLayout {
        textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(spacing: 10))
    }
    private var disabled: Bool { session.busy || session.hasPendingAction }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if state.phase != .finished || !textSize.isAccessibilitySize { header }
            if state.phase == .lobby { lobby }
            else if state.phase == .finished {
                finishedResults
                if state.role == .host { hostControls }
            }
            else {
                if let round = state.quizRound { question(round) }
                if state.phase == .reveal { results }
                if state.role == .host { hostControls }
            }
        }
        .onChange(of: state.matchId) { _, _ in showsLastQuestion = false }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: state.phase == .lobby ? 12 : 6) {
            if state.phase == .lobby { Text("LIVE QUIZ").quizFont(.caption, .heavy).tracking(1.5) }
            Text(state.quiz?.title ?? "Quiz").quizFont(state.phase == .lobby ? .largeTitle : .headline, .black)
                .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("live.quiz.title")
            if state.phase == .lobby {
                Text("\(state.quiz?.questionCount ?? 0) questions · 1,000 points per correct answer")
                    .quizFont(.subheadline, .medium).foregroundStyle(Palette.muted)
                QuizCastArtwork(sceneKey: liveSceneKey)
                Text(state.code).quizFont(.largeTitle, .black).tracking(3)
                    .padding(.horizontal, 22).padding(.vertical, 12)
                    .background(Palette.violet.opacity(0.35), in: RoundedRectangle(cornerRadius: 22))
                    .textSelection(.enabled).accessibilityLabel("Room code \(state.code)")
                    .accessibilityIdentifier("live.roomCode")
                actionLayout {
                    QuizActionButton(title: "Copy code", symbol: "doc.on.doc", identifier: "live.copyCode") { UIPasteboard.general.string = state.code }
                    if let invite = session.configuration.inviteURL(code: state.code) {
                        ShareLink(item: invite) { Label("Invite", systemImage: "square.and.arrow.up").quizFont(.subheadline, .semibold).frame(minHeight: 44) }
                            .buttonStyle(.bordered).tint(Palette.ink).accessibilityIdentifier("live.invite")
                    }
                }
            } else {
                actionLayout {
                    Text("Room \(state.code) · \(state.role == .host ? "Host" : state.viewer.nickname)")
                        .quizFont(.caption, .medium).foregroundStyle(Palette.muted).accessibilityIdentifier("live.roomCode")
                    Text(connectionText).quizFont(.caption, .semibold).accessibilityIdentifier("live.connection")
                }
            }
            if state.phase == .lobby { Text(connectionText).quizFont(.footnote, .semibold).accessibilityIdentifier("live.connection") }
            if !state.hostConnected { Text("Host disconnected. Timed questions continue on the server.").quizFont(.footnote, .medium) }
            if [.disconnected, .paused, .reconnecting].contains(session.connection) {
                QuizActionButton(title: "Reconnect now", symbol: "arrow.clockwise", identifier: "live.reconnect", disabled: session.busy) { session.reconnect() }
            }
        }
    }

    private var connectionText: String {
        switch session.connection {
        case .live: return "Live"
        case .polling: return "Connected"
        case .connecting: return "Connecting…"
        case .reconnecting: return "Reconnecting · shown state may be out of date"
        case .paused: return "Connection paused · shown state may be out of date"
        case .disconnected: return "Disconnected"
        }
    }

    private var lobby: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your curious crew").quizFont(.title2, .heavy)
            Text("Players: \(state.players.count) / \(state.settings.capacity) · \(state.joinLocked ? "Room locked" : "Open to join")")
                .quizFont(.subheadline, .semibold).accessibilityIdentifier("live.rosterCount")
            if state.players.isEmpty { Text("Share the room code. Two players need to join before you start.").quizFont(.body, .medium) }
            ForEach(state.players) { player in
                HStack(spacing: 12) {
                    StoryCharacter(value: player.avatar, pose: .hold).frame(width: 38, height: 48).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(player.nickname).quizFont(.body, .heavy)
                        Text(player.connected ? "Connected" : "Reconnecting").quizFont(.caption, .medium).foregroundStyle(Palette.muted)
                    }
                    Spacer(minLength: 4)
                    if state.role == .host { removalButton(player) }
                }.padding(15).background(.white, in: RoundedRectangle(cornerRadius: 20))
                    .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.ink.opacity(0.24)))
            }
            if state.role == .host {
                Toggle("Lock room to new players", isOn: Binding(get: { state.joinLocked }, set: { session.send(.lock, locked: $0) }))
                    .quizFont(.body, .semibold).tint(Palette.ink).disabled(disabled).accessibilityIdentifier("live.lockRoom")
                QuizPrimaryButton(title: "Start quiz", symbol: "play.fill", identifier: "live.start", disabled: disabled || state.players.count < 2) { session.send(.start) }
            } else {
                HStack(alignment: .center, spacing: 18) {
                    QuizNeutralArtwork(height: 70)
                    Text("Waiting for the host. Everyone answers the same question together.").quizFont(.body, .medium)
                }
            }
            Text("Your nickname, submitted choices and points become visible to the room at reveal. The host controls when an untimed question is revealed.")
                .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
        }
    }

    private func question(_ round: LiveQuizRound) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                if !textSize.isAccessibilitySize {
                    QuizParticipantArtwork(value: state.players.first(where: { $0.id == state.viewer.id })?.avatar ?? 3,
                        height: 44, sceneKey: state.phase == .answer ? liveSceneKey : nil)
                }
                VStack(alignment: .leading, spacing: 7) {
                    Text("QUESTION \(round.index) OF \(round.total)").quizFont(.caption, .heavy).tracking(1)
                        .accessibilityIdentifier("live.quiz.progress")
                    if state.phase == .answer { LiveQuizDeadline(deadline: round.deadline, serverTime: state.serverTime, receivedAt: session.receivedAt) }
                }
            }
            Text(round.prompt).quizFont(.title, .heavy).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("live.prompt")
            if state.phase == .answer, state.role == .host {
                ForEach(round.answers.indices, id: \.self) { index in answerCard(round.answers[index], index: index, selected: false, selectable: false) }
                Text("Answers locked: \(round.submittedCount) / \(round.eligibleCount)").quizFont(.body, .heavy).accessibilityIdentifier("live.waiting")
                Text("Player choices and the answer key stay hidden until reveal.").quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
            } else if state.phase == .answer {
                if let own = state.ownLockedValue {
                    Label("Locked: \(Self.letter(own)) · \(round.answers[own])", systemImage: "lock.fill")
                        .quizFont(.body, .heavy).accessibilityIdentifier("live.locked")
                }
                ForEach(round.answers.indices, id: \.self) { index in
                    answerCard(round.answers[index], index: index, selected: (state.ownLockedValue ?? selection) == index,
                               selectable: state.canSubmit && !disabled)
                }
                if state.ownLockedValue != nil {
                    Text("Your answer is saved by the server. Waiting for the room to reveal.").quizFont(.footnote, .medium)
                } else {
                    QuizPrimaryButton(title: "Lock my answer", symbol: "lock.fill", identifier: "live.submit", disabled: selection == nil || disabled || !state.canSubmit) {
                        if let selection { session.send(.quizAnswer, value: selection) }
                    }
                    Text("Choose one. You can change your choice until you lock it. Points and timing are decided by the server.")
                        .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
                }
            }
        }
    }

    private func answerCard(_ text: String, index: Int, selected: Bool, selectable: Bool) -> some View {
        Button { if selectable { selection = index } } label: {
            actionLayout {
                Text(Self.letter(index)).quizFont(.body, .heavy)
                    .frame(minWidth: 32, minHeight: 32).padding(2)
                    .background(Palette.violet.opacity(0.45), in: Circle()).accessibilityHidden(true)
                Text(text).quizFont(.body, .semibold).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if selected { Image(systemName: state.ownLockedValue == nil ? "checkmark.circle.fill" : "lock.fill").font(.title3).accessibilityHidden(true) }
            }
            .padding(12).frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .background(selected ? Palette.violet.opacity(0.32) : .white, in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Palette.ink, lineWidth: selected ? 2 : 1))
            .contentShape(RoundedRectangle(cornerRadius: 22))
        }
        .buttonStyle(LiveQuizAnswerStyle()).disabled(!selectable)
        .accessibilityLabel("\(Self.letter(index)), \(text)")
        .accessibilityValue(selected ? (state.ownLockedValue == nil ? "Selected" : "Locked") : (selectable ? "" : "Read only"))
        .accessibilityAddTraits(selected ? .isSelected : []).accessibilityIdentifier("live.quiz.choice.\(index)")
    }

    private var results: some View {
        VStack(alignment: .leading, spacing: 18) {
            personalFeedback
            if state.role == .host, let reveal = state.quizReveal, reveal.valid,
               reveal.results.contains(where: { $0.points == 1_000 }) {
                QuizCastArtwork(celebrating: true, sceneKey: liveSceneKey)
            }
            revealDetails
            if state.role == .player, let reveal = state.quizReveal, reveal.valid,
               reveal.results.contains(where: { $0.playerId == state.viewer.id && $0.points == 1_000 }) {
                QuizCastArtwork(celebrating: true, sceneKey: liveSceneKey)
            }
            standings
        }
    }

    @ViewBuilder private var personalFeedback: some View {
        if state.phase == .reveal, state.role == .player, let reveal = state.quizReveal, reveal.valid,
           let own = reveal.results.first(where: { $0.playerId == state.viewer.id }) {
            PaperCard(color: own.points == 1_000 ? Palette.lime.opacity(0.35) : Palette.violet.opacity(0.18)) {
                HStack(alignment: .center, spacing: 16) {
                    if own.points == 0 { QuizNeutralArtwork(height: 54, sceneKey: liveSceneKey) }
                    VStack(alignment: .leading, spacing: 7) {
                        Text(own.value == nil ? "No answer this time" : own.points == 1_000 ? "Correct!" : "Not quite")
                            .quizFont(.title3, .heavy).accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("live.quiz.personal.feedback")
                        Text("This question · \(own.points.formatted()) points")
                            .quizFont(.subheadline, .semibold)
                            .accessibilityIdentifier("live.quiz.personal.points")
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var finishedResults: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(state.completion == .complete ? "Quiz complete" : "Quiz ended · incomplete")
                .quizFont(.largeTitle, .black).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("live.finished")
            PaperCard(color: state.completion == .complete ? Palette.lime.opacity(0.5) : Palette.violet.opacity(0.22)) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(state.role == .player ? "Your total" : (state.completion == .complete ? "Top score" : "Highest provisional score"))
                        .quizFont(.subheadline, .heavy)
                    Text("\(finalPoints.formatted()) points").quizFont(.largeTitle, .black)
                        .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("live.quiz.total")
                    Text(state.completion == .complete ? "\(state.quiz?.questionCount ?? 0) questions, answered together." : "Provisional standings from scored questions. There is no final winner.")
                        .quizFont(.subheadline, .medium).fixedSize(horizontal: false, vertical: true)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            // At accessibility sizes, lead with the completed game and full
            // total. Preserve every metadata label below this summary.
            if textSize.isAccessibilitySize { header }
            if state.completion == .complete { QuizCastArtwork(celebrating: true, sceneKey: liveSceneKey) }
            standings
            if state.quizReveal != nil {
                QuizActionButton(title: showsLastQuestion ? "Hide last question details" : "Last question details",
                                 symbol: showsLastQuestion ? "chevron.up" : "chevron.down", identifier: "live.quiz.lastQuestion") {
                    showsLastQuestion.toggle()
                }.accessibilityValue(showsLastQuestion ? "Expanded" : "Collapsed")
                if showsLastQuestion {
                    VStack(alignment: .leading, spacing: 16) {
                        if let round = state.quizRound {
                            Text(round.prompt).quizFont(.title3, .heavy).fixedSize(horizontal: false, vertical: true)
                        }
                        revealDetails
                    }
                }
            }
        }
    }

    private var finalPoints: Int {
        if state.role == .player { return state.leaderboard.first(where: { $0.playerId == state.viewer.id })?.points ?? 0 }
        return state.leaderboard.map(\.points).max() ?? 0
    }

    private var liveSceneKey: QuizSceneKey? {
        let phase: QuizScenePhase
        switch state.phase {
        case .lobby: phase = .lobby
        case .answer: phase = .answer
        case .reveal: phase = .reveal
        case .finished: phase = .finished
        case .predict: return nil
        }
        return .make(namespace: .live,
            identifiers: [state.matchId] + (state.activeRoundID.map { [$0] } ?? []), phase: phase)
    }

    @ViewBuilder private var revealDetails: some View {
        if let reveal = state.quizReveal {
            PaperCard(color: reveal.valid ? Palette.lime.opacity(0.5) : Palette.violet.opacity(0.22)) {
                VStack(alignment: .leading, spacing: 13) {
                    if reveal.valid, let correct = reveal.correctAnswer, let round = state.quizRound {
                        Text("The reveal").quizFont(.title2, .heavy)
                        Label("\(Self.letter(correct)) · \(round.answers[correct])", systemImage: "sparkles")
                            .quizFont(.title3, .heavy).accessibilityIdentifier("live.revealedAnswer")
                        if !reveal.explanation.isEmpty { Text(reveal.explanation).quizFont(.body, .medium).fixedSize(horizontal: false, vertical: true) }
                        ForEach(reveal.results) { row in
                            Text("\(row.nickname): \(row.value.map { Self.letter($0) + " · " + round.answers[$0] } ?? "No answer") · \(row.points) points")
                                .quizFont(.subheadline, .semibold).fixedSize(horizontal: false, vertical: true)
                        }
                    } else {
                        Text("Question not scored").quizFont(.title2, .heavy)
                        Text("The match ended before this question was revealed. Unfinished choices and the answer key stay hidden.").quizFont(.body, .medium)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var standings: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(state.phase == .finished && state.completion == .complete ? "Final leaderboard" : "Standings so far").quizFont(.title2, .heavy)
            ForEach(state.leaderboard) { row in
                PaperCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(row.rank.map { "\($0). " } ?? "")\(row.nickname)").quizFont(.title3, .heavy)
                        Text("\(row.points) points").quizFont(.title2, .black)
                        Text("\(row.accuracy.map { $0.formatted(.number.precision(.fractionLength(0))) + "% correct" } ?? "No scored questions yet") · \(row.opportunities) questions")
                            .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.accessibilityIdentifier("live.quiz.standing.\(row.playerId)")
            }
        }
    }

    private var hostControls: some View {
        VStack(alignment: .leading, spacing: 14) {
            if state.phase == .answer {
                QuizActionButton(title: "Reveal question now", symbol: "eye", identifier: "live.quiz.reveal", disabled: disabled, action: confirmReveal)
                Text("Revealing now closes answers and scores missing choices as zero.").quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
            }
            if state.phase == .reveal {
                QuizPrimaryButton(title: state.roundIndex == state.roundTotal ? "Finish quiz" : "Next question", identifier: "live.next", disabled: disabled) { session.send(.next) }
            }
            if state.phase == .finished {
                QuizPrimaryButton(title: "Back to lobby for a rematch", symbol: "arrow.clockwise", identifier: "live.rematch", disabled: disabled) { session.send(.rematch) }
            } else {
                QuizActionButton(title: "End quiz", symbol: "stop", role: .destructive, identifier: "live.end", disabled: disabled, action: confirmEnd)
            }
            QuizActionButton(title: managesPlayers ? "Hide player controls" : "Manage players", symbol: "person.2", identifier: "live.managePlayers") { managesPlayers.toggle() }
            if managesPlayers {
                Text("Removing a player ends a running match as incomplete.").quizFont(.footnote, .medium)
                ForEach(state.players) { player in
                    HStack { Text(player.nickname).quizFont(.body, .medium); Spacer(); removalButton(player) }
                }
            }
        }
    }

    private func removalButton(_ player: LiveRoomPlayer) -> some View {
        Button { removePlayer(player.id, player.nickname) } label: { Image(systemName: "person.badge.minus").frame(width: 44, height: 44) }
            .accessibilityLabel("Remove \(player.nickname)").accessibilityIdentifier("live.remove.\(player.id)").disabled(disabled)
    }
    private static func letter(_ index: Int) -> String { ["A", "B", "C", "D"][index] }
}

private struct LiveQuizDeadline: View {
    let deadline: Int64?
    let serverTime: Int64
    let receivedAt: Date
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let elapsed = max(0, timeline.date.timeIntervalSince(receivedAt))
            let remaining = deadline.map { max(0, Int(ceil(Double($0 - serverTime) / 1_000 - elapsed))) }
            Text(remaining.map { $0 > 0 ? "Time remaining: \($0) seconds" : "Checking the server's reveal…" } ?? "Untimed · host reveals when ready")
                .quizFont(.subheadline, .semibold).accessibilityIdentifier("live.quiz.timer")
        }
    }
}

/// A locked answer remains a real disabled button, with readable content rather
/// than the system's dimmed disabled tint. Its state is also announced in text.
private struct LiveQuizAnswerStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.foregroundStyle(Palette.ink)
    }
}
