import SwiftUI
import UIKit

/// Main-app-only room UI. A room invite contains its locator, never a member capability.
struct LiveRoomView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var session: LiveRoomSession
    @State private var settings = LiveRoomSettings()
    @State private var code = ""
    @State private var nickname = ""
    @State private var acceptsSharing = false
    @State private var selection: Int?
    @State private var confirmation: Confirmation?
    @State private var managesPlayers = false
    @FocusState private var joinFocus: JoinField?
    private let close: () -> Void
    private let initialQuiz: QuizDocument?
    private enum JoinField: Hashable { case code, nickname }

    init(configuration: LiveRoomConfiguration, quiz: QuizDocument? = nil, close: @escaping () -> Void) {
        _session = State(initialValue: LiveRoomSession(configuration: configuration))
        initialQuiz = quiz
        self.close = close
    }

    private enum Confirmation: Equatable {
        case exit, leave, close, end, skip, forget, quizReveal, kick(String, String)
        var title: String {
            switch self {
            case .exit: return "Keep your place in the room?"
            case .leave: return "Leave this room?"
            case .close: return "Close the room for everyone?"
            case .end: return "End this match?"
            case .skip: return "Skip this round without scoring?"
            case .forget: return "Forget saved room access?"
            case .kick(_, let name): return "Remove \(name) from the room?"
            case .quizReveal: return "Reveal this question now?"
            }
        }
        var message: String {
            switch self {
            case .exit: return "Returning home pauses this connection and keeps secure access on this device. It does not leave or close the room. Timed rounds can continue."
            case .leave: return "Your seat will be removed. If a match is running, it ends as incomplete."
            case .close: return "Everyone will lose access to this room. This cannot be undone."
            case .end: return "This match will be marked incomplete. An unfinished answer will stay hidden."
            case .skip: return "No points will be awarded. The match will be marked incomplete."
            case .forget: return "This only removes access from this device. It does not remove a remote seat or close a room. Recover or resume first if you want to leave or close it."
            case .kick: return "This revokes their access. If a match is running, it ends as incomplete."
            case .quizReveal: return "Answers close immediately. Submitted choices are scored; anyone who has not answered receives zero for this question."
            }
        }
    }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    status
                    if let state = session.state { room(state) }
                    else { entrance }
                }
                .padding(session.state?.isQuiz == true ? 20 : 24).frame(maxWidth: 660).frame(maxWidth: .infinity)
                .id("live.quiz.top")
            }
            .onChange(of: quizNavigationIdentity) { _, identity in
                if identity != nil { scroll.scrollTo("live.quiz.top", anchor: .top) }
            }
        }
        .background(Palette.cream.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
        .foregroundStyle(Palette.ink)
        .safeAreaInset(edge: .top) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    if compactQuizChrome {
                        Text("Likerts").quizFont(.headline, .black)
                    } else {
                        Text("Likerts Live").roundedFont(21, .heavy)
                        Text(session.state == nil ? "A little closer, wherever you are." : "One room. Different instincts.")
                            .roundedFont(12, .medium).foregroundStyle(Palette.muted)
                    }
                }
                Spacer(minLength: 10)
                CloseButton {
                    if session.state != nil || session.busy { confirmation = .exit }
                    else { session.suspend(); close() }
                }.accessibilityIdentifier("live.close")
            }.padding(.horizontal, 24).padding(.vertical, compactQuizChrome ? 4 : 12).background(Palette.cream)
        }
        .confirmationDialog(confirmation?.title ?? "", isPresented: Binding(
            get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }
        ), titleVisibility: .visible) {
            confirmationButtons
        } message: { Text(confirmation?.message ?? "") }
        .onChange(of: session.state?.activeRoundID) { _, _ in selection = session.state?.ownLockedValue }
        .onChange(of: session.state?.ownLockedValue) { _, value in if let value { selection = value } }
        .onChange(of: session.state != nil) { wasInRoom, isInRoom in
            if wasInRoom && !isInRoom { clearJoinContext() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, session.state != nil { session.reconnect() }
            else if phase != .active { session.suspend() }
        }
        .onDisappear { session.suspend() }
    }

    private var compactQuizChrome: Bool { session.state?.isQuiz == true && session.state?.phase != .lobby }
    /// Polling revisions and server time never move a reader's scroll position.
    private var quizNavigationIdentity: String? {
        guard let state = session.state, state.isQuiz else { return nil }
        return "\(state.matchId):\(state.phase.rawValue):\(state.activeRoundID ?? "lobby")"
    }

    @ViewBuilder private var confirmationButtons: some View {
        switch confirmation {
        case .exit:
            Button("Keep place and return home") { session.suspend(); close() }
        case .leave: Button("Leave room", role: .destructive) { session.send(.leave) }
        case .close: Button("Close room", role: .destructive) { session.send(.close) }
        case .end: Button("End incomplete match", role: .destructive) { session.send(.end) }
        case .skip: Button("Skip without scoring", role: .destructive) { session.send(.skip) }
        case .forget: Button("Forget this device's access", role: .destructive) { session.forgetSavedAccess(); clearJoinContext() }
        case .kick(let id, _): Button("Remove player", role: .destructive) { session.send(.kick, playerId: id) }
        case .quizReveal: Button("Reveal and score now") { session.send(.quizReveal) }
        case nil: EmptyView()
        }
        Button("Cancel", role: .cancel) { confirmation = nil }
    }

    private func clearJoinContext() {
        acceptsSharing = false; code = ""; selection = nil
        joinFocus = nil; managesPlayers = false
    }

    @ViewBuilder private var status: some View {
        if session.busy {
            PaperCard(color: Palette.violet.opacity(0.18)) {
                VStack(alignment: .leading, spacing: 14) {
                    HStack { ProgressView(); Text("Checking with your room…").roundedFont(16) }
                    Button("Stop waiting") { session.cancelWaiting() }
                        .buttonStyle(.bordered).accessibilityIdentifier("live.cancelWaiting")
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        if let error = session.error {
            Text(error).roundedFont(15, .semibold).fixedSize(horizontal: false, vertical: true)
                .padding(18).frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.coral.opacity(0.16), in: RoundedRectangle(cornerRadius: 20))
                .accessibilityIdentifier("live.error")
        }
        if let notice = session.notice {
            Text(notice).roundedFont(14, .medium).foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("live.notice")
        }
        if session.hasPendingAction && !session.busy {
            Button("Check or retry the same action") { session.retryPendingAction() }
                .buttonStyle(.bordered).accessibilityIdentifier("live.retryAction")
        }
        if session.secureAccessNeedsRetry && session.state != nil {
            Button { session.retrySecureAccess() } label: {
                Text("Retry secure resume").frame(minHeight: 44)
            }.buttonStyle(.bordered).disabled(session.busy)
                .accessibilityHint("Saves this room's existing access on this device; it does not join again")
                .accessibilityIdentifier("live.retrySecureResume")
        }
    }

    private var entrance: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .center, spacing: 18) {
                StoryCharacter(value: 3, pose: .peek).frame(width: 84, height: 104).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 8) {
                    Text(initialQuiz == nil ? "How well do you know your people?" : "Bring your quiz to life.").quizFont(.title, .heavy)
                    Text("Host on one screen. Join on your own phones. Choose privately, then find out together.")
                        .roundedFont(15, .medium).foregroundStyle(Palette.muted)
                }
            }
            if session.hasSavedRoom || session.hasPendingAdmission || session.unreadableSavedAccess {
                recovery
            } else {
                if let initialQuiz { quizHostCard(initialQuiz); joinCard }
                else { joinCard; hostCard }
            }
            PaperCard(color: Palette.violet.opacity(0.15)) {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Before you join", systemImage: "person.2.fill").roundedFont(17)
                    Text("Live play needs an internet connection. The service receives your nickname and submissions to run the room. Quiz choices and points become visible at reveal. In mind-reading, private answers are revealed after predictions lock. The host can remove players or close the room.")
                        .roundedFont(14, .medium)
                    Text("Use a nickname, share the room only with people you trust, and keep personal details out of it. Offline challenges and pass-the-phone play remain separate.")
                        .roundedFont(14, .medium).foregroundStyle(Palette.muted)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var recovery: some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 15) {
                Text("Your place is saved securely").roundedFont(21)
                Text("Resume the room you already joined. If its reply was lost, recover that request before creating another room or seat.")
                    .roundedFont(14, .medium).foregroundStyle(Palette.muted)
                if session.unreadableSavedAccess || session.secureAccessNeedsRetry {
                    Button("Try secure access again") { session.retrySecureAccess() }
                        .buttonStyle(.bordered).accessibilityIdentifier("live.retrySecureAccess")
                }
                if session.hasSavedRoom {
                    PrimaryButton(title: "Resume saved room", symbol: "arrow.clockwise", identifier: "live.resume", disabled: session.busy) { session.resumeSavedRoom() }
                }
                if session.hasPendingAdmission {
                    PrimaryButton(title: "Recover saved request", symbol: "key", identifier: "live.recover", disabled: session.busy) { session.recoverAdmission() }
                }
                Button("Forget saved access on this device", role: .destructive) { confirmation = .forget }
                    .padding(.vertical, 10).disabled(session.busy).accessibilityIdentifier("live.forget")
            }
        }
    }

    private var joinCard: some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 16) {
                Text("Join your people").roundedFont(23, .heavy)
                input("Six-character room code", text: $code, identifier: "live.code", field: .code)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                input("Your nickname", text: $nickname, identifier: "live.nickname", field: .nickname)
                    .textInputAutocapitalization(.words).autocorrectionDisabled()
                Toggle(isOn: $acceptsSharing) {
                    Text("I understand my nickname and room play are shared with this room.")
                        .roundedFont(14, .medium)
                }.tint(Palette.ink).accessibilityIdentifier("live.consent")
                PrimaryButton(title: "Join room", symbol: "person.2", identifier: "live.join", disabled: session.busy || !acceptsSharing || code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || nickname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                    session.join(code: code, nickname: nickname, acceptsSharing: acceptsSharing)
                }
            }
        }
    }

    private var hostCard: some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 16) {
                Text("Bring a room together").roundedFont(23, .heavy)
                Text("This screen is the host controller. Join from another phone to play. You need at least two players, plus the host.")
                    .roundedFont(14, .medium).foregroundStyle(Palette.muted)
                Picker("Topic", selection: $settings.topic) {
                    Text("A bit of everything").tag("mix")
                    ForEach(TopicID.allCases) { topic in Text(topic.definition.title).tag(topic.rawValue) }
                }.tint(Palette.ink).accessibilityIdentifier("live.topic")
                Picker("Turns per player", selection: $settings.cycles) {
                    ForEach(1...3, id: \.self) { Text("\($0)").tag($0) }
                }.pickerStyle(.segmented).accessibilityIdentifier("live.cycles")
                Text("Turns per player").roundedFont(12, .medium).foregroundStyle(Palette.muted)
                Stepper("Player capacity: \(settings.capacity)", value: $settings.capacity, in: 2...12)
                    .roundedFont(14, .semibold).accessibilityIdentifier("live.capacity")
                timerPicker("Answer time", value: $settings.answerSeconds)
                timerPicker("Prediction time", value: $settings.predictSeconds)
                PrimaryButton(title: "Create room", symbol: "plus", identifier: "live.create", disabled: session.busy) { session.create(settings: settings) }
            }
        }
    }
    private func quizHostCard(_ quiz: QuizDocument) -> some View {
        PaperCard(color: Palette.violet.opacity(0.22)) {
            VStack(alignment: .leading, spacing: 16) {
                Text(quiz.title).quizFont(.title2, .heavy).fixedSize(horizontal: false, vertical: true)
                Text("\(quiz.questions.count) questions · 1,000 points per correct answer").quizFont(.subheadline, .semibold)
                Text("Creating uploads a frozen copy of this quiz, including its answer key, to the live service. Later edits in your library won’t change the room. Players see each answer key only at reveal.")
                    .quizFont(.body, .medium).fixedSize(horizontal: false, vertical: true)
                Text("You control the room from this screen. Join from another device to play. Two players are needed.")
                    .quizFont(.footnote, .medium).foregroundStyle(Palette.muted)
                Stepper("Player capacity: \(settings.capacity)", value: $settings.capacity, in: 2...12)
                    .quizFont(.body, .semibold).accessibilityIdentifier("live.capacity")
                QuizPrimaryButton(title: "Create quiz room", symbol: "person.2.fill", identifier: "live.quiz.create", disabled: session.busy) {
                    session.create(quiz: quiz, capacity: settings.capacity)
                }
            }
        }
    }
    private func input(_ title: String, text: Binding<String>, identifier: String, field: JoinField) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).roundedFont(13, .semibold)
            TextField(title, text: text).roundedFont(18).padding(16)
                .background(Palette.cream, in: RoundedRectangle(cornerRadius: 15))
                .accessibilityLabel(title).accessibilityIdentifier(identifier)
                .focused($joinFocus, equals: field)
                .submitLabel(field == .code ? .next : .done)
                .onSubmit { joinFocus = field == .code ? .nickname : nil }
        }
    }
    private func timerPicker(_ title: String, value: Binding<Int>) -> some View {
        Picker(title, selection: value) {
            Text("No timer").tag(0)
            ForEach([30, 60, 120], id: \.self) { Text("\($0) seconds").tag($0) }
        }.tint(Palette.ink)
    }

    private func room(_ state: LiveRoomState) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            if state.isQuiz {
                LiveQuizRoomContent(session: session, state: state, selection: $selection,
                    confirmReveal: { confirmation = .quizReveal }, confirmEnd: { confirmation = .end },
                    removePlayer: { confirmation = .kick($0, $1) })
            } else {
                roomHeader(state)
                if state.phase == .lobby { lobby(state) }
                else {
                    if let round = state.round { roundCard(state, round: round) }
                    if state.phase == .reveal || state.phase == .finished { results(state) }
                    if state.role == .host { hostControls(state) }
                }
            }
            if state.role == .player {
                Button("Leave room", role: .destructive) { confirmation = .leave }
                    .padding(.vertical, 14).disabled(session.busy).accessibilityIdentifier("live.leave")
            } else {
                Button("Close room for everyone", role: .destructive) { confirmation = .close }
                    .padding(.vertical, 14).disabled(session.busy).accessibilityIdentifier("live.closeRoom")
            }
        }
    }
    private func roomHeader(_ state: LiveRoomState) -> some View {
        PaperCard(color: Palette.violet.opacity(0.3)) {
            VStack(alignment: .leading, spacing: 14) {
                Text(state.role == .host ? "YOUR ROOM" : "YOU'RE IN, \(state.viewer.nickname.uppercased())")
                    .roundedFont(12, .heavy).tracking(1.3)
                Text(state.code).roundedFont(34, .heavy).textSelection(.enabled).accessibilityIdentifier("live.roomCode")
                HStack(spacing: 18) {
                    Button { UIPasteboard.general.string = state.code } label: { Label("Copy code", systemImage: "doc.on.doc") }
                        .accessibilityIdentifier("live.copyCode")
                    if let invite = session.configuration.inviteURL(code: state.code) {
                        ShareLink(item: invite) { Label("Invite", systemImage: "square.and.arrow.up") }
                            .accessibilityIdentifier("live.invite")
                    }
                }.roundedFont(14).buttonStyle(.bordered).tint(Palette.ink)
                Label(connectionText, systemImage: session.connection == .live ? "dot.radiowaves.left.and.right" : "arrow.triangle.2.circlepath")
                    .roundedFont(12, .semibold).accessibilityIdentifier("live.connection")
                if !state.hostConnected { Text("Host disconnected. Your seat stays saved; timed rounds can continue.").roundedFont(13, .medium) }
                if [.paused, .reconnecting, .connecting, .polling].contains(session.connection) {
                    Button("Reconnect now") { session.reconnect() }.buttonStyle(.bordered)
                        .disabled(session.busy).accessibilityIdentifier("live.reconnect")
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private var connectionText: String {
        switch session.connection {
        case .live: return "Live connection"
        case .polling: return "Connected · checking for updates"
        case .connecting: return "Connecting…"
        case .reconnecting: return "Reconnecting · shown state may be out of date"
        case .paused: return "Connection paused · shown state may be out of date"
        case .disconnected: return "Disconnected"
        }
    }
    private func lobby(_ state: LiveRoomState) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("The getting-to-know-you crew").roundedFont(25, .heavy)
            Text("Players: \(state.players.count) / \(state.settings.capacity) · \(state.joinLocked ? "Room locked" : "Open to join")")
                .roundedFont(14, .semibold).accessibilityIdentifier("live.rosterCount")
            if state.players.isEmpty { Text("Share the code and wait for your first players.").roundedFont(16, .medium) }
            ForEach(state.players) { player in
                HStack(spacing: 14) {
                    StoryCharacter(value: player.avatar).frame(width: 45, height: 55).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(player.nickname).roundedFont(18)
                        Text(player.connected ? "Connected" : "Reconnecting").roundedFont(12, .medium).foregroundStyle(Palette.muted)
                    }
                    Spacer(minLength: 4)
                    if state.role == .host {
                        Button { confirmation = .kick(player.id, player.nickname) } label: { Image(systemName: "person.badge.minus").frame(width: 44, height: 44) }
                            .accessibilityLabel("Remove \(player.nickname)").disabled(session.busy)
                    }
                }.padding(15).background(.white, in: RoundedRectangle(cornerRadius: 20))
            }
            if state.role == .host {
                Toggle("Lock room to new players", isOn: Binding(get: { state.joinLocked }, set: { session.send(.lock, locked: $0) }))
                    .tint(Palette.ink).disabled(session.busy).accessibilityIdentifier("live.lockRoom")
                PrimaryButton(title: "Start the match", symbol: "play.fill", identifier: "live.start", disabled: session.busy || state.players.count < 2) { session.send(.start) }
                if state.players.count < 2 { Text("Two players need to join before the match can begin.").roundedFont(13, .medium).foregroundStyle(Palette.muted) }
            } else {
                Text("Waiting for the host to start. Each player gets a turn in the spotlight.").roundedFont(16, .medium)
            }
        }
    }

    private func roundCard(_ state: LiveRoomState, round: LiveRoomRound) -> some View {
        VStack(alignment: .leading, spacing: 19) {
            Text("ROUND \(round.index) OF \(round.total)").roundedFont(12, .heavy).tracking(1.5)
            Text(state.isSubject ? "Your turn to be you." : "In the spotlight: \(round.subjectName)")
                .roundedFont(25, .heavy).accessibilityAddTraits(.isHeader)
            if state.phase == .answer || state.phase == .predict {
                LiveRoomDeadline(round: round, serverTime: state.serverTime, receivedAt: session.receivedAt)
            }
            PaperCard {
                VStack(alignment: .leading, spacing: 18) {
                    if let artwork = TopicPlayLibrary.round(id: round.prompt.id) {
                        StorySceneView(round: artwork, compact: true).frame(height: 170).allowsHitTesting(false)
                    }
                    Text(round.prompt.text).roundedFont(25, .heavy).fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("live.prompt")
                }
            }
            if state.phase == .answer || state.phase == .predict { privateTurn(state, round: round) }
        }
    }
    @ViewBuilder private func privateTurn(_ state: LiveRoomState, round: LiveRoomRound) -> some View {
        if state.role == .host {
            Text(state.phase == .answer ? "Waiting for \(round.subjectName)'s private answer." : "Predictions locked: \(round.submittedCount) / \(round.eligibleCount)")
                .roundedFont(18).accessibilityIdentifier("live.waiting")
            Text("The host cannot see private answers or predictions before the reveal.").roundedFont(14, .medium).foregroundStyle(Palette.muted)
        } else if state.canSubmit || state.ownLockedValue != nil {
            Text(state.isSubject ? "How much does this sound like you?" : "How much does this sound like \(round.subjectName)?")
                .roundedFont(18)
            LiveRoomChoicePicker(selection: state.ownLockedValue ?? selection,
                                 locked: !state.canSubmit || session.busy || session.hasPendingAction,
                                 answering: state.isSubject) { selection = $0 }
            if let locked = state.ownLockedValue {
                Label("Locked: \(locked) · \(ChoiceScale.labels[locked - 1])", systemImage: "lock.fill")
                    .roundedFont(16).accessibilityIdentifier("live.locked")
                Text(state.isSubject ? "Your answer stays hidden until the room reveals." : "Your prediction is saved. Waiting for the room.")
                    .roundedFont(14, .medium).foregroundStyle(Palette.muted)
            } else {
                PrimaryButton(title: state.isSubject ? "Lock my answer" : "Lock my prediction", symbol: "lock.fill", identifier: "live.submit", disabled: selection == nil || session.busy || session.hasPendingAction || !state.canSubmit) {
                    if let selection { session.send(state.isSubject ? .answer : .guess, value: selection) }
                }
                Text("You can change your choice until you lock it. Locked choices cannot be changed.").roundedFont(13, .medium).foregroundStyle(Palette.muted)
            }
        } else {
            Text(round.paused ? "The host has paused this round." : "Waiting for \(round.subjectName) to lock an answer before predictions begin.")
                .roundedFont(18).accessibilityIdentifier("live.waiting")
        }
    }
    private func results(_ state: LiveRoomState) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            if let reveal = state.reveal {
                PaperCard(color: reveal.valid ? Palette.lime.opacity(0.55) : Palette.violet.opacity(0.2)) {
                    VStack(alignment: .leading, spacing: 14) {
                        if reveal.valid, let answer = reveal.answer {
                            Text("The reveal").roundedFont(25, .heavy)
                            Label("\(answer) · \(ChoiceScale.labels[answer - 1])", systemImage: "sparkles").roundedFont(23)
                                .accessibilityIdentifier("live.revealedAnswer")
                            ForEach(reveal.guesses) { guess in
                                Text("\(guess.nickname): \(guess.value.map { "\($0) · \(ChoiceScale.labels[$0 - 1])" } ?? "No prediction") · \(guess.points) points")
                                    .roundedFont(15, .semibold).fixedSize(horizontal: false, vertical: true)
                            }
                        } else {
                            Text("Round not scored").roundedFont(23, .heavy)
                            Text(incompleteReason(reveal.reason)).roundedFont(16, .medium)
                            Text("The unfinished answer stays hidden.").roundedFont(14, .medium)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if state.phase == .finished {
                Text(state.completion == .complete ? "A little better acquainted." : "Match ended · incomplete")
                    .roundedFont(27, .heavy).accessibilityIdentifier("live.finished")
                if state.completion != .complete {
                    Text("These are provisional standings from scored rounds, with no final winner.").roundedFont(15, .medium).foregroundStyle(Palette.muted)
                }
            }
            Text(state.phase == .finished && state.completion == .complete ? "Final leaderboard" : "Standings so far")
                .roundedFont(21, .heavy)
            ForEach(state.leaderboard) { row in
                PaperCard {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("\(row.rank.map { "\($0). " } ?? "")\(row.nickname)").roundedFont(20)
                        Text("\(row.accuracy.map { $0.formatted(.number.precision(.fractionLength(0))) + "% accuracy" } ?? "No scored predictions yet")")
                            .roundedFont(15, .semibold)
                        Text("Points: \(row.points) · Predictions: \(row.opportunities)").roundedFont(13, .medium).foregroundStyle(Palette.muted)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
    private func hostControls(_ state: LiveRoomState) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                managesPlayers.toggle()
            } label: {
                HStack {
                    Text("Manage players")
                    Spacer(minLength: 12)
                    Image(systemName: managesPlayers ? "chevron.up" : "chevron.down")
                }.frame(minHeight: 44).contentShape(Rectangle())
            }
            .roundedFont(16).tint(Palette.ink)
            .accessibilityValue(managesPlayers ? "Expanded" : "Collapsed")
            .accessibilityHint("Shows controls for removing a player")
            .accessibilityIdentifier("live.managePlayers")
            if managesPlayers {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Removing a player during a match ends it as incomplete.")
                        .roundedFont(13, .medium).foregroundStyle(Palette.muted)
                    ForEach(state.players) { player in
                        HStack(alignment: .center, spacing: 12) {
                            Text(player.nickname).roundedFont(16)
                            Spacer(minLength: 4)
                            Button { confirmation = .kick(player.id, player.nickname) } label: {
                                Image(systemName: "person.badge.minus").frame(width: 44, height: 44)
                            }
                            .accessibilityLabel("Remove \(player.nickname)")
                            .accessibilityIdentifier("live.remove.\(player.id)")
                            .disabled(session.busy || session.hasPendingAction)
                        }
                    }
                }.padding(.top, 12)
            }
            if state.phase == .reveal {
                PrimaryButton(title: state.round?.index == state.round?.total ? "Finish match" : "Next spotlight", identifier: "live.next", disabled: session.busy) { session.send(.next) }
            }
            if state.phase == .finished {
                PrimaryButton(title: "Back to lobby for a rematch", symbol: "arrow.clockwise", identifier: "live.rematch", disabled: session.busy) { session.send(.rematch) }
            }
            if state.phase == .answer || state.phase == .predict {
                Button(state.round?.paused == true ? "Resume round" : "Pause round") { session.send(state.round?.paused == true ? .resume : .pause) }
                    .buttonStyle(.bordered).disabled(session.busy).accessibilityIdentifier("live.pauseResume")
                Button("Skip this round", role: .destructive) { confirmation = .skip }
                    .padding(.vertical, 10).disabled(session.busy).accessibilityIdentifier("live.skip")
            }
            if state.phase != .lobby && state.phase != .finished {
                Button("End match", role: .destructive) { confirmation = .end }
                    .padding(.vertical, 10).disabled(session.busy).accessibilityIdentifier("live.end")
            }
        }
    }
    private func incompleteReason(_ reason: String) -> String {
        switch reason {
        case "subject_timeout": return "The answer timer ran out before an answer was locked."
        case "player_left": return "A player left the match."
        case "player_removed": return "The host removed a player."
        case "host_ended": return "The host ended the match."
        case "skipped": return "The host skipped this round."
        default: return "This round ended without a score."
        }
    }
}

private struct LiveRoomChoicePicker: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let selection: Int?
    let locked: Bool
    let answering: Bool
    let choose: (Int) -> Void
    var body: some View {
        VStack(spacing: 12) {
            if typeSize.isAccessibilitySize {
                ForEach(1...5, id: \.self) { value in choice(value, horizontal: true) }
            } else {
                HStack(alignment: .bottom, spacing: 6) {
                    ForEach(1...5, id: \.self) { value in choice(value, horizontal: false) }
                }
            }
            Text(selection.map { ChoiceScale.labels[$0 - 1] } ?? "Five takes. Pick your instinct.")
                .roundedFont(16).foregroundStyle(Palette.muted)
        }
    }
    private func choice(_ value: Int, horizontal: Bool) -> some View {
        Button { Feel.tap(); choose(value) } label: {
            Group {
                if horizontal {
                    HStack {
                        Text("\(value)").roundedFont(20, .heavy)
                        Text(ChoiceScale.labels[value - 1]).roundedFont(17)
                        Spacer(minLength: 2)
                        if selection == value { Image(systemName: "checkmark.circle.fill") }
                    }.padding(16)
                } else {
                    VStack(spacing: 7) {
                        StoryCharacter(value: value, pose: selection == value ? .peek : .hold)
                            .frame(height: 85).accessibilityHidden(true)
                        Text("\(value)").roundedFont(17, .heavy)
                    }.padding(.vertical, 12).frame(maxWidth: .infinity)
                }
            }
            .frame(minHeight: 44).background(selection == value ? Palette.violet.opacity(0.45) : .white, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(selection == value ? Palette.ink : .clear, lineWidth: 2))
        }.buttonStyle(SquishButtonStyle()).disabled(locked)
            .accessibilityLabel("\(value), \(ChoiceScale.labels[value - 1])")
            .accessibilityValue(selection == value ? "Selected" : "Not selected")
            .accessibilityAddTraits(selection == value ? .isSelected : [])
            .accessibilityHint(answering ? "Choose how much this sounds like you." : "Predict the person in the spotlight.")
            .accessibilityIdentifier("live.choice.\(value)")
    }
}

private struct LiveRoomDeadline: View {
    let round: LiveRoomRound
    let serverTime: Int64
    let receivedAt: Date
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let elapsed = max(0, timeline.date.timeIntervalSince(receivedAt))
            let remaining = round.deadline.map { max(0, Int(ceil(Double($0 - serverTime) / 1_000 - elapsed))) }
            Text(round.paused ? "Round paused" : remaining.map { $0 > 0 ? "Time remaining: \($0) seconds" : "Checking the room's next phase…" } ?? "Take your time · no timer")
                .roundedFont(14, .semibold).foregroundStyle(Palette.muted)
                .accessibilityIdentifier("live.timer")
        }
    }
}
