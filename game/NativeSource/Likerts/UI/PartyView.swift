import SwiftUI

struct PartyView: View {
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var party = PartySession()
    @State private var showLeave = false
    @State private var showReset = false
    @State private var activity: SharePayload?
    let leave: () -> Void

    var body: some View {
        ZStack {
            Palette.cream.ignoresSafeArea()
            VStack(spacing: 0) {
                if let error = party.error { Text(error).roundedFont(14, .semibold).padding(16).frame(maxWidth: .infinity).background(Palette.coral.opacity(0.2)).accessibilityIdentifier("party.error") }
                screen
            }
        }.foregroundStyle(Palette.ink)
            .alert("Leave this party?", isPresented: $showLeave) {
                Button("Keep playing", role: .cancel) {}.accessibilityIdentifier("party.leave.cancel")
                if party.board != nil {
                    Button("Back to the board") { party.abandonTurn() }.accessibilityIdentifier("party.turn.cancel")
                }
                Button("End party", role: .destructive, action: leave).accessibilityIdentifier("party.leave.confirm")
            } message: { Text("Ending the party clears your five takes and this phone's scores.") }
            .alert("Clear scores?", isPresented: $showReset) {
                Button("Keep scores", role: .cancel) {}.accessibilityIdentifier("party.reset.cancel")
                Button("Clear scores", role: .destructive) { party.clearScores() }.accessibilityIdentifier("party.reset.confirm")
            } message: { Text("Keep the host's same five takes. Remove every friend's completed run.") }
            .sheet(item: $activity) { ActivityView(items: $0.items) }
    }

