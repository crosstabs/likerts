import SwiftUI

struct MessagesGameView: View {
    let model: MessagesGameModel
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var confirmExit = false
    @State private var help: HelpDestination?

    var body: some View {
        ZStack {
            Palette.cream.ignoresSafeArea().allowsHitTesting(false)
            if !model.isExpanded { compact }
            else {
                VStack(spacing: 0) {
                    if let detail = model.conversationDetail { banner(detail, id: "messages.conversation") }
                    if let error = model.error, model.stage != .invalid { banner(error, id: "messages.error") }
                    expanded
                }
            }
        }.foregroundStyle(Palette.ink).tint(Palette.ink).preferredColorScheme(.light)
            .sheet(item: $help) { HelpDestinationView(destination: $0).environment(\.dynamicTypeSize, textSize) }
            .alert("Leave this game?", isPresented: $confirmExit) {
                Button("Keep playing", role: .cancel) {}
                Button("Leave game", role: .destructive) { model.reset() }.accessibilityIdentifier("messages.leave")
            } message: { Text("Your unfinished answers will be lost.") }
    }

    private var compact: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 16) {
                    StoryCharacter(value: 3, pose: .hold).frame(width: 40, height: 60).rotationEffect(.degrees(8))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("likerts").roundedFont(25, .black).tracking(-1)
                        Text(compactTitle).roundedFont(14, .semibold)
                    }
                    Spacer(minLength: 0)
                }
                if let notice = model.notice { Text(notice).roundedFont(12, .medium).accessibilityIdentifier("messages.notice") }
                if let detail = model.conversationDetail { Text(detail).roundedFont(12, .medium).accessibilityIdentifier("messages.conversation") }
                PrimaryButton(title: model.stage == .home ? "I bet you can't get 5/5" : "Open game", identifier: model.stage == .home ? "messages.start" : "messages.expand") {
                    if model.stage == .home { model.start() } else { model.expand() }
                }
                helpButton
            }.padding(18).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }
    }
    private var compactTitle: String {
        switch model.stage {
        case .home: return "Five takes. One friend. Dare them."
        case .incoming: return "Your friend thinks you can't read them."
        case .waiting: return "Your five-take challenge."
        case .report: return "Your wavelength report is here."
        case .invalid: return "This card needs a fresh start."
        case .hidden: return "This challenge is hidden here."
        case .playing: return "Your game is right where you left it."
        }
    }
    @ViewBuilder private var expanded: some View {
        switch model.stage {
        case .home: home
        case .incoming: incoming
        case .waiting: waiting
        case .report: report
        case .hidden:
            page {
                Image(systemName: "eye.slash").font(.system(size: 44)).accessibilityHidden(true)
                Text("Hidden in Likerts here.").roundedFont(30, .black).accessibilityIdentifier("messages.hidden")
                Text("The card stays in Messages. No report is sent and the sender is not blocked.").roundedFont(16, .medium)
                PrimaryButton(title: "Make a new challenge", identifier: "messages.start") { model.start() }
                Button("Show this challenge again") { model.unhideSelectedChallenge() }
                    .roundedFont(15, .semibold).frame(minHeight: 44).accessibilityIdentifier("messages.unhide")
            }
        case .invalid:
            page {
                Image(systemName: "bubble.left.and.exclamationmark.bubble.right").font(.system(size: 50)).padding(.vertical, 20)
                Text("Lost the brainwave.").roundedFont(32, .black)
                Text(model.error ?? "Ask for a new game card.").roundedFont(17, .medium).accessibilityIdentifier("messages.error")
                PrimaryButton(title: "Make a new challenge", identifier: "messages.start") { model.start() }
            }
        case .playing:
            if let game = model.game {
                switch game.phase {
                case .answering, .guessing:
                    RoundView(game: game, close: { confirmExit = true }, hideContent: game.challenge == nil ? nil : { model.hideSelectedChallenge() }).id(game.phase)
                case .sealed: sealed
                case .result: report
                case .dailyIntro: EmptyView()
                }
            }
        }
    }
    private var home: some View {
        page {
            Text("Read my mind.\nI dare you.").roundedFont(36, .black).tracking(-1)
            StoryHomeCast(height: 150)
            Text("Answer five takes. Add your challenge to the conversation. Your friend guesses, then sends back the verdict.").roundedFont(17, .medium)
            nickname
            PrimaryButton(title: "I bet you can't get 5/5", identifier: "messages.start") { model.start() }
            footnote
        }
    }
    private var incoming: some View {
        page {
            safetyActions
            Eyebrow(text: "A five-take dare")
            MessageCardArtwork(name: model.envelope?.challenge.name ?? "Your friend", score: nil, exact: nil)
            Text("Think you know them?").roundedFont(30, .black)
            Text("Predict five answers. Get the reveal after each guess. Then add your result to this conversation.").roundedFont(17, .medium)
            PrimaryButton(title: "Try for 5/5", identifier: "messages.playChallenge") { model.playIncoming() }
            footnote
        }
    }
    private var sealed: some View {
        page {
            Eyebrow(text: "Five takes. Ready for a dare.")
            MessageCardArtwork(name: model.game?.name ?? "Your friend", score: nil, exact: nil)
            Text("Who really gets you?").roundedFont(31, .black)
            Text("Add this interactive card. Your friend taps it to play here in Messages.").roundedFont(17, .medium)
            PrimaryButton(title: model.isStaging ? "Adding card…" : "Add challenge to Messages", symbol: "bubble.left.and.bubble.right", identifier: "messages.draftChallenge", disabled: !model.canDraft) {
                Task { await model.draftChallenge() }
            }
            Text("You choose when to tap Send.").roundedFont(13, .semibold)
            Button { confirmExit = true } label: {
                Text("Start over").roundedFont(15, .bold).frame(minHeight: 44).contentShape(Rectangle())
            }.accessibilityIdentifier("messages.startOver")
            footnote
        }
    }
    private var waiting: some View {
        page {
            safetyActions
            Eyebrow(text: "Your challenge")
            MessageCardArtwork(name: model.envelope?.challenge.name ?? "Your friend", score: nil, exact: nil)
            Text("The dare is ready.").roundedFont(31, .black)
            Text(model.notice ?? "Your friend can tap your card to play.").roundedFont(17, .medium).accessibilityIdentifier("messages.notice")
            Text("No peeking at your own answers. Give your friend the next move.").roundedFont(14, .medium).foregroundStyle(Palette.muted)
            if model.game?.phase == .sealed {
                Button("Add card again") { Task { await model.draftChallenge() } }.roundedFont(16).frame(minHeight: 44).disabled(!model.canDraft).accessibilityIdentifier("messages.draftChallenge")
            }
            footnote
        }
    }
    private var report: some View {
        page {
            safetyActions
            if let value = model.resultEnvelope, let guesses = value.guesses, let score = value.score {
                let exact = zip(guesses, value.challenge.answers).filter { $0.0 == $0.1 }.count
                Eyebrow(text: "The wavelength report")
                ResultCard(name: value.challenge.name, score: score, title: Scoring.title(for: score), exact: exact, daily: false, guesser: nil).accessibilityIdentifier("messages.result")
                if let insight = try? RoundInsight(challenge: value.challenge, guesses: guesses) {
                    InsightCard(insight: insight, hostName: value.challenge.name)
                        .accessibilityIdentifier("messages.insight")
                }
                if model.game?.phase == .result {
                    PrimaryButton(title: model.isStaging ? "Adding card…" : "Add result to Messages", symbol: "bubble.left.and.bubble.right", identifier: "messages.draftResult", disabled: !model.canDraft) { Task { await model.draftResult() } }
                }
                if let notice = model.notice { Text(notice).roundedFont(14, .medium).accessibilityIdentifier("messages.notice") }
                PrimaryButton(title: "Your turn · Send a rematch", symbol: "arrow.triangle.2.circlepath", color: Palette.violet.opacity(0.4), foreground: Palette.ink, identifier: "messages.rematch") { model.start(rematch: true) }
                ForEach(0..<5) { index in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(value.challenge.resolvedPrompts[index].text).roundedFont(15, .bold)
                        Text("Guess \(guesses[index]) · Answer \(value.challenge.answers[index])").roundedFont(13, .medium).foregroundStyle(Palette.muted)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(.white.opacity(0.65), in: RoundedRectangle(cornerRadius: 18))
                }
                footnote
            }
        }
    }
    private var safetyActions: some View {
        HStack { Spacer(); ContentSafetyButton { model.hideSelectedChallenge() } }
    }
    private var nickname: some View {
        @Bindable var model = model
        return TextField("Nickname · optional", text: $model.nickname).roundedFont(18).padding(17).background(.white, in: RoundedRectangle(cornerRadius: 18))
            .textContentType(.nickname).autocorrectionDisabled().onChange(of: model.nickname) { _, value in model.nickname = String(value.prefix(20)) }
    }
    private var footnote: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Two players. Both need Likerts installed.\nCards contain your nickname, takes and answers. They are encoded, not encrypted or tamper-proof.")
                .roundedFont(11, .medium).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
            helpButton
        }
    }
    private var helpButton: some View {
        Button { help = .support } label: {
            Text("Help & privacy").roundedFont(14, .bold).frame(minHeight: 44).contentShape(Rectangle())
        }.accessibilityIdentifier("messages.support")
    }
    private func banner(_ text: String, id: String) -> some View {
        Text(text).roundedFont(13, .semibold).frame(maxWidth: .infinity, alignment: .leading).padding(14)
            .background(Palette.coral.opacity(0.15)).accessibilityIdentifier(id)
    }
    private func page<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) { content() }
                .padding(24).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }.scrollIndicators(.visible)
    }
}

