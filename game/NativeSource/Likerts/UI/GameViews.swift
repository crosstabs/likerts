import SwiftUI

struct HandoffView: View {
    let game: GameSession
    let close: () -> Void
    @State private var challengeToShare: ChallengeSheet?
    private var named: Bool { game.name != "Your friend" }
    var body: some View {
        ScrollView {
            VStack(spacing: 21) {
                HStack { Eyebrow(text: "Five takes, sealed."); Spacer(); CloseButton(action: close) }
                ZStack(alignment: .bottom) {
                    HStack(alignment: .bottom, spacing: 70) {
                        StoryCharacter(value: 3, pose: .hold).frame(width: 94, height: 132).rotationEffect(.degrees(-8))
                        StoryCharacter(value: 5, pose: .peek).frame(width: 90, height: 120).rotationEffect(.degrees(8))
                    }
                    StoryRaster(ref: "set/envelope").frame(width: 154, height: 110).offset(y: 9)
                }.frame(height: 164).padding(.top, 8).accessibilityHidden(true)
                Text(named ? "\(game.name)'s takes\nare sealed." : "Five takes, sealed.\nPass it over.")
                    .roundedFont(32, .black).tracking(-0.9).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                Text("Your answers stay hidden.\nPass the phone to your guesser.")
                    .roundedFont(16, .medium).foregroundStyle(Palette.muted).multilineTextAlignment(.center).lineSpacing(3)
                Text("Their turn to read your mind.").roundedFont(12, .semibold).foregroundStyle(Palette.muted)
            }.padding(24).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }.scrollIndicators(.hidden)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 6) {
                    PrimaryButton(title: "I'm the guesser", symbol: "eye", identifier: "handoff.guess") { GameAudio.shared.prewarm(); game.beginGuessing() }
                    Button { if let challenge = game.challenge { challengeToShare = ChallengeSheet(challenge: challenge) } } label: {
                        Label("Friend far away? Send a code", systemImage: "square.and.arrow.up")
                            .roundedFont(14, .semibold).multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true).padding(.vertical, 13).frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(SquishButtonStyle()).accessibilityIdentifier("handoff.share")
                }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 8)
                    .frame(maxWidth: 550).frame(maxWidth: .infinity).background(Palette.cream)
            }
            .sheet(item: $challengeToShare) { value in ChallengeShareView(challenge: value.challenge) }
    }
}

struct DailyIntroView: View {
    let game: GameSession
    let close: () -> Void
    var body: some View {
        if let puzzle = game.daily {
            ScrollView {
                VStack(alignment: .leading, spacing: 25) {
                    HStack { Eyebrow(text: "The daily read · Solo"); Spacer(); CloseButton(action: close) }
                    Text(puzzle.emoji).font(.system(size: 88)).frame(maxWidth: .infinity).padding(30).background(Palette.lime, in: RoundedRectangle(cornerRadius: 35))
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(text: puzzle.tagline).foregroundStyle(Palette.muted)
                        Text("Meet \(puzzle.name).").roundedFont(43, .black).tracking(-1).accessibilityIdentifier("daily.identity")
                        Text(puzzle.bio).roundedFont(19, .medium).lineSpacing(5)
                    }
                    PaperCard(color: Palette.violet.opacity(0.25)) {
                        Label("Read the clues. Predict five answers.\nHow well can you read a stranger?", systemImage: "sparkles").roundedFont(16, .semibold).lineSpacing(4)
                    }
                    PrimaryButton(title: "I've got a read on them", identifier: "daily.start") { GameAudio.shared.prewarm(); game.beginGuessing() }
                    Text("An authored fictional character · \(puzzle.displayDate())\nA new read at midnight UTC. Replays welcome.").roundedFont(11, .medium).foregroundStyle(Palette.muted).frame(maxWidth: .infinity).multilineTextAlignment(.center).accessibilityIdentifier("daily.date")
                }.padding(24).frame(maxWidth: 550).frame(maxWidth: .infinity)
            }.scrollIndicators(.hidden)
        }
    }
}