    @ViewBuilder private var screen: some View {
        switch party.phase {
        case .setup: setup
        case .answering:
            if let game = party.game { RoundView(game: game, close: { showLeave = true }, advance: party.advanceHost) }
        case .friendSetup: friendSetup
        case .guessing:
            if let game = party.game {
                VStack(spacing: 0) {
                    HStack {
                        Label(party.activeFriend, systemImage: "person.fill").roundedFont(14, .heavy)
                        Spacer(minLength: 8)
                        Text("Five blind guesses").roundedFont(11, .semibold)
                    }.padding(.horizontal, 24).padding(.vertical, 10).background(Palette.violet.opacity(0.25))
                    RoundView(game: game, close: { showLeave = true }, blindGuess: true, advance: party.advanceGuess)
                }
            }
        case .handBack: handBack
        case .board: leaderboard
        case .insight: insight
        }
    }
    private var setup: some View {
        page {
            header("One host. Several minds.")
            Text("Who knows\nme best?").roundedFont(43, .black).tracking(-1.5)
            StoryHomeCast(height: 155)
            Text("Answer once. Let your friends take turns reading the same five takes.").roundedFont(19, .semibold)
            Text("Their guesses stay blind until all five are locked. Then compare real scores on this phone.").roundedFont(16, .medium).foregroundStyle(Palette.muted)
            nameField("Host nickname · optional", value: $party.hostName, id: "party.hostName")
            PrimaryButton(title: "Make my five takes", identifier: "party.beginHost", action: party.beginHost)
            sessionNote
        }
    }
    private var friendSetup: some View {
        page {
            header("Same five. Next friend.")
            HStack(spacing: 18) {
                StoryCharacter(value: 5, pose: .hold).frame(width: 60, height: 90).rotationEffect(.degrees(-8))
                VStack(alignment: .leading, spacing: 7) {
                    Text("\(party.board?.challenge.name ?? "The host") is locked in.").roundedFont(28, .black)
                    Text("Their answers stay hidden while you guess.").roundedFont(15, .medium).foregroundStyle(Palette.muted)
                }
            }.padding(.vertical, 12)
            Text("Who's taking\nthe dare?").roundedFont(36, .black).tracking(-1)
            nameField("Friend \((party.board?.runs.count ?? 0) + 1) · nickname optional", value: $party.friendName, id: "party.friendName")
            PrimaryButton(title: "My turn · Read their mind", identifier: "party.beginFriend", action: party.beginFriend)
            Button("Back to the board", action: party.showBoard).roundedFont(16).frame(maxWidth: .infinity, minHeight: 44).accessibilityIdentifier("party.backBoard")
            Text("One turn each. No answers or points appear during a turn. Keep the reveal away from friends who haven't played.").roundedFont(14, .medium).foregroundStyle(Palette.muted)
            sessionNote
        }
    }
    private var handBack: some View {
        page {
            header("Turn complete")
            HStack { Spacer(); StoryCharacter(value: 3, pose: .hold).frame(width: 100, height: 145).rotationEffect(.degrees(8)); Spacer() }.padding(.vertical, 25)
            Text("Five guesses.\nLocked.").roundedFont(40, .black).tracking(-1)
            Text("Nice work, \(party.activeFriend). Hand the phone back to the host.").roundedFont(19, .semibold)
            Text("The next friend gets the same five takes. Keep the answer reveals out of their sight.").roundedFont(15, .medium).foregroundStyle(Palette.muted)
            PrimaryButton(title: "I'm the host · Show the board", symbol: "list.number", identifier: "party.handBack", action: party.showBoard)
        }
    }
    private var leaderboard: some View {
        page {
            header("On this phone · Session board")
            Text("Who knows\n\(party.board?.challenge.name ?? "the host") best?").roundedFont(36, .black).tracking(-1)
            Text("\(party.board?.runs.count ?? 0) completed \((party.board?.runs.count ?? 0) == 1 ? "friend" : "friends")")
                .roundedFont(14, .semibold).foregroundStyle(Palette.muted).accessibilityIdentifier("party.count")
            if party.standings.isEmpty {
                PaperCard(color: Palette.violet.opacity(0.25)) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Your five are ready.").roundedFont(24, .heavy)
                        Text("Pass the phone to the first friend. Every completed turn earns a spot here.").roundedFont(16, .medium)
                    }
                }
            } else {
                ForEach(party.standings) { standing in boardRow(standing) }
            }
            PrimaryButton(title: party.canAddFriend ? (party.standings.isEmpty ? "Let the first friend play" : "Next friend · Same five takes") : "12 friends · Board is full", identifier: "party.addFriend", disabled: !party.canAddFriend, action: party.addFriend)
            Text("Only completed turns count. Replays replace that friend's score; the latest attempt counts. Ties share a rank.")
                .roundedFont(12, .medium).foregroundStyle(Palette.muted)
            if !party.standings.isEmpty {
                Button("Clear scores · Keep my five") { showReset = true }.roundedFont(14, .semibold).frame(maxWidth: .infinity, minHeight: 44).accessibilityIdentifier("party.reset")
            }
            Text("The same five takes for every friend.")
                .roundedFont(12, .semibold).foregroundStyle(Palette.muted).accessibilityIdentifier("party.pack")
            sessionNote
        }.accessibilityIdentifier("party.board")
    }
    private func boardRow(_ standing: PartyStanding) -> some View {
        let run = standing.run
        let index = party.board?.runs.firstIndex { $0.id == run.id } ?? 0
        return VStack(alignment: .leading, spacing: 13) {
            if textSize.isAccessibilitySize {
                HStack {
                    Text("#\(standing.rank)").roundedFont(20, .black)
                    Spacer(minLength: 8)
                    Text("\(run.score)%").roundedFont(27, .black).accessibilityIdentifier("party.score.\(index)")
                }
                friendLabel(standing, index: index)
            } else {
                HStack(spacing: 13) {
                    Text("\(standing.rank)").roundedFont(26, .black).frame(width: 42, height: 50)
                        .background(standing.rank == 1 ? Palette.lime : Palette.violet.opacity(0.25), in: RoundedRectangle(cornerRadius: 15))
                    friendLabel(standing, index: index)
                    Spacer(minLength: 8)
                    Text("\(run.score)%").roundedFont(29, .black).accessibilityIdentifier("party.score.\(index)")
                }
            }
            HStack {
                Text(run.attemptCount == 1 ? "First attempt" : "Attempt \(run.attemptCount) · latest counts").roundedFont(11, .medium).foregroundStyle(Palette.muted)
                Spacer(minLength: 8)
                Button { party.showInsight(run.id) } label: {
                    Label(run.insight.allMatched ? "The mind meld" : "The plot twist", systemImage: "sparkles").roundedFont(13, .bold).padding(.horizontal, 12).frame(minHeight: 44).background(Palette.ink.opacity(0.05), in: Capsule())
                }.buttonStyle(SquishButtonStyle()).accessibilityLabel("Reveal \(run.displayName)'s result").accessibilityIdentifier("party.reveal.\(index)")
            }
        }.padding(18).background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 25))
    }
    private func friendLabel(_ standing: PartyStanding, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(standing.run.displayName).roundedFont(22, .heavy).accessibilityIdentifier("party.name.\(index)")
            Text(standing.isTied ? "Tied #\(standing.rank)" : "\(standing.run.exactCount)/5 exact reads").roundedFont(12, .semibold).foregroundStyle(Palette.muted).accessibilityIdentifier("party.tie.\(index)")
        }
    }
    private var insight: some View {
        page {
            HStack {
                Button { party.showBoard() } label: { Label("Board", systemImage: "arrow.left").roundedFont(15).frame(minHeight: 44) }.accessibilityIdentifier("party.insight.back")
                Spacer()
                Button { showLeave = true } label: { Image(systemName: "xmark").frame(width: 44, height: 44).navigationGlass() }.accessibilityLabel("End party").accessibilityIdentifier("party.leave")
            }
            if let run = party.selectedRun, let board = party.board {
                Text("\(run.displayName)'s\nwavelength.").roundedFont(34, .black).tracking(-1)
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("\(run.score)%").font(.system(size: 72, weight: .black, design: .rounded)).tracking(-4)
                    Text("\(run.exactCount)/5\nexact reads").roundedFont(16, .semibold)
                }
                InsightCard(insight: run.insight, hostName: board.challenge.name, guesser: run.displayName).accessibilityIdentifier("party.insight")
                PrimaryButton(title: run.insight.allMatched ? "Share the mind meld" : "Share this plot twist", symbol: "square.and.arrow.up", identifier: "party.insight.share") { share(board: board, run: run) }
                PrimaryButton(title: "\(run.displayName) · Try again", symbol: "arrow.triangle.2.circlepath", color: Palette.violet.opacity(0.4), foreground: Palette.ink, identifier: "party.replay", action: party.replay)
                Text("A replay replaces this friend's score when all five guesses are locked. Leaving a turn keeps their earlier score.").roundedFont(12, .medium).foregroundStyle(Palette.muted)
                sessionNote
            }
        }
    }
    private func header(_ text: String) -> some View {
        HStack(alignment: .top) {
            Eyebrow(text: text).foregroundStyle(Palette.muted)
            Spacer(minLength: 10)
            Button { showLeave = true } label: { Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).frame(width: 44, height: 44).navigationGlass() }.accessibilityLabel("End party").accessibilityIdentifier("party.leave")
        }
    }
    private func nameField(_ placeholder: String, value: Binding<String>, id: String) -> some View {
        TextField(placeholder, text: value).roundedFont(19).padding(18).background(.white, in: RoundedRectangle(cornerRadius: 18)).textContentType(.nickname).autocorrectionDisabled().submitLabel(.done).accessibilityIdentifier(id)
            .onChange(of: value.wrappedValue) { _, name in value.wrappedValue = String(name.prefix(20)); party.error = nil }
    }
    private var sessionNote: some View {
        Text("On-device session only. No remote scoreboard.\nLeaving or restarting the app clears this party.").roundedFont(11, .medium).foregroundStyle(Palette.muted)
    }
    private func page<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22, content: content).padding(24).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }.scrollIndicators(.visible)
    }
    private func share(board: PartyBoard, run: PartyRun) {
        let renderer = ImageRenderer(content: PartyShareCard(board: board, run: run).padding(22).frame(width: 390).background(Palette.cream).environment(\.dynamicTypeSize, .medium).environment(\.colorScheme, .light))
        renderer.scale = 3
        guard let image = renderer.uiImage else { return }
        activity = SharePayload(items: [ResultShareItem(image: image, title: "\(run.displayName) got \(run.score)% · Who knows \(board.challenge.name) best?"), "\(run.displayName) got \(run.score)% reading \(board.challenge.name)'s five takes. This is our on-device Likerts session board. #Likerts"])
    }
}

