import SwiftUI

private enum HomeSheet: String, Identifiable {
    case setup, join, howTo, fresh, topics, settings, live, quizzes
    var id: String { rawValue }
}

struct ContentView: View {
    @Environment(\.dynamicTypeSize) private var presentedTextSize
    @State private var session: GameSession?
    @State private var gameStore: StandaloneGameStore
    @State private var restoreFailed = false
    private let persistenceEnabled: Bool
    @State private var sheet: HomeSheet?
    @State private var showExit = false
    @State private var showParty = false
    @State private var topicRematchError = false
    @State private var dailyClock: DailyReadClock
    @State private var clockRevision = 0
    @Environment(\.scenePhase) private var appPhase
    @ObservedObject private var audio = GameAudio.shared
    @AppStorage("dailyDate") private var dailyDate = ""
    @AppStorage("dailyBest") private var dailyBest = 0
    private var daily: DailyPuzzle { dailyClock.puzzle }
    private var best: Int? { !Feel.testing && dailyDate == daily.key ? dailyBest : nil }

    init(qaChallenge: Challenge? = nil, qaAnswering: Bool = false, qaCompleted: Bool = false, dailyClock: DailyReadClock? = nil) {
        #if DEBUG
        _dailyClock = State(initialValue: dailyClock ?? DailyReadClock.forCurrentProcess())
        #else
        _dailyClock = State(initialValue: dailyClock ?? DailyReadClock())
        #endif
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        let enabled = qaChallenge == nil && (!Feel.testing || arguments.contains("-persistence-testing"))
        #else
        let enabled = qaChallenge == nil && !Feel.testing
        #endif
        let store = StandaloneGameStore()
        self.persistenceEnabled = enabled
        _gameStore = State(initialValue: store)
        #if DEBUG
        if enabled { store.applyTestingLaunchFixture() }
        #endif
        if enabled, let snapshot = store.load(), let restored = GameSession(snapshot: snapshot) {
            restored.onSnapshot = { [weak store] snapshot in _ = store?.save(snapshot) }
            _session = State(initialValue: restored)
        } else if enabled && store.hasSavedData {
            _restoreFailed = State(initialValue: true)
        }
        if let qaChallenge {
            let game = GameSession(challenge: qaChallenge)
            if qaCompleted { game.guesses = qaChallenge.answers.map(Optional.some); game.phase = .result }
            else if qaAnswering { game.phase = .answering }
            else { game.select(4) }
            _session = State(initialValue: game)
        }
    }