struct ResultView: View {
    let game: GameSession
    let home: () -> Void
    let rematch: () -> Void
    @State private var activity: SharePayload?
    private var insight: RoundInsight? {
        guard let challenge = game.challenge else { return nil }
        return try? RoundInsight(challenge: challenge, guesses: game.guesses.compactMap { $0 })
    }
    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                HStack {
                    Eyebrow(text: game.daily == nil ? "The wavelength report" : "Daily read complete"); Spacer()
                    Button(action: home) { Image(systemName: "house").font(.system(size: 17, weight: .bold)).frame(width: 44, height: 44).navigationGlass() }.accessibilityLabel("Home").accessibilityIdentifier("result.home")
                }
                StoryOutcomeHeader(game: game)
                if let puzzle = game.daily, puzzle.key != DailyPuzzle.today().key {
                    Text("Daily read · \(puzzle.displayDate())").roundedFont(12, .medium).foregroundStyle(Palette.muted)
                }
                if let insight {
                    StoryInsightSummary(insight: insight, name: game.name, daily: game.daily != nil)
                }
                VStack(alignment: .leading, spacing: 15) {
                    Eyebrow(text: "The five brainwaves").foregroundStyle(Palette.muted)
                    ForEach(Array(game.prompts.enumerated()), id: \.element.id) { index, prompt in
                        HStack(alignment: .top, spacing: 13) {
                            Text(prompt.emoji).font(.system(size: 24)).frame(width: 32)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(prompt.text).roundedFont(14, .bold)
                                Text("You guessed \(game.guesses[index] ?? 1) · \(game.name) picked \(game.challenge?.answers[index] ?? 1)").roundedFont(11, .medium).foregroundStyle(Palette.muted)
                            }
                            Spacer(minLength: 0)
                            if let challenge = game.challenge {
                                Text("\(Scoring.points(guess: game.guesses[index] ?? 1, answer: challenge.answers[index]))").roundedFont(15, .heavy)
                            }
                        }
                        if index < 4 { Divider().overlay(Palette.ink.opacity(0.05)) }
                    }
                }.padding(22).background(.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 27))
                Text("Five tiny takes. A surprising amount of you.").roundedFont(11, .medium).foregroundStyle(Palette.muted)
            }.padding(24).frame(maxWidth: 550).frame(maxWidth: .infinity)
        }.scrollIndicators(.hidden)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 8) {
                    PrimaryButton(title: game.daily == nil ? "Share our wavelength" : "Share my read", symbol: "square.and.arrow.up", identifier: "result.share", action: shareResult)
                    PrimaryButton(title: game.daily != nil ? "Read them again" : game.pack != nil ? "Play this pack again" : "New takes · Play again", symbol: "arrow.triangle.2.circlepath", color: Palette.violet.opacity(0.4), foreground: Palette.ink, identifier: "result.rematch") {
                        GameAudio.shared.play(.rematch, userInitiated: true)
                        rematch()
                    }
                }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 8)
                    .frame(maxWidth: 550).frame(maxWidth: .infinity).background(Palette.cream)
            }
            .sheet(item: $activity) { payload in ActivityView(items: payload.items) }
    }
    private func shareResult() {
        let renderer = ImageRenderer(content: ResultShareCard(name: game.name, score: game.score, title: game.title, exact: game.exactCount, daily: game.daily != nil, insight: insight, guesser: "You").frame(width: 390))
        renderer.scale = 3
        let shareText = game.daily == nil
            ? "\(game.score)% on the same wavelength with \(game.name). Think you could read my mind? #Likerts"
            : "I scored \(game.score)% reading \(game.name) in the Likerts Daily Read. Five predictions about a fictional character. #Likerts"
        var items: [Any] = [shareText]
        if let image = renderer.uiImage { items.insert(ResultShareItem(image: image, title: "\(game.score)% · \(game.title)"), at: 0) }
        activity = SharePayload(items: items)
    }
}

private struct StoryOutcomeHeader: View {
    let game: GameSession
    @Environment(\.dynamicTypeSize) private var textSize
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .center, spacing: 16) {
                HStack(alignment: .bottom, spacing: -11) {
                    StoryCharacter(value: 1, pose: game.score > 0 ? .celebrate : .peek).frame(width: 55, height: 79).rotationEffect(.degrees(-8))
                    StoryCharacter(value: 3, pose: game.score > 0 ? .celebrate : .peek).frame(width: 58, height: 90).rotationEffect(.degrees(7))
                }.accessibilityHidden(true)
                Spacer(minLength: 0)
                Text("\(game.score)%").roundedFont(textSize.isAccessibilitySize ? 54 : 64, .black)
                    .tracking(-3).minimumScaleFactor(0.6).lineLimit(1)
            }
            Text(game.title).roundedFont(25, .heavy).tracking(-0.6).fixedSize(horizontal: false, vertical: true)
            Text(game.daily == nil ? "\(game.exactCount)/5 exact reads with \(game.name)." : "\(game.exactCount)/5 exact reads of \(game.name).")
                .roundedFont(13, .medium).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.lime, in: RoundedRectangle(cornerRadius: 28))
            .accessibilityElement(children: .contain)
    }
}

private struct StoryInsightSummary: View {
    let insight: RoundInsight
    let name: String
    let daily: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Eyebrow(text: insight.allMatched ? "Five for five" : daily ? "Your biggest prediction gap" : "The biggest plot twist")
                .foregroundStyle(Palette.muted)
            if insight.allMatched {
                Text("No plot twist.").roundedFont(23, .heavy).tracking(-0.4)
                Text("You read all five.").roundedFont(16, .medium)
            } else {
                Text(insight.prompt.text).roundedFont(18, .heavy).fixedSize(horizontal: false, vertical: true)
                Text("You guessed \(insight.guess) · \(name) picked \(insight.answer)")
                    .roundedFont(13, .semibold).fixedSize(horizontal: false, vertical: true)
                Text("\(insight.distance) \(insight.distance == 1 ? "step" : "steps") apart. One take worth talking about.")
                    .roundedFont(12, .medium).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
            }
        }.padding(19).frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.violet.opacity(0.20), in: RoundedRectangle(cornerRadius: 24))
            .accessibilityElement(children: .contain).accessibilityIdentifier("result.insight")
    }
}