struct PartyShareCard: View {
    let board: PartyBoard
    let run: PartyRun
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack { Text("likerts").roundedFont(29, .black).tracking(-1.5); Spacer(); Image(systemName: "sparkles").font(.title2.bold()) }
            Text("Who knows\n\(board.challenge.name) best?").roundedFont(31, .black).tracking(-1)
            VStack(alignment: .leading, spacing: 6) {
                Text("\(run.displayName) got").roundedFont(19, .heavy)
                Text("\(run.score)%").font(.system(size: 76, weight: .black, design: .rounded)).tracking(-4)
                Text("\(run.exactCount)/5 exact reads · Attempt \(run.attemptCount)").roundedFont(13, .semibold)
            }.padding(22).frame(maxWidth: .infinity, alignment: .leading).background(Palette.lime, in: RoundedRectangle(cornerRadius: 25))
            VStack(alignment: .leading, spacing: 12) {
                Eyebrow(text: "This phone's board · \(board.runs.count) played")
                ForEach(Array(board.standings.prefix(5))) { standing in
                    HStack {
                        Text(standing.isTied ? "=\(standing.rank)" : "\(standing.rank)").frame(width: 24)
                        Text(standing.run.displayName)
                        Spacer(minLength: 8)
                        Text("\(standing.run.score)%")
                    }.roundedFont(15, .bold)
                }
                if board.runs.count > 5 {
                    let remaining = board.runs.count - 5
                    Text(remaining == 1 ? "+1 more completed turn" : "+\(remaining) more completed turns").roundedFont(12, .medium)
                }
            }.padding(18).background(.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 22))
            InsightCard(insight: run.insight, hostName: board.challenge.name, guesser: run.displayName)
            Text("A snapshot of this on-device session. Ties share a rank.\nFive takes, not a personality test.").roundedFont(10, .medium).foregroundStyle(Palette.muted)
        }.foregroundStyle(Palette.ink)
    }
}