    var body: some View {
        ZStack {
            Palette.cream.ignoresSafeArea()
            if showParty {
                PartyView { showParty = false }
            } else if let session {
                gameScreen(session).id(session.phase)
            } else {
                HomeView(daily: daily, best: best, make: { GameAudio.shared.prewarm(); setSession(GameSession(name: "Your friend")) }, customize: { sheet = .setup }, fresh: { sheet = .fresh }, join: { sheet = .join }, playDaily: { puzzle in
                    GameAudio.shared.prewarm()
                    setSession(GameSession(challenge: puzzle.challenge, daily: puzzle))
                }, howTo: { sheet = .howTo }, party: { showParty = true }, topics: { sheet = .topics }, settings: { sheet = .settings }, live: LiveRoomConfiguration.current == nil ? nil : { sheet = .live }, quizzes: { sheet = .quizzes })
            }
        }
        .foregroundStyle(Palette.ink)
        .sheet(item: $sheet) { destination in
            switch destination {
            case .setup:
                SetupView { name in GameAudio.shared.prewarm(); setSession(GameSession(name: name)) }
            case .join:
                JoinView { challenge in
                    TopicPlayLibrary.recordPresented(ids: challenge.promptIDs)
                    GameAudio.shared.prewarm(); setSession(GameSession(challenge: challenge))
                }
            case .howTo:
                HowToView()
            case .fresh:
                FreshPackView { name, pack in GameAudio.shared.prewarm(); setSession(GameSession(name: name, pack: pack)) }
                    .environment(\.dynamicTypeSize, presentedTextSize)
            case .topics:
                TopicPickerView { topic, rounds in GameAudio.shared.prewarm(); setSession(GameSession(name: "Your friend", topic: topic, preparedRounds: rounds)) }
            case .settings:
                SoundSettingsView()
                    .environment(\.dynamicTypeSize, presentedTextSize)
            case .live:
                if let configuration = LiveRoomConfiguration.current {
                    LiveRoomView(configuration: configuration, close: { sheet = nil })
                        .environment(\.dynamicTypeSize, presentedTextSize)
                }
            case .quizzes:
                QuizLibraryView()
                    .modifier(QuizPresentationTextSize(size: presentedTextSize))
            }
        }
        .alert("Leave this game?", isPresented: $showExit) {
            Button("Keep playing", role: .cancel) {}.accessibilityIdentifier("exit.cancel")
            Button("Leave game", role: .destructive) { setSession(nil) }.accessibilityIdentifier("exit.confirm")
        } message: { Text("Your progress in this game will be lost.") }
        .alert("Game couldn't be saved", isPresented: Binding(get: { gameStore.saveFailed }, set: { if !$0 { gameStore.dismissSaveWarning() } })) {
            Button("OK", role: .cancel) { gameStore.dismissSaveWarning() }
        } message: { Text("You can keep playing, but this game may not resume if the app closes.") }
        .alert("Saved game couldn't be removed", isPresented: Binding(get: { gameStore.clearFailed }, set: { if !$0 { gameStore.dismissClearWarning() } })) {
            Button("OK", role: .cancel) { gameStore.dismissClearWarning() }
        } message: { Text("The old game won't be reopened, but its local file could not be removed. Try leaving a new game again.") }
        .alert("Saved game couldn't be restored", isPresented: $restoreFailed) {
            Button("OK", role: .cancel) { gameStore.clear() }
        } message: { Text("Start a new game to keep playing.") }
        .alert("Couldn't prepare another pack", isPresented: $topicRematchError) {
            Button("OK", role: .cancel) {}
        } message: { Text("Try again, or go home for a quick game.") }
        .onChange(of: session?.phase) { _, phase in
            if phase == nil { GameAudio.shared.stopAll() }
            guard phase == .result, let session else { return }
            recordDailyBest(for: session)
        }
        .onAppear {
            dailyClock.refresh()
            GameAudio.shared.setActive(appPhase == .active)
            if let session, session.phase == .result { recordDailyBest(for: session) }
        }
        .onChange(of: appPhase) { _, phase in
            if phase == .active { dailyClock.refresh() }
            GameAudio.shared.setActive(phase == .active)
            if phase != .active, persistenceEnabled, let session { _ = gameStore.save(session.snapshot) }
        }
        .onChange(of: showParty) { _, shown in if !shown { GameAudio.shared.stopAll() } }
        .task(id: "\(appPhase)-\(clockRevision)") {
            guard appPhase == .active else { return }
            await dailyClock.run()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)) { _ in
            dailyClock.refresh(); clockRevision &+= 1
        }
        #if DEBUG
        .overlay(alignment: .topLeading) {
            if ProcessInfo.processInfo.arguments.contains("-audio-probe") {
                Text(audio.debugTraceText).font(.system(size: 1)).foregroundStyle(.clear)
                    .accessibilityLabel(audio.debugTraceText)
                    .accessibilityIdentifier("audio.probe")
            }
            if ProcessInfo.processInfo.arguments.contains("-daily-clock-testing") {
                Button("Next test day") { dailyClock.advanceTestingDay() }
                    .font(.caption).padding(8).background(.white)
                    .accessibilityIdentifier("daily.testAdvance")
            }
        }
        #endif
    }

    private func recordDailyBest(for game: GameSession) {
        guard let puzzle = game.daily, !Feel.testing else { return }
        let updated = DailyBest.updating(savedDate: dailyDate, savedScore: dailyBest, puzzleDate: puzzle.key, score: game.score)
        dailyDate = updated.date; dailyBest = updated.score
    }

    private func setSession(_ next: GameSession?) {
        session?.onSnapshot = nil
        if persistenceEnabled {
            if let next {
                let store = gameStore
                next.onSnapshot = { [weak store] snapshot in _ = store?.save(snapshot) }
                _ = store.save(next.snapshot)
            } else { gameStore.clear() }
        }
        session = next
    }

    @ViewBuilder private func gameScreen(_ game: GameSession) -> some View {
        switch game.phase {
        case .answering, .guessing:
            RoundView(game: game, close: { showExit = true }, hideContent: game.daily == nil && game.challenge != nil ? {
                if let challenge = game.challenge { LocalContentSafety().hide(challenge) }
                setSession(nil)
            } : nil)
        case .sealed:
            HandoffView(game: game, close: { showExit = true })
        case .dailyIntro:
            DailyIntroView(game: game, close: { setSession(nil) })
        case .result:
            ResultView(game: game, home: { setSession(nil) }, rematch: {
                GameAudio.shared.prewarm()
                if game.daily == nil { TopicPlayLibrary.recordPresented(ids: game.prompts.map(\.id)) }
                if let puzzle = game.daily { setSession(GameSession(challenge: puzzle.challenge, daily: puzzle)) }
                else if let topic = game.topic {
                    do {
                        let rounds = try TopicPlayLibrary.prepare(topic: topic)
                        setSession(GameSession(name: game.name, topic: topic, preparedRounds: rounds))
                    } catch { topicRematchError = true }
                } else { setSession(GameSession(name: game.name, pack: game.pack)) }
            })
        }
    }
}