/// Rendered into the actual MSMessageTemplateLayout image, not a web preview.
struct MessageCardArtwork: View {
    let name: String
    let score: Int?
    let exact: Int?
    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack { Text("likerts").roundedFont(28, .black).tracking(-1.4); Spacer(); Image(systemName: "sparkles").font(.system(size: 20, weight: .bold)) }
            HStack(spacing: 20) {
                HStack(alignment: .bottom, spacing: -7) {
                    StoryCharacter(value: 1, pose: .hold).frame(width: 45, height: 70).rotationEffect(.degrees(-9))
                    StoryCharacter(value: 3, pose: .hold).frame(width: 50, height: 90).rotationEffect(.degrees(9))
                }
                Text(score.map { "\($0)%" } ?? "5/5?").font(.system(size: 60, weight: .black, design: .rounded)).tracking(-3).minimumScaleFactor(0.7).lineLimit(1)
            }
            Text(score == nil ? "I bet you can't read me." : Scoring.title(for: score ?? 0)).roundedFont(22, .heavy)
            Text(score == nil ? "\(name)'s five takes · Tap to play" : "\(exact ?? 0)/5 exact reads · Tap for a rematch").roundedFont(13, .semibold)
        }.padding(24).frame(maxWidth: .infinity, alignment: .leading).background(score == nil ? Palette.violet.opacity(0.4) : Palette.lime, in: RoundedRectangle(cornerRadius: 28))
            .foregroundStyle(Palette.ink)
    }
}
