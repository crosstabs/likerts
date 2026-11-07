import SwiftUI

struct ResultCard: View {
    let name: String
    let score: Int
    let title: String
    let exact: Int
    let daily: Bool
    var guesser: String? = "You"
    private var resultLine: String {
        if daily { return "\(guesser ?? "The reader") read \(name) · \(exact)/5 exact reads" }
        if let guesser { return "\(guesser) + \(name) · \(exact)/5 exact reads" }
        return "\(name)'s five takes · \(exact)/5 exact reads"
    }
    var body: some View {
        VStack(spacing: 14) {
            HStack { Text("likerts").roundedFont(24, .black).tracking(-1); Spacer(); Image(systemName: "sparkles").font(.system(size: 22, weight: .bold)) }
            HStack(alignment: .bottom, spacing: -7) {
                StoryCharacter(value: 1, pose: score > 0 ? .celebrate : .peek).frame(width: 60, height: 88).rotationEffect(.degrees(-14))
                StoryCharacter(value: 3, pose: score > 0 ? .celebrate : .peek).frame(width: 65, height: 108).rotationEffect(.degrees(10))
            }.padding(.top, 8)
            Text("\(score)%").roundedFont(85, .black).tracking(-6).minimumScaleFactor(0.6).lineLimit(1)
            Eyebrow(text: daily ? "Inside \(name)'s head" : "On the same wavelength").multilineTextAlignment(.center)
            Text(title).roundedFont(27, .heavy).tracking(-0.5).multilineTextAlignment(.center)
            Text(resultLine).roundedFont(14, .medium).multilineTextAlignment(.center)
            HStack(spacing: 6) { ForEach(0..<5) { i in Capsule().fill(i < exact ? Palette.ink : Palette.ink.opacity(0.12)).frame(width: 25, height: 6) } }.padding(.bottom, 4)
        }.padding(25).frame(maxWidth: .infinity).background(Palette.lime, in: RoundedRectangle(cornerRadius: 32)).foregroundStyle(Palette.ink)
    }
}