struct HomeView: View {
    let daily: DailyPuzzle
    let best: Int?
    let make: () -> Void
    let customize: () -> Void
    let fresh: () -> Void
    let join: () -> Void
    let playDaily: (DailyPuzzle) -> Void
    let howTo: () -> Void
    let party: () -> Void
    let topics: () -> Void
    let settings: () -> Void
    let live: (() -> Void)?
    var quizzes: (() -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        GeometryReader { geometry in
        ScrollView {
            VStack(alignment: .leading, spacing: 23) {
                HStack {
                    Text("likerts").roundedFont(34, .black).lineLimit(1).minimumScaleFactor(0.5)
                    Circle().fill(Palette.coral).frame(width: 8, height: 8).offset(x: -6, y: 8)
                    Spacer()
                    Button(action: settings) {
                        Image(systemName: "slider.horizontal.3").font(.system(size: 16, weight: .heavy)).frame(width: 44, height: 44).navigationGlass()
                    }.accessibilityLabel("Settings, sound and privacy").accessibilityIdentifier("home.settings")
                    Button(action: howTo) {
                        Image(systemName: "questionmark").font(.system(size: 16, weight: .heavy)).frame(width: 44, height: 44).navigationGlass()
                    }.accessibilityLabel("How to play").accessibilityIdentifier("home.howTo")
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Read my mind. I\u{00A0}dare you.")
                        .font(.system(.largeTitle, design: .rounded, weight: .black).leading(.loose))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("home.hero")
                    Text("Five takes. Two brains. Suspiciously good instincts.").roundedFont(15, .medium).foregroundStyle(Palette.muted)
                }
                StoryHomeCast(height: 142).padding(.top, -9).padding(.bottom, -8)
                VStack(spacing: 12) {
                    PrimaryButton(title: "Start a quick game", identifier: "home.makeChallenge", action: make)
                    if textSize.isAccessibilitySize {
                        VStack(spacing: 8) {
                            nicknameButton
                            playDuration
                        }.frame(maxWidth: .infinity)
                    } else {
                        HStack(spacing: 14) {
                            nicknameButton
                            Text("·").foregroundStyle(Palette.muted).accessibilityHidden(true)
                            playDuration
                        }
                    }
                    Text("Your unfinished game is saved on this device until you leave.")
                        .roundedFont(12, .medium).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("home.sessionNote")
                }
                playSteps
                if let quizzes {
                    Button(action: quizzes) {
                        HStack(spacing: 15) {
                            Image(systemName: "rectangle.stack.badge.plus").font(.system(size: 24, weight: .semibold))
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Quizzes").roundedFont(19, .heavy)
                                Text("Create, save and practice what you know.").roundedFont(12, .medium)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.up.right").font(.system(size: 14, weight: .bold))
                                .accessibilityHidden(true)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                            .padding(20).background(Palette.lime, in: RoundedRectangle(cornerRadius: 24))
                    }.buttonStyle(SquishButtonStyle()).accessibilityIdentifier("home.quizzes")
                }
                if let live {
                    Button(action: live) {
                        HStack(spacing: 15) {
                            Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 24, weight: .semibold))
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Live mind-reading").roundedFont(18, .heavy)
                                Text("Host a room. Join with a code.").roundedFont(12, .medium)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.up.right").font(.system(size: 13, weight: .bold))
                        }.padding(20).background(Palette.violet.opacity(0.38), in: RoundedRectangle(cornerRadius: 24))
                    }.buttonStyle(SquishButtonStyle()).accessibilityIdentifier("home.live")
                }
                Button(action: topics) {
                    HStack(spacing: 15) {
                        Image(systemName: "square.grid.2x2.fill").font(.system(size: 23, weight: .semibold))
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Pick your world").roundedFont(19, .heavy).fixedSize(horizontal: false, vertical: true)
                            Text("20 topics · 1,000 illustrated takes").roundedFont(12, .medium)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right").font(.system(size: 14, weight: .bold))
                    }.padding(20).background(Palette.violet.opacity(0.38), in: RoundedRectangle(cornerRadius: 24))
                }.buttonStyle(SquishButtonStyle()).accessibilityIdentifier("home.topics")
                Button(action: party) {
                    HStack(spacing: 15) {
                        Image(systemName: "person.3.fill").font(.system(size: 24, weight: .semibold))
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Who knows me best?").roundedFont(18, .heavy)
                            Text("Answer once. Dare the whole room.").roundedFont(12, .medium)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right").font(.system(size: 13, weight: .bold))
                    }.padding(20).background(Palette.lime, in: RoundedRectangle(cornerRadius: 24))
                }.buttonStyle(SquishButtonStyle()).accessibilityIdentifier("home.party")
                if textSize.isAccessibilitySize {
                    VStack(spacing: 12) { freshCard; dailyCard }
                } else {
                    HStack(alignment: .top, spacing: 12) { freshCard; dailyCard }
                }
                Button(action: join) {
                    HStack {
                        Image(systemName: "ticket").font(.system(size: 19, weight: .semibold))
                        Text("Enter a challenge").roundedFont(16)
                        Spacer()
                        Image(systemName: "arrow.right").font(.system(size: 15, weight: .bold))
                    }.padding(19).overlay(RoundedRectangle(cornerRadius: 23).strokeBorder(Palette.ink.opacity(0.15)))
                }.buttonStyle(SquishButtonStyle()).accessibilityIdentifier("home.join")
            }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 24).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }.scrollIndicators(.hidden)
            .overlay(alignment: .top) {
                // Home scrolls behind the status area. Keep its text out of
                // that area, including when a native sheet dims the underlay.
                Palette.cream.frame(height: geometry.safeAreaInsets.top)
                    .offset(y: -geometry.safeAreaInsets.top)
                    .allowsHitTesting(false).accessibilityHidden(true)
            }
        }
    }
    private var nicknameButton: some View {
        Button(action: customize) {
            Text("Add a nickname").roundedFont(13, .semibold)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 44).contentShape(Rectangle())
        }.accessibilityIdentifier("home.customize")
    }
    private var playDuration: some View {
        Label("2 minutes", systemImage: "timer").roundedFont(12, .medium)
            .foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
    }
    @ViewBuilder private var playSteps: some View {
        if textSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                Label("Answer", systemImage: "1.circle.fill")
                Label("Pass", systemImage: "2.circle.fill")
                Label("Mind-read", systemImage: "3.circle.fill")
            }.roundedFont(12, .semibold).foregroundStyle(Palette.muted)
                .frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
        } else {
            HStack(spacing: 10) {
                Label("Answer", systemImage: "1.circle.fill")
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                Label("Pass", systemImage: "2.circle.fill")
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                Label("Mind-read", systemImage: "3.circle.fill")
            }.roundedFont(12, .semibold).foregroundStyle(Palette.muted)
                .frame(maxWidth: .infinity).accessibilityElement(children: .combine)
        }
    }
    private var freshCard: some View {
        Button(action: fresh) {
            VStack(alignment: .leading, spacing: 10) {
                HStack { Image(systemName: "sparkles").font(.system(size: 25, weight: .semibold)); Spacer(); Image(systemName: "arrow.up.right").font(.system(size: 13, weight: .bold)) }
                Text("Fresh takes").roundedFont(19, .heavy)
                Text("Handpicked themes + optional AI picks").roundedFont(12, .medium).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(19).background(Palette.violet.opacity(0.40), in: RoundedRectangle(cornerRadius: 25))
        }.buttonStyle(SquishButtonStyle()).accessibilityIdentifier("home.fresh")
    }
    private var dailyCard: some View {
        Button { playDaily(daily) } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "pawprint.fill").font(.system(size: 25, weight: .semibold))
                        .foregroundStyle(Palette.ink).accessibilityHidden(true)
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.system(size: 13, weight: .bold))
                }
                Text("Daily read").roundedFont(19, .heavy)
                Text(best.map { "Your best: \($0)% · Play solo" } ?? "Meet \(daily.name). Read their mind.").roundedFont(12, .medium).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(19).background(Palette.lime, in: RoundedRectangle(cornerRadius: 25))
        }.buttonStyle(SquishButtonStyle()).accessibilityElement(children: .ignore)
            .accessibilityLabel(best.map { "Daily read. Your best: \($0) percent. Play solo." } ?? "Daily read. Meet \(daily.name). Read their mind.")
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("home.daily").accessibilityValue(daily.displayDate())
    }
}

