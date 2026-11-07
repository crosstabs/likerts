import SwiftUI

/// One grounded conversation starter from a validated, finished five-take game.
struct InsightCard: View {
    let insight: RoundInsight
    var hostName: String = "Your friend"
    var guesser: String? = nil
    var daily: Bool = false
    @Environment(\.dynamicTypeSize) private var textSize

    private var namedGuesser: String? {
        guard let value = guesser?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if insight.allMatched { perfectRead }
            else { biggestDifference }
        }
        .padding(23)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(insight.allMatched ? Palette.lime : Palette.violet.opacity(0.25), in: RoundedRectangle(cornerRadius: 28))
        .foregroundStyle(Palette.ink)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("result.insight")
    }

    private var perfectRead: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Eyebrow(text: "Five for five")
                Spacer()
                Image(systemName: "checkmark.seal.fill").font(.system(size: 25, weight: .semibold)).accessibilityHidden(true)
            }
            Text("No plot twist.").roundedFont(27, .black).tracking(-0.6)
            Text(namedGuesser.map { "\($0) read all five." } ?? "All five were read exactly.")
                .roundedFont(19, .heavy).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 7) {
                ForEach(0..<5) { _ in
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .black))
                        .frame(width: 31, height: 31).background(.white.opacity(0.65), in: Circle())
                }
                Spacer(minLength: 0)
            }.accessibilityElement(children: .ignore).accessibilityLabel("5 out of 5 exact reads")
            Text(daily ? "Every prediction matched \(hostName)'s authored answers." : "Every guess matched \(hostName)'s five answers.")
                .roundedFont(14, .medium).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var biggestDifference: some View {
        VStack(alignment: .leading, spacing: 18) {
            Eyebrow(text: daily ? "Your biggest prediction gap" : namedGuesser == nil ? "The biggest difference this round" : "Your biggest difference this round")
                .foregroundStyle(Palette.muted)
            Text("The biggest plot twist.").roundedFont(27, .black).tracking(-0.6)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 12) {
                Text(insight.prompt.emoji).font(.system(size: 26)).accessibilityHidden(true)
                Text(insight.prompt.text).roundedFont(18, .heavy)
                    .fixedSize(horizontal: false, vertical: true)
            }.padding(.vertical, 3)
            if textSize.isAccessibilitySize {
                VStack(spacing: 10) { guessCard; answerCard }
            } else {
                HStack(alignment: .top, spacing: 10) { guessCard; answerCard }
            }
            Label("\(insight.distance) \(insight.distance == 1 ? "step" : "steps") apart", systemImage: "arrow.left.and.right")
                .roundedFont(14, .heavy)
            Text(daily ? "A twist in this fictional character's story." : "One take worth talking about.")
                .roundedFont(13, .medium).foregroundStyle(Palette.muted)
        }
    }

    private var guessCard: some View {
        answerValue(title: namedGuesser.map { "\($0) GUESSED" } ?? "THE GUESS", value: insight.guess, color: Palette.violet.opacity(0.50))
    }
    private var answerCard: some View {
        answerValue(title: daily ? "AUTHORED ANSWER" : "\(hostName) PICKED", value: insight.answer, color: .white.opacity(0.75))
    }
    private func answerValue(title: String, value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title.uppercased()).roundedFont(9, .heavy).tracking(0.5)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(value)").roundedFont(30, .black)
            Text(ChoiceScale.labels[value - 1]).roundedFont(14, .heavy)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(15)
        .background(color, in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .combine)
    }
}

/// Render with a proposed width of 390 points. Fixed text size keeps the exported
/// card legible and predictable without changing accessibility settings in-app.
struct ResultShareCard: View {
    let name: String
    let score: Int
    let title: String
    let exact: Int
    let daily: Bool
    let insight: RoundInsight?
    var guesser: String? = nil

    var body: some View {
        VStack(spacing: 16) {
            ResultCard(name: name, score: score, title: title, exact: exact, daily: daily, guesser: guesser)
            if let insight {
                InsightCard(insight: insight, hostName: name, guesser: guesser, daily: daily)
            }
            if daily {
                Text("The Daily Read · A fictional character puzzle")
                    .roundedFont(11, .medium).foregroundStyle(Palette.muted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(22)
        .background(Palette.cream)
        .foregroundStyle(Palette.ink)
        .environment(\.dynamicTypeSize, .medium)
        .environment(\.colorScheme, .light)
    }
}
