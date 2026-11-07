import SwiftUI
import UIKit

enum TotemTone {
    static let paper = Color(red: 0.996, green: 0.961, blue: 0.910)
    static let ink = Color(red: 0.122, green: 0.102, blue: 0.192)
    static let button = Color(red: 0.173, green: 0.141, blue: 0.255)
    static let muted = Color(red: 0.45, green: 0.42, blue: 0.49)
    static let close = Color(red: 0.996, green: 0.976, blue: 0.937)
}

/// Original generated raster artwork. The bounds trim transparent export margins
/// at presentation time; they never redraw, recolor or replace the sculpture.
@MainActor enum TotemArt {
    private static let bounds: [String: CGRect] = [
        "Totem1": CGRect(x: 184, y: 138, width: 913, height: 985),
        "Totem2": CGRect(x: 210, y: 210, width: 826, height: 902),
        "Totem3": CGRect(x: 270, y: 122, width: 756, height: 1025),
        "Totem4": CGRect(x: 344, y: 73, width: 598, height: 1105),
        "Totem5": CGRect(x: 128, y: 161, width: 1008, height: 963),
        "TotemPlatform": CGRect(x: 47, y: 289, width: 2080, height: 171),
        "TotemPedestal": CGRect(x: 530, y: 216, width: 988, height: 349),
        "TotemAvatar": CGRect(x: 121, y: 141, width: 1011, height: 1009)
    ]
    private static var cache: [String: UIImage] = [:]
    static func image(_ name: String) -> UIImage? {
        if let cached = cache[name] { return cached }
        guard let original = UIImage(named: name) else { return nil }
        let image: UIImage
        if let rect = bounds[name], let cg = original.cgImage?.cropping(to: rect) {
            image = UIImage(cgImage: cg, scale: 1, orientation: .up)
        } else { image = original }
        cache[name] = image
        return image
    }
    // A scene is used only after it has been authored and reviewed. New AI text
    // receives the consistent reusable cast; it does not trigger image generation.
    static let reviewedQuestionScenes: [Int: String] = [:]
}

struct TotemRaster: View {
    let name: String
    var body: some View {
        if let image = TotemArt.image(name) {
            Image(uiImage: image).resizable().scaledToFit().accessibilityHidden(true)
        }
    }
}

/// Native text with a deliberate display baseline. Larger type and long/clue
/// layouts use scalable SwiftUI Text instead, with no forced line-height cap.
struct TotemQuestionLabel: UIViewRepresentable {
    let text: String
    let scale: CGFloat
    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.numberOfLines = 0
        label.isAccessibilityElement = true
        label.accessibilityIdentifier = "round.prompt"
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return label
    }
    func updateUIView(_ label: UILabel, context: Context) {
        let descriptor = UIFont.systemFont(ofSize: 41 * scale, weight: .heavy).fontDescriptor.withDesign(.rounded)
        let font = descriptor.map { UIFont(descriptor: $0, size: 41 * scale) } ?? .systemFont(ofSize: 41 * scale, weight: .heavy)
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = 43 * scale
        paragraph.maximumLineHeight = 43 * scale
        paragraph.lineBreakMode = .byWordWrapping
        label.attributedText = NSAttributedString(string: text, attributes: [.font: font, .kern: -1, .foregroundColor: UIColor(TotemTone.ink), .paragraphStyle: paragraph])
        label.accessibilityLabel = text
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UILabel, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(size.height))
    }
}

struct TotemBackdrop: View {
    var body: some View {
        GeometryReader { geometry in
            Image("TotemBackground").resizable().scaledToFill()
                .frame(width: geometry.size.width, height: geometry.size.height).clipped()
        }.background(TotemTone.paper).ignoresSafeArea().accessibilityHidden(true).allowsHitTesting(false)
    }
}

struct TotemChoiceStage: View {
    let selection: Int?
    var scale: CGFloat = 1
    var answering = false
    let choose: (Int) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.likertsReducedEffectsTest) private var testEffects
    private let heights: [CGFloat] = [81, 81, 108, 123, 81]
    private let widths: [CGFloat] = [72, 72, 80, 68, 80]
    private let positions: [CGFloat] = [0.126, 0.310, 0.492, 0.672, 0.867]
    @ScaledMetric(relativeTo: .caption) private var minimumOrdinalSize: CGFloat = 13
    private var ordinalSize: CGFloat { max(minimumOrdinalSize, 16 * scale) }
    private var badgeSize: CGFloat { max(32 * scale, ordinalSize + 10) }
    private var stageHeight: CGFloat { 198 * scale + max(0, badgeSize - 32 * scale) }
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                TotemRaster(name: "TotemPlatform").frame(width: geometry.size.width - 22 * scale, height: 36 * scale)
                    .shadow(color: TotemTone.ink.opacity(0.08), radius: 7, y: 5)
                    .position(x: geometry.size.width / 2, y: 144 * scale)
                ForEach(1...5, id: \.self) { value in
                    Button { Feel.tap(); choose(value) } label: {
                        VStack(spacing: 0) {
                            ZStack(alignment: .bottom) {
                                if selection == value {
                                    TotemRaster(name: "TotemPedestal").frame(width: 70 * scale, height: 25 * scale).offset(y: 10 * scale)
                                }
                                TotemRaster(name: "Totem\(value)")
                                    .frame(width: widths[value - 1] * scale, height: heights[value - 1] * scale)
                                    .offset(y: selection == value ? -6 * scale : 0)
                            }.frame(height: 138 * scale, alignment: .bottom)
                            Spacer().frame(height: 28 * scale)
                            Text("\(value)").font(.system(size: ordinalSize, weight: .semibold, design: .rounded))
                                .foregroundStyle(selection == value ? .white : TotemTone.ink)
                                .frame(width: badgeSize, height: badgeSize)
                                .background(selection == value ? TotemTone.ink : TotemTone.paper, in: Circle())
                                .accessibilityHidden(true)
                        }.frame(width: max(54, 70 * scale), height: stageHeight).contentShape(Rectangle())
                    }.buttonStyle(SquishButtonStyle())
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(value), \(ChoiceScale.labels[value - 1])")
                        .accessibilityValue(selection == value ? "selected" : "not selected")
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAddTraits(selection == value ? [.isSelected] : [])
                        .accessibilityHint(answering ? "Choose how much this statement sounds like you." : "Predict how much this statement sounds like the person who answered.")
                        .accessibilityIdentifier("round.choice.\(value)")
                        .position(x: geometry.size.width * positions[value - 1], y: stageHeight / 2)
                }
            }
        }.frame(height: stageHeight)
            .animation(reduceMotion || testEffects || Feel.testing ? nil : .spring(response: 0.34, dampingFraction: 0.67), value: selection)
    }
}

struct TotemAction: View {
    let title: String
    let disabled: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack {
                Text(title).roundedFont(20, .bold)
                Spacer(minLength: 12)
                Image(systemName: "arrow.right").font(.system(size: 22, weight: .semibold))
            }.padding(.horizontal, 23).frame(minHeight: 65).padding(.vertical, 1)
                .foregroundStyle(disabled ? TotemTone.ink.opacity(0.55) : .white)
                .background(disabled ? TotemTone.ink.opacity(0.14) : TotemTone.button, in: RoundedRectangle(cornerRadius: 28))
                .shadow(color: TotemTone.ink.opacity(disabled ? 0 : 0.06), radius: 9, y: 4)
        }.buttonStyle(SquishButtonStyle()).disabled(disabled).accessibilityIdentifier("round.next")
    }
}