struct SetupView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var name = ""
    @State private var nameError: String?
    let start: (String) -> Void
    var body: some View {
        SheetPage {
            HStack { Text("Make it personal.").roundedFont(28, .black).tracking(-0.6); Spacer(); CloseButton { dismiss() } }
            Text("Whose five takes are we reading?").roundedFont(16, .medium).foregroundStyle(Palette.muted)
            VStack(alignment: .leading, spacing: 10) {
                Text("Nickname · optional").roundedFont(13, .semibold)
                TextField("Your friend", text: $name).roundedFont(21).padding(18).background(.white, in: RoundedRectangle(cornerRadius: 18))
                    .textContentType(.nickname).autocorrectionDisabled().submitLabel(.done).accessibilityIdentifier("setup.name")
                    .onChange(of: name) { _, value in if value.count > 20 { name = String(value.prefix(20)) }; nameError = nil }
                if let nameError { Text(nameError).roundedFont(14, .medium).accessibilityIdentifier("setup.error") }
            }
            PrimaryButton(title: "Start five takes", identifier: "setup.start") {
                do {
                    let validated = try Challenge(name: name, promptIDs: Array(PromptBank.all.prefix(5)).map(\.id), answers: [1, 1, 1, 1, 1])
                    dismiss(); start(validated.name)
                } catch { nameError = "Try another playful nickname: up to 20 characters, with no contact details or sensitive words." }
            }
        }.presentationDetents(textSize.isAccessibilitySize ? [.large] : [.height(410), .large])
    }
}

