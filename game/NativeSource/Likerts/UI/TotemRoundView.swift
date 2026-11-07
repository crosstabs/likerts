import SwiftUI

struct RoundView: View {
    let game: GameSession
    let close: () -> Void
    var blindGuess = false
    var advance: (() -> Void)? = nil
    var hideContent: (() -> Void)? = nil
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.likertsReducedEffectsTest) private var testEffects
    @Environment(\.scenePhase) private var scenePhase
    @State private var outcomeTask: Task<Void, Never>?
    @State private var sceneSoundTask: Task<Void, Never>?
    @State private var showSoundSettings = false
    @AccessibilityFocusState private var focused: Focus?
    @Namespace private var sceneSpace
    private enum Focus: Hashable { case prompt, reveal }
    private var answering: Bool { game.phase == .answering }
    private var prompt: Prompt { game.prompts[game.index] }
    private var illustratedRound: TopicRound? {
        if let exact = TopicPlayLibrary.round(id: prompt.id) { return exact }
        guard let theme = game.pack?.theme ?? PackTheme.allCases.first(where: { game.challenge?.isCustom == true && $0.emoji == prompt.emoji }) else { return nil }
        let topic: TopicID
        switch theme {
        case .everydayChaos: topic = .home
        case .foodTakes: topic = .snacks
        case .socialBattery: topic = .social
        case .sideQuests: topic = .fantasy
        }
        return TopicPlayLibrary.catalog?.rounds(for: topic).dropFirst(game.index).first
    }
    private var nextTitle: String {
        if blindGuess { return game.index == 4 ? "Lock my five guesses" : "Lock my guess" }
        if answering { return game.index == 4 ? "Seal my five takes" : "Lock it in" }
        return game.revealed ? (game.index == 4 ? "See our wavelength" : "Next brainwave") : "Lock my guess"
    }
    var body: some View {
        GeometryReader { geometry in
            let scale = min(1.15, geometry.size.width / 390)
            let spacious = geometry.size.height >= 720 && textSize <= .large && game.daily == nil && prompt.text.count <= 95
            ZStack {
                TotemBackdrop()
                if game.revealed { revealLayout(compact: geometry.size.height < 720).transition(.identity) }
                else if let illustratedRound { topicLayout(round: illustratedRound, compact: geometry.size.height < 720).transition(.identity) }
                else if spacious { referenceLayout(scale: scale) }
                else { accessibleLayout(scale: scale) }
            }.foregroundStyle(TotemTone.ink)
        }
        .onChange(of: game.index) { _, _ in outcomeTask?.cancel(); sceneSoundTask?.cancel(); focused = .prompt }
        .onChange(of: game.revealed) { _, value in focused = value ? .reveal : .prompt }
        .onChange(of: scenePhase) { _, value in if value != .active { outcomeTask?.cancel(); sceneSoundTask?.cancel() } }
        .onDisappear { outcomeTask?.cancel(); sceneSoundTask?.cancel() }
        .sheet(isPresented: $showSoundSettings) { SoundSettingsView().environment(\.dynamicTypeSize, textSize) }
    }
    private func topicLayout(round: TopicRound, compact: Bool) -> some View {
        Group {
        if textSize.isAccessibilitySize {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header
                        question.roundedFont(27, .heavy).tracking(-0.65)
                        StorySceneView(round: round, choice: game.selection, compact: true)
                            .matchedGeometryEffect(id: "scene-\(round.id)", in: sceneSpace)
                            .accessibilityHidden(TopicPlayLibrary.round(id: prompt.id) == nil)
                        if let source = game.packLabel {
                            Text(source).roundedFont(11, .medium).foregroundStyle(TotemTone.muted).accessibilityIdentifier("round.packSource")
                        }
                        ChoiceScale(selection: game.selection, answering: answering, onSelect: select)
                    }.padding(.horizontal, 24).padding(.top, 8).padding(.bottom, 24).id("accessibleTopicQuestion")
                }.onChange(of: game.index) { _, _ in proxy.scrollTo("accessibleTopicQuestion", anchor: .top) }
                    .safeAreaInset(edge: .bottom) { accessibleAction }
            }
        } else {
        VStack(spacing: 0) {
            header.padding(.horizontal, 23).padding(.top, 8).padding(.bottom, 10)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 13) {
                        HStack(spacing: 7) {
                            Image(systemName: round.topic.definition.symbol).accessibilityHidden(true)
                            Text(round.topic.definition.title.uppercased()).tracking(1.1)
                            Spacer()
                            Text(TopicPlayLibrary.round(id: prompt.id) != nil ? "CURATED" : "SHARED THEME ART").tracking(0.6)
                        }.roundedFont(10, .heavy).foregroundStyle(TotemTone.muted)
                        question.roundedFont(textSize.isAccessibilitySize || compact ? 27 : 30, .heavy).tracking(-0.65)
                        StorySceneView(round: round, choice: game.selection, compact: compact || textSize.isAccessibilitySize)
                            .matchedGeometryEffect(id: "scene-\(round.id)", in: sceneSpace)
                            .accessibilityHidden(TopicPlayLibrary.round(id: prompt.id) == nil)
                        if let source = game.packLabel, !compact || game.pack != nil || game.challenge?.isCustom == true {
                            Text(source).roundedFont(11, .medium).foregroundStyle(TotemTone.muted).accessibilityIdentifier("round.packSource")
                        }
                    }.padding(.horizontal, 24).padding(.vertical, 7).id("topicQuestion")
                }.scrollIndicators(.hidden)
                    .onChange(of: game.index) { _, _ in proxy.scrollTo("topicQuestion", anchor: .top) }
            }
        }.safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 7) {
                if textSize.isAccessibilitySize { ChoiceScale(selection: game.selection, answering: answering, onSelect: select) }
                else {
                    TotemChoiceStage(selection: game.selection, scale: 0.57, answering: answering, choose: select)
                    endpoints.padding(.horizontal, 22)
                    readout.roundedFont(18, .heavy)
                }
                action.padding(.horizontal, 22)
            }.padding(.top, 7).padding(.bottom, 8).background(TotemTone.paper)
        }
        }
        }
    }
    private func referenceLayout(scale: CGFloat) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    header.padding(.horizontal, 23).padding(.top, 13).id("roundTop")
                    TotemQuestionLabel(text: prompt.text, scale: scale).fixedSize(horizontal: false, vertical: true)
                        .accessibilityFocused($focused, equals: .prompt)
                        .padding(.horizontal, 24).padding(.top, 64 * scale)
                    TotemChoiceStage(selection: game.selection, scale: scale, answering: answering, choose: select).padding(.top, 49 * scale)
                    endpoints.padding(.horizontal, 22).padding(.top, 12 * scale)
                    readout.roundedFont(25, .heavy).padding(.top, 24 * scale)
                    if let source = game.packLabel {
                        Text(source).roundedFont(11, .medium).foregroundStyle(TotemTone.muted).padding(.top, 12).accessibilityIdentifier("round.packSource")
                    }
                    action.padding(.horizontal, 22).padding(.top, 76 * scale)
                    Spacer(minLength: 48)
                }.frame(maxWidth: 550).frame(maxWidth: .infinity)
            }.scrollIndicators(.hidden)
                .onChange(of: game.index) { _, _ in proxy.scrollTo("roundTop", anchor: .top) }
        }
    }
    private func accessibleLayout(scale: CGFloat) -> some View {
        Group {
        if textSize.isAccessibilitySize {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header
                        question.roundedFont(27, .heavy).tracking(-0.6)
                        if let puzzle = game.daily {
                            Label(puzzle.clues[game.index], systemImage: "lightbulb").roundedFont(16, .medium)
                                .padding(18).background(TotemTone.close, in: RoundedRectangle(cornerRadius: 20))
                        }
                        if let source = game.packLabel {
                            Text(source).roundedFont(12, .medium).foregroundStyle(TotemTone.muted).accessibilityIdentifier("round.packSource")
                        }
                        ChoiceScale(selection: game.selection, answering: answering, onSelect: select)
                    }.padding(.horizontal, 24).padding(.top, 8).padding(.bottom, 24).id("accessibleQuestion")
                }.onChange(of: game.index) { _, _ in proxy.scrollTo("accessibleQuestion", anchor: .top) }
                    .safeAreaInset(edge: .bottom) { accessibleAction }
            }
        } else {
        VStack(spacing: 0) {
            header.padding(.horizontal, 23).padding(.top, 8).padding(.bottom, 12)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        question.roundedFont(textSize.isAccessibilitySize ? 27 : 31, .heavy).tracking(-0.6)
                        if let puzzle = game.daily {
                            Label(puzzle.clues[game.index], systemImage: "lightbulb").roundedFont(16, .medium)
                                .padding(18).background(TotemTone.close, in: RoundedRectangle(cornerRadius: 20))
                        }
                        if let source = game.packLabel {
                            Text(source).roundedFont(12, .medium).foregroundStyle(TotemTone.muted).accessibilityIdentifier("round.packSource")
                        }
                    }.padding(.horizontal, 24).padding(.vertical, 16).id("question")
                }.onChange(of: game.index) { _, _ in proxy.scrollTo("question", anchor: .top) }
            }
        }.safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 10) {
                if textSize.isAccessibilitySize {
                    ChoiceScale(selection: game.selection, answering: answering, onSelect: select)
                } else {
                    TotemChoiceStage(selection: game.selection, scale: min(0.8, scale), answering: answering, choose: select)
                    endpoints.padding(.horizontal, 22)
                    readout.roundedFont(20, .heavy)
                }
                action.padding(.horizontal, 22)
            }.padding(.top, 10).padding(.bottom, 10).background(TotemTone.paper)
        }
        }
        }
    }
    private func revealLayout(compact: Bool) -> some View {
        Group {
        if textSize.isAccessibilitySize {
            ScrollView {
                VStack(spacing: 18) {
                    header
                    RevealStage(game: game, sceneSpace: sceneSpace, compact: compact)
                        .accessibilityFocused($focused, equals: .reveal)
                }.padding(.horizontal, 24).padding(.top, 8).padding(.bottom, 24)
                    .frame(maxWidth: 550).frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .bottom) { accessibleAction }
        } else {
        VStack(spacing: 0) {
            header.padding(.horizontal, 23).padding(.top, compact ? 8 : 13).padding(.bottom, compact ? 6 : 12)
            ScrollView {
                RevealStage(game: game, sceneSpace: sceneSpace, compact: compact).accessibilityFocused($focused, equals: .reveal)
                    .padding(.horizontal, 24).padding(.bottom, 25).frame(maxWidth: 550).frame(maxWidth: .infinity)
            }
        }.safeAreaInset(edge: .bottom) { action.padding(.horizontal, 22).padding(.vertical, 12).background(TotemTone.paper) }
        }
        }
    }
    private var question: some View {
        Text(prompt.text).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(TotemTone.ink).background(TotemTone.paper)
            .accessibilityFocused($focused, equals: .prompt).accessibilityIdentifier("round.prompt")
    }
    private var header: some View {
        HStack(spacing: textSize.isAccessibilitySize ? 8 : 18) {
            if !textSize.isAccessibilitySize || (answering && game.index > 0) {
            if answering && game.index > 0 {
                Button { game.back() } label: { Image(systemName: "arrow.left").font(.system(size: 20, weight: .semibold)).frame(width: 54, height: 54).background(TotemTone.close, in: Circle()) }
                    .accessibilityLabel("Previous answer").accessibilityIdentifier("round.back")
            } else {
                TotemRaster(name: "TotemAvatar").frame(width: 54, height: 54).accessibilityHidden(true)
            }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(answering ? "Your five takes" : "Reading \(game.name)")
                    .roundedFont(15, .bold).fixedSize(horizontal: false, vertical: true)
                Text("\(textSize.isAccessibilitySize ? (answering ? "Take" : "Guess") : (answering ? "YOUR TAKE" : "YOUR PREDICTION")) · \(game.index + 1) of 5").roundedFont(11, .bold).foregroundStyle(TotemTone.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
            Spacer(minLength: 6)
            HStack(spacing: 4) {
                if let hideContent { ContentSafetyButton(hide: hideContent) }
                // Messages uses a separate, deliberately silent extension;
                // controls in the standalone app remain available mid-round.
                if Bundle.main.bundleURL.pathExtension != "appex" && !ProcessInfo.processInfo.arguments.contains("-messages-harness") {
                    Button { showSoundSettings = true } label: {
                        Image(systemName: "speaker.wave.2").font(.system(size: 16, weight: .semibold)).frame(width: 44, height: 44).background(TotemTone.close, in: Circle())
                    }.buttonStyle(SquishButtonStyle()).accessibilityLabel("Sound and haptics settings").accessibilityIdentifier("round.settings")
                }
                Button(action: close) {
                    Image(systemName: "xmark").font(.system(size: 21, weight: .medium)).frame(width: 44, height: 44).background(TotemTone.close, in: Circle())
                }.buttonStyle(SquishButtonStyle()).accessibilityLabel("Close").accessibilityIdentifier("nav.close")
            }
        }.frame(minHeight: 54).foregroundStyle(TotemTone.ink)
    }
    private var endpoints: some View {
        HStack { Text("Not me"); Spacer(); Text("So me") }.roundedFont(14, .semibold).foregroundStyle(TotemTone.muted)
            .accessibilityElement(children: .combine).accessibilityLabel("Scale from Not me to So me")
    }
    private var readout: some View {
        Text(game.selection.map { "\($0) · \(ChoiceScale.labels[$0 - 1])" } ?? "Trust your instinct")
            .multilineTextAlignment(.center).frame(maxWidth: .infinity)
    }
    private var action: some View { TotemAction(title: nextTitle, disabled: game.selection == nil, action: next) }
    private var accessibleAction: some View {
        action.padding(.horizontal, 24).padding(.vertical, 12).background(TotemTone.paper)
    }
    private func select(_ value: Int) {
        let previous = game.selection
        game.select(value)
        guard game.selection != previous else { return }
        // All five choices use the same cue: neither pitch nor intensity
        // communicates an answer, score or direction.
        GameAudio.shared.play(.motif, token: "\(game.audioSessionID)-motif", userInitiated: true)
        GameAudio.shared.play(.choice, userInitiated: true)
    }
    private func next() {
        guard game.selection != nil else { return }
        let wasRevealed = game.revealed
        let wasGuessing = game.phase == .guessing
        let round = game.index
        let token = "\(game.audioSessionID)-\(round)"
        if !wasRevealed {
            // Blind party guesses, host answers and challenge answers all use
            // the same neutral lock; only a public individual reveal gets an
            // anticipation cue. Nothing in this branch reads the hidden answer.
            // Public reveals already have their own outcome haptic in
            // GameSession.next(); do not add a second tap on that transition.
            if !wasGuessing || blindGuess { Feel.tap() }
            GameAudio.shared.play(wasGuessing && !blindGuess ? .anticipation : .lock, userInitiated: true)
        }
        withAnimation(reduceMotion || testEffects || Feel.testing ? nil : .easeInOut(duration: 0.2)) {
            if let advance { advance() } else { game.next() }
        }
        if wasGuessing && !blindGuess && !wasRevealed && game.revealed,
           let answer = game.correctAnswer, let guess = game.selection {
            let distance = abs(answer - guess)
            let cue: GameAudio.Cue = distance == 0 ? .exact : distance == 1 ? .near : .far
            // The neutral anticipation is brief and the interface changes
            // immediately. A cancelled/advanced/backgrounded round must not
            // deliver a late outcome sound on a different screen.
            outcomeTask?.cancel()
            if let ticket = GameAudio.shared.soundTicket() { outcomeTask = Task { @MainActor in
                do { try await Task.sleep(for: .milliseconds(450)) } catch { return }
                guard !Task.isCancelled, game.phase == .guessing,
                      game.index == round, game.revealed else { return }
                GameAudio.shared.play(cue, token: "\(token)-reveal", revealAllowed: true, pendingTicket: ticket)
            } }
            // Layered scene metadata is publicly visible illustration content,
            // never a selection or answer. Native adapters have their own
            // hand-authored renderer and are deliberately not inferred here.
            if let performance = MotionProductionLibrary.performance(id: prompt.id),
               performance.renderer == .layeredGraph,
               performance.review.coverage == .actionMotion {
                let sceneCue: GameAudio.Cue?
                switch performance.reveal.action.recipe {
                case .travel, .windowDrift, .hover, .orbit: sceneCue = .sceneDrift
                case .place, .stack, .pack, .unpack, .assemble: sceneCue = .scenePlace
                default: sceneCue = nil
                }
                if let sceneCue, let ticket = GameAudio.shared.soundTicket() {
                    sceneSoundTask?.cancel()
                    sceneSoundTask = Task { @MainActor in
                        do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
                        guard !Task.isCancelled, game.phase == .guessing,
                              game.index == round, game.revealed else { return }
                        GameAudio.shared.play(sceneCue, token: "\(token)-scene", revealAllowed: true, pendingTicket: ticket)
                    }
                }
            }
        } else if wasRevealed && game.phase == .result {
            GameAudio.shared.play(.results, token: "\(game.audioSessionID)-results", userInitiated: true)
        }
    }
}

struct RevealStage: View {
    let game: GameSession
    var sceneSpace: Namespace.ID? = nil
    var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.likertsReducedEffectsTest) private var testEffects
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var arrived = false
    private var actual: Int { game.correctAnswer ?? 1 }
    private var guess: Int { game.guesses[game.index] ?? 1 }
    private var distance: Int { abs(actual - guess) }
    private var settled: Bool { arrived || reduceMotion || testEffects || Feel.testing }
    private var reaction: String { distance == 0 ? "Mind. Read." : distance == 1 ? "So close." : "Plot twist!" }
    private var explanation: String { distance == 0 ? "Exactly on their wavelength." : distance == 1 ? "One tiny step apart." : "\(distance) steps apart. Still a story to tell." }
    private var tight: Bool { compact && !textSize.isAccessibilitySize }
    var body: some View {
        VStack(spacing: tight ? 10 : 18) {
            if let round = TopicPlayLibrary.round(id: game.prompts[game.index].id) {
                if let sceneSpace {
                    StorySceneView(round: round, resolution: StoryResolution(guess: guess, answer: actual), compact: compact || textSize.isAccessibilitySize)
                        .matchedGeometryEffect(id: "scene-\(round.id)", in: sceneSpace)
                } else {
                    StorySceneView(round: round, resolution: StoryResolution(guess: guess, answer: actual), compact: compact || textSize.isAccessibilitySize)
                }
            } else {
            ZStack(alignment: .bottom) {
                TotemRaster(name: "TotemPlatform").frame(width: 300, height: 32)
                HStack(alignment: .bottom, spacing: distance == 0 ? -5 : 16) {
                    StoryCharacter(value: guess, pose: distance == 0 ? .celebrate : .peek).frame(width: 105, height: 155)
                        .rotationEffect(.degrees(distance == 0 ? 8 : -8)).offset(x: settled ? 0 : -42)
                    StoryCharacter(value: actual, pose: distance == 0 ? .celebrate : .hold).frame(width: 105, height: 155)
                        .rotationEffect(.degrees(distance == 0 ? -8 : 8)).offset(x: settled ? 0 : 42)
                }.padding(.bottom, 15)
            }.frame(height: tight ? 175 : 205).accessibilityHidden(true)
            }
            VStack(spacing: tight ? 10 : 18) {
            VStack(spacing: tight ? 4 : 8) {
                Text(reaction).roundedFont(tight ? 32 : 38, .heavy).tracking(-1).multilineTextAlignment(.center)
                Text(explanation).roundedFont(16, .medium).foregroundStyle(TotemTone.muted).multilineTextAlignment(.center)
            }
            Text("+\(game.roundPoints)").font(.system(size: tight ? 53 : 65, weight: .black, design: .rounded)).tracking(-3).padding(.vertical, tight ? 0 : 4)
            if textSize.isAccessibilitySize { VStack(spacing: 15) { guessValue; answerValue } }
            else { HStack(alignment: .top, spacing: 20) { guessValue; answerValue } }
            Text(game.prompts[game.index].text).roundedFont(15, .semibold).foregroundStyle(TotemTone.muted).multilineTextAlignment(.center).padding(.top, tight ? 4 : 12)
            }.accessibilityElement(children: .ignore)
                .accessibilityLabel("\(reaction) You guessed \(guess), \(ChoiceScale.labels[guess - 1]). \(game.name) picked \(actual), \(ChoiceScale.labels[actual - 1]). \(game.roundPoints) points. \(explanation) \(game.prompts[game.index].text)")
                .accessibilityIdentifier("round.reveal")
        }.frame(maxWidth: .infinity)
            .onAppear { withAnimation(reduceMotion || testEffects || Feel.testing ? nil : .spring(response: 0.42, dampingFraction: 0.7)) { arrived = true } }
    }
    private var guessValue: some View { value(title: "YOU GUESSED", number: guess) }
    private var answerValue: some View { value(title: "\(game.name.uppercased()) PICKED", number: actual) }
    private func value(title: String, number: Int) -> some View {
        VStack(spacing: tight ? 3 : 7) {
            Text(title).roundedFont(11, .heavy).tracking(0.6).multilineTextAlignment(.center)
            Text("\(number)").roundedFont(tight ? 32 : 37, .heavy)
            Text(ChoiceScale.labels[number - 1]).roundedFont(15, .bold)
        }.frame(maxWidth: .infinity).padding(.vertical, tight ? 3 : 12)
    }
}