struct JoinView: View {
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .body) private var codeFontSize: CGFloat = 18
    @State private var code = ""
    @State private var error: String?
    @FocusState private var editingCode: Bool
    let play: (Challenge) -> Void
    var body: some View {
        SheetPage {
            HStack { Eyebrow(text: "Incoming brainwave"); Spacer(); CloseButton { dismiss() } }
            Text("Someone thinks\nyou know them.").roundedFont(36, .black).tracking(-1)
            Text("Paste the challenge your friend sent. Their five takes travel with it, so you can play offline.")
                .roundedFont(17, .medium).foregroundStyle(Palette.muted)
            TextField("Paste your challenge code", text: $code, axis: .vertical)
                .font(.system(size: codeFontSize, weight: .semibold, design: .monospaced))
                .lineLimit(3...6).textInputAutocapitalization(.never).autocorrectionDisabled()
                .padding(20).background(.white, in: RoundedRectangle(cornerRadius: 20))
                .accessibilityIdentifier("join.code")
                .focused($editingCode).submitLabel(.done).onSubmit { editingCode = false }
                .onChange(of: code) { _, value in if value.count > 4096 { code = String(value.prefix(4096)) }; error = nil }
            if let error {
                Label(error, systemImage: "exclamationmark.circle").roundedFont(14, .medium)
                    .foregroundStyle(Palette.ink).accessibilityIdentifier("join.error")
            }
            PrimaryButton(title: "Read their mind", identifier: "join.play", disabled: code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                editingCode = false
                do {
                    let challenge = try ChallengeCodec.decode(code)
                    guard !LocalContentSafety().contains(challenge) else {
                        error = "This challenge is hidden here. You can clear locally hidden challenges in Settings. No report was sent."
                        return
                    }
                    dismiss(); play(challenge)
                }
                catch { self.error = error.localizedDescription }
            }
            Text("Your friend needs Likerts installed to enter a code.")
                .roundedFont(12, .medium).foregroundStyle(Palette.muted)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if editingCode {
                HStack {
                    Spacer(minLength: 8)
                    Button { editingCode = false } label: {
                        Text("Done").font(.body)
                            .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                        .accessibilityIdentifier("join.done")
                }
                .padding(.horizontal, 28).padding(.vertical, 8)
                .frame(maxWidth: 550).frame(maxWidth: .infinity)
                .foregroundStyle(Palette.ink).background(Palette.cream)
            }
        }
    }
}

struct HowToView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        SheetPage {
            HStack { Eyebrow(text: "Your two-minute brain date"); Spacer(); CloseButton { dismiss() } }
            Text("A little intuition.\nA lot of “that's so you.”").roundedFont(33, .black).tracking(-1)
            ForEach(Array([("01", "Make your five takes", "Rate each statement from 1 (not me) to 5 (so me)."), ("02", "Pass it or send it", "Hand over the phone, or send a code to a friend who has Likerts."), ("03", "Read. Reveal. Repeat.", "Your friend guesses each answer. Exact = 100 points; each step away costs 25. Your final sync is the five-round average.")].enumerated()), id: \.offset) { _, step in
                HStack(alignment: .top, spacing: 16) {
                    Text(step.0).roundedFont(18, .heavy).padding(12).background(Palette.violet.opacity(0.3), in: Circle())
                    VStack(alignment: .leading, spacing: 7) {
                        Text(step.1).roundedFont(20, .heavy)
                        Text(step.2).roundedFont(16, .medium).foregroundStyle(Palette.muted)
                    }
                }.padding(.vertical, 8)
            }
            PaperCard(color: Palette.lime) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Flying solo?").roundedFont(19, .heavy)
                    Text("The Daily Read is an authored puzzle. Meet a fictional character, use their clues, and predict their five answers. A new read rotates in at midnight UTC.")
                        .roundedFont(15, .medium)
                }
            }
        }
    }
}

struct SheetPage<Content: View>: View {
    var scrollIdentifier = "sheet.scroll"
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) { content }
                .padding(28).padding(.top, 10).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }.scrollDismissesKeyboard(.interactively).accessibilityIdentifier(scrollIdentifier).background(Palette.cream).foregroundStyle(Palette.ink).presentationDragIndicator(.visible)
    }
}

#Preview { ContentView() }
